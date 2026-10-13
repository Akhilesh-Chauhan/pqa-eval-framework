import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { PortalSessionExpired, keepAlive } from '../ingestion/portal.js';
import * as store from '../ingestion/store.js';

const fake = (status: number) => ({ get: async () => ({ status: () => status }) }) as unknown as APIRequestContext;

test('keepAlive passes on 200 and stops the run on 401', async () => {
  process.env.PQA_RUN_ID = `unit-${Date.now()}`;
  await keepAlive(fake(200), 'https://p', 'qi1a2b');
  expect(store.get('stop')).toBeUndefined();
  await expect(keepAlive(fake(401), 'https://p', 'qi1a2b')).rejects.toBeInstanceOf(PortalSessionExpired);
  expect(store.get<{ reason: string }>('stop')?.reason).toMatch(/qa:ingest:provision/);
});
