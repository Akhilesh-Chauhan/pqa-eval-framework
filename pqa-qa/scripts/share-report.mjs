// Bundles an HTML report and its screenshots into one self-contained file you can email or upload.
// Usage: npm run qa:share [reports/<run>]   (default: the newest run)
// Writes reports/<run>/pqa-report-<run>.html. Screenshots are re-encoded as WebP (about 2.5x smaller).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const latest = readdirSync('reports').filter((d) => statSync(join('reports', d)).isDirectory()).sort().at(-1);
const dir = process.argv[2] ?? (latest && join('reports', latest));
if (!dir) {
  console.error('No report found under reports/. Run the suite first.');
  process.exit(1);
}

// shortcut: needs ImageMagick `convert` for WebP and falls back to the original PNG (about 2.5x larger); switch to sharp if the team runs this without ImageMagick.
const dataUri = (src) => {
  try {
    return `data:image/webp;base64,${execFileSync('convert', [join(dir, src), '-quality', '75', 'webp:-']).toString('base64')}`;
  } catch {
    return `data:image/png;base64,${readFileSync(join(dir, src)).toString('base64')}`;
  }
};

let shots = 0;
const html = readFileSync(join(dir, 'index.html'), 'utf8')
  // A link to img/… cannot work once the file travels alone, so the screenshot becomes a button that enlarges it in place.
  .replace(/<a href="(img\/[^"]+)" target="_blank"><img ([^>]*?)src="\1"([^>]*)><\/a>/g, (_, src, before, after) => {
    shots++;
    return `<button type="button" class="shot" aria-pressed="false"><img ${before}src="${dataUri(src)}"${after}></button>`;
  })
  .replace('</style>', '.shot{padding:0;border:0;background:none;cursor:zoom-in}.shot.big{flex-basis:100%;cursor:zoom-out}.shot.big img{max-width:100%}</style>')
  .replace('</body>', `<script>document.addEventListener('click',function(e){var b=e.target.closest('.shot');if(b)b.setAttribute('aria-pressed',b.classList.toggle('big'));});</script></body>`);

if (html.includes('src="img/')) {
  console.error('Some screenshots were not inlined: the report markup changed. Update the pattern in scripts/share-report.mjs.');
  process.exit(1);
}
const out = join(dir, `pqa-report-${basename(dir)}.html`);
writeFileSync(out, html);
console.log(`pqa-qa: ${shots} screenshots inlined, ${(Buffer.byteLength(html) / 1e6).toFixed(1)} MB — ${out}`);
