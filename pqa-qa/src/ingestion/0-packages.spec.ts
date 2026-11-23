import { setPackage } from './admin-config.js';
import { test, expect } from './fixtures.js';
import { loadIngestEnv } from './ingest-env.js';
import { keepAlive, stopIfExpired } from './portal.js';

// A3.1, components B3 "How to test" 1, spec §3.5 — SA-WBAS-32, 38, 39 (signed in): change the disposable ingestion
// tenant's package in Super Admin, then check the signed-in portal follows it: the sidebar, where sign-in lands,
// "Not available" on a deep link outside the package, and 403 {reason:"package_excluded"} from the portal BFF for the
// signed-in user. Every case ends with the tenant back on Platform + AI Assistant, which the ingestion phases need.
const ienv = loadIngestEnv();
const CASES = [
  { id: 'SA-WBAS-38', pkg: 'platform', name: 'Platform only', absent: ['AI Assistant'], present: ['Dashboard'], blockedPages: ['/ai-assistant', '/settings/file-ingestions'], blockedApi: ['assistant/chat-history'], openApi: ['dashboard/counts'] },
  { id: 'SA-WBAS-32', pkg: 'assistant', name: 'AI Assistant only', absent: ['Dashboard'], present: ['AI Assistant'], landing: /\/ai-assistant(\/|$)/, blockedPages: ['/parliament/secretary-dashboard', '/parliament/all-questions'], blockedApi: ['dashboard/counts', 'parliament/all-questions'], openApi: ['assistant/chat-history'] },
  { id: 'SA-WBAS-39', pkg: 'platform_ai', name: 'Platform + AI Assistant', absent: [], present: ['Dashboard', 'AI Assistant'], blockedPages: [], blockedApi: [], openApi: ['dashboard/counts', 'assistant/chat-history'] },
];

test.describe('packages, signed in to the portal', () => {
  test.skip(!ienv.allowWrites, 'writes to the shared environment are off — set PQA_ADMIN_ALLOW_WRITES=true');
  test.skip(!ienv.tenant, 'run npm run qa:ingest:provision first');

  for (const c of CASES) {
    test(`${c.id} signed in on "${c.name}": sidebar, landing, deep links and the portal API follow the package`, async ({ page, portal, portalPage }) => {
      stopIfExpired();
      test.setTimeout(300_000);
      const base = `${ienv.portalUrl}/${ienv.tenant}`;
      try {
        await setPackage(page, ienv.tenant!, c.pkg);
        await test.step(`Wait until the portal serves package "${c.pkg}" (5 s config cache)`, async () => {
          await expect.poll(async () => (await (await portal.get(`${base}/api/tenant-config`)).json().catch(() => ({}))).data?.tenant?.features?.package, { timeout: 30_000, intervals: [2_000, 3_000] }).toBe(c.pkg);
          await keepAlive(portal, ienv.portalUrl, ienv.tenant!);
        });
        await test.step(`Open the portal signed in — expect the sidebar to have ${c.present.join(', ') || 'its entries'}${c.absent.length ? ` and not ${c.absent.join(', ')}` : ''}${c.landing ? ', landing on the AI Assistant' : ''}`, async () => {
          // Pages can lag the public tenant-config after a switch (seen 23 Oct): poll, and record how long it took.
          const t0 = Date.now();
          if (c.landing) {
            await expect.poll(async () => {
              await portalPage.goto(base);
              await portalPage.waitForLoadState('networkidle');
              return new URL(portalPage.url()).pathname;
            }, { message: 'sign-in lands on the AI Assistant', timeout: 45_000, intervals: [3_000, 5_000] }).toMatch(c.landing);
            test.info().annotations.push({ type: 'note', description: `landing followed the package after ${Math.round((Date.now() - t0) / 1000)} s` });
          } else {
            await portalPage.goto(base);
            await portalPage.waitForLoadState('networkidle');
          }
          // The AI Assistant page is full screen (only "Back to portal"): read the sidebar on KB Docs then.
          let nav = portalPage.getByRole('complementary').getByRole('navigation').first();
          if (!(await nav.isVisible())) {
            await portalPage.goto(`${base}/settings/file-ingestions`);
            nav = portalPage.getByRole('complementary').getByRole('navigation').first();
          }
          await expect(nav).toBeVisible();
          const names = (await nav.getByRole('link').allInnerTexts()).map((n) => n.trim());
          test.info().annotations.push({ type: 'note', description: `sidebar on ${c.pkg}: ${names.join(' · ')}` });
          for (const n of c.present) expect.soft(names, `sidebar has "${n}"`).toContain(n);
          for (const n of c.absent) expect.soft(names, `sidebar has no "${n}"`).not.toContain(n);
        });
        for (const path of c.blockedPages) {
          await test.step(`Deep link ${path} — expect "Not available", not the page`, async () => {
            await expect.poll(async () => {
              await portalPage.goto(`${base}${path}`);
              return portalPage.getByText(/not available/i).first().isVisible({ timeout: 5_000 }).catch(() => false);
            }, { message: `${path} on ${c.pkg} shows "Not available"`, timeout: 30_000, intervals: [3_000, 5_000] }).toBe(true).catch(async (e) => {
              const shown = (await portalPage.getByRole('main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
              expect.soft(shown, `${path} on ${c.pkg}: expected "Not available"`).toMatch(/not available/i);
              void e;
            });
          });
        }
        for (const p of c.blockedApi) {
          await test.step(`Signed in, GET /api/${p} — expect 403 package_excluded`, async () => {
            let got = '';
            for (const stop = Date.now() + 30_000; Date.now() < stop; await new Promise((r) => setTimeout(r, 3_000))) {
              const res = await portal.get(`${base}/api/${p}`, { failOnStatusCode: false });
              got = `${res.status()}${(await res.text()).includes('package_excluded') ? ' package_excluded' : ''}`;
              if (got === '403 package_excluded') break;
            }
            expect.soft(got, `/api/${p} on ${c.pkg}`).toBe('403 package_excluded');
          });
        }
        for (const p of c.openApi) {
          await test.step(`Signed in, GET /api/${p} — expect it not refused by the package`, async () => {
            const res = await portal.get(`${base}/api/${p}`, { failOnStatusCode: false });
            expect.soft((await res.text()).includes('package_excluded'), `/api/${p} on ${c.pkg} answered ${res.status()}`).toBe(false);
          });
        }
      } finally {
        if (c.pkg !== 'platform_ai') await setPackage(page, ienv.tenant!, 'platform_ai'); // the ingestion phases need it
      }
    });
  }
});
