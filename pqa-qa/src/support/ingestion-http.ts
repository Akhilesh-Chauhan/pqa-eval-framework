import type { Expect } from './golden-manifest.js';

/** What one uploaded file came to. "duplicate" means the tenant's documents were not cleared first. */
export type Outcome = 'accept' | 'refuse' | 'quarantine' | 'duplicate' | 'error';

/** One item of the ingestion service's batch response (status completed | partial | quarantined | duplicate). */
export function classifyItem(item: any): { outcome: Outcome; detail: string } {
  const s = String(item?.status ?? '');
  if (s === 'completed' || s === 'partial') return { outcome: 'accept', detail: s };
  if (s === 'quarantined' || s === 'failed') return { outcome: 'quarantine', detail: `${s} ${item?.error ?? ''}`.trim() };
  if (s === 'duplicate') return { outcome: 'duplicate', detail: 'duplicate — the documents were not cleared before this upload' };
  return { outcome: 'error', detail: `unexpected item status "${s}"` };
}

/** A single-file upload: a 4xx refusal before storage, or the first item's outcome. */
export function classifyUpload(status: number, body: any): { outcome: Outcome; detail: string } {
  const message = String(body?.error?.message ?? body?.error ?? body?.detail ?? '');
  if ([400, 413, 415, 422].includes(status)) return { outcome: 'refuse', detail: `${status} ${message}`.trim() };
  const item = body?.results?.[0];
  if (status < 200 || status >= 300 || !item) return { outcome: 'error', detail: `${status} ${message}`.trim() };
  return classifyItem(item);
}

/** A = accepted and indexed; R = refused before storage; Q = refused or quarantined, never indexed as a success. */
export function meets(expect: Expect, outcome: Outcome): boolean {
  if (expect === 'A') return outcome === 'accept';
  if (expect === 'R') return outcome === 'refuse';
  return outcome === 'refuse' || outcome === 'quarantine';
}
