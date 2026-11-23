import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { setEnvLine } from './env-file.js';

test('setEnvLine adds, replaces and removes one key, keeping every other line', () => {
  const p = join(mkdtempSync(join(tmpdir(), 'envfile-')), '.env');
  setEnvLine(p, 'A', '1');
  expect(readFileSync(p, 'utf8')).toBe('A=1\n');
  writeFileSync(p, '# note\nB=2\n\nA=1\nAB=3\n');
  setEnvLine(p, 'A', 'qi12ab');
  expect(readFileSync(p, 'utf8')).toBe('# note\nB=2\n\nAB=3\nA=qi12ab\n');
  setEnvLine(p, 'A', undefined);
  expect(readFileSync(p, 'utf8')).toBe('# note\nB=2\n\nAB=3\n');
});
