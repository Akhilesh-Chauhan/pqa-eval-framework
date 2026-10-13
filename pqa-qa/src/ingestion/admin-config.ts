import type { Page } from '@playwright/test';
import { test, expect } from '../admin/fixtures.js';
import { withSetup } from '../support/ingestion-setups.js';
import type { Setup } from '../support/ingestion-setups.js';
import * as store from './store.js';

/** The portal and the ingestion service each cache tenant config for 300 s and nothing invalidates it. */
export const CACHE_WAIT_MS = 330_000;

const message = async (res: { json(): Promise<any> }): Promise<string> => String((await res.json().catch(() => ({})))?.error?.message ?? '');

/** Saves the setup's file rules through the edit page's own Save configuration body (captured with the PATCH
 * aborted, then sent with the rules replaced), checks them, waits out both caches, and records the setup as live. */
export async function applySetup(page: Page, slug: string, setup: Setup): Promise<void> {
  const body = await test.step(`Open /tenants/${slug}/edit; capture the Save configuration body (PATCH aborted, nothing written)`, async () => {
    await page.goto(`/tenants/${slug}/edit`);
    await expect(page.getByRole('button', { name: 'Save configuration' })).toBeVisible();
    await page.route(`**/api/tenants/${slug}`, (r) => (r.request().method() === 'PATCH' ? r.abort() : r.continue()));
    const req = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith(`/api/tenants/${slug}`));
    await page.getByRole('button', { name: 'Save configuration' }).click();
    const captured = (await req).postDataJSON();
    await page.unroute(`**/api/tenants/${slug}`);
    return captured;
  });
  await test.step(`PATCH /api/tenants/${slug}: ${setup.id} = ${setup.types.join(', ')}, max ${setup.maxMb} MB (one retry on 409)`, async () => {
    for (let attempt = 1; ; attempt++) {
      const fresh = (await (await page.request.get(`/api/tenants/${slug}`)).json()).data;
      const res = await page.request.patch(`/api/tenants/${slug}`, { data: withSetup(body, setup, fresh.tenant.updatedAt), failOnStatusCode: false });
      if (res.status() === 409 && attempt === 1) continue;
      expect(res.status(), `saving ${setup.id}: ${res.status()} ${await message(res)}`).toBe(200);
      break;
    }
    const saved = (await (await page.request.get(`/api/tenants/${slug}`)).json()).data.tenant.assistant;
    expect(saved.fileSupportType.mimeTypes).toEqual(withSetup(body, setup, '').tenant.assistant.fileSupportType.mimeTypes);
    expect(saved.filesize.bytes).toBe(setup.maxMb * 1024 * 1024);
  });
  await test.step(`Wait ${CACHE_WAIT_MS / 1000} s for the portal and ingestion-service config caches`, async () => {
    await page.waitForTimeout(CACHE_WAIT_MS);
  });
  store.put('setup', { id: setup.id, at: new Date().toISOString() });
}
