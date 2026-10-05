import { test as base, expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { loadEnv } from './env.js';
import type { QaEnv, PersonaName } from './env.js';
import { readCapabilities } from './probe.js';
import type { Capabilities } from './probe.js';
import { loadInventory } from './inventory.js';
import type { RouteEntry } from './inventory.js';
import { storageStatePath } from './personas.js';
import type { TenantPair } from './tenant.js';

interface QaFixtures {
  env: QaEnv;
  caps: Capabilities;
  routes: RouteEntry[];
  tenantPair: TenantPair | null;
  as: (persona: PersonaName) => Promise<APIRequestContext>;
}

export const test = base.extend<QaFixtures>({
  env: async ({}, use) => {
    await use(loadEnv());
  },
  caps: async ({}, use) => {
    await use(readCapabilities());
  },
  routes: async ({}, use) => {
    await use(loadInventory());
  },
  tenantPair: async ({ caps }, use) => {
    await use(caps.tenantPair);
  },

  as: async ({ env, caps }, use) => {
    const created: APIRequestContext[] = [];
    const factory = async (persona: PersonaName): Promise<APIRequestContext> => {
      const probe = caps.personas[persona];
      if (!probe?.available) {
        throw new Error(
          `persona "${persona}" is unavailable: ${probe?.reason ?? 'not configured'}`,
        );
      }
      const ctx = await playwrightRequest.newContext({
        storageState: storageStatePath(persona),
        extraHTTPHeaders: { 'User-Agent': env.userAgent },
      });
      created.push(ctx);
      return ctx;
    };
    await use(factory);
    await Promise.all(created.map((c) => c.dispose()));
  },
});

export { expect };

/** Resolve an inventory path template against a tenant and an optional id. */
export function url(env: QaEnv, entry: RouteEntry, tenant: string, id = '1'): string {
  return `${env.baseUrl}${entry.path.replace('{tenant}', tenant).replace('{id}', id)}`;
}
