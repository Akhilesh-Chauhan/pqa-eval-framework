// Signs in to the Super Admin panel once and saves the session for the test suite.
// The OTP goes to your inbox; you type it in the browser window this opens.
// Usage: npm run qa:admin:login   (reads PQA_ADMIN_URL and PQA_ADMIN_EMAIL from .env)
import { chmodSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const SESSION_FILE = 'src/.auth/super-admin.json'; // same file as src/admin/admin-env.ts
const adminUrl = process.env.PQA_ADMIN_URL?.trim().replace(/\/+$/, '');
const email = process.env.PQA_ADMIN_EMAIL?.trim();
if (!adminUrl || !email) {
  console.error('Set PQA_ADMIN_URL and PQA_ADMIN_EMAIL in pqa-qa/.env first.');
  process.exit(1);
}

const browser = await chromium.launch({ headless: false });
try {
  const page = await browser.newPage();
  await page.goto(`${adminUrl}/login?return_to=%2Ftenants`);
  await page.locator('#admin-email').fill(email);
  await page.getByRole('button', { name: 'Send code' }).click();
  console.log(`A sign-in code was sent to ${email}.`);
  console.log('Type it in the browser window and press Verify. Waiting up to 5 minutes…');

  await page.waitForURL(/\/tenants(\?|$)/, { timeout: 5 * 60_000 });
  mkdirSync('src/.auth', { recursive: true, mode: 0o700 });
  await page.context().storageState({ path: SESSION_FILE });
  chmodSync(SESSION_FILE, 0o600);
  console.log(`Saved ${SESSION_FILE}. Valid for up to 8 h; it ends after about 1 h without use.`);
} finally {
  await browser.close();
}
