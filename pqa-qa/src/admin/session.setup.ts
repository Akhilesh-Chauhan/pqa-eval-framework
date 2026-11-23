import { existsSync } from 'node:fs';
import { test as setup, request } from '@playwright/test';
import { loadAdminEnv, SESSION_FILE } from './admin-env.js';

const LOGIN_HINT = 'Run `npm run qa:admin:login` and type the OTP in the browser window that opens.';

/** Fails fast, before any admin test runs, when there is no usable Super Admin session. */
setup('saved Super Admin session is still valid', async () => {
  const env = loadAdminEnv();
  if (!existsSync(SESSION_FILE)) throw new Error(`No saved Super Admin session. ${LOGIN_HINT}`);

  const ctx = await request.newContext({ storageState: SESSION_FILE });
  try {
    const res = await ctx.get(`${env.adminUrl}/api/auth/session`, { failOnStatusCode: false });
    if (res.status() !== 200) {
      throw new Error(
        `Saved Super Admin session no longer works (HTTP ${res.status()}). It lasts at most 8 h ` +
          `and ends after about 1 h without use. ${LOGIN_HINT}`,
      );
    }
    await ctx.storageState({ path: SESSION_FILE });
  } finally {
    await ctx.dispose();
  }
});
