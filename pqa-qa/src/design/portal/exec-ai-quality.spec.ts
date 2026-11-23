import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { test, expect, requireWrites } from '../fixtures.js';
import type { DesignEnv, DesignPersona } from '../design-env.js';
import { loadGoldenSet } from '../../support/assistant-golden.js';
import type { GoldenRow } from '../../support/assistant-golden.js';
import { exec as L, uncheckedExec as U } from '../labels/assistant.js';
import * as nav from './assistant-nav.js';
import { esc, precondition } from './assistant-nav.js';

// DS-EXAI-46…53 (52 is Manual): answer QUALITY, whatever the format. Each case asks golden rows in fresh chats (a -F2
// row in its -F1's chat, right after it), writes one JSON line per row under runs/design/<PQA_RUN_ID>/ and deletes
// its chats. Pass/fail here needs no judge: an answer arrived and is not a stop or error message; Part 2 answers never
// cite the withheld document; Search returns the expected documents. Fact scores (must_include_facts, hallucination,
// sources) come afterwards from the judge run on exai-quality.jsonl.

interface Doc {
  document: string;
  filename?: string;
  house?: string;
  qno?: number | string;
  question_number?: string;
  answer_date?: string;
  session_date?: string;
}
type Row = Omit<GoldenRow, 'expected_sources'> & {
  expected_sources: Doc[];
  provenance: { part: string; query_style: string; follow_up_of?: string | null };
};
interface SearchCase {
  id: string;
  part: string;
  query_type: string;
  query: string;
  expected_documents: Doc[];
  match: 'all' | 'any';
  expected_within_top: number | null;
  must_not_return: Doc[];
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** The ways a reply date is written: ISO, dd.mm.yyyy, dd/mm/yyyy, "31 July 2026", "31 Jul 2026". */
function dateForms(iso: string): string[] {
  const [y, m, d] = iso.split('-') as [string, string, string];
  const month = MONTHS[Number(m) - 1]!;
  return [iso, `${d}.${m}.${y}`, `${d}/${m}/${y}`, `${Number(d)} ${month} ${y}`, `${Number(d)} ${month.slice(0, 3)} ${y}`];
}
const word = (s: string): RegExp => new RegExp(`(?<![\\w])${esc(s)}(?![\\w])`, 'i');
/** Whether `text` names the document: its file name (or stem), or its house, question number and date together
 * (search_golden.json's rule for matching a result to a document). */
function names(text: string, doc: Doc): boolean {
  const file = doc.filename ?? doc.document.split('/').pop() ?? '';
  if (file && (word(file).test(text) || word(file.replace(/\.[^.]+$/, '')).test(text))) return true;
  const no = String(doc.qno ?? doc.question_number ?? '');
  const date = doc.answer_date ?? doc.session_date;
  const house = { ls: 'lok sabha', rs: 'rajya sabha' }[doc.house ?? ''];
  const t = text.toLowerCase();
  return !!no && !!date && !!house && t.includes(house) && new RegExp(`(?<!\\d)\\*?${no}(?!\\d)`).test(t)
    && dateForms(date).some((f) => t.includes(f.toLowerCase()));
}

/** A deterministic sample of `n` (0 = all) taken round-robin across groups, so every kind of row is asked. */
function spread<T>(xs: T[], key: (x: T) => string, n: number): T[] {
  if (n <= 0 || n >= xs.length) return xs;
  const groups = new Map<string, T[]>();
  for (const x of xs) groups.set(key(x), [...(groups.get(key(x)) ?? []), x]);
  const out: T[] = [];
  for (let i = 0; out.length < n; i++) for (const g of groups.values()) if (i < g.length && out.length < n) out.push(g[i]!);
  return out;
}

// Self-check of the matcher and the sampler; runs whenever this file loads (also on --list).
const WITHHELD: Doc = { document: 'Rajya Sabha 271/310726/Unstarred Question_1504_310726_RS.pdf', house: 'rs', qno: 1504, answer_date: '2026-07-31' };
assert.ok(names('View document: Unstarred Question_1504_310726_RS.pdf, page 1', WITHHELD));
assert.ok(names('Reply in the official format: Rajya Sabha unstarred question 1504, answered on 31.07.2026', WITHHELD));
assert.ok(!names('Rajya Sabha unstarred question 1504, answered on 31.07.2025', WITHHELD));
assert.ok(!names('Lok Sabha unstarred question 1504, answered on 31 July 2026', WITHHELD));
assert.ok(!names('Rajya Sabha unstarred question 15040, answered on 31 July 2026', WITHHELD));
assert.deepEqual(spread(['a1', 'a2', 'a3', 'b1'], (s) => s[0]!, 3), ['a1', 'b1', 'a2']);

const runFile = (name: string): string => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'runs', 'design', process.env.PQA_RUN_ID!);
  mkdirSync(dir, { recursive: true });
  return join(dir, name);
};
const record = (name: string, line: object): void => appendFileSync(runFile(name), `${JSON.stringify(line)}\n`);
const decode = (s: string | null): string => {
  try {
    return decodeURIComponent(s ?? '');
  } catch {
    return s ?? '';
  }
};

function golden(denv: DesignEnv): Row[] {
  precondition(denv.goldenRoot !== undefined, 'PQA_DESIGN_GOLDEN_ROOT not set');
  return loadGoldenSet(join(denv.goldenRoot, 'assistant', 'meity-2part-short-v1')).rows as unknown as Row[];
}
function searchCases(denv: DesignEnv): SearchCase[] {
  precondition(denv.goldenRoot !== undefined, 'PQA_DESIGN_GOLDEN_ROOT not set');
  const file = join(denv.goldenRoot, 'assistant', 'meity-search-v1', 'search_golden.json');
  return (JSON.parse(readFileSync(file, 'utf8')) as { cases: SearchCase[] }).cases;
}
const isFollowUp = (r: Row): boolean => /-F[12]$/.test(r.id);
/** Up to 120 s per answer plus chat set-up and clean-up. */
const budget = (asks: number): number => 120_000 + asks * 150_000;

/** Answer text with layout removed (DS-EXAI-53): author and time lines, headers, kind tags, result-card labels, `*****`. */
const LAYOUT: Array<string | RegExp> = [L.aiAssistant, /^\d{1,2}:\d{2}\s?[ap]m$/i, L.goiCaps, U.ministryCaps, /^(LOK|RAJYA) SABHA$/,
  /QUESTION NO\./, /^TO BE ANSWERED ON/, U.answerHead, /^\*+$/, new RegExp(`^(${nav.KIND_TAGS.map(esc).join('|')})`),
  new RegExp(`^\\d{1,3}${esc(U.match)}$`), L.aiSummary, U.showQA, U.hideQA, new RegExp(`^${esc(L.viewDoc)}`), L.copyAnswer, L.download,
  new RegExp(`(${esc(L.docsMatch)}|${esc(L.docMatches)})$`)];
const stripLayout = (text: string): string =>
  text.split('\n').map((l) => l.trim())
    .filter((l) => l && !LAYOUT.some((m) => (typeof m === 'string' ? l === m : m.test(l))))
    .join('\n');

// QA heuristic: the design draws no error message, so these are the usual failure wordings.
const ERROR = /something went wrong|an error (has )?occurred|request failed|try again later/i;
function answerProblem(text: string): string {
  if (text.includes(L.stopped)) return 'stopped answer';
  if (ERROR.test(text)) return 'error message';
  return stripLayout(text) ? '' : 'empty answer';
}

interface Capture {
  case: string;
  row: string;
  mode: nav.Mode;
  user_input: string;
  response: string;
  response_plain: string;
  sources: nav.Answer['links'];
  format_observed: string;
  ms: number;
  error?: string;
}

async function open(as: (p: DesignPersona) => Promise<Page>): Promise<Page> {
  const page = await as('executive');
  await nav.openExecAssistant(page);
  return page;
}

/** Asks one row in the open chat and appends its line to exai-quality.jsonl. A missing answer is recorded, not thrown. */
async function capture(page: Page, caseId: string, row: Row, mode: nav.Mode): Promise<Capture> {
  const t0 = Date.now();
  const line: Capture = { case: caseId, row: row.id, mode, user_input: row.user_input, response: '', response_plain: '', sources: [], format_observed: '', ms: 0 };
  try {
    const a = await nav.readAnswer(await nav.ask(page, row.user_input, mode));
    Object.assign(line, { response: a.text, response_plain: stripLayout(a.text), sources: a.links, format_observed: a.kind || 'none of the designed kind tags' });
    line.error = answerProblem(a.text) || undefined;
  } catch (e) {
    line.error = `no answer: ${String(e).split('\n')[0]}`;
  }
  line.ms = Date.now() - t0;
  record('exai-quality.jsonl', line);
  return line;
}

/** Each row in a new chat, except a -F2 row, which follows its -F1 in the same chat. Deletes every chat it made. */
async function runRows(page: Page, caseId: string, rows: Row[], mode: nav.Mode = 'generate'): Promise<Capture[]> {
  const out: Capture[] = [];
  for (const row of rows) {
    if (!row.provenance.follow_up_of) {
      await nav.cleanUp(page);
      await nav.newChat(page);
    }
    out.push(await capture(page, caseId, row, mode));
  }
  await nav.cleanUp(page);
  return out;
}

/** Part 2 rows whose answer names or links the withheld document (`expected_sources`). */
function withheldCited(caps: Capture[], rows: Row[]): string[] {
  return caps.flatMap((c) => {
    const row = rows.find((r) => r.id === c.row)!;
    if (row.provenance.part !== '2-not-ingested') return [];
    const shown = [c.response, ...c.sources.map((s) => `${s.name} ${decode(s.href)}`)].join('\n');
    return row.expected_sources.filter((d) => names(shown, d))
      .map((d) => `${c.row}: cites the withheld ${d.document} (Part 2 is void if Rajya Sabha 271 was ingested)`);
  });
}

async function finish(caps: Capture[], failures: string[] = []): Promise<void> {
  const file = runFile('exai-quality.jsonl');
  await test.info().attach('exai-quality.jsonl', { path: file });
  test.info().annotations.push({
    type: 'judge-pending',
    description: `fact, hallucination and source scores need the judge run (qa/golden/assistant/meity-2part-v1/judge_prompts_v1.md) on ${file}`,
  });
  const noAnswer = caps.filter((c) => c.error).map((c) => `${c.row} (${c.mode}): ${c.error}`);
  expect([...noAnswer, ...failures], 'rows that failed a no-judge check').toEqual([]);
}

/** What a search answer returned, in order: per result (article, else link) its text, link names and targets. */
async function returned(answer: Locator): Promise<string[]> {
  const items = (await answer.getByRole('article').count()) ? await answer.getByRole('article').all() : await answer.getByRole('link').all();
  const out: string[] = [];
  for (const item of items) {
    const links = await item.getByRole('link').evaluateAll((ls) => ls.map((l) => `${l.getAttribute('aria-label') ?? ''} ${l.getAttribute('href') ?? ''}`));
    out.push([await item.innerText(), decode(await item.getAttribute('href')), ...links.map(decode)].join(' '));
  }
  return out;
}

interface SearchRun { text: string; texts: string[]; notFound: boolean; ms: number; error?: string }
async function askSearch(page: Page, query: string): Promise<SearchRun> {
  const t0 = Date.now();
  await nav.cleanUp(page);
  await nav.newChat(page);
  try {
    const answer = await nav.ask(page, query, 'search');
    const text = await answer.innerText();
    return { text, texts: await returned(answer), notFound: text.includes(L.notFoundDocs), ms: Date.now() - t0, error: answerProblem(text) || undefined };
  } catch (e) {
    return { text: '', texts: [], notFound: false, ms: Date.now() - t0, error: `no answer: ${String(e).split('\n')[0]}` };
  }
}

async function finishSearch(misses: string[], total: number): Promise<void> {
  const file = runFile('exai-search.jsonl');
  await test.info().attach('exai-search.jsonl', { path: file });
  test.info().annotations.push({ type: 'search-result', description: `${total - misses.length} of ${total} cases passed; per-case ranks in ${file}` });
  expect(misses, 'search cases that missed').toEqual([]);
}

test.describe('DS-EXAI — Executive AI Assistant (design)', () => {
  test("DS-EXAI-46 Generate reply answers with the earlier reply's facts (Part 1)", async ({ as, denv }) => {
    requireWrites(denv);
    const rows = spread(golden(denv).filter((r) => r.provenance.part === '1-ingested' && !isFollowUp(r)), (r) => r.provenance.query_style, denv.qualityLimit);
    test.setTimeout(budget(rows.length));
    const page = await open(as);
    await finish(await runRows(page, 'DS-EXAI-46', rows));
  });

  test('DS-EXAI-47 Roughly worded questions still find the earlier reply', async ({ as, denv }) => {
    requireWrites(denv);
    const rows = spread(golden(denv).filter((r) => r.provenance.part === '1-ingested' && !isFollowUp(r) && /^paraphrased/.test(r.question_origin)),
      (r) => r.question_origin, denv.qualityLimit);
    test.setTimeout(budget(rows.length));
    const page = await open(as);
    test.info().annotations.push({ type: 'judge-pending', description: 'compare source recall and completeness with the DS-EXAI-46 verbatim rows of the same jsonl' });
    await finish(await runRows(page, 'DS-EXAI-47', rows));
  });

  test('DS-EXAI-48 Not in the knowledge base: no invented figures (Part 2)', async ({ as, denv }) => {
    requireWrites(denv);
    const rows = spread(golden(denv).filter((r) => r.provenance.part === '2-not-ingested' && !isFollowUp(r)), (r) => r.provenance.query_style, denv.qualityLimit);
    test.setTimeout(budget(rows.length));
    const page = await open(as);
    const caps = await runRows(page, 'DS-EXAI-48', rows);
    await finish(caps, withheldCited(caps, rows));
  });

  test('DS-EXAI-49 Follow-up questions asked in the same chat', async ({ as, denv }) => {
    requireWrites(denv);
    const all = golden(denv);
    const pairs = all.filter((r) => r.id.endsWith('-F1')).flatMap((f1) => {
      const f2 = all.find((r) => r.provenance.follow_up_of === f1.id);
      return f2 ? [[f1, f2]] : [];
    });
    const rows = spread(pairs, ([f1]) => f1!.provenance.part, denv.qualityLimit).flat();
    test.setTimeout(budget(rows.length));
    const page = await open(as);
    const caps = await runRows(page, 'DS-EXAI-49', rows);
    await finish(caps, withheldCited(caps, rows));
  });

  test('DS-EXAI-50 Search documents returns the right documents', async ({ as, denv }) => {
    requireWrites(denv);
    const cases = spread(searchCases(denv).filter((c) => c.part === '1-ingested'), (c) => c.query_type, denv.qualityLimit);
    test.setTimeout(budget(cases.length));
    const page = await open(as);
    const misses: string[] = [];
    for (const c of cases) {
      const r = await askSearch(page, c.query);
      const top = c.expected_within_top ?? 10;
      const ranks = c.expected_documents.map((d) => r.texts.findIndex((t) => names(t, d)));
      const within = ranks.map((k) => k >= 0 && k < top);
      const leaked = c.must_not_return.filter((d) => r.texts.some((t) => names(t, d))).map((d) => d.document);
      const pass = !r.error && (c.match === 'all' ? within.every(Boolean) : within.some(Boolean)) && leaked.length === 0;
      const rank1 = ranks.map((k) => (k < 0 ? null : k + 1));
      record('exai-search.jsonl', { case: 'DS-EXAI-50', id: c.id, part: c.part, query_type: c.query_type, query: c.query, match: c.match,
        expected_within_top: top, ranks: rank1, leaked, not_found: r.notFound, returned: r.texts.map((t) => t.slice(0, 300)), pass, ms: r.ms, error: r.error });
      if (!pass) misses.push(`${c.id} (${c.query_type}): ${r.error ?? (leaked.length ? `returned ${leaked.join(', ')}` : `expected ranks ${JSON.stringify(rank1)} not within top ${top} (match ${c.match})`)}`);
    }
    await nav.cleanUp(page);
    await finishSearch(misses, cases.length);
  });

  test('DS-EXAI-51 Search documents does not answer beyond our documents', async ({ as, denv }) => {
    requireWrites(denv);
    const cases = spread(searchCases(denv).filter((c) => c.part !== '1-ingested'), (c) => c.part, denv.qualityLimit);
    test.setTimeout(budget(cases.length));
    const page = await open(as);
    const misses: string[] = [];
    const topMatch = new RegExp(`(\\d{1,3})${esc(U.match)}`);
    for (const c of cases) {
      const r = await askSearch(page, c.query);
      const leaked = c.must_not_return.filter((d) => names(r.text, d) || r.texts.some((t) => names(t, d))).map((d) => d.document);
      // Not ingested: related older replies are fine, the withheld one never. Out of scope: not-found, or nothing returned.
      const answeredBeyond = c.part === 'out-of-scope' && !r.notFound && r.texts.length > 0;
      const pass = !r.error && leaked.length === 0 && !answeredBeyond;
      record('exai-search.jsonl', { case: 'DS-EXAI-51', id: c.id, part: c.part, query_type: c.query_type, query: c.query, leaked,
        not_found: r.notFound, returned: r.texts.map((t) => t.slice(0, 300)), top_match_pct: r.text.match(topMatch)?.[1] ?? null, pass, ms: r.ms, error: r.error });
      if (!pass) misses.push(`${c.id} (${c.part}): ${r.error ?? (leaked.length ? `returned the withheld ${leaked.join(', ')}` : `${r.texts.length} document(s) and no not-found message`)}`);
    }
    await nav.cleanUp(page);
    await finishSearch(misses, cases.length);
  });

  test('DS-EXAI-53 Answer quality is judged on facts, whatever the format', async ({ as, denv }) => {
    requireWrites(denv);
    const rows = spread(golden(denv).filter((r) => r.provenance.part === '1-ingested' && !isFollowUp(r)), (r) => r.provenance.query_style, denv.qualityLimit);
    test.setTimeout(budget(rows.length * 2));
    const page = await open(as);
    // The same rows in both choices; the judge reads response_plain (layout removed) and compares per row.
    const caps = [...await runRows(page, 'DS-EXAI-53', rows, 'generate'), ...await runRows(page, 'DS-EXAI-53', rows, 'search')];
    test.info().annotations.push({ type: 'judge-pending', description: 'compare per-row scores of the generate and search lines of DS-EXAI-53 (response_plain)' });
    await finish(caps);
  });
});
