import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures.js';
import { notMeasured } from '../../support/annotations.js';
import type { DesignPersona } from '../design-env.js';
import { labels } from '../labels/dashboards.js';
import type { DivisionLabels, ExecutiveLabels, ParliamentLabels } from '../labels/dashboards.js';

// Navigation and shared checks for the portal shell and the three FINAL dashboards. Every persona lands on its
// dashboard; other screens are reached only by clicking design labels. The FINAL boards share one shell, so the shell
// labels are read from the Executive board.

export const BOARD = {
  executive: 'FigmaTestingCal2-5g42.dc.html',
  parliament: 'FigmaTestingCal2-5g42-ux4gbar.dc.html',
  division: 'FigmaTestingCal2-5g42-i92s.dc.html',
} as const;

// Typed views: `labels` is a plain Record, so a typo in a key would otherwise pass as `undefined` (= no name filter).
export const E = labels[BOARD.executive]! as ExecutiveLabels;
export const P = labels[BOARD.parliament]! as ParliamentLabels;
export const D = labels[BOARD.division]! as DivisionLabels;

/** A design label inside a RegExp: specials escaped, straight and curly quotes interchangeable. */
export const esc = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/['’]/g, "['’]").replace(/["“”]/g, '["“”]');
/** Exactly this label in any letter case: the design sets many labels in capitals with CSS. */
export const caps = (s: string): RegExp => new RegExp(`^${esc(s)}$`, 'i');
/** Regex source for a house name. */
export const HOUSE = `(?:${esc(E.lokSabha)}|${esc(E.rajyaSabha)})`;
export const DATE = '\\d{2}/\\d{2}/\\d{4}';

export const DASH = {
  executive: { heading: E.h1, searchbox: E.searchbox, placeholder: E.placeholder },
  parliament: { heading: P.h1, searchbox: E.searchbox, placeholder: E.placeholder },
  division: { heading: D.h1, searchbox: D.searchbox, placeholder: D.placeholder },
} satisfies Record<DesignPersona, { heading: string; searchbox: string; placeholder: string }>;

/** The persona's sidebar items, in design order. */
export const MENU: Record<DesignPersona, Array<string | RegExp>> = {
  executive: [E.dashboard, E.aiAssistant],
  parliament: [E.dashboard, P.provisionalQ, P.admittedQ, P.efile, P.completedQ],
  division: [
    E.dashboard, D.provisionalQ, new RegExp(`^${esc(D.admittedQ)} \\(\\d+\\)$`), D.completedQ, D.transferReq, D.inputCollab, D.profile,
  ],
};

/** Data the case needs is absent from the tenant: "not measured", never a pass. */
export function need(ok: unknown, detail: string): asserts ok {
  if (!ok) notMeasured(test.info(), { tracker: 'design-precondition', owner: 'QA', detail });
}

/** Shows within `timeout`: for finding preconditions only, never for the assertion itself. */
export const shows = (loc: Locator, timeout = 3_000): Promise<boolean> =>
  loc.first().waitFor({ timeout }).then(() => true, () => false);

/** Search terms: a letter nearly every subject or division name holds, and one nothing matches. */
export const ANY = 'a';
export const NONE = 'zzqa-no-match';

// ---- shell -----------------------------------------------------------------------------------------------------

export const menu = (page: Page): Locator => page.getByRole('complementary', { name: E.mainMenu, exact: true });
export const sections = (page: Page): Locator => menu(page).getByRole('navigation', { name: E.sections, exact: true });
export const menuLink = (page: Page, name: string | RegExp): Locator => sections(page).getByRole('link', { name, exact: true });
export const h1 = (page: Page, persona: DesignPersona): Locator =>
  page.getByRole('heading', { level: 1, name: DASH[persona].heading, exact: true });

export async function goDashboard(page: Page, persona: DesignPersona): Promise<void> {
  await menuLink(page, E.dashboard).click();
  await expect(h1(page, persona)).toBeVisible();
}

/** Hand-off: the control opened another screen. That screen's own checks belong to its area's cases. */
export async function expectLeft(page: Page, persona: DesignPersona): Promise<void> {
  await expect(h1(page, persona)).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
}

/** Browser Back to the dashboard. */
export async function back(page: Page, persona: DesignPersona): Promise<void> {
  await page.goBack();
  await expect(h1(page, persona)).toBeVisible();
}

export const searchbox = (page: Page, persona: DesignPersona): Locator =>
  page.getByRole('search', { name: E.searchForm, exact: true }).getByRole('searchbox', { name: DASH[persona].searchbox, exact: true });

export async function search(page: Page, persona: DesignPersona, term: string): Promise<void> {
  await searchbox(page, persona).fill(term);
  await searchbox(page, persona).press('Enter');
}

export const region = (page: Page, name: string | RegExp): Locator => page.getByRole('region', { name, exact: true });
export const bell = (page: Page): Locator => page.getByRole('button', { name: E.bell, exact: true });
export const notifications = (page: Page): Locator => page.getByRole('dialog', { name: E.notifTitle, exact: true });

export async function openNotifications(page: Page): Promise<Locator> {
  await bell(page).click();
  await expect(notifications(page)).toBeVisible();
  return notifications(page);
}

/** A toast: the polite status region carrying `text`. */
export const toast = (page: Page, text: RegExp): Locator => page.getByRole('status').filter({ hasText: text });

/** The update indicator: "Last updated <relative>" or "Last updated on: <dd/mm/yyyy>". */
export const updated = (page: Page): Locator => page.getByText(new RegExp(`^${esc(E.lastUpdated)}`)).first().locator('..');
export const UPDATED = new RegExp(
  `${esc(E.lastUpdated)}\\s*(?:${esc(E.justNow)}|\\d+ [a-z]+${esc(E.ago)})|${esc(E.lastUpdatedOn)}\\s*${DATE}`,
);

/** The persona's role label as shown (innerText, so CSS capitals count). The Division officer's is the division name. */
export async function expectRoleLabel(page: Page, label: string): Promise<void> {
  // first(): the header comes before main, where e.g. a JOINT SECRETARY column header also lives
  const role = page.getByText(caps(label)).first();
  await expect(role).toBeVisible();
  expect(await role.innerText()).toBe(label.toUpperCase());
}

/** The Division officer's division, from the AI Daily Briefing footer "… questions for <division> across open sittings." */
export async function divisionName(page: Page): Promise<string> {
  const re = new RegExp(`${esc(D.questionsFor)}(.+)${esc(D.acrossOpen)}$`);
  const foot = region(page, E.briefing).getByText(re).first();
  await expect(foot).toBeVisible();
  return re.exec(((await foot.textContent()) ?? '').trim())![1]!;
}

// ---- generic checks --------------------------------------------------------------------------------------------

/** The accessible name, read from the aria snapshot. */
export async function accName(loc: Locator): Promise<string> {
  const quoted = (await loc.ariaSnapshot()).match(/^- [\w-]+ ("(?:[^"\\]|\\.)*")/)?.[1];
  return quoted ? (JSON.parse(quoted) as string) : '';
}

/** These elements come in this order in the page (DOM order is reading and Tab order). */
export async function expectOrder(locators: Locator[]): Promise<void> {
  for (let i = 1; i < locators.length; i++) {
    const next = await locators[i]!.elementHandle();
    const follows = await locators[i - 1]!.evaluate((a, b) => !!(a.compareDocumentPosition(b!) & Node.DOCUMENT_POSITION_FOLLOWING), next);
    expect(follows, `item ${i} comes after item ${i - 1}`).toBe(true);
  }
}

const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
/** Whether the element, or anything inside it, can take keyboard focus. */
export const focusable = (loc: Locator): Promise<boolean> =>
  loc.evaluate((el, sel) => el.matches(sel) || !!el.querySelector(sel), FOCUSABLE);
export const hasFocus = (loc: Locator): Promise<boolean> => loc.evaluate((el) => el.contains(document.activeElement));

/** Presses Tab until `target` has focus. */
export async function tabTo(page: Page, target: Locator, max = 60): Promise<void> {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`not reached in ${max} Tab presses: ${target}`);
}

/** Rendered text scale: font-size × CSS zoom, so either way of scaling text counts. */
export const textScale = (loc: Locator): Promise<number> =>
  loc.evaluate((el) => {
    const cs = getComputedStyle(el);
    return parseFloat(cs.fontSize) * (parseFloat(cs.zoom) || 1);
  });

/** Clicks somewhere inert outside any popup: the page's h1. */
export async function clickOutside(page: Page): Promise<void> {
  const box = (await page.getByRole('heading', { level: 1 }).first().boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + box.height / 2);
}

/** Each card's text in `scope`. A card is the largest element around one `anchor` text node (e.g. "D. No.") holding
 * no other anchor. innerText, so CSS capitals read as capitals; match it case-insensitively. */
export const cardTexts = (scope: Locator, anchor: RegExp): Promise<string[]> =>
  scope.evaluate((root, src) => {
    const re = new RegExp(src);
    const hits = [...root.querySelectorAll('*')].filter((e) =>
      [...e.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && re.test((n.textContent ?? '').trim())),
    );
    return hits.map((h) => {
      let card: Element = h;
      while (card.parentElement && card.parentElement !== root && hits.filter((x) => card.parentElement!.contains(x)).length === 1) {
        card = card.parentElement;
      }
      return (card as HTMLElement).innerText;
    });
  }, anchor.source);

// ---- tables ----------------------------------------------------------------------------------------------------

export const dataRows = (table: Locator): Locator => table.getByRole('row').filter({ has: table.page().getByRole('cell') });

/** The table's column headers: exactly these, in this order (headers are styled in capitals). */
export async function expectColumns(table: Locator, names: string[]): Promise<void> {
  const heads = table.getByRole('columnheader');
  await expect(heads).toHaveCount(names.length);
  for (const [i, n] of names.entries()) await expect(heads.nth(i)).toHaveAccessibleName(new RegExp(`^${esc(n)}(?=$|\\s)`, 'i'));
}

/** The visible text of one column, row by row (row headers count as a column). */
export async function column(table: Locator, name: string): Promise<string[]> {
  const heads = (await table.getByRole('columnheader').allTextContents()).map((h) => h.trim().toUpperCase());
  const i = heads.findIndex((h) => h.startsWith(name.toUpperCase()));
  expect(i, `column "${name}" in ${JSON.stringify(heads)}`).toBeGreaterThanOrEqual(0);
  return dataRows(table).evaluateAll(
    (rows, i) => rows.map((r) => ((r.children[i] as HTMLElement | undefined)?.innerText ?? '').trim()),
    i,
  );
}

export const firstNumber = (s: string): number => Number(/\d+/.exec(s)?.[0] ?? NaN);

/** dd/mm/yyyy at the start of a cell → epoch days (UTC), for ordering. */
export function epochDay(s: string): number {
  const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s);
  return m ? Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!) / 86_400_000 : NaN;
}
/** Today in epoch days, on the portal's calendar (India). */
export const today = (): number => Math.floor((Date.now() + 5.5 * 3_600_000) / 86_400_000);

// ---- KPI cards and list panels (Executive and Parliament user) -------------------------------------------------

export interface Kpi { label: string; purpose: string }
const kpiOf = (a: string, b: string, purpose: string): Kpi => ({ label: `${a} ${b}`, purpose });
export const KPIS = {
  uploaded: kpiOf(E.uploaded, E.questions, E.openUpload),
  provisional: kpiOf(E.provisional, E.questions, E.openUpload),
  admitted: kpiOf(E.admitted, E.questions, E.openAdmitted),
  assigned: kpiOf(E.assigned, E.questions, E.showAssigned),
  replies: kpiOf(E.replies, E.received, E.openRepoKpi),
  delayed: kpiOf(E.delayed, E.questions, E.showDelayed),
  transfer: kpiOf(E.transfer, E.requests, E.showReapproval),
};
export const DIV_KPIS = {
  provisional: kpiOf(D.provisional, D.questions, D.showProv),
  admitted: kpiOf(D.admitted, D.questions, D.showAdm),
  downloaded: kpiOf(D.replies, D.downloaded, D.showDl),
  collab: kpiOf(D.inputCollabKpi, D.received, D.collabPurpose),
  transfer: kpiOf(D.transfer, D.requests, D.goTransfer),
  delayed: kpiOf(D.delayed, D.questions, D.showDelayed),
};

/** A KPI link card: "<LABEL>: <n>. <purpose>". */
export const kpi = (page: Page, k: Kpi): Locator =>
  page.getByRole('link', { name: new RegExp(`^${esc(k.label)}: \\d+\\. ${esc(k.purpose)}$`) });
export async function kpiNumber(page: Page, k: Kpi): Promise<number> {
  return firstNumber((await accName(kpi(page, k))).slice(k.label.length));
}

export const kpiValues = (page: Page, kpis: Kpi[]): Promise<number[]> => Promise.all(kpis.map((k) => kpiNumber(page, k)));

export const LISTS = {
  assigned: { kpi: KPIS.assigned, title: E.assignedQ, sub: E.assignedSub },
  delayed: { kpi: KPIS.delayed, title: E.delayedQ, sub: E.delayedSub },
  reapproval: { kpi: KPIS.transfer, title: E.reapproval, sub: E.reapprovalSub },
};
export const LIST_COLUMNS = [E.colQuestion, E.colHouse, E.colSubject, E.colDivOfficer, E.colStatus, E.colDue, E.colAction];
export const ASSIGNED_CHIPS = [E.all, E.submitted, E.accepted, E.inProgress, E.forwarded, E.pendingTarget];
export const SEARCH_CHIPS = [E.all, E.draft, E.submitted, E.accepted, E.inProgress, E.forwarded, E.pendingTarget, E.completed];

/** Opens an in-page list panel from its KPI card. */
export async function openList(page: Page, list: (typeof LISTS)[keyof typeof LISTS]): Promise<Locator> {
  await kpi(page, list.kpi).click();
  const panel = region(page, list.title);
  await expect(panel).toBeVisible();
  return panel;
}
export const resultsTitle = (term: string): RegExp => new RegExp(`^${esc(E.resultsFor)}${esc(term)}["“”]$`);
export const panelTable = (panel: Locator): Locator => panel.getByRole('table');
/** A status chip: the label and its count, rendered with no separator. */
export const chip = (panel: Locator, label: string): Locator =>
  panel.getByRole('group', { name: E.filterByStatus, exact: true }).getByRole('button', { name: new RegExp(`^${esc(label)}\\s*\\d+$`) });
export const chipCount = async (c: Locator): Promise<number> => firstNumber((await accName(c)).replace(/^\D+/, ''));
/** The panel's paging status ("Showing <a>–<b> of <n> …" or "Showing 0 questions"). */
export const paging = (panel: Locator): Locator => panel.getByRole('status').filter({ hasText: new RegExp(`^${esc(E.showing)}`) });
export const pageButton = (panel: Locator, name: string): Locator => panel.getByRole('button', { name, exact: true });

// ---- analytics sections (Executive and Parliament user) --------------------------------------------------------

export const BREAKUP_COLUMNS = [E.colDivision, E.colJs, E.colAssigned, E.colProvisional, E.colAdmitted, E.colCompleted, E.colDelayed];
export const breakupTable = (page: Page): Locator =>
  region(page, E.breakup).getByRole('table', { name: E.breakupTable, exact: true });
export const topDelayedTable = (page: Page): Locator =>
  region(page, E.topDelayed).getByRole('table', { name: E.tdTable, exact: true });
export const sortHeader = (table: Locator, col: string): Locator =>
  table.getByRole('columnheader', { name: new RegExp(`^${esc(col)}`, 'i') });
/** "Sorted by <Column>, <highest|lowest> first. Use the column buttons to sort." */
export const sortNote = (col: string, dir: string): RegExp =>
  new RegExp(`^${esc(E.sortedBy)}${esc(col)}, ${esc(dir)}\\. ${esc(E.sortHint)}$`);

/** Rows run by `col` in this direction; ties by division name. */
export async function expectSorted(table: Locator, col: string, dir: 'ascending' | 'descending'): Promise<void> {
  const values = (await column(table, col)).map(firstNumber);
  const names = await column(table, E.colDivision);
  for (let i = 1; i < values.length; i++) {
    const [a, b] = [values[i - 1]!, values[i]!];
    const ok = a === b ? names[i - 1]!.localeCompare(names[i]!) <= 0 : dir === 'descending' ? a > b : a < b;
    expect(ok, `${col} ${dir}: row ${i} (${a}, ${names[i - 1]}) then (${b}, ${names[i]})`).toBe(true);
  }
}

/** Today's Action Plan cards (Executive and Parliament user): up to 3, each with its tags, fields and reminder buttons. */
export async function expectPlanCards(plan: Locator): Promise<void> {
  const cards = await cardTexts(plan, new RegExp(`^${esc(E.dno)}`));
  expect(cards.length).toBeGreaterThan(0);
  expect(cards.length).toBeLessThanOrEqual(3);
  const has = (card: string, ...alts: string[]) => expect(card).toMatch(new RegExp(`(?:${alts.map(esc).join('|')})`, 'i'));
  for (const card of cards) {
    has(card, E.high, E.medium, E.low);
    expect(card).toMatch(new RegExp(`\\b(?:${esc(E.starred)}|${esc(E.unstarred)})\\b`, 'i'));
    expect(card).toMatch(new RegExp(HOUSE, 'i'));
    expect(card).toMatch(new RegExp(`${esc(E.dno)} \\d+`, 'i'));
    for (const label of [E.division, E.officer, E.dueDate]) has(card, label);
    has(card, E.sendSms, E.smsSent);
    has(card, E.sendEmail, E.emailSent);
    if (new RegExp(`\\b${esc(E.starred)}\\b`, 'i').test(card)) has(card, E.high); // starred is always High
  }
}

/** AI Daily Briefing (Executive and Parliament user): 7 bullets, footer, and View Analytics → AI Routing Quality. */
export async function expectBriefing(page: Page): Promise<void> {
  const briefing = region(page, E.briefing);
  await expect(briefing.getByText(caps(E.todaySummary))).toBeVisible();
  await expect(briefing.getByRole('listitem')).toHaveCount(7);
  await expect(briefing.getByText(new RegExp(
    `^${esc(E.generated)}\\d{2}:\\d{2}${esc(E.from)}\\d+${esc(E.questionsComma)}\\d+${esc(E.divisionsAnd)}\\d+${esc(E.efileMoves)}$`,
  ))).toBeVisible();
  await briefing.getByRole('button', { name: E.viewAnalytics, exact: true }).click();
  const heading = region(page, E.routing).getByRole('heading', { name: E.routing, exact: true });
  await expect(heading).toBeFocused();
  await expect(heading).toBeInViewport();
}

/** AI Routing Quality (Executive and Parliament user): texts, donut, legend adding up to 100%, hover tooltips. */
export async function expectRouting(page: Page): Promise<void> {
  const routing = region(page, E.routing);
  for (const text of [E.routingSub, E.avgConf, E.acceptedWord, E.asSuggested, E.routingFoot]) {
    await expect(routing.getByText(text, { exact: true })).toBeVisible();
  }
  await expect(routing.getByRole('img', {
    name: new RegExp(`^\\d+% ${esc(E.topSugg)}, \\d+% ${esc(E.altSugg)}, \\d+% ${esc(E.manual)}$`, 'i'),
  })).toBeVisible();
  const legend = routing.getByRole('list', { name: E.routesList, exact: true }).getByRole('listitem');
  const labels = [E.topSugg, E.altSugg, E.manual];
  await expect(legend).toHaveCount(3);
  const share: number[] = [];
  for (const [i, label] of labels.entries()) {
    await expect(legend.nth(i)).toContainText(label);
    share.push(Number(/(\d+)%/.exec(await legend.nth(i).innerText())![1]));
  }
  expect(share.reduce((a, b) => a + b), 'the three shares add up to 100%').toBe(100);
  for (const [i, label] of labels.entries()) {
    await legend.nth(i).hover();
    const tip = page.getByRole('tooltip').filter({ hasText: label });
    await expect(tip).toContainText(`${share[i]}%`);
    await page.mouse.move(0, 0);
    await expect(tip).toBeHidden();
  }
}

/** Priority from the deadline: High when overdue, Medium when due within 2 days, otherwise Low. */
export function priorityFor(deadline: string): string {
  const left = deadline.startsWith(E.today) ? 0 : epochDay(deadline) - today();
  return left < 0 ? E.highTag : left <= 2 ? E.mediumTag : E.lowTag;
}

// ---- session calendar ------------------------------------------------------------------------------------------

export const sittingDateButton = (page: Page, persona: DesignPersona): Locator =>
  page.getByRole('button', {
    name:
      persona === 'division'
        ? new RegExp(`^${esc(D.sittingDate)}: .+\\. ${esc(E.openCal)}$`)
        : new RegExp(`^${esc(E.sittingDate)} ${DATE}\\. ${esc(E.openCal)}$`),
  });
export const calendar = (page: Page): Locator => page.getByRole('dialog', { name: E.calendar, exact: true });
export const dayGrid = (cal: Locator): Locator => cal.getByRole('group', { name: new RegExp(`^${esc(E.sittingDays)} `) });
/** "<d> <Month> <yyyy>, <Weekday>, <Lok Sabha sits|Rajya Sabha sits|no sitting>[, selected]" */
export const DAY = new RegExp(
  `^\\d{1,2} \\S+ \\d{4}, \\S+, (?:${HOUSE} ${esc(E.sits)}|${esc(E.noSitting)})(?:, ${esc(E.selected)})?$`,
);
export const sittingDay = (house = HOUSE): RegExp => new RegExp(`, ${house} ${esc(E.sits)}(?:, ${esc(E.selected)})?$`);
export const selectedDay = (cal: Locator): Locator =>
  dayGrid(cal).getByRole('button', { name: new RegExp(`, ${esc(E.selected)}$`) });
export const calButton = (cal: Locator, name: string): Locator => cal.getByRole('button', { name, exact: true });

/** "5 August 2026, Wednesday, …" → "05/08/2026", as the sitting date button writes it. */
export function dayDate(name: string): string {
  const d = new Date(`${name.split(',')[0]} UTC`);
  return [d.getUTCDate(), d.getUTCMonth() + 1].map((n) => String(n).padStart(2, '0')).join('/') + `/${d.getUTCFullYear()}`;
}
export const dayTime = (name: string): number => new Date(`${name.split(',')[0]} UTC`).getTime();

export async function openCalendar(page: Page, persona: DesignPersona): Promise<Locator> {
  await sittingDateButton(page, persona).click();
  await expect(calendar(page)).toBeVisible();
  return calendar(page);
}

/** The first enabled day button named like `name`, searching later months, then earlier ones. */
export async function findDay(cal: Locator, name: RegExp, skip?: string): Promise<Locator | undefined> {
  for (const step of [E.nextMonth, E.prevMonth]) {
    for (let i = 0; i < 24; i++) {
      const days = dayGrid(cal).getByRole('button', { name, disabled: false });
      for (let j = 0; j < (await days.count()); j++) if ((await accName(days.nth(j))) !== skip) return days.nth(j);
      if (await calButton(cal, step).isDisabled()) break;
      await calButton(cal, step).click();
    }
  }
  return undefined;
}

/** The House filter group of the Executive and Parliament boards, and the house it shows. */
export const houseGroup = (page: Page): Locator =>
  page.getByRole('group', { name: new RegExp(`^${esc(E.house)}: ${HOUSE}\\. ${esc(E.defaultRO)}$`) });
export const houseNow = async (page: Page): Promise<string> =>
  new RegExp(HOUSE).exec(await accName(houseGroup(page)))![0];

export const sessionGroup = (page: Page): Locator =>
  page.getByRole('group', { name: new RegExp(`^${esc(E.session)}: .+\\. ${esc(E.defaultRO)}$`) });

/** Applies a sitting day of the house that is not showing. Undefined when the session range has none. */
export async function applyOtherHouse(page: Page, persona: DesignPersona): Promise<{ house: string; date: string } | undefined> {
  const house = (await houseNow(page)) === E.lokSabha ? E.rajyaSabha : E.lokSabha;
  const cal = await openCalendar(page, persona);
  const day = await findDay(cal, sittingDay(esc(house)));
  if (!day) return undefined;
  const date = dayDate(await accName(day));
  await day.click();
  await calButton(cal, E.apply).click();
  await expect(cal).toBeHidden();
  return { house, date };
}

/** Applies any sitting day other than the one applied now; returns its dd/mm/yyyy. */
export async function applyOtherDay(page: Page, persona: DesignPersona): Promise<string | undefined> {
  const cal = await openCalendar(page, persona);
  const current = (await selectedDay(cal).count()) ? await accName(selectedDay(cal)) : undefined;
  const day = await findDay(cal, sittingDay(), current);
  if (!day) return undefined;
  const date = dayDate(await accName(day));
  await day.click();
  await calButton(cal, E.apply).click();
  await expect(cal).toBeHidden();
  return date;
}

// ---- single-select dropdowns (Dashboard scope, Question type) --------------------------------------------------

export const dropdown = (page: Page, label: string): Locator =>
  page.getByRole('button', { name: new RegExp(`^${esc(label)}: `) });
export const listbox = (page: Page, label: string): Locator => page.getByRole('listbox', { name: label, exact: true });

/** Picks an option by name (or index) and returns the option's name. */
export async function choose(page: Page, label: string, option: string | number): Promise<string> {
  await dropdown(page, label).click();
  const opts = listbox(page, label).getByRole('option');
  const opt = typeof option === 'number' ? opts.nth(option) : listbox(page, label).getByRole('option', { name: option, exact: true });
  const name = await accName(opt);
  await opt.click();
  await expect(dropdown(page, label)).toHaveAccessibleName(`${label}: ${name}`);
  return name;
}

// ---- Export Data -----------------------------------------------------------------------------------------------

/** Clicks Export Data; returns the download's file name and text (BOM kept). */
export async function exportCsv(page: Page): Promise<{ name: string; text: string }> {
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: E.export, exact: true }).click();
  const d = await dl;
  return { name: d.suggestedFilename(), text: await readFile(await d.path(), 'utf8') };
}

/** The CSV holds this row, cells compared unquoted. Only the header rows the design names are checked. */
export function expectCsvRow(text: string, cells: string[]): void {
  const rows = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')).join(','));
  expect(rows, 'CSV header row').toContain(cells.join(','));
}
export const ISO_DAY = '\\d{4}-\\d{2}-\\d{2}';
