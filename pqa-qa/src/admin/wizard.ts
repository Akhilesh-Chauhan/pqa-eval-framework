import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';
import type { Division } from './tenant-profile.js';

/** Step 0 package cards (A3.1); the wizard default is "Platform + AI Assistant". */
export type Package = 'Platform + AI Assistant' | 'Platform only' | 'AI Assistant only';

export interface WizardData {
  ministry: string;
  slug?: string;
  adminName: string;
  adminEmail: string;
  llm: { apiKey: string; baseUrl: string; model: string; embeddingModel: string };
  /** Leave unset to keep the wizard default. */
  package?: Package;
  /** Logo field label → path or URL (see tenant-profile.ts). */
  logos?: Record<string, string>;
  divisions?: Division[];
}

export const nextButton = (page: Page) => page.getByRole('button', { name: 'Next', exact: true });
export const packageRadio = (page: Page, name: Package) => page.getByRole('radio', { name });
/** Picks a package card by its title, centred first: a forced click on the hidden radio can land on the sticky footer
 * bar that covers the third card (22 Oct). Checks the radio took it. */
export async function pickPackage(page: Page, name: Package): Promise<void> {
  const title = page.getByRole('group', { name: 'Package' }).getByText(name, { exact: true }).first();
  await title.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await title.click();
  await expect(packageRadio(page, name)).toBeChecked();
}

/** Dummy Bedrock keys: AWS refuses them, so nothing is listed or billed. Never real credentials. */
export const DUMMY_BEDROCK = { accessKeyId: 'qa-dummy-access-key', secretAccessKey: 'qa-dummy-secret-key' };
export const BEDROCK_MODELS = { chat: ['qa.chat-a', 'qa.chat-b'], embedding: ['qa.embed-a'] };
export const checkCredentials = (page: Page) => page.getByRole('button', { name: 'Check credentials' });
// On Bedrock the model fields are the two unnamed comboboxes of the "Models" group (no #model / #embeddingModel there);
// on-prem the same group holds the #model / #embeddingModel textboxes instead.
export const chatModelPicker = (page: Page) => page.getByRole('group', { name: 'Models', exact: true }).getByRole('combobox').nth(0);
export const embeddingModelPicker = (page: Page) => page.getByRole('group', { name: 'Models', exact: true }).getByRole('combobox').nth(1);

/** Step 3: provider Bedrock with both keys typed (A3.4). */
export async function chooseBedrock(page: Page, keys = DUMMY_BEDROCK): Promise<void> {
  await page.locator('#provider').selectOption('bedrock');
  await page.locator('#bedrockAccessKeyId').fill(keys.accessKeyId);
  await page.locator('#bedrockSecretAccessKey').fill(keys.secretAccessKey);
}

/** Answers POST /api/llm/bedrock-models in the browser, so nothing reaches the server or AWS. Check n gets
 * lists[n]; the last repeats. Register after blockWrites so this handler runs first. */
export async function mockBedrockModels(page: Page, ...lists: Array<{ chat: string[]; embedding: string[] }>): Promise<void> {
  let n = 0;
  const options = (ids: string[]) => ids.map((id) => ({ id, label: id }));
  await page.route('**/api/llm/bedrock-models', (route) => {
    const list = lists[Math.min(n++, lists.length - 1)]!;
    return route.fulfill({ json: { data: { chatModels: options(list.chat), embeddingModels: options(list.embedding) } } });
  });
}

/** Presses Check credentials and load models, then picks a chat and an embedding model from the loaded lists. */
export async function loadModels(page: Page, chat = BEDROCK_MODELS.chat[0]!, embedding = BEDROCK_MODELS.embedding[0]!): Promise<void> {
  await checkCredentials(page).click();
  await chatModelPicker(page).selectOption(chat);
  await embeddingModelPicker(page).selectOption(embedding);
}

/** Walks steps 0–6 with valid values and stops on step 7 (Review & Submit), nothing submitted. */
export async function fillWizardToReview(page: Page, d: WizardData): Promise<void> {
  await test.step(`Open /tenants/new; step 0: ministry "${d.ministry}", slug ${d.slug ?? '(suggested)'}, package ${d.package ?? '(default)'}, admin ${d.adminName} <${d.adminEmail}>; Next`, async () => {
    await page.goto('/tenants/new');
    await page.locator('#ministryId').selectOption({ label: d.ministry });
    if (d.slug) await page.locator('#slug').fill(d.slug);
    // force: a radio card's label may sit over its input.
    if (d.package) await pickPackage(page, d.package);
    await page.locator('#adminName').fill(d.adminName);
    await page.locator('#adminEmail').fill(d.adminEmail);
    await nextButton(page).click();
  });
  await test.step('Step 1 Branding: keep defaults; Next', async () => {
    await expect(page.locator('#brandingPreset')).toBeVisible();
    await nextButton(page).click();
  });
  await test.step(`Step 2 Assistant: name "QA Assistant", heading, subheading, placeholder${d.logos ? `, ${Object.keys(d.logos).length} logos` : ''}; Next`, async () => {
    await page.locator('#displayName').fill('QA Assistant');
    await page.getByPlaceholder('Ready when you are.').fill('QA heading');
    await page.getByPlaceholder(/^Your digital assistant for/).fill('QA subheading');
    await page.getByPlaceholder(/^Ask your queries here/).fill('QA placeholder');
    for (const [label, value] of Object.entries(d.logos ?? {})) {
      await page.getByRole('textbox', { name: label, exact: true }).fill(value);
    }
    await nextButton(page).click();
  });
  await test.step(`Step 3 LLM: on-prem, API key from .env, base URL ${d.llm.baseUrl}, model ${d.llm.model}, embedding ${d.llm.embeddingModel}; Next`, async () => {
    await page.locator('#llmApiKey').fill(d.llm.apiKey);
    await page.locator('#baseUrl').fill(d.llm.baseUrl);
    await page.locator('#model').fill(d.llm.model);
    await page.locator('#embeddingModel').fill(d.llm.embeddingModel);
    await nextButton(page).click();
  });
  await test.step('Step 4 File rules: keep 10 MB, PDF; Next', async () => {
    await expect(page.locator('#filesizeMb')).toBeVisible();
    await nextButton(page).click();
  });
  const divisions = d.divisions ?? [];
  await test.step(`Step 5 Departments: ${divisions.length ? divisions.map((v) => `${v.name} [${v.short}]`).join('; ') : 'none'}; Next`, async () => {
    await expect(page.getByRole('button', { name: /^\+? ?Add division$/ })).toBeVisible();
    for (const [i, v] of divisions.entries()) {
      await page.getByRole('button', { name: /^\+? ?Add division$/ }).click();
      await page.getByRole('textbox', { name: 'Division name' }).nth(i).fill(v.name);
      await page.getByRole('textbox', { name: 'Short name' }).nth(i).fill(v.short);
      await page.getByRole('textbox', { name: /^(Description|What this division handles)$/ }).nth(i).fill(v.handles);
    }
    await nextButton(page).click();
  });
  await test.step('Step 6 Sources: no sources; Next', async () => {
    await expect(page.locator('#sourceUrl')).toBeVisible();
    await nextButton(page).click();
  });
  await expect(page.locator('#finalStatus')).toBeVisible();
}
