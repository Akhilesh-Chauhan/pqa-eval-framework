import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { PortalSessionExpired, keepAlive, keepsSession, upload } from '../ingestion/portal.js';
import { touchAdmin } from '../ingestion/admin-config.js';
import * as store from '../ingestion/store.js';

/** A fake portal: the jar holds an access cookie expiring in `minutes` (undefined = already dropped), records calls. */
function fake(status: number, minutes?: number) {
  const calls: string[] = [];
  const cookies = [{ name: 'pqa_refresh', expires: Date.now() / 1000 + 30 * 86400 }, ...(minutes === undefined ? [] : [{ name: 'pqa_session', expires: Date.now() / 1000 + minutes * 60 }])];
  const portal = {
    storageState: async () => ({ cookies, origins: [] }),
    post: async (url: string) => (calls.push(`POST ${url}`), { status: () => 200 }),
    get: async (url: string) => (calls.push(`GET ${url}`), { status: () => status }),
  } as unknown as APIRequestContext;
  return { portal, calls };
}

const runId = process.env.PQA_RUN_ID;
test.afterEach(() => {
  process.env.PQA_RUN_ID = runId;
});

test('keepAlive passes on 200 and stops the run on 401', async () => {
  process.env.PQA_RUN_ID = `unit-${Date.now()}`;
  await keepAlive(fake(200, 50).portal, 'https://p', 'qi1a2b');
  expect(store.get('stop')).toBeUndefined();
  await expect(keepAlive(fake(401, 50).portal, 'https://p', 'qi1a2b')).rejects.toBeInstanceOf(PortalSessionExpired);
  expect(store.get<{ reason: string }>('stop')?.reason).toMatch(/qa:ingest:provision/);
});

test('keepAlive refreshes an access cookie that lapses within 15 minutes, before checking the session', async () => {
  const { portal, calls } = fake(200, 5);
  await keepAlive(portal, 'https://p', 'qi1a2b');
  expect(calls).toEqual(['POST https://p/qi1a2b/api/auth/session/refresh', 'GET https://p/qi1a2b/api/auth/session']);
});

test('keepAlive refreshes when the access cookie is already gone (Playwright drops expired cookies)', async () => {
  const { portal, calls } = fake(200);
  await keepAlive(portal, 'https://p', 'qi1a2b');
  expect(calls[0]).toBe('POST https://p/qi1a2b/api/auth/session/refresh');
});

test('keepAlive leaves a fresh access cookie alone', async () => {
  const { portal, calls } = fake(200, 50);
  await keepAlive(portal, 'https://p', 'qi1a2b');
  expect(calls).toEqual(['GET https://p/qi1a2b/api/auth/session']);
});

test('keepsSession: a jar without the refresh cookie must not overwrite the saved session', () => {
  expect(keepsSession([{ name: 'pqa_refresh' }, { name: 'pqa_session' }])).toBe(true);
  expect(keepsSession([{ name: 'pqa_session' }])).toBe(false);
  expect(keepsSession([])).toBe(false);
});

test('touchAdmin uses the admin session, so it is not idle for an hour while the portal is busy', async () => {
  const calls: string[] = [];
  const page = { request: { get: async (url: string) => (calls.push(url), { status: () => 200 }) } } as unknown as Page;
  await touchAdmin(page);
  expect(calls).toEqual(['/api/auth/session']);
});

test('upload turns a request that throws (timeout, network) into status 0, so the caller can retry and record it', async () => {
  const { portal } = fake(200, 50);
  const ok = (data: object) => ({ ok: () => true, status: () => 201, json: async () => ({ data }) });
  (portal as any).post = async (url: string) => {
    if (url.endsWith('/files/presigned-url')) return ok({ presignedUrl: 'https://s3/put', s3Key: 'k', bucket: 'b', uploadToken: 't' });
    if (url.endsWith('/files/confirm-upload')) return ok({ s3Key: 'k', bucket: 'b' });
    if (url.endsWith('/ingestion/batch')) throw new Error('Request timed out after 330000ms');
    return { ok: () => true, status: () => 200 };
  };
  (portal as any).fetch = async () => ({ ok: () => true, status: () => 200 });
  const res = await upload(portal, 'https://p', 'qi1a2b', 'ingestion', [{ filename: 'a.pdf', mime: 'application/pdf', data: Buffer.from('%PDF') }]);
  expect(res.status).toBe(0);
  expect(String(res.body.error)).toMatch(/timed out/);
});
