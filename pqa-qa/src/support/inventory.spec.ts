import { test, expect } from '@playwright/test';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadInventory, routesFor } from './inventory.js';

function fixture(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'pqa-inv-'));
  const file = join(dir, 'routes.yaml');
  writeFileSync(file, yaml, 'utf8');
  return file;
}

const valid = `
- path: /{tenant}/api/dashboard/counts
  method: GET
  screen: dashboard
  upstream: pqa-service /dashboard/counts
  gate: requirePortalSession
  data_class: tenant-scoped
  attacks: [missing-identity, wrong-tenant, session-replay]
  s1_scope: true
- path: /{tenant}/api/embed
  method: POST
  screen: none
  upstream: rag-service /embed
  gate: requireIngestionPermission
  data_class: tenant-scoped
  attacks: []
  s1_scope: false
`;

test('loads and types a valid inventory', () => {
  const entries = loadInventory(fixture(valid));
  expect(entries).toHaveLength(2);
  expect(entries[0]?.dataClass).toBe('tenant-scoped');
  expect(entries[0]?.s1Scope).toBe(true);
  expect(entries[1]?.attacks).toEqual([]);
});

test('rejects an unknown data class, naming the route', () => {
  const bad = valid.replace('data_class: tenant-scoped', 'data_class: sort-of-private');
  expect(() => loadInventory(fixture(bad))).toThrow(/dashboard\/counts/);
});

test('rejects an unknown attack family', () => {
  const bad = valid.replace('session-replay', 'vibes-based-attack');
  expect(() => loadInventory(fixture(bad))).toThrow(/dashboard\/counts/);
});

test('rejects an in-scope route that declares no attacks', () => {
  const bad = valid.replace(
    'attacks: [missing-identity, wrong-tenant, session-replay]',
    'attacks: []',
  );
  expect(() => loadInventory(fixture(bad))).toThrow(/at least one attack/i);
});

test('rejects a path missing the {tenant} placeholder', () => {
  const bad = valid.replace('/{tenant}/api/dashboard/counts', '/commerce/api/dashboard/counts');
  expect(() => loadInventory(fixture(bad))).toThrow(/\{tenant\}/);
});

test('rejects an unknown key rather than silently defaulting it', () => {
  const bad = valid.replace('  data_class: tenant-scoped', '  dataclass: tenant-scoped');
  expect(() => loadInventory(fixture(bad))).toThrow(/dashboard\/counts/);
});

test('routesFor returns only in-scope routes declaring that family', () => {
  const entries = loadInventory(fixture(valid));
  expect(routesFor(entries, 'wrong-tenant').map((r) => r.path))
    .toEqual(['/{tenant}/api/dashboard/counts']);
  expect(routesFor(entries, 'wrong-department')).toEqual([]);
});

test('the committed demo-path inventory is valid', () => {
  const entries = loadInventory();
  expect(entries.length).toBeGreaterThan(10);
  expect(entries.some((e) => e.s1Scope)).toBe(true);
  expect(routesFor(entries, 'missing-identity').length).toBeGreaterThan(5);
});
