// Signs in to the Super Admin panel once and saves the session for the test suite.
// The OTP goes to your inbox: type it in the browser window this opens, or write the 6 digits to
// src/.auth/otp.txt and the script fills it in. Codes can take a while to arrive, so it waits up to
// PQA_OTP_WAIT_MIN minutes (default 30); a wrong code leaves the field open for the next one.
// Usage: npm run qa:admin:login   (reads PQA_ADMIN_URL and PQA_ADMIN_EMAIL from .env)
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { chromium } from '@playwright/test';

const SESSION_FILE = 'src/.auth/super-admin.json'; // same file as src/admin/admin-env.ts
const OTP_FILE = 'src/.auth/otp.txt';
const adminUrl = process.env.PQA_ADMIN_URL?.trim().replace(/\/+$/, '');
const email = process.env.PQA_ADMIN_EMAIL?.trim();
const waitMin = Number(process.env.PQA_OTP_WAIT_MIN ?? 30);
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
  console.log(`Type it in the browser window and press Verify, or write it to ${OTP_FILE}. Waiting up to ${waitMin} minutes…`);

  // The path alone: the login URL itself carries "return_to=/tenants" in its query.
  const signedIn = () => /^\/tenants\/?$/.test(new URL(page.url()).pathname);
  const deadline = Date.now() + waitMin * 60_000;
  while (!signedIn()) {
    if (Date.now() > deadline) throw new Error(`No accepted code within ${waitMin} minutes.`);
    const code = existsSync(OTP_FILE) ? readFileSync(OTP_FILE, 'utf8').trim() : '';
    if (/^\d{6}$/.test(code)) {
      rmSync(OTP_FILE); // used once
      await page.locator('#admin-otp').fill(code);
      await page.locator('#admin-otp').press('Enter');
    }
    await page.waitForTimeout(1_000);
  }
  mkdirSync('src/.auth', { recursive: true, mode: 0o700 });
  await page.context().storageState({ path: SESSION_FILE });
  chmodSync(SESSION_FILE, 0o600);
  console.log(`Saved ${SESSION_FILE}. Valid for up to 8 h; it ends after about 1 h without use.`);
} finally {
  await browser.close();
}
