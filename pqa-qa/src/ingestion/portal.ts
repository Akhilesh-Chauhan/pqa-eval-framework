import type { APIRequestContext } from '@playwright/test';
import { test } from '../admin/fixtures.js';
import { streamResults } from '../support/ingestion-http.js';
import type { FilePart } from '../support/ingestion-http.js';
import * as store from './store.js';

/** The two portal upload surfaces (Settings → Ingestion "Run Pipeline", Settings → KB Docs "Ingest documents"; KB Docs
 * was ingestion-demo, components B13/B15). Both must enforce the file policy. Recorded from the live pages, 22 Oct. */
export type Route = 'ingestion' | 'file-ingestions';
export const ROUTES: Route[] = ['ingestion', 'file-ingestions'];

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

/** Uploads as both pages do on the live build (22 Oct): per file POST …/api/files/presigned-url (purpose
 * INGESTION_SOURCE), PUT to storage, POST …/api/files/confirm-upload with the upload token; then one call with the
 * stored items — `ingestion` POST …/api/ingestion/batch (JSON), `file-ingestions` POST …/api/file-ingestions/batch-stream
 * (events). Answers {status, body: {results}} like the old batch route; a refused step answers its own status. */
export async function upload(portal: APIRequestContext, base: string, slug: string, route: Route, files: FilePart[]): Promise<{ status: number; body: any }> {
  await keepAlive(portal, base, slug);
  const api = (p: string) => `${base}/${slug}/api/${p}`;
  const json = async (r: { json(): Promise<any> }) => r.json().catch(() => ({}));
  try {
    const items: Array<{ bucket: string; key: string; filename: string }> = [];
    for (const f of files) {
      const meta = { mimeType: f.mime ?? '', fileSize: f.data.length, purpose: 'INGESTION_SOURCE' };
      const pre = await portal.post(api('files/presigned-url'), { data: { fileName: f.filename, ...meta }, failOnStatusCode: false });
      if (!pre.ok()) return { status: pre.status(), body: await json(pre) };
      const p = (await json(pre)).data ?? {};
      const put = await portal.fetch(p.presignedUrl, { method: 'PUT', data: f.data, headers: f.mime ? { 'content-type': f.mime } : {}, failOnStatusCode: false });
      if (!put.ok()) return { status: 502, body: { error: `storage PUT answered ${put.status()}` } };
      const conf = await portal.post(api('files/confirm-upload'), {
        data: { s3Key: p.s3Key, s3Bucket: p.bucket, originalFileName: f.filename, ...meta, uploadToken: p.uploadToken },
        failOnStatusCode: false,
      });
      if (!conf.ok()) return { status: conf.status(), body: await json(conf) };
      const c = (await json(conf)).data ?? {};
      items.push({ bucket: c.bucket ?? p.bucket, key: c.s3Key ?? p.s3Key, filename: f.filename });
    }
    const res = await portal.post(api(route === 'ingestion' ? 'ingestion/batch' : 'file-ingestions/batch-stream'), { data: { items }, timeout: 330_000, failOnStatusCode: false });
    if (route === 'ingestion' || !res.ok()) return { status: res.status(), body: await json(res) };
    return { status: res.status(), body: { results: streamResults(await res.text()) } };
  } catch (e) {
    // A timeout or dropped connection: status 0, so the caller retries or records "not measured" instead of losing the case.
    return { status: 0, body: { error: `request failed: ${(e as Error).message.split('\n')[0]}` } };
  }
}

/** DELETE /<slug>/api/file-ingestions/clear (was ingestion-demo/clear, B15) — empties the tenant's index, so the next
 * upload is processed afresh. */
export async function clearDocuments(portal: APIRequestContext, base: string, slug: string): Promise<void> {
  await keepAlive(portal, base, slug);
  const res = await portal.delete(`${base}/${slug}/api/file-ingestions/clear`, { failOnStatusCode: false, timeout: 60_000 });
  if (!res.ok()) throw new Error(`clearing ${slug}'s documents answered ${res.status()}`);
}
