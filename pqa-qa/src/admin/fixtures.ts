import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { loadAdminEnv, SESSION_FILE } from './admin-env.js';
import type { AdminEnv } from './admin-env.js';

export const test = base.extend<{ env: AdminEnv }>({
  env: async ({}, use) => {
    await use(loadAdminEnv());
  },

  context: async ({ context }, use, testInfo) => {
    await use(context);

    // Where the browser was when it failed — goes into the evidence REPRO.md.
    if (testInfo.status !== testInfo.expectedStatus) {
      const urls = context.pages().map((p) => p.url()).join('\n');
      if (urls) await testInfo.attach('page-url', { body: urls, contentType: 'text/plain' });
    }

    // /api/auth/session rotates the cookies (A6). Write the newest pair back so
    // the next test does not present a spent refresh token. Skipped for
    // contexts that never had a session, so a sign-out test cannot blank the file.
    const cookies = await context.cookies();
    if (cookies.some((c) => c.name === 'pqa_admin_refresh')) {
      await context.storageState({ path: SESSION_FILE });
    }
  },
});

export { expect };

/**
 * Aborts every write the page attempts (any non-GET /api/* call except sign-in) and returns
 * the list of what was attempted. A test asserting "nothing is sent" checks it is empty; a
 * broken client-side guard can then never create or change anything on the shared environment.
 */
export async function blockWrites(page: Page): Promise<Array<{ method: string; path: string; body: string | null }>> {
  const attempts: Array<{ method: string; path: string; body: string | null }> = [];
  await page.route('**/api/**', (route) => {
    const req = route.request();
    if (req.method() === 'GET' || new URL(req.url()).pathname.startsWith('/api/auth/')) return route.continue();
    attempts.push({ method: req.method(), path: new URL(req.url()).pathname, body: req.postData() });
    return route.abort();
  });
  return attempts;
}

/** Skip a test that would write to the shared environment unless writes are switched on. */
export function requireWrites(env: AdminEnv): void {
  test.skip(!env.allowWrites, 'writes to the shared environment are off — set PQA_ADMIN_ALLOW_WRITES=true');
}
