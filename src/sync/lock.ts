import fs from 'node:fs/promises';
import path from 'node:path';

export interface SyncLock {
  path: string;
  release: () => Promise<void>;
}

const LOCK_PATH = path.resolve('data/sync.lock');

export async function acquireSyncLock(): Promise<SyncLock> {
  await fs.mkdir(path.dirname(LOCK_PATH), { recursive: true });

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(LOCK_PATH, 'wx');
    await handle.writeFile(
      JSON.stringify({
        pid: process.pid,
        createdAt: new Date().toISOString()
      })
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Sync is already running: ${LOCK_PATH} exists`);
    }
    throw error;
  } finally {
    await handle?.close();
  }

  return {
    path: LOCK_PATH,
    release: async () => {
      try {
        await fs.unlink(LOCK_PATH);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }
  };
}
