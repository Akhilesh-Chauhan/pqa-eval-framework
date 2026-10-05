import type { TestInfo } from '@playwright/test';

export const GAP_ANNOTATION = 'known-gap';
export const NOT_MEASURED_ANNOTATION = 'not-measured';

export interface GapMeta {
  tracker: string;
  owner: string;
  detail: string;
}

const SEP = ' · ';

export function formatGapMeta(meta: GapMeta): string {
  return [meta.tracker, meta.owner, meta.detail].join(SEP);
}

export function parseGapMeta(description: string): GapMeta {
  const [tracker = '', owner = '', ...rest] = description.split(SEP);
  return { tracker, owner, detail: rest.join(SEP) };
}

/**
 * Declare that this test is expected to fail against a known, owned gap.
 * A failure is reported as a tracked gap and does not fail the run; a PASS
 * is reported as a closed gap so the annotation gets removed.
 */
export function trackedGap(info: TestInfo, meta: GapMeta): void {
  info.annotations.push({ type: GAP_ANNOTATION, description: formatGapMeta(meta) });
}

/**
 * Declare that this property cannot be measured right now, and skip.
 * Never a pass: an unmeasured boundary is not a safe boundary.
 */
export function notMeasured(info: TestInfo, meta: GapMeta): void {
  info.annotations.push({ type: NOT_MEASURED_ANNOTATION, description: formatGapMeta(meta) });
  info.skip(true, `not measured — ${formatGapMeta(meta)}`);
}
