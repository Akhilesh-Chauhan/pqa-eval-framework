import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAdminEnv } from '../admin/admin-env.js';
import type { AdminEnv } from '../admin/admin-env.js';

/** Only disposable ingestion tenants: "qi" + 4 hex. Anything else (comind, educat, …) is refused outright. */
export const SLUG = /^qi[0-9a-f]{4}$/;

/** Saved portal cookies for the disposable tenant. Written by scripts/portal-login.mjs, kept current by the fixtures. */
export const portalSessionFile = (slug: string): string => join(dirname(fileURLToPath(import.meta.url)), '..', '.auth', `portal-${slug}.json`);

export interface IngestEnv extends AdminEnv {
  /** PQA_GOLDEN_DIR — the dataset folder; tests skip when unset. */
  goldenDir?: string;
  /** PQA_INGEST_TENANT — written by npm run qa:ingest:provision. */
  tenant?: string;
  /** Who signs in to the tenant portal: PQA_INGEST_ADMIN_EMAIL, else PQA_ADMIN_TENANT_ADMIN_EMAIL. */
  ingestAdminEmail?: string;
}

export function loadIngestEnv(src: NodeJS.ProcessEnv = process.env): IngestEnv {
  const opt = (key: string): string | undefined => src[key]?.trim() || undefined;
  const tenant = opt('PQA_INGEST_TENANT');
  if (tenant && !SLUG.test(tenant)) throw new Error(`PQA_INGEST_TENANT=${tenant} is not a disposable ingestion tenant (qi + 4 hex) — refusing to touch it`);
  const admin = loadAdminEnv(src);
  return { ...admin, goldenDir: opt('PQA_GOLDEN_DIR'), tenant, ingestAdminEmail: opt('PQA_INGEST_ADMIN_EMAIL') ?? admin.tenantAdmin?.email };
}
