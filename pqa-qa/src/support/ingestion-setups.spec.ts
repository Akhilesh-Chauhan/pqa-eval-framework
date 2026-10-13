import { test, expect } from '@playwright/test';
import { SETUPS, acceptMatches, withSetup } from './ingestion-setups.js';

const [P1, P2, P3, P4] = SETUPS;

test('the four setups of the spec', () => {
  expect(SETUPS.map((s) => [s.id, s.types.length, s.maxMb])).toEqual([['P1', 1, 10], ['P2', 11, 10], ['P3', 3, 10], ['P4', 1, 1]]);
});

test('withSetup replaces only the file rules and sets expectedUpdatedAt', () => {
  const body = { expectedUpdatedAt: 'old', tenant: { status: 'active', assistant: { displayName: 'QA', fileSupportType: { extensions: ['.pdf'], mimeTypes: ['application/pdf'], questionListMimeTypes: ['application/pdf'] }, filesize: { bytes: 1, label: 'x' } } } };
  const out = withSetup(body, P3!, 'new');
  expect(out.expectedUpdatedAt).toBe('new');
  expect(out.tenant.status).toBe('active');
  expect(out.tenant.assistant.displayName).toBe('QA');
  expect(out.tenant.assistant.fileSupportType).toEqual({
    extensions: ['.pdf', '.docx', '.png'],
    mimeTypes: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/png'],
    questionListMimeTypes: ['application/pdf'],
  });
  expect(withSetup(body, P4!, 'n').tenant.assistant.filesize).toEqual({ bytes: 1048576, label: '1 MB' });
  expect(body.tenant.assistant.fileSupportType.extensions).toEqual(['.pdf']); // input untouched
});

test('acceptMatches: exactly the setup, by extension or MIME; .jpg counts as JPEG', () => {
  expect(acceptMatches('application/pdf,.pdf', P1!).ok).toBe(true);
  expect(acceptMatches('application/pdf,.doc,.docx,application/msword', P1!)).toEqual({ ok: false, missing: [], extra: ['.doc', '.docx', 'application/msword'] });
  expect(acceptMatches('.pdf', P3!)).toMatchObject({ ok: false, missing: ['.docx', '.png'] });
  expect(acceptMatches('.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.png,.jpeg,.jpg', P2!).ok).toBe(true);
  expect(acceptMatches('', P1!)).toMatchObject({ ok: false, missing: ['.pdf'] });
});
