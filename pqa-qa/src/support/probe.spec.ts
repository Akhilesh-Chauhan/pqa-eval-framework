import { test, expect } from '@playwright/test';
import { credentialProbe, mockAuthProbe } from './probe.js';

test('an absent credential is unavailable with a reason naming what is needed', () => {
  const r = credentialProbe(undefined, 'S3', 'PQA_S3_* (ask Bhupendra, S1-DO-02)');
  expect(r.available).toBe(false);
  expect(r.reason).toContain('PQA_S3_*');
  expect(r.reason).toContain('Bhupendra');
});

test('a present credential is available', () => {
  expect(credentialProbe({ bucket: 'b' }, 'S3', 'x').available).toBe(true);
});

test('mock auth is available when the OTP request returns a code', () => {
  expect(mockAuthProbe(200, { message: 'DEV', otp: '123456' }).available).toBe(true);
});

test('mock auth is unavailable when the endpoint 404s', () => {
  const r = mockAuthProbe(404, { message: 'Mock OTP is disabled.' });
  expect(r.available).toBe(false);
  expect(r.reason).toContain('disabled');
});

test('mock auth without an OTP in the body is unavailable — it cannot be automated', () => {
  const r = mockAuthProbe(200, { message: 'Check identity-service logs for the OTP code.' });
  expect(r.available).toBe(false);
  expect(r.reason).toMatch(/no otp in response/i);
});
