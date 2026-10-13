import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { FullConfig, FullResult, Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import { classifyOutcome, mergedAnnotations } from './gap-reporter.js';
import type { Outcome } from './gap-reporter.js';
import { redact, testId } from './evidence-reporter.js';

/**
 * Extent-style HTML report: reports/<run>/index.html with a dashboard, every executed test
 * (steps, errors, screenshots) and, when PQA_CATALOGUE points at the test-case catalogue,
 * each test's catalogue row plus catalogue coverage. Screenshots sit beside it in img/;
 * `npm run qa:share` bundles both into one file for sending.
 * Traces and videos are deliberately left out: they carry session cookies.
 */

export interface CatalogueCase {
  id: string;
  area: string;
  title: string;
  pri: string;
  type: string;
  expected: string;
  run: string;
}

export interface Catalogue {
  cases: Map<string, CatalogueCase>;
  areas: Map<string, string>;
}

/** Reads `## AREA — Name` headings and `| SA-… |` rows of the catalogue markdown. */
export function parseCatalogue(md: string): Catalogue {
  const cases = new Map<string, CatalogueCase>();
  const areas = new Map<string, string>();
  const clean = (s = ''): string => s.replace(/<br>/g, ' ').replace(/`/g, '').replace(/\*\*/g, '').replace(/\\\|/g, '|').trim();
  for (const line of md.split('\n')) {
    const heading = /^## ([A-Z]+) — (.+)$/.exec(line);
    if (heading) areas.set(heading[1] as string, clean(heading[2]));
    if (!line.startsWith('| SA-')) continue;
    const c = line.split(/(?<!\\)\|/).map((x) => x.trim());
    const id = c[1] as string;
    cases.set(id, {
      id,
      area: id.split('-')[1] as string,
      title: clean(c[2]),
      pri: clean(c[3]),
      type: clean(c[4]),
      expected: clean(c[7]),
      run: clean(c[8]),
    });
  }
  return { cases, areas };
}

type Bucket = 'pass' | 'fail' | 'gap' | 'skip';
const BUCKETS: Record<Bucket, { label: string; icon: string }> = {
  pass: { label: 'Passed', icon: '✓' },
  fail: { label: 'Failed', icon: '✕' },
  gap: { label: 'Known gap', icon: '!' },
  skip: { label: 'Skipped', icon: '–' },
};
const ORDER: Bucket[] = ['pass', 'fail', 'gap', 'skip'];

export function bucketOf(outcome: Outcome): Bucket {
  if (outcome === 'passed' || outcome === 'closed-gap') return 'pass';
  if (outcome === 'regression') return 'fail';
  if (outcome === 'tracked-gap') return 'gap';
  return 'skip';
}

export interface Row {
  id?: string;
  title: string;
  group: string;
  project: string;
  bucket: Bucket;
  ms: number;
  steps: Array<{ title: string; ok: boolean; ms: number; error?: string }>;
  errors: string[];
  notes: string[];
  shots: string[];
  pageUrl?: string;
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ANSI = /\u001b\[[0-9;]*m/g;
const dur = (ms: number): string =>
  ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
const pct = (n: number, d: number): number => (d ? Math.round((n / d) * 100) : 0);

function counts(rows: Row[]): Record<Bucket, number> {
  const c: Record<Bucket, number> = { pass: 0, fail: 0, gap: 0, skip: 0 };
  for (const r of rows) c[r.bucket]++;
  return c;
}

function splitBar(c: Record<Bucket, number>, label: string): string {
  const total = ORDER.reduce((n, b) => n + c[b], 0);
  const segs = ORDER.filter((b) => c[b])
    .map((b) => `<span class="seg ${b}" style="flex:${c[b]}" title="${BUCKETS[b].label}: ${c[b]} (${pct(c[b], total)}%)"></span>`)
    .join('');
  return `<div class="stack" role="img" aria-label="${esc(label)}: ${ORDER.map((b) => `${c[b]} ${BUCKETS[b].label}`).join(', ')}">${segs}</div>`;
}

export function renderReport(
  rows: Row[],
  meta: { started: Date; ms: number; target: string; projects: string[] },
  cat?: Catalogue,
): string {
  const c = counts(rows);
  const executed = rows.length - c.skip;
  const areaOf = (r: Row): string => r.id?.split('-')[1] ?? 'OTHER';
  const areaNames = cat?.areas ?? new Map<string, string>();
  const areas = [...new Set(rows.map(areaOf))].sort(
    (a, b) => ([...areaNames.keys()].indexOf(a) + 1 || 99) - ([...areaNames.keys()].indexOf(b) + 1 || 99),
  );

  const kpi = (label: string, value: string, cls = ''): string =>
    `<div class="kpi ${cls}"><div class="kv">${value}</div><div class="kl">${label}</div></div>`;

  const areaRows = areas
    .map((a) => {
      const ac = counts(rows.filter((r) => areaOf(r) === a));
      const n = ORDER.reduce((s, b) => s + ac[b], 0);
      return `<tr><td><code>${esc(a)}</code></td><td>${esc(areaNames.get(a) ?? '')}</td><td class="num">${n}</td>${ORDER.map((b) => `<td class="num">${ac[b] || ''}</td>`).join('')}<td class="barcell">${splitBar(ac, a)}</td></tr>`;
    })
    .join('');

  let coverage = '';
  if (cat) {
    const ran = new Set(rows.filter((r) => r.id && r.bucket !== 'skip').map((r) => r.id as string));
    const all = [...cat.cases.values()];
    const covRows = [...cat.areas.keys()]
      .map((a) => {
        const inArea = all.filter((x) => x.area === a);
        const done = inArea.filter((x) => ran.has(x.id)).length;
        return `<tr><td><code>${esc(a)}</code></td><td>${esc(cat.areas.get(a) ?? '')}</td><td class="num">${inArea.length}</td><td class="num">${done}</td><td class="num">${pct(done, inArea.length)}%</td><td class="barcell"><div class="meter" role="img" aria-label="${pct(done, inArea.length)}% executed"><span style="width:${pct(done, inArea.length)}%"></span></div></td></tr>`;
      })
      .join('');
    coverage = `<section><h2>Catalogue coverage</h2><p class="sub">${ran.size} of ${all.length} catalogue cases executed in this run.</p>
<div class="tw"><table><thead><tr><th>Area</th><th>Name</th><th class="num">Cases</th><th class="num">Executed</th><th class="num">%</th><th></th></tr></thead><tbody>${covRows}</tbody></table></div></section>`;
  }

  const cards = rows
    .map((r, i) => {
      const cc = r.id ? cat?.cases.get(r.id) : undefined;
      const text = `${r.id ?? ''} ${r.title} ${r.group} ${cc?.title ?? ''}`.toLowerCase();
      // An error already shown under its failing step is not repeated below the steps.
      const shown = r.steps.map((st) => st.error).filter((e): e is string => !!e);
      const extra = r.errors.filter((e) => !shown.some((se) => e.startsWith(se)));
      const steps = r.steps.length
        ? `<ol class="steps">${r.steps.map((s) => `<li class="${s.ok ? 'ok' : 'ko'}"><span class="si">${s.ok ? '✓' : '✕'}</span> ${esc(s.title)} <span class="ms">${dur(s.ms)}</span>${s.error ? `<pre>${esc(s.error)}</pre>` : ''}</li>`).join('')}</ol>`
        : '';
      return `<details class="test" data-status="${r.bucket}" data-area="${esc(areaOf(r))}" data-text="${esc(text)}"${r.bucket === 'fail' ? ' open' : ''}>
<summary><span class="badge ${r.bucket}">${BUCKETS[r.bucket].icon} ${BUCKETS[r.bucket].label}</span>${r.id ? `<code>${esc(r.id)}</code>` : ''}<span class="t">${esc(r.title.replace(/^SA-[A-Z]+-\d+\s*/, ''))}</span><span class="grp">${esc(r.group)}</span><span class="ms">${dur(r.ms)}</span></summary>
<div class="body">
${cc ? `<div class="cat"><span class="chip">${esc(cc.pri)}</span><span class="chip">${esc(cc.type)}</span><span class="chip">Catalogue: ${esc(cc.run)}</span><p><b>Catalogue title:</b> ${esc(cc.title)}</p><p><b>Expected:</b> ${esc(cc.expected)}</p></div>` : ''}
${r.notes.map((n) => `<p class="note">${esc(n)}</p>`).join('')}
${steps}
${extra.length ? `<pre class="err">${esc(extra.join('\n\n'))}</pre>` : ''}
${r.pageUrl ? `<p class="sub">Page at failure: ${esc(r.pageUrl)}</p>` : ''}
${r.shots.length ? `<div class="shots">${r.shots.map((s, k) => `<a href="${esc(s)}" target="_blank"><img loading="lazy" src="${esc(s)}" alt="Screenshot ${k + 1} of test ${i + 1}"></a>`).join('')}</div>` : ''}
<p class="sub">${esc(r.project)}</p>
</div></details>`;
    })
    .join('\n');

  const chips = (['all', ...ORDER] as const)
    .map((b) => `<button type="button" class="chip-btn${b === 'all' ? ' on' : ''}" data-filter="${b}">${b === 'all' ? `All ${rows.length}` : `${BUCKETS[b].icon} ${BUCKETS[b].label} ${c[b]}`}</button>`)
    .join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>PQA Test Report</title><style>
:root{--bg:#f6f6f4;--surface:#fcfcfb;--ink:#1d1d1b;--ink2:#5c5c57;--line:#e3e3df;--good:#0ca30c;--critical:#d03b3b;--warning:#fab219;--skip:#9a9a94;--accent:#3b4cca}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#121211;--surface:#1a1a19;--ink:#ececea;--ink2:#a5a5a0;--line:#2e2e2c;--skip:#6f6f6a;--accent:#8f9bff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1200px;margin:0 auto;padding:24px 16px 64px}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 12px}
section{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:16px;margin-top:16px}
.sub{color:var(--ink2);margin:4px 0}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;background:none;border:0;padding:0}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:14px}.kv{font-size:28px;font-weight:600}.kl{color:var(--ink2);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.kpi.hero .kv{font-size:40px}
.stack{display:flex;gap:2px;height:14px;border-radius:4px;overflow:hidden;background:var(--line)}.seg{min-width:4px}
.seg.pass{background:var(--good)}.seg.fail{background:var(--critical)}.seg.gap{background:var(--warning)}.seg.skip{background:var(--skip)}
.legend{display:flex;flex-wrap:wrap;gap:16px;list-style:none;padding:0;margin:10px 0 0;color:var(--ink2)}.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}
.tw{overflow-x:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}th{color:var(--ink2);font-weight:500;font-size:12px}
.num{text-align:right;font-variant-numeric:tabular-nums}.barcell{width:30%}.meter{height:8px;border-radius:4px;background:var(--line);overflow:hidden}.meter span{display:block;height:100%;background:var(--accent);border-radius:4px}
.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px}.chip-btn{border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:999px;padding:4px 12px;cursor:pointer;font:inherit}
.chip-btn.on{border-color:var(--accent);color:var(--accent);font-weight:600}select,input[type=search]{font:inherit;padding:4px 8px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink)}
input[type=search]{flex:1;min-width:160px}select{max-width:100%}
.test{border:1px solid var(--line);border-radius:8px;margin:8px 0;background:var(--surface)}.test summary{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;cursor:pointer}
.test summary .t{flex:1;min-width:0;overflow-wrap:anywhere}.grp{color:var(--ink2);font-size:12px}.ms{color:var(--ink2);font-size:12px;font-variant-numeric:tabular-nums}
.badge{font-size:12px;font-weight:600;padding:2px 8px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}
.badge.pass{color:var(--good)}.badge.fail{color:var(--critical)}.badge.gap{color:#a87400}.badge.skip{color:var(--ink2)}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .badge.gap{color:var(--warning)}}
.body{padding:0 12px 12px;border-top:1px solid var(--line)}.cat p{margin:6px 0}.chip{display:inline-block;font-size:12px;border:1px solid var(--line);border-radius:4px;padding:1px 6px;margin:8px 6px 0 0;color:var(--ink2)}
.note{background:var(--bg);border-left:3px solid var(--accent);padding:6px 10px;margin:8px 0}
.steps{padding-left:0;list-style:none;margin:8px 0}.steps li{padding:4px 0;border-bottom:1px dashed var(--line)}.si{display:inline-block;width:16px;font-weight:700}
.steps li.ok .si{color:var(--good)}.steps li.ko .si{color:var(--critical)}.steps li.ko{font-weight:500}
pre{white-space:pre-wrap;word-break:break-word;background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:8px;font-size:12px;margin:6px 0}
pre.err{border-color:var(--critical)}.shots{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.shots img{max-width:360px;width:100%;border:1px solid var(--line);border-radius:6px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
@media (max-width:640px){.barcell{display:none}.shots img{max-width:100%}}
</style></head><body><main>
<h1>PQA Super Admin — test report</h1>
<p class="sub">Started ${esc(meta.started.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))} IST · Duration ${dur(meta.ms)} · Target ${esc(meta.target)} · Projects ${esc(meta.projects.join(', '))}</p>
<section class="kpis" aria-label="Summary">
${kpi('Pass rate (executed)', `${pct(c.pass, executed)}%`, 'hero')}${kpi('Tests', String(rows.length))}${kpi(`${BUCKETS.pass.icon} Passed`, String(c.pass))}${kpi(`${BUCKETS.fail.icon} Failed`, String(c.fail))}${kpi(`${BUCKETS.gap.icon} Known gaps`, String(c.gap))}${kpi(`${BUCKETS.skip.icon} Skipped`, String(c.skip))}
</section>
<section><h2>Result split</h2>${splitBar(c, 'All tests')}
<ul class="legend">${ORDER.map((b) => `<li><i class="seg ${b}"></i>${BUCKETS[b].icon} ${BUCKETS[b].label} — ${c[b]} (${pct(c[b], rows.length)}%)</li>`).join('')}</ul></section>
<section><h2>By area</h2><div class="tw"><table><thead><tr><th>Area</th><th>Name</th><th class="num">Tests</th>${ORDER.map((b) => `<th class="num">${BUCKETS[b].label}</th>`).join('')}<th>Split</th></tr></thead><tbody>${areaRows}</tbody></table></div></section>
${coverage}
<section><h2>Tests</h2>
<div class="filters">${chips}<select id="area" aria-label="Area"><option value="">All areas</option>${areas.map((a) => `<option value="${esc(a)}">${esc(a)}${areaNames.get(a) ? ` — ${esc(areaNames.get(a) as string)}` : ''}</option>`).join('')}</select><input type="search" id="q" placeholder="Search id, title, ministry…" aria-label="Search tests"></div>
<div id="tests">${cards}</div></section>
</main><script>
(function(){var s='all',a='',q='';var tests=[].slice.call(document.querySelectorAll('.test'));
function apply(){tests.forEach(function(t){t.style.display=(s==='all'||t.dataset.status===s)&&(!a||t.dataset.area===a)&&(!q||t.dataset.text.indexOf(q)>=0)?'':'none';});}
[].forEach.call(document.querySelectorAll('.chip-btn'),function(b){b.addEventListener('click',function(){s=b.dataset.filter;[].forEach.call(document.querySelectorAll('.chip-btn'),function(x){x.classList.toggle('on',x===b);});apply();});});
document.getElementById('area').addEventListener('change',function(e){a=e.target.value;apply();});
document.getElementById('q').addEventListener('input',function(e){q=e.target.value.toLowerCase();apply();});})();
</script></body></html>`;
}

function topSteps(steps: TestStep[]): Row['steps'] {
  const own = steps.filter((s) => s.category === 'test.step');
  return (own.length ? own : steps.filter((s) => s.category === 'pw:api')).map((s) => ({
    title: redact(s.title),
    ok: !s.error,
    ms: s.duration,
    error: s.error?.message ? redact(s.error.message.replace(ANSI, '')).split('\nCall log:')[0] : undefined,
  }));
}

class HtmlReport implements Reporter {
  private started = new Date();
  private dir = join('reports', this.started.toISOString().replace(/[:.]/g, '-'));
  private rows: Row[] = [];
  private target = '';

  onBegin(config: FullConfig): void {
    this.target = [...new Set(config.projects.map((p) => p.use.baseURL).filter(Boolean))].join(', ') || process.env.PQA_ADMIN_URL || '';
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const annotations = mergedAnnotations(test, result);
    const shots: string[] = [];
    let pageUrl: string | undefined;
    for (const a of result.attachments) {
      if (a.name === 'page-url' && a.body) pageUrl = a.body.toString();
      if (a.contentType !== 'image/png' || !(a.path || a.body)) continue;
      mkdirSync(join(this.dir, 'img'), { recursive: true });
      const name = `img/${String(this.rows.length + 1).padStart(4, '0')}-${shots.length + 1}-${a.path ? basename(a.path) : `${a.name}.png`}`;
      if (a.path) copyFileSync(a.path, join(this.dir, name));
      else writeFileSync(join(this.dir, name), a.body as Buffer);
      shots.push(name);
    }
    const path = test.titlePath();
    this.rows.push({
      id: testId(test.title),
      title: test.title,
      group: path.slice(3, -1).join(' › '),
      project: `${path[1] ?? ''} · ${test.location.file.split('/src/')[1] ?? basename(test.location.file)}:${test.location.line}`,
      bucket: bucketOf(classifyOutcome(annotations, result.status)),
      ms: result.duration,
      steps: topSteps(result.steps),
      errors: result.errors.map((e) => redact((e.message ?? '').replace(ANSI, ''))),
      notes: annotations
        .filter((a) => ['precondition', 'known-gap', 'not-measured', 'skip'].includes(a.type) && a.description)
        .map((a) => `${a.type === 'precondition' ? 'Precondition' : a.type === 'skip' ? 'Skipped' : 'Known gap'}: ${redact(a.description as string)}`),
      shots,
      pageUrl,
    });
  }

  onEnd(result: FullResult): void {
    if (!this.rows.length) return;
    const catPath = process.env.PQA_CATALOGUE?.trim();
    const cat = catPath && existsSync(catPath) ? parseCatalogue(readFileSync(catPath, 'utf8')) : undefined;
    mkdirSync(this.dir, { recursive: true });
    const html = renderReport(this.rows, { started: this.started, ms: result.duration, target: this.target, projects: [...new Set(this.rows.map((r) => r.project.split(' · ')[0] as string))] }, cat);
    writeFileSync(join(this.dir, 'index.html'), html);
    console.log(`pqa-qa: HTML report — ${resolve(this.dir, 'index.html')}`);
  }
}

export default HtmlReport;
