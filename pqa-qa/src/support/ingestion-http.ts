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

/** Pairs a batch's results with the files sent. The ingestion service returns one result per file, in order, but a
 * quarantined result has no filename — so position decides, unless a filename says otherwise. With a different
 * count, only names can be trusted. */
export function matchResults(names: string[], items: any[]): Array<any | undefined> {
  const byName = (n: string) => items.find((i) => i?.filename === n);
  if (items.length !== names.length) return names.map(byName);
  return names.map((n, i) => (items[i]?.filename && items[i].filename !== n ? byName(n) : items[i]));
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

export interface FilePart {
  filename: string;
  /** Omitted = no declared type (case F15): sent as an empty MIME type, as a browser does for an unknown file. */
  mime?: string;
  data: Buffer;
}

/** The KB Docs stream (POST …/file-ingestions/batch-stream, server-sent events): each file's `file_done` (or
 * `file_error`) event carries the same result object the JSON batch route returns. Results come back in file order. */
export function streamResults(text: string): any[] {
  const out: any[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const event = /^event: ?(.*)$/m.exec(block)?.[1]?.trim();
    const data = [...block.matchAll(/^data: ?(.*)$/gm)].map((m) => m[1]).join('\n');
    if ((event !== 'file_done' && event !== 'file_error') || !data) continue;
    const d = JSON.parse(data);
    out[typeof d.index === 'number' ? d.index : out.length] = d.result ?? { filename: d.filename, status: d.status ?? 'failed', error: d.error ?? d.message };
  }
  return out;
}
