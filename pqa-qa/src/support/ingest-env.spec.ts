import { test, expect } from '@playwright/test';
import { loadIngestEnv, portalSessionFile } from '../ingestion/ingest-env.js';

const base = { PQA_ADMIN_URL: 'https://admin.example', PQA_ADMIN_EMAIL: 'a@x.gov.in', PQA_BASE_URL: 'https://portal.example', PQA_ADMIN_TENANT_ADMIN_NAME: 'T', PQA_ADMIN_TENANT_ADMIN_EMAIL: 't@x.gov.in' };

test('refuses any tenant that is not a disposable ingestion tenant', () => {
  for (const slug of ['comind', 'educat', 'qw1a2b', 'qi12345', 'QI12AB']) {
    expect(() => loadIngestEnv({ ...base, PQA_INGEST_TENANT: slug })).toThrow(/refusing/);
  }
  expect(loadIngestEnv({ ...base, PQA_INGEST_TENANT: 'qi1a2b' }).tenant).toBe('qi1a2b');
});

test('golden dir and tenant are optional; the portal sign-in email defaults to the tenant admin', () => {
  const e = loadIngestEnv(base);
  expect([e.goldenDir, e.tenant, e.ingestAdminEmail]).toEqual([undefined, undefined, 't@x.gov.in']);
  expect(loadIngestEnv({ ...base, PQA_INGEST_ADMIN_EMAIL: 'p@x.gov.in' }).ingestAdminEmail).toBe('p@x.gov.in');
  expect(portalSessionFile('qi1a2b')).toMatch(/src\/\.auth\/portal-qi1a2b\.json$/);
});
