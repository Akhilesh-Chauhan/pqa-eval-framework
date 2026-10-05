import type { APIRequestContext } from '@playwright/test';
import type { QaEnv } from './env.js';

export type TenantStatus = 'active' | 'suspended' | 'not-found' | 'error';

export interface TenantProbe {
  slug: string;
  status: TenantStatus;
  tenantName?: string;
  detail?: string;
}

export interface TenantPair {
  primary: string;
  secondary: string;
}

interface ConfigBody {
  data?: { tenant?: { tenantName?: string; status?: string } };
}

export function classifyTenantResponse(
  slug: string,
  httpStatus: number,
  body: unknown,
): TenantProbe {
  if (httpStatus === 404) return { slug, status: 'not-found' };
  if (httpStatus === 403) return { slug, status: 'suspended', detail: 'HTTP 403' };
  if (httpStatus !== 200) {
    return { slug, status: 'error', detail: `HTTP ${httpStatus}` };
  }

  const tenant = (body as ConfigBody | null)?.data?.tenant;
  if (!tenant?.tenantName) {
    return { slug, status: 'error', detail: 'HTTP 200 with no tenant in body' };
  }
  if (tenant.status && tenant.status !== 'active') {
    return { slug, status: 'suspended', tenantName: tenant.tenantName, detail: tenant.status };
  }
  return { slug, status: 'active', tenantName: tenant.tenantName };
}

export async function discoverTenants(
  request: APIRequestContext,
  env: QaEnv,
): Promise<TenantProbe[]> {
  const probes: TenantProbe[] = [];
  for (const slug of env.tenantCandidates) {
    try {
      const res = await request.get(`${env.baseUrl}/${slug}/api/tenant-config`, {
        headers: { 'User-Agent': env.userAgent },
        timeout: 15_000,
        failOnStatusCode: false,
      });
      const body = await res.json().catch(() => null);
      probes.push(classifyTenantResponse(slug, res.status(), body));
    } catch (err) {
      probes.push({
        slug,
        status: 'error',
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return probes;
}

export function activeSlugs(probes: TenantProbe[]): string[] {
  return probes.filter((p) => p.status === 'active').map((p) => p.slug);
}

export function pickTenantPair(probes: TenantProbe[]): TenantPair | null {
  const active = activeSlugs(probes);
  const [primary, secondary] = active;
  if (!primary || !secondary) return null;
  return { primary, secondary };
}
