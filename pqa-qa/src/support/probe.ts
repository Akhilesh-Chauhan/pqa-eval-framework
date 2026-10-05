import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext } from '@playwright/test';
import type { QaEnv, PersonaName } from './env.js';
import { discoverTenants, pickTenantPair } from './tenant.js';
import type { TenantProbe, TenantPair } from './tenant.js';

export interface ProbeResult {
  available: boolean;
  reason?: string;
}

export interface Capabilities {
  runId: string;
  baseUrl: string;
  probedAt: string;
  baseUrlReachable: ProbeResult;
  tenants: TenantProbe[];
  tenantPair: TenantPair | null;
  mockAuth: ProbeResult;
  personas: Partial<Record<PersonaName, ProbeResult>>;
  s3: ProbeResult;
  openSearch: ProbeResult;
  postgres: ProbeResult;
}

export function credentialProbe(
  value: unknown,
  label: string,
  needed: string,
): ProbeResult {
  if (value) return { available: true };
  return { available: false, reason: `${label} not configured — set ${needed}` };
}

export function mockAuthProbe(httpStatus: number, body: unknown): ProbeResult {
  const parsed = body as { message?: string; otp?: string } | null;
  if (httpStatus === 404) {
    return { available: false, reason: parsed?.message ?? 'mock OTP disabled (404)' };
  }
  if (httpStatus !== 200) {
    return { available: false, reason: `mock OTP request returned HTTP ${httpStatus}` };
  }
  if (!parsed?.otp) {
    return {
      available: false,
      reason: 'no OTP in response body — the flow cannot be automated from here',
    };
  }
  return { available: true };
}

function capabilitiesPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '.auth', 'capabilities.json');
}

export function writeCapabilities(c: Capabilities): void {
  const p = capabilitiesPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(c, null, 2), 'utf8');
}

export function readCapabilities(): Capabilities {
  return JSON.parse(readFileSync(capabilitiesPath(), 'utf8')) as Capabilities;
}

export async function probeCapabilities(
  request: APIRequestContext,
  env: QaEnv,
): Promise<Capabilities> {
  const base: Capabilities = {
    runId: env.runId,
    baseUrl: env.baseUrl,
    probedAt: new Date().toISOString(),
    baseUrlReachable: { available: false, reason: 'not probed' },
    tenants: [],
    tenantPair: null,
    mockAuth: { available: false, reason: 'not probed' },
    personas: {},
    s3: credentialProbe(env.s3, 'S3', 'PQA_S3_* (ask Bhupendra, S1-DO-02)'),
    openSearch: credentialProbe(
      env.openSearch,
      'OpenSearch',
      'PQA_OPENSEARCH_* (ask Bhupendra, S1-DO-02)',
    ),
    postgres: credentialProbe(env.postgresDsn, 'Postgres', 'PQA_POSTGRES_DSN (ask Bhupendra)'),
  };

  try {
    const res = await request.get(env.baseUrl, {
      headers: { 'User-Agent': env.userAgent },
      timeout: 20_000,
      failOnStatusCode: false,
    });
    base.baseUrlReachable = { available: res.status() < 500, reason: `HTTP ${res.status()}` };
  } catch (err) {
    base.baseUrlReachable = {
      available: false,
      reason: err instanceof Error ? err.message : String(err),
    };
    return base;
  }

  base.tenants = await discoverTenants(request, env);
  base.tenantPair = pickTenantPair(base.tenants);

  const primary =
    base.tenantPair?.primary ?? base.tenants.find((t) => t.status === 'active')?.slug;
  if (!primary) return base;

  const admin = env.personaEmails['platform-admin'];
  if (admin) {
    const res = await request.post(`${env.baseUrl}/${primary}/api/auth/otp/request`, {
      headers: { 'User-Agent': env.userAgent, 'Content-Type': 'application/json' },
      data: { email: admin },
      timeout: 20_000,
      failOnStatusCode: false,
    });
    base.mockAuth = mockAuthProbe(res.status(), await res.json().catch(() => null));
  }

  return base;
}
