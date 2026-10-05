import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import type { QaEnv, PersonaName } from './env.js';
import type { Capabilities, ProbeResult } from './probe.js';

export function storageStatePath(persona: PersonaName): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '.auth', `${persona}.json`);
}

export function classifyLogin(
  step: 'request' | 'verify',
  httpStatus: number,
  body: unknown,
): ProbeResult {
  const message = (body as { message?: string } | null)?.message;
  if (httpStatus === 200) return { available: true };
  if (message) return { available: false, reason: `${step}: ${message} (HTTP ${httpStatus})` };
  return { available: false, reason: `${step}: HTTP ${httpStatus}` };
}

async function loginOne(
  ctx: APIRequestContext,
  env: QaEnv,
  slug: string,
  persona: PersonaName,
  email: string,
): Promise<ProbeResult> {
  const headers = { 'User-Agent': env.userAgent, 'Content-Type': 'application/json' };

  const reqRes = await ctx.post(`${env.baseUrl}/${slug}/api/auth/otp/request`, {
    headers,
    data: { email },
    timeout: 20_000,
    failOnStatusCode: false,
  });
  const reqBody = (await reqRes.json().catch(() => null)) as
    | { otp?: string; message?: string }
    | null;
  if (reqRes.status() !== 200) return classifyLogin('request', reqRes.status(), reqBody);
  if (!reqBody?.otp) {
    return { available: false, reason: 'request: no OTP in response body' };
  }

  const verifyRes = await ctx.post(`${env.baseUrl}/${slug}/api/auth/otp/verify`, {
    headers,
    data: { email, otp: reqBody.otp },
    timeout: 20_000,
    failOnStatusCode: false,
  });
  if (verifyRes.status() !== 200) {
    return classifyLogin('verify', verifyRes.status(), await verifyRes.json().catch(() => null));
  }

  const path = storageStatePath(persona);
  mkdirSync(dirname(path), { recursive: true });
  await ctx.storageState({ path });
  return { available: true };
}

export async function authenticatePersonas(
  env: QaEnv,
  caps: Capabilities,
): Promise<Partial<Record<PersonaName, ProbeResult>>> {
  const out: Partial<Record<PersonaName, ProbeResult>> = {};
  const slug = caps.tenantPair?.primary ?? caps.tenants.find((t) => t.status === 'active')?.slug;

  for (const [persona, email] of Object.entries(env.personaEmails) as Array<
    [PersonaName, string]
  >) {
    if (!slug) {
      out[persona] = { available: false, reason: 'no active tenant to authenticate against' };
      continue;
    }
    if (!caps.mockAuth.available) {
      out[persona] = { available: false, reason: `mock auth unavailable: ${caps.mockAuth.reason}` };
      continue;
    }

    // A fresh context per persona. Reusing one would carry the previous
    // persona's cookies into the next storageState, silently producing N
    // identical sessions and N authorization tests that all pass for the
    // wrong reason. This is the most dangerous failure mode in the fixture
    // layer, and it is invisible in a green report.
    const personaCtx = await playwrightRequest.newContext({
      extraHTTPHeaders: { 'User-Agent': env.userAgent },
    });
    try {
      out[persona] = await loginOne(personaCtx, env, slug, persona, email);
    } finally {
      await personaCtx.dispose();
    }
  }
  return out;
}
