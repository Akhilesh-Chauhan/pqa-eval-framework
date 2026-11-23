import { createHash } from 'node:crypto';
import type { Locator, Page } from '@playwright/test';
import { test, expect, requireWrites } from './fixtures.js';
import { loadAdminEnv } from './admin-env.js';
import type { AdminEnv } from './admin-env.js';
import { fillWizardToReview, nextButton } from './wizard.js';
import { DIVISIONS, LOGOS } from './tenant-profile.js';

// One new tenant per ministry in PQA_ADMIN_TEST_MINISTRIES, each under a throwaway slug:
// create → Active → Inactive → Suspended → Archive → Unarchive → Archive.
// Archiving is the end state: it releases the ministry, but the row stays listed as archived
// and the slug can never be reused (spec §3.8, §9.3). The temporary hard delete (A2.1) is not used here.

type Status = 'active' | 'inactive' | 'suspended' | 'archived';
const LABEL: Record<Exclude<Status, 'archived'>, string> = { active: 'Active', inactive: 'Inactive', suspended: 'Suspended' };

async function apiStatus(page: Page, slug: string): Promise<Status> {
  const res = await page.request.get(`/api/tenants/${slug}`);
  expect(res.status(), `GET /api/tenants/${slug}`).toBe(200);
  return (await res.json()).data.tenant.status;
}

/** A4.1: the Configuration tab shows one section at a time; the settings menu switches between them.
 * Whole words, case-sensitive, so the Configuration tab's own name never matches. */
async function showSection(page: Page, name: string): Promise<void> {
  const re = new RegExp(`(^|\\W)${name}(\\W|$)`);
  const main = page.getByRole('main');
  await main.getByRole('link', { name: re }).or(main.getByRole('button', { name: re })).or(main.getByRole('tab', { name: re })).first().click();
}

/** Opens the edit page on its Status section. */
async function openStatus(page: Page, slug: string): Promise<void> {
  await page.goto(`/tenants/${slug}/edit`);
  await showSection(page, 'Status');
}

// A4.1a on the live build (22 Oct): no Portal status dropdown — the Status card shows the current status as text and
// one button per move. Seen: inactive → "Activate portal" · "Suspend portal"; active → "Set portal inactive" ·
// "Suspend portal"; suspended → "Reactivate portal" · "Archive ministry"; archived → "Unarchive ministry".
const statusCard = (page: Page) => page.getByRole('region', { name: 'Status' });
const MOVE: Record<Exclude<Status, 'archived'>, RegExp> = {
  active: /^(Activate|Reactivate) portal$/,
  suspended: /^Suspend portal$/,
  inactive: /^Set portal inactive$/,
};
/** The status word the card shows. */
const shownStatus = (page: Page) => statusCard(page).getByText(/^(active|inactive|suspended)$/).first();

/** Presses `button`, then accepts its confirmation: a browser confirm, or an in-page dialog (never the UX4G widget,
 * which is a dialog on every page) — the live build moved several confirmations into the page. */
async function pressAndConfirm(page: Page, button: Locator): Promise<void> {
  page.once('dialog', (d) => void d.accept());
  await button.click();
  const modal = page.getByRole('dialog').or(page.getByRole('alertdialog')).filter({ hasNotText: 'Accessibility Options' }).first();
  if (await modal.waitFor({ timeout: 2_000 }).then(() => true, () => false)) await modal.getByRole('button', { name: /^(?!(Cancel|Close)$).+/ }).last().click();
}

async function setStatus(page: Page, slug: string, to: Exclude<Status, 'archived'>): Promise<void> {
  await test.step(`Open /tenants/${slug}/edit › Status and move it to "${LABEL[to]}"`, async () => {
    await openStatus(page, slug);
    const saved = page.waitForResponse((r) => r.url().endsWith(`/api/tenants/${slug}/status`) && r.request().method() === 'PATCH');
    await pressAndConfirm(page, statusCard(page).getByRole('button', { name: MOVE[to] }));
    expect((await saved).status()).toBe(200);
  });
  await test.step(`Expect "Portal status updated." and the API to report ${to}`, async () => {
    await expect(page.getByText('Portal status updated.')).toBeVisible();
    expect(await apiStatus(page, slug)).toBe(to);
  });
}

async function expectPortal(page: Page, env: AdminEnv, slug: string, serving: boolean): Promise<void> {
  await test.step(`Open ${env.portalUrl}/${slug} — expect it ${serving ? 'to serve' : 'to show the unavailable page'} within ~30 s (5 s config cache)`, async () => {
    await expect
      .poll(async () => {
        await page.goto(`${env.portalUrl}/${slug}`);
        return (await page.title()).includes('(Unavailable)');
      }, { timeout: 30_000, intervals: [3_000] })
      .toBe(!serving);
  });
}

const env = loadAdminEnv();
if (!env.ministries.length) {
  test('SA-WREV-07 tenant lifecycle', () => test.skip(true, 'set PQA_ADMIN_TEST_MINISTRIES in .env'));
}

for (const ministry of env.ministries) {
  // Same slug in every worker of this run: after a failure Playwright restarts the
  // worker and re-imports this file, and the remaining steps must find the same tenant.
  const slug = `qa${createHash('sha1').update(`${process.env.PQA_RUN_ID}:${ministry}`).digest('hex').slice(0, 4)}`;

  // Not serial: a failed check is recorded with evidence and the lifecycle carries on.
  // Clean-up is the last test, not afterAll, which would also run on a mid-run worker restart.
  test.describe(`A4.1a Tenant lifecycle — ${ministry} (writes)`, () => {
    requireWrites(env);
    test.skip(!env.tenantAdmin || !env.llm, 'set PQA_ADMIN_TENANT_ADMIN_* and PQA_ADMIN_LLM_* in .env');

    test(`SA-WREV-07 create a tenant for the test ministry as Inactive`, async ({ page }) => {
      await test.step(`Check "${ministry}" has no live portal (GET /api/ministries)`, async () => {
        const rows: Array<{ name: string; taken: boolean }> = (await (await page.request.get('/api/ministries')).json()).data;
        const row = rows.find((m) => m.name === ministry);
        expect(row, `"${ministry}" is not in the master list`).toBeDefined();
        expect(row?.taken, `"${ministry}" already has a live portal — pick another for PQA_ADMIN_TEST_MINISTRIES`).toBe(false);
      });
      await fillWizardToReview(page, { ministry, slug, adminName: env.tenantAdmin!.name, adminEmail: env.tenantAdmin!.email, llm: env.llm!, logos: LOGOS, divisions: DIVISIONS });
      const created = page.waitForResponse((r) => r.url().endsWith('/api/tenants') && r.request().method() === 'POST');
      await test.step('Step 7: keep "Inactive (recommended)" and press Create tenant', async () => {
        await expect(page.locator('#finalStatus')).toHaveValue('inactive');
        await page.getByRole('button', { name: 'Create tenant' }).click();
      });
      await test.step(`Expect 201 and "${ministry} provisioned"`, async () => {
        expect((await created).status()).toBe(201);
        await expect(page.getByText(`${ministry} provisioned`)).toBeVisible();
      });
    });

    test('SA-MIN-01 the claimed ministry is listed but disabled in the create wizard', async ({ page }) => {
      await test.step('Open /tenants/new', async () => {
        await page.goto('/tenants/new');
      });
      await test.step(`Expect "${ministry} (already provisioned)", disabled`, async () => {
        const option = page.locator('#ministryId option', { hasText: ministry });
        await expect(option).toHaveText(`${ministry} (already provisioned)`);
        await expect(option).toBeDisabled();
      });
    });

    test('SA-WREV-11 a tenant created as Inactive is inactive and its portal does not serve', async ({ page, env }, testInfo) => {
      testInfo.annotations.push({
        type: 'precondition',
        description: `SA-WREV-07 created ${slug} for ${ministry} through the wizard with step 7 "Initial status" left on "Inactive (recommended)"; the POST /api/tenants body carried "status":"inactive".`,
      });
      await test.step(`Open /tenants/${slug}/edit › Status — expect Portal status "Inactive"`, async () => {
        await openStatus(page, slug);
        await expect(shownStatus(page)).toBeVisible();
        await testInfo.attach('manage-page-status', { body: await page.screenshot(), contentType: 'image/png' });
        await expect.soft(shownStatus(page)).toHaveText('inactive');
      });
      await test.step(`GET /api/tenants/${slug} — expect status "inactive"`, async () => {
        expect.soft(await apiStatus(page, slug)).toBe('inactive');
      });
      await expectPortal(page, env, slug, false);
    });

    test('SA-ESTA-06 Active: the portal serves, and no Archive button is offered', async ({ page, env }) => {
      await setStatus(page, slug, 'active');
      await test.step('Expect no Archive button while active', async () => {
        await expect(page.getByRole('button', { name: /^Archive\b/ })).toHaveCount(0);
      });
      await expectPortal(page, env, slug, true);
    });

    test('SA-ESTA-09 archiving an active portal is refused', async ({ page }) => {
      const res = await test.step(`PATCH /api/tenants/${slug}/status {"status":"archived"} while active`, () =>
        page.request.patch(`/api/tenants/${slug}/status`, { data: { status: 'archived' }, failOnStatusCode: false }),
      );
      await test.step('Expect 409 "Only a suspended portal can be archived" and status still active', async () => {
        expect(res.status()).toBe(409);
        expect(JSON.stringify(await res.json())).toContain('Only a suspended portal can be archived');
        expect(await apiStatus(page, slug)).toBe('active');
      });
    });

    test('SA-ESTA-04 Inactive: the portal shows the unavailable page', async ({ page, env }) => {
      await setStatus(page, slug, 'inactive');
      await expectPortal(page, env, slug, false);
    });

    test('SA-ECFG-14 Save configuration after a status change asks for a refresh; after reload it saves', async ({ page }) => {
      // By design (developer, 2026-10-12): the status save moves updatedAt, so the
      // page must be reloaded before a configuration save.
      await setStatus(page, slug, 'active');
      // Save is disabled until something changes (live build, 22 Oct): toggle the accessibility bar to have a save.
      const bar = page.getByRole('switch', { name: 'Accessibility bar' });
      await test.step('Choose Basic Info; toggle Accessibility bar; press Save configuration without reloading', async () => {
        await showSection(page, 'Basic Info');
        await bar.click();
        await page.getByRole('button', { name: 'Save configuration' }).click();
      });
      await test.step('Expect the "modified elsewhere" refresh alert', async () => {
        await expect(page.getByText(/modified elsewhere/i)).toBeVisible();
      });
      await test.step('Reload, toggle Accessibility bar again, press Save configuration', async () => {
        await page.reload();
        await bar.click();
        await page.getByRole('button', { name: 'Save configuration' }).click();
      });
      await test.step('Expect "Configuration saved." and the status unchanged (active)', async () => {
        await expect(page.getByText(/^Configuration saved\.?$/).first()).toBeVisible(); // A4.1 "Configuration saved."; the live toast has no full stop
        expect(await apiStatus(page, slug)).toBe('active');
      });
    });

    test('SA-ESTA-05 Suspended: the portal shows the unavailable page and Archive appears', async ({ page, env }) => {
      await setStatus(page, slug, 'suspended');
      await test.step('Expect an Archive button', async () => {
        await expect(page.getByRole('button', { name: /^Archive\b/ })).toBeVisible();
      });
      await expectPortal(page, env, slug, false);
    });

    test('SA-ESTA-10 Archive: the tenant is archived and offers Unarchive', async ({ page }) => {
      await test.step(`Open /tenants/${slug}/edit › Status and press Archive (accept any confirmation)`, async () => {
        await openStatus(page, slug);
        await pressAndConfirm(page, page.getByRole('button', { name: /^Archive\b/ }));
      });
      await test.step('Expect "Archived. A new portal can be created for this ministry." and an Unarchive button', async () => {
        await expect(page.getByText('Archived. A new portal can be created for this ministry.')).toBeVisible();
        await expect(page.getByRole('button', { name: /^Unarchive\b/ })).toBeVisible();
        await expect(page.getByRole('button', { name: /^(Activate|Suspend) portal$/ })).toHaveCount(0);
        expect(await apiStatus(page, slug)).toBe('archived');
      });
    });

    test('SA-MIN-04 archiving released the ministry: it is selectable again', async ({ page }) => {
      await test.step('Open /tenants/new', async () => {
        await page.goto('/tenants/new');
      });
      await test.step(`Expect "${ministry}" enabled, without "(already provisioned)"`, async () => {
        const option = page.locator('#ministryId option', { hasText: ministry });
        await expect(option).toHaveText(ministry);
        await expect(option).toBeEnabled();
      });
    });

    test('SA-MIN-06 the archived slug cannot be reused', async ({ page }) => {
      await test.step(`Open /tenants/new; choose "${ministry}", type slug ${slug}, admin fields; Next`, async () => {
        await page.goto('/tenants/new');
        await page.locator('#ministryId').selectOption({ label: ministry });
        await page.locator('#slug').fill(slug);
        await page.locator('#adminName').fill(env.tenantAdmin!.name);
        await page.locator('#adminEmail').fill(env.tenantAdmin!.email);
        await nextButton(page).click();
      });
      await test.step('Expect "This slug belongs to an archived portal and cannot be reused." and still on step 0', async () => {
        await expect(page.getByText('This slug belongs to an archived portal and cannot be reused.')).toBeVisible();
        await expect(page.locator('#adminName')).toBeVisible();
      });
    });

    test('SA-ESTA-12 Unarchive returns the portal to suspended, not active; archive again', async ({ page, env }) => {
      await test.step(`Open /tenants/${slug}/edit › Status and press Unarchive`, async () => {
        await openStatus(page, slug);
        await pressAndConfirm(page, page.getByRole('button', { name: /^Unarchive\b/ }));
      });
      await test.step('Expect status suspended and the portal still unavailable', async () => {
        await expect(shownStatus(page)).toHaveText('suspended');
        expect(await apiStatus(page, slug)).toBe('suspended');
      });
      await expectPortal(page, env, slug, false);
      await test.step('Archive again so the ministry is released', async () => {
        await openStatus(page, slug);
        await pressAndConfirm(page, page.getByRole('button', { name: /^Archive\b/ }));
        await expect(page.getByText('Archived. A new portal can be created for this ministry.')).toBeVisible();
      });
    });

    test('cleanup: leave the tenant archived so the ministry is free', async ({ page }) => {
      await test.step(`Suspend then archive ${slug} unless it is already archived (or was never created)`, async () => {
        const res = await page.request.get(`/api/tenants/${slug}`);
        if (res.status() !== 200) return;
        const status: Status = (await res.json()).data.tenant.status;
        if (status === 'archived') return;
        if (status !== 'suspended') await page.request.patch(`/api/tenants/${slug}/status`, { data: { status: 'suspended' } });
        const archived = await page.request.patch(`/api/tenants/${slug}/status`, { data: { status: 'archived' } });
        expect(archived.status(), `could not archive ${slug} — archive it by hand`).toBe(200);
      });
    });
  });
}
