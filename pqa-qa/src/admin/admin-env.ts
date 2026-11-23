import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { required } from '../support/env.js';

/** Saved Super Admin cookies. Written by `npm run qa:admin:login`, kept current by the fixtures. */
export const SESSION_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', '.auth', 'super-admin.json');

export interface AdminEnv {
  adminUrl: string;
  adminEmail: string;
  /** Ministry portal origin, for "open the portal and check" steps. */
  portalUrl: string;
  testTenant: string;
  allowWrites: boolean;
  /** Ministries the lifecycle test provisions, one tenant each. */
  ministries: string[];
  tenantAdmin?: { name: string; email: string };
  llm?: { apiKey: string; baseUrl: string; model: string; embeddingModel: string };
  peopleEmail?: string;
}

export function loadAdminEnv(src: NodeJS.ProcessEnv = process.env): AdminEnv {
  const opt = (key: string): string | undefined => src[key]?.trim() || undefined;
  const name = opt('PQA_ADMIN_TENANT_ADMIN_NAME');
  const email = opt('PQA_ADMIN_TENANT_ADMIN_EMAIL');
  const apiKey = opt('PQA_ADMIN_LLM_API_KEY');
  const baseUrl = opt('PQA_ADMIN_LLM_BASE_URL');
  const model = opt('PQA_ADMIN_LLM_MODEL');
  const embeddingModel = opt('PQA_ADMIN_LLM_EMBEDDING_MODEL');
  return {
    adminUrl: required(src, 'PQA_ADMIN_URL').replace(/\/+$/, ''),
    adminEmail: required(src, 'PQA_ADMIN_EMAIL'),
    portalUrl: required(src, 'PQA_BASE_URL').replace(/\/+$/, ''),
    testTenant: opt('PQA_ADMIN_TEST_TENANT') ?? 'educat',
    allowWrites: opt('PQA_ADMIN_ALLOW_WRITES') === 'true',
    // `;`-separated: some ministry names contain commas.
    ministries: (opt('PQA_ADMIN_TEST_MINISTRIES') ?? '').split(';').map((m) => m.trim()).filter(Boolean),
    tenantAdmin: name && email ? { name, email } : undefined,
    llm: apiKey && baseUrl && model && embeddingModel ? { apiKey, baseUrl, model, embeddingModel } : undefined,
    peopleEmail: opt('PQA_ADMIN_PEOPLE_EMAIL'),
  };
}
