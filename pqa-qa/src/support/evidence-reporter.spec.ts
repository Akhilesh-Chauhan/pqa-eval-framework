import { test, expect } from '@playwright/test';
import { redact, reproMarkdown, testId } from './evidence-reporter.js';

test('redact removes every secret env value and leaves the rest', () => {
  const env = { PQA_ADMIN_LLM_API_KEY: 'sk-live-123456', PQA_ADMIN_EMAIL: 'a@b.in', SHORT_KEY: 'abc' };
  expect(redact('key=sk-live-123456 email=a@b.in abc', env)).toBe('key=[redacted] email=a@b.in abc');
});

test('testId reads the catalogue id from the title', () => {
  expect(testId('SA-WBAS-04 a 5-character slug is rejected')).toBe('SA-WBAS-04');
  expect(testId('no id here')).toBeUndefined();
});

test('reproMarkdown numbers the steps and marks the failing one', () => {
  const md = reproMarkdown({
    id: 'SA-WBAS-04',
    title: 'a 5-character slug is rejected',
    outcome: 'FAILED',
    location: 'src/admin/wizard.spec.ts:10',
    preconditions: ['Tenant qa1234 exists, created as Inactive'],
    steps: [
      { title: 'Open /tenants/new', failed: false },
      { title: 'Type "abcde" in #slug and press Next', failed: true },
    ],
    error: 'expected message not shown',
    pageUrl: 'https://admin.example/tenants/new',
    screenshots: ['1-test-failed-1.png'],
  });
  expect(md).toContain('1. Open /tenants/new\n2. Type "abcde" in #slug and press Next  ← **failed here**');
  expect(md).toContain('**Page at failure:** https://admin.example/tenants/new');
  expect(md).toContain('## Preconditions\n\n- Tenant qa1234 exists, created as Inactive');
  expect(md).toContain('![screenshot](1-test-failed-1.png)');
  expect(md).not.toContain('show-trace');
});

test('testId also reads golden-dataset ids', () => {
  expect(testId('GI-CAT-023 category Circular → orders')).toBe('GI-CAT-023');
  expect(testId('GI-FMT-03 format gate P2 ingestion: office-memo.docx → accept')).toBe('GI-FMT-03');
});
