import crypto from 'node:crypto';
import { loadConfig } from '../config';
import { logger } from '../logger';
import { BitrixClient } from './client';

export interface BitrixSection {
  id: number | string;
  iblockId?: number | string;
  iblockSectionId?: number | string | null;
  name?: string;
  active?: string;
  xmlId?: string;
  [key: string]: unknown;
}

export class BitrixSectionService {
  private sections?: BitrixSection[];

  constructor(
    private readonly client: BitrixClient,
    private readonly iblockId: number,
    private readonly rootSectionName: string
  ) {}

  async listSections(): Promise<BitrixSection[]> {
    if (!this.sections) {
      this.sections = await listSections(this.client, this.iblockId);
    }

    return this.sections;
  }

  async ensureCarSection(brand: string, model: string, dryRun: boolean): Promise<number | undefined> {
    const root = await this.ensureSection(this.rootSectionName, undefined, dryRun);
    const brandSection = await this.ensureSection(brand, root, dryRun);
    return this.ensureSection(model, brandSection, dryRun);
  }

  private async ensureSection(
    name: string,
    parentId: number | undefined,
    dryRun: boolean
  ): Promise<number | undefined> {
    const existing = (await this.listSections()).find(
      (section) => normalizeName(section.name) === normalizeName(name) && normalizeParentId(section.iblockSectionId) === normalizeParentId(parentId)
    );

    if (existing) {
      return Number(existing.id);
    }

    if (dryRun) {
      logger.info({ name, parentId }, 'Dry run: would create Bitrix24 catalog section');
      return undefined;
    }

    const section = await addSection(this.client, {
      iblockId: this.iblockId,
      iblockSectionId: parentId,
      name,
      active: 'Y',
      xmlId: buildSectionXmlId(this.iblockId, parentId, name)
    });

    this.sections = [...(this.sections ?? []), section];
    logger.info({ id: section.id, name, parentId }, 'Created Bitrix24 catalog section');
    return Number(section.id);
  }
}

export async function listSections(client: BitrixClient, iblockId: number): Promise<BitrixSection[]> {
  return client.listAll<BitrixSection>(
    'catalog.section.list',
    {
      select: ['id', 'iblockId', 'iblockSectionId', 'name', 'active', 'xmlId'],
      filter: {
        iblockId
      },
      order: {
        leftMargin: 'ASC',
        id: 'ASC'
      }
    },
    'sections'
  );
}

export async function addSection(
  client: BitrixClient,
  fields: Record<string, unknown>
): Promise<BitrixSection> {
  const cleanedFields = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
  const result = await client.call<Record<string, unknown>>('catalog.section.add', { fields: cleanedFields });
  const section = result.section;
  return section && typeof section === 'object' ? (section as BitrixSection) : (result as BitrixSection);
}

export async function printSections(): Promise<void> {
  const config = loadConfig({ bitrix: true, bitrixIblock: true });
  const client = new BitrixClient(config.bitrix.webhookBaseUrl, config.bitrix.delayMs, config.bitrix.maxRetries);
  const sections = await listSections(client, config.bitrix.iblockId as number);

  console.table(
    sections.map((section) => ({
      id: section.id,
      parentId: section.iblockSectionId ?? '',
      name: section.name,
      active: section.active,
      xmlId: section.xmlId ?? ''
    }))
  );
}

function normalizeName(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeParentId(value: unknown): string {
  if (value === undefined || value === null || value === '' || value === 0 || value === '0') {
    return '';
  }

  return String(value);
}

function buildSectionXmlId(iblockId: number, parentId: number | undefined, name: string): string {
  const hash = crypto.createHash('sha1').update(`${iblockId}:${parentId ?? 'root'}:${name}`).digest('hex').slice(0, 16);
  return `cmexpert-section-${hash}`;
}
