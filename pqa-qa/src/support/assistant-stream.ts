import { mapCitedSources, type GoldenRow } from './assistant-golden.js';

/** Parses the tenant assistant's SSE chat stream and builds the captured row the scorer reads. */

export interface RawSource {
  filename: string;
  topic: string;
  source_url: string;
  score?: number;
  assembly: string;
  session_date: string;
  question_number: string;
  text_preview: string;
}

export interface StreamResult {
  answer: string;
  sources: RawSource[];
  complete: boolean;
  statuses: string[];
}

const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

function toSource(o: Record<string, unknown>): RawSource {
  const src: RawSource = { filename: str(o.filename), topic: str(o.topic), source_url: str(o.source_url), assembly: str(o.assembly),
    session_date: str(o.session_date), question_number: str(o.question_number), text_preview: str(o.text_preview) };
  if (typeof o.score === 'number') src.score = o.score;
  return src;
}

/** Mirrors the product's safelyParseSources, but keeps text_preview whole. */
function parseSources(raw: unknown): RawSource[] {
  if (Array.isArray(raw)) return raw.filter((o) => o && typeof o === 'object').map(toSource);
  if (typeof raw === 'string') return [toSource({ text_preview: raw })];
  if (raw && typeof raw === 'object') return [toSource(raw as Record<string, unknown>)];
  return [];
}

export function parseStream(text: string): StreamResult {
  const result: StreamResult = { answer: '', sources: [], complete: false, statuses: [] };
  let tokens = '';
  for (const block of text.split('\n\n')) {
    const lines = block.split('\n');
    const event = lines.find((l) => l.startsWith('event:'))?.slice(6).trim();
    const first = lines.findIndex((l) => l.startsWith('data:'));
    if (!event || first < 0) continue;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(lines.slice(first).join('\n').slice(5));
    } catch {
      continue; // [DONE] or a broken block
    }
    if (!data || typeof data !== 'object') continue;
    if (event === 'status') result.statuses.push(str(data.message));
    else if (event === 'token') tokens += str(data.token);
    else if (event === 'complete') {
      result.complete = true;
      result.answer = typeof data.answer === 'string' && data.answer ? data.answer : tokens;
      result.sources = parseSources(data.sources);
    }
  }
  if (!result.complete) result.answer = tokens;
  return result;
}

export interface SearchDoc {
  id?: string;
  text?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Recovers each cited chunk's full text from the search results by its (possibly truncated) preview. */
export function matchContexts(sources: RawSource[], docs: SearchDoc[]): { contexts: string[]; matched: number; unmatched: number } {
  const contexts: string[] = [];
  let matched = 0;
  let unmatched = 0;
  for (const s of sources) {
    const preview = norm(s.text_preview.replace(/\.\.\.$/, ''));
    if (!preview) {
      unmatched++;
      continue;
    }
    const doc = docs.find((d) => norm(d.text ?? '').startsWith(preview));
    if (doc) {
      matched++;
      const text = doc.text ?? '';
      contexts.push(text.length >= s.text_preview.length ? text : s.text_preview);
    } else {
      unmatched++;
      contexts.push(s.text_preview);
    }
  }
  return { contexts, matched, unmatched };
}

export type AskOutcome = 'ok' | 'session-lost' | 'error';

export function askOutcome(status: number): AskOutcome {
  return status === 200 ? 'ok' : status === 401 || status === 403 ? 'session-lost' : 'error';
}

export interface CaptureTiming {
  status: number;
  ttft_ms: number | null;
  total_ms: number;
  error?: string;
}

export interface CaptureMeta extends CaptureTiming {
  contexts_from: 'chat.sources+search.match';
  matched: number;
  unmatched: number;
  chunks: number;
}

export interface CapturedRow extends GoldenRow {
  response: string;
  retrieved_contexts: string[];
  cited_sources: string[];
  cited_sources_raw: string[];
  capture: CaptureMeta;
}

export function buildCapturedRow(row: GoldenRow, stream: StreamResult | null, docs: SearchDoc[], kbNames: Record<string, string>, timing: CaptureTiming): CapturedRow {
  const base = { ...row, capture: { ...timing, contexts_from: 'chat.sources+search.match' as const, matched: 0, unmatched: 0, chunks: 0 } };
  if (timing.error || !stream || !stream.complete) {
    base.capture.error = timing.error ?? 'stream ended without complete event';
    return { ...base, response: '', retrieved_contexts: [], cited_sources: [], cited_sources_raw: [] };
  }
  const { contexts, matched, unmatched } = matchContexts(stream.sources, docs);
  const raw = stream.sources.map((s) => s.filename).filter(Boolean);
  return { ...base, response: stream.answer, retrieved_contexts: contexts, cited_sources: mapCitedSources(raw, kbNames).cited, cited_sources_raw: raw,
    capture: { ...base.capture, matched, unmatched, chunks: contexts.length } };
}
