# PQA QA Automation — Design

**Date:** 2026-09-21
**Status:** Approved for implementation
**Owner:** NeGD PQA Platform — QA / Security workstream
**Tracker:** S1-QA-01 (Fri 25 Sep), S2-QA-01 (Wed 30 Sep, gate), S4-QA-01 (Fri 16 Oct, gate)
**Scope:** A browser, API and isolation test suite for the PQA multi-tenant Parliamentary Question platform, delivered as `pqa-qa/` inside this repository alongside `pqa-eval/`.

---

## 1. Purpose

`pqa-builder` is an Nx monorepo of eight applications serving multiple ministry tenants from one codebase. It carries 788 test files and a 90% coverage policy, but **two end-to-end specs** covering 47 portal pages, 5 admin pages and roughly 130 BFF routes. Nothing above the unit layer proves the product's central claim.

That claim is tenant isolation. The platform's commercial argument is that one ministry's data, index, storage and audit trail cannot reach another's. Today that is an assertion in `product.md`. This suite makes it a result.

It answers four questions on every run:

1. Can a caller reach another tenant's data by any route on the demo path?
2. Can a caller act without server-derived identity, or substitute their own?
3. Does tenant-scoped infrastructure — S3 prefixes, OpenSearch indexes, Postgres schemas, row-level security — fail closed?
4. Does content leave India-aligned infrastructure, and does the running system match its configured model provider?

Question 4 is included because the sovereignty claim is currently **unverified and partly untrue** (§7.9). A selling point that no test covers is a liability, not an asset.

## 2. What the sprint plan asks for

The tracker names this work three times. The design is shaped by those exit criteria, not by a generic testing-pyramid ideal.

| Item | Due | Exit criterion | Section |
|---|---|---|---|
| **S1-QA-01** (P0) | Fri 25 Sep | "Inventory the BFF/service routes on the demo path and classify data; negative tests for missing identity, wrong tenant, wrong department, S3 prefix escape, wrong index." · *"Suite runs daily; every gap is a named failing test, not an opinion"* | §6, §7, §10 |
| **S2-QA-01** (P0, gate) | Wed 30 Sep | "Isolation negative suite, two-tenant end-to-end PQ workflow, retrieval quality report against the golden set." | §7, §9 |
| **S4-QA-01** (P0, gate) | Fri 16 Oct | "Two-tenant E2E on the production topology, timed config-only onboarding of a third tenant, isolation re-test." | §9, §12 |

Two dependency facts set the pace:

- **S1-DO-02 depends on S1-QA-01.** DevOps cannot close S3 prefix-escape and wrong-index at the infrastructure layer until tests exist to fail against. This suite is on another workstream's critical path from day one.
- **S2-BE-01 is "close every failing test from the S1 isolation suite."** Backend's next sprint is defined by this suite's output. The gap register (§10) is therefore a deliverable in its own right, not a by-product.

## 3. Constraints

- **`pqa-builder` is read-only.** Not one character changes there. No test file, no CI config, no fixture, no `package.json` entry. Everything lives in this repository and reaches the system under test over HTTP, S3, OpenSearch and Postgres only.
- **This repository is private.** Made private on 2026-09-21, before any of this work was committed, with zero forks and zero stars at the time. That is a precondition, not a detail: §10's gap register is a dated list of which isolation attacks currently succeed against a Government of India platform, pre-VAPT (X-01). It must not become public. If the repository is ever made public again, `inventory/` must be excised first.
- **Scope is the demo path**, defined by S1-UX-01: login, dashboard, PQ intake, drafting, review, export. Routes outside it are inventoried and flagged `S1-OUT`, not tested.
- **WebKit cannot run** on the team's Linux hosts (documented in `pqa-builder/CLAUDE.md` §11). Chromium and Firefox only.
- **Two services have no local environment.** `apps/rag-service` and `apps/ingestion-service` have no Python virtualenv on the current host, so ports 8002 and 8001 are dark. The suite must report their tests as skipped-with-reason, never as passing (§5.3).

## 4. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Suite technology | One TypeScript package, Playwright as runner for all three layers | The fixture layer — QA tenant, four personas, PQ factory — is needed identically by isolation, API and browser tests. Playwright's `page` and `request` share a `browserContext`, so an API assertion can read state a browser journey just created, with one login. A polyglot split pays for that layer twice. |
| Test-data strategy | Dedicated disposable `qa` tenant; Commerce read-only | `product.md` makes Commerce the reference implementation that must not regress. Destructive lifecycle tests run in a tenant that is dropped at teardown; Commerce gets read-only assertions only. |
| Placement | `pqa-qa/` in this repository, beside `pqa-eval/` | `pqa-builder` is read-only. This repository already owns platform quality tooling and is owned by the S1-QA-01 owner. |
| Failure semantics | Three states: regression, tracked gap, closed gap | S1-QA-01's deliverable is deliberately red. A binary pass/fail run cannot distinguish "Ankur has not fixed this yet" from "someone broke something today", and a suite that is permanently red stops being read within a week. |
| Infrastructure probes | Direct S3 / OpenSearch / Postgres clients inside the same suite | Prefix escape and wrong-index are not HTTP concerns. Splitting them into a separate tool would split the gap register that S1-DO-02 works from. |
| Run target | Local-first, CI-ready | No CI configuration exists anywhere in `pqa-builder` today. The suite ships a `.gitlab-ci.yml` here for adoption when a pipeline exists (S3-DO-01). |

### 4.1 Rejected alternatives

- **Playwright for the browser, `pytest` + `httpx` for API and isolation.** Shares a language and runner with `pqa-eval` and the two FastAPI services, and suits a Python-side maintainer. Rejected because the mock-OTP login and cookie handling would be reimplemented in Python, producing two session layers, two reports and two CI jobs, with no browser-to-API state handoff.
- **Journey-first, no fixture layer.** Fastest to something running. Rejected because the isolation matrix is combinatorial — personas × tenants × routes × attack families — and retrofitting fixtures across written tests is the expensive direction.
- **Schema-derived contract tests.** Attractive, but only `rag-service` and `ingestion-service` expose OpenAPI. The three NestJS services have no Swagger setup and the ~130 BFF routes have no machine-readable contract, so generation would cover the least important 15% of the surface.
- **Inventory all 130 BFF routes before Friday.** The tracker asks for the demo path. A complete inventory is a week of classification work that delays the tests S1-DO-02 is waiting on.

## 5. Architecture

### 5.1 Layout

```
pqa-qa/
├── README.md                     prerequisites, one command, how to read gaps.md
├── package.json
├── playwright.config.ts          projects: isolation | api | e2e
├── .env.example                  every URL env-driven; no hardcoded ports
├── .gitlab-ci.yml                daily scheduled run + on-demand
│
├── inventory/
│   ├── demo-path.routes.yaml     S1-QA-01 deliverable (a) — routes + data class
│   └── gaps.md                   generated — the S2-BE-01 checklist
│
└── src/
    ├── support/
    │   ├── probe.ts              service reachability → explicit skip
    │   ├── tenant.ts             provision / seed / drop the qa tenant
    │   ├── personas.ts           four storageStates, built in globalSetup
    │   ├── pq-factory.ts         create a PQ at any lifecycle status
    │   ├── clients/              s3.ts · opensearch.ts · postgres.ts
    │   └── gap-reporter.ts       three-state reporter (§10)
    │
    ├── isolation/                nine attack families (§7)
    ├── api/                      contract tests (§8)
    └── e2e/                      browser journeys (§9)
```

### 5.2 Fixture layer

Four units, each independently usable:

**`tenant.ts`** — provisions tenant slug `qa` through `POST /internal/tenants/provision` on `pqa-service` (guarded by `x-api-key`), seeds departments, and drops schema `tenant_qa` at teardown. Commerce is never written to.

A caveat carried from `pqa-builder/CLAUDE.md` §1.5: provisioning shapes tenant schemas via TypeORM `synchronize: true`, not the 26 tracked migrations. A `qa` schema can therefore differ from a migrated production schema. Tests that depend on migration-specific structure must run against Commerce read-only, and are annotated accordingly.

**`personas.ts`** — `globalSetup` authenticates four personas through the mock OTP flow (`MOCK_IDP_ENABLED=true`, `PARICHAY_BASE_URL=http://localhost:3200/mock-idp`) and writes four `storageState` files:

| Persona | OrgType | MembershipRole |
|---|---|---|
| `parliament-admin` | PARLIAMENT | ADMIN |
| `parliament-member` | PARLIAMENT | MEMBER |
| `division-admin` | DIVISION | ADMIN |
| `division-member` | DIVISION | MEMBER |

Built once per run and reused across all three Playwright projects. RBAC permission keys (`users:read`, `users:manage`, `roles:read`, `roles:manage`, `permissions:read`, `ingestion:manage`) are asserted against `libs/rbac-contract`'s vocabulary, read from the running services rather than copied — a copied vocabulary is the duplication `tenant-contract` already taught this platform to avoid.

**`pq-factory.ts`** — creates a PQ at a named status from the 19-value lifecycle, so a review test does not have to drive intake and drafting first. Every record it creates is prefixed with the run id and removed at teardown.

**`clients/`** — thin S3, OpenSearch and Postgres clients constructed with a *tenant-scoped* credential, used by families 4, 5 and 8. These deliberately bypass the application: the question they answer is whether the infrastructure boundary holds when the application is not in the way.

### 5.3 Capability probe

`probe.ts` runs before the suite and checks reachability of: frontend `:3000`, admin `:4200`, pqa-service `:3001`, config-manager `:3100`, identity-service `:3200`, ingestion `:8001`, rag `:8002`, Postgres, S3, OpenSearch.

An unreachable dependency marks its tests `skip` with the reason printed in the report and recorded in `gaps.md` under *not measured*. This is the same discipline `pqa-eval`'s design applies to missing captures: a test that did not run is never reported as a test that passed. It matters immediately — the two Python services have no virtualenv on the current host, so without this probe roughly a quarter of the suite would silently report green.

## 6. The route inventory

S1-QA-01's first deliverable. `inventory/demo-path.routes.yaml` carries one entry per route reachable from the six demo-path screens:

```yaml
- path: /{tenant}/api/departments/questions/{id}/draft
  method: PUT
  screen: drafting
  upstream: pqa-service /questions/:id/draft
  gate: requirePortalSession
  data_class: department-scoped
  attacks: [missing-identity, wrong-tenant, wrong-department, session-replay]
  s1_scope: true
```

`data_class` is one of `public`, `tenant-scoped`, `department-scoped`, `private-source`, `credential`. The classification drives which attack families apply, and it is the artefact Bhupendra needs for S1-DO-02's IAM and index scoping.

Routes outside the demo path are listed with `s1_scope: false`, so the full surface is visible on Friday without being a commitment.

## 7. Attack families

Nine families. Five are named verbatim in S1-QA-01; four were added because the platform's own architecture documents point at them.

### 7.1 Missing identity

No cookie; expired cookie; malformed cookie; cookie present but the account's portal access has been revoked. Every demo-path route must answer 401 or 403.

The specific failure this guards against is a route that answers **200 with an empty list** instead of 401. An empty list is indistinguishable from "this tenant has no data" and would hide a broken gate behind a plausible-looking screen.

### 7.2 Wrong tenant

Four probes:

- **Forged `x-tenant-slug`.** `proxy.ts` uses `requestHeaders.set()`, so a client-supplied header is overwritten when the path carries a valid tenant segment. Expected to pass; asserted so that a future change to `append` is caught.
- **Matcher evasion.** `proxy.ts`'s `matcher` excludes any path ending `.svg|.png|.jpg|.jpeg|.gif|.webp|.ico`. A request whose final dynamic segment resembles an asset — `/commerce/api/parliament/questions/123.png` — skips the proxy entirely. `resolveUpstreamTenantSlug()` in `lib/server/upstream.ts` then trusts an inbound `x-tenant-slug` before falling back to the tenant bundle. **Hypothesis to be proven or disproven by test**, not a finding. If it holds, it is a cross-tenant read reachable from a browser.
- **Null-segment header retention.** When `parseTenantSegment()` returns null the proxy returns early without clearing any client-supplied `x-tenant-slug`. No demo-path route currently lives outside a tenant segment, so this is expected to be unreachable — asserted to keep it that way.
- **Unknown slug.** Must render an explicit not-found and return `404 TENANT_NOT_FOUND`, never fall through to Commerce.

### 7.3 Wrong department

A `division-member` persona requests another division's PQ by id, assigns across divisions, and reads another division's draft.

Separately, and this is S1-BE-01's exit criterion stated as a test: client-supplied `callerEmail`, `departmentId` and `tenantId` in body, query or header must be **ignored** in favour of server-derived identity. `requirePortalSession()` documents this intent — *"Prefer session email over any client-supplied callerEmail"* — and the test makes it enforceable.

### 7.4 S3 prefix escape

Using a tenant-scoped credential directly against S3: read, write, list and delete outside `<tenant>/`. Expected to fail until S1-DO-02 lands per-tenant IAM boundaries. Annotated as a tracked gap owned by Bhupendra.

### 7.5 Wrong index

Using a tenant-scoped credential directly against OpenSearch: query, write to and enumerate another tenant's index. Same ownership and timeline.

Note the Phase 0 boundary recorded in `CLAUDE.md` §1.1: S3 and OpenSearch are **still single-tenant**, so these two families are expected to fail comprehensively. That is the point — they quantify the remaining work.

### 7.6 Cross-tenant session replay

`pqa_session` is scoped to `/<slug>` precisely because all tenants share one origin; a root-scoped cookie would be a cross-tenant identity leak. Probes: a Commerce session cookie replayed at `/mohfw`; a session issued for a suspended tenant; a session surviving a tenant slug rename; cookie path widened by hand.

`lib/auth/server.ts` cross-checks the session's tenant against the request's, so this is expected to hold. It is included because it is a single-line regression away from being catastrophic, and because "one origin, many ministries" is the architectural choice a reviewer will question first.

### 7.7 Service-to-service surface

`POST /internal/tenants/provision`, `POST /internal/tenants/migrate-all`, and the three controllers behind `ServiceApiKeyGuard`. Probes: absent `x-api-key`; wrong key; valid key used to provision, read or migrate a tenant other than the caller's own; key accepted from a browser-origin request.

These endpoints create schemas and seed administrators. They are the highest-privilege surface in the platform and are not covered by any current test.

### 7.8 Identity-service row-level security

`identity_users`, `identity_roles`, `identity_sessions`, `identity_role_permissions` and `identity_user_roles` are RLS-enabled and default closed. A query issued outside `withTenantScope()` returns **zero rows rather than erroring**.

Probes: confirm the boundary holds; confirm the main connection role does not hold `BYPASSRLS`; confirm `identity_backchannel_role` is the only path to the one legitimate cross-tenant action. Critically, confirm that zero-rows is never surfaced to a user as "no data" — a silent empty result is the failure mode this design distrusts most, and here the database produces it by default.

### 7.9 Egress and residency

The platform's stated selling point is that ministry data does not leave sovereign infrastructure. As of 2026-09-21 that claim does not survive reading the code:

| Observation | Source |
|---|---|
| Commerce and mohfw run Bedrock `claude-sonnet-4-5` in `ap-south-1`; only railways is configured for Ollama | `apps/frontend/data/tenants/*.json` |
| `rag-service` — the service that actually generates drafts — is Bedrock-only. `ChatBedrockConverse` is constructed directly; there is no provider switch in `config.py` and no occurrence of "ollama" anywhere in its source | `apps/rag-service/src/workflow/generate.py` |
| The frontend's `OllamaProvider` has no importers outside its own directory — it is not on the live path | `apps/frontend/src/lib/llm/` |
| Ingestion cascades Azure Document Intelligence before the vision model, sending document content to a third-party cloud processor | `apps/ingestion-service/src/pipeline/cascading_extractor.py` |

`ap-south-1` gives data **residency in India**, which is defensible. "On-premise, therefore no egress" is not, and a tenant administrator can select Ollama in the admin UI while `rag-service` continues to call Bedrock — configured and actual diverge silently.

The tracker agrees this is unfinished: S1-ARC-01 lists the model stack as a decision due this week, and S3-AI-01 (09 Oct) is where India-hosted adapters behind an allowlist and per-call residency metadata get built.

Five probes, expected to produce four tracked gaps owned by Mohit:

1. Every outbound model and embedding call resolves to an allowlisted endpoint — Bedrock `ap-south-1`, or the tenant's own `baseUrl`. *Expected pass.*
2. `rag-service` honours the tenant's configured `llm.provider`. *Expected fail — S3-AI-01.*
3. Selecting Ollama in the admin UI routes generation to Ollama end to end. *Expected fail — same gap.*
4. Residency metadata is recorded on every generation call. *Expected fail — S3-AI-01 exit criterion.*
5. Ingestion's Azure DI stage is disabled, or acknowledged per tenant as an offshore processor. *Expected fail or not-configured.*

## 8. API contract suite

Per demo-path route, per applicable persona:

- Happy path, asserting the response shape rather than only the status.
- At least one error path — `CLAUDE.md` §10.4 requires every external call to have one.
- **A 200 carrying an embedded error payload is a failure**, per `CLAUDE.md` §10.4. This is asserted explicitly because HTTP status alone is known not to be trustworthy on this stack.
- Explicit-timeout compliance: a route whose upstream hangs must return an error, not hold the connection open. `CLAUDE.md` §10.4 makes a missing timeout a release blocker, and its §12 records that the rule is not yet uniformly followed across the codebase.

## 9. Browser journeys

The two-tenant end-to-end PQ workflow S2-QA-01 gates on, across the six demo-path screens: login → dashboard → PQ intake → drafting → review → export.

Run twice: against `qa` with the full destructive lifecycle, and against Commerce with read-only assertions (branding, terminology, reachability, no cross-tenant bleed).

These journeys are written from **observation of the running application through Playwright MCP**, not inferred from route source. Selector strategy, loading states, and the real sequence of screens are all things the source under-specifies and a recorded session settles. This is the only part of the suite that cannot begin before the stack is running.

Chromium and Firefox. Traces on first retry.

For S4-QA-01, the same journeys run against the production topology, plus a timed config-only onboarding of a third tenant — the onboarding clock is itself the exit criterion.

## 10. Failure semantics and the gap register

S1-QA-01's exit criterion is *"every gap is a named failing test, not an opinion"*, and S2-BE-01 is *"close every failing test from the S1 isolation suite."* The suite's output is therefore expected to be substantially red on Friday, and that red is the deliverable.

A binary runner cannot express this. Every known gap carries an annotation:

```ts
test.info().annotations.push({
  type: 'known-gap',
  description: 'S1-DO-02 · Bhupendra · per-tenant S3 IAM boundary',
});
```

`gap-reporter.ts` then resolves each result into one of three states:

| State | Condition | Effect |
|---|---|---|
| **Regression** | Unannotated test failed | Exit non-zero. Something broke today. |
| **Tracked gap** | Annotated test failed | Expected. Written to `gaps.md`. Run still exits zero. |
| **Closed gap** | Annotated test **passed** | The owner fixed it. Reported prominently; the annotation should be removed. |

A tracked gap must not fail the daily run. If it did, the run would be red from day one, and "suite runs daily" would be abandoned within a week — the failure mode that kills most acceptance suites.

The closed-gap state is what keeps the register honest. Without it a fixed gap sits annotated indefinitely and the checklist rots.

`inventory/gaps.md` is regenerated every run: one row per gap with owner, tracker reference, route, attack family, and the failing assertion. It is the artefact S2-BE-01 works from.

## 11. Environment and handover

S1-QA-01's owner is Akhilesh, supported by Bhupendra and Ankur. Combined with *"suite runs daily"*, the suite must be runnable by someone who did not build it.

- `yarn qa` runs everything; `yarn qa:isolation` runs Friday's deliverable alone.
- Every URL comes from the environment. No hardcoded ports — **port 3000 is currently occupied by an unrelated Langfuse container on the development host**, and a hardcoded base URL would fail confusingly.
- `README.md` states prerequisites plainly: Postgres up, port 3000 free, Python virtualenvs built for the two FastAPI services, `MOCK_IDP_ENABLED=true`.
- HTML and JUnit reporters. Non-zero exit on regression only.
- No credential is committed. `.env.example` lists variable names only, consistent with this repository's existing `.gitignore` policy.

## 12. Delivery schedule

| When | Deliverable | Tracker |
|---|---|---|
| Mon 21 – Tue 22 Sep | Route inventory and data classification; fixture layer; families 1, 2, 6 | S1-QA-01 |
| Wed 23 Sep | Families 3, 7, 8; infrastructure probes for 4, 5 | S1-QA-01, unblocks S1-DO-02 |
| Thu 24 Sep | Family 9; gap reporter; `gaps.md`; README; daily CI job | S1-QA-01 |
| **Fri 25 Sep** | **Hand over: suite runs daily, gaps named** | **S1-QA-01 exit** |
| Sat 26 – Tue 29 Sep | API contract suite; browser journeys from Playwright MCP observation | S2-QA-01 |
| **Wed 30 Sep** | **Demo acceptance gate** | **S2-QA-01** |
| Oct | Production-topology re-run; timed third-tenant onboarding | S4-QA-01 |

Families 4, 5 and 9 are expected to fail throughout. They are scheduled to *exist*, not to pass.

## 13. Out of scope

- **Visual regression** — S3-FE-01, due 09 Oct, a separate piece of work with its own tooling.
- **Load and performance testing** — X-04, requires production infrastructure that does not yet exist.
- **Metering accuracy** — S4-QA-01, depends on S3-BE-03's counters.
- **LLM output quality** — `pqa-eval/` in this repository owns it, judged by Bedrock against golden datasets. This suite asserts that generation is *reachable, isolated and correctly routed*; it does not score what comes back.
- **The ~90 non-demo-path BFF routes** — inventoried and flagged `S1-OUT`, not tested this sprint.
- **Remediation.** The suite reports. Ankur, Bhupendra and Mohit fix.

## 14. Risks

| Risk | Mitigation |
|---|---|
| The `qa` tenant's schema is shaped by `synchronize: true`, not the 26 tracked migrations, so it can diverge from production | Migration-sensitive assertions run read-only against Commerce; the divergence is recorded in `gaps.md` as a known limitation, and S4-QA-01 re-runs on production topology |
| A crashed run leaves `tenant_qa` behind | Teardown is idempotent and also runs at the start of the next run; the schema name is fixed, never generated |
| Families 4, 5 and 9 fail comprehensively, and a permanently red suite stops being read | The three-state reporter (§10); tracked gaps do not fail the run; the register names an owner per row |
| `rag-service` and `ingestion-service` have no virtualenv, so a quarter of the suite cannot run | Capability probe reports explicit skips; never a silent pass. Building the virtualenvs is a prerequisite in the README |
| The gap register becomes public before remediation | Repository made private 2026-09-21 with zero forks; `inventory/` must be excised before any future re-publication |
| Playwright MCP observation is unavailable, so journeys get written from route source and miss real behaviour | Journeys are explicitly deferred to the S2 window rather than guessed at during S1 |
