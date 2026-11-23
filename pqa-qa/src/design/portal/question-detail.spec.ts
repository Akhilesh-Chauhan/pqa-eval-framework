import { basename } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { test, expect, requireWrites } from '../fixtures.js';
import { notMeasured } from '../../support/annotations.js';
import { labels } from '../labels/qdetail.js';
import type { BaseLabels, DashboardLabels, DraftWithAILabels, FinalReviewLabels, StarredLabels } from '../labels/qdetail.js';
import {
  button, card, crumbs, dashboard, esc, eye, findQuestion, hasPart, header, inAssistant, isAdmitted, isFresh, isSaved,
  isStarred, isUnstarred, letters, notOverdue, openQuestion, panel, partWith, parts, partsWith, priorityTag, progress, qno,
  rx, shows, sidebarDashboard, status, tag, timeline, tooltip,
} from './qdetail-nav.js';

// DS-QDET: the Division officer's question detail page (FINAL boards). Preconditions are found through Questions
// Activity; Auto-W cases change the disposable tenant's questions, so later cases may find no candidate left and
// report "not measured". Case-file wording the design snapshot does not hold is not asserted (see labels/qdetail.ts).

const L = labels['QDetailFinalReview.dc.html']! as FinalReviewLabels;
const S = labels['QDetailFinalReviewStarred.dc.html']! as StarredLabels;
const W = labels['QDetailDraftWithAI.dc.html']! as DraftWithAILabels;
const B = labels['QDetailBaseYourDesign.dc.html']! as BaseLabels;
const D = labels['FigmaTestingCal2-5g42-i92s.dc.html']! as DashboardLabels;

const PRE_Q = 'that is new, unstarred, admitted, due more than 2 days ahead, with no part drafted (PRE-Q)';
const PRE_SAVED = 'that is unstarred with every answer saved and no input request (PRE-SAVED)';
const IN_AI = 'with a part drafted in the AI Assistant';
const MARK = 'QA edit';

const blocked = (detail: string) => notMeasured(test.info(), { tracker: 'design-OQ', owner: 'UI/UX', detail });
const missing = (detail: string) => notMeasured(test.info(), { tracker: 'design-precondition', owner: 'QA', detail });

const reviewBox = (c: Locator, k: string) => c.getByRole('textbox', { name: new RegExp(`^${esc(L.answerFor)} ${k}\\b`) });
/** A draft waiting for review on its card: already in review, or offering Review draft. */
const toReview = (k: string) => (c: Locator) => reviewBox(c, k).or(button(c, L.reviewDraft));
const hasDraft = (k: string) => (c: Locator) => toReview(k)(c).or(button(c, L.openAI));
const reviewable = async (p: Page) => (await partWith(p, (c) => reviewBox(c, '[A-Z]').or(button(c, L.reviewDraft)))) !== undefined;
const saveOnCard = (c: Locator) => c.getByRole('button', { name: new RegExp(`^(${esc(L.saveAndNext)}|${esc(L.saveAnswer)})$`) });
const savedCount = (page: Page) => async () => (await progress(page)).saved;

/** First part with a draft to review on its card, put in review. */
async function enterReview(page: Page): Promise<{ k: string; c: Locator; box: Locator }> {
  const k = (await partWith(page, (c) => reviewBox(c, '[A-Z]').or(button(c, L.reviewDraft))))!;
  const c = card(page, k);
  if (await button(c, L.reviewDraft).isVisible()) await button(c, L.reviewDraft).click();
  const box = reviewBox(c, k);
  await expect(box).toBeVisible();
  return { k, c, box };
}

async function openAssistant(page: Page, k: string): Promise<Locator> {
  await button(card(page, k), L.openAI).click();
  const ai = panel(page);
  await expect(ai.getByRole('heading', { name: `${L.subQuestion} ${k}` })).toBeVisible();
  return ai;
}

async function openFinalReview(page: Page): Promise<Locator> {
  await button(page, L.reviewFinal).click();
  const fr = page.getByRole('dialog', { name: L.finalReview });
  await expect(fr).toBeVisible();
  return fr;
}

const quick = (ai: Locator, request: string) => button(ai.getByRole('group', { name: L.quickRequests }), request);
const drafts = (ai: Locator) => ai.getByRole('group', { name: L.thisDraft });
const nextPart = (ai: Locator) => ai.getByRole('button', { name: new RegExp(`^${esc(L.nextSubQuestion)} [A-Z]$`) });

test.describe('DS-QDET — Question detail and final review (design)', () => {
  test('DS-QDET-01 Open Question Detail from Questions Activity', async ({ as }) => {
    const page = await as('division');
    const dno = await findQuestion(page, PRE_Q, isFresh);
    await dashboard(page);
    const open = eye(page, dno);
    await open.hover();
    await expect(tooltip(page, D.openQuestion)).toBeVisible();
    await open.click();
    await expect(page.getByRole('heading', { name: L.questionDetail, level: 1 })).toBeVisible();
    await expect(crumbs(page).getByRole('link', { name: L.dashboard, exact: true })).toBeVisible();
    await expect(crumbs(page).getByRole('link', { name: L.questionsActivity, exact: true })).toBeVisible();
    await expect(crumbs(page).locator('[aria-current="page"]')).toHaveText(new RegExp(`${esc(L.qNo)} \\d+`));
    await expect(sidebarDashboard(page)).toHaveAttribute('aria-current', 'page');
    await expect(header(page)).toContainText(new RegExp(`${esc(D.diaryNo)}:?\\s*${dno}\\b`));
  });

  test('DS-QDET-02 Back arrow, breadcrumb and sidebar return to the dashboard', async ({ as }) => {
    const page = await as('division');
    const dno = await findQuestion(page, 'that is admitted', isAdmitted);
    // A link on the final review board, a button on the base board (OQ-9): either is the designed back control.
    const back = page.getByRole('link', { name: L.backToQA, exact: true }).or(button(page, L.backToQA));
    await back.hover();
    await expect(tooltip(page, L.backToQA)).toBeVisible();
    const atRow = async () => {
      await expect(page.getByRole('table', { name: D.table })).toBeInViewport();
      await expect(eye(page, dno)).toBeInViewport();
    };
    const atTop = () => expect(page.getByRole('heading', { name: D.heading })).toBeInViewport();
    await back.click();
    await atRow();
    await openQuestion(page, dno);
    await crumbs(page).getByRole('link', { name: L.questionsActivity, exact: true }).click();
    await atRow();
    await openQuestion(page, dno);
    await crumbs(page).getByRole('link', { name: L.dashboard, exact: true }).click();
    await atTop();
    await openQuestion(page, dno);
    await sidebarDashboard(page).click();
    await atTop();
  });

  test('DS-QDET-03 Header, status banner and overview of a new admitted question', async ({ as }) => {
    const page = await as('division');
    await findQuestion(page, PRE_Q, isFresh);
    const h = header(page);
    await expect(h.getByRole('heading', { name: L.questionDetail, level: 1 })).toBeVisible();
    await expect(h).toContainText(L.qNo);
    // Tags in order: priority, star, house, stage.
    await expect(h).toContainText(new RegExp([`(${L.low}|${L.medium}|${L.high})`, L.unstarred, `(${L.lokSabha}|${L.rajyaSabha})`, L.admitted].join('[\\s\\S]*')));
    await expect(h).toContainText(L.received);
    await expect(button(h, L.viewUploaded)).toBeVisible();
    await expect(status(page, L.assignedOn)).toContainText(rx(L.readEach, L.saveEach));
    await expect(h.getByRole('heading', { level: 2 }).first()).toBeVisible(); // the subject
  });

  test('DS-QDET-04 Priority tag and due-date note follow the deadline (unstarred)', async ({ as }) => {
    const page = await as('division');
    const overdue = new RegExp(`${esc(L.overdueBy)} \\d+ ${L.day}s?`);
    for (const level of [L.low, L.medium, L.high]) {
      await findQuestion(page, `that is unstarred with ${level} priority`, isUnstarred, (p) => priorityTag(p, level).isVisible());
      // Only a past-due question (High) carries the overdue note. The due-soon wording of Medium is not in the design
      // snapshot, so only its absence of an overdue note is checked.
      if (level === L.high) await expect(header(page)).toContainText(overdue);
      else await expect(header(page)).not.toContainText(L.overdueBy);
    }
  });

  test('DS-QDET-05 Starred question: always High priority, filled Starred tag', async ({ as }) => {
    const page = await as('division');
    await findQuestion(page, 'that is starred, not overdue, with every answer saved', isStarred, notOverdue,
      async (p) => { const { saved, total } = await progress(p); return total > 0 && saved === total; });
    const starredNo = `${S.starred.toUpperCase()} ${S.questionNo}`;
    const unstarredNo = `${S.unstarred.toUpperCase()} ${S.questionNo}`; // contains starredNo, so check it is absent
    const h = header(page);
    await expect(priorityTag(page, S.high)).toBeVisible();
    await expect(tag(h, S.starred)).toBeVisible();
    await expect(h.getByText(S.unstarred, { exact: true })).toHaveCount(0);
    await button(h, S.viewUploaded).click();
    const up = page.getByRole('dialog', { name: S.uploadedQuestion });
    await expect(up).toContainText(starredNo);
    await expect(up).not.toContainText(unstarredNo);
    await button(up, S.close).first().click();
    const fr = await openFinalReview(page);
    await expect(fr).toContainText(S.starredQ);
    await expect(fr).toContainText(starredNo);
    await expect(fr).not.toContainText(unstarredNo);
    await button(fr, S.close).click();
    await expect(timeline(page)).toContainText(S.starredQ);
    await expect(timeline(page)).not.toContainText(S.unstarredQ);
    // The RS_SQ_ file name needs a download, which logs a timeline event: a write this read-only case does not make.
  });

  test('DS-QDET-07 View Uploaded Question dialog', async ({ as }) => {
    const page = await as('division');
    await findQuestion(page, 'that is admitted', isAdmitted);
    const opener = button(header(page), L.viewUploaded);
    const dlg = page.getByRole('dialog', { name: L.uploadedQuestion });
    await opener.click();
    await expect(dlg).toContainText(L.fromParliamentSection);
    const doc = dlg.getByRole('article', { name: L.asUploaded });
    await expect(doc).toContainText(new RegExp([
      `(${L.lokSabha.toUpperCase()}|${L.rajyaSabha.toUpperCase()})`,
      `(${L.unstarred.toUpperCase()}|${L.starred.toUpperCase()}) ${esc(L.questionNo)} \\d+`,
      `${L.answeredOn} \\d{2}\\.\\d{2}\\.\\d{4}`,
      L.willTheMinister, L.pleased, '\\(a\\)', '\\(b\\)',
    ].join('[\\s\\S]*')));
    const closes = [
      () => button(dlg, L.close).last().click(), // footer
      () => button(dlg, L.close).first().click(), // X
      () => page.keyboard.press('Escape'),
    ];
    for (const close of closes) {
      if (!(await dlg.isVisible())) await opener.click();
      await close();
      await expect(dlg).toBeHidden();
      await expect(opener).toBeFocused();
    }
  });

  test('DS-QDET-08 Questions in this Document: first view', async ({ as }) => {
    const page = await as('division');
    await findQuestion(page, PRE_Q, isFresh);
    const { total } = await progress(page);
    const region = parts(page);
    await expect(region).toContainText(new RegExp(`${esc(L.questionsInDoc)}\\s*${total}`));
    await expect(region).toContainText(L.readEach);
    await expect(page.getByRole('progressbar', { name: L.answersSaved })).toHaveAttribute('aria-valuetext', `0 of ${total} ${L.answersSavedText}`);
    await expect(region).toContainText(`${L.drafted} 0 of ${total}`);
    const groups = new RegExp(`^(${esc(L.belongsTo)}|${esc(L.suggestedOther)})`);
    await expect(region.getByRole('heading', { level: 3, name: groups }).first()).toBeVisible();
    for (const k of letters(total)) {
      const c = card(page, k);
      await expect(button(c, L.draftWithAI)).toBeVisible();
      await expect(button(c, L.inputRequest)).toBeVisible();
      for (const t of [L.tagSaved, L.tagWaiting, L.tagDraftReady, L.tagReviewing]) await expect(c.getByText(t, { exact: true })).toHaveCount(0);
    }
    await expect(button(page, L.draftAll)).toHaveCount(0); // switched off on this board (OQ-2)
  });

  test('DS-QDET-09 AI department suggestion tag is keyboard accessible', async ({ as }) => {
    const page = await as('division');
    await findQuestion(page, `${PRE_Q} with an AI department suggestion on a part`, isFresh,
      async (p) => shows(parts(p).getByText(L.suggestion)));
    const sug = parts(page).getByText(new RegExp(`^${esc(L.suggestion)} \\S`)).first();
    await sug.focus(); // a no-op unless the tag is focusable
    await expect(sug).toBeFocused();
    // The tooltip wording is not in the design snapshot: check the tag is described and shows a tooltip.
    await expect(sug).toHaveAccessibleDescription(/\S/);
    await sug.hover();
    await expect(page.getByRole('tooltip').first()).toBeVisible();
  });

  test('DS-QDET-10 Review final answer stays locked until every answer is saved', async ({ as }) => {
    const page = await as('division');
    await findQuestion(page, PRE_Q, isFresh);
    const { total } = await progress(page);
    await expect(status(page, `0 of ${total} ${L.answersSavedText}`)).toBeVisible();
    for (const k of letters(total)) await expect(button(page, `${L.part} ${k}: ${L.notDraftedYet}`)).toBeVisible();
    await expect(button(page, L.reviewFinal)).toBeDisabled();
    await button(page, `${L.part} A: ${L.notDraftedYet}`).click();
    await expect(button(card(page, 'A'), L.draftWithAI)).toBeFocused();
  });

  test('DS-QDET-11 Draft with AI on one part opens the AI Assistant beside the page', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('division');
    await findQuestion(page, PRE_Q, isFresh);
    const { total } = await progress(page);
    const a = card(page, 'A');
    await button(a, L.draftWithAI).click();
    const ai = panel(page);
    await expect(ai.getByRole('heading', { name: L.aiAssistant, exact: true })).toBeVisible();
    await expect(ai.getByRole('heading', { name: `${L.subQuestion} A` })).toBeVisible();
    await expect(ai).toContainText(L.aiDraftingPart);
    await expect(button(a, L.drafting)).toBeDisabled();
    await expect(status(page, `${L.part} A ${L.isDraftedInAI}`)).toBeVisible({ timeout: 120_000 });
    await expect(a).toContainText(L.draftInAI);
    await expect(button(a, L.openAI)).toBeVisible();
    await expect(button(a, L.inputRequest)).toBeVisible();
    await expect(tag(header(page), L.draftStage)).toBeVisible();
    await expect(parts(page)).toContainText(`${L.drafted} 1 of ${total}`);
    await expect(timeline(page)).toContainText(L.aiDraftGenerated);
    await expect(timeline(page)).toContainText(`${L.partLower} A ${L.inTheAI}`);
    await expect(ai.getByRole('textbox', { name: `${L.tellAI} A` })).toBeFocused();
  });

  test('DS-QDET-12 AI Assistant panel layout, info tooltip and closing', async ({ as }) => {
    const page = await as('division');
    await findQuestion(page, IN_AI, hasPart((c) => button(c, W.openAI)));
    const k = (await inAssistant(page))!;
    const opener = button(card(page, k), W.openAI);
    const ai = panel(page);
    const rail = button(page, W.showFullMenu);
    await opener.click();
    await expect(rail).toBeVisible(); // the main menu is an icon rail while the panel is open
    await expect(sidebarDashboard(page)).toBeVisible(); // rail icons keep their names
    await button(ai, W.aboutAI).hover();
    await expect(page.getByRole('tooltip').first()).toBeVisible(); // its wording is not in the design snapshot
    await button(ai, W.closeAI).hover();
    await expect(tooltip(page, W.close)).toBeVisible();
    for (const close of [() => page.keyboard.press('Escape'), () => rail.click(), () => button(ai, W.closeAI).click()]) {
      if (!(await ai.isVisible())) await opener.click();
      await expect(ai).toBeVisible();
      await close();
      await expect(ai).toBeHidden();
      await expect(rail).toBeHidden();
      await expect(opener).toBeFocused();
    }
  });

  test('DS-QDET-13 Sources and copy on a draft', async ({ as }) => {
    const page = await as('division');
    await findQuestion(page, IN_AI, hasPart((c) => button(c, W.openAI)));
    const k = (await inAssistant(page))!;
    const ai = await openAssistant(page, k);
    const draft = ai.getByRole('group', { name: W.thisDraft }).first();
    const toggle = draft.getByRole('button', { name: new RegExp(`^\\d+ ${W.source}s?$`) });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const first = ai.getByRole('list', { name: W.sourcesFor }).getByRole('button', { name: new RegExp(`^${W.sourceN} \\d+: `) }).first();
    await first.click();
    const doc = page.getByRole('region').filter({ has: button(page, W.closeSource) }).last();
    await expect(doc.getByRole('heading').first()).toBeFocused();
    await expect(doc).toContainText(`${W.usedInDraft} ${k}`);
    await page.keyboard.press('Escape');
    await expect(doc).toBeHidden();
    await expect(first).toBeFocused();
    await expect(ai).toBeVisible();
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const copy = button(draft, W.copyDraft);
    await copy.hover();
    await expect(tooltip(page, W.copyTip)).toBeVisible();
    await copy.click();
    await expect(status(page, W.copied)).toBeVisible();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toMatch(/\S/);
  });

  test('DS-QDET-14 Refine a draft with quick requests', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('division');
    const noInputs = async (p: Page) => {
      const k = await inAssistant(p);
      return !!k && !(await shows(button(card(p, k), L.viewInput).or(button(card(p, k), L.viewInputs))));
    };
    await findQuestion(page, `${IN_AI} and no input received`, noInputs);
    const k = (await inAssistant(page))!;
    const ai = await openAssistant(page, k);
    const requests = [L.shorter, L.formal, L.hindiReq, L.another];
    for (const r of requests) await expect(quick(ai, r)).toBeVisible();
    await expect(quick(ai, L.useInput)).toHaveCount(0);
    const log = ai.getByRole('log', { name: L.conversation });
    for (const r of requests) {
      const before = await drafts(ai).count();
      await quick(ai, r).click();
      await expect(log).toContainText(r);
      const busy = ai.getByText(`${L.rewriting} ${k}`);
      await expect(busy).toBeVisible();
      await expect(ai.getByRole('group', { name: L.quickRequests })).toBeHidden();
      await expect(button(ai, L.send)).toBeDisabled();
      await expect(busy).toBeHidden({ timeout: 120_000 });
      await expect(drafts(ai)).toHaveCount(before + 1);
      await expect(button(ai, L.useVersion).last()).toBeVisible();
      if (r === L.hindiReq) await expect(log).toContainText(/[ऀ-ॿ]/);
    }
  });

  test('DS-QDET-15 Own instruction: Send rules and keys', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('division');
    await findQuestion(page, IN_AI, hasPart((c) => button(c, L.openAI)));
    const k = (await inAssistant(page))!;
    const ai = await openAssistant(page, k);
    const box = ai.getByRole('textbox', { name: `${L.tellAI} ${k}` });
    const send = button(ai, L.send);
    await expect(box).toHaveAttribute('placeholder', `${L.tellAI} ${k}`);
    await box.fill('');
    await expect(send).toBeDisabled();
    await box.fill('   ');
    await expect(send).toBeDisabled();
    await box.fill('');
    await box.pressSequentially('Keep every figure as it is.');
    await box.press('Shift+Enter');
    await box.pressSequentially('Use plain English.');
    await expect(box).toHaveValue(/\n/);
    await expect(send).toBeEnabled();
    const before = await drafts(ai).count();
    await box.press('Enter');
    await expect(drafts(ai)).toHaveCount(before + 1, { timeout: 120_000 });
  });

  test('DS-QDET-16 Attach an updated document to revise a part', async ({ as, denv }) => {
    requireWrites(denv);
    // The QA-made question PDF stands in for "a test .docx file": the picker takes .pdf too.
    if (!denv.questionPdf) missing('PQA_DESIGN_QUESTION_PDF not set (a test document to attach)');
    const page = await as('division');
    await findQuestion(page, IN_AI, hasPart((c) => button(c, L.openAI)));
    const k = (await inAssistant(page))!;
    const ai = await openAssistant(page, k);
    const attach = button(ai, L.attach);
    await attach.hover();
    await expect(tooltip(page, L.attach)).toBeVisible();
    const pick = async () => {
      const chooser = page.waitForEvent('filechooser');
      await attach.click();
      const fc = await chooser;
      const accept = (await fc.element().getAttribute('accept')) ?? '';
      expect(accept.split(',').map((s) => s.trim()).sort()).toEqual(['.doc', '.docx', '.pdf', '.xls', '.xlsx']);
      await fc.setFiles(denv.questionPdf!);
    };
    const file = basename(denv.questionPdf!);
    const remove = button(ai, `${L.remove} ${file}`);
    await pick();
    await expect(remove).toBeVisible();
    await remove.click();
    await expect(remove).toBeHidden();
    await expect(attach).toBeFocused();
    await pick();
    await expect(ai.getByRole('textbox', { name: `${L.tellAI} ${k}` })).toHaveValue('');
    await expect(button(ai, L.send)).toBeEnabled();
    const before = await drafts(ai).count();
    await button(ai, L.send).click();
    await expect(ai.getByRole('log', { name: L.conversation })).toContainText(file);
    await expect(drafts(ai)).toHaveCount(before + 1, { timeout: 120_000 });
  });

  test('DS-QDET-17 Use this version, then Save answer from the AI Assistant', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('division');
    await findQuestion(page, `${IN_AI} and another part with a draft`, async (p) => {
      const k = await inAssistant(p);
      return !!k && (await partsWith(p, (c) => button(c, L.openAI).or(button(c, L.reviewDraft)))).length > 1;
    });
    const k = (await inAssistant(page))!;
    const { saved } = await progress(page);
    const ai = await openAssistant(page, k);
    if ((await drafts(ai).count()) < 2) missing(`part ${k} has a single AI version in the AI Assistant (needs 2 or more)`);
    await button(ai, L.useVersion).first().click(); // the older reply
    await button(ai, `${L.saveAnswerTo} ${k}`).click();
    const c = card(page, k);
    await expect(tag(c, L.tagSaved)).toBeVisible();
    await expect(c).toContainText(L.savedAnswer);
    await expect(button(c, L.editAnswer)).toBeVisible();
    await expect.poll(savedCount(page)).toBe(saved + 1);
    await expect(timeline(page)).toContainText(L.answerSaved);
    const msg = status(page, `${L.answerToPart} ${k} ${L.savedDot}`);
    await expect(msg).toBeVisible();
    const next = (await msg.textContent())?.match(new RegExp(`${L.part} ([A-Z]) ${esc(L.isOpenNext)}`))?.[1];
    if (next) await expect(ai.getByRole('heading', { name: `${L.subQuestion} ${next}` })).toBeVisible();
    else await expect(msg).toContainText(L.stillToDo);
  });

  test('DS-QDET-18 Move between parts inside the AI Assistant', async ({ as }) => {
    const page = await as('division');
    await findQuestion(page, `${IN_AI}, a part waiting for input and an undrafted part (PRE-WAIT)`,
      hasPart((c) => button(c, L.openAI)), hasPart((c) => button(c, L.viewRequest)), hasPart((c) => button(c, L.draftWithAI)));
    const { saved, total } = await progress(page);
    const ai = await openAssistant(page, (await inAssistant(page))!);
    for (let i = 1; i < total && (await nextPart(ai).isVisible()); i++) {
      const to = ((await nextPart(ai).getAttribute('aria-label')) ?? '').slice(-1);
      await expect(nextPart(ai)).toContainText(`${L.nextSubQues} ${to}`);
      await nextPart(ai).click();
      await expect(ai.getByRole('heading', { name: `${L.subQuestion} ${to}` })).toBeVisible();
      const c = card(page, to);
      if (await shows(button(c, L.viewRequest))) {
        await expect(button(ai, L.viewRequest)).toBeVisible();
        await expect(ai.getByRole('textbox', { name: `${L.tellAI} ${to}` })).toHaveCount(0);
        await expect(button(ai, `${L.saveAnswerTo} ${to}`)).toHaveCount(0);
      } else if (await shows(button(c, L.draftWithAI))) {
        await expect(ai).toContainText(L.noDraftYet);
        await expect(button(ai, L.draftWithAI)).toBeVisible();
      } else if (await shows(button(c, L.editAnswer))) {
        await expect(button(ai, L.refine)).toBeVisible();
      }
    }
    expect((await progress(page)).saved, 'moving between parts does not save').toBe(saved);
  });

  test('DS-QDET-19 Review a draft on its card', async () => {
    blocked('OQ-2: drafts placed on the cards (AI draft ready, Review draft) come only from Draft all with AI, switched off on QDetailFinalReview');
  });

  test('DS-QDET-20 Edit on the card, undo, save with Ctrl+Enter', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('division');
    await findQuestion(page, 'with a part in review on its card and another part with a draft to review', reviewable,
      async (p) => (await partsWith(p, (c) => hasDraft('[A-Z]')(c))).length > 1);
    const { k, c, box } = await enterReview(page);
    const original = await box.inputValue();
    await box.fill(`${original} ${MARK}`);
    await expect(c).toContainText(L.changedDraft);
    const undo = button(c, L.undo);
    await undo.click();
    await expect(box).toHaveValue(original);
    await expect(undo).toBeHidden();
    await box.fill(`${original} ${MARK}`);
    await box.press('Control+Enter');
    await expect(status(page, rx(`${L.answerToPart} ${k} ${L.savedDot} ${L.part}`, L.isOpenNext))).toBeVisible();
    await expect(timeline(page)).toContainText(new RegExp(`${esc(L.answerSaved)}[\\s\\S]*${esc(L.editedByYou)}`, 'i'));
  });

  test('DS-QDET-21 An empty answer cannot be saved', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('division');
    await findQuestion(page, 'with a part in review on its card', reviewable);
    const { saved } = await progress(page);
    const { k, c, box } = await enterReview(page);
    await box.fill('');
    await saveOnCard(c).click();
    await expect(c).toContainText(`${L.enterAnswer} ${k} ${L.beforeSaving}`);
    await expect(box).toBeFocused();
    await expect(tag(c, L.tagSaved)).toBeHidden();
    expect((await progress(page)).saved).toBe(saved);
  });

  test('DS-QDET-22 Compare draft versions on the card', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('division');
    await findQuestion(page, 'with a part in review on its card', reviewable);
    const { k, c, box } = await enterReview(page);
    const prev = button(c, `${L.prevVersion} ${k}`);
    const next = button(c, `${L.nextVersion} ${k}`);
    if (!(await prev.isVisible())) missing(`part ${k} in review has a single version (needs 2 or more)`);
    const label = c.getByText(new RegExp(`(${esc(L.aiDraftVer)}|${esc(L.yourEditVer)}) ${L.version} \\d+ of \\d+`));
    for (let i = 0; i < 20 && (await prev.isEnabled()); i++) await prev.click();
    await expect(label).toContainText(`${L.version} 1 of`);
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();
    for (let i = 0; i < 20 && (await next.isEnabled()); i++) await next.click();
    await expect(next).toBeDisabled();
    const [, at, of] = (await label.textContent())?.match(/(\d+) of (\d+)/) ?? [];
    expect(at, 'Next is disabled on the last version').toBe(of);
    await box.fill(`${await box.inputValue()} ${MARK}`);
    await expect(prev).toBeDisabled();
    await expect(next).toBeDisabled();
    await expect(c).toContainText(L.switchBlocked);
    await button(c, L.undo).click();
  });

  test('DS-QDET-23 Regenerate with AI from the card and use the new version', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('division');
    await findQuestion(page, 'with a part in review on its card', reviewable);
    const { k, c, box } = await enterReview(page);
    await button(c, L.regenerate).click();
    const ai = panel(page);
    await expect(ai.getByRole('heading', { name: `${L.subQuestion} ${k}` })).toBeVisible();
    const useNew = async (request: string) => {
      const before = await drafts(ai).count();
      await quick(ai, request).click();
      await expect(drafts(ai)).toHaveCount(before + 1, { timeout: 120_000 });
      await button(ai, L.useVersion).last().click();
    };
    await useNew(L.shorter);
    await expect(status(page, `${L.newVersionIn} ${k}`)).toBeVisible();
    await expect(c.getByRole('textbox', { name: new RegExp(`^${esc(L.answerFor)} ${k} ${esc(L.aiReq)}`) })).toBeVisible();
    await box.fill(`${await box.inputValue()} ${MARK}`);
    await useNew(L.another);
    await expect(status(page, L.unsavedKept)).toBeVisible();
  });

  test('DS-QDET-24 Reopen a saved answer', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('division');
    await findQuestion(page, PRE_SAVED, isSaved);
    const { saved } = await progress(page);
    const a = card(page, 'A');
    await button(a, L.editAnswer).click();
    await expect(tag(a, L.tagSaved)).toBeHidden();
    await expect(reviewBox(a, 'A')).toBeVisible();
    await expect.poll(savedCount(page)).toBe(saved - 1);
    await expect(button(page, L.reviewFinal)).toBeDisabled();
    await expect(button(page, `${L.part} A: ${L.reviewAIDraft}`)).toBeVisible();
    await expect(timeline(page)).toContainText(L.reopened);
    // Step 3: in the AI Assistant, move to another saved part and reopen it there.
    await button(a, L.regenerate).click();
    const ai = panel(page);
    await nextPart(ai).click();
    await button(ai, L.refine).click();
    await expect(ai.getByRole('textbox', { name: new RegExp(`^${esc(L.tellAI)} [B-Z]$`) })).toBeFocused();
  });

  test('DS-QDET-25 Saving the last answer unlocks Review final answer', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('division');
    await findQuestion(page, 'with every part saved except one, which has a draft to review', async (p) => {
      const { saved, total } = await progress(p);
      return total > 1 && saved === total - 1 && (await partWith(p, hasDraft('[A-Z]'))) !== undefined;
    });
    const { total } = await progress(page);
    const k = (await partWith(page, hasDraft('[A-Z]')))!;
    if (await shows(button(card(page, k), L.openAI))) {
      const ai = await openAssistant(page, k);
      await button(ai, `${L.saveAnswerTo} ${k}`).click();
    } else {
      const { c } = await enterReview(page);
      await saveOnCard(c).click();
    }
    await expect(status(page, L.allSaved)).toBeVisible();
    const review = button(page, L.reviewFinal);
    await expect(review).toBeEnabled();
    await expect(review).toBeFocused();
    await expect(page.getByRole('progressbar', { name: L.answersSaved })).toHaveAttribute('aria-valuetext', `${total} of ${total} ${L.answersSavedText}`);
    await expect(page.getByRole('button', { name: new RegExp(`^${L.part} [A-Z]: `) })).toHaveCount(0); // no Still to do
  });

  test('DS-QDET-26 Final review dialog content', async ({ as }) => {
    const page = await as('division');
    await findQuestion(page, PRE_SAVED, isSaved);
    const { total } = await progress(page);
    const q = await qno(page);
    const fr = await openFinalReview(page);
    await expect(fr).toContainText(rx(`${L.unstarredQ} ${q}`, L.dnoSep, `${total} ${L.partsDue}`));
    await expect(fr.getByRole('heading', { name: L.answersEach })).toBeVisible();
    const acc = fr.getByRole('button', { name: new RegExp(`^${L.subQuestion} [A-Z]`) });
    await expect(acc).toHaveCount(total);
    const how = new RegExp(`(${esc(L.howAI)}|${esc(L.editedByYou)}|${esc(L.howAIVer)}.+${esc(L.howAIVerEnd)})`);
    for (const b of await acc.all()) {
      await expect(b).toHaveAttribute('aria-expanded', 'true');
      await expect(b).toContainText(L.tagSaved);
      const region = fr.locator(`[id="${await b.getAttribute('aria-controls')}"]`);
      await expect(region).toContainText(how);
      await expect(button(region, L.editAnswer)).toBeVisible();
    }
    await expect(fr.getByRole('heading', { name: L.consolidated, exact: true })).toBeVisible();
    await expect(button(fr, L.copyText)).toBeVisible();
    await expect(fr).toContainText(L.builtFrom);
    await expect(fr).toContainText(new RegExp([
      L.govt, L.ministry, `(${L.lokSabha.toUpperCase()}|${L.rajyaSabha.toUpperCase()})`,
      `${L.unstarred.toUpperCase()} ${esc(L.questionNo)} ${q}`, L.answeredOn, L.answer, L.ministerOfState, '\\(a\\)', '\\(b\\)',
    ].join('[\\s\\S]*')));
    for (const b of [L.backToParts, L.downloadPdf, L.downloadWord]) await expect(button(fr, b)).toBeVisible();
    const all = fr.getByRole('button', { name: new RegExp(`^(${L.collapseAll}|${L.expandAll})$`) });
    await expect(all).toContainText(L.collapseAll);
    await all.click();
    for (const b of await acc.all()) await expect(b).toHaveAttribute('aria-expanded', 'false');
    await expect(all).toContainText(L.expandAll);
    await all.click();
    for (const b of await acc.all()) await expect(b).toHaveAttribute('aria-expanded', 'true');
    await acc.first().click();
    await expect(acc.first()).toHaveAttribute('aria-expanded', 'false');
  });

  test('DS-QDET-27 Edit an answer inside Final review', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as('division');
    await findQuestion(page, PRE_SAVED, isSaved);
    const fr = await openFinalReview(page);
    const edits = button(fr, L.editAnswer);
    const downloads = [button(fr, L.downloadPdf), button(fr, L.downloadWord)];
    const box = fr.getByRole('textbox', { name: `${L.answerFor} A`, exact: true });
    const save = button(fr, L.saveChanges);
    await edits.first().click();
    await expect(button(fr, L.cancel)).toBeVisible();
    for (const e of await edits.all()) if (await e.isVisible()) await expect(e).toBeDisabled();
    for (const d of downloads) await expect(d).toBeDisabled();
    await expect(fr).toContainText(`${L.saveOrCancel} A ${L.beforeDownload}`);
    const original = await box.inputValue();
    await box.fill('');
    await expect(save).toBeDisabled();
    await box.fill(`${original} ${MARK}`);
    await save.click();
    // Paragraph (a) of the consolidated answer carries the change (it comes before (b)).
    await expect(fr).toContainText(new RegExp(`\\(a\\)[\\s\\S]*${MARK}[\\s\\S]*\\(b\\)`));
    for (const d of downloads) await expect(d).toBeEnabled();
    await edits.first().click();
    await box.fill(`${original} discarded`);
    await button(fr, L.cancel).click();
    await expect(fr).not.toContainText(`${original} discarded`);
    for (const d of downloads) await expect(d).toBeEnabled();
    await button(fr, L.close).click();
    await expect(timeline(page)).toContainText(L.editedInFR);
    // The "Part A is updated…" message waits behind the dialog (OQ-6) and its wording is not in the snapshot.
  });

  test('DS-QDET-28 Copy the consolidated answer', async ({ as }) => {
    const page = await as('division');
    await findQuestion(page, PRE_SAVED, isSaved);
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    const fr = await openFinalReview(page);
    await button(fr, L.copyText).click();
    // The confirmation waits behind the dialog (OQ-6): the clipboard is the evidence.
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toMatch(new RegExp([L.govt, L.ministry, `\\b${L.answer}\\b`, L.ministerOfState, '\\(a\\)', '\\(b\\)'].join('[\\s\\S]*')));
  });

  // DS-QDET-29 and -30 are the same flow for the two formats.
  for (const [id, title, press, format, ext, toast] of [
    ['DS-QDET-29', 'Download Word', L.downloadWord, L.word, 'doc', L.wordToast],
    ['DS-QDET-30', 'Download PDF', L.downloadPdf, L.pdf, 'pdf', L.pdfToast],
  ] as const) {
    test(`${id} ${title}`, async ({ as, denv }) => {
      requireWrites(denv);
      const page = await as('division');
      await findQuestion(page, PRE_SAVED, isSaved);
      const { total } = await progress(page);
      const q = await qno(page);
      const fr = await openFinalReview(page);
      const dl = page.waitForEvent('download');
      await button(fr, press).click();
      const file = (await dl).suggestedFilename();
      // RS_USQ_<qno>_consolidated_answer.<ext>; the Lok Sabha prefix is open (OQ-14), so only the rest is checked.
      expect(file).toMatch(new RegExp(`_${q}_\\w+\\.${ext}$`));
      await expect(fr).toContainText(`${L.downloadedAs} ${format}`);
      await button(fr, L.close).click();
      await expect(status(page, `${file} ${toast}`)).toBeVisible(); // shown once the dialog closes (OQ-6)
      if (format === L.word) await expect(status(page, `${L.finalDownloadedAs} ${L.word}`)).toBeVisible();
      await expect(timeline(page)).toContainText(L.finalDownloaded);
      await expect(timeline(page)).toContainText(`${format} ${L.consolidatedOf} ${total} ${L.partsApproval}`);
    });
  }

  test('DS-QDET-32 Dialog keyboard handling (Final review as example)', async ({ as }) => {
    const page = await as('division');
    await findQuestion(page, PRE_SAVED, isSaved);
    const review = button(page, L.reviewFinal);
    const fr = page.getByRole('dialog', { name: L.finalReview });
    await review.press('Enter');
    await expect(fr).toBeVisible();
    await expect(fr.locator(':focus')).toHaveCount(1);
    const last = button(fr, L.downloadWord); // last enabled footer button
    await last.focus();
    await page.keyboard.press('Tab');
    await expect(button(fr, L.close)).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(last).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(fr).toBeHidden();
    await expect(review).toBeFocused();
    await review.press('Enter');
    await button(fr, L.backToParts).click();
    await expect(fr).toBeHidden();
    await expect(review).toBeFocused();
  });

  test('DS-QDET-33 Movement Timeline and current custodian', async ({ as }) => {
    const page = await as('division');
    const more = (p: Page) => timeline(p).getByRole('button', {
      name: new RegExp(`^${L.showAll} \\d+ ${esc(L.updatesOpen)}\\d+ ${esc(L.earlier)}$`),
    });
    await findQuestion(page, 'with more than 6 timeline events', (p) => more(p).isVisible());
    const tl = timeline(page);
    await expect(tl.getByRole('heading', { name: L.movementTimeline })).toBeVisible();
    const key = tl.getByRole('list', { name: L.colourKey });
    for (const t of [L.actionRequired, L.onTrack, L.inProgress]) await expect(key).toContainText(t);
    const n = Number((await more(page).textContent())?.match(/\d+/)?.[0]);
    const id = await more(page).getAttribute('aria-controls');
    const toggle = tl.locator(`[aria-controls="${id}"]`); // the same button, relabelled when it expands
    const events = page.locator(`[id="${id}"]`).getByRole('listitem');
    await expect(events).toHaveCount(6);
    const tone = new RegExp(`\\((${L.actionRequired}|${L.onTrack}|${L.inProgress})\\)`);
    for (const e of await events.all()) await expect(e).toContainText(tone);
    await expect(tl).toContainText(L.currentStage);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toContainText(`${L.showLatest} 6 ${L.updates}`);
    await expect(events).toHaveCount(n);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(events).toHaveCount(6);
  });

  test('DS-QDET-34 Page utilities and messages', async ({ as }) => {
    const page = await as('division');
    // A message needs an action that changes nothing: copying a draft in the AI Assistant.
    await findQuestion(page, `${IN_AI} (its Copy message is the read-only trigger)`, hasPart((c) => button(c, L.openAI)));
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.reload();
    await expect(page.getByRole('heading', { name: L.questionDetail, level: 1 })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: L.skip })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('main')).toBeFocused();

    const size = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    const base = await size();
    const sizes = page.getByRole('group', { name: L.textSize });
    for (let i = 0; i < 3; i++) await button(sizes, L.textInc).click();
    await expect.poll(size).toBeCloseTo(base * 1.2, 1); // 10% steps, capped at 120%
    for (let i = 0; i < 4; i++) await button(sizes, L.textDec).click();
    await expect.poll(size).toBeCloseTo(base * 0.9, 1); // floor 90%
    await button(sizes, L.textReset).click();
    await expect.poll(size).toBeCloseTo(base, 1);

    await button(page, L.lang).click();
    const lang = page.getByRole('listbox', { name: L.language, exact: true });
    await expect(lang.getByRole('option', { name: new RegExp(`^${L.english}`) })).toHaveAttribute('aria-selected', 'true');
    await expect(lang.getByRole('option', { name: L.hindi })).toBeVisible();
    await page.keyboard.press('Escape');

    const ai = await openAssistant(page, (await inAssistant(page))!);
    const copy = button(ai, L.copyDraft).first();
    const msg = status(page, L.copied);
    await copy.click();
    await expect(msg).toBeVisible();
    await button(page, L.dismiss).click();
    await expect(msg).toBeHidden();
    await copy.click();
    await expect(msg).toBeVisible();
    await expect(msg).toBeHidden({ timeout: 10_000 }); // slides out after about 6 s
  });

  test('DS-QDET-35 Submit for approval with the e-file number (only if enabled)', async () => {
    blocked('OQ-1: submitting with an e-file number is switched off on QDetailFinalReview (the flow ends at Download Word or PDF)');
  });

  test('DS-QDET-36 Draft all with AI', async () => {
    blocked('OQ-2: Draft all with AI is switched off on QDetailFinalReview');
  });

  test('DS-QDET-37 Draft-all layout: edit, regenerate limit and save on the card', async () => {
    blocked('OQ-2: the Draft-all card layout (Edit draft, Regenerate cap) ships only with Draft all with AI');
  });

  test('DS-QDET-38 Create the consolidated answer', async () => {
    blocked('OQ-2: Create consolidated answer belongs to the Draft-all layout');
  });

  test('DS-QDET-39 E-file number is locked until the consolidated answer exists', async () => {
    blocked('OQ-1: the E-file number card is switched off on QDetailFinalReview');
  });

  test('DS-QDET-40 Submit e-file', async () => {
    blocked('OQ-1: e-file submission is switched off on QDetailFinalReview');
  });

  test('DS-QDET-41 Provisional question: read and collect inputs only', async ({ as }) => {
    const page = await as('division');
    const dno = await findQuestion(page, 'that is provisional (not yet admitted)', (p) => tag(header(p), B.provisional).isVisible());
    await expect(crumbs(page).locator('[aria-current="page"]')).toContainText(`${B.dNo} ${dno}`);
    await expect(header(page)).toContainText(`${B.dNo} ${dno}`);
    await expect(status(page, B.provisionalBanner)).toBeVisible();
    await expect(button(parts(page), B.draftWithAI)).toHaveCount(0);
    await expect(button(page, B.draftAll)).toHaveCount(0);
    await expect(button(parts(page), B.inputRequest).first()).toBeVisible();
    await expect(page.getByText(B.efileLocked)).toBeVisible();
  });

  test('DS-QDET-42 Approved and submitted questions', async ({ as }) => {
    const page = await as('division');
    const approved = await findQuestion(page, 'whose drafts are approved with the e-file pending', (p) => tag(parts(p), B.draftApproved).isVisible());
    const submitted = await findQuestion(page, 'whose reply is already submitted', (p) => tag(parts(p), B.replySubmitted).isVisible());
    await openQuestion(page, approved);
    await expect(button(parts(page), B.viewApproved).first()).toBeVisible();
    await expect(parts(page)).toContainText(B.everyApproved);
    await expect(status(page, B.nextSubmit)).toBeVisible();
    await expect(page.getByRole('textbox', { name: B.efileNumber })).toBeEnabled();
    await expect(page.getByText(B.efileReady)).toBeVisible();
    await openQuestion(page, submitted);
    await expect(button(parts(page), B.viewReply).first()).toBeVisible();
    await expect(parts(page)).toContainText(B.replyHasBeen);
    for (const b of [B.draftWithAI, B.inputRequest]) await expect(button(page, b)).toHaveCount(0);
  });
});
