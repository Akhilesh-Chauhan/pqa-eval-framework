// Read-only page map of the disposable ingestion tenant's ministry portal (signed in as its admin): aria snapshots of
// the shell, the upload surfaces and the assistant, plus the API calls each page makes. Every non-GET request to the
// portal origin is aborted (sign-in refresh excepted), so nothing is uploaded, ingested or cleared.
// Usage: node --env-file=.env scripts/pagemap-portal.mjs <outDir>   (session from scripts/portal-login.mjs)
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.env.PQA_BASE_URL.trim().replace(/\/+$/, '');
const slug = process.env.PQA_INGEST_TENANT.trim();
if (!/^qi[0-9a-f]{4}$/.test(slug)) throw new Error(`PQA_INGEST_TENANT=${slug} is not a disposable ingestion tenant`);
const SESSION = `src/.auth/portal-${slug}.json`;
const out = process.argv[2];
if (!out) throw new Error('usage: node --env-file=.env scripts/pagemap-portal.mjs <outDir>');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ storageState: SESSION, viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const origin = new URL(base).origin;
const calls = [];
const blocked = [];
await page.route('**/*', (route) => {
  const req = route.request();
  const url = new URL(req.url());
  if (url.origin === origin && url.pathname.includes('/api/')) calls.push(`${req.method()} ${url.pathname}`);
  if (['GET', 'HEAD'].includes(req.method()) || url.pathname.includes('/api/auth/')) return route.continue();
  if (url.origin === origin) blocked.push(`${req.method()} ${url.pathname}`);
  return route.abort();
});

let n = 0;
async function snap(name, locator = page.locator('main').first()) {
  try {
    const yaml = await locator.ariaSnapshot({ timeout: 10_000 });
    writeFileSync(`${out}/${String(++n).padStart(2, '0')}-${name}.yml`, `# ${page.url()}\n# api calls: ${[...new Set(calls)].join(', ')}\n${yaml}\n`);
  } catch (e) {
    console.log(`snap ${name}: ${e.message.split('\n')[0]}`);
  }
  calls.length = 0;
}
async function visit(name, path, extra) {
  try {
    await page.goto(`${base}/${slug}${path}`, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(1_000);
    await snap(name);
    if (extra) await extra();
  } catch (e) {
    console.log(`${name}: ${e.message.split('\n')[0]}`);
  }
}

try {
  await visit('landing', '', () => snap('landing-shell', page.locator('body')));
  await visit('kb-docs', '/settings/file-ingestions');
  await visit('ingestion-dashboard', '/settings/ingestion');
  await visit('ai-assistant', '/ai-assistant');
  await visit('settings', '/settings');
  const pickers = await page.evaluate(() => [...document.querySelectorAll('input[type=file]')].map((i) => `${i.id || '(no id)'} accept="${i.accept}"`));
  console.log('file inputs on /settings:', pickers);
  for (const [name, path] of [['kb-docs-inputs', '/settings/file-ingestions'], ['ingestion-inputs', '/settings/ingestion']]) {
    await page.goto(`${base}/${slug}${path}`, { waitUntil: 'networkidle', timeout: 60_000 }).catch(() => {});
    const inputs = await page.evaluate(() => [...document.querySelectorAll('input[type=file]')].map((i) => `${i.id || '(no id)'} accept="${i.accept}" multiple=${i.multiple}`));
    console.log(`${name}:`, inputs);
  }
} finally {
  await ctx.storageState({ path: SESSION }); // keep rotated portal cookies
  console.log(`snapshots: ${n}; portal writes blocked: ${blocked.length ? [...new Set(blocked)].join(', ') : 'none'}`);
  await browser.close();
}
