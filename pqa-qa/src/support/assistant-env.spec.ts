import { test, expect } from '@playwright/test';
import { isAbsolute } from 'node:path';
import { loadAssistantEnv, runDir } from '../assistant/assistant-env.js';

const BASE_ADMIN_ENV = { PQA_ADMIN_URL: 'https://admin.example', PQA_ADMIN_EMAIL: 'a@x.gov.in', PQA_BASE_URL: 'https://portal.example' };
const assistant = { ...BASE_ADMIN_ENV, PQA_ASSISTANT_TENANT: 'comind', PQA_ASSISTANT_GOLDEN_DIR: '/x/golden/moc-45', PQA_ADMIN_TENANT_ADMIN_EMAIL: 'a@gov.in' };

test('loadAssistantEnv: run id defaults to <dataset>-<tenant>-<date>, stream to chat', () => {
  const env = loadAssistantEnv(assistant, new Date('2026-11-03T05:00:00Z'));
  expect(env.runId).toBe('moc-45-comind-2026-11-03');
  expect(env.stream).toBe('chat');
  expect(env.adminEmail).toBe('a@gov.in');
  expect(env.reparse).toBe(false);
});

test('explicit run id, generate stream, assistant email and reparse are honoured', () => {
  const env = loadAssistantEnv({ ...assistant, PQA_ASSISTANT_RUN: 'r9', PQA_ASSISTANT_STREAM: 'generate', PQA_ASSISTANT_ADMIN_EMAIL: 'p@gov.in', PQA_ASSISTANT_REPARSE: '1' });
  expect([env.runId, env.stream, env.adminEmail, env.reparse]).toEqual(['r9', 'generate', 'p@gov.in', true]);
});

test('missing tenant or golden dir throws naming the variable', () => {
  expect(() => loadAssistantEnv({ ...assistant, PQA_ASSISTANT_TENANT: '' })).toThrow(/PQA_ASSISTANT_TENANT/);
  expect(() => loadAssistantEnv({ ...assistant, PQA_ASSISTANT_GOLDEN_DIR: undefined })).toThrow(/PQA_ASSISTANT_GOLDEN_DIR/);
});

test('an unknown stream value throws', () => {
  expect(() => loadAssistantEnv({ ...assistant, PQA_ASSISTANT_STREAM: 'search' })).toThrow(/PQA_ASSISTANT_STREAM/);
});

test('runDir is absolute and under runs/assistant', () => {
  expect(runDir('r1')).toMatch(/\/runs\/assistant\/r1$/);
  expect(isAbsolute(runDir('r1'))).toBe(true);
});
