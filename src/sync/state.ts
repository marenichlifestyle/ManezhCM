import fs from 'node:fs/promises';
import path from 'node:path';

export interface SyncState {
  lastSuccessfulSyncAt?: string;
  lastSuccessfulCount?: number;
  knownExternalCodes: string[];
}

const STATE_PATH = path.resolve('data/state.json');

export async function readState(): Promise<SyncState> {
  try {
    const content = await fs.readFile(STATE_PATH, 'utf8');
    const parsed = JSON.parse(content) as Partial<SyncState>;

    return {
      lastSuccessfulSyncAt: parsed.lastSuccessfulSyncAt,
      lastSuccessfulCount: parsed.lastSuccessfulCount,
      knownExternalCodes: Array.isArray(parsed.knownExternalCodes) ? parsed.knownExternalCodes : []
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { knownExternalCodes: [] };
    }

    throw error;
  }
}

export async function writeState(state: SyncState): Promise<void> {
  await fs.mkdir(path.dirname(STATE_PATH), { recursive: true });
  const tmpPath = `${STATE_PATH}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2));
  await fs.rename(tmpPath, STATE_PATH);
}
