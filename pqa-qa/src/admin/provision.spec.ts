import { test, expect } from './fixtures.js';
import { fillWizardToReview } from './wizard.js';
import type { Division } from './tenant-profile.js';
import { DIVISIONS, LOGOS } from './tenant-profile.js';

// Provisions the standing tenants (tester's decisions, 2026-10-12 and 2026-10-22): the tester's own admin, the real
// LLM key and the tenant-profile logos. The suite never archives them. Runs only when asked:
//   PQA_ADMIN_PROVISION=commerce,education npx playwright test --project=admin src/admin/provision.spec.ts
// commerce  — Ministry of Commerce and Industry at /comind, Active, with the four DoC divisions: the ministry-portal phase.
// education — Ministry of Education at /educat, Inactive: PQA_ADMIN_TEST_TENANT, the standing test tenant **T**.
const PROFILES: Record<string, { ministry: string; slug: string; status: 'active' | 'inactive'; divisions?: Division[] }> = {
  commerce: { ministry: 'Ministry of Commerce and Industry', slug: 'comind', status: 'active', divisions: DIVISIONS },
  education: { ministry: 'Ministry of Education', slug: 'educat', status: 'inactive' },
};
const wanted = (process.env.PQA_ADMIN_PROVISION ?? '').split(',').map((s) => s.trim());

for (const [key, p] of Object.entries(PROFILES)) {
  test(`provision the standing ${p.ministry} tenant (/${p.slug}, ${p.status})`, async ({ page, env }) => {
    test.skip(!wanted.includes(key), `runs only with PQA_ADMIN_PROVISION=${key}`);
    test.skip(!env.tenantAdmin || !env.llm, 'set PQA_ADMIN_TENANT_ADMIN_* and PQA_ADMIN_LLM_* in .env');

    const taken = await test.step(`Check "${p.ministry}" has no live portal (GET /api/ministries)`, async () => {
      const rows: Array<{ name: string; taken: boolean }> = (await (await page.request.get('/api/ministries')).json()).data;
      const row = rows.find((m) => m.name === p.ministry);
      expect(row, `"${p.ministry}" is not in the master list`).toBeDefined();
      return row!.taken;
    });
    test.skip(taken, `"${p.ministry}" already has a live portal — nothing to do`);

    await fillWizardToReview(page, {
      ministry: p.ministry,
      slug: p.slug,
      adminName: env.tenantAdmin!.name,
      adminEmail: env.tenantAdmin!.email,
      llm: env.llm!,
      logos: LOGOS,
      divisions: p.divisions,
    });
    const created = page.waitForResponse((r) => r.url().endsWith('/api/tenants') && r.request().method() === 'POST');
    await test.step(`Step 7: Initial status "${p.status}"; press Create tenant`, async () => {
      await page.locator('#finalStatus').selectOption(p.status);
      await page.getByRole('button', { name: 'Create tenant' }).click();
    });
    await test.step(`Expect 201 and "${p.ministry} provisioned" at /${p.slug}, ${p.status}`, async () => {
      const res = await created;
      expect(res.status()).toBe(201);
      await expect(page.getByText(`${p.ministry} provisioned`)).toBeVisible();
      const tenant = (await res.json()).data.tenant;
      expect(tenant.slug).toBe(p.slug);
      expect.soft(tenant.status, 'status at creation (spec §9.1)').toBe(p.status);
      test.info().annotations.push({ type: 'provisioned', description: `${p.ministry} → /${tenant.slug} (${env.portalUrl}/${tenant.slug}), ${tenant.status}` });
      console.log(`provisioned ${p.ministry} at ${env.portalUrl}/${tenant.slug} (${tenant.status})`);
    });
  });
}
