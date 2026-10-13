import { createHash } from 'node:crypto';
import { test, expect, requireWrites } from '../admin/fixtures.js';
import { fillWizardToReview } from '../admin/wizard.js';
import { setEnvLine } from '../support/env-file.js';
import { loadIngestEnv } from './ingest-env.js';

// Creates the disposable ingestion tenant qi#### once (spec §4.1). `npm run qa:ingest:provision` then runs
// scripts/portal-login.mjs to sign in to its portal. Rerunning is safe: a live PQA_INGEST_TENANT is kept.
const ienv = loadIngestEnv();

test('create the disposable ingestion tenant and record it as PQA_INGEST_TENANT', async ({ page }) => {
  requireWrites(ienv);
  test.skip(!ienv.tenantAdmin || !ienv.llm || !ienv.ministries.length || !ienv.ingestAdminEmail, 'set PQA_ADMIN_TENANT_ADMIN_*, PQA_ADMIN_LLM_* and PQA_ADMIN_TEST_MINISTRIES in .env');
  test.setTimeout(180_000);
  if (ienv.tenant) {
    const res = await page.request.get(`/api/tenants/${ienv.tenant}`);
    const status: string = res.status() === 200 ? (await res.json()).data.tenant.status : 'missing';
    test.skip(status !== 'archived' && status !== 'missing', `${ienv.tenant} already exists (${status}) — nothing to do`);
  }
  const slug = `qi${createHash('sha1').update(`${Date.now()}`).digest('hex').slice(0, 4)}`;
  const ministry = await test.step('Pick the first PQA_ADMIN_TEST_MINISTRIES ministry with no live portal (GET /api/ministries)', async () => {
    const rows: Array<{ name: string; taken: boolean }> = (await (await page.request.get('/api/ministries')).json()).data;
    const free = ienv.ministries.find((m) => rows.find((r) => r.name === m)?.taken === false);
    expect(free, 'every PQA_ADMIN_TEST_MINISTRIES ministry already has a live portal').toBeDefined();
    return free!;
  });
  await fillWizardToReview(page, { ministry, slug, adminName: ienv.tenantAdmin!.name, adminEmail: ienv.ingestAdminEmail!, llm: ienv.llm! });
  const created = page.waitForResponse((r) => r.url().endsWith('/api/tenants') && r.request().method() === 'POST', { timeout: 60_000 });
  await test.step('Step 7: Initial status "Active"; press Create tenant', async () => {
    await page.locator('#finalStatus').selectOption('active');
    await page.getByRole('button', { name: 'Create tenant' }).click();
  });
  await test.step(`Expect 201; write PQA_INGEST_TENANT=${slug} to .env`, async () => {
    expect((await created).status()).toBe(201);
    setEnvLine('.env', 'PQA_INGEST_TENANT', slug);
    console.log(`ingestion tenant ${slug} created for ${ministry}: ${ienv.portalUrl}/${slug}`);
  });
});
