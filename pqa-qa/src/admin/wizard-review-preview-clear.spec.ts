import { writeFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { test, expect, blockWrites } from './fixtures.js';
import type { AdminEnv } from './admin-env.js';
import { nextButton } from './wizard.js';
import type { WizardData } from './wizard.js';

// Create-tenant wizard: step 7 Review & Submit, the live portal preview, and Clear all
// (components.md A3.8–A3.10). Every test aborts all non-GET /api calls (blockWrites) before
// opening the wizard. SA-WREV-05/06 answer POST /api/tenants in the browser — nothing reaches
// the server. The LLM key is always a dummy.

type Writes = Awaited<ReturnType<typeof blockWrites>>;

const STEPS = ['Basic Info', 'Branding', 'Assistant & Logos', 'LLM Config', 'File Rules', 'Departments', 'Sources & modules', 'Review & Submit'];
const LLM = { apiKey: 'dummy-key', baseUrl: 'https://negd-gpus.in', model: 'qa-chat-model', embeddingModel: 'qa-embed-model' };
const DIVISION = { name: 'QA Division', short: 'QAD', desc: 'Handles QA questions' };
const SOURCE = 'https://www.india.gov.in';

const onStep = (page: Page, n: number) => expect(page.getByRole('heading', { level: 2, name: STEPS[n], exact: true })).toBeVisible();
const message = (page: Page, text: string) => page.getByText(text, { exact: true });
const back = (page: Page) => page.getByRole('button', { name: 'Back', exact: true }).click();
const nothingSent = (writes: Writes) => test.step('Expect no write request was sent to /api', async () => expect(writes).toEqual([]));

async function fillLlm(page: Page): Promise<void> {
  await page.locator('#llmApiKey').fill(LLM.apiKey);
  await page.locator('#baseUrl').fill(LLM.baseUrl);
  await page.locator('#model').fill(LLM.model);
  await page.locator('#embeddingModel').fill(LLM.embeddingModel);
}

/** Valid input for the steps that need typing; steps 1 and 4–6 are valid as defaulted. */
const FILL: Partial<Record<number, (page: Page, d: WizardData) => Promise<void>>> = {
  0: async (page, d) => {
    await page.locator('#ministryId').selectOption({ label: d.ministry });
    await page.locator('#slug').fill(d.slug!);
    await page.locator('#adminName').fill(d.adminName);
    await page.locator('#adminEmail').fill(d.adminEmail);
  },
  2: async (page) => {
    await page.locator('#displayName').fill('QA Assistant');
    await page.getByPlaceholder('Ready when you are.').fill('QA heading');
    await page.getByPlaceholder(/^Your digital assistant for/).fill('QA subheading');
    await page.getByPlaceholder(/^Ask your queries here/).fill('QA placeholder');
  },
  3: fillLlm,
};

/** Presses Next from step `from` until step `to`, typing valid values where a step needs them. */
async function walk(page: Page, d: WizardData, from: number, to: number): Promise<void> {
  for (let s = from; s < to; s++) {
    await FILL[s]?.(page, d);
    await nextButton(page).click();
    await onStep(page, s + 1);
  }
}

/** Opens a fresh wizard (this test's own context, so an empty draft) and walks to step `to` with valid values. */
async function openWizardAt(page: Page, env: AdminEnv, to: number): Promise<WizardData> {
  const d = await test.step('Pick the first untaken ministry from GET /api/ministries and a random slug "qa" + 4 characters', async () => {
    const rows: Array<{ name: string; taken: boolean }> = (await (await page.request.get('/api/ministries')).json()).data;
    const ministry = rows.find((m) => !m.taken)?.name;
    expect(ministry, 'every ministry is taken').toBeTruthy();
    return {
      ministry: ministry!,
      slug: `qa${Math.random().toString(36).slice(2).padEnd(4, '0').slice(0, 4)}`,
      adminName: 'QA Admin',
      adminEmail: 'qa.admin@example.gov.in',
      llm: LLM,
    };
  });
  const filled = `fill steps 0–${to - 1} validly (ministry "${d.ministry}", slug ${d.slug}, admin ${d.adminName} <${d.adminEmail}>, assistant "QA Assistant", LLM key "dummy-key", model "${LLM.model}", embedding "${LLM.embeddingModel}") pressing Next each time`;
  await test.step(`Open /tenants/new${to ? ` and ${filled}` : ''} — on step ${to} "${STEPS[to]}"`, async () => {
    await page.goto('/tenants/new');
    await onStep(page, 0);
    await walk(page, d, 0, to);
  });
  return d;
}

/** Jumps with the step list at the top of the wizard, e.g. "8. Review & Submit". */
async function jump(page: Page, n: number): Promise<void> {
  await page.getByRole('button', { name: `${n + 1}. ${STEPS[n]}`, exact: true }).click();
  await onStep(page, n);
}

async function addDivision(page: Page, v: { name?: string; short?: string; desc?: string }): Promise<void> {
  await page.getByRole('button', { name: '+ Add division' }).click();
  const last = (name: string) => page.getByRole('textbox', { name, exact: true }).last();
  if (v.name) await last('Division name').fill(v.name);
  if (v.short) await last('Short name').fill(v.short);
  if (v.desc) await last('What this division handles').fill(v.desc);
}

async function addSource(page: Page, url: string): Promise<void> {
  await page.locator('#sourceUrl').fill(url);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}
const trustBox = (page: Page) => page.getByRole('checkbox', { name: /I confirm these URLs are trustworthy/ });

function tempFile(name: string, content: string): string {
  const path = test.info().outputPath(name);
  writeFileSync(path, content);
  return path;
}

const reviewRow = (page: Page, label: string, value: string) =>
  expect.soft(page.getByRole('main').first()).toContainText(new RegExp(`${label}\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

async function expectStep0(page: Page, d: WizardData): Promise<void> {
  await onStep(page, 0);
  await expect(page.locator('#ministryId option:checked')).toHaveText(d.ministry);
  await expect(page.locator('#slug')).toHaveValue(d.slug!);
  await expect(page.locator('#adminName')).toHaveValue(d.adminName);
  await expect(page.locator('#adminEmail')).toHaveValue(d.adminEmail);
}

test.describe('A3.8 Step 7 — Review & Submit', () => {
  test('SA-WREV-01 the summary shows every step and each Edit jumps to it', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const d = await openWizardAt(page, env, 5);
    await test.step(`Step 5: + Add division "${DIVISION.name}" / ${DIVISION.short} / "${DIVISION.desc}"; Next`, async () => {
      await addDivision(page, DIVISION);
      await nextButton(page).click();
      await onStep(page, 6);
    });
    await test.step(`Step 6: add ${SOURCE}, tick "I confirm these URLs are trustworthy", pick spec.yaml; Next`, async () => {
      await addSource(page, SOURCE);
      await trustBox(page).check();
      await page.locator('#openapiYaml').setInputFiles(tempFile('spec.yaml', 'openapi: 3.0.0\n'));
      await nextButton(page).click();
      await onStep(page, 7);
    });
    const rows: Array<[label: string, value: string, step: number]> = [
      ['Ministry name', d.ministry, 0],
      ['Portal path', `/${d.slug}`, 0],
      ['Primary color', '#4338ca', 1],
      ['Assistant name', 'QA Assistant', 2],
      ['LLM', `on_prem — ${LLM.model}`, 3],
      ['Max upload size', '10 MB', 4],
      ['Departments', '1', 5],
      ['Source websites', '1', 6],
      ['OpenAPI YAML', 'spec.yaml', 6],
    ];
    await test.step(`Expect the rows: ${rows.map(([label, value]) => `${label} ${value}`).join(' · ')}`, async () => {
      for (const [label, value] of rows) await reviewRow(page, label, value);
    });
    for (const [i, [label, , step]] of rows.entries()) {
      await test.step(`Click Edit on "${label}" — expect step ${step} "${STEPS[step]}"; return with the step list "8. Review & Submit"`, async () => {
        await page.getByRole('button', { name: 'Edit', exact: true }).nth(i).click();
        await onStep(page, step);
        await jump(page, 7);
      });
    }
    await nothingSent(writes);
  });

  test('SA-WREV-02 blank values and empty lists show as —, None and Not attached', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const d = await openWizardAt(page, env, 1);
    await test.step('Step 1: clear Primary brand color; Next through steps 2–6 (no sources, no YAML) to step 7', async () => {
      await page.locator('#primaryColor').fill('');
      await walk(page, d, 1, 7);
    });
    await test.step('Expect "Primary color —", "Source websites None", "OpenAPI YAML Not attached"', async () => {
      await reviewRow(page, 'Primary color', '—');
      await reviewRow(page, 'Source websites', 'None');
      await reviewRow(page, 'OpenAPI YAML', 'Not attached');
    });
    await nothingSent(writes);
  });

  test('SA-WREV-03 initial status defaults to Inactive and offers only Inactive and Active', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 7);
    await test.step('Expect Initial status "Inactive (recommended)" selected; options exactly "Inactive (recommended)", "Active" (no suspended)', async () => {
      await expect(page.locator('#finalStatus')).toHaveValue('inactive');
      await expect(page.locator('#finalStatus option')).toHaveText(['Inactive (recommended)', 'Active']);
    });
    await nothingSent(writes);
  });

  test('SA-WREV-04 the hint explains the inactive default', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 7);
    await test.step('Expect "Starts inactive by default so branding can be checked before it goes live."', async () => {
      await expect(message(page, 'Starts inactive by default so branding can be checked before it goes live.')).toBeVisible();
    });
    await nothingSent(writes);
  });

  test('SA-WREV-05 a submission error shows in red above the footer and the draft stays', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const posts: unknown[] = [];
    await test.step('Answer POST /api/tenants in the browser with 409 {"error":{"message":"A portal for X already exists"}} — nothing reaches the server', async () => {
      await page.route('**/api/tenants', (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        posts.push(route.request().postData());
        return route.fulfill({ status: 409, json: { error: { message: 'A portal for X already exists' } } });
      });
    });
    const d = await openWizardAt(page, env, 7);
    await test.step('Press Create tenant', async () => {
      await page.getByRole('button', { name: 'Create tenant' }).click();
    });
    const error = message(page, 'A portal for X already exists');
    await test.step('Expect "A portal for X already exists" in red, above the footer buttons', async () => {
      await expect(error).toBeVisible();
      // Through a canvas so any CSS colour syntax (rgb, oklch…) comes back as RGB.
      const [r = 0, g = 0, b = 0] = await error.evaluate((el) => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        ctx.fillStyle = getComputedStyle(el).color;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data];
      });
      expect(r, `rgb(${r}, ${g}, ${b}) is red`).toBeGreaterThan(Math.max(g, b));
      const footer = await page.getByRole('button', { name: 'Back', exact: true }).boundingBox();
      expect((await error.boundingBox())?.y).toBeLessThan(footer?.y ?? 0);
    });
    await test.step('Expect still on step 7 with the draft intact (ministry and portal path rows)', async () => {
      await onStep(page, 7);
      await reviewRow(page, 'Ministry name', d.ministry);
      await reviewRow(page, 'Portal path', `/${d.slug}`);
    });
    await test.step('Expect exactly one POST, answered by the test', async () => expect(posts).toHaveLength(1));
    await nothingSent(writes);
  });

  test('SA-WREV-06 a double-click on Create tenant sends one request and shows Provisioning…', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const posts: unknown[] = [];
    await test.step('Answer POST /api/tenants in the browser with 201 after 3 s (echoing the sent tenant) — nothing reaches the server', async () => {
      await page.route('**/api/tenants', async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        posts.push(route.request().postData());
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        const now = new Date().toISOString();
        const tenant = { ...route.request().postDataJSON().tenant, createdAt: now, updatedAt: now };
        return route.fulfill({ status: 201, json: { data: { tenant, departments: [] } } });
      });
    });
    const d = await openWizardAt(page, env, 7);
    await test.step('Double-click Create tenant', async () => {
      await page.getByRole('button', { name: 'Create tenant' }).dblclick();
    });
    await test.step('Expect the button to read "Provisioning…" while the request is in flight; record whether it is disabled', async () => {
      const busy = page.getByRole('button', { name: 'Provisioning…' });
      await expect(busy).toBeVisible();
      test.info().annotations.push({ type: 'question', description: `Spec does not say the button is disabled in flight. Observed: ${(await busy.isDisabled()) ? 'disabled' : 'enabled'}.` });
    });
    await test.step(`Expect "${d.ministry} provisioned" and exactly one POST`, async () => {
      await expect(page.getByText(`${d.ministry} provisioned`)).toBeVisible({ timeout: 10_000 });
      expect(posts).toHaveLength(1);
    });
    await nothingSent(writes);
  });
});

const preview = (page: Page) => page.getByRole('complementary', { name: 'Portal preview' });
const shows = (scope: Locator, text: string) => scope.getByText(text, { exact: true }).or(scope.getByPlaceholder(text, { exact: true })).first();

/** Every colour, background and gradient computed inside the preview, as one comparable string. */
const paint = (page: Page) =>
  preview(page).evaluate((root) =>
    [root, ...root.querySelectorAll('*')]
      .map((el) => {
        const s = getComputedStyle(el);
        return [s.color, s.backgroundColor, s.backgroundImage, s.borderColor].join('|');
      })
      .join('\n'),
  );
const gradients = (paint: string) => paint.split('\n').filter((line) => line.includes('gradient')).join('\n');

test.describe('A3.9 Live portal preview', () => {
  test('SA-WPRV-01 the preview sits beside every step', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 7);
    for (let n = 7; n >= 0; n--) {
      await test.step(`Step ${n} "${STEPS[n]}": expect the Portal preview column${n ? '; then Back' : ''}`, async () => {
        await onStep(page, n);
        await expect(preview(page)).toBeVisible();
        if (n) await back(page);
      });
    }
    await test.step('Expect the preview column to be sticky', async () => {
      const sticky = await preview(page).evaluate((el) => {
        for (let e: Element | null = el; e; e = e.parentElement) if (getComputedStyle(e).position === 'sticky') return true;
        return false;
      });
      expect(sticky, 'position: sticky on the preview or an ancestor').toBe(true);
    });
    await nothingSent(writes);
  });

  test('SA-WPRV-02 three screen buttons and the URL strip', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const d = await openWizardAt(page, env, 0);
    const strip = preview(page).getByText(/^https?:\/\/\S+$/);
    await test.step('With no slug: expect "Advanced Dashboard" pressed and the strip ending "/…/parliament/advanced-dashboard"', async () => {
      await expect(preview(page).getByRole('button', { name: 'Advanced Dashboard', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await expect(strip).toHaveText(/\/…\/parliament\/advanced-dashboard$/);
    });
    const slug = await test.step(`Choose "${d.ministry}" — expect the strip to end "/<derived slug>/parliament/advanced-dashboard"`, async () => {
      await page.locator('#ministryId').selectOption({ label: d.ministry });
      await expect(page.locator('#slug')).not.toHaveValue('');
      const derived = await page.locator('#slug').inputValue();
      await expect(strip).toHaveText(new RegExp(`/${derived}/parliament/advanced-dashboard$`));
      return derived;
    });
    for (const screen of ['Generate', 'Parliament Dashboard', 'Advanced Dashboard']) {
      await test.step(`Click "${screen}" — expect it pressed and the strip on /${slug}/`, async () => {
        const button = preview(page).getByRole('button', { name: screen, exact: true });
        await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'true');
        await expect(strip).toContainText(`/${slug}/`);
      });
    }
    await nothingSent(writes);
  });

  test('SA-WPRV-03 the preview frame is a static mock-up', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 0);
    await test.step('Click "Search" in the preview navigation — expect to stay on /tenants/new, step 0', async () => {
      await preview(page).getByRole('navigation').getByText('Search', { exact: true }).click({ force: true });
      await expect(page).toHaveURL(/\/tenants\/new$/);
      await onStep(page, 0);
    });
    await test.step('Click Generate, click the chat input in the preview and type "qa typed text" — expect the text nowhere in the preview', async () => {
      await preview(page).getByRole('button', { name: 'Generate', exact: true }).click();
      await shows(preview(page), 'Please ask your queries here').click({ force: true });
      await page.keyboard.type('qa typed text');
      await expect(preview(page)).not.toContainText('qa typed text');
      const values = await preview(page).locator('input, textarea').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
      expect(values).not.toContain('qa typed text');
    });
    await nothingSent(writes);
  });

  test('SA-WPRV-04 a new primary colour re-tints the preview at once', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 1);
    const before = await test.step('Read the preview colours with the default primary #4338ca', () => paint(page));
    await test.step('Set Primary brand color to #ff0000 — expect the preview colours and gradients to change', async () => {
      await page.locator('#primaryColor').fill('#ff0000');
      await expect.poll(() => paint(page)).not.toBe(before);
      expect.soft(gradients(await paint(page)), 'gradients re-tinted').not.toBe(gradients(before));
    });
    await nothingSent(writes);
  });

  test('SA-WPRV-05 an unsafe colour "red; }" writes nothing', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 1);
    const before = await test.step('Read the preview colours with the default primary #4338ca', () => paint(page));
    await test.step('Enter "red; }" in Primary brand color', async () => {
      await page.locator('#primaryColor').fill('red; }');
    });
    await test.step('Expect the preview colours unchanged, "red; }" in no inline style or <style> element, and the page intact', async () => {
      expect(await paint(page)).toBe(before);
      const leaked = await page.evaluate((raw) => {
        const css = [...document.querySelectorAll('[style]')].map((e) => e.getAttribute('style') ?? '');
        css.push(...[...document.querySelectorAll('style')].map((s) => s.textContent ?? ''));
        return css.some((text) => text.includes(raw));
      }, 'red; }');
      expect(leaked).toBe(false);
      await expect(preview(page)).toBeVisible();
      await onStep(page, 1);
    });
    await nothingSent(writes);
  });

  test('SA-WPRV-06 a pinned brand token overrides the derived shade', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 1);
    await test.step('Press "Show advanced: pin exact tokens" — expect no #ff0000 in the preview yet', async () => {
      await page.getByRole('button', { name: 'Show advanced: pin exact tokens' }).click();
      expect(await paint(page)).not.toContain('rgb(255, 0, 0)');
    });
    await test.step('Set token "brand" (#override-brand) to #ff0000 — expect the preview to use rgb(255, 0, 0)', async () => {
      await page.locator('#override-brand').fill('#ff0000');
      await expect.poll(() => paint(page)).toContain('rgb(255, 0, 0)');
    });
    await nothingSent(writes);
  });

  test('SA-WPRV-07 a wrong logo path hides the image in the preview', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 2);
    await test.step('Set App wordmark (#logo-appWordmark) to "/nope.png" and wait for the image to be requested', async () => {
      const requested = page.waitForRequest((r) => r.url().endsWith('/nope.png'));
      await page.locator('#logo-appWordmark').fill('/nope.png');
      await requested;
    });
    await test.step('Expect no visible /nope.png image in the preview; record the field\'s own preview', async () => {
      await expect(preview(page).locator('img[src*="nope.png"]:visible')).toHaveCount(0);
      const outside = await page.locator('img[src*="nope.png"]:visible').count();
      test.info().annotations.push({ type: 'question', description: `The portal preview hides the broken wordmark; outside it ${outside} broken /nope.png image(s) are visible (the field's own preview, A3.3). Confirm both behaviours are intended.` });
    });
    await nothingSent(writes);
  });

  test('SA-WPRV-08 unticking Knowledge-base Search removes Search from the preview nav', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 6);
    const nav = preview(page).getByRole('navigation');
    await test.step('Expect "Search" in the preview navigation', async () => expect(nav).toContainText('Search'));
    await test.step('Untick "Knowledge-base Search" — expect "Search" gone from the preview navigation', async () => {
      await page.getByRole('checkbox', { name: 'Knowledge-base Search', exact: true }).uncheck();
      await expect(nav).not.toContainText('Search');
    });
    await nothingSent(writes);
  });

  test('SA-WPRV-09 the first division shows on the dashboard preview', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 5);
    await test.step('+ Add division named "QA Division" — expect "#1 QA Division" in the preview', async () => {
      await addDivision(page, { name: 'QA Division' });
      await expect(preview(page).getByText('#1 QA Division')).toBeVisible();
    });
    await nothingSent(writes);
  });

  test('SA-WPRV-10 the preview shows the ministry and greets the admin', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const d = await openWizardAt(page, env, 0);
    await test.step(`Choose "${d.ministry}" — expect it in the preview`, async () => {
      await page.locator('#ministryId').selectOption({ label: d.ministry });
      await expect(preview(page)).toContainText(d.ministry);
    });
    await test.step('Admin name "Asha" — expect "Good Morning, Asha"', async () => {
      await page.locator('#adminName').fill('Asha');
      await expect(preview(page)).toContainText('Good Morning, Asha');
    });
    await test.step('Clear the admin name — expect "Good Morning, Admin"', async () => {
      await page.locator('#adminName').fill('');
      await expect(preview(page)).toContainText('Good Morning, Admin');
    });
    await nothingSent(writes);
  });

  test('SA-WPRV-11 blank values fall back; a blank welcome heading and subheading are omitted', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const d = await openWizardAt(page, env, 0);
    await test.step('Before filling anything: expect "Ministry" and "#1 Division" on the dashboard preview', async () => {
      await expect(shows(preview(page), 'Ministry')).toBeVisible();
      await expect(shows(preview(page), '#1 Division')).toBeVisible();
    });
    await test.step('Click Generate — expect "Assistant" and the placeholder "Please ask your queries here"', async () => {
      await preview(page).getByRole('button', { name: 'Generate', exact: true }).click();
      await expect(shows(preview(page), 'Assistant')).toBeVisible();
      await expect(shows(preview(page), 'Please ask your queries here')).toBeVisible();
    });
    await test.step(`Fill step 0 (ministry "${d.ministry}", slug ${d.slug}, admin) and Next twice to step 2`, async () => walk(page, d, 0, 2));
    const blank = await test.step('Click Generate and read the preview text with the welcome heading and subheading blank', async () => {
      await preview(page).getByRole('button', { name: 'Generate', exact: true }).click();
      return preview(page).innerText();
    });
    await test.step('Welcome heading "QA heading", subheading "QA subheading" — expect both in the preview', async () => {
      await page.getByPlaceholder('Ready when you are.').fill('QA heading');
      await page.getByPlaceholder(/^Your digital assistant for/).fill('QA subheading');
      await expect(preview(page)).toContainText('QA heading');
      await expect(preview(page)).toContainText('QA subheading');
    });
    await test.step('Clear both — expect them omitted: the preview text is exactly as it was, with no empty line left behind', async () => {
      await page.getByPlaceholder('Ready when you are.').fill('');
      await page.getByPlaceholder(/^Your digital assistant for/).fill('');
      await expect.poll(() => preview(page).innerText()).toBe(blank);
    });
    await nothingSent(writes);
  });

  test('SA-WPRV-12 the assistant strings appear in the Generate preview', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 2);
    const strings = ['QA Bot', 'QA welcome heading', 'QA welcome subheading', 'QA composer placeholder'];
    await test.step(`Assistant name "${strings[0]}", heading "${strings[1]}", subheading "${strings[2]}", placeholder "${strings[3]}"; click Generate`, async () => {
      await page.locator('#displayName').fill(strings[0]!);
      await page.getByPlaceholder('Ready when you are.').fill(strings[1]!);
      await page.getByPlaceholder(/^Your digital assistant for/).fill(strings[2]!);
      await page.getByPlaceholder(/^Ask your queries here/).fill(strings[3]!);
      await preview(page).getByRole('button', { name: 'Generate', exact: true }).click();
    });
    await test.step('Expect all four in the preview', async () => {
      for (const text of strings) await expect(shows(preview(page), text)).toBeVisible();
    });
    await nothingSent(writes);
  });
});

const clearDialog = (page: Page) => page.getByRole('dialog', { name: 'Clear all fields on this step?' });

/** Footer "Clear all", then the dialog's Clear all (accessible name "Confirm clear all") or Cancel. */
async function clearStep(page: Page, choice: 'Clear all' | 'Cancel' = 'Clear all'): Promise<void> {
  await page.getByRole('button', { name: 'Clear all fields on this step', exact: true }).click();
  await clearDialog(page).getByRole('button', { name: choice === 'Cancel' ? 'Cancel' : 'Confirm clear all', exact: true }).click();
  await expect(clearDialog(page)).toBeHidden();
}

const LOGOS = ['Ministry crest', 'App icon (collapsed sidebar)', 'App wordmark (expanded sidebar)', 'Assistant avatar', 'Assistant avatar (on color)', 'Assistant splash logo', 'Assistant splash logo (on color)'];

test.describe('A3.10 Clear all', () => {
  test('SA-WCLR-01 every step offers the same Clear all dialog', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 7);
    for (let n = 7; n >= 0; n--) {
      await test.step(`Step ${n} "${STEPS[n]}": press Clear all — expect the title, body, Cancel and Clear all; press Cancel${n ? '; then Back' : ''}`, async () => {
        await onStep(page, n);
        await page.getByRole('button', { name: 'Clear all fields on this step', exact: true }).click();
        const dialog = clearDialog(page);
        await expect(dialog.getByRole('heading')).toHaveText('Clear all fields on this step?');
        await expect(dialog).toContainText('Fields on this step return to their empty values. Other steps stay as entered.');
        await expect(dialog.getByRole('button', { name: 'Confirm clear all', exact: true })).toHaveText('Clear all');
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(dialog).toBeHidden();
        if (n) await back(page);
      });
    }
    await nothingSent(writes);
  });

  test('SA-WCLR-02 Cancel changes nothing', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const d = await openWizardAt(page, env, 0);
    await test.step(`Fill step 0: ministry "${d.ministry}", slug ${d.slug}, admin ${d.adminName} <${d.adminEmail}>`, async () => FILL[0]!(page, d));
    await test.step('Press Clear all, then Cancel', async () => clearStep(page, 'Cancel'));
    await test.step('Expect every step-0 value unchanged', async () => expectStep0(page, d));
    await nothingSent(writes);
  });

  test('SA-WCLR-03 confirming clears the errors shown on the step', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 0);
    const errors = ['Select a ministry.', 'Admin name is required', 'Admin email is required'];
    await test.step(`Press Next on the blank step 0 — expect ${errors.map((e) => `"${e}"`).join(', ')}`, async () => {
      await nextButton(page).click();
      for (const e of errors) await expect(message(page, e)).toBeVisible();
    });
    await test.step('Press Clear all and confirm — expect the errors gone', async () => {
      await clearStep(page);
      for (const e of errors) await expect(message(page, e)).toBeHidden();
    });
    await nothingSent(writes);
  });

  test('SA-WCLR-04 Clear all on step 0 resets it and unlocks the slug', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const d = await openWizardAt(page, env, 1);
    await test.step('Back to step 0 — expect the slug locked (disabled)', async () => {
      await back(page);
      await onStep(page, 0);
      await expect(page.locator('#slug')).toBeDisabled();
    });
    await test.step('Press Clear all and confirm — expect ministry, slug, admin name and admin email cleared', async () => {
      await clearStep(page);
      await expect(page.locator('#ministryId option:checked')).toHaveText('Select a ministry');
      for (const id of ['#slug', '#adminName', '#adminEmail']) await expect(page.locator(id)).toHaveValue('');
    });
    await test.step(`Choose "${d.ministry}" — expect the slug editable and re-derived (6 characters, not ${d.slug})`, async () => {
      await page.locator('#ministryId').selectOption({ label: d.ministry });
      await expect(page.locator('#slug')).toBeEditable();
      await expect(page.locator('#slug')).toHaveValue(/^[a-z0-9-]{6}$/);
      await expect(page.locator('#slug')).not.toHaveValue(d.slug!);
    });
    await nothingSent(writes);
  });

  test('SA-WCLR-05 Clear all on step 1 resets the colours only', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const d = await openWizardAt(page, env, 3);
    await test.step('Back to step 1; Chat bubble #112233, Primary #ff0000, Accent #00ff00; show advanced and pin brand #123456', async () => {
      await back(page);
      await back(page);
      await onStep(page, 1);
      await page.locator('#userMsgColor').fill('#112233');
      await page.locator('#primaryColor').fill('#ff0000');
      await page.locator('#accentColor').fill('#00ff00');
      await page.getByRole('button', { name: 'Show advanced: pin exact tokens' }).click();
      await page.locator('#override-brand').fill('#123456');
    });
    await test.step('Press Clear all and confirm — expect #e0e7ffcc, #4338ca, #0ea5e9 and the brand override blank', async () => {
      await clearStep(page);
      await expect(page.locator('#userMsgColor')).toHaveValue('#e0e7ffcc');
      await expect(page.locator('#primaryColor')).toHaveValue('#4338ca');
      await expect(page.locator('#accentColor')).toHaveValue('#0ea5e9');
      // The advanced panel may close on reset; reopen it to read the token.
      const show = page.getByRole('button', { name: 'Show advanced: pin exact tokens' });
      if (await show.isVisible()) await show.click();
      await expect(page.locator('#override-brand')).toHaveValue('');
    });
    await test.step('Back to step 0 — expect ministry, slug and admin unchanged', async () => {
      await back(page);
      await expectStep0(page, d);
    });
    await test.step('Next twice to step 2 — expect Assistant name "QA Assistant" unchanged', async () => {
      await nextButton(page).click();
      await onStep(page, 1);
      await nextButton(page).click();
      await onStep(page, 2);
      await expect(page.locator('#displayName')).toHaveValue('QA Assistant');
    });
    await nothingSent(writes);
  });

  test('SA-WCLR-06 Clear all on step 2 resets the assistant, logos, welcome strings and years', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 2);
    const fields = [
      page.locator('#displayName'),
      page.getByPlaceholder('Ready when you are.'),
      page.getByPlaceholder(/^Your digital assistant for/),
      page.getByPlaceholder(/^Ask your queries here/),
      ...LOGOS.map((name) => page.getByRole('textbox', { name, exact: true })),
    ];
    const years = page.getByRole('spinbutton');
    await test.step('Fill assistant name, welcome heading, subheading and placeholder with "QA text", the seven logo paths with "/logos/tenants/qa.svg", years to look back "3"', async () => {
      for (const [i, field] of fields.entries()) await field.fill(i < 4 ? 'QA text' : '/logos/tenants/qa.svg');
      await years.fill('3');
    });
    await test.step('Press Clear all and confirm — expect all eleven text fields blank; record years to look back', async () => {
      await clearStep(page);
      for (const field of fields) await expect(field).toHaveValue('');
      await expect(years).not.toHaveValue('3');
      test.info().annotations.push({ type: 'question', description: `Years to look back after Clear all: "${await years.inputValue()}" (5 or blank is unspecified).` });
    });
    await nothingSent(writes);
  });

  test('SA-WCLR-07 Clear all on step 3 discards the typed API key from the field and the draft', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 3);
    const draft = () => page.evaluate(() => Object.values(sessionStorage).join('\n'));
    await test.step('API key "dummy-key", base URL https://llm.example.gov.in, chat and embedding models, dimensions 768', async () => {
      await fillLlm(page);
      await page.locator('#baseUrl').fill('https://llm.example.gov.in');
      await page.locator('#embeddingDimensions').fill('768');
      test.info().annotations.push({ type: 'note', description: `Before Clear all the sessionStorage draft ${(await draft()).includes(LLM.apiKey) ? 'held' : 'did not hold'} the typed API key.` });
    });
    await test.step('Press Clear all and confirm — expect on-prem, https://negd-gpus.in, models blank, dimensions 1024, API key blank', async () => {
      await clearStep(page);
      await expect(page.locator('#provider option:checked')).toHaveText('On Prem (NeGD GPUs)');
      await expect(page.locator('#baseUrl')).toHaveValue('https://negd-gpus.in');
      await expect(page.locator('#embeddingDimensions')).toHaveValue('1024');
      for (const id of ['#model', '#embeddingModel', '#llmApiKey']) await expect(page.locator(id)).toHaveValue('');
    });
    await test.step('Expect "dummy-key" nowhere in sessionStorage', async () => {
      await expect.poll(draft).not.toContain(LLM.apiKey);
    });
    await nothingSent(writes);
  });

  test('SA-WCLR-08 Clear all on step 4 resets size and types', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 4);
    await test.step('Max upload size "25"; tick PNG; untick PDF', async () => {
      await page.locator('#filesizeMb').fill('25');
      await page.getByRole('checkbox', { name: 'PNG', exact: true }).check();
      await page.getByRole('checkbox', { name: 'PDF', exact: true }).uncheck();
    });
    await test.step('Press Clear all and confirm — expect size "10" and only PDF ticked', async () => {
      await clearStep(page);
      await expect(page.locator('#filesizeMb')).toHaveValue('10');
      await expect(page.getByRole('checkbox', { name: 'PDF', exact: true })).toBeChecked();
      await expect(page.getByRole('checkbox', { checked: true })).toHaveCount(1);
    });
    await nothingSent(writes);
  });

  test('SA-WCLR-09 Clear all on step 5 removes every division', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 5);
    await test.step('Add divisions "QA Division 1" / QA1 and "QA Division 2" / QA2', async () => {
      await addDivision(page, { ...DIVISION, name: 'QA Division 1', short: 'QA1' });
      await addDivision(page, { ...DIVISION, name: 'QA Division 2', short: 'QA2' });
    });
    await test.step('Press Clear all and confirm — expect no division rows and the "No departments yet" note', async () => {
      await clearStep(page);
      await expect(page.getByRole('textbox', { name: 'Division name', exact: true })).toHaveCount(0);
      await expect(page.getByText(/^No departments yet/)).toBeVisible();
    });
    await nothingSent(writes);
  });

  test('SA-WCLR-10 Clear all on step 6 empties sources, unticks trust, turns every module on and drops the YAML', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 6);
    await test.step(`Add ${SOURCE}, tick trust, untick "AI Assistant (Generate)" and "Divisions", pick spec.yaml`, async () => {
      await addSource(page, SOURCE);
      await trustBox(page).check();
      await page.getByRole('checkbox', { name: 'AI Assistant (Generate)', exact: true }).uncheck();
      await page.getByRole('checkbox', { name: 'Divisions', exact: true }).uncheck();
      await page.locator('#openapiYaml').setInputFiles(tempFile('spec.yaml', 'openapi: 3.0.0\n'));
      await expect(message(page, 'Selected: spec.yaml')).toBeVisible();
    });
    await test.step('Press Clear all and confirm — expect no sources, all 18 modules ticked, "No file attached."', async () => {
      await clearStep(page);
      await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(0);
      await expect(page.getByRole('checkbox')).toHaveCount(18);
      await expect(page.getByRole('checkbox', { checked: false })).toHaveCount(0);
      await expect(message(page, 'No file attached.')).toBeVisible();
    });
    await test.step(`Add ${SOURCE} again — expect the trust box unticked`, async () => {
      await addSource(page, SOURCE);
      await expect(trustBox(page)).not.toBeChecked();
    });
    await nothingSent(writes);
  });

  test('SA-WCLR-11 Clear all on step 7 sets the status back to inactive', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 7);
    await test.step('Choose Initial status "Active"', async () => {
      await page.locator('#finalStatus').selectOption({ label: 'Active' });
    });
    await test.step('Press Clear all and confirm — expect "inactive"', async () => {
      await clearStep(page);
      await expect(page.locator('#finalStatus')).toHaveValue('inactive');
    });
    await nothingSent(writes);
  });

  test('SA-WCLR-12 Clear all on step 3 leaves the other steps untouched', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const d = await openWizardAt(page, env, 4);
    await test.step(`Step 4: size "25", tick PNG; Next. Step 5: add "${DIVISION.name}" / ${DIVISION.short}; Next. Step 6: add ${SOURCE}, tick trust; Next`, async () => {
      await page.locator('#filesizeMb').fill('25');
      await page.getByRole('checkbox', { name: 'PNG', exact: true }).check();
      await nextButton(page).click();
      await addDivision(page, DIVISION);
      await nextButton(page).click();
      await addSource(page, SOURCE);
      await trustBox(page).check();
      await nextButton(page).click();
      await onStep(page, 7);
    });
    await test.step('Back to step 3; press Clear all and confirm', async () => {
      for (let n = 6; n >= 3; n--) await back(page);
      await onStep(page, 3);
      await clearStep(page);
    });
    await test.step('Back to steps 2, 1, 0 — expect "QA Assistant" / "QA heading", primary #4338ca, and step 0 unchanged', async () => {
      await back(page);
      await onStep(page, 2);
      await expect(page.locator('#displayName')).toHaveValue('QA Assistant');
      await expect(page.getByPlaceholder('Ready when you are.')).toHaveValue('QA heading');
      await back(page);
      await onStep(page, 1);
      await expect(page.locator('#primaryColor')).toHaveValue('#4338ca');
      await back(page);
      await expectStep0(page, d);
    });
    await test.step('Next to step 3 and refill the LLM fields (dummy key) — the only way forward after the clear', async () => {
      for (let n = 1; n <= 3; n++) {
        await nextButton(page).click();
        await onStep(page, n);
      }
      await fillLlm(page);
    });
    await test.step(`Next to steps 4, 5, 6 — expect 25 MB with PNG ticked, "${DIVISION.name}", and ${SOURCE} with trust ticked`, async () => {
      await nextButton(page).click();
      await onStep(page, 4);
      await expect(page.locator('#filesizeMb')).toHaveValue('25');
      await expect(page.getByRole('checkbox', { name: 'PNG', exact: true })).toBeChecked();
      await nextButton(page).click();
      await onStep(page, 5);
      await expect(page.getByRole('textbox', { name: 'Division name', exact: true })).toHaveValue(DIVISION.name);
      await nextButton(page).click();
      await onStep(page, 6);
      await expect(page.getByRole('button', { name: `Remove ${SOURCE}`, exact: true })).toBeVisible();
      await expect(trustBox(page)).toBeChecked();
    });
    await nothingSent(writes);
  });
});
