import type { Locator, Page } from '@playwright/test';
import { test, expect, requireWrites } from '../fixtures.js';
import { notMeasured } from '../../support/annotations.js';
import { labels } from '../labels/dashboards.js';
import type { DivisionLabels } from '../labels/dashboards.js';
import {
  DATE, DIV_KPIS, E, HOUSE, ISO_DAY, MENU, NONE, P, accName, applyOtherDay, calButton, cardTexts, caps, column, dataRows, dayGrid,
  divisionName, dropdown, epochDay, esc, expectColumns, expectCsvRow, expectLeft, expectOrder, expectRoleLabel, exportCsv,
  firstNumber, h1, kpi, kpiNumber, menu, menuLink, need, openCalendar, openNotifications, region, search, searchbox, selectedDay,
  shows, sittingDateButton, sortHeader, today, toast, topDelayedTable, updated, UPDATED,
} from './dashboards-nav.js';

// DS-DIVD: My Division Dashboard for a division officer. Read-only except the Auto-W cases: Accept and Reject move a
// transfer for good (the design gives no undo, OQ-12) and Mark all as read cannot be undone; run them on a disposable
// QA tenant only. Remind sends to an officer a test cannot point at a tester contact, so DS-DIVD-34 stays Manual.

const L = labels['FigmaTestingCal2-5g42-i92s.dc.html']! as DivisionLabels;
const ME = 'division' as const;
const ALL_KPIS = Object.values(DIV_KPIS);

const qa = (page: Page): Locator => region(page, L.qa);
const qaTable = (page: Page): Locator => qa(page).getByRole('table', { name: L.qaTable, exact: true });
const qaHeading = (page: Page): Locator => qa(page).getByRole('heading', { name: L.qa, exact: true });
/** Questions Activity status line, ending "Showing <x> of <n>." */
const qaStatus = (page: Page): Locator =>
  qa(page).getByRole('status').filter({ hasText: new RegExp(`${esc(E.showing)}\\d+${esc(L.of)}\\d+\\.`) }).first();
const showingOf = async (page: Page): Promise<[number, number]> => {
  const m = new RegExp(`${esc(E.showing)}(\\d+)${esc(L.of)}(\\d+)\\.`).exec(await qaStatus(page).innerText())!;
  return [Number(m[1]), Number(m[2])];
};
/** The pressed Questions Activity filter chip, named "Clear the filter: <filter>". */
const filterChip = (page: Page, filter: string | RegExp): Locator =>
  page.getByRole('button', typeof filter === 'string' ? { name: `${L.clearFilter}${filter}`, exact: true } : { name: filter });
const anyFilterChip = (page: Page): Locator => page.getByRole('button', { name: new RegExp(`^${esc(L.clearFilter)}`) });
const resultsChip = (page: Page, term: string): Locator =>
  filterChip(page, new RegExp(`^${esc(L.clearFilter)}${esc(L.resultsFor)}${esc(term)}["“”]$`));
const admittedItem = MENU.division[2]!;
const menuAdmitted = async (page: Page): Promise<number> => firstNumber((await accName(menuLink(page, admittedItem))).slice(L.admittedQ.length));
const houseGroup = (page: Page): Locator => page.getByRole('group', { name: caps(E.house) });

const transfers = (page: Page): Locator => region(page, L.transferReq);
const ACCEPT = new RegExp(`^${esc(L.acceptAria)}${esc(L.diaryNo)}(\\d+)${esc(L.fromW)}(.+)$`);
const REJECT = new RegExp(`^${esc(L.rejectAria)}${esc(L.diaryNo)}(\\d+)${esc(L.leaveWith)}(.+)$`);

const plan = (page: Page): Locator => region(page, E.actionPlan);
const stage = (page: Page, label: string): Locator =>
  plan(page).getByRole('group', { name: L.stageGroup, exact: true }).getByRole('button', { name: new RegExp(`^${esc(label)} · \\d+$`) });
const planCards = (page: Page): Promise<string[]> => cardTexts(plan(page), new RegExp(`^${esc(L.dno)}`));
const GO = new RegExp(`^(${esc(L.continueDraft)}|${esc(L.downloadReply)}), ${esc(L.diaryNo)}\\d+$`);

/** A sort button's tooltip: "Sort by <column>, <direction>". */
const sortTip = (page: Page, col: string, dir: string): Locator =>
  page.getByRole('tooltip').filter({ hasText: new RegExp(`^${esc(L.sortBy)}${esc(col)}, ${esc(dir)}$`) });

test.describe('DS-DIVD — My Division Dashboard (design)', () => {
  test('DS-DIVD-01 Page header and persona', async ({ as }) => {
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
    await expectRoleLabel(page, await divisionName(page));
  });

  test('DS-DIVD-02 Sidebar items', async ({ as }) => {
    const page = await as(ME);
    const items = MENU.division.map((name) => menuLink(page, name));
    for (const item of items) await expect(item).toBeVisible();
    await expectOrder(items);
    await expect(menuLink(page, E.dashboard)).toHaveAttribute('aria-current', 'page');
    await expect(menu(page).getByRole('button', { name: P.settings, exact: true })).toHaveCount(0);
    await expect(menu(page).getByRole('link', { name: E.aiAssistant, exact: true })).toHaveCount(0);
  });

  test('DS-DIVD-03 Admitted Questions count matches the KPI', async ({ as }) => {
    const page = await as(ME);
    const count = await menuAdmitted(page);
    expect(count).toBe(await kpiNumber(page, DIV_KPIS.admitted));
    need(await applyOtherDay(page, ME), 'no sitting day in the session calendar');
    expect(await menuAdmitted(page), 'the menu count covers all sittings').toBe(count);
  });

  test('DS-DIVD-04 Menu items filter Questions Activity', async ({ as }) => {
    const page = await as(ME);
    const dueAll = (want: (due: string) => boolean) => async () => {
      for (const due of await column(qaTable(page), L.colDue)) expect(want(due), `DUE DATE "${due}"`).toBe(true);
    };
    const steps: Array<[string | RegExp, string, () => Promise<void>]> = [
      [L.provisionalQ, L.fProvisional, dueAll((d) => d === '—')],
      [admittedItem, L.fAdmitted, dueAll((d) => d !== '—')],
      [L.completedQ, L.fCompleted, async () => {
        for (const s of await column(qaTable(page), L.colStatus)) expect(s).toMatch(new RegExp(`^${esc(L.stDownloaded)}`, 'i'));
      }],
    ];
    for (const [item, filter, rowsMatch] of steps) {
      await test.step(filter, async () => {
        await menuLink(page, item).click();
        await expect(qaHeading(page)).toBeFocused();
        await expect(qa(page).getByText(E.showing.trim(), { exact: true })).toBeVisible();
        await expect(filterChip(page, filter)).toHaveAttribute('aria-pressed', 'true');
        await rowsMatch();
      });
    }
  });

  test('DS-DIVD-05 Transfer Requests menu item', async ({ as }) => {
    const page = await as(ME);
    await menuLink(page, L.transferReq).click();
    const heading = transfers(page).getByRole('heading', { name: L.transferReq, exact: true });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
  });

  test('DS-DIVD-06 Dashboard menu item clears filters', async ({ as }) => {
    const page = await as(ME);
    await menuLink(page, L.provisionalQ).click();
    await expect(filterChip(page, L.fProvisional)).toBeVisible();
    await searchbox(page, ME).fill(NONE);
    const dialog = await openNotifications(page);
    await menuLink(page, E.dashboard).click();
    await expect(anyFilterChip(page)).toHaveCount(0);
    await expect(searchbox(page, ME)).toHaveValue('');
    await expect(dialog).toBeHidden();
  });

  test('DS-DIVD-07 Header search', async ({ as }) => {
    const page = await as(ME);
    await expect(searchbox(page, ME)).toHaveAttribute('placeholder', L.placeholder);
    const subject = (await column(qaTable(page), L.colSubject))[0] ?? '';
    const term = /[A-Za-z]{4,}/.exec(subject)?.[0];
    need(term, 'no question with a subject in Questions Activity');
    await search(page, ME, term);
    await expect(resultsChip(page, term)).toBeVisible();
    await expect(qaHeading(page)).toBeFocused();
    const [shown, total] = await showingOf(page);
    expect(shown, 'every match shows, no 6-row limit').toBe(total);
    await expect(dataRows(qaTable(page))).toHaveCount(total);
  });

  test('DS-DIVD-08 Search ignores D. No., Q and * prefixes', async ({ as }) => {
    const page = await as(ME);
    const diary = String(firstNumber((await column(qaTable(page), L.colDiary))[0] ?? ''));
    need(diary !== 'NaN', 'no question in Questions Activity');
    const qno = (await dataRows(qaTable(page)).allInnerTexts()).map((t) => /(?:\bQ |\*)(\d+)/.exec(t)?.[1]).find(Boolean);
    need(qno, 'no question number shown in Questions Activity rows');
    for (const [term, want] of [[`${L.dno} ${diary}`, diary], [`Q ${qno}`, qno], [`*${qno}`, qno]] as const) {
      await test.step(term, async () => {
        await search(page, ME, term);
        await expect(resultsChip(page, term)).toBeVisible();
        await expect(dataRows(qaTable(page)).filter({ hasText: want }).first()).toBeVisible();
      });
    }
  });

  test('DS-DIVD-09 Search with no match, and clearing the filter chip', async ({ as }) => {
    const page = await as(ME);
    await search(page, ME, NONE);
    await expect(dataRows(qaTable(page))).toHaveCount(0);
    await expect(qa(page).getByText(L.noQuestions, { exact: true })).toBeVisible();
    await resultsChip(page, NONE).click();
    await expect(resultsChip(page, NONE)).toBeHidden();
    await expect(searchbox(page, ME)).toHaveValue('');
    const [, total] = await showingOf(page);
    await expect(dataRows(qaTable(page))).toHaveCount(Math.min(total, 6));
    if (total > 6) await expect(qa(page).getByRole('button', { name: L.viewAll, exact: true })).toBeVisible();
  });

  test('DS-DIVD-10 Filter bar layout and defaults', async ({ as }) => {
    const page = await as(ME);
    const main = page.getByRole('main');
    await expectOrder([main.getByText(caps(L.sittingDate)).first(), main.getByText(caps(E.house)).first()]);
    await expect(dropdown(page, P.qtype)).toHaveCount(0);
    await expect(main.getByText(caps(E.session))).toHaveCount(0);
    await expect(page.getByRole('button', { name: E.reset, exact: true })).toHaveCount(0);
    await expect(page.getByRole('status').filter({ hasText: new RegExp(`${esc(E.scopeNote)}|${esc(P.appliesNote)}`) })).toHaveCount(0);
    const button = sittingDateButton(page, ME);
    await expect(button).toHaveAccessibleName(`${L.sittingDate}: ${L.allSittings}. ${E.openCal}`);
    await expect(button).toContainText(L.allSittings);
    await expect(houseGroup(page)).toContainText(L.allHouses);
    await expect(houseGroup(page)).toHaveAccessibleDescription(L.houseDescAll);
  });

  test('DS-DIVD-11 Picking a sitting date filters the dashboard', async ({ as }) => {
    const page = await as(ME);
    const briefing = await region(page, E.briefing).innerText();
    const date = await applyOtherDay(page, ME);
    need(date, 'no sitting day in the session calendar');
    const button = sittingDateButton(page, ME);
    await expect(button).toHaveAccessibleName(`${L.sittingDate}: ${date}. ${E.openCal}`);
    await expect(button).toContainText(date);
    await expect(houseGroup(page)).toContainText(new RegExp(HOUSE));
    await expect(houseGroup(page)).toHaveAccessibleDescription(L.houseDescSet);
    const house = new RegExp(HOUSE).exec((await houseGroup(page).textContent()) ?? '')![0];
    for (const cell of await column(qaTable(page), L.colHouse)) expect(cell).toContain(house);
    for (const cell of await column(topDelayedTable(page), E.colHouse)) expect(cell).toContain(house);
    expect(await region(page, E.briefing).innerText(), 'the AI Daily Briefing covers the whole division').toBe(briefing);
  });

  test('DS-DIVD-12 Calendar Reset brings back All sittings', async ({ as }) => {
    const page = await as(ME);
    need(await applyOtherDay(page, ME), 'no sitting day in the session calendar');
    const cal = await openCalendar(page, ME);
    await expect(cal.getByText(L.calSub, { exact: true })).toBeVisible();
    await calButton(cal, E.reset).click();
    await expect(selectedDay(cal)).toHaveCount(0);
    await expect(dayGrid(cal).locator('[aria-pressed="true"]')).toHaveCount(0);
    await expect(cal.getByText(L.noSittingSel, { exact: true })).toBeVisible();
    await expect(cal.getByText(L.noSittingHint, { exact: true })).toBeVisible();
    await expect(calButton(cal, E.apply)).toBeEnabled();
    await calButton(cal, E.apply).click();
    await expect(sittingDateButton(page, ME)).toHaveAccessibleName(`${L.sittingDate}: ${L.allSittings}. ${E.openCal}`);
    await expect(houseGroup(page)).toContainText(L.allHouses);
  });

  test('DS-DIVD-13 Sitting with no division questions', async ({ as }) => {
    const page = await as(ME);
    const cal = await openCalendar(page, ME);
    // Find, in the calendar's own panel, a sitting that lists none of this division's questions.
    const listed = async () => firstNumber(((await cal.getByText(L.yourListed, { exact: true }).locator('..').textContent()) ?? '').replace(L.yourListed, ''));
    const prev = calButton(cal, E.prevMonth);
    for (let i = 0; i < 24 && (await prev.isEnabled()); i++) await prev.click();
    let found = false;
    for (let m = 0; m < 24 && !found; m++) {
      const days = dayGrid(cal).getByRole('button', { disabled: false });
      for (let d = 0; d < (await days.count()) && !found; d++) {
        await days.nth(d).click();
        found = (await listed()) === 0;
      }
      if (!found && (await calButton(cal, E.nextMonth).isEnabled())) await calButton(cal, E.nextMonth).click();
      else if (!found) break;
    }
    need(found, 'every sitting day lists questions for this division');
    await calButton(cal, E.apply).click();
    for (const k of ALL_KPIS) expect(await kpiNumber(page, k), k.label).toBe(0);
    await expect(qa(page).getByText(L.noQuestions, { exact: true })).toBeVisible();
    await expect(transfers(page).getByText(L.noTransfers, { exact: true })).toBeVisible();
    await expect(plan(page).getByText(L.noItems, { exact: true })).toBeVisible();
    await expect(plan(page).getByText(new RegExp(`^0${esc(L.itemsNeed)}${esc(L.aDecision)}$`))).toBeVisible();
    await expect(region(page, E.topDelayed).getByText(L.noPendingReplies, { exact: true })).toBeVisible();
  });

  test('DS-DIVD-14 KPI cards: order and names', async ({ as }) => {
    const page = await as(ME);
    const cards = ALL_KPIS.map((k) => kpi(page, k));
    for (const card of cards) await expect(card).toBeVisible();
    await expectOrder(cards);
    await expect(page.getByRole('link', { name: /^[A-Z ]+: \d+\. / })).toHaveCount(6);
  });

  test('DS-DIVD-15 KPI cards filter Questions Activity or jump to Transfer Requests', async ({ as }) => {
    const page = await as(ME);
    const steps = [
      [DIV_KPIS.provisional, L.fProvisional], [DIV_KPIS.admitted, L.fAdmitted],
      [DIV_KPIS.downloaded, L.fDownloaded], [DIV_KPIS.delayed, L.fDelayed],
    ] as const;
    for (const [k, filter] of steps) {
      await test.step(k.label, async () => {
        const n = await kpiNumber(page, k);
        await kpi(page, k).click();
        await expect(filterChip(page, filter)).toHaveAttribute('aria-pressed', 'true');
        await expect(qaHeading(page)).toBeFocused();
        expect((await showingOf(page))[1], 'the total equals the card').toBe(n);
      });
    }
    await kpi(page, DIV_KPIS.transfer).click();
    const heading = transfers(page).getByRole('heading', { name: L.transferReq, exact: true });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
  });

  test('DS-DIVD-16 Questions Activity: default view and View All', async ({ as }) => {
    const page = await as(ME);
    const [, total] = await showingOf(page);
    need(total > 6, 'Questions Activity holds 6 questions or fewer');
    const rows = dataRows(qaTable(page));
    await expect(qaStatus(page)).toHaveText(new RegExp(`^${esc(L.qaLatest)} ${esc(E.showing)}6${esc(L.of)}${total}\\.$`));
    await expect(rows).toHaveCount(6);
    const viewAll = qa(page).getByRole('button', { name: L.viewAll, exact: true });
    await viewAll.click();
    const fewer = qa(page).getByRole('button', { name: L.showFewer, exact: true });
    await expect(fewer).toHaveAttribute('aria-expanded', 'true');
    await expect(rows).toHaveCount(total);
    await expect(qaStatus(page)).toContainText(`${E.showing}${total}${L.of}${total}.`);
    await fewer.click();
    await expect(rows).toHaveCount(6);
  });

  test('DS-DIVD-17 Questions Activity: columns, status and overdue', async ({ as }) => {
    const page = await as(ME);
    const table = qaTable(page);
    await expectColumns(table, [L.colDiary, L.colSubject, L.colHouse, L.colReceived, L.colDue, L.colStatus, L.colAction]);
    const status = new RegExp(`^(?:${[L.stNew, L.stDraft, L.stWaiting, L.stDownloaded].map(esc).join('|')})`, 'i');
    for (const s of await column(table, L.colStatus)) expect(s).toMatch(status);
    const due = new RegExp(
      `^(?:—|${DATE}, \\d{1,2}:\\d{2} ?[ap]m(?:\\s+\\d+ (?:${esc(L.dayW)}|${esc(L.daysW)})${esc(L.overdue)})?)$`, 'i',
    );
    for (const d of await column(table, L.colDue)) expect(d).toMatch(due);
    // Truncated subjects with a full-text tooltip are a visual check (Manual).
  });

  for (const [col, word, first, second, firstAria] of [
    [L.colReceived, L.receivedDate, L.newest, L.oldest, 'descending'],
    [L.colDue, L.dueDateW, L.earliest, L.latest, 'ascending'],
  ] as const) {
    const id = col === L.colReceived ? 'DS-DIVD-18 Questions Activity: sort by RECEIVED DATE' : 'DS-DIVD-19 Questions Activity: sort by DUE DATE';
    test(id, async ({ as }) => {
      const page = await as(ME);
      const table = qaTable(page);
      const sort = table.getByRole('button', { name: caps(col) });
      await sort.hover();
      await expect(sortTip(page, word, first)).toBeVisible();
      const secondAria = firstAria === 'descending' ? 'ascending' : 'descending';
      for (const [dir, aria] of [[first, firstAria], [second, secondAria]] as const) {
        await test.step(dir, async () => {
          await sort.click();
          await expect(sortHeader(table, col)).toHaveAttribute('aria-sort', aria);
          await expect(qaStatus(page)).toHaveText(new RegExp(`^${esc(L.sortedBy)}${esc(word)}, ${esc(dir)}\\. ${esc(E.showing)}`));
          const days = (await column(table, col)).map(epochDay);
          const dated = days.filter((d) => !Number.isNaN(d));
          expect(days.slice(0, dated.length), 'rows with no date ("—") stay at the end').toEqual(dated);
          dated.slice(1).forEach((d, i) => expect(aria === 'ascending' ? d >= dated[i]! : d <= dated[i]!, `${dir}: row ${i + 2}`).toBe(true));
        });
      }
      if (col === L.colReceived) await expect(sortHeader(table, L.colDue)).toHaveAttribute('aria-sort', 'none');
    });
  }

  test('DS-DIVD-20 Open question from Questions Activity', async () => {
    notMeasured(test.info(), { tracker: 'design-OQ', owner: 'UI/UX', detail: 'OQ-3: the eye buttons on every row but D. No. 16448 are "not part of this prototype yet" placeholders' });
  });

  test('DS-DIVD-21 Transfer Requests: structure', async ({ as }) => {
    const page = await as(ME);
    const section = transfers(page);
    const accept = section.getByRole('button', { name: ACCEPT });
    need(await shows(accept), 'no pending transfer request');
    await expect(section.getByText(L.transferSub, { exact: true })).toBeVisible();
    await expectColumns(section.getByRole('table', { name: L.trTable, exact: true }), [
      L.colDiary, L.colQuestion, L.colHouse, L.colFrom, L.colRequested, L.colAction,
    ]);
    for (let i = 0; i < (await accept.count()); i++) {
      const [, diary, from] = ACCEPT.exec(await accName(accept.nth(i)))!;
      await expect(section.getByRole('button', { name: `${L.rejectAria}${L.diaryNo}${diary}${L.leaveWith}${from}`, exact: true })).toBeVisible();
    }
    await expect(section.getByRole('button', { name: REJECT })).toHaveCount(await accept.count());
    await expect(section.getByRole('button', { name: L.viewAll, exact: true })).toBeVisible();
  });

  test('DS-DIVD-22 Accept a transfer', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as(ME);
    const accept = transfers(page).getByRole('button', { name: ACCEPT }).first();
    need(await shows(accept), 'no pending transfer request');
    const name = await accName(accept);
    const [, diary] = ACCEPT.exec(name)!;
    const briefingTransfers = async () =>
      firstNumber(new RegExp(`(\\d+)${esc(L.transferWord)}`).exec(await region(page, E.briefing).innerText())?.[1] ?? '');
    const before = {
      transfer: await kpiNumber(page, DIV_KPIS.transfer),
      admitted: await kpiNumber(page, DIV_KPIS.admitted),
      menu: await menuAdmitted(page),
      briefing: await briefingTransfers(),
    };
    await accept.click();
    // No undo exists for Accept (OQ-12): the question stays with this division on the disposable tenant.
    await expect(toast(page, new RegExp(`${esc(L.dno)} ${diary}${esc(L.acceptedToast)}.+${esc(L.asAdmitted)}`))).toBeVisible();
    await expect(transfers(page).getByRole('button', { name, exact: true })).toBeHidden();
    await expect.poll(() => kpiNumber(page, DIV_KPIS.transfer)).toBe(before.transfer - 1);
    await expect.poll(() => kpiNumber(page, DIV_KPIS.admitted)).toBe(before.admitted + 1);
    await expect.poll(() => menuAdmitted(page)).toBe(before.menu + 1);
    if (!Number.isNaN(before.briefing)) await expect.poll(briefingTransfers).toBe(before.briefing - 1);
    await search(page, ME, diary!);
    await expect(dataRows(qaTable(page)).filter({ hasText: diary! }).first()).toContainText(L.stNew);
  });

  test('DS-DIVD-23 Reject a transfer', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as(ME);
    const reject = transfers(page).getByRole('button', { name: REJECT }).first();
    need(await shows(reject), 'no pending transfer request');
    const name = await accName(reject);
    const [, diary, from] = REJECT.exec(name)!;
    const before = await kpiNumber(page, DIV_KPIS.transfer);
    await reject.click();
    // No undo exists for Reject (OQ-12): the question stays with the sending division.
    await expect(toast(page, new RegExp(`${esc(L.dno)} ${diary}${esc(L.rejectedToast)}${esc(from!)}\\.`))).toBeVisible();
    await expect(transfers(page).getByRole('button', { name, exact: true })).toBeHidden();
    await expect.poll(() => kpiNumber(page, DIV_KPIS.transfer)).toBe(before - 1);
    await search(page, ME, diary!);
    await expect(dataRows(qaTable(page)).filter({ hasText: diary! })).toHaveCount(0);
  });

  test('DS-DIVD-24 Transfer Requests: View All and Pending only', async ({ as }) => {
    const page = await as(ME);
    const section = transfers(page);
    const rows = dataRows(section.getByRole('table', { name: L.trTable, exact: true }));
    const viewAll = section.getByRole('button', { name: L.viewAll, exact: true });
    await viewAll.click();
    const pendingOnly = section.getByRole('button', { name: L.pendingOnly, exact: true });
    await expect(pendingOnly).toHaveAttribute('aria-expanded', 'true');
    const handled = rows.filter({
      has: page.getByText(L.accepted, { exact: true }).or(page.getByText(L.rejected, { exact: true })),
    });
    need(await shows(handled), 'no transfer accepted or rejected yet');
    for (let i = 0; i < (await handled.count()); i++) await expect(handled.nth(i).getByRole('button')).toHaveCount(0);
    await pendingOnly.click();
    await expect(viewAll).toHaveAttribute('aria-expanded', 'false');
    await expect(handled).toHaveCount(0);
  });

  test('DS-DIVD-25 Transfer Requests: empty state', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as(ME);
    const reject = transfers(page).getByRole('button', { name: REJECT });
    // Reject leaves each question with its sender; there is no undo (OQ-12).
    for (let i = 0; i < 50 && (await shows(reject, 2_000)); i++) {
      const name = await accName(reject.first());
      await reject.first().click();
      await expect(transfers(page).getByRole('button', { name, exact: true })).toBeHidden();
    }
    await expect(transfers(page).getByText(L.noTransfers, { exact: true })).toBeVisible();
    await expect(transfers(page).getByRole('table', { name: L.trTable, exact: true })).toBeHidden();
    expect(await kpiNumber(page, DIV_KPIS.transfer)).toBe(0);
  });

  test("DS-DIVD-26 Today's Action Plan: structure", async ({ as }) => {
    const page = await as(ME);
    await expect(plan(page).getByRole('status').first()).toHaveText(
      new RegExp(`^(?:\\d+${esc(L.itemsNeed)}|1${esc(L.itemNeeds)})${esc(L.aDecision)}$`),
    );
    await expect(stage(page, L.all)).toHaveAttribute('aria-pressed', 'true');
    await expectOrder([stage(page, L.all), stage(page, L.draft), stage(page, L.replyDownloaded)]);
    const cards = await planCards(page);
    need(cards.length, 'no item in the action plan');
    expect(cards.length).toBeLessThanOrEqual(3);
    for (const card of cards) {
      expect(card).toMatch(new RegExp(`\\b(?:${esc(E.starred)}|${esc(E.unstarred)})\\b`, 'i'));
      expect(card).toMatch(new RegExp(HOUSE, 'i'));
      expect(card).toMatch(new RegExp(`${esc(L.dno)} \\d+`, 'i'));
      expect(card).toMatch(/^\d+\. /m);
      for (const label of [L.sitting, L.officer, L.dueDate]) expect(card).toMatch(new RegExp(esc(label), 'i'));
      expect(card).toMatch(new RegExp(`${esc(L.continueDraft)}|${esc(L.downloadReply)}`, 'i'));
      if (new RegExp(esc(L.continueDraft), 'i').test(card)) {
        expect(card).toMatch(new RegExp(`(?:${[L.high, L.medium, L.low].map(esc).join('|')})${esc(L.priority)}`, 'i'));
      }
    }
    await expect(plan(page).getByRole('button', { name: GO })).toHaveCount(cards.length);
  });

  test('DS-DIVD-27 Action plan stage chips', async ({ as }) => {
    const page = await as(ME);
    const pressed = plan(page).getByRole('group', { name: L.stageGroup, exact: true }).locator('[aria-pressed="true"]');
    const go = (label: string) => plan(page).getByRole('button', { name: new RegExp(`^${esc(label)}, `) });
    const stages = [[L.draft, L.continueDraft, L.downloadReply], [L.replyDownloaded, L.downloadReply, L.continueDraft]] as const;
    for (const [label, own, other] of stages) {
      await test.step(label, async () => {
        await stage(page, label).click();
        await expect(pressed).toHaveCount(1);
        await expect(stage(page, label)).toHaveAttribute('aria-pressed', 'true');
        await expect(go(other)).toHaveCount(0);
        expect(await go(own).count()).toBe((await planCards(page)).length);
        if (label === L.replyDownloaded) {
          for (const card of await planCards(page)) expect(card, 'no priority tag').not.toMatch(new RegExp(esc(L.priority), 'i'));
        }
      });
    }
    await stage(page, L.all).click();
    await expect(pressed).toHaveCount(1);
    const order = [...(await plan(page).ariaSnapshot()).matchAll(new RegExp(`button "(${esc(L.continueDraft)}|${esc(L.downloadReply)}),`, 'g'))]
      .map((m) => (m[1] === L.continueDraft ? 'D' : 'R'))
      .join('');
    expect(order, 'Draft cards first').toMatch(/^D*R*$/);
  });

  test('DS-DIVD-28 Action plan priority, due text and order', async ({ as }) => {
    const page = await as(ME);
    await stage(page, L.draft).click(); // priority tags are on Draft cards only
    const cards = await planCards(page);
    need(cards.length, 'no Draft item in the action plan');
    const levels = [L.high, L.medium, L.low];
    const due = new RegExp(
      `${esc(L.dueDate)}\\s*(${DATE}), \\d{1,2}:\\d{2} ?[ap]m(?: \\((?:(\\d+) ${esc(L.daysW)}${esc(L.overdue)}|${esc(E.today)}|${esc(L.tomorrow)})\\))?`,
      'i',
    );
    let last: [number, number] | undefined;
    for (const card of cards) {
      const level = levels.findIndex((p) => new RegExp(`\\b${esc(p)}${esc(L.priority)}`, 'i').test(card));
      const m = due.exec(card);
      expect(m, `Due Date in: ${card}`).not.toBeNull();
      const day = epochDay(m![1]!);
      const starred = new RegExp(`\\b${esc(E.starred)}\\b`, 'i').test(card);
      const want = starred || day < today() ? 0 : day - today() <= 2 ? 1 : 2;
      expect(level, `priority of: ${card}`).toBe(want);
      if (last) expect(level > last[0] || (level === last[0] && day >= last[1]), 'High first, then most overdue, then nearest').toBe(true);
      last = [level, day];
    }
  });

  test('DS-DIVD-29 Action plan: empty stage', async ({ as }) => {
    const page = await as(ME);
    let empty: Locator | undefined;
    for (const label of [L.draft, L.replyDownloaded]) if (!empty && / · 0$/.test(await accName(stage(page, label)))) empty = stage(page, label);
    need(empty, 'no action-plan stage with count 0');
    await empty.click();
    expect(await planCards(page)).toEqual([]);
    await expect(plan(page).getByText(L.noItems, { exact: true })).toBeVisible();
  });

  test('DS-DIVD-30 Action plan View All', async ({ as }) => {
    const page = await as(ME);
    await plan(page).getByRole('link', { name: E.viewAllPlan, exact: true }).click();
    await expect(filterChip(page, L.fPlan)).toHaveAttribute('aria-pressed', 'true');
    await expect(qaHeading(page)).toBeFocused();
  });

  test('DS-DIVD-32 AI Daily Briefing and View Questions', async ({ as }) => {
    const page = await as(ME);
    await kpi(page, DIV_KPIS.provisional).click();
    await expect(filterChip(page, L.fProvisional)).toBeVisible();
    const briefing = region(page, E.briefing);
    await expect(briefing.getByText(caps(L.todaySummary))).toBeVisible();
    await expect(briefing.getByText(caps(L.workloadAhead))).toBeVisible();
    await expect(briefing.getByRole('list').nth(0).getByRole('listitem')).toHaveCount(4);
    await expect(briefing.getByRole('list').nth(1).getByRole('listitem')).toHaveCount(2);
    await expect(briefing.getByText(new RegExp(`^${esc(L.nextSitting)}|^${esc(L.noComing)}$`)).first()).toBeVisible();
    await expect(briefing.getByText(new RegExp(
      `^\\d+${esc(L.stillNeed)}\\d+${esc(L.needDecision)}\\d+${esc(L.notStarted)}\\d+${esc(L.dueNext2)}$`,
    ))).toBeVisible();
    await expect(briefing.getByText(new RegExp(
      `^${esc(E.generated)}\\d{2}:\\d{2}${esc(E.from)}\\d+${esc(L.questionsFor)}.+${esc(L.acrossOpen)}$`,
    ))).toBeVisible();
    await briefing.getByRole('button', { name: L.viewQuestions, exact: true }).click();
    await expect(anyFilterChip(page)).toHaveCount(0);
    await expect(qaHeading(page)).toBeFocused();
    await expect(qaHeading(page)).toBeInViewport();
  });

  test('DS-DIVD-33 Top Delayed Questions: structure', async ({ as }) => {
    const page = await as(ME);
    const section = region(page, E.topDelayed);
    const table = topDelayedTable(page);
    await expect(section.getByText(E.tdSub, { exact: true })).toBeVisible();
    await expectColumns(table, [E.colDiary, E.colHouse, E.colDivOfficer, E.colDays, E.colDeadline, E.colPriority, E.colAction]);
    expect(await dataRows(table).count()).toBeLessThanOrEqual(5);
    const days = (await column(table, E.colDays)).map(firstNumber);
    days.slice(1).forEach((d, i) => expect(d, 'longest-running first').toBeLessThanOrEqual(days[i]!));
    const division = await divisionName(page);
    for (const cell of await column(table, E.colDivOfficer)) expect(cell).toContain(division);
    for (const d of await column(table, E.colDeadline)) expect(d).toMatch(new RegExp(`^(?:${esc(E.today)}|${DATE})\\s+\\d{1,2}:\\d{2}`, 'i'));
    const priority = new RegExp(`^(?:${[E.highTag, E.mediumTag, E.lowTag].map(esc).join('|')})`, 'i');
    for (const p of await column(table, E.colPriority)) expect(p).toMatch(priority);
  });

  test('DS-DIVD-35 Top Delayed Questions View All', async ({ as }) => {
    const page = await as(ME);
    await region(page, E.topDelayed).getByRole('link', { name: E.viewAllDelayed, exact: true }).click();
    await expect(filterChip(page, L.fPending)).toHaveAttribute('aria-pressed', 'true');
    await expect(qaHeading(page)).toBeFocused();
  });

  test('DS-DIVD-36 Notifications panel for the Division', async ({ as }) => {
    const page = await as(ME);
    const division = await divisionName(page);
    const dialog = await openNotifications(page);
    await expect(dialog.getByText(`${L.notifSub}${division}.`, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: L.markAllRead, exact: true })).toBeVisible();
    await dialog.getByRole('link', { name: L.notifSettings, exact: true }).click();
    await expectLeft(page, ME);
  });

  test('DS-DIVD-37 Mark all as read', async ({ as, denv }) => {
    requireWrites(denv);
    const page = await as(ME);
    const dialog = await openNotifications(page);
    await dialog.getByRole('button', { name: L.markAllRead, exact: true }).click(); // no undo in the design
    await dialog.getByRole('button', { name: E.closeNotif, exact: true }).click();
    await expect(page.getByText(L.allRead, { exact: true })).toBeVisible();
  });

  test('DS-DIVD-38 Export Data CSV', async ({ as }) => {
    const page = await as(ME);
    const csv = await exportCsv(page);
    expect(csv.name).toMatch(new RegExp(`^${esc(L.csvFile)}${ISO_DAY}\\.csv$`));
    expect(csv.text.charCodeAt(0), 'UTF-8 with BOM').toBe(0xfeff);
    expectCsvHeaders(csv.text);
    await expect(toast(page, new RegExp(`${esc(E.exported)}${esc(csv.name)}\\.`))).toBeVisible();
  });

  test('DS-DIVD-39 Export follows the sitting date and the Questions Activity filter', async ({ as }) => {
    const page = await as(ME);
    need(await applyOtherDay(page, ME), 'no sitting day in the session calendar');
    await kpi(page, DIV_KPIS.provisional).click();
    await expect(filterChip(page, L.fProvisional)).toBeVisible();
    const csv = await exportCsv(page);
    // The area brief limits CSV checks to the file name and the header rows the design names, not the rows below them.
    expect(csv.name).toMatch(new RegExp(`^${esc(L.csvFile)}${ISO_DAY}\\.csv$`));
    expectCsvHeaders(csv.text);
  });
});

/** The header rows the design names for the Division CSV. */
function expectCsvHeaders(text: string): void {
  expectCsvRow(text, [E.csvKpi, E.csvValue]);
  expectCsvRow(text, [E.colDiary, E.csvQno, E.colQuestion, E.colHouse, L.csvSitting, L.csvStage, L.csvStatus, E.csvOfficer, E.colDeadline, L.csvLastUpdate]);
  expectCsvRow(text, [E.colDiary, L.colQuestion, E.colHouse, L.colFrom, L.colRequested, L.csvStatus]);
  expectCsvRow(text, [E.colDiary, E.colHouse, E.colQuestion, E.colDays, E.colDeadline, L.csvRisk]);
}
