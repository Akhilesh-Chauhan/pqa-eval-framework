import { test, expect } from '@playwright/test';
import { classifyUpload, meets } from './ingestion-http.js';

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
