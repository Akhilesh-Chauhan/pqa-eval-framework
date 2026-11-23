import { labels as assistant } from './labels/assistant.js';
import { labels as buttons } from './labels/buttons.js';
import { labels as dashboards } from './labels/dashboards.js';
import { labels as qdetail } from './labels/qdetail.js';

/** Every label the design specs click or assert, by the design board (.dc.html) it was taken from. The unit check
 * src/support/design-labels.spec.ts proves each one is still on that board in the design snapshot. */
export const DESIGN_LABELS: Record<string, string[]> = {};
for (const area of [assistant, buttons, dashboards, qdetail]) {
  for (const [board, map] of Object.entries(area)) (DESIGN_LABELS[board] ??= []).push(...Object.values(map));
}
