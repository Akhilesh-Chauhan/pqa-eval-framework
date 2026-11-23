import { test, expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { notMeasured } from '../../support/annotations.js';
import { labels } from '../labels/qdetail.js';
import type { DashboardLabels, FinalReviewLabels } from '../labels/qdetail.js';

// Question detail is reached only the way the design does it: My Division Dashboard → Questions Activity → the row's
// eye link. A precondition (a question in some state) is found by opening the questions one by one and reading the
// page; when none qualifies the case is "not measured", never a pass.

// Typed views: `labels` is a plain Record, so a typo in a key would otherwise pass as `undefined` (= no name filter).
const D = labels['FigmaTestingCal2-5g42-i92s.dc.html']! as DashboardLabels;
const L = labels['QDetailFinalReview.dc.html']! as FinalReviewLabels;

export type Check = (page: Page) => Promise<boolean>;

export const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A message from its static pieces, in order; whatever the build puts between them (names, counts, times) is free. */
export const rx = (...pieces: string[]): RegExp => new RegExp(pieces.map(esc).join('[\\s\\S]*?'));

export const button = (scope: Page | Locator, name: string | RegExp) => scope.getByRole('button', { name, exact: true });
export const header = (page: Page) => page.getByRole('region', { name: L.questionDetail });
export const parts = (page: Page) => page.getByRole('region', { name: L.questionsInDoc });
export const card = (page: Page, k: string) =>
  parts(page).getByRole('listitem').filter({ has: page.getByText(`${L.subQuestion} ${k}`, { exact: true }) });
export const panel = (page: Page) => page.getByRole('complementary', { name: L.aiPanel });
export const timeline = (page: Page) => page.getByRole('region', { name: L.movementTimeline });
export const crumbs = (page: Page) => page.getByRole('navigation', { name: L.breadcrumb });
export const sidebarDashboard = (page: Page) =>
  page.getByRole('navigation', { name: D.sections }).getByRole('link', { name: D.dashboard, exact: true });
/** The toast and the bar after the parts are both `status`; several exist on the page, so match by text. */
export const status = (page: Page, text: string | RegExp) => page.getByRole('status').filter({ hasText: text }).first();
export const tooltip = (page: Page, text: string | RegExp) => page.getByRole('tooltip').filter({ hasText: text }).first();
/** A tag: its text ends with the label (tags may carry an icon ligature in front). */
export const tag = (scope: Locator, text: string) => scope.getByText(new RegExp(`${esc(text)}$`)).first();
/** The priority tag starts with Low, Medium or High. */
export const priorityTag = (page: Page, level: string) => header(page).getByText(new RegExp(`^${esc(level)}\\b`)).first();
export const shows = (l: Locator) => l.first().isVisible();
export const eye = (page: Page, dno: string) => page.getByRole('link', { name: `${D.openQuestionDno} ${dno}`, exact: true });
const EYE = new RegExp(`^${esc(D.openQuestionDno)} `);

/** `<n> of <N> answers saved` from the progress bar; 0 of 0 on pages without one (provisional, forwarded). */
export async function progress(page: Page): Promise<{ saved: number; total: number }> {
  const bar = page.getByRole('progressbar', { name: L.answersSaved });
  if (!(await bar.isVisible())) return { saved: 0, total: 0 };
  const [saved = 0, total = 0] = ((await bar.getAttribute('aria-valuetext')) ?? '').match(/\d+/g)?.map(Number) ?? [];
  return { saved, total };
}

export const letters = (n: number): string[] => [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].slice(0, n);

/** Letters of the parts whose card shows what `pick` finds. */
export async function partsWith(page: Page, pick: (card: Locator) => Locator): Promise<string[]> {
  const found: string[] = [];
  for (const k of letters((await progress(page)).total)) if (await shows(pick(card(page, k)))) found.push(k);
  return found;
}
export const partWith = async (page: Page, pick: (card: Locator) => Locator): Promise<string | undefined> =>
  (await partsWith(page, pick))[0];
export const hasPart = (pick: (card: Locator) => Locator): Check => async (p) => (await partWith(p, pick)) !== undefined;

/** The question number from the breadcrumb's current item. */
export async function qno(page: Page): Promise<string> {
  return ((await crumbs(page).locator('[aria-current="page"]').textContent()) ?? '').replace(L.qNo, '').trim();
}

/** My Division Dashboard from the sidebar, with Questions Activity expanded past its first rows. */
export async function dashboard(page: Page): Promise<void> {
  await sidebarDashboard(page).click();
  await expect(page.getByRole('table', { name: D.table })).toBeVisible();
  const all = button(page, D.viewAll);
  if (await all.isVisible()) await all.click();
}

export async function openQuestion(page: Page, dno: string): Promise<void> {
  await dashboard(page);
  await eye(page, dno).click();
  await expect(page.getByRole('heading', { name: L.questionDetail, level: 1 })).toBeVisible();
  await expect(parts(page).getByText(L.subQuestion).first()).toBeVisible();
}

/** Opens the first question in Questions Activity whose page passes every check and returns its diary number. */
export async function findQuestion(page: Page, what: string, ...checks: Check[]): Promise<string> {
  await dashboard(page);
  const names = await page.getByRole('table', { name: D.table }).getByRole('link', { name: EYE })
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? e.textContent ?? ''));
  next: for (const dno of names.map((n) => n.replace(EYE, '').trim())) {
    await openQuestion(page, dno);
    for (const check of checks) if (!(await check(page))) continue next;
    return dno;
  }
  notMeasured(test.info(), { tracker: 'design-precondition', owner: 'QA', detail: `no question in Questions Activity ${what}` });
  throw new Error('not reached');
}

// Checks for findQuestion.
export const isAdmitted: Check = (p) => tag(header(p), L.admitted).isVisible();
export const isUnstarred: Check = (p) => tag(header(p), L.unstarred).isVisible();
export const isStarred: Check = (p) => tag(header(p), L.starred).isVisible();
export const notOverdue: Check = async (p) => !(await shows(header(p).getByText(L.overdueBy)));
/** PRE-Q: admitted, unstarred, due more than 2 days ahead (Low), every part still offering Draft with AI. */
export const isFresh: Check = async (p) => {
  const { saved, total } = await progress(p);
  return total > 1 && saved === 0 && (await button(parts(p), L.draftWithAI).count()) === total
    && (await isAdmitted(p)) && (await isUnstarred(p)) && (await priorityTag(p, L.low).isVisible());
};
/** PRE-SAVED: unstarred, every answer saved, no input request open. */
export const isSaved: Check = async (p) => {
  const { saved, total } = await progress(p);
  return total > 1 && saved === total && (await isUnstarred(p)) && !(await shows(button(parts(p), L.viewRequest)));
};
export const inAssistant = (p: Page) => partWith(p, (c) => button(c, L.openAI));
export const waitingPart = (p: Page) => partWith(p, (c) => button(c, L.viewRequest));
