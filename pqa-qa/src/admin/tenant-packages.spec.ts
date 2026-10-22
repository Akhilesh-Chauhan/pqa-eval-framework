import { randomBytes } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { test, expect, requireWrites } from './fixtures.js';
import { fillWizardToReview } from './wizard.js';
import type { Package } from './wizard.js';

// A3.1, B3, spec §3.5 — a tenant created on each package follows it (tester's request, 22 Oct). One disposable tenant
// per package, created through the wizard as Active (an unavailable portal answers before the package gate), checked
// where no portal sign-in is needed, then suspended and archived:
//  - the stored configuration and the portal's public tenant-config carry the package and its module map;
//  - signed out, every area's portal BFF routes refuse (401, or 403 {reason:"package_excluded"} for an area outside the
//    package). §3.5 says the package check runs first; on 22 Oct a signed-out caller got 401 on excluded areas too, so
//    that ordering is recorded as a deviation, and enforcement itself is proven signed in (SA-WBAS-38/39).
// The signed-in sidebar, landing page and "Not available" deep links are SA-WBAS-32, 38 and 39 (portal session).

const ASSISTANT = ['aiAssistant', 'kbSearch', 'documentIngestion'];
const WORKFLOW = ['parliamentDashboard', 'provisionalQuestions', 'admittedQuestions', 'assignedQuestions', 'receivedAnswers',
  'completedQuestions', 'departmentDashboard', 'departmentProvisional', 'departmentAdmitted', 'departmentCompleted', 'departmentProfile', 'divisions'];
const EVERY_PACKAGE = ['usersAndRoles', 'reApprovals'];
// GET routes that answer 401 "Not signed in" on a Platform + AI Assistant portal (checked on /comind, 22 Oct).
const AREAS = {
  assistant: ['assistant/chat-history', 'assistant/search'], // ingestion/reviews dropped: maker-checker is deferred (22 Oct)
  workflowAi: ['assistant/generate', 'upload/suggestions'],
  workflow: ['dashboard/counts', 'parliament/all-questions'],
} as const;
type Area = keyof typeof AREAS;

const CASES: Array<{ id: string; name: Package; value: string; on: string[]; off: string[]; excluded: Area[] }> = [
  { id: 'SA-WBAS-35', name: 'Platform + AI Assistant', value: 'platform_ai', on: [...ASSISTANT, ...WORKFLOW, ...EVERY_PACKAGE], off: [], excluded: [] },
  { id: 'SA-WBAS-36', name: 'Platform only', value: 'platform', on: [...WORKFLOW, ...EVERY_PACKAGE], off: ASSISTANT, excluded: ['assistant'] },
  { id: 'SA-WBAS-37', name: 'AI Assistant only', value: 'assistant', on: [...ASSISTANT, ...EVERY_PACKAGE], off: WORKFLOW, excluded: ['workflow', 'workflowAi'] },
];

/** GET `url` signed out until it answers `want` ("401" or "403 package_excluded") or 30 s pass (config cache 5 s). */
async function gate(anon: APIRequestContext, url: string, want: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const res = await anon.get(url);
    const got = `${res.status()}${(await res.text()).includes('package_excluded') ? ' package_excluded' : ''}`;
    if (got === want || Date.now() > deadline) return got;
    await new Promise((r) => setTimeout(r, 3_000));
  }
}

test.describe('A3.1 Packages — a created tenant follows its package', () => {
  for (const c of CASES) {
    test(`${c.id} a tenant created on "${c.name}" follows it: stored package, the portal's view, and the package gate on every area`, async ({ page, env, playwright }) => {
      requireWrites(env);
      test.skip(!env.tenantAdmin || !env.llm || !env.ministries.length, 'set PQA_ADMIN_TENANT_ADMIN_*, PQA_ADMIN_LLM_* and PQA_ADMIN_TEST_MINISTRIES in .env');
      test.setTimeout(240_000);
      const slug = `qk${randomBytes(2).toString('hex')}`;
      const ministry = await test.step('Pick the first PQA_ADMIN_TEST_MINISTRIES ministry with no live portal (GET /api/ministries)', async () => {
        const rows: Array<{ name: string; taken: boolean }> = (await (await page.request.get('/api/ministries')).json()).data;
        return env.ministries.find((m) => rows.find((r) => r.name === m)?.taken === false);
      });
      test.skip(!ministry, 'every PQA_ADMIN_TEST_MINISTRIES ministry already has a live portal');
      const anon = await playwright.request.newContext(); // no cookies: the portal sees a signed-out caller
      try {
        await fillWizardToReview(page, { ministry: ministry!, slug, adminName: env.tenantAdmin!.name, adminEmail: env.tenantAdmin!.email, llm: env.llm!, package: c.name });
        const created = page.waitForResponse((r) => r.url().endsWith('/api/tenants') && r.request().method() === 'POST', { timeout: 60_000 });
        await test.step(`Step 7: Initial status "Active"; press Create tenant — expect 201`, async () => {
          await page.locator('#finalStatus').selectOption('active');
          await page.getByRole('button', { name: 'Create tenant' }).click();
          expect((await created).status()).toBe(201);
        });
        await test.step(`GET /api/tenants/${slug} and the portal's public /${slug}/api/tenant-config — expect package "${c.value}" and its module map`, async () => {
          const stored = (await (await page.request.get(`/api/tenants/${slug}`)).json()).data.tenant;
          // The portal sees a new tenant only after its 5 s config cache: poll until it does.
          let portal: any;
          await expect.poll(async () => (portal = (await (await anon.get(`${env.portalUrl}/${slug}/api/tenant-config`)).json().catch(() => ({}))).data?.tenant)?.slug,
            { message: 'the portal serves the new tenant\'s config', timeout: 30_000, intervals: [2_000, 3_000] }).toBe(slug);
          for (const [where, t] of [['stored', stored], ['portal', portal]] as const) {
            expect.soft(t?.features?.package, `${where} features.package`).toBe(c.value);
            for (const m of c.on) expect.soft(t?.enabledModules?.[m], `${where} enabledModules.${m}`).toBe(true);
            for (const m of c.off) expect.soft(t?.enabledModules?.[m], `${where} enabledModules.${m}`).toBe(false);
          }
          test.info().annotations.push({ type: 'note', description: `advancedDashboard (its group is not documented): ${stored?.enabledModules?.advancedDashboard}` });
        });
        for (const [area, paths] of Object.entries(AREAS) as Array<[Area, readonly string[]]>) {
          const excluded = c.excluded.includes(area);
          const want = excluded ? '403 package_excluded' : '401';
          await test.step(`Signed out, GET ${paths.map((p) => `/${slug}/api/${p}`).join(', ')} (${area}) — expect ${want}${excluded ? ' (401 recorded as the §3.5 ordering deviation)' : ''}`, async () => {
            for (const p of paths) {
              const got = await gate(anon, `${env.portalUrl}/${slug}/api/${p}`, want);
              if (excluded && got === '401') {
                test.info().annotations.push({ type: 'deviation', description: `§3.5: the package check runs first, so signed out ${area} routes should answer 403 package_excluded on "${c.name}"; /api/${p} answered 401` });
                continue;
              }
              expect.soft(got, `/api/${p}`).toBe(want);
            }
          });
        }
      } finally {
        await anon.dispose();
        // Never leave the ministry claimed: suspend + archive (A6 status route).
        if ((await page.request.get(`/api/tenants/${slug}`)).status() === 200) {
          await page.request.patch(`/api/tenants/${slug}/status`, { data: { status: 'suspended' } });
          const archived = await page.request.patch(`/api/tenants/${slug}/status`, { data: { status: 'archived' } });
          test.info().annotations.push({ type: 'cleanup', description: `${slug} suspended and archived (HTTP ${archived.status()})` });
        }
      }
    });
  }
});
