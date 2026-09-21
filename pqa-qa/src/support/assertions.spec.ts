import { test, expect } from '@playwright/test';
import { assertRefused, assertNoForeignContent } from './assertions.js';
import { parseGapMeta } from './annotations.js';

test('a 401 is a refusal', () => {
  expect(() => assertRefused({ status: 401, body: { error: 'x' } }, 'ctx')).not.toThrow();
});

test('a 403 is a refusal', () => {
  expect(() => assertRefused({ status: 403, body: {} }, 'ctx')).not.toThrow();
});

test('a 404 is a refusal', () => {
  expect(() => assertRefused({ status: 404, body: {} }, 'ctx')).not.toThrow();
});

test('a 200 is NOT a refusal', () => {
  expect(() => assertRefused({ status: 200, body: { data: [1] } }, 'GET /x')).toThrow(/GET \/x/);
});

test('a 200 with an empty list is not a refusal either — this is the masquerade', () => {
  expect(() => assertRefused({ status: 200, body: { data: [] } }, 'GET /x')).toThrow(/200/);
});

test('a 500 is not counted as a refusal — it is an error, not a gate', () => {
  expect(() => assertRefused({ status: 500, body: {} }, 'GET /x')).toThrow(/500/);
});

test('foreign content in a body fails', () => {
  expect(() =>
    assertNoForeignContent(
      { status: 200, body: { data: [{ subject: 'Ministry of Railways budget' }] } },
      ['Ministry of Railways'],
      'GET /commerce/x',
    ),
  ).toThrow(/Ministry of Railways/);
});

test('absence of foreign content passes', () => {
  expect(() =>
    assertNoForeignContent(
      { status: 200, body: { data: [{ subject: 'Commerce exports' }] } },
      ['Ministry of Railways'],
      'ctx',
    ),
  ).not.toThrow();
});

test('gap metadata round-trips through the annotation description', () => {
  expect(parseGapMeta('S1-DO-02 · Bhupendra · per-tenant S3 IAM boundary')).toEqual({
    tracker: 'S1-DO-02',
    owner: 'Bhupendra',
    detail: 'per-tenant S3 IAM boundary',
  });
});
