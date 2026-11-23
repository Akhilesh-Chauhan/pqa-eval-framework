// Signs one design-suite persona in to PQA_DESIGN_TENANT's portal and saves the session for `npm run qa:design`.
//   npm run qa:design:login -- executive [email]     (persona: executive | parliament | division)
// The email defaults to PQA_DESIGN_<PERSONA>_EMAIL. The OTP goes to that inbox: type it in the browser window this
// opens, or write the 6 digits to src/.auth/otp.txt and the script fills it in.
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { chromium } from '@playwright/test';

const PERSONAS = ['executive', 'parliament', 'division'];
const base = process.env.PQA_BASE_URL?.trim().replace(/\/+$/, '');
const slug = process.env.PQA_DESIGN_TENANT?.trim();
const [persona, argEmail] = process.argv.slice(2);
if (!PERSONAS.includes(persona)) {
  console.error(`Usage: npm run qa:design:login -- <${PERSONAS.join('|')}> [email]`);
  process.exit(1);
}
const email = (argEmail || process.env[`PQA_DESIGN_${persona.toUpperCase()}_EMAIL`])?.trim();
if (!base || !slug || !email) {
  console.error(`Set PQA_BASE_URL, PQA_DESIGN_TENANT and PQA_DESIGN_${persona.toUpperCase()}_EMAIL in pqa-qa/.env (or pass the email).`);
  process.exit(1);
}
if (!/^[a-z0-9]{6}$/.test(slug)) {
  console.error(`PQA_DESIGN_TENANT=${slug} is not a tenant slug (6 lower-case letters or digits).`);
  process.exit(1);
}
const SESSION_FILE = `src/.auth/design-${slug}-${persona}.json`; // same name as src/design/design-env.ts
const OTP_FILE = 'src/.auth/otp.txt';

const browser = await chromium.launch({ headless: false });
try {
  const page = await browser.newPage();
  await page.goto(`${base}/${slug}`);
  await page.locator('#otp-email').fill(email);
  await page.locator('#otp-email').press('Enter');
  await page.locator('#otp-code').waitFor({ state: 'visible', timeout: 60_000 });
  const waitMin = Number(process.env.PQA_OTP_WAIT_MIN ?? 30);
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
  mkdirSync('src/.auth', { recursive: true, mode: 0o700 });
  await page.context().storageState({ path: SESSION_FILE });
  chmodSync(SESSION_FILE, 0o600);
  console.log(`Saved ${SESSION_FILE} for the ${persona} persona.`);
} finally {
  await browser.close();
}
