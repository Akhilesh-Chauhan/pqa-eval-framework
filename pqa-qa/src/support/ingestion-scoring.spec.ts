import { test, expect } from '@playwright/test';
import { listF1, normalizeId, parseDate, scoreField, similarity, summarize, withUnrecorded } from './ingestion-scoring.js';
import type { CatResult, GateResult } from './ingestion-scoring.js';

test('parseDate handles the formats in the trackers and documents', () => {
  expect(parseDate('2024-07-22')).toBe('2024-07-22');
  expect(parseDate('23.05.1986')).toBe('1986-05-23');
  expect(parseDate('25/03/2026')).toBe('2026-03-25');
  expect(parseDate('25th April, 1872')).toBe('1872-04-25');
  expect(parseDate('2nd Feburary, 2024')).toBe('2024-02-02');
  expect(parseDate('March 25, 2026')).toBe('2026-03-25');
  expect(parseDate('25 MAR 2026 4:15PM by PIB Delhi')).toBe('2026-03-25');
  expect(parseDate('no date')).toBeUndefined();
  expect(parseDate('31.13.2020')).toBeUndefined();
});

test('identifiers ignore case, spaces and punctuation only', () => {
  expect(normalizeId('F. No. 3/1/2007-PY-III')).toBe(normalizeId('F.No.3/1/2007-py-iii'));
  expect(normalizeId('S.O. 1234(E)')).not.toBe(normalizeId('S.O. 1243(E)'));
});

test('similarity: same words score 1, filler words and punctuation are ignored', () => {
  expect(similarity('Ministry of Personnel, Public Grievances and Pensions', 'Ministry of Personnel, Public Grievances & Pensions')).toBe(1);
  expect(similarity('Ministry of Home Affairs', 'Ministry of Finance')).toBeLessThan(0.8);
  expect(similarity('', '')).toBe(1);
});

test('listF1 matches items fuzzily, once each', () => {
  expect(listF1(['Shri Ravi Kumar', 'Smt Sita Devi'], ['Ravi Kumar', 'Sita Devi'])).toBe(1);
  expect(listF1(['Ravi Kumar', 'Sita Devi'], ['Ravi Kumar'])).toBeCloseTo(2 / 3);
  expect(listF1([], [])).toBe(1);
});

test('scoreField applies the rule for each kind of field', () => {
  expect(scoreField('file_number', 'F. No. 12', { file_number: 'F.No.12' }).pass).toBe(true);
  expect(scoreField('date', '25th March, 2010', { date: '2010-03-25' }).pass).toBe(true);
  expect(scoreField('subject', 'Recovery of excess payments', { subject: 'Something else' }).pass).toBe(false);
  expect(scoreField('details', 'Long text', { details: 'Long text' })).toMatchObject({ kind: 'long', pass: null, score: 1 });
  expect(scoreField('members', ['Shri Ravi Kumar', 'Smt Sita Devi'], { members: ['Ravi Kumar', 'Sita Devi'] }).pass).toBe(true);
  expect(scoreField('members', ['Shri Ravi Kumar', 'Smt Sita Devi'], { members: ['Ravi Kumar'] }).pass).toBe(false);
  expect(scoreField('date', '1 May 2024', {}).pass).toBe(false);
});

test('ministry_or_department matches the ministry, the department, or both', () => {
  const s = scoreField('ministry_or_department', 'Department of Commerce', { ministry: 'Ministry of Commerce and Industry', department: 'Department of Commerce' });
  expect(s.pass).toBe(true);
  expect(s.actual).toBe('Department of Commerce');
});

test('summarize counts gate errors and builds the confusion table', () => {
  const gate: GateResult[] = [
    { id: 'GI-FMT-02', setup: 'P1', route: 'ingestion', expect: 'R', outcome: 'accept' },
    { id: 'GI-FMT-01', setup: 'P1', route: 'ingestion', expect: 'A', outcome: 'refuse' },
    { id: 'GI-FMT-20', setup: 'P1', route: 'ingestion', expect: 'Q', outcome: 'quarantine' },
  ];
  const f = (pass: boolean | null) => ({ field: 'subject', kind: 'text' as const, expected: 'a', actual: 'b', score: 0, pass });
  const cat: CatResult[] = [
    { id: 'GI-CAT-001', user_category: 'Circular', expected_type: 'orders', actual_type: 'orders', confidence: 0.9, outcome: 'accept', truth_status: 'verified', fields: [f(true), f(false)] },
    { id: 'GI-CAT-002', user_category: 'Bill', expected_type: 'acts', actual_type: 'others', confidence: 0.6, outcome: 'accept', truth_status: 'draft', fields: [] },
    { id: 'GI-CAT-003', user_category: 'Acts', expected_type: 'acts', outcome: 'error', truth_status: 'verified', fields: [] },
  ];
  const s = summarize(gate, cat);
  expect(s.gate).toMatchObject({ checks: 3, correct: 1, falseAccepts: 1, falseRefusals: 1 });
  expect(s.category).toMatchObject({ files: 3, accepted: 2, notMeasured: 1, accuracy: 0.5, lowConfidence: 1 });
  expect(s.category.confusion).toEqual({ orders: { orders: 1 }, acts: { others: 1 } });
  expect(s.metadata).toMatchObject({ documents: 1, documentsAllFieldsMatch: 0, fieldAccuracy: 0.5 });
  expect(s.category.byCategory).toEqual({
    Circular: { files: 1, correct: 1, fieldsChecked: 2, fieldsPassed: 1 },
    Bill: { files: 1, correct: 0, fieldsChecked: 0, fieldsPassed: 0 },
  });
});

test('an expected date with no date in it is reported, never failed', () => {
  const s = scoreField('date', '1968 (exact date not stated in document)', { date: '1968' });
  expect([s.pass, s.expected, s.actual]).toEqual([null, '1968 (exact date not stated in document)', '1968']);
});

test('withUnrecorded lists files a run never recorded as not measured, instead of dropping them', () => {
  const rows = [
    { id: 'GI-CAT-001', user_category: 'Acts', expected_type: 'acts' as const, truth_status: 'verified' },
    { id: 'GI-CAT-002', user_category: 'Bill', expected_type: 'acts' as const, truth_status: 'draft' },
  ];
  const done = [{ ...rows[0]!, actual_type: 'acts', outcome: 'accept' as const, fields: [] }];
  const all = withUnrecorded(done, rows);
  expect(all.map((c) => [c.id, c.outcome])).toEqual([['GI-CAT-001', 'accept'], ['GI-CAT-002', 'error']]);
  expect(summarize([], all).category).toMatchObject({ files: 2, accepted: 1, notMeasured: 1 });
});

test('summarize reports gate checks that were expected but never recorded', () => {
  const gate: GateResult[] = [{ id: 'GI-FMT-01', setup: 'P1', route: 'ingestion', expect: 'A', outcome: 'accept' }];
  expect(summarize(gate, [], 208).gate).toMatchObject({ checks: 1, expectedChecks: 208, notRecorded: 207 });
  expect(summarize(gate, []).gate).toMatchObject({ expectedChecks: 1, notRecorded: 0 });
});
