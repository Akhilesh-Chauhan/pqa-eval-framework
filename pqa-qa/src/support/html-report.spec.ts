import { test, expect } from '@playwright/test';
import { parseCatalogue, renderReport, summaryAttachment } from './html-report.js';
import type { Row } from './html-report.js';

const MD = [
  '## WBAS — Step 0, Basic Info (A3.1)',
  '| ID | Title | Pri | Type | Preconditions | Steps | Expected | Run |',
  '| SA-WBAS-10 | Slug of 5 characters | P2 | Boundary | **W** | `#slug` = `qa123`, Next. | `Must be exactly 6 characters (this one is 5).` | Auto |',
  '| SA-WBAS-11 | Slug a\\|b | P3 | Boundary | — | x | y | Auto |',
].join('\n');

test('parseCatalogue reads areas and rows, unescaping cells', () => {
  const cat = parseCatalogue(MD);
  expect(cat.areas.get('WBAS')).toBe('Step 0, Basic Info (A3.1)');
  expect(cat.cases.get('SA-WBAS-10')).toMatchObject({
    area: 'WBAS',
    pri: 'P2',
    expected: 'Must be exactly 6 characters (this one is 5).',
    run: 'Auto',
  });
  expect(cat.cases.get('SA-WBAS-11')?.title).toBe('Slug a|b');
});

test('renderReport counts outcomes, escapes text and lists coverage', () => {
  const row = (id: string, bucket: Row['bucket']): Row => ({
    id, title: `${id} <b>x</b>`, group: 'g', project: 'admin', bucket, ms: 10, steps: [], errors: [], notes: [], shots: [],
  });
  const html = renderReport(
    [row('SA-WBAS-10', 'pass'), row('SA-WBAS-11', 'fail')],
    { started: new Date(0), ms: 1000, target: 'https://admin.example', projects: ['admin'] },
    parseCatalogue(MD),
  );
  expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  expect(html).not.toContain('<b>x</b>');
  expect(html).toContain('2 of 2 catalogue cases executed');
  expect(html).toContain('data-status="fail" data-area="WBAS"');
  expect(html).toContain('>50%<');
});

test('summaryAttachment picks the ingestion summary out of a test result', () => {
  const body = Buffer.from('{"gate":{}}');
  expect(summaryAttachment([{ name: 'screenshot', contentType: 'image/png', body: Buffer.from('x') }, { name: 'ingestion-summary', contentType: 'application/json', body }])).toEqual(body);
  expect(summaryAttachment([{ name: 'other', contentType: 'application/json', body }])).toBeUndefined();
});
