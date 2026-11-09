import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'fixtures');

export function fixture(rel: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, rel)));
}

export function fixtureJson(rel: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, rel), 'utf8'));
}

export const CASES = Object.keys(fixtureJson('pairs/index.json') as Record<string, string>);
