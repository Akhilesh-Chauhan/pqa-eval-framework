// Signs in to the disposable ingestion tenant's portal once and saves the session for `npm run qa:ingest`.
// The OTP goes to the tenant admin's inbox; you type it in the browser window this opens.
// Runs as the second half of `npm run qa:ingest:provision` (reads .env).
import { chmodSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.env.PQA_BASE_URL?.trim().replace(/\/+$/, '');
const slug = process.env.PQA_INGEST_TENANT?.trim();
const email = (process.env.PQA_INGEST_ADMIN_EMAIL || process.env.PQA_ADMIN_TENANT_ADMIN_EMAIL)?.trim();
if (!base || !slug || !email) {
  console.error('Set PQA_BASE_URL and PQA_ADMIN_TENANT_ADMIN_EMAIL in pqa-qa/.env; PQA_INGEST_TENANT is written by the provision test.');
  process.exit(1);
}
if (!/^qi[0-9a-f]{4}$/.test(slug)) {
  console.error(`PQA_INGEST_TENANT=${slug} is not a disposable ingestion tenant — refusing.`);
  process.exit(1);
}
const SESSION_FILE = `src/.auth/portal-${slug}.json`; // same file as src/ingestion/ingest-env.ts

const browser = await chromium.launch({ headless: false });
try {
  const page = await browser.newPage();
  await page.goto(`${base}/${slug}`);
  await page.locator('#otp-email').fill(email);
  await page.locator('#otp-email').press('Enter');
  await page.locator('#otp-code').waitFor({ state: 'visible', timeout: 60_000 });
  console.log(`A sign-in code was sent to ${email}. Type it in the browser window and confirm. Waiting up to 5 minutes…`);
  await page.locator('#otp-code').waitFor({ state: 'detached', timeout: 5 * 60_000 });
  const res = await page.request.get(`${base}/${slug}/api/auth/session`);
  if (res.status() !== 200) throw new Error(`Not signed in: GET /${slug}/api/auth/session answered ${res.status()}.`);
  if (!JSON.stringify(await res.json()).includes('ingestion:manage')) throw new Error(`${email} is signed in but lacks ingestion:manage on ${slug} — uploads would be refused.`);
  mkdirSync('src/.auth', { recursive: true, mode: 0o700 });
  await page.context().storageState({ path: SESSION_FILE });
  chmodSync(SESSION_FILE, 0o600);
  console.log(`Saved ${SESSION_FILE}. The refresh cookie lasts 30 days; the suite renews the 1-hour access cookie as it goes.`);
} finally {
  await browser.close();
}
