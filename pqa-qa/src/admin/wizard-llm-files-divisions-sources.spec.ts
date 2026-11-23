import { writeFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { test, expect, blockWrites } from './fixtures.js';
import type { AdminEnv } from './admin-env.js';
import { BEDROCK_MODELS, DUMMY_BEDROCK, checkCredentials, chooseBedrock, loadModels, mockBedrockModels, nextButton } from './wizard.js';
import type { WizardData } from './wizard.js';
import { notMeasured } from '../support/annotations.js';

// Create-tenant wizard steps 3–6 (components.md A3.4–A3.7). Every test aborts all non-GET /api
// calls (blockWrites) before opening the wizard, so nothing here can create a tenant. The
// "capture" tests read the body of the aborted POST /api/tenants. The LLM keys are always dummies;
// the Bedrock model list is answered in the browser, except SA-WLLM-17, which lets AWS refuse the dummy keys.

type Writes = Awaited<ReturnType<typeof blockWrites>>;

const STEPS = ['Basic Info', 'Branding', 'Assistant & Logos', 'LLM Config', 'File Rules', 'Departments', 'Sources', 'Review & Submit'];
const LLM = { apiKey: 'dummy-key', baseUrl: 'https://negd-gpus.in', model: 'qa-chat-model', embeddingModel: 'qa-embed-model' };
const KEYS_REQUIRED = 'Access key and secret key are required for Bedrock.';
const MODELS_STALE = 'Check credentials and load models, then choose one.';
const CREDENTIALS_ERROR = 'Those credentials could not list models in this region. Check the access key, secret key, and region.';
const AWS_UNREACHABLE = 'Could not reach AWS to list models.';
const HTTPS_ONLY = 'Must be a public HTTPS URL (no localhost or private IPs).';
const DIVISION = { name: 'QA Division', short: 'QAD', desc: 'Handles QA questions' };

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

/** The step list's button for step `n`, e.g. "Step 4: LLM Config, completed" (its state follows the comma). */
const stepButton = (page: Page, n: number) =>
  page.getByRole('button', { name: new RegExp(`^Step ${n + 1}: ${STEPS[n]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(,|$)`) });

/** Jumps with the step list at the top of the wizard. */
async function jump(page: Page, n: number): Promise<void> {
  await stepButton(page, n).click();
  await onStep(page, n);
}

// The Bedrock model pickers have no id or label on the live build (A3.4 names them #model / #embeddingModel):
// they are the two selects of the "Models" group.
const chatPicker = (page: Page) => page.getByRole('group', { name: 'Models' }).getByRole('combobox').nth(0);
const embeddingPicker = (page: Page) => page.getByRole('group', { name: 'Models' }).getByRole('combobox').nth(1);

/** `fill` refuses letters in a number input, so type those the way a user would. */
async function typeInto(input: Locator, value: string): Promise<void> {
  if (/^[-\d.]*$/.test(value)) return input.fill(value);
  await input.fill('');
  await input.pressSequentially(value);
}

/** Each value alone must block Next with `text`; a valid value in between proves every error is fresh. */
async function expectEachRejected(page: Page, field: string, values: string[], text: string, step: number, valid: string): Promise<void> {
  for (const value of values) {
    await test.step(`Enter "${value}" in ${field}, press Next — expect "${text}" and still on step ${step}`, async () => {
      await typeInto(page.locator(field), value);
      await nextButton(page).click();
      await expect(message(page, text)).toBeVisible();
      await onStep(page, step);
    });
    await test.step(`Enter "${valid}" in ${field}, press Next (advances), then Back — the error is gone`, async () => {
      await typeInto(page.locator(field), valid);
      await nextButton(page).click();
      await onStep(page, step + 1);
      await back(page);
      await expect(message(page, text)).toBeHidden();
    });
  }
}

const reviewRow = (page: Page, label: string, value: string) =>
  expect(page.getByRole('main').first()).toContainText(new RegExp(`${label}\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

interface CreateBody {
  tenant: { assistant: { fileSupportType: { mimeTypes: string[]; questionListMimeTypes: string[] }; llm?: Record<string, unknown> } };
  departments: Array<{ designations?: string[]; status?: string }>;
  llmApiKey?: string;
  bedrockAccessKeyId?: string;
  bedrockSecretAccessKey?: string;
}

async function captureCreate(page: Page, writes: Writes): Promise<CreateBody> {
  return test.step('Press Create tenant and capture the POST /api/tenants body (the request is aborted — nothing is created)', async () => {
    await page.getByRole('button', { name: 'Create tenant' }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toMatchObject({ method: 'POST', path: '/api/tenants' });
    return JSON.parse(writes[0]?.body ?? '{}') as CreateBody;
  });
}

async function addDivision(page: Page, v: { name?: string; short?: string; desc?: string; designations?: string }): Promise<void> {
  await page.getByRole('button', { name: /^\+? ?Add division$/ }).click();
  const last = (name: string) => page.getByRole('textbox', { name, exact: true }).last();
  if (v.name) await last('Division name').fill(v.name);
  if (v.short) await last('Short name').fill(v.short);
  if (v.designations) await last('Designations').fill(v.designations);
  if (v.desc) await last('Description').fill(v.desc);
}

async function addSource(page: Page, url: string): Promise<void> {
  await page.locator('#sourceUrl').fill(url);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}
const removeButton = (page: Page, url: string) => page.getByRole('button', { name: `Remove ${url}`, exact: true });
const anyRemoveButton = (page: Page) => page.getByRole('button', { name: /^Remove / });
const trustBox = (page: Page) => page.getByRole('checkbox', { name: /I confirm these URLs are trustworthy/ });

function tempFile(name: string, content: string | Buffer): string {
  const path = test.info().outputPath(name);
  writeFileSync(path, content);
  return path;
}

test.describe('A3.4 Step 3 — LLM Config', () => {
  test('SA-WLLM-01 step 3 opens with the on-prem defaults', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 3);
    await test.step('Expect provider "On Prem (NeGD GPUs)", base URL https://negd-gpus.in, embedding dimensions 1024; API key, chat model and embedding model blank', async () => {
      await expect(page.locator('#provider option:checked')).toHaveText('On Prem (NeGD GPUs)');
      await expect(page.locator('#baseUrl')).toHaveValue('https://negd-gpus.in');
      await expect(page.locator('#embeddingDimensions')).toHaveValue('1024');
      for (const id of ['#llmApiKey', '#model', '#embeddingModel']) await expect(page.locator(id)).toHaveValue('');
    });
    await nothingSent(writes);
  });

  test('SA-WLLM-02 switching to Bedrock shows both keys, region ap-south-1 and Check credentials, and hides base URL and API key', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 3);
    await test.step('Choose provider Bedrock', async () => {
      await page.locator('#provider').selectOption('bedrock');
    });
    await test.step('Expect access and secret key password fields, region "ap-south-1", "Check credentials and load models"; base URL and API key hidden', async () => {
      for (const id of ['#bedrockAccessKeyId', '#bedrockSecretAccessKey']) await expect(page.locator(id)).toHaveAttribute('type', 'password');
      await expect(page.locator('#region')).toHaveValue('ap-south-1');
      await expect(checkCredentials(page)).toBeVisible();
      await expect(page.locator('#baseUrl')).toBeHidden();
      await expect(page.locator('#llmApiKey')).toBeHidden();
    });
    await nothingSent(writes);
  });

  test('SA-WLLM-03 switching back to on-prem refills an empty base URL and clears the region', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 3);
    await test.step('Clear the base URL; choose Bedrock; set region "eu-west-1"', async () => {
      await page.locator('#baseUrl').fill('');
      await page.locator('#provider').selectOption('bedrock');
      await page.locator('#region').fill('eu-west-1');
    });
    await test.step('Choose on-prem — expect base URL https://negd-gpus.in', async () => {
      await page.locator('#provider').selectOption('on_prem');
      await expect(page.locator('#baseUrl')).toHaveValue('https://negd-gpus.in');
    });
    await test.step('Choose Bedrock again — expect region "ap-south-1", not "eu-west-1" (it was cleared)', async () => {
      await page.locator('#provider').selectOption('bedrock');
      await expect(page.locator('#region')).toHaveValue('ap-south-1');
    });
    await nothingSent(writes);
  });

  test('SA-WLLM-04 Bedrock with no region is refused', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 3);
    await test.step('Choose Bedrock, clear the region; Next', async () => {
      await page.locator('#provider').selectOption('bedrock');
      await page.locator('#region').fill('');
      await nextButton(page).click();
    });
    await test.step('Expect "Required for Bedrock." and still on step 3', async () => {
      await expect(message(page, 'Required for Bedrock.')).toBeVisible();
      await onStep(page, 3);
    });
    await nothingSent(writes);
  });

  test('SA-WLLM-05 Create without an API key routes to step 3 and sends nothing', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 7);
    await test.step('Go back with the step list "Step 4: LLM Config" and clear the API key', async () => {
      await jump(page, 3);
      await page.locator('#llmApiKey').fill('');
    });
    await test.step('Return with the step list "Step 8: Review & Submit" and press Create tenant', async () => {
      await stepButton(page, 7).click();
      const reached = await page.getByRole('heading', { level: 2, name: STEPS[7], exact: true }).waitFor({ timeout: 5_000 }).then(() => true, () => false);
      if (!reached) {
        const at = await page.getByRole('heading', { level: 2 }).first().textContent();
        notMeasured(test.info(), {
          tracker: 'catalogue SA-WLLM-05',
          owner: 'QA',
          detail: `the step list validates forward jumps and stopped on "${at}", so Create cannot be pressed with the key blank (the current step is not in the draft, so a reload opens step 0)`,
        });
      }
      await page.getByRole('button', { name: 'Create tenant' }).click();
    });
    await test.step('Expect step 3 with "API key is required for On Prem."', async () => {
      await onStep(page, 3);
      await expect(message(page, 'API key is required for On Prem.')).toBeVisible();
    });
    await nothingSent(writes);
  });

  test('SA-WLLM-06 Next from step 3 with a blank API key (records behaviour)', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 3);
    const keyError = message(page, 'API key is required for On Prem.');
    await test.step(`Fill base URL, chat model "${LLM.model}", embedding model "${LLM.embeddingModel}"; leave the API key blank; Next`, async () => {
      await fillLlm(page);
      await page.locator('#llmApiKey').fill('');
      await nextButton(page).click();
    });
    await test.step('Record whether Next was blocked with "API key is required for On Prem."', async () => {
      await expect(keyError.or(page.getByRole('heading', { level: 2, name: STEPS[4], exact: true }))).toBeVisible();
      const blocked = await keyError.isVisible();
      test.info().annotations.push({
        type: 'question',
        description: `Spec states the API-key check only for Create. Next from step 3 with a blank key: ${blocked ? 'blocked with "API key is required for On Prem."' : 'advanced to step 4'}.`,
      });
    });
    await nothingSent(writes);
  });

  test('SA-WLLM-07 Bedrock passes without an API key once its keys are checked and the models picked', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await mockBedrockModels(page, BEDROCK_MODELS);
    await openWizardAt(page, env, 3);
    await test.step(`Choose Bedrock with the dummy keys; press Check credentials and load models (answered in the browser: ${BEDROCK_MODELS.chat.join(', ')} / ${BEDROCK_MODELS.embedding.join(', ')})`, async () => {
      await chooseBedrock(page);
      await checkCredentials(page).click();
    });
    await test.step('Expect the dropdowns to offer the answered models and no API key field', async () => {
      await expect(chatPicker(page).locator('option')).toContainText(BEDROCK_MODELS.chat);
      await expect(embeddingPicker(page).locator('option')).toContainText(BEDROCK_MODELS.embedding);
      await expect(page.locator('#llmApiKey')).toBeHidden();
    });
    await test.step(`Pick ${BEDROCK_MODELS.chat[0]} and ${BEDROCK_MODELS.embedding[0]}; Next — expect step 4 "File Rules"`, async () => {
      await chatPicker(page).selectOption(BEDROCK_MODELS.chat[0]!);
      await embeddingPicker(page).selectOption(BEDROCK_MODELS.embedding[0]!);
      await nextButton(page).click();
      await onStep(page, 4);
    });
    await nothingSent(writes);
  });

  test('SA-WLLM-08 an invalid base URL is rejected', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 3);
    await test.step('Fill the LLM fields validly, then base URL "not a url"; Next', async () => {
      await fillLlm(page);
      await page.locator('#baseUrl').fill('not a url');
      await nextButton(page).click();
    });
    await test.step('Expect "Enter a valid URL." and still on step 3', async () => {
      await expect(message(page, 'Enter a valid URL.')).toBeVisible();
      await onStep(page, 3);
    });
    await nothingSent(writes);
  });

  test('SA-WLLM-09 base URL accepts any parseable URL, e.g. http://10.0.0.1:8000', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 3);
    await test.step('Fill the LLM fields validly, then base URL "http://10.0.0.1:8000"; Next', async () => {
      await fillLlm(page);
      await page.locator('#baseUrl').fill('http://10.0.0.1:8000');
      await nextButton(page).click();
    });
    await test.step('Expect step 4 "File Rules" (accepted)', async () => {
      await onStep(page, 4);
      test.info().annotations.push({ type: 'question', description: 'A plain-HTTP, private-IP model endpoint (http://10.0.0.1:8000) is accepted as the base URL. Should it be? Raise with the team.' });
    });
    await nothingSent(writes);
  });

  for (const [id, field, label] of [
    ['SA-WLLM-10', '#model', 'chat model'],
    ['SA-WLLM-11', '#embeddingModel', 'embedding model'],
  ] as const) {
    test(`${id} a blank ${label} is refused`, async ({ page, env }) => {
      const writes = await blockWrites(page);
      await openWizardAt(page, env, 3);
      await test.step(`Fill the LLM fields validly, then clear the ${label}; Next`, async () => {
        await fillLlm(page);
        await page.locator(field).fill('');
        await nextButton(page).click();
      });
      await test.step('Expect "Required." and still on step 3', async () => {
        await expect(message(page, 'Required.')).toBeVisible();
        await onStep(page, 3);
      });
      await nothingSent(writes);
    });
  }

  test('SA-WLLM-12 embedding dimensions 0, 1.5, -1, abc and blank are each refused', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 3);
    await test.step('Fill the LLM fields validly', async () => fillLlm(page));
    await expectEachRejected(page, '#embeddingDimensions', ['0', '1.5', '-1', 'abc', ''], 'Enter a positive whole number.', 3, '1024');
    await nothingSent(writes);
  });

  test('SA-WLLM-13 embedding dimensions 1 and 1024 are accepted', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 3);
    await test.step('Fill the LLM fields validly, embedding dimensions "1"; Next — expect step 4', async () => {
      await fillLlm(page);
      await page.locator('#embeddingDimensions').fill('1');
      await nextButton(page).click();
      await onStep(page, 4);
    });
    await test.step('Back; embedding dimensions "1024"; Next — expect step 4', async () => {
      await back(page);
      await page.locator('#embeddingDimensions').fill('1024');
      await nextButton(page).click();
      await onStep(page, 4);
    });
    await nothingSent(writes);
  });

  test('SA-WLLM-14 on-prem shows the re-ingest warning', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 3);
    await test.step('Expect the warning that changing the embedding model or dimensions requires re-ingesting the knowledge base', async () => {
      await expect(page.getByText(/Changing the embedding model or dimensions requires re-ingesting the tenant knowledge base/)).toBeVisible();
    });
    await nothingSent(writes);
  });

  test('SA-WLLM-15 Bedrock needs both keys', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 3);
    await test.step(`Choose Bedrock, leave both keys blank; Next — expect "${KEYS_REQUIRED}" and still on step 3`, async () => {
      await page.locator('#provider').selectOption('bedrock');
      await nextButton(page).click();
      await expect(message(page, KEYS_REQUIRED).first()).toBeVisible();
      await onStep(page, 3);
    });
    await nothingSent(writes);
  });

  test('SA-WLLM-16 Bedrock does not pass until the models are loaded', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 3);
    await test.step(`Choose Bedrock with the dummy keys, no Check credentials; Next — expect "${MODELS_STALE}" and still on step 3`, async () => {
      await chooseBedrock(page);
      await nextButton(page).click();
      await expect(message(page, MODELS_STALE).first()).toBeVisible();
      await onStep(page, 3);
    });
    await nothingSent(writes);
  });

  test('SA-WLLM-17 wrong keys: Check credentials shows the credentials error, loads no model and echoes no key', async ({ page, env }) => {
    test.setTimeout(90_000); // the check itself may take its full 20 s
    const writes = await blockWrites(page);
    await test.step('Let POST /api/llm/bedrock-models reach the server: it only lists models, and AWS refuses the dummy keys', async () => {
      await page.route('**/api/llm/bedrock-models', (route) => route.continue());
    });
    await openWizardAt(page, env, 3);
    await test.step('Choose Bedrock with the dummy keys; press Check credentials and load models — expect a refusal whose body holds neither key', async () => {
      await chooseBedrock(page);
      const answered = page.waitForResponse((r) => r.url().endsWith('/api/llm/bedrock-models'), { timeout: 30_000 });
      await checkCredentials(page).click();
      const res = await answered;
      const body = await res.text();
      expect(res.status(), body).toBeGreaterThanOrEqual(400);
      for (const key of Object.values(DUMMY_BEDROCK)) expect(body, 'a key was echoed back').not.toContain(key);
    });
    await test.step(`Expect "${CREDENTIALS_ERROR}" (or "${AWS_UNREACHABLE}"), no model in either dropdown and neither key in the page text`, async () => {
      await expect(message(page, CREDENTIALS_ERROR).or(message(page, AWS_UNREACHABLE)).first()).toBeVisible();
      for (const [name, picker] of [['chat', chatPicker(page)], ['embedding', embeddingPicker(page)]] as const) {
        expect(await picker.locator('option').evaluateAll((os) => os.filter((o) => (o as HTMLOptionElement).value).length), `${name} models listed`).toBe(0);
      }
      const text = await page.locator('body').innerText();
      for (const key of Object.values(DUMMY_BEDROCK)) expect(text).not.toContain(key);
    });
    await test.step(`Next — expect "${MODELS_STALE}" and still on step 3`, async () => {
      await nextButton(page).click();
      await expect(message(page, MODELS_STALE).first()).toBeVisible();
      await onStep(page, 3);
    });
    await nothingSent(writes);
  });

  test('SA-WLLM-18 editing a key after the check marks the model list stale', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await mockBedrockModels(page, BEDROCK_MODELS);
    await openWizardAt(page, env, 3);
    await test.step('Choose Bedrock with the dummy keys; Check credentials (answered in the browser); pick a chat and an embedding model', async () => {
      await chooseBedrock(page);
      await loadModels(page);
    });
    await test.step(`Change the access key; Next — expect "${MODELS_STALE}" and still on step 3`, async () => {
      await page.locator('#bedrockAccessKeyId').fill(`${DUMMY_BEDROCK.accessKeyId}-2`);
      await nextButton(page).click();
      await expect(message(page, MODELS_STALE).first()).toBeVisible();
      await onStep(page, 3);
    });
    await nothingSent(writes);
  });

  test('SA-WLLM-19 a fresh check that lacks the picked chat model clears the pick', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const [chatA, chatB] = BEDROCK_MODELS.chat as [string, string];
    await mockBedrockModels(page, BEDROCK_MODELS, { chat: [chatA], embedding: BEDROCK_MODELS.embedding });
    await openWizardAt(page, env, 3);
    const draft = () => page.evaluate(() => Object.values(sessionStorage).join('\n'));
    await test.step(`Choose Bedrock with the dummy keys; Check credentials; pick ${chatB} and ${BEDROCK_MODELS.embedding[0]}`, async () => {
      await chooseBedrock(page);
      await loadModels(page, chatB);
    });
    await test.step(`Change the secret key; Check credentials again (answered without ${chatB}) — expect ${chatB} gone from the draft and the embedding pick kept`, async () => {
      await page.locator('#bedrockSecretAccessKey').fill(`${DUMMY_BEDROCK.secretAccessKey}-2`);
      await checkCredentials(page).click();
      await expect.poll(draft).not.toContain(chatB);
      await expect(embeddingPicker(page)).toHaveValue(BEDROCK_MODELS.embedding[0]!);
    });
    await test.step('Next — expect still on step 3 (no chat model chosen)', async () => {
      await nextButton(page).click();
      await onStep(page, 3);
    });
    await nothingSent(writes);
  });

  test('SA-WLLM-20 switching provider discards the typed secrets', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 3);
    await test.step('On-prem: API key "dummy-key"; switch to Bedrock and back — expect the API key blank', async () => {
      await page.locator('#llmApiKey').fill(LLM.apiKey);
      await page.locator('#provider').selectOption('bedrock');
      await page.locator('#provider').selectOption('on_prem');
      await expect(page.locator('#llmApiKey')).toHaveValue('');
    });
    await test.step('Bedrock: type the dummy keys; switch to on-prem and back — expect both key fields blank', async () => {
      await chooseBedrock(page);
      await page.locator('#provider').selectOption('on_prem');
      await page.locator('#provider').selectOption('bedrock');
      for (const id of ['#bedrockAccessKeyId', '#bedrockSecretAccessKey']) await expect(page.locator(id)).toHaveValue('');
    });
    await nothingSent(writes);
  });

  test('SA-WLLM-21 the create body carries the Bedrock keys beside the tenant and only the picked model ids', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await mockBedrockModels(page, BEDROCK_MODELS);
    const d = await openWizardAt(page, env, 3);
    const [chatA, chatB] = BEDROCK_MODELS.chat as [string, string];
    await test.step(`Choose Bedrock with the dummy keys; Check credentials (answered in the browser); pick ${chatB}; Next through steps 4–6 to step 7`, async () => {
      await chooseBedrock(page);
      await loadModels(page, chatB);
      await nextButton(page).click();
      await onStep(page, 4);
      await walk(page, d, 4, 7);
    });
    const body = await captureCreate(page, writes);
    await test.step(`Expect both keys beside "tenant" and no llmApiKey; tenant.assistant.llm = bedrock, ap-south-1, ${chatB}, ${BEDROCK_MODELS.embedding[0]}; neither key nor ${chatA} inside "tenant"`, async () => {
      expect(body).toMatchObject({ bedrockAccessKeyId: DUMMY_BEDROCK.accessKeyId, bedrockSecretAccessKey: DUMMY_BEDROCK.secretAccessKey });
      expect(body.llmApiKey ?? '').toBe('');
      expect(body.tenant.assistant.llm).toMatchObject({ provider: 'bedrock', region: 'ap-south-1', model: chatB, embeddingModel: BEDROCK_MODELS.embedding[0] });
      const tenant = JSON.stringify(body.tenant);
      for (const leaked of [...Object.values(DUMMY_BEDROCK), chatA]) expect(tenant).not.toContain(leaked);
    });
  });
});

const FILE_TYPES = ['PDF', 'Word (.doc)', 'Word (.docx)', 'Excel (.xls)', 'Excel (.xlsx)', 'PowerPoint (.ppt)', 'PowerPoint (.pptx)', 'Text (.txt)', 'CSV', 'PNG', 'JPEG'];
const fileType = (page: Page, label: string) => page.getByRole('checkbox', { name: label, exact: true });
const SIZE_ERROR = 'Enter a positive whole number of bytes.';

test.describe('A3.5 Step 4 — File Rules', () => {
  test('SA-WFIL-01 step 4 opens with 10 MB and only PDF ticked', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 4);
    await test.step('Expect Max upload size "10"; PDF ticked; the other ten types unticked', async () => {
      await expect(page.locator('#filesizeMb')).toHaveValue('10');
      await expect(fileType(page, 'PDF')).toBeChecked();
      for (const label of FILE_TYPES.slice(1)) await expect(fileType(page, label)).not.toBeChecked();
    });
    await nothingSent(writes);
  });

  test('SA-WFIL-02 eleven file types are offered, in order', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 4);
    await test.step(`Expect exactly 11 checkboxes: ${FILE_TYPES.join(', ')}`, async () => {
      await expect(page.getByRole('checkbox')).toHaveCount(FILE_TYPES.length);
      for (const [i, label] of FILE_TYPES.entries()) await expect(page.getByRole('checkbox').nth(i)).toHaveAccessibleName(label);
    });
    await nothingSent(writes);
  });

  test('SA-WFIL-03 at least one file type is required', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 4);
    await test.step('Untick PDF (the only ticked type); Next', async () => {
      await fileType(page, 'PDF').uncheck();
      await nextButton(page).click();
    });
    await test.step('Expect "Select at least one file extension." (or "Select at least one MIME type.") and still on step 4', async () => {
      await expect(message(page, 'Select at least one file extension.').or(message(page, 'Select at least one MIME type.')).first()).toBeVisible();
      await onStep(page, 4);
    });
    await nothingSent(writes);
  });

  test('SA-WFIL-04 a size of 0 is refused', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 4);
    await expectEachRejected(page, '#filesizeMb', ['0'], SIZE_ERROR, 4, '10');
    await nothingSent(writes);
  });

  test('SA-WFIL-05 sizes -1, blank and abc are each refused; a cleared field stays blank', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 4);
    await test.step('Clear Max upload size and leave the field — expect it to stay blank, not snap back to 1', async () => {
      await page.locator('#filesizeMb').fill('');
      await page.locator('#filesizeMb').blur();
      await expect(page.locator('#filesizeMb')).toHaveValue('');
    });
    await expectEachRejected(page, '#filesizeMb', ['-1', '', 'abc'], SIZE_ERROR, 4, '10');
    await nothingSent(writes);
  });

  test('SA-WFIL-06 sizes of 1 and 0.5 MB are accepted: there is no 1 MB floor', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 4);
    for (const size of ['1', '0.5']) {
      await test.step(`Max upload size "${size}"; Next — expect step 5; Back — expect the field to show "${size}"`, async () => {
        await page.locator('#filesizeMb').fill(size);
        await nextButton(page).click();
        await onStep(page, 5);
        await back(page);
        await expect(page.locator('#filesizeMb')).toHaveValue(size);
      });
    }
    await nothingSent(writes);
  });

  for (const [id, size] of [['SA-WFIL-07', '25'], ['SA-WFIL-08', '12.5']] as const) {
    test(`${id} a size of ${size} shows as "${size} MB" on review and round-trips as megabytes`, async ({ page, env }) => {
      const writes = await blockWrites(page);
      const d = await openWizardAt(page, env, 4);
      await test.step(`Max upload size "${size}"; Next through steps 5 and 6 to step 7`, async () => {
        await page.locator('#filesizeMb').fill(size);
        await walk(page, d, 4, 7);
      });
      await test.step(`Expect the review row "Max upload size ${size} MB"`, async () => reviewRow(page, 'Max upload size', `${size} MB`));
      await test.step(`Go back to step 4 with the step list — expect the field to show "${size}", not a byte count`, async () => {
        await jump(page, 4);
        await expect(page.locator('#filesizeMb')).toHaveValue(size);
      });
      await nothingSent(writes);
    });
  }

  test('SA-WFIL-09 ticking PNG adds both the extension and the MIME type to the draft', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 4);
    const draft = () => page.evaluate(() => Object.values(sessionStorage).join('\n'));
    await test.step('Read the sessionStorage draft — no image/png yet', async () => {
      expect(await draft()).not.toContain('image/png');
    });
    await test.step('Tick PNG — expect the draft to hold the extension "png" and the MIME type "image/png"', async () => {
      await fileType(page, 'PNG').check();
      await expect.poll(draft).toContain('"image/png"');
      expect(await draft()).toMatch(/"\.?png"/);
    });
    await nothingSent(writes);
  });

  test('SA-WFIL-10 the create body mirrors mimeTypes into questionListMimeTypes', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const d = await openWizardAt(page, env, 4);
    await test.step('Tick "Word (.docx)"; Next through steps 5 and 6 to step 7', async () => {
      await fileType(page, 'Word (.docx)').check();
      await walk(page, d, 4, 7);
    });
    const body = await captureCreate(page, writes);
    await test.step('Expect questionListMimeTypes to equal mimeTypes, which include the .docx MIME type', async () => {
      const types = body.tenant.assistant.fileSupportType;
      expect(types.mimeTypes).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(types.questionListMimeTypes).toEqual(types.mimeTypes);
    });
  });
});

test.describe('A3.6 Step 5 — Departments', () => {
  test('SA-WDIV-01 no divisions is allowed and the screen says why one is useful', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 5);
    await test.step('Expect the note that departments are not required but routing needs at least one', async () => {
      await expect(page.getByText('No divisions yet', { exact: true })).toBeVisible();
      await expect(page.getByText('Not required to create the tenant, but the routing workflow needs at least one to be useful.')).toBeVisible();
    });
    await test.step('Press Next with no rows — expect step 6', async () => {
      await nextButton(page).click();
      await onStep(page, 6);
    });
    await nothingSent(writes);
  });

  test('SA-WDIV-02 a new division row has name, short name, Active (ticked), designations and description', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 5);
    await test.step('Press + Add division', async () => addDivision(page, {}));
    await test.step('Expect Division name, Short name, Active (ticked), Designations, Description', async () => {
      for (const name of ['Division name', 'Short name', 'Designations', 'Description']) {
        await expect(page.getByRole('textbox', { name, exact: true })).toBeVisible();
      }
      await expect(page.getByRole('checkbox', { name: 'Active', exact: true })).toBeChecked();
    });
    await nothingSent(writes);
  });

  test('SA-WDIV-03 a blank row shows Required on name, short name and description', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 5);
    await test.step('Press + Add division, leave it blank; Next', async () => {
      await addDivision(page, {});
      await nextButton(page).click();
    });
    await test.step('Expect "Required." on name and description, "Required; letters, numbers, no spaces." on short name; still on step 5', async () => {
      await expect(message(page, 'Required.')).toHaveCount(2);
      await expect(message(page, 'Required; letters, numbers, no spaces.')).toBeVisible();
      await onStep(page, 5);
      const shown = await page.getByText(/^Required/).allTextContents();
      test.info().annotations.push({ type: 'question', description: `A3.6 test 1 says "Required." for the short name too. Messages shown: ${JSON.stringify(shown)}.` });
    });
    await nothingSent(writes);
  });

  test('SA-WDIV-04 short names R&D, Trade-Policy and (A)/B are accepted', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 5);
    await test.step('Add three divisions with short names "R&D", "Trade-Policy", "(A)/B" (names and descriptions filled); Next', async () => {
      for (const [i, short] of ['R&D', 'Trade-Policy', '(A)/B'].entries()) await addDivision(page, { ...DIVISION, name: `QA Division ${i + 1}`, short });
      await nextButton(page).click();
    });
    await test.step('Expect step 6 (accepted despite the message wording)', async () => onStep(page, 6));
    await nothingSent(writes);
  });

  test('SA-WDIV-05 a short name with a space is refused', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 5);
    await test.step('Add a division with short name "Trade Policy"; Next', async () => {
      await addDivision(page, { ...DIVISION, short: 'Trade Policy' });
      await nextButton(page).click();
    });
    await test.step('Expect "Required; letters, numbers, no spaces." and still on step 5', async () => {
      await expect(message(page, 'Required; letters, numbers, no spaces.')).toBeVisible();
      await onStep(page, 5);
    });
    await nothingSent(writes);
  });

  test('SA-WDIV-06 short names TP_D, TP.D and TP@D are each refused', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 5);
    await test.step('Add three divisions with short names "TP_D", "TP.D", "TP@D"; Next', async () => {
      for (const [i, short] of ['TP_D', 'TP.D', 'TP@D'].entries()) await addDivision(page, { ...DIVISION, name: `QA Division ${i + 1}`, short });
      await nextButton(page).click();
    });
    await test.step('Expect "Required; letters, numbers, no spaces." on all three rows', async () => {
      await expect(message(page, 'Required; letters, numbers, no spaces.')).toHaveCount(3);
      await onStep(page, 5);
    });
    await nothingSent(writes);
  });

  test('SA-WDIV-07 short names are unique, case-insensitive (TPD and tpd)', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 5);
    await test.step('Add two divisions with short names "TPD" and "tpd"; Next', async () => {
      await addDivision(page, { ...DIVISION, name: 'QA Division 1', short: 'TPD' });
      await addDivision(page, { ...DIVISION, name: 'QA Division 2', short: 'tpd' });
      await nextButton(page).click();
    });
    await test.step('Expect "Must be unique within this tenant." and still on step 5', async () => {
      await expect(message(page, 'Must be unique within this tenant.').first()).toBeVisible();
      await onStep(page, 5);
    });
    await nothingSent(writes);
  });

  test('SA-WDIV-08 a description of only spaces is refused', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 5);
    await test.step('Add a division "QA Division" / QAD with description "   " (three spaces); Next', async () => {
      await addDivision(page, { ...DIVISION, desc: '   ' });
      await nextButton(page).click();
    });
    await test.step('Expect "Required." and still on step 5', async () => {
      await expect(message(page, 'Required.')).toBeVisible();
      await onStep(page, 5);
    });
    await nothingSent(writes);
  });

  test('SA-WDIV-09 designations are split on commas with blanks dropped', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const d = await openWizardAt(page, env, 5);
    await test.step('Add division "QA Division" / QAD with designations "PCM, , Physics,"; Next to step 7', async () => {
      await addDivision(page, { ...DIVISION, designations: 'PCM, , Physics,' });
      await walk(page, d, 5, 7);
    });
    const body = await captureCreate(page, writes);
    await test.step('Expect designations ["PCM","Physics"] in the captured body', async () => {
      expect(body.departments[0]?.designations).toEqual(['PCM', 'Physics']);
    });
  });

  test('SA-WDIV-10 unticking Active sends the division as inactive', async ({ page, env }) => {
    const writes = await blockWrites(page);
    const d = await openWizardAt(page, env, 5);
    await test.step('Add division "QA Division" / QAD; untick Active; Next to step 7', async () => {
      await addDivision(page, DIVISION);
      await page.getByRole('checkbox', { name: 'Active', exact: true }).uncheck();
      await walk(page, d, 5, 7);
    });
    const body = await captureCreate(page, writes);
    await test.step('Expect the captured division to be inactive', async () => {
      expect(body.departments[0], JSON.stringify(body.departments)).toMatchObject({ status: 'inactive' });
    });
  });

  test('SA-WDIV-11 an empty extra row blocks Next until it is removed', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 5);
    await test.step('Add a valid division "QA Division" / QAD, then + Add division and leave it blank; Next', async () => {
      await addDivision(page, DIVISION);
      await addDivision(page, {});
      await nextButton(page).click();
    });
    await test.step('Expect "Required." errors on the blank row and still on step 5', async () => {
      await expect(message(page, 'Required.').first()).toBeVisible();
      await onStep(page, 5);
    });
    await test.step('Press Remove on the blank (second) row ("Remove Division 2"); Next — expect step 6', async () => {
      await page.getByRole('button', { name: /^Remove / }).nth(1).click();
      await nextButton(page).click();
      await onStep(page, 6);
    });
    await nothingSent(writes);
  });
});

const MODULES = [
  'Advanced Dashboard', 'AI Assistant (Generate)', 'Knowledge-base Search', 'Document Ingestion', 'Parliament Dashboard',
  'Provisional Questions', 'Admitted Questions', 'Assigned Questions', 'Received Answers', 'Completed Questions',
  'Re-Approval Requests', 'Department Dashboard', 'Department Provisional Questions', 'Department Admitted Questions',
  'Department Completed Questions', 'Department Profile', 'Users & roles', 'Divisions',
];
const yamlStatus = (page: Page) => page.getByText(/^(Selected: |Current: |No file attached\.)/);

test.describe('A3.7 Step 6 — Sources', () => {
  test('SA-WSRC-01 an HTTP source is refused', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 6);
    await test.step('Add http://example.gov.in', async () => addSource(page, 'http://example.gov.in'));
    await test.step(`Expect "${HTTPS_ONLY}" and nothing listed`, async () => {
      await expect(message(page, HTTPS_ONLY)).toBeVisible();
      await expect(anyRemoveButton(page)).toHaveCount(0);
    });
    await nothingSent(writes);
  });

  test('SA-WSRC-02 localhost, loopback, private and link-local hosts are refused', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 6);
    for (const url of [
      'https://localhost/docs', 'https://a.localhost/', 'https://[::1]/', 'https://[fc00::1]/', 'https://[fd12::1]/', 'https://127.0.0.1/',
      'https://10.1.2.3/', 'https://192.168.1.5/docs', 'https://169.254.169.254/latest/meta-data', 'https://0.0.0.0/', 'https://172.16.0.1/', 'https://172.31.255.255/',
    ]) {
      await test.step(`Add ${url} — expect "${HTTPS_ONLY}" and it is not listed`, async () => {
        await addSource(page, url);
        await expect(message(page, HTTPS_ONLY)).toBeVisible();
        await expect(anyRemoveButton(page)).toHaveCount(0);
      });
    }
    await nothingSent(writes);
  });

  test('SA-WSRC-03 172.15.0.1 and 172.32.0.1 are public and accepted', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 6);
    for (const url of ['https://172.15.0.1/', 'https://172.32.0.1/']) {
      await test.step(`Add ${url} — expect it listed`, async () => {
        await addSource(page, url);
        await expect(removeButton(page, url)).toBeVisible();
      });
    }
    await nothingSent(writes);
  });

  test('SA-WSRC-04 a URL with embedded credentials is refused', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 6);
    await test.step('Add https://user:pass@www.india.gov.in/', async () => addSource(page, 'https://user:pass@www.india.gov.in/'));
    await test.step(`Expect "${HTTPS_ONLY}" and nothing listed`, async () => {
      await expect(message(page, HTTPS_ONLY)).toBeVisible();
      await expect(anyRemoveButton(page)).toHaveCount(0);
    });
    await nothingSent(writes);
  });

  test('SA-WSRC-05 an unparseable URL is refused (message recorded)', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 6);
    await test.step('Add "not a url"', async () => addSource(page, 'not a url'));
    await test.step('Expect nothing listed; record the message shown', async () => {
      await expect(anyRemoveButton(page)).toHaveCount(0);
      const https = await message(page, HTTPS_ONLY).isVisible();
      test.info().annotations.push({ type: 'question', description: `"not a url" was refused; message shown: ${https ? `"${HTTPS_ONLY}"` : 'not the HTTPS message — see screenshot'}.` });
    });
    await nothingSent(writes);
  });

  for (const [id, variant] of [
    ['SA-WSRC-06', 'https://www.india.gov.in/docs/'],
    ['SA-WSRC-07', 'https://www.india.gov.in/docs?a=1'],
  ] as const) {
    test(`${id} ${variant} is a duplicate of https://www.india.gov.in/docs`, async ({ page, env }) => {
      const writes = await blockWrites(page);
      await openWizardAt(page, env, 6);
      await test.step(`Add https://www.india.gov.in/docs, then ${variant}`, async () => {
        await addSource(page, 'https://www.india.gov.in/docs');
        await addSource(page, variant);
      });
      await test.step('Expect "Duplicate URL." and only one entry listed', async () => {
        await expect(message(page, 'Duplicate URL.')).toBeVisible();
        await expect(anyRemoveButton(page)).toHaveCount(1);
      });
      await nothingSent(writes);
    });
  }

  test('SA-WSRC-08 twenty URLs are accepted and the 21st is refused', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 6);
    await test.step('Add https://www.india.gov.in/qa-1 … /qa-20 — expect 20 listed', async () => {
      for (let i = 1; i <= 20; i++) await addSource(page, `https://www.india.gov.in/qa-${i}`);
      await expect(anyRemoveButton(page)).toHaveCount(20);
    });
    await test.step('Tick "I confirm these URLs are trustworthy"; add https://www.india.gov.in/qa-21', async () => {
      await trustBox(page).check();
      await addSource(page, 'https://www.india.gov.in/qa-21');
    });
    await test.step('Expect "At most 20 source websites." and still 20 listed', async () => {
      await expect(message(page, 'At most 20 source websites.')).toBeVisible();
      await expect(anyRemoveButton(page)).toHaveCount(20);
    });
    await nothingSent(writes);
  });

  test('SA-WSRC-09 the trust box is required once a URL is listed', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 6);
    await test.step('Add https://www.india.gov.in, leave the trust box unticked; Next', async () => {
      await addSource(page, 'https://www.india.gov.in');
      await nextButton(page).click();
    });
    await test.step('Expect "Confirm these URLs are trustworthy before saving." and still on step 6', async () => {
      await expect(message(page, 'Confirm these URLs are trustworthy before saving.')).toBeVisible();
      await onStep(page, 6);
    });
    await nothingSent(writes);
  });

  test('SA-WSRC-10 ticking the trust box clears the block', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 6);
    await test.step('Add https://www.india.gov.in; Next — expect the trust message', async () => {
      await addSource(page, 'https://www.india.gov.in');
      await nextButton(page).click();
      await expect(message(page, 'Confirm these URLs are trustworthy before saving.')).toBeVisible();
    });
    await test.step('Tick "I confirm these URLs are trustworthy"; Next — expect step 7', async () => {
      await trustBox(page).check();
      await nextButton(page).click();
      await onStep(page, 7);
    });
    await nothingSent(writes);
  });

  test('SA-WSRC-11 Remove <url> removes the entry', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 6);
    await test.step('Add https://www.india.gov.in', async () => addSource(page, 'https://www.india.gov.in'));
    await test.step('Click "Remove https://www.india.gov.in" — expect the entry gone', async () => {
      await removeButton(page, 'https://www.india.gov.in').click();
      await expect(anyRemoveButton(page)).toHaveCount(0);
    });
    await nothingSent(writes);
  });

  test('SA-WSRC-12 the wizard offers no Sync now', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 6);
    await test.step('Add https://www.india.gov.in and tick "I confirm these URLs are trustworthy"', async () => {
      await addSource(page, 'https://www.india.gov.in');
      await trustBox(page).check();
    });
    await test.step('Expect no Sync now control', async () => {
      await expect(page.getByRole('button', { name: /sync now/i })).toHaveCount(0);
      await expect(page.getByText(/sync now/i)).toHaveCount(0);
    });
    await nothingSent(writes);
  });

  test('SA-WSRC-13 eighteen portal modules, all ticked', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 6);
    // Two columns; the docs give no order, so only the set of names is checked.
    await test.step(`Expect exactly 18 checkboxes, each ticked: ${MODULES.join(' · ')}`, async () => {
      await expect(page.getByRole('checkbox')).toHaveCount(MODULES.length);
      for (const label of MODULES) await expect(page.getByRole('checkbox', { name: label, exact: true })).toBeChecked();
    });
    await nothingSent(writes);
  });

  test('SA-WSRC-15 a non-YAML OpenAPI pick is silently dropped', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 6);
    await test.step('Pick spec.txt in the OpenAPI YAML file field', async () => {
      await page.locator('#openapiYaml').setInputFiles(tempFile('spec.txt', 'openapi: 3.0.0\n'));
    });
    await test.step('Expect the status line to stay "No file attached." with no "Selected:"', async () => {
      await expect(message(page, 'No file attached.')).toBeVisible();
      await expect(page.getByText(/^Selected: /)).toHaveCount(0);
    });
    await nothingSent(writes);
  });

  test('SA-WSRC-16 a .yaml or .yml pick is staged', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 6);
    for (const name of ['spec.yaml', 'spec.yml']) {
      await test.step(`Pick ${name} — expect "Selected: ${name}"`, async () => {
        await page.locator('#openapiYaml').setInputFiles(tempFile(name, 'openapi: 3.0.0\n'));
        await expect(message(page, `Selected: ${name}`)).toBeVisible();
      });
    }
    await nothingSent(writes);
  });

  test('SA-WSRC-17 a YAML over 5 MB (records behaviour)', async ({ page, env }) => {
    const writes = await blockWrites(page);
    await openWizardAt(page, env, 6);
    await test.step('Pick big.yaml of 5 MB + 1 byte; record the status line', async () => {
      await page.locator('#openapiYaml').setInputFiles(tempFile('big.yaml', Buffer.alloc(5 * 1024 * 1024 + 1, '#')));
      await expect(yamlStatus(page)).toBeVisible();
      test.info().annotations.push({ type: 'question', description: `Client behaviour for a YAML over 5 MB is unspecified (the API returns 400, SA-API-22). Status line after picking 5 MB + 1 byte: "${await yamlStatus(page).textContent()}".` });
    });
    await nothingSent(writes);
  });
});
