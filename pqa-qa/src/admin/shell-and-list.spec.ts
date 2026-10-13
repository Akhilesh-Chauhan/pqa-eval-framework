import type { APIResponse, Page } from '@playwright/test';
import { test, expect, blockWrites } from './fixtures.js';

// Signed in, read-only. Never press "Sign out": it revokes the shared automation session.

interface Bundle {
  tenant: { tenantName: string; slug: string; status: string; updatedAt: string };
}

async function apiTenants(page: Page): Promise<Bundle[]> {
  const res = await page.request.get('/api/tenants');
  expect(res.status(), 'GET /api/tenants').toBe(200);
  return (await res.json()).data;
}

/** Opens /login while signed in and waits for the on-mount redirect off the page. */
async function leaveLogin(page: Page, query: string): Promise<URL> {
  await page.goto(`/login${query}`);
  await page.waitForURL((u) => u.pathname !== '/login', { timeout: 10_000 });
  return new URL(page.url());
}

const setCookies = (res: APIResponse): string[] =>
  res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value);

const row = (page: Page, slug: string) =>
  page.locator('table tbody tr').filter({ has: page.getByRole('link', { name: `/${slug}`, exact: true }) });

test.describe('A1.2 Sign-in page while signed in', () => {
  test('SA-AUTH-18 a tampered return_to falls back to /tenants and never leaves the origin', async ({ page, env }) => {
    const origin = new URL(env.adminUrl).origin;
    // If the redirect escapes, never actually load the other site.
    await page.route((u) => u.origin !== origin, (route) =>
      route.request().isNavigationRequest() ? route.fulfill({ contentType: 'text/html', body: 'left the admin origin' }) : route.continue(),
    );
    for (const target of ['/evil', '//evil.com']) {
      const landed = await test.step(`Open /login?return_to=${encodeURIComponent(target)}`, () =>
        leaveLogin(page, `?return_to=${encodeURIComponent(target)}`),
      );
      await test.step(`Expect /tenants on the admin origin (for ${target})`, async () => {
        // Soft, so every tampered value is checked even after the first one fails.
        expect.soft(landed.origin, `return_to=${target} left the admin origin`).toBe(origin);
        expect.soft(landed.pathname, `return_to=${target}`).toBe('/tenants');
      });
    }
  });

  test('SA-AUTH-19 /login sends a signed-in admin straight on to return_to', async ({ page }) => {
    const plain = await test.step('Open /login', () => leaveLogin(page, ''));
    await test.step('Expect /tenants', async () => expect(plain.pathname).toBe('/tenants'));
    const admins = await test.step('Open /login?return_to=%2Fadmins', () => leaveLogin(page, '?return_to=%2Fadmins'));
    await test.step('Expect /admins', async () => expect(admins.pathname).toBe('/admins'));
  });
});

test.describe('A6 Session cookies', () => {
  test('SA-AUTH-23 the session is silently restored from the refresh cookie alone', async ({ page, env }) => {
    await test.step('Remove only pqa_admin_session from the browser (keep pqa_admin_refresh)', async () => {
      await page.context().clearCookies({ name: 'pqa_admin_session' });
      const names = (await page.context().cookies()).map((c) => c.name);
      expect(names).toContain('pqa_admin_refresh');
      expect(names).not.toContain('pqa_admin_session');
    });
    const res = await test.step('GET /api/auth/session', () => page.request.get('/api/auth/session'));
    await test.step('Expect 200 with the session and a new pqa_admin_session in Set-Cookie', async () => {
      expect(res.status()).toBe(200);
      expect((await res.json()).user?.email).toBe(env.adminEmail);
      expect(setCookies(res).some((c) => /^pqa_admin_session=[^;]+/.test(c)), 'new pqa_admin_session set').toBe(true);
    });
    await test.step('Open /tenants — expect the page, not /login', async () => {
      await page.goto('/tenants');
      await expect(page).toHaveURL(/\/tenants$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Tenants' })).toBeVisible();
    });
  });

  test('SA-AUTH-28 /api/auth/session expires a legacy root-scoped pqa_session cookie', async ({ page, env }) => {
    try {
      await test.step('Add a pqa_session cookie with Path=/ on the admin host', async () => {
        await page.context().addCookies([{ name: 'pqa_session', value: 'qa-legacy', domain: new URL(env.adminUrl).hostname, path: '/', secure: true }]);
      });
      const res = await test.step('GET /api/auth/session', () => page.request.get('/api/auth/session'));
      await test.step('Expect 200 and Set-Cookie expiring pqa_session at Path=/', async () => {
        expect(res.status()).toBe(200);
        const cookies = setCookies(res);
        expect(cookies.some((c) => c.startsWith('pqa_session=') && /path=\/(;|$)/i.test(c) && /max-age=0|expires=thu, 01 jan 1970/i.test(c))).toBe(true);
        const legacy = cookies.map((c) => c.split('=')[0]).filter((n) => !n?.startsWith('pqa_admin_'));
        test.info().annotations.push({ type: 'question', description: `Legacy cookies expired: ${legacy.join(', ') || 'none'}` });
      });
    } finally {
      await page.context().clearCookies({ name: 'pqa_session' });
    }
  });
});

test.describe('A1.4 Navigation shell', () => {
  const ENTRIES = [
    ['Tenants All ministries', '/tenants'],
    ['Create tenant Provision a ministry', '/tenants/new'],
    ['Admins Platform administrators', '/admins'],
  ] as const;

  test('SA-NAV-01 the sidebar has Tenants, Create tenant and Admins', async ({ page }) => {
    await test.step('Open /tenants', () => page.goto('/tenants'));
    await test.step('Expect "Tenants — All ministries", "Create tenant — Provision a ministry", "Admins — Platform administrators"', async () => {
      for (const [name] of ENTRIES) await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
    });
  });

  test('SA-NAV-02 each sidebar entry opens its page', async ({ page }) => {
    await blockWrites(page);
    await test.step('Open /admins', () => page.goto('/admins'));
    for (const [name, path] of ENTRIES) {
      await test.step(`Click "${name}" — expect ${path}`, async () => {
        await page.getByRole('link', { name, exact: true }).click();
        await expect(page).toHaveURL(new RegExp(`${path}$`));
      });
    }
  });

  test('SA-NAV-03 the footer shows the signed-in email and a sign-out control', async ({ page, env }) => {
    await test.step('Open /tenants', () => page.goto('/tenants'));
    await test.step(`Expect "Signed in as ${env.adminEmail}" and a "Sign out" button (not pressed)`, async () => {
      await expect(page.getByText(`Signed in as ${env.adminEmail}`)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    });
  });

  test('SA-NAV-04 the footer shows "Checking sign-in…" while the session resolves', async ({ page, env }) => {
    await page.route('**/api/auth/session', async (route) => {
      await new Promise((r) => setTimeout(r, 2_000));
      await route.continue().catch(() => {});
    });
    await test.step('Delay GET /api/auth/session by 2 s and open /tenants', () => page.goto('/tenants'));
    await test.step('Expect "Checking sign-in…", then the signed-in email', async () => {
      await expect(page.getByText('Checking sign-in…')).toBeVisible();
      await expect(page.getByText(`Signed in as ${env.adminEmail}`)).toBeVisible({ timeout: 10_000 });
    });
  });
});

test.describe('A2 Tenant list', () => {
  test('SA-LIST-01 the table has Ministry, Status, Portal, Updated and a Manage button per row', async ({ page, env }) => {
    const t = (await apiTenants(page)).find((b) => b.tenant.slug === env.testTenant);
    await test.step('Open /tenants', () => page.goto('/tenants'));
    await test.step('Expect columns Ministry, Status, Portal, Updated', async () => {
      await expect(page.getByRole('columnheader')).toContainText(['Ministry', 'Status', 'Portal', 'Updated']);
    });
    await test.step('Expect a Manage button on every row', async () => {
      const rows = page.locator('table tbody tr');
      await expect(rows.first()).toBeVisible();
      await expect(rows.getByRole('button', { name: 'Manage' })).toHaveCount(await rows.count());
    });
    await test.step(`Expect the ${env.testTenant} row to show the ministry name with the slug beneath`, async () => {
      const ministry = row(page, env.testTenant).locator('td').first();
      await expect(ministry).toContainText(t?.tenant.tenantName ?? '(not in GET /api/tenants)');
      await expect(ministry).toContainText(env.testTenant);
    });
  });

  test('SA-LIST-02 every tenant is listed once with its API status', async ({ page }) => {
    const api = await test.step('GET /api/tenants', () => apiTenants(page));
    await test.step('Open /tenants', () => page.goto('/tenants'));
    const table = await test.step('Read the slug (Portal column) and status of every row', async () => {
      await expect(page.locator('table tbody tr').first()).toBeVisible();
      return page.locator('table tbody tr').evaluateAll((rows) =>
        rows.map((r) => ({ slug: r.children[2]?.textContent?.trim().replace(/^\//, ''), status: r.children[1]?.textContent?.trim() })),
      );
    });
    await test.step('Expect each API tenant exactly once, with the same status', async () => {
      for (const { tenant } of api) {
        const hits = table.filter((r) => r.slug === tenant.slug);
        expect.soft(hits.length, `rows for ${tenant.slug}`).toBe(1);
        expect.soft(hits[0]?.status, `status of ${tenant.slug}`).toBe(tenant.status);
      }
      expect(table.length).toBe(api.length);
    });
  });

  test('SA-LIST-03 each Portal link targets the ministry portal', async ({ page, env }) => {
    const api = await apiTenants(page);
    await test.step('Open /tenants', () => page.goto('/tenants'));
    await test.step(`Expect each /{slug} link to point at ${env.portalUrl}/{slug}`, async () => {
      for (const { tenant } of api) {
        await expect.soft(row(page, tenant.slug).getByRole('link', { name: `/${tenant.slug}`, exact: true })).toHaveAttribute('href', `${env.portalUrl}/${tenant.slug}`);
      }
      const target = await page.locator('table tbody tr td:nth-child(3) a').first().getAttribute('target');
      test.info().annotations.push({ type: 'question', description: `Portal link opens in ${target === '_blank' ? 'a new tab' : `the same tab (target=${target ?? 'none'})`}` });
    });
  });

  test.describe(() => {
    test.use({ timezoneId: 'Asia/Kolkata' });

    test('SA-LIST-04 Updated shows the API updatedAt in the browser time zone (IST)', async ({ page }) => {
      const api = await apiTenants(page);
      await test.step('Open /tenants in a browser set to Asia/Kolkata', () => page.goto('/tenants'));
      await test.step('Expect each Updated cell to equal updatedAt formatted by the browser (toLocaleString)', async () => {
        for (const { tenant } of api) {
          const local = await page.evaluate((iso) => new Date(iso).toLocaleString(), tenant.updatedAt);
          await expect.soft(row(page, tenant.slug).locator('td').nth(3), tenant.slug).toHaveText(local);
        }
      });
    });
  });

  test('SA-LIST-05 Manage opens the edit page for that tenant', async ({ page, env }) => {
    await blockWrites(page);
    const t = (await apiTenants(page)).find((b) => b.tenant.slug === env.testTenant);
    expect(t, `${env.testTenant} in GET /api/tenants`).toBeDefined();
    await test.step(`Open /tenants and press Manage on ${env.testTenant}`, async () => {
      await page.goto('/tenants');
      await row(page, env.testTenant).getByRole('link', { name: 'Manage' }).click();
    });
    await test.step(`Expect /tenants/${env.testTenant}/edit headed "${t?.tenant.tenantName}"`, async () => {
      await expect(page).toHaveURL(new RegExp(`/tenants/${env.testTenant}/edit$`));
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(t!.tenant.tenantName);
    });
  });

  test('SA-LIST-06 archived tenants stay listed as archived', async ({ page }) => {
    const archived = (await apiTenants(page)).filter((b) => b.tenant.status === 'archived');
    test.skip(!archived.length, 'no archived tenant on this environment');
    await test.step('Open /tenants', () => page.goto('/tenants'));
    await test.step(`Expect ${archived.length} archived tenant(s) listed with status "archived"`, async () => {
      for (const { tenant } of archived) await expect.soft(row(page, tenant.slug).locator('td').nth(1)).toHaveText('archived');
    });
    test.info().annotations.push({ type: 'question', description: 'A2 says "every tenant on the platform" — confirm archived rows are meant to stay listed.' });
  });

  test('SA-LIST-07 legacy rows outside the ministry master list render', async ({ page }) => {
    await blockWrites(page);
    const legacy = (await apiTenants(page)).filter((b) => ['demmmc', 'mindem'].includes(b.tenant.slug));
    test.skip(!legacy.length, 'neither demmmc nor mindem exists on this environment');
    for (const { tenant } of legacy) {
      await test.step(`Open /tenants — expect the ${tenant.slug} row ("${tenant.tenantName}")`, async () => {
        await page.goto('/tenants');
        await expect(row(page, tenant.slug).locator('td').first()).toContainText(tenant.tenantName);
      });
      await test.step(`Press Manage on ${tenant.slug} — expect the edit page headed "${tenant.tenantName}"`, async () => {
        await row(page, tenant.slug).getByRole('link', { name: 'Manage' }).click();
        await expect(page).toHaveURL(new RegExp(`/tenants/${tenant.slug}/edit$`));
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(tenant.tenantName);
      });
    }
    test.info().annotations.push({
      type: 'question',
      description: 'Are these pre-picker legacy rows expected, and should "Ministry of Commerce and Industry" stay selectable while "Demo Commerce" exists?',
    });
  });
});
