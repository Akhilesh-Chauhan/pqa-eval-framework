# PQA Evaluation Dashboard — Design

**Date:** 2026-08-31
**Status:** Approved for implementation
**Owner:** NeGD PQA Platform engineering
**Scope:** Unified Evaluation & Monitoring Dashboard — the read-side layer over the pqa-eval framework's run artifacts. Serves Ministry Admins (own tenant only) and Super Admins (all tenants).
**Depends on:** `2026-08-31-pqa-eval-framework-design.md` — specifically the `RunReport` / `RunManifest` / `SampleEvaluation` / `MetricOutcome` contract serialized as `runs/<tenant_id>/<run_id>/report.json`. The dashboard consumes that contract only; it never imports the framework's evaluators and never recomputes a score.

**Contract extension this design requires (implemented in the framework, not the dashboard):** `SampleEvaluation` gains an optional `evidence: SampleEvidence` block — `question`, `draft_answer`, `expected_answer`, `contexts` (doc_id, visibility, is_annexure, text), `citations` (citation_id, source_ref, visibility, `resolves: bool`). The runner populates it from the golden + draft at report time, applies the same private-span redaction as the Markdown writer for unpromoted samples, and clamps each context text to 20,000 chars with an explicit truncation marker. This keeps report.json fully self-contained for human debugging AND lets Run Detail render explainability without ever touching golden files.

---

## 1. Purpose

Evaluation results are only useful if the people responsible act on them. The dashboard makes every run answerable in three clicks: is anything failing (Overview), which run and why (Run Detail, sample-level reasons), and is quality drifting (Trends vs pinned baseline). Failures must be explainable on screen — the metric's own `reason` string, the retrieved contexts with provenance, and the citations with resolution status.

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Shape | FastAPI + server-rendered UI, one Python service inside pqa-eval | Only shape where tenant scoping is enforced server-side; same language and deployment story as the framework; no Node toolchain on gov cloud |
| Frontend | Jinja2 templates + vanilla JS + vendored Chart.js (no CDN) | Air-gapped friendly, fast first paint, ownable by a government team |
| Auth | `AuthProvider` ABC; v1 `FileAuthProvider` (bcrypt `users.yaml`, CLI-managed), signed session cookies | Parichay SSO is a Phase 1 platform deliverable not available here; the ABC lets Parichay OIDC drop in with zero view changes |
| Data | SQLite index over `runs/`, rebuilt by ingest; `report.json` stays the source of truth | Trends and filters over hundreds of runs need indexed queries; the DB is disposable and rebuildable, so no migration burden |
| Alerts | In-app only, rules evaluated at ingest; CSV export + print-to-PDF | Email/webhook needs gov SMTP decisions not yet made; the rule model makes channels an add-on |

### 2.1 Rejected alternatives

- **Static site generator** — weakest isolation story (folder reachability), client-side filtering, rebuilt artifacts for trends.
- **Module in the PQA admin portal (apps/admin, Next.js)** — best long-term integration but that repo is not accessible here and it couples release cycles.
- **Reverse-proxy header auth / no auth** — either unusable until the gateway exists or turns "Ministry Admin sees only their tenant" into a UI fiction.
- **Postgres** — operational overhead the `runs/` directory does not justify.
- **Reusing `TenantContext` for request scoping** — it is a one-tenant fail-closed *writer* guard; a Super Admin viewing all tenants needs a different object (`ViewerScope`), with the same fail-closed philosophy adapted to the read side.

## 3. Architecture

```
src/pqa_eval/dashboard/
├── app.py               # FastAPI factory; mounts routers, static, templates
├── auth.py              # AuthProvider ABC; FileAuthProvider; Principal;
│                        #   session cookie sign/verify; require_login/require_role deps
├── scope.py             # ViewerScope — the isolation object
├── db.py                # SQLite schema + ALL query functions (scope-first signatures)
├── ingest.py            # runs/ scanner -> SQLite; validation via RunReport pydantic
├── alerts.py            # rule engine, evaluated at ingest; acknowledge with audit fields
├── routers/
│   ├── auth.py          # login/logout
│   ├── overview.py      # /
│   ├── runs.py          # /runs (+ /api/runs)
│   ├── run_detail.py    # /runs/{run_id} (+ /api/runs/{run_id})
│   ├── trends.py        # /trends (+ /api/trends)
│   ├── coverage.py      # /coverage (+ /api/coverage)
│   ├── alerts.py        # /alerts (+ /api/alerts, acknowledge)
│   └── export.py        # /export/... CSV streams
├── templates/           # base.html + one template per view
└── static/              # app.css, app.js, chart.umd.js (vendored)
```

Entry points: `pqa-eval dashboard serve [--host 127.0.0.1] [--port 8600] [--dev]` (`--dev` permits a generated throwaway cookie secret; without it the server refuses to start unless `PQA_EVAL_DASHBOARD_SECRET` is set), `pqa-eval dashboard ingest [--rebuild]`, `pqa-eval dashboard useradd --username U --role ministry_admin --tenant commerce`. Deployment guidance: gov gateway/TLS terminates in front; the app binds loopback by default.

New dependencies (added to pyproject as the `dashboard` extra so the core eval framework stays lean): `fastapi`, `uvicorn`, `jinja2`, `bcrypt`. Chart.js is vendored into `static/` (MIT licence) — no CDN.

## 4. Isolation model — `ViewerScope`

- `Principal(username, role, tenant_id | None)` comes from the session cookie only.
- `ViewerScope(tenant_ids: frozenset[str] | ALL)` is derived per request: ministry_admin → their single tenant; super_admin → ALL.
- **Every** query function in `db.py` takes `scope` as its first argument and appends the tenant predicate itself. There is no unscoped query function; code review rule: a new query without `scope` is a defect.
- URL/tenant filters are **intersected** with the scope. A ministry_admin requesting another tenant's data receives 403 (page routes) or an empty, 403-status API response — never a silent partial answer, never a leak.
- The parametrised isolation test walks every registered route with a ministry_admin session and a foreign-tenant target and asserts 403/empty — so a newly added route cannot forget scoping without failing CI.

## 5. Data model (SQLite; disposable index)

```
runs(run_id PK, tenant_id, timestamp, dataset_version, model_version,
     prompt_version, judge_model_id, git_sha, retrieval_mode,
     pass_rate REAL, passed INT, ingested_at)
samples(run_id, sample_id, status, composite REAL, veto_failure,
        notes, adversarial_expected_json, evidence_json,
        PRIMARY KEY(run_id, sample_id))
outcomes(run_id, sample_id, metric, tier INT, score REAL, threshold REAL,
         passed INT NULL, veto INT, not_applicable INT, error, reason,
         context_truncated INT,
         PRIMARY KEY(run_id, sample_id, metric))
alerts(id INTEGER PK AUTOINCREMENT, tenant_id, run_id, severity, rule,
       message, created_at, acknowledged INT DEFAULT 0,
       acknowledged_by, acknowledged_at)
ingest_log(run_id PK, ingested_at, status, detail)   -- skip/ok/invalid audit
```

Ingest behaviour:

- Walks `runs/<tenant>/<run_id>/report.json`; each file is validated through the framework's `RunReport` pydantic model. Invalid or mixed-tenant files are logged to `ingest_log` as `invalid` and skipped whole — never half-ingested.
- The directory tenant and `manifest.tenant_id` must agree, else `invalid`.
- Idempotent: already-ingested run_ids are skipped; `--rebuild` drops and re-scans.
- Runs at service startup, on `POST /api/ingest` (super_admin only), and via CLI.
- `reason` strings are indexed verbatim — they are already redaction-safe (the framework's report writer redacts private spans before serialization); the dashboard renders, never recomputes and never re-derives content from goldens.

## 6. Views

### 6.1 Overview `/`
Per visible tenant: latest-run verdict badge, pass rate, time since last run (amber "no recent evaluation" when older than 48h — silence is never green), open critical alert count, 30-day pass-rate sparkline. Below: unacknowledged critical alerts feed. Super Admin: card grid across ministries; Ministry Admin: single tenant expanded. Meta-refresh every 60s.

### 6.2 Evaluation Runs `/runs`
Newest-first table: run_id, tenant (super_admin only), timestamp, dataset/model/prompt versions, judge model, pass rate, verdict. Querystring-backed filters (tenant ∩ scope, date range, model_version, prompt_version, status) so filtered views are shareable. Server-side pagination, 50/page.

### 6.3 Run Detail `/runs/{run_id}`
- Manifest header: every provenance field from `RunManifest`.
- Aggregate strip grouped by tier: **Tier 0 rendered as invariant badges (HELD / VIOLATED / N-A), never gauges**; Tier 1/2 and RAG as score-vs-threshold bars, red when below; `hallucination` labelled lower-is-better.
- Samples table: status, composite, veto flag, failed-metric chips. Row expands in place to: "why did this fail?" line (veto message, or below-threshold metrics with reasons); per-metric outcomes with verbatim `reason` (and `error`, `context_truncated` marker); question; draft vs expected answer side by side; retrieved contexts with doc_id / visibility / annexure badges (private = distinct colour + lock glyph); citations with resolution status (resolves ✓ / hallucinated ✗ against the retrieved set as recorded in the report); adversarial panel ("should trip: private_source_guard — it did ✓") where `adversarial_expected` is non-empty.
- Print stylesheet: browser print-to-PDF is the PDF export.

### 6.4 Metric Trends `/trends`
Chart.js time series per tenant: chosen metric's mean and pass-rate across runs (x = run timestamp), with vertical annotation markers where model_version or prompt_version changed between consecutive runs. Default panel: faithfulness, hallucination, citation_quality, private_source_guard, subquestion_completeness, composite. Drift: latest run vs the tenant's pinned `baseline_run_id` using the framework's `compare_runs` tolerance semantics; regressed metrics flagged inline and mirrored as alerts.

### 6.5 Golden Dataset Coverage `/coverage`
Per tenant: dataset versions with sample counts and golden/adversarial split (derived from ingested runs' sample rows), capture coverage (evaluated vs NOT_EVALUATED counts), detector-exercise distribution (which veto/detector metrics the adversarial samples target, from `adversarial_expected` — shows where the adversarial set is thin), and failure analysis: metrics ranked by failure count over the last N runs (default 10) with drill-through links to the failing samples in Run Detail.

Golden `tags` are deliberately NOT surfaced: they are not part of the report.json contract, and reading golden files directly would cross the dashboard's read-boundary (goldens carry unredacted private spans). If tag analytics are wanted later, the framework should add tags to `SampleEvaluation` first.

### 6.6 Alerts `/alerts` and export
Feed with acknowledge buttons; acknowledgement records who and when. Severity filter. Export endpoints stream CSV for: runs list (current filter), run detail outcomes (long format: run_id, sample_id, metric, score, threshold, passed, reason), and trend series.

## 7. Alert rules (v1, evaluated at ingest unless noted)

| Rule | Severity | Trigger |
|---|---|---|
| run_failed | critical | ingested run has `passed == false` |
| veto_fired | critical | any non-adversarial sample with a veto metric outcome `passed == false` |
| drift_regression | warning | `compare_runs(latest, baseline)` has regression (only when the tenant has a pinned baseline) |
| pass_rate_drop | warning | pass_rate ≥ 10 points below the tenant's previous run |
| stale_tenant | info | tenant's newest run older than 48h (computed at page load, not stored) |

Duplicate suppression: an (rule, run_id) pair is inserted at most once.

## 8. API surface

Every view is backed by a JSON endpoint under `/api/` with identical scope enforcement: `/api/overview`, `/api/runs`, `/api/runs/{run_id}`, `/api/runs/{run_id}/samples/{sample_id}`, `/api/trends`, `/api/coverage`, `/api/alerts` (+ `POST /api/alerts/{id}/ack`), `POST /api/ingest` (super_admin). These are the future integration points for the platform portal; the HTML views consume the same query layer.

## 9. Auth

- `AuthProvider.authenticate(username, password) -> Principal | None`; v1 `FileAuthProvider` reads `users.yaml` (`username`, `bcrypt_hash`, `role`, `tenant_id`), managed only via `pqa-eval dashboard useradd` (no self-registration, no in-app user management).
- Sessions: HMAC-signed cookie (stdlib `hmac` over a server secret from env `PQA_EVAL_DASHBOARD_SECRET`), 8-hour expiry, `HttpOnly`, `SameSite=Lax`. Tampered/expired → 401 → login page.
- Roles: `super_admin`, `ministry_admin`. `require_role` FastAPI dependencies guard routes; scope derivation is the only place role meaning is interpreted.
- Parichay OIDC later: new `AuthProvider` implementation; views and scoping untouched.

## 10. Testing

Same no-cloud discipline as the framework:

- **Unit**: ViewerScope intersection (incl. foreign-tenant request → empty+403 semantics), ingest idempotency and invalid-file skipping, each alert rule, cookie sign/verify + tamper, bcrypt verify, CSV writers.
- **System**: FastAPI `TestClient` with a fixture SQLite built by ingesting generated fixture `report.json` files for two tenants (commerce + example_ministry) and two seeded users. The parametrised isolation sweep over every registered route is the core test: ministry_admin vs foreign tenant → 403/empty on all of them.
- **No live judge anywhere**: the dashboard consumes reports; its tests consume fixture reports.

## 11. Out of scope (v2 candidates)

Email/webhook alert channels; user self-service; cross-tenant anonymised analytics; triggering evaluations from the UI; websockets/live push (60s meta-refresh suffices); Parichay OIDC implementation (interface only).

## 12. Risks

| Risk | Mitigation |
|---|---|
| A new route forgets scoping | Parametrised all-routes isolation test; scope-first query signatures; no unscoped query helpers exist |
| SQLite write contention (ingest during serving) | Single writer (ingest) with WAL mode; readers unaffected; index is rebuildable |
| report.json contract drift as the framework evolves | Ingest validates via the framework's own pydantic models — a contract change breaks ingest tests, not silently the UI |
| reasons contain sensitive text | Reports are redacted at write time by the framework; dashboard renders only what reports contain; run detail shows the redaction marker verbatim |
| Cookie secret mismanagement | Secret from env only; refuses to start with an empty/default secret outside `--dev` |
