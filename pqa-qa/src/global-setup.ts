import { request } from '@playwright/test';
import { loadEnv } from './support/env.js';
import { probeCapabilities, writeCapabilities } from './support/probe.js';

export default async function globalSetup(): Promise<void> {
  const env = loadEnv();
  const ctx = await request.newContext({ ignoreHTTPSErrors: false });

  try {
    const capabilities = await probeCapabilities(ctx, env);

    if (!capabilities.baseUrlReachable.available) {
      writeCapabilities(capabilities);
      throw new Error(
        `pqa-qa: ${env.baseUrl} is unreachable (${capabilities.baseUrlReachable.reason}). ` +
          `Aborting before any test runs — a deploying environment produces hundreds of ` +
          `misleading failures otherwise.`,
      );
    }

    // Persona authentication is wired in by Task 5.
    writeCapabilities(capabilities);

    const active = capabilities.tenants.filter((t) => t.status === 'active').length;
    const usable = Object.values(capabilities.personas).filter((p) => p?.available).length;
    console.log(
      `pqa-qa run ${env.runId} · ${env.baseUrl} · ${active} active tenant(s) · ` +
        `${usable} persona(s) · s3=${capabilities.s3.available} ` +
        `opensearch=${capabilities.openSearch.available} pg=${capabilities.postgres.available}`,
    );
  } finally {
    await ctx.dispose();
  }
}
