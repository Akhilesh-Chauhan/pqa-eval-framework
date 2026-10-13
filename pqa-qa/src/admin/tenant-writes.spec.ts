import { createHash } from 'node:crypto';
import type { Page, Response, TestInfo } from '@playwright/test';
import { test, expect, requireWrites, blockWrites } from './fixtures.js';
import { loadAdminEnv } from './admin-env.js';
import type { AdminEnv } from './admin-env.js';
import { fillWizardToReview, nextButton } from './wizard.js';
import { DIVISIONS, LOGOS } from './tenant-profile.js';

// The Auto-W cases that edit a tenant, on ONE disposable tenant D created here through the wizard.
// D's slug is derived from PQA_RUN_ID, so a worker restart after a failure finds the same tenant.
// Each edit test sets the state it needs itself; nothing is restored (D is archived at the end).
// Then the ministry-exclusivity writes (SA-MIN-03, SA-MIN-05), and clean-up as the last test.

type Status = 'active' | 'inactive' | 'suspended' | 'archived';
const LABEL: Record<Exclude<Status, 'archived'>, string> = { active: 'Active', inactive: 'Inactive', suspended: 'Suspended' };

const env = loadAdminEnv();
const hex = (s: string) => createHash('sha1').update(`${process.env.PQA_RUN_ID}:${s}`).digest('hex').slice(0, 4);
const tag = hex('writes');
const slug = `qw${tag}`; // D
const slug2 = `qx${tag}`; // D2 — a second portal for D's ministry (SA-MIN-05)
const raceA = `qr${hex('writes:race-a')}`; // SA-MIN-03
const raceB = `qr${hex('writes:race-b')}`;
const editUrl = `/tenants/${slug}/edit`;
const adminEmailUpper = env.tenantAdmin?.email.replace(/^[^@]+/, (local) => local.toUpperCase()) ?? '';

const DIV = { name: 'QA Wizard Division', short: 'QAWD', desig: 'Director, Under Secretary', desc: 'Handles QA routing checks' };
const PAYLOAD = '<img src=x onerror=alert(1)>';
const YAML = 'openapi: 3.0.3\ninfo:\n  title: QA\n  version: "1.0"\npaths: {}\n';
const PDF =
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';
const file = (name: string, mimeType: string, text: string) => ({ name, mimeType, buffer: Buffer.from(text) });

/** Plus-addressed variant of PQA_ADMIN_PEOPLE_EMAIL, so every invitation lands in the tester's inbox. */
function plus(n: number): string {
  const [local, domain] = env.peopleEmail!.split('@');
  return `${local}+qa${tag}-${n}@${domain}`;
}

// ---------- tenant and status helpers (as in tenant-lifecycle.spec.ts) ----------

async function getTenant(page: Page, s = slug): Promise<any> {
  const res = await page.request.get(`/api/tenants/${s}`);
  expect(res.status(), `GET /api/tenants/${s}`).toBe(200);
  return (await res.json()).data;
}

async function exists(page: Page, s: string): Promise<boolean> {
  return (await page.request.get(`/api/tenants/${s}`)).status() === 200;
}

async function apiStatus(page: Page, s: string): Promise<Status> {
  return (await getTenant(page, s)).tenant.status;
}

async function setStatus(page: Page, s: string, to: Exclude<Status, 'archived'>): Promise<void> {
  await test.step(`Open /tenants/${s}/edit and choose Portal status "${LABEL[to]}"`, async () => {
    await page.goto(`/tenants/${s}/edit`);
    await expect(page.locator('#status')).toBeVisible();
    if ((await page.locator('#status').inputValue()) === to) return; // already there: nothing to save
    const saved = page.waitForResponse((r) => r.url().endsWith(`/api/tenants/${s}/status`) && r.request().method() === 'PATCH');
    await page.locator('#status').selectOption(to);
    expect((await saved).status()).toBe(200);
    await expect(page.getByText('Portal status updated.')).toBeVisible();
  });
  await test.step(`Expect the API to report ${to}`, async () => {
    expect(await apiStatus(page, s)).toBe(to);
  });
}

async function expectPortal(page: Page, e: AdminEnv, s: string, serving: boolean): Promise<void> {
  await test.step(`Open ${e.portalUrl}/${s} — expect it ${serving ? 'to serve' : 'to show the unavailable page'} within ~30 s (5 s config cache)`, async () => {
    await expect
      .poll(async () => {
        await page.goto(`${e.portalUrl}/${s}`);
        return (await page.title()).includes('(Unavailable)');
      }, { timeout: 30_000, intervals: [3_000] })
      .toBe(!serving);
  });
}

/** Suspend → archive, idempotent. Archiving releases the ministry; the slug stays burned. */
async function retire(page: Page, s: string): Promise<void> {
  await test.step(`Suspend then archive ${s} unless it is already archived (or was never created)`, async () => {
    const res = await page.request.get(`/api/tenants/${s}`);
    if (res.status() !== 200) return;
    const status: Status = (await res.json()).data.tenant.status;
    if (status === 'archived') return;
    if (status !== 'suspended') await page.request.patch(`/api/tenants/${s}/status`, { data: { status: 'suspended' } });
    const archived = await page.request.patch(`/api/tenants/${s}/status`, { data: { status: 'archived' } });
    expect(archived.status(), `could not archive ${s} — archive it by hand`).toBe(200);
  });
}

async function freeMinistry(page: Page): Promise<string | undefined> {
  const rows: Array<{ name: string; taken: boolean }> = (await (await page.request.get('/api/ministries')).json()).data;
  return env.ministries.find((m) => rows.find((r) => r.name === m)?.taken === false);
}

/** Status and server message only — never a whole body, which could carry a secret. */
async function answer(res: { status(): number; ok(): boolean; json(): Promise<any> }): Promise<string> {
  const json = await res.json().catch(() => ({}));
  return `${res.status()} ${json?.error?.message ?? (res.ok() ? 'ok' : '')}`.trim();
}

/** The GET bundle's "a key is set" signal. Its field name is not documented: the first boolean whose name mentions "key". */
function keySetFlag(data: unknown): boolean | undefined {
  let found: boolean | undefined;
  JSON.stringify(data, (k, v) => {
    if (found === undefined && typeof v === 'boolean' && /key/i.test(k)) found = v;
    return v;
  });
  return found;
}

/** A3.4: on edit, a stored key turns the API key placeholder into "Leave blank to keep existing key" and the key is not required. */
async function expectKeyStored(page: Page): Promise<void> {
  const key = page.locator('#llmApiKey');
  await expect(key).toHaveValue('');
  await expect(key).toHaveAttribute('placeholder', 'Leave blank to keep existing key');
  expect(await key.evaluate((e) => (e as HTMLInputElement).required), '#llmApiKey required').toBe(false);
}

/** A6: GET /api/tenants/<slug> reports whether a key is set. Checks that flag when present; records its absence as a deviation. */
async function expectKeyFlag(page: Page, testInfo: TestInfo): Promise<void> {
  const data = await getTenant(page);
  const flag = keySetFlag(data);
  if (flag === undefined) {
    testInfo.annotations.push({
      type: 'deviation',
      description: `A6 says GET /api/tenants/<slug> reports whether a key is set; the body has no such field (top-level keys: ${Object.keys(data).join(', ')}). The edit page's key placeholder (A3.4) is checked instead.`,
    });
    return;
  }
  expect(flag, 'GET /api/tenants/<slug> key-set flag').toBe(true);
}

async function userEmails(page: Page): Promise<string[]> {
  const res = await page.request.get(`/api/tenants/${slug}/users`);
  expect(res.status(), `GET /api/tenants/${slug}/users`).toBe(200);
  return ((await res.json()).data as Array<{ email: string }>).map((u) => u.email);
}

async function onD(page: Page, testInfo: TestInfo, more = ''): Promise<void> {
  testInfo.annotations.push({
    type: 'precondition',
    description:
      `Disposable tenant ${slug} exists — created by SA-WREV-09 at the top of this file through the wizard for the first free ` +
      `PQA_ADMIN_TEST_MINISTRIES ministry (Initial status Active, one division "${DIV.name}"). This test sets any other state it needs.` +
      (more ? ` ${more}` : ''),
  });
  await test.step(`Check the disposable tenant ${slug} exists (GET /api/tenants/${slug} → 200)`, async () => {
    expect((await page.request.get(`/api/tenants/${slug}`)).status(), `${slug} was not created — see SA-WREV-09`).toBe(200);
  });
}

// ---------- edit-page helpers ----------

type Tab = 'Configuration' | 'People' | 'Divisions' | 'Roles';
const READY: Record<Tab, (p: Page) => ReturnType<Page['locator']>> = {
  Configuration: (p) => p.getByRole('button', { name: 'Save configuration' }),
  People: (p) => p.getByRole('button', { name: 'Save people' }),
  Divisions: (p) => p.getByRole('button', { name: 'Save divisions' }),
  Roles: (p) => p.getByRole('textbox', { name: 'New role name' }),
};

async function openEdit(page: Page, tab: Tab = 'Configuration'): Promise<void> {
  await test.step(`Open ${editUrl} — ${tab} tab`, async () => {
    await page.goto(editUrl);
    if (tab !== 'Configuration') await page.getByRole('button', { name: new RegExp(`^${tab}\\b`) }).click();
    await expect(READY[tab](page)).toBeVisible();
  });
}

const subheading = (page: Page) => page.getByPlaceholder(/^Your digital assistant for/);

/** Presses Save configuration and returns the PATCH /api/tenants/<D> response. */
async function saveConfig(page: Page) {
  const res = page.waitForResponse((r) => r.url().endsWith(`/api/tenants/${slug}`) && r.request().method() === 'PATCH', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Save configuration' }).click();
  return res;
}

/** The body the edit page sends on Save configuration, captured and aborted: nothing is written. */
async function captureConfigBody(page: Page): Promise<any> {
  await openEdit(page);
  return test.step('Press Save configuration with the PATCH intercepted and aborted — capture its body (nothing written)', async () => {
    await page.route(`**/api/tenants/${slug}`, (r) => (r.request().method() === 'PATCH' ? r.abort() : r.continue()));
    const req = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith(`/api/tenants/${slug}`));
    await page.getByRole('button', { name: 'Save configuration' }).click();
    const body = (await req).postDataJSON();
    await page.unroute(`**/api/tenants/${slug}`);
    return body;
  });
}

const sendConfig = (page: Page, body: unknown) => page.request.patch(`/api/tenants/${slug}`, { data: body, failOnStatusCode: false });

/** A probe that should have been refused was stored: put the captured configuration back so later saves still pass validation. */
async function restoreConfig(page: Page, original: any): Promise<void> {
  await test.step('The server accepted it — PATCH the previous configuration back so later tests can save', async () => {
    const fresh = await getTenant(page);
    const res = await sendConfig(page, { ...original, expectedUpdatedAt: fresh.tenant.updatedAt });
    expect(res.status(), `restore PATCH: ${await answer(res)}`).toBe(200);
  });
}

const values = (page: Page, prefix: string): Promise<string[]> =>
  page.locator(`[id^="${prefix}"]`).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

/** Row key of the input `<prefix><key>` whose value is `value` (case-insensitive). */
async function keyOf(page: Page, prefix: string, value: string): Promise<string | undefined> {
  const pairs = await page.locator(`[id^="${prefix}"]`).evaluateAll((els) => els.map((e) => [e.id, (e as HTMLInputElement).value]));
  return pairs.find(([, v]) => v?.trim().toLowerCase() === value.toLowerCase())?.[0]?.slice(prefix.length);
}

/** Key of the row the last "+ Add …" click created. */
async function lastKey(page: Page, prefix: string): Promise<string> {
  return (await page.locator(`[id^="${prefix}"]`).last().getAttribute('id'))!.slice(prefix.length);
}

/** The editor row holding input #id: its nearest ancestor with a button or checkbox. */
const rowOf = (page: Page, id: string) =>
  page.locator(`[id="${id}"]`).locator('xpath=ancestor::div[.//button or .//input[@type="checkbox"]][1]');

// People

async function addPerson(page: Page, name: string, email: string, role?: 'Ministry admin' | 'User'): Promise<string> {
  await page.getByRole('button', { name: '+ Add person' }).click();
  const key = await lastKey(page, 'name-');
  await page.locator(`[id="name-${key}"]`).fill(name);
  await page.locator(`[id="email-${key}"]`).fill(email);
  if (role) await page.locator(`[id="role-${key}"]`).selectOption({ label: role });
  return key;
}

async function savePeople(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save people' }).click();
  await expect(page.getByText('People saved to the ministry portal schema.')).toBeVisible({ timeout: 30_000 });
}

async function personState(page: Page, email: string): Promise<'active' | 'inactive' | 'absent'> {
  const key = await keyOf(page, 'email-', email);
  if (key === undefined) return 'absent';
  return (await rowOf(page, `email-${key}`).getByRole('checkbox', { name: 'Active' }).isChecked()) ? 'active' : 'inactive';
}

async function deactivate(page: Page, email: string): Promise<void> {
  await test.step(`Press Deactivate on ${email}; accept "Deactivate ${email}? They will not be able to sign in."`, async () => {
    const key = await keyOf(page, 'email-', email);
    expect(key, `${email} is listed on People`).toBeDefined();
    const done = page.waitForResponse((r) => r.request().method() !== 'GET' && r.url().includes(`/api/tenants/${slug}/users/`));
    page.once('dialog', (d) => d.accept());
    await rowOf(page, `email-${key}`).getByRole('button', { name: 'Deactivate' }).click();
    expect((await done).ok(), 'deactivate request').toBe(true);
  });
}

// Divisions

async function addDivision(page: Page, d: { name: string; code?: string; desc?: string; desig?: string }): Promise<string> {
  await page.getByRole('button', { name: '+ Add division' }).click();
  const key = await lastKey(page, 'dname-');
  await page.locator(`[id="dname-${key}"]`).fill(d.name);
  if (d.code) await page.locator(`[id="dcode-${key}"]`).fill(d.code);
  if (d.desc) await page.locator(`[id="ddesc-${key}"]`).fill(d.desc);
  if (d.desig) await page.locator(`[id="ddesig-${key}"]`).fill(d.desig);
  return key;
}

async function saveDivisions(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save divisions' }).click();
  await expect(page.getByText('Divisions saved to the ministry portal schema.')).toBeVisible({ timeout: 30_000 });
}

/** D has at least one saved division (the wizard's, normally); creates one by API if not. */
async function ensureSavedDivision(page: Page): Promise<void> {
  await test.step(`Make sure ${slug} has a saved division (GET /api/tenants/${slug}/departments; create "QA seed division" if empty)`, async () => {
    const list = (await (await page.request.get(`/api/tenants/${slug}/departments`)).json()).data;
    if (Array.isArray(list) && list.length) return;
    const res = await page.request.post(`/api/tenants/${slug}/departments`, { data: { name: 'QA seed division', code: `QS${tag}` } });
    expect(res.ok(), await answer(res)).toBe(true);
  });
}

const isProfileUpload = (url: string) => /\/departments\/[^/]+\/profile$/.test(new URL(url).pathname);
const isPositionsPost = (url: string) => /\/departments\/[^/]+\/positions$/.test(new URL(url).pathname);

// Roles

const roleButton = (page: Page, name: string) => page.getByRole('listitem').getByRole('button', { name, exact: true });

async function selectRole(page: Page, name: string, nth = 0): Promise<void> {
  // The editor loads the role's permissions after the click; a box ticked earlier is reset when they arrive.
  const loaded = page.waitForResponse((r) => r.request().method() === 'GET' && /\/roles\/[^/]+\/permissions$/.test(new URL(r.url()).pathname));
  await roleButton(page, name).nth(nth).click();
  await loaded;
  await expect(page.locator('#role-rename')).toHaveValue(name);
}

async function savePermissions(page: Page): Promise<void> {
  const put = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().endsWith('/permissions'));
  await page.getByRole('button', { name: 'Save permissions' }).click();
  expect((await put).ok(), 'PUT …/permissions').toBe(true);
}

async function createRole(page: Page, name: string, perms: string[] = []): Promise<void> {
  await openEdit(page, 'Roles');
  await test.step(`Create role "${name}"${perms.length ? ` with ${perms.join(', ')}; Save permissions` : ''} (reused if it already exists)`, async () => {
    if (!(await roleButton(page, name).count())) {
      const created = page.waitForResponse((r) => r.request().method() === 'POST' && /\/roles$/.test(new URL(r.url()).pathname));
      await page.getByRole('textbox', { name: 'New role name' }).fill(name);
      await page.getByRole('button', { name: 'Create', exact: true }).click();
      expect((await created).ok(), 'POST …/roles').toBe(true);
    }
    await selectRole(page, name);
    if (!perms.length) return;
    for (const p of perms) await page.getByRole('checkbox', { name: p, exact: true }).check();
    await savePermissions(page);
  });
}

/** Runs the wizard for `ministry` with writes blocked and returns the POST /api/tenants body it tried to send. */
async function captureCreateBody(page: Page, ministry: string, s: string): Promise<any> {
  const attempts = await blockWrites(page);
  await fillWizardToReview(page, { ministry, slug: s, adminName: env.tenantAdmin!.name, adminEmail: env.tenantAdmin!.email, llm: env.llm! });
  return test.step('Press Create tenant with every write blocked — capture the POST /api/tenants body (nothing is created)', async () => {
    await page.getByRole('button', { name: 'Create tenant' }).click();
    const post = () => attempts.find((a) => a.method === 'POST' && a.path === '/api/tenants');
    await expect.poll(() => !!post()).toBe(true);
    await page.unroute('**/api/**');
    return JSON.parse(post()!.body!);
  });
}

// Filled by the creation test; read by SA-WREV-14 (same worker only — the success view cannot be revisited).
let created: { successText: string; openapiAttempts: number } | undefined;
let openapiAttempts = 0;

test.describe('Writes on a disposable tenant', () => {
  requireWrites(env);
  test.skip(!env.tenantAdmin || !env.llm || !env.ministries.length, 'set PQA_ADMIN_TENANT_ADMIN_*, PQA_ADMIN_LLM_* and PQA_ADMIN_TEST_MINISTRIES in .env');
  // Provisioning, invitations and 30 s portal polls do not fit the 30 s default.
  test.describe.configure({ timeout: 180_000 });

  // ---------- D: creation and read-back ----------

  test('SA-WREV-09 create the disposable tenant through the wizard; on success the draft is cleared', async ({ page }) => {
    test.skip(await exists(page, slug), `${slug} already exists (created earlier in this run, before a worker restart) — the draft check needs the tab that created it`);
    const ministry = await test.step('Pick the first PQA_ADMIN_TEST_MINISTRIES ministry with no live portal (GET /api/ministries)', async () => {
      const m = await freeMinistry(page);
      expect(m, 'every PQA_ADMIN_TEST_MINISTRIES ministry already has a live portal').toBeDefined();
      return m!;
    });
    await fillWizardToReview(page, { ministry, slug, adminName: env.tenantAdmin!.name, adminEmail: adminEmailUpper, llm: env.llm!, logos: LOGOS, divisions: DIVISIONS });
    await test.step(`Back twice to step 5; + Add a fifth division: "${DIV.name}", short name ${DIV.short}, designations "${DIV.desig}", description "${DIV.desc}"; Next`, async () => {
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.getByRole('button', { name: '+ Add division' }).click();
      await page.getByRole('textbox', { name: 'Division name' }).last().fill(DIV.name);
      await page.getByRole('textbox', { name: 'Short name' }).last().fill(DIV.short);
      await page.getByRole('textbox', { name: 'Designations, comma-separated' }).last().fill(DIV.desig);
      await page.getByRole('textbox', { name: 'What this division handles' }).last().fill(DIV.desc);
      await nextButton(page).click();
    });
    await test.step('Step 6: stage qa-openapi.yaml in "OpenAPI YAML file"; Next', async () => {
      await expect(page.locator('#sourceUrl')).toBeVisible();
      await page.getByLabel('OpenAPI YAML file').setInputFiles(file('qa-openapi.yaml', 'application/yaml', YAML));
      await expect(page.getByText('Selected: qa-openapi.yaml')).toBeVisible();
      await nextButton(page).click();
    });
    await test.step('Intercept: POST /api/tenants goes to the server with tenant.tenantName rewritten to "QA Fake Name" (SA-WREV-10); POST /api/tenants/*/openapi is answered 502 by the test (SA-WREV-14)', async () => {
      await page.route('**/api/tenants', (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        const body = route.request().postDataJSON();
        body.tenant.tenantName = 'QA Fake Name';
        return route.continue({ postData: JSON.stringify(body) });
      });
      await page.route('**/api/tenants/*/openapi', (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        openapiAttempts += 1;
        return route.fulfill({ status: 502, json: { error: { message: 'QA: simulated OpenAPI upload failure' } } });
      });
    });
    const createdRes = page.waitForResponse((r) => r.url().endsWith('/api/tenants') && r.request().method() === 'POST', { timeout: 60_000 });
    await test.step('Step 7: choose Initial status "Active"; press Create tenant', async () => {
      await page.locator('#finalStatus').selectOption('active');
      await page.getByRole('button', { name: 'Create tenant' }).click();
    });
    await test.step(`Expect 201 and "${ministry} provisioned"`, async () => {
      expect((await createdRes).status()).toBe(201);
      await expect.soft(page.getByText(`${ministry} provisioned`)).toBeVisible({ timeout: 30_000 });
      created = { successText: await page.locator('main').innerText(), openapiAttempts };
    });
    await test.step('Press Back to tenants; then open /tenants/new in the same tab', async () => {
      await page.getByRole('button', { name: 'Back to tenants' }).click();
      await expect(page).toHaveURL(/\/tenants$/);
      await page.goto('/tenants/new');
    });
    await test.step(`Expect a blank wizard (no ministry, empty admin fields) and no draft in session storage mentioning ${slug} or the admin email`, async () => {
      await expect(page.locator('#adminName')).toHaveValue('');
      await expect(page.locator('#adminEmail')).toHaveValue('');
      await expect(page.locator('#slug')).not.toHaveValue(slug);
      await expect.soft(page.locator('#ministryId')).toHaveValue('');
      const stored = (await page.evaluate(() => Object.values(sessionStorage).join('\n'))).toLowerCase();
      expect(stored.includes(slug), `session storage still holds a draft with slug ${slug}`).toBe(false);
      expect(stored.includes(env.tenantAdmin!.email.toLowerCase()), 'session storage still holds a draft with the admin email').toBe(false);
    });
  });

  test('SA-WREV-14 a failed OpenAPI upload after provisioning leaves the tenant created and warns on the success view', async ({ page }, testInfo) => {
    test.skip(!created, 'the success view is gone: D was created before a worker restart — rerun the file with a new PQA_RUN_ID');
    testInfo.annotations.push({
      type: 'precondition',
      description: `SA-WREV-09 staged qa-openapi.yaml on step 6 and the test answered POST /api/tenants/${slug}/openapi with 502 {"error":{"message":"QA: simulated OpenAPI upload failure"}}; POST /api/tenants itself reached the server.`,
    });
    await testInfo.attach('success-view-text', { body: created!.successText, contentType: 'text/plain' });
    await test.step('Expect exactly one OpenAPI upload attempt, made after the create', () => {
      expect(created!.openapiAttempts).toBe(1);
    });
    await test.step(`Expect the tenant created anyway (GET /api/tenants/${slug} → 200)`, async () => {
      expect(await exists(page, slug)).toBe(true);
    });
    await test.step('Expect the success view to warn that the YAML can be attached later from the edit page', () => {
      // A3.11 paraphrases the warning ("can be attached later from the edit page"); the wording itself is not specified.
      expect(created!.successText).toMatch(/(YAML|OpenAPI)[^\n]*edit page/i);
    });
  });

  test('SA-WREV-08 the new tenant is listed and its ministry is shown as taken in the wizard', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const { tenant } = await getTenant(page);
    await test.step(`Open /tenants — expect one row for /${slug} with status "${tenant.status}" (as GET /api/tenants/${slug} reports)`, async () => {
      await page.goto('/tenants');
      const row = page.getByRole('row').filter({ hasText: `/${slug}` });
      await expect(row).toHaveCount(1);
      await expect(row.getByRole('cell').nth(1)).toHaveText(tenant.status);
    });
    await test.step(`Open /tenants/new — expect "${tenant.tenantName} (already provisioned)", disabled`, async () => {
      await page.goto('/tenants/new');
      const option = page.locator('#ministryId option', { hasText: tenant.tenantName });
      await expect(option).toHaveText(`${tenant.tenantName} (already provisioned)`);
      await expect(option).toBeDisabled();
    });
  });

  test('SA-WREV-10 the stored bundle matches the wizard inputs; the caller tenantName is ignored; no key is returned', async ({ page }, testInfo) => {
    await onD(page, testInfo,
      'The POST /api/tenants body was rewritten in flight to tenant.tenantName "QA Fake Name". Inputs: assistant "QA Assistant" / "QA heading" / ' +
      '"QA subheading" / "QA placeholder"; on-prem LLM from PQA_ADMIN_LLM_*; 10 MB; PDF only; all modules on; Initial status Active.');
    const res = await page.request.get(`/api/tenants/${slug}`);
    const text = await res.text();
    const t = JSON.parse(text).data.tenant;
    await test.step(`GET /api/tenants/${slug} — expect tenantName to be the official ministry name, not "QA Fake Name"`, () => {
      expect(t.tenantName).not.toBe('QA Fake Name');
      expect(env.ministries).toContain(t.tenantName);
    });
    await test.step('Expect slug, status active, assistant strings, LLM provider/model/baseUrl/embedding, 10 MB in bytes, PDF only, all 18 modules, docYear = this year', () => {
      expect.soft(t.slug).toBe(slug);
      expect.soft(t.status).toBe('active');
      expect.soft(t.assistant.displayName).toBe('QA Assistant');
      expect.soft(t.assistant.welcomeMsg).toEqual({ heading: 'QA heading', subheading: 'QA subheading', inputPlaceholder: 'QA placeholder' });
      expect.soft(t.assistant.llm.provider).toBe('on_prem');
      expect.soft(t.assistant.llm.model).toBe(env.llm!.model);
      expect.soft(t.assistant.llm.baseUrl).toBe(env.llm!.baseUrl);
      expect.soft(t.assistant.llm.embeddingModel).toBe(env.llm!.embeddingModel);
      expect.soft(t.assistant.filesize.bytes).toBe(10 * 1024 * 1024);
      expect.soft(t.assistant.fileSupportType.extensions).toEqual(['.pdf']);
      expect.soft(Object.values(t.enabledModules ?? {})).toEqual(Array(18).fill(true));
      expect.soft(t.assistant.docYear.current).toBe(new Date().getFullYear());
    });
    await test.step(`GET /api/tenants/${slug}/departments — expect "${DIV.name}"`, async () => {
      const list = (await (await page.request.get(`/api/tenants/${slug}/departments`)).json()).data as Array<{ name: string }>;
      expect.soft(list.map((d) => d.name)).toContain(DIV.name);
    });
    await test.step(`GET /api/tenants/${slug}/users — expect the admin email lower-cased (${env.tenantAdmin!.email.toLowerCase()})`, async () => {
      expect.soft(await userEmails(page)).toContain(env.tenantAdmin!.email.toLowerCase());
    });
    await test.step('Expect the LLM API key value nowhere in the GET response (SA-SEC-01)', () => {
      expect(text.includes(env.llm!.apiKey), 'the API key value is in GET /api/tenants/<slug>').toBe(false);
    });
  });

  test('SA-WREV-13 the division added in the wizard is listed on the Divisions tab', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    await openEdit(page, 'Divisions');
    await test.step(`Expect a division named "${DIV.name}"`, async () => {
      await expect.poll(() => values(page, 'dname-')).toContain(DIV.name);
    });
  });

  test('SA-WBAS-28 an admin email typed with an upper-case local part is stored lower-case', async ({ page }, testInfo) => {
    await onD(page, testInfo, `SA-WREV-09 typed the admin email as ${adminEmailUpper}.`);
    const lower = env.tenantAdmin!.email.toLowerCase();
    await test.step(`GET /api/tenants/${slug}/users — expect ${lower}${adminEmailUpper !== lower ? `, not ${adminEmailUpper}` : ''}`, async () => {
      const emails = await userEmails(page);
      expect(emails).toContain(lower);
      if (adminEmailUpper !== lower) expect(emails).not.toContain(adminEmailUpper);
    });
    await openEdit(page, 'People');
    await test.step(`Expect ${lower} listed on the People tab`, async () => {
      await expect.poll(() => values(page, 'email-')).toContain(lower);
    });
  });

  // ---------- Configuration tab ----------

  test('SA-ECFG-11 Save configuration shows Saving… then "Configuration saved."; the change survives a reload', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const value = `QA subheading ECFG-11 ${tag}`;
    await openEdit(page);
    await test.step(`Hold PATCH /api/tenants/${slug} for 1 s so the in-flight state can be seen`, () =>
      page.route(`**/api/tenants/${slug}`, async (r) => {
        if (r.request().method() === 'PATCH') await new Promise((ok) => setTimeout(ok, 1_000));
        await r.continue();
      }),
    );
    await test.step(`Set Welcome subheading to "${value}"; press Save configuration`, async () => {
      await subheading(page).fill(value);
      await page.getByRole('button', { name: 'Save configuration' }).click();
    });
    await test.step('Expect the button to read "Saving…", then "Configuration saved."', async () => {
      await expect(page.getByRole('button', { name: 'Saving…' })).toBeVisible();
      await expect(page.getByText('Configuration saved.')).toBeVisible({ timeout: 15_000 });
    });
    await test.step(`Reload — expect Welcome subheading "${value}"`, async () => {
      await page.reload();
      await expect(subheading(page)).toHaveValue(value);
    });
  });

  test('SA-ECFG-12 a second save works without reloading', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const [first, second] = [`QA subheading ECFG-12a ${tag}`, `QA subheading ECFG-12b ${tag}`];
    await openEdit(page);
    await test.step(`Set Welcome subheading "${first}"; Save — expect 200 and "Configuration saved."`, async () => {
      await subheading(page).fill(first);
      expect((await saveConfig(page)).status()).toBe(200);
      await expect(page.getByText('Configuration saved.')).toBeVisible();
    });
    await test.step(`Without reloading, set "${second}"; Save — expect 200, no "modified elsewhere" conflict`, async () => {
      await subheading(page).fill(second);
      expect((await saveConfig(page)).status()).toBe(200);
      await expect(page.getByText(/modified elsewhere/i)).toHaveCount(0);
    });
    await test.step(`GET /api/tenants/${slug} — expect subheading "${second}"`, async () => {
      expect((await getTenant(page)).tenant.assistant.welcomeMsg.subheading).toBe(second);
    });
  });

  test('SA-ECFG-13 two tabs: the second save gets the conflict message and the first save is kept', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const [a, b] = [`QA subheading tab A ${tag}`, `QA subheading tab B ${tag}`];
    const pageB = await page.context().newPage();
    await test.step('Open the edit page in two tabs, A and B', async () => {
      await openEdit(page);
      await openEdit(pageB);
    });
    await test.step(`Tab A: Welcome subheading "${a}"; Save — expect 200`, async () => {
      await subheading(page).fill(a);
      expect((await saveConfig(page)).status()).toBe(200);
    });
    await test.step(`Tab B: Welcome subheading "${b}"; Save — expect 409 and "This tenant was modified elsewhere since you loaded it. Refresh and reapply your changes."`, async () => {
      await subheading(pageB).fill(b);
      // Soft, so the last step still shows whether tab B silently overwrote tab A.
      expect.soft((await saveConfig(pageB)).status()).toBe(409);
      await expect.soft(pageB.getByText(/modified elsewhere/i)).toBeVisible();
      await expect.soft(pageB.getByText('This tenant was modified elsewhere since you loaded it. Refresh and reapply your changes.')).toBeVisible();
    });
    await test.step(`GET /api/tenants/${slug} — expect tab A's subheading "${a}" kept`, async () => {
      expect((await getTenant(page)).tenant.assistant.welcomeMsg.subheading).toBe(a);
    });
    await pageB.close();
  });

  test('SA-ECFG-15 Save configuration never changes status, even when the PATCH body carries one', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    await setStatus(page, slug, 'suspended');
    await test.step('Reload; change Welcome subheading; press Save configuration — expect 200', async () => {
      await page.reload();
      await subheading(page).fill(`QA subheading ECFG-15 ${tag}`);
      expect((await saveConfig(page)).status()).toBe(200);
    });
    await test.step('Expect status still suspended', async () => {
      expect(await apiStatus(page, slug)).toBe('suspended');
    });
    const body = await captureConfigBody(page);
    const res = await test.step(`PATCH /api/tenants/${slug} with the page's own body but tenant.status "active"`, () => {
      body.tenant.status = 'active';
      return sendConfig(page, body);
    });
    await test.step('Expect status still suspended (the route no longer changes status)', async () => {
      await testInfo.attach('patch-with-status', { body: await answer(res), contentType: 'text/plain' });
      expect(await apiStatus(page, slug)).toBe('suspended');
    });
  });

  test('SA-ECFG-17 a blank API key on save keeps the stored key', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    await test.step(`GET /api/tenants/${slug} — expect it to report a key is set`, () => expectKeyFlag(page, testInfo));
    await openEdit(page);
    await test.step('Expect the API key field empty, placeholder "Leave blank to keep existing key", not required (a key is stored)', () => expectKeyStored(page));
    await test.step('Leave the API key field empty; change Welcome subheading; Save — expect 200', async () => {
      await subheading(page).fill(`QA subheading ECFG-17 ${tag}`);
      expect((await saveConfig(page)).status()).toBe(200);
    });
    await test.step(`GET /api/tenants/${slug} — expect a key still set`, () => expectKeyFlag(page, testInfo));
    await test.step('Reload the edit page — expect the placeholder still "Leave blank to keep existing key" (the key was kept)', async () => {
      await page.reload();
      await expectKeyStored(page);
    });
  });

  test('SA-ECFG-18 a new API key replaces the old one and is never echoed', async ({ page }, testInfo) => {
    await onD(page, testInfo, "This replaces D's LLM key with a dummy value; D's assistant will not answer afterwards.");
    const dummy = `qa-dummy-key-${tag}`;
    await openEdit(page);
    await test.step(`Type the dummy key "${dummy}" in API key; Save — expect 200`, async () => {
      await page.locator('#llmApiKey').fill(dummy);
      expect((await saveConfig(page)).status()).toBe(200);
    });
    await test.step(`GET /api/tenants/${slug} — expect a key set and the dummy value nowhere in the body`, async () => {
      const res = await page.request.get(`/api/tenants/${slug}`);
      const text = await res.text();
      await expectKeyFlag(page, testInfo);
      expect(text.includes(dummy), 'the key value is echoed by the API').toBe(false);
    });
    await test.step('Reload the edit page — expect the API key field empty with "Leave blank to keep existing key", and the dummy value nowhere in the page', async () => {
      await page.reload();
      await expectKeyStored(page);
      expect((await page.content()).includes(dummy), 'the key value is in the edit page').toBe(false);
    });
  });

  test('SA-ECFG-22 an MCP row without a server URL is dropped on save', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const name = `QA MCP no-url ${tag}`;
    await openEdit(page);
    await test.step(`Add MCP server with name "${name}" and no URL; Save — expect 200`, async () => {
      await page.getByRole('button', { name: 'Add MCP server' }).click();
      await page.locator(`[id="mcp-name-${await lastKey(page, 'mcp-name-')}"]`).fill(name);
      expect((await saveConfig(page)).status()).toBe(200);
    });
    await test.step(`Reload — expect no connector named "${name}"`, async () => {
      await page.reload();
      await expect(READY.Configuration(page)).toBeVisible();
      expect(await values(page, 'mcp-name-')).not.toContain(name);
    });
  });

  test('SA-ECFG-23 an MCP row without a name is dropped on save', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const url = `https://example.gov.in/qa-no-name-${tag}`;
    await openEdit(page);
    await test.step(`Add MCP server with URL ${url} and no name; Save — expect 200`, async () => {
      await page.getByRole('button', { name: 'Add MCP server' }).click();
      await page.locator(`[id="mcp-url-${await lastKey(page, 'mcp-name-')}"]`).fill(url);
      expect((await saveConfig(page)).status()).toBe(200);
    });
    await test.step(`Reload — expect no connector with URL ${url}`, async () => {
      await page.reload();
      await expect(READY.Configuration(page)).toBeVisible();
      expect(await values(page, 'mcp-url-')).not.toContain(url);
    });
  });

  test('SA-ECFG-24 a valid MCP connector round-trips', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const name = `QA MCP ${tag}`;
    await openEdit(page);
    await test.step(`Add MCP server "${name}", https://example.gov.in/mcp, HTTP, Bearer, secret ref qa/ref, tools a,b; Save — expect 200`, async () => {
      await page.getByRole('button', { name: 'Add MCP server' }).click();
      const i = await lastKey(page, 'mcp-name-');
      await page.locator(`[id="mcp-name-${i}"]`).fill(name);
      await page.locator(`[id="mcp-url-${i}"]`).fill('https://example.gov.in/mcp');
      await page.locator(`[id="mcp-transport-${i}"]`).selectOption({ label: 'HTTP' });
      await page.locator(`[id="mcp-auth-${i}"]`).selectOption({ label: 'Bearer' });
      await page.locator(`[id="mcp-secret-${i}"]`).fill('qa/ref');
      await page.locator(`[id="mcp-tools-${i}"]`).fill('a,b');
      expect((await saveConfig(page)).status()).toBe(200);
    });
    await test.step(`Reload — expect "${name}" back with every value, Enabled ticked`, async () => {
      await page.reload();
      await expect(READY.Configuration(page)).toBeVisible();
      const i = await keyOf(page, 'mcp-name-', name);
      expect(i, `connector "${name}" after reload`).toBeDefined();
      await expect.soft(page.locator(`[id="mcp-url-${i}"]`)).toHaveValue('https://example.gov.in/mcp');
      await expect.soft(page.locator(`[id="mcp-transport-${i}"] option:checked`)).toHaveText('HTTP');
      await expect.soft(page.locator(`[id="mcp-auth-${i}"] option:checked`)).toHaveText('Bearer');
      await expect.soft(page.locator(`[id="mcp-secret-${i}"]`)).toHaveValue('qa/ref');
      await expect.soft(page.locator(`[id="mcp-tools-${i}"]`)).toHaveValue(/^a,\s*b$/);
      // The connector card is the ancestor holding both its first (name) and last (tools) field.
      const card = page.locator(`[id="mcp-name-${i}"]`).locator(`xpath=ancestor::div[.//*[@id="mcp-tools-${i}"]][1]`);
      await expect.soft(card.getByRole('checkbox', { name: 'Enabled' })).toBeChecked();
    });
  });

  test('SA-ECFG-25 an MCP server URL "not a url" is not blocked in the browser (server answer recorded)', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const name = `QA MCP bad-url ${tag}`;
    await openEdit(page);
    const res = await test.step(`Add MCP server "${name}" with URL "not a url"; Save — expect the PATCH to be sent (no client-side validation)`, async () => {
      await page.getByRole('button', { name: 'Add MCP server' }).click();
      const i = await lastKey(page, 'mcp-name-');
      await page.locator(`[id="mcp-name-${i}"]`).fill(name);
      await page.locator(`[id="mcp-url-${i}"]`).fill('not a url');
      return saveConfig(page);
    });
    await test.step('Q: record the server answer (is there server-side validation?)', async () => {
      await testInfo.attach('Q-server-answer', { body: await answer(res), contentType: 'text/plain' });
    });
  });

  test('SA-ECFG-26 file size and types round-trip on edit', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    await openEdit(page);
    await test.step('Set Max upload size (MB) 25; tick CSV; Save — expect 200', async () => {
      await page.locator('#filesizeMb').fill('25');
      await page.getByRole('checkbox', { name: 'CSV', exact: true }).check();
      expect((await saveConfig(page)).status()).toBe(200);
    });
    await test.step('Reload — expect 25 and CSV ticked; the API stores 25 MB in bytes', async () => {
      await page.reload();
      await expect(page.locator('#filesizeMb')).toHaveValue('25');
      await expect(page.getByRole('checkbox', { name: 'CSV', exact: true })).toBeChecked();
      expect.soft((await getTenant(page)).tenant.assistant.filesize.bytes).toBe(25 * 1024 * 1024);
    });
  });

  test('SA-ECFG-29 an OpenAPI YAML uploaded on edit is shown as current after reload', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const name = `qa-openapi-${tag}.yaml`;
    await openEdit(page);
    await test.step(`Pick ${name} in "OpenAPI YAML file"; Save — expect 200 and the upload POST /api/tenants/${slug}/openapi → 200`, async () => {
      const uploaded = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/api/tenants/${slug}/openapi`), { timeout: 30_000 });
      await page.getByLabel('OpenAPI YAML file').setInputFiles(file(name, 'application/yaml', YAML));
      await expect(page.getByText(`Selected: ${name}`)).toBeVisible();
      // The page uploads first and sends the PATCH only after a successful upload.
      const patched = saveConfig(page).catch(() => null);
      const upload = await uploaded;
      expect(upload.status(), `POST /api/tenants/${slug}/openapi: ${await answer(upload)}`).toBe(200);
      expect((await patched)?.status(), `PATCH /api/tenants/${slug}`).toBe(200);
    });
    await test.step(`Reload — expect "Current: ${name}"`, async () => {
      await page.reload();
      await expect(page.getByText(`Current: ${name}`)).toBeVisible();
    });
  });

  test('SA-ECFG-30 a primary colour change reaches the portal within ~5 s, no restart', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const color = `#${createHash('sha1').update(`${process.env.PQA_RUN_ID}:writes:color`).digest('hex').slice(0, 6).toUpperCase()}`;
    await setStatus(page, slug, 'active');
    await test.step(`Reload; set Primary brand color ${color}; Save — expect 200`, async () => {
      await page.reload();
      await page.locator('#primaryColor').fill(color);
      expect((await saveConfig(page)).status()).toBe(200);
    });
    await test.step(`Reload ${env.portalUrl}/${slug} every second for 10 s — expect CSS --brand ${color}`, async () => {
      await expect
        .poll(async () => {
          await page.goto(`${env.portalUrl}/${slug}`);
          return (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--brand'))).trim().toUpperCase();
        }, { timeout: 10_000, intervals: [1_000] })
        .toBe(color);
    });
  });

  test('SA-WAST-13 a wrong logo path saves and shows as a broken image on the portal sign-in card', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    await openEdit(page);
    await test.step('Set Ministry crest to /nope/x.png; Save — expect 200 and no client complaint', async () => {
      await page.getByRole('textbox', { name: 'Ministry crest' }).fill('/nope/x.png');
      expect((await saveConfig(page)).status()).toBe(200);
      await expect(page.getByText('Configuration saved.')).toBeVisible();
    });
    await setStatus(page, slug, 'active');
    await test.step(`Open ${env.portalUrl}/${slug} — expect an <img> for /nope/x.png that failed to load`, async () => {
      const crest = page.locator('img[src*="nope"]');
      await expect
        .poll(async () => {
          await page.goto(`${env.portalUrl}/${slug}`);
          return crest.count();
        }, { timeout: 30_000, intervals: [3_000] })
        .toBeGreaterThan(0);
      await expect.poll(() => crest.first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 0)).toBe(true);
    });
  });

  // ---------- Status card ----------

  test('SA-ESTA-03 a status change saves immediately, without Save configuration', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const to: Exclude<Status, 'archived'> = (await apiStatus(page, slug)) === 'suspended' ? 'inactive' : 'suspended';
    await openEdit(page);
    await test.step(`Choose Portal status "${LABEL[to]}"; do not press Save — expect PATCH …/status 200 {"data":{"status":"${to}"}} and "Portal status updated."`, async () => {
      const saved = page.waitForResponse((r) => r.url().endsWith(`/api/tenants/${slug}/status`) && r.request().method() === 'PATCH');
      await page.locator('#status').selectOption(to);
      const res = await saved;
      expect(res.status()).toBe(200);
      expect(await res.json()).toEqual({ data: { status: to } });
      await expect(page.getByText('Portal status updated.')).toBeVisible();
    });
    await test.step(`Reload — expect Portal status "${LABEL[to]}"`, async () => {
      await page.reload();
      await expect(page.locator('#status')).toHaveValue(to);
    });
    await test.step(`Open /tenants — expect /${slug} listed as ${to}`, async () => {
      await page.goto('/tenants');
      await expect(page.getByRole('row').filter({ hasText: `/${slug}` }).getByRole('cell').nth(1)).toHaveText(to);
    });
  });

  test('SA-ESTA-07 Archive is offered only while Suspended', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    for (const s of ['active', 'inactive', 'suspended'] as const) {
      await setStatus(page, slug, s);
      await test.step(`Reload — expect ${s === 'suspended' ? 'an' : 'no'} Archive button while ${s}`, async () => {
        await page.reload();
        await expect(page.locator('#status')).toHaveValue(s);
        await expect(page.getByRole('button', { name: /^Archive\b/ })).toHaveCount(s === 'suspended' ? 1 : 0);
      });
    }
  });

  // ---------- API and security probes on D ----------

  test('SA-API-30 an unknown palette token is removed and not stored', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const original = await captureConfigBody(page);
    const body = structuredClone(original);
    const ui = body.tenant.assistant.UIConfig;
    ui.paletteOverrides = { ...(ui.paletteOverrides ?? {}), 'not-a-token': '#fff' };
    const res = await test.step(`PATCH /api/tenants/${slug} with paletteOverrides {"not-a-token":"#fff"} and the current expectedUpdatedAt`, () => sendConfig(page, body));
    let stored = false;
    try {
      await test.step('Expect "Unknown token — removed." and no "not-a-token" key stored', async () => {
        await testInfo.attach('server-answer', { body: await answer(res), contentType: 'text/plain' });
        stored = 'not-a-token' in ((await getTenant(page)).tenant.assistant.UIConfig.paletteOverrides ?? {});
        expect.soft(await res.text()).toContain('Unknown token — removed.');
        expect(stored, '"not-a-token" was stored').toBe(false);
      });
    } finally {
      if (stored) await restoreConfig(page, original);
    }
  });

  test('SA-SEC-10 the server refuses a CSS-injecting colour', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const original = await captureConfigBody(page);
    const before = original.tenant.assistant.UIConfig.primaryColor;
    const body = structuredClone(original);
    body.tenant.assistant.UIConfig.primaryColor = 'red; }';
    const res = await test.step(`PATCH /api/tenants/${slug} with primaryColor "red; }" and the current expectedUpdatedAt`, () => sendConfig(page, body));
    try {
      await test.step('Expect 422 "Validation failed" with "Enter a valid color."', async () => {
        expect(res.status(), await answer(res)).toBe(422);
        const json = await res.json();
        expect(json.error?.message).toBe('Validation failed');
        expect(JSON.stringify(json.error?.fields ?? {})).toContain('Enter a valid color.');
      });
      await test.step(`GET /api/tenants/${slug} — expect primaryColor still ${before}`, async () => {
        expect((await getTenant(page)).tenant.assistant.UIConfig.primaryColor).toBe(before);
      });
    } finally {
      if (res.ok()) await restoreConfig(page, original);
    }
  });

  test('SA-SEC-19 the server refuses a private source URL', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const original = await captureConfigBody(page);
    const body = structuredClone(original);
    body.tenant.sourceWebsites = [{ url: 'https://169.254.169.254/' }];
    body.tenant.sourceWebsitesTrusted = true;
    const res = await test.step(`PATCH /api/tenants/${slug} with sourceWebsites [{"url":"https://169.254.169.254/"}], trusted, and the current expectedUpdatedAt`, () => sendConfig(page, body));
    try {
      await test.step('Expect 422 with "Must be a public HTTPS URL (no localhost or private IPs)."', async () => {
        expect(res.status(), await answer(res)).toBe(422);
        expect(await res.text()).toContain('Must be a public HTTPS URL (no localhost or private IPs).');
      });
      await test.step(`GET /api/tenants/${slug} — expect no 169.254.169.254 source stored`, async () => {
        expect(JSON.stringify((await getTenant(page)).tenant.sourceWebsites ?? [])).not.toContain('169.254');
      });
    } finally {
      if (res.ok()) await restoreConfig(page, original);
    }
  });

  test('SA-SEC-12 stored markup stays inert text in the admin app and the portal', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    /** An HTML 403 (not the app's JSON) is the edge firewall refusing the markup before the app sees it. */
    const refusedAtEdge = (res: Response, what: string): boolean => {
      if (res.status() !== 403 || !(res.headers()['content-type'] ?? '').includes('text/html')) return false;
      testInfo.annotations.push({ type: 'question', description: `${what} carrying ${PAYLOAD} got an HTML 403 from the edge firewall, so the app's own handling of stored markup was not reached. Is the firewall the intended defence?` });
      return true;
    };
    const stored = { heading: true, division: true };
    await openEdit(page);
    await test.step(`Set Welcome heading to ${PAYLOAD}; Save — expect 200 (or a 403 from the edge firewall, with nothing stored)`, async () => {
      await page.getByPlaceholder('Ready when you are.').fill(PAYLOAD);
      const res = await saveConfig(page);
      if (refusedAtEdge(res, `PATCH /api/tenants/${slug}`)) {
        stored.heading = false;
        expect((await getTenant(page)).tenant.assistant.welcomeMsg.heading, 'heading stored despite the 403').not.toBe(PAYLOAD);
      } else expect(res.status()).toBe(200);
    });
    await openEdit(page, 'Divisions');
    await test.step(`+ Add division named ${PAYLOAD}; Save divisions — expect it saved (or a 403 from the edge firewall, with nothing stored)`, async () => {
      await addDivision(page, { name: PAYLOAD });
      const posted = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/api/tenants/${slug}/departments`));
      await page.getByRole('button', { name: 'Save divisions' }).click();
      if (refusedAtEdge(await posted, `POST /api/tenants/${slug}/departments`)) {
        stored.division = false;
        const list = (await (await page.request.get(`/api/tenants/${slug}/departments`)).json()).data as Array<{ name: string }>;
        expect(list.map((d) => d.name), 'division stored despite the 403').not.toContain(PAYLOAD);
      } else await expect(page.getByText('Divisions saved to the ministry portal schema.')).toBeVisible({ timeout: 30_000 });
    });
    await openEdit(page);
    await test.step('Expect the heading shown as text (when stored), no <img src="x"> rendered, no dialog', async () => {
      if (stored.heading) await expect(page.getByPlaceholder('Ready when you are.')).toHaveValue(PAYLOAD);
      await expect(page.locator('img[src="x"]')).toHaveCount(0);
    });
    await openEdit(page, 'Divisions');
    await test.step('Expect the division name shown as text (when stored), no <img src="x"> rendered, no dialog', async () => {
      if (stored.division) expect(await values(page, 'dname-')).toContain(PAYLOAD);
      await expect(page.locator('img[src="x"]')).toHaveCount(0);
    });
    await setStatus(page, slug, 'active');
    await expectPortal(page, env, slug, true);
    await test.step('Signed-out portal page: expect no dialog and no <img src="x"> (the signed-in assistant view is ministry-portal phase)', async () => {
      await expect(page.locator('img[src="x"]')).toHaveCount(0);
      expect(dialogs).toEqual([]);
    });
  });

  // ---------- People tab ----------

  test.describe('People tab', () => {
    test.skip(!env.peopleEmail, 'set PQA_ADMIN_PEOPLE_EMAIL — invitations go there, plus-addressed');

    test('SA-EPPL-07 add two people; both listed after reload', async ({ page }, testInfo) => {
      await onD(page, testInfo, 'Sends two invitations to plus-addresses of PQA_ADMIN_PEOPLE_EMAIL; the people clean-up test deactivates them.');
      const people = [[`QA Person ${tag}-1`, plus(1)], [`QA Person ${tag}-2`, plus(2)]] as const;
      await openEdit(page, 'People');
      await test.step(`+ Add person ×2: ${people.map(([n, e]) => `${n} <${e}>`).join(', ')}; Save people — expect "People saved to the ministry portal schema."`, async () => {
        for (const [n, e] of people) await addPerson(page, n, e);
        await savePeople(page);
      });
      await openEdit(page, 'People');
      await test.step('Expect both listed after reload', async () => {
        const emails = (await values(page, 'email-')).map((e) => e.toLowerCase());
        for (const [, e] of people) expect(emails).toContain(e.toLowerCase());
      });
    });

    test('SA-EPPL-09 re-activate a deactivated person', async ({ page }, testInfo) => {
      await onD(page, testInfo, 'Signing in as the re-activated person is an OTP / ministry-portal check, not done here.');
      const email = plus(3);
      await openEdit(page, 'People');
      await test.step(`+ Add person "QA Reactivate ${tag}" <${email}>; Save people`, async () => {
        await addPerson(page, `QA Reactivate ${tag}`, email);
        await savePeople(page);
      });
      await openEdit(page, 'People');
      await deactivate(page, email);
      await openEdit(page, 'People');
      await test.step(`Expect ${email} still listed, Active unticked`, async () => {
        expect(await personState(page, email)).toBe('inactive');
      });
      await test.step(`Tick Active on ${email}; Save people`, async () => {
        const key = await keyOf(page, 'email-', email);
        await rowOf(page, `email-${key}`).getByRole('checkbox', { name: 'Active' }).check();
        await savePeople(page);
      });
      await openEdit(page, 'People');
      await test.step(`Reload — expect ${email} Active`, async () => {
        expect(await personState(page, email)).toBe('active');
      });
    });

    test('SA-EPPL-10 an identity role picked on a new row is held by the person', async ({ page }, testInfo) => {
      await onD(page, testInfo);
      const role = `QA EPPL-10 Role ${tag}`;
      const email = plus(4);
      await createRole(page, role);
      await openEdit(page, 'People');
      const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/api/tenants/${slug}/users`));
      const roleValue = await test.step(`+ Add person "QA Role holder ${tag}" <${email}>; pick identity role "${role}"; Save people`, async () => {
        const key = await addPerson(page, `QA Role holder ${tag}`, email);
        const iroles = page.locator(`[id="iroles-${key}"]`);
        await iroles.selectOption({ label: role });
        const value = await iroles.locator('option', { hasText: role }).getAttribute('value');
        await savePeople(page);
        return value ?? role;
      });
      await test.step(`Expect the POST /api/tenants/${slug}/users body to carry the role`, async () => {
        expect((await posted).postData() ?? '').toContain(roleValue);
      });
      await test.step(`GET /api/tenants/${slug}/users — expect ${email} listed; record that no identity role is readable there`, async () => {
        const users = (await (await page.request.get(`/api/tenants/${slug}/users`)).json()).data as Array<{ email: string }>;
        const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
        expect(user, `${email} listed`).toBeDefined();
        if (!new RegExp(`${role}|${roleValue}`).test(JSON.stringify(user))) {
          testInfo.annotations.push({
            type: 'question',
            description: `The admin API exposes no identity roles per person (GET /users carries PQ memberships only), so "holds ${role}" can only be confirmed in the ministry portal. The POST carried identityRoleIds [${roleValue}] and was accepted.`,
          });
        }
      });
    });

    test('SA-EPPL-11 the Ministry admin role persists for a new person', async ({ page }, testInfo) => {
      await onD(page, testInfo);
      const email = plus(5);
      await openEdit(page, 'People');
      await test.step(`+ Add person "QA Admin ${tag}" <${email}> as Ministry admin; Save people`, async () => {
        await addPerson(page, `QA Admin ${tag}`, email, 'Ministry admin');
        await savePeople(page);
      });
      await openEdit(page, 'People');
      await test.step(`Reload — expect ${email} with role Ministry admin`, async () => {
        const key = await keyOf(page, 'email-', email);
        expect(key, `${email} listed`).toBeDefined();
        await expect(page.locator(`[id="role-${key}"] option:checked`)).toHaveText('Ministry admin');
      });
    });

    test('SA-EPPL-12 people save one at a time: a failed 2nd row stops the 3rd; re-saving is safe', async ({ page }, testInfo) => {
      await onD(page, testInfo);
      const emails = [plus(6), plus(7), plus(8)];
      let posts = 0;
      await openEdit(page, 'People');
      await test.step(`Answer the 2nd POST /api/tenants/${slug}/users with 500 {"error":{"message":"QA: simulated failure on the 2nd person"}}`, () =>
        page.route(`**/api/tenants/${slug}/users`, (route) => {
          if (route.request().method() !== 'POST') return route.continue();
          posts += 1;
          return posts === 2 ? route.fulfill({ status: 500, json: { error: { message: 'QA: simulated failure on the 2nd person' } } }) : route.continue();
        }),
      );
      await test.step(`+ Add person ×3: ${emails.join(', ')}; Save people`, async () => {
        for (const [i, e] of emails.entries()) await addPerson(page, `QA Sequence ${tag}-${i + 1}`, e);
        await page.getByRole('button', { name: 'Save people' }).click();
        await expect(page.getByRole('button', { name: 'Save people' })).toBeEnabled({ timeout: 30_000 });
      });
      await test.step('Expect the error shown and exactly two POSTs (the 3rd never attempted)', async () => {
        await expect.soft(page.getByText('QA: simulated failure on the 2nd person')).toBeVisible();
        expect(posts).toBe(2);
      });
      await test.step('Remove the interception; press Save people again — expect "People saved to the ministry portal schema."', async () => {
        await page.unroute(`**/api/tenants/${slug}/users`);
        await savePeople(page);
      });
      await openEdit(page, 'People');
      await test.step(`Reload — expect each of ${emails.join(', ')} listed exactly once`, async () => {
        const listed = (await values(page, 'email-')).map((e) => e.toLowerCase());
        for (const e of emails) expect(listed.filter((l) => l === e.toLowerCase()), e).toHaveLength(1);
      });
    });

    test('SA-EPPL-15 adding a duplicate email to the same tenant (Q: behaviour recorded)', async ({ page }, testInfo) => {
      await onD(page, testInfo);
      const email = plus(9);
      await openEdit(page, 'People');
      await test.step(`+ Add person "QA Duplicate A" <${email}>; Save people`, async () => {
        await addPerson(page, 'QA Duplicate A', email);
        await savePeople(page);
      });
      await openEdit(page, 'People');
      const res = await test.step(`+ Add person "QA Duplicate B" with the same email ${email}; Save people`, async () => {
        const posted = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith(`/api/tenants/${slug}/users`));
        await addPerson(page, 'QA Duplicate B', email);
        await page.getByRole('button', { name: 'Save people' }).click();
        const r = await posted;
        await expect(page.getByRole('button', { name: 'Save people' })).toBeEnabled({ timeout: 30_000 });
        return r;
      });
      await openEdit(page, 'People');
      await test.step('Q: record the server answer and how many rows carry that email after reload', async () => {
        const rows = (await values(page, 'email-')).filter((e) => e.toLowerCase() === email.toLowerCase()).length;
        await testInfo.attach('Q-duplicate-email', { body: `POST answer: ${await answer(res)}\nrows with ${email} after reload: ${rows}`, contentType: 'text/plain' });
      });
    });

    test('cleanup: deactivate the people this file added to the disposable tenant', async ({ page }) => {
      if (!(await exists(page, slug))) return;
      for (let i = 0; i < 20; i++) {
        await openEdit(page, 'People');
        let target: string | undefined;
        for (const e of (await values(page, 'email-')).filter((v) => v.includes(`+qa${tag}-`))) {
          if ((await personState(page, e)) === 'active') {
            target = e;
            break;
          }
        }
        if (!target) return;
        await deactivate(page, target);
      }
    });
  });

  // ---------- Divisions tab ----------

  test('SA-EDIV-05 a new division with designations creates its positions', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const d = { name: `QA Div ${tag}`, code: `QAD${tag}`, desc: 'QA division with designations', desig: 'A, B' };
    const positions: Array<{ title: string; ok: boolean }> = [];
    page.on('response', (r) => {
      if (r.request().method() === 'POST' && isPositionsPost(r.url())) positions.push({ title: r.request().postDataJSON()?.title, ok: r.ok() });
    });
    await openEdit(page, 'Divisions');
    await test.step(`+ Add division: name "${d.name}", code ${d.code}, description, designations "${d.desig}"; Save divisions — expect "Divisions saved to the ministry portal schema."`, async () => {
      await addDivision(page, d);
      await saveDivisions(page);
    });
    await test.step('Expect two successful position POSTs, titles A and B', async () => {
      await expect.poll(() => positions.length).toBe(2);
      expect(positions.map((p) => p.title).sort()).toEqual(['A', 'B']);
      expect(positions.every((p) => p.ok)).toBe(true);
    });
    await openEdit(page, 'Divisions');
    await test.step(`Reload — expect "${d.name}" listed`, async () => {
      expect(await values(page, 'dname-')).toContain(d.name);
    });
  });

  test('SA-EDIV-06 a division with only a name saves; blank code is sent as unset', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const name = `QA Div name-only ${tag}`;
    await openEdit(page, 'Divisions');
    const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().endsWith(`/api/tenants/${slug}/departments`));
    await test.step(`+ Add division with name "${name}" only; Save divisions — expect success`, async () => {
      await addDivision(page, { name });
      await saveDivisions(page);
    });
    await test.step('Expect the POST body to carry no code', async () => {
      expect((await posted).postDataJSON().code ?? null).toBeNull();
    });
  });

  test('SA-EDIV-07 editing designations of a saved division sends no positions', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const name = `QA Div 07 ${tag}`;
    await openEdit(page, 'Divisions');
    await test.step(`+ Add division "${name}" with designation X; Save divisions`, async () => {
      await addDivision(page, { name, desig: 'X' });
      await saveDivisions(page);
    });
    await openEdit(page, 'Divisions');
    const positions: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && isPositionsPost(r.url())) positions.push(r.url());
    });
    await test.step(`Set designations of "${name}" to "C, D"; Save divisions — expect no POST …/positions`, async () => {
      const key = await keyOf(page, 'dname-', name);
      expect(key, `"${name}" listed`).toBeDefined();
      await page.locator(`[id="ddesig-${key}"]`).fill('C, D');
      await saveDivisions(page);
      expect(positions).toEqual([]);
    });
  });

  test('SA-EDIV-08 a profile PDF uploads as soon as it is picked, with no message on screen', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    await ensureSavedDivision(page);
    await openEdit(page, 'Divisions');
    await test.step('Pick qa-profile.pdf in the first saved division\'s Profile document — do not press Save; expect the upload POST …/profile → 2xx', async () => {
      const uploaded = page.waitForResponse((r) => r.request().method() === 'POST' && isProfileUpload(r.url()), { timeout: 15_000 });
      await page.locator('[id^="dprofile-"]').first().setInputFiles(file('qa-profile.pdf', 'application/pdf', PDF));
      expect((await uploaded).ok()).toBe(true);
    });
    await test.step('Expect no "Divisions saved…" message (verifying the profile is ministry-portal phase)', async () => {
      await expect(page.getByText('Divisions saved to the ministry portal schema.')).toHaveCount(0);
    });
  });

  test('SA-API-29 the department profile upload answers {"ok":true}, not {"data":…}', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    await ensureSavedDivision(page);
    await openEdit(page, 'Divisions');
    await test.step('Pick qa-profile.pdf in the first saved division\'s Profile document; expect POST …/departments/<id>/profile to answer exactly {"ok":true}', async () => {
      const uploaded = page.waitForResponse((r) => r.request().method() === 'POST' && isProfileUpload(r.url()), { timeout: 15_000 });
      await page.locator('[id^="dprofile-"]').first().setInputFiles(file('qa-profile.pdf', 'application/pdf', PDF));
      expect(await (await uploaded).json()).toEqual({ ok: true });
    });
  });

  test('SA-EDIV-09 a non-PDF profile document (Q: behaviour recorded)', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    await ensureSavedDivision(page);
    await openEdit(page, 'Divisions');
    await test.step('Pick qa-profile.txt (text/plain) in the first saved division\'s Profile document; record whether it is sent and the answer', async () => {
      const sent = page.waitForRequest((r) => r.method() === 'POST' && isProfileUpload(r.url()), { timeout: 5_000 }).catch(() => null);
      await page.locator('[id^="dprofile-"]').first().setInputFiles(file('qa-profile.txt', 'text/plain', 'not a pdf'));
      const req = await sent;
      const res = req ? await req.response() : null;
      await testInfo.attach('Q-non-pdf-profile', {
        body: req ? `request sent; answer ${res ? await answer(res) : 'none'}` : 'no request sent (refused in the browser)',
        contentType: 'text/plain',
      });
      await testInfo.attach('after-pick', { body: await page.screenshot(), contentType: 'image/png' });
    });
  });

  test('SA-EDIV-10 unticking Active on a division saves isActive false', async ({ page }, testInfo) => {
    await onD(page, testInfo, 'The ministry-portal routing-picker check is ministry-portal phase.');
    const name = `QA Div 10 ${tag}`;
    await test.step(`Create division "${name}" (POST /api/tenants/${slug}/departments) unless it exists`, async () => {
      const list = (await (await page.request.get(`/api/tenants/${slug}/departments`)).json()).data as Array<{ name: string }>;
      if (list.some((d) => d.name === name)) return;
      const res = await page.request.post(`/api/tenants/${slug}/departments`, { data: { name } });
      expect(res.ok(), await answer(res)).toBe(true);
    });
    await openEdit(page, 'Divisions');
    await test.step(`Untick Active on "${name}"; Save divisions — expect its PATCH to carry isActive false`, async () => {
      const key = await keyOf(page, 'dname-', name);
      expect(key, `"${name}" listed`).toBeDefined();
      const patched = page.waitForRequest((r) => r.method() === 'PATCH' && /\/departments\/[^/]+$/.test(new URL(r.url()).pathname) && r.postDataJSON()?.name === name);
      await rowOf(page, `dname-${key}`).getByRole('checkbox', { name: 'Active' }).uncheck();
      await saveDivisions(page);
      expect((await patched).postDataJSON().isActive).toBe(false);
    });
    await openEdit(page, 'Divisions');
    await test.step(`Reload — expect "${name}" with Active unticked`, async () => {
      const key = await keyOf(page, 'dname-', name);
      await expect(rowOf(page, `dname-${key}`).getByRole('checkbox', { name: 'Active' })).not.toBeChecked();
    });
  });

  test('SA-EDIV-11 divisions save one at a time: a failed 2nd new row stops the 3rd', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const names = [1, 2, 3].map((i) => `QA Div 11-${i} ${tag}`);
    let posts = 0;
    await openEdit(page, 'Divisions');
    await test.step(`Answer the 2nd POST /api/tenants/${slug}/departments with 500 {"error":{"message":"QA: simulated failure on the 2nd division"}}`, () =>
      page.route(`**/api/tenants/${slug}/departments`, (route) => {
        if (route.request().method() !== 'POST') return route.continue();
        posts += 1;
        return posts === 2 ? route.fulfill({ status: 500, json: { error: { message: 'QA: simulated failure on the 2nd division' } } }) : route.continue();
      }),
    );
    await test.step(`+ Add division ×3: ${names.join(', ')}; Save divisions`, async () => {
      for (const name of names) await addDivision(page, { name });
      await page.getByRole('button', { name: 'Save divisions' }).click();
      await expect(page.getByRole('button', { name: 'Save divisions' })).toBeEnabled({ timeout: 30_000 });
    });
    await test.step('Expect the error shown and exactly two POSTs (the 3rd never attempted)', async () => {
      await expect.soft(page.getByText('QA: simulated failure on the 2nd division')).toBeVisible();
      expect(posts).toBe(2);
    });
    await page.unroute(`**/api/tenants/${slug}/departments`);
    await openEdit(page, 'Divisions');
    await test.step(`Reload — expect "${names[0]}" saved, "${names[1]}" and "${names[2]}" not`, async () => {
      const listed = await values(page, 'dname-');
      expect(listed).toContain(names[0]);
      expect(listed).not.toContain(names[1]);
      expect(listed).not.toContain(names[2]);
    });
  });

  // ---------- Roles tab ----------

  test('SA-EROL-04 a new role and its permissions persist', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const name = `QA Role ${tag}`;
    const perms = ['users:read', 'divisions:read', 'assistant:search'];
    await createRole(page, name, perms);
    await openEdit(page, 'Roles');
    await test.step(`Reload; open "${name}" — expect ${perms.join(', ')} ticked and users:manage not`, async () => {
      await selectRole(page, name);
      for (const p of perms) await expect(page.getByRole('checkbox', { name: p, exact: true })).toBeChecked();
      await expect.soft(page.getByRole('checkbox', { name: 'users:manage', exact: true })).not.toBeChecked();
    });
  });

  test('SA-EROL-05 a role is renamed on blur, with no explicit save', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const [from, to] = [`QA Rename ${tag}`, `QA Renamed ${tag}`];
    await createRole(page, from);
    await test.step(`Type "${to}" in the role name; click elsewhere — expect PATCH …/roles/<id> 2xx`, async () => {
      const renamed = page.waitForResponse((r) => r.request().method() === 'PATCH' && /\/roles\/[^/]+$/.test(new URL(r.url()).pathname));
      await page.locator('#role-rename').fill(to);
      await page.getByRole('heading', { name: 'Roles' }).click();
      expect((await renamed).ok()).toBe(true);
    });
    await openEdit(page, 'Roles');
    await test.step(`Reload — expect "${to}" listed and "${from}" gone`, async () => {
      await expect(roleButton(page, to)).toBeVisible();
      await expect(roleButton(page, from)).toHaveCount(0);
    });
  });

  test('SA-EROL-06 blurring an unchanged role name sends nothing', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const name = `QA Blur ${tag}`;
    await createRole(page, name);
    const writes: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET' && r.url().includes('/roles')) writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });
    await test.step('Focus the role name and click elsewhere without changing it', async () => {
      await page.locator('#role-rename').focus();
      await page.getByRole('heading', { name: 'Roles' }).click();
    });
    await test.step(`Type "  ${name}  " (same name, extra spaces); click elsewhere`, async () => {
      await page.locator('#role-rename').fill(`  ${name}  `);
      await page.getByRole('heading', { name: 'Roles' }).click();
    });
    await test.step('Wait 2 s — expect no role write request', async () => {
      await page.waitForTimeout(2_000); // asserting an absence: give a stray request time to appear
      expect(writes).toEqual([]);
    });
  });

  test('SA-EROL-07 clone copies permissions; a blank clone name falls back to the source name', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const [src, copy] = [`QA Clone src ${tag}`, `QA Clone ${tag}`];
    const perms = ['users:read', 'roles:read'];
    await createRole(page, src, perms);
    const clone = async (as: string) => {
      const cloned = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/clone'));
      await page.getByRole('textbox', { name: /clone/i }).fill(as);
      await page.getByRole('button', { name: /^Clone\b/ }).click();
      expect((await cloned).ok(), 'POST …/clone').toBe(true);
    };
    await test.step(`Clone "${src}" as "${copy}" — expect "${copy}" listed`, async () => {
      await clone(copy);
      await expect(roleButton(page, copy)).toBeVisible();
    });
    await test.step(`Open "${copy}" — expect exactly ${perms.join(', ')} ticked, as on the source`, async () => {
      await selectRole(page, copy);
      for (const p of perms) await expect(page.getByRole('checkbox', { name: p, exact: true })).toBeChecked();
      await expect(page.locator('input[type="checkbox"]:checked')).toHaveCount(perms.length);
    });
    await test.step(`Open "${src}"; clone with a blank name — expect a second role named "${src}"`, async () => {
      await selectRole(page, src);
      await clone('');
      await expect(roleButton(page, src)).toHaveCount(2);
    });
    await test.step(`Delete both clones ("${copy}" and the second "${src}")`, async () => {
      for (const [name, nth] of [[copy, 0], [src, 1]] as const) {
        await selectRole(page, name, nth);
        const deleted = page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes('/roles/'));
        await page.getByRole('button', { name: /^Delete\b/ }).click();
        expect((await deleted).ok()).toBe(true);
      }
    });
  });

  test('SA-EROL-08 deleting a role asks for no confirmation', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    const name = `QA Delete ${tag}`;
    await createRole(page, name);
    let dialog = false;
    page.on('dialog', (d) => {
      dialog = true;
      void d.dismiss();
    });
    await test.step(`Press Delete on "${name}" — expect DELETE …/roles/<id> 2xx at once, no dialog`, async () => {
      const deleted = page.waitForResponse((r) => r.request().method() === 'DELETE' && r.url().includes('/roles/'));
      await page.getByRole('button', { name: /^Delete\b/ }).click();
      expect((await deleted).ok()).toBe(true);
      expect(dialog, 'a confirmation dialog appeared').toBe(false);
      await expect(roleButton(page, name)).toHaveCount(0);
    });
    await openEdit(page, 'Roles');
    await test.step(`Reload — expect "${name}" still gone`, async () => {
      await expect(roleButton(page, name)).toHaveCount(0);
    });
  });

  // ---------- Archive D ----------

  test('SA-ESTA-13 inactive, suspended and archived look the same to a ministry user', async ({ page }, testInfo) => {
    await onD(page, testInfo, 'This test leaves it archived.');
    const seen: Record<string, string> = {};
    const look = async (state: string) => {
      seen[state] = `${await page.title()}\n${(await page.locator('body').innerText()).replace(/\s+/g, ' ').trim()}`;
      await testInfo.attach(`portal-${state}`, { body: await page.screenshot(), contentType: 'image/png' });
    };
    for (const s of ['inactive', 'suspended'] as const) {
      await setStatus(page, slug, s);
      await expectPortal(page, env, slug, false);
      await look(s);
    }
    await test.step(`Open ${editUrl}; press Archive — expect "Archived. A new portal can be created for this ministry."`, async () => {
      await page.goto(editUrl);
      page.once('dialog', (d) => d.accept());
      await page.getByRole('button', { name: /^Archive\b/ }).click();
      await expect(page.getByText('Archived. A new portal can be created for this ministry.')).toBeVisible();
    });
    await expectPortal(page, env, slug, false);
    await look('archived');
    await test.step('Expect the same page (title and text) in all three states', () => {
      expect.soft(seen.suspended).toBe(seen.inactive);
      expect.soft(seen.archived).toBe(seen.inactive);
    });
  });

  test('SA-ESTA-11 an archived portal shows the unavailable page', async ({ page }, testInfo) => {
    await onD(page, testInfo);
    await retire(page, slug);
    await test.step(`Expect ${slug} archived`, async () => {
      expect(await apiStatus(page, slug)).toBe('archived');
    });
    await expectPortal(page, env, slug, false);
  });

  // ---------- Ministry exclusivity ----------

  test('SA-MIN-03 two concurrent creates for one free ministry: exactly one 201', async ({ page }, testInfo) => {
    const already = (await Promise.all([raceA, raceB].map((s) => exists(page, s)))).some(Boolean);
    test.skip(already, `${raceA}/${raceB} already exist — the race already ran in this run (worker restart); clean-up archives them`);
    const ministry = await test.step('Pick the first PQA_ADMIN_TEST_MINISTRIES ministry with no live portal (GET /api/ministries)', async () => {
      const m = await freeMinistry(page);
      expect(m, 'every PQA_ADMIN_TEST_MINISTRIES ministry already has a live portal').toBeDefined();
      return m!;
    });
    const body = await captureCreateBody(page, ministry, raceA);
    try {
      const results = await test.step(`Fire two POST /api/tenants at once for "${ministry}", slugs ${raceA} and ${raceB}`, () =>
        Promise.all([raceA, raceB].map((s) => page.request.post('/api/tenants', { data: { ...body, tenant: { ...body.tenant, slug: s } }, failOnStatusCode: false }))),
      );
      await test.step('Expect exactly one 201; the other 409 "A portal for … already exists"', async () => {
        await testInfo.attach('race-answers', { body: (await Promise.all(results.map(answer))).join('\n'), contentType: 'text/plain' });
        expect(results.filter((r) => r.status() === 201)).toHaveLength(1);
        const loser = results.find((r) => r.status() !== 201)!;
        expect(loser.status()).toBe(409);
        expect((await loser.json()).error?.message).toMatch(/A portal for .+ already exists/);
      });
    } finally {
      await retire(page, raceA);
      await retire(page, raceB);
    }
  });

  test('SA-MIN-05 un-archiving D is refused while another portal holds its ministry', async ({ page }, testInfo) => {
    await onD(page, testInfo, `This test archives ${slug} if needed and creates a second disposable tenant ${slug2} for the same ministry; both end archived.`);
    const d2 = await page.request.get(`/api/tenants/${slug2}`);
    test.skip(d2.status() === 200 && (await d2.json()).data.tenant.status === 'archived', `${slug2} is already archived — this check already ran in this run`);
    const ministry: string = (await getTenant(page)).tenant.tenantName;
    await retire(page, slug);
    try {
      if (d2.status() !== 200) {
        const body = await captureCreateBody(page, ministry, slug2);
        await test.step(`POST /api/tenants for "${ministry}" with slug ${slug2} — expect 201`, async () => {
          const res = await page.request.post('/api/tenants', { data: body, failOnStatusCode: false });
          expect(res.status(), await answer(res)).toBe(201);
        });
      }
      await test.step(`PATCH /api/tenants/${slug}/status {"status":"suspended"} (unarchive) — expect 409 "A portal for this ministry already exists"; ${slug} stays archived`, async () => {
        const res = await page.request.patch(`/api/tenants/${slug}/status`, { data: { status: 'suspended' }, failOnStatusCode: false });
        expect(res.status(), await answer(res)).toBe(409);
        expect((await res.json()).error?.message).toBe('A portal for this ministry already exists');
        expect(await apiStatus(page, slug)).toBe('archived');
      });
      await test.step(`Open ${editUrl}; press Unarchive — expect "A portal for this ministry already exists" and Unarchive still offered`, async () => {
        await page.goto(editUrl);
        page.once('dialog', (d) => d.accept());
        await page.getByRole('button', { name: /^Unarchive\b/ }).click();
        await expect(page.getByText('A portal for this ministry already exists')).toBeVisible();
        await expect(page.getByRole('button', { name: /^Unarchive\b/ })).toBeVisible();
        expect(await apiStatus(page, slug)).toBe('archived');
      });
    } finally {
      await retire(page, slug2);
      await retire(page, slug);
    }
  });

  test('cleanup: leave every tenant this file created archived', async ({ page }) => {
    for (const s of [slug, slug2, raceA, raceB]) await retire(page, s);
  });
});
