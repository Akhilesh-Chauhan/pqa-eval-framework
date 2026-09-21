# PQA QA — Isolation Acceptance Baseline (S1-QA-01) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a daily-runnable, non-destructive isolation acceptance suite against the deployed PQA environment, in which every unverified isolation property is a named failing or explicitly-not-measured test rather than an opinion.

**Architecture:** One standalone TypeScript package, `pqa-qa/`, in this repository. Playwright is both the runner and the HTTP client. A support layer discovers what is testable (tenants, personas, credentials) before any assertion runs; nine attack-family specs consume that layer; a custom three-state reporter separates regressions from tracked gaps from unmeasured properties and emits `inventory/gaps.md`. The system under test is reached over HTTPS only — nothing is created, modified or deleted.

**Tech Stack:** Node 20 · TypeScript 5 · `@playwright/test` · `zod` (schema validation) · `yaml` · optional `@aws-sdk/client-s3`, `@opensearch-project/opensearch`, `pg` for the infrastructure families. Package manager is **npm** — yarn is not installed on the team's hosts.

**Spec:** `docs/superpowers/specs/2026-09-21-pqa-qa-design.md`

## Global Constraints

- **`pqa-builder` is read-only.** Not one character changes there. No file is created, edited or deleted in that tree by any task in this plan.
- **Non-destructive against the target.** No `POST`/`PUT`/`PATCH`/`DELETE` that creates, modifies or deletes a record; no tenant provisioning; no schema changes; no `migrate-all`. Probes that exercise write endpoints do so only with credentials expected to be *rejected*, and assert the rejection.
- **Target base URL comes from `PQA_BASE_URL`.** No default, ever. A hardcoded host is a plan violation.
- **No credential or identity is committed.** `PLATFORM_SEED_EMAIL` is a real account on a `.gov.in` domain. Real values live only in a gitignored `pqa-qa/.env`.
- **Every outbound request carries an identifying User-Agent**: `pqa-qa/<version> (run:<runId>)`. Adversarial traffic that cannot be told from a real attack is an operational hazard.
- **A test that did not run is never reported as passing.** Unavailable dependency → skip with a reason recorded, never a silent pass.
- **File size:** target 100 lines, hard ceiling 200, matching the platform's own standard. Split by responsibility.
- **Node 20, npm.** `yarn` is absent from the team's hosts.
- **Deadline:** S1-QA-01 exits Fri 25 Sep 2026. Tasks 1–6 need no reachable URL and are the Monday/Tuesday work.

## How TDD applies to a test suite

This codebase's *product* is tests, so "write a failing test first" means two different things depending on the task. Both are TDD; do not conflate them.

**Support modules (Tasks 1–6)** — ordinary TDD. `env.ts`, `inventory.ts`, `tenant.ts`, `probe.ts`, `personas.ts` and `gap-reporter.ts` are library code with unit tests in the `unit` Playwright project. They run with no browser and no network. Write the failing unit test, watch it fail, implement, watch it pass.

**Attack families (Tasks 7–11)** — the deliverable *is* the probe. The TDD analogue is: write the probe against a **fixture that simulates the vulnerable response**, prove the assertion fails on it, then point the probe at the real environment. This guarantees the assertion can actually fail. A probe that has never been seen to fail is not evidence of anything — it is the single most common defect in acceptance suites, and it is how a suite reports green while testing nothing.

Each family task therefore has a `*.assert.spec.ts` unit test that feeds the assertion helper a known-bad response and requires it to throw.

---

## File Structure

```
pqa-qa/
├── package.json                    npm scripts, deps
├── tsconfig.json
├── playwright.config.ts            projects: unit | isolation
├── .env.example                    variable names only, no values
├── README.md                       prerequisites, one command, reading gaps.md
├── .gitlab-ci.yml                  daily scheduled run
├── inventory/
│   ├── demo-path.routes.yaml       S1-QA-01 deliverable (a)
│   └── gaps.md                     generated each run — do not hand-edit
└── src/
    ├── global-setup.ts             probe + persona auth, writes capabilities.json
    ├── support/
    │   ├── env.ts                  environment → typed config
    │   ├── inventory.ts            YAML → typed RouteEntry[]
    │   ├── tenant.ts               discover active tenant slugs
    │   ├── probe.ts                what is testable right now
    │   ├── personas.ts             authenticate, write storageState
    │   ├── annotations.ts          trackedGap() / notMeasured()
    │   ├── gap-reporter.ts         three-state reporter → gaps.md
    │   ├── assertions.ts           refusal assertions, reusable + unit-testable
    │   ├── fixtures.ts             Playwright test fixtures
    │   └── clients/
    │       ├── s3.ts               family 4, optional credential
    │       ├── opensearch.ts       family 5, optional credential
    │       └── postgres.ts         family 8, optional credential
    └── isolation/
        ├── f1-missing-identity.spec.ts
        ├── f2-wrong-tenant.spec.ts
        ├── f3-wrong-department.spec.ts
        ├── f4-s3-prefix-escape.spec.ts
        ├── f5-wrong-index.spec.ts
        ├── f6-session-replay.spec.ts
        ├── f7-service-surface.spec.ts
        ├── f8-identity-rls.spec.ts
        └── f9-egress-residency.spec.ts
```

Responsibilities are split so that a family spec never parses YAML, never reads `process.env`, and never decides whether something is testable — it consumes `fixtures.ts` and asserts. That separation is what keeps each spec under 100 lines and reviewable on its own.

---

## Task 1: Package scaffold and typed environment

**Files:**
- Create: `pqa-qa/package.json`
- Create: `pqa-qa/tsconfig.json`
- Create: `pqa-qa/playwright.config.ts`
- Create: `pqa-qa/.env.example`
- Create: `pqa-qa/src/support/env.ts`
- Test: `pqa-qa/src/support/env.spec.ts`
- Modify: `.gitignore` (repository root)

**Interfaces:**
- Consumes: nothing.
- Produces: `loadEnv(source?: NodeJS.ProcessEnv): QaEnv`, `MissingEnvError`, and the types `QaEnv`, `PersonaName`, `S3Creds`, `OpenSearchCreds`.

- [ ] **Step 1: Create the package manifest**

`pqa-qa/package.json`:

```json
{
  "name": "pqa-qa",
  "version": "0.1.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "scripts": {
    "qa": "playwright test",
    "qa:unit": "playwright test --project=unit",
    "qa:isolation": "playwright test --project=isolation",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "yaml": "^2.6.0",
    "zod": "^3.23.0"
  },
  "optionalDependencies": {
    "@aws-sdk/client-s3": "^3.700.0",
    "@opensearch-project/opensearch": "^2.13.0",
    "pg": "^8.13.0"
  }
}
```

The three infrastructure clients are `optionalDependencies` deliberately: families 4, 5 and 8 are expected to be unmeasured on most hosts, and a missing S3 SDK must degrade to a skip, not break `npm install`.

- [ ] **Step 2: Create the TypeScript config**

`pqa-qa/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "playwright.config.ts"]
}
```

- [ ] **Step 3: Create the Playwright config**

`pqa-qa/playwright.config.ts`. Note there is **no `webServer`** — the system under test is deployed, not started by us. `forbidOnly` and zero retries: a flaky isolation result must be investigated, not retried away.

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './src',
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 4,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'playwright-report/junit.xml' }],
    ['./src/support/gap-reporter.ts'],
  ],
  projects: [
    {
      name: 'unit',
      testMatch: /.*\.spec\.ts$/,
      testDir: './src/support',
    },
    {
      name: 'isolation',
      testMatch: /.*\.spec\.ts$/,
      testDir: './src/isolation',
      dependencies: ['unit'],
    },
  ],
});
```

`isolation` depends on `unit` so that a broken support module fails fast, before any traffic reaches the deployed environment.

- [ ] **Step 4: Write the failing test for `loadEnv`**

`pqa-qa/src/support/env.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { loadEnv, MissingEnvError } from './env.js';

const minimal = {
  PQA_BASE_URL: 'https://pqa.example.in',
  PQA_TENANT_CANDIDATES: 'commerce, railways ,mohfw',
  PLATFORM_SEED_EMAIL: 'admin@example.gov.in',
};

test('throws MissingEnvError naming the variable when base URL is absent', () => {
  const { PQA_BASE_URL, ...rest } = minimal;
  expect(() => loadEnv(rest as NodeJS.ProcessEnv)).toThrow(MissingEnvError);
  expect(() => loadEnv(rest as NodeJS.ProcessEnv)).toThrow(/PQA_BASE_URL/);
});

test('rejects a base URL that is not a URL', () => {
  expect(() => loadEnv({ ...minimal, PQA_BASE_URL: 'not-a-url' } as NodeJS.ProcessEnv))
    .toThrow(/PQA_BASE_URL/);
});

test('splits and trims tenant candidates', () => {
  const env = loadEnv(minimal as NodeJS.ProcessEnv);
  expect(env.tenantCandidates).toEqual(['commerce', 'railways', 'mohfw']);
});

test('strips a trailing slash from the base URL', () => {
  const env = loadEnv({ ...minimal, PQA_BASE_URL: 'https://pqa.example.in/' } as NodeJS.ProcessEnv);
  expect(env.baseUrl).toBe('https://pqa.example.in');
});

test('generates a run id when none is supplied', () => {
  const env = loadEnv(minimal as NodeJS.ProcessEnv);
  expect(env.runId).toMatch(/^[0-9a-f]{12}$/);
});

test('builds an identifying user agent containing the run id', () => {
  const env = loadEnv({ ...minimal, PQA_RUN_ID: 'abc123abc123' } as NodeJS.ProcessEnv);
  expect(env.userAgent).toBe('pqa-qa/0.1.0 (run:abc123abc123)');
});

test('collects only the personas whose emails are configured', () => {
  const env = loadEnv({
    ...minimal,
    PQA_PERSONA_DIVISION_MEMBER_EMAIL: 'div@example.gov.in',
  } as NodeJS.ProcessEnv);
  expect(env.personaEmails['platform-admin']).toBe('admin@example.gov.in');
  expect(env.personaEmails['division-member']).toBe('div@example.gov.in');
  expect(env.personaEmails['parliament-member']).toBeUndefined();
});

test('omits S3 credentials entirely when only some parts are present', () => {
  const env = loadEnv({ ...minimal, PQA_S3_BUCKET: 'b' } as NodeJS.ProcessEnv);
  expect(env.s3).toBeUndefined();
});

test('returns S3 credentials when every part is present', () => {
  const env = loadEnv({
    ...minimal,
    PQA_S3_REGION: 'ap-south-1',
    PQA_S3_BUCKET: 'bucket',
    PQA_S3_ACCESS_KEY_ID: 'AK',
    PQA_S3_SECRET_ACCESS_KEY: 'SK',
    PQA_S3_TENANT_PREFIX: 'commerce/',
  } as NodeJS.ProcessEnv);
  expect(env.s3?.bucket).toBe('bucket');
  expect(env.s3?.tenantPrefix).toBe('commerce/');
});
```

- [ ] **Step 5: Run the test and watch it fail**

Run: `cd pqa-qa && npm run qa:unit -- env.spec.ts`
Expected: FAIL — `Cannot find module './env.js'`.

- [ ] **Step 6: Implement `env.ts`**

`pqa-qa/src/support/env.ts`:

```ts
import { randomBytes } from 'node:crypto';

export const VERSION = '0.1.0';

export type PersonaName =
  | 'platform-admin'
  | 'parliament-admin'
  | 'parliament-member'
  | 'division-admin'
  | 'division-member';

export interface S3Creds {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  tenantPrefix: string;
}

export interface OpenSearchCreds {
  endpoint: string;
  username: string;
  password: string;
  tenantIndex: string;
}

export interface QaEnv {
  baseUrl: string;
  tenantCandidates: string[];
  runId: string;
  userAgent: string;
  personaEmails: Partial<Record<PersonaName, string>>;
  s3?: S3Creds;
  openSearch?: OpenSearchCreds;
  postgresDsn?: string;
}

export class MissingEnvError extends Error {
  constructor(variable: string, detail: string) {
    super(`${variable}: ${detail}`);
    this.name = 'MissingEnvError';
  }
}

const PERSONA_VARS: Array<[PersonaName, string]> = [
  ['platform-admin', 'PLATFORM_SEED_EMAIL'],
  ['parliament-admin', 'PQA_PERSONA_PARLIAMENT_ADMIN_EMAIL'],
  ['parliament-member', 'PQA_PERSONA_PARLIAMENT_MEMBER_EMAIL'],
  ['division-admin', 'PQA_PERSONA_DIVISION_ADMIN_EMAIL'],
  ['division-member', 'PQA_PERSONA_DIVISION_MEMBER_EMAIL'],
];

function required(src: NodeJS.ProcessEnv, key: string): string {
  const value = src[key]?.trim();
  if (!value) throw new MissingEnvError(key, 'is required and was not set');
  return value;
}

function allOrNothing(
  src: NodeJS.ProcessEnv,
  keys: string[],
): Record<string, string> | undefined {
  const values = keys.map((k) => src[k]?.trim() ?? '');
  if (values.some((v) => !v)) return undefined;
  return Object.fromEntries(keys.map((k, i) => [k, values[i] as string]));
}

function readBaseUrl(src: NodeJS.ProcessEnv): string {
  const raw = required(src, 'PQA_BASE_URL');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new MissingEnvError('PQA_BASE_URL', `is not a valid URL: ${raw}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new MissingEnvError('PQA_BASE_URL', `must be http or https: ${raw}`);
  }
  return raw.replace(/\/+$/, '');
}

function readPersonas(src: NodeJS.ProcessEnv): Partial<Record<PersonaName, string>> {
  const out: Partial<Record<PersonaName, string>> = {};
  for (const [name, key] of PERSONA_VARS) {
    const email = src[key]?.trim();
    if (email) out[name] = email;
  }
  return out;
}

function readS3(src: NodeJS.ProcessEnv): S3Creds | undefined {
  const v = allOrNothing(src, [
    'PQA_S3_REGION',
    'PQA_S3_BUCKET',
    'PQA_S3_ACCESS_KEY_ID',
    'PQA_S3_SECRET_ACCESS_KEY',
    'PQA_S3_TENANT_PREFIX',
  ]);
  if (!v) return undefined;
  return {
    region: v['PQA_S3_REGION'] as string,
    bucket: v['PQA_S3_BUCKET'] as string,
    accessKeyId: v['PQA_S3_ACCESS_KEY_ID'] as string,
    secretAccessKey: v['PQA_S3_SECRET_ACCESS_KEY'] as string,
    tenantPrefix: v['PQA_S3_TENANT_PREFIX'] as string,
  };
}

function readOpenSearch(src: NodeJS.ProcessEnv): OpenSearchCreds | undefined {
  const v = allOrNothing(src, [
    'PQA_OPENSEARCH_ENDPOINT',
    'PQA_OPENSEARCH_USERNAME',
    'PQA_OPENSEARCH_PASSWORD',
    'PQA_OPENSEARCH_TENANT_INDEX',
  ]);
  if (!v) return undefined;
  return {
    endpoint: v['PQA_OPENSEARCH_ENDPOINT'] as string,
    username: v['PQA_OPENSEARCH_USERNAME'] as string,
    password: v['PQA_OPENSEARCH_PASSWORD'] as string,
    tenantIndex: v['PQA_OPENSEARCH_TENANT_INDEX'] as string,
  };
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): QaEnv {
  const baseUrl = readBaseUrl(source);

  const candidates = required(source, 'PQA_TENANT_CANDIDATES')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (candidates.length === 0) {
    throw new MissingEnvError('PQA_TENANT_CANDIDATES', 'contained no slugs');
  }

  const personaEmails = readPersonas(source);
  if (!personaEmails['platform-admin']) {
    throw new MissingEnvError('PLATFORM_SEED_EMAIL', 'is required and was not set');
  }

  const runId = source['PQA_RUN_ID']?.trim() || randomBytes(6).toString('hex');

  return {
    baseUrl,
    tenantCandidates: candidates,
    runId,
    userAgent: `pqa-qa/${VERSION} (run:${runId})`,
    personaEmails,
    s3: readS3(source),
    openSearch: readOpenSearch(source),
    postgresDsn: source['PQA_POSTGRES_DSN']?.trim() || undefined,
  };
}
```

- [ ] **Step 7: Run the test and watch it pass**

Run: `cd pqa-qa && npm run qa:unit -- env.spec.ts`
Expected: PASS, 9 tests.

- [ ] **Step 8: Write `.env.example` — names only, never values**

`pqa-qa/.env.example`:

```bash
# Target. No default exists; the suite refuses to run without this.
PQA_BASE_URL=

# Comma-separated tenant slugs to probe. The suite reports which resolve.
PQA_TENANT_CANDIDATES=

# Identities. Only the platform admin is required; each additional persona
# unlocks the attack families that need a lower-privileged attacker.
PLATFORM_SEED_EMAIL=
PQA_PERSONA_PARLIAMENT_ADMIN_EMAIL=
PQA_PERSONA_PARLIAMENT_MEMBER_EMAIL=
PQA_PERSONA_DIVISION_ADMIN_EMAIL=
PQA_PERSONA_DIVISION_MEMBER_EMAIL=

# Optional. Absent → families 4, 5 and the database half of 8 report
# "not measured" rather than passing. Ask Bhupendra (S1-DO-02).
PQA_S3_REGION=
PQA_S3_BUCKET=
PQA_S3_ACCESS_KEY_ID=
PQA_S3_SECRET_ACCESS_KEY=
PQA_S3_TENANT_PREFIX=
PQA_OPENSEARCH_ENDPOINT=
PQA_OPENSEARCH_USERNAME=
PQA_OPENSEARCH_PASSWORD=
PQA_OPENSEARCH_TENANT_INDEX=
PQA_POSTGRES_DSN=

# Optional. Generated per run when unset.
PQA_RUN_ID=
```

- [ ] **Step 9: Extend the repository `.gitignore`**

Append to the existing root `.gitignore`, under a new heading. Do **not** reorder or remove existing entries.

```
# pqa-qa — Playwright suite
pqa-qa/node_modules/
pqa-qa/.env
pqa-qa/playwright-report/
pqa-qa/test-results/
pqa-qa/src/.auth/
```

Note `inventory/gaps.md` is **not** ignored — it is a committed artefact, regenerated each run, and its diff is how the team sees gaps open and close. `pqa-qa/.env` is ignored because it holds a real `.gov.in` identity.

- [ ] **Step 10: Verify the secret guard**

Run: `cd "$(git rev-parse --show-toplevel)" && printf 'PQA_BASE_URL=x\n' > pqa-qa/.env && git status --short pqa-qa/.env`
Expected: **no output** — the file is ignored. If it appears, the `.gitignore` entry is wrong; fix before continuing.

Then: `git check-ignore -v pqa-qa/.env`
Expected: prints the matching `.gitignore` rule.

- [ ] **Step 11: Commit**

```bash
git add pqa-qa/package.json pqa-qa/tsconfig.json pqa-qa/playwright.config.ts \
        pqa-qa/.env.example pqa-qa/src/support/env.ts pqa-qa/src/support/env.spec.ts .gitignore
git commit -m "feat(qa): package scaffold and typed environment loader

Every URL and identity comes from the environment with no defaults, so
the suite cannot be one edited constant away from probing the wrong
deployment. Infrastructure credentials are all-or-nothing: a partial S3
configuration yields undefined rather than a client that fails obscurely
at first use."
```

---

## Task 2: Demo-path route inventory

This is S1-QA-01's first named deliverable — *"inventory the BFF/service routes on the demo path and classify data"*. It is also the input every family task filters against, so it comes before any probe.

**Files:**
- Create: `pqa-qa/inventory/demo-path.routes.yaml`
- Create: `pqa-qa/src/support/inventory.ts`
- Test: `pqa-qa/src/support/inventory.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `loadInventory(path?: string): RouteEntry[]`, `routesFor(entries: RouteEntry[], family: AttackFamily): RouteEntry[]`, and the types `RouteEntry`, `DataClass`, `AttackFamily`, `Screen`.

- [ ] **Step 1: Write the failing test for the inventory loader**

`pqa-qa/src/support/inventory.spec.ts`:

```ts
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
  expect(() => loadInventory(fixture(bad))).toThrow(/vibes-based-attack/);
});

test('rejects an in-scope route that declares no attacks', () => {
  const bad = valid.replace(
    'attacks: [missing-identity, wrong-tenant, session-replay]',
    'attacks: []',
  );
  expect(() => loadInventory(fixture(bad))).toThrow(/s1_scope.*at least one attack/i);
});

test('rejects a path missing the {tenant} placeholder', () => {
  const bad = valid.replace('/{tenant}/api/dashboard/counts', '/commerce/api/dashboard/counts');
  expect(() => loadInventory(fixture(bad))).toThrow(/\{tenant\}/);
});

test('routesFor returns only in-scope routes declaring that family', () => {
  const entries = loadInventory(fixture(valid));
  expect(routesFor(entries, 'wrong-tenant').map((r) => r.path))
    .toEqual(['/{tenant}/api/dashboard/counts']);
  expect(routesFor(entries, 'wrong-department')).toEqual([]);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd pqa-qa && npm run qa:unit -- inventory.spec.ts`
Expected: FAIL — `Cannot find module './inventory.js'`.

- [ ] **Step 3: Implement `inventory.ts`**

`pqa-qa/src/support/inventory.ts`:

```ts
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
      throw new Error(`${label}: ${parsed.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`);
    }
    const r = parsed.data;
    if (!r.path.includes('{tenant}')) {
      throw new Error(`${r.path}: every route must be tenant-relative and contain {tenant}`);
    }
    if (r.s1_scope && r.attacks.length === 0) {
      throw new Error(`${r.path}: s1_scope is true but declares no attacks — an in-scope route must declare at least one attack family`);
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
```

Zod's `.strict()` matters: a typo'd key such as `dataclass:` must be an error, not a silently-defaulted field. A misclassified route is worse than a missing one, because it produces confident wrong coverage.

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd pqa-qa && npm run qa:unit -- inventory.spec.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Build the inventory from source**

Read the route handlers under `pqa-builder/apps/frontend/src/app/[tenant]/api/**/route.ts` — **read only, change nothing**. For each, record the HTTP methods it exports, the session gate it calls (`requirePortalSession`, `requireIngestionPermission`, `requireAdminApiSession`, or none), and the upstream it proxies to.

Mark `s1_scope: true` only for routes reachable from the six demo-path screens: login, dashboard, PQ intake, drafting, review, export. Everything else is inventoried with `s1_scope: false`.

Assign `data_class` by what the response body contains, not by what the path suggests:

| Class | Meaning |
|---|---|
| `public` | Identical for every caller; no tenant or user information |
| `tenant-scoped` | Contains one tenant's data; another tenant must never see it |
| `department-scoped` | Contains one division's data; another division must never see it |
| `private-source` | May contain private external-source content subject to promote-to-public |
| `credential` | Contains or accepts a key, token, presigned URL or session |

Assign `attacks` from the class: `tenant-scoped` implies `wrong-tenant` and `session-replay`; `department-scoped` additionally implies `wrong-department`; every gated route implies `missing-identity`; `/internal/*` implies `service-surface`; anything calling an LLM or embedding implies `egress-residency`.

Seed the file with these entries, then extend to full demo-path coverage:

```yaml
# S1-QA-01 deliverable (a): demo-path route inventory and data classification.
# data_class describes what the RESPONSE BODY contains, not what the path suggests.
# s1_scope: true == reachable from login / dashboard / intake / drafting / review / export.

- path: /{tenant}/api/tenant-config
  method: GET
  screen: login
  upstream: tenant-config-manager-service /tenants/resolve
  gate: none
  data_class: public
  attacks: [wrong-tenant]
  s1_scope: true

- path: /{tenant}/api/auth/session
  method: GET
  screen: login
  upstream: identity-service /auth/session
  gate: none
  data_class: credential
  attacks: [missing-identity, wrong-tenant, session-replay]
  s1_scope: true

- path: /{tenant}/api/auth/otp/request
  method: POST
  screen: login
  upstream: identity-service /auth/mock/otp/request
  gate: none
  data_class: credential
  attacks: [missing-identity, wrong-tenant]
  s1_scope: true

- path: /{tenant}/api/dashboard/counts
  method: GET
  screen: dashboard
  upstream: pqa-service /dashboard/counts
  gate: requirePortalSession
  data_class: tenant-scoped
  attacks: [missing-identity, wrong-tenant, session-replay]
  s1_scope: true

- path: /{tenant}/api/dashboard/action-required
  method: GET
  screen: dashboard
  upstream: pqa-service /dashboard/action-required
  gate: requirePortalSession
  data_class: department-scoped
  attacks: [missing-identity, wrong-tenant, wrong-department, session-replay]
  s1_scope: true

- path: /{tenant}/api/parliament/questions
  method: GET
  screen: intake
  upstream: pqa-service /questions
  gate: requirePortalSession
  data_class: tenant-scoped
  attacks: [missing-identity, wrong-tenant, session-replay]
  s1_scope: true

- path: /{tenant}/api/parliament/questions/{id}
  method: GET
  screen: drafting
  upstream: pqa-service /questions/:id
  gate: requirePortalSession
  data_class: department-scoped
  attacks: [missing-identity, wrong-tenant, wrong-department, session-replay]
  s1_scope: true

- path: /{tenant}/api/departments/questions/{id}/draft
  method: GET
  screen: drafting
  upstream: pqa-service /departments/questions/:id/draft
  gate: requirePortalSession
  data_class: department-scoped
  attacks: [missing-identity, wrong-tenant, wrong-department, session-replay]
  s1_scope: true

- path: /{tenant}/api/parliament/approvals
  method: GET
  screen: review
  upstream: pqa-service /questions/approvals
  gate: requirePortalSession
  data_class: department-scoped
  attacks: [missing-identity, wrong-tenant, wrong-department, session-replay]
  s1_scope: true

- path: /{tenant}/api/questions/upload-batch/{id}/export-docx
  method: GET
  screen: export
  upstream: pqa-service /questions/upload-batch/:id/export-docx
  gate: requirePortalSession
  data_class: department-scoped
  attacks: [missing-identity, wrong-tenant, wrong-department, session-replay]
  s1_scope: true

- path: /{tenant}/api/assistant/search
  method: POST
  screen: drafting
  upstream: rag-service /search
  gate: requirePortalSession
  data_class: private-source
  attacks: [missing-identity, wrong-tenant, wrong-index, egress-residency]
  s1_scope: true

- path: /{tenant}/api/assistant/generate
  method: POST
  screen: drafting
  upstream: rag-service /generate
  gate: requirePortalSession
  data_class: private-source
  attacks: [missing-identity, wrong-tenant, wrong-index, egress-residency]
  s1_scope: true

- path: /{tenant}/api/files/presigned-url
  method: POST
  screen: intake
  upstream: pqa-service /files/presigned-url
  gate: requirePortalSession
  data_class: credential
  attacks: [missing-identity, wrong-tenant, wrong-department, s3-prefix-escape]
  s1_scope: true
```

- [ ] **Step 6: Prove the real inventory parses**

Add to `inventory.spec.ts`:

```ts
test('the committed demo-path inventory is valid', () => {
  const entries = loadInventory();
  expect(entries.length).toBeGreaterThan(10);
  expect(entries.some((e) => e.s1Scope)).toBe(true);
  expect(routesFor(entries, 'missing-identity').length).toBeGreaterThan(5);
});
```

Run: `cd pqa-qa && npm run qa:unit -- inventory.spec.ts`
Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add pqa-qa/inventory/demo-path.routes.yaml pqa-qa/src/support/inventory.ts pqa-qa/src/support/inventory.spec.ts
git commit -m "feat(qa): demo-path route inventory and validating loader

S1-QA-01's first deliverable. data_class describes what the response
body contains rather than what the path suggests, because that is what
decides which attacks apply, and it is the field S1-DO-02 needs for IAM
and index scoping.

The loader is strict on unknown keys: a typo'd data_class must be an
error rather than a silently-defaulted field. A misclassified route is
worse than a missing one — it produces confident wrong coverage."
```

---

## Task 3: Tenant discovery

Tenant slugs on the deployed environment are not known in advance, and path-segment routing means nothing else can run until they are. Discovery is read-only: a `GET` of each candidate's public config endpoint.

**Files:**
- Create: `pqa-qa/src/support/tenant.ts`
- Test: `pqa-qa/src/support/tenant.spec.ts`

**Interfaces:**
- Consumes: `QaEnv` from `env.ts`.
- Produces: `discoverTenants(request: APIRequestContext, env: QaEnv): Promise<TenantProbe[]>`, `activeSlugs(probes: TenantProbe[]): string[]`, `pickTenantPair(probes: TenantProbe[]): TenantPair | null`, and the types `TenantProbe`, `TenantStatus`, `TenantPair`.

- [ ] **Step 1: Write the failing test**

`pqa-qa/src/support/tenant.spec.ts`. The classifier is a pure function so it can be unit-tested without network; only `discoverTenants` does I/O.

```ts
import { test, expect } from '@playwright/test';
import { classifyTenantResponse, activeSlugs, pickTenantPair } from './tenant.js';
import type { TenantProbe } from './tenant.js';

test('a 200 with a tenant name is active', () => {
  const p = classifyTenantResponse('commerce', 200, {
    data: { tenant: { tenantName: 'Ministry of Commerce and Industry', status: 'active' } },
  });
  expect(p.status).toBe('active');
  expect(p.tenantName).toBe('Ministry of Commerce and Industry');
});

test('a 200 reporting a non-active status is suspended, not active', () => {
  const p = classifyTenantResponse('railways', 200, {
    data: { tenant: { tenantName: 'Ministry of Railways', status: 'suspended' } },
  });
  expect(p.status).toBe('suspended');
});

test('a 404 is not-found', () => {
  expect(classifyTenantResponse('nope', 404, { error: 'TENANT_NOT_FOUND' }).status).toBe('not-found');
});

test('a 403 is suspended — the API signals an inactive tenant that way', () => {
  expect(classifyTenantResponse('paused', 403, { error: 'TENANT_INACTIVE' }).status).toBe('suspended');
});

test('a 503 is error, not not-found — config service down must not read as absent', () => {
  const p = classifyTenantResponse('commerce', 503, {});
  expect(p.status).toBe('error');
  expect(p.detail).toContain('503');
});

test('a 200 with an unparseable body is error, not active', () => {
  expect(classifyTenantResponse('commerce', 200, null).status).toBe('error');
});

const probes = (spec: Array<[string, TenantProbe['status']]>): TenantProbe[] =>
  spec.map(([slug, status]) => ({ slug, status }));

test('activeSlugs returns only active tenants, in candidate order', () => {
  expect(activeSlugs(probes([
    ['commerce', 'active'], ['railways', 'suspended'], ['mohfw', 'active'],
  ]))).toEqual(['commerce', 'mohfw']);
});

test('pickTenantPair needs two active tenants', () => {
  expect(pickTenantPair(probes([['commerce', 'active']]))).toBeNull();
  expect(pickTenantPair(probes([['commerce', 'active'], ['mohfw', 'active']])))
    .toEqual({ primary: 'commerce', secondary: 'mohfw' });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd pqa-qa && npm run qa:unit -- tenant.spec.ts`
Expected: FAIL — `Cannot find module './tenant.js'`.

- [ ] **Step 3: Implement `tenant.ts`**

```ts
import type { APIRequestContext } from '@playwright/test';
import type { QaEnv } from './env.js';

export type TenantStatus = 'active' | 'suspended' | 'not-found' | 'error';

export interface TenantProbe {
  slug: string;
  status: TenantStatus;
  tenantName?: string;
  detail?: string;
}

export interface TenantPair {
  primary: string;
  secondary: string;
}

interface ConfigBody {
  data?: { tenant?: { tenantName?: string; status?: string } };
}

export function classifyTenantResponse(
  slug: string,
  httpStatus: number,
  body: unknown,
): TenantProbe {
  if (httpStatus === 404) return { slug, status: 'not-found' };
  if (httpStatus === 403) return { slug, status: 'suspended', detail: 'HTTP 403' };
  if (httpStatus !== 200) {
    return { slug, status: 'error', detail: `HTTP ${httpStatus}` };
  }

  const tenant = (body as ConfigBody | null)?.data?.tenant;
  if (!tenant?.tenantName) {
    return { slug, status: 'error', detail: 'HTTP 200 with no tenant in body' };
  }
  if (tenant.status && tenant.status !== 'active') {
    return { slug, status: 'suspended', tenantName: tenant.tenantName, detail: tenant.status };
  }
  return { slug, status: 'active', tenantName: tenant.tenantName };
}

export async function discoverTenants(
  request: APIRequestContext,
  env: QaEnv,
): Promise<TenantProbe[]> {
  const probes: TenantProbe[] = [];
  for (const slug of env.tenantCandidates) {
    try {
      const res = await request.get(`${env.baseUrl}/${slug}/api/tenant-config`, {
        headers: { 'User-Agent': env.userAgent },
        timeout: 15_000,
        failOnStatusCode: false,
      });
      const body = await res.json().catch(() => null);
      probes.push(classifyTenantResponse(slug, res.status(), body));
    } catch (err) {
      probes.push({
        slug,
        status: 'error',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return probes;
}

export function activeSlugs(probes: TenantProbe[]): string[] {
  return probes.filter((p) => p.status === 'active').map((p) => p.slug);
}

export function pickTenantPair(probes: TenantProbe[]): TenantPair | null {
  const active = activeSlugs(probes);
  const [primary, secondary] = active;
  if (!primary || !secondary) return null;
  return { primary, secondary };
}
```

Two classifications carry weight. A `503` is `error`, never `not-found` — the config service being down must not be recorded as "this tenant does not exist", which would silently shrink the test matrix. And a `200` whose body has no tenant is `error`, not `active`, because `CLAUDE.md` §1.1 states an unknown slug must never fall through to another tenant; a shapeless 200 is exactly what that failure would look like.

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd pqa-qa && npm run qa:unit -- tenant.spec.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add pqa-qa/src/support/tenant.ts pqa-qa/src/support/tenant.spec.ts
git commit -m "feat(qa): read-only tenant discovery

The deployed environment's tenant slugs are not known in advance and
path-segment routing means nothing runs without them. Discovery is a
GET of each candidate's public config endpoint.

A 503 classifies as error rather than not-found: the config service
being down must not silently shrink the test matrix. A 200 with no
tenant in the body is also error, because an unknown slug falling
through to another tenant would look exactly like that."
```

---

## Task 4: Capability probe and global setup

The probe decides what is testable before any assertion runs, and aborts the run cleanly if the environment is unreachable — which it will be while the deployment is in progress.

**Files:**
- Create: `pqa-qa/src/support/probe.ts`
- Create: `pqa-qa/src/global-setup.ts`
- Modify: `pqa-qa/playwright.config.ts` (register `globalSetup`)
- Test: `pqa-qa/src/support/probe.spec.ts`

**Interfaces:**
- Consumes: `QaEnv`, `discoverTenants`, `pickTenantPair`, `TenantProbe`.
- Produces: `probeCapabilities(request, env): Promise<Capabilities>`, `writeCapabilities(c: Capabilities): void`, `readCapabilities(): Capabilities`, and the types `Capabilities`, `ProbeResult`.

- [ ] **Step 1: Write the failing test**

`pqa-qa/src/support/probe.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { credentialProbe, mockAuthProbe } from './probe.js';

test('an absent credential is unavailable with a reason naming what is needed', () => {
  const r = credentialProbe(undefined, 'S3', 'PQA_S3_* (ask Bhupendra, S1-DO-02)');
  expect(r.available).toBe(false);
  expect(r.reason).toContain('PQA_S3_*');
  expect(r.reason).toContain('Bhupendra');
});

test('a present credential is available', () => {
  expect(credentialProbe({ bucket: 'b' }, 'S3', 'x').available).toBe(true);
});

test('mock auth is available when the OTP request returns a code', () => {
  expect(mockAuthProbe(200, { message: 'DEV', otp: '123456' }).available).toBe(true);
});

test('mock auth is unavailable when the endpoint 404s', () => {
  const r = mockAuthProbe(404, { message: 'Mock OTP is disabled.' });
  expect(r.available).toBe(false);
  expect(r.reason).toContain('disabled');
});

test('mock auth without an OTP in the body is unavailable — it cannot be automated', () => {
  const r = mockAuthProbe(200, { message: 'Check identity-service logs for the OTP code.' });
  expect(r.available).toBe(false);
  expect(r.reason).toMatch(/no otp in response/i);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd pqa-qa && npm run qa:unit -- probe.spec.ts`
Expected: FAIL — `Cannot find module './probe.js'`.

- [ ] **Step 3: Implement `probe.ts`**

```ts
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext } from '@playwright/test';
import type { QaEnv, PersonaName } from './env.js';
import { discoverTenants, pickTenantPair } from './tenant.js';
import type { TenantProbe, TenantPair } from './tenant.js';

export interface ProbeResult {
  available: boolean;
  reason?: string;
}

export interface Capabilities {
  runId: string;
  baseUrl: string;
  probedAt: string;
  baseUrlReachable: ProbeResult;
  tenants: TenantProbe[];
  tenantPair: TenantPair | null;
  mockAuth: ProbeResult;
  personas: Partial<Record<PersonaName, ProbeResult>>;
  s3: ProbeResult;
  openSearch: ProbeResult;
  postgres: ProbeResult;
}

export function credentialProbe(
  value: unknown,
  label: string,
  needed: string,
): ProbeResult {
  if (value) return { available: true };
  return { available: false, reason: `${label} not configured — set ${needed}` };
}

export function mockAuthProbe(httpStatus: number, body: unknown): ProbeResult {
  const parsed = body as { message?: string; otp?: string } | null;
  if (httpStatus === 404) {
    return { available: false, reason: parsed?.message ?? 'mock OTP disabled (404)' };
  }
  if (httpStatus !== 200) {
    return { available: false, reason: `mock OTP request returned HTTP ${httpStatus}` };
  }
  if (!parsed?.otp) {
    return {
      available: false,
      reason: 'no OTP in response body — the flow cannot be automated from here',
    };
  }
  return { available: true };
}

function capabilitiesPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '.auth', 'capabilities.json');
}

export function writeCapabilities(c: Capabilities): void {
  const p = capabilitiesPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(c, null, 2), 'utf8');
}

export function readCapabilities(): Capabilities {
  return JSON.parse(readFileSync(capabilitiesPath(), 'utf8')) as Capabilities;
}

export async function probeCapabilities(
  request: APIRequestContext,
  env: QaEnv,
): Promise<Capabilities> {
  const base: Capabilities = {
    runId: env.runId,
    baseUrl: env.baseUrl,
    probedAt: new Date().toISOString(),
    baseUrlReachable: { available: false, reason: 'not probed' },
    tenants: [],
    tenantPair: null,
    mockAuth: { available: false, reason: 'not probed' },
    personas: {},
    s3: credentialProbe(env.s3, 'S3', 'PQA_S3_* (ask Bhupendra, S1-DO-02)'),
    openSearch: credentialProbe(env.openSearch, 'OpenSearch', 'PQA_OPENSEARCH_* (ask Bhupendra, S1-DO-02)'),
    postgres: credentialProbe(env.postgresDsn, 'Postgres', 'PQA_POSTGRES_DSN (ask Bhupendra)'),
  };

  try {
    const res = await request.get(env.baseUrl, {
      headers: { 'User-Agent': env.userAgent },
      timeout: 20_000,
      failOnStatusCode: false,
    });
    base.baseUrlReachable = { available: res.status() < 500, reason: `HTTP ${res.status()}` };
  } catch (err) {
    base.baseUrlReachable = {
      available: false,
      reason: err instanceof Error ? err.message : String(err),
    };
    return base;
  }

  base.tenants = await discoverTenants(request, env);
  base.tenantPair = pickTenantPair(base.tenants);

  const primary = base.tenantPair?.primary ?? base.tenants.find((t) => t.status === 'active')?.slug;
  if (!primary) return base;

  const admin = env.personaEmails['platform-admin'];
  if (admin) {
    const res = await request.post(`${env.baseUrl}/${primary}/api/auth/otp/request`, {
      headers: { 'User-Agent': env.userAgent, 'Content-Type': 'application/json' },
      data: { email: admin },
      timeout: 20_000,
      failOnStatusCode: false,
    });
    base.mockAuth = mockAuthProbe(res.status(), await res.json().catch(() => null));
  }

  return base;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd pqa-qa && npm run qa:unit -- probe.spec.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Implement `global-setup.ts`**

```ts
import { request } from '@playwright/test';
import { loadEnv } from './support/env.js';
import { probeCapabilities, writeCapabilities } from './support/probe.js';
import { authenticatePersonas } from './support/personas.js';

export default async function globalSetup(): Promise<void> {
  const env = loadEnv();
  const ctx = await request.newContext({ ignoreHTTPSErrors: false });

  try {
    const capabilities = await probeCapabilities(ctx, env);

    if (!capabilities.baseUrlReachable.available) {
      writeCapabilities(capabilities);
      throw new Error(
        `pqa-qa: ${env.baseUrl} is unreachable (${capabilities.baseUrlReachable.reason}). ` +
          `Aborting before any test runs — a deploying environment produces hundreds of ` +
          `misleading failures otherwise.`,
      );
    }

    capabilities.personas = await authenticatePersonas(env, capabilities);
    writeCapabilities(capabilities);

    const active = capabilities.tenants.filter((t) => t.status === 'active').length;
    const usable = Object.values(capabilities.personas).filter((p) => p?.available).length;
    console.log(
      `pqa-qa run ${env.runId} · ${env.baseUrl} · ${active} active tenant(s) · ` +
        `${usable} persona(s) · s3=${capabilities.s3.available} ` +
        `opensearch=${capabilities.openSearch.available} pg=${capabilities.postgres.available}`,
    );
  } finally {
    await ctx.dispose();
  }
}
```

Aborting on an unreachable base URL is deliberate. During the deployment window the alternative is a report full of connection errors that look like isolation failures, which is worse than no report.

- [ ] **Step 6: Register global setup**

In `pqa-qa/playwright.config.ts`, add inside `defineConfig({ ... })`, immediately after `testDir`:

```ts
  globalSetup: './src/global-setup.ts',
```

- [ ] **Step 7: Verify the abort path with an unreachable host**

Run: `cd pqa-qa && PQA_BASE_URL=https://127.0.0.1:9 PQA_TENANT_CANDIDATES=commerce PLATFORM_SEED_EMAIL=x@y.gov.in npm run qa:isolation`
Expected: the run aborts in global setup with the "is unreachable" message, and **no** isolation tests execute.

- [ ] **Step 8: Commit**

```bash
git add pqa-qa/src/support/probe.ts pqa-qa/src/support/probe.spec.ts pqa-qa/src/global-setup.ts pqa-qa/playwright.config.ts
git commit -m "feat(qa): capability probe and global setup

Establishes what is testable before anything is asserted: base URL,
tenant slugs, mock-auth availability, which personas exist, which
infrastructure credentials are present.

Three of S1-QA-01's five named families have no credentials on this
target, so without the probe a large fraction of the suite would
report green while testing nothing. Every unavailable capability
carries a reason naming what would unblock it.

The run aborts on an unreachable base URL rather than emitting
hundreds of connection errors that read like isolation failures."
```

---

## Task 5: Persona authentication and test fixtures

**Files:**
- Create: `pqa-qa/src/support/personas.ts`
- Create: `pqa-qa/src/support/fixtures.ts`
- Test: `pqa-qa/src/support/personas.spec.ts`

**Interfaces:**
- Consumes: `QaEnv`, `PersonaName`, `Capabilities`, `ProbeResult`.
- Produces: `authenticatePersonas(ctx, env, caps): Promise<Partial<Record<PersonaName, ProbeResult>>>`, `storageStatePath(p: PersonaName): string`, `classifyLogin(step, httpStatus, body): ProbeResult`; and from `fixtures.ts` the extended `test` object exposing fixtures `env`, `caps`, `routes`, `tenantPair`, `as(persona)`.

The authentication contract, read from the running code rather than assumed:

1. `POST {base}/{slug}/api/auth/otp/request` with `{ email }` → `200 { message, otp }`. The OTP **is returned in the response body** — `mock-otp.service.ts` returns it deliberately as the sanctioned dev channel. `404` means mock OTP is disabled; `404` with a "No portal is configured" message means the slug is unknown; `503` means the config service is unreachable.
2. `POST {base}/{slug}/api/auth/otp/verify` with `{ email, otp }` → sets the session cookies. `401 "User is not provisioned for this tenant"` means the account exists in neither sense that matters — that persona is unavailable, not broken.

- [ ] **Step 1: Write the failing test**

`pqa-qa/src/support/personas.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { classifyLogin, storageStatePath } from './personas.js';

test('a successful verify is available', () => {
  expect(classifyLogin('verify', 200, {}).available).toBe(true);
});

test('an unprovisioned user is unavailable, not an error', () => {
  const r = classifyLogin('verify', 401, { message: 'User is not provisioned for this tenant' });
  expect(r.available).toBe(false);
  expect(r.reason).toContain('not provisioned');
});

test('a deactivated account is unavailable with its own reason', () => {
  const r = classifyLogin('verify', 401, { message: 'Your account has been deactivated' });
  expect(r.reason).toContain('deactivated');
});

test('a disabled mock OTP endpoint is reported at the request step', () => {
  const r = classifyLogin('request', 404, { message: 'Mock OTP is disabled.' });
  expect(r.available).toBe(false);
  expect(r.reason).toContain('Mock OTP is disabled');
});

test('a 5xx is reported with its status so it is not read as a missing account', () => {
  const r = classifyLogin('verify', 502, {});
  expect(r.available).toBe(false);
  expect(r.reason).toContain('502');
});

test('storage state paths are per-persona and under the gitignored .auth directory', () => {
  const p = storageStatePath('division-member');
  expect(p).toContain('.auth');
  expect(p).toContain('division-member');
  expect(p.endsWith('.json')).toBe(true);
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd pqa-qa && npm run qa:unit -- personas.spec.ts`
Expected: FAIL — `Cannot find module './personas.js'`.

- [ ] **Step 3: Implement `personas.ts`**

```ts
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import type { QaEnv, PersonaName } from './env.js';
import type { Capabilities, ProbeResult } from './probe.js';

export function storageStatePath(persona: PersonaName): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '.auth', `${persona}.json`);
}

export function classifyLogin(
  step: 'request' | 'verify',
  httpStatus: number,
  body: unknown,
): ProbeResult {
  const message = (body as { message?: string } | null)?.message;
  if (httpStatus === 200) return { available: true };
  if (message) return { available: false, reason: `${step}: ${message} (HTTP ${httpStatus})` };
  return { available: false, reason: `${step}: HTTP ${httpStatus}` };
}

async function loginOne(
  ctx: APIRequestContext,
  env: QaEnv,
  slug: string,
  persona: PersonaName,
  email: string,
): Promise<ProbeResult> {
  const headers = { 'User-Agent': env.userAgent, 'Content-Type': 'application/json' };

  const reqRes = await ctx.post(`${env.baseUrl}/${slug}/api/auth/otp/request`, {
    headers, data: { email }, timeout: 20_000, failOnStatusCode: false,
  });
  const reqBody = (await reqRes.json().catch(() => null)) as { otp?: string; message?: string } | null;
  if (reqRes.status() !== 200) return classifyLogin('request', reqRes.status(), reqBody);
  if (!reqBody?.otp) {
    return { available: false, reason: 'request: no OTP in response body' };
  }

  const verifyRes = await ctx.post(`${env.baseUrl}/${slug}/api/auth/otp/verify`, {
    headers, data: { email, otp: reqBody.otp }, timeout: 20_000, failOnStatusCode: false,
  });
  if (verifyRes.status() !== 200) {
    return classifyLogin('verify', verifyRes.status(), await verifyRes.json().catch(() => null));
  }

  const path = storageStatePath(persona);
  mkdirSync(dirname(path), { recursive: true });
  await ctx.storageState({ path });
  return { available: true };
}

export async function authenticatePersonas(
  env: QaEnv,
  caps: Capabilities,
): Promise<Partial<Record<PersonaName, ProbeResult>>> {
  const out: Partial<Record<PersonaName, ProbeResult>> = {};
  const slug = caps.tenantPair?.primary ?? caps.tenants.find((t) => t.status === 'active')?.slug;

  for (const [persona, email] of Object.entries(env.personaEmails) as Array<[PersonaName, string]>) {
    if (!slug) {
      out[persona] = { available: false, reason: 'no active tenant to authenticate against' };
      continue;
    }
    if (!caps.mockAuth.available) {
      out[persona] = { available: false, reason: `mock auth unavailable: ${caps.mockAuth.reason}` };
      continue;
    }

    // A fresh context per persona. Reusing one would carry the previous
    // persona's cookies into the next storageState, silently producing N
    // identical sessions and N authorization tests that all pass for the
    // wrong reason. This is the most dangerous failure mode in the fixture
    // layer, and it is invisible in a green report.
    const personaCtx = await playwrightRequest.newContext({
      extraHTTPHeaders: { 'User-Agent': env.userAgent },
    });
    try {
      out[persona] = await loginOne(personaCtx, env, slug, persona, email);
    } finally {
      await personaCtx.dispose();
    }
  }
  return out;
}
```

`APIRequestContext` remains imported for `loginOne`'s parameter type.

- [ ] **Step 4: Write a test that proves personas are distinct**

Append to `personas.spec.ts`:

```ts
test('each persona gets its own storage state path', () => {
  const paths = new Set([
    storageStatePath('platform-admin'),
    storageStatePath('parliament-admin'),
    storageStatePath('parliament-member'),
    storageStatePath('division-admin'),
    storageStatePath('division-member'),
  ]);
  expect(paths.size).toBe(5);
});
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd pqa-qa && npm run qa:unit -- personas.spec.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Implement `fixtures.ts`**

```ts
import { test as base, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { loadEnv } from './env.js';
import type { QaEnv, PersonaName } from './env.js';
import { readCapabilities } from './probe.js';
import type { Capabilities } from './probe.js';
import { loadInventory } from './inventory.js';
import type { RouteEntry } from './inventory.js';
import { storageStatePath } from './personas.js';
import type { TenantPair } from './tenant.js';

interface QaFixtures {
  env: QaEnv;
  caps: Capabilities;
  routes: RouteEntry[];
  tenantPair: TenantPair | null;
  as: (persona: PersonaName) => Promise<APIRequestContext>;
}

export const test = base.extend<QaFixtures>({
  env: async ({}, use) => { await use(loadEnv()); },
  caps: async ({}, use) => { await use(readCapabilities()); },
  routes: async ({}, use) => { await use(loadInventory()); },
  tenantPair: async ({ caps }, use) => { await use(caps.tenantPair); },

  as: async ({ env, caps }, use) => {
    const created: APIRequestContext[] = [];
    const factory = async (persona: PersonaName): Promise<APIRequestContext> => {
      const probe = caps.personas[persona];
      if (!probe?.available) {
        throw new Error(
          `persona "${persona}" is unavailable: ${probe?.reason ?? 'not configured'}`,
        );
      }
      const ctx = await playwrightRequest.newContext({
        storageState: storageStatePath(persona),
        extraHTTPHeaders: { 'User-Agent': env.userAgent },
      });
      created.push(ctx);
      return ctx;
    };
    await use(factory);
    await Promise.all(created.map((c) => c.dispose()));
  },
});

export { expect };

/** Resolve an inventory path template against a tenant and an optional id. */
export function url(env: QaEnv, entry: RouteEntry, tenant: string, id = '1'): string {
  return `${env.baseUrl}${entry.path.replace('{tenant}', tenant).replace('{id}', id)}`;
}
```

- [ ] **Step 7: Commit**

```bash
git add pqa-qa/src/support/personas.ts pqa-qa/src/support/personas.spec.ts pqa-qa/src/support/fixtures.ts
git commit -m "feat(qa): persona authentication and shared test fixtures

Drives the mock OTP flow, which returns the code in the response body
as the sanctioned dev channel, so authentication is fully automatable.

A persona whose account is not provisioned is recorded as unavailable
with that reason rather than failing the run — only the platform seed
admin is confirmed to exist on this environment, and families 3 and 8
degrade honestly when there is no lower-privileged attacker.

Each persona authenticates in its own request context. A shared one
would carry the previous persona's cookies into the next storage
state, producing four identical sessions and four authorization tests
that all pass for the wrong reason."
```

---

## Task 6: Gap annotations and refusal assertions

The shared vocabulary every family spec uses. Two concerns: how a test declares it is a known gap or unmeasurable, and how a test asserts that access was actually refused.

**Files:**
- Create: `pqa-qa/src/support/annotations.ts`
- Create: `pqa-qa/src/support/assertions.ts`
- Test: `pqa-qa/src/support/assertions.spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `trackedGap(info, meta)`, `notMeasured(info, meta)`, `GAP_ANNOTATION`, `NOT_MEASURED_ANNOTATION`, `parseGapMeta(description)`, type `GapMeta`; and `assertRefused(obs, ctx)`, `assertNoForeignContent(obs, markers, ctx)`, type `HttpObservation`.

- [ ] **Step 1: Write the failing test for the assertions**

`pqa-qa/src/support/assertions.spec.ts`. This is the task that proves the assertions can fail — everything downstream depends on it.

```ts
import { test, expect } from '@playwright/test';
import { assertRefused, assertNoForeignContent } from './assertions.js';
import { parseGapMeta } from './annotations.js';

test('a 401 is a refusal', () => {
  expect(() => assertRefused({ status: 401, body: { error: 'x' } }, 'ctx')).not.toThrow();
});

test('a 403 is a refusal', () => {
  expect(() => assertRefused({ status: 403, body: {} }, 'ctx')).not.toThrow();
});

test('a 404 is a refusal', () => {
  expect(() => assertRefused({ status: 404, body: {} }, 'ctx')).not.toThrow();
});

test('a 200 is NOT a refusal', () => {
  expect(() => assertRefused({ status: 200, body: { data: [1] } }, 'GET /x'))
    .toThrow(/GET \/x/);
});

test('a 200 with an empty list is not a refusal either — this is the masquerade', () => {
  expect(() => assertRefused({ status: 200, body: { data: [] } }, 'GET /x'))
    .toThrow(/empty|200/i);
});

test('a 500 is not counted as a refusal — it is an error, not a gate', () => {
  expect(() => assertRefused({ status: 500, body: {} }, 'GET /x')).toThrow(/500/);
});

test('foreign content in a body fails', () => {
  expect(() =>
    assertNoForeignContent(
      { status: 200, body: { data: [{ subject: 'Ministry of Railways budget' }] } },
      ['Ministry of Railways'],
      'GET /commerce/x',
    ),
  ).toThrow(/Ministry of Railways/);
});

test('absence of foreign content passes', () => {
  expect(() =>
    assertNoForeignContent(
      { status: 200, body: { data: [{ subject: 'Commerce exports' }] } },
      ['Ministry of Railways'],
      'ctx',
    ),
  ).not.toThrow();
});

test('gap metadata round-trips through the annotation description', () => {
  expect(parseGapMeta('S1-DO-02 · Bhupendra · per-tenant S3 IAM boundary')).toEqual({
    tracker: 'S1-DO-02',
    owner: 'Bhupendra',
    detail: 'per-tenant S3 IAM boundary',
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd pqa-qa && npm run qa:unit -- assertions.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `annotations.ts`**

```ts
import type { TestInfo } from '@playwright/test';

export const GAP_ANNOTATION = 'known-gap';
export const NOT_MEASURED_ANNOTATION = 'not-measured';

export interface GapMeta {
  tracker: string;
  owner: string;
  detail: string;
}

const SEP = ' · ';

export function formatGapMeta(meta: GapMeta): string {
  return [meta.tracker, meta.owner, meta.detail].join(SEP);
}

export function parseGapMeta(description: string): GapMeta {
  const [tracker = '', owner = '', ...rest] = description.split(SEP);
  return { tracker, owner, detail: rest.join(SEP) };
}

/**
 * Declare that this test is expected to fail against a known, owned gap.
 * A failure is reported as a tracked gap and does not fail the run; a PASS
 * is reported as a closed gap so the annotation gets removed.
 */
export function trackedGap(info: TestInfo, meta: GapMeta): void {
  info.annotations.push({ type: GAP_ANNOTATION, description: formatGapMeta(meta) });
}

/**
 * Declare that this property cannot be measured right now, and skip.
 * Never a pass: an unmeasured boundary is not a safe boundary.
 */
export function notMeasured(info: TestInfo, meta: GapMeta): void {
  info.annotations.push({ type: NOT_MEASURED_ANNOTATION, description: formatGapMeta(meta) });
  info.skip(true, `not measured — ${formatGapMeta(meta)}`);
}
```

- [ ] **Step 4: Implement `assertions.ts`**

```ts
export interface HttpObservation {
  status: number;
  body: unknown;
}

const REFUSAL_STATUSES = new Set([401, 403, 404]);

function preview(body: unknown): string {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? null);
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

/**
 * Access must have been refused. A 2xx is a failure even when the payload is
 * empty: an empty list is indistinguishable from "this tenant has no data",
 * which is exactly how a broken gate hides behind a plausible screen.
 * A 5xx is also a failure — it is an error, not evidence of a working gate.
 */
export function assertRefused(obs: HttpObservation, context: string): void {
  if (REFUSAL_STATUSES.has(obs.status)) return;

  if (obs.status >= 200 && obs.status < 300) {
    throw new Error(
      `${context}: expected refusal (401/403/404) but got ${obs.status}. ` +
        `Access was granted where it should have been denied. Body: ${preview(obs.body)}`,
    );
  }
  throw new Error(
    `${context}: expected refusal (401/403/404) but got ${obs.status}, which is ` +
      `an error rather than a gate. A 5xx does not demonstrate that access is denied. ` +
      `Body: ${preview(obs.body)}`,
  );
}

/**
 * The response must not contain any marker belonging to another tenant.
 * Used where a request legitimately succeeds but must be scoped.
 */
export function assertNoForeignContent(
  obs: HttpObservation,
  foreignMarkers: string[],
  context: string,
): void {
  const text = typeof obs.body === 'string' ? obs.body : JSON.stringify(obs.body ?? null);
  const hits = foreignMarkers.filter((m) => m && text.includes(m));
  if (hits.length > 0) {
    throw new Error(
      `${context}: response contained content belonging to another tenant: ` +
        `${hits.join(', ')}. Body: ${preview(obs.body)}`,
    );
  }
}
```

- [ ] **Step 5: Run the tests and watch them pass**

Run: `cd pqa-qa && npm run qa:unit -- assertions.spec.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add pqa-qa/src/support/annotations.ts pqa-qa/src/support/assertions.ts pqa-qa/src/support/assertions.spec.ts
git commit -m "feat(qa): gap annotations and refusal assertions

assertRefused treats a 2xx with an empty list as a failure, not a
pass. An empty list is indistinguishable from 'this tenant has no
data', which is how a broken gate hides behind a plausible screen. A
5xx is also a failure: an error is not evidence that access is denied.

notMeasured skips rather than passes, because an unmeasured boundary
is not a safe boundary.

Every assertion is unit-tested against a known-bad response and
required to throw. A probe that has never been seen to fail is not
evidence of anything."
```

---

## Task 7: Three-state gap reporter

The mechanism that makes *"every gap is a named failing test, not an opinion"* survive contact with a daily run.

**Files:**
- Create: `pqa-qa/src/support/gap-reporter.ts`
- Create: `pqa-qa/inventory/gaps.md` (generated; commit the first output)
- Test: `pqa-qa/src/support/gap-reporter.spec.ts`

**Interfaces:**
- Consumes: `GAP_ANNOTATION`, `NOT_MEASURED_ANNOTATION`, `parseGapMeta`.
- Produces: default-exported Playwright `Reporter` class; `classifyOutcome(annotations, status): Outcome`; `renderGapsMarkdown(rows, meta): string`; types `Outcome`, `GapRow`.

- [ ] **Step 1: Confirm the annotation API on the installed Playwright**

Playwright moved annotations between `TestCase` and `TestResult` across versions, and reading the wrong one silently yields zero gaps — which would look like a clean run.

Run: `cd pqa-qa && node -e "const p=require('./node_modules/@playwright/test/package.json');console.log(p.version)"`

Then confirm both shapes are handled by the merge helper in Step 3. Do not skip this step: a reporter that reads no annotations classifies every tracked gap as a regression and turns the run red on day one.

- [ ] **Step 2: Write the failing test**

`pqa-qa/src/support/gap-reporter.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { classifyOutcome, renderGapsMarkdown } from './gap-reporter.js';
import { GAP_ANNOTATION, NOT_MEASURED_ANNOTATION } from './annotations.js';

const gap = [{ type: GAP_ANNOTATION, description: 'S1-DO-02 · Bhupendra · S3 IAM' }];
const unmeasured = [{ type: NOT_MEASURED_ANNOTATION, description: 'S1-DO-02 · Bhupendra · no key' }];

test('an unannotated failure is a regression', () => {
  expect(classifyOutcome([], 'failed')).toBe('regression');
});

test('an annotated failure is a tracked gap', () => {
  expect(classifyOutcome(gap, 'failed')).toBe('tracked-gap');
});

test('an annotated PASS is a closed gap — the owner fixed it', () => {
  expect(classifyOutcome(gap, 'passed')).toBe('closed-gap');
});

test('a not-measured skip is its own state, never a pass', () => {
  expect(classifyOutcome(unmeasured, 'skipped')).toBe('not-measured');
});

test('an unannotated pass is just a pass', () => {
  expect(classifyOutcome([], 'passed')).toBe('passed');
});

test('an unannotated skip is reported, not silently green', () => {
  expect(classifyOutcome([], 'skipped')).toBe('skipped');
});

test('a timed-out unannotated test is a regression', () => {
  expect(classifyOutcome([], 'timedOut')).toBe('regression');
});

test('the markdown names owner, tracker and the failing assertion', () => {
  const md = renderGapsMarkdown(
    [{
      outcome: 'tracked-gap',
      title: 'f4 › write outside the tenant prefix is denied',
      family: 'f4',
      tracker: 'S1-DO-02',
      owner: 'Bhupendra',
      detail: 'S3 IAM',
      error: 'expected refusal but got 200',
    }],
    { runId: 'abc', baseUrl: 'https://x', probedAt: '2026-09-22T00:00:00Z' },
  );
  expect(md).toContain('Bhupendra');
  expect(md).toContain('S1-DO-02');
  expect(md).toContain('expected refusal but got 200');
  expect(md).toContain('https://x');
});

test('the markdown states plainly when there are no gaps', () => {
  const md = renderGapsMarkdown([], { runId: 'abc', baseUrl: 'https://x', probedAt: 'now' });
  expect(md).toMatch(/no tracked gaps|none/i);
});
```

- [ ] **Step 3: Implement `gap-reporter.ts`**

```ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Reporter, TestCase, TestResult, FullResult,
} from '@playwright/test/reporter';
import { GAP_ANNOTATION, NOT_MEASURED_ANNOTATION, parseGapMeta } from './annotations.js';
import { readCapabilities } from './probe.js';

export type Outcome =
  | 'passed' | 'skipped' | 'regression' | 'tracked-gap' | 'closed-gap' | 'not-measured';

export interface GapRow {
  outcome: Outcome;
  title: string;
  family: string;
  tracker: string;
  owner: string;
  detail: string;
  error: string;
}

interface Annotation { type: string; description?: string }

export function classifyOutcome(
  annotations: Annotation[],
  status: TestResult['status'] | 'passed' | 'failed' | 'skipped',
): Outcome {
  const hasGap = annotations.some((a) => a.type === GAP_ANNOTATION);
  const hasUnmeasured = annotations.some((a) => a.type === NOT_MEASURED_ANNOTATION);

  if (hasUnmeasured) return 'not-measured';
  if (status === 'passed') return hasGap ? 'closed-gap' : 'passed';
  if (status === 'skipped') return 'skipped';
  return hasGap ? 'tracked-gap' : 'regression';
}

/** Playwright has moved annotations between TestCase and TestResult; read both. */
function mergedAnnotations(test: TestCase, result: TestResult): Annotation[] {
  const fromResult = (result as unknown as { annotations?: Annotation[] }).annotations ?? [];
  const seen = new Set<string>();
  return [...test.annotations, ...fromResult].filter((a) => {
    const key = `${a.type}::${a.description ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function renderGapsMarkdown(
  rows: GapRow[],
  meta: { runId: string; baseUrl: string; probedAt: string },
): string {
  const section = (title: string, outcome: Outcome, blurb: string): string => {
    const subset = rows.filter((r) => r.outcome === outcome);
    if (subset.length === 0) return '';
    const body = subset
      .map((r) => `| ${r.family} | ${r.owner} | ${r.tracker} | ${r.title} | ${r.error.replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`)
      .join('\n');
    return `\n## ${title} (${subset.length})\n\n${blurb}\n\n| Family | Owner | Tracker | Test | Detail |\n|---|---|---|---|---|\n${body}\n`;
  };

  const header =
    `<!-- Generated by pqa-qa. Do not hand-edit; regenerated on every run. -->\n` +
    `# Isolation gap register\n\n` +
    `**Run:** \`${meta.runId}\` · **Target:** ${meta.baseUrl} · **Probed:** ${meta.probedAt}\n`;

  const body =
    section('Regressions', 'regression',
      'Unannotated failures. Something broke — investigate before anything else.') +
    section('Tracked gaps', 'tracked-gap',
      'Known, owned, expected to fail. This is the S2-BE-01 checklist.') +
    section('Closed gaps', 'closed-gap',
      'Annotated tests that now PASS. The owner fixed it — remove the annotation.') +
    section('Not measured', 'not-measured',
      'No credential or no persona. Not passing, not failing — unverified.');

  if (!body) {
    return `${header}\nNo tracked gaps, regressions or unmeasured properties in this run.\n`;
  }
  return `${header}${body}`;
}

function gapsPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'inventory', 'gaps.md');
}

class GapReporter implements Reporter {
  private rows: GapRow[] = [];
  private meta = { runId: 'unknown', baseUrl: 'unknown', probedAt: new Date().toISOString() };

  onBegin(): void {
    try {
      // capabilities.json legitimately does not exist when global setup
      // aborted on an unreachable base URL; the header keeps its defaults.
      const caps = readCapabilities();
      this.meta = { runId: caps.runId, baseUrl: caps.baseUrl, probedAt: caps.probedAt };
    } catch {
      // Intentionally empty — see above.
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const annotations = mergedAnnotations(test, result);
    const outcome = classifyOutcome(annotations, result.status);
    if (outcome === 'passed' || outcome === 'skipped') return;

    const source =
      annotations.find((a) => a.type === GAP_ANNOTATION) ??
      annotations.find((a) => a.type === NOT_MEASURED_ANNOTATION);
    const parsed = parseGapMeta(source?.description ?? ' ·  · ');

    this.rows.push({
      outcome,
      title: test.titlePath().slice(1).join(' › '),
      family: test.parent.title || 'unknown',
      tracker: parsed.tracker || '—',
      owner: parsed.owner || '—',
      detail: parsed.detail,
      error: result.error?.message ?? result.status,
    });
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult['status'] }> {
    const path = gapsPath();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderGapsMarkdown(this.rows, this.meta), 'utf8');

    const counts = (o: Outcome) => this.rows.filter((r) => r.outcome === o).length;
    console.log(
      `\npqa-qa: ${counts('regression')} regression(s) · ${counts('tracked-gap')} tracked gap(s) · ` +
        `${counts('closed-gap')} closed gap(s) · ${counts('not-measured')} not measured\n` +
        `gap register written to inventory/gaps.md`,
    );

    // A tracked gap must not fail the daily run, or the run goes red on day
    // one and "suite runs daily" is abandoned within a week. Only an
    // unannotated failure is a real failure.
    if (counts('regression') > 0) return { status: 'failed' };
    return { status: result.status === 'failed' ? 'passed' : result.status };
  }
}

export default GapReporter;
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `cd pqa-qa && npm run qa:unit -- gap-reporter.spec.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Prove the exit-code behaviour end to end**

Create a throwaway spec `pqa-qa/src/isolation/zz-reporter-smoke.spec.ts`:

```ts
import { test } from '@playwright/test';
import { trackedGap } from '../support/annotations.js';

test('a tracked gap fails without failing the run', async ({}, testInfo) => {
  trackedGap(testInfo, { tracker: 'S1-DO-02', owner: 'Bhupendra', detail: 'smoke' });
  throw new Error('expected refusal but got 200');
});
```

Run: `cd pqa-qa && npm run qa:isolation -- zz-reporter-smoke.spec.ts; echo "exit=$?"`
Expected: the test reports as failed in the list output, `inventory/gaps.md` gains a "Tracked gaps" row naming Bhupendra, and **`exit=0`**.

Then change `trackedGap(...)` to a plain `throw` with no annotation and re-run.
Expected: `exit=1`, and the row moves to "Regressions".

Delete `zz-reporter-smoke.spec.ts` once both behaviours are confirmed.

- [ ] **Step 6: Commit**

```bash
git add pqa-qa/src/support/gap-reporter.ts pqa-qa/src/support/gap-reporter.spec.ts pqa-qa/inventory/gaps.md
git commit -m "feat(qa): three-state gap reporter and generated register

Separates regressions from tracked gaps from unmeasured properties,
and writes inventory/gaps.md — the checklist S2-BE-01 works from.

A tracked gap does not fail the run. S1-QA-01's deliverable is
deliberately red, and a suite that exits non-zero from day one stops
being run within a week. Only an unannotated failure fails the build.

The closed-gap state exists so a fix announces itself: an annotated
test that passes means the owner is done and the annotation should go.
Without it the register rots into a list nobody trusts."
```

---

## Task 8: Family 1 — missing identity

**Files:**
- Create: `pqa-qa/src/isolation/f1-missing-identity.spec.ts`

**Interfaces:**
- Consumes: `test`, `expect`, `url` from `fixtures.ts`; `assertRefused` from `assertions.ts`; `routesFor` from `inventory.ts`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the spec**

Every gated demo-path route, called with no session at all. The assertion helper is already proven able to fail (Task 6), so this spec is a loop over the inventory.

```ts
import { request as playwrightRequest } from '@playwright/test';
import { test, expect, url } from '../support/fixtures.js';
import { assertRefused } from '../support/assertions.js';
import { routesFor } from '../support/inventory.js';

test.describe('f1 · missing identity', () => {
  test('every gated demo-path route refuses an unauthenticated caller', async ({
    env, caps, routes,
  }) => {
    const tenant = caps.tenantPair?.primary ?? caps.tenants.find((t) => t.status === 'active')?.slug;
    test.skip(!tenant, 'no active tenant discovered');

    const gated = routesFor(routes, 'missing-identity');
    expect(gated.length, 'inventory declares at least one gated route').toBeGreaterThan(0);

    const anon = await playwrightRequest.newContext({
      extraHTTPHeaders: { 'User-Agent': env.userAgent },
    });
    const failures: string[] = [];

    try {
      for (const route of gated) {
        const target = url(env, route, tenant as string);
        const res = await anon.fetch(target, {
          method: route.method,
          data: route.method === 'GET' ? undefined : {},
          failOnStatusCode: false,
          timeout: 20_000,
        });
        try {
          assertRefused(
            { status: res.status(), body: await res.json().catch(() => null) },
            `${route.method} ${route.path}`,
          );
        } catch (err) {
          failures.push(err instanceof Error ? err.message : String(err));
        }
      }
    } finally {
      await anon.dispose();
    }

    expect(failures, `${failures.length} route(s) served an unauthenticated caller`).toEqual([]);
  });

  test('an expired or forged session cookie is refused', async ({ env, caps }) => {
    const tenant = caps.tenantPair?.primary;
    test.skip(!tenant, 'no active tenant discovered');

    const forged = await playwrightRequest.newContext({
      extraHTTPHeaders: { 'User-Agent': env.userAgent },
      storageState: {
        cookies: [{
          name: 'pqa_session',
          value: 'forged.' + 'a'.repeat(40),
          domain: new URL(env.baseUrl).hostname,
          path: `/${tenant}`,
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
        }],
        origins: [],
      },
    });

    try {
      const res = await forged.get(`${env.baseUrl}/${tenant}/api/dashboard/counts`, {
        failOnStatusCode: false, timeout: 20_000,
      });
      assertRefused(
        { status: res.status(), body: await res.json().catch(() => null) },
        'GET dashboard/counts with a forged pqa_session',
      );
    } finally {
      await forged.dispose();
    }
  });
});
```

Note the accumulate-then-assert shape rather than failing on the first bad route. One failing route must not hide the other eleven — the register needs the whole list on Friday, not the first entry.

- [ ] **Step 2: Run against the environment**

Run: `cd pqa-qa && npm run qa:isolation -- f1-missing-identity.spec.ts`
Expected: either PASS (gates hold), or a failure whose message names every route that served an anonymous caller.

- [ ] **Step 3: Annotate any genuine gap found**

If a route serves anonymous callers, wrap that finding with `trackedGap(testInfo, { tracker: 'S1-BE-01', owner: 'Ankur', detail: '<route> serves unauthenticated callers' })` so it reports as a tracked gap rather than a regression, and the register names the owner.

- [ ] **Step 4: Commit**

```bash
git add pqa-qa/src/isolation/f1-missing-identity.spec.ts
git commit -m "test(qa): family 1 — missing identity

Every gated demo-path route called with no session, plus a forged
cookie. Failures accumulate rather than short-circuit: one bad route
must not hide the rest, because the register needs the whole list."
```

---

## Task 9: Family 2 — wrong tenant

The family most likely to find something, and the one carrying the specific hypothesis from the spec's §7.2.

**Files:**
- Create: `pqa-qa/src/isolation/f2-wrong-tenant.spec.ts`

**Interfaces:**
- Consumes: `test`, `expect`, `url`; `assertRefused`, `assertNoForeignContent`; `trackedGap`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the spec**

```ts
import { test, expect, url } from '../support/fixtures.js';
import { assertRefused, assertNoForeignContent } from '../support/assertions.js';
import { trackedGap } from '../support/annotations.js';
import { routesFor } from '../support/inventory.js';

test.describe('f2 · wrong tenant', () => {
  test('a forged x-tenant-slug header does not override the URL segment', async ({
    env, caps, tenantPair, as,
  }) => {
    test.skip(!tenantPair, 'needs two active tenants');
    const { primary, secondary } = tenantPair!;
    const secondaryName = caps.tenants.find((t) => t.slug === secondary)?.tenantName ?? secondary;

    const ctx = await as('platform-admin');
    const res = await ctx.get(`${env.baseUrl}/${primary}/api/tenant-config`, {
      headers: { 'x-tenant-slug': secondary },
      failOnStatusCode: false,
      timeout: 20_000,
    });

    const body = await res.json().catch(() => null);
    assertNoForeignContent(
      { status: res.status(), body },
      [secondaryName],
      `GET /${primary}/api/tenant-config with forged x-tenant-slug: ${secondary}`,
    );
  });

  test('an asset-suffixed path does not evade the proxy matcher', async ({
    env, tenantPair, as,
  }, testInfo) => {
    test.skip(!tenantPair, 'needs two active tenants');
    const { primary, secondary } = tenantPair!;

    // proxy.ts's matcher excludes paths ending .svg/.png/.jpg/.jpeg/.gif/.webp/.ico.
    // A dynamic segment that looks like an asset skips tenant promotion entirely,
    // and upstream.ts then trusts an inbound x-tenant-slug. If this request is
    // served rather than refused, that is a cross-tenant read from a browser.
    const ctx = await as('platform-admin');
    const res = await ctx.get(`${env.baseUrl}/${primary}/api/parliament/questions/1.png`, {
      headers: { 'x-tenant-slug': secondary },
      failOnStatusCode: false,
      timeout: 20_000,
    });

    const body = await res.json().catch(() => null);
    if (res.status() >= 200 && res.status() < 300) {
      trackedGap(testInfo, {
        tracker: 'S1-BE-01',
        owner: 'Ankur',
        detail: 'asset-suffixed path evades proxy.ts matcher; forged x-tenant-slug honoured',
      });
    }
    assertRefused(
      { status: res.status(), body },
      `GET /${primary}/api/parliament/questions/1.png with forged x-tenant-slug: ${secondary}`,
    );
  });

  test('an unknown slug is an explicit not-found, never another tenant', async ({
    env, caps,
  }) => {
    const known = caps.tenants.filter((t) => t.status === 'active').map((t) => t.tenantName ?? '');
    const res = await (await import('@playwright/test')).request
      .newContext({ extraHTTPHeaders: { 'User-Agent': env.userAgent } })
      .then(async (ctx) => {
        const r = await ctx.get(`${env.baseUrl}/this-slug-does-not-exist/api/tenant-config`, {
          failOnStatusCode: false, timeout: 20_000,
        });
        const out = { status: r.status(), body: await r.json().catch(() => null) };
        await ctx.dispose();
        return out;
      });

    expect(res.status, 'unknown slug must 404').toBe(404);
    assertNoForeignContent(res, known.filter(Boolean), 'GET /this-slug-does-not-exist/api/tenant-config');
  });

  test('a session for one tenant cannot read another tenant\'s scoped routes', async ({
    env, tenantPair, routes, as,
  }) => {
    test.skip(!tenantPair, 'needs two active tenants');
    const { primary, secondary } = tenantPair!;

    const ctx = await as('platform-admin');
    const scoped = routesFor(routes, 'wrong-tenant').filter((r) => r.method === 'GET');
    const failures: string[] = [];

    for (const route of scoped) {
      const res = await ctx.get(url(env, route, secondary), {
        failOnStatusCode: false, timeout: 20_000,
      });
      // The session was issued at /<primary>; its cookie is path-scoped there,
      // so it must not authenticate at /<secondary>.
      try {
        assertRefused(
          { status: res.status(), body: await res.json().catch(() => null) },
          `${route.method} ${route.path} at /${secondary} using a /${primary} session`,
        );
      } catch (err) {
        failures.push(err instanceof Error ? err.message : String(err));
      }
    }

    expect(failures, `${failures.length} cross-tenant read(s) succeeded`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `cd pqa-qa && npm run qa:isolation -- f2-wrong-tenant.spec.ts`
Expected: the forged-header and unknown-slug tests pass; the matcher-evasion result is the one to read carefully.

- [ ] **Step 3: Record the matcher-evasion outcome in the spec document**

Whichever way it goes, update `docs/superpowers/specs/2026-09-21-pqa-qa-design.md` §7.2, replacing "Hypothesis to be proven or disproven by test" with the result and the date. A hypothesis left open in a design document after it has been answered is how stale specs start.

- [ ] **Step 4: Commit**

```bash
git add pqa-qa/src/isolation/f2-wrong-tenant.spec.ts docs/superpowers/specs/2026-09-21-pqa-qa-design.md
git commit -m "test(qa): family 2 — wrong tenant, including matcher evasion

proxy.ts sets rather than appends x-tenant-slug, so a forged header
loses to the URL segment. But its matcher excludes asset extensions,
and upstream.ts trusts an inbound x-tenant-slug when the proxy has not
run. A dynamic segment ending .png therefore tests whether the two
combine into a cross-tenant read reachable from a browser.

Spec §7.2 updated with the answer."
```

---

## Task 10: Families 3 and 6 — wrong department, session replay

**Files:**
- Create: `pqa-qa/src/isolation/f3-wrong-department.spec.ts`
- Create: `pqa-qa/src/isolation/f6-session-replay.spec.ts`

**Interfaces:**
- Consumes: `test`, `expect`, `url`, `as`; `assertRefused`; `notMeasured`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the wrong-department spec**

This is S1-BE-01's exit criterion — *"no client-supplied tenant/department accepted anywhere on the demo path"* — expressed as tests.

```ts
import { test, expect, url } from '../support/fixtures.js';
import { notMeasured } from '../support/annotations.js';
import { routesFor } from '../support/inventory.js';

test.describe('f3 · wrong department', () => {
  test('a division member cannot read another division\'s question', async ({
    env, caps, routes, as,
  }, testInfo) => {
    if (!caps.personas['division-member']?.available) {
      notMeasured(testInfo, {
        tracker: 'S1-QA-01',
        owner: 'Akhilesh',
        detail: 'no division-member persona seeded — a wrong-department attack needs a wrong department',
      });
      return;
    }
    if (!caps.personas['parliament-admin']?.available) {
      notMeasured(testInfo, {
        tracker: 'S1-QA-01',
        owner: 'Akhilesh',
        detail: 'need a parliament persona as the reference reader to establish which ids exist',
      });
      return;
    }

    const tenant = caps.tenantPair?.primary as string;
    const member = await as('division-member');
    const reference = await as('parliament-admin');
    const scoped = routesFor(routes, 'wrong-department')
      .filter((r) => r.method === 'GET' && r.path.includes('{id}'));

    // Ids are discovered, never created. The parliament persona establishes
    // which ids resolve at all; the division member must then be refused at
    // least one of them. Without that reference read, a 404 for the member is
    // ambiguous between "denied" and "no such record" — and treating the
    // second as evidence of isolation is exactly the mistake this suite exists
    // to prevent.
    const leaks: string[] = [];
    let comparisons = 0;

    for (const route of scoped) {
      for (const id of ['1', '2', '3', '4', '5']) {
        const refRes = await reference.get(url(env, route, tenant, id), {
          failOnStatusCode: false, timeout: 20_000,
        });
        if (refRes.status() < 200 || refRes.status() >= 300) continue;

        comparisons += 1;
        const memberRes = await member.get(url(env, route, tenant, id), {
          failOnStatusCode: false, timeout: 20_000,
        });
        if (memberRes.status() >= 200 && memberRes.status() < 300) {
          const body = await memberRes.text().catch(() => '');
          leaks.push(`${route.method} ${route.path} id=${id} → ${memberRes.status()} for division-member: ${body.slice(0, 200)}`);
        }
      }
    }

    if (comparisons === 0) {
      notMeasured(testInfo, {
        tracker: 'S1-QA-01',
        owner: 'Akhilesh',
        detail: 'no department-scoped record resolved for the reference persona — nothing to compare against',
      });
      return;
    }

    testInfo.attach('comparisons', {
      body: `${comparisons} record(s) compared; ${leaks.length} readable by division-member`,
      contentType: 'text/plain',
    });
    expect(
      leaks,
      `division-member read ${leaks.length} of ${comparisons} record(s) visible to the parliament persona`,
    ).toEqual([]);
  });

  test('a client-supplied callerEmail does not override the session identity', async ({
    env, caps, as,
  }, testInfo) => {
    if (!caps.personas['division-member']?.available) {
      notMeasured(testInfo, {
        tracker: 'S1-BE-01',
        owner: 'Ankur',
        detail: 'no second persona to impersonate from',
      });
      return;
    }
    const tenant = caps.tenantPair?.primary as string;
    const victim = env.personaEmails['platform-admin'] as string;
    const ctx = await as('division-member');

    const res = await ctx.get(`${env.baseUrl}/${tenant}/api/profile/me?callerEmail=${encodeURIComponent(victim)}`, {
      headers: { callerEmail: victim, 'x-caller-email': victim },
      failOnStatusCode: false,
      timeout: 20_000,
    });

    const body = await res.json().catch(() => null);
    const text = JSON.stringify(body ?? {});
    expect(
      text.includes(victim),
      `profile/me echoed the client-supplied callerEmail ${victim} — server-derived identity was overridden`,
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Write the session-replay spec**

```ts
import { request as playwrightRequest } from '@playwright/test';
import { test, expect } from '../support/fixtures.js';
import { assertRefused } from '../support/assertions.js';
import { storageStatePath } from '../support/personas.js';

test.describe('f6 · cross-tenant session replay', () => {
  test('a session cookie issued at one tenant does not authenticate at another', async ({
    env, tenantPair,
  }) => {
    test.skip(!tenantPair, 'needs two active tenants');
    const { primary, secondary } = tenantPair!;

    const ctx = await playwrightRequest.newContext({
      storageState: storageStatePath('platform-admin'),
      extraHTTPHeaders: { 'User-Agent': env.userAgent },
    });
    try {
      const res = await ctx.get(`${env.baseUrl}/${secondary}/api/auth/session`, {
        failOnStatusCode: false, timeout: 20_000,
      });
      assertRefused(
        { status: res.status(), body: await res.json().catch(() => null) },
        `GET /${secondary}/api/auth/session replaying a /${primary} session`,
      );
    } finally {
      await ctx.dispose();
    }
  });

  test('the session cookie is path-scoped to its tenant, never to the origin root', async ({
    env, tenantPair,
  }) => {
    test.skip(!tenantPair, 'needs two active tenants');
    const { primary } = tenantPair!;

    const ctx = await playwrightRequest.newContext({
      storageState: storageStatePath('platform-admin'),
      extraHTTPHeaders: { 'User-Agent': env.userAgent },
    });
    const state = await ctx.storageState();
    await ctx.dispose();

    const session = state.cookies.filter((c) => c.name === 'pqa_session');
    expect(session.length, 'a pqa_session cookie was issued').toBeGreaterThan(0);

    for (const cookie of session) {
      expect(
        cookie.path,
        `pqa_session path is "${cookie.path}" — a root-scoped cookie is sent to every ` +
          `other ministry on this origin, which is a cross-tenant identity leak`,
      ).toBe(`/${primary}`);
    }
  });
});
```

- [ ] **Step 3: Run both**

Run: `cd pqa-qa && npm run qa:isolation -- f3-wrong-department.spec.ts f6-session-replay.spec.ts`
Expected: f6 passes if the cookie scoping holds; f3 either reports *not measured* (no second persona) or attaches the 2xx responses for triage.

- [ ] **Step 4: Commit**

```bash
git add pqa-qa/src/isolation/f3-wrong-department.spec.ts pqa-qa/src/isolation/f6-session-replay.spec.ts
git commit -m "test(qa): families 3 and 6 — wrong department, session replay

f3 states S1-BE-01's exit criterion as a test: a client-supplied
callerEmail must not override server-derived identity. With only the
platform seed admin available it reports not-measured rather than
faking coverage — a wrong-department attack needs a wrong department.

f6 asserts pqa_session stays path-scoped to /<slug>. All tenants share
one origin, so a root-scoped cookie would be sent to every other
ministry."
```

---

## Task 11: Families 7 and 8 — service surface, identity RLS

**Files:**
- Create: `pqa-qa/src/isolation/f7-service-surface.spec.ts`
- Create: `pqa-qa/src/isolation/f8-identity-rls.spec.ts`
- Create: `pqa-qa/src/support/clients/postgres.ts`

**Interfaces:**
- Consumes: `test`, `expect`, `as`; `assertRefused`; `notMeasured`.
- Produces: `openPostgres(dsn): Promise<PgLike | null>`, type `PgLike` (`{ query(sql, params?): Promise<{ rows: unknown[] }>; end(): Promise<void> }`).

Family 7 needs **no valid credential** — it probes absent and wrong keys only, which is both the safest and the most informative version of the test. These endpoints create schemas and seed administrators; they are the highest-privilege surface on the platform and nothing currently covers them.

- [ ] **Step 1: Write the service-surface spec**

```ts
import { request as playwrightRequest } from '@playwright/test';
import { test, expect } from '../support/fixtures.js';
import { assertRefused } from '../support/assertions.js';

const SERVICE_ROUTES = [
  { method: 'POST' as const, path: '/internal/tenants/provision' },
  { method: 'POST' as const, path: '/internal/tenants/migrate-all' },
];

test.describe('f7 · service-to-service surface', () => {
  test('internal endpoints refuse an absent api key', async ({ env, caps }) => {
    const tenant = caps.tenantPair?.primary;
    test.skip(!tenant, 'no active tenant discovered');

    const ctx = await playwrightRequest.newContext({
      extraHTTPHeaders: { 'User-Agent': env.userAgent },
    });
    const failures: string[] = [];

    try {
      for (const route of SERVICE_ROUTES) {
        // Non-destructive: the body is deliberately invalid AND the key is
        // absent, so a correctly-guarded endpoint rejects on auth before it
        // ever reaches provisioning. A 2xx here would mean it provisioned.
        const res = await ctx.fetch(`${env.baseUrl}/${tenant}${route.path}`, {
          method: route.method,
          data: {},
          failOnStatusCode: false,
          timeout: 20_000,
        });
        try {
          assertRefused(
            { status: res.status(), body: await res.json().catch(() => null) },
            `${route.method} ${route.path} with no x-api-key`,
          );
        } catch (err) {
          failures.push(err instanceof Error ? err.message : String(err));
        }
      }
    } finally {
      await ctx.dispose();
    }

    expect(failures, 'an internal provisioning endpoint accepted an unauthenticated call').toEqual([]);
  });

  test('internal endpoints refuse a wrong api key', async ({ env, caps }) => {
    const tenant = caps.tenantPair?.primary;
    test.skip(!tenant, 'no active tenant discovered');

    const ctx = await playwrightRequest.newContext({
      extraHTTPHeaders: { 'User-Agent': env.userAgent, 'x-api-key': 'not-a-real-key' },
    });
    try {
      const res = await ctx.post(`${env.baseUrl}/${tenant}/internal/tenants/provision`, {
        data: {}, failOnStatusCode: false, timeout: 20_000,
      });
      assertRefused(
        { status: res.status(), body: await res.json().catch(() => null) },
        'POST /internal/tenants/provision with a wrong x-api-key',
      );
    } finally {
      await ctx.dispose();
    }
  });

  test('a browser session cannot reach an internal endpoint', async ({ env, caps, as }) => {
    const tenant = caps.tenantPair?.primary;
    test.skip(!tenant, 'no active tenant discovered');

    const ctx = await as('platform-admin');
    const res = await ctx.post(`${env.baseUrl}/${tenant}/internal/tenants/provision`, {
      data: {}, failOnStatusCode: false, timeout: 20_000,
    });
    assertRefused(
      { status: res.status(), body: await res.json().catch(() => null) },
      'POST /internal/tenants/provision with a portal session instead of a service key',
    );
  });
});
```

- [ ] **Step 2: Implement the optional Postgres client**

`pqa-qa/src/support/clients/postgres.ts`:

```ts
export interface PgLike {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
}

/** Returns null when no DSN is configured or `pg` is not installed. */
export async function openPostgres(dsn: string | undefined): Promise<PgLike | null> {
  if (!dsn) return null;
  try {
    const pg = await import('pg');
    const client = new pg.default.Client({ connectionString: dsn });
    await client.connect();
    return {
      query: (sql, params) => client.query(sql, params) as Promise<{ rows: unknown[] }>,
      end: () => client.end(),
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 3: Write the identity-RLS spec**

```ts
import { test, expect } from '../support/fixtures.js';
import { notMeasured } from '../support/annotations.js';
import { openPostgres } from '../support/clients/postgres.js';

const RLS_TABLES = [
  'identity_users', 'identity_roles', 'identity_sessions',
  'identity_role_permissions', 'identity_user_roles',
];

test.describe('f8 · identity-service row-level security', () => {
  test('RLS tables are enabled and the app role does not bypass them', async ({
    env,
  }, testInfo) => {
    const pg = await openPostgres(env.postgresDsn);
    if (!pg) {
      notMeasured(testInfo, {
        tracker: 'S1-DO-02',
        owner: 'Bhupendra',
        detail: 'no PQA_POSTGRES_DSN — RLS enforcement is unverified, which is not the same as safe',
      });
      return;
    }

    try {
      const rls = await pg.query(
        `SELECT relname, relrowsecurity, relforcerowsecurity
           FROM pg_class WHERE relname = ANY($1::text[])`,
        [RLS_TABLES],
      );
      const rows = rls.rows as Array<{ relname: string; relrowsecurity: boolean }>;
      const unprotected = rows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
      expect(unprotected, 'these identity tables do not have row-level security enabled').toEqual([]);

      const roles = await pg.query(
        `SELECT rolname, rolbypassrls FROM pg_roles WHERE rolbypassrls = true`,
      );
      const bypass = (roles.rows as Array<{ rolname: string }>).map((r) => r.rolname);
      expect(
        bypass.filter((r) => !r.startsWith('rds_') && r !== 'postgres'),
        'a non-superuser role holds BYPASSRLS; identity_backchannel_role exists so ' +
          'the one legitimate cross-tenant action does not require weakening RLS globally',
      ).toEqual([]);
    } finally {
      await pg.end();
    }
  });

  test('an out-of-scope user listing is a refusal, not an authoritative empty list', async ({
    env, caps, tenantPair, as,
  }) => {
    test.skip(!tenantPair, 'needs two active tenants');
    const { primary, secondary } = tenantPair!;

    const ctx = await as('platform-admin');
    const res = await ctx.get(`${env.baseUrl}/${secondary}/api/rbac/users`, {
      failOnStatusCode: false, timeout: 20_000,
    });
    const body = (await res.json().catch(() => null)) as { data?: unknown[] } | null;

    // The failure this guards against: RLS defaults closed and returns zero
    // rows, the API wraps that in a 200, and the UI shows "no users" for a
    // tenant that has users. Silence read as data.
    if (res.status() >= 200 && res.status() < 300) {
      expect(
        Array.isArray(body?.data) && body!.data!.length === 0,
        `GET /${secondary}/api/rbac/users returned 200 with an empty list to a ` +
          `/${primary} session. An empty result from a closed RLS policy must not ` +
          `be presented as authoritative "no users".`,
      ).toBe(false);
    }
  });
});
```

- [ ] **Step 4: Run both**

Run: `cd pqa-qa && npm run qa:isolation -- f7-service-surface.spec.ts f8-identity-rls.spec.ts`
Expected: f7 passes if the guards hold; f8's first test reports *not measured* without a DSN, and its second runs regardless.

- [ ] **Step 5: Commit**

```bash
git add pqa-qa/src/isolation/f7-service-surface.spec.ts pqa-qa/src/isolation/f8-identity-rls.spec.ts pqa-qa/src/support/clients/postgres.ts
git commit -m "test(qa): families 7 and 8 — service surface, identity RLS

f7 needs no valid key: absent and wrong keys are both the safest probe
and the informative one. These endpoints create schemas and seed
administrators, and nothing covered them before.

f8's database half reports not-measured without a DSN. Its HTTP half
runs regardless and targets the specific failure RLS makes easy: zero
rows wrapped in a 200 and presented as authoritative 'no users' for a
tenant that has users. Silence read as data."
```

---

## Task 12: Families 4, 5 and 9 — infrastructure and egress

**Files:**
- Create: `pqa-qa/src/isolation/f4-s3-prefix-escape.spec.ts`
- Create: `pqa-qa/src/isolation/f5-wrong-index.spec.ts`
- Create: `pqa-qa/src/isolation/f9-egress-residency.spec.ts`
- Create: `pqa-qa/src/support/clients/s3.ts`
- Create: `pqa-qa/src/support/clients/opensearch.ts`

**Interfaces:**
- Consumes: `test`, `expect`, `as`; `notMeasured`, `trackedGap`.
- Produces: `openS3(creds): Promise<S3Like | null>`, `openOpenSearch(creds): Promise<OsLike | null>`.

- [ ] **Step 1: Implement the two optional clients**

`pqa-qa/src/support/clients/s3.ts`:

```ts
import type { S3Creds } from '../env.js';

export interface S3Like {
  listUnder(prefix: string): Promise<string[]>;
}

export async function openS3(creds: S3Creds | undefined): Promise<S3Like | null> {
  if (!creds) return null;
  try {
    const { S3Client, ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    const client = new S3Client({
      region: creds.region,
      credentials: { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey },
    });
    return {
      listUnder: async (prefix) => {
        const out = await client.send(
          new ListObjectsV2Command({ Bucket: creds.bucket, Prefix: prefix, MaxKeys: 25 }),
        );
        return (out.Contents ?? []).map((o) => o.Key ?? '');
      },
    };
  } catch {
    return null;
  }
}
```

`pqa-qa/src/support/clients/opensearch.ts`:

```ts
import type { OpenSearchCreds } from '../env.js';

export interface OsLike {
  listIndices(): Promise<string[]>;
  search(index: string): Promise<{ status: number; hits: number }>;
}

export async function openOpenSearch(creds: OpenSearchCreds | undefined): Promise<OsLike | null> {
  if (!creds) return null;
  try {
    const { Client } = await import('@opensearch-project/opensearch');
    const client = new Client({
      node: creds.endpoint,
      auth: { username: creds.username, password: creds.password },
    });
    return {
      listIndices: async () => {
        const res = await client.cat.indices({ format: 'json' });
        return ((res.body as Array<{ index?: string }>) ?? []).map((i) => i.index ?? '');
      },
      search: async (index) => {
        const res = await client.search({ index, body: { size: 1, query: { match_all: {} } } });
        const total = (res.body as { hits?: { total?: { value?: number } } })?.hits?.total?.value ?? 0;
        return { status: res.statusCode ?? 200, hits: total };
      },
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Write the S3 spec**

```ts
import { test, expect } from '../support/fixtures.js';
import { notMeasured, trackedGap } from '../support/annotations.js';
import { openS3 } from '../support/clients/s3.js';

test.describe('f4 · S3 prefix escape', () => {
  test('a tenant-scoped credential cannot list outside its own prefix', async ({
    env,
  }, testInfo) => {
    const s3 = await openS3(env.s3);
    if (!s3) {
      notMeasured(testInfo, {
        tracker: 'S1-DO-02',
        owner: 'Bhupendra',
        detail: 'no PQA_S3_* credential — prefix escape is unverified; S1-DO-02 requires it fail closed',
      });
      return;
    }

    // Read-only: list, never write. CLAUDE.md §1.1 records that S3 is still
    // single-tenant in Phase 0, so this is expected to fail until S1-DO-02.
    const own = env.s3!.tenantPrefix;
    const keys = await s3.listUnder('');
    const foreign = keys.filter((k) => k && !k.startsWith(own));

    if (foreign.length > 0) {
      trackedGap(testInfo, {
        tracker: 'S1-DO-02',
        owner: 'Bhupendra',
        detail: `credential scoped to "${own}" listed ${foreign.length} object(s) outside it`,
      });
    }
    expect(
      foreign.slice(0, 10),
      `the tenant credential listed objects outside "${own}" — the IAM boundary does not hold`,
    ).toEqual([]);
  });
});
```

- [ ] **Step 3: Write the OpenSearch spec**

```ts
import { test, expect } from '../support/fixtures.js';
import { notMeasured, trackedGap } from '../support/annotations.js';
import { openOpenSearch } from '../support/clients/opensearch.js';

test.describe('f5 · wrong index', () => {
  test('a tenant-scoped credential cannot enumerate or read another tenant\'s index', async ({
    env,
  }, testInfo) => {
    const os = await openOpenSearch(env.openSearch);
    if (!os) {
      notMeasured(testInfo, {
        tracker: 'S1-DO-02',
        owner: 'Bhupendra',
        detail: 'no PQA_OPENSEARCH_* credential — index scoping is unverified',
      });
      return;
    }

    const own = env.openSearch!.tenantIndex;
    const indices = (await os.listIndices()).filter((i) => i && !i.startsWith('.'));
    const foreign = indices.filter((i) => i !== own);

    if (foreign.length > 0) {
      trackedGap(testInfo, {
        tracker: 'S1-DO-02',
        owner: 'Bhupendra',
        detail: `credential scoped to "${own}" enumerated ${foreign.length} other index/indices`,
      });
    }
    expect(
      foreign.slice(0, 10),
      `the tenant credential enumerated indices other than "${own}" — role scoping does not hold`,
    ).toEqual([]);
  });
});
```

- [ ] **Step 4: Write the egress and residency spec**

```ts
import { test, expect } from '../support/fixtures.js';
import { trackedGap } from '../support/annotations.js';

test.describe('f9 · egress and residency', () => {
  test('the tenant config declares a model provider and region', async ({
    env, caps, as,
  }, testInfo) => {
    const tenant = caps.tenantPair?.primary as string;
    test.skip(!tenant, 'no active tenant discovered');

    const ctx = await as('platform-admin');
    const res = await ctx.get(`${env.baseUrl}/${tenant}/api/tenant-config`, {
      failOnStatusCode: false, timeout: 20_000,
    });
    const body = (await res.json().catch(() => null)) as {
      data?: { tenant?: { assistant?: { llm?: { provider?: string; region?: string; baseUrl?: string } } } };
    } | null;
    const llm = body?.data?.tenant?.assistant?.llm;

    expect(llm, 'tenant config exposes an llm block').toBeTruthy();
    testInfo.attach('declared-llm', {
      body: JSON.stringify(llm, null, 2),
      contentType: 'application/json',
    });

    // Residency: either an India-region managed endpoint, or a self-hosted base URL.
    const region = llm?.region ?? '';
    const isIndiaRegion = region.startsWith('ap-south-');
    const isSelfHosted = llm?.provider === 'ollama' && !!llm?.baseUrl;
    expect(
      isIndiaRegion || isSelfHosted,
      `declared model config is neither an ap-south-* region nor a self-hosted base URL: ${JSON.stringify(llm)}`,
    ).toBe(true);
  });

  test('a generation response reports which provider actually served it', async ({
    env, caps, as,
  }, testInfo) => {
    const tenant = caps.tenantPair?.primary as string;
    test.skip(!tenant, 'no active tenant discovered');

    const ctx = await as('platform-admin');
    // A minimal, read-only generate call. If the deployment rejects it, that is
    // recorded rather than treated as a residency failure.
    const res = await ctx.post(`${env.baseUrl}/${tenant}/api/assistant/generate`, {
      data: { query: 'residency probe', filters: {} },
      failOnStatusCode: false,
      timeout: 60_000,
    });
    const text = await res.text().catch(() => '');
    testInfo.attach('generate-response-head', {
      body: text.slice(0, 2000),
      contentType: 'text/plain',
    });

    const declaresResidency = /"(model_version|modelId|provider|region|residency)"/.test(text);
    if (!declaresResidency) {
      trackedGap(testInfo, {
        tracker: 'S3-AI-01',
        owner: 'Mohit',
        detail: 'generation response records no provider, model or residency metadata',
      });
    }
    expect(
      declaresResidency,
      'S3-AI-01 requires residency recorded on every call; the response carries none',
    ).toBe(true);
  });

  test('the configured provider is the provider that serves generation', async ({
    env, caps, as,
  }, testInfo) => {
    const tenant = caps.tenantPair?.primary as string;
    test.skip(!tenant, 'no active tenant discovered');

    const ctx = await as('platform-admin');
    const cfg = await ctx.get(`${env.baseUrl}/${tenant}/api/tenant-config`, {
      failOnStatusCode: false, timeout: 20_000,
    });
    const declared = ((await cfg.json().catch(() => null)) as {
      data?: { tenant?: { assistant?: { llm?: { provider?: string } } } };
    } | null)?.data?.tenant?.assistant?.llm?.provider;

    const gen = await ctx.post(`${env.baseUrl}/${tenant}/api/assistant/generate`, {
      data: { query: 'provider probe', filters: {} },
      failOnStatusCode: false,
      timeout: 60_000,
    });
    const text = (await gen.text().catch(() => '')).toLowerCase();

    // rag-service constructs ChatBedrockConverse directly and has no provider
    // switch, so a tenant configured for ollama is still served by Bedrock.
    const servedByBedrock = /bedrock|anthropic\.claude|converse/.test(text);
    if (declared === 'ollama' && servedByBedrock) {
      trackedGap(testInfo, {
        tracker: 'S3-AI-01',
        owner: 'Mohit',
        detail: 'tenant declares provider "ollama" but generation is served by Bedrock',
      });
    }
    expect(
      declared === 'ollama' && servedByBedrock,
      'configured provider and serving provider diverge — the sovereignty claim does not hold',
    ).toBe(false);
  });
});
```

- [ ] **Step 5: Run all three**

Run: `cd pqa-qa && npm run qa:isolation -- f4-s3-prefix-escape.spec.ts f5-wrong-index.spec.ts f9-egress-residency.spec.ts`
Expected: f4 and f5 report *not measured*; f9 produces at least one tracked gap for missing residency metadata.

- [ ] **Step 6: Commit**

```bash
git add pqa-qa/src/isolation/f4-s3-prefix-escape.spec.ts pqa-qa/src/isolation/f5-wrong-index.spec.ts \
        pqa-qa/src/isolation/f9-egress-residency.spec.ts pqa-qa/src/support/clients/
git commit -m "test(qa): families 4, 5 and 9 — infrastructure and egress

f4 and f5 are written and skipped with reason: no S3 or OpenSearch
credential. They light up the day one arrives. Reported as not
measured, never as passing — S1-DO-02's criterion is that these fail
closed, and nothing currently demonstrates that.

f9 turns the sovereignty claim into assertions. rag-service builds
ChatBedrockConverse directly with no provider switch, so a tenant
configured for ollama is still served by Bedrock; the probe compares
declared provider against serving provider and records the divergence
against S3-AI-01."
```

---

## Task 13: Handover — README, CI, and the first committed register

**Files:**
- Create: `pqa-qa/README.md`
- Create: `pqa-qa/.gitlab-ci.yml`
- Modify: `pqa-qa/inventory/gaps.md` (commit a real run's output)

**Interfaces:**
- Consumes: everything.
- Produces: the S1-QA-01 deliverable.

- [ ] **Step 1: Write the README**

```markdown
# pqa-qa — isolation acceptance suite

Non-destructive isolation, authorization and residency tests for the PQA
platform. Nothing here creates, modifies or deletes data on the target.

**Deliverable for S1-QA-01.** The suite is expected to be partly red: every
unverified isolation property is a named failing or explicitly-unmeasured
test. See `inventory/gaps.md`.

## Run it

    cd pqa-qa
    cp .env.example .env     # fill in PQA_BASE_URL and PLATFORM_SEED_EMAIL
    npm install
    npx playwright install --with-deps chromium
    npm run qa:isolation

`npm run qa` runs the unit tests for the support layer as well.

## Prerequisites

| Needed | Without it |
|---|---|
| `PQA_BASE_URL` | The run aborts immediately. There is no default. |
| `PLATFORM_SEED_EMAIL` | No persona authenticates; everything skips. |
| Mock OTP enabled on the target | No persona authenticates. |
| Two active tenants | Families 2, 6 and 9 report not measured. |
| A second, lower-privileged persona | Families 3 and 8 report not measured. |
| `PQA_S3_*`, `PQA_OPENSEARCH_*`, `PQA_POSTGRES_DSN` | Families 4, 5 and the database half of 8 report not measured. Ask Bhupendra (S1-DO-02). |

## Reading `inventory/gaps.md`

Four sections, and the distinction between them is the point.

- **Regressions** — unannotated failures. Something broke. The run exits
  non-zero only for these.
- **Tracked gaps** — known, owned, expected to fail. This is the S2-BE-01
  checklist. They do not fail the run.
- **Closed gaps** — an annotated test that now passes. The owner fixed it;
  remove the annotation so the register stays honest.
- **Not measured** — no credential, no persona. Neither passing nor failing.
  An unmeasured boundary is not a safe boundary.

## Adding a probe

1. Add the route to `inventory/demo-path.routes.yaml` with its `data_class`
   and the attack families that apply.
2. Add the assertion to the matching `src/isolation/f*.spec.ts`.
3. If it is a known gap, call `trackedGap(testInfo, { tracker, owner, detail })`.
4. Run it and confirm it can actually fail before trusting it.

## What this suite does not do

Browser journeys, API contract tests and LLM output quality. The first two
are the S2-QA-01 plan; quality lives in `pqa-eval/`.
```

- [ ] **Step 2: Write the CI job**

```yaml
# Adopt from pqa-builder's pipeline when one exists (S3-DO-01).
stages: [qa]

isolation:
  stage: qa
  image: mcr.microsoft.com/playwright:v1.49.0-jammy
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
    - if: $CI_PIPELINE_SOURCE == "web"
  variables:
    PQA_RUN_ID: $CI_PIPELINE_ID
  script:
    - cd pqa-qa
    - npm ci
    - npm run qa:isolation
  artifacts:
    when: always
    paths:
      - pqa-qa/inventory/gaps.md
      - pqa-qa/playwright-report/
    reports:
      junit: pqa-qa/playwright-report/junit.xml
    expire_in: 30 days
```

`PQA_BASE_URL`, `PLATFORM_SEED_EMAIL` and the optional credentials are set as masked CI variables, never in this file.

- [ ] **Step 3: Full run and commit the register**

Run: `cd pqa-qa && npm run qa; echo "exit=$?"`
Expected: `exit=0` if there are no regressions, with `inventory/gaps.md` listing tracked gaps and not-measured rows.

- [ ] **Step 4: Verify no secret is staged**

Run: `git status --short pqa-qa/ && git diff --cached --name-only | grep -E '\.env$' && echo "SECRET STAGED — STOP" || echo "clean"`
Expected: `clean`.

- [ ] **Step 5: Commit**

```bash
git add pqa-qa/README.md pqa-qa/.gitlab-ci.yml pqa-qa/inventory/gaps.md
git commit -m "feat(qa): handover — README, scheduled CI job, first gap register

S1-QA-01 is owned by Akhilesh with Bhupendra and Ankur supporting, and
its exit criterion is that the suite runs daily. It therefore has to be
runnable by someone who did not build it: one command, prerequisites
stated plainly, and a table saying what each missing credential costs.

The README explains the four sections of gaps.md, because the
difference between a tracked gap and a not-measured row is the
difference between work someone owns and a boundary nobody has
checked."
```

---

## Self-review

Run after the plan is written; fix inline.

**Spec coverage.** Every section of `2026-09-21-pqa-qa-design.md` maps to a task: §5.1 layout → Task 1; §5.2 fixtures → Tasks 3, 5; §5.3 probe → Task 4; §6 inventory → Task 2; §7.1–§7.9 → Tasks 8–12; §10 reporter → Tasks 6, 7; §11 handover → Task 13; §12 schedule → the task order. §8 (API contract) and §9 (browser journeys) are deliberately **not** in this plan — they are the S2-QA-01 plan, per the scope check.

**Placeholder scan.** No "TBD", no "similar to Task N", no "add error handling". Three defects were found in the first draft and fixed inline rather than left as notes:

1. **Task 5** originally presented the persona loop with a shared request context and a follow-up step to correct it. Writing knowingly-broken code for an executor to fix is a plan failure — the loop now creates and disposes a fresh context per persona the first time it appears.
2. **Task 7's `onBegin`** used `require()` inside an ESM module, which throws at runtime. It is now a static import with the `try`/`catch` kept around the call, because `capabilities.json` legitimately does not exist when global setup aborted.
3. **Task 10's f3** ended in `expect(true).toBe(true)` — evidence-gathering dressed as a test. It now reads records with a reference persona first and asserts that the division member is refused at least one id the reference can read. Without that comparison a 404 is ambiguous between "denied" and "no such record", and treating the second as evidence of isolation is the exact mistake this suite exists to prevent.

**Type consistency.** `ProbeResult`, `Capabilities`, `TenantProbe`, `TenantPair`, `RouteEntry`, `GapMeta`, `HttpObservation`, `Outcome`, `GapRow`, `PersonaName`, `S3Creds`, `OpenSearchCreds`, `PgLike`, `S3Like`, `OsLike` are each defined once and imported thereafter. `storageStatePath`, `classifyLogin`, `classifyTenantResponse`, `classifyOutcome`, `credentialProbe`, `mockAuthProbe`, `assertRefused`, `assertNoForeignContent`, `trackedGap`, `notMeasured`, `parseGapMeta`, `renderGapsMarkdown`, `loadInventory`, `routesFor`, `url` keep the same names across every task that uses them.
