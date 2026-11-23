import { existsSync } from 'node:fs';
import { test as setup, request } from '@playwright/test';
import { DESIGN_PERSONAS, designSessionFile, loadDesignEnv } from './design-env.js';
import { keepsSession } from '../ingestion/portal.js';

/** Renews each saved persona session before the design suite runs, and fails fast on one that no longer works.
 * A persona with no saved file is fine here: its cases report "not measured". */
setup('saved design-suite portal sessions are still valid', async () => {
  const env = loadDesignEnv();
  setup.skip(!env.tenant, 'PQA_DESIGN_TENANT is not set — every portal design case will report "not measured"');
  const dead: string[] = [];
  for (const persona of DESIGN_PERSONAS) {
    const file = designSessionFile(env.tenant!, persona);
    if (!existsSync(file)) continue;
    const ctx = await request.newContext({ storageState: file });
    try {
      const api = `${env.portalUrl}/${env.tenant}/api/auth`;
      await ctx.post(`${api}/session/refresh`, { failOnStatusCode: false });
      const res = await ctx.get(`${api}/session`, { failOnStatusCode: false });
      if (res.status() === 200 && keepsSession((await ctx.storageState()).cookies)) await ctx.storageState({ path: file });
      else dead.push(`${persona} (HTTP ${res.status()})`);
    } finally {
      await ctx.dispose();
    }
  }
  if (dead.length) throw new Error(`Saved portal session no longer works for: ${dead.join(', ')}. Run npm run qa:design:login -- <persona>.`);
});
