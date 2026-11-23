import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures.js';
import { notMeasured } from '../../support/annotations.js';
import { labels } from '../labels/dashboards.js';
import type { ExecutiveLabels } from '../labels/dashboards.js';
import {
  ANY, ASSIGNED_CHIPS, BREAKUP_COLUMNS, DATE, HOUSE, ISO_DAY, KPIS, LISTS, LIST_COLUMNS, NONE, P, SEARCH_CHIPS, accName, back,
  breakupTable, calButton, caps, chip, chipCount, choose, column, dataRows, dayDate, dropdown, esc, expectColumns,
  expectCsvRow, expectBriefing, expectLeft, expectOrder, expectPlanCards, expectRouting, expectRoleLabel, expectSorted, exportCsv, findDay, firstNumber, focusable, h1, houseGroup,
  houseNow, kpi, kpiValues, listbox, menu, menuLink, need, notifications, openCalendar, openList, openNotifications, pageButton,
  paging, panelTable, priorityFor, region, resultsTitle, search, searchbox, sections, selectedDay, sittingDateButton, sittingDay,
  sessionGroup, sortHeader, sortNote, toast, topDelayedTable, updated, UPDATED, applyOtherHouse,
} from './dashboards-nav.js';

// DS-EXEC: Session Command Centre for the Joint Secretary / Director. Read-only: scope, sitting date and lists change only
// what the page shows. Reminder sends (Remind, Send SMS, Send Email, Remind all overdue) go to division officers, whom a
// test cannot point at a tester contact, so those cases stay Manual.

const L = labels['FigmaTestingCal2-5g42.dc.html']! as ExecutiveLabels;
const ME = 'executive' as const;
const ALL_KPIS = Object.values(KPIS);

/** The filter bar's status note: "Showing <scope> · <House>. The Dashboard Scope applies to …". */
const scopeNote = (page: Page): Locator => page.getByRole('status').filter({ hasText: new RegExp(`${esc(L.scopeNote)}$`) });
const noteFor = (scope: string, house = HOUSE): RegExp =>
  new RegExp(`^${esc(L.showing)}${esc(scope)} · ${house}\\. ${esc(L.scopeNote)}$`);

test.describe('DS-EXEC — Executive Dashboard (design)', () => {
  test('DS-EXEC-01 Page header, persona and search label', async ({ as }) => {
    const page = await as(ME);
    const heading = h1(page, ME);
    const refresh = page.getByRole('button', { name: L.refresh, exact: true });
    const exportData = page.getByRole('button', { name: L.export, exact: true });
    await expect(heading).toBeVisible();
    await expect(exportData).toContainText(L.exportText);
    await expect(updated(page)).toContainText(UPDATED);
    await expectOrder([
      heading, page.getByText(L.sub, { exact: true }), page.getByText(new RegExp(`^${esc(L.lastUpdated)}`)).first(), refresh, exportData,
    ]);
    await expectRoleLabel(page, L.role);
    await expect(searchbox(page, ME)).toHaveAttribute('placeholder', L.placeholder);
  });

  test('DS-EXEC-02 Sidebar items, and Dashboard resets panels', async ({ as }) => {
    const page = await as(ME);
    await expect(sections(page).getByRole('link')).toHaveCount(2);
    await expectOrder([menuLink(page, L.dashboard), menuLink(page, L.aiAssistant)]);
    await expect(menuLink(page, L.dashboard)).toHaveAttribute('aria-current', 'page');
    await expect(menu(page).getByRole('button', { name: P.settings, exact: true })).toHaveCount(0);
    const panel = await openList(page, LISTS.assigned);
    await searchbox(page, ME).fill(NONE);
    await openNotifications(page);
    await menuLink(page, L.dashboard).click();
    await expect(panel).toBeHidden();
    await expect(notifications(page)).toBeHidden();
    await expect(searchbox(page, ME)).toHaveValue('');
  });

  test('DS-EXEC-03 AI Assistant menu item', async ({ as }) => {
    const page = await as(ME);
    await menuLink(page, L.aiAssistant).click();
    await expectLeft(page, ME);
  });

  test('DS-EXEC-04 Filter bar layout and defaults', async ({ as }) => {
    const page = await as(ME);
    const label = (s: string) => page.getByRole('main').getByText(caps(s)).first();
    await expectOrder([label(L.scope), label(L.sittingDate), label(L.house), label(L.session)]);
    await expect(dropdown(page, L.scope)).toHaveAccessibleName(`${L.scope}: ${L.parliament}`);
    await expect(dropdown(page, L.scope)).toContainText(L.parliament);
    await expect(sittingDateButton(page, ME)).toContainText(new RegExp(DATE));
    for (const group of [houseGroup(page), sessionGroup(page)]) {
      await expect(group).toBeVisible();
      expect(await focusable(group), 'read-only group, nothing focusable').toBe(false);
    }
    await expect(page.getByRole('button', { name: new RegExp(`^${esc(P.qtype)}: `) })).toHaveCount(0);
    await expect(page.getByRole('button', { name: L.reset, exact: true })).toHaveCount(0);
    await expect(scopeNote(page)).toHaveText(noteFor(L.parliament));
  });

  test('DS-EXEC-05 Dashboard scope options', async ({ as }) => {
    const page = await as(ME);
    await dropdown(page, L.scope).click();
    const options = listbox(page, L.scope).getByRole('option');
    await expect(options.first()).toHaveAccessibleName(L.parliament);
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    expect(await options.count(), 'one option per division after Parliament').toBeGreaterThan(1);
  });

  test('DS-EXEC-06 Division scope updates the note and KPIs', async ({ as }) => {
    const page = await as(ME);
    const before = await kpiValues(page, ALL_KPIS);
    const division = await choose(page, L.scope, 1);
    await expect(scopeNote(page)).toHaveText(noteFor(division));
    await expect.poll(() => kpiValues(page, ALL_KPIS), 'KPI cards show the division figures').not.toEqual(before);
    const after = await kpiValues(page, ALL_KPIS);
    after.forEach((n, i) => expect(n, `${ALL_KPIS[i]!.label} within the Parliament figure`).toBeLessThanOrEqual(before[i]!));
  });

  test('DS-EXEC-07 Division scope narrows the analytics sections', async ({ as }) => {
    const page = await as(ME);
    const donut = region(page, L.routing).getByRole('img');
    const routingBefore = await accName(donut);
    const division = await choose(page, L.scope, 1);
    const workload = region(page, L.workload);
    const rows = workload.getByRole('list', { name: L.workloadList, exact: true }).getByRole('listitem');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveText(new RegExp(`#1[\\s\\S]*${esc(division)}[\\s\\S]*100%`));
    await expect(workload.getByText(L.noOther, { exact: true })).toBeVisible();
    await expect(workload.getByText('0%', { exact: true })).toBeVisible();
    await expect(workload.getByRole('button', { name: L.viewAll, exact: true })).toHaveCount(0);
    const breakup = region(page, L.breakup);
    await expect(breakup.getByRole('rowheader')).toHaveCount(1);
    await expect(breakup.getByRole('rowheader')).toHaveText(division);
    await expect(breakup.getByRole('button', { name: L.viewAll, exact: true })).toHaveCount(0);
    await expect.poll(() => accName(donut), 'AI Routing Quality shows the division figures').not.toBe(routingBefore);
    for (const cell of await column(topDelayedTable(page), L.colDivOfficer)) expect(cell).toContain(division);
  });

  test('DS-EXEC-08 Scope does not change Action Plan or Briefing; Parliament restores all', async ({ as }) => {
    const page = await as(ME);
    const [plan, briefing] = [region(page, L.actionPlan), region(page, L.briefing)];
    const [planText, briefingText] = [await plan.innerText(), await briefing.innerText()];
    const division = await choose(page, L.scope, 1);
    await expect(scopeNote(page)).toHaveText(noteFor(division));
    expect(await plan.innerText(), "Today's Action Plan ignores the scope").toBe(planText);
    expect(await briefing.innerText(), 'AI Daily Briefing ignores the scope').toBe(briefingText);
    await choose(page, L.scope, L.parliament);
    const workload = region(page, L.workload);
    await expect(workload.getByRole('list', { name: L.workloadList, exact: true }).getByRole('listitem')).toHaveCount(4);
    await expect(workload.getByText(new RegExp(`^\\d+${esc(L.across)}\\d+${esc(L.otherDivs)}$`))).toBeVisible();
    await expect(workload.getByRole('button', { name: L.viewAll, exact: true })).toBeVisible();
    const breakup = region(page, L.breakup);
    await expect(breakup.getByRole('rowheader')).toHaveCount(6);
    await expect(breakup.getByRole('button', { name: L.viewAll, exact: true })).toBeVisible();
  });

  test('DS-EXEC-09 Applying a sitting date sets House and session', async ({ as }) => {
    const page = await as(ME);
    const applied = await applyOtherHouse(page, ME);
    need(applied, 'no sitting day of the other house in the session calendar');
    const button = sittingDateButton(page, ME);
    await expect(button).toBeFocused();
    await expect(button).toHaveAccessibleName(new RegExp(`^${esc(L.sittingDate)} ${esc(applied.date)}\\. `));
    await expect(houseGroup(page)).toHaveAccessibleName(new RegExp(`^${esc(L.house)}: ${esc(applied.house)}\\. `));
    await expect(scopeNote(page)).toHaveText(noteFor(L.parliament, esc(applied.house)));
    for (const house of await column(topDelayedTable(page), L.colHouse)) expect(house).toContain(applied.house);
    const panel = await openList(page, LISTS.assigned);
    for (const house of await column(panelTable(panel), L.colHouse)) expect(house).toContain(applied.house);
  });

  test('DS-EXEC-10 Calendar specifics for the Executive', async ({ as }) => {
    const page = await as(ME);
    const appliedDate = new RegExp(DATE).exec(await accName(sittingDateButton(page, ME)))![0];
    const cal = await openCalendar(page, ME);
    await expect(cal.getByText(L.calSub, { exact: true })).toBeVisible();
    const applied = await accName(selectedDay(cal));
    expect(dayDate(applied), 'the applied day is the selected one').toBe(appliedDate);
    await expect(selectedDay(cal)).toHaveAttribute('aria-pressed', 'true');
    const other = await findDay(cal, sittingDay(), applied);
    need(other, 'only one sitting day in the session calendar');
    await other.click();
    await expect(calButton(cal, L.apply)).toBeEnabled();
    await calButton(cal, L.reset).click();
    await expect(selectedDay(cal)).toHaveAccessibleName(applied);
    await expect(selectedDay(cal)).toBeFocused();
    await expect(calButton(cal, L.apply)).toBeEnabled();
  });

  test('DS-EXEC-11 KPI cards: order and accessible names', async ({ as }) => {
    const page = await as(ME);
    const cards = ALL_KPIS.map((k) => kpi(page, k));
    for (const card of cards) await expect(card).toBeVisible();
    await expectOrder(cards);
    await expect(page.getByRole('link', { name: /^[A-Z ]+: \d+\. / })).toHaveCount(7);
  });

  test('DS-EXEC-12 KPI cards that open other screens', async ({ as }) => {
    const page = await as(ME);
    for (const k of [KPIS.uploaded, KPIS.provisional, KPIS.admitted, KPIS.replies]) {
      await test.step(k.label, async () => {
        await kpi(page, k).click();
        await expectLeft(page, ME);
        await back(page, ME);
      });
    }
  });

  test('DS-EXEC-13 KPI cards that open in-page lists', async ({ as }) => {
    const page = await as(ME);
    const plan = region(page, L.actionPlan);
    for (const list of [LISTS.assigned, LISTS.delayed, LISTS.reapproval]) {
      await test.step(list.title, async () => {
        const panel = await openList(page, list);
        await expect(panel.getByRole('heading', { name: list.title, exact: true })).toBeFocused();
        await expect(panel).toBeInViewport();
        await expect(panel.getByText(list.sub, { exact: true })).toBeVisible();
        await expectOrder([panel, plan]);
      });
    }
  });

  test('DS-EXEC-14 List panel table, overdue flag and Close list', async ({ as }) => {
    const page = await as(ME);
    const panel = await openList(page, LISTS.assigned);
    const table = panel.getByRole('table', { name: L.assignedQ, exact: true });
    await expectColumns(table, LIST_COLUMNS);
    const status = new RegExp(`^(?:${[L.submitted, L.accepted, L.inProgress, L.forwarded, L.pendingTarget].map(esc).join('|')})`, 'i');
    for (const q of await column(table, L.colQuestion)) {
      expect(q).toMatch(/Q \*?\d+/);
      expect(q).toMatch(new RegExp(`\\b(?:${esc(L.starred)}|${esc(L.unstarred)})\\b`, 'i'));
    }
    for (const h of await column(table, L.colHouse)) expect(h).toMatch(new RegExp(HOUSE));
    for (const s of await column(table, L.colStatus)) {
      expect(s).toMatch(status);
      if (/overdue/i.test(s)) expect(s).toMatch(new RegExp(`${esc(L.overdue)}\\d+d`, 'i'));
    }
    await panel.getByRole('button', { name: L.closeList, exact: true }).click();
    await expect(panel).toBeHidden();
  });

  test('DS-EXEC-15 Status chips filter the Assigned list', async ({ as }) => {
    const page = await as(ME);
    const panel = await openList(page, LISTS.assigned);
    await expect(panel.getByRole('group', { name: L.filterByStatus, exact: true }).getByRole('button')).toHaveCount(ASSIGNED_CHIPS.length);
    await expectOrder(ASSIGNED_CHIPS.map((c) => chip(panel, c)));
    await expect(chip(panel, L.all)).toHaveAttribute('aria-pressed', 'true');
    if (await pageButton(panel, L.next).isEnabled()) await pageButton(panel, L.next).click(); // so the reset to page 1 shows
    const n = await chipCount(chip(panel, L.inProgress));
    await chip(panel, L.inProgress).click();
    await expect(chip(panel, L.inProgress)).toHaveAttribute('aria-pressed', 'true');
    const table = panelTable(panel);
    await expect(dataRows(table)).toHaveCount(Math.min(n, 6));
    for (const s of await column(table, L.colStatus)) expect(s).toMatch(new RegExp(`^${esc(L.inProgress)}`, 'i'));
    await expect(paging(panel)).toHaveText(n ? new RegExp(`^${esc(L.showing)}1–\\d+ of ${n}\\b`) : L.showing0);
    const all = await chipCount(chip(panel, L.all));
    await chip(panel, L.all).click();
    await expect(dataRows(table)).toHaveCount(Math.min(all, 6));
    for (const list of [LISTS.delayed, LISTS.reapproval]) {
      const other = await openList(page, list);
      await expect(other.getByRole('group', { name: L.filterByStatus, exact: true })).toHaveCount(0);
    }
  });

  test('DS-EXEC-16 List paging', async ({ as }) => {
    const page = await as(ME);
    const panel = await openList(page, LISTS.assigned);
    need((await chipCount(chip(panel, L.all))) > 6, 'the Assigned list holds 6 questions or fewer');
    const rows = dataRows(panelTable(panel));
    const [prev, next] = [pageButton(panel, L.prev), pageButton(panel, L.next)];
    await expect(rows).toHaveCount(6);
    await expect(paging(panel)).toHaveText(new RegExp(`^${esc(L.showing)}1–6 of \\d+ .*${esc(L.assignedTotal)}$`));
    await expect(prev).toBeDisabled();
    for (let i = 0; i < 50 && (await next.isEnabled()); i++) await next.click();
    await expect(next).toBeDisabled();
    const [, to, of] = /–(\d+) of (\d+)/.exec(await paging(panel).innerText())!;
    expect(to, 'the last page ends at the total').toBe(of);
    await prev.click();
    await expect(rows).toHaveCount(6);
  });

  test('DS-EXEC-17 Empty list state', async ({ as }) => {
    const page = await as(ME);
    const panel = await openList(page, LISTS.assigned);
    let empty: Locator | undefined;
    for (const c of ASSIGNED_CHIPS.slice(1)) if (!empty && (await chipCount(chip(panel, c))) === 0) empty = chip(panel, c);
    need(empty, 'no status chip with count 0 in Assigned questions');
    await empty.click();
    // OQ-7: "No sample questions match…" is prototype wording, so the message text itself is not asserted.
    await expect(dataRows(panelTable(panel))).toHaveCount(0);
    await expect(paging(panel)).toHaveText(L.showing0);
    await expect(pageButton(panel, L.prev)).toBeDisabled();
    await expect(pageButton(panel, L.next)).toBeDisabled();
  });

  test('DS-EXEC-19 No Remind for Completed or Draft questions', async ({ as }) => {
    const page = await as(ME);
    await search(page, ME, ANY);
    const panel = region(page, resultsTitle(ANY));
    await expect(panel).toBeVisible();
    const counts = [await chipCount(chip(panel, L.completed)), await chipCount(chip(panel, L.draft))];
    need(counts.some(Boolean), `no Completed or Draft question matches "${ANY}"`);
    for (const c of [L.completed, L.draft]) {
      await chip(panel, c).click();
      await expect(chip(panel, c)).toHaveAttribute('aria-pressed', 'true');
      for (const action of await column(panelTable(panel), L.colAction)) expect(action, `${c}: ACTION cell`).toBe('');
    }
  });

  test('DS-EXEC-20 Header search shows results', async ({ as }) => {
    const page = await as(ME);
    const house = await houseNow(page);
    await search(page, ME, ANY);
    const panel = region(page, resultsTitle(ANY));
    await expect(panel.getByRole('heading', { name: resultsTitle(ANY) })).toBeFocused();
    await expect(panel.getByText(L.matchesOn, { exact: true })).toBeVisible();
    await expect(panel.getByRole('group', { name: L.filterByStatus, exact: true }).getByRole('button')).toHaveCount(SEARCH_CHIPS.length);
    await expectOrder(SEARCH_CHIPS.map((c) => chip(panel, c)));
    await expect(panel.getByRole('link', { name: L.openRepo, exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: L.closeList, exact: true })).toBeVisible();
    for (const h of await column(panelTable(panel), L.colHouse)) expect(h, 'results follow the sitting date house').toContain(house);
  });

  test('DS-EXEC-21 Search with no match, then clearing', async ({ as }) => {
    const page = await as(ME);
    await search(page, ME, NONE);
    const panel = region(page, resultsTitle(NONE));
    // OQ-7: the "No sample questions match…" message is prototype wording; only the empty structure is asserted.
    await expect(dataRows(panelTable(panel))).toHaveCount(0);
    await expect(paging(panel)).toHaveText(L.showing0);
    await search(page, ME, '');
    await expect(panel).toBeHidden();
  });

  test('DS-EXEC-22 Open Repository from Completed or search results', async ({ as }) => {
    const page = await as(ME);
    await search(page, ME, ANY);
    await region(page, resultsTitle(ANY)).getByRole('link', { name: L.openRepo, exact: true }).click();
    await expectLeft(page, ME);
    await expect
      .poll(() => page.locator('input').evaluateAll((els, q) => els.some((e) => (e as HTMLInputElement).value === q), ANY), 'the query is carried')
      .toBe(true);
  });

  test("DS-EXEC-23 Today's Action Plan: structure and View All", async ({ as }) => {
    const page = await as(ME);
    const plan = region(page, L.actionPlan);
    await expect(plan.getByRole('status').first()).toHaveText(
      new RegExp(`^\\d+(?:${esc(L.itemsNeed)}|${esc(L.itemNeeds)})${esc(L.aDecision)}$`),
    );
    await expectPlanCards(plan);
    await plan.getByRole('link', { name: L.viewAllPlan, exact: true }).click();
    await expect(region(page, L.assignedQ)).toBeVisible();
  });

  test('DS-EXEC-29 AI Daily Briefing and View Analytics', async ({ as }) => {
    await expectBriefing(await as(ME));
  });

  test('DS-EXEC-30 Division Work Load', async ({ as }) => {
    const page = await as(ME);
    const workload = region(page, L.workload);
    await expect(workload.getByText(L.workloadSub, { exact: true })).toBeVisible();
    const list = workload.getByRole('list', { name: L.workloadList, exact: true });
    const rows = list.getByRole('listitem');
    await expect(rows).toHaveCount(4);
    for (let i = 0; i < 4; i++) await expect(rows.nth(i)).toHaveText(new RegExp(`#${i + 1}[\\s\\S]*\\d+%[\\s\\S]*\\d+`));
    const summary = workload.getByText(new RegExp(`^\\d+${esc(L.across)}\\d+${esc(L.otherDivs)}$`));
    await expect(summary).toBeVisible();
    const others = Number(new RegExp(`(\\d+)${esc(L.otherDivs)}`).exec(await summary.innerText())![1]);
    await expect(list.getByRole('button')).toHaveCount(0);
    await expect(list.getByRole('link')).toHaveCount(0);
    const viewAll = workload.getByRole('button', { name: L.viewAll, exact: true });
    await viewAll.click();
    const top4 = workload.getByRole('button', { name: L.showTop4, exact: true });
    await expect(top4).toHaveAttribute('aria-expanded', 'true');
    await expect(rows).toHaveCount(4 + others);
    await expect(summary).toBeHidden();
    await expect(list, 'the long list can take focus to scroll').toHaveAttribute('tabindex', '0');
    await top4.click();
    await expect(viewAll).toHaveAttribute('aria-expanded', 'false');
    await expect(rows).toHaveCount(4);
    await expect(summary).toBeVisible();
  });

  test('DS-EXEC-31 AI Routing Quality', async ({ as }) => {
    await expectRouting(await as(ME));
  });

  test('DS-EXEC-32 Division-wise Breakup: structure and default sort', async ({ as }) => {
    const page = await as(ME);
    const table = breakupTable(page);
    await expect(region(page, L.breakup).getByText(L.breakupSub, { exact: true })).toBeVisible();
    await expectColumns(table, BREAKUP_COLUMNS);
    await expect(table.getByRole('rowheader')).toHaveCount(6);
    await expect(sortHeader(table, L.colAssigned)).toHaveAttribute('aria-sort', 'descending');
    for (const col of [L.colProvisional, L.colAdmitted, L.colCompleted, L.colDelayed]) {
      await expect(sortHeader(table, col)).toHaveAttribute('aria-sort', 'none');
    }
    await expect(region(page, L.breakup).getByText(sortNote(L.colAssigned, L.highest))).toBeVisible();
  });

  test('DS-EXEC-33 Division-wise Breakup: sorting', async ({ as }) => {
    const page = await as(ME);
    const table = breakupTable(page);
    const sort = table.getByRole('button', { name: caps(L.colProvisional) });
    const tip = (dir: string) =>
      page.getByRole('tooltip').filter({ hasText: new RegExp(`^${esc(L.sortBy)}${esc(L.colProvisional)}, ${esc(dir)}$`) });
    await sort.hover();
    await expect(tip(L.highest)).toBeVisible();
    for (const [dir, aria] of [[L.highest, 'descending'], [L.lowest, 'ascending']] as const) {
      await test.step(dir, async () => {
        await sort.click();
        await expect(sortHeader(table, L.colProvisional)).toHaveAttribute('aria-sort', aria);
        await expect(region(page, L.breakup).getByText(sortNote(L.colProvisional, dir))).toBeVisible();
        await expectSorted(table, L.colProvisional, aria);
      });
      if (aria === 'descending') await expect(tip(L.lowest)).toBeVisible();
    }
  });

  test('DS-EXEC-34 Division-wise Breakup: View All and number rules', async ({ as }) => {
    const page = await as(ME);
    const section = region(page, L.breakup);
    const table = breakupTable(page);
    await section.getByRole('button', { name: L.viewAll, exact: true }).click();
    const top6 = section.getByRole('button', { name: L.showTop6, exact: true });
    await expect(top6).toHaveAttribute('aria-expanded', 'true');
    expect(await table.getByRole('rowheader').count()).toBeGreaterThanOrEqual(6);
    const [assigned, prov, adm, done, late] = await Promise.all(
      [L.colAssigned, L.colProvisional, L.colAdmitted, L.colCompleted, L.colDelayed].map(async (c) => (await column(table, c)).map(firstNumber)),
    );
    assigned!.forEach((n, i) => {
      expect(n, `row ${i + 1}: assigned = provisional + admitted`).toBe(prov![i]! + adm![i]!);
      expect(done![i]!, `row ${i + 1}: completed ≤ admitted`).toBeLessThanOrEqual(adm![i]!);
      expect(late![i]!, `row ${i + 1}: delayed ≤ admitted`).toBeLessThanOrEqual(adm![i]!);
    });
    await top6.click();
    await expect(table.getByRole('rowheader')).toHaveCount(6);
  });

  test('DS-EXEC-35 Top Delayed Questions: structure, priority and View All', async ({ as }) => {
    const page = await as(ME);
    const section = region(page, L.topDelayed);
    const table = topDelayedTable(page);
    await expect(section.getByText(L.tdSub, { exact: true })).toBeVisible();
    await expectColumns(table, [L.colDiary, L.colHouse, L.colQuestion, L.colDivOfficer, L.colDays, L.colDeadline, L.colPriority, L.colAction]);
    expect(await dataRows(table).count()).toBeLessThanOrEqual(5);
    const days = (await column(table, L.colDays)).map(firstNumber);
    days.slice(1).forEach((d, i) => expect(d, 'days pending, highest first').toBeLessThanOrEqual(days[i]!));
    const priorities = await column(table, L.colPriority);
    for (const [i, deadline] of (await column(table, L.colDeadline)).entries()) {
      expect(deadline).toMatch(new RegExp(`^(?:${esc(L.today)}|${DATE})`));
      expect(priorities[i]!.toLowerCase(), `priority for deadline ${deadline}`).toContain(priorityFor(deadline).toLowerCase());
    }
    await section.getByRole('link', { name: L.viewAllDelayed, exact: true }).click();
    await expect(region(page, L.delayedQ)).toBeVisible();
  });

  test('DS-EXEC-37 Top Delayed Questions: empty state', async () => {
    notMeasured(test.info(), { tracker: 'design-OQ', owner: 'UI/UX', detail: 'OQ-7: the empty state says "Press Reset" but the Executive filter bar has no Reset' });
  });

  test('DS-EXEC-38 Export Data CSV follows scope', async ({ as }) => {
    const page = await as(ME);
    const csv = await exportCsv(page);
    expect(csv.name).toMatch(new RegExp(`^${esc(L.csvFile)}${ISO_DAY}\\.csv$`));
    expect(csv.text.charCodeAt(0), 'UTF-8 with BOM').toBe(0xfeff);
    expectCsvRow(csv.text, [L.csvKpi, L.csvValue]);
    expectCsvRow(csv.text, [L.colDivision, L.colJs, L.colAssigned, L.colProvisional, L.colAdmitted, L.colCompleted, L.colDelayed]);
    expectCsvRow(csv.text, [L.colDiary, L.csvQno, L.colQuestion, L.colHouse, L.colDivision, L.csvOfficer, L.colDays, L.colDeadline]);
    await expect(toast(page, new RegExp(`${esc(L.exported)}${esc(csv.name)}\\.`))).toBeVisible();
    await choose(page, L.scope, 1);
    const scoped = await exportCsv(page);
    expect(scoped.name).toMatch(new RegExp(`^${esc(L.csvFile)}[a-z0-9-]+-${ISO_DAY}\\.csv$`));
    expect(scoped.name).not.toBe(csv.name);
  });

  test('DS-EXEC-39 Notifications panel for the Executive', async ({ as }) => {
    const page = await as(ME);
    const dialog = await openNotifications(page);
    await expect(dialog.getByText(new RegExp(`^${esc(L.autoReminder)}\\S`))).toBeVisible();
    await expect(dialog.getByRole('button', { name: new RegExp(`^${esc(L.remindAll)}\\d+\\)$`) })).toBeVisible();
    await dialog.getByRole('link', { name: L.reminderSettings, exact: true }).click();
    await expectLeft(page, ME);
  });
});
