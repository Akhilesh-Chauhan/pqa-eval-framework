import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures.js';
import { notMeasured } from '../../support/annotations.js';
import { exec as X, execNotes as XN, uncheckedExec as UX } from '../labels/assistant.js';

// Navigation for the Executive AI Assistant (full-screen page, DS-EXAI). Screens are reached only by clicking design
// labels.

export const ANSWER_TIMEOUT = 120_000;
export const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A dynamic name: the design's static part, then data. */
export const starts = (label: string): RegExp => new RegExp(`^${esc(label)}`);
/** Message time as the design writes it (h:mm am/pm). */
export const TIME = /\b\d{1,2}:\d{2}\s?[ap]m\b/i;

/** Data the case needs is absent: "not measured", never a pass. */
export function precondition(ok: boolean, detail: string): asserts ok {
  if (!ok) notMeasured(test.info(), { tracker: 'design-precondition', owner: 'QA', detail });
}
/** Whether something shows up within a short wait — for preconditions only, never for the assertion itself. */
export const present = (loc: Locator, timeout = 5_000): Promise<boolean> =>
  loc.first().waitFor({ timeout }).then(() => true, () => false);

/** The design shows a tooltip on hover; accept a visible `tooltip` or the control's accessible description. */
export async function expectTooltip(page: Page, target: Locator, text: string): Promise<void> {
  await target.hover();
  await expect
    .poll(async () => (await page.getByRole('tooltip').filter({ hasText: text }).first().isVisible())
      || (await target.evaluate((el, t) => el.getAttribute('title') === t
        || (el.getAttribute('aria-describedby') ?? '').split(/\s+/).some((id) => document.getElementById(id)?.textContent?.trim() === t), text)),
    { message: `tooltip "${text}"` })
    .toBe(true);
}

export const toast = (page: Page, text: string | RegExp): Locator => page.getByRole('status').filter({ hasText: text });

export async function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}
export async function allowClipboard(page: Page): Promise<void> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(page.url()).origin });
}

export type Mode = 'generate' | 'search';

export const rail = (page: Page): Locator => page.getByRole('navigation', { name: X.chats, exact: true });
export const recentRows = (page: Page): Locator => rail(page).getByRole('list', { name: X.recents, exact: true }).getByRole('listitem');
/** The row's own button (title then date); the row's other button is Delete. */
export const rowButton = (row: Locator): Locator => row.getByRole('button').first();
export const currentRow = (page: Page): Locator => recentRows(page).filter({ has: page.locator('[aria-current="true"]') });
export const chatLog = (page: Page): Locator => page.getByRole('log', { name: X.chatLog, exact: true });
export const questionBox = (page: Page): Locator => page.getByRole('textbox', { name: X.yourQuestion, exact: true });
export const sendButton = (page: Page): Locator => page.getByRole('button', { name: X.send, exact: true });
export const stopButton = (page: Page): Locator => page.getByRole('button', { name: X.stop, exact: true });
export const clearButton = (page: Page): Locator => page.getByRole('button', { name: X.clearChat, exact: true });
export const modeRadio = (page: Page, mode: Mode): Locator =>
  page.getByRole('radiogroup', { name: X.switchGroup, exact: true }).getByRole('radio', { name: mode === 'generate' ? X.generate : X.search, exact: true });
export const attachButton = (page: Page, mode: Mode): Locator =>
  page.getByRole('button', { name: mode === 'generate' ? X.attachCompare : X.attachDoc, exact: true });
export const chip = (page: Page, file: string): Locator => page.getByRole('button', { name: `${X.remove} ${file}`, exact: true });

// shortcut: a message is a direct child of log "Chat" carrying its author line (`You` or `AI Assistant`); upgrade when
// the build gives messages a role or name.
const authored = (page: Page, who: string): Locator =>
  chatLog(page).locator(':scope > *').filter({ has: page.getByText(who, { exact: true }) });
export const messages = (page: Page): Locator => authored(page, UX.you).or(authored(page, X.aiAssistant));
export const yourMessages = (page: Page): Locator => authored(page, UX.you);
export const answers = (page: Page): Locator => authored(page, X.aiAssistant);

export async function openExecAssistant(page: Page): Promise<void> {
  await page.getByRole('link', { name: X.aiAssistant, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: X.aiAssistant, exact: true })).toBeVisible();
}

export async function newChat(page: Page): Promise<void> {
  await rail(page).getByRole('button', { name: X.newChat, exact: true }).click();
  await expect(page.getByRole('heading', { level: 2, name: X.welcome, exact: true })).toBeVisible();
}

export async function chooseMode(page: Page, mode: Mode): Promise<void> {
  await modeRadio(page, mode).check();
}

/** Clicks the attach button for the current choice and picks `file` (a path or an in-memory file). */
export async function attach(page: Page, mode: Mode, file: string | { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await attachButton(page, mode).click();
  await (await chooser).setFiles(file);
}

/** Sends `text` (and whatever is attached) and returns the new answer once it has finished. */
export async function ask(page: Page, text: string, mode?: Mode): Promise<Locator> {
  if (mode) await chooseMode(page, mode);
  const before = await answers(page).count();
  await questionBox(page).fill(text);
  await sendButton(page).click();
  await expect(answers(page)).toHaveCount(before + 1);
  await waitAnswered(page);
  return answers(page).last();
}

/** Done = no `Stop` and `Your question` usable again (it is disabled while the assistant works). */
export async function waitAnswered(page: Page): Promise<void> {
  await expect(stopButton(page)).toBeHidden({ timeout: ANSWER_TIMEOUT });
  await expect(questionBox(page)).toBeEnabled({ timeout: ANSWER_TIMEOUT });
}

/** Answer kind tags as drawn (screens) and as written in the notes (OQ-EX-03). Format is recorded, never asserted. */
export const KIND_TAGS = [UX.officialKind, XN.replyGiven, X.draftKind, X.fromDocs];

export interface Answer {
  text: string;
  links: Array<{ name: string; href: string | null }>;
  /** The kind tag shown, or '' when none of the designed tags is there. */
  kind: string;
}

export async function readAnswer(answer: Locator): Promise<Answer> {
  const text = await answer.innerText();
  const links: Answer['links'] = [];
  for (const link of await answer.getByRole('link').all()) {
    links.push({ name: ((await link.getAttribute('aria-label')) ?? (await link.innerText())).trim(), href: await link.getAttribute('href') });
  }
  return { text, links, kind: KIND_TAGS.find((t) => text.includes(t)) ?? '' };
}

/** Opens Recents rows, newest first, until `want` holds for the open chat. False when no row qualifies. */
export async function openRecent(page: Page, want: () => Promise<boolean>, max = 15): Promise<boolean> {
  const n = Math.min(await recentRows(page).count(), max);
  for (let i = 0; i < n; i++) {
    await rowButton(recentRows(page).nth(i)).click();
    await expect(recentRows(page).nth(i).locator('[aria-current="true"]')).toHaveCount(1);
    await expect(answers(page).first()).toBeVisible();
    if (await want()) return true;
  }
  return false;
}

/** Deletes one Recents row through its Delete button and the confirm dialog. */
export async function deleteChat(page: Page, row: Locator): Promise<void> {
  await row.hover();
  await row.getByRole('button', { name: starts(`${X.deleteChat}: `) }).click();
  await page.getByRole('alertdialog', { name: X.deleteTitle, exact: true }).getByRole('button', { name: X.delete, exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
}

/** Clean-up for `Auto-W` cases: deletes the open chat, if any. Never hides the case's own failure. */
export async function cleanUp(page: Page): Promise<void> {
  try {
    if (await stopButton(page).isVisible()) await stopButton(page).click();
    if (await currentRow(page).count()) await deleteChat(page, currentRow(page));
  } catch (e) {
    test.info().annotations.push({ type: 'cleanup-failed', description: `delete the QA chat by hand: ${String(e).split('\n')[0]}` });
  }
}
