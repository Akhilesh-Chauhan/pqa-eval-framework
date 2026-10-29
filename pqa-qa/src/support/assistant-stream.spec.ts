import { test, expect } from '@playwright/test';
import type { GoldenRow } from './assistant-golden.js';
import { askOutcome, buildCapturedRow, matchContexts, parseStream, type RawSource, type StreamResult } from './assistant-stream.js';

const STREAM_OK = `event: status
data: {"message":"Searching"}

event: token
data: {"token":"The "}

event: token
data: {"token":"deficit"}

event: complete
data: {"answer":"The deficit was ₹1 crore.","sources":[{"filename":"ls_unstarred_1493.pdf","question_number":"1493","text_preview":"GOVERNMENT OF INDIA  MINISTRY OF COMMERCE","score":0.91}]}

`;

const SRC: RawSource = { filename: 'ls_unstarred_1493.pdf', topic: '', source_url: '', assembly: '', session_date: '', question_number: '1493', text_preview: '' };

const ROW = { id: 'q1', user_input: 'What was the deficit?' } as GoldenRow;
const TIMING = { status: 200, ttft_ms: 120, total_ms: 900 };

test('parseStream: tokens accumulate, complete overrides answer and carries sources untruncated', () => {
  const r = parseStream(STREAM_OK);
  expect(r.answer).toBe('The deficit was ₹1 crore.');
  expect(r.sources).toHaveLength(1);
  expect(r.sources[0]).toMatchObject({ filename: 'ls_unstarred_1493.pdf', question_number: '1493', score: 0.91, topic: '' });
  expect(r.sources[0]?.text_preview).toBe('GOVERNMENT OF INDIA  MINISTRY OF COMMERCE');
  expect(r.statuses).toEqual(['Searching']);
  expect(r.complete).toBe(true);
});

test('a stream without complete keeps the token text and reports complete=false', () => {
  const r = parseStream(STREAM_OK.split('\n\n').slice(0, 3).join('\n\n') + '\n\n');
  expect(r.answer).toBe('The deficit');
  expect(r.complete).toBe(false);
});

test('sources as a string, a single object, garbage and a bad data block do not throw', () => {
  const complete = (sources: unknown) => `event: complete\ndata: ${JSON.stringify({ answer: 'a', sources })}\n\n`;
  expect(parseStream(complete('just text')).sources).toEqual([{ ...SRC, filename: '', question_number: '', text_preview: 'just text' }]);
  expect(parseStream(complete({ filename: 'x.pdf', score: 'high' })).sources).toEqual([{ ...SRC, filename: 'x.pdf', question_number: '' }]);
  expect(parseStream(complete(42)).sources).toEqual([]);
  const bad = parseStream('event: token\ndata: {not json\n\nevent: token\ndata: [DONE]\n\n' + complete([]));
  expect(bad).toMatchObject({ answer: 'a', sources: [], complete: true });
});

test('matchContexts strips a trailing ... , ignores whitespace runs, prefers the longer text, counts misses', () => {
  const docs = [{ text: 'GOVERNMENT OF INDIA\nMINISTRY OF COMMERCE  … full chunk text here' }];
  const r = matchContexts([{ ...SRC, text_preview: 'GOVERNMENT OF INDIA MINISTRY OF COMMERCE...' }, { ...SRC, text_preview: 'no such chunk' }], docs);
  expect(r.contexts[0]).toBe(docs[0]!.text);
  expect(r.contexts[1]).toBe('no such chunk');
  expect(r).toMatchObject({ matched: 1, unmatched: 1 });
});

test('askOutcome maps 200 / 401 / 403 / 502', () => {
  expect([200, 401, 403, 502].map(askOutcome)).toEqual(['ok', 'session-lost', 'session-lost', 'error']);
});

test('buildCapturedRow: ok row carries response, contexts, mapped citations and chunk count', () => {
  const stream = parseStream(STREAM_OK);
  const row = buildCapturedRow(ROW, stream, [{ text: 'GOVERNMENT OF INDIA MINISTRY OF COMMERCE and the rest' }], { 'ls_unstarred_1493.pdf': 'ls_1493.md' }, TIMING);
  expect(row).toMatchObject({ id: 'q1', response: 'The deficit was ₹1 crore.', retrieved_contexts: ['GOVERNMENT OF INDIA MINISTRY OF COMMERCE and the rest'],
    cited_sources: ['ls_1493.md'], cited_sources_raw: ['ls_unstarred_1493.pdf'] });
  expect(row.capture).toEqual({ ...TIMING, contexts_from: 'chat.sources+search.match', matched: 1, unmatched: 0, chunks: 1 });
});

test('buildCapturedRow: an error or incomplete stream yields an empty row with capture.error', () => {
  const incomplete: StreamResult = { answer: 'partial', sources: [SRC], complete: false, statuses: [] };
  const a = buildCapturedRow(ROW, incomplete, [], {}, TIMING);
  expect(a).toMatchObject({ response: '', retrieved_contexts: [], cited_sources: [] });
  expect(a.capture).toMatchObject({ error: 'stream ended without complete event', chunks: 0 });
  const b = buildCapturedRow(ROW, parseStream(STREAM_OK), [], {}, { ...TIMING, status: 502, error: 'HTTP 502' });
  expect(b.response).toBe('');
  expect(b.capture.error).toBe('HTTP 502');
  expect(buildCapturedRow(ROW, null, [], {}, TIMING).capture.error).toBe('stream ended without complete event');
});
