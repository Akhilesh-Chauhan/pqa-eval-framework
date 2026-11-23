import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAdminEnv } from '../admin/admin-env.js';
import type { AdminEnv } from '../admin/admin-env.js';

/** Only disposable ingestion tenants: "qi" + 4 hex. Anything else (comind, educat, …) is refused outright. */
export const SLUG = /^qi[0-9a-f]{4}$/;

/** Saved portal cookies for the disposable tenant: its admin (the maker), or `role` such as the checker. Written by
 * scripts/portal-login.mjs, kept current by the fixtures. */
export const portalSessionFile = (slug: string, role?: string): string =>
  join(dirname(fileURLToPath(import.meta.url)), '..', '.auth', `portal-${slug}${role ? `-${role}` : ''}.json`);

export interface IngestEnv extends AdminEnv {
  /** PQA_GOLDEN_DIR — the dataset folder; tests skip when unset. */
  goldenDir?: string;
  /** PQA_INGEST_TENANT — written by npm run qa:ingest:provision. */
  tenant?: string;
  /** Who signs in to the tenant portal: PQA_INGEST_ADMIN_EMAIL, else PQA_ADMIN_TENANT_ADMIN_EMAIL. */
  ingestAdminEmail?: string;
  /** PQA_INGEST_CATEGORY — comma-separated categories to run (each is its own golden dataset); unset runs all. */
  categories?: string[];
}

/** The existing tenant's status from GET /api/tenants/<slug>. Only a 404 means it is gone and may be replaced: any
 * other failure (401, 5xx) must stop provisioning, or a second tenant would claim another real ministry. */
export function existingTenantStatus(httpStatus: number, body: any): string {
  if (httpStatus === 404) return 'missing';
  if (httpStatus !== 200) throw new Error(`GET /api/tenants answered ${httpStatus} — not provisioning a second tenant; retry, or check PQA_INGEST_TENANT`);
  return String(body?.data?.tenant?.status);
}

export function loadIngestEnv(src: NodeJS.ProcessEnv = process.env): IngestEnv {
  const opt = (key: string): string | undefined => src[key]?.trim() || undefined;
  const tenant = opt('PQA_INGEST_TENANT');
  if (tenant && !SLUG.test(tenant)) throw new Error(`PQA_INGEST_TENANT=${tenant} is not a disposable ingestion tenant (qi + 4 hex) — refusing to touch it`);
  const admin = loadAdminEnv(src);
  const categories = opt('PQA_INGEST_CATEGORY')?.split(',').map((c) => c.trim()).filter(Boolean);
  return { ...admin, goldenDir: opt('PQA_GOLDEN_DIR'), tenant, ingestAdminEmail: opt('PQA_INGEST_ADMIN_EMAIL') ?? admin.tenantAdmin?.email, categories: categories?.length ? categories : undefined };
}
