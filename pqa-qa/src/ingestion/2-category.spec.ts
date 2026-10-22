import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { notMeasured } from '../support/annotations.js';
import { categoryRows, loadGolden } from '../support/golden-manifest.js';
import { classifyItem, matchResults } from '../support/ingestion-http.js';
import type { Outcome } from '../support/ingestion-http.js';
import { scoreField } from '../support/ingestion-scoring.js';
import { SETUPS } from '../support/ingestion-setups.js';
import { applySetup, touchAdmin } from './admin-config.js';
import { test, expect } from './fixtures.js';
import { loadIngestEnv } from './ingest-env.js';
import { clearDocuments, stopIfExpired, upload } from './portal.js';
import * as store from './store.js';

// Spec §4.2.3 and §5: under P1, ingest the 89 category PDFs (or only the PQA_INGEST_CATEGORY ones) through
// Settings → Ingestion in batches of 5, then judge each file: type always, metadata when its truth is verified.
// A batch never fails the run: after one retry its files are "not measured".

export interface StoredCat {
  outcome: Outcome;
  detail: string;
  classification: { document_type?: string; confidence?: number } | null;
  metadata: Record<string, unknown> | null;
}

const ienv = loadIngestEnv();
const golden = ienv.goldenDir ? loadGolden(ienv.goldenDir) : undefined;
const rows = golden ? categoryRows(golden, ienv.categories) : [];
const batches = Array.from({ length: Math.ceil(rows.length / 5) }, (_, i) => rows.slice(i * 5, i * 5 + 5));

test.describe('category and metadata', () => {
  test.skip(!ienv.allowWrites, 'writes to the shared environment are off — set PQA_ADMIN_ALLOW_WRITES=true');
  test.skip(!golden || !ienv.tenant, 'set PQA_GOLDEN_DIR and run npm run qa:ingest:provision first');

  test('category: make P1 live (wait for the caches if it is not) and clear the documents', async ({ page, portal }) => {
    stopIfExpired();
    store.put('category-started', { at: new Date().toISOString() });
    if (store.get<{ id: string }>('setup')?.id !== 'P1') await applySetup(page, ienv.tenant!, SETUPS[0]!);
    await clearDocuments(portal, ienv.portalUrl, ienv.tenant!);
    store.put('category-ready', { at: new Date().toISOString() });
  });

  batches.forEach((batch, k) => {
    test(`category: ingest batch ${k + 1} of ${batches.length} (${batch.map((r) => r.id).join(', ')})`, async ({ page, portal }, testInfo) => {
      stopIfExpired();
      test.skip(!store.get('category-ready'), 'the P1 set-up test did not finish');
      test.setTimeout(2 * 330_000 + 120_000); // the route may take its full 300 s, twice
      await touchAdmin(page);
      const files = batch.map((r) => ({ filename: r.upload_name, mime: 'application/pdf', data: readFileSync(join(golden!.dir, r.file)) }));
      // KB Docs ("Ingest documents"), the user-facing upload: after Clear All Documents a file is accepted again there,
      // while Settings → Ingestion keeps calling it a duplicate (22 Oct).
      let res = await upload(portal, ienv.portalUrl, ienv.tenant!, 'file-ingestions', files);
      if (res.status >= 500 || res.status === 0) res = await upload(portal, ienv.portalUrl, ienv.tenant!, 'file-ingestions', files);
      const items: any[] = Array.isArray(res.body?.results) ? res.body.results : [];
      const matched = matchResults(batch.map((r) => r.upload_name), items);
      for (const [i, r] of batch.entries()) {
        const item = matched[i];
        const judged = res.status >= 200 && res.status < 300 && item ? classifyItem(item) : { outcome: 'error' as const, detail: `batch answered ${res.status} after one retry` };
        store.put(`cat-${r.id}`, { ...judged, classification: item?.classification ?? null, metadata: item?.pq_metadata ?? null } satisfies StoredCat);
      }
      await testInfo.attach('batch', {
        body: JSON.stringify({ status: res.status, results: items.map((i) => ({ filename: i?.filename, status: i?.status, classification: i?.classification, error: i?.error })) }, null, 2),
        contentType: 'application/json',
      });
    });

    for (const r of batch) {
      test(`${r.id} category ${r.user_category} → ${r.expected_type}${r.truth_status === 'verified' ? ' + metadata' : ''}: ${r.upload_name}`, async ({}, testInfo) => {
        const got = store.get<StoredCat>(`cat-${r.id}`);
        if (!got || got.outcome === 'error' || got.outcome === 'duplicate') {
          notMeasured(testInfo, { tracker: 'golden-ingestion', owner: 'QA', detail: got?.detail ?? 'its batch did not run' });
          return;
        }
        if (r.not_captured.length) testInfo.annotations.push({ type: 'note', description: `Not captured by the classifier, not scored: ${r.not_captured.join(', ')}` });
        expect(got.outcome, `not ingested: ${got.detail}`).toBe('accept');
        const actual = got.classification?.document_type ?? (got.metadata?.document_type as string | undefined);
        expect.soft(actual, `classified as ${actual} (confidence ${got.classification?.confidence ?? '?'})`).toBe(r.expected_type);
        if (r.truth_status !== 'verified') {
          testInfo.annotations.push({ type: 'note', description: `Metadata not scored: its expected values are ${r.truth_status === 'draft' ? 'a draft awaiting review' : 'not written yet'}` });
          return;
        }
        const fields = Object.entries(r.expected_metadata).map(([field, value]) => scoreField(field, value, got.metadata ?? {}));
        store.put(`fields-${r.id}`, fields);
        await testInfo.attach('metadata-scores', { body: JSON.stringify(fields, null, 2), contentType: 'application/json' });
        for (const f of fields) if (f.pass === false) expect.soft(f.actual, `${f.field} (${f.kind} rule, score ${f.score})`).toBe(f.expected);
      });
    }
  });
});
