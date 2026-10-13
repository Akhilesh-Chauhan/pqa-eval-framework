import type { APIRequestContext } from '@playwright/test';
import { test } from '../admin/fixtures.js';
import { multipart } from '../support/ingestion-http.js';
import type { FilePart } from '../support/ingestion-http.js';
import * as store from './store.js';

/** The two portal upload routes (Settings → Ingestion, Settings → Ingestion demo). Both must enforce the file policy. */
export type Route = 'ingestion' | 'ingestion-demo';
export const ROUTES: Route[] = ['ingestion', 'ingestion-demo'];

export class PortalSessionExpired extends Error {}

/** GET /<slug>/api/auth/session renews the 1-hour access cookie from the 30-day refresh cookie. Anything but 200
 * means the session is gone: record "stop" so every later test skips, and throw. */
export async function keepAlive(portal: APIRequestContext, base: string, slug: string): Promise<void> {
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
  const res = await portal.post(`${base}/${slug}/api/${route}/batch`, { data: body, headers: { 'content-type': contentType }, timeout: 330_000, failOnStatusCode: false });
  return { status: res.status(), body: await res.json().catch(() => ({})) };
}

/** DELETE /<slug>/api/ingestion-demo/clear — empties the tenant's index, so the next upload is processed afresh. */
export async function clearDocuments(portal: APIRequestContext, base: string, slug: string): Promise<void> {
  await keepAlive(portal, base, slug);
  const res = await portal.delete(`${base}/${slug}/api/ingestion-demo/clear`, { failOnStatusCode: false, timeout: 60_000 });
  if (!res.ok()) throw new Error(`clearing ${slug}'s documents answered ${res.status()}`);
}
