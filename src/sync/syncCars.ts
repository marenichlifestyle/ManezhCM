import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config';
import { CmExpertClient, shouldFetchNextPage } from '../cmExpert/client';
import { isImportableCar, normalizeCar, NormalizedCar, RawCar } from '../cmExpert/normalize';
import { BitrixClient } from '../bitrix/client';
import { BitrixSectionService } from '../bitrix/sections';
import {
  addProduct,
  downloadImageAsBitrixFile,
  listProducts,
  productHasPicture,
  updateProduct,
  BitrixProduct
} from '../bitrix/products';
import { hasConfiguredBitrixFieldMap } from '../bitrix/fieldMap';
import { buildProductFields } from '../bitrix/productMapper';
import { listProductProperties } from '../bitrix/productProperties';
import { upsertProductPrice } from '../bitrix/prices';
import { logger } from '../logger';
import { acquireSyncLock } from './lock';
import { readState, writeState } from './state';

export interface SyncReport {
  received: number;
  filtered: number;
  unique: number;
  created: number;
  updated: number;
  archived: number;
  skipped: number;
  errors: number;
  dryRun: boolean;
}

const ERRORS_PATH = path.resolve('errors/sync-errors.jsonl');

export async function syncCars(options: { dryRun?: boolean; limit?: number } = {}): Promise<SyncReport> {
  const config = loadConfig({ cm: true, bitrix: true, bitrixIblock: true });
  const dryRun = options.dryRun ?? config.sync.dryRun;
  const limit = options.limit ?? config.sync.limit;
  const isLimitedRun = Boolean(limit && limit > 0);
  const report: SyncReport = {
    received: 0,
    filtered: 0,
    unique: 0,
    created: 0,
    updated: 0,
    archived: 0,
    skipped: 0,
    errors: 0,
    dryRun
  };

  const lock = await acquireSyncLock();

  try {
    logger.info({ dryRun }, 'Starting CM.Expert to Bitrix24 cars sync');

    const state = await readState();
    const cmClient = new CmExpertClient(config.cm);
    const bitrixClient = new BitrixClient(config.bitrix.webhookBaseUrl, config.bitrix.delayMs, config.bitrix.maxRetries);

    const rawCars = await fetchRawCarsForSync(cmClient, limit);
    report.received = rawCars.length;

    if (rawCars.length === 0) {
      logger.warn('CM.Expert returned 0 cars; skip all Bitrix24 writes and archiving');
      logger.info(report, 'Sync finished');
      return report;
    }

    const filteredRawCars = rawCars.filter(isImportableCar);
    report.filtered = filteredRawCars.length;

    const allCars = dedupeCars(filteredRawCars.map(normalizeCar).filter(isNormalizedCar), report);
    const cars = limit && limit > 0 ? allCars.slice(0, limit) : allCars;
    report.unique = cars.length;
    if (isLimitedRun) {
      logger.warn({ limit, availableUniqueCount: allCars.length, selectedCount: cars.length }, 'SYNC_LIMIT enabled; only selected cars will be processed');
    }

    if (cars.length > 0 && cars.every((car) => car.photos.length === 0)) {
      logger.warn('No photo URLs detected in CM.Expert cars; Bitrix24 product pictures will not be changed');
    }

    const products = await listProducts(bitrixClient, config.bitrix.iblockId as number);
    const productsByXmlId = new Map<string, BitrixProduct>();
    for (const product of products) {
      if (product.xmlId) {
        productsByXmlId.set(String(product.xmlId), product);
      }
    }

    const sectionService = new BitrixSectionService(
      bitrixClient,
      config.bitrix.iblockId as number,
      config.bitrix.rootSectionName
    );
    const productProperties = hasConfiguredBitrixFieldMap()
      ? await listProductProperties(bitrixClient, config.bitrix.iblockId as number)
      : [];
    let dryRunCharacteristicPreviewPrinted = false;

    for (const car of cars) {
      try {
        const existingProduct = productsByXmlId.get(car.externalCode);
        const sectionId = await sectionService.ensureCarSection(car.sectionBrand, car.sectionModel, dryRun);
        const image = await prepareProductImage(car, existingProduct, dryRun);
        const productFields = buildProductFields({
          car,
          iblockId: config.bitrix.iblockId as number,
          sectionId,
          includeIblockId: !existingProduct,
          image,
          productProperties
        });
        const fields = productFields.fields;

        if (dryRun && !dryRunCharacteristicPreviewPrinted) {
          printDryRunCharacteristicPreview(car, productFields.characteristics);
          dryRunCharacteristicPreviewPrinted = true;
        }

        if (existingProduct) {
          if (!dryRun) {
            await updateProduct(bitrixClient, existingProduct.id, fields);
            await upsertProductPrice({
              client: bitrixClient,
              productId: existingProduct.id,
              price: car.sellingPrice,
              currency: 'RUB'
            });
          }
          report.updated += 1;
          continue;
        }

        if (!dryRun) {
          const createdProduct = await addProduct(bitrixClient, fields);
          await upsertProductPrice({
            client: bitrixClient,
            productId: createdProduct.id,
            price: car.sellingPrice,
            currency: 'RUB'
          });
          productsByXmlId.set(car.externalCode, createdProduct);
        }
        report.created += 1;
      } catch (error) {
        report.errors += 1;
        await writeItemError(car, error);
        logger.error({ error: serializeError(error), externalCode: car.externalCode }, 'Failed to sync car; continue next');
      }
    }

    if (isLimitedRun) {
      logger.warn('Limited sync run: skip archiving missing products and skip state baseline update');
    } else {
      await archiveMissingProducts({
        dryRun,
        report,
        state,
        currentCodes: new Set(cars.map((car) => car.externalCode)),
        productsByXmlId,
        bitrixClient
      });
    }

    const previousCount = state.lastSuccessfulCount ?? 0;
    const shouldPersistState =
      !dryRun && !isLimitedRun && report.errors === 0 && !(previousCount > 0 && cars.length < previousCount * 0.5);

    if (shouldPersistState) {
      await writeState({
        lastSuccessfulSyncAt: new Date().toISOString(),
        lastSuccessfulCount: cars.length,
        knownExternalCodes: cars.map((car) => car.externalCode).sort()
      });
    } else if (dryRun) {
      logger.info('Dry run: state file was not updated');
    } else if (isLimitedRun) {
      logger.info('Limited sync run: state file was not updated');
    } else if (report.errors > 0) {
      logger.warn({ errors: report.errors }, 'State file was not updated because sync finished with item errors');
    } else {
      logger.warn({ previousCount, currentCount: cars.length }, 'State file was not updated because current count dropped by more than 50%');
    }

    logger.info(report, 'Sync finished');
    return report;
  } finally {
    await lock.release();
  }
}

async function fetchRawCarsForSync(cmClient: CmExpertClient, limit?: number): Promise<RawCar[]> {
  const perPage = 50;
  if (!limit || limit <= 0) {
    return cmClient.getAllCars(perPage);
  }

  const rawCars: RawCar[] = [];
  const selectedExternalCodes = new Set<string>();

  for (let page = 1; page <= 1000; page += 1) {
    const pageResult = await cmClient.getCarsPage(page, perPage);
    rawCars.push(...pageResult.cars);

    logger.info({ page, pageCount: pageResult.cars.length, totalReceived: rawCars.length }, 'Fetched CM.Expert cars page');

    for (const rawCar of pageResult.cars) {
      if (!isImportableCar(rawCar)) continue;

      const car = normalizeCar(rawCar);
      if (!car) continue;

      selectedExternalCodes.add(car.externalCode);
      if (selectedExternalCodes.size >= limit) {
        logger.warn(
          { limit, selectedCount: selectedExternalCodes.size, totalReceived: rawCars.length },
          'Limited CM.Expert fetch stopped after collecting selected cars'
        );
        return rawCars;
      }
    }

    if (!shouldFetchNextPage(pageResult.raw, pageResult.cars.length, page, perPage)) {
      break;
    }
  }

  return rawCars;
}

function dedupeCars(cars: NormalizedCar[], report: SyncReport): NormalizedCar[] {
  const byExternalCode = new Map<string, NormalizedCar>();

  for (const car of cars) {
    if (!car.externalCode) {
      report.skipped += 1;
      continue;
    }

    if (byExternalCode.has(car.externalCode)) {
      report.skipped += 1;
      logger.warn({ externalCode: car.externalCode }, 'Skip duplicate CM.Expert car by externalCode');
      continue;
    }

    byExternalCode.set(car.externalCode, car);
  }

  return [...byExternalCode.values()];
}

function printDryRunCharacteristicPreview(
  car: NormalizedCar,
  characteristics: ReturnType<typeof buildProductFields>['characteristics']
): void {
  const payload = {
    dryRunCharacteristicPreview: {
      externalCode: car.externalCode,
      name: car.name,
      sentToBitrix: characteristics.sent,
      skippedEmptyFieldMap: characteristics.skippedEmptyFieldMap,
      skippedEmptyValue: characteristics.skippedEmptyValue,
      skippedUnknownProperty: characteristics.skippedUnknownProperty
    }
  };

  console.log(JSON.stringify(payload, null, 2));
}

async function prepareProductImage(
  car: NormalizedCar,
  existingProduct: BitrixProduct | undefined,
  dryRun: boolean
) {
  if (dryRun || car.photos.length === 0 || productHasPicture(existingProduct)) {
    return undefined;
  }

  for (const photoUrl of car.photos) {
    try {
      return await downloadImageAsBitrixFile(photoUrl);
    } catch (error) {
      logger.warn({ error: serializeError(error), externalCode: car.externalCode, photoUrl }, 'Skip one product photo URL');
    }
  }

  logger.warn({ externalCode: car.externalCode, photoCount: car.photos.length }, 'No downloadable product photos found');
  return undefined;
}

async function archiveMissingProducts(options: {
  dryRun: boolean;
  report: SyncReport;
  state: Awaited<ReturnType<typeof readState>>;
  currentCodes: Set<string>;
  productsByXmlId: Map<string, BitrixProduct>;
  bitrixClient: BitrixClient;
}): Promise<void> {
  const { dryRun, report, state, currentCodes, productsByXmlId, bitrixClient } = options;
  const previousCount = state.lastSuccessfulCount ?? 0;
  const isFirstRun = !state.lastSuccessfulSyncAt || state.knownExternalCodes.length === 0;
  const droppedTooMuch = previousCount > 0 && currentCodes.size < previousCount * 0.5;

  if (isFirstRun) {
    logger.info('First successful sync baseline is not present; skip archiving missing products');
    return;
  }

  if (droppedTooMuch) {
    logger.warn({ previousCount, currentCount: currentCodes.size }, 'Current car count dropped by more than 50%; skip archiving missing products');
    return;
  }

  for (const externalCode of state.knownExternalCodes) {
    if (currentCodes.has(externalCode)) continue;

    const product = productsByXmlId.get(externalCode);
    if (!product || product.active === 'N') {
      continue;
    }

    try {
      if (!dryRun) {
        await updateProduct(bitrixClient, product.id, { active: 'N' });
      }
      report.archived += 1;
    } catch (error) {
      report.errors += 1;
      await writeArchiveError(externalCode, error);
      logger.error({ error: serializeError(error), externalCode }, 'Failed to archive missing product; continue next');
    }
  }
}

async function writeItemError(car: NormalizedCar, error: unknown): Promise<void> {
  await writeErrorLine({
    timestamp: new Date().toISOString(),
    type: 'item',
    externalCode: car.externalCode,
    vin: car.vin,
    dmsCarId: car.dmsCarId,
    error: serializeError(error)
  });
}

async function writeArchiveError(externalCode: string, error: unknown): Promise<void> {
  await writeErrorLine({
    timestamp: new Date().toISOString(),
    type: 'archive',
    externalCode,
    error: serializeError(error)
  });
}

async function writeErrorLine(payload: Record<string, unknown>): Promise<void> {
  await fs.mkdir(path.dirname(ERRORS_PATH), { recursive: true });
  await fs.appendFile(ERRORS_PATH, `${JSON.stringify(payload)}\n`);
}

function isNormalizedCar(value: NormalizedCar | null): value is NormalizedCar {
  return value !== null;
}

function serializeError(error: unknown): Record<string, unknown> {
  const candidate = error as {
    name?: string;
    message?: string;
    code?: string | number;
    status?: number;
    response?: { status?: number; data?: unknown };
  };

  return {
    name: candidate.name,
    message: candidate.message ?? String(error),
    code: candidate.code,
    status: candidate.status ?? candidate.response?.status,
    response: candidate.response?.data
  };
}
