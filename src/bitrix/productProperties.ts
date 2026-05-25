import { loadConfig } from '../config';
import { BitrixClient } from './client';
import { getProductFields } from './products';

export interface BitrixProductProperty {
  id: number | string;
  iblockId?: number | string;
  name?: string;
  code?: string;
  propertyType?: string;
  userType?: string | null;
  multiple?: string;
  active?: string;
  sort?: number | string;
  [key: string]: unknown;
}

export async function listProductProperties(
  client: BitrixClient,
  iblockId: number
): Promise<BitrixProductProperty[]> {
  return client.listAll<BitrixProductProperty>(
    'catalog.productProperty.list',
    {
      select: ['id', 'iblockId', 'name', 'code', 'propertyType', 'userType', 'multiple', 'active', 'sort'],
      filter: {
        iblockId
      },
      order: {
        sort: 'ASC',
        id: 'ASC'
      }
    },
    'productProperties'
  );
}

export async function printProductFieldsAndProperties(): Promise<void> {
  const config = loadConfig({ bitrix: true, bitrixIblock: true });
  const client = new BitrixClient(config.bitrix.webhookBaseUrl, config.bitrix.delayMs, config.bitrix.maxRetries);

  const fields = await getProductFields(client, config.bitrix.iblockId as number);
  const properties = await listProductProperties(client, config.bitrix.iblockId as number);

  console.log('Standard product fields:');
  console.log(JSON.stringify(fields, null, 2));
  console.log('');
  console.log('Product properties / characteristics:');

  if (properties.length === 0) {
    console.log('No product properties found for this iblockId.');
    return;
  }

  console.table(
    properties.map((property) => ({
      id: property.id,
      code: property.code || '',
      name: property.name || '',
      type: property.propertyType || '',
      userType: property.userType || '',
      multiple: property.multiple || '',
      active: property.active || '',
      bitrixField: `property${property.id}`
    }))
  );
}
