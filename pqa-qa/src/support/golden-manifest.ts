import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/** The golden ingestion dataset (PQA Builder/qa/golden/ingestion, built by its build/run.py). */

export const DOC_TYPES = ['parliamentary_qa', 'acts', 'schemes', 'orders', 'press_releases', 'others'] as const;
export type DocType = (typeof DOC_TYPES)[number];
export const SETUP_IDS = ['P1', 'P2', 'P3', 'P4'] as const;
export type SetupId = (typeof SETUP_IDS)[number];
export type Expect = 'A' | 'R' | 'Q';

/** Classifier fields per type (ingestion-service models/document_types.py) plus the combined "Ministry / Department". */
export const TYPE_FIELDS: Record<DocType, readonly string[]> = {
  parliamentary_qa: ['authority', 'ministry', 'department', 'ministry_or_department', 'house', 'question_type', 'answered_on', 'topic', 'diary_number', 'members', 'answering_minister'],
  acts: ['title', 'act_number', 'date', 'subject'],
  schemes: ['authorizing_body', 'details', 'eligibility', 'benefits', 'exclusions', 'application_process', 'documents_required', 'faqs'],
  orders: ['file_number', 'ministry', 'department', 'ministry_or_department', 'date', 'subject', 'issuing_officer'],
  press_releases: ['issued_by', 'date', 'subject', 'posted_by', 'release_id'],
  others: ['document_title', 'date', 'subject', 'issuing_authority', 'summary'],
};

const E = z.enum(['A', 'R', 'Q']);
const Row = z.object({
  id: z.string().regex(/^GI-(CAT-\d{3}|FMT-\d{2})$/),
  file: z.string().min(1),
  upload_name: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().nonnegative(),
  group: z.enum(['category', 'format']),
  user_category: z.string().min(1),
  expected_type: z.enum(DOC_TYPES),
  truth_status: z.enum(['verified', 'draft', 'none']),
  expected_metadata: z.record(z.union([z.string(), z.array(z.string())])),
  not_captured: z.array(z.string()),
  format_case: z.object({ declared_mime: z.string().nullable(), expect: z.object({ P1: E, P2: E, P3: E, P4: E }) }).nullable(),
});
export type GoldenRow = z.infer<typeof Row>;
export interface Golden {
  version: string;
  rows: GoldenRow[];
  dir: string;
}

/** Reads <dir>/manifest.jsonl and checks every row and file; throws once, listing every problem. */
export function loadGolden(dir: string): Golden {
  const path = join(dir, 'manifest.jsonl');
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());
  const head = z.object({ version: z.string().min(1) }).safeParse(JSON.parse(lines[0] ?? '{}'));
  const problems: string[] = head.success ? [] : ['line 1: no {"version": …} header'];
  const rows: GoldenRow[] = [];
  lines.slice(1).forEach((line, i) => {
    const parsed = Row.safeParse(JSON.parse(line));
    if (parsed.success) rows.push(parsed.data);
    else problems.push(`line ${i + 2}: ${parsed.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`);
  });
  for (const r of rows) {
    let buf: Buffer | undefined;
    try {
      buf = readFileSync(join(dir, r.file));
    } catch {
      problems.push(`${r.id}: missing file ${r.file}`);
    }
    if (buf && (createHash('sha256').update(buf).digest('hex') !== r.sha256 || buf.length !== r.bytes)) problems.push(`${r.id}: ${r.file} does not match its sha256`);
    for (const k of Object.keys(r.expected_metadata)) if (!TYPE_FIELDS[r.expected_type].includes(k)) problems.push(`${r.id}: field ${k} does not exist for ${r.expected_type}`);
    if ((r.group === 'format') !== (r.format_case !== null)) problems.push(`${r.id}: format_case must be set on format rows and only there`);
  }
  const count = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
  for (const [id, n] of count(rows.map((r) => r.id))) if (n > 1) problems.push(`${id}: duplicate id`);
  for (const [name, n] of count(rows.filter((r) => r.group === 'category').map((r) => r.upload_name))) if (n > 1) problems.push(`upload name ${name} is used twice in the category group`);
  if (problems.length) throw new Error(`golden manifest ${path} is invalid:\n${problems.join('\n')}`);
  return { version: head.success ? head.data.version : '', rows, dir };
}

/** The category rows, or only those whose user_category is in `only` (any case). An unknown name throws: a typo
 * must not run, and report, an empty dataset. */
export function categoryRows(golden: Golden, only?: string[]): GoldenRow[] {
  const rows = golden.rows.filter((r) => r.group === 'category');
  if (!only) return rows;
  const want = new Set(only.map((c) => c.toLowerCase()));
  const known = [...new Set(rows.map((r) => r.user_category))];
  const unknown = only.filter((c) => !known.some((k) => k.toLowerCase() === c.toLowerCase()));
  if (unknown.length) throw new Error(`PQA_INGEST_CATEGORY: no category ${unknown.join(', ')} in the golden dataset (it has ${known.join(', ')})`);
  return rows.filter((r) => want.has(r.user_category.toLowerCase()));
}
