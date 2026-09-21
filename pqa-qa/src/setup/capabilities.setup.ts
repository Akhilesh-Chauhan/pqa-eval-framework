import { test as setup, request } from '@playwright/test';
import { loadEnv } from '../support/env.js';
import { probeCapabilities, writeCapabilities } from '../support/probe.js';
import { authenticatePersonas } from '../support/personas.js';

/**
 * Runs once before the isolation project. Deliberately a setup *project*
 * rather than Playwright's `globalSetup`: globalSetup runs for every project,
 * which would make the support-layer unit tests require a reachable
 * environment and a full set of credentials to run at all.
 */
setup('probe capabilities and authenticate personas', async () => {
  setup.setTimeout(180_000);

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

    capabilities.personas = await authenticatePersonas(env, capabilities);
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
});
