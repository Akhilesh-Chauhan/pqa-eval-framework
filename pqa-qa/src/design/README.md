# Design suite (`DS-*`): tests written only from the UI/UX design

The cases come from the **FINAL** page of the designer's canvas "Parliament Questions — Multi-tenant Dashboard
System", read on 20 Nov 2026 (version `1795166459-872b`); the designer confirmed FINAL is the only page in use. No
product code, spec or older catalogue was used. The catalogue is `PQA Builder/qa/design-test-cases.md` (260 cases),
the design snapshot is in `PQA Builder/qa/design/`. FINAL has no Super Admin screens, so the Super Admin suite
(`src/admin`, `npm run qa:admin`) is unchanged and not part of this suite.

| Project | What it runs | Signs in as |
| --- | --- | --- |
| `design-session` | Renews each saved persona session; fails fast on a dead one | — |
| `design-portal` | `src/design/portal/*.spec.ts`: shell and button system, Executive / Parliament user / My Division dashboards, question detail and collaboration, Executive AI Assistant and its answer quality | `executive`, `parliament`, `division` |
| `unit` (part) | `src/support/design-labels.spec.ts`: every label the specs use is still on its design board | — |

## Run it

```bash
npm run qa:design:login -- executive      # once per persona: executive, parliament, division (OTP by email)
npm run qa:design                         # design-portal
npm run qa:pipeline                       # typecheck → unit (incl. design label check) → design suites
```

Set in `.env` (see `.env.example`): `PQA_DESIGN_TENANT`, `PQA_DESIGN_<PERSONA>_EMAIL`, `PQA_DESIGN_INVENTORY`, and for
the cases that need them `PQA_DESIGN_ALLOW_WRITES`, `PQA_DESIGN_QUESTION_PDF`, `PQA_DESIGN_COLLAB_EMAIL`,
`PQA_DESIGN_GOLDEN_ROOT`, `PQA_DESIGN_QUALITY_LIMIT`. Point `PQA_CATALOGUE` at `qa/design-test-cases.md` to see each
case's catalogue row and the coverage in the HTML report.

## How outcomes read

- **Failed**: the build differs from the design. Each failure is a design gap to raise or a bug to fix.
- **Not measured**: the case needs a persona session, data the tenant does not have yet, or an open design
  question (`design-OQ`) to be settled. Never a pass.
- **AI Assistant answers**: the answer *format* of Generate reply and Search documents is still under consideration,
  so format cases only record what was shown (`format-observed`) and never fail. Answer *quality* is the focus:
  `exec-ai-quality.spec.ts` asks golden-set questions (`qa/golden/assistant/meity-2part-short-v1`,
  `meity-search-v1`), fails on missing answers, cited held-out documents and missed search documents, and writes every
  answer to `runs/design/<run id>/` for the fact judge (`judge_prompts_v1.md`).

`Auto-W` cases (they send, save, submit or upload) run only with `PQA_DESIGN_ALLOW_WRITES=true`, on a QA-owned
disposable tenant. Never upload a Monsoon 2026 answer document (holdout).

## When the designer publishes a new version

1. Download the canvas files and re-run `PQA Builder/qa/design/extract_design.py <project folder> <design_inventory.json>`.
2. `npm run qa:design:labels`: it lists every label the specs use that the design no longer has.
3. Update the affected cases in `qa/design-test-cases.md` and the matching labels file in `src/design/labels/`.
4. Refresh the knowledge graph (`qa/design/pqa-ui-design-2026-11-20/graphify-out/`) with graphify `--update`.
