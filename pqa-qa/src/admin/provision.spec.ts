import { test, expect } from './fixtures.js';
import { fillWizardToReview } from './wizard.js';
import { DIVISIONS, LOGOS } from './tenant-profile.js';

// Provisions the standing Ministry of Commerce and Industry tenant that the ministry-portal phase
// uses (tester's decision, 2026-10-12): the wizard's suggested slug, the tester's own admin, the
// real LLM key, the tenant-profile logos and divisions, Active. The suite never archives it.
// Runs only when asked:
//   PQA_ADMIN_PROVISION=commerce npx playwright test --project=admin src/admin/provision.spec.ts
const MINISTRY = 'Ministry of Commerce and Industry';

test('provision the standing Ministry of Commerce and Industry tenant', async ({ page, env }) => {
  test.skip(process.env.PQA_ADMIN_PROVISION !== 'commerce', 'runs only with PQA_ADMIN_PROVISION=commerce');
  test.skip(!env.tenantAdmin || !env.llm, 'set PQA_ADMIN_TENANT_ADMIN_* and PQA_ADMIN_LLM_* in .env');

  const taken = await test.step(`Check "${MINISTRY}" has no live portal (GET /api/ministries)`, async () => {
    const rows: Array<{ name: string; taken: boolean }> = (await (await page.request.get('/api/ministries')).json()).data;
    const row = rows.find((m) => m.name === MINISTRY);
    expect(row, `"${MINISTRY}" is not in the master list`).toBeDefined();
    return row!.taken;
  });
  test.skip(taken, `"${MINISTRY}" already has a live portal — nothing to do`);

  await fillWizardToReview(page, {
    ministry: MINISTRY,
    adminName: env.tenantAdmin!.name,
    adminEmail: env.tenantAdmin!.email,
    llm: env.llm!,
    logos: LOGOS,
    divisions: DIVISIONS,
  });
  const created = page.waitForResponse((r) => r.url().endsWith('/api/tenants') && r.request().method() === 'POST');
  await test.step('Step 7: Initial status "Active"; press Create tenant', async () => {
    await page.locator('#finalStatus').selectOption('active');
    await page.getByRole('button', { name: 'Create tenant' }).click();
  });
  await test.step(`Expect 201 and "${MINISTRY} provisioned"; record the slug`, async () => {
    const res = await created;
    expect(res.status()).toBe(201);
    await expect(page.getByText(`${MINISTRY} provisioned`)).toBeVisible();
    const slug: string = (await res.json()).data.tenant.slug;
    test.info().annotations.push({ type: 'provisioned', description: `${MINISTRY} → /${slug} (${env.portalUrl}/${slug})` });
    console.log(`provisioned ${MINISTRY} at ${env.portalUrl}/${slug}`);
  });
});
