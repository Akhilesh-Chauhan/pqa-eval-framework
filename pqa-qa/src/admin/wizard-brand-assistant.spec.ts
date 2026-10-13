import type { Page } from '@playwright/test';
import { test, expect, blockWrites } from './fixtures.js';
import type { AdminEnv } from './admin-env.js';
import { nextButton } from './wizard.js';

// Create-tenant wizard steps 1 (Branding, A3.2) and 2 (Assistant & Logos, A3.3). Read-only on the
// shared environment: every test records-and-aborts writes before opening /tenants/new (create
// guard G) and ends by asserting nothing was attempted. Fresh context per test, so a fresh draft.

type Writes = Awaited<ReturnType<typeof blockWrites>>;
type Step = 'Branding' | 'Assistant & Logos';

const COLOR_MSG = 'Enter a valid color.';
const YEARS_MSG = 'Enter a whole number between 0 and 50.';
const PRESETS = ['Indigo & Sky', 'Teal & Amber', 'Maroon & Gold', 'Forest & Lime', 'Slate & Cyan'];
const TOKENS = [
  'brand', 'brand-hover', 'brand-active', 'brand-primary', 'brand-ring', 'brand-accent', 'brand-accent-hover',
  'brand-accent-muted', 'brand-accent-border', 'brand-accent-tint', 'brand-accent-wash', 'brand-soft', 'brand-tint',
  'brand-wash', 'brand-border', 'brand-border-strong', 'brand-shadow', 'gradient-pink', 'gradient-red',
  'gradient-light', 'gradient-light-pink',
];
const LOGOS = ['ministryCrest', 'appIcon', 'appWordmark', 'botIcon', 'botIconWhite', 'botLogo', 'botLogoWhite'];

const heading = (page: Page, name: string) => page.getByRole('heading', { level: 2, name, exact: true });
const backButton = (page: Page) => page.getByRole('button', { name: 'Back', exact: true });
const showAdvanced = (page: Page) => page.getByRole('button', { name: 'Show advanced: pin exact tokens' });
const years = (page: Page) => page.getByRole('spinbutton');
const randomSlug = () => `qa${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;
const question = (description: string) => test.info().annotations.push({ type: 'question', description });

const assistantFields = (page: Page) => [
  { label: 'Assistant name', field: page.locator('#displayName'), value: 'QA Assistant' },
  { label: 'Welcome heading', field: page.getByPlaceholder('Ready when you are.'), value: 'QA heading' },
  { label: 'Welcome subheading', field: page.getByPlaceholder(/^Your digital assistant for/), value: 'QA subheading' },
  { label: 'Chat input placeholder', field: page.getByPlaceholder(/^Ask your queries here/), value: 'QA placeholder' },
];

async function advance(page: Page, to: string): Promise<void> {
  await nextButton(page).click();
  await expect(heading(page, to)).toBeVisible();
}

/** Opens a fresh wizard and walks a valid step 0 (and step-1 defaults) to the given step. */
async function openAt(page: Page, env: AdminEnv, step: Step): Promise<void> {
  const ministry = await test.step('Pick the first untaken ministry (GET /api/ministries)', async () => {
    const rows: Array<{ name: string; taken: boolean }> = (await (await page.request.get('/api/ministries')).json()).data;
    return rows.find((m) => !m.taken)!.name;
  });
  const admin = { name: 'QA Admin', email: 'qa.admin@example.gov.in' };
  const slug = randomSlug();
  const tail = step === 'Branding' ? '' : '; step 1: keep the defaults; Next';
  await test.step(`Open /tenants/new; step 0: "${ministry}", slug "${slug}", admin "${admin.name}" <${admin.email}>; Next${tail}`, async () => {
    await page.goto('/tenants/new');
    await page.locator('#ministryId').selectOption({ label: ministry });
    await page.locator('#slug').fill(slug);
    await page.locator('#adminName').fill(admin.name);
    await page.locator('#adminEmail').fill(admin.email);
    await advance(page, 'Branding');
    if (step !== 'Branding') await advance(page, step);
  });
}

async function fillAssistant(page: Page): Promise<void> {
  const fields = assistantFields(page);
  await test.step(`Step 2: ${fields.map((f) => `${f.label} "${f.value}"`).join(', ')}`, async () => {
    for (const f of fields) await f.field.fill(f.value);
  });
}

async function nextRejected(page: Page, message: string, step: Step): Promise<void> {
  await test.step(`Press Next — expect "${message}" and still on "${step}"`, async () => {
    await nextButton(page).click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await expect(heading(page, step)).toBeVisible();
  });
}

async function nothingSent(writes: Writes): Promise<void> {
  await test.step('Expect no write request was attempted (no POST /api/tenants or any other write)', async () => {
    expect(writes).toEqual([]);
  });
}

test.describe('A3.2 Step 1 — Branding', () => {
  test('SA-WBRD-01 branding defaults', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openAt(page, env, 'Branding');
    await test.step('Expect no preset chosen, Chat bubble "#e0e7ffcc", Primary "#4338ca", Accent "#0ea5e9"', async () => {
      await expect(page.locator('#brandingPreset')).toHaveValue('');
      await expect(page.locator('#brandingPreset option:checked')).toHaveText('Choose a preset…');
      await expect(page.locator('#userMsgColor')).toHaveValue('#e0e7ffcc');
      await expect(page.locator('#primaryColor')).toHaveValue('#4338ca');
      await expect(page.locator('#accentColor')).toHaveValue('#0ea5e9');
    });
    await nothingSent(writes);
  });

  test('SA-WBRD-02 five palette presets are offered', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openAt(page, env, 'Branding');
    await test.step(`Expect #brandingPreset to offer: ${PRESETS.join(', ')}`, async () => {
      await expect(page.locator('#brandingPreset option')).toHaveText(['Choose a preset…', ...PRESETS]);
    });
    await nothingSent(writes);
  });

  test('SA-WBRD-03 each preset sets all three colours and all 21 tokens', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openAt(page, env, 'Branding');
    await test.step('Press "Show advanced: pin exact tokens"', () => showAdvanced(page).click());
    const triples: string[] = [];
    for (const preset of PRESETS) {
      await test.step(`Choose preset "${preset}" — expect every #override-<token> filled and the three colours set`, async () => {
        await page.locator('#brandingPreset').selectOption({ label: preset });
        for (const token of TOKENS) await expect(page.locator(`#override-${token}`)).not.toHaveValue('');
        const colours = await Promise.all(['#userMsgColor', '#primaryColor', '#accentColor'].map((id) => page.locator(id).inputValue()));
        expect(colours).not.toContain('');
        triples.push(colours.join(' '));
      });
    }
    await test.step('Expect the five presets to give five different colour sets', async () => {
      expect(new Set(triples).size).toBe(PRESETS.length);
    });
    await nothingSent(writes);
  });

  test('SA-WBRD-04 the chat bubble colour is required', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openAt(page, env, 'Branding');
    await test.step('Clear #userMsgColor; press Next', async () => {
      await page.locator('#userMsgColor').fill('');
      await nextButton(page).click();
    });
    await test.step(`Expect still on "Branding" with "${COLOR_MSG}" (record it if "Required." shows instead)`, async () => {
      const colour = page.getByText(COLOR_MSG, { exact: true });
      await expect(colour.or(page.getByText('Required.', { exact: true })).first()).toBeVisible();
      await expect(heading(page, 'Branding')).toBeVisible();
      question(`A blank chat bubble colour shows "${(await colour.isVisible()) ? COLOR_MSG : 'Required.'}".`);
    });
    await nothingSent(writes);
  });

  test('SA-WBRD-05 primary and accent colours are optional', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openAt(page, env, 'Branding');
    await test.step('Clear #primaryColor and #accentColor; press Next — expect step 2', async () => {
      await page.locator('#primaryColor').fill('');
      await page.locator('#accentColor').fill('');
      await advance(page, 'Assistant & Logos');
    });
    await nothingSent(writes);
  });

  for (const [id, what, value] of [
    ['SA-WBRD-06', 'a named colour', 'red'],
    ['SA-WBRD-07', 'a var() reference', 'var(--x)'],
  ] as const) {
    test(`${id} ${what} is rejected`, async ({ page, env }) => {
      const writes = await blockWrites(page);
      await openAt(page, env, 'Branding');
      await test.step(`Set #primaryColor to "${value}"`, () => page.locator('#primaryColor').fill(value));
      await nextRejected(page, COLOR_MSG, 'Branding');
      await nothingSent(writes);
    });
  }

  test('SA-WBRD-08 accepted colour formats', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openAt(page, env, 'Branding');
    const primary = ['#abc', '#abcd', '#a1b2c3', '#1a2b3c80', 'rgb(1,2,3)', 'rgba(1,2,3,0.5)', 'hsl(200 50% 50%)', 'hsla(200,50%,50%,0.5)', 'oklch(0.6 0.1 200)', 'oklab(0.6 0.1 0.1)', 'lab(50% 40 59)', 'lch(50% 40 60)'];
    for (const [id, value] of [...primary.map((v) => ['#primaryColor', v] as const), ['#userMsgColor', '#1a2b3c80'] as const]) {
      await test.step(`Set ${id} to "${value}", press Next — expect step 2; press Back`, async () => {
        await page.locator(id).fill(value);
        await advance(page, 'Assistant & Logos');
        await backButton(page).click();
        await expect(heading(page, 'Branding')).toBeVisible();
      });
    }
    await nothingSent(writes);
  });

  test('SA-WBRD-09 rejected colour formats', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openAt(page, env, 'Branding');
    for (const value of ['#ab', '#abcdef123', '#ggg', 'rgb(1,2,3);', 'url(x)', '#fff }']) {
      await test.step(`Set #primaryColor to "${value}"`, () => page.locator('#primaryColor').fill(value));
      await nextRejected(page, COLOR_MSG, 'Branding');
    }
    await nothingSent(writes);
  });

  test('SA-WBRD-10 upper-case hex (question: accepted or not)', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openAt(page, env, 'Branding');
    await test.step('Set #primaryColor to "#4338CA"; press Next; record whether it is accepted', async () => {
      await page.locator('#primaryColor').fill('#4338CA');
      await nextButton(page).click();
      const advanced = heading(page, 'Assistant & Logos');
      await expect(advanced.or(page.getByText(COLOR_MSG, { exact: true })).first()).toBeVisible();
      question(`Upper-case hex "#4338CA" is ${(await advanced.isVisible()) ? 'accepted' : `rejected with "${COLOR_MSG}"`} (the §4.2 pattern is written lower-case).`);
    });
    await nothingSent(writes);
  });

  test('SA-WBRD-11 a swatch is shown for "#" colours only', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openAt(page, env, 'Branding');
    // Background colours of the elements beside #primaryColor — the swatch is one of them.
    const beside = () =>
      page.locator('#primaryColor').evaluate((input) =>
        Array.from(input.parentElement?.children ?? []).filter((el) => el !== input).map((el) => getComputedStyle(el).backgroundColor),
      );
    await test.step('Set #primaryColor to "#4338ca" — expect a swatch of that colour beside it', async () => {
      await page.locator('#primaryColor').fill('#4338ca');
      await expect.poll(beside).toContain('rgb(67, 56, 202)');
    });
    await test.step('Set #primaryColor to "rgb(1,2,3)" — expect no swatch of that colour', async () => {
      await page.locator('#primaryColor').fill('rgb(1,2,3)');
      await expect.poll(beside).not.toContain('rgb(1, 2, 3)');
    });
    await nothingSent(writes);
  });

  test('SA-WBRD-12 the advanced token panel is collapsed by default and lists 21 tokens', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openAt(page, env, 'Branding');
    const fields = page.locator('[id^="override-"]');
    await test.step('Expect "Show advanced: pin exact tokens" and no token field visible', async () => {
      await expect(showAdvanced(page)).toBeVisible();
      await expect(page.locator('#override-brand')).toBeHidden();
    });
    await test.step(`Press "Show advanced: pin exact tokens" — expect 21 fields: ${TOKENS.join(', ')}`, async () => {
      await showAdvanced(page).click();
      await expect(fields).toHaveCount(TOKENS.length);
      expect(await fields.evaluateAll((els) => els.map((el) => el.id))).toEqual(TOKENS.map((t) => `override-${t}`));
      for (const token of TOKENS) await expect(page.locator(`#override-${token}`)).toBeVisible();
    });
    await test.step('Press "Hide advanced: pin exact tokens" — expect the fields hidden again', async () => {
      await page.getByRole('button', { name: 'Hide advanced: pin exact tokens' }).click();
      await expect(page.locator('#override-brand')).toBeHidden();
    });
    await nothingSent(writes);
  });

  test('SA-WBRD-13 an invalid advanced token value is rejected', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openAt(page, env, 'Branding');
    await test.step('Press "Show advanced: pin exact tokens"; set #override-brand to "red"', async () => {
      await showAdvanced(page).click();
      await page.locator('#override-brand').fill('red');
    });
    await nextRejected(page, COLOR_MSG, 'Branding');
    await nothingSent(writes);
  });

  test('SA-WBRD-14 clearing a token removes the override from the draft', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openAt(page, env, 'Branding');
    const draftKey = await test.step('Show advanced; set #override-brand to "#123456"; find the sessionStorage entry that holds it', async () => {
      await showAdvanced(page).click();
      await page.locator('#override-brand').fill('#123456');
      const find = () => page.evaluate(() => Object.keys(sessionStorage).find((k) => sessionStorage.getItem(k)?.includes('#123456')) ?? '');
      await expect.poll(find).not.toBe('');
      return find();
    });
    await test.step(`Clear #override-brand — expect the draft (${draftKey}) to have no "brand" key at all, not "brand":""`, async () => {
      await page.locator('#override-brand').fill('');
      await expect.poll(() => page.evaluate((k) => sessionStorage.getItem(k) ?? '', draftKey)).not.toMatch(/"brand":/);
    });
    await nothingSent(writes);
  });
});

test.describe('A3.3 Step 2 — Assistant & Logos', () => {
  for (const [id, title, label, value] of [
    ['SA-WAST-01', 'the assistant name is required', 'Assistant name', ''],
    ['SA-WAST-02', 'an assistant name of only spaces is rejected', 'Assistant name', '   '],
    ['SA-WAST-03', 'the welcome heading is required', 'Welcome heading', ''],
    ['SA-WAST-04', 'the welcome subheading is required', 'Welcome subheading', ''],
    ['SA-WAST-05', 'the chat input placeholder is required', 'Chat input placeholder', ''],
  ] as const) {
    test(`${id} ${title}`, async ({ page, env }) => {
      const writes = await blockWrites(page);
      await openAt(page, env, 'Assistant & Logos');
      await fillAssistant(page);
      await test.step(`Set ${label} to ${value ? `${value.length} spaces` : 'blank'}`, async () => {
        await assistantFields(page).find((f) => f.label === label)!.field.fill(value);
      });
      await nextRejected(page, 'Required.', 'Assistant & Logos');
      await nothingSent(writes);
    });
  }

  test('SA-WAST-06 years to look back defaults to 5', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openAt(page, env, 'Assistant & Logos');
    await test.step('Expect "Years to look back" to read 5', async () => {
      await expect(years(page)).toHaveValue('5');
    });
    await nothingSent(writes);
  });

  test('SA-WAST-07 look-back boundaries 0 and 50 are accepted', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openAt(page, env, 'Assistant & Logos');
    await fillAssistant(page);
    await test.step('Set "Years to look back" to 0; press Next — expect step 3; press Back', async () => {
      await years(page).fill('0');
      await advance(page, 'LLM Config');
      await backButton(page).click();
      await expect(heading(page, 'Assistant & Logos')).toBeVisible();
    });
    await test.step('Set "Years to look back" to 50; press Next — expect step 3', async () => {
      await years(page).fill('50');
      await advance(page, 'LLM Config');
    });
    await nothingSent(writes);
  });

  test('SA-WAST-08 look-back values out of range are rejected', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openAt(page, env, 'Assistant & Logos');
    await fillAssistant(page);
    for (const value of ['51', '-1', '2.5', '']) {
      await test.step(`Set "Years to look back" to ${value ? `"${value}"` : 'blank'}`, () => years(page).fill(value));
      await nextRejected(page, YEARS_MSG, 'Assistant & Logos');
    }
    // A number input refuses fill('abc'); type it as a user would and record what the field keeps.
    await test.step('Clear "Years to look back" and type "abc"; record what the field keeps', async () => {
      await years(page).fill('');
      await years(page).pressSequentially('abc');
      test.info().annotations.push({ type: 'note', description: `Typing "abc" leaves "${await years(page).inputValue()}" in the field.` });
    });
    await nextRejected(page, YEARS_MSG, 'Assistant & Logos');
    await nothingSent(writes);
  });

  test('SA-WAST-09 the seven logo fields are optional', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openAt(page, env, 'Assistant & Logos');
    await test.step(`Expect seven blank logo fields: ${LOGOS.map((k) => `#logo-${k}`).join(', ')}`, async () => {
      for (const key of LOGOS) await expect(page.locator(`#logo-${key}`)).toHaveValue('');
    });
    await fillAssistant(page);
    await test.step('Leave every logo blank; press Next — expect step 3', () => advance(page, 'LLM Config'));
    await nothingSent(writes);
  });

  test('SA-WAST-10 logo fields are text paths, trimmed as you type', async ({ page, env }) => {
    test.info().annotations.push({ type: 'note', description: 'On 12 Oct the tester clicked the crest field 5× expecting an upload — UX observation, not a defect.' });
    const writes = await blockWrites(page);
    await openAt(page, env, 'Assistant & Logos');
    await test.step('Type "  /logos/x.png  " into Ministry crest — expect "/logos/x.png"', async () => {
      await page.locator('#logo-ministryCrest').pressSequentially('  /logos/x.png  ');
      await expect(page.locator('#logo-ministryCrest')).toHaveValue('/logos/x.png');
    });
    await test.step('Expect no file picker on the step', async () => {
      await expect(page.locator('input[type="file"]')).toHaveCount(0);
    });
    await nothingSent(writes);
  });

  test('SA-WAST-11 a wrong logo path shows a broken preview and does not block', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openAt(page, env, 'Assistant & Logos');
    await fillAssistant(page);
    await test.step('Set Ministry crest to "/nope/x.png" — expect its preview image broken', async () => {
      await page.locator('#logo-ministryCrest').fill('/nope/x.png');
      const preview = page.locator('img[src*="/nope/x.png"]').first();
      await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth === 0)).toBe(true);
    });
    await test.step('Press Next — expect step 3', () => advance(page, 'LLM Config'));
    await nothingSent(writes);
  });

  test('SA-WAST-12 the logo preview resolves against the portal origin', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const used = await test.step('Find a logo path an existing tenant uses (GET /api/tenants)', async () =>
      (await (await page.request.get('/api/tenants')).text()).match(/"(\/logos\/[^"]+)"/)?.[1],
    );
    if (!used) test.info().annotations.push({ type: 'note', description: 'No tenant has a /logos/ path; only the preview URL is checked, not that it loads.' });
    const path = used ?? '/logos/tenants/example-crest.svg';
    await openAt(page, env, 'Assistant & Logos');
    await test.step(`Set Ministry crest to "${path}" — expect its preview to load from ${env.portalUrl}`, async () => {
      await page.locator('#logo-ministryCrest').fill(path);
      const preview = page.locator(`img[src*="${path}"]`).first();
      const src = await preview.evaluate((img: HTMLImageElement) => img.currentSrc || img.src);
      expect(new URL(src).origin).toBe(new URL(env.portalUrl).origin);
      if (used) await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    });
    await nothingSent(writes);
  });

  test('SA-WAST-14 there is no document-year field', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openAt(page, env, 'Assistant & Logos');
    await test.step('Expect one number field ("Years to look back") and no document-year or current-year field', async () => {
      await expect(years(page)).toHaveCount(1);
      await expect(page.getByText(/document year|current year/i)).toHaveCount(0);
    });
    await nothingSent(writes);
  });
});
