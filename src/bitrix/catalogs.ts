import { loadConfig } from '../config';
import { BitrixClient } from './client';

export interface BitrixCatalog {
  id: number | string;
  iblockId?: number | string;
  name?: string;
  productIblockId?: number | string | null;
  [key: string]: unknown;
}

export async function listCatalogs(client: BitrixClient): Promise<BitrixCatalog[]> {
  return client.listAll<BitrixCatalog>(
    'catalog.catalog.list',
    {
      select: ['id', 'iblockId', 'name', 'productIblockId', 'iblockTypeId']
    },
    'catalogs'
  );
}

export async function printCatalogs(): Promise<void> {
  const config = loadConfig({ bitrix: true });
  const client = new BitrixClient(config.bitrix.webhookBaseUrl, config.bitrix.delayMs, config.bitrix.maxRetries);
  const catalogs = await listCatalogs(client);

  console.table(
    catalogs.map((catalog) => ({
      catalogId: catalog.id,
      iblockId: catalog.iblockId,
      name: catalog.name,
      productIblockId: catalog.productIblockId ?? ''
    }))
  );
}
