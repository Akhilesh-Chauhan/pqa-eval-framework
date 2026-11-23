// Records a Document Intelligence run: every portal API response (and exported .docx) while a person takes each
// golden question through the portal, tagged with the golden record id. Output: runs/di/<run>/raw.jsonl + files/.
// Then: python3 …/qa/golden/document-intelligence/di-eval/extract_outputs.py runs/di/<run>  →  score_di.py.
//
//   npm run qa:di:record -- parliament [--run <name>] [--ids DI-…,DI-…] [--limit N]   upload + routing
//   npm run qa:di:record -- division   [--run <same name>] …                           drafting + final answer
//
// It uploads nothing itself: for each question it names the question-only PDF (make_question_pdfs.py) to upload by
// hand. Sessions are the design-suite ones (npm run qa:design:login -- <persona>, with PQA_DESIGN_TENANT set to the
// DI tenant). Sign-in and session responses are never recorded (they carry identity).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { chromium } from '@playwright/test';

const args = process.argv.slice(2);
const persona = args[0];
const opt = (k) => { const i = args.indexOf(`--${k}`); return i > 0 ? args[i + 1] : undefined; };
const base = process.env.PQA_BASE_URL?.trim().replace(/\/+$/, '');
const slug = process.env.PQA_DI_TENANT?.trim();
const pdfDir = process.env.PQA_DI_PDF_DIR?.trim();
if (!['parliament', 'division'].includes(persona) || !base || !slug || !pdfDir) {
  console.error('Usage: npm run qa:di:record -- <parliament|division> [--run name] [--ids …] [--limit N]\n' +
    'Needs PQA_BASE_URL, PQA_DI_TENANT and PQA_DI_PDF_DIR (the question-pdfs folder) in .env.');
  process.exit(1);
}
if (process.env.PQA_DI_ALLOW_WRITES !== 'true') {
  console.error('This run uploads questions and saves drafts on PQA_DI_TENANT. Set PQA_DI_ALLOW_WRITES=true, and only for a QA-owned disposable tenant.');
  process.exit(1);
}
const session = `src/.auth/design-${slug}-${persona}.json`;
if (!existsSync(session)) {
  console.error(`No ${persona} session for ${slug}: run PQA_DESIGN_TENANT=${slug} npm run qa:design:login -- ${persona}`);
  process.exit(1);
}
let records = JSON.parse(readFileSync(join(pdfDir, 'manifest.json'), 'utf8'));
if (opt('ids')) { const want = new Set(opt('ids').split(',')); records = records.filter((r) => want.has(r.id)); }
if (opt('limit')) records = records.slice(0, Number(opt('limit')));
const run = opt('run') ?? `di-${slug}-${new Date().toISOString().slice(0, 10)}`;
const dir = join('runs', 'di', run);
mkdirSync(join(dir, 'files'), { recursive: true });
const raw = join(dir, 'raw.jsonl');

let current = null;
let n = 0;
const write = (o, record = current) => appendFileSync(raw, JSON.stringify({ record, persona, ts: new Date().toISOString(), ...o }) + '\n');
// What was sent: the part a draft was asked for is in the request, not in the reply.
const sent = (req) => { try { return req.postDataJSON(); } catch { return null; } };
const browser = await chromium.launch({ headless: false });
const ctx = await browser.newContext({ storageState: session, acceptDownloads: true });
const page = await ctx.newPage();
page.on('response', async (res) => {
  const rec = current;   // the question on screen when the response started; `current` may move on before the body is read
  if (!rec) return;
  const url = res.url();
  if (!url.includes(`/${slug}/api/`) || /\/api\/auth\//.test(url)) return;
  const ct = res.headers()['content-type'] ?? '';
  const meta = { url, method: res.request().method(), status: res.status(), contentType: ct, request: sent(res.request()) };
  try {
    if (ct.includes('json')) write({ ...meta, json: await res.json(), file: null }, rec);
    // Draft with AI answers as a stream: the draft text and its sources are only here.
    else if (ct.includes('event-stream')) write({ ...meta, json: null, sse: await res.text(), file: null }, rec);
    else if (ct.includes('officedocument') || url.endsWith('export-docx')) {
      const file = join(dir, 'files', `${rec}-${++n}.docx`);
      writeFileSync(file, await res.body());
      write({ ...meta, json: null, file }, rec);
    }
  } catch (e) { write({ ...meta, json: null, file: null, unread: String(e).slice(0, 200) }, rec); }   // kept visible, never guessed
});
page.on('download', async (d) => {
  if (!current || !d.suggestedFilename().endsWith('.docx')) return;
  const file = join(dir, 'files', `${current}-${++n}.docx`);
  await d.saveAs(file);
  write({ url: d.url(), method: 'GET', status: 200, contentType: 'download', json: null, file });
});

const rl = createInterface({ input: process.stdin, output: process.stdout });
await page.goto(`${base}/${slug}`);
const todo = persona === 'parliament'
  ? 'upload it, check what the portal read from it, and confirm the routing'
  : 'open it, Draft with AI for every part and WAIT for each draft to finish, save WITHOUT editing, then download the final answer as Word';
try {
  for (const r of records) {
    current = r.id;
    const pdf = join(pdfDir, r.pdf);
    const a = (await rl.question(`\n${r.id} (${r.house.toUpperCase()} Q ${r.question_no}, ${r.kb_status}): ${r.subject}\n` +
      `  PDF: ${pdf}\n  In the browser: ${todo}. Enter = done, s = skip, q = quit > `)).trim().toLowerCase();
    if (a === 'q') break;
    // Markers, so a question with no recorded response still shows as taken to the portal (or as skipped).
    write({ url: a === 's' ? 'skipped' : 'done', method: '-', status: 0, contentType: '', json: null, file: null });
  }
} finally {
  current = null;
  const cookies = await ctx.cookies();
  if (cookies.some((c) => c.name === 'pqa_refresh')) await ctx.storageState({ path: session });
  rl.close();
  await browser.close();
  console.log(`\nRecorded to ${raw}. Next: python3 <di-eval>/extract_outputs.py ${dir} && python3 <di-eval>/score_di.py ${dir}/outputs.jsonl`);
}
