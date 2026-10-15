# Outcome & Learning — closing the loop

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Completing an experiment currently leads nowhere. After this, a founder records what was measured, and turns it into a learning that is explicitly validated or rejected — the second half of the one claim the MVP exists to prove (`docs/development/mvp.md`: "sees a measured outcome, and gets a learning that improves the next decision").

**Architecture:** Backend-first, the reverse of the experiments UI: `Outcome` and `Learning` already exist as Prisma models with **no routes at all**, so no migration is needed — two new vertical-slice modules, then the UI on the experiment detail page. Learning gets a transition table like hypotheses and experiments; the frontend mirrors it the same way and reuses `LifecycleActions` unchanged.

**Tech Stack:** Backend — Node 22, Fastify 5, TypeScript strict ESM, Zod, Prisma, Vitest. Frontend — Vite 6, React 19, Kubb 4 + TanStack Query 5, Tailwind + shadcn/ui, react-i18next (en/pt/es), Vitest + Testing Library.

## Survey (read on 2026-07-28)

`Outcome` — `workspaceId`, `experimentId`, `metric`, `value: Float`, `unit?`, `observedAt` (defaults now), `source` (defaults `"USER"`). One experiment may have many.

`Learning` — `workspaceId`, `experimentId?`, `title`, `statement`, `evidence: Json?`, `confidence: ConfidenceLevel`, `status: LearningStatus` (CANDIDATE | VALIDATED | REJECTED | ARCHIVED), `validatedAt?`, `archivedAt?`.

Documented rules this plan must honour:

| Rule | Source | Consequence |
|---|---|---|
| "An Outcome without provenance is not trustworthy" | `docs/domains/analytics.md` §11 | `source` and `observedAt` are part of the contract, never silently defaulted away in the UI |
| "Completed ≠ Successful" | `docs/domains/experiments.md` §14 | completing an experiment must not imply success anywhere in the UI |
| "Success Criteria must be defined before the Experiment runs. Defining success after seeing results invalidates the test." | `docs/domains/experiments.md` §13 | **currently violated** — see Task 1 |
| "Learning candidates are proposed… They are validated before becoming canonical knowledge" | `docs/domains/analytics.md` §19 | a candidate is never knowledge; validation is a human act |

**Found while surveying — a live violation.** `PATCH /experiments/:id` (`update-experiment.controller.ts`) accepts a partial of the create body at *any* status, so `metric`, `baselineValue`, `targetValue` and `successCriteria` can be rewritten while the experiment is RUNNING or after it is COMPLETED. Today that is merely wrong; once outcomes exist it becomes the exact failure §13 warns about — record a disappointing number, then move the goalposts. Task 1 fixes it before anything can depend on it.

## Global Constraints

- **Backend:** vertical slice per use case — `src/http/api/<resource>/<use-case>/{controller,schema,service}.ts`, shared `<resource>.schema.ts`. Controllers declare `operationId` and a response schema.
- **New modules must register the guards**: `authenticate`, `resolveTenant`, `denyReadOnly` — the last one is what keeps a VIEWER read-only, and a module that forgets it is writable by anyone (see `src/http/api/write-guard.test.ts`, and extend its tables with the new routes).
- **Frontend:** domain data only through Kubb hooks; Tailwind + shadcn only; every domain term gets a `<Help>`; all copy in en/pt/es (the parity test in `web/src/i18n/locales.test.ts` must stay green).
- **No `any`, no casual `as`.** Status unions come from the generated types.
- **TDD, no exceptions.** Watch each test fail for the stated reason first.
- **Gate per task:** `back/` → `pnpm typecheck` + `pnpm test`; `web/` → `pnpm typecheck` + `pnpm test`, plus `pnpm build` on the last frontend task.
- Two independent repos — commit inside the one you changed.

---

## Task 1 (back) — Freeze the measurement contract once the experiment leaves planning

- [x] RED: `PATCH /experiments/:id` changing `successCriteria`, `metric`, `baselineValue` or `targetValue` is refused for an experiment in APPROVED, RUNNING, PAUSED, COMPLETED or CANCELLED, and still allowed in DRAFT and PLANNED. Descriptive fields (name, description, objective, channel, audience) stay editable at any status — fixing a typo in the audience is not moving the goalposts.
- [x] GREEN: guard in the update slice with a named error (`AUR-*`, message naming the rule), registered in the error catalogue and its i18n files.
- [x] Document the rule where the route is documented (`docs/architecture/` or the experiments domain doc, matching whichever already describes the route).

## Task 2 (back) — `Outcome`: record what was measured

- [x] RED: `POST /experiments/:id/outcomes` — creates with `value` required, `metric` defaulting to the experiment's own metric (an outcome that silently measures something else is unreadable), `unit` and `observedAt` optional (`observedAt` defaults to now), `source` defaulting to `"USER"`; 404 for an experiment outside the tenant's workspace; refused for a VIEWER.
- [x] RED: rejects a non-finite `value` and an `observedAt` in the future — a measurement that has not happened yet is not an observation.
- [x] RED: `GET /experiments/:id/outcomes` returns them newest-first, scoped to the workspace.
- [x] GREEN: `src/http/api/outcomes/` module (repository, schema, two slices, `index.ts` with all three guard hooks).
- [x] Extend `write-guard.test.ts` with the new write route.

## Task 3 (back) — `Learning`: propose, then validate or reject

**Proposed transition table** (nothing in `docs/` defines one; modelled on hypotheses, where terminal states are terminal):

```
CANDIDATE → VALIDATED, REJECTED
VALIDATED → ARCHIVED
REJECTED  → ARCHIVED
ARCHIVED  → (terminal)
```

- [x] RED: `POST /learnings` creates a CANDIDATE (`title`, `statement` required; `experimentId`, `evidence`, `confidence` optional) — never VALIDATED, whatever the body asks for. A candidate is not knowledge.
- [x] RED: `GET /learnings?experimentId=&status=` filters server-side.
- [x] RED: `POST /learnings/:id/{validate,reject,archive}` follow the table above; every illegal move is refused with the same shape the other two domains use; `validate` stamps `validatedAt`, `archive` stamps `archivedAt`.
- [x] GREEN: `src/http/api/learnings/` module with a `learnings.domain.ts` transition table + `assertLearningTransition`, mirroring `hypotheses.domain.ts` exactly so the three lifecycles stay recognisable.
- [x] Extend `write-guard.test.ts`.

## Task 4 (back) — Publish the contract

- [x] Regenerate the OpenAPI dump and copy it to `web/api.json` (the web client is generated from it, so this is the handoff).
- [x] Update the docs that describe the loop's routes; note explicitly that `Outcome` provenance is currently `source` + `observedAt` only — `docs/domains/analytics.md` §11 also asks for external reference, ingestion method and confidence, which manual entry does not have. Flagged, not faked.

## Task 5 (web) — Data layer

- [x] Regenerate the Kubb hooks from the new `api.json`.
- [x] `src/api/modules/{outcomes,learnings}.ts` with `queryKeyRoot`, exported from `index.ts`.
- [x] RED: `src/lib/learning-actions.ts` — `allowedLearningActions(status)` asserted as a whole map against the Task 3 table, same shape as `experiment-actions.ts` (each move names its route and whether it is terminal).

## Task 6 (web) — Outcomes on the experiment detail page

- [x] RED: the page lists recorded outcomes with value, unit, when they were observed and where they came from; the record form posts `value` (and `unit`/`observedAt` when given) against the experiment; a rejected record keeps what was typed and shows the server's reason.
- [x] RED: **progress is shown, a verdict is not.** With a `targetValue`, show the measured value against it as a plain comparison; with none, show the value alone. Nothing anywhere may print "successful" — `successCriteria` is free text, so no honest verdict can be computed from it, and §14 forbids inferring one from completion.
- [x] GREEN, invalidating both the outcome list and the experiment detail key (the list root does not match the detail key — see `ExperimentDetailPage`).

## Task 7 (web) — Learnings on the experiment detail page

- [x] RED: proposing a learning posts `experimentId`, `title` and `statement` and it appears as a candidate; `LifecycleActions` offers only the legal moves per status; validate/reject/archive update the row; a refused move keeps the old status with the server's reason.
- [x] GREEN reusing `LifecycleActions` and `learning-actions` — if the component needs changing to fit a third domain, fix it there with its own test.
- [x] Rejecting and archiving confirm first: both are terminal in the table.

## Task 8 (web) — Completing an experiment leads somewhere

- [x] RED: after a COMPLETED experiment with no outcome yet, the page asks for the measurement; with an outcome and no learning, it asks what was learned. Today completing is a dead end, which is precisely the half of the loop the MVP has to prove.
- [x] GREEN, wording that never implies the experiment succeeded.

## Task 9 (web) — Copy and gate

- [x] All new strings in en/pt/es; `locales.test.ts` green.
- [x] Gate: `pnpm typecheck`, `pnpm test`, `pnpm build`.

---

## Risks & open decisions

| Item | Position |
|---|---|
| **Learning transitions are undocumented** | The table in Task 3 is a proposal. It is the one thing in this plan I would want confirmed before building on it — mainly whether a REJECTED learning should be archivable at all, or simply stay rejected. |
| No stored success verdict | Deliberate. `successCriteria` is free text; deriving "successful" from it would be invention, and deriving it from completion is what §14 forbids. Show the number against the target and let the human write the learning. |
| Outcome provenance thinner than `analytics.md` §11 | Accepted for manual entry, documented in Task 4. Adding `externalRef`/`ingestionMethod`/`confidence` is a migration that belongs with the first real analytics integration, not here. |
| Multiple outcomes per experiment | Supported by the model and the docs (§29: "one or more Outcomes"). The UI lists all of them rather than pretending there is one. |
| Scope creep into the Analytics Agent | Out. Interpreting outcomes and *proposing* learning candidates is feature C; here every learning is written by a human. |
