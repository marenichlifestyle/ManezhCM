export type RawCar = Record<string, unknown>;

export interface NormalizedCar {
  raw: RawCar;
  externalCode: string;
  name: string;
  sectionBrand: string;
  sectionModel: string;
  brand?: string;
  model?: string;
  pseudoModel?: string;
  generation?: string;
  year?: number;
  mileage?: number;
  body?: string;
  color?: string;
  equipmentName?: string;
  modificationName?: string;
  drive?: string;
  engine?: string;
  gear?: string;
  power?: number;
  volume?: number;
  wheel?: string;
  doors?: number;
  stockState?: string;
  saleStatus?: string;
  publishStatus?: string;
  vehicleAvailability?: string;
  vehicleState?: string;
  publicationDescription?: string;
  dealerSitePublicationUrl?: string;
  vin?: string;
  dmsCarId?: string;
  sellingPrice?: number;
  photos: string[];
  photosUrls: string[];
}

const FIELD_KEYS = [
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
  'sellingPrice'
] as const;

export type NormalizedFieldKey = (typeof FIELD_KEYS)[number] | 'photos' | 'photosUrls';

export function isImportableCar(raw: RawCar): boolean {
  const dealerSitePublicationUrl = toStringValue(findField(raw, 'dealerSitePublicationUrl'));
  const saleStatus = toStringValue(findField(raw, 'saleStatus'));

  return saleStatus === 'onsale' && (Boolean(dealerSitePublicationUrl) || hasPublishedSignal(raw));
}

export function normalizeCar(raw: RawCar): NormalizedCar | null {
  const dmsCarId = toStringValue(findField(raw, 'dmsCarId'));
  const vin = toStringValue(findField(raw, 'vin'));
  const dealerSitePublicationUrl = toStringValue(findField(raw, 'dealerSitePublicationUrl'));
  const externalCode = (dmsCarId || vin || dealerSitePublicationUrl || '').trim();

  if (!externalCode) {
    return null;
  }

  const brand = toStringValue(findField(raw, 'brand'));
  const model = toStringValue(findField(raw, 'model'));
  const modificationName = toStringValue(findField(raw, 'modificationName'));
  const year = toNumberValue(findField(raw, 'year'));
  const photos = extractPhotoUrls(raw);
  const photosUrls = extractPhotosUrls(raw, photos);

  const nameParts = [
    year ? String(year) : undefined,
    brand,
    model,
    modificationName
  ].filter(Boolean);

  return {
    raw,
    externalCode,
    name: nameParts.join(' ') || externalCode,
    sectionBrand: brand || 'Без марки',
    sectionModel: model || 'Без модели',
    brand,
    model,
    pseudoModel: toStringValue(findField(raw, 'pseudoModel')),
    generation: toStringValue(findField(raw, 'generation')),
    year,
    mileage: toNumberValue(findField(raw, 'mileage')),
    body: toStringValue(findField(raw, 'body')),
    color: toStringValue(findField(raw, 'color')),
    equipmentName: toStringValue(findField(raw, 'equipmentName')),
    modificationName,
    drive: toStringValue(findField(raw, 'drive')),
    engine: toStringValue(findField(raw, 'engine')),
    gear: toStringValue(findField(raw, 'gear')),
    power: toNumberValue(findField(raw, 'power')),
    volume: toNumberValue(findField(raw, 'volume')),
    wheel: toStringValue(findField(raw, 'wheel')),
    doors: toNumberValue(findField(raw, 'doors')),
    stockState: toStringValue(findField(raw, 'stockState')),
    saleStatus: toStringValue(findField(raw, 'saleStatus')),
    publishStatus: toStringValue(findField(raw, 'publishStatus')),
    vehicleAvailability: toStringValue(findField(raw, 'vehicleAvailability')),
    vehicleState: toStringValue(findField(raw, 'vehicleState')),
    publicationDescription: toStringValue(findField(raw, 'publicationDescription')),
    dealerSitePublicationUrl,
    vin,
    dmsCarId,
    sellingPrice: toNumberValue(findField(raw, 'sellingPrice')),
    photos,
    photosUrls
  };
}

export function getNormalizedValue(car: NormalizedCar, key: NormalizedFieldKey): unknown {
  return car[key];
}

export function extractPhotoUrls(value: unknown): string[] {
  const found = new Set<string>();

  function visit(node: unknown, path: string[], insidePhotoContainer: boolean): void {
    if (node === null || node === undefined) return;

    if (typeof node === 'string') {
      const candidate = node.trim();
      if (insidePhotoContainer && isHttpUrl(candidate)) {
        found.add(candidate);
      }
      return;
    }

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, path, insidePhotoContainer);
      }
      return;
    }

    if (typeof node !== 'object') return;

    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const childPath = [...path, key];
      const nextInsidePhotoContainer = insidePhotoContainer || isPhotoContainerKey(key);

      if (
        nextInsidePhotoContainer &&
        ['url', 'uri', 'src', 'href', 'link'].includes(key.toLowerCase()) &&
        typeof child === 'string' &&
        isHttpUrl(child)
      ) {
        found.add(child.trim());
      }

      visit(child, childPath, nextInsidePhotoContainer);
    }
  }

  visit(value, [], false);
  return [...found];
}

function extractPhotosUrls(raw: RawCar, fallback: string[]): string[] {
  const value = findField(raw, 'photosUrls');
  if (Array.isArray(value)) {
    const urls = value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item && isHttpUrl(item));

    if (urls.length > 0) {
      return [...new Set(urls)];
    }
  }

  return fallback;
}

function findField(raw: RawCar, fieldName: string): unknown {
  if (Object.prototype.hasOwnProperty.call(raw, fieldName)) {
    return raw[fieldName];
  }

  return findByKey(raw, fieldName, new Set());
}

function hasPublishedSignal(raw: RawCar): boolean {
  const publishStatus = toStringValue(findField(raw, 'publishStatus'))?.toLowerCase();
  if (publishStatus === 'published') {
    return true;
  }

  const stockPublications = findField(raw, 'stockPublications');
  if (!Array.isArray(stockPublications)) {
    return false;
  }

  return stockPublications.some((publication) => {
    if (!publication || typeof publication !== 'object') return false;
    return (publication as Record<string, unknown>).publish === true;
  });
}

function findByKey(value: unknown, targetKey: string, seen: Set<unknown>): unknown {
  if (!value || typeof value !== 'object') return undefined;
  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findByKey(item, targetKey, seen);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key === targetKey) return child;
    const found = findByKey(child, targetKey, seen);
    if (found !== undefined) return found;
  }

  return undefined;
}

function toStringValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
}

function toNumberValue(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const normalized = typeof value === 'number' ? value : Number(String(value).replace(/\s/g, ''));
  return Number.isFinite(normalized) ? normalized : undefined;
}

function isPhotoContainerKey(key: string): boolean {
  return /photo|image|picture|gallery|media/i.test(key);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}
