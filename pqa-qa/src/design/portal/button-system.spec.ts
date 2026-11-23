import type { Locator, Page } from '@playwright/test';
import { test, expect } from '../fixtures.js';
import { notMeasured } from '../../support/annotations.js';
import { labels } from '../labels/buttons.js';
import type { DesignPersona } from '../design-env.js';

// DS-BTN: the FINAL page's button-system rules, checked on every FINAL screen reachable without test data.
// Read-only: nothing is pressed except Tab, hover, and Delete chat → Cancel.

const EXEC = labels['FigmaTestingCal2-5g42.dc.html']!;
const AI = labels['ExecAIAssistant.dc.html']!;

interface Screen { name: string; persona: DesignPersona; heading: string; open?: (page: Page) => Promise<void> }
const SCREENS: Screen[] = [
  { name: 'Executive Dashboard', persona: 'executive', heading: EXEC.home! },
  { name: 'Parliament user dashboard', persona: 'parliament', heading: labels['FigmaTestingCal2-5g42-ux4gbar.dc.html']!.home! },
  { name: 'My Division Dashboard', persona: 'division', heading: labels['FigmaTestingCal2-5g42-i92s.dc.html']!.home! },
  {
    name: 'Executive AI Assistant', persona: 'executive', heading: AI.welcome!,
    open: async (page) => page.getByRole('link', { name: EXEC.aiAssistant!, exact: true }).click(),
  },
];

/** Each FINAL screen in turn, signed in as its persona; `check` returns the violations found there. */
async function onEveryScreen(as: (p: DesignPersona) => Promise<Page>, check: (page: Page) => Promise<string[]>): Promise<string[]> {
  const found: string[] = [];
  for (const s of SCREENS) {
    await test.step(s.name, async () => {
      const page = await as(s.persona);
      await s.open?.(page);
      await expect(page.getByRole('heading', { name: s.heading, exact: true })).toBeVisible();
      found.push(...(await check(page)).map((v) => `${s.name}: ${v}`));
    });
  }
  return found;
}

const visibleButtons = async (page: Page): Promise<Locator[]> => {
  const all = await page.getByRole('button').all();
  const shown: Locator[] = [];
  for (const b of all) if (await b.isVisible()) shown.push(b);
  return shown;
};

/** The icon font renders ligature words ("content_copy") as glyphs, so a button whose only text is such words has
 * no visible label. */
const iconOnly = (text: string): boolean => /^[a-z_\s]*$/.test(text.trim());
const nameOf = (b: Locator): Promise<string> =>
  b.evaluate((el) => {
    const by = el.getAttribute('aria-labelledby');
    const ref = by ? by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : '';
    return (el.getAttribute('aria-label') ?? ref ?? '').trim();
  });

test.describe('DS-BTN — Button system on the FINAL screens (design)', () => {
  test('DS-BTN-01 Icon-only buttons have a name and a matching tooltip', async ({ as }) => {
    const bad = await onEveryScreen(as, async (page) => {
      const out: string[] = [];
      for (const b of await visibleButtons(page)) {
        if (!iconOnly(await b.innerText())) continue;
        const name = await nameOf(b);
        if (!name || iconOnly(name)) { out.push(`icon button "${(await b.innerText()).trim()}" has no accessible name`); continue; }
        await b.hover();
        // The design's tooltip carries the same words; a dynamic name may append context ("Delete chat: <title>").
        const tip = page.getByRole('tooltip').filter({ visible: true }).first();
        const text = (await tip.isVisible({ timeout: 1_500 }).catch(() => false)) ? (await tip.innerText()).trim() : '';
        if (!text) out.push(`"${name}" shows no tooltip`);
        else if (!name.toLowerCase().startsWith(text.toLowerCase())) out.push(`"${name}" tooltip reads "${text}"`);
      }
      return out;
    });
    expect(bad, 'icon-only buttons without a name or matching tooltip').toEqual([]);
  });

  test('DS-BTN-02 Keyboard focus shows a ring on every button', async ({ as }) => {
    const bad = await onEveryScreen(as, async (page) => {
      const out: string[] = [];
      await page.locator('body').click({ position: { x: 1, y: 1 } });
      for (let i = 0; i < 80; i++) {
        await page.keyboard.press('Tab');
        const f = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || !(el.tagName === 'BUTTON' || el.getAttribute('role') === 'button')) return null;
          const cs = getComputedStyle(el);
          const ring = (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2) || cs.boxShadow !== 'none';
          return { ring, name: el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 40) || '?' };
        });
        if (f && !f.ring) out.push(`"${f.name}" has no visible focus ring`);
      }
      return [...new Set(out)];
    });
    expect(bad, 'buttons with no focus indicator on keyboard focus').toEqual([]);
  });

  test('DS-BTN-03 Buttons are at least 32 x 32 px', async ({ as }) => {
    const bad = await onEveryScreen(as, async (page) => {
      const out: string[] = [];
      for (const b of await visibleButtons(page)) {
        const box = await b.boundingBox();
        // 0.5 px tolerance for sub-pixel layout.
        if (box && (box.width < 31.5 || box.height < 31.5)) out.push(`"${(await nameOf(b)) || (await b.innerText()).trim()}" is ${Math.round(box.width)}×${Math.round(box.height)} px`);
      }
      return out;
    });
    expect(bad, 'buttons smaller than 32 × 32 px').toEqual([]);
  });

  test('DS-BTN-04 Danger red only inside a dialog that asks first', async ({ as }) => {
    const page = await as('executive');
    await page.getByRole('link', { name: EXEC.aiAssistant!, exact: true }).click();
    await expect(page.getByRole('heading', { name: AI.welcome!, exact: true })).toBeVisible();
    // Outside any dialog there is no danger "Delete" button, only icon buttons that ask first.
    await expect(page.getByRole('button', { name: AI.delete!, exact: true })).toHaveCount(0);
    const recents = page.getByRole('navigation', { name: AI.chats! }).getByRole('button', { name: new RegExp(`^${AI.deleteChat}`) });
    if (!(await recents.count())) notMeasured(test.info(), { tracker: 'design-precondition', owner: 'QA', detail: 'no recent chat to open the delete dialog on' });
    const before = await recents.count();
    await recents.first().focus();
    await recents.first().click();
    const dialog = page.getByRole('alertdialog', { name: AI.deleteDialog!, exact: true });
    await expect(dialog.getByRole('button', { name: AI.delete!, exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: AI.cancel!, exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(recents).toHaveCount(before);
  });

  test('DS-BTN-05 Labels say what happens, never OK', async ({ as }) => {
    const bad = await onEveryScreen(as, async (page) => {
      // "OK" is the label the design forbids, so it is a pattern here, not a design label.
      const ok = await page.getByRole('button', { name: /^\s*ok\s*$/i }).count();
      return ok ? [`${ok} button(s) labelled OK`] : [];
    });
    expect(bad).toEqual([]);
  });
});
