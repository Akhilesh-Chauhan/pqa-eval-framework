import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Per-run results on disk (test-results/, emptied by Playwright at the start of every run). A worker restarted
 * after a failing test loses its memory, so batches, per-file tests and the summary meet here instead. */
const dir = (): string => join('test-results', `ingestion-${process.env.PQA_RUN_ID ?? 'local'}`);

export function put(key: string, value: unknown): void {
  mkdirSync(dir(), { recursive: true });
  writeFileSync(join(dir(), `${key}.json`), JSON.stringify(value));
}

export function get<T>(key: string): T | undefined {
  try {
    return JSON.parse(readFileSync(join(dir(), `${key}.json`), 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export function list<T>(prefix: string): T[] {
  try {
    return readdirSync(dir()).filter((f) => f.startsWith(prefix)).sort().map((f) => JSON.parse(readFileSync(join(dir(), f), 'utf8')) as T);
  } catch {
    return [];
  }
}
