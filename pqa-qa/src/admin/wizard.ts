import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';
import type { Division } from './tenant-profile.js';

export interface WizardData {
  ministry: string;
  slug?: string;
  adminName: string;
  adminEmail: string;
  llm: { apiKey: string; baseUrl: string; model: string; embeddingModel: string };
  /** Logo field label → path or URL (see tenant-profile.ts). */
  logos?: Record<string, string>;
  divisions?: Division[];
}

export const nextButton = (page: Page) => page.getByRole('button', { name: 'Next', exact: true });

/** Walks steps 0–6 with valid values and stops on step 7 (Review & Submit), nothing submitted. */
export async function fillWizardToReview(page: Page, d: WizardData): Promise<void> {
  await test.step(`Open /tenants/new; step 0: ministry "${d.ministry}", slug ${d.slug ?? '(suggested)'}, admin ${d.adminName} <${d.adminEmail}>; Next`, async () => {
    await page.goto('/tenants/new');
    await page.locator('#ministryId').selectOption({ label: d.ministry });
    if (d.slug) await page.locator('#slug').fill(d.slug);
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
    await expect(page.getByRole('button', { name: '+ Add division' })).toBeVisible();
    for (const [i, v] of divisions.entries()) {
      await page.getByRole('button', { name: '+ Add division' }).click();
      await page.getByRole('textbox', { name: 'Division name' }).nth(i).fill(v.name);
      await page.getByRole('textbox', { name: 'Short name' }).nth(i).fill(v.short);
      await page.getByRole('textbox', { name: 'What this division handles' }).nth(i).fill(v.handles);
    }
    await nextButton(page).click();
  });
  await test.step('Step 6 Sources & modules: no sources, all modules on; Next', async () => {
    await expect(page.locator('#sourceUrl')).toBeVisible();
    await nextButton(page).click();
  });
  await expect(page.locator('#finalStatus')).toBeVisible();
}
