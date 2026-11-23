import { existsSync } from 'node:fs';
import type { APIRequestContext, Page } from '@playwright/test';
import { test as adminTest, expect } from '../admin/fixtures.js';
import { loadIngestEnv, portalSessionFile } from './ingest-env.js';
import { keepsSession } from './portal.js';
import type { IngestEnv } from './ingest-env.js';

function sessionFile(ienv: IngestEnv): string {
  if (!ienv.tenant) throw new Error('PQA_INGEST_TENANT is not set — run npm run qa:ingest:provision');
  const file = portalSessionFile(ienv.tenant);
  if (!existsSync(file)) throw new Error(`${file} is missing — run npm run qa:ingest:provision (portal OTP sign-in)`);
  return file;
}

/** Admin fixtures (admin page + session write-back) plus the disposable tenant's portal, as API and as browser.
 * Both write the rotated portal cookies back, like the admin fixtures do, unless the refresh cookie is gone. */
export const test = adminTest.extend<{ ienv: IngestEnv; portal: APIRequestContext; portalPage: Page }>({
  ienv: async ({}, use) => {
    await use(loadIngestEnv());
  },
  portal: async ({ playwright, ienv }, use) => {
    const file = sessionFile(ienv);
    const ctx = await playwright.request.newContext({ storageState: file });
    await use(ctx);
    if (keepsSession((await ctx.storageState()).cookies)) await ctx.storageState({ path: file });
    await ctx.dispose();
  },
  portalPage: async ({ browser, ienv }, use) => {
    const file = sessionFile(ienv);
    const ctx = await browser.newContext({ storageState: file });
    await use(await ctx.newPage());
    if (keepsSession(await ctx.cookies())) await ctx.storageState({ path: file });
    await ctx.close();
  },
});

export { expect };
