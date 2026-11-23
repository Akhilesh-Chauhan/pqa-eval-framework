import { existsSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { notMeasured } from '../support/annotations.js';
import { keepsSession } from '../ingestion/portal.js';
import { designSessionFile, loadDesignEnv } from './design-env.js';
import type { DesignEnv, DesignPersona } from './design-env.js';

/**
 * `as(persona)` opens the design tenant's portal home signed in as that persona. A persona with no saved session
 * (or no PQA_DESIGN_TENANT) makes the case "not measured" — never a pass. Rotated cookies are written back.
 */
export const test = base.extend<{ denv: DesignEnv; as: (persona: DesignPersona) => Promise<Page> }>({
  denv: async ({}, use) => {
    await use(loadDesignEnv());
  },

  as: async ({ browser, denv }, use, testInfo) => {
    const opened: Array<{ ctx: BrowserContext; file: string }> = [];
    await use(async (persona) => {
      const hint = { tracker: 'design-suite', owner: 'QA', detail: '' };
      if (!denv.tenant) notMeasured(testInfo, { ...hint, detail: 'PQA_DESIGN_TENANT is not set' });
      const file = designSessionFile(denv.tenant!, persona);
      if (!existsSync(file)) notMeasured(testInfo, { ...hint, detail: `no ${persona} session — run npm run qa:design:login -- ${persona}` });
      const ctx = await browser.newContext({ storageState: file });
      opened.push({ ctx, file });
      const page = await ctx.newPage();
      await page.goto(`${denv.portalUrl}/${denv.tenant}`);
      return page;
    });
    for (const { ctx, file } of opened) {
      if (testInfo.status !== testInfo.expectedStatus) {
        const urls = ctx.pages().map((p) => p.url()).join('\n');
        if (urls) await testInfo.attach('page-url', { body: urls, contentType: 'text/plain' });
      }
      if (keepsSession(await ctx.cookies())) await ctx.storageState({ path: file });
      await ctx.close();
    }
  },
});

export { expect };

/** Skip an `Auto-W` case unless writes are on (QA-owned disposable tenant only). */
export function requireWrites(denv: DesignEnv): void {
  test.skip(!denv.allowWrites, 'design-suite writes are off — set PQA_DESIGN_ALLOW_WRITES=true on a disposable tenant only');
}
