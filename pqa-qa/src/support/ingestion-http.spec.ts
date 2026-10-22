import { test, expect } from '@playwright/test';
import { classifyUpload, matchResults, meets, streamResults } from './ingestion-http.js';

test('classifyUpload reads status codes and the first item', () => {
  expect(classifyUpload(400, { detail: 'Unsupported file type' }).outcome).toBe('refuse');
  expect(classifyUpload(413, {}).outcome).toBe('refuse');
  expect(classifyUpload(502, { error: 'Batch ingestion failed' }).outcome).toBe('error');
  expect(classifyUpload(200, { results: [{ status: 'completed' }] }).outcome).toBe('accept');
  expect(classifyUpload(200, { results: [{ status: 'partial' }] }).outcome).toBe('accept');
  expect(classifyUpload(200, { results: [{ status: 'quarantined', error: 'corrupt' }] })).toEqual({ outcome: 'quarantine', detail: 'quarantined corrupt' });
  expect(classifyUpload(200, { results: [] }).outcome).toBe('error');
});

test('a duplicate is never an accept', () => {
  const r = classifyUpload(200, { results: [{ status: 'duplicate' }] });
  expect(r.outcome).toBe('duplicate');
  expect(r.detail).toMatch(/not cleared/);
  expect(meets('A', 'duplicate')).toBe(false);
});

test('meets: A needs accept, R needs refuse, Q takes refuse or quarantine', () => {
  expect([meets('A', 'accept'), meets('A', 'quarantine')]).toEqual([true, false]);
  expect([meets('R', 'refuse'), meets('R', 'accept'), meets('R', 'quarantine')]).toEqual([true, false, false]);
  expect([meets('Q', 'refuse'), meets('Q', 'quarantine'), meets('Q', 'accept')]).toEqual([true, true, false]);
});

test('streamResults takes each file_done / file_error result from the KB Docs event stream, in file order', () => {
  const ev = (event: string, data: object) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const text = ev('init', { total: 2, filenames: ['a.pdf', 'b.pdf'] }) + ev('file_start', { index: 0, filename: 'a.pdf' }) +
    ev('stage', { index: 0, filename: 'a.pdf', stage: 'classify', step: 5, total_steps: 9 }) +
    ev('file_error', { index: 1, filename: 'b.pdf', message: 'convert failed' }) +
    ev('file_done', { index: 0, filename: 'a.pdf', status: 'completed', result: { filename: 'a.pdf', status: 'completed', classification: { document_type: 'acts', confidence: 0.99 } } });
  const got = streamResults(text);
  expect(got).toHaveLength(2);
  expect(got[0]).toMatchObject({ filename: 'a.pdf', status: 'completed', classification: { document_type: 'acts' } });
  expect(got[1]).toEqual({ filename: 'b.pdf', status: 'failed', error: 'convert failed' });
  expect(streamResults('event: init\ndata: {"total": 0}\n\n')).toEqual([]);
});

test('matchResults pairs a batch by position, because quarantined results carry no filename', () => {
  const q = { status: 'quarantined', error: 'convert failed' };
  expect(matchResults(['a.pdf', 'b.pdf'], [{ filename: 'a.pdf', status: 'completed' }, q])).toEqual([{ filename: 'a.pdf', status: 'completed' }, q]);
});

test('matchResults trusts a filename that disagrees with the position', () => {
  const a = { filename: 'a.pdf' };
  const b = { filename: 'b.pdf' };
  expect(matchResults(['a.pdf', 'b.pdf'], [b, a])).toEqual([a, b]);
});

test('matchResults falls back to names alone when the counts differ', () => {
  expect(matchResults(['a.pdf', 'b.pdf', 'c.pdf'], [{ filename: 'c.pdf' }, { status: 'quarantined' }])).toEqual([undefined, undefined, { filename: 'c.pdf' }]);
});
