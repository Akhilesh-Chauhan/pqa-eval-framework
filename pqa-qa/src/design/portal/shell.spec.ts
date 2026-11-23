import type { Page } from '@playwright/test';
import { test, expect, requireWrites } from '../fixtures.js';
import { notMeasured } from '../../support/annotations.js';
import { DESIGN_PERSONAS } from '../design-env.js';
import type { DesignPersona } from '../design-env.js';
import { labels } from '../labels/dashboards.js';
import type { DivisionLabels, ExecutiveLabels, ParliamentLabels } from '../labels/dashboards.js';
import {
  DATE, DAY, HOUSE, MENU, accName, bell, calButton, caps, clickOutside, dayDate, dayGrid, dayTime, divisionName,
  dropdown, esc, expectOrder, expectRoleLabel, findDay, h1, hasFocus, listbox, menu, menuLink, notifications, openCalendar,
  openNotifications, region, resultsTitle, search, searchbox, sections, selectedDay, sittingDateButton, sittingDay, tabTo,
  textScale, toast, updated, UPDATED,
} from './dashboards-nav.js';

// DS-SHELL: the portal shell on the three FINAL dashboards. "Any persona" cases run as the Executive; "each persona"
// cases run once per dashboard. Only the FINAL boards count: cases that exist only on board 14 (Shell) or 13
// (Compliance) are out of scope, and where a kept case also cites them only what the FINAL boards show is asserted.

const L = labels['FigmaTestingCal2-5g42.dc.html']! as ExecutiveLabels;
const P = labels['FigmaTestingCal2-5g42-ux4gbar.dc.html']! as ParliamentLabels;
const D = labels['FigmaTestingCal2-5g42-i92s.dc.html']! as DivisionLabels;

const roleOf = async (page: Page, persona: DesignPersona): Promise<string> =>
  persona === 'executive' ? L.role : persona === 'parliament' ? P.role : divisionName(page);

/** Accessible names of every named node in the page's accessibility tree. */
const accNames = async (page: Page): Promise<string[]> =>
  [...(await page.locator('body').ariaSnapshot()).matchAll(/^\s*- [\w-]+ ("(?:[^"\\]|\\.)*")/gm)].map((m) => JSON.parse(m[1]!) as string);

// Icon-font ligatures the design hides from assistive technology (DS-SHELL-20). Not labels: they must never show.
const LIGATURES =
  /\b(?:text_decrease|font_download|text_increase|accessibility_new|language|arrow_drop_down|open_in_new|arrow_forward|download|expand_less|visibility|close|check_circle)\b/;

/** Click handlers on non-native elements (pointer cursor, onclick) and native controls kept out of the Tab order. */
const interactiveAudit = (page: Page, tabOrder: boolean): Promise<string[]> =>
  page.evaluate((tabOrder) => {
    const native = 'a[href], button, input, select, textarea, summary, label, option';
    const shown = (el: Element) => (el as HTMLElement).checkVisibility();
    const fake = [...document.querySelectorAll('body *')]
      .filter((el) => !el.closest(native) && shown(el) && (el.hasAttribute('onclick') || getComputedStyle(el).cursor === 'pointer'))
      .map((el) => `not a native control: ${el.outerHTML.slice(0, 120)}`);
    const untabbable = tabOrder
      ? [...document.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select, textarea')]
        .filter((el) => shown(el) && el.tabIndex < 0)
        .map((el) => `not in the Tab order: ${el.outerHTML.slice(0, 120)}`)
      : [];
    return [...fake, ...untabbable];
  }, tabOrder);

test.describe('DS-SHELL — Portal shell and accessibility (design)', () => {
  test('DS-SHELL-01 Top bar: landmarks, utilities and the Government of India link', async ({ as }) => {
    const page = await as('executive');
    const banner = page.getByRole('banner');
    const goi = banner.getByRole('link', { name: L.goi, exact: true });
    await expect(goi).toContainText(L.goiText);
    await expect(goi).toHaveAttribute('href', 'https://www.india.gov.in/');
    await expect(goi).toHaveAttribute('target', '_blank');
    await expect(goi).toHaveAttribute('rel', /\bnoopener\b/);
    const util = banner.getByRole('navigation', { name: L.topUtilities, exact: true });
    const sizes = util.getByRole('group', { name: L.textSize, exact: true });
    for (const name of [L.textDec, L.textReset, L.textInc]) await expect(sizes.getByRole('button', { name, exact: true })).toBeVisible();
    const lang = util.getByRole('button', { name: L.lang, exact: true });
    await expect(lang).toContainText(L.english);
    await expectOrder([
      goi, util, util.getByRole('link', { name: L.skip, exact: true }), sizes,
      util.getByRole('button', { name: L.a11y, exact: true }), lang,
    ]);
  });

  test('DS-SHELL-02 Skip link moves focus to the main content', async ({ as }) => {
    const page = await as('executive');
    await tabTo(page, page.getByRole('link', { name: L.skip, exact: true }));
    await page.keyboard.press('Enter');
    const main = page.getByRole('main');
    await expect(main).toHaveAttribute('id', 'main-content');
    await expect(main).toBeFocused();
    await expect(main).toBeInViewport();
    await page.keyboard.press('Tab');
    expect(await main.evaluate((m) => m !== document.activeElement && m.contains(document.activeElement)), 'next Tab stays in main').toBe(true);
  });

  test('DS-SHELL-03 Skip link is the first Tab stop', async ({ as }) => {
    // OQ-2 settled for the FINAL boards: "Government of India" is the first Tab stop, the skip link the second.
    const page = await as('executive');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: L.goi, exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: L.skip, exact: true });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
  });

  test('DS-SHELL-04 Text size: increase, decrease and reset', async ({ as }) => {
    const page = await as('executive');
    const sizes = page.getByRole('group', { name: L.textSize, exact: true });
    const [main, bar, side] = [page.getByRole('main'), page.getByRole('banner'), menu(page)];
    const [base, barBase, sideBase] = [await textScale(main), await textScale(bar), await textScale(side)];
    const scale = async () => Math.round((100 * (await textScale(main))) / base);
    const press = async (name: string, expected: number[]) => {
      for (const want of expected) {
        await sizes.getByRole('button', { name, exact: true }).click();
        await expect.poll(scale, `${name} → ${want}%`).toBe(want);
      }
    };
    await press(L.textInc, [110, 120, 120]);
    expect(await textScale(bar), 'top bar keeps its size').toBe(barBase);
    expect(await textScale(side), 'sidebar keeps its size').toBe(sideBase);
    await press(L.textDec, [110, 100, 90, 90]);
    await press(L.textReset, [100]);
  });

  test('DS-SHELL-05 Language selector opens and closes', async ({ as }) => {
    const page = await as('executive');
    const lang = page.getByRole('button', { name: L.lang, exact: true });
    await lang.click();
    await expect(lang).toHaveAttribute('aria-expanded', 'true');
    const lb = listbox(page, L.language);
    const en = lb.getByRole('option', { name: L.english, exact: true });
    const hi = lb.getByRole('option', { name: L.hindi, exact: true });
    await expect(en).toHaveAttribute('aria-selected', 'true');
    await expect(hi).toHaveAttribute('lang', 'hi');
    await expect(hi).toHaveAttribute('aria-selected', 'false');
    await en.click();
    await expect(lb).toBeHidden();
    await expect(lang).toHaveAttribute('aria-expanded', 'false');
    await expect(lang).toHaveAccessibleName(L.lang);
  });

  test('DS-SHELL-07 UX4G accessibility widget opens with all profiles and tools', async () => {
    notMeasured(test.info(), { tracker: 'design-OQ', owner: 'UI/UX', detail: 'OQ-3: on the FINAL boards "Accessibility options" is a "not part of this prototype yet" placeholder' });
  });

  for (const persona of DESIGN_PERSONAS) {
    test.describe(persona, () => {
      test('DS-SHELL-10 Main menu (sidebar) structure', async ({ as }) => {
        const page = await as(persona);
        const side = menu(page);
        await expect(side.getByText(L.logoSlot, { exact: true }).or(side.getByRole('img')).first()).toBeVisible();
        const items = MENU[persona].map((name) => menuLink(page, name));
        for (const item of items) await expect(item).toBeVisible();
        await expectOrder(items);
        await expect(sections(page).locator('[aria-current="page"]')).toHaveCount(1);
        await expect(menuLink(page, L.dashboard)).toHaveAttribute('aria-current', 'page');
        const version = side.getByText(new RegExp(`^v\\d+\\.\\d+\\.\\d+ · ${esc(L.versionUpdated)} ${DATE}$`));
        await expect(version).toBeVisible();
        const top = (await side.boundingBox())!.y;
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await expect.poll(async () => (await side.boundingBox())!.y, 'menu stays in place').toBe(top);
        await expect(version).toBeInViewport();
      });

      test('DS-SHELL-11 Header search form', async ({ as }) => {
        const page = await as(persona);
        const form = page.getByRole('search', { name: L.searchForm, exact: true });
        const go = form.getByRole('button', { name: L.search, exact: true });
        await expect(searchbox(page, persona)).toBeVisible();
        await expect(go).toBeVisible();
        const term = 'zzqa';
        const results = persona === 'division'
          ? page.getByRole('button', { name: new RegExp(`^${esc(D.clearFilter)}${esc(D.resultsFor)}${term}["“”]$`) })
          : region(page, resultsTitle(term));
        await search(page, persona, term);
        await expect(results).toBeVisible();
        await searchbox(page, persona).fill('');
        await go.click();
        await expect(results).toBeHidden();
      });

      test('DS-SHELL-13 Greeting and role label', async ({ as }) => {
        const page = await as(persona);
        const greeting = page.getByText(new RegExp(`^${esc(L.greeting)} \\S`)).first();
        await expect(greeting).toBeVisible();
        const name = (await greeting.innerText()).slice(L.greeting.length).trim();
        await expectRoleLabel(page, await roleOf(page, persona));
        await expect(page.getByText(name[0]!.toUpperCase(), { exact: true }).first(), 'avatar initial').toBeVisible();
      });

      test('DS-SHELL-22 Page title and language attributes', async ({ as }) => {
        const page = await as(persona);
        // FINAL boards only: their <title> is prototype text and they set no description, so neither is checked.
        await expect(h1(page, persona)).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        await page.getByRole('button', { name: L.lang, exact: true }).click(); // brings the हिन्दी option into the page
        await expect(listbox(page, L.language)).toBeVisible();
        const unmarked = await page.evaluate(() =>
          [...document.querySelectorAll('body *')]
            .filter((el) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && /[ऀ-ॿ]/.test(n.textContent ?? '')))
            .filter((el) => !(el.closest('[lang]')?.getAttribute('lang') ?? '').startsWith('hi'))
            .map((el) => el.outerHTML.slice(0, 120)),
        );
        expect(unmarked, 'Hindi text without lang="hi"').toEqual([]);
      });
    });
  }

  test('DS-SHELL-12 Ministry logo and emblem have text alternatives', async ({ as }) => {
    // The FINAL boards show the header logo only (the emblem is board 14). Its alt: "<ministry>, Government of India".
    const page = await as('executive');
    await expect(page.getByRole('img', { name: new RegExp(`^\\S.*, ${esc(L.goiText)}$`) }).first()).toBeVisible();
  });

  test('DS-SHELL-14 Notifications panel: open, focus, close', async ({ as }) => {
    const page = await as('executive');
    const trigger = bell(page);
    const dialog = notifications(page);
    const close = dialog.getByRole('button', { name: L.closeNotif, exact: true });
    await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    await openNotifications(page);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(dialog.getByText(L.notifTitle, { exact: true })).toBeVisible();
    await expect(close).toBeFocused();
    await expect(dialog.getByRole('button', { name: new RegExp(`^${esc(L.remindAll)}\\d+\\)$`) })).toBeVisible();
    await expect(dialog.getByRole('link', { name: L.reminderSettings, exact: true })).toBeVisible();
    const closes: Array<[string, () => Promise<void>]> = [
      ['Escape', () => page.keyboard.press('Escape')],
      [L.closeNotif, () => close.click()],
      ['the bell', () => trigger.click()],
    ];
    for (const [how, shut] of closes) {
      await test.step(`close with ${how}`, async () => {
        if (!(await dialog.isVisible())) await openNotifications(page);
        await shut();
        await expect(dialog).toBeHidden();
        await expect(trigger).toHaveAttribute('aria-expanded', 'false');
        await expect(trigger).toBeFocused();
      });
    }
  });

  test('DS-SHELL-15 Toast is a status message and can be dismissed', async ({ as }) => {
    const page = await as('executive');
    await page.getByRole('button', { name: L.refresh, exact: true }).click();
    const msg = new RegExp(`${esc(L.refreshed)}\\d{2}:\\d{2}:\\d{2}\\.`);
    const t = toast(page, msg);
    await expect(t).toBeVisible();
    await expect(t).toHaveAttribute('aria-live', 'polite');
    await t.getByRole('button', { name: L.dismiss, exact: true }).click();
    await expect(page.getByText(msg)).toBeHidden();
    // It must stay away until a new action posts one: give a re-render the chance to bring it back.
    await page.waitForTimeout(2_000);
    await expect(page.getByText(msg)).toBeHidden();
  });

  test('DS-SHELL-16 Toast is held while the notifications panel is open', async ({ as, denv }) => {
    requireWrites(denv);
    // Division officer: "Mark all as read" sends nothing to anyone, unlike "Remind all overdue".
    const page = await as('division');
    const dialog = await openNotifications(page);
    await dialog.getByRole('button', { name: D.markAllRead, exact: true }).click();
    await page.waitForTimeout(1_000);
    await expect(page.getByText(D.allRead, { exact: true }), 'no toast while the panel is open').toBeHidden();
    await dialog.getByRole('button', { name: L.closeNotif, exact: true }).click();
    await expect(page.getByText(D.allRead, { exact: true })).toBeVisible();
  });

  test('DS-SHELL-17 Last updated and Refresh', async ({ as }) => {
    test.setTimeout(180_000);
    const page = await as('executive');
    await expect(updated(page)).toContainText(UPDATED);
    // Refresh first so the value is "just now": then its 30 s tick to "1 minute ago" is certain to show.
    await page.getByRole('button', { name: L.refresh, exact: true }).click();
    await expect(updated(page)).toContainText(new RegExp(`${esc(L.lastUpdated)}\\s*${esc(L.justNow)}`));
    await expect(toast(page, new RegExp(`${esc(L.refreshed)}\\d{2}:\\d{2}:\\d{2}\\.`))).toBeVisible();
    await expect(updated(page)).toContainText(new RegExp(`${esc(L.lastUpdated)}\\s*1 [a-z]+${esc(L.ago)}`), { timeout: 100_000 });
  });

  test('DS-SHELL-19 Every control is a real button, link or input', async ({ as }) => {
    const page = await as('executive');
    const found = await interactiveAudit(page, true);
    await openNotifications(page);
    found.push(...(await interactiveAudit(page, true)));
    await page.keyboard.press('Escape');
    await openCalendar(page, 'executive');
    // Only one calendar day sits in the Tab order by design (arrow keys move between days).
    found.push(...(await interactiveAudit(page, false)));
    expect(found).toEqual([]);
  });

  test('DS-SHELL-20 Icon ligatures and decorative icons are hidden from assistive technology', async ({ as }) => {
    const page = await as('executive');
    await expect(page.getByRole('button', { name: L.refresh, exact: true })).toBeVisible();
    const workload = region(page, L.workload);
    await workload.getByRole('button', { name: L.viewAll, exact: true }).click();
    await expect(workload.getByRole('button', { name: L.showTop4, exact: true })).toBeVisible();
    await openNotifications(page);
    const division = await as('division');
    await expect(h1(division, 'division')).toBeVisible();
    for (const [who, p] of [['executive', page], ['division', division]] as const) {
      expect((await accNames(p)).filter((n) => LIGATURES.test(n)), `${who}: names carrying icon text`).toEqual([]);
    }
  });

  test('DS-SHELL-21 Accessible names start with the visible label', async () => {
    notMeasured(test.info(), { tracker: 'design-OQ', owner: 'UI/UX', detail: 'OQ-5: the design names Remind, Send SMS and Send Email "Send a … reminder for …"' });
  });

  test('DS-SHELL-31 Reflow at 320 px', async () => {
    notMeasured(test.info(), { tracker: 'design-OQ', owner: 'UI/UX', detail: 'OQ-11: the FINAL boards fix 1280 / 1440 px widths against reflow at 320 px' });
  });

  test('DS-SHELL-34 Tooltips on hover and focus', async ({ as }) => {
    const page = await as('executive');
    const table = region(page, L.breakup).getByRole('table', { name: L.breakupTable, exact: true });
    const sort = table.getByRole('button', { name: caps(L.colProvisional) });
    const tip = page.getByRole('tooltip').filter({ hasText: new RegExp(`^${esc(L.sortBy)}${esc(L.colProvisional)}, `) });
    await sort.hover();
    await expect(tip).toBeVisible();
    const box = (await tip.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await expect(tip, 'stays while the pointer is on it').toBeVisible();
    await clickOutside(page);
    await table.getByRole('button', { name: caps(L.colAssigned) }).focus();
    await page.keyboard.press('Tab');
    await expect(sort).toBeFocused();
    await expect(tip).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tip).toBeHidden();
  });

  test('DS-SHELL-35 Session calendar dialog: open, focus trap, dismiss without applying', async ({ as }) => {
    const page = await as('executive');
    const button = sittingDateButton(page, 'executive');
    const applied = await accName(button);
    const cal = await openCalendar(page, 'executive');
    await expect(cal).toHaveAttribute('aria-modal', 'true');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(selectedDay(cal)).toBeFocused();
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let i = 1; i <= 12; i++) {
        await page.keyboard.press(key);
        expect(await hasFocus(cal), `${key} ×${i} stays in the dialog`).toBe(true);
      }
    }
    const dismissals: Array<[string, () => Promise<void>]> = [
      ['Escape', () => page.keyboard.press('Escape')],
      [L.closeCal, () => calButton(cal, L.closeCal).click()],
      ['a click outside', () => clickOutside(page)],
    ];
    for (const [how, dismiss] of dismissals) {
      await test.step(`select another day, then ${how}`, async () => {
        if (!(await cal.isVisible())) await openCalendar(page, 'executive');
        const other = await findDay(cal, sittingDay(), await accName(selectedDay(cal)));
        expect(other, 'another sitting day in the session').toBeDefined();
        await other!.click();
        await dismiss();
        await expect(cal).toBeHidden();
        await expect(button).toHaveAccessibleName(applied);
        await expect(button).toBeFocused();
      });
    }
  });

  test('DS-SHELL-36 Session calendar: day grid, keyboard and month navigation', async ({ as }) => {
    const page = await as('executive');
    const cal = await openCalendar(page, 'executive');
    const grid = dayGrid(cal);
    expect(await cal.ariaSnapshot(), 'weekday headings are hidden').not.toMatch(/\b(?:SUN|MON|TUE|WED|THU|FRI|SAT)\b/);
    const days = [...(await grid.ariaSnapshot()).matchAll(/^\s*- button ("(?:[^"\\]|\\.)*")(.*)$/gm)].map((m) => ({
      name: JSON.parse(m[1]!) as string,
      disabled: m[2]!.includes('[disabled]'),
      pressed: m[2]!.includes('[pressed]'),
    }));
    expect(days.length).toBeGreaterThanOrEqual(28);
    for (const d of days) {
      expect(d.name).toMatch(DAY);
      if (d.name.endsWith(`, ${L.noSitting}`)) expect(d.disabled, `${d.name} is disabled`).toBe(true);
      expect(d.pressed, `${d.name}: pressed only when selected`).toBe(d.name.endsWith(`, ${L.selected}`));
    }
    const inTabOrder = await grid.getByRole('button').evaluateAll((els) =>
      els.filter((el) => (el as HTMLButtonElement).tabIndex >= 0 && !(el as HTMLButtonElement).disabled).length,
    );
    expect(inTabOrder, 'one day in the Tab order').toBe(1);
    for (const legend of [L.legendNon, L.lokSabha, L.rajyaSabha, L.legendSitting, L.legendSelected]) {
      await expect(cal.getByText(legend, { exact: true }).first()).toBeVisible();
    }

    await test.step('arrow keys move between sitting days and selection follows focus', async () => {
      const focused = cal.locator(':focus');
      const selectedSitting = new RegExp(`, ${HOUSE} ${esc(L.sits)}, ${esc(L.selected)}$`);
      let at = dayTime(await accName(focused));
      for (const [key, later] of [['ArrowRight', true], ['ArrowLeft', false], ['ArrowDown', true], ['ArrowUp', false]] as const) {
        await page.keyboard.press(key);
        await expect(focused).toHaveAccessibleName(selectedSitting);
        const now = dayTime(await accName(focused));
        expect(later ? now > at : now < at, `${key} moves ${later ? 'later' : 'earlier'}`).toBe(true);
        at = now;
      }
    });

    await test.step('PageDown and PageUp change the month', async () => {
      const month = async () => accName(dayGrid(cal));
      const start = await month();
      await page.keyboard.press('PageDown');
      await expect.poll(month).not.toBe(start);
      await page.keyboard.press('PageUp');
      await expect.poll(month).toBe(start);
    });

    for (const step of [L.nextMonth, L.prevMonth]) {
      await test.step(`${step} is disabled at the end of the range`, async () => {
        for (let i = 0; i < 24 && (await calButton(cal, step).isEnabled()); i++) await calButton(cal, step).click();
        await expect(calButton(cal, step)).toBeDisabled();
      });
    }
  });

  test('DS-SHELL-37 Session calendar: SELECTED SITTING panel', async ({ as }) => {
    const page = await as('executive');
    const cal = await openCalendar(page, 'executive');
    await selectedDay(cal).click();
    // The panel: the innermost element holding both its headings.
    const panel = cal.locator('*')
      .filter({ has: cal.getByText(caps(L.selSitting)) })
      .filter({ has: cal.getByText(caps(L.onSitting)) })
      .last();
    await expect(panel.getByText(new RegExp(`^\\S+${esc(L.dayOf)}\\d+${esc(L.of)}\\d+${esc(L.sittings)}$`))).toBeVisible();
    await expect(panel.getByText(new RegExp(`^${HOUSE}$`)), 'one house sits per day').toHaveCount(1);
    await expect(panel.getByText(caps(L.sessionHead))).toBeVisible();
    await expect(panel.getByText(L.questionHour)).toBeVisible();
    await expect(panel.getByText(L.sittingHours)).toBeVisible();
    for (const t of [L.qListed, L.starUnstar, L.dueToday, L.overdueAlready]) await expect(panel.getByText(t, { exact: true })).toBeVisible();
    await expect(cal.getByText(new RegExp(`${esc(L.sessionsPill)} · \\d{1,2} \\S+ – \\d{1,2} \\S+ \\d{4}$`))).toBeVisible();
    expect(dayDate(await accName(selectedDay(cal)))).toMatch(new RegExp(`^${DATE}$`));
  });

  test('DS-SHELL-38 Single-select dropdown: keyboard and pointer', async ({ as }) => {
    const page = await as('executive');
    const button = dropdown(page, L.scope);
    const lb = listbox(page, L.scope);
    const opts = lb.getByRole('option');
    await button.focus();
    await page.keyboard.press('ArrowDown');
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(opts.first()).toBeFocused();
    await expect(opts.first()).toHaveAttribute('aria-selected', 'true');
    const n = await opts.count();
    for (const [key, i] of [['ArrowDown', 1], ['ArrowUp', 0], ['End', n - 1], ['Home', 0]] as const) {
      await page.keyboard.press(key);
      await expect(opts.nth(i), key).toBeFocused();
    }
    const names: string[] = [];
    for (let i = 0; i < n; i++) names.push(await accName(opts.nth(i)));
    const letter = names[n - 1]![0]!.toLowerCase();
    const target = names.findIndex((s, i) => i > 0 && s[0]!.toLowerCase() === letter);
    await page.keyboard.type(letter);
    await expect(opts.nth(target), `type-ahead "${letter}"`).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(lb).toBeHidden();
    await expect(button).toBeFocused();
    await expect(button).toHaveAccessibleName(`${L.scope}: ${names[target]}`);
    const chosen = await accName(button);
    const keyboardOpen = async () => {
      await button.focus();
      await page.keyboard.press('ArrowDown');
    };
    const ways: Array<[string, () => Promise<void>, () => Promise<void>]> = [
      ['Escape', keyboardOpen, () => page.keyboard.press('Escape')],
      ['Tab', keyboardOpen, () => page.keyboard.press('Tab')],
      ['a click outside', () => button.click(), () => clickOutside(page)],
    ];
    for (const [how, open, close] of ways) {
      await test.step(`close with ${how}`, async () => {
        await open();
        await expect(lb).toBeVisible();
        await close();
        await expect(lb).toBeHidden();
        await expect(button).toHaveAccessibleName(chosen);
        if (how === 'Escape') await expect(button).toBeFocused();
      });
    }
  });

  test('DS-SHELL-39 Tables, regions and headings are marked up', async ({ as }) => {
    const page = await as('executive');
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    const h2 = [...(await page.getByRole('main').ariaSnapshot()).matchAll(/- heading ("(?:[^"\\]|\\.)*") \[level=2\]/g)].map(
      (m) => JSON.parse(m[1]!) as string,
    );
    expect(h2.length).toBeGreaterThan(0);
    for (const name of h2) await expect(region(page, name), `region named by "${name}"`).toHaveCount(1);
    for (const table of await page.getByRole('table').all()) await expect(table).toHaveAccessibleName(/\S/);
    const breakup = page.getByRole('table', { name: L.breakupTable, exact: true });
    await expect(breakup.getByRole('rowheader').first()).toBeVisible();
    await expect(breakup.getByRole('columnheader').and(breakup.locator('[aria-sort]'))).toHaveCount(5);
    const top = page.getByRole('table', { name: L.tdTable, exact: true });
    await expect(top.getByRole('columnheader').first()).toBeVisible();
    if (await top.getByRole('row').nth(1).count()) await expect(top.getByRole('cell').first()).toBeVisible();
  });
});

