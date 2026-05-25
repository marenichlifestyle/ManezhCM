import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../config';
import { logger } from '../logger';
import { CmExpertClient } from './client';
import { extractPhotoUrls } from './normalize';

export async function saveCmSample(): Promise<void> {
  const config = loadConfig({ cm: true });
  const client = new CmExpertClient(config.cm);
  const sample = await client.getCarsPage(1, 50);

  await fs.mkdir(path.resolve('data'), { recursive: true });
  await fs.writeFile(path.resolve('data/cm-sample.json'), JSON.stringify(sample.raw, null, 2));

  const fields = collectFieldPaths(sample.raw);
  const photoUrls = extractPhotoUrls(sample.raw);

  console.log('CM.Expert sample saved to data/cm-sample.json');
  console.log('');
  console.log('Returned field paths:');
  for (const field of fields) {
    console.log(field);
  }

  console.log('');
  if (photoUrls.length > 0) {
    console.log(`Detected photo URLs: ${photoUrls.length}`);
    for (const url of photoUrls.slice(0, 20)) {
      console.log(url);
    }
  } else {
    console.log('No photo URLs detected in the first CM.Expert page.');
    logger.warn('No photo URLs detected in CM.Expert sample response');
  }
}

export function collectFieldPaths(value: unknown): string[] {
  const paths = new Set<string>();

  function visit(node: unknown, prefix: string): void {
    if (node === null || node === undefined) {
      if (prefix) paths.add(prefix);
      return;
    }

    if (Array.isArray(node)) {
      const arrayPrefix = prefix ? `${prefix}[]` : '[]';
      paths.add(arrayPrefix);
      for (const item of node) {
        visit(item, arrayPrefix);
      }
      return;
    }

    if (typeof node !== 'object') {
      if (prefix) paths.add(prefix);
      return;
    }

    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      paths.add(nextPrefix);
      visit(child, nextPrefix);
    }
  }

  visit(value, '');
  return [...paths].sort((a, b) => a.localeCompare(b));
}
