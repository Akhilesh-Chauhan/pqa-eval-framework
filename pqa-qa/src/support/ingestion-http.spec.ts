import { test, expect } from '@playwright/test';
import { classifyUpload, meets, multipart } from './ingestion-http.js';

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

test('multipart round-trips through a real form-data parser, with and without a MIME type', async () => {
  const { body, contentType } = multipart([
    { filename: 'a "quoted" [1].pdf', mime: 'application/pdf', data: Buffer.from('%PDF-1') },
    { filename: 'no-mime.pdf', data: Buffer.from([0, 255, 13, 10]) },
    { filename: 'ठीक line\r\nbreak.pdf', mime: 'application/pdf', data: Buffer.from('x') },
  ]);
  expect(body.includes(Buffer.from('filename="ठीक linebreak.pdf"'))).toBe(true); // UTF-8 bytes, no header injection
  const form = await new Response(new Uint8Array(body), { headers: { 'content-type': contentType } }).formData();
  const [a, b] = form.getAll('files') as File[];
  expect(a!.name).toBe('a "quoted" [1].pdf'); // sent as %22, decoded back by the parser
  expect(body.includes(Buffer.from('filename="a %22quoted%22 [1].pdf"'))).toBe(true);
  expect(a!.type).toBe('application/pdf');
  expect(Buffer.from(await a!.arrayBuffer()).toString()).toBe('%PDF-1');
  expect(b!.type).not.toBe('application/pdf');
  expect([...Buffer.from(await b!.arrayBuffer())]).toEqual([0, 255, 13, 10]);
  expect(body.toString('latin1')).not.toMatch(/filename="no-mime\.pdf"\r\nContent-Type/);
});
