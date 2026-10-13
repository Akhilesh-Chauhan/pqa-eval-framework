import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import type { Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter';
import { classifyOutcome, mergedAnnotations } from './gap-reporter.js';

export interface Failure {
  id: string;
  title: string;
  outcome: string;
  location: string;
  /** From `precondition` annotations: state another test set up, so the repro is self-contained. */
  preconditions: string[];
  steps: Array<{ title: string; failed: boolean }>;
  error: string;
  pageUrl?: string;
  screenshots: string[];
  trace?: string;
}

const SECRET_ENV = /KEY|SECRET|PASSWORD|TOKEN|DSN/i;
const ANSI = /\u001b\[[0-9;]*m/g;

/** Replace every secret value from the environment, so evidence can be shared. */
export function redact(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text;
  for (const [key, value] of Object.entries(env)) {
    if (SECRET_ENV.test(key) && value && value.trim().length >= 6) out = out.split(value.trim()).join('[redacted]');
  }
  return out;
}

export function testId(title: string): string | undefined {
  return /^(SA-[A-Z]+-\d+)\b/.exec(title)?.[1];
}

export function reproMarkdown(f: Failure): string {
  const steps = f.steps.length
    ? f.steps.map((s, i) => `${i + 1}. ${s.title}${s.failed ? '  ← **failed here**' : ''}`).join('\n')
    : '_No steps recorded — see the test source._';
  return (
    `# ${f.id} — ${f.title}\n\n` +
    `**Result:** ${f.outcome} · **Test:** \`${f.location}\`\n` +
    (f.pageUrl ? `**Page at failure:** ${f.pageUrl}\n` : '') +
    (f.preconditions.length ? `\n## Preconditions\n\n${f.preconditions.map((p) => `- ${p}`).join('\n')}\n` : '') +
    `\n## Steps to reproduce\n\n${steps}\n` +
    `\n## Expected vs actual\n\n\`\`\`\n${f.error}\n\`\`\`\n` +
    `\n## Evidence\n\n` +
    (f.screenshots.map((s) => `![screenshot](${s})`).join('\n') || '_No screenshot (API-only test)._') +
    '\n' +
    (f.trace
      ? `\nFull trace (local only — it contains session cookies, do not share): ` +
        `\`npx playwright show-trace ${f.trace}\`\n`
      : '')
  );
}

function userSteps(steps: TestStep[]): Array<{ title: string; failed: boolean }> {
  const own = steps.filter((s) => s.category === 'test.step');
  const chosen = own.length ? own : steps.filter((s) => s.category === 'pw:api');
  return chosen.map((s) => ({ title: s.title, failed: !!s.error }));
}

/** One folder per failed test under evidence/<run>/, plus an INDEX.md. */
class EvidenceReporter implements Reporter {
  private runDir = join('evidence', new Date().toISOString().replace(/[:.]/g, '-'));
  private rows: string[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === 'passed' || result.status === 'skipped') return;
    const annotations = mergedAnnotations(test, result);
    const outcome = classifyOutcome(annotations, result.status);
    const id = testId(test.title) ?? 'NO-ID';
    const slug = test.title.replace(/^SA-[A-Z]+-\d+\s*/, '').replace(/[^A-Za-z0-9]+/g, '-').slice(0, 60);
    // Numbered: the same test can run once per ministry.
    const dir = join(this.runDir, `${String(this.rows.length + 1).padStart(3, '0')}-${id}-${slug}`);
    mkdirSync(dir, { recursive: true });

    const screenshots: string[] = [];
    let trace: string | undefined;
    let pageUrl: string | undefined;
    for (const a of result.attachments) {
      if (a.name === 'page-url' && a.body) pageUrl = a.body.toString();
      else if (a.contentType === 'image/png' && (a.path || a.body)) {
        // Explicit testInfo.attach() screenshots come as a body; the automatic one as a path.
        const name = `${screenshots.length + 1}-${a.path ? basename(a.path) : `${a.name}.png`}`;
        if (a.path) copyFileSync(a.path, join(dir, name));
        else writeFileSync(join(dir, name), a.body as Buffer);
        screenshots.push(name);
      } else if (a.name === 'trace' && a.path) trace = relative(process.cwd(), a.path);
    }

    const title = test.titlePath().slice(1).filter(Boolean).join(' › ');
    writeFileSync(
      join(dir, 'REPRO.md'),
      redact(
        reproMarkdown({
          id,
          title,
          outcome: outcome === 'tracked-gap' ? 'FAILED (known, tracked gap)' : 'FAILED',
          location: `${relative(process.cwd(), test.location.file)}:${test.location.line}`,
          preconditions: annotations.filter((a) => a.type === 'precondition').map((a) => a.description ?? ''),
          steps: userSteps(result.steps),
          // All errors, not just the first: soft assertions let one test record several.
          error: (result.errors.map((e) => e.message).join('\n\n') || result.status).replace(ANSI, ''),
          pageUrl,
          screenshots,
          trace,
        }),
      ),
    );
    this.rows.push(`| ${id} | ${title.replace(/\|/g, '\\|')} | ${outcome} | [REPRO](${relative(this.runDir, dir)}/REPRO.md) |`);
  }

  onEnd(): void {
    if (!this.rows.length) return;
    writeFileSync(
      join(this.runDir, 'INDEX.md'),
      `# Failures — ${basename(this.runDir)}\n\n| ID | Test | Outcome | Evidence |\n|---|---|---|---|\n${this.rows.join('\n')}\n`,
    );
    console.log(`pqa-qa: ${this.rows.length} failure(s) — evidence in ${this.runDir}/INDEX.md`);
  }
}

export default EvidenceReporter;
