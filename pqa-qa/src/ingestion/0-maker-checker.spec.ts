import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { categoryRows, loadGolden } from '../support/golden-manifest.js';
import { notMeasured } from '../support/annotations.js';
import { classifyUpload } from '../support/ingestion-http.js';
import { test, expect } from './fixtures.js';
import { loadIngestEnv } from './ingest-env.js';
import { ROUTES, clearDocuments, stopIfExpired, upload } from './portal.js';

// spec §8.8 and intent "No single-person ingestion" (21 Oct docs): a document enters the knowledge base only when a
// second person accepts it. So one PDF sent straight to either portal batch route must not come back ingested.
// components B14 still says /settings/ingestion "works": a failure on that route means the documents disagree.
// DEFERRED 22 Oct: the team is removing maker-checker from KB Docs for the demo (the maker could pick himself as the
// checker), so single-person upload is the intended behaviour on that build. Re-enable when maker-checker returns.
const DEFERRED = { tracker: 'deferred-maker-checker', owner: 'dev', detail: 'maker-checker removed from KB Docs for the 22 Oct demo build' };
const ienv = loadIngestEnv();
const golden = ienv.goldenDir ? loadGolden(ienv.goldenDir) : undefined;
const pdf = golden ? categoryRows(golden)[0] : undefined;

test.describe('maker-checker', () => {
  test.skip(!ienv.allowWrites, 'writes to the shared environment are off — set PQA_ADMIN_ALLOW_WRITES=true');
  test.skip(!pdf || !ienv.tenant, 'set PQA_GOLDEN_DIR and run npm run qa:ingest:provision first');

  ROUTES.forEach((route, i) => {
    test(`GI-MC-0${i + 1} maker-checker: one PDF sent straight to ${route}/batch is not ingested without a checker`, async ({ portal }, testInfo) => {
      notMeasured(testInfo, DEFERRED);
      stopIfExpired();
      const data = readFileSync(join(golden!.dir, pdf!.file));
      const res = await upload(portal, ienv.portalUrl, ienv.tenant!, route, [{ filename: pdf!.upload_name, mime: 'application/pdf', data }]);
      const { outcome, detail } = classifyUpload(res.status, res.body);
      if (outcome !== 'refuse') await clearDocuments(portal, ienv.portalUrl, ienv.tenant!);
      await testInfo.attach('outcome', { body: JSON.stringify({ status: res.status, outcome, detail }, null, 2), contentType: 'application/json' });
      expect(outcome, `a single-person upload came back ${outcome} (${detail})`).not.toBe('accept');
    });
  });
});
