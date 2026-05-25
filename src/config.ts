import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  cm: {
    clientId: string;
    clientSecret: string;
  };
  bitrix: {
    webhookBaseUrl: string;
    catalogId?: number;
    iblockId?: number;
    rootSectionName: string;
    delayMs: number;
    maxRetries: number;
  };
  sync: {
    cron: string;
    dryRun: boolean;
    runOnStart: boolean;
    limit?: number;
  };
  logLevel: string;
}

export interface ConfigRequirements {
  cm?: boolean;
  bitrix?: boolean;
  bitrixCatalog?: boolean;
  bitrixIblock?: boolean;
}

export function loadConfig(requirements: ConfigRequirements = {}): AppConfig {
  const catalogId = optionalNumber('BITRIX_CATALOG_ID');
  const iblockId = optionalNumber('BITRIX_IBLOCK_ID');

  const config: AppConfig = {
    cm: {
      clientId: process.env.CM_CLIENT_ID?.trim() ?? '',
      clientSecret: process.env.CM_CLIENT_SECRET?.trim() ?? ''
    },
    bitrix: {
      webhookBaseUrl: trimTrailingSlash(process.env.BITRIX_WEBHOOK_BASE_URL?.trim() ?? ''),
      catalogId,
      iblockId,
      rootSectionName: process.env.BITRIX_ROOT_SECTION_NAME?.trim() || 'Автомобили',
      delayMs: optionalNumber('BITRIX_DELAY_MS') ?? 300,
      maxRetries: optionalNumber('BITRIX_MAX_RETRIES') ?? 5
    },
    sync: {
      cron: process.env.SYNC_CRON?.trim() || '0 */2 * * *',
      dryRun: parseBoolean(process.env.DRY_RUN, false),
      runOnStart: parseBoolean(process.env.RUN_SYNC_ON_START, true),
      limit: optionalNumber('SYNC_LIMIT')
    },
    logLevel: process.env.LOG_LEVEL?.trim() || 'info'
  };

  const missing: string[] = [];
  if (requirements.cm) {
    if (!config.cm.clientId) missing.push('CM_CLIENT_ID');
    if (!config.cm.clientSecret) missing.push('CM_CLIENT_SECRET');
  }
  if (requirements.bitrix && !config.bitrix.webhookBaseUrl) {
    missing.push('BITRIX_WEBHOOK_BASE_URL');
  }
  if (requirements.bitrixCatalog && !config.bitrix.catalogId) {
    missing.push('BITRIX_CATALOG_ID');
  }
  if (requirements.bitrixIblock && !config.bitrix.iblockId) {
    missing.push('BITRIX_IBLOCK_ID');
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  return config;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(value.trim().toLowerCase());
}

function optionalNumber(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;

  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number`);
  }

  return value;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
