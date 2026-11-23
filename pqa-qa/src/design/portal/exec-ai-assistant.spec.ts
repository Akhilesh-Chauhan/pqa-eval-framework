import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect, requireWrites } from '../fixtures.js';
import type { DesignEnv } from '../design-env.js';
import { notMeasured } from '../../support/annotations.js';
import { loadGoldenSet } from '../../support/assistant-golden.js';
import { exec as L, execNotes as N, uncheckedExec as U } from '../labels/assistant.js';
import * as nav from './assistant-nav.js';
import { esc, precondition, starts } from './assistant-nav.js';

// DS-EXAI-01…45: the Executive AI Assistant as designed. The answer FORMAT of Generate reply and Search documents is
// still under consideration: cases marked "report only" record what was shown (`format-observed`, plus the answer's
// aria snapshot) and turn a format miss into a `format-not-seen` annotation; they fail only when no answer arrives.
// Answer quality is DS-EXAI-46 onward (exec-ai-quality.spec.ts).

// QA questions for the UI cases; the answer's content is never asserted. NEVER_ASKED was never put to MeitY in
// Parliament and NOT_COVERED is outside our documents: they give the two not-found answers.
const ASK = 'What steps has the Government taken to promote digital literacy in rural areas?';
const FOLLOW_UP = 'How many people have been trained under it so far?';
const NEVER_ASKED = 'What is the minimum support price fixed for wheat for the 2026-27 marketing season?';
const NOT_COVERED = 'GST rate on cement';

const REPLY_NAME = new RegExp(`^${esc(L.replyArticle)}: (Lok Sabha|Rajya Sabha) (starred|unstarred) question \\*?\\d+, answered on .+`, 'i');
const REPLY_FILE = new RegExp(`^${esc(U.replyFile)}(LS|RS)_Q\\d+\\.doc$`);
const DRAFT_FILE = new RegExp(`^${esc(L.draftFile)}.*\\.doc$`);
const ROW_DATE = new RegExp(`(${L.today}|${L.yesterday}|\\d{1,2} [A-Z][a-z]{2})$`);
const anyChip = (page: Page): Locator => page.getByRole('button', { name: starts(`${L.remove} `) });
const deleteButton = (row: Locator): Locator => row.getByRole('button', { name: starts(`${L.deleteChat}: `) });

const needPdf = (denv: DesignEnv): string => {
  precondition(denv.questionPdf !== undefined, 'PQA_DESIGN_QUESTION_PDF not set (a small QA-made PDF; never a Monsoon 2026 answer document)');
  return denv.questionPdf;
};

/** A question MeitY answered before: the first verbatim Part 1 row of the short golden set. */
function answeredQuestion(denv: DesignEnv): string {
  precondition(denv.goldenRoot !== undefined, 'PQA_DESIGN_GOLDEN_ROOT not set (a question answered before comes from the golden set)');
  const rows = loadGoldenSet(join(denv.goldenRoot, 'assistant', 'meity-2part-short-v1')).rows as unknown as
    Array<{ user_input: string; question_origin: string; provenance: { part: string } }>;
  const row = rows.find((r) => r.provenance.part === '1-ingested' && r.question_origin === 'verbatim');
  precondition(row !== undefined, 'no verbatim Part 1 row in meity-2part-short-v1');
  return row.user_input;
}

/** A question our documents cover: the first Part 1 subject case of the search golden set. */
function coveredQuery(denv: DesignEnv): string {
  precondition(denv.goldenRoot !== undefined, 'PQA_DESIGN_GOLDEN_ROOT not set (a covered question comes from the search golden set)');
  const { cases } = JSON.parse(readFileSync(join(denv.goldenRoot, 'assistant', 'meity-search-v1', 'search_golden.json'), 'utf8')) as
    { cases: Array<{ part: string; query_type: string; query: string }> };
  const c = cases.find((x) => x.part === '1-ingested' && x.query_type === 'subject');
  precondition(c !== undefined, 'no Part 1 subject case in search_golden.json');
  return c.query;
}

const clean = (e: unknown): string =>
  String(e instanceof Error ? e.message : e).replace(/\u001b\[[0-9;]*m/g, '').replace(/\s+/g, ' ').slice(0, 300);

/** Records what an answer showed (report only): kind tag, the answer's accessible name, its aria snapshot and text. */
async function observe(answer: Locator, what: string): Promise<nav.Answer & { name: string }> {
  const a = await nav.readAnswer(answer);
  const aria = await answer.ariaSnapshot();
  const name = aria.match(/- article "((?:[^"\\]|\\.)*)"/)?.[1] ?? '';
  test.info().annotations.push({
    type: 'format-observed',
    description: `${what}: kind tag "${a.kind || 'none of the designed tags'}"; article "${name || 'none'}"; ${a.links.length} link(s)`,
  });
  await test.info().attach(`${what}.aria.yml`, { body: aria, contentType: 'text/yaml' });
  await test.info().attach(`${what}.txt`, { body: a.text, contentType: 'text/plain' });
  return { ...a, name };
}

/** A format expectation from the design: a miss becomes a `format-not-seen` annotation, never a failure. */
async function formatCheck(what: string, check: () => Promise<void>): Promise<void> {
  try {
    await check();
    test.info().annotations.push({ type: 'format-observed', description: `${what}: as designed` });
  } catch (e) {
    test.info().annotations.push({ type: 'format-not-seen', description: `${what}: ${clean(e)}` });
  }
}
const missing = (text: string, marks: Array<string | RegExp>): string[] =>
  marks.filter((m) => (typeof m === 'string' ? !text.includes(m) : !m.test(text))).map(String);
const linesShown = (text: string, marks: Array<string | RegExp>) => async (): Promise<void> => {
  expect(missing(text, marks), 'design lines not shown').toEqual([]);
};

async function expectWelcome(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 2, name: L.welcome, exact: true })).toBeVisible();
  // Ministry wording follows the tenant (OQ-EX-01): only the fixed parts are asserted.
  await expect(page.getByText(new RegExp(`^${esc(L.scopeHead)} .+ ${esc(L.scopeTail)}$`))).toBeVisible();
  await expect(nav.messages(page)).toHaveCount(0);
  await expect(nav.clearButton(page)).toBeDisabled();
}

/** Search results of an answer: result articles, or its links when results are drawn differently (format OQ-EX-04). */
async function resultCount(answer: Locator): Promise<number> {
  return Math.max(await answer.getByRole('article').count(), await answer.getByRole('link').count());
}
const searchChat = (page: Page, min: number) => async (): Promise<boolean> =>
  (await nav.modeRadio(page, 'search').isChecked()) && (await resultCount(nav.answers(page).last())) >= min;
const replyChat = (page: Page) => async (): Promise<boolean> =>
  (await nav.answers(page).last().getByRole('button', { name: L.copyAnswer, exact: true }).count()) > 0;

const words = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

test.describe('DS-EXAI — Executive AI Assistant (design)', () => {
  // Answers take up to 120 s, and Recents-driven cases open several chats.
  test.describe.configure({ timeout: 300_000 });

  test('DS-EXAI-01 Open the AI Assistant from the Executive Dashboard', async ({ as }) => {
    const page = await as('executive');
    await nav.openExecAssistant(page);
    // Full screen: the portal sidebar (and its AI Assistant link) is gone.
    await expect(page.getByRole('link', { name: L.aiAssistant, exact: true })).toHaveCount(0);
    await expect(page.getByRole('banner').first()).toBeVisible();
    await expect(page.getByRole('link', { name: L.goi, exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: L.aiAssistant, exact: true })).toBeVisible();
    await expect(nav.rail(page).getByRole('link', { name: L.backToPortal, exact: true })).toBeVisible();
    await expect(nav.rail(page).getByRole('button', { name: L.newChat, exact: true })).toBeVisible();
    await expect(nav.rail(page).getByText(L.recents, { exact: true })).toBeVisible();
    await expectWelcome(page);
    await expect(nav.questionBox(page)).toBeVisible();
  });

  test('DS-EXAI-02 Back to portal returns to the Executive Dashboard', async ({ as }) => {
    const page = await as('executive');
    await expect(page.getByRole('link', { name: L.aiAssistant, exact: true })).toBeVisible();
    const dashboard = page.url();
    await nav.openExecAssistant(page);
    await nav.rail(page).getByRole('link', { name: L.backToPortal, exact: true }).click();
    await expect(page).toHaveURL(dashboard);
    await expect(page.getByRole('link', { name: L.aiAssistant, exact: true })).toBeVisible();
    await expect(page.getByRole('dialog').or(page.getByRole('alertdialog'))).toHaveCount(0);
  });

  test('DS-EXAI-03 Welcome state', async ({ as }) => {
    const page = await as('executive');
    await nav.openExecAssistant(page);
    await expectWelcome(page);
    await nav.newChat(page);
    await expectWelcome(page);
  });

  test('DS-EXAI-04 Choice cards on a new chat (blocked by OQ-EX-02)', async ({ as }) => {
    notMeasured(test.info(), { tracker: 'design-OQ', owner: 'UI/UX', detail: 'OQ-EX-02: the FINAL boards do not draw the Welcome choice cards' });
    const page = await as('executive');
    await nav.openExecAssistant(page);
    const cards = page.getByRole('radiogroup').filter({ hasText: L.cardGenerateWhen });
    await expect(cards.getByRole('radio')).toHaveCount(2);
    await expect(cards).toContainText(L.generateAReply);
    await expect(cards).toContainText(U.cardGenerateWhat);
    await expect(cards).toContainText(L.searchOurDocs);
    await expect(cards).toContainText(L.cardSearchWhen);
    await expect(cards).toContainText(L.cardSearchWhat);
    await cards.getByRole('radio').nth(1).click();
    await expect(nav.modeRadio(page, 'search')).toBeChecked();
    await expect(nav.questionBox(page)).toBeFocused();
    await cards.getByRole('radio').nth(1).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(cards.getByRole('radio').first()).toBeFocused();
  });

  test('DS-EXAI-05 Two-way switch: options, default and tooltips', async ({ as }) => {
    const page = await as('executive');
    await nav.openExecAssistant(page);
    const gen = nav.modeRadio(page, 'generate');
    const search = nav.modeRadio(page, 'search');
    await expect(gen).toBeChecked();
    await expect(search).not.toBeChecked();
    await expect(gen).toBeVisible();
    await expect(search).toBeVisible();
    // Each tooltip is linked to its option by aria-describedby.
    await expect(gen).toHaveAccessibleDescription(U.generateTip);
    await expect(search).toHaveAccessibleDescription(L.searchTip);
    await nav.expectTooltip(page, gen, U.generateTip);
    await nav.expectTooltip(page, search, L.searchTip);
  });

  test('DS-EXAI-06 Placeholder and attach hint follow the choice', async ({ as }) => {
    const page = await as('executive');
    await nav.openExecAssistant(page);
    const box = nav.questionBox(page);
    await expect(box).toHaveAttribute('placeholder', N.generatePh);
    await nav.expectTooltip(page, nav.attachButton(page, 'generate'), L.attachCompare);
    await box.fill(ASK);
    await nav.modeRadio(page, 'search').click();
    await expect(box).toHaveAttribute('placeholder', L.searchPh);
    await nav.expectTooltip(page, nav.attachButton(page, 'search'), L.attachDoc);
    await expect(box).toHaveValue(ASK);
    await nav.modeRadio(page, 'generate').click();
    await expect(box).toHaveAttribute('placeholder', N.generatePh);
    await expect(nav.attachButton(page, 'generate')).toBeVisible();
    await expect(box).toHaveValue(ASK);
  });

  test('DS-EXAI-07 Keyboard on the switch (arrow keys, one tab stop)', async ({ as }) => {
    const page = await as('executive');
    await nav.openExecAssistant(page);
    const gen = nav.modeRadio(page, 'generate');
    const search = nav.modeRadio(page, 'search');
    await expect(gen).toHaveAttribute('tabindex', '0');
    await expect(search).toHaveAttribute('tabindex', '-1');
    await gen.focus();
    for (const [key, to, from] of [['ArrowRight', search, gen], ['ArrowLeft', gen, search], ['ArrowDown', search, gen], ['ArrowUp', gen, search]] as const) {
      await page.keyboard.press(key);
      await expect(to, `${key} checks the other option`).toBeChecked();
      await expect(to).toBeFocused();
      await expect(to).toHaveAttribute('tabindex', '0');
      await expect(from).toHaveAttribute('tabindex', '-1');
      const isSearch = to === search;
      await expect(nav.questionBox(page)).toHaveAttribute('placeholder', isSearch ? L.searchPh : N.generatePh);
      await expect(nav.attachButton(page, isSearch ? 'search' : 'generate')).toBeVisible();
    }
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(gen, 'focus returns to the checked option').toBeFocused();
  });

  test('DS-EXAI-08 Send rules and line breaks', async ({ as }) => {
    const page = await as('executive');
    await nav.openExecAssistant(page);
    const box = nav.questionBox(page);
    const send = nav.sendButton(page);
    await expect(send).toBeDisabled();
    await box.fill('   ');
    await expect(send).toBeDisabled();
    await box.fill('QA line one');
    await expect(send).toBeEnabled();
    await box.press('Shift+Enter');
    await box.pressSequentially('QA line two');
    await expect(box).toHaveValue('QA line one\nQA line two');
    await expect(nav.messages(page), 'Shift+Enter sends nothing').toHaveCount(0);
    await expect(box).toHaveAccessibleDescription(new RegExp(esc(U.keysHint)));
    await expect(box).toHaveAccessibleDescription(new RegExp(esc(L.disclaimer)));
  });

  test('DS-EXAI-09 Clear chat is unavailable on an empty chat', async ({ as }) => {
    const page = await as('executive');
    await nav.openExecAssistant(page);
    const clear = nav.clearButton(page);
    await expect(clear).toBeDisabled();
    await clear.click({ force: true });
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await clear.focus();
    await expect(clear).not.toBeFocused();
  });

  test('DS-EXAI-10 Attach a document shows a removable chip', async ({ as, denv }) => {
    const pdf = needPdf(denv);
    const page = await as('executive');
    await nav.openExecAssistant(page);
    await nav.attach(page, 'generate', pdf);
    await expect(nav.chip(page, basename(pdf))).toBeVisible();
    await expect(page.getByText(basename(pdf), { exact: true })).toBeVisible();
    await expect(nav.questionBox(page)).toBeFocused();
    await expect(nav.questionBox(page)).toHaveValue('');
    await expect(nav.sendButton(page), 'a file alone can be sent').toBeEnabled();
  });

  test('DS-EXAI-11 Remove the attached document', async ({ as, denv }) => {
    const pdf = needPdf(denv);
    const page = await as('executive');
    await nav.openExecAssistant(page);
    await nav.attach(page, 'generate', pdf);
    await nav.chip(page, basename(pdf)).click();
    await expect(nav.chip(page, basename(pdf))).toHaveCount(0);
    await expect(nav.attachButton(page, 'generate')).toBeFocused();
    await expect(nav.sendButton(page)).toBeDisabled();
  });

  test('DS-EXAI-12 Only PDF and Word files can be attached', async ({ as }) => {
    const page = await as('executive');
    await nav.openExecAssistant(page);
    const pick = page.waitForEvent('filechooser');
    await nav.attachButton(page, 'generate').click();
    const chooser = await pick;
    const accept = (await chooser.element().getAttribute('accept')) ?? '';
    expect(accept.split(',').map((s) => s.trim().toLowerCase()).sort()).toEqual(['.doc', '.docx', '.pdf']);
    // The accept filter only guides the OS dialog: hand the input other types and check none becomes a chip.
    await chooser.setFiles({ name: 'qa-sheet.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('qa') });
    await nav.attach(page, 'generate', { name: 'qa-image.png', mimeType: 'image/png', buffer: Buffer.from('qa') });
    await page.waitForTimeout(500); // absence check: give the page a moment to react to the files
    await expect(anyChip(page)).toHaveCount(0);
  });

  test('DS-EXAI-13 Ask in Generate reply: working state and Recents', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('executive');
    await nav.openExecAssistant(page);
    const rows = nav.recentRows(page);
    const before = await rows.count();
    const box = nav.questionBox(page);
    await box.fill(ASK);
    await box.press('Enter');
    try {
      const you = nav.yourMessages(page).first();
      await expect(you).toContainText(ASK);
      await expect(you.getByText(nav.TIME)).toBeVisible();
      await expect(nav.answers(page).last().getByText(N.finding, { exact: true })).toBeVisible();
      await expect(nav.stopButton(page)).toBeVisible();
      await expect(box).toBeDisabled();
      await expect(box).toHaveValue('');
      await expect(nav.sendButton(page)).toBeDisabled();
      await expect(nav.clearButton(page)).toBeDisabled();
      await expect(rows).toHaveCount(before + 1);
      await expect(rows.first()).toContainText(L.today);
      await expect(nav.rowButton(rows.first())).toHaveAttribute('aria-current', 'true');
      await nav.waitAnswered(page);
      await expect(box).toBeFocused();
      await nav.ask(page, FOLLOW_UP);
      await expect(rows, 'a follow-up adds no Recents row').toHaveCount(before + 1);
    } finally {
      await nav.cleanUp(page);
    }
  });

  test('DS-EXAI-14 Working message when a document is attached', async ({ as, denv }) => {
    requireWrites(denv);
    const pdf = needPdf(denv);
    const file = basename(pdf);
    const page = await as('executive');
    await nav.openExecAssistant(page);
    await nav.attach(page, 'generate', pdf);
    await nav.questionBox(page).fill(ASK);
    await nav.sendButton(page).click();
    try {
      const you = nav.yourMessages(page).last();
      await expect(you).toContainText(ASK);
      await expect(you).toContainText(file);
      await expect(nav.answers(page).last().getByText(`${L.comparing} ${file}…`, { exact: true })).toBeVisible();
      await expect(nav.chip(page, file), 'the chip leaves the question box').toHaveCount(0);
      await nav.waitAnswered(page);
    } finally {
      await nav.cleanUp(page);
    }
  });

  test('DS-EXAI-15 Working message in Search documents', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('executive');
    await nav.openExecAssistant(page);
    await nav.chooseMode(page, 'search');
    await nav.questionBox(page).fill(ASK);
    await nav.sendButton(page).click();
    try {
      await expect(nav.answers(page).last().getByText(L.searching, { exact: true })).toBeVisible();
      await expect(nav.stopButton(page)).toBeVisible();
      await nav.waitAnswered(page);
    } finally {
      await nav.cleanUp(page);
    }
  });

  test('DS-EXAI-16 Stop while it works', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('executive');
    await nav.openExecAssistant(page);
    await nav.questionBox(page).fill(ASK);
    await nav.sendButton(page).click();
    try {
      await nav.stopButton(page).click();
      const stopped = nav.answers(page).last();
      await expect(stopped.getByText(L.stopped, { exact: true })).toBeVisible();
      await expect(nav.stopButton(page)).toBeHidden();
      await expect(nav.questionBox(page)).toBeEnabled();
      await expect(nav.questionBox(page)).toBeFocused();
      await expect(stopped.getByRole('button', { name: L.copyAnswer, exact: true })).toHaveCount(0);
      await expect(stopped.getByRole('button', { name: L.download, exact: true })).toHaveCount(0);
      await expect(nav.clearButton(page)).toBeEnabled();
    } finally {
      await nav.cleanUp(page);
    }
  });

  test('DS-EXAI-17 Generate reply: the reply given in Parliament, in the official format (format under consideration — report only)', async ({ as, denv }) => {
    requireWrites(denv);
    const question = answeredQuestion(denv);
    const page = await as('executive');
    await nav.openExecAssistant(page);
    try {
      const a = await observe(await nav.ask(page, question, 'generate'), 'DS-EXAI-17');
      await formatCheck('kind tag', async () => expect(a.kind).toBe(U.officialKind));
      await formatCheck('answer name', async () => expect(a.name).toMatch(REPLY_NAME));
      await formatCheck('reply layout', linesShown(a.text, [L.goiCaps, U.ministryCaps, /(LOK|RAJYA) SABHA/, /(STARRED|UNSTARRED) QUESTION NO\. \*?\d+/,
        /TO BE ANSWERED ON: \d{2}\.\d{2}\.\d{4}/, /^\*?\d+\. .+:$/m, L.willMinister, U.answerHead, U.stars]));
    } finally {
      await nav.cleanUp(page);
    }
  });

  test('DS-EXAI-18 Reply that lays a statement on the Table (format under consideration — report only)', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('executive');
    await nav.openExecAssistant(page);
    // No golden row is known to lay a statement on the Table: use one already asked, from Recents.
    const statement = new RegExp(`${esc(L.statementHead)}|${esc(L.statementLaid)}`, 'i');
    precondition(await nav.openRecent(page, async () => statement.test(await nav.chatLog(page).innerText())),
      'no question known whose earlier reply lays a statement on the Table (none in the golden sets, none in Recents)');
    const a = await observe(nav.answers(page).filter({ hasText: statement }).last(), 'DS-EXAI-18');
    await formatCheck('statement heading', linesShown(a.text, [
      new RegExp(`${esc(L.statementHead)} (LOK|RAJYA) SABHA (STARRED|UNSTARRED) QUESTION NO\\. \\*?\\d+ FOR .+ REGARDING “.+”`)]));
    await formatCheck('stars before the statement and at the end', linesShown(a.text, [
      new RegExp(`${esc(U.stars)}\\s+${esc(L.statementHead)}`), new RegExp(`${esc(U.stars)}\\s*$`)]));
  });

  test('DS-EXAI-19 Generate reply with a document: new draft (format under consideration — report only)', async ({ as, denv }) => {
    requireWrites(denv);
    const pdf = needPdf(denv);
    const question = answeredQuestion(denv);
    const page = await as('executive');
    await nav.openExecAssistant(page);
    await nav.attach(page, 'generate', pdf);
    try {
      const a = await observe(await nav.ask(page, question), 'DS-EXAI-19');
      await formatCheck('kind tag', async () => expect(a.text).toContain(`${L.draftKind} ${basename(pdf)}`));
      await formatCheck('what changed note', async () => expect(a.text).toContain(L.fillIn));
      await formatCheck('answer name', async () => expect(a.name).toBe(L.draftArticle));
      await formatCheck('draft blanks', linesShown(a.text, [L.houseBlank, U.blankQuestionNo, U.blankDate, U.blankMember, U.blankMinister]));
    } finally {
      await nav.cleanUp(page);
    }
  });

  test('DS-EXAI-20 Search documents: answer from our documents (format under consideration — report only)', async ({ as, denv }) => {
    requireWrites(denv);
    const query = coveredQuery(denv);
    const page = await as('executive');
    await nav.openExecAssistant(page);
    try {
      const answer = await nav.ask(page, query, 'search');
      const a = await observe(answer, 'DS-EXAI-20');
      await formatCheck('kind tag', async () => expect(a.kind).toBe(L.fromDocs));
      await formatCheck('count line', linesShown(a.text, [new RegExp(`^(\\d+ ${esc(L.docsMatch)}|1 ${esc(L.docMatches)})$`, 'm')]));
      await formatCheck('result layout', async () => {
        const results = await answer.getByRole('article').all();
        expect(results.length, 'result articles').toBeGreaterThan(0);
        for (const r of results) {
          await expect(r.getByRole('heading', { level: 3 })).toHaveCount(1, { timeout: 1_000 });
          expect(missing(await r.innerText(), [new RegExp(`\\d{1,3}${esc(U.match)}`), new RegExp(`(${esc(U.starredQ)} \\*\\d+|${esc(U.unstarredQ)} \\d+)`),
            /Lok Sabha|Rajya Sabha/, L.aiSummary]), 'result lines not shown').toEqual([]);
          await expect(r.getByRole('button', { name: U.showQA, exact: true })).toHaveCount(1, { timeout: 1_000 });
          await expect(r.getByRole('link', { name: starts(L.viewDoc) })).toHaveCount(1, { timeout: 1_000 });
        }
      });
      await formatCheck('no Copy or Download on search answers (OQ-EX-04)', async () => {
        expect(await answer.getByRole('button', { name: L.copyAnswer, exact: true }).count()).toBe(0);
        expect(await answer.getByRole('button', { name: L.download, exact: true }).count()).toBe(0);
      });
    } finally {
      await nav.cleanUp(page);
    }
  });

  test('DS-EXAI-21 Sort the search results (format under consideration — report only)', async ({ as }) => {
    const page = await as('executive');
    await nav.openExecAssistant(page);
    precondition(await nav.openRecent(page, searchChat(page, 2)), 'no Search chat with 2+ results in Recents');
    const answer = nav.answers(page).last();
    await observe(answer, 'DS-EXAI-21');
    const sort = answer.getByRole('button', { name: starts(`${L.sortBy}: `) });
    const list = page.getByRole('listbox', { name: L.sortBy, exact: true });
    const option = (name: string): Locator => list.getByRole('option', { name, exact: true });
    await formatCheck('sort by mouse', async () => {
      await expect(sort).toHaveAccessibleName(`${L.sortBy}: ${L.mostRelevant}`, { timeout: 2_000 });
      const order = async (): Promise<string> => (await answer.getByRole('article').allInnerTexts()).join('\n');
      const relevant = await order();
      await sort.click();
      await expect(list.getByRole('option')).toHaveText([L.mostRelevant, L.newest, L.oldest]);
      await option(L.newest).click();
      await expect(sort).toHaveAccessibleName(`${L.sortBy}: ${L.newest}`);
      test.info().annotations.push({ type: 'format-observed', description: `Newest first ${(await order()) === relevant ? 'kept' : 'changed'} the order` });
      await sort.click();
      await option(L.oldest).click();
      await expect(sort).toHaveAccessibleName(`${L.sortBy}: ${L.oldest}`);
    });
    await formatCheck('sort by keyboard', async () => {
      await sort.focus();
      await page.keyboard.press('ArrowDown');
      await expect(option(L.oldest), 'Down opens on the current option').toBeFocused({ timeout: 2_000 });
      await page.keyboard.press('Home');
      await expect(option(L.mostRelevant)).toBeFocused();
      await page.keyboard.press('End');
      await expect(option(L.oldest)).toBeFocused();
      await page.keyboard.press('n');
      await expect(option(L.newest), 'a letter jumps').toBeFocused();
      await page.keyboard.press('Escape');
      await expect(list).toBeHidden();
      await expect(sort).toBeFocused();
    });
  });

  test('DS-EXAI-22 Show and hide the question and answer of a result (format under consideration — report only)', async ({ as }) => {
    const page = await as('executive');
    await nav.openExecAssistant(page);
    precondition(await nav.openRecent(page, searchChat(page, 1)), 'no Search chat with results in Recents');
    const answer = nav.answers(page).last();
    await observe(answer, 'DS-EXAI-22');
    await formatCheck('show and hide question and answer', async () => {
      const show = answer.getByRole('button', { name: U.showQA, exact: true }).first();
      await expect(show).toHaveAttribute('aria-expanded', 'false', { timeout: 2_000 });
      await show.click();
      const hide = answer.getByRole('button', { name: U.hideQA, exact: true }).first();
      await expect(hide).toHaveAttribute('aria-expanded', 'true');
      expect(missing(await answer.innerText(), [L.qaQuestion, L.willMinister, L.qaAnswer]), 'question and answer lines').toEqual([]);
      await hide.click();
      await expect(answer.getByRole('button', { name: U.showQA, exact: true }).first()).toHaveAttribute('aria-expanded', 'false');
    });
  });

  test('DS-EXAI-23 View document opens the source PDF at the page', async ({ as }) => {
    const page = await as('executive');
    await nav.openExecAssistant(page);
    precondition(await nav.openRecent(page, searchChat(page, 1)), 'no Search chat with results in Recents');
    const answer = nav.answers(page).last();
    const before = await nav.chatLog(page).innerText();
    const { links } = await nav.readAnswer(answer);
    test.info().annotations.push({ type: 'format-observed', description: `document link names: ${links.map((l) => l.name).join(' | ')}` });
    const all = await answer.getByRole('link').all();
    for (const [i, link] of all.slice(0, 10).entries()) {
      const popup = page.waitForEvent('popup');
      await link.click();
      const tab = await popup;
      await tab.waitForURL((u) => u.href !== 'about:blank');
      const pageNo = links[i]!.name.match(/page (\d+)/)?.[1];
      if (pageNo) expect(tab.url(), `${links[i]!.name} opens at the cited page`).toMatch(new RegExp(`[#?&]page=${pageNo}\\b`));
      await tab.close();
    }
    expect(await nav.chatLog(page).innerText(), 'the chat stays as it was').toBe(before);
  });

  test('DS-EXAI-24 Not found in Generate reply: ask the other way', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('executive');
    await nav.openExecAssistant(page);
    try {
      const answer = await nav.ask(page, NEVER_ASKED, 'generate');
      await expect(answer.getByText(L.notFoundReply, { exact: true })).toBeVisible();
      await expect(answer.getByText(L.notFoundReplyHint, { exact: true })).toBeVisible();
      await expect(answer.getByRole('button', { name: L.copyAnswer, exact: true })).toHaveCount(0);
      await expect(answer.getByRole('button', { name: L.download, exact: true })).toHaveCount(0);
      const asked = await nav.yourMessages(page).count();
      await answer.getByRole('button', { name: L.searchOurDocs, exact: true }).click();
      await expect(nav.modeRadio(page, 'search')).toBeChecked();
      await expect(nav.yourMessages(page)).toHaveCount(asked + 1);
      await expect(nav.yourMessages(page).last()).toContainText(NEVER_ASKED);
      await expect(nav.answers(page).last().getByText(L.searching, { exact: true })).toBeVisible();
      await nav.waitAnswered(page);
    } finally {
      await nav.cleanUp(page);
    }
  });

  test('DS-EXAI-25 Not found in Search documents: generate a reply instead', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('executive');
    await nav.openExecAssistant(page);
    try {
      const answer = await nav.ask(page, NOT_COVERED, 'search');
      await expect(answer.getByText(L.notFoundDocs, { exact: true })).toBeVisible();
      await expect(answer.getByText(L.notFoundDocsHint, { exact: true })).toBeVisible();
      const asked = await nav.yourMessages(page).count();
      await answer.getByRole('button', { name: L.generateAReply, exact: true }).click();
      await expect(nav.modeRadio(page, 'generate')).toBeChecked();
      await expect(nav.yourMessages(page)).toHaveCount(asked + 1);
      await expect(nav.yourMessages(page).last()).toContainText(NOT_COVERED);
      await expect(nav.answers(page).last().getByText(N.finding, { exact: true })).toBeVisible();
      await nav.waitAnswered(page);
    } finally {
      await nav.cleanUp(page);
    }
  });

  test('DS-EXAI-26 Asking the other way does not carry the attachment', async ({ as, denv }) => {
    requireWrites(denv);
    const pdf = needPdf(denv);
    const file = basename(pdf);
    const page = await as('executive');
    await nav.openExecAssistant(page);
    await nav.attach(page, 'generate', pdf);
    try {
      const answer = await nav.ask(page, NEVER_ASKED);
      const other = answer.getByRole('button', { name: L.searchOurDocs, exact: true });
      precondition(await nav.present(other), 'Generate reply with the file attached did not give the not-found answer');
      await other.click();
      await expect(nav.yourMessages(page).last()).toContainText(NEVER_ASKED);
      await expect(nav.yourMessages(page).last(), 'the re-sent question has no file').not.toContainText(file);
      await expect(nav.chip(page, file)).toHaveCount(0);
      await nav.waitAnswered(page);
    } finally {
      await nav.cleanUp(page);
    }
  });

  test('DS-EXAI-27 Copy answer', async ({ as }) => {
    const page = await as('executive');
    await nav.openExecAssistant(page);
    precondition(await nav.openRecent(page, replyChat(page)), 'no Generate reply answer with Copy in Recents');
    await nav.allowClipboard(page);
    const answer = nav.answers(page).last();
    const copy = answer.getByRole('button', { name: L.copyAnswer, exact: true });
    await nav.expectTooltip(page, copy, L.copy);
    await copy.click();
    await expect(nav.toast(page, L.copied)).toBeVisible();
    const clip = await nav.readClipboard(page);
    const body = (await answer.getByRole('article').count()) ? answer.getByRole('article').first() : answer;
    const have = new Set(words(clip));
    const shown = words(await body.innerText());
    expect(shown.filter((w) => have.has(w)).length / shown.length, 'share of the answer text in the clipboard').toBeGreaterThan(0.9);
    for (const ui of [L.copyAnswer, L.download, L.thisAnswer]) expect(clip, 'no UI labels in the clipboard').not.toContain(ui);
    test.info().annotations.push({ type: 'format-observed', description: `clipboard keeps ${clip.split('\n').length} lines` });
    await test.info().attach('DS-EXAI-27.clipboard.txt', { body: clip, contentType: 'text/plain' });
  });

  test('DS-EXAI-28 Download as Word', async ({ as }) => {
    const page = await as('executive');
    await nav.openExecAssistant(page);
    const found = { reply: '', draft: '' };
    let tipChecked = false;
    const rows = nav.recentRows(page);
    const n = Math.min(await rows.count(), 15);
    for (let i = 0; i < n && !(found.reply && found.draft); i++) {
      await nav.rowButton(rows.nth(i)).click();
      await expect(nav.rowButton(rows.nth(i))).toHaveAttribute('aria-current', 'true');
      for (const button of await nav.chatLog(page).getByRole('button', { name: L.download, exact: true }).all()) {
        if (!tipChecked) await nav.expectTooltip(page, button, N.downloadTip);
        tipChecked = true;
        const dl = page.waitForEvent('download');
        await button.click();
        const name = (await dl).suggestedFilename();
        await expect(nav.toast(page, `${name} ${L.downloaded}`)).toBeVisible();
        const kind = REPLY_FILE.test(name) ? 'reply' : DRAFT_FILE.test(name) ? 'draft' : '';
        expect(kind, `downloaded file name ${name}`).not.toBe('');
        found[kind as 'reply' | 'draft'] ||= name;
        if (found.reply && found.draft) break;
      }
    }
    precondition(found.reply !== '', 'no Generate reply answer with Download in Recents');
    precondition(found.draft !== '', 'no draft answer (Generate reply with a document) in Recents');
  });

  test('DS-EXAI-30 New chat', async ({ as, denv }) => {
    const pdf = needPdf(denv);
    const page = await as('executive');
    await nav.openExecAssistant(page);
    precondition(await nav.openRecent(page, async () => true), 'no chat with answers in Recents');
    const mode: nav.Mode = (await nav.modeRadio(page, 'search').isChecked()) ? 'search' : 'generate';
    const rows = await nav.recentRows(page).count();
    await nav.attach(page, mode, pdf);
    await nav.questionBox(page).fill(ASK);
    await nav.rail(page).getByRole('button', { name: L.newChat, exact: true }).click();
    await expectWelcome(page);
    await expect(nav.questionBox(page)).toHaveValue('');
    await expect(anyChip(page)).toHaveCount(0);
    await expect(nav.questionBox(page)).toBeFocused();
    await expect(nav.modeRadio(page, mode), 'the switch keeps its choice').toBeChecked();
    await expect(nav.recentRows(page)).toHaveCount(rows);
    await expect(nav.currentRow(page)).toHaveCount(0);
  });

  test('DS-EXAI-31 Recents: titles, dates and the open chat', async ({ as }) => {
    const page = await as('executive');
    await nav.openExecAssistant(page);
    await expect(nav.rail(page).getByText(L.recents, { exact: true })).toBeVisible();
    const rows = nav.recentRows(page);
    precondition((await rows.count()) > 0, 'no chats in Recents');
    const now = new Date();
    const ago = (date: string): number => {
      if (date === L.today) return 0;
      if (date === L.yesterday) return 1;
      const d = new Date(`${date} ${now.getFullYear()}`);
      if (d > now) d.setFullYear(d.getFullYear() - 1);
      return Math.round((now.getTime() - d.getTime()) / 864e5);
    };
    const dates: number[] = [];
    for (const row of await rows.all()) {
      const text = ((await nav.rowButton(row).textContent()) ?? '').trim();
      const date = text.match(ROW_DATE)?.[1];
      expect(date, `date on "${text}"`).toBeTruthy();
      dates.push(ago(date!));
    }
    expect(dates, 'newest first').toEqual([...dates].sort((a, b) => a - b));
    await expect(rows.filter({ hasText: L.pleased }), 'official-form questions are titled by part (a)').toHaveCount(0);
    await nav.rowButton(rows.first()).click();
    await expect(nav.rowButton(rows.first())).toHaveAttribute('aria-current', 'true');
    await expect(nav.currentRow(page)).toHaveCount(1);
  });

  test('DS-EXAI-32 Open a recent chat', async ({ as }) => {
    const page = await as('executive');
    await nav.openExecAssistant(page);
    const rows = nav.recentRows(page);
    let search = -1;
    let other = -1;
    const n = Math.min(await rows.count(), 15);
    for (let i = 0; i < n && (search < 0 || other < 0); i++) {
      await nav.rowButton(rows.nth(i)).click();
      await expect(nav.rowButton(rows.nth(i))).toHaveAttribute('aria-current', 'true');
      if (await nav.modeRadio(page, 'search').isChecked()) search = search < 0 ? i : search;
      else other = other < 0 ? i : other;
    }
    precondition(search >= 0 && other >= 0, 'needs a Search chat and a Generate reply chat in Recents');
    await nav.rowButton(rows.nth(other)).click();
    await expect(nav.modeRadio(page, 'generate')).toBeChecked();
    await nav.rowButton(rows.nth(search)).click();
    await expect(nav.answers(page).first()).toBeVisible();
    await expect(nav.modeRadio(page, 'search')).toBeChecked();
    await expect(nav.questionBox(page)).toHaveValue('');
    await expect(anyChip(page)).toHaveCount(0);
    await expect(nav.questionBox(page)).toBeFocused();
    await expect(nav.rowButton(rows.nth(search))).toHaveAttribute('aria-current', 'true');
    const log = await nav.chatLog(page).innerText();
    await nav.rail(page).getByRole('button', { name: L.newChat, exact: true }).focus();
    await nav.rowButton(rows.nth(search)).click();
    await expect(nav.questionBox(page)).toBeFocused();
    expect(await nav.chatLog(page).innerText(), 'clicking the open chat only focuses the box').toBe(log);
  });

  test('DS-EXAI-33 Leaving a chat while it works', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('executive');
    await nav.openExecAssistant(page);
    let first = '';
    try {
      await nav.ask(page, ASK, 'generate');
      first = ((await nav.rowButton(nav.currentRow(page)).textContent()) ?? '').trim();
      await nav.newChat(page);
      await nav.questionBox(page).fill(FOLLOW_UP);
      await nav.sendButton(page).click();
      await expect(nav.stopButton(page)).toBeVisible();
      await nav.rowButton(nav.recentRows(page).filter({ hasText: first }).first()).click();
      await expect(nav.answers(page).first()).toBeVisible();
      await nav.rowButton(nav.recentRows(page).first()).click();
      await expect(nav.answers(page).last().getByText(L.stopped, { exact: true })).toBeVisible();
    } finally {
      await nav.cleanUp(page);
      const row = nav.recentRows(page).filter({ hasText: first }).first();
      if (first && (await row.count())) {
        await nav.rowButton(row).click();
        await nav.cleanUp(page);
      }
    }
  });

  test('DS-EXAI-34 Delete appears on hover or focus', async ({ as }) => {
    const page = await as('executive');
    await nav.openExecAssistant(page);
    const row = nav.recentRows(page).first();
    precondition(await nav.present(row), 'no chats in Recents');
    await row.hover();
    await expect(deleteButton(row)).toBeVisible();
    await expect(row.getByText(ROW_DATE), 'the date gives way to Delete').toBeHidden();
    await nav.expectTooltip(page, deleteButton(row), L.deleteChat);
    await page.mouse.move(0, 0);
    await nav.rowButton(row).focus();
    await expect(deleteButton(row), 'Delete shows on keyboard focus').toBeVisible();
    // Touch screens: no hover, coarse pointer. Delete shows all the time.
    await nav.questionBox(page).focus();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'hover', value: 'none' }, { name: 'pointer', value: 'coarse' }] });
    await expect(deleteButton(row), 'Delete shows all the time on touch').toBeVisible();
  });

  test('DS-EXAI-35 Delete a chat (asks first)', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('executive');
    await nav.openExecAssistant(page);
    const before = await nav.recentRows(page).count();
    try {
      await nav.ask(page, ASK, 'generate');
      const row = nav.currentRow(page);
      await row.hover();
      await deleteButton(row).click();
      const dialog = page.getByRole('alertdialog', { name: L.deleteTitle, exact: true });
      await expect(dialog).toContainText(new RegExp(`“.+” ${esc(U.deleteBody)}`));
      for (const b of [L.close, L.cancel, L.delete]) await expect(dialog.getByRole('button', { name: b, exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: L.cancel, exact: true })).toBeFocused();
      await dialog.getByRole('button', { name: L.delete, exact: true }).click();
      await expect(nav.recentRows(page)).toHaveCount(before);
      await expect(nav.toast(page, U.chatDeleted)).toBeVisible();
      await expect(nav.rail(page).getByRole('button', { name: L.newChat, exact: true })).toBeFocused();
      await expectWelcome(page);
    } finally {
      await nav.cleanUp(page);
    }
  });

  test('DS-EXAI-36 Delete: Cancel and Esc return focus', async ({ as }) => {
    const page = await as('executive');
    await nav.openExecAssistant(page);
    const rows = nav.recentRows(page);
    precondition(await nav.present(rows), 'no chats in Recents');
    const count = await rows.count();
    const dialog = page.getByRole('alertdialog', { name: L.deleteTitle, exact: true });
    for (const close of ['Escape', L.cancel, L.close]) {
      await rows.first().hover();
      await deleteButton(rows.first()).click();
      await expect(dialog).toBeVisible();
      if (close === 'Escape') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', { name: close, exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(deleteButton(rows.first()), `focus back after ${close}`).toBeFocused();
      await expect(rows).toHaveCount(count);
    }
  });

  test('DS-EXAI-37 Clear chat asks first: text and focus', async ({ as }) => {
    const page = await as('executive');
    await nav.openExecAssistant(page);
    precondition(await nav.openRecent(page, async () => true), 'no chat with answers in Recents');
    const log = await nav.chatLog(page).innerText();
    const clear = nav.clearButton(page);
    await nav.expectTooltip(page, clear, L.clearChat);
    const dialog = page.getByRole('alertdialog', { name: L.clearTitle, exact: true });
    for (const close of ['Escape', L.cancel, L.close]) {
      await clear.click();
      await expect(dialog).toHaveAttribute('aria-modal', 'true');
      await expect(dialog).toHaveAccessibleDescription(L.clearBody);
      for (const b of [L.close, L.cancel, L.clearChat]) await expect(dialog.getByRole('button', { name: b, exact: true })).toBeVisible();
      await expect(dialog.getByRole('button', { name: L.cancel, exact: true })).toBeFocused();
      for (const key of ['Tab', 'Tab', 'Tab', 'Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab', 'Shift+Tab']) {
        await page.keyboard.press(key);
        expect(await dialog.evaluate((d) => d.contains(document.activeElement)), `${key} keeps focus in the dialog`).toBe(true);
      }
      if (close === 'Escape') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', { name: close, exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(clear, `focus back after ${close}`).toBeFocused();
      expect(await nav.chatLog(page).innerText(), 'the chat is unchanged').toBe(log);
    }
  });

  test('DS-EXAI-38 Clear chat removes the chat', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('executive');
    await nav.openExecAssistant(page);
    const before = await nav.recentRows(page).count();
    try {
      await nav.ask(page, ASK, 'generate');
      await nav.clearButton(page).click();
      await page.getByRole('alertdialog', { name: L.clearTitle, exact: true }).getByRole('button', { name: L.clearChat, exact: true }).click();
      await expectWelcome(page);
      await expect(nav.recentRows(page), 'the row leaves Recents').toHaveCount(before);
      await expect(nav.toast(page, U.chatCleared)).toBeVisible();
      await expect(nav.questionBox(page)).toBeFocused();
    } finally {
      await nav.cleanUp(page);
    }
  });

  test('DS-EXAI-40 Every icon button has a name and a tooltip', async ({ as, denv }) => {
    const pdf = needPdf(denv);
    const page = await as('executive');
    await nav.openExecAssistant(page);
    precondition(await nav.openRecent(page, replyChat(page)), 'no Generate reply answer with Copy in Recents');
    await nav.allowClipboard(page);
    await nav.attach(page, 'generate', pdf);
    const answer = nav.answers(page).last();
    const pairs: Array<[Locator, string]> = [
      [nav.clearButton(page), L.clearChat],
      [nav.attachButton(page, 'generate'), L.attachCompare],
      [nav.sendButton(page), L.send],
      [answer.getByRole('button', { name: L.copyAnswer, exact: true }), L.copy],
      [answer.getByRole('button', { name: L.download, exact: true }), N.downloadTip],
    ];
    for (const [button, tip] of pairs) await nav.expectTooltip(page, button, tip);
    await nav.currentRow(page).hover();
    await nav.expectTooltip(page, deleteButton(nav.currentRow(page)), L.deleteChat);
    // Named, without a tooltip.
    await expect(nav.chip(page, basename(pdf))).toBeVisible();
    await nav.clearButton(page).click();
    const dialog = page.getByRole('alertdialog', { name: L.clearTitle, exact: true });
    await expect(dialog.getByRole('button', { name: L.close, exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await answer.getByRole('button', { name: L.copyAnswer, exact: true }).click();
    await expect(nav.toast(page, L.copied).getByRole('button', { name: L.dismiss, exact: true })).toBeVisible();
  });

  test('DS-EXAI-41 Disclaimer and footer lines', async ({ as }) => {
    const page = await as('executive');
    await nav.openExecAssistant(page);
    await expect(page.getByText(L.disclaimer)).toBeVisible();
    await expect(page.getByText(N.poweredBy)).toBeVisible();
    await expect(page.getByRole('img', { name: U.negd, exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: L.meity, exact: true })).toBeVisible();
    await expect(page.getByText(new RegExp(`v\\d+\\.\\d+\\.\\d+ · ${esc(L.lastUpdated)} \\d{2}/\\d{2}/\\d{4}`))).toBeVisible();
  });

  test('DS-EXAI-43 Government of India bar: skip link and text size', async ({ as }) => {
    const page = await as('executive');
    await nav.openExecAssistant(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: L.skip, exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('main')), { message: 'focus in the main chat area' }).toBe(true);
    const size = (): Promise<number> => nav.questionBox(page).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const sizes = page.getByRole('group', { name: L.textSize, exact: true });
    const base = await size();
    await sizes.getByRole('button', { name: L.textUp, exact: true }).click();
    await sizes.getByRole('button', { name: L.textUp, exact: true }).click();
    await expect.poll(size).toBeGreaterThan(base);
    const up = await size();
    expect(up, 'at most 120%').toBeLessThanOrEqual(base * 1.2 + 0.5);
    await sizes.getByRole('button', { name: L.textDown, exact: true }).click();
    await expect.poll(size).toBeLessThan(up);
    await sizes.getByRole('button', { name: L.textReset, exact: true }).click();
    await expect.poll(size).toBe(base);
    await expect(page.getByRole('link', { name: L.goi, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: L.a11y, exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: L.language, exact: true })).toBeVisible();
  });

  test('DS-EXAI-44 Answer fidelity: earlier reply and new draft (moved to DS-EXAI-46 and DS-EXAI-52)', async ({ denv }) => {
    requireWrites(denv);
    test.skip(true, 'Not run on its own: covered by DS-EXAI-46 (and DS-EXAI-48) and DS-EXAI-52');
  });

  test('DS-EXAI-45 Rough wording and grounding in our documents (moved to DS-EXAI-47, DS-EXAI-50, DS-EXAI-51)', async ({ denv }) => {
    requireWrites(denv);
    test.skip(true, 'Not run on its own: covered by DS-EXAI-47, DS-EXAI-50 and DS-EXAI-51');
  });
});
