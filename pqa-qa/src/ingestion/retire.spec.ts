import { existsSync, rmSync } from 'node:fs';
import { test, expect, requireWrites } from '../admin/fixtures.js';
import { setEnvLine } from '../support/env-file.js';
import { loadIngestEnv, portalSessionFile } from './ingest-env.js';
import { clearDocuments } from './portal.js';

// Spec §4.3: clear the disposable tenant's documents, suspend and archive it (archiving frees its ministry;
// the slug is never reusable), then forget its portal session and PQA_INGEST_TENANT.
const ienv = loadIngestEnv();

test('retire the disposable ingestion tenant: clear, suspend, archive, forget', async ({ page, playwright }, testInfo) => {
  requireWrites(ienv);
  test.skip(!ienv.tenant, 'PQA_INGEST_TENANT is not set — nothing to retire');
  const slug = ienv.tenant!;
  const file = portalSessionFile(slug);
  await test.step(`Clear ${slug}'s documents (archiving goes ahead even if this fails)`, async () => {
    if (!existsSync(file)) return testInfo.annotations.push({ type: 'note', description: `No portal session — ${slug}'s documents were not cleared` });
    const portal = await playwright.request.newContext({ storageState: file });
    try {
      await clearDocuments(portal, ienv.portalUrl, slug);
    } catch (e) {
      testInfo.annotations.push({ type: 'note', description: `Documents not cleared: ${(e as Error).message}` });
    } finally {
      await portal.dispose();
    }
  });
  await test.step(`Suspend then archive ${slug} unless it is already archived`, async () => {
    const res = await page.request.get(`/api/tenants/${slug}`);
    if (res.status() !== 200) return;
    const status: string = (await res.json()).data.tenant.status;
    if (status === 'archived') return;
    if (status !== 'suspended') await page.request.patch(`/api/tenants/${slug}/status`, { data: { status: 'suspended' } });
    const archived = await page.request.patch(`/api/tenants/${slug}/status`, { data: { status: 'archived' }, failOnStatusCode: false });
    expect(archived.status(), `could not archive ${slug} — archive it by hand in the Admin Panel`).toBe(200);
  });
  await test.step('Delete the portal session file and PQA_INGEST_TENANT from .env', async () => {
    rmSync(file, { force: true });
    setEnvLine('.env', 'PQA_INGEST_TENANT', undefined);
  });
});
