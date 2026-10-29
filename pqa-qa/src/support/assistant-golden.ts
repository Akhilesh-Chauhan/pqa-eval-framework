import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The assistant-eval golden set (PQA Builder/qa/golden/<name>, built by its build script). */

export interface GoldenRow {
  id: string;
  user_input: string;
  reference: string;
  reference_contexts: string[];
  must_include_facts: Array<{ fact: string; weight: string }>;
  expected_sources: Array<{ document: string; necessity: string }>;
  expected_behavior: string;
  stratum: string;
  category: string;
  difficulty: string;
  house: string;
  question_origin: string;
  ragas_eligible: boolean;
}

/** Names the Python scorer and the stream parser read; keep in step with GoldenRow. */
export const GOLDEN_KEYS: readonly (keyof GoldenRow)[] = ['id', 'user_input', 'reference', 'reference_contexts', 'must_include_facts',
  'expected_sources', 'expected_behavior', 'stratum', 'category', 'difficulty', 'house', 'question_origin', 'ragas_eligible'];

export interface GoldenManifest {
  name: string;
  built_from: { unified_sha256: string };
  golden_sha256: string;
  kb_fingerprint: string;
  judge_prompts_sha256: string;
  expected_n: number;
  rows_kept: string[];
  rows_dropped: Array<{ id: string; reason: string }>;
}

export interface GoldenSet {
  dir: string;
  rows: GoldenRow[];
  manifest: GoldenManifest;
  kbNames: Record<string, string>;
}

function readJson<T>(dir: string, file: string): T {
  const path = join(dir, file);
  if (!existsSync(path)) throw new Error(`${file} is missing in ${dir}`);
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Reads golden.json, manifest.json and kb-names.json from `dir`; a missing file throws. */
export function loadGoldenSet(dir: string): GoldenSet {
  const golden = readJson<{ name: string; rows: GoldenRow[] }>(dir, 'golden.json');
  const manifest = readJson<GoldenManifest>(dir, 'manifest.json');
  const kbNames = readJson<Record<string, string>>(dir, 'kb-names.json');
  return { dir, rows: golden.rows, manifest, kbNames };
}

/** Maps cited uploaded file names to KB ids: exact key first, then the name without its extension as an id. */
export function mapCitedSources(filenames: string[], kbNames: Record<string, string>): { cited: string[]; unmapped: string[] } {
  const cited: string[] = [];
  const unmapped: string[] = [];
  const kbIds = Object.values(kbNames);
  for (const name of filenames) {
    const stem = name.replace(/\.[^.]+$/, '') + '.md';
    const id = Object.hasOwn(kbNames, name) ? kbNames[name] : kbIds.includes(stem) ? stem : undefined;
    if (id) cited.push(id);
    else {
      cited.push(name);
      unmapped.push(name);
    }
  }
  return { cited, unmapped };
}
