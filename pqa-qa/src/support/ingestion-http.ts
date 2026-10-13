import { randomBytes } from 'node:crypto';
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
  /** Omitted = the part carries no Content-Type (case F15). */
  mime?: string;
  data: Buffer;
}

/** multipart/form-data with every file under "files". Built by hand because Playwright's multipart option
 * always sends a Content-Type, and F15 needs a part without one. */
export function multipart(files: FilePart[]): { body: Buffer; contentType: string } {
  const boundary = `----pqaqa${randomBytes(12).toString('hex')}`;
  // RFC 7578 §4.2: percent-encode quotes and drop line breaks so a filename cannot end its header.
  const safe = (s: string) => s.replace(/"/g, '%22').replace(/[\r\n]/g, '');
  const parts = files.flatMap((f) => [
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${safe(f.filename)}"\r\n${f.mime ? `Content-Type: ${f.mime}\r\n` : ''}\r\n`),
    f.data,
    Buffer.from('\r\n'),
  ]);
  return { body: Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]), contentType: `multipart/form-data; boundary=${boundary}` };
}
