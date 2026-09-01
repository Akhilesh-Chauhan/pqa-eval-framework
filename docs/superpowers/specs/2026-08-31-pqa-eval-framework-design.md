# PQA Evaluation Framework — Design

**Date:** 2026-08-31
**Status:** Approved for implementation
**Owner:** NeGD PQA Platform engineering
**Scope:** A production-grade, multi-tenant LLM evaluation framework for the Parliament Chatbot Common Platform (PQA), built on DeepEval as the primary framework with RAGAS as the complementary RAG metrics library.

---

## 1. Purpose

PQA drafts Parliamentary Question (PQ) answers using RAG over a per-tenant knowledge base. The AI is an accelerator; every draft is human-reviewed before it becomes an official answer. This framework measures whether those drafts are safe to put in front of a reviewer, and blocks releases that regress.

It answers four questions on every run:

1. Is the draft **grounded** in this tenant's knowledge base?
2. Does it **answer every sub-part** of the PQ?
3. Did **private-source content leak** without an explicit promote-to-public acknowledgement?
4. Did **retrieved text act as instructions** rather than data?

Questions 3 and 4 are safety invariants from the product spec. They are enforced deterministically and carry veto power over a sample's result.

## 2. Product invariants this design is bound by

Taken directly from `docs/product.md` — the internal PQA product spec, which is deliberately **not committed to this repository** (see `.gitignore`); obtain it from the internal platform repo. The invariants it defines are restated in full below, so this design stands on its own.

- Ministry data, KB, search index, storage, users, and audit logs are strictly isolated per tenant. No cross-tenant read or write.
- Human review is required before any AI-generated draft becomes an official answer.
- Private external-source content does not appear in a final answer without an explicit "promote to public" acknowledgement.
- Retrieved document text is treated as data, never as instructions to the LLM.
- The Commerce tenant is the reference implementation and must not regress.
- All hosting is on India-aligned government cloud infrastructure.
- Ministry-specific behaviour lives in configuration, not code.

The last two shape the framework directly: the judge model is **AWS Bedrock in `ap-south-1`** (not OpenAI), and per-tenant differences — thresholds, budgets, terminology, style — live in YAML under `config/tenants/`, never in Python.

## 3. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Judge / evaluator LLM | AWS Bedrock, `ap-south-1` | India-aligned gov cloud invariant. Matches existing DoE Chatbot RAGAS pipeline. Requires a custom `DeepEvalBaseLLM` adapter since DeepEval defaults to OpenAI. |
| System-under-test access | Dual: `StaticFixtureClient` + `HttpPQAClient` behind one ABC | Static gives deterministic, cheap, offline CI. Live enables real regression and sampling-variance testing. Chosen via config, not code change. |
| Tenant isolation | Fail-closed runtime guard (`TenantContext`) | Isolation becomes an architectural property, not a convention. Cross-tenant access raises rather than silently succeeding. |
| Metric implementation | Tiered by failure mode: deterministic / DAG / GEval | Safety invariants must not be probabilistic. Judgement calls should not be forced into decision trees. |
| Pass/fail composition | Per-metric threshold AND composite floor, with Tier 0 veto | A weighted average alone lets an ungrounded answer pass on the strength of its style score. |

### 3.1 Rejected alternatives

- **GEval for every custom metric.** Fastest to write and uniformly explainable, but makes Private Source Guard and Prompt Injection Resistance probabilistic. A safety invariant that fails a small percentage of the time is not an invariant.
- **DAG for every custom metric.** Deterministic and auditable, but enormously verbose for metrics like terminology adherence whose entire judgement is holistic and has no useful decomposition.
- **Live-only evaluation.** Truest signal, but makes CI slow, costly, non-deterministic, and dependent on a running stack. Retained as an option, not the default.
- **Directory-convention-only tenant isolation.** Simpler, but relies on every future contributor remembering the convention. Rejected against an explicit product invariant.

## 4. Architecture

### 4.1 Directory structure

```
pqa-eval/
├── README.md
├── pyproject.toml
├── requirements.txt
├── Makefile
├── .env.example
├── .github/workflows/eval.yml
├── .gitlab-ci.yml
│
├── src/pqa_eval/
│   ├── config/
│   │   ├── settings.py            # env-driven global settings
│   │   ├── tenant_config.py       # TenantConfig model + YAML loader
│   │   ├── thresholds.py          # default -> tenant -> env override resolution
│   │   └── tenants/
│   │       ├── _defaults.yaml
│   │       ├── _template.yaml
│   │       └── commerce.yaml
│   │
│   ├── core/
│   │   ├── tenant_context.py      # fail-closed isolation guard
│   │   ├── exceptions.py
│   │   ├── run_manifest.py        # run identity & provenance
│   │   └── logging.py             # tenant-tagged logs, private-span redaction
│   │
│   ├── providers/
│   │   ├── base.py
│   │   ├── bedrock.py             # BedrockJudge(DeepEvalBaseLLM), BedrockEmbeddings
│   │   ├── ragas_adapter.py       # same client -> RAGAS wrappers
│   │   └── registry.py            # bedrock | openai | ollama
│   │
│   ├── schema/
│   │   ├── golden.py              # PQAGoldenSample
│   │   ├── citation.py            # Citation, SourceVisibility
│   │   └── enums.py               # QuestionType, House, RetrievalMode
│   │
│   ├── datasets/
│   │   ├── loader.py              # tenant-scoped json/csv/parquet loader
│   │   ├── registry.py            # versions, manifests, sha256 integrity
│   │   ├── converters.py          # golden -> LLMTestCase
│   │   └── synthetic/
│   │       ├── generator.py
│   │       ├── injection_payloads.py
│   │       └── adversarial.py
│   │
│   ├── clients/
│   │   ├── base.py                # PQADraftClient ABC -> DraftResult
│   │   ├── static.py
│   │   └── http.py
│   │
│   ├── metrics/
│   │   ├── base.py                # PQABaseMetric: tier, veto, tenant threshold
│   │   ├── tiers.py
│   │   ├── deterministic/         # Tier 0
│   │   ├── dag/                   # Tier 1
│   │   ├── geval/                 # Tier 2
│   │   ├── ragas_wrappers.py
│   │   └── catalogue.py
│   │
│   ├── evaluators/
│   │   ├── runner.py              # tier ordering, veto short-circuit, aggregation
│   │   ├── end_to_end.py
│   │   ├── component.py
│   │   └── stability.py           # N-run variance harness
│   │
│   ├── reports/
│   │   ├── models.py
│   │   ├── json_report.py
│   │   ├── markdown_report.py
│   │   ├── html_report.py
│   │   └── drift.py
│   │
│   └── cli.py
│
├── data/tenants/<tenant>/goldens/<version>/
│       ├── manifest.json
│       ├── golden_set.json
│       └── adversarial.json
│
├── tests/
│   ├── conftest.py
│   ├── test_happy_path.py
│   ├── test_tenant_isolation.py
│   ├── test_commerce_regression.py
│   ├── edge_cases/
│   └── metrics/
│
└── runs/                          # gitignored run artifacts
```

### 4.2 Module boundaries

- **`core/tenant_context.py` is the choke point.** `datasets`, `metrics`, `clients`, and `reports` all require an active `TenantContext`. There is no code path that loads a golden, scores a sample, or writes a report without passing through it.
- **`providers/` is shared by both frameworks.** One Bedrock client, two adapters. A RAGAS Faithfulness score and a DeepEval GEval score in the same run come from the same judge model at the same temperature, so disagreements between them are signal rather than noise.
- **`tests/metrics/` tests the metrics; `tests/edge_cases/` tests the system.** Metric unit tests use hand-built test cases and a stubbed judge — no Bedrock calls, millisecond runtime — and are what prevent a refactor from silently breaking Private Source Guard.

## 5. Data model

### 5.1 `PQAGoldenSample`

Strict pydantic model (`extra="forbid"`, frozen), so a malformed golden fails at load rather than producing a misleading score.

Fields, grouped:

**Identity & isolation** — `sample_id`, `tenant_id`.

**The question** — `question` (full PQ text including sub-parts), `sub_questions`, `question_type` (`STARRED` / `UNSTARRED` / `SHORT_NOTICE`), `clubbed_with`, `transferred_from`.

`sub_questions` is **authoritative when present** and is human-curated, not derived. `SubQuestionCompleteness` uses it as the expected set and does not re-parse the question. When it is absent (older or bulk-imported goldens), the metric falls back to parsing the question text and records `sub_questions_inferred: true` on the result so a reviewer knows the expected set was machine-derived. Parsing lettered parts out of real PQ text is unreliable enough — nested romans, annexure references, `(a) and (b) together` — that a silently inferred set must never be mistaken for a curated one.

**Ground truth** — `expected_answer` (human-verified official reply), `expected_citations`, `expected_refusal` (true when the correct behaviour is to decline).

**Retrieval** — `retrieved_contexts` (`None` means re-retrieve live), `retrieval_mode` (`STATIC` / `LIVE`).

**Private-source safeguards** — `is_private_source_used`, `promote_to_public_acknowledged`, `private_spans`.

**Metadata** — `PQMetadata`: house, session, question number, diary number, subject, department, minister, date, annexure refs, language.

**Conversation** — `conversation_history: list[ConversationTurn]` (default empty). A `ConversationTurn` is `{role, content, citations}`. `ConversationConsistency` runs only when this is non-empty and exits deterministically as *not applicable* otherwise; the converter maps a sample with history to a DeepEval `ConversationalTestCase` instead of a plain `LLMTestCase`.

**Evaluation control** — `tags`, `expected_failure_metrics`.

Two fields carry non-obvious weight:

- **`private_spans`** is what makes Private Source Guard deterministic. We do not ask an LLM whether private content leaked; we normalise and match known private spans against the draft. If private source was used, promotion was not acknowledged, and a span appears — hard fail, no LLM involved.
- **`expected_failure_metrics`** inverts scoring for adversarial goldens. A prompt-injection sample is not scored "did the model do well" but "did our detector correctly fire". Without it, a broken detector looks like a passing suite. This is how the framework stays honest about itself.

### 5.2 Supporting models

```python
class SourceVisibility(str, Enum):
    PUBLIC  = "public"     # tenant KB or approved public external source
    PRIVATE = "private"    # private external source, gated

class Citation(BaseModel):
    citation_id: str
    source_ref: str
    visibility: SourceVisibility
    quoted_span: str | None
    context_index: int | None

class RetrievedContext(BaseModel):
    text: str
    doc_id: str
    visibility: SourceVisibility
    score: float | None
    is_annexure: bool = False
```

`visibility` lives on `RetrievedContext`, not only on `Citation`. Without it, Private Source Guard cannot tell which retrieved chunk was the private one.

### 5.3 `DraftResult` — what the system under test returns

Both clients (`StaticFixtureClient` and `HttpPQAClient`) return the same shape, so metrics never know or care which mode produced the draft:

```python
class DraftResult(BaseModel):
    sample_id: str
    tenant_id: str                       # checked against active TenantContext
    answer: str                          # the AI draft under evaluation
    citations: list[Citation]            # as emitted by the system
    retrieved_contexts: list[RetrievedContext]  # as actually retrieved (live mode)
    latency_ms: int | None               # measured by HttpPQAClient; carried
    input_tokens: int | None             #   from the capture file in static mode
    output_tokens: int | None
    model_version: str
    prompt_version: str
```

`BudgetCompliance` consumes `latency_ms` and token counts from here — the eval framework never measures the system itself in static mode, it trusts the capture. When these fields are `None` (older captures), `BudgetCompliance` reports *not measurable* rather than passing silently.

### 5.4 Capture store — where actual outputs live in offline mode

Goldens are stable across system versions; the drafts under test are not. Mixing them would mean editing golden files on every model or prompt change, which destroys the versioning guarantee. So captures live in a parallel, versioned store:

```
data/tenants/<tenant>/captures/<model_version>__<prompt_version>/
├── manifest.json        # model_version, prompt_version, capture date,
│                        #   golden dataset version it was captured against, sha256
└── responses.json       # list[DraftResult], keyed by sample_id
```

`StaticFixtureClient` is constructed with a capture id, verifies the manifest's golden-dataset version matches the loaded goldens (a capture taken against goldens v1.0.0 cannot silently score against v1.1.0), and serves `DraftResult`s by `sample_id`. A sample with no capture entry is reported as *not evaluated* — never skipped silently, never zero-scored.

A small export script (documented in the README, analogous to the DoE pipeline's capture step) calls the tenant's AI service once per golden and writes a capture; CI then replays it deterministically.

## 6. Tenant isolation

`TenantContext` is a `ContextVar`-scoped guard, entered with `with TenantContext(tenant_id): ...`.

- `TenantContext.current()` raises `NoTenantContextError` when no context is active.
- `assert_owns(obj_tenant_id, what=...)` raises `CrossTenantViolation` on mismatch.

Enforcement points:

| Point | Guard |
|---|---|
| `datasets/loader.py` | Path derived from `current().tenant_id`, never from an argument. Every sample's `tenant_id` is checked. One foreign sample aborts the load. |
| `datasets/registry.py` | Version manifests resolve under the tenant root only. Path traversal rejected. |
| `metrics/base.py` | Thresholds resolved from `current()`. A metric cannot be constructed against another tenant's config. |
| `clients/http.py` | Endpoint and auth from active tenant config. Refuses if the response echoes a different tenant id. |
| `reports/*` | Output path is `runs/<tenant_id>/<run_id>/`. A report containing mixed tenant ids raises before serialisation. |
| `evaluators/runner.py` | Exactly one context per run. `--all` runs tenants sequentially in separate contexts, never interleaved. |

`ContextVar` keeps this correct under the thread pools used for concurrency within a tenant. Cross-tenant parallelism is deliberately not offered: sequential execution removes the entire class of interleaving bug rather than attempting to be careful about it.

## 7. Metrics

### 7.0 Traceability to the required custom metrics

Ten custom metrics were required. Eleven are implemented, because requirement 2 (Citation Quality & Provenance) splits cleanly along the deterministic/judgemental line and is far stronger as two metrics than one.

| Required | Implemented as | Tier |
|---|---|---|
| 1. Sub-Question Completeness | `SubQuestionCompleteness` | 1 |
| 2. Citation Quality & Provenance | `CitationExistence` (does the citation resolve?) **+** `CitationQuality` (is it the right citation, correctly labelled?) | 0 + 2 |
| 3. Private Source Guard | `PrivateSourceGuard` | 0 |
| 4. Prompt Injection Resistance | `PromptInjectionResistance` | 1 |
| 5. Annexure / Structured Data Fidelity | `AnnexureFidelity` | 1 |
| 6. Terminology & Style Adherence | `TerminologyStyleAdherence` | 2 |
| 7. No Extraneous Speculation | `NoExtraneousSpeculation` | 2 |
| 8. Empty / Low-Relevance Retrieval Handling | `EmptyRetrievalHandling` | 1 |
| 9. Multi-turn / Conversation Consistency | `ConversationConsistency` | 2 |
| 10. Latency & Token Budget Awareness | `BudgetCompliance` | 0 |

The split of requirement 2 is the one deviation from the literal ask. The reason: "citation 7 does not exist in the retrieved set" is a fact checkable in microseconds with no LLM and no variance, and it is the failure mode that matters most (a hallucinated citation that looks real). Folding it into an LLM-judged quality score would make a hard invariant probabilistic and would let a fabricated citation be averaged away by good prose.

### 7.1 Tier 0 — deterministic, no LLM, veto power

| Metric | Assertion | Fails when |
|---|---|---|
| `PrivateSourceGuard` | Normalised `private_spans` absent from the draft unless promoted | Private source used, promotion not acknowledged, span present in draft |
| `CitationExistence` | Every cited `citation_id` resolves into the retrieved set | Citation invented or malformed |
| `BudgetCompliance` | Latency and token count within tenant budget | Budget breached (scored; non-veto by default) |

Tier 0 runs first. Any veto failure fails the sample immediately, records the reason, and skips all remaining tiers. This is both a cost lever and a correctness statement: safety invariants veto a result, they are not averaged into it.

### 7.2 Tier 1 — DAG: deterministic gates, narrow LLM leaves

| Metric | Deterministic gate | LLM leaf judges |
|---|---|---|
| `SubQuestionCompleteness` | Parse `(a)`…`(z)`, `(aa)`… and count parts | Per part: answered / partially answered / not addressed |
| `PromptInjectionResistance` | Detect injection payload present in contexts | Did the draft comply with the injected instruction? |
| `AnnexureFidelity` | Extract numerics and table cells from annexure contexts | Are figures reproduced faithfully and correctly cited? |
| `EmptyRetrievalHandling` | Is retrieval empty or entirely below the relevance floor? | Did the draft refuse cleanly rather than hallucinate? |

The gate is not only an optimisation. `EmptyRetrievalHandling` on a sample with rich retrieval exits deterministically as *not applicable* — no Bedrock call, and no LLM invited to form an opinion about a question that was not asked.

### 7.3 Tier 2 — GEval: judgement with reasoning

`CitationQuality` · `TerminologyStyleAdherence` · `NoExtraneousSpeculation` · `ConversationConsistency`

Each returns a score and a `reason` string. The reason is the deliverable for the human debugging a failure and is surfaced verbatim in the Markdown and HTML reports.

### 7.4 Standard RAG metrics

Six mandatory RAG metrics, sourced from whichever library implements them properly. Which library provides which matters for implementation, so it is stated explicitly:

| Metric | Library | Concrete class |
|---|---|---|
| Faithfulness / Groundedness | RAGAS | `Faithfulness` |
| Answer Relevancy | RAGAS | `ResponseRelevancy` |
| Context Precision | RAGAS | `LLMContextPrecisionWithReference` |
| Context Recall | RAGAS | `LLMContextRecall` |
| Context Utilization | RAGAS | `ContextUtilization` — in newer ragas releases this is `LLMContextPrecisionWithoutReference`; the wrapper imports whichever the pinned version exposes and normalises the name, so reports always say `context_utilization` |
| Contextual Relevancy | DeepEval | `ContextualRelevancyMetric` |
| Hallucination rate | DeepEval | `HallucinationMetric` |

The RAGAS ones are wrapped as DeepEval `BaseMetric` subclasses (`metrics/ragas_wrappers.py`) so both libraries compose inside a single suite and a single test case. The wrapper is responsible for translating a DeepEval `LLMTestCase` into a RAGAS `SingleTurnSample`, invoking the metric with the shared Bedrock judge, and surfacing NaN as an explicit error state rather than a zero score.

Note that Faithfulness (RAGAS) and Hallucination (DeepEval) overlap deliberately. They disagree in useful ways — RAGAS decomposes the answer into claims and verifies each against the context, DeepEval judges contradiction against context wholesale. Divergence between them on a sample is a strong signal for human review, which is why both are retained rather than deduplicated.

### 7.5 Result composition

```
1. Run Tier 0. Any veto metric fails -> sample FAILS. Stop, record reason.
2. Run Tier 1 + Tier 2 + RAGAS (parallel within the sample).
3. Composite = weighted mean of non-veto metrics.
4. Sample passes iff every metric >= its tenant threshold
                   AND composite >= tenant composite floor.
```

Step 4 is a conjunction, not a composite alone. A draft scoring 0.95 composite while failing Faithfulness at 0.4 is a failure. Averaging is precisely how ungrounded answers pass a green dashboard. The composite exists for trend-tracking and drift detection, not for pass/fail.

For adversarial goldens, `expected_failure_metrics` inverts the rule: the sample passes if and only if the named metrics fired.

## 8. Edge cases

All twenty are covered by a dedicated test.

| # | Edge case | Test | Primary assertion |
|---|---|---|---|
| 1 | Empty retrieval | `test_ec01_empty_retrieval.py` | `EmptyRetrievalHandling`, `expected_refusal` |
| 2 | Partial retrieval | `test_ec02_partial_retrieval.py` | `SubQuestionCompleteness`, `Faithfulness` |
| 3 | High-noise context | `test_ec03_noisy_context.py` | `ContextPrecision`, `NoExtraneousSpeculation` |
| 4 | Injection in documents or annexures | `test_ec04_prompt_injection.py` | `PromptInjectionResistance` |
| 5 | Private source used, not promoted | `test_ec05_private_unpromoted.py` | `PrivateSourceGuard` (veto) |
| 6 | Private source correctly promoted | `test_ec06_private_promoted.py` | Guard passes, `CitationQuality` labels correctly |
| 7 | Conflicting documents | `test_ec07_conflicting_sources.py` | `Faithfulness`, `NoExtraneousSpeculation` |
| 8 | Very long PQ, many sub-questions | `test_ec08_many_subquestions.py` | `SubQuestionCompleteness` |
| 9 | Tables and annexure data | `test_ec09_annexure_data.py` | `AnnexureFidelity` |
| 10 | Clubbed and transferred questions | `test_ec10_clubbed_transferred.py` | `SubQuestionCompleteness` across the clubbed set |
| 11 | Starred / Unstarred / Short Notice | `test_ec11_question_types.py` | `TerminologyStyleAdherence`, per-type rubric |
| 12 | Multilingual terms | `test_ec12_multilingual.py` | `TerminologyStyleAdherence`, `Faithfulness` |
| 13 | Near context-window limit | `test_ec13_context_window.py` | Graceful degradation, no silent truncation |
| 14 | Sampling variance | `test_ec14_stability.py` | N runs, standard deviation within tenant bound |
| 15 | Cross-tenant contamination | `test_tenant_isolation.py` | `CrossTenantViolation` raised |
| 16 | Malformed citations | `test_ec16_malformed_citations.py` | `CitationExistence` (veto) |
| 17 | Hallucinated citations | `test_ec17_hallucinated_citations.py` | `CitationExistence` (veto) |
| 18 | True but ungrounded | `test_ec18_true_but_ungrounded.py` | `Faithfulness` must fail |
| 19 | Correct but wrong terminology | `test_ec19_terminology_drift.py` | `TerminologyStyleAdherence` |
| 20 | Commerce regression | `test_commerce_regression.py` | Full suite against pinned baseline |
| +1 | Multi-turn contradiction (beyond the required 20) | `test_ec21_multiturn_consistency.py` | `ConversationConsistency` |

EC21 is added beyond the required twenty because custom metric 9 (`ConversationConsistency`) would otherwise ship without a test that exercises it: a drafter asks a follow-up, and the new draft contradicts a grounded statement from an earlier turn.

On EC14 specifically: with the static client, N runs produce the identical draft, so what varies is the **judge**, not the generator. The stability harness therefore measures two different things and reports them separately — *judge-score variance* on a fixed draft (static client, always available, bounds Tier 2/RAGAS flakiness) and *generation variance* across N live drafts of the same PQ (requires `HttpPQAClient`; skipped with an explicit `skip` reason when no live endpoint is configured, never silently passed).

Two of these warrant explicit documentation for reviewers:

- **EC18** — an answer that is factually correct by general knowledge but unsupported by the tenant KB **must fail** faithfulness. This is counter-intuitive and will be argued about; the README states it plainly.
- **EC20** — Commerce regression is wired as a session-scoped autouse guard. If Commerce regresses against its pinned baseline, the entire pytest session fails, including other tenants' passing runs. Per the invariant, this is a stop-the-line event, not one failure among many.

## 9. Datasets

Goldens live at `data/tenants/<tenant>/goldens/<version>/`, each version carrying `manifest.json` (version, sha256, sample count, provenance, author, date), `golden_set.json`, and `adversarial.json`.

Versioning is explicit and immutable: a new version is a new directory. The manifest sha256 is verified at load, so a silently edited golden set fails rather than quietly shifting the baseline.

Synthetic adversarial generation (`datasets/synthetic/`) produces, from a seed golden: prompt-injection variants drawn from a curated payload corpus, empty-retrieval variants, private-leak variants, partial-sub-question variants, noise-injected variants, and conflicting-source variants. Generated samples are written with `expected_failure_metrics` populated so they self-describe what should fire.

## 10. Run identity, reporting, and CI

Every run emits a `RunManifest`: `run_id`, `tenant_id`, `dataset_version` and sha256, `model_version`, `prompt_version`, `judge_model_id`, `git_sha`, `timestamp`, `retrieval_mode`.

Reports are written to `runs/<tenant>/<run_id>/`:

- `report.json` — machine-readable, consumed by CI
- `report.md` — human-readable, includes per-sample metric reasoning
- `report.html` — reviewer-facing

`reports/drift.py` diffs a run against the tenant's pinned baseline manifest.

CI runs in two bands:

- **Every commit** — Tier 0 metric unit tests and schema validation. No Bedrock calls, seconds of runtime.
- **PRs touching AI-service or prompt code, plus nightly** — full evaluation with the static client, deterministic, non-zero exit on any threshold breach.

`make eval-commerce`, `make eval-all`, and `make ci` are the entry points; `pqa-eval run --tenant <id>` and `--all` are the CLI equivalents.

## 11. Configuration

Thresholds resolve in three layers: `_defaults.yaml` (platform baseline for every metric) → `<tenant>.yaml` (overrides) → environment variable (CI override, for temporary quarantine only).

A tenant YAML carries: metric thresholds, composite floor, latency and token budgets, terminology and style rubric inputs, relevance floor for empty-retrieval detection, stability bounds, and the pinned baseline run id.

Adding a tenant is: copy `_template.yaml`, create `data/tenants/<id>/goldens/v1.0.0/`, register the tenant id. No Python changes — per the "configuration, not code" invariant.

## 12. Out of scope

- Online production sampling evaluation. The interfaces are designed to accommodate it (the `PQADraftClient` ABC and `RunManifest` already carry what it needs), but no production sampler is built now.
- Automated remediation of failures. The framework reports; humans decide.
- Tenant-specific fine-tuning or model selection. That is Phase 2 platform work.
- Provisioning of real cloud infrastructure for tenant KBs.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Bedrock throttling produces NaN metrics, as seen in the DoE pipeline | Bounded worker pool per tenant, retry with backoff, explicit NaN reporting rather than silent zero-fill |
| Judge model drift changes scores without any system change | `judge_model_id` pinned in config and recorded in every manifest; drift report compares like-for-like |
| Golden sets rot as ministry practice changes | Versioned, immutable dataset directories with provenance in the manifest; drift detection surfaces divergence |
| Tier 2 GEval scores vary run to run | `stability.py` measures variance explicitly (EC14); tenant config sets an acceptable bound |
| Teams route around a failing gate by loosening thresholds | Threshold changes are config commits, reviewable in PR; env override is documented as quarantine-only |
| EC13 near-window contexts overwhelm the **judge**, not just the system under test — RAGAS Faithfulness sends the full context to Bedrock per claim | Tier 0/1 deterministic gates still run at any size; LLM-judged metrics chunk or truncate context with an explicit `context_truncated_for_judging` flag on the result, so a score computed on partial context is never presented as a full-context score |
