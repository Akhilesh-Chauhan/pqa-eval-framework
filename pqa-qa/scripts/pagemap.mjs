// Read-only page map of the Super Admin panel: an aria snapshot of every screen the suite drives, for rebuilding the
// tests after a redesign. Every non-GET request to the admin origin is aborted (the Bedrock model check is answered with
// a mock list), so nothing is written and no AWS call is made. Never presses Create, Save, Delete or Send.
// Usage: node --env-file=.env scripts/pagemap.mjs <outDir>     (signed-in session from npm run qa:admin:login)
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const SESSION = 'src/.auth/super-admin.json';
const base = process.env.PQA_ADMIN_URL.trim().replace(/\/+$/, '');
const T = process.env.PQA_ADMIN_TEST_TENANT.trim();
const out = process.argv[2];
if (!out) throw new Error('usage: node --env-file=.env scripts/pagemap.mjs <outDir>');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ baseURL: base, storageState: SESSION, viewport: { width: 1440, height: 1000 } });
const page = await ctx.newPage();
const blocked = [];
await page.route('**/*', (route) => {
  const req = route.request();
  const url = new URL(req.url());
  if (['GET', 'HEAD'].includes(req.method()) || url.pathname.startsWith('/api/auth/')) return route.continue();
  if (url.origin === new URL(base).origin && url.pathname === '/api/llm/bedrock-models') {
    return route.fulfill({ json: { data: { chatModels: [{ id: 'qa.chat-a', label: 'QA Chat A' }, { id: 'qa.chat-b', label: 'QA Chat B' }], embeddingModels: [{ id: 'qa.embed-a', label: 'QA Embed A' }] } } });
  }
  if (url.origin === new URL(base).origin) blocked.push(`${req.method()} ${url.pathname}`);
  return route.abort();
});

let n = 0;
const main = () => page.locator('main').first();
const dialog = () => page.getByRole('dialog').or(page.getByRole('alertdialog')).first();
async function snap(name, locator = main()) {
  try {
    const yaml = await locator.ariaSnapshot({ timeout: 10_000 });
    writeFileSync(`${out}/${String(++n).padStart(2, '0')}-${name}.yml`, `# ${page.url()}\n${yaml}\n`);
  } catch (e) {
    console.log(`snap ${name}: ${e.message.split('\n')[0]}`);
  }
}
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    console.log(`${name}: ${e.message.split('\n')[0]}`);
  }
}
const byName = (re) => page.getByRole('tab', { name: re }).or(page.getByRole('link', { name: re })).or(page.getByRole('button', { name: re })).first();
const next = () => page.getByRole('button', { name: 'Next', exact: true });

try {
  // Shell and tenant list
  await page.goto('/tenants', { waitUntil: 'networkidle' });
  await snap('shell-body', page.locator('body'));
  await snap('tenants-list');
  const ministry = (await (await page.request.get(`/api/tenants/${T}`)).json()).data.tenant.tenantName;
  await step('row menu', async () => {
    await page.getByRole('button', { name: `More actions for ${ministry}` }).click();
    await snap('tenants-row-menu', page.getByRole('menu').first());
    await page.keyboard.press('Escape');
  });
  await step('delete dialog', async () => {
    await page.getByRole('checkbox', { name: `Select ${ministry}` }).check();
    await snap('tenants-list-ticked');
    await page.getByRole('button', { name: /^Delete selected/ }).click();
    await snap('tenants-delete-dialog', dialog());
    await dialog().getByRole('button', { name: 'Cancel' }).click();
  });

  // Super Admins
  await page.goto('/admins', { waitUntil: 'networkidle' });
  await snap('admins');

  // Wizard, step by step (never Create)
  await page.goto('/tenants/new', { waitUntil: 'networkidle' });
  await snap('wizard-0-basic');
  const free = (await (await page.request.get('/api/ministries')).json()).data.find((m) => !m.taken)?.name;
  await step('wizard step 0', async () => {
    await page.locator('#ministryId').selectOption({ label: free });
    await page.locator('#adminName').fill('QA Map');
    await page.locator('#adminEmail').fill('qa.map@digitalindia.gov.in');
    await snap('wizard-0-filled');
    await next().click();
  });
  await snap('wizard-1-branding');
  await step('wizard step 1 advanced', async () => {
    await page.getByRole('button', { name: /advanced|tokens/i }).first().click();
    await snap('wizard-1-branding-advanced');
  });
  await step('wizard step 1 next', () => next().click());
  await snap('wizard-2-assistant');
  await step('wizard step 2', async () => {
    for (const [label, value] of [['Assistant name', 'QA Assistant'], ['Welcome heading', 'QA heading'], ['Welcome subheading', 'QA subheading'], ['Chat input placeholder', 'QA placeholder']]) {
      await page.getByRole('textbox', { name: label, exact: true }).fill(value);
    }
    await next().click();
  });
  await snap('wizard-3-llm-onprem');
  await step('wizard step 3 bedrock', async () => {
    await page.locator('#provider').selectOption('bedrock');
    await snap('wizard-3-llm-bedrock');
    await page.locator('#bedrockAccessKeyId').fill('qa-dummy-access-key');
    await page.locator('#bedrockSecretAccessKey').fill('qa-dummy-secret-key');
    await page.getByRole('button', { name: /Check credentials/ }).click();
    await page.waitForTimeout(1_500);
    await snap('wizard-3-llm-bedrock-models-loaded');
    await page.locator('#provider').selectOption('on_prem');
  });
  await step('wizard step 3 on-prem', async () => {
    await page.locator('#llmApiKey').fill('qa-dummy-key');
    await page.locator('#model').fill('qa-chat-model');
    await page.locator('#embeddingModel').fill('qa-embed-model');
    await next().click();
  });
  await snap('wizard-4-files');
  await step('wizard step 4', () => next().click());
  await snap('wizard-5-departments');
  await step('wizard step 5 row', async () => {
    await page.getByRole('button', { name: /^\+? ?Add division$/ }).click();
    await snap('wizard-5-departments-row');
    await page.getByRole('button', { name: /^Remove/ }).first().click();
    await next().click();
  });
  await snap('wizard-6-sources');
  await step('wizard step 6', () => next().click());
  await snap('wizard-7-review');
  await snap('wizard-preview', page.getByRole('complementary', { name: 'Portal preview' }));

  // Edit page: tabs and configuration sections
  await page.goto(`/tenants/${T}/edit`, { waitUntil: 'networkidle' });
  await snap('edit-default');
  for (const s of ['Status', 'Basic Info', 'Branding', 'Assistant & Logos', 'LLM Config', 'File Rules', 'Sources & modules', 'MCP connectors']) {
    await step(`edit section ${s}`, async () => {
      await byName(new RegExp(`^${s.replace(/[&]/g, '\\&')}\\b`)).click();
      await page.waitForTimeout(500);
      await snap(`edit-config-${s.toLowerCase().replace(/[^a-z]+/g, '-')}`);
    });
  }
  await step('edit package confirmation', async () => {
    await byName(/^Basic Info\b/).click();
    await page.getByRole('radio', { name: /AI Assistant only/ }).check({ force: true });
    await page.waitForTimeout(500);
    await snap('edit-basic-package-confirm', dialog().or(main()));
    await page.keyboard.press('Escape');
  });
  for (const tab of ['People', 'Divisions', 'Roles']) {
    await step(`edit tab ${tab}`, async () => {
      await page.goto(`/tenants/${T}/edit`, { waitUntil: 'networkidle' });
      await byName(new RegExp(`^${tab}\\b`)).click();
      await page.waitForTimeout(1_000);
      await snap(`edit-tab-${tab.toLowerCase()}`);
    });
  }
  await step('edit role detail', async () => {
    await page.getByText(/Tenant Admin/).first().click();
    await page.waitForTimeout(800);
    await snap('edit-tab-roles-detail');
  });
} finally {
  if ((await page.request.get('/api/auth/session')).status() === 200) await ctx.storageState({ path: SESSION }); // keep rotated cookies
  console.log(`snapshots: ${n}; admin-origin writes blocked: ${blocked.length ? blocked.join(', ') : 'none'}`);
  await browser.close();
}
