import { randomBytes, randomUUID } from 'node:crypto';
import type { APIResponse, Page } from '@playwright/test';
import { test, expect, requireWrites } from './fixtures.js';
import type { AdminEnv } from './admin-env.js';

// A2.1 / spec §9.5 — the TEMPORARY hard delete (to be removed before production). Only SA-DEL-07 lets a
// DELETE reach the server, and only for the disposable tenant it creates itself. Every other UI test runs
// under deleteGuard — each non-GET request the page makes (server actions included) is aborted unless the
// test answers it — and points the dialog only at archived disposable tenants. The platform tenant's id is
// never sent: SA-DEL-08 is Manual, local stack only.

type Tenant = { tenantName: string; slug: string; status: string };
const DISPOSABLE = /^q[a-z][0-9a-f]{4}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function tenants(page: Page): Promise<Tenant[]> {
  const res = await page.request.get('/api/tenants');
  expect(res.status(), 'GET /api/tenants').toBe(200);
  return ((await res.json()).data as Array<{ tenant: Tenant }>).map((b) => b.tenant);
}

/** Archived tenants that earlier runs created: the only rows the dialog tests point at. */
async function targets(page: Page, n: number): Promise<Tenant[]> {
  const found = (await tenants(page)).filter((t) => t.status === 'archived' && DISPOSABLE.test(t.slug)).slice(0, n);
  test.skip(found.length < n, `needs ${n} archived disposable tenant(s) (q?xxxx) to point the dialog at`);
  return found;
}

/** Aborts every non-GET request the page makes except sign-in, and lists the admin origin's own. Other sites' (the
 * UX4G accessibility widget posts usage tracking) are aborted without being listed. */
async function deleteGuard(page: Page): Promise<string[]> {
  const sent: string[] = [];
  const origin = new URL(String(test.info().project.use.baseURL)).origin;
  await page.route('**/*', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (['GET', 'HEAD'].includes(req.method()) || url.pathname.startsWith('/api/auth/')) return route.continue();
    if (url.origin === origin) sent.push(`${req.method()} ${url.pathname}`);
    return route.abort();
  });
  return sent;
}

/** slug → configTenantId from the list page's own data: the ids its Delete sends (the API bundles carry none). */
async function listIds(page: Page): Promise<Map<string, string>> {
  const html = (await page.content()).replace(/\\"/g, '"');
  return new Map([...html.matchAll(/"configTenantId":"([0-9a-f-]{36})"[^{}]*?"slug":"([a-z0-9-]+)"/gi)].map((m) => [m[2]!, m[1]!]));
}

async function message(res: APIResponse): Promise<string | undefined> {
  const json = await res.json().catch(() => undefined);
  return typeof json?.error === 'string' ? json.error : (json?.error?.message ?? json?.message);
}

// A row by its portal link's href: the link's name is now "Open <ministry> portal (/<slug>) in a new tab".
const row = (page: Page, slug: string) => page.locator('table tbody tr').filter({ has: page.locator(`a[href$="/${slug}"]`) });
const tick = (page: Page, t: Tenant) => row(page, t.slug).getByRole('checkbox', { name: `Select ${t.tenantName}` });
const deleteSelected = (page: Page) => page.getByRole('button', { name: /^Delete selected/ });
// The overflow trigger is "More actions for <ministry>" on the live build (A2.1 does not name it).
const rowMenu = (page: Page, slug: string) => row(page, slug).getByRole('button', { name: /^More actions for / });
const menuDelete = (page: Page) => page.getByRole('menuitem', { name: 'Delete', exact: true });
// The one with a Cancel button: the UX4G accessibility widget keeps its own dialog in every page.
const dialog = (page: Page) =>
  page.getByRole('dialog').or(page.getByRole('alertdialog')).filter({ has: page.getByRole('button', { name: 'Cancel' }) });

async function expectDialog(page: Page, title: string, names: string[]): Promise<void> {
  const d = dialog(page);
  await expect(d).toBeVisible();
  await expect(d.getByText(title, { exact: true })).toBeVisible();
  for (const n of names) await expect(d).toContainText(n);
  await expect.soft(d).toContainText(/cannot be undone/i);
  await expect.soft(d).toContainText(/configuration.*identity.*parliamentary/is);
}

test.describe('A2.1 Delete tenants (temporary) — dialogs, nothing sent', () => {
  test('SA-DEL-01 each row has a Select checkbox and a row-menu Delete; Delete selected is tagged Temporary and starts disabled', async ({ page, env }) => {
    const sent = await deleteGuard(page);
    const T = (await tenants(page)).find((t) => t.slug === env.testTenant);
    expect(T, `${env.testTenant} in GET /api/tenants`).toBeDefined();
    await test.step('Open /tenants', () => page.goto('/tenants'));
    await test.step('Expect "Delete selected" disabled, with a "Temporary" tag', async () => {
      await expect(deleteSelected(page)).toBeDisabled();
      await expect(page.getByText('Temporary', { exact: true }).first()).toBeVisible();
    });
    await test.step('Expect one unticked "Select <ministry>" checkbox per row', async () => {
      const rows = page.locator('table tbody tr');
      await expect(rows.first()).toBeVisible();
      await expect(rows.getByRole('checkbox', { name: /^Select / })).toHaveCount(await rows.count());
      await expect(tick(page, T!)).not.toBeChecked();
    });
    await test.step(`Open ${env.testTenant}'s row menu — expect a Delete entry (not pressed); close it with Escape`, async () => {
      await rowMenu(page, env.testTenant).click();
      await expect(menuDelete(page)).toBeVisible();
      await page.keyboard.press('Escape');
    });
    expect(sent).toEqual([]);
  });

  test('SA-DEL-02 a tick enables Delete selected; the dialog names the tenant and warns; Cancel sends nothing and keeps the tick', async ({ page }) => {
    const sent = await deleteGuard(page);
    const [t] = await targets(page, 1);
    await test.step('Open /tenants', () => page.goto('/tenants'));
    await test.step(`Tick "Select ${t!.tenantName}" on the archived ${t!.slug} row — expect Delete selected enabled`, async () => {
      await tick(page, t!).check();
      await expect(deleteSelected(page)).toBeEnabled();
    });
    await test.step(`Press Delete selected — expect "Delete ${t!.tenantName}?" naming it and warning it cannot be undone`, async () => {
      await deleteSelected(page).click();
      await expectDialog(page, `Delete ${t!.tenantName}?`, [t!.tenantName]);
    });
    await test.step('Press Cancel — expect the dialog gone, the tick kept, nothing sent', async () => {
      await dialog(page).getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog(page)).toHaveCount(0);
      await expect(tick(page, t!)).toBeChecked();
      expect(sent).toEqual([]);
    });
  });

  test('SA-DEL-03 two ticks give "Delete 2 tenants?" listing both; Cancel sends nothing', async ({ page }) => {
    const sent = await deleteGuard(page);
    const pair = await targets(page, 2);
    await test.step(`Open /tenants; tick ${pair.map((t) => t.slug).join(' and ')} (archived); press Delete selected`, async () => {
      await page.goto('/tenants');
      for (const t of pair) await tick(page, t).check();
      await deleteSelected(page).click();
    });
    await test.step('Expect "Delete 2 tenants?" listing both names', () => expectDialog(page, 'Delete 2 tenants?', pair.map((t) => t.tenantName)));
    await test.step('Press Cancel — expect nothing sent', async () => {
      await dialog(page).getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog(page)).toHaveCount(0);
      expect(sent).toEqual([]);
    });
  });

  test('SA-DEL-04 the row-menu Delete opens the same dialog; Cancel sends nothing', async ({ page }) => {
    const sent = await deleteGuard(page);
    const [t] = await targets(page, 1);
    await test.step(`Open /tenants; open the archived ${t!.slug} row menu; press Delete`, async () => {
      await page.goto('/tenants');
      await rowMenu(page, t!.slug).click();
      await menuDelete(page).click();
    });
    await test.step(`Expect "Delete ${t!.tenantName}?"`, () => expectDialog(page, `Delete ${t!.tenantName}?`, [t!.tenantName]));
    await test.step('Press Cancel — expect nothing sent', async () => {
      await dialog(page).getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog(page)).toHaveCount(0);
      expect(sent).toEqual([]);
    });
  });

  test('SA-DEL-05 Delete sends one DELETE /api/tenants with UUIDs, Cancel is disabled while it runs, failures show under the list and the ticks clear (answered by the test)', async ({ page }) => {
    const sent = await deleteGuard(page);
    const [t] = await targets(page, 1);
    const MOCK = 'QA mock: pqa-service unreachable';
    let body: { ids?: unknown[] } | undefined;
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    // Registered after the guard, so the test itself answers DELETE /api/tenants: nothing reaches the server.
    await page.route('**/api/tenants', async (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback();
      body = route.request().postDataJSON();
      await held;
      await route.fulfill({ json: { data: { deleted: [], failed: [{ id: body?.ids?.[0], message: MOCK }] } } });
    });
    await test.step(`Open /tenants; tick the archived ${t!.slug} row; Delete selected; press Delete in the dialog`, async () => {
      await page.goto('/tenants');
      await tick(page, t!).check();
      await deleteSelected(page).click();
      await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
    });
    await test.step('Expect one DELETE /api/tenants body {"ids":[<one UUID>]} and Cancel disabled while it is held', async () => {
      await expect.poll(() => body).toBeDefined();
      expect(body!.ids).toHaveLength(1);
      expect(String(body!.ids![0])).toMatch(UUID);
      expect(body!.ids![0], `${t!.slug}'s configTenantId`).toBe((await listIds(page)).get(t!.slug));
      await expect(dialog(page).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    });
    await test.step(`Answer {deleted:[], failed:[{message:"${MOCK}"}]} — expect the message under the list, the row still listed, the tick cleared`, async () => {
      release();
      await expect(page.getByText(MOCK)).toBeVisible();
      await expect(row(page, t!.slug)).toHaveCount(1);
      await expect(tick(page, t!)).not.toBeChecked();
      expect(sent).toEqual([]);
    });
  });
});

test.describe('A6 DELETE /api/tenants (temporary)', () => {
  test('SA-DEL-06 bad id lists are refused before anything is deleted; an unknown UUID is a per-id failure', async ({ page }) => {
    // Nothing here can match a tenant: refused bodies, random UUIDs, and an id no slug can have.
    const cases: Array<[string, Parameters<Page['request']['delete']>[1], string]> = [
      ['body "{bad"', { data: Buffer.from('{bad'), headers: { 'content-type': 'application/json' } }, 'Invalid JSON body'],
      ['body {"ids":[]}', { data: { ids: [] } }, 'Provide between 1 and 50 tenant ids'],
      ['body {"ids":[51 random UUIDs]}', { data: { ids: Array.from({ length: 51 }, () => randomUUID()) } }, 'Provide between 1 and 50 tenant ids'],
      ['body {"ids":["QA_NOT_A_UUID"]}', { data: { ids: ['QA_NOT_A_UUID'] } }, 'Each tenant id must be a UUID'],
    ];
    for (const [label, options, expected] of cases) {
      const res = await test.step(`DELETE /api/tenants ${label}`, () => page.request.delete('/api/tenants', options));
      await test.step(`Expect 400 ${expected}`, async () => {
        expect.soft(res.status()).toBe(400);
        expect.soft(await message(res)).toBe(expected);
      });
    }
    const unknown = randomUUID();
    const res = await test.step(`DELETE /api/tenants body {"ids":["${unknown}"]} (random: no tenant has it)`, () => page.request.delete('/api/tenants', { data: { ids: [unknown] } }));
    await test.step('Expect 200 {data:{deleted:[], failed:[{id, message:"Tenant not found"}]}}', async () => {
      expect(res.status()).toBe(200);
      const data = (await res.json()).data;
      expect(data.deleted).toEqual([]);
      expect(data.failed).toEqual([{ id: unknown, message: 'Tenant not found' }]);
    });
  });
});

test.describe('A2.1 Delete tenants (temporary) — real delete of a disposable tenant', () => {
  /** POST /api/tenants for `slug`, built from T's stored configuration with the .env admin and LLM key. */
  async function create(page: Page, env: AdminEnv, slug: string, ministry: { id: string; name: string }): Promise<void> {
    const res = await test.step(`POST /api/tenants: ${slug} for "${ministry.name}", status inactive, admin ${env.tenantAdmin!.email}`, async () => {
      const { createdAt, updatedAt, ...tenant } = (await (await page.request.get(`/api/tenants/${env.testTenant}`)).json()).data.tenant;
      const llm = { ...tenant.assistant.llm, provider: 'on_prem', baseUrl: env.llm!.baseUrl, model: env.llm!.model, embeddingModel: env.llm!.embeddingModel };
      return page.request.post('/api/tenants', {
        data: {
          tenant: { ...tenant, slug, tenantName: ministry.name, status: 'inactive', sourceWebsites: [], sourceWebsitesTrusted: false, openapiSpec: null, assistant: { ...tenant.assistant, llm } },
          ministryId: ministry.id,
          departments: [],
          admin: { ...env.tenantAdmin!, phone: '' },
          llmApiKey: env.llm!.apiKey,
        },
      });
    });
    await test.step('Expect 201, and the chosen "inactive" kept (spec §9.1)', async () => {
      expect(res.status(), await message(res)).toBe(201);
      expect.soft((await res.json()).data?.tenant?.status, 'status at creation').toBe('inactive');
    });
  }

  /** Deletes `t` through the list (Delete selected or its row menu). Only a DELETE of exactly `t`'s id — read from the
   * page just before — is let through: a hard delete cannot be undone, so a UI that sent another row's id is stopped. */
  async function deleteInUi(page: Page, t: Tenant, via: 'Delete selected' | 'row menu'): Promise<void> {
    await test.step('Open /tenants', () => page.goto('/tenants'));
    const ids = await listIds(page);
    const id = ids.get(t.slug);
    expect(id, `${t.slug}'s configTenantId in the list page's data`).toMatch(UUID);
    expect([...ids.values()].filter((v) => v === id), 'the id is unique on the page').toHaveLength(1);
    await page.route('**/api/tenants', (route) => {
      const req = route.request();
      if (req.method() !== 'DELETE') return route.fallback();
      const sent = (req.postDataJSON() as { ids?: unknown[] })?.ids ?? [];
      const ok = sent.length === 1 && sent[0] === id;
      if (!ok) test.info().annotations.push({ type: 'guard', description: `DELETE aborted: ids ${JSON.stringify(sent)} are not exactly ${t.slug}'s ${id}` });
      return ok ? route.continue() : route.abort();
    });
    await test.step(via === 'row menu' ? `${t.slug}'s row menu › Delete` : `Tick ${t.slug}, Delete selected`, async () => {
      if (via === 'row menu') {
        await rowMenu(page, t.slug).click();
        await menuDelete(page).click();
      } else {
        await tick(page, t).check();
        await deleteSelected(page).click();
      }
    });
    await test.step(`Expect "Delete ${t.tenantName}?"; press Delete — expect 200 deleted [1 id], failed [], and the row gone`, async () => {
      await expectDialog(page, `Delete ${t.tenantName}?`, [t.tenantName]);
      const done = page.waitForResponse((r) => r.url().endsWith('/api/tenants') && r.request().method() === 'DELETE', { timeout: 120_000 });
      await dialog(page).getByRole('button', { name: 'Delete', exact: true }).click();
      const res = await done;
      expect(res.status()).toBe(200);
      const data = (await res.json()).data;
      expect(data.failed, 'per-tenant failures').toEqual([]);
      expect(data.deleted).toHaveLength(1);
      await expect(row(page, t.slug)).toHaveCount(0);
    });
    await page.unroute('**/api/tenants');
  }

  test('SA-DEL-07 deleting a disposable tenant removes it and its portal; its slug and ministry can be used again', async ({ page, env }) => {
    requireWrites(env);
    test.skip(!env.tenantAdmin || !env.llm || !env.ministries.length, 'set PQA_ADMIN_TENANT_ADMIN_*, PQA_ADMIN_LLM_* and PQA_ADMIN_TEST_MINISTRIES in .env');
    test.setTimeout(300_000);
    await deleteGuard(page);
    const slug = `qd${randomBytes(2).toString('hex')}`;
    const ministry = await test.step('Pick the first PQA_ADMIN_TEST_MINISTRIES ministry with no live portal (GET /api/ministries)', async () => {
      const rows: Array<{ id: string; name: string; taken: boolean }> = (await (await page.request.get('/api/ministries')).json()).data;
      return env.ministries.map((m) => rows.find((r) => r.name === m)).find((r) => r && !r.taken);
    });
    test.skip(!ministry, 'every PQA_ADMIN_TEST_MINISTRIES ministry already has a live portal');
    const t: Tenant = { slug, tenantName: ministry!.name, status: 'inactive' };
    try {
      await create(page, env, slug, ministry!);
      await deleteInUi(page, t, 'Delete selected');
      await test.step(`Expect GET /api/tenants/${slug} 404 and ${env.portalUrl}/${slug} a not-found page`, async () => {
        expect((await page.request.get(`/api/tenants/${slug}`)).status()).toBe(404);
        await expect
          .poll(async () => {
            await page.goto(`${env.portalUrl}/${slug}`);
            return page.title();
          }, { timeout: 30_000, intervals: [5_000] })
          .toMatch(/not found/i);
      });
      await create(page, env, slug, ministry!);
      await deleteInUi(page, t, 'row menu');
    } finally {
      // Whatever failed, never leave the ministry claimed: suspend + archive what is left (A6 status route).
      if ((await page.request.get(`/api/tenants/${slug}`)).status() === 200) {
        await page.request.patch(`/api/tenants/${slug}/status`, { data: { status: 'suspended' } });
        const archived = await page.request.patch(`/api/tenants/${slug}/status`, { data: { status: 'archived' } });
        test.info().annotations.push({ type: 'cleanup', description: `${slug} left behind — suspended and archived (HTTP ${archived.status()})` });
      }
    }
  });
});
