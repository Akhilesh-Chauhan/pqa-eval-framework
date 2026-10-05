import { test, expect } from '@playwright/test';
import { loadEnv, MissingEnvError } from './env.js';

const minimal = {
  PQA_BASE_URL: 'https://pqa.example.in',
  PQA_TENANT_CANDIDATES: 'commerce, railways ,mohfw',
  PLATFORM_SEED_EMAIL: 'admin@example.gov.in',
};

test('throws MissingEnvError naming the variable when base URL is absent', () => {
  const { PQA_BASE_URL, ...rest } = minimal;
  expect(() => loadEnv(rest as NodeJS.ProcessEnv)).toThrow(MissingEnvError);
  expect(() => loadEnv(rest as NodeJS.ProcessEnv)).toThrow(/PQA_BASE_URL/);
});

test('rejects a base URL that is not a URL', () => {
  expect(() => loadEnv({ ...minimal, PQA_BASE_URL: 'not-a-url' } as NodeJS.ProcessEnv))
    .toThrow(/PQA_BASE_URL/);
});

test('splits and trims tenant candidates', () => {
  const env = loadEnv(minimal as NodeJS.ProcessEnv);
  expect(env.tenantCandidates).toEqual(['commerce', 'railways', 'mohfw']);
});

test('strips a trailing slash from the base URL', () => {
  const env = loadEnv({ ...minimal, PQA_BASE_URL: 'https://pqa.example.in/' } as NodeJS.ProcessEnv);
  expect(env.baseUrl).toBe('https://pqa.example.in');
});

test('generates a run id when none is supplied', () => {
  const env = loadEnv(minimal as NodeJS.ProcessEnv);
  expect(env.runId).toMatch(/^[0-9a-f]{12}$/);
});

test('builds an identifying user agent containing the run id', () => {
  const env = loadEnv({ ...minimal, PQA_RUN_ID: 'abc123abc123' } as NodeJS.ProcessEnv);
  expect(env.userAgent).toBe('pqa-qa/0.1.0 (run:abc123abc123)');
});

test('collects only the personas whose emails are configured', () => {
  const env = loadEnv({
    ...minimal,
    PQA_PERSONA_DIVISION_MEMBER_EMAIL: 'div@example.gov.in',
  } as NodeJS.ProcessEnv);
  expect(env.personaEmails['platform-admin']).toBe('admin@example.gov.in');
  expect(env.personaEmails['division-member']).toBe('div@example.gov.in');
  expect(env.personaEmails['parliament-member']).toBeUndefined();
});

test('omits S3 credentials entirely when only some parts are present', () => {
  const env = loadEnv({ ...minimal, PQA_S3_BUCKET: 'b' } as NodeJS.ProcessEnv);
  expect(env.s3).toBeUndefined();
});

test('returns S3 credentials when every part is present', () => {
  const env = loadEnv({
    ...minimal,
    PQA_S3_REGION: 'ap-south-1',
    PQA_S3_BUCKET: 'bucket',
    PQA_S3_ACCESS_KEY_ID: 'AK',
    PQA_S3_SECRET_ACCESS_KEY: 'SK',
    PQA_S3_TENANT_PREFIX: 'commerce/',
  } as NodeJS.ProcessEnv);
  expect(env.s3?.bucket).toBe('bucket');
  expect(env.s3?.tenantPrefix).toBe('commerce/');
});
