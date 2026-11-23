// Bundles an HTML report and its screenshots into one self-contained file you can email or upload.
// Usage: npm run qa:share [reports/<run>] [findings.html]   (default: the newest run)
// Writes reports/<run>/pqa-report-<run>.html. Screenshots are re-encoded as WebP (about 2.5x smaller).
// An optional HTML fragment (e.g. the findings, rendered with pandoc) is placed at the top of the report.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const latest = readdirSync('reports').filter((d) => statSync(join('reports', d)).isDirectory()).sort().at(-1);
const dir = process.argv[2] ?? (latest && join('reports', latest));
if (!dir) {
  console.error('No report found under reports/. Run the suite first.');
  process.exit(1);
}

// PQA_SHARE_SCALE (e.g. 80%) shrinks the screenshots to stay under mail limits; this ImageMagick ignores -quality for WebP.
const scale = process.env.PQA_SHARE_SCALE ? ['-resize', process.env.PQA_SHARE_SCALE] : [];
// shortcut: needs ImageMagick `convert` for WebP and falls back to the original PNG (about 2.5x larger); switch to sharp if the team runs this without ImageMagick.
const dataUri = (src) => {
  try {
    return `data:image/webp;base64,${execFileSync('convert', [join(dir, src), ...scale, '-quality', '75', 'webp:-']).toString('base64')}`;
  } catch {
    return `data:image/png;base64,${readFileSync(join(dir, src)).toString('base64')}`;
  }
};

// A div, not a section: the report draws every <section> as a bordered card.
const findings = process.argv[3] ? `<div class="findings">${readFileSync(process.argv[3], 'utf8')}</div>` : '';

let shots = 0;
const html = readFileSync(join(dir, 'index.html'), 'utf8')
  .replace('<main>', `<main>${findings}`)
  // A link to img/… cannot work once the file travels alone, so the screenshot becomes a button that enlarges it in place.
  .replace(/<a href="(img\/[^"]+)" target="_blank"><img ([^>]*?)src="\1"([^>]*)><\/a>/g, (_, src, before, after) => {
    shots++;
    return `<button type="button" class="shot" aria-pressed="false"><img ${before}src="${dataUri(src)}"${after}></button>`;
  })
  .replace('</style>', '.shot{padding:0;border:0;background:none;cursor:zoom-in}.shot.big{flex-basis:100%;cursor:zoom-out}.shot.big img{max-width:100%}' +
    '.findings{margin:0 0 2rem;line-height:1.5}' +
    '.findings table{border-collapse:collapse;margin:.75rem 0;width:100%;font-size:.9em}.findings th,.findings td{border:1px solid #8885;padding:.35rem .5rem;text-align:left;vertical-align:top}' +
    '.findings code{font-size:.9em;word-break:break-word}.findings h1{font-size:1.5em}.findings h2{font-size:1.2em;margin-top:1.5rem}</style>')
  .replace('</body>', `<script>document.addEventListener('click',function(e){var b=e.target.closest('.shot');if(b)b.setAttribute('aria-pressed',b.classList.toggle('big'));});</script></body>`);

if (html.includes('src="img/')) {
  console.error('Some screenshots were not inlined: the report markup changed. Update the pattern in scripts/share-report.mjs.');
  process.exit(1);
}
const out = join(dir, `pqa-report-${basename(dir)}.html`);
writeFileSync(out, html);
console.log(`pqa-qa: ${shots} screenshots inlined, ${(Buffer.byteLength(html) / 1e6).toFixed(1)} MB — ${out}`);
