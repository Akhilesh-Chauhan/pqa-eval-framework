// Signs in to the disposable ingestion tenant's portal once and saves the session for `npm run qa:ingest`.
// The OTP goes to the signing-in user's inbox: type it in the browser window this opens, or write the 6 digits
// to src/.auth/otp.txt and the script fills it in (for a code relayed from someone else's inbox).
// Runs as the second half of `npm run qa:ingest:provision` (reads .env) for the tenant admin, the maker.
// The maker-checker checker signs in separately:
//   node --env-file=.env scripts/portal-login.mjs <checker email> checker   → src/.auth/portal-<slug>-checker.json
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.env.PQA_BASE_URL?.trim().replace(/\/+$/, '');
const slug = process.env.PQA_INGEST_TENANT?.trim();
const [argEmail, role] = process.argv.slice(2);
const email = (argEmail || process.env.PQA_INGEST_ADMIN_EMAIL || process.env.PQA_ADMIN_TENANT_ADMIN_EMAIL)?.trim();
if (!base || !slug || !email) {
  console.error('Set PQA_BASE_URL and PQA_ADMIN_TENANT_ADMIN_EMAIL in pqa-qa/.env; PQA_INGEST_TENANT is written by the provision test.');
  process.exit(1);
}
if (!/^qi[0-9a-f]{4}$/.test(slug)) {
  console.error(`PQA_INGEST_TENANT=${slug} is not a disposable ingestion tenant — refusing.`);
  process.exit(1);
}
if (role !== undefined && !/^[a-z]+$/.test(role)) {
  console.error(`role "${role}" must be lower-case letters, e.g. checker`);
  process.exit(1);
}
const SESSION_FILE = `src/.auth/portal-${slug}${role ? `-${role}` : ''}.json`; // same names as src/ingestion/ingest-env.ts
const OTP_FILE = 'src/.auth/otp.txt';

const browser = await chromium.launch({ headless: false });
try {
  const page = await browser.newPage();
  await page.goto(`${base}/${slug}`);
  await page.locator('#otp-email').fill(email);
  await page.locator('#otp-email').press('Enter');
  await page.locator('#otp-code').waitFor({ state: 'visible', timeout: 60_000 });
  const waitMin = Number(process.env.PQA_OTP_WAIT_MIN ?? 30); // codes can take a while to arrive
  console.log(`A sign-in code was sent to ${email}. Type it in the browser window, or write it to ${OTP_FILE}. Waiting up to ${waitMin} minutes…`);
  const deadline = Date.now() + waitMin * 60_000;
  while (await page.locator('#otp-code').count()) {
    if (Date.now() > deadline) throw new Error(`No accepted code within ${waitMin} minutes.`);
    const code = existsSync(OTP_FILE) ? readFileSync(OTP_FILE, 'utf8').trim() : '';
    if (/^\d{6}$/.test(code)) {
      rmSync(OTP_FILE); // used once: a wrong code leaves the field open for the next one
      await page.locator('#otp-code').fill(code);
      await page.locator('#otp-code').press('Enter');
    }
    await page.waitForTimeout(1_000);
  }
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
