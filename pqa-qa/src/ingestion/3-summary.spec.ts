import { loadGolden } from '../support/golden-manifest.js';
import { summarize } from '../support/ingestion-scoring.js';
import type { CatResult, FieldScore, GateResult } from '../support/ingestion-scoring.js';
import type { StoredCat } from './2-category.spec.js';
import { test } from './fixtures.js';
import { loadIngestEnv } from './ingest-env.js';
import * as store from './store.js';

// Spec §6: everything this run measured, as reports/<run>/ingestion-summary.json (the HTML reporter files the
// attachment). The title names both phases so `--grep format` and `--grep category` both keep it.
const ienv = loadIngestEnv();
const golden = ienv.goldenDir ? loadGolden(ienv.goldenDir) : undefined;

test('summary of this run (format gate, category, metadata) → ingestion-summary.json', async ({}, testInfo) => {
  test.skip(!golden, 'set PQA_GOLDEN_DIR');
  const gate = store.list<GateResult>('gate-');
  const cat: CatResult[] = golden!.rows
    .filter((r) => r.group === 'category')
    .flatMap((r) => {
      const got = store.get<StoredCat>(`cat-${r.id}`);
      if (!got) return [];
      return [{
        id: r.id, user_category: r.user_category, expected_type: r.expected_type,
        actual_type: got.classification?.document_type ?? (got.metadata?.document_type as string | undefined),
        confidence: got.classification?.confidence, outcome: got.outcome, truth_status: r.truth_status,
        fields: store.get<FieldScore[]>(`fields-${r.id}`) ?? [],
      }];
    });
  const summary = { dataset: golden!.version, tenant: ienv.tenant, platform: ienv.portalUrl, runId: process.env.PQA_RUN_ID, finished: new Date().toISOString(), ...summarize(gate, cat), files: cat };
  await testInfo.attach('ingestion-summary', { body: JSON.stringify(summary, null, 2), contentType: 'application/json' });
  console.log(`ingestion summary: format gate ${summary.gate.correct}/${summary.gate.checks} correct, ${summary.gate.falseAccepts} false accepts; ` +
    `category accuracy ${summary.category.accuracy ?? 'n/a'} over ${summary.category.accepted} files; metadata field accuracy ${summary.metadata.fieldAccuracy ?? 'n/a'}`);
});
