import type { Dialog, Locator, Page } from '@playwright/test';
import { test, expect, blockWrites } from './fixtures.js';

// The edit page of the standing test tenant (env.testTenant). It belongs to the user: READ ONLY.
// Every test that types or presses a button calls blockWrites first, so nothing it does can
// reach the server; a few answer one route themselves (registered later, so they win).

const FILE_TYPES: Record<string, string> = {
  PDF: 'application/pdf',
  'Word (.doc)': 'application/msword',
  'Word (.docx)': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'Excel (.xls)': 'application/vnd.ms-excel',
  'Excel (.xlsx)': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'PowerPoint (.ppt)': 'application/vnd.ms-powerpoint',
  'PowerPoint (.pptx)': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'Text (.txt)': 'text/plain',
  CSV: 'text/csv',
  PNG: 'image/png',
  JPEG: 'image/jpeg',
};

const MODULES: Record<string, string> = {
  'Advanced Dashboard': 'advancedDashboard',
  'AI Assistant (Generate)': 'aiAssistant',
  'Knowledge-base Search': 'kbSearch',
  'Document Ingestion': 'documentIngestion',
  'Parliament Dashboard': 'parliamentDashboard',
  'Provisional Questions': 'provisionalQuestions',
  'Admitted Questions': 'admittedQuestions',
  'Assigned Questions': 'assignedQuestions',
  'Received Answers': 'receivedAnswers',
  'Completed Questions': 'completedQuestions',
  'Re-Approval Requests': 'reApprovals',
  'Department Dashboard': 'departmentDashboard',
  'Department Provisional Questions': 'departmentProvisional',
  'Department Admitted Questions': 'departmentAdmitted',
  'Department Completed Questions': 'departmentCompleted',
  'Department Profile': 'departmentProfile',
  'Users & roles': 'usersAndRoles',
  Divisions: 'divisions',
};

// spec.md §7.1 (21 Oct): twenty-four keys; parliament:advanced-dashboard was renamed parliament:executive-dashboard.
const PERMISSIONS = [
  'users:read', 'users:manage', 'roles:read', 'roles:manage', 'permissions:read', 'ingestion:manage',
  'divisions:read', 'divisions:manage', 'assistant:generate', 'assistant:search',
  'parliament:dashboard', 'parliament:provisional', 'parliament:admitted', 'parliament:assigned',
  'parliament:received-answers', 'parliament:completed', 'parliament:reapproval',
  'parliament:executive-dashboard', 'parliament:secretary-dashboard',
  'department:dashboard', 'department:provisional', 'department:admitted', 'department:completed', 'department:profile',
];

const TABS = ['Configuration', 'People', 'Divisions', 'Roles'] as const;
const tabList = (page: Page) => page.getByRole('tablist', { name: 'Tenant sections' });
const tab = (page: Page, name: (typeof TABS)[number]) => tabList(page).getByRole('tab', { name, exact: true });
const saveConfig = (page: Page) => page.getByRole('button', { name: 'Save configuration' });

// A4.1: the Configuration tab shows one section at a time; a settings menu switches between them.
const SECTIONS = ['Status', 'Basic Info', 'Branding', 'Assistant & Logos', 'LLM Config', 'File Rules', 'Sources & modules', 'MCP connectors'] as const;
type Section = (typeof SECTIONS)[number];
/** A menu entry: whole words, case-sensitive, so the Configuration tab's own name ("… branding, LLM, files") never matches. */
function menuEntry(page: Page, name: Section): Locator {
  const re = new RegExp(`(^|\\W)${name}(\\W|$)`);
  // Live (22 Oct): navigation "Configuration sections", one link per section.
  const nav = page.getByRole('navigation', { name: 'Configuration sections' });
  const main = page.getByRole('main');
  return nav.getByRole('link', { name: re }).or(main.getByRole('link', { name: re })).or(main.getByRole('button', { name: re })).or(main.getByRole('tab', { name: re })).first();
}
const showSection = (page: Page, name: Section) => test.step(`Choose "${name}" in the settings menu`, () => menuEntry(page, name).click());

// D1 / spec §3.5: one package per ministry, chosen with radio cards on Basic Info.
const PACKAGES = { platform_ai: 'Platform + AI Assistant', platform: 'Platform only', assistant: 'AI Assistant only' } as const;
type Pkg = keyof typeof PACKAGES;
const pkgRadio = (page: Page, p: Pkg) => page.getByRole('radio', { name: new RegExp(`^${PACKAGES[p].replace('+', '\\+')}`) });

/** Picks a package. One that removes anything asks "Switch to <package>?" first — a browser confirm or an in-page dialog:
 * answers it and returns its text. With no answer given, a confirmation is not expected: returns '' if none appeared. */
async function choosePackage(page: Page, p: Pkg, answer?: 'accept' | 'cancel'): Promise<string> {
  let asked = '';
  const onDialog = (d: Dialog) => {
    asked = d.message();
    void (answer === 'accept' ? d.accept() : d.dismiss());
  };
  page.once('dialog', onDialog);
  // The card title, centred: a forced click on the hidden radio can land on the sticky save bar over the third card.
  const card = page.getByRole('group', { name: 'Package' }).getByText(PACKAGES[p], { exact: true }).first();
  await card.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await card.click();
  const modal = page.getByRole('dialog').or(page.getByRole('alertdialog')).filter({ hasText: 'Switch to' }).filter({ hasNotText: 'Accessibility Options' }).first();
  if (!answer) await page.waitForTimeout(1_000); // asserting an absence: give a confirmation time to appear
  else await expect.poll(async () => asked || (await modal.isVisible())).toBeTruthy();
  page.off('dialog', onDialog);
  if (asked || !(await modal.isVisible())) return asked;
  const text = await modal.innerText();
  // The dialog also has an icon "Close" button: confirm with the one that is neither Cancel nor Close ("Switch package").
  if (answer) await modal.getByRole('button', { name: answer === 'cancel' ? /^Cancel$/ : /^(?!(Cancel|Close)$).+/ }).last().click();
  return text;
}

// spec §6.6: gov.in / nic.in, or a subdomain of either.
const OFFICIAL = /^[^@\s]+@(?:[a-z0-9-]+\.)*(?:gov|nic)\.in$/i;
const GOI = 'Use an official Government of India email address (gov.in or nic.in).';
/** Answers the People list with no one, so a stored pre-policy address cannot interfere (that case is SA-EPPL-17). */
const noPeople = (page: Page, slug: string) =>
  page.route(`**/api/tenants/${slug}/users*`, (r) => (r.request().method() === 'GET' ? r.fulfill({ json: { data: [] } }) : r.fallback()));
const trustBox = (page: Page) => page.getByRole('checkbox', { name: 'I confirm these URLs are trustworthy' });
// "Years to look back" has no id and no label association (page map 30): the first input after its label.
const lookBack = (page: Page) => page.getByText('Years to look back', { exact: true }).locator('xpath=following::input[1]');

async function openEdit(page: Page, slug: string, tabName?: 'People' | 'Divisions' | 'Roles'): Promise<void> {
  await test.step(`Open /tenants/${slug}/edit${tabName ? ` and choose the ${tabName} tab` : ''}`, async () => {
    await page.goto(`/tenants/${slug}/edit`);
    if (tabName) await tab(page, tabName).click();
  });
}

async function stored(page: Page, slug: string) {
  const res = await page.request.get(`/api/tenants/${slug}`);
  expect(res.status(), `GET /api/tenants/${slug}`).toBe(200);
  return (await res.json()).data.tenant;
}

/** Key of the one `{prefix}{key}` field holding `value` — editor rows are keyed, not ordered. */
async function keyOf(page: Page, prefix: string, value: string): Promise<string> {
  const fields = page.locator(`[id^="${prefix}"]`);
  await expect(fields.first()).toBeAttached();
  const ids = await fields.evaluateAll((els, v) => els.filter((e) => (e as HTMLInputElement).value === v).map((e) => e.id), value);
  expect(ids, `one ${prefix}… field holding "${value}"`).toHaveLength(1);
  return ids[0]!.slice(prefix.length);
}

/** The innermost element holding both the field and `marker`: its editor row. */
const rowOf = (page: Page, fieldId: string, marker: Locator) =>
  page.locator('tr, div, li').filter({ has: page.locator(`[id="${fieldId}"]`) }).filter({ has: marker }).last(); // People rows are table rows (22 Oct)

/** Presses "+ Add person" and returns the new row's key. */
async function addPerson(page: Page): Promise<string> {
  const names = page.locator('[id^="name-"]');
  await expect(page.getByRole('button', { name: /^\+? ?Add person$/ })).toBeVisible();
  const n = await names.count();
  await page.getByRole('button', { name: /^\+? ?Add person$/ }).click();
  await expect(names).toHaveCount(n + 1);
  return (await names.last().getAttribute('id'))!.slice('name-'.length);
}

test.describe('A4 Edit tenant page', () => {
  test('SA-ECFG-01 four tabs: Configuration, People, Divisions, Roles', async ({ page, env }) => {
    await openEdit(page, env.testTenant);
    await test.step('Expect the tabs Configuration · People · Divisions · Roles, in that order (A4: four tabs)', async () => {
      const tabs = tabList(page).getByRole('tab');
      for (const [i, name] of TABS.entries()) await expect(tabs.nth(i)).toHaveText(new RegExp(`^${name}`));
      const all = (await tabs.allInnerTexts()).map((s) => s.trim());
      expect.soft(all, `A4 documents four tabs; the page has: ${all.join(' · ')}`).toHaveLength(TABS.length);
    });
  });

  test('SA-ECFG-02 header: ministry name, portal link in a new tab, status badge matching the API', async ({ page, env }) => {
    const t = await test.step(`GET /api/tenants/${env.testTenant}`, () => stored(page, env.testTenant));
    await openEdit(page, env.testTenant);
    await test.step(`Expect heading "${t.tenantName}", link "Open /${env.testTenant} →" to ${env.portalUrl}/${env.testTenant} in a new tab, badge "${t.status}"`, async () => {
      await expect(page.getByRole('heading', { level: 1 }).getByText(t.tenantName, { exact: true })).toBeVisible();
      const link = page.getByRole('main').getByRole('link', { name: /^Open (portal|\/)/ });
      await expect(link).toHaveAttribute('href', `${env.portalUrl}/${env.testTenant}`);
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(page.getByRole('main').getByText(t.status, { exact: true }).first()).toBeVisible();
    });
  });

  test('SA-ECFG-07 an unknown tenant shows a not-found state', async ({ page }) => {
    const res = await test.step('Open /tenants/nosuch/edit', () => page.goto('/tenants/nosuch/edit'));
    await test.step('Expect a not-found page and no edit form', async () => {
      await expect(page.getByText(/not found|could not be found|404/i).first()).toBeVisible();
      await expect(saveConfig(page)).toHaveCount(0);
      const wording = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 200);
      test.info().annotations.push({ type: 'question', description: `UI wording is unspecified. Observed (HTTP ${res?.status()}): "${wording}"` });
    });
    await test.step('GET /api/tenants/nosuch — expect 404 No tenant found with id "nosuch"', async () => {
      const api = await page.request.get('/api/tenants/nosuch');
      expect(api.status()).toBe(404);
      expect((await api.json()).error.message).toBe('No tenant found with id "nosuch"');
    });
  });
});

test.describe('A4.1 Configuration tab', () => {
  test('SA-ECFG-03 settings menu: Status … MCP connectors in order, one section at a time, no Features section', async ({ page, env }) => {
    await openEdit(page, env.testTenant);
    await test.step(`Expect the menu entries ${SECTIONS.join(', ')} in that order, and no "Features" or "Workflow rules" entry`, async () => {
      const menu = page.getByRole('navigation', { name: 'Configuration sections' });
      await expect(menu.getByRole('link').first()).toBeVisible();
      const names = (await menu.getByRole('link').allInnerTexts()).map((n) => n.trim());
      expect(names.map((n) => SECTIONS.find((s) => n.startsWith(s))).filter(Boolean)).toEqual([...SECTIONS]);
      expect(names.filter((n) => /^(Features|Workflow rules)\b/.test(n))).toEqual([]);
    });
    await showSection(page, 'Branding');
    await test.step('Expect the Branding fields shown, and neither the Status nor the LLM Config fields', async () => {
      await expect(page.locator('#primaryColor')).toBeVisible();
      await expect(page.getByRole('region', { name: 'Status' })).toBeHidden();
      await expect(page.locator('#embeddingDimensions')).toBeHidden();
    });
  });

  test('SA-ECFG-04 ministry name and slug are read-only text', async ({ page, env }) => {
    const t = await test.step(`GET /api/tenants/${env.testTenant}`, () => stored(page, env.testTenant));
    await openEdit(page, env.testTenant);
    await showSection(page, 'Basic Info');
    await test.step(`Expect Basic Info to show "${t.tenantName}" and "${env.testTenant}" as text, with no field holding either and no ministry dropdown`, async () => {
      const card = page.locator('div, section')
        .filter({ has: page.getByRole('heading', { name: 'Basic Info', exact: true }) })
        .filter({ hasText: 'Portal slug' })
        .last();
      await expect(card.getByText(t.tenantName, { exact: true })).toBeVisible();
      await expect(card.getByText(env.testTenant, { exact: true })).toBeVisible();
      // Basic Info now also holds the package cards and two portal switches (A4.1): only identity must be read-only.
      await expect(page.locator('#ministryId, #slug')).toHaveCount(0);
      const holding = await card.locator('input, select, textarea').evaluateAll((els, v) => els.filter((e) => v.includes((e as HTMLInputElement).value)).length, [t.tenantName, env.testTenant]);
      expect(holding, 'fields holding the ministry name or the slug').toBe(0);
      await expect(card.locator('[contenteditable="true"]')).toHaveCount(0);
    });
  });

  test('SA-ECFG-05 no administrator fields and no live preview', async ({ page, env }) => {
    await openEdit(page, env.testTenant);
    await showSection(page, 'Basic Info');
    await test.step('Expect no admin name/email inputs and no "Portal preview" column', async () => {
      await expect(saveConfig(page)).toBeVisible();
      await expect(page.locator('#adminName, #adminEmail')).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: /admin/i })).toHaveCount(0);
      await expect(page.getByRole('complementary', { name: 'Portal preview' })).toHaveCount(0);
    });
  });

  test('SA-ECFG-06 the form loads the stored values', async ({ page, env }) => {
    const t = await test.step(`GET /api/tenants/${env.testTenant}`, () => stored(page, env.testTenant));
    const a = t.assistant;
    const f = t.features ?? {};
    await openEdit(page, env.testTenant);
    await showSection(page, 'Basic Info');
    await test.step('Expect the stored package chosen, and the accessibility bar, idle timeout and warning as stored (unset: shown, 15, 2)', async () => {
      await expect.soft(pkgRadio(page, (f.package ?? 'platform_ai') as Pkg)).toBeChecked();
      await expect.soft(page.locator('#accessibilityBar')).toBeChecked({ checked: f.accessibilityBar ?? true });
      await expect.soft(page.locator('#sessionTimeoutMinutes')).toHaveValue(String(f.sessionTimeoutMinutes ?? 15));
      await expect.soft(page.locator('#sessionWarningMinutes')).toHaveValue(String(f.sessionWarningMinutes ?? 2));
    });
    await showSection(page, 'Branding');
    await test.step('Expect the three colours to match', async () => {
      for (const id of ['userMsgColor', 'primaryColor', 'accentColor']) await expect.soft(page.locator(`#${id}`)).toHaveValue(a.UIConfig[id]);
    });
    await showSection(page, 'Assistant & Logos');
    await test.step('Expect assistant strings, look-back and logo paths to match', async () => {
      await expect.soft(page.locator('#displayName')).toHaveValue(a.displayName);
      await expect.soft(page.getByPlaceholder('Ready when you are.')).toHaveValue(a.welcomeMsg.heading);
      await expect.soft(page.getByPlaceholder(/^Your digital assistant for/)).toHaveValue(a.welcomeMsg.subheading);
      await expect.soft(page.getByPlaceholder(/^Ask your queries here/)).toHaveValue(a.welcomeMsg.inputPlaceholder);
      await expect.soft(lookBack(page)).toHaveValue(String(a.docYear.lookbackYears));
      for (const [k, v] of Object.entries(a.logo)) await expect.soft(page.locator(`#logo-${k}`)).toHaveValue(v as string);
    });
    await showSection(page, 'LLM Config');
    await test.step('Expect the LLM config to match', async () => {
      await expect.soft(page.locator('#provider')).toHaveValue(a.llm.provider);
      for (const id of ['baseUrl', 'model', 'embeddingModel']) await expect.soft(page.locator(`#${id}`)).toHaveValue(a.llm[id] ?? '');
      await expect.soft(page.locator('#embeddingDimensions')).toHaveValue(String(a.llm.embeddingDimensions));
    });
    await showSection(page, 'File Rules');
    await test.step('Expect file size and file types to match', async () => {
      await expect.soft(page.locator('#filesizeMb')).toHaveValue(String(a.filesize.bytes / 1024 / 1024));
      for (const [label, mime] of Object.entries(FILE_TYPES)) {
        await expect.soft(page.getByRole('checkbox', { name: label, exact: true })).toBeChecked({ checked: a.fileSupportType.mimeTypes.includes(mime) });
      }
    });
    await showSection(page, 'Sources & modules');
    // enabledModules is the package's module map (spec §3.5), so the checklist mirrors the package.
    await test.step('Expect source websites, trust box and portal modules to match', async () => {
      for (const s of t.sourceWebsites) await expect.soft(page.getByText(s.url, { exact: true })).toBeVisible();
      if (t.sourceWebsites.length) await expect.soft(trustBox(page)).toBeChecked({ checked: t.sourceWebsitesTrusted === true });
      for (const [label, key] of Object.entries(MODULES)) {
        await expect.soft(page.getByRole('checkbox', { name: label, exact: true })).toBeChecked({ checked: Boolean(t.enabledModules[key]) });
      }
    });
  });

  const INVALID: Array<{ what: string; section: Section; set: (page: Page) => Promise<unknown>; message: string }> = [
    { what: 'primary colour "red"', section: 'Branding', set: (p) => p.locator('#primaryColor').fill('red'), message: 'Enter a valid color.' },
    { what: 'years to look back 51', section: 'Assistant & Logos', set: (p) => lookBack(p).fill('51'), message: 'Enter a whole number between 0 and 50.' },
    { what: 'embedding dimensions 0', section: 'LLM Config', set: (p) => p.locator('#embeddingDimensions').fill('0'), message: 'Enter a positive whole number.' },
    {
      what: 'every file type unticked',
      section: 'File Rules',
      set: async (p) => {
        for (const label of Object.keys(FILE_TYPES)) await p.getByRole('checkbox', { name: label, exact: true }).uncheck();
      },
      // "Select at least one file extension." and/or "Select at least one MIME type."
      message: 'Select at least one',
    },
  ];
  for (const c of INVALID) {
    test(`SA-ECFG-08 an invalid edit blocks the save: ${c.what}`, async ({ page, env }) => {
      const writes = await blockWrites(page);
      await openEdit(page, env.testTenant);
      await showSection(page, c.section);
      await test.step(`Set ${c.what}, press Save configuration`, async () => {
        await c.set(page);
        await saveConfig(page).click();
      });
      await test.step(`Expect "${c.message}…" and no PATCH sent`, async () => {
        await expect(page.getByText(c.message).first()).toBeVisible();
        expect(writes).toEqual([]);
      });
    });
  }

  test('SA-ECFG-08 an invalid edit blocks the save: source http://x.gov.in', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const url = 'http://x.gov.in';
    await openEdit(page, env.testTenant);
    await showSection(page, 'Sources & modules');
    await test.step(`Type ${url} in Source website URL, press Add`, async () => {
      await page.locator('#sourceUrl').fill(url);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
    });
    await test.step('Expect "Must be a public HTTPS URL (no localhost or private IPs)." and the URL not listed', async () => {
      await expect(page.getByText('Must be a public HTTPS URL (no localhost or private IPs).')).toBeVisible();
      await expect(page.getByText(url, { exact: true })).toHaveCount(0);
    });
    await test.step(`Press Save configuration if it is enabled (nothing changed: it stays disabled) — expect no request carrying ${url}`, async () => {
      if (await saveConfig(page).isEnabled()) {
        const sent = page.waitForRequest((r) => r.method() === 'PATCH', { timeout: 5_000 }).catch(() => null);
        await saveConfig(page).click();
        expect((await sent)?.postData() ?? '').not.toContain(url);
      }
      expect(writes.filter((w) => w.body?.includes(url))).toEqual([]);
    });
  });

  test('SA-ECFG-09 an error in a section not on screen: Save opens that section; the save-error link focuses the field', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const dims = page.locator('#embeddingDimensions');
    await openEdit(page, env.testTenant);
    await showSection(page, 'LLM Config');
    await test.step('Set Embedding dimensions to 0', () => dims.fill('0'));
    await showSection(page, 'Branding');
    await test.step('Expect Embedding dimensions not shown; press Save configuration', async () => {
      await expect(dims).toBeHidden();
      await saveConfig(page).click();
    });
    await test.step('Expect LLM Config opened with "Enter a positive whole number." in view, and no PATCH', async () => {
      await expect(dims).toBeVisible();
      await expect(page.getByText('Enter a positive whole number.').first()).toBeInViewport();
      expect(writes).toEqual([]);
    });
    await showSection(page, 'Branding');
    await test.step('Press the save-error link (wording unspecified: matched by the field label or its message) — expect Embedding dimensions shown and focused', async () => {
      const re = /Embedding dimensions|Enter a positive whole number/;
      await page.getByRole('link', { name: re }).or(page.getByRole('button', { name: re })).first().click();
      await expect(dims).toBeFocused();
    });
  });

  test('SA-ECFG-10 a failed save shows the server error in the save bar', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await page.route(`**/api/tenants/${env.testTenant}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      await new Promise((r) => setTimeout(r, 1_500));
      await route.fulfill({ status: 502, json: { error: { message: 'Upstream failed' } } });
    });
    await openEdit(page, env.testTenant);
    await showSection(page, 'Assistant & Logos');
    await test.step('Change the welcome subheading; press Save configuration (the test answers the PATCH with 502 "Upstream failed")', async () => {
      await page.getByPlaceholder(/^Your digital assistant for/).fill('QA subheading — never saved');
      await saveConfig(page).click();
    });
    await test.step('Expect "Saving…", then "Upstream failed" and the button back to Save configuration', async () => {
      await expect(page.getByRole('button', { name: 'Saving…' })).toBeVisible();
      await expect(page.getByText('Upstream failed')).toBeVisible();
      await expect(saveConfig(page)).toBeEnabled();
      expect(writes).toEqual([]);
    });
  });

  test('SA-ECFG-16 API key: empty, placeholder, optional, and the stored key is nowhere on the page', async ({ page, env }) => {
    const key = page.locator('#llmApiKey');
    await openEdit(page, env.testTenant);
    await showSection(page, 'LLM Config');
    await test.step('Expect #llmApiKey empty, placeholder "Leave blank to keep existing key", not required', async () => {
      await expect(key).toHaveValue('');
      await expect(key).toHaveAttribute('placeholder', 'Leave blank to keep existing key');
      expect(await key.evaluate((e) => (e as HTMLInputElement).required)).toBe(false);
    });
    await test.step('Expect the stored key (PQA_ADMIN_LLM_API_KEY) nowhere in the page HTML', async () => {
      const secret = process.env.PQA_ADMIN_LLM_API_KEY?.trim();
      if (!secret) {
        test.info().annotations.push({ type: 'not-measured', description: 'PQA_ADMIN_LLM_API_KEY is unset: key absence not checked' });
        return;
      }
      // A boolean, so a failure never prints the key.
      expect((await page.content()).includes(secret), 'the stored API key appears in the page HTML').toBe(false);
    });
  });

  test('SA-ECFG-19 Sync now only for a non-active tenant with the trust box ticked', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const url = 'https://qa-sync-check.example.gov.in/docs';
    const syncNow = page.getByRole('button', { name: /^Sync now/ });
    const addSource = async () => {
      await page.locator('#sourceUrl').fill(url);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(page.getByText(url, { exact: true })).toBeVisible();
    };
    await test.step(`GET /api/tenants/${env.testTenant} — expect it not active`, async () => {
      expect((await stored(page, env.testTenant)).status).not.toBe('active');
    });
    await openEdit(page, env.testTenant);
    await showSection(page, 'Sources & modules');
    await test.step(`Add source ${url} (never saved)`, addSource);
    await test.step('Trust box unticked: expect no Sync now', async () => {
      await trustBox(page).uncheck();
      await expect(syncNow).toHaveCount(0);
    });
    await test.step('Tick "I confirm these URLs are trustworthy": expect Sync now (not pressed)', async () => {
      await trustBox(page).check();
      await expect(syncNow.first()).toBeVisible();
    });
    const active = await test.step('Find an active tenant (GET /api/tenants)', async () => {
      const rows: Array<{ tenant: { slug: string; status: string } }> = (await (await page.request.get('/api/tenants')).json()).data;
      return rows.find((r) => r.tenant.status === 'active')?.tenant.slug;
    });
    if (!active) {
      test.info().annotations.push({ type: 'not-measured', description: 'no active tenant on the environment: the "active" case was not checked' });
    } else {
      await test.step(`Open /tenants/${active}/edit (active) › Sources & modules, add the source, tick trust: expect no Sync now`, async () => {
        await page.goto(`/tenants/${active}/edit`);
        await menuEntry(page, 'Sources & modules').click();
        await addSource();
        await trustBox(page).check();
        await expect(syncNow).toHaveCount(0);
      });
    }
    await test.step('Expect nothing sent', async () => expect(writes).toEqual([]));
  });

  test('SA-ECFG-21 MCP connector row: fields, defaults, secret-ref field only with auth', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openEdit(page, env.testTenant);
    await showSection(page, 'MCP connectors');
    const i = await test.step('Press Add MCP server', async () => {
      const n = await page.locator('[id^="mcp-name-"]').count();
      await page.getByRole('button', { name: 'Add MCP server' }).click();
      return n;
    });
    const secret = page.locator(`#mcp-secret-${i}`);
    const auth = page.locator(`#mcp-auth-${i}`);
    await test.step('Expect name, URL, transport SSE (SSE/HTTP), auth None (None/Bearer/Basic/API key), Enabled ticked, tools; no secret field', async () => {
      await expect(page.locator(`#mcp-name-${i}`)).toHaveValue('');
      await expect(page.locator(`#mcp-url-${i}`)).toHaveValue('');
      await expect(page.locator(`#mcp-transport-${i} option`)).toHaveText(['SSE', 'HTTP']);
      await expect(page.locator(`#mcp-transport-${i} option:checked`)).toHaveText('SSE');
      await expect(auth.locator('option')).toHaveText(['None', 'Bearer', 'Basic', 'API key']);
      await expect(auth.locator('option:checked')).toHaveText('None');
      await expect(page.getByRole('switch', { name: /^Enabled\b/ }).nth(i)).toBeChecked();
      await expect(page.locator(`#mcp-tools-${i}`)).toHaveValue('');
      await expect(secret).toBeHidden();
    });
    for (const label of ['Bearer', 'Basic', 'API key']) {
      await test.step(`Choose auth "${label}": expect the secret-ref field`, async () => {
        await auth.selectOption({ label });
        await expect(secret).toBeVisible();
      });
    }
    await test.step('Back to None: secret field hidden; banner says secret refs only', async () => {
      await auth.selectOption({ label: 'None' });
      await expect(secret).toBeHidden();
      await expect(page.getByText(/Auth stores secret refs only/).first()).toBeVisible();
      expect(writes).toEqual([]);
    });
  });

  test('SA-ECFG-27 Save mirrors the accepted MIME types into questionListMimeTypes', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openEdit(page, env.testTenant);
    await showSection(page, 'File Rules');
    await test.step('Tick Word (.docx), press Save configuration (the PATCH is captured and aborted)', async () => {
      await page.getByRole('checkbox', { name: 'Word (.docx)', exact: true }).check();
      await saveConfig(page).click();
    });
    await test.step('Expect the captured body: questionListMimeTypes equals mimeTypes, which include .docx', async () => {
      await expect.poll(() => writes.some((w) => w.method === 'PATCH')).toBe(true);
      const patch = writes.find((w) => w.method === 'PATCH');
      expect(patch?.path).toBe(`/api/tenants/${env.testTenant}`);
      const files = JSON.parse(patch?.body ?? '{}').tenant.assistant.fileSupportType;
      expect(files.mimeTypes).toContain(FILE_TYPES['Word (.docx)']);
      expect(files.questionListMimeTypes).toEqual(files.mimeTypes);
    });
  });

  test('SA-ECFG-28 OpenAPI status line shows the stored file or "No file attached."', async ({ page, env }) => {
    const t = await test.step(`GET /api/tenants/${env.testTenant}`, () => stored(page, env.testTenant));
    const expected = t.openapiSpec ? `Current: ${t.openapiSpec.fileName}` : 'No file attached.';
    await openEdit(page, env.testTenant);
    await showSection(page, 'Sources & modules');
    await test.step(`Expect "${expected}"`, async () => {
      await expect(page.getByText(expected, { exact: true })).toBeVisible();
    });
  });

  test('SA-ECFG-32 the chosen section is kept in the address; ?section=branding and the old ?section=sources open their sections', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await test.step(`Open /tenants/${env.testTenant}/edit?tab=config&section=branding — expect Branding shown, Status not`, async () => {
      await page.goto(`/tenants/${env.testTenant}/edit?tab=config&section=branding`);
      await expect(page.locator('#primaryColor')).toBeVisible();
      await expect(page.getByRole('region', { name: 'Status' })).toBeHidden();
    });
    await test.step(`Open /tenants/${env.testTenant}/edit?section=sources (the old link) — expect Sources & modules shown`, async () => {
      await page.goto(`/tenants/${env.testTenant}/edit?section=sources`);
      await expect(page.locator('#sourceUrl')).toBeVisible();
    });
    await showSection(page, 'LLM Config');
    await test.step('Expect the address to name the new section; reload — expect LLM Config still shown', async () => {
      await expect(page).toHaveURL(/[?&]section=/);
      await expect(page).not.toHaveURL(/section=sources/);
      await page.reload();
      await expect(page.locator('#embeddingDimensions')).toBeVisible();
    });
    expect(writes).toEqual([]);
  });

  test('SA-ECFG-33 a package change that removes anything asks first; Cancel keeps it; a larger package does not ask', async ({ page, env }, testInfo) => {
    const writes = await blockWrites(page);
    const t = await test.step(`GET /api/tenants/${env.testTenant}`, () => stored(page, env.testTenant));
    const from = (t.features?.package ?? 'platform_ai') as Pkg;
    const to: Pkg = from === 'assistant' ? 'platform' : 'assistant'; // either removes something from any other package
    const title = `Switch to ${PACKAGES[to]}?`;
    await openEdit(page, env.testTenant);
    await showSection(page, 'Basic Info');
    await test.step(`Choose "${PACKAGES[to]}" and Cancel — expect "${title}" listing what users lose, and "${PACKAGES[from]}" still chosen`, async () => {
      const asked = await choosePackage(page, to, 'cancel');
      await testInfo.attach('confirmation', { body: asked, contentType: 'text/plain' });
      expect(asked).toContain(title);
      expect(asked.length, 'the confirmation lists what users will lose').toBeGreaterThan(title.length);
      await expect(pkgRadio(page, from)).toBeChecked();
    });
    await test.step(`Choose it again and confirm; press Save configuration — expect the PATCH (captured, aborted) to carry package "${to}"`, async () => {
      await choosePackage(page, to, 'accept');
      await expect(pkgRadio(page, to)).toBeChecked();
      await saveConfig(page).click();
      await expect.poll(() => writes.find((w) => w.method === 'PATCH')?.body ?? '').toContain(`"package":"${to}"`);
    });
    await test.step(`Choose "${PACKAGES.platform_ai}" (larger) — expect no confirmation`, async () => {
      expect(await choosePackage(page, 'platform_ai')).toBe('');
      await expect(pkgRadio(page, 'platform_ai')).toBeChecked();
    });
  });

  test('SA-ECFG-36 a typed key, a picked YAML file or a colour marks its section unsaved; Discard restores every section', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const t = await test.step(`GET /api/tenants/${env.testTenant}`, () => stored(page, env.testTenant));
    await openEdit(page, env.testTenant);
    // The unsaved dot's markup is not specified: compare the entry's markup, its section open, before and after a change.
    const marks = async (s: Section, change: () => Promise<unknown>): Promise<string> => {
      await menuEntry(page, s).click();
      const clean = await menuEntry(page, s).innerHTML();
      await change();
      await expect.poll(() => menuEntry(page, s).innerHTML(), { message: `${s} marked unsaved` }).not.toBe(clean);
      return clean;
    };
    await test.step('Branding: primary colour #123456 — expect Branding marked unsaved', () => marks('Branding', () => page.locator('#primaryColor').fill('#123456')));
    await test.step('LLM Config: type an API key — expect LLM Config marked unsaved', () => marks('LLM Config', () => page.locator('#llmApiKey').fill('qa-unsaved-key')));
    const clean = await test.step('Sources & modules: pick qa.yaml in "OpenAPI YAML file" — expect Sources & modules marked unsaved', () =>
      marks('Sources & modules', () => page.getByLabel('OpenAPI YAML file').setInputFiles({ name: 'qa.yaml', mimeType: 'application/yaml', buffer: Buffer.from('openapi: 3.0.3\n') })),
    );
    await test.step('Press Discard (accept any confirmation) — expect the staged file gone and Sources & modules no longer marked', async () => {
      page.once('dialog', (d) => d.accept());
      await page.getByRole('button', { name: /^Discard( changes)?$/ }).first().click();
      const confirm = page.getByRole('dialog').or(page.getByRole('alertdialog')).filter({ hasText: 'Discard unsaved changes?' }).first();
      if (await confirm.waitFor({ timeout: 2_000 }).then(() => true, () => false)) await confirm.getByRole('button', { name: /^Discard( changes)?$/ }).click();
      await expect(page.getByText('Selected: qa.yaml')).toHaveCount(0);
      await expect.poll(() => menuEntry(page, 'Sources & modules').innerHTML()).toBe(clean);
    });
    await showSection(page, 'LLM Config');
    await test.step('Expect the typed API key gone', () => expect(page.locator('#llmApiKey')).toHaveValue(''));
    await showSection(page, 'Branding');
    await test.step('Expect the stored primary colour back; nothing sent', async () => {
      await expect(page.locator('#primaryColor')).toHaveValue(t.assistant.UIConfig.primaryColor ?? '');
      expect(writes).toEqual([]);
    });
  });

  test("SA-ECFG-37 switching the provider on edit requires the new provider's credential", async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openEdit(page, env.testTenant);
    await showSection(page, 'LLM Config');
    const from = await page.locator('#provider').inputValue();
    const [to, message] = from === 'bedrock'
      ? (['on_prem', 'API key is required for On Prem.'] as const)
      : (['bedrock', 'Access key and secret key are required for Bedrock.'] as const);
    await test.step(`Switch Provider from ${from} to ${to}, type no credential, press Save configuration`, async () => {
      await page.locator('#provider').selectOption(to);
      await saveConfig(page).click();
    });
    await test.step(`Expect "${message}" and no PATCH`, async () => {
      await expect(page.getByText(message).first()).toBeVisible();
      expect(writes).toEqual([]);
    });
  });

  test('SA-ECFG-40 a save the server refuses opens the first section with an error', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await page.route(`**/api/tenants/${env.testTenant}`, (route) =>
      route.request().method() === 'PATCH'
        ? route.fulfill({ status: 422, json: { error: { message: 'Validation failed', fields: { 'tenant.assistant.UIConfig.primaryColor': 'Enter a valid color.' } } } })
        : route.fallback(),
    );
    await openEdit(page, env.testTenant);
    await showSection(page, 'Assistant & Logos');
    await test.step('Change the welcome subheading', () => page.getByPlaceholder(/^Your digital assistant for/).fill('QA subheading — never saved'));
    await showSection(page, 'MCP connectors');
    await test.step('Press Save configuration (the test answers 422 Validation failed: tenant.assistant.UIConfig.primaryColor "Enter a valid color.")', () => saveConfig(page).click());
    await test.step('Expect Branding opened with "Enter a valid color."; nothing written', async () => {
      await expect(page.locator('#primaryColor')).toBeVisible();
      await expect(page.getByText('Enter a valid color.').first()).toBeVisible();
      expect(writes).toEqual([]);
    });
  });
});

// A4.1a on the live build (22 Oct): no Portal status dropdown — the Status card shows the current status as text and one
// button per move ("Activate portal", "Suspend portal"; Archive only while suspended). The docs still say a dropdown.
const statusCard = (page: Page) => page.getByRole('region', { name: 'Status' });
const shownStatus = (page: Page) => statusCard(page).getByText(/^(active|inactive|suspended)$/).first();
/** Read with textContent: innerText applies the badge's CSS capitalisation. */
const shownNow = async (page: Page) => ((await shownStatus(page).textContent()) ?? '').trim().toLowerCase();
/** Presses `button`, then accepts its confirmation if one opens: a browser confirm, or an in-page dialog (never the UX4G
 * widget, which is a dialog on every page). */
async function pressAndConfirm(page: Page, button: Locator): Promise<void> {
  page.once('dialog', (d) => void d.accept());
  await button.click();
  const modal = page.getByRole('dialog').or(page.getByRole('alertdialog')).filter({ hasNotText: 'Accessibility Options' }).first();
  if (await modal.waitFor({ timeout: 2_000 }).then(() => true, () => false)) await modal.getByRole('button', { name: /^(?!(Cancel|Close)$).+/ }).last().click();
}
const DROPDOWN = 'A4.1a describes a Portal status dropdown (#status: Active · Inactive · Suspended); the live card shows the status and one button per move.';

test.describe('A4.1a Portal status', () => {
  test('SA-ESTA-01 status options are Active, Inactive, Suspended — Archived is not offered', async ({ page, env }) => {
    await openEdit(page, env.testTenant);
    await showSection(page, 'Status');
    const now = await test.step('Read the status the card shows', () => shownNow(page));
    test.info().annotations.push({ type: 'deviation', description: DROPDOWN });
    test.skip(now !== 'inactive', `${env.testTenant} is ${now}: the moves were only checked from inactive (T's state)`);
    await test.step('Inactive: expect a move to Active and to Suspended, and no Archive (offered only while suspended)', async () => {
      await expect(statusCard(page).getByRole('button', { name: 'Activate portal', exact: true })).toBeVisible();
      await expect(statusCard(page).getByRole('button', { name: 'Suspend portal', exact: true })).toBeVisible();
      await expect(statusCard(page).getByRole('button', { name: /^Archive\b/ })).toHaveCount(0);
    });
  });

  test('SA-ESTA-02 status hint', async ({ page, env }) => {
    const doc = 'Status is saved immediately. Pausing reaches the portal after its config cache refreshes (~5s).';
    await openEdit(page, env.testTenant);
    await showSection(page, 'Status');
    await test.step(`Expect "${doc}"`, async () => {
      const hint = statusCard(page).getByText(/^Status is saved immediately\./);
      await expect(hint).toBeVisible();
      const text = (await hint.innerText()).trim();
      if (text !== doc) test.info().annotations.push({ type: 'deviation', description: `A4.1a hint "${doc}"; the page says "${text}"` });
      expect(text).toMatch(/^Status is saved immediately\. .+ the portal after its config cache refreshes \(~5s\)\.$/);
    });
  });

  test('SA-ESTA-08 a failed status change shows the server message and leaves the status as it was', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await page.route(`**/api/tenants/${env.testTenant}/status`, (route) =>
      route.fulfill({ status: 500, json: { error: { message: 'Failed to update portal status' } } }),
    );
    await openEdit(page, env.testTenant);
    await showSection(page, 'Status');
    const before = await test.step('Read the status the card shows', () => shownNow(page));
    const move = before === 'active' ? 'Suspend portal' : before === 'suspended' ? 'Reactivate portal' : 'Activate portal';
    await test.step(`Press "${move}" (the test answers the PATCH with 500)`, () =>
      pressAndConfirm(page, statusCard(page).getByRole('button', { name: move, exact: true })));
    await test.step(`Expect "Failed to update portal status" and the status still "${before}"`, async () => {
      await expect(page.getByText('Failed to update portal status').first()).toBeVisible(); // inline and in a toast
      await expect(shownStatus(page)).toHaveText(new RegExp(`^${before}$`, 'i')); // CSS capitalises the badge
      expect(writes).toEqual([]);
    });
  });
});

test.describe('A4.2 People tab', () => {
  test('SA-EPPL-01 the seeded admin is listed as an active Ministry admin', async ({ page, env }) => {
    // The standing tenant's admin, as the panel stores it (PQA_ADMIN_TENANT_ADMIN_EMAIL is for tenants the suite creates).
    const email = await test.step(`GET /api/tenants/${env.testTenant}/users — take the seeded (active) admin's email`, async () => {
      const users: Array<{ email: string; is_active: boolean }> = (await (await page.request.get(`/api/tenants/${env.testTenant}/users`)).json()).data;
      const admin = users.find((u) => u.is_active);
      expect(admin, `${env.testTenant} has no active user`).toBeDefined();
      return admin!.email;
    });
    await openEdit(page, env.testTenant, 'People');
    await test.step(`Expect ${email} with Role "Ministry admin" and Active ticked`, async () => {
      const key = await keyOf(page, 'email-', email);
      await expect(page.locator(`[id="role-${key}"] option:checked`)).toHaveText('Ministry admin');
      const row = rowOf(page, `email-${key}`, page.getByRole('button', { name: 'Deactivate' }));
      await expect(row.getByRole('checkbox', { name: 'Active' })).toBeChecked();
    });
    await test.step('Expect the note that division users are managed in the ministry portal under Parliament Settings → Users', async () => {
      await expect(page.getByText(/users are managed in the ministry portal under Parliament Settings → Users/)).toBeVisible();
    });
  });

  test('SA-EPPL-02 a new person row: name, email, role (default User), identity roles, Remove, no Active', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openEdit(page, env.testTenant, 'Roles');
    await test.step('Expect the tenant to have at least one role (identity roles are offered only then)', async () => {
      await expect(page.getByRole('main').getByRole('listitem').first()).toBeVisible();
    });
    await test.step('Choose the People tab', () => tab(page, 'People').click());
    const key = await test.step('Press + Add person', () => addPerson(page));
    await test.step('Expect #name-, #email-, #role- (Ministry admin / User, default User), #iroles-, Remove, and no Active checkbox', async () => {
      await expect(page.locator(`[id="name-${key}"]`)).toBeVisible();
      await expect(page.locator(`[id="email-${key}"]`)).toBeVisible();
      await expect(page.locator(`[id="role-${key}"] option`)).toHaveText(['Ministry admin', 'User']);
      await expect(page.locator(`[id="role-${key}"] option:checked`)).toHaveText('User');
      await expect(page.locator(`[id="iroles-${key}"]`)).toBeVisible();
      const row = rowOf(page, `name-${key}`, page.getByRole('button', { name: 'Remove' }));
      await expect(row.getByRole('button', { name: 'Remove' })).toBeVisible();
      await expect(row.getByRole('checkbox', { name: 'Active' })).toHaveCount(0);
      expect(writes).toEqual([]);
    });
  });

  test('SA-EPPL-03 Remove on a new row is local: the row goes and nothing is requested', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const calls: string[] = [];
    await openEdit(page, env.testTenant, 'People');
    const key = await test.step('Press + Add person', () => addPerson(page));
    await test.step('Press Remove on the new row', async () => {
      page.on('request', (r) => {
        if (r.url().includes('/api/') && !r.url().includes('/api/auth/')) calls.push(`${r.method()} ${r.url()}`);
      });
      await page.getByRole('button', { name: 'Remove' }).click();
    });
    await test.step('Expect the row gone and no request', async () => {
      await expect(page.locator(`[id="name-${key}"]`)).toHaveCount(0);
      expect(calls).toEqual([]);
      expect(writes).toEqual([]);
    });
  });

  for (const [id, missing, field, value] of [
    ['SA-EPPL-04', 'email', 'name', 'QA Person'],
    ['SA-EPPL-05', 'name', 'email', 'qa.person@example.gov.in'],
  ] as const) {
    test(`${id} a new person with no ${missing} blocks the save`, async ({ page, env }) => {
      const writes = await blockWrites(page);
      await noPeople(page, env.testTenant);
      await openEdit(page, env.testTenant, 'People');
      await test.step('Expect the empty People list (answered empty by the test, so stored people cannot interfere)', async () => {
        await expect(page.getByText(/^No people yet/)).toBeVisible();
      });
      await test.step(`+ Add person, fill only the ${field} ("${value}"), press Save people`, async () => {
        const key = await addPerson(page);
        await page.locator(`[id="${field}-${key}"]`).fill(value);
        await page.getByRole('button', { name: 'Save people' }).click();
      });
      await test.step('Expect "Every person needs a name and email" and nothing sent', async () => {
        await expect(page.getByText('Every person needs a name and email').first()).toBeVisible(); // inline and in a toast
        expect(writes).toEqual([]);
      });
    });
  }

  test('SA-EPPL-06 Deactivate asks for confirmation; Cancel keeps the person', async ({ page, env }) => {
    const writes = await blockWrites(page);
    let message = '';
    await openEdit(page, env.testTenant, 'People');
    const email = await test.step('Read the first person\'s email', async () => {
      await expect(page.getByRole('button', { name: 'Deactivate' }).first()).toBeVisible();
      return page.locator('[id^="email-"]').first().inputValue();
    });
    await test.step('Press Deactivate on that row, then Cancel the dialog (a browser confirm or an in-page dialog)', async () => {
      page.once('dialog', (d) => {
        message = d.message();
        void d.dismiss();
      });
      await page.getByRole('button', { name: /^Deactivate\b/ }).first().click();
      const modal = page.getByRole('dialog').or(page.getByRole('alertdialog')).filter({ hasText: 'Deactivate' }).filter({ hasNotText: 'Accessibility Options' }).first();
      if (!message && (await modal.waitFor({ timeout: 2_000 }).then(() => true, () => false))) {
        message = (await modal.innerText()).replace(/\s+/g, ' ').trim();
        await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
      }
    });
    await test.step(`Expect the dialog "Deactivate ${email}? They will not be able to sign in." and nothing changed`, async () => {
      await expect.poll(() => message).toContain(`Deactivate ${email}? They will not be able to sign in`); // live adds "until reactivated…"
      await expect(page.locator('[id^="email-"]').first()).toHaveValue(email);
      await expect(page.getByRole('button', { name: 'Deactivate' }).first()).toBeVisible();
      expect(writes).toEqual([]);
    });
  });

  test('SA-EPPL-16 a new person needs an official email: gov.in, nic.in or a subdomain', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await noPeople(page, env.testTenant);
    const fill = async (email: string) => {
      await openEdit(page, env.testTenant, 'People');
      await expect(page.getByText(/^No people yet/)).toBeVisible();
      const key = await addPerson(page);
      await page.locator(`[id="name-${key}"]`).fill('QA Person');
      await page.locator(`[id="email-${key}"]`).fill(email);
      await page.getByRole('button', { name: 'Save people' }).click();
    };
    for (const email of ['qa.person@gmail.com', 'qa.person@evilgov.in', 'qa.person@gov.in.evil.com']) {
      await test.step(`People (answered empty by the test): + Add person <${email}>; Save people — expect "${GOI}" and nothing sent`, async () => {
        await fill(email);
        await expect(page.getByText(GOI).first()).toBeVisible();
        expect(writes).toEqual([]);
      });
    }
    await test.step('+ Add person <qa.person@mha.gov.in> (a gov.in subdomain); Save people — expect it sent (the test aborts the request)', async () => {
      await fill('qa.person@mha.gov.in');
      await expect.poll(() => writes.some((w) => w.method === 'POST' && (w.body ?? '').includes('qa.person@mha.gov.in'))).toBe(true);
    });
  });

  test('SA-EPPL-17 saving People while a stored person has a pre-policy email (Q: behaviour recorded)', async ({ page, env }, testInfo) => {
    const writes = await blockWrites(page);
    const stale = await test.step(`GET /api/tenants/${env.testTenant}/users — find stored addresses outside gov.in / nic.in`, async () => {
      const users: Array<{ email: string }> = (await (await page.request.get(`/api/tenants/${env.testTenant}/users`)).json()).data;
      return users.map((u) => u.email).filter((e) => !OFFICIAL.test(e));
    });
    test.skip(!stale.length, `every stored address on ${env.testTenant} is official — nothing to record`);
    await openEdit(page, env.testTenant, 'People');
    await test.step('+ Add person "QA Person" <qa.person@example.gov.in>; Save people — record what the page says and tries to send (every write aborted)', async () => {
      const key = await addPerson(page);
      await page.locator(`[id="name-${key}"]`).fill('QA Person');
      await page.locator(`[id="email-${key}"]`).fill('qa.person@example.gov.in');
      await page.getByRole('button', { name: 'Save people' }).click();
      await page.waitForTimeout(2_000); // let any message or request appear
      const said = await page.getByText(GOI).count();
      testInfo.annotations.push({
        type: 'question',
        description: `${env.testTenant} stores ${stale.length} address(es) at ${stale.map((e) => e.split('@')[1]).join(', ')}. On Save people the page ${said ? 'showed' : 'did not show'} "${GOI}" and tried ${writes.length} write(s): ${writes.map((w) => `${w.method} ${w.path}`).join(', ') || 'none'}. §6.6 refuses such users at sign-in; it does not say whether unchanged rows are re-validated on save.`,
      });
    });
  });
});

test.describe('A4.3 Divisions tab', () => {
  test('SA-EDIV-01 the live divisions are listed with their fields', async ({ page, env }) => {
    type Division = { name: string; code?: string | null; description?: string | null; is_active?: boolean; isActive?: boolean };
    const divisions = await test.step(`GET /api/tenants/${env.testTenant}/departments`, async () => {
      const res = await page.request.get(`/api/tenants/${env.testTenant}/departments`);
      expect(res.status()).toBe(200);
      const list: Division[] = (await res.json()).data;
      expect(list.length, `${env.testTenant} has at least one division`).toBeGreaterThan(0);
      return list;
    });
    await openEdit(page, env.testTenant, 'Divisions');
    for (const d of divisions) {
      await test.step(`Expect "${d.name}" with #dcode-, #ddesc-, #ddesig-, Active and #dprofile-`, async () => {
        const key = await keyOf(page, 'dname-', d.name);
        await expect.soft(page.locator(`[id="dcode-${key}"]`)).toHaveValue(d.code ?? '');
        await expect.soft(page.locator(`[id="ddesc-${key}"]`)).toHaveValue(d.description ?? '');
        await expect.soft(page.locator(`[id="ddesig-${key}"]`)).toBeVisible();
        await expect.soft(page.locator(`[id="dprofile-${key}"]`)).toBeAttached();
        const active = page.getByRole('checkbox', { name: 'Active' });
        await expect.soft(rowOf(page, `dname-${key}`, active).getByRole('checkbox', { name: 'Active' })).toBeChecked({ checked: d.is_active ?? d.isActive ?? true });
      });
    }
  });

  test('SA-EDIV-02 designations come back empty after load (they do not round-trip)', async ({ page, env }) => {
    test.info().annotations.push({ type: 'precondition', description: `${env.testTenant}'s divisions were created with designations, so positions exist.` });
    await openEdit(page, env.testTenant, 'Divisions');
    await test.step('Expect every Designations field empty', async () => {
      const fields = page.locator('[id^="ddesig-"]');
      await expect(fields.first(), 'A4.3: every row has a Designations field (it comes back empty)').toBeAttached();
      for (const f of await fields.all()) await expect.soft(f).toHaveValue('');
    });
  });

  test('SA-EDIV-03 a division without a name blocks the save', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openEdit(page, env.testTenant, 'Divisions');
    await test.step('Press + Add division, leave it blank, press Save divisions', async () => {
      await page.getByRole('button', { name: /^\+? ?Add division$/ }).click();
      await page.getByRole('button', { name: 'Save divisions' }).click();
    });
    await test.step('Expect "Every division needs a name" and nothing sent', async () => {
      await expect(page.getByText('Every division needs a name')).toBeVisible();
      expect(writes).toEqual([]);
    });
  });
});

test.describe('A4.4 Roles tab', () => {
  const roleButtons = (page: Page) => page.getByRole('main').getByRole('listitem').getByRole('button');
  /** The provisioned "Tenant Admin": "(system)" after its name (A4.4), or a "System role" icon (live build, 22 Oct). */
  const systemRole = (page: Page) =>
    roleButtons(page).filter({ hasText: /^Tenant Admin\b/ }).filter({ has: page.getByRole('img', { name: 'System role' }) })
      .or(page.getByRole('button', { name: 'Tenant Admin (system)' })).first();

  test('SA-EROL-01 the system role is listed as "Tenant Admin (system)"', async ({ page, env }) => {
    await openEdit(page, env.testTenant, 'Roles');
    await test.step('Expect "Tenant Admin" marked as the system role in the role list', async () => {
      await expect(systemRole(page)).toBeVisible();
      const name = (await systemRole(page).innerText()).trim();
      if (!name.endsWith('(system)')) test.info().annotations.push({ type: 'deviation', description: `A4.4: "(system)" after the name; the list shows "${name}" with a "System role" icon` });
    });
  });

  test('SA-EROL-02 the system role is fully locked', async ({ page, env }) => {
    await openEdit(page, env.testTenant, 'Roles');
    await test.step('Open the system role "Tenant Admin"', () => systemRole(page).click());
    await test.step('Expect the name field and every permission checkbox disabled; no save, clone or delete control', async () => {
      await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toBeDisabled();
      const boxes = page.getByRole('main').getByRole('checkbox');
      await expect(boxes.first()).toBeVisible();
      for (const box of await boxes.all()) await expect.soft(box).toBeDisabled();
      await expect(page.getByRole('main').getByRole('button', { name: /save|clone|delete/i })).toHaveCount(0);
    });
  });

  test('SA-EROL-03 Create stays disabled while the new role name is blank', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const name = page.getByRole('textbox', { name: 'New role name' });
    const create = page.getByRole('button', { name: /^Create( role)?$/ });
    await openEdit(page, env.testTenant, 'Roles');
    await test.step('Leave "New role name" blank: expect Create disabled', async () => {
      await expect(name).toHaveValue('');
      await expect(create).toBeDisabled();
    });
    await test.step('Type only spaces: record whether Create enables (not pressed)', async () => {
      await name.fill('   ');
      const state = (await create.isEnabled()) ? 'enabled' : 'disabled';
      test.info().annotations.push({ type: 'question', description: `Spaces-only role name: Create is ${state}` });
      expect(writes).toEqual([]);
    });
  });

  test('SA-EROL-09 a role shows the full permission catalogue (spec §7.1)', async ({ page, env }) => {
    await openEdit(page, env.testTenant, 'Roles');
    const role = await test.step('Pick a custom role (the system role if there is none)', async () => {
      await expect(roleButtons(page).first()).toBeVisible();
      const custom = roleButtons(page).filter({ hasNot: page.getByRole('img', { name: 'System role' }) }).filter({ hasNotText: '(system)' });
      if (await custom.count()) return custom.first();
      test.info().annotations.push({ type: 'precondition', description: `${env.testTenant} has no custom role; the system role's catalogue was checked instead` });
      return systemRole(page);
    });
    await test.step(`Open "${(await role.innerText()).trim()}"`, () => role.click());
    await test.step(`Expect all ${PERMISSIONS.length} permissions of §7.1`, async () => {
      for (const p of PERMISSIONS) await expect.soft(page.getByRole('checkbox', { name: p, exact: true })).toBeVisible();
    });
  });
});
