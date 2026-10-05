import { test, expect } from '@playwright/test';
import { classifyOutcome, renderGapsMarkdown } from './gap-reporter.js';
import { GAP_ANNOTATION, NOT_MEASURED_ANNOTATION } from './annotations.js';

const gap = [{ type: GAP_ANNOTATION, description: 'S1-DO-02 · Bhupendra · S3 IAM' }];
const unmeasured = [{ type: NOT_MEASURED_ANNOTATION, description: 'S1-DO-02 · Bhupendra · no key' }];

test('an unannotated failure is a regression', () => {
  expect(classifyOutcome([], 'failed')).toBe('regression');
});

test('an annotated failure is a tracked gap', () => {
  expect(classifyOutcome(gap, 'failed')).toBe('tracked-gap');
});

test('an annotated PASS is a closed gap — the owner fixed it', () => {
  expect(classifyOutcome(gap, 'passed')).toBe('closed-gap');
});

test('a not-measured skip is its own state, never a pass', () => {
  expect(classifyOutcome(unmeasured, 'skipped')).toBe('not-measured');
});

test('an unannotated pass is just a pass', () => {
  expect(classifyOutcome([], 'passed')).toBe('passed');
});

test('an unannotated skip is reported, not silently green', () => {
  expect(classifyOutcome([], 'skipped')).toBe('skipped');
});

test('a timed-out unannotated test is a regression', () => {
  expect(classifyOutcome([], 'timedOut')).toBe('regression');
});

test('the markdown names owner, tracker and the failing assertion', () => {
  const md = renderGapsMarkdown(
    [{
      outcome: 'tracked-gap',
      title: 'f4 › write outside the tenant prefix is denied',
      family: 'f4',
      tracker: 'S1-DO-02',
      owner: 'Bhupendra',
      detail: 'S3 IAM',
      error: 'expected refusal but got 200',
    }],
    { runId: 'abc', baseUrl: 'https://x', probedAt: '2026-09-22T00:00:00Z' },
  );
  expect(md).toContain('Bhupendra');
  expect(md).toContain('S1-DO-02');
  expect(md).toContain('expected refusal but got 200');
  expect(md).toContain('https://x');
});

test('the markdown states plainly when there are no gaps', () => {
  const md = renderGapsMarkdown([], { runId: 'abc', baseUrl: 'https://x', probedAt: 'now' });
  expect(md).toMatch(/no tracked gaps|none/i);
});
