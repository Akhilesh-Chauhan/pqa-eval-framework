import { test, expect } from '@playwright/test';
import { classifyLogin, storageStatePath } from './personas.js';

test('a successful verify is available', () => {
  expect(classifyLogin('verify', 200, {}).available).toBe(true);
});

test('an unprovisioned user is unavailable, not an error', () => {
  const r = classifyLogin('verify', 401, { message: 'User is not provisioned for this tenant' });
  expect(r.available).toBe(false);
  expect(r.reason).toContain('not provisioned');
});

test('a deactivated account is unavailable with its own reason', () => {
  const r = classifyLogin('verify', 401, { message: 'Your account has been deactivated' });
  expect(r.reason).toContain('deactivated');
});

test('a disabled mock OTP endpoint is reported at the request step', () => {
  const r = classifyLogin('request', 404, { message: 'Mock OTP is disabled.' });
  expect(r.available).toBe(false);
  expect(r.reason).toContain('Mock OTP is disabled');
});

test('a 5xx is reported with its status so it is not read as a missing account', () => {
  const r = classifyLogin('verify', 502, {});
  expect(r.available).toBe(false);
  expect(r.reason).toContain('502');
});

test('storage state paths are per-persona and under the gitignored .auth directory', () => {
  const p = storageStatePath('division-member');
  expect(p).toContain('.auth');
  expect(p).toContain('division-member');
  expect(p.endsWith('.json')).toBe(true);
});

test('each persona gets its own storage state path', () => {
  const paths = new Set([
    storageStatePath('platform-admin'),
    storageStatePath('parliament-admin'),
    storageStatePath('parliament-member'),
    storageStatePath('division-admin'),
    storageStatePath('division-member'),
  ]);
  expect(paths.size).toBe(5);
});
