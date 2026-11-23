import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures.js';
import { labels } from '../labels/dashboards.js';
import type { ParliamentLabels } from '../labels/dashboards.js';
import {
  ANY, ASSIGNED_CHIPS, BREAKUP_COLUMNS, E, HOUSE, ISO_DAY, KPIS, LISTS, LIST_COLUMNS, MENU, SEARCH_CHIPS, accName, applyOtherDay,
  applyOtherHouse, back, breakupTable, caps, chip, chipCount, choose, column, dataRows, dropdown, esc, expectBriefing,
  expectColumns, expectCsvRow, expectLeft, expectOrder, expectPlanCards, expectRoleLabel, expectRouting, expectSorted, exportCsv,
  focusable, h1, houseGroup, houseNow, kpi, kpiValues, listbox, menu, menuLink, need, openCalendar, openList, pageButton, paging,
  panelTable, region, resultsTitle, search, searchbox, sessionGroup, shows, sittingDateButton, sortHeader, sortNote, toast,
  topDelayedTable, updated, UPDATED,
} from './dashboards-nav.js';

// DS-PARL: Platform Analytics for the Parliament Section user. Read-only: filters and lists change only what the page
// shows. Reminder sends go to division officers, whom a test cannot point at a tester contact, so those cases stay Manual.

const L = labels['FigmaTestingCal2-5g42-ux4gbar.dc.html']! as ParliamentLabels;
const ME = 'parliament' as const;
const ALL_KPIS = Object.values(KPIS);
const SETTINGS = [L.users, L.addDivisions, L.designations, L.sessions, L.ingestion, L.garden, L.deadlines];

/** The filter bar note: "Showing <House>[, <type> questions]. This applies to the question lists …". */
const appliesNote = (page: Page): Locator => page.getByRole('status').filter({ hasText: new RegExp(`${esc(L.appliesNote)}$`) });
const noteFor = (house = HOUSE, type?: string): RegExp =>
  new RegExp(`^${esc(E.showing)}${house}${type ? `, ${esc(type)}${esc(L.questionsWord)}` : ''}\\. ${esc(L.appliesNote)}$`);
const settingsButton = (page: Page): Locator => menu(page).getByRole('button', { name: L.settings, exact: true });
const settingsList = (page: Page): Locator => menu(page).getByRole('list', { name: L.settings, exact: true });
const filterReset = (page: Page): Locator => page.getByRole('button', { name: L.reset, exact: true });

test.describe('DS-PARL — Parliament user dashboard (design)', () => {
  test('DS-PARL-01 Page header, persona and search label', async ({ as }) => {
    const page = await as(ME);
    const heading = h1(page, ME);
    const refresh = page.getByRole('button', { name: E.refresh, exact: true });
    const exportData = page.getByRole('button', { name: E.export, exact: true });
    await expect(heading).toBeVisible();
    await expect(exportData).toContainText(E.exportText);
    await expect(updated(page)).toContainText(UPDATED);
    await expectOrder([
      heading, page.getByText(L.sub, { exact: true }), page.getByText(new RegExp(`^${esc(E.lastUpdated)}`)).first(), refresh, exportData,
    ]);
    await expectRoleLabel(page, L.role);
    await expect(searchbox(page, ME)).toBeVisible();
  });

  test('DS-PARL-02 Upload Provisional Question card', async ({ as }) => {
    const page = await as(ME);
    await expect(page.getByText(L.uploadProv, { exact: true })).toBeVisible();
    await expect(page.getByText(L.uploadProvSub, { exact: true })).toBeVisible();
    await page.getByRole('link', { name: L.uploadDoc, exact: true }).click();
    await expectLeft(page, ME);
  });

  test('DS-PARL-03 Upload Admitted Questions card', async ({ as }) => {
    const page = await as(ME);
    await expect(page.getByText(L.uploadAdm, { exact: true })).toBeVisible();
    await expect(page.getByText(L.uploadAdmSub, { exact: true })).toBeVisible();
    await page.getByRole('link', { name: L.uploadBulletin, exact: true }).click();
    await expectLeft(page, ME);
  });

  test('DS-PARL-05 Sidebar items and Settings group', async ({ as }) => {
    const page = await as(ME);
    const items = MENU.parliament.map((name) => menuLink(page, name));
    for (const item of items) await expect(item).toBeVisible();
    await expect(menuLink(page, E.dashboard)).toHaveAttribute('aria-current', 'page');
    const button = settingsButton(page);
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    const list = settingsList(page);
    await expect(button).toHaveAttribute('aria-controls', (await list.getAttribute('id'))!);
    const subItems = SETTINGS.map((name) => list.getByRole('link', { name, exact: true }));
    for (const item of subItems) await expect(item).toBeVisible();
    await expectOrder([...items, button, ...subItems]);
    await expect(menu(page).getByRole('link', { name: E.aiAssistant, exact: true })).toHaveCount(0);
  });

  test('DS-PARL-06 Collapse and expand Settings', async ({ as }) => {
    const page = await as(ME);
    const button = settingsButton(page);
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(settingsList(page)).toBeHidden();
    await button.click();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(settingsList(page).getByRole('link')).toHaveCount(SETTINGS.length);
  });

  test('DS-PARL-07 Settings sub-items open Parliament Section settings', async ({ as }) => {
    const page = await as(ME);
    for (const name of SETTINGS) {
      await test.step(name, async () => {
        await settingsList(page).getByRole('link', { name, exact: true }).click();
        await expectLeft(page, ME);
        await back(page, ME);
      });
    }
  });

  test('DS-PARL-08 Provisional and Admitted Questions menu items', async ({ as }) => {
    const page = await as(ME);
    await menuLink(page, L.provisionalQ).click();
    await expectLeft(page, ME);
    await back(page, ME);
    await menuLink(page, L.admittedQ).click();
    await expectLeft(page, ME);
  });

  test('DS-PARL-09 Completed Questions opens the completed list', async ({ as }) => {
    const page = await as(ME);
    await menuLink(page, L.completedQ).click();
    const panel = region(page, E.completedQ);
    await expect(panel).toBeVisible();
    await expect(panel.getByText(E.completedSub, { exact: true })).toBeVisible();
    await expect(panel.getByRole('group', { name: E.filterByStatus, exact: true })).toHaveCount(0);
    await expect(panel.getByText(E.remind, { exact: true })).toHaveCount(0);
    await expect(panel.getByRole('link', { name: E.openRepo, exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: E.closeList, exact: true })).toBeVisible();
    await expect(menuLink(page, L.completedQ)).toHaveAttribute('aria-current', 'page');
    await expect(menuLink(page, E.dashboard)).not.toHaveAttribute('aria-current', 'page');
    await menuLink(page, E.dashboard).click();
    await expect(panel).toBeHidden();
    await expect(menuLink(page, E.dashboard)).toHaveAttribute('aria-current', 'page');
  });

  test('DS-PARL-10 Filter bar layout and defaults', async ({ as }) => {
    const page = await as(ME);
    const label = (s: string) => page.getByRole('main').getByText(caps(s)).first();
    await expectOrder([label(E.sittingDate), label(L.qtype), label(E.house), label(E.session), filterReset(page)]);
    await expect(dropdown(page, L.qtype)).toHaveAccessibleName(`${L.qtype}: ${L.allTypes}`);
    for (const group of [houseGroup(page), sessionGroup(page)]) {
      await expect(group).toBeVisible();
      expect(await focusable(group), 'read-only group, nothing focusable').toBe(false);
    }
    await expect(dropdown(page, E.scope)).toHaveCount(0);
    await expect(appliesNote(page)).toHaveText(noteFor());
  });

  test('DS-PARL-11 Question type options and status note', async ({ as }) => {
    const page = await as(ME);
    await dropdown(page, L.qtype).click();
    const options = listbox(page, L.qtype).getByRole('option');
    await expect(options).toHaveCount(3);
    for (const [i, name] of [L.allTypes, L.starred, L.unstarred].entries()) await expect(options.nth(i)).toHaveAccessibleName(name);
    await options.nth(1).click();
    await expect(dropdown(page, L.qtype)).toHaveAccessibleName(`${L.qtype}: ${L.starred}`);
    await expect(appliesNote(page)).toHaveText(noteFor(HOUSE, L.starred));
  });

  test('DS-PARL-12 Question type filters the lists and Top Delayed', async ({ as }) => {
    const page = await as(ME);
    await choose(page, L.qtype, L.starred);
    const panel = await openList(page, LISTS.assigned);
    for (const q of await column(panelTable(panel), E.colQuestion)) expect(q).toMatch(new RegExp(`\\b${esc(L.starred)}\\b`, 'i'));
    // Top Delayed on this board shows no starred marker (no QUESTION column), so its filtering is not observable here.
    await choose(page, L.qtype, L.unstarred);
    await expect(panel).toBeVisible();
    for (const q of await column(panelTable(panel), E.colQuestion)) expect(q).toMatch(new RegExp(`\\b${esc(L.unstarred)}\\b`, 'i'));
  });

  test('DS-PARL-13 KPI cards and charts ignore the filters', async ({ as }) => {
    const page = await as(ME);
    const snapshot = async () => [
      ...(await kpiValues(page, ALL_KPIS)).map(String),
      await region(page, E.workload).innerText(),
      await accName(region(page, E.routing).getByRole('img')),
      await breakupTable(page).innerText(),
    ];
    const before = await snapshot();
    await choose(page, L.qtype, L.starred);
    need(await applyOtherDay(page, ME), 'only one sitting day in the session calendar');
    expect(await snapshot()).toEqual(before);
  });

  test('DS-PARL-14 Reset restores the default filters', async ({ as }) => {
    const page = await as(ME);
    const defaults = [await accName(sittingDateButton(page, ME)), await accName(houseGroup(page)), await accName(sessionGroup(page))];
    await choose(page, L.qtype, L.unstarred);
    need(await applyOtherDay(page, ME), 'only one sitting day in the session calendar');
    const panel = await openList(page, LISTS.assigned);
    let busiest = ASSIGNED_CHIPS[1]!;
    for (const c of ASSIGNED_CHIPS.slice(2)) if ((await chipCount(chip(panel, c))) > (await chipCount(chip(panel, busiest)))) busiest = c;
    await chip(panel, busiest).click();
    if (await pageButton(panel, E.next).isEnabled()) await pageButton(panel, E.next).click();
    await filterReset(page).click();
    await expect(sittingDateButton(page, ME)).toHaveAccessibleName(defaults[0]!);
    await expect(houseGroup(page)).toHaveAccessibleName(defaults[1]!);
    await expect(sessionGroup(page)).toHaveAccessibleName(defaults[2]!);
    await expect(dropdown(page, L.qtype)).toHaveAccessibleName(`${L.qtype}: ${L.allTypes}`);
    await expect(chip(panel, E.all)).toHaveAttribute('aria-pressed', 'true');
    await expect(paging(panel)).toHaveText(new RegExp(`^${esc(E.showing)}(?:1–|0 )`));
  });

  test('DS-PARL-15 Sitting date sets House and session', async ({ as }) => {
    const page = await as(ME);
    const cal = await openCalendar(page, ME);
    await expect(cal.getByText(L.calSub, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    const applied = await applyOtherHouse(page, ME);
    need(applied, 'no sitting day of the other house in the session calendar');
    await expect(sittingDateButton(page, ME)).toHaveAccessibleName(new RegExp(`^${esc(E.sittingDate)} ${esc(applied.date)}\\. `));
    await expect(houseGroup(page)).toHaveAccessibleName(new RegExp(`^${esc(E.house)}: ${esc(applied.house)}\\. `));
    await expect(appliesNote(page)).toHaveText(noteFor(esc(applied.house)));
    for (const house of await column(topDelayedTable(page), E.colHouse)) expect(house).toContain(applied.house);
    const panel = await openList(page, LISTS.assigned);
    for (const house of await column(panelTable(panel), E.colHouse)) expect(house).toContain(applied.house);
  });

  test('DS-PARL-16 KPI cards: labels, names and targets', async ({ as }) => {
    const page = await as(ME);
    const cards = ALL_KPIS.map((k) => kpi(page, k));
    for (const card of cards) await expect(card).toBeVisible();
    await expectOrder(cards);
    for (const k of [KPIS.uploaded, KPIS.provisional, KPIS.admitted, KPIS.replies]) {
      await test.step(k.label, async () => {
        await kpi(page, k).click();
        await expectLeft(page, ME);
        await back(page, ME);
      });
    }
    for (const list of [LISTS.assigned, LISTS.delayed, LISTS.reapproval]) await openList(page, list);
  });

  test('DS-PARL-17 List panels: table, chips and paging', async ({ as }) => {
    const page = await as(ME);
    const panel = await openList(page, LISTS.assigned);
    const table = panelTable(panel);
    await expectColumns(table, LIST_COLUMNS);
    await expectOrder(ASSIGNED_CHIPS.map((c) => chip(panel, c)));
    await expect(paging(panel)).toHaveText(new RegExp(`^${esc(E.showing)}(?:1–\\d+ of \\d+|0 )`));
    expect(await dataRows(table).count()).toBeLessThanOrEqual(6);
    const [prev, next] = [pageButton(panel, E.prev), pageButton(panel, E.next)];
    await expect(prev).toBeDisabled();
    for (let i = 0; i < 50 && (await next.isEnabled()); i++) await next.click();
    await expect(next).toBeDisabled();
    if (await prev.isEnabled()) await prev.click();
    let picked: string | undefined;
    for (const c of ASSIGNED_CHIPS.slice(1)) if (!picked && (await chipCount(chip(panel, c))) > 0) picked = c;
    need(picked, 'no assigned question in any status');
    await chip(panel, picked).click();
    for (const s of await column(table, E.colStatus)) expect(s).toMatch(new RegExp(`^${esc(picked)}`, 'i'));
    await panel.getByRole('button', { name: E.closeList, exact: true }).click();
    await expect(panel).toBeHidden();
  });

  test('DS-PARL-18 Empty list under filters', async ({ as }) => {
    const page = await as(ME);
    let panel: Locator | undefined;
    for (const type of [L.allTypes, L.starred, L.unstarred]) {
      if (panel) break;
      if (type !== L.allTypes) await choose(page, L.qtype, type);
      const list = await openList(page, LISTS.reapproval);
      if (await shows(paging(list).filter({ hasText: E.showing0 }))) panel = list;
    }
    need(panel, 'Re-approval requests is not empty for any question type on the default sitting date');
    // OQ-7: the "No sample questions match…" message is prototype wording; only the empty structure is asserted.
    await expect(dataRows(panelTable(panel))).toHaveCount(0);
    await expect(paging(panel)).toHaveText(E.showing0);
    await expect(pageButton(panel, E.prev)).toBeDisabled();
    await expect(pageButton(panel, E.next)).toBeDisabled();
  });

  test('DS-PARL-20 Header search and Open Repository', async ({ as }) => {
    const page = await as(ME);
    const house = await houseNow(page);
    await search(page, ME, ANY);
    const panel = region(page, resultsTitle(ANY));
    await expect(panel.getByText(E.matchesOn, { exact: true })).toBeVisible();
    await expect(panel.getByRole('group', { name: E.filterByStatus, exact: true }).getByRole('button')).toHaveCount(SEARCH_CHIPS.length);
    await expectOrder(SEARCH_CHIPS.map((c) => chip(panel, c)));
    for (const h of await column(panelTable(panel), E.colHouse)) expect(h, 'results follow the House').toContain(house);
    await panel.getByRole('link', { name: E.openRepo, exact: true }).click();
    await expectLeft(page, ME);
    await expect
      .poll(() => page.locator('input').evaluateAll((els, q) => els.some((e) => (e as HTMLInputElement).value === q), ANY), 'the query is carried')
      .toBe(true);
  });

  test("DS-PARL-21 Today's Action Plan: structure and View All", async ({ as }) => {
    const page = await as(ME);
    const plan = region(page, E.actionPlan);
    await expect(plan.getByRole('status').first()).toHaveText(new RegExp(
      `^(?:\\d+(?:${esc(E.itemsNeed)}|${esc(E.itemNeeds)})${esc(E.aDecision)}|${esc(E.allSent)}|${esc(E.nothingToday)})$`,
    ));
    await expectPlanCards(plan);
    await plan.getByRole('link', { name: E.viewAllPlan, exact: true }).click();
    await expect(region(page, E.assignedQ)).toBeVisible();
  });

  test('DS-PARL-24 AI Daily Briefing and View Analytics', async ({ as }) => {
    await expectBriefing(await as(ME));
  });

  test('DS-PARL-25 Division Work Load', async ({ as }) => {
    const page = await as(ME);
    const workload = region(page, E.workload);
    await expect(workload.getByText(E.workloadSub, { exact: true })).toBeVisible();
    const rows = workload.getByRole('list', { name: E.workloadList, exact: true }).getByRole('listitem');
    const summary = workload.getByText(new RegExp(`^\\d+${esc(E.across)}\\d+${esc(E.otherDivs)}$`));
    await expect(rows).toHaveCount(4);
    await expect(summary).toBeVisible();
    const viewAll = workload.getByRole('button', { name: E.viewAll, exact: true });
    await expect(viewAll).toHaveAttribute('aria-expanded', 'false');
    await viewAll.click();
    const top4 = workload.getByRole('button', { name: E.showTop4, exact: true });
    await expect(top4).toHaveAttribute('aria-expanded', 'true');
    expect(await rows.count(), 'every division').toBeGreaterThan(4);
    await top4.click();
    await expect(viewAll).toHaveAttribute('aria-expanded', 'false');
    await expect(rows).toHaveCount(4);
  });

  test('DS-PARL-26 AI Routing Quality', async ({ as }) => {
    await expectRouting(await as(ME));
  });

  test('DS-PARL-27 Division-wise Breakup: sort and View All', async ({ as }) => {
    const page = await as(ME);
    const section = region(page, E.breakup);
    const table = breakupTable(page);
    await expectColumns(table, BREAKUP_COLUMNS);
    await expect(table.getByRole('rowheader')).toHaveCount(6);
    await expect(section.getByText(sortNote(E.colAssigned, E.highest))).toBeVisible();
    const sort = table.getByRole('button', { name: caps(E.colCompleted) });
    for (const [dir, aria] of [[E.highest, 'descending'], [E.lowest, 'ascending']] as const) {
      await test.step(dir, async () => {
        await sort.click();
        await expect(sortHeader(table, E.colCompleted)).toHaveAttribute('aria-sort', aria);
        await expect(section.getByText(sortNote(E.colCompleted, dir))).toBeVisible();
        await expectSorted(table, E.colCompleted, aria);
      });
    }
    await section.getByRole('button', { name: E.viewAll, exact: true }).click();
    const top6 = section.getByRole('button', { name: E.showTop6, exact: true });
    await expect(top6).toHaveAttribute('aria-expanded', 'true');
    expect(await table.getByRole('rowheader').count()).toBeGreaterThanOrEqual(6);
    await top6.click();
    await expect(table.getByRole('rowheader')).toHaveCount(6);
  });

  test('DS-PARL-28 Top Delayed Questions: columns', async ({ as }) => {
    const page = await as(ME);
    const section = region(page, E.topDelayed);
    const table = topDelayedTable(page);
    await expect(section.getByText(E.tdSub, { exact: true })).toBeVisible();
    await expectColumns(table, [E.colDiary, E.colHouse, E.colDivOfficer, E.colDays, E.colDeadline, E.colPriority, E.colAction]);
    expect(await dataRows(table).count()).toBeLessThanOrEqual(5);
    const priority = new RegExp(`^(?:${[E.highTag, E.mediumTag, E.lowTag].map(esc).join('|')})`, 'i');
    for (const p of await column(table, E.colPriority)) expect(p).toMatch(priority);
    await section.getByRole('link', { name: E.viewAllDelayed, exact: true }).click();
    await expect(region(page, E.delayedQ)).toBeVisible();
  });

  test('DS-PARL-29 Top Delayed Questions: empty state and Reset', async ({ as }) => {
    const page = await as(ME);
    const section = region(page, E.topDelayed);
    const empty = section.getByText(L.noPending, { exact: true });
    let found = await shows(empty);
    for (const type of [L.starred, L.unstarred]) {
      if (found) break;
      await choose(page, L.qtype, type);
      found = await shows(empty);
    }
    need(found, 'Top Delayed lists questions for every question type on the default sitting date');
    await expect(dataRows(topDelayedTable(page))).toHaveCount(0);
    await filterReset(page).click();
    await expect(dataRows(topDelayedTable(page)).first()).toBeVisible();
  });

  test('DS-PARL-31 Export Data CSV', async ({ as }) => {
    const page = await as(ME);
    const csv = await exportCsv(page);
    expect(csv.name).toMatch(new RegExp(`^${esc(L.csvFile)}${ISO_DAY}\\.csv$`));
    expect(csv.text.charCodeAt(0), 'UTF-8 with BOM').toBe(0xfeff);
    expectCsvRow(csv.text, [E.csvKpi, E.csvValue]);
    expectCsvRow(csv.text, [E.colDivision, E.colJs, E.colAssigned, E.colProvisional, E.colAdmitted, E.colCompleted, E.colDelayed]);
    expectCsvRow(csv.text, [E.colDiary, E.colQuestion, E.colHouse, E.colDivision, E.csvOfficer, E.colDays, E.colDeadline]);
    await expect(toast(page, new RegExp(`${esc(E.exported)}${esc(csv.name)}\\.`))).toBeVisible();
  });
});
