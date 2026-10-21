import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { categoryRows, loadGolden } from './golden-manifest.js';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const row = (over: Record<string, unknown> = {}) => ({
  id: 'GI-CAT-001', file: 'files/a.pdf', upload_name: 'a.pdf', sha256: sha(Buffer.from('%PDF-a')), bytes: 6,
  group: 'category', user_category: 'Circular', expected_type: 'orders', truth_status: 'verified',
  expected_metadata: { file_number: 'F.1', ministry_or_department: 'MHA' }, not_captured: [], format_case: null, ...over,
});

function dataset(rows: unknown[], head: unknown = { version: 'abc123def456', rows: rows.length }): string {
  const dir = mkdtempSync(join(tmpdir(), 'golden-'));
  mkdirSync(join(dir, 'files'));
  writeFileSync(join(dir, 'files', 'a.pdf'), '%PDF-a');
  writeFileSync(join(dir, 'manifest.jsonl'), [head, ...rows].map((r) => JSON.stringify(r)).join('\n') + '\n');
  return dir;
}

test('categoryRows picks one category in any case, and refuses a name the dataset does not have', () => {
  const rows = [row(), row({ id: 'GI-CAT-002', user_category: 'Parliamentary Q&A' }), row({ id: 'GI-FMT-01', group: 'format' })] as Parameters<typeof categoryRows>[0]['rows'];
  const g = { version: 'v', rows, dir: '' };
  expect(categoryRows(g).map((r) => r.id)).toEqual(['GI-CAT-001', 'GI-CAT-002']);
  expect(categoryRows(g, ['parliamentary q&a']).map((r) => r.id)).toEqual(['GI-CAT-002']);
  expect(() => categoryRows(g, ['Circular', 'Circulars'])).toThrow(/no category Circulars .*it has Circular, Parliamentary Q&A/);
});

test('loads a valid manifest', () => {
  const g = loadGolden(dataset([row()]));
  expect(g.version).toBe('abc123def456');
  expect(g.rows[0]?.expected_type).toBe('orders');
});

test('lists every problem at once', () => {
  const dir = dataset([
    row({ sha256: '0'.repeat(64) }),
    row({ id: 'GI-CAT-002', expected_metadata: { act_number: 'x' } }),
    row({ id: 'GI-CAT-003', expected_type: 'circulars' }),
  ]);
  expect(() => loadGolden(dir)).toThrow(/line 4[\s\S]*GI-CAT-001: files\/a\.pdf does not match its sha256[\s\S]*GI-CAT-002: field act_number does not exist for orders/);
});

test('category upload names must be unique and format rows need format_case', () => {
  const dir = dataset([row(), row({ id: 'GI-CAT-002' }), row({ id: 'GI-FMT-01', group: 'format', expected_metadata: {} })]);
  expect(() => loadGolden(dir)).toThrow(/GI-FMT-01: format_case[\s\S]*upload name a\.pdf is used twice/);
});

test('the real dataset loads when it is on this machine', () => {
  const dir = '/home/user/NeGD/PQA Builder/qa/golden/ingestion';
  test.skip(!existsSync(join(dir, 'manifest.jsonl')), 'golden dataset not built here');
  const g = loadGolden(dir);
  expect(g.rows.filter((r) => r.group === 'category')).toHaveLength(89);
  expect(g.rows.filter((r) => r.group === 'format')).toHaveLength(26);
});
