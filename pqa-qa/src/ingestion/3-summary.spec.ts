import { categoryRows, loadGolden } from '../support/golden-manifest.js';
import { summarize, withUnrecorded } from '../support/ingestion-scoring.js';
import { SETUPS } from '../support/ingestion-setups.js';
import type { CatResult, FieldScore, GateResult } from '../support/ingestion-scoring.js';
import type { StoredCat } from './2-category.spec.js';
import { test } from './fixtures.js';
import { loadIngestEnv } from './ingest-env.js';
import { ROUTES } from './portal.js';
import * as store from './store.js';

// Spec §6: everything this run measured, as reports/<run>/ingestion-summary.json (the HTML reporter files the
// attachment). The title names both phases so `--grep format` and `--grep category` both keep it.
const ienv = loadIngestEnv();
const golden = ienv.goldenDir ? loadGolden(ienv.goldenDir) : undefined;

test('summary of this run (format gate, category, metadata) → ingestion-summary.json', async ({}, testInfo) => {
  test.skip(!golden, 'set PQA_GOLDEN_DIR');
  const gate = store.list<GateResult>('gate-');
  const rows = categoryRows(golden!, ienv.categories);
  const recorded: CatResult[] = rows
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
  // A phase that started accounts for every file and check it set out to cover, recorded or not.
  const cat = store.get('category-started') ? withUnrecorded(recorded, rows) : recorded;
  const formatCases = golden!.rows.filter((r) => r.group === 'format').length;
  const expectedChecks = store.get('format-started') ? SETUPS.length * ROUTES.length * formatCases : gate.length;
  // shortcut: the LLM is the one in .env now, assumed unchanged since provisioning; read it from the tenant once the
  // admin API returns it. The key is never recorded. Kept so on-prem and AWS runs can be compared later.
  const llm = ienv.llm && { model: ienv.llm.model, embeddingModel: ienv.llm.embeddingModel };
  const summary = { dataset: golden!.version, categories: ienv.categories ?? 'all', tenant: ienv.tenant, llm, platform: ienv.portalUrl, runId: process.env.PQA_RUN_ID, finished: new Date().toISOString(), ...summarize(gate, cat, expectedChecks), files: cat };
  await testInfo.attach('ingestion-summary', { body: JSON.stringify(summary, null, 2), contentType: 'application/json' });
  console.log(`ingestion summary: format gate ${summary.gate.correct}/${summary.gate.checks} correct, ${summary.gate.falseAccepts} false accepts; ` +
    `category accuracy ${summary.category.accuracy ?? 'n/a'} over ${summary.category.accepted} files; metadata field accuracy ${summary.metadata.fieldAccuracy ?? 'n/a'}`);
  for (const [name, b] of Object.entries(summary.category.byCategory))
    console.log(`  ${name}: type ${b.correct}/${b.files} correct; metadata fields ${b.fieldsPassed}/${b.fieldsChecked} match`);
});
