import { NormalizedCar, NormalizedFieldKey, getNormalizedValue } from '../cmExpert/normalize';
import { bitrixFieldMap, BitrixFieldMapKey } from './fieldMap';
import { BitrixImageFile } from './products';
import { BitrixProductProperty } from './productProperties';

export interface CharacteristicMappingItem {
  sourceKey: BitrixFieldMapKey;
  bitrixFieldMapValue: string;
  bitrixField?: string;
  propertyId?: number | string;
  propertyCode?: string;
  propertyName?: string;
  propertyType?: string;
  multiple?: string;
  value?: unknown;
  reason?: string;
}

export interface CharacteristicMappingResult {
  fields: Record<string, unknown>;
  sent: CharacteristicMappingItem[];
  skippedEmptyFieldMap: CharacteristicMappingItem[];
  skippedEmptyValue: CharacteristicMappingItem[];
  skippedUnknownProperty: CharacteristicMappingItem[];
}

export interface ProductFieldsBuildResult {
  fields: Record<string, unknown>;
  characteristics: CharacteristicMappingResult;
}

export function buildProductFields(options: {
  car: NormalizedCar;
  iblockId: number;
  sectionId?: number;
  includeIblockId: boolean;
  image?: BitrixImageFile;
  productProperties?: BitrixProductProperty[];
}): ProductFieldsBuildResult {
  const characteristics = buildCharacteristicFields(options.car, options.productProperties ?? []);
  const description = buildProductDescription(options.car);
  const fields: Record<string, unknown> = {
    name: options.car.name,
    active: 'Y',
    xmlId: options.car.externalCode,
    detailText: description,
    detailTextType: 'text',
    previewText: description,
    previewTextType: 'text',
    ...characteristics.fields
  };

  if (options.includeIblockId) {
    fields.iblockId = options.iblockId;
  }

  if (options.sectionId) {
    fields.iblockSectionId = options.sectionId;
  }

  if (options.image) {
    const fileData = [options.image.fileName, options.image.base64];
    fields.previewPicture = { fileData };
    fields.detailPicture = { fileData };
  }

  return { fields, characteristics };
}

function buildProductDescription(car: NormalizedCar): string {
  const parts = [car.publicationDescription?.trim()].filter(Boolean) as string[];

  if (car.cmExpertUrl) {
    parts.push(`Ссылка CM.Expert: ${car.cmExpertUrl}`);
  }

  return parts.join('\n\n');
}

export function buildCharacteristicFields(
  car: NormalizedCar,
  productProperties: BitrixProductProperty[]
): CharacteristicMappingResult {
  const fields: Record<string, unknown> = {};
  const result: CharacteristicMappingResult = {
    fields,
    sent: [],
    skippedEmptyFieldMap: [],
    skippedEmptyValue: [],
    skippedUnknownProperty: []
  };

  const propertiesByCode = new Map<string, BitrixProductProperty>();
  const propertiesById = new Map<string, BitrixProductProperty>();

  for (const property of productProperties) {
    propertiesById.set(String(property.id), property);
    if (property.code) {
      propertiesByCode.set(normalizePropertyCode(property.code), property);
    }
  }

  for (const [sourceKey, bitrixFieldMapValue] of Object.entries(bitrixFieldMap) as Array<[BitrixFieldMapKey, string]>) {
    const configuredValue = bitrixFieldMapValue.trim();
    const sourceValue = getNormalizedValue(car, sourceKey as NormalizedFieldKey);

    if (!configuredValue) {
      result.skippedEmptyFieldMap.push({
        sourceKey,
        bitrixFieldMapValue: '',
        value: previewValue(sourceValue),
        reason: 'empty fieldMap value'
      });
      continue;
    }

    const value = normalizePropertyValue(sourceValue);
    if (value === undefined) {
      result.skippedEmptyValue.push({
        sourceKey,
        bitrixFieldMapValue: configuredValue,
        reason: 'empty CM.Expert value'
      });
      continue;
    }

    const resolved = resolveProperty(configuredValue, propertiesById, propertiesByCode);
    if (!resolved) {
      result.skippedUnknownProperty.push({
        sourceKey,
        bitrixFieldMapValue: configuredValue,
        value: previewValue(value),
        reason: 'fieldMap value is not a property id, propertyN field, or known property code'
      });
      continue;
    }

    fields[resolved.bitrixField] = buildBitrixPropertyPayload(value, resolved.property);
    result.sent.push({
      sourceKey,
      bitrixFieldMapValue: configuredValue,
      bitrixField: resolved.bitrixField,
      propertyId: resolved.property?.id ?? resolved.propertyId,
      propertyCode: resolved.property?.code,
      propertyName: resolved.property?.name,
      propertyType: resolved.property?.propertyType,
      multiple: resolved.property?.multiple,
      value: previewValue(value)
    });
  }

  return result;
}

function resolveProperty(
  configuredValue: string,
  propertiesById: Map<string, BitrixProductProperty>,
  propertiesByCode: Map<string, BitrixProductProperty>
):
  | {
      bitrixField: string;
      propertyId: string;
      property?: BitrixProductProperty;
    }
  | undefined {
  const propertyFieldMatch = configuredValue.match(/^property(\d+)$/i);
  const numericId = propertyFieldMatch?.[1] ?? (configuredValue.match(/^\d+$/) ? configuredValue : undefined);

  if (numericId) {
    return {
      bitrixField: `property${numericId}`,
      propertyId: numericId,
      property: propertiesById.get(numericId)
    };
  }

  const property = propertiesByCode.get(normalizePropertyCode(configuredValue));
  if (!property) {
    return undefined;
  }

  return {
    bitrixField: `property${property.id}`,
    propertyId: String(property.id),
    property
  };
}

function buildBitrixPropertyPayload(value: unknown, property?: BitrixProductProperty): unknown {
  if (Array.isArray(value)) {
    const values = value.filter((item) => item !== undefined && item !== null && item !== '');
    if (property?.multiple === 'Y') {
      return values.map((item) => ({ value: item }));
    }

    return { value: values.join('\n') };
  }

  return { value };
}

function normalizePropertyValue(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return undefined;

  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => normalizeScalarValue(item))
      .filter((item) => item !== undefined);
    return normalized.length > 0 ? normalized : undefined;
  }

  return normalizeScalarValue(value);
}

function normalizeScalarValue(value: unknown): string | number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const normalized = value.trim();
    return normalized || undefined;
  }

  if (typeof value === 'boolean') return value ? 'Y' : 'N';
  return JSON.stringify(value);
}

function previewValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.length > 5 ? [...value.slice(0, 5), `... ${value.length - 5} more`] : value;
  }

  if (typeof value === 'string' && value.length > 240) {
    return `${value.slice(0, 240)}...`;
  }

  return value;
}

function normalizePropertyCode(value: string): string {
  return value.trim().toUpperCase();
}
