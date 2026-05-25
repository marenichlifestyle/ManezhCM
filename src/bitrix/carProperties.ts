import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config';
import { logger } from '../logger';
import { BitrixClient } from './client';
import { BitrixFieldMapKey } from './fieldMap';
import { BitrixProductProperty, listProductProperties } from './productProperties';

export interface CarPropertyDefinition {
  key: BitrixFieldMapKey;
  name: string;
  code: string;
  type: 'S' | 'N';
  multiple: 'Y' | 'N';
}

export interface EnsuredCarProperty {
  definition: CarPropertyDefinition;
  property: BitrixProductProperty;
  status: 'created' | 'found';
}

const FIELD_MAP_PATH = path.resolve('src/bitrix/fieldMap.ts');

export const CAR_PROPERTY_DEFINITIONS: CarPropertyDefinition[] = [
  { key: 'brand', name: 'Марка', code: 'CAR_BRAND', type: 'S', multiple: 'N' },
  { key: 'model', name: 'Модель', code: 'CAR_MODEL', type: 'S', multiple: 'N' },
  { key: 'generation', name: 'Поколение', code: 'CAR_GENERATION', type: 'S', multiple: 'N' },
  { key: 'year', name: 'Год', code: 'CAR_YEAR', type: 'N', multiple: 'N' },
  { key: 'mileage', name: 'Пробег', code: 'CAR_MILEAGE', type: 'N', multiple: 'N' },
  { key: 'vin', name: 'VIN', code: 'CAR_VIN', type: 'S', multiple: 'N' },
  { key: 'body', name: 'Кузов', code: 'CAR_BODY', type: 'S', multiple: 'N' },
  { key: 'color', name: 'Цвет', code: 'CAR_COLOR', type: 'S', multiple: 'N' },
  { key: 'engine', name: 'Двигатель', code: 'CAR_ENGINE', type: 'S', multiple: 'N' },
  { key: 'volume', name: 'Объем двигателя', code: 'CAR_VOLUME', type: 'S', multiple: 'N' },
  { key: 'power', name: 'Мощность', code: 'CAR_POWER', type: 'N', multiple: 'N' },
  { key: 'gear', name: 'Коробка', code: 'CAR_GEAR', type: 'S', multiple: 'N' },
  { key: 'drive', name: 'Привод', code: 'CAR_DRIVE', type: 'S', multiple: 'N' },
  { key: 'wheel', name: 'Руль', code: 'CAR_WHEEL', type: 'S', multiple: 'N' },
  { key: 'doors', name: 'Дверей', code: 'CAR_DOORS', type: 'N', multiple: 'N' },
  { key: 'equipmentName', name: 'Комплектация', code: 'CAR_EQUIPMENT', type: 'S', multiple: 'N' },
  { key: 'modificationName', name: 'Модификация', code: 'CAR_MODIFICATION', type: 'S', multiple: 'N' },
  { key: 'stockState', name: 'Состояние склада', code: 'CAR_STOCK_STATE', type: 'S', multiple: 'N' },
  { key: 'saleStatus', name: 'Статус продажи', code: 'CAR_SALE_STATUS', type: 'S', multiple: 'N' },
  { key: 'publishStatus', name: 'Статус публикации', code: 'CAR_PUBLISH_STATUS', type: 'S', multiple: 'N' },
  { key: 'vehicleAvailability', name: 'Доступность авто', code: 'CAR_AVAILABILITY', type: 'S', multiple: 'N' },
  { key: 'vehicleState', name: 'Состояние авто', code: 'CAR_VEHICLE_STATE', type: 'S', multiple: 'N' },
  { key: 'dealerSitePublicationUrl', name: 'Ссылка на сайт', code: 'CAR_URL', type: 'S', multiple: 'N' },
  { key: 'photosUrls', name: 'Фото URL', code: 'CAR_PHOTOS_URLS', type: 'S', multiple: 'Y' }
];

const FIELD_MAP_KEYS: BitrixFieldMapKey[] = [
  'brand',
  'model',
  'pseudoModel',
  'generation',
  'year',
  'mileage',
  'body',
  'color',
  'drive',
  'engine',
  'gear',
  'power',
  'volume',
  'wheel',
  'doors',
  'vin',
  'dmsCarId',
  'equipmentName',
  'modificationName',
  'stockState',
  'saleStatus',
  'publishStatus',
  'vehicleAvailability',
  'vehicleState',
  'dealerSitePublicationUrl',
  'publicationDescription',
  'photos',
  'photosUrls'
];

export async function createCarPropertiesCommand(): Promise<void> {
  const config = loadConfig({ bitrix: true, bitrixIblock: true });
  const client = new BitrixClient(config.bitrix.webhookBaseUrl, config.bitrix.delayMs, config.bitrix.maxRetries);
  const ensured = await ensureCarProperties(client, config.bitrix.iblockId as number);

  const updatedFieldMap = await writeFieldMap(ensured);

  console.table(
    ensured.map((item) => ({
      status: item.status,
      key: item.definition.key,
      id: item.property.id,
      bitrixField: `property${item.property.id}`,
      code: item.property.code,
      name: item.property.name,
      type: item.property.propertyType,
      multiple: item.property.multiple
    }))
  );

  console.log('');
  console.log(`Updated ${path.relative(process.cwd(), FIELD_MAP_PATH)}`);
  console.table(
    CAR_PROPERTY_DEFINITIONS.map((definition) => ({
      key: definition.key,
      fieldMapValue: updatedFieldMap[definition.key]
    }))
  );
}

export async function ensureCarProperties(
  client: BitrixClient,
  iblockId: number
): Promise<EnsuredCarProperty[]> {
  const existingProperties = await listProductProperties(client, iblockId);
  const existingByCode = new Map<string, BitrixProductProperty>();
  const existingByName = new Map<string, BitrixProductProperty>();

  for (const property of existingProperties) {
    if (property.code) {
      existingByCode.set(normalizeCode(property.code), property);
    }
    if (property.name) {
      existingByName.set(normalizeName(property.name), property);
    }
  }

  const ensured: EnsuredCarProperty[] = [];

  for (const [index, definition] of CAR_PROPERTY_DEFINITIONS.entries()) {
    const existing =
      existingByCode.get(normalizeCode(definition.code)) ??
      existingByName.get(normalizeName(definition.name));

    if (existing) {
      ensured.push({ definition, property: existing, status: 'found' });
      continue;
    }

    const property = await addProductProperty(client, {
      iblockId,
      name: definition.name,
      code: definition.code,
      propertyType: definition.type,
      multiple: definition.multiple,
      isRequired: 'N',
      active: 'Y',
      sort: 500 + index * 10
    });

    logger.info(
      { id: property.id, key: definition.key, code: definition.code, name: definition.name },
      'Created Bitrix24 product property'
    );

    existingByCode.set(normalizeCode(definition.code), property);
    existingByName.set(normalizeName(definition.name), property);
    ensured.push({ definition, property, status: 'created' });
  }

  return ensured;
}

async function addProductProperty(client: BitrixClient, fields: Record<string, unknown>): Promise<BitrixProductProperty> {
  const result = await client.call<unknown>('catalog.productProperty.add', { fields });
  return {
    ...fields,
    ...normalizeProductPropertyResult(result)
  } as BitrixProductProperty;
}

async function writeFieldMap(ensured: EnsuredCarProperty[]): Promise<Record<BitrixFieldMapKey, string>> {
  const existingValues = await readCurrentFieldMapValues();
  const values: Record<BitrixFieldMapKey, string> = { ...existingValues };

  for (const item of ensured) {
    values[item.definition.key] = `property${item.property.id}`;
  }

  const content = buildFieldMapFileContent(values);
  await fs.writeFile(FIELD_MAP_PATH, content);
  return values;
}

async function readCurrentFieldMapValues(): Promise<Record<BitrixFieldMapKey, string>> {
  const values = Object.fromEntries(FIELD_MAP_KEYS.map((key) => [key, ''])) as Record<BitrixFieldMapKey, string>;

  try {
    const content = await fs.readFile(FIELD_MAP_PATH, 'utf8');
    for (const key of FIELD_MAP_KEYS) {
      const match = content.match(new RegExp(`${key}:\\s*["']([^"']*)["']`));
      if (match) {
        values[key] = match[1];
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  return values;
}

function buildFieldMapFileContent(values: Record<BitrixFieldMapKey, string>): string {
  return `export type BitrixFieldMapKey =
${FIELD_MAP_KEYS.map((key, index) => `  ${index === 0 ? '|' : '|'} "${key}"`).join('\n')};

export const bitrixFieldMap: Record<BitrixFieldMapKey, string> = {
${FIELD_MAP_KEYS.map((key) => `  ${key}: "${values[key] ?? ''}"`).join(',\n')}
};

export function getConfiguredBitrixFieldMapEntries(): Array<[BitrixFieldMapKey, string]> {
  return (Object.entries(bitrixFieldMap) as Array<[BitrixFieldMapKey, string]>).filter(
    ([, bitrixProperty]) => bitrixProperty.trim() !== ""
  );
}

export function hasConfiguredBitrixFieldMap(): boolean {
  return getConfiguredBitrixFieldMapEntries().length > 0;
}
`;
}

function normalizeProductPropertyResult(result: unknown): BitrixProductProperty {
  if (typeof result === 'number' || typeof result === 'string') {
    return { id: result };
  }

  if (!result || typeof result !== 'object') {
    throw new Error('Bitrix24 catalog.productProperty.add returned an empty result');
  }

  const record = result as Record<string, unknown>;
  const productProperty = record.productProperty;

  if (typeof productProperty === 'number' || typeof productProperty === 'string') {
    return { id: productProperty };
  }

  if (productProperty && typeof productProperty === 'object') {
    return productProperty as BitrixProductProperty;
  }

  if (typeof record.id === 'number' || typeof record.id === 'string') {
    return record as BitrixProductProperty;
  }

  throw new Error(`Unexpected Bitrix24 product property response: ${JSON.stringify(result)}`);
}

function normalizeCode(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeName(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}
