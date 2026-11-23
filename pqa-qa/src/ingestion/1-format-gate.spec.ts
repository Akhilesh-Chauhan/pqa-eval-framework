import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { notMeasured } from '../support/annotations.js';
import { loadGolden } from '../support/golden-manifest.js';
import type { GateResult } from '../support/ingestion-scoring.js';
import { classifyUpload, meets } from '../support/ingestion-http.js';
import { SETUPS, acceptMatches } from '../support/ingestion-setups.js';
import { applySetup, touchAdmin } from './admin-config.js';
import { test, expect } from './fixtures.js';
import { loadIngestEnv } from './ingest-env.js';
import { ROUTES, clearDocuments, stopIfExpired, upload } from './portal.js';
import * as store from './store.js';

// Spec §3.5 / §4.2.2: for each allowed-format setup P1–P4, save it through the Admin API, wait out the config
// caches, then upload every format case alone through both portal routes and check both upload pickers.
// Tests run in file order on one worker; a test whose setup is not live (its "apply" failed) skips.

const ienv = loadIngestEnv();
const golden = ienv.goldenDir ? loadGolden(ienv.goldenDir) : undefined;
const cases = golden?.rows.filter((r) => r.group === 'format') ?? [];
const WORD = { A: 'accept', R: 'refuse', Q: 'refuse or quarantine' } as const;
const live = (id: string) => store.get<{ id: string }>('setup')?.id === id;

test.describe('format gate', () => {
  test.skip(!ienv.allowWrites, 'writes to the shared environment are off — set PQA_ADMIN_ALLOW_WRITES=true');
  test.skip(!golden || !ienv.tenant, 'set PQA_GOLDEN_DIR and run npm run qa:ingest:provision first');

  SETUPS.forEach((setup, s) => {
    test(`format gate: apply ${setup.id} (${setup.types.join(', ')}; ${setup.maxMb} MB) and wait for the config caches`, async ({ page, portal }) => {
      stopIfExpired();
      store.put('format-started', { at: new Date().toISOString() });
      await clearDocuments(portal, ienv.portalUrl, ienv.tenant!);
      await applySetup(page, ienv.tenant!, setup);
    });

    ROUTES.forEach((route, r) => {
      test(`GI-PICK-0${s * 2 + r + 1} format gate ${setup.id} settings/${route} upload picker offers exactly ${setup.types.join(', ')}`, async ({ page, portalPage }) => {
        stopIfExpired();
        await touchAdmin(page);
        test.skip(!live(setup.id), `${setup.id} is not in effect — its "apply" test did not finish`);
        await portalPage.goto(`${ienv.portalUrl}/${ienv.tenant}/settings/${route}`);
        const input = portalPage.locator('input[type=file]').first();
        await expect(input).toBeAttached();
        const accept = (await input.getAttribute('accept')) ?? '';
        const m = acceptMatches(accept, setup);
        expect(m.ok, `accept="${accept}" — missing: ${m.missing.join(', ') || 'none'}; not allowed: ${m.extra.join(', ') || 'none'}`).toBe(true);
      });

      for (const c of cases) {
        const want = c.format_case!.expect[setup.id];
        const mime = c.format_case!.declared_mime;
        test(`${c.id} format gate ${setup.id} ${route}: ${c.upload_name} (${mime ?? 'no MIME'}, ${c.bytes} bytes) → ${WORD[want]}`, async ({ page, portal }, testInfo) => {
          stopIfExpired();
          await touchAdmin(page);
          test.skip(!live(setup.id), `${setup.id} is not in effect — its "apply" test did not finish`);
          const data = readFileSync(join(golden!.dir, c.file));
          const res = await upload(portal, ienv.portalUrl, ienv.tenant!, route, [{ filename: c.upload_name, mime: mime ?? undefined, data }]);
          const { outcome, detail } = classifyUpload(res.status, res.body);
          // Settings → Ingestion keeps a cleared file's fingerprint (22 Oct): a duplicate says nothing about the policy.
          if (outcome === 'duplicate') return notMeasured(testInfo, { tracker: 'ingestion-dedup-after-clear', owner: 'dev', detail: `${route}: same bytes already ingested; Clear All Documents does not reset it` });
          store.put(`gate-${setup.id}-${route}-${c.id}`, { id: c.id, setup: setup.id, route, expect: want, outcome } satisfies GateResult);
          // The next case may send the same bytes; unless the file was refused outright (an error or a timeout may still
          // have indexed it), clear, or the next upload would come back "duplicate".
          if (outcome !== 'refuse') await clearDocuments(portal, ienv.portalUrl, ienv.tenant!);
          await testInfo.attach('outcome', { body: JSON.stringify({ status: res.status, outcome, detail }, null, 2), contentType: 'application/json' });
          expect(meets(want, outcome), `expected ${WORD[want]}, got ${outcome} (${detail})`).toBe(true);
        });
      }
    });
  });
});
