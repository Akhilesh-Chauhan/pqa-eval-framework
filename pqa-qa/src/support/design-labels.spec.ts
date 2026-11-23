import { existsSync, readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { DESIGN_LABELS } from '../design/labels.js';

// Offline gate: every label the design specs click or assert must exist on the design board it was taken from, in
// the design snapshot's inventory (PQA_DESIGN_INVENTORY). A renamed or dropped label fails here, before a browser run.

/** Icon-font ligatures glued to visible text in the design source ("auto_awesomeDraft with AI"), curly quotes, spaces. */
export const normalise = (s: string): string =>
  s.replace(/^(?:[a-z]+_)*[a-z]+(?=[A-Z])/, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

export function labelOnBoard(label: string, board: Record<string, unknown>): boolean {
  const want = normalise(label);
  const strings = Object.values(board).flatMap((v) => (Array.isArray(v) ? v : [])).map((s) => normalise(String(s)));
  return strings.some((s) => s === want || (want.length > 3 && s.includes(want)));
}

test('normalise strips icon ligatures and curly quotes', () => {
  expect(normalise('auto_awesomeDraft with AI')).toBe('Draft with AI');
  expect(normalise('downloadExport Data')).toBe('Export Data');
  expect(normalise('Today’s  Action Plan')).toBe("Today's Action Plan");
  expect(labelOnBoard('Clear chat', { buttons: ['Cancel'], script_strings: ['Clear chat'] })).toBe(true);
  expect(labelOnBoard('Delete everything', { buttons: ['Cancel'] })).toBe(false);
});

test('every label used by the design specs is on its design board', () => {
  const path = process.env.PQA_DESIGN_INVENTORY?.trim();
  test.skip(!path || !existsSync(path), 'PQA_DESIGN_INVENTORY is not set — the design label check needs the snapshot inventory');
  const inventory = JSON.parse(readFileSync(path!, 'utf8')) as Record<string, Record<string, unknown>>;
  const missing: string[] = [];
  for (const [board, labels] of Object.entries(DESIGN_LABELS)) {
    const inv = inventory[board];
    if (!inv) {
      missing.push(`${board}: board not in the inventory`);
      continue;
    }
    for (const label of labels) if (!labelOnBoard(label, inv)) missing.push(`${board}: "${label}"`);
  }
  expect(missing, 'labels used by src/design specs that the design no longer has').toEqual([]);
});
