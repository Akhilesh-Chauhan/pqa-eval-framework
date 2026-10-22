import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect, blockWrites } from './fixtures.js';
import { fillWizardToReview, nextButton } from './wizard.js';
import { storageStatePath } from '../support/personas.js';
import { notMeasured } from '../support/annotations.js';

// Signed in. The real LLM key (PQA_ADMIN_LLM_API_KEY) is only ever compared, never typed, logged or
// put in a step title or assertion message. Wizard tests type a random marker instead, and run with
// writes aborted (blockWrites), so nothing is ever submitted.

const realKey = () => process.env.PQA_ADMIN_LLM_API_KEY?.trim() || undefined;

/** Every (path, value) pair whose key matches `re`, at any depth. */
function fieldsMatching(value: unknown, re: RegExp, path = ''): Array<{ path: string; value: unknown }> {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [...(re.test(k) ? [{ path: `${path}${k}`, value: v }] : []), ...fieldsMatching(v, re, `${path}${k}.`)]);
}

async function untakenMinistry(page: Page): Promise<string> {
  const rows: Array<{ name: string; taken: boolean }> = (await (await page.request.get('/api/ministries')).json()).data;
  const m = rows.find((r) => !r.taken);
  if (!m) throw new Error('every ministry is taken — the wizard cannot be walked');
  return m.name;
}

const slug = () => `qa${randomBytes(2).toString('hex')}`;

/** Walks the wizard to Review with a random marker as the API key; returns the marker. */
async function wizardWithMarkerKey(page: Page): Promise<string> {
  const marker = `qa-key-${randomBytes(6).toString('hex')}`;
  await fillWizardToReview(page, {
    ministry: await untakenMinistry(page),
    slug: slug(),
    adminName: 'QA Admin',
    adminEmail: 'qa.admin@example.gov.in',
    llm: { apiKey: marker, baseUrl: 'https://negd-gpus.in', model: 'qa-model', embeddingModel: 'qa-embed' },
  });
  return marker;
}

/** Step 0 with valid values, then Next (lands on Branding). */
async function wizardStep0(page: Page, adminName: string): Promise<void> {
  await page.goto('/tenants/new');
  await page.locator('#ministryId').selectOption({ label: await untakenMinistry(page) });
  await page.locator('#slug').fill(slug());
  await page.locator('#adminName').fill(adminName);
  await page.locator('#adminEmail').fill('qa.admin@example.gov.in');
  await nextButton(page).click();
  await expect(page.locator('#brandingPreset')).toBeVisible();
}

/** A4.1 (21 Oct spec): the edit page shows one section at a time; open `name` from its settings menu when it has one. */
async function openSection(page: Page, name: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  const re = new RegExp(`^${name}`, 'i');
  const entry = page.getByRole('link', { name: re }).or(page.getByRole('button', { name: re })).first();
  if (await entry.isVisible()) await entry.click();
}

/** Create guard (G): the wizard never attempted POST /api/tenants. */
function expectNoCreate(attempts: Array<{ method: string; path: string }>): void {
  expect(attempts.map((a) => `${a.method} ${a.path}`)).not.toContain('POST /api/tenants');
}

test.describe('LLM API key', () => {
  test('SA-SEC-01 the LLM API key is never returned by the API', async ({ page, env }) => {
    const key = realKey();
    if (!key) test.info().annotations.push({ type: 'note', description: 'PQA_ADMIN_LLM_API_KEY not set: only the key-field check ran' });
    for (const path of ['/api/tenants', `/api/tenants/${env.testTenant}`]) {
      const res = await test.step(`GET ${path}`, () => page.request.get(path));
      await test.step('Expect no non-empty API-key or Bedrock-key field and not the configured key anywhere in the body', async () => {
        expect(res.status()).toBe(200);
        const text = await res.text();
        // 21 Oct spec §3.3: Bedrock keys are write-only too (only the internal llm-runtime route returns them).
        const KEYS = /^(apiKey|llmApiKey|bedrockAccessKeyId|bedrockSecretAccessKey|awsAccessKeyId|awsSecretAccessKey|accessKeyId|secretAccessKey)$/i;
        const filled = fieldsMatching(JSON.parse(text), KEYS).filter((f) => typeof f.value === 'string' && f.value !== '');
        expect(filled.map((f) => f.path), 'non-empty key fields').toEqual([]);
        if (key) expect(text.includes(key), 'the configured LLM API key appears in the response').toBe(false);
      });
    }
  });

  test('SA-SEC-02 the API key never reaches the edit page', async ({ page, env }) => {
    const key = realKey();
    test.skip(!key, 'set PQA_ADMIN_LLM_API_KEY (the key stored on the test tenant)');
    await blockWrites(page);
    const bodies: Array<Promise<string>> = [];
    page.on('response', (r) => {
      if (r.url().startsWith(env.adminUrl) && ['document', 'fetch', 'xhr'].includes(r.request().resourceType())) bodies.push(r.text().catch(() => ''));
    });
    await test.step(`Open /tenants/${env.testTenant}/edit, let it finish loading, open LLM Config`, async () => {
      await page.goto(`/tenants/${env.testTenant}/edit`, { waitUntil: 'networkidle' });
      await openSection(page, 'LLM Config');
      await expect(page.locator('#llmApiKey')).toBeAttached();
    });
    await test.step('Search the HTML/DOM, every document/fetch response (incl. RSC payloads) and all input values for the key', async () => {
      const html = await page.content();
      const values = await page.evaluate(() => [...document.querySelectorAll('input, textarea')].map((e) => (e as HTMLInputElement).value).join('\n'));
      const responses = (await Promise.all(bodies)).join('\n');
      expect(html.includes(key!), 'key in the page HTML/DOM').toBe(false);
      expect(values.includes(key!), 'key in an input value').toBe(false);
      expect(responses.includes(key!), 'key in a response body').toBe(false);
    });
  });

  // Bedrock key masking: SA-WLLM-02. Bedrock keys never echoed by the model check: SA-WLLM-17.
  test('SA-SEC-03 the API key input is masked in the wizard and on the edit page', async ({ page, env }) => {
    const attempts = await blockWrites(page);
    await wizardWithMarkerKey(page);
    await test.step('Go back to step 4, LLM Config — expect #llmApiKey type="password"', async () => {
      await page.getByRole('button', { name: /^Step 4: LLM Config\b/ }).click();
      await expect(page.locator('#llmApiKey')).toHaveAttribute('type', 'password');
    });
    await test.step(`Open /tenants/${env.testTenant}/edit › LLM Config — expect #llmApiKey type="password"`, async () => {
      await page.goto(`/tenants/${env.testTenant}/edit`);
      await openSection(page, 'LLM Config');
      await expect(page.locator('#llmApiKey')).toHaveAttribute('type', 'password');
    });
    expectNoCreate(attempts);
  });

  test('SA-SEC-04 a typed API key is not echoed on Review or in the preview', async ({ page }) => {
    const attempts = await blockWrites(page);
    const marker = await wizardWithMarkerKey(page);
    await test.step('On Review & Submit, read the visible text of the summary and the portal preview — expect no key', async () => {
      expect((await page.locator('body').innerText()).includes(marker), 'typed key shown on the page').toBe(false);
    });
    expectNoCreate(attempts);
  });

  test('SA-SEC-05 record whether the typed key is kept in clear in the session-storage draft', async ({ page }) => {
    const attempts = await blockWrites(page);
    const marker = await wizardWithMarkerKey(page);
    await test.step('Read every sessionStorage entry on the admin origin; record whether the key is there', async () => {
      const entries = await page.evaluate(() => Object.entries(sessionStorage));
      const holding = entries.filter(([, v]) => v.includes(marker)).map(([k]) => k);
      test.info().annotations.push({
        type: 'question',
        description: holding.length
          ? `The typed API key is held in clear in sessionStorage (${holding.join(', ')}) — raise with the team`
          : `The typed API key is not in sessionStorage (${entries.length} entries: ${entries.map(([k]) => k).join(', ') || 'none'})`,
      });
    });
    expectNoCreate(attempts);
  });
});

test.describe('Admin session cookies', () => {
  test('SA-SEC-06 admin cookies are HttpOnly, Secure, SameSite=Strict and hidden from page script', async ({ page }) => {
    await test.step('GET /api/auth/session (renews the access cookie if it has expired)', async () => {
      expect((await page.request.get('/api/auth/session')).status()).toBe(200);
    });
    await test.step('Read pqa_admin_session and pqa_admin_refresh from the browser — expect httpOnly, secure, sameSite Strict', async () => {
      const cookies = await page.context().cookies();
      for (const name of ['pqa_admin_session', 'pqa_admin_refresh']) {
        const c = cookies.find((x) => x.name === name);
        expect.soft({ name, present: !!c, httpOnly: c?.httpOnly, secure: c?.secure, sameSite: c?.sameSite }).toEqual({ name, present: true, httpOnly: true, secure: true, sameSite: 'Strict' });
      }
    });
    await test.step('Open /tenants and read document.cookie — expect neither cookie', async () => {
      await page.goto('/tenants');
      expect((await page.evaluate(() => document.cookie)).includes('pqa_admin_'), 'admin cookie readable by page script').toBe(false);
    });
  });

  test('SA-SEC-07 record whether admin cookies are host-only', async ({ page, env }) => {
    await page.request.get('/api/auth/session');
    const host = new URL(env.adminUrl).hostname;
    await test.step(`Read the admin cookies' domain — expected host-only ${host}`, async () => {
      const cookies = (await page.context().cookies()).filter((c) => c.name.startsWith('pqa_admin_'));
      expect(cookies.length).toBeGreaterThan(0);
      for (const c of cookies) {
        test.info().annotations.push({ type: 'question', description: `${c.name}: domain=${c.domain} — ${c.domain === host ? 'host-only' : 'NOT host-only, reaches other hosts'}` });
      }
    });
  });

  test('SA-SEC-16 the admin session does not open a ministry portal', async ({ page, playwright, env }) => {
    const tenants: Array<{ tenant: { slug: string; status: string } }> = (await (await page.request.get('/api/tenants')).json()).data;
    // An inactive portal answers 403 TENANT_INACTIVE before it looks at the session, so probe an active one.
    const target = tenants.find((b) => b.tenant.slug === env.testTenant && b.tenant.status === 'active')?.tenant.slug
      ?? tenants.find((b) => b.tenant.status === 'active')?.tenant.slug;
    test.skip(!target, 'no active tenant to probe');
    await page.request.get('/api/auth/session');
    const access = (await page.context().cookies()).find((c) => c.name === 'pqa_admin_session')?.value;
    expect(!!access, 'admin access cookie present').toBe(true);
    // Only the access token: sending the refresh token could rotate (and so revoke) the shared admin session.
    const ctx = await playwright.request.newContext();
    try {
      const res = await test.step(`GET ${env.portalUrl}/${target}/api/auth/session carrying the admin access token as pqa_session`, () =>
        ctx.get(`${env.portalUrl}/${target}/api/auth/session`, { headers: { cookie: `pqa_session=${access}` } }),
      );
      await test.step('Expect a refusal (401, or 403 for a session from another tenant — spec §6.3) and no user in the body', async () => {
        expect([401, 403]).toContain(res.status());
        expect(await res.text()).not.toContain('"user"');
      });
    } finally {
      await ctx.dispose();
    }
    await test.step(`Open ${env.portalUrl}/00000000-0000-0000-0000-000000000001 (the platform tenant) — expect not-found`, async () => {
      await page.goto(`${env.portalUrl}/00000000-0000-0000-0000-000000000001`);
      await expect(page).toHaveTitle(/not found/i);
    });
    test.info().annotations.push({
      type: 'question',
      description: 'The super admin session belongs to platform tenant 00000000-…-0001 as "Tenant Admin" — is that tenant ever addressable from a portal?',
    });
  });

  test('SA-SEC-15 a ministry-portal session is not an admin session', async ({ playwright, env }, testInfo) => {
    const personas = ['platform-admin', 'parliament-admin', 'parliament-member', 'division-admin', 'division-member'] as const;
    const state = personas.map(storageStatePath).find(existsSync);
    if (!state) notMeasured(testInfo, { tracker: 'SA-SEC-15', owner: 'QA', detail: 'no ministry-portal storage state in src/.auth — run the isolation setup first' });
    const cookies: Array<{ name: string; value: string }> = JSON.parse(readFileSync(state!, 'utf8')).cookies;
    const portal = (name: string) => cookies.find((c) => c.name === name)?.value ?? '';
    const ctx = await playwright.request.newContext({ baseURL: env.adminUrl });
    try {
      const res = await test.step('GET /api/tenants carrying the portal pqa_session / pqa_refresh values as pqa_admin_session / pqa_admin_refresh', () =>
        ctx.get('/api/tenants', { headers: { cookie: `pqa_admin_session=${portal('pqa_session')}; pqa_admin_refresh=${portal('pqa_refresh')}` } }),
      );
      await test.step('Expect 401', async () => expect(res.status()).toBe(401));
    } finally {
      await ctx.dispose();
    }
  });
});

test.describe('return_to open redirect', () => {
  test('SA-SEC-08 return_to never leaves the admin origin', async ({ page, env }) => {
    const origin = new URL(env.adminUrl).origin;
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    // If the redirect escapes, never actually load the other site.
    await page.route((u) => u.origin !== origin, (route) =>
      route.request().isNavigationRequest() ? route.fulfill({ contentType: 'text/html', body: 'left the admin origin' }) : route.continue(),
    );
    // 21 Oct spec (§6.6): protocol-relative, absolute (even same-origin), backslash-bearing and credentialed values all collapse to /tenants.
    const variants = ['//evil.com', 'https://evil.com', '/\\evil.com', '\\\\evil.com', '/tenants\\evil', 'javascript:alert(1)', '/tenants@evil.com', '//user@evil.com/tenants', `${origin}/admins`];
    for (const target of variants) {
      await test.step(`Open /login?return_to=${encodeURIComponent(target)} — expect /tenants on the admin origin, no script run`, async () => {
        await page.goto(`/login?return_to=${encodeURIComponent(target)}`);
        await page.waitForURL((u) => u.pathname !== '/login', { timeout: 10_000 });
        const landed = new URL(page.url());
        expect(landed.origin).toBe(origin);
        expect.soft(landed.pathname).toBe('/tenants');
        expect(dialogs).toEqual([]);
      });
    }
  });
});

test.describe('Injection in the wizard', () => {
  const PAYLOADS = ['red; }', '#fff;}body{display:none}', 'var(--x)', 'url(https://evil.example/x.png)', 'expression(alert(1))', 'rgb(1,2,3)};'];

  test('SA-SEC-09 colour injection is refused in the wizard', async ({ page }) => {
    const attempts = await blockWrites(page);
    await test.step('Open /tenants/new; step 0 valid; Next to Branding', () => wizardStep0(page, 'QA Admin'));
    for (const field of ['#primaryColor', '#userMsgColor', '#override-brand']) {
      // The toggle keeps one name ("Exact tokens (advanced) …") open or shut, so open it only while it is collapsed.
      const showAdvanced = page.getByRole('button', { name: /^Exact tokens \(advanced\)/ });
      const open = async () => {
        if (field === '#override-brand' && (await showAdvanced.getAttribute('aria-expanded')) !== 'true') await showAdvanced.click();
      };
      await open();
      const original = await page.locator(field).inputValue();
      for (const value of PAYLOADS) {
        await test.step(`Type ${JSON.stringify(value)} in ${field}, press Next — expect "Enter a valid color.", still on Branding, no injected CSS`, async () => {
          await open();
          await page.locator(field).fill(value);
          await nextButton(page).click();
          await expect(page.getByRole('heading', { level: 2, name: 'Branding' })).toBeVisible();
          await expect(page.getByText('Enter a valid color.').first()).toBeVisible();
          const css = await page.evaluate(() =>
            [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n') +
            [...document.querySelectorAll('[style]')].map((e) => e.getAttribute('style')).join('\n'),
          );
          expect(css.includes(value), 'payload written into a style').toBe(false);
          await expect(page.locator('body')).toBeVisible();
          await expect(page.getByRole('complementary', { name: 'Portal preview' })).toBeVisible();
        });
      }
      await open();
      await page.locator(field).fill(original);
    }
    expectNoCreate(attempts);
  });

  test('SA-SEC-11 markup typed into free text stays inert in the wizard', async ({ page }) => {
    const XSS = '<img src=x onerror=alert(1)>';
    const attempts = await blockWrites(page);
    const dialogs: string[] = [];
    page.on('dialog', (d) => {
      dialogs.push(d.message());
      void d.dismiss();
    });
    await test.step(`Step 0: admin name ${XSS}; Next`, () => wizardStep0(page, XSS));
    await test.step('Step 1 Branding: keep defaults; Next', () => nextButton(page).click());
    await test.step(`Step 2: assistant name and welcome heading ${XSS}; Next`, async () => {
      await page.locator('#displayName').fill(XSS);
      await page.getByPlaceholder('Ready when you are.').fill(XSS);
      await page.getByPlaceholder(/^Your digital assistant for/).fill('QA subheading');
      await page.getByPlaceholder(/^Ask your queries here/).fill('QA placeholder');
      await nextButton(page).click();
    });
    await test.step('Step 3 LLM: placeholder values; Next. Step 4: keep; Next', async () => {
      await page.locator('#llmApiKey').fill('qa-not-a-real-key');
      await page.locator('#model').fill('qa-model');
      await page.locator('#embeddingModel').fill('qa-embed');
      await nextButton(page).click();
      await expect(page.locator('#filesizeMb')).toBeVisible();
      await nextButton(page).click();
    });
    await test.step(`Step 5: + Add division, name ${XSS}, short name QAD`, async () => {
      await page.getByRole('button', { name: /^\+? ?Add division$/ }).click();
      await page.getByRole('textbox', { name: 'Division name' }).fill(XSS);
      await page.getByRole('textbox', { name: 'Short name' }).fill('QAD');
    });
    const preview = page.getByRole('complementary', { name: 'Portal preview' });
    await test.step('Preview Advanced Dashboard, then Generate — expect the payload shown as text', async () => {
      await expect(preview.getByText(XSS).first()).toBeVisible();
      await preview.getByRole('button', { name: 'Generate', exact: true }).click();
      await expect(preview.getByText(XSS).first()).toBeVisible();
    });
    await test.step('Expect no dialog and no <img src="x"> element anywhere', async () => {
      expect(dialogs).toEqual([]);
      await expect(page.locator('img[src="x"]')).toHaveCount(0);
    });
    expectNoCreate(attempts);
  });
});

test.describe('Server-side rules', () => {
  test('SA-SEC-14 the Super Admin email domain rule is enforced by the server', async ({ page }) => {
    // Trailing-space and upper-case variants (SA-ADM-10) are left out: a server that normalises them
    // would accept a valid domain and send a real code. The 21 Oct spec says the portal route refuses
    // them too; that is SA-SEC-22 (Manual).
    for (const email of ['x@gmail.com', 'x@digitalindia.gov.in.evil.com', 'x@evil-digitalindia.gov.in', 'x@sub.digitalindia.gov.in']) {
      const res = await test.step(`POST /api/admins/otp/request body {"name":"QA","email":"${email}"}`, () =>
        page.request.post('/api/admins/otp/request', { data: { name: 'QA', email } }),
      );
      await test.step('Expect 400 Super Admin email must be a @digitalindia.gov.in address.', async () => {
        expect.soft(res.status()).toBe(400);
        expect.soft(JSON.stringify(await res.json())).toContain('Super Admin email must be a @digitalindia.gov.in address.');
      });
    }
  });

  test('SA-SEC-18 storage names derive from the slug', async ({ page, env }, testInfo) => {
    const T = env.testTenant;
    const res = await test.step(`GET /api/tenants/${T}`, () => page.request.get(`/api/tenants/${T}`));
    const storage = fieldsMatching((await res.json()).data, /bucket|prefix|index/i).filter((f) => typeof f.value === 'string' && f.value !== '');
    if (!storage.length) notMeasured(testInfo, { tracker: 'SA-SEC-18', owner: 'admin team', detail: `GET /api/tenants/${T} exposes no bucket/prefix/index field — confirm the field names` });
    await test.step(`Expect every bucket/prefix/index value to derive from "${T}" (pqa-${T}, pqa_${T})`, async () => {
      for (const { path, value } of storage) {
        testInfo.annotations.push({ type: 'observed', description: `${path} = ${String(value)}` });
        // §3.6: a shared (non pqa-*) bucket may come from the environment, tenants split by key prefix.
        if (/bucket/i.test(path) && !String(value).startsWith('pqa-')) continue;
        expect.soft(String(value), path).toContain(T);
      }
    });
  });
});
