import { randomUUID } from 'node:crypto';
import { test, expect } from '../fixtures.js';
import { trackedGap } from '../../support/annotations.js';

// Signed out. Nothing here can change the environment: every write is either
// refused by the gate or, if the gate were missing, rejected as invalid input.

test.describe('A1.3 Route protection (signed out)', () => {
  test('SA-AUTH-01 a protected page redirects to /login carrying return_to', async ({ page }) => {
    await test.step('Open /tenants in a browser with no session', async () => {
      await page.goto('/tenants');
    });
    await test.step('Expect /login?return_to=/tenants', async () => {
      await expect(page).toHaveURL(/\/login\?return_to=(%2F|\/)tenants$/);
    });
  });

  test('SA-AUTH-02 a deep link keeps its full path in return_to', async ({ page, env }) => {
    const path = `/tenants/${env.testTenant}/edit`;
    await test.step(`Open ${path} with no session`, async () => {
      await page.goto(path);
    });
    await test.step(`Expect return_to=${path}`, async () => {
      const returnTo = new URL(page.url()).searchParams.get('return_to');
      expect(new URL(page.url()).pathname).toBe('/login');
      expect(returnTo).toBe(path);
    });
  });

  for (const [method, path, data] of [
    ['GET', '/api/tenants', undefined],
    ['GET', '/api/ministries', undefined],
    ['GET', '/api/admins', undefined],
    ['GET', '/api/tenants/{t}', undefined],
    ['POST', '/api/tenants', {}],
    ['PATCH', '/api/tenants/{t}', {}],
    ['PATCH', '/api/tenants/{t}/status', { status: 'not-a-status' }],
    ['POST', '/api/admins/otp/request', { name: 'QA', email: 'qa@example.com' }],
    // 21 Oct spec: the temporary delete (a random UUID no tenant has) and the Bedrock model check.
    ['DELETE', '/api/tenants', { ids: [randomUUID()] }],
    ['POST', '/api/llm/bedrock-models', {}],
  ] as const) {
    test(`${method === 'GET' ? 'SA-AUTH-03' : 'SA-SEC-13'} ${method} ${path} without a session is 401 JSON, not a redirect`, async ({ request, env }) => {
      const url = path.replace('{t}', env.testTenant);
      const res = await test.step(`Send ${method} ${url} with no cookies`, () =>
        request.fetch(url, { method, data, maxRedirects: 0, failOnStatusCode: false }),
      );
      await test.step('Expect 401 with a JSON error body', async () => {
        expect(res.status()).toBe(401);
        expect(res.headers()['content-type']).toContain('application/json');
        expect(await res.json()).toHaveProperty('error');
      });
    });
  }

  test('SA-API-19 GET /api/auth/session without a session is 401', async ({ request }) => {
    const res = await test.step('Send GET /api/auth/session with no cookies', () =>
      request.get('/api/auth/session', { failOnStatusCode: false }),
    );
    await test.step('Expect 401', async () => expect(res.status()).toBe(401));
  });
});

test.describe('A1.2 Sign-in page', () => {
  test('SA-AUTH-07 the sign-in page offers email + Send code', async ({ page }) => {
    await test.step('Open /login', async () => {
      await page.goto('/login');
    });
    await test.step('Expect an Email field and a Send code button', async () => {
      await expect(page.locator('#admin-email')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Send code' })).toBeVisible();
    });
  });

  test('SA-AUTH-06 the sign-in page offers "Sign in with Parichay"', async ({ page }, testInfo) => {
    trackedGap(testInfo, {
      tracker: 'deployed-env deviation',
      owner: 'admin team',
      detail: 'components.md A1.2 says the Parichay button is always present; pqa-admin.myscheme.in shows only the OTP form (seen 2026-10-09)',
    });
    await test.step('Open /login', async () => {
      await page.goto('/login');
    });
    await test.step('Expect a "Sign in with Parichay" control', async () => {
      await expect(page.getByRole('button', { name: /Parichay/i }).or(page.getByRole('link', { name: /Parichay/i }))).toBeVisible({ timeout: 5_000 });
    });
  });

  test('SA-AUTH-08 an OTP request with no email is refused and sends nothing', async ({ request }) => {
    const res = await test.step('Send POST /api/auth/otp/request with an empty body', () =>
      request.post('/api/auth/otp/request', { data: {}, failOnStatusCode: false }),
    );
    await test.step("Expect 400 Missing 'email'", async () => {
      expect(res.status()).toBe(400);
      expect(JSON.stringify(await res.json())).toContain("Missing 'email'");
    });
  });
});
