import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';

export const DATA_CLASSES = [
  'public',
  'tenant-scoped',
  'department-scoped',
  'private-source',
  'credential',
] as const;
export type DataClass = (typeof DATA_CLASSES)[number];

export const ATTACK_FAMILIES = [
  'missing-identity',
  'wrong-tenant',
  'wrong-department',
  's3-prefix-escape',
  'wrong-index',
  'session-replay',
  'service-surface',
  'identity-rls',
  'egress-residency',
] as const;
export type AttackFamily = (typeof ATTACK_FAMILIES)[number];

export const SCREENS = [
  'login',
  'dashboard',
  'intake',
  'drafting',
  'review',
  'export',
  'none',
] as const;
export type Screen = (typeof SCREENS)[number];

const RowSchema = z
  .object({
    path: z.string().min(1),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']),
    screen: z.enum(SCREENS),
    upstream: z.string().min(1),
    gate: z.string().min(1),
    data_class: z.enum(DATA_CLASSES),
    attacks: z.array(z.enum(ATTACK_FAMILIES)),
    s1_scope: z.boolean(),
  })
  .strict();

export interface RouteEntry {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  screen: Screen;
  upstream: string;
  gate: string;
  dataClass: DataClass;
  attacks: AttackFamily[];
  s1Scope: boolean;
}

function defaultPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'inventory', 'demo-path.routes.yaml');
}

export function loadInventory(path: string = defaultPath()): RouteEntry[] {
  const rows = parse(readFileSync(path, 'utf8')) as unknown[];
  if (!Array.isArray(rows)) throw new Error(`${path}: expected a YAML list`);

  return rows.map((row, i) => {
    const parsed = RowSchema.safeParse(row);
    if (!parsed.success) {
      const label = (row as { path?: string })?.path ?? `row ${i}`;
      const detail = parsed.error.issues
        .map((x) => `${x.path.join('.') || '(root)'} ${x.message}`)
        .join('; ');
      throw new Error(`${label}: ${detail}`);
    }
    const r = parsed.data;
    if (!r.path.includes('{tenant}')) {
      throw new Error(
        `${r.path}: every route must be tenant-relative and contain {tenant}`,
      );
    }
    if (r.s1_scope && r.attacks.length === 0) {
      throw new Error(
        `${r.path}: s1_scope is true but declares no attacks — an in-scope route must declare at least one attack family`,
      );
    }
    return {
      path: r.path,
      method: r.method,
      screen: r.screen,
      upstream: r.upstream,
      gate: r.gate,
      dataClass: r.data_class,
      attacks: [...r.attacks],
      s1Scope: r.s1_scope,
    };
  });
}

export function routesFor(entries: RouteEntry[], family: AttackFamily): RouteEntry[] {
  return entries.filter((e) => e.s1Scope && e.attacks.includes(family));
}
