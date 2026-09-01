# pqa-eval-framework

A multi-tenant LLM evaluation framework and monitoring dashboard for the
Parliament Chatbot Common Platform (PQA) — a Government of India platform on
which each ministry is an isolated tenant and AI-drafted Parliamentary Question
answers are grounded in that tenant's knowledge base and reviewed by humans
before use.

Built on **DeepEval** (primary framework, custom domain metrics, CI quality
gates) with **RAGAS** (reference-free RAG metrics), judged by **AWS Bedrock** in
`ap-south-1`.

## What it does

- Scores AI-drafted PQ answers on grounding, sub-question completeness,
  citation provenance, and adherence to parliamentary style.
- Enforces two safety invariants **deterministically**, with veto power over a
  sample's result: private-source content never leaks without an explicit
  promote-to-public acknowledgement, and citations must resolve to documents
  that were actually retrieved.
- Treats retrieved document text as data, never instructions — prompt-injection
  payloads hidden in source documents must not influence a draft.
- Keeps every tenant's datasets, runs, and reports isolated at runtime, fail-closed.
- Surfaces results through a dashboard where a failure is explainable in one
  screen: the metric's reasoning, the retrieved context with provenance, and the
  citations with resolution status.

## Status

Design complete; implementation in progress against the plan below.

| Document | Contents |
|---|---|
| [Framework design](docs/superpowers/specs/2026-08-31-pqa-eval-framework-design.md) | Metric tiers, tenant isolation, datasets, 21 edge cases |
| [Dashboard design](docs/superpowers/specs/2026-08-31-pqa-dashboard-design.md) | Views, `ViewerScope` read-side isolation, alerts |
| [Implementation plan](docs/superpowers/plans/2026-08-31-pqa-eval-framework.md) | 34 tasks, test-first, with full code |

## Design in one table

Metrics are tiered by **failure mode**, not by convenience — a safety invariant
must never be probabilistic:

| Tier | Mechanism | Examples |
|---|---|---|
| 0 | Deterministic Python, no LLM, **veto** | Private Source Guard, Citation Existence |
| 1 | DAG: deterministic gate + narrow LLM leaf | Sub-Question Completeness, Prompt Injection Resistance |
| 2 | GEval rubric with reasoning | Citation Quality, Terminology & Style |
| RAG | RAGAS + DeepEval | Faithfulness, Context Recall, Hallucination |

A sample passes only if **every** metric clears its tenant threshold *and* the
weighted composite clears the tenant floor. Averaging alone is how an ungrounded
answer slips past a green dashboard.

## Note on the product spec

`docs/product.md` (the internal PQA product specification) is intentionally not
committed to this public repository. The design documents restate every
invariant they depend on, so they are readable without it.

## Licence

Not yet determined.
