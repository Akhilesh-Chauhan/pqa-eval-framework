import type { APIResponse } from '@playwright/test';
import { test, expect } from '../fixtures.js';

// Signed out. Nothing here can sign anyone in or send a code: the only cookies sent are
// deliberately bogus, and an OTP request the browser lets through is aborted by the test.

const setCookies = (res: APIResponse): string[] =>
  res.headersArray().filter((h) => h.name.toLowerCase() === 'set-cookie').map((h) => h.value);
const expires = (cookies: string[], name: string): boolean =>
  cookies.some((c) => c.startsWith(`${name}=`) && /max-age=0|expires=thu, 01 jan 1970/i.test(c));
const setsValue = (cookies: string[], name: string): boolean => cookies.some((c) => c.startsWith(`${name}=`) && !c.startsWith(`${name}=;`));

test.describe('A1.3 Route protection (signed out)', () => {
  test('SA-AUTH-04 an unauthenticated request clears the admin cookies', async ({ request, browser, env }) => {
    const res = await test.step('Send GET /api/tenants with bogus pqa_admin_session and pqa_admin_refresh cookies', () =>
      request.get('/api/tenants', { headers: { cookie: 'pqa_admin_session=qa-bogus; pqa_admin_refresh=qa-bogus' } }),
    );
    await test.step('Expect 401 and Set-Cookie expiring both admin cookies', async () => {
      expect(res.status()).toBe(401);
      expect.soft(expires(setCookies(res), 'pqa_admin_session'), 'pqa_admin_session expired').toBe(true);
      expect.soft(expires(setCookies(res), 'pqa_admin_refresh'), 'pqa_admin_refresh expired').toBe(true);
    });
    // Own context: the fixture would save a surviving bogus pqa_admin_refresh over the real session file.
    const ctx = await browser.newContext({ baseURL: env.adminUrl });
    try {
      const page = await ctx.newPage();
      await test.step('Open /tenants in a browser holding the same bogus cookies', async () => {
        await ctx.addCookies(['pqa_admin_session', 'pqa_admin_refresh'].map((name) => ({ name, value: 'qa-bogus', url: env.adminUrl })));
        await page.goto('/tenants');
      });
      await test.step('Expect /login?return_to=… and both admin cookies gone from the browser', async () => {
        await expect(page).toHaveURL(/\/login\?return_to=/);
        const names = (await ctx.cookies()).map((c) => c.name);
        expect.soft(names).not.toContain('pqa_admin_session');
        expect.soft(names).not.toContain('pqa_admin_refresh');
      });
    } finally {
      await ctx.close();
    }
  });

  test('SA-AUTH-05 /login and /api/auth/session are reachable without a session', async ({ page, request }) => {
    const nav = await test.step('Open /login', () => page.goto('/login'));
    await test.step('Expect 200 and the sign-in form', async () => {
      expect(nav?.status()).toBe(200);
      await expect(page.locator('#admin-email')).toBeVisible();
    });
    const res = await test.step('Send GET /api/auth/session with no cookies', () => request.get('/api/auth/session'));
    await test.step('Expect 401 with a JSON error body', async () => {
      expect(res.status()).toBe(401);
      expect(res.headers()['content-type']).toContain('application/json');
      expect(await res.json()).toHaveProperty('error');
    });
  });
});

test.describe('A1.2 Sign-in page', () => {
  test('SA-AUTH-09 a malformed email does not reach the verify step', async ({ page }) => {
    const sent: string[] = [];
    await page.route('**/api/auth/otp/request', (route) => {
      sent.push(route.request().postData() ?? '');
      return route.abort();
    });
    await test.step('Open /login, type "not-an-email" and press Send code', async () => {
      await page.goto('/login');
      await page.locator('#admin-email').fill('not-an-email');
      await page.getByRole('button', { name: 'Send code' }).click();
    });
    await test.step('Expect to stay on the email step with no OTP field; record who refused it', async () => {
      await expect(page.locator('#admin-email')).toBeVisible();
      await expect(page.locator('#admin-otp')).toHaveCount(0);
      const browserMessage = await page.locator('#admin-email').evaluate((el) => (el as HTMLInputElement).validationMessage);
      test.info().annotations.push({
        type: 'question',
        description: browserMessage
          ? `Refused by the browser: "${browserMessage}"; requests sent: ${sent.length}`
          : `No browser refusal; the request ${sent.length ? 'was sent (aborted by the test, so the server answer is not recorded)' : 'was not sent'}`,
      });
    });
  });

  test('SA-AUTH-20 an auth error in the URL is shown as a message, and markup in it never runs', async ({ page }) => {
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    // The spec names the parameter `error`; apps/admin/src/lib/auth reads `auth_error`. Send both.
    await test.step('Open /login?error=exchange_failed&auth_error=exchange_failed', async () => {
      await page.goto('/login?error=exchange_failed&auth_error=exchange_failed');
    });
    await test.step('Expect the error surfaced as a message', async () => {
      const alert = page.getByRole('alert').filter({ hasText: /\S/ }).first();
      await expect(alert).toBeVisible();
      test.info().annotations.push({ type: 'question', description: `Shown for exchange_failed: "${await alert.innerText()}"` });
    });
    const payload = '<script>alert(1)</script>';
    await test.step(`Open /login?error=${payload} (URL-encoded, also as auth_error)`, async () => {
      const res = await page.goto(`/login?error=${encodeURIComponent(payload)}&auth_error=${encodeURIComponent(payload)}`);
      // The deployed edge firewall answers 403 to a <script> in the query (seen 2026-10-12);
      // that is a pass for "markup never runs". Otherwise the login page must render normally.
      if (res?.status() === 403) {
        test.info().annotations.push({ type: 'question', description: 'Blocked at the edge with 403 Forbidden before reaching the app' });
      } else {
        await expect(page.locator('#admin-email')).toBeVisible();
      }
    });
    await test.step('Expect no dialog and no injected script element', async () => {
      expect(dialogs).toEqual([]);
      expect(await page.evaluate(() => [...document.scripts].some((s) => s.textContent?.trim() === 'alert(1)'))).toBe(false);
      const shown = await page.getByRole('alert').filter({ hasText: /\S/ }).allInnerTexts();
      test.info().annotations.push({ type: 'question', description: `Shown for an unknown code: ${shown.length ? `"${shown.join(' | ')}"` : 'nothing'}` });
    });
  });
});

test.describe('A6 Auth routes (signed out)', () => {
  test('SA-API-20 GET /api/admins without a session is 401', async ({ request }) => {
    const res = await test.step('Send GET /api/admins with no cookies', () => request.get('/api/admins'));
    await test.step('Expect 401; record the body (A6 says "Not signed in", A1.3 says "Unauthorized")', async () => {
      expect(res.status()).toBe(401);
      test.info().annotations.push({ type: 'question', description: `Body: ${await res.text()}` });
    });
  });

  test('SA-API-31 GET /api/auth/oauth/login redirects to the identity service', async ({ request, env }) => {
    const res = await test.step('Send GET /api/auth/oauth/login with no cookies, not following redirects', () =>
      request.get('/api/auth/oauth/login', { maxRedirects: 0 }),
    );
    await test.step('Expect a redirect away from the admin /login page', async () => {
      expect(res.status()).toBeGreaterThanOrEqual(300);
      expect(res.status()).toBeLessThan(400);
      const location = new URL(res.headers()['location'] ?? '', env.adminUrl);
      test.info().annotations.push({ type: 'observed', description: `Location: ${location.origin}${location.pathname}` });
      expect(location.pathname, 'bounced back to the admin /login — identity service not reached').not.toBe('/login');
    });
  });

  test('SA-SEC-20 a bogus OAuth handoff code sets no session', async ({ request }) => {
    // `code` is the catalogue's name; `sid` is the name apps/admin reads.
    for (const query of ['code=bogus', 'sid=bogus']) {
      const res = await test.step(`Send GET /api/auth/oauth/complete?${query} with no cookies, not following redirects`, () =>
        request.get(`/api/auth/oauth/complete?${query}`, { maxRedirects: 0 }),
      );
      await test.step('Expect no pqa_admin_* cookie set and no landing on /tenants', async () => {
        expect(setsValue(setCookies(res), 'pqa_admin_session'), 'pqa_admin_session set').toBe(false);
        expect(setsValue(setCookies(res), 'pqa_admin_refresh'), 'pqa_admin_refresh set').toBe(false);
        const location = res.headers()['location'];
        if (location) expect(new URL(location, 'http://x').pathname).not.toBe('/tenants');
        test.info().annotations.push({ type: 'question', description: `${query}: HTTP ${res.status()}${location ? ` → ${location}` : ''}` });
      });
    }
    await test.step('Send GET /api/auth/session with whatever cookies came back — expect 401', async () => {
      expect((await request.get('/api/auth/session')).status()).toBe(401);
    });
  });
});

test.describe('E1 Tenant isolation (signed out)', () => {
  test('SA-SEC-17 an unknown portal slug is an explicit not-found page', async ({ page, env }) => {
    for (const slug of ['commrce', 'qazzzz', 'admin']) {
      await test.step(`Open ${env.portalUrl}/${slug}`, async () => {
        await page.goto(`${env.portalUrl}/${slug}`);
      });
      await test.step('Expect a not-found page, never a ministry portal', async () => {
        await expect(page).toHaveTitle(/not found/i);
      });
    }
  });
});
