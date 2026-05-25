import axios from 'axios';
import { logger } from '../logger';
import { withRetry } from '../utils/retry';
import { BitrixClient } from './client';

export interface BitrixProduct {
  id: number | string;
  iblockId?: number | string;
  iblockSectionId?: number | string | null;
  name?: string;
  active?: string;
  xmlId?: string;
  previewPicture?: unknown;
  detailPicture?: unknown;
  [key: string]: unknown;
}

export interface BitrixImageFile {
  fileName: string;
  base64: string;
}

export async function listProducts(client: BitrixClient, iblockId: number): Promise<BitrixProduct[]> {
  return client.listAll<BitrixProduct>(
    'catalog.product.list',
    {
      select: [
        'id',
        'iblockId',
        'iblockSectionId',
        'name',
        'active',
        'xmlId',
        'previewPicture',
        'detailPicture'
      ],
      filter: {
        iblockId
      },
      order: {
        id: 'ASC'
      }
    },
    'products'
  );
}

export async function addProduct(
  client: BitrixClient,
  fields: Record<string, unknown>
): Promise<BitrixProduct> {
  const result = await client.call<unknown>('catalog.product.add', { fields });
  return normalizeProductResult(result);
}

export async function updateProduct(
  client: BitrixClient,
  id: number | string,
  fields: Record<string, unknown>
): Promise<BitrixProduct> {
  const result = await client.call<unknown>('catalog.product.update', { id, fields });
  return normalizeProductResult(result, id);
}

export async function getProductFields(client: BitrixClient, iblockId: number): Promise<Record<string, unknown>> {
  let result: Record<string, unknown>;
  try {
    result = await client.call<Record<string, unknown>>('catalog.product.getFieldsByFilter', {
      filter: { iblockId }
    });
  } catch (error) {
    logger.warn({ error: String((error as Error).message ?? error) }, 'Fallback to catalog.product.getFields');
    result = await client.call<Record<string, unknown>>('catalog.product.getFields');
  }

  return result.product && typeof result.product === 'object'
    ? (result.product as Record<string, unknown>)
    : result;
}

export function productHasPicture(product: BitrixProduct | undefined): boolean {
  if (!product) return false;
  return Boolean(product.previewPicture || product.detailPicture);
}

export async function downloadImageAsBitrixFile(url: string): Promise<BitrixImageFile> {
  const response = await withRetry(
    () =>
      axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: 30_000,
        maxContentLength: 20 * 1024 * 1024
      }),
    {
      onRetry: (error, attempt, delayMs) => {
        logger.warn({ error: String((error as Error).message ?? error), attempt, delayMs, url }, 'Retry image download');
      }
    }
  );

  const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
  if (contentType && !contentType.startsWith('image/')) {
    throw new Error(`Photo URL returned non-image content-type: ${contentType}`);
  }

  const fileName = getFileNameFromUrl(url, contentType);
  return {
    fileName,
    base64: Buffer.from(response.data).toString('base64')
  };
}

function normalizeProductResult(result: unknown, fallbackId?: number | string): BitrixProduct {
  if (typeof result === 'number' || typeof result === 'string') {
    return { id: result };
  }

  if (!result || typeof result !== 'object') {
    return { id: fallbackId ?? '' };
  }

  const record = result as Record<string, unknown>;
  const product = record.product;

  if (typeof product === 'number' || typeof product === 'string') {
    return { id: product };
  }

  if (product && typeof product === 'object') {
    return product as BitrixProduct;
  }

  if ((typeof record.id === 'number' || typeof record.id === 'string') && record.id !== '') {
    return record as BitrixProduct;
  }

  return { ...record, id: fallbackId ?? '' } as BitrixProduct;
}

function getFileNameFromUrl(url: string, contentType: string): string {
  try {
    const parsed = new URL(url);
    const pathPart = parsed.pathname.split('/').filter(Boolean).pop();
    if (pathPart && /\.[a-z0-9]+$/i.test(pathPart)) {
      return pathPart;
    }
  } catch {
    // Fall back below.
  }

  const extension = contentTypeToExtension(contentType);
  return `car-photo.${extension}`;
}

function contentTypeToExtension(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('avif')) return 'avif';
  return 'jpg';
}
