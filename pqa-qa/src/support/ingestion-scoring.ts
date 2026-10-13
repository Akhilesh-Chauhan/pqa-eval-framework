import type { DocType, Expect, SetupId } from './golden-manifest.js';
import { meets } from './ingestion-http.js';
import type { Outcome } from './ingestion-http.js';

/** Field rules from the spec §5: identifiers exact after normalising, dates as ISO, text by word overlap ≥ 0.8,
 * lists by F1, long text reported only. */

export type FieldKind = 'id' | 'date' | 'text' | 'list' | 'long';
const KIND: Record<string, FieldKind> = {
  file_number: 'id', act_number: 'id', release_id: 'id', diary_number: 'id',
  date: 'date', answered_on: 'date',
  members: 'list', documents_required: 'list',
  details: 'long', eligibility: 'long', benefits: 'long', exclusions: 'long', application_process: 'long', faqs: 'long', summary: 'long',
};
export const kindOf = (field: string): FieldKind => KIND[field] ?? 'text';
export const MATCH = 0.8;

export const normalizeId = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const month = (word: string): number => MONTHS.indexOf(word.slice(0, 3)) + 1;

/** yyyy-mm-dd, or undefined. Numeric dates are day-first (Indian usage); month names may be misspelt ("Feburary"). */
export function parseDate(s: string): string | undefined {
  const t = s.trim().toLowerCase();
  const iso = (y: number, m: number, d: number) =>
    m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : undefined;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(t);
  if (m) return iso(+m[3]!, +m[2]!, +m[1]!);
  m = /(\d{1,2})(?:st|nd|rd|th)?\s*(?:day of\s+)?([a-z]{3,})\.?,?\s+(\d{4})/.exec(t);
  if (m) return iso(+m[3]!, month(m[2]!), +m[1]!);
  m = /([a-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(t);
  if (m) return iso(+m[3]!, month(m[1]!), +m[2]!);
  return undefined;
}

const FILLER = new Set(['of', 'the', 'and', 'for', 'to', 'in', 'on', 'a', 'an', 'by', 'shri', 'smt', 'dr']);
const words = (s: string): Set<string> => new Set(s.toLowerCase().split(/[^a-z0-9ऀ-ॿ]+/).filter((w) => w && !FILLER.has(w)));

/** Dice coefficient over word sets. 1 = the same words. */
export function similarity(a: string, b: string): number {
  const A = words(a);
  const B = words(b);
  if (!A.size && !B.size) return 1;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return (2 * both) / (A.size + B.size);
}

export function listF1(expected: string[], actual: string[]): number {
  if (!expected.length && !actual.length) return 1;
  const left = [...actual];
  let hit = 0;
  for (const e of expected) {
    const i = left.findIndex((a) => similarity(e, a) >= MATCH);
    if (i >= 0) {
      hit++;
      left.splice(i, 1);
    }
  }
  const p = actual.length ? hit / actual.length : 0;
  const r = expected.length ? hit / expected.length : 0;
  return p + r ? (2 * p * r) / (p + r) : 0;
}

const flat = (v: unknown): string =>
  v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.map(flat).join('; ') : typeof v === 'object' ? Object.values(v as object).map(flat).join(' ') : String(v);
const asList = (v: unknown): string[] => (Array.isArray(v) ? v.map(flat) : flat(v).split(/[;,\n]/)).map((s) => s.trim()).filter(Boolean);

export interface FieldScore {
  field: string;
  kind: FieldKind;
  expected: string;
  actual: string;
  score: number;
  /** null for long text: reported, never pass/fail. */
  pass: boolean | null;
}

export function scoreField(field: string, expected: string | string[], actualMeta: Record<string, unknown>): FieldScore {
  const kind = kindOf(field);
  const exp = Array.isArray(expected) ? expected.join('; ') : expected;
  const candidates =
    field === 'ministry_or_department'
      ? [actualMeta.ministry, actualMeta.department, `${flat(actualMeta.ministry)} ${flat(actualMeta.department)}`.trim()]
      : [actualMeta[field]];
  const score = (raw: unknown): number => {
    const act = flat(raw);
    if (kind === 'id') return normalizeId(exp) !== '' && normalizeId(exp) === normalizeId(act) ? 1 : 0;
    if (kind === 'date') {
      const e = parseDate(exp);
      return e !== undefined && e === parseDate(act) ? 1 : 0;
    }
    if (kind === 'list') return listF1(Array.isArray(expected) ? expected : asList(expected), asList(raw));
    return act ? similarity(exp, act) : 0;
  };
  const scores = candidates.map(score);
  const best = Math.max(...scores);
  const need = kind === 'id' || kind === 'date' ? 1 : MATCH;
  return { field, kind, expected: exp, actual: flat(candidates[scores.indexOf(best)]), score: Math.round(best * 100) / 100, pass: kind === 'long' ? null : best >= need };
}

export interface GateResult {
  id: string;
  setup: SetupId;
  route: string;
  expect: Expect;
  outcome: Outcome;
}

export interface CatResult {
  id: string;
  user_category: string;
  expected_type: DocType;
  actual_type?: string;
  confidence?: number;
  outcome: Outcome;
  truth_status: string;
  fields: FieldScore[];
}

const ratio = (n: number, d: number): number | null => (d ? Math.round((n / d) * 1000) / 1000 : null);

/** Category rows a run never recorded (a batch that threw, a run cut short) stay in the summary as not measured. */
export function withUnrecorded(cat: CatResult[], rows: Array<Pick<CatResult, 'id' | 'user_category' | 'expected_type' | 'truth_status'>>): CatResult[] {
  const seen = new Set(cat.map((c) => c.id));
  return [...cat, ...rows.filter((r) => !seen.has(r.id)).map((r) => ({ ...r, outcome: 'error' as const, fields: [] }))];
}

/** expectedChecks: format-gate checks the run set out to make; the difference from those recorded is reported. */
export function summarize(gate: GateResult[], cat: CatResult[], expectedChecks = gate.length) {
  const falseAccepts = gate.filter((g) => g.expect !== 'A' && g.outcome === 'accept');
  const falseRefusals = gate.filter((g) => g.expect === 'A' && g.outcome !== 'accept');
  const accepted = cat.filter((c) => c.outcome === 'accept');
  const confusion: Record<string, Record<string, number>> = {};
  const byCategory: Record<string, { files: number; correct: number }> = {};
  for (const c of accepted) {
    const row = (confusion[c.expected_type] ??= {});
    const got = c.actual_type ?? 'none';
    row[got] = (row[got] ?? 0) + 1;
    const b = (byCategory[c.user_category] ??= { files: 0, correct: 0 });
    b.files++;
    if (c.actual_type === c.expected_type) b.correct++;
  }
  const verified = accepted.filter((c) => c.truth_status === 'verified');
  const scored = verified.flatMap((c) => c.fields.map((f) => ({ type: c.expected_type, f }))).filter((x) => x.f.pass !== null);
  const byField: Record<string, { checked: number; passed: number }> = {};
  for (const { type, f } of scored) {
    const b = (byField[`${type}.${f.field}`] ??= { checked: 0, passed: 0 });
    b.checked++;
    if (f.pass) b.passed++;
  }
  const confidences = accepted.map((c) => c.confidence).filter((x): x is number => typeof x === 'number');
  return {
    gate: {
      checks: gate.length,
      expectedChecks,
      notRecorded: Math.max(0, expectedChecks - gate.length),
      correct: gate.filter((g) => meets(g.expect, g.outcome)).length,
      falseAccepts: falseAccepts.length,
      falseRefusals: falseRefusals.length,
      falseAcceptCases: falseAccepts.map((g) => `${g.id} ${g.setup} ${g.route}`),
      falseRefusalCases: falseRefusals.map((g) => `${g.id} ${g.setup} ${g.route} (${g.outcome})`),
    },
    category: {
      files: cat.length,
      accepted: accepted.length,
      quarantined: cat.filter((c) => c.outcome === 'quarantine').length,
      notMeasured: cat.filter((c) => c.outcome === 'error' || c.outcome === 'duplicate').length,
      accuracy: ratio(accepted.filter((c) => c.actual_type === c.expected_type).length, accepted.length),
      confusion,
      byCategory,
      lowConfidence: confidences.filter((x) => x < 0.7).length,
      meanConfidence: ratio(confidences.reduce((s, x) => s + x, 0), confidences.length),
    },
    metadata: {
      documents: verified.length,
      documentsAllFieldsMatch: verified.filter((c) => c.fields.every((f) => f.pass !== false)).length,
      fieldAccuracy: ratio(scored.filter((x) => x.f.pass).length, scored.length),
      byField,
    },
  };
}
