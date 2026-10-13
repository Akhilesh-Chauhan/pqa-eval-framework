import type { Page } from '@playwright/test';
import { test, expect, blockWrites } from './fixtures.js';
import type { AdminEnv } from './admin-env.js';
import { fillWizardToReview, nextButton } from './wizard.js';
import { notMeasured } from '../support/annotations.js';

// Create-tenant wizard: navigation rules (A3.0) and step 0 (A3.1). Read-only on the shared
// environment: every test records-and-aborts writes before opening /tenants/new (create guard G)
// and ends by asserting nothing was attempted. Each test gets a fresh context, so a fresh draft.

type Writes = Awaited<ReturnType<typeof blockWrites>>;

const STEPS = ['Basic Info', 'Branding', 'Assistant & Logos', 'LLM Config', 'File Rules', 'Departments', 'Sources & modules', 'Review & Submit'];
// Never the real key: nothing is submitted, and the step-3 fields only need to be non-blank.
const DUMMY_LLM = { apiKey: 'dummy-key', baseUrl: 'https://example.org', model: 'm', embeddingModel: 'e' };
const CHARSET_MSG = 'Lowercase letters, numbers and single hyphens only, and not a reserved name.';
const lengthMsg = (n: number) => `Must be exactly 6 characters (this one is ${n}).`;

const heading = (page: Page, name: string) => page.getByRole('heading', { level: 2, name, exact: true });
const backButton = (page: Page) => page.getByRole('button', { name: 'Back', exact: true });
const randomSlug = () => `qa${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;
const adminOf = (env: AdminEnv) => ({ name: 'QA Admin', email: 'qa.admin@example.gov.in' });
const question = (description: string) => test.info().annotations.push({ type: 'question', description });

async function ministries(page: Page): Promise<Array<{ name: string; taken: boolean }>> {
  return (await (await page.request.get('/api/ministries')).json()).data;
}

/** Every tenant in the registry, live and archived. */
async function tenants(page: Page): Promise<Array<{ slug: string; status: string }>> {
  const bundles: Array<{ tenant: { slug: string; status: string } }> = (await (await page.request.get('/api/tenants')).json()).data;
  return bundles.map((b) => b.tenant);
}

async function freeMinistries(page: Page): Promise<string[]> {
  return test.step('Read the untaken ministries (GET /api/ministries, taken:false)', async () =>
    (await ministries(page)).filter((m) => !m.taken).map((m) => m.name),
  );
}

async function openWizard(page: Page): Promise<void> {
  await test.step('Open /tenants/new', async () => {
    // The slug checks run against the wizard's own GET /api/tenants; until it answers, any slug passes.
    const registry = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/tenants' && r.request().method() === 'GET');
    await page.goto('/tenants/new');
    await registry;
    await expect(heading(page, 'Basic Info')).toBeVisible();
  });
}

/** Valid step 0: the first untaken ministry, the given slug, the test admin. Nothing pressed. */
async function fillStep0(page: Page, env: AdminEnv, slug = randomSlug()): Promise<{ ministry: string; slug: string }> {
  const ministry = (await freeMinistries(page))[0]!;
  const admin = adminOf(env);
  await test.step(`Step 0: choose "${ministry}", type slug "${slug}", admin "${admin.name}" <${admin.email}>`, async () => {
    await page.locator('#ministryId').selectOption({ label: ministry });
    await page.locator('#slug').fill(slug);
    await page.locator('#adminName').fill(admin.name);
    await page.locator('#adminEmail').fill(admin.email);
  });
  return { ministry, slug };
}

async function advance(page: Page, to: string): Promise<void> {
  await nextButton(page).click();
  await expect(heading(page, to)).toBeVisible();
}

async function nextRejected(page: Page, message: string, step = 'Basic Info'): Promise<void> {
  await test.step(`Press Next — expect "${message}" and still on "${step}"`, async () => {
    await nextButton(page).click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(heading(page, step)).toBeVisible();
  });
}

async function expectSlugLocked(page: Page, slug: string): Promise<void> {
  await test.step(`Expect #slug "${slug}" disabled and read-only, with the tooltip "Portal slug is assigned"`, async () => {
    const field = page.locator('#slug');
    await expect(field).toHaveValue(slug);
    await expect(field).toBeDisabled();
    await expect(field).toHaveJSProperty('readOnly', true);
    await expect(page.getByTitle('Portal slug is assigned').first()).toBeVisible();
  });
}

async function nothingSent(writes: Writes): Promise<void> {
  await test.step('Expect no write request was attempted (no POST /api/tenants or any other write)', async () => {
    expect(writes).toEqual([]);
  });
}

/** Valid steps 0–6 (dummy LLM values), stopped on step 7. */
async function toReview(page: Page, env: AdminEnv): Promise<void> {
  const admin = adminOf(env);
  const ministry = (await freeMinistries(page))[0]!;
  await fillWizardToReview(page, { ministry, slug: randomSlug(), adminName: admin.name, adminEmail: admin.email, llm: DUMMY_LLM });
}

/** The Review row's Edit button: the nearest ancestor of the row label that holds a button. */
const reviewEdit = (page: Page, row: string) =>
  page.getByText(row, { exact: true }).locator('xpath=ancestor::*[.//button][1]').getByRole('button', { name: 'Edit' });

/** From a step opened with a Review "Edit" link: jump back to step 7 with the step list, press Create tenant. */
async function createFromReview(page: Page): Promise<void> {
  await test.step('Click "8. Review & Submit" in the step list to return to step 7', async () => {
    await page.getByRole('button', { name: '8. Review & Submit' }).click();
    const reached = await heading(page, 'Review & Submit').waitFor({ timeout: 5_000 }).then(() => true, () => false);
    if (!reached) {
      const at = await page.getByRole('heading', { level: 2 }).first().textContent();
      notMeasured(test.info(), {
        tracker: 'catalogue SA-WNAV-05',
        owner: 'QA',
        detail: `the step list did not jump to step 7 (showed "${at}"), so Create cannot be pressed with an earlier step invalid; seeding the sessionStorage draft cannot help: the current step is not part of it, so a reload always opens step 0`,
      });
    }
    test.info().annotations.push({ type: 'note', description: 'Step 7 was reached with the "8. Review & Submit" step-list button.' });
  });
  await test.step('Press Create tenant', () => page.getByRole('button', { name: 'Create tenant' }).click());
}

test.describe('A3.0 Wizard navigation, blocking and draft', () => {
  test('SA-WNAV-01 the step list shows the eight steps in order', async ({ page }) => {
    const writes = await blockWrites(page);
    await openWizard(page);
    const labels = STEPS.map((s, i) => `${i + 1}. ${s}`);
    await test.step(`Expect the step list: ${labels.join(' · ')}`, async () => {
      await expect(page.getByRole('main').getByRole('list').first().getByRole('button')).toHaveText(labels);
    });
    await nothingSent(writes);
  });

  test('SA-WNAV-02 Back is never validated', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizard(page);
    await fillStep0(page, env);
    await test.step('Press Next twice (step 1 defaults) to reach step 2 with every field blank', async () => {
      await advance(page, 'Branding');
      await advance(page, 'Assistant & Logos');
    });
    await test.step('Press Back', () => backButton(page).click());
    await test.step('Expect step 1 "Branding" and no validation message anywhere', async () => {
      await expect(heading(page, 'Branding')).toBeVisible();
      await expect(page.getByText(/^(Required\.|Enter a valid color\.)$/)).toHaveCount(0);
    });
    await nothingSent(writes);
  });

  test('SA-WNAV-03 Next on a blank step 0 stays there with only step-0 errors', async ({ page }) => {
    const writes = await blockWrites(page);
    await openWizard(page);
    await test.step('Press Next with every field blank', () => nextButton(page).click());
    await test.step('Expect still on "Basic Info" with "Select a ministry.", "Required.", "Admin name is required", "Admin email is required"', async () => {
      await expect(heading(page, 'Basic Info')).toBeVisible();
      for (const message of ['Select a ministry.', 'Required.', 'Admin name is required', 'Admin email is required']) {
        await expect(page.getByText(message, { exact: true })).toBeVisible();
      }
    });
    await nothingSent(writes);
  });

  test('SA-WNAV-04 leaving step 0 forwards locks the slug even when a later step blocks', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizard(page);
    const { slug } = await fillStep0(page, env);
    await test.step('Next to step 1, Next to step 2, then Next with step 2 blank — expect it blocked with "Required."', async () => {
      await advance(page, 'Branding');
      await advance(page, 'Assistant & Logos');
      await nextButton(page).click();
      await expect(page.getByText('Required.', { exact: true }).first()).toBeVisible();
      await expect(heading(page, 'Assistant & Logos')).toBeVisible();
    });
    await test.step('Press Back twice to step 0', async () => {
      await backButton(page).click();
      await backButton(page).click();
      await expect(heading(page, 'Basic Info')).toBeVisible();
    });
    await expectSlugLocked(page, slug);
    await nothingSent(writes);
  });

  // The spec's router test and its siblings: break one field on an earlier step, press Create from step 7.
  const ROUTES: Array<{ id: string; title: string; row: string; step: string; change: string; act: (page: Page) => Promise<unknown>; message: string }> = [
    { id: 'SA-WNAV-05', title: 'an assistant error', row: 'Assistant name', step: 'Assistant & Logos', change: 'clear Assistant name (#displayName)', act: (p) => p.locator('#displayName').fill(''), message: 'Required.' },
    { id: 'SA-WNAV-06', title: 'a branding error', row: 'Primary color', step: 'Branding', change: 'set Primary brand color to "red"', act: (p) => p.locator('#primaryColor').fill('red'), message: 'Enter a valid color.' },
    { id: 'SA-WNAV-07', title: 'an LLM error', row: 'LLM', step: 'LLM Config', change: 'clear Chat model (#model)', act: (p) => p.locator('#model').fill(''), message: 'Required.' },
    { id: 'SA-WNAV-08', title: 'a file-type error', row: 'Max upload size', step: 'File Rules', change: 'untick PDF, the only ticked type', act: (p) => p.getByRole('checkbox', { name: 'PDF', exact: true }).uncheck(), message: 'Select at least one file extension.' },
    { id: 'SA-WNAV-09', title: 'a department error', row: 'Departments', step: 'Departments', change: 'press "+ Add division" and leave the row blank', act: (p) => p.getByRole('button', { name: '+ Add division' }).click(), message: 'Required.' },
    {
      id: 'SA-WNAV-10',
      title: 'a source-trust error',
      row: 'Source websites',
      step: 'Sources & modules',
      change: 'add https://www.india.gov.in and leave the trust box unticked',
      act: async (p) => {
        await p.locator('#sourceUrl').fill('https://www.india.gov.in');
        await p.getByRole('button', { name: 'Add', exact: true }).click();
      },
      message: 'Confirm these URLs are trustworthy before saving.',
    },
  ];
  for (const r of ROUTES) {
    test(`${r.id} Create from step 7 routes ${r.title} to "${r.step}" and sends nothing`, async ({ page, env }) => {
      const writes = await blockWrites(page);
      await toReview(page, env);
      await test.step(`Press Edit on the "${r.row}" row — expect "${r.step}"`, async () => {
        await reviewEdit(page, r.row).click();
        await expect(heading(page, r.step)).toBeVisible();
      });
      await test.step(`On "${r.step}": ${r.change}`, () => r.act(page));
      await createFromReview(page);
      await test.step(`Expect "${r.step}" with "${r.message}"`, async () => {
        await expect(heading(page, r.step)).toBeVisible();
        await expect(page.getByText(r.message, { exact: true }).first()).toBeVisible();
      });
      await nothingSent(writes);
    });
  }

  test('SA-WNAV-11 the draft survives a page reload', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizard(page);
    const { ministry, slug } = await fillStep0(page, env);
    const admin = adminOf(env);
    await test.step('Next; step 1: Primary brand color "#123456"; Next', async () => {
      await advance(page, 'Branding');
      await page.locator('#primaryColor').fill('#123456');
      await advance(page, 'Assistant & Logos');
    });
    await test.step('Step 2: Assistant name "QA Assistant", heading "QA heading", subheading "QA subheading", placeholder "QA placeholder"', async () => {
      await page.locator('#displayName').fill('QA Assistant');
      await page.getByPlaceholder('Ready when you are.').fill('QA heading');
      await page.getByPlaceholder(/^Your digital assistant for/).fill('QA subheading');
      await page.getByPlaceholder(/^Ask your queries here/).fill('QA placeholder');
    });
    await test.step('Reload the page; record which step it shows (the spec does not say)', async () => {
      await page.reload();
      await page.waitForLoadState('networkidle');
      question(`After a reload the wizard shows step "${await page.getByRole('heading', { level: 2 }).first().textContent()}".`);
    });
    await test.step(`Press Back until step 0 — expect "${ministry}", slug "${slug}", admin "${admin.name}" <${admin.email}>`, async () => {
      for (let i = 0; i < STEPS.length && (await backButton(page).isEnabled()); i++) await backButton(page).click();
      await expect(page.locator('#ministryId option:checked')).toHaveText(ministry);
      await expect(page.locator('#slug')).toHaveValue(slug);
      await expect(page.locator('#adminName')).toHaveValue(admin.name);
      await expect(page.locator('#adminEmail')).toHaveValue(admin.email);
    });
    await test.step('Next — expect step 1 Primary brand color "#123456"', async () => {
      await advance(page, 'Branding');
      await expect(page.locator('#primaryColor')).toHaveValue('#123456');
    });
    await test.step('Next — expect the four step-2 strings restored', async () => {
      await advance(page, 'Assistant & Logos');
      await expect(page.locator('#displayName')).toHaveValue('QA Assistant');
      await expect(page.getByPlaceholder('Ready when you are.')).toHaveValue('QA heading');
      await expect(page.getByPlaceholder(/^Your digital assistant for/)).toHaveValue('QA subheading');
      await expect(page.getByPlaceholder(/^Ask your queries here/)).toHaveValue('QA placeholder');
    });
    await nothingSent(writes);
  });

  test('SA-WNAV-12 the draft is per tab', async ({ page, env }) => {
    test.info().annotations.push({ type: 'note', description: 'Follows from session storage; the spec does not state it.' });
    const writes = await blockWrites(page);
    await openWizard(page);
    await fillStep0(page, env);
    await test.step('Next; step 1: Primary brand color "#123456"', async () => {
      await advance(page, 'Branding');
      await page.locator('#primaryColor').fill('#123456');
    });
    const tab = await page.context().newPage();
    const tabWrites = await blockWrites(tab);
    await test.step('Open /tenants/new in a new tab of the same browser', () => tab.goto('/tenants/new'));
    await test.step('Expect the new tab on step 0 with "Select a ministry", and slug and admin fields blank', async () => {
      await expect(heading(tab, 'Basic Info')).toBeVisible();
      await expect(tab.locator('#ministryId option:checked')).toHaveText('Select a ministry');
      await expect(tab.locator('#slug')).toHaveValue('');
      await expect(tab.locator('#adminName')).toHaveValue('');
      await expect(tab.locator('#adminEmail')).toHaveValue('');
    });
    await nothingSent([...writes, ...tabWrites]);
  });
});

test.describe('A3.1 Step 0 — Basic Info', () => {
  const isMinistries = (url: URL) => url.pathname === '/api/ministries';

  test('SA-WBAS-01 the ministry list shows "Loading ministries…" until it arrives', async ({ page }) => {
    const writes = await blockWrites(page);
    await test.step('Delay GET /api/ministries by 2 s; open /tenants/new', async () => {
      await page.route(isMinistries, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
        await route.fallback();
      });
      await page.goto('/tenants/new');
    });
    await test.step('Expect "Loading ministries…", then #ministryId offering "Select a ministry"', async () => {
      await expect(page.getByRole('main').first()).toContainText('Loading ministries…');
      await expect(page.locator('#ministryId')).toContainText('Select a ministry', { timeout: 10_000 });
    });
    await nothingSent(writes);
  });

  test('SA-WBAS-02 a failed ministry list disables the dropdown', async ({ page }) => {
    const writes = await blockWrites(page);
    await test.step('Answer GET /api/ministries with 500; open /tenants/new', async () => {
      await page.route(isMinistries, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"qa-injected"}' }));
      await page.goto('/tenants/new');
    });
    await test.step('Expect #ministryId disabled with "Could not load the ministry list."', async () => {
      await expect(page.getByRole('main').first()).toContainText('Could not load the ministry list.');
      await expect(page.locator('#ministryId')).toBeDisabled();
    });
    await nothingSent(writes);
  });

  test('SA-WBAS-03 the dropdown lists the 56 master-list ministries in source order', async ({ page }) => {
    const writes = await blockWrites(page);
    const api = await test.step('GET /api/ministries', async () => (await ministries(page)).map((m) => m.name));
    await openWizard(page);
    await test.step('Expect "Select a ministry" plus 56 options, in the API order (not alphabetical), incl. Department of Atomic Energy, Prime Minister, Department of Space', async () => {
      const options = page.locator('#ministryId option');
      await expect(options).toHaveCount(57);
      const texts = await options.allTextContents();
      expect(texts[0]).toBe('Select a ministry');
      const names = texts.slice(1).map((t) => t.replace(/ \(already provisioned\)$/, ''));
      expect(api).toHaveLength(56);
      expect(names).toEqual(api);
      expect(names).not.toEqual([...names].sort());
      expect(names).toEqual(expect.arrayContaining(['Department of Atomic Energy', 'Prime Minister', 'Department of Space']));
    });
    await nothingSent(writes);
  });

  test('SA-WBAS-04 a ministry is required', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const admin = adminOf(env);
    const slug = randomSlug();
    await openWizard(page);
    await test.step(`Leave "Select a ministry"; type slug "${slug}", admin "${admin.name}" <${admin.email}>`, async () => {
      await page.locator('#slug').fill(slug);
      await page.locator('#adminName').fill(admin.name);
      await page.locator('#adminEmail').fill(admin.email);
    });
    await nextRejected(page, 'Select a ministry.');
    await nothingSent(writes);
  });

  test('SA-WBAS-05 a provisioned ministry is disabled and choosing it is a no-op', async ({ page }) => {
    const writes = await blockWrites(page);
    const rows = await test.step('Find a taken and an untaken ministry (GET /api/ministries)', () => ministries(page));
    const taken = rows.find((m) => m.taken)?.name;
    if (!taken) notMeasured(test.info(), { tracker: 'environment', owner: 'QA', detail: 'no ministry has a live portal right now' });
    const free = rows.find((m) => !m.taken)!.name;
    const label = `${taken} (already provisioned)`;
    await openWizard(page);
    const slugBefore = await test.step(`Choose "${free}"; note the suggested slug`, async () => {
      await page.locator('#ministryId').selectOption({ label: free });
      await expect(page.locator('#slug')).not.toHaveValue('');
      return page.locator('#slug').inputValue();
    });
    const option = page.locator('#ministryId option', { hasText: label });
    await test.step(`Expect the option "${label}", disabled`, async () => {
      await expect(option).toHaveText(label);
      await expect(option).toBeDisabled();
    });
    await test.step(`Try to choose "${label}": click it, then selectOption with force`, async () => {
      // Either attempt may be refused outright; what matters is the state afterwards.
      await option.click({ force: true, timeout: 2_000 }).catch(() => {});
      await page.locator('#ministryId').selectOption({ label }, { force: true, timeout: 2_000 }).catch(() => {});
    });
    await test.step(`Expect the ministry still "${free}" and the slug still "${slugBefore}"`, async () => {
      await expect(page.locator('#ministryId option:checked')).toHaveText(free);
      await expect(page.locator('#slug')).toHaveValue(slugBefore);
    });
    await nothingSent(writes);
  });

  test('SA-WBAS-06 the slug is derived from the ministry and re-derives on change', async ({ page }) => {
    const writes = await blockWrites(page);
    const [first, second] = await freeMinistries(page);
    await openWizard(page);
    const derived = await test.step(`Choose "${first}" — expect #slug filled with 6 characters`, async () => {
      await page.locator('#ministryId').selectOption({ label: first! });
      await expect(page.locator('#slug')).toHaveValue(/^[a-z0-9-]{6}$/);
      return page.locator('#slug').inputValue();
    });
    await test.step(`Choose "${second}" — expect #slug to change from "${derived}" to another 6-character suggestion`, async () => {
      await page.locator('#ministryId').selectOption({ label: second! });
      await expect(page.locator('#slug')).not.toHaveValue(derived);
      await expect(page.locator('#slug')).toHaveValue(/^[a-z0-9-]{6}$/);
    });
    await nothingSent(writes);
  });

  test('SA-WBAS-07 the slug derivation matches the worked examples', async ({ page }) => {
    const writes = await blockWrites(page);
    const [rows, registry] = await test.step('Read GET /api/ministries and the slug registry GET /api/tenants', async () =>
      [await ministries(page), new Set((await tenants(page)).map((t) => t.slug))] as const,
    );
    await openWizard(page);
    for (const [name, expected] of [
      ['Ministry of Railways', 'railwa'],
      ['Ministry of Coal', 'coalco'],
      ['Ministry of Commerce and Industry', 'comind'],
      ['Ministry of Health and Family Welfare', 'hefawe'],
      ['Department of Atomic Energy', 'atoene'],
      ['Prime Minister', 'primin'],
    ] as const) {
      const collides = registry.has(expected);
      await test.step(`Choose "${name}" — expect slug "${expected}"${collides ? ' with its last character a digit (suggestion already taken)' : ''}`, async () => {
        if (rows.find((m) => m.name === name)?.taken !== false) {
          test.info().annotations.push({ type: 'note', description: `${name} not measured: provisioned or missing from the master list.` });
          return;
        }
        await page.locator('#ministryId').selectOption({ label: name });
        await expect.soft(page.locator('#slug')).toHaveValue(collides ? new RegExp(`^${expected.slice(0, 5)}\\d$`) : expected);
      });
    }
    await nothingSent(writes);
  });

  test('SA-WBAS-08 a colliding suggestion gets a numeric tail', async ({ page }) => {
    const writes = await blockWrites(page);
    const free = await freeMinistries(page);
    const registry = await test.step('Read the slug registry, live and archived (GET /api/tenants)', async () => new Set((await tenants(page)).map((t) => t.slug)));
    await openWizard(page);
    const seen = await test.step(`Choose each of the ${free.length} untaken ministries in turn and read #slug`, async () => {
      const out: Array<[string, string]> = [];
      for (const name of free) {
        await page.locator('#ministryId').selectOption({ label: name });
        out.push([name, await page.locator('#slug').inputValue()]);
      }
      return out;
    });
    await test.step('Expect no suggestion to equal an existing slug', async () => {
      expect(seen.filter(([, slug]) => registry.has(slug))).toEqual([]);
    });
    await nothingSent(writes);
    const tails = seen.filter(([, slug]) => /\d$/.test(slug));
    if (!tails.length) notMeasured(test.info(), { tracker: 'environment', owner: 'QA', detail: "no untaken ministry's suggestion collides with an existing slug" });
    test.info().annotations.push({ type: 'note', description: `Collisions seen: ${tails.map(([n, s]) => `${n} → ${s}`).join('; ')}` });
  });

  test('SA-WBAS-09 a manually typed slug survives a ministry change', async ({ page }) => {
    const writes = await blockWrites(page);
    const [first, second] = await freeMinistries(page);
    await openWizard(page);
    await test.step(`Choose "${first}", then type "qaslug" in #slug`, async () => {
      await page.locator('#ministryId').selectOption({ label: first! });
      await page.locator('#slug').fill('qaslug');
    });
    await test.step(`Choose "${second}" — expect #slug still "qaslug"`, async () => {
      await page.locator('#ministryId').selectOption({ label: second! });
      await expect(page.locator('#slug')).toHaveValue('qaslug');
    });
    await nothingSent(writes);
  });

  test('SA-WBAS-10 a 5-character slug is rejected', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizard(page);
    await fillStep0(page, env, 'qa123');
    await nextRejected(page, lengthMsg(5));
    await nothingSent(writes);
  });

  test('SA-WBAS-11 a 7-character slug is typed in full and rejected', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizard(page);
    await fillStep0(page, env, 'qa12345');
    await test.step('Expect #slug to hold all 7 characters "qa12345" (no input length cap)', async () => {
      await expect(page.locator('#slug')).toHaveValue('qa12345');
    });
    await nextRejected(page, lengthMsg(7));
    await nothingSent(writes);
  });

  test('SA-WBAS-12 a valid 6-character slug advances to step 1', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizard(page);
    await fillStep0(page, env);
    await test.step('Press Next — expect step 1 "Branding"', () => advance(page, 'Branding'));
    await nothingSent(writes);
  });

  test('SA-WBAS-13 a blank slug is rejected', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizard(page);
    await fillStep0(page, env);
    await test.step('Clear #slug', () => page.locator('#slug').fill(''));
    await nextRejected(page, 'Required.');
    await nothingSent(writes);
  });

  test('SA-WBAS-14 slugs outside the character set are rejected', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const slug = page.locator('#slug');
    await openWizard(page);
    await fillStep0(page, env);
    for (const value of ['ab_cde', 'ab cde', 'a--bcd', '-abcde', 'abcde-', 'ab.cde']) {
      await test.step(`Type slug "${value}"`, () => slug.fill(value));
      await nextRejected(page, CHARSET_MSG);
    }
    // Last: if the field lower-cases it, "abcdef" is valid and Next would leave step 0.
    const shown = await test.step('Type slug "ABCDEF"; record whether the field lower-cases it', async () => {
      await slug.fill('ABCDEF');
      const value = await slug.inputValue();
      question(`Typing "ABCDEF" leaves "${value}" in #slug.`);
      return value;
    });
    if (shown === 'ABCDEF') await nextRejected(page, CHARSET_MSG);
    await nothingSent(writes);
  });

  test('SA-WBAS-15 a single hyphen is allowed', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizard(page);
    await fillStep0(page, env, 'qa-t01');
    await test.step('Press Next — expect step 1 "Branding"', () => advance(page, 'Branding'));
    await nothingSent(writes);
  });

  test('SA-WBAS-16 the reserved 6-character slug "images" is rejected', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizard(page);
    await fillStep0(page, env, 'images');
    await nextRejected(page, CHARSET_MSG);
    await nothingSent(writes);
  });

  test('SA-WBAS-17 short reserved slugs are refused (which message is a question)', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const slug = page.locator('#slug');
    await openWizard(page);
    await fillStep0(page, env);
    for (const value of ['admin', 'api', 'www', 'app', '_next', 'logos', 'icons']) {
      await test.step(`Type slug "${value}", press Next — expect it refused on step 0; record whether the reserved-name or the length message shows`, async () => {
        await slug.fill(value);
        await nextButton(page).click();
        const reserved = page.getByText(CHARSET_MSG, { exact: true });
        await expect(reserved.or(page.getByText(lengthMsg(value.length), { exact: true })).first()).toBeVisible();
        await expect(heading(page, 'Basic Info')).toBeVisible();
        question(`"${value}": the ${(await reserved.isVisible()) ? 'reserved-name' : 'length'} message is shown (spec test 7 expects reserved-name).`);
      });
    }
    await nothingSent(writes);
  });

  test('SA-WBAS-18 the slug of a live tenant is rejected', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizard(page);
    await fillStep0(page, env);
    for (const live of [env.testTenant, 'cooper']) {
      await test.step(`Type slug "${live}"`, () => page.locator('#slug').fill(live));
      await nextRejected(page, 'Already in use by another tenant.');
    }
    await nothingSent(writes);
  });

  test('SA-WBAS-19 the slug of an archived portal is rejected', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const archived = await test.step('Find an archived slug (GET /api/tenants)', async () => (await tenants(page)).find((t) => t.status === 'archived')?.slug);
    if (!archived) notMeasured(test.info(), { tracker: 'environment', owner: 'QA', detail: 'no archived tenant exists' });
    await openWizard(page);
    await fillStep0(page, env, archived);
    await nextRejected(page, 'This slug belongs to an archived portal and cannot be reused.');
    await nothingSent(writes);
  });

  test('SA-WBAS-20 the slug hint and the portal-path preview', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const [ministry] = await freeMinistries(page);
    const path = page.locator('p', { hasText: 'Portal path' }).locator('code');
    await openWizard(page);
    await test.step('Expect the hint "Exactly 6 characters; lowercase letters, numbers and hyphens." and the portal path ending in "…"', async () => {
      await expect(page.getByText('Exactly 6 characters; lowercase letters, numbers and hyphens.', { exact: true })).toBeVisible();
      await expect(path).toHaveText(/…$/);
    });
    await test.step(`Choose "${ministry}" — expect the portal path to end in "/<slug>"; record its origin`, async () => {
      await page.locator('#ministryId').selectOption({ label: ministry! });
      await expect(page.locator('#slug')).not.toHaveValue('');
      const slug = await page.locator('#slug').inputValue();
      await expect(path).toHaveText(new RegExp(`/${slug}$`));
      const origin = new URL((await path.textContent())!).origin;
      question(`Portal-path preview origin is ${origin}; PQA_BASE_URL is ${env.portalUrl}.`);
    });
    await nothingSent(writes);
  });

  test('SA-WBAS-21 the slug locks once step 0 passes', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizard(page);
    const { slug } = await fillStep0(page, env);
    await test.step('Press Next, then Back', async () => {
      await advance(page, 'Branding');
      await backButton(page).click();
      await expect(heading(page, 'Basic Info')).toBeVisible();
    });
    await expectSlugLocked(page, slug);
    await nothingSent(writes);
  });

  test('SA-WBAS-22 a locked slug survives a ministry change and a reload', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizard(page);
    const { ministry, slug } = await fillStep0(page, env);
    await test.step('Press Next, then Back', async () => {
      await advance(page, 'Branding');
      await backButton(page).click();
    });
    const other = (await freeMinistries(page)).find((m) => m !== ministry)!;
    await test.step(`Choose another ministry, "${other}"`, () => page.locator('#ministryId').selectOption({ label: other }));
    await expectSlugLocked(page, slug);
    await test.step('Reload the page', async () => {
      await page.reload();
      await expect(heading(page, 'Basic Info')).toBeVisible();
    });
    await expectSlugLocked(page, slug);
    await nothingSent(writes);
  });

  test('SA-WBAS-23 the admin name is required', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizard(page);
    await fillStep0(page, env);
    await test.step('Clear #adminName', () => page.locator('#adminName').fill(''));
    await nextRejected(page, 'Admin name is required');
    await nothingSent(writes);
  });

  test('SA-WBAS-24 an admin name of only spaces is rejected', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizard(page);
    await fillStep0(page, env);
    await test.step('Set #adminName to 3 spaces', () => page.locator('#adminName').fill('   '));
    await nextRejected(page, 'Admin name is required');
    await nothingSent(writes);
  });

  test('SA-WBAS-25 the admin email is required', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizard(page);
    await fillStep0(page, env);
    await test.step('Clear #adminEmail', () => page.locator('#adminEmail').fill(''));
    await nextRejected(page, 'Admin email is required');
    await nothingSent(writes);
  });

  test('SA-WBAS-26 an admin email that is not an email is not accepted', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizard(page);
    await fillStep0(page, env);
    await test.step('Set #adminEmail to "not-an-email"; press Next', async () => {
      await page.locator('#adminEmail').fill('not-an-email');
      await nextButton(page).click();
    });
    await test.step('Expect still on step 0; record how it was refused', async () => {
      await expect(heading(page, 'Basic Info')).toBeVisible();
      await expect(page.locator('#adminEmail')).toBeVisible();
      const browser = await page.locator('#adminEmail').evaluate((el: HTMLInputElement) => el.validationMessage);
      test.info().annotations.push({ type: 'note', description: `Browser validation message: "${browser}".` });
    });
    await nothingSent(writes);
  });

  test('SA-WBAS-27 blank admin fields and Create from step 7 return to step 0 and send nothing', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await toReview(page, env);
    await test.step('Press Edit on the "Ministry name" row — expect step 0', async () => {
      await reviewEdit(page, 'Ministry name').click();
      await expect(heading(page, 'Basic Info')).toBeVisible();
    });
    await test.step('Clear #adminName and #adminEmail', async () => {
      await page.locator('#adminName').fill('');
      await page.locator('#adminEmail').fill('');
    });
    await createFromReview(page);
    await test.step('Expect step 0 with "Admin name is required" and "Admin email is required"', async () => {
      await expect(heading(page, 'Basic Info')).toBeVisible();
      await expect(page.getByText('Admin name is required', { exact: true })).toBeVisible();
      await expect(page.getByText('Admin email is required', { exact: true })).toBeVisible();
    });
    await nothingSent(writes);
  });

  test('SA-WBAS-29 step 0 has no administrator phone field (known gap)', async ({ page }) => {
    test.info().annotations.push({ type: 'note', description: 'A3.1 known gap: a phone number is carried in wizard state and sent on provisioning, but there is no input for it.' });
    const writes = await blockWrites(page);
    await openWizard(page);
    await test.step('Expect no phone or mobile input on step 0', async () => {
      await expect(page.locator('input[type="tel"]')).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: /phone|mobile/i })).toHaveCount(0);
    });
    await nothingSent(writes);
  });
});
