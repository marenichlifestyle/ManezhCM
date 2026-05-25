import cron from 'node-cron';
import { printCatalogs } from './bitrix/catalogs';
import { createCarPropertiesCommand } from './bitrix/carProperties';
import { printProductFieldsAndProperties } from './bitrix/productProperties';
import { printSections } from './bitrix/sections';
import { loadConfig } from './config';
import { saveCmSample } from './cmExpert/sample';
import { logger } from './logger';
import { syncCars } from './sync/syncCars';

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'start';

  switch (command) {
    case 'cm:sample':
      await saveCmSample();
      return;

    case 'bitrix:catalogs':
      await printCatalogs();
      return;

    case 'bitrix:fields':
      await printProductFieldsAndProperties();
      return;

    case 'bitrix:sections':
      await printSections();
      return;

    case 'bitrix:create-car-properties':
      await createCarPropertiesCommand();
      return;

    case 'sync':
      console.log(JSON.stringify(await syncCars({ dryRun: false, ...parseSyncArgs() }), null, 2));
      return;

    case 'sync:dry':
      console.log(JSON.stringify(await syncCars({ dryRun: true, ...parseSyncArgs() }), null, 2));
      return;

    case 'start':
      await startService();
      return;

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function parseSyncArgs(): { limit?: number; externalCode?: string; vin?: string } {
  return {
    limit: parseLimitArg(),
    externalCode: parseStringArg('--external-code='),
    vin: parseStringArg('--vin=')
  };
}

function parseLimitArg(): number | undefined {
  const raw = parseStringArg('--limit=');
  if (!raw) return undefined;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error('--limit must be a positive integer');
  }

  return value;
}

function parseStringArg(prefix: string): string | undefined {
  const rawArg = process.argv.find((arg) => arg.startsWith(prefix));
  const raw = rawArg?.slice(prefix.length).trim();
  return raw || undefined;
}

async function startService(): Promise<void> {
  const config = loadConfig({ cm: true, bitrix: true, bitrixIblock: true });
  logger.info(
    { cron: config.sync.cron, dryRun: config.sync.dryRun, runSyncOnStart: config.sync.runOnStart },
    'Starting sync service'
  );

  if (config.sync.runOnStart) {
    try {
      logger.info('RUN_SYNC_ON_START enabled; running one sync before cron scheduler');
      await syncCars();
    } catch (error) {
      logger.error({ error: serializeError(error) }, 'Startup sync failed; cron scheduler will still be started');
    }
  }

  cron.schedule(config.sync.cron, () => {
    syncCars().catch((error) => {
      logger.error({ error: serializeError(error) }, 'Scheduled sync failed');
    });
  });

  logger.info({ cron: config.sync.cron }, 'Cron scheduler started');
}

function serializeError(error: unknown): Record<string, unknown> {
  const candidate = error as { name?: string; message?: string; stack?: string };
  return {
    name: candidate.name,
    message: candidate.message ?? String(error),
    stack: candidate.stack
  };
}

main().catch((error) => {
  logger.error({ error: serializeError(error) }, 'Command failed');
  process.exitCode = 1;
});
