import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { GOLDEN_KEYS, loadGoldenSet, mapCitedSources } from './assistant-golden.js';

function dataset(files: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'pqa-golden-'));
  const row = { id: 'Q1', user_input: 'q', reference: 'a', reference_contexts: [], must_include_facts: [], expected_sources: [], expected_behavior: 'answer', stratum: 's', category: 'c', difficulty: 'easy', house: 'h', question_origin: 'o', ragas_eligible: true };
  const all: Record<string, unknown> = {
    'golden.json': { name: 'moc-45', rows: [row, { ...row, id: 'Q2' }] },
    'manifest.json': { name: 'moc-45', built_from: { unified_sha256: 'u' }, golden_sha256: 'g', kb_fingerprint: 'k', judge_prompts_sha256: 'j', expected_n: 2, rows_kept: ['Q1', 'Q2'], rows_dropped: [] },
    'kb-names.json': { 'LS_Q_1493.pdf': 'ls_unstarred_1493.md' },
    ...files,
  };
  for (const [name, body] of Object.entries(all)) if (body !== undefined) writeFileSync(join(dir, name), JSON.stringify(body));
  return dir;
}

test('loadGoldenSet reads rows, manifest and kb-names', () => {
  const set = loadGoldenSet(dataset());
  expect(set.rows).toHaveLength(2);
  expect(set.manifest.expected_n).toBe(2);
  expect(Object.keys(set.kbNames)).toHaveLength(1);
  expect(GOLDEN_KEYS).toHaveLength(13);
});

test('a missing manifest.json throws naming the file and the dir', () => {
  const dir = dataset({ 'manifest.json': undefined });
  expect(() => loadGoldenSet(dir)).toThrow(`manifest.json is missing in ${dir}`);
});

test('mapCitedSources: exact key, extension-stripped id, and unmapped kept verbatim', () => {
  const r = mapCitedSources(['LS_Q_1493.pdf', 'ls_unstarred_2765.pdf', 'unknown.pdf'], { 'LS_Q_1493.pdf': 'ls_unstarred_1493.md', 'rs_2446.pdf': 'rs_unstarred_2446.md', 'x.pdf': 'ls_unstarred_2765.md' });
  expect(r.cited).toEqual(['ls_unstarred_1493.md', 'ls_unstarred_2765.md', 'unknown.pdf']);
  expect(r.unmapped).toEqual(['unknown.pdf']);
});
