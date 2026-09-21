# PQA QA Automation — Design

**Date:** 2026-09-21
**Status:** Approved for implementation
**Owner:** NeGD PQA Platform — QA / Security workstream
**Tracker:** S1-QA-01 (Fri 25 Sep), S2-QA-01 (Wed 30 Sep, gate), S4-QA-01 (Fri 16 Oct, gate)
**Scope:** A browser, API and isolation test suite for the PQA multi-tenant Parliamentary Question platform, delivered as `pqa-qa/` inside this repository alongside `pqa-eval/`.
**Target:** the shared deployed environment at `https://pqa.myscheme.in/`. **Non-destructive testing only** — see §3 and §9.

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
- **The system under test is a shared deployed environment**, not a laptop. `https://pqa.myscheme.in/` is used by the whole team and stands nine days from the CEO demo. The suite reaches it over HTTPS only; there is no filesystem, no `.env` and no service console.
- **Non-destructive only.** Adversarial probes attempt unauthorised access but create, modify and delete nothing. No tenant provisioning, no schema drops, no PQ records, no `migrate-all`. This is a hard boundary, and §9 records what it costs.
- **No infrastructure credentials.** S3, OpenSearch and Postgres credentials for the deployed environment are not available to QA. Families 4, 5 and 8 are therefore *not measured* rather than passing or failing (§7.4, §7.5, §7.8).

## 4. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Suite technology | One TypeScript package, Playwright as runner for all three layers | The fixture layer — QA tenant, four personas, PQ factory — is needed identically by isolation, API and browser tests. Playwright's `page` and `request` share a `browserContext`, so an API assertion can read state a browser journey just created, with one login. A polyglot split pays for that layer twice. |
| Test-data strategy | Non-destructive throughout — nothing is created, modified or deleted | The target is shared infrastructure nine days before the CEO demo, and `product.md` makes Commerce a reference implementation that must not regress. Adversarial probes attempt unauthorised access and assert on the refusal. The cost is stated in §9: the two-tenant lifecycle S2-QA-01 gates on cannot be automated under this rule. |
| Placement | `pqa-qa/` in this repository, beside `pqa-eval/` | `pqa-builder` is read-only. This repository already owns platform quality tooling and is owned by the S1-QA-01 owner. |
| Failure semantics | Three states: regression, tracked gap, closed gap | S1-QA-01's deliverable is deliberately red. A binary pass/fail run cannot distinguish "Ankur has not fixed this yet" from "someone broke something today", and a suite that is permanently red stops being read within a week. |
| Infrastructure probes | Direct S3 / OpenSearch / Postgres clients inside the same suite | Prefix escape and wrong-index are not HTTP concerns. Splitting them into a separate tool would split the gap register that S1-DO-02 works from. |
| Run target | Remote-first, environment-driven | The system under test is deployed. Every URL and credential comes from the environment, so the same suite runs unchanged against this environment, a laptop, or the production topology S4-QA-01 requires. No CI configuration exists in `pqa-builder`; the suite ships its own `.gitlab-ci.yml`. |

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
    │   ├── tenant.ts             discover active tenants (read-only)
    │   ├── personas.ts           storageStates for whichever personas exist
    │   ├── pq-locator.ts         find an existing PQ at a given status
    │   ├── clients/              s3.ts · opensearch.ts · postgres.ts
    │   └── gap-reporter.ts       three-state reporter (§10)
    │
    ├── isolation/                nine attack families (§7)
    ├── api/                      contract tests (§8)
    └── e2e/                      browser journeys (§9)
```

### 5.2 Fixture layer

Four units, each independently usable:

**`tenant.ts`** — *discovers* tenants rather than creating them. Tenant slugs on the deployed environment are not known in advance, and path-segment routing means the suite cannot proceed without them. It resolves the active set by probing `/<slug>/api/tenant-config` across configured candidates and recording which answer `200`, which answer `404 TENANT_NOT_FOUND`, and which are suspended.

At least two active tenants are required — the S2-QA-01 gate is a *two-tenant* assertion, and every cross-tenant attack in §7 needs a second tenant to attack from. If only one is active, families 2, 6 and 9 report *not measured* and the run says so loudly.

No provisioning, no seeding, no teardown. `POST /internal/tenants/provision` and `migrate-all` are probed for **authentication only** (§7.7) — absent key and wrong key, asserting refusal. A valid key is never used to actually provision.

**`personas.ts`** — `globalSetup` authenticates through the mock OTP flow, which is reported as enabled on the deployed environment. Each persona that authenticates yields a `storageState` file reused across all three Playwright projects.

Only one identity is confirmed to exist: `PLATFORM_SEED_EMAIL`, a platform seed administrator. The remaining three depend on accounts being seeded by the team. `globalSetup` attempts each, and a persona that cannot authenticate is recorded as *not available* — every test requiring it is skipped with that reason, never silently run as a different persona. Families 3 and 8 degrade to *not measured* if no lower-privileged identity exists, because a wrong-department attack needs an identity that is genuinely in the wrong department.

That mock authentication is reachable at all on a deployed environment is itself an assertion the suite makes: X-02 requires mock auth modes disabled in production, so the suite records the environment's mode and flags it if this host is ever promoted.

The four personas the matrix is designed around:

| Persona | OrgType | MembershipRole |
|---|---|---|
| `parliament-admin` | PARLIAMENT | ADMIN |
| `parliament-member` | PARLIAMENT | MEMBER |
| `division-admin` | DIVISION | ADMIN |
| `division-member` | DIVISION | MEMBER |

Built once per run and reused across all three Playwright projects. RBAC permission keys (`users:read`, `users:manage`, `roles:read`, `roles:manage`, `permissions:read`, `ingestion:manage`) are asserted against `libs/rbac-contract`'s vocabulary, read from the running services rather than copied — a copied vocabulary is the duplication `tenant-contract` already taught this platform to avoid.

**`pq-locator.ts`** — *finds* an existing PQ at a named status from the 19-value lifecycle, so an authorisation test has a real record to attack without creating one. Read-only by construction: it queries list endpoints, filters by status, and returns an id.

A located record is a weaker fixture than a created one — the environment may hold no PQ in a given status, in which case the dependent test skips with that reason rather than passing vacuously. This is the direct cost of the non-destructive constraint, and it is why §9.2 matters: a created fixture is deterministic, a located one is whatever the environment happens to contain that day.

**`clients/`** — thin S3, OpenSearch and Postgres clients constructed with a *tenant-scoped* credential, used by families 4, 5 and 8. These deliberately bypass the application: the question they answer is whether the infrastructure boundary holds when the application is not in the way.

### 5.3 Capability probe

`probe.ts` runs before the suite and establishes what is actually testable: base URL reachability, which tenant slugs resolve, whether mock authentication is available, which personas authenticate, and whether S3, OpenSearch and Postgres credentials are configured.

Anything unavailable marks its tests `skip` with the reason printed in the report and recorded in `gaps.md` under *not measured*. This is the same discipline `pqa-eval`'s design applies to missing captures: a test that did not run is never reported as a test that passed.

On this target the probe is load-bearing rather than defensive. Three of S1-QA-01's five named attack families have no credentials (§7.4, §7.5, §7.8) and three of four personas are unconfirmed. Without the probe, a substantial fraction of the suite would report green on Friday while having tested nothing — which is precisely the outcome the exit criterion *"every gap is a named failing test, not an opinion"* exists to prevent.

The probe also enforces the deployment window: if the base URL is unreachable, the run aborts with that as its single result rather than emitting hundreds of misleading failures.

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

**Status: not measured.** Using a tenant-scoped credential directly against S3 — read, list, and attempted write outside `<tenant>/` — requires an S3 credential for the deployed environment, which QA does not hold.

The probes are written and skipped with reason `no S3 credential`, owner **Bhupendra**. They light up the moment a read-scoped key is provided. Recorded in `gaps.md` as *not measured*, not as passing: S1-DO-02's exit criterion is that prefix escape *fails closed at the infrastructure layer*, and nothing here currently verifies that.

### 7.5 Wrong index

**Status: not measured.** Querying and enumerating another tenant's index directly against OpenSearch. Same constraint, same owner, same handling as §7.4.

Worth stating plainly for the gate review: `CLAUDE.md` §1.1 records that S3 and OpenSearch are **still single-tenant** in Phase 0 — the non-Commerce tenants point at a bucket and index that do not exist. These two families are therefore expected to fail comprehensively once credentials arrive. Leaving them unmeasured does not make the boundary safe; it makes it unverified.

### 7.6 Cross-tenant session replay

`pqa_session` is scoped to `/<slug>` precisely because all tenants share one origin; a root-scoped cookie would be a cross-tenant identity leak. Probes: a Commerce session cookie replayed at `/mohfw`; a session issued for a suspended tenant; a session surviving a tenant slug rename; cookie path widened by hand.

`lib/auth/server.ts` cross-checks the session's tenant against the request's, so this is expected to hold. It is included because it is a single-line regression away from being catastrophic, and because "one origin, many ministries" is the architectural choice a reviewer will question first.

### 7.7 Service-to-service surface

`POST /internal/tenants/provision`, `POST /internal/tenants/migrate-all`, and the three controllers behind `ServiceApiKeyGuard`. Probes: absent `x-api-key`; wrong key; valid key used to provision, read or migrate a tenant other than the caller's own; key accepted from a browser-origin request.

These endpoints create schemas and seed administrators. They are the highest-privilege surface in the platform and are not covered by any current test.

### 7.8 Identity-service row-level security

`identity_users`, `identity_roles`, `identity_sessions`, `identity_role_permissions` and `identity_user_roles` are RLS-enabled and default closed. A query issued outside `withTenantScope()` returns **zero rows rather than erroring**.

**Status: partly not measured.** The direct-database probes — that the main connection role does not hold `BYPASSRLS`, that `identity_backchannel_role` is the only path to the one legitimate cross-tenant action, that a query outside `withTenantScope()` returns nothing — need a Postgres DSN that QA does not hold. Skipped with reason `no database credential`, owner **Bhupendra**.

What *is* measurable over HTTP: that a user-management or role-listing response never presents an empty result as authoritative "no data" when the caller is outside the tenant scope. A silent empty result is the failure mode this design distrusts most, and here the database produces it by default — so the HTTP-layer half runs regardless of credentials.

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

Journeys are written from **observation of the running application through Playwright MCP**, not inferred from route source. Selector strategy, loading states and the real sequence of screens are things the source under-specifies and a recorded session settles. This is the only part of the suite that cannot begin before the environment is reachable.

Chromium and Firefox. Traces on first retry.

### 9.1 What runs: read-only traversal

Login → dashboard → PQ list → an existing PQ's drafting screen → review screen → export, across every active tenant. Assertions cover branding and terminology per tenant, RBAC-gated navigation per persona, loading and error states, and the absence of cross-tenant bleed in anything rendered. Export is included only where it does not mutate state.

### 9.2 What does not run, and why it matters

**S2-QA-01's exit criterion names a "two-tenant end-to-end PQ workflow".** A PQ workflow means creating a question and moving it through the lifecycle — Assign, Accept, Draft, Submit for Approval, Approve, Transmit. Every one of those writes. Under the non-destructive constraint in §3, none can be automated.

This is a scope conflict between a constraint and a P0 gate, not an oversight. It is recorded here so it is decided rather than discovered on 30 September. Three ways out, in order of preference:

1. **A disposable QA tenant** on this environment, or a second environment, where writes are permitted. Restores full automated coverage and is the only option that satisfies the criterion as written.
2. **A time-boxed write window** — an agreed slot in which the suite may drive one PQ through the lifecycle in a named tenant, with the records left in place for inspection rather than deleted.
3. **Manual demonstration** of the lifecycle at the gate, with the automated suite covering traversal, authorisation and isolation only. The criterion is then met by a human, and the suite does not regress-test the workflow.

Until one is chosen, the lifecycle half is a *blocked* row in `gaps.md`, owner Akhilesh, with S2-QA-01 named as what it blocks.

### 9.3 S4-QA-01

The same journeys against the production topology, plus a timed config-only onboarding of a third tenant. The onboarding clock is itself the exit criterion, and that measurement necessarily writes — it requires the same decision as §9.2.

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
- **Every URL and identity comes from the environment.** `PQA_BASE_URL` defaults to nothing, not to a hardcoded host — the suite must never be one edited constant away from probing the wrong deployment.
- **No credential or identity is committed.** `PLATFORM_SEED_EMAIL` is a real account on a `.gov.in` domain; it lives in a gitignored `.env`. `.env.example` lists variable names only, consistent with this repository's existing `.gitignore` policy.
- `README.md` states prerequisites plainly: the base URL, the seeded persona accounts and which are confirmed to exist, mock-authentication availability, and which optional credentials unlock families 4, 5 and 8.
- HTML and JUnit reporters. Non-zero exit on regression only.
- **The suite identifies itself.** Every request carries a `User-Agent` naming the suite and the run id, so its traffic is separable from real usage in the deployed environment's logs. Adversarial probes against shared infrastructure that cannot be told apart from an actual attack are an operational hazard, not a test.

## 12. Delivery schedule

The target environment was under deployment on Mon 21 Sep. Work is ordered so that everything not requiring a reachable URL happens first, and nothing on the critical path waits on the deployment finishing.

| When | Deliverable | Needs the URL? | Tracker |
|---|---|---|---|
| Mon 21 Sep | Route inventory and data classification, from source; fixture scaffolding; gap reporter | No | S1-QA-01 |
| Tue 22 Sep | Tenant and persona discovery against the live environment; families 1, 2, 6 | Yes | S1-QA-01 |
| Wed 23 Sep | Families 3, 7; the HTTP-measurable half of 8; family 9 probes | Yes | S1-QA-01, informs S1-DO-02 |
| Thu 24 Sep | Skip-with-reason wiring for 4, 5 and the database half of 8; `gaps.md`; README; daily CI job | Partly | S1-QA-01 |
| **Fri 25 Sep** | **Hand over: suite runs daily, gaps named, not-measured rows owned** | — | **S1-QA-01 exit** |
| Sat 26 – Tue 29 Sep | API contract suite; read-only browser traversal from Playwright MCP observation | Yes | S2-QA-01 |
| **Wed 30 Sep** | **Demo acceptance gate** | — | **S2-QA-01** |
| Oct | Production-topology re-run; timed third-tenant onboarding (needs the §9.2 decision) | Yes | S4-QA-01 |

Families 4, 5 and 8 are scheduled to *exist as skipped probes with named owners*, not to pass. Family 9 is expected to fail. The §9.2 lifecycle decision is needed before Fri 25 Sep if S2-QA-01 is to be met by automation rather than by demonstration.

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
| Three of S1-QA-01's five named attack families are unmeasurable without infrastructure credentials, so Friday's deliverable is thinner than the criterion reads | Reported as *not measured* with Bhupendra named per row, never as passing. Escalate on Mon 22 Sep — a read-scoped S3 key, OpenSearch credential and Postgres DSN turn three skipped families into real results within a day |
| S2-QA-01's two-tenant lifecycle cannot be automated under the non-destructive constraint | §9.2 states the conflict and three ways out. A decision is needed before Fri 25 Sep; until then it is a blocked row in `gaps.md` owned by Akhilesh |
| Only one identity is confirmed, so the persona matrix collapses and families 3 and 8 lose their attacker | Personas are discovered, not assumed; an unavailable persona skips its tests with reason. Seeding three more accounts is a one-line ask, listed as a prerequisite in the README |
| Adversarial probes against shared infrastructure are mistaken for a real attack, or disturb the team's work | Non-destructive by construction; every request carries an identifying `User-Agent` and run id (§11); the suite aborts cleanly if the base URL is unreachable rather than retrying against a deploying environment |
| Families 4, 5 and 9 fail or stay unmeasured, and a permanently red suite stops being read | The three-state reporter (§10); tracked gaps do not fail the run; the register names an owner per row |
| The deployed environment changes underneath the suite mid-sprint, and a failure is read as a regression when it was a deployment | Every run records the environment's reported build and tenant set in the report header, so a step change is visible rather than inferred |
| The gap register becomes public before remediation | Repository made private 2026-09-21 with zero forks; `inventory/` must be excised before any future re-publication |
| Playwright MCP observation is unavailable, so journeys get written from route source and miss real behaviour | Journeys are explicitly deferred to the S2 window rather than guessed at during S1 |

---

## 15. Revision history

| Date | Change |
|---|---|
| 2026-09-21 | Initial design. Target was a locally-run stack: dedicated disposable `qa` tenant provisioned and dropped per run, Commerce read-only, full destructive PQ lifecycle automated. |
| 2026-09-21 | **Retargeted to the shared deployed environment `https://pqa.myscheme.in/`.** Testing is now non-destructive throughout (§3, §4); `tenant.ts` discovers tenants instead of provisioning them (§5.2); personas are discovered and may be unavailable (§5.2); families 4, 5 and the database half of 8 become *not measured* pending credentials from DevOps (§7.4, §7.5, §7.8); the automated PQ lifecycle is blocked and S2-QA-01's exit criterion is at risk (§9.2); schedule reordered so URL-independent work precedes the deployment completing (§12). |
