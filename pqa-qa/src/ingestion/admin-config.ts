import type { Page } from '@playwright/test';
import { test, expect } from '../admin/fixtures.js';
import { withSetup } from '../support/ingestion-setups.js';
import type { Setup } from '../support/ingestion-setups.js';
import * as store from './store.js';

/** The portal and the ingestion service each cache tenant config for 300 s and nothing invalidates it. */
export const CACHE_WAIT_MS = 330_000;

/** The admin session ends after about 1 h unused; portal-only stretches of the run would let it lapse. Any admin
 * request renews it (the admin fixture then saves the rotated cookies). */
export async function touchAdmin(page: Page): Promise<void> {
  await page.request.get('/api/auth/session', { failOnStatusCode: false });
}

const message = async (res: { json(): Promise<any> }): Promise<string> => String((await res.json().catch(() => ({})))?.error?.message ?? '');

function setKey(o: unknown, key: string, value: unknown): void {
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) (k === key ? ((o as Record<string, unknown>)[k] = value) : setKey(v, key, value));
}

/** Saves the setup's file rules through the edit page's own Save configuration body (captured with the PATCH
 * aborted, then sent with the rules replaced), checks them, waits out both caches, and records the setup as live.
 * Save is disabled until something changes (live build, 22 Oct): it toggles the accessibility bar to capture the body,
 * then puts the stored value back in it. */
export async function applySetup(page: Page, slug: string, setup: Setup): Promise<void> {
  const body = await test.step(`Open /tenants/${slug}/edit (Basic Info); toggle Accessibility bar; capture the Save configuration body with the stored value put back (PATCH aborted, nothing written)`, async () => {
    const bar: boolean = (await (await page.request.get(`/api/tenants/${slug}`)).json()).data.tenant.features?.accessibilityBar ?? true;
    await page.goto(`/tenants/${slug}/edit?tab=config&section=basic`);
    await expect(page.getByRole('button', { name: 'Save configuration' })).toBeVisible();
    await page.getByRole('switch', { name: 'Accessibility bar' }).click();
    await page.route(`**/api/tenants/${slug}`, (r) => (r.request().method() === 'PATCH' ? r.abort() : r.continue()));
    const req = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().endsWith(`/api/tenants/${slug}`));
    await page.getByRole('button', { name: 'Save configuration' }).click();
    const captured = (await req).postDataJSON();
    await page.unroute(`**/api/tenants/${slug}`);
    setKey(captured, 'accessibilityBar', bar);
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
