import { logger } from '../logger';
import { BitrixClient } from './client';

export interface BitrixPriceType {
  id: number | string;
  name?: string;
  base?: string;
  xmlId?: string;
  [key: string]: unknown;
}

export interface BitrixPrice {
  id: number | string;
  productId?: number | string;
  catalogGroupId?: number | string;
  price?: number | string;
  currency?: string;
  [key: string]: unknown;
}

let cachedPriceTypeId: number | undefined;

export async function getDefaultPriceTypeId(client: BitrixClient): Promise<number> {
  if (cachedPriceTypeId) {
    return cachedPriceTypeId;
  }

  const priceTypes = await client.listAll<BitrixPriceType>(
    'catalog.priceType.list',
    {
      select: ['id', 'name', 'base', 'xmlId'],
      order: { id: 'ASC' }
    },
    'priceTypes'
  );

  const selected =
    priceTypes.find((type) => type.base === 'Y') ??
    priceTypes.find((type) => String(type.name).toUpperCase() === 'BASE') ??
    priceTypes.find((type) => String(type.xmlId).toUpperCase() === 'BASE') ??
    priceTypes[0];

  if (!selected) {
    throw new Error('No Bitrix24 price types found. Check catalog permissions for the webhook user.');
  }

  cachedPriceTypeId = Number(selected.id);
  logger.info({ priceTypeId: cachedPriceTypeId, priceTypeName: selected.name }, 'Selected Bitrix24 price type');
  return cachedPriceTypeId;
}

export async function upsertProductPrice(options: {
  client: BitrixClient;
  productId: number | string;
  price?: number;
  currency: string;
}): Promise<void> {
  if (options.price === undefined) {
    logger.debug({ productId: options.productId }, 'Skip price update: car has no sellingPrice');
    return;
  }

  const catalogGroupId = await getDefaultPriceTypeId(options.client);
  const prices = await options.client.listAll<BitrixPrice>(
    'catalog.price.list',
    {
      select: ['id', 'productId', 'catalogGroupId', 'price', 'currency'],
      filter: {
        productId: options.productId,
        catalogGroupId
      }
    },
    'prices'
  );

  const existing = prices[0];
  if (existing) {
    await options.client.call('catalog.price.update', {
      id: existing.id,
      fields: {
        price: options.price,
        currency: options.currency
      }
    });
    return;
  }

  await options.client.call('catalog.price.add', {
    fields: {
      productId: options.productId,
      catalogGroupId,
      price: options.price,
      currency: options.currency
    }
  });
}
