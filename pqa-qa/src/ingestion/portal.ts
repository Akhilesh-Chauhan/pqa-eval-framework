import type { APIRequestContext } from '@playwright/test';
import { test } from '../admin/fixtures.js';
import { multipart } from '../support/ingestion-http.js';
import type { FilePart } from '../support/ingestion-http.js';
import * as store from './store.js';

/** The two portal upload routes (Settings → Ingestion, Settings → Ingestion demo). Both must enforce the file policy. */
export type Route = 'ingestion' | 'ingestion-demo';
export const ROUTES: Route[] = ['ingestion', 'ingestion-demo'];

export class PortalSessionExpired extends Error {}

/** A jar without the refresh cookie (the server cleared it on a 401) must not overwrite the saved session. */
export const keepsSession = (cookies: Array<{ name: string }>): boolean => cookies.some((c) => c.name === 'pqa_refresh');

const RENEW_MS = 15 * 60_000;

/** The access cookie lives 1 h and the portal does not renew it from the refresh cookie once it is gone (Playwright
 * drops expired cookies), so renew it while it has under 15 minutes left: POST /<slug>/api/auth/session/refresh
 * re-sets both cookies. Then GET /<slug>/api/auth/session; anything but 200 means the session is gone: record "stop"
 * so every later test skips, and throw. */
export async function keepAlive(portal: APIRequestContext, base: string, slug: string): Promise<void> {
  const access = (await portal.storageState()).cookies.find((c) => c.name === 'pqa_session');
  if (!access || (access.expires > 0 && access.expires * 1000 - Date.now() < RENEW_MS)) {
    await portal.post(`${base}/${slug}/api/auth/session/refresh`, { failOnStatusCode: false });
  }
  const res = await portal.get(`${base}/${slug}/api/auth/session`, { failOnStatusCode: false });
  if (res.status() === 200) return;
  const reason = `portal session for ${slug} answered ${res.status()} — run npm run qa:ingest:provision again`;
  store.put('stop', { reason });
  throw new PortalSessionExpired(reason);
}

/** Skip the current test once a session failure has stopped the run. */
export function stopIfExpired(): void {
  const stop = store.get<{ reason: string }>('stop');
  test.skip(!!stop, stop?.reason ?? '');
}

export async function upload(portal: APIRequestContext, base: string, slug: string, route: Route, files: FilePart[]): Promise<{ status: number; body: any }> {
  await keepAlive(portal, base, slug);
  const { body, contentType } = multipart(files);
  try {
    const res = await portal.post(`${base}/${slug}/api/${route}/batch`, { data: body, headers: { 'content-type': contentType }, timeout: 330_000, failOnStatusCode: false });
    return { status: res.status(), body: await res.json().catch(() => ({})) };
  } catch (e) {
    // A timeout or dropped connection: status 0, so the caller retries or records "not measured" instead of losing the case.
    return { status: 0, body: { error: `request failed: ${(e as Error).message.split('\n')[0]}` } };
  }
}

/** DELETE /<slug>/api/ingestion-demo/clear — empties the tenant's index, so the next upload is processed afresh. */
export async function clearDocuments(portal: APIRequestContext, base: string, slug: string): Promise<void> {
  await keepAlive(portal, base, slug);
  const res = await portal.delete(`${base}/${slug}/api/ingestion-demo/clear`, { failOnStatusCode: false, timeout: 60_000 });
  if (!res.ok()) throw new Error(`clearing ${slug}'s documents answered ${res.status()}`);
}
