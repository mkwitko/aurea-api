# Dashboard — where am I in the loop, and what do I do next

**Status:** approved design, not yet planned
**Repos:** `aurea-back` (one read slice) and `aurea-web` (the page)
**Phase:** MVP Step 7 (`docs/development/mvp.md` §8), not an engineering phase of its own

## 1. Why now

`docs/development/mvp.md` §4 lists, in scope: *"Basic dashboard: the loop state and
history."* §8 makes it Step 7, the last step before shipping to design partners.

Every other loop stage now has a screen. Business context, ICP, goal, research,
strategy, experiment, outcome and learning are all reachable and all tested. What is
missing is the answer to the question a founder actually opens the app with on day
five: *where am I, and what do I do next?*

Today `/app` answers a different question. `DashboardPage.tsx` is a five-step setup
checklist — business, ICP, goal, research, strategy — and it stops at strategy. It is
an onboarding aid, and a good one, but it has nothing to say to a founder whose
experiment ended two days ago and who does not remember that recording the outcome is
the next move. It shows no loop state and no history.

`mvp.md` §9 sets activation at one full loop within seven days, and §10 names the
failure signal this screen exists to prevent: *"Nobody returns with an outcome → loop
too slow or low value."* A founder who cannot see that an outcome is owed is a founder
who does not return with one.

## 2. Scope

One backend read slice and one page. No new entity, no migration, no new write path,
no new agent.

Explicitly **not** in this spec:

- **Analytics Agent lite** (`mvp.md` §4: *"interpret the outcome, propose a learning
  candidate"*). It is the other open MVP gap and gets its own spec. Until it lands,
  the `LEARN` stage points the founder at the existing manual learning form.
- **New write UI.** `OutcomesSection` and `LearningsSection` already exist on the
  experiment detail page. Every next action that writes something deep-links there.
- **Multi-loop views.** See §3.6.

## 3. Decisions

### 3.1 The Experiment is the spine

There is no loop or iteration entity, and this spec does not add one. `Experiment`
already carries `strategyId` and `hypothesisId` as non-nullable columns and owns
`outcomes[]` and `learnings[]`, so one row plus its relations spells out the whole
post-strategy chain. Walking down from `Goal` instead would have to cope with
`Strategy ↔ Goal` being many-to-many and with a goal carrying several concurrent
experiments, which turns "where am I" into a plural answer needing a tie-break rule
anyway.

**Spine pick:** the latest `Experiment` where `status != CANCELLED`, ordered
`createdAt desc, id desc`. The id breaks ties so the answer is deterministic.

Deliberately *not* "the latest non-terminal experiment." A `COMPLETED` experiment is
precisely where the outcome and learning stages live.
`docs/development/phase-06-experiments.md` §1 is explicit: *"An experiment is not
successful merely because it completed."* `COMPLETED` means it ran to its end, not
that the loop is closed.

**Loop number** = the count of non-cancelled experiments in the workspace. The spine
is the newest of them, so that count *is* its ordinal. Derived, never stored. When
setup is complete and no experiment exists yet, the number is `1` — the loop being set
up, not a zeroth loop.

### 3.2 The stage machine

Eleven stages in one flat enum: five setup, six loop.

**Setup gate.** Evaluated in order; the first false one is the stage. The detection
rules are the ones `DashboardPage.tsx` uses today, carried over unchanged:

| Stage | True when |
|---|---|
| `BUSINESS` | `GET /business` returns a business |
| `ICP` | ≥1 ICP |
| `GOAL` | ≥1 Goal |
| `RESEARCH` | ≥1 AgentRun with `taskType: research-growth-context`, **any status** |
| `STRATEGY` | ≥1 Strategy |

`RESEARCH` counts a run of any status on purpose. The existing comment in
`DashboardPage.tsx` states the reason and it still holds: a founder whose run failed
still did the step, and the checklist's job is to move them along, not to grade the
outcome.

**Loop stages,** once all five setup steps pass:

| Spine | Stage | `nextAction.kind` |
|---|---|---|
| none | `EXPERIMENT` | `DESIGN_EXPERIMENT` |
| `DRAFT` | `RUN` | `PLAN_EXPERIMENT` |
| `PLANNED` | `RUN` | `APPROVE_EXPERIMENT` |
| `APPROVED` | `RUN` | `START_EXPERIMENT` |
| `RUNNING`, `endDate` null or future | `RUN` | `WAIT_FOR_EXPERIMENT` |
| `RUNNING`, `endDate` in the past | `RUN` | `COMPLETE_EXPERIMENT` |
| `PAUSED` | `RUN` | `RESUME_EXPERIMENT` |
| `COMPLETED`, no outcomes | `OUTCOME` | `RECORD_OUTCOME` |
| `COMPLETED`, a `VALIDATED` learning exists | `COMPLETE` | `START_NEXT_LOOP` |
| `COMPLETED`, a `CANDIDATE` learning exists | `VALIDATE` | `VALIDATE_LEARNING` |
| `COMPLETED`, otherwise (no learnings, or all `REJECTED`/`ARCHIVED`) | `LEARN` | `WRITE_LEARNING` |

The four `COMPLETED` rows are evaluated in exactly that order: outcomes, then
validated, then candidate, then fall through to `LEARN`. A rejected candidate
therefore returns the founder to writing a learning rather than stranding the loop.

When more than one `CANDIDATE` learning exists, `nextAction.learningId` is the oldest
of them (`createdAt asc`, `id asc` to break ties) — the one that has been waiting
longest, and a deterministic answer.

Every action offered is a **legal transition** under the table in
`src/http/api/experiments/experiments.domain.ts`. A `PLANNED` experiment is offered
approve, not start; there is no path that suggests a move the API would reject with
`Cannot move experiment from X to Y`.

`WAIT_FOR_EXPERIMENT` is a stage with no action. It renders as text with the end
date, not a button. A dashboard that always demands a click will invent work.

### 3.3 `endDate` is the planned end, and that is accepted

`phase-06-experiments.md` §2 says *"Start/complete set `startedAt`/`completedAt`
timestamps."* `startedAt` does not exist on the model; the columns are `startDate`,
`endDate` and `completedAt`. The doc overstates what was built.

The `COMPLETE_EXPERIMENT` rule therefore reads the *planned* `endDate`, not a real
one. For the MVP that is the right reading anyway — the planned window is the one the
founder agreed to when they approved the experiment — and no column is added here.
The drift is recorded, not fixed.

### 3.4 The payload carries no prose and no URLs

Two constraints on the response shape, both load-bearing.

**No sentences.** The web app ships EN, PT and ES. Every string in the response is
either an enum member or data the founder typed. `"Research found 6 findings"` is
`t('app.dashboard.recent.RESEARCH_COMPLETED', { count: 6 })`, rendered client-side. A
backend that returns display copy cannot be translated.

**No hrefs.** Recent items carry `refType` + `refId`; next actions carry
`experimentId` / `learningId`. React Router paths belong to the web repo. The backend
has no opinion about `/app/experiments/:id`.

### 3.5 History is derived from columns that already exist

No events table, no `AuditLog`, no migration. `mvp.md` §6 defers `Decision` and
`AuditLog`, and this screen does not need them:

| kind | source |
|---|---|
| `GOAL_SET` | `Goal.createdAt` |
| `RESEARCH_COMPLETED` | `AgentRun.completedAt`, `taskType: research-growth-context`, `status: COMPLETED`; `count` from the findings in `output` |
| `STRATEGY_ACCEPTED` | `Strategy.createdAt` where `sourceAgentRunId != null` — it came from the agent |
| `STRATEGY_CREATED` | `Strategy.createdAt` where `sourceAgentRunId == null` — hand-written |
| `EXPERIMENT_CREATED` | `Experiment.createdAt` |
| `EXPERIMENT_COMPLETED` | `Experiment.completedAt` (non-null only) |
| `OUTCOME_RECORDED` | `Outcome.observedAt` |
| `LEARNING_CREATED` | `Learning.createdAt` |
| `LEARNING_VALIDATED` | `Learning.validatedAt` (non-null only) |

Max eight items, `at` descending, merged and truncated in the domain rather than the
database.

The cost of deriving instead of recording: the feed shows creations and terminal
timestamps, not intermediate status changes. There is no row anywhere that says an
experiment moved `PLANNED → APPROVED` on Tuesday. Recording that is the `Decision`
entity's job and `mvp.md` §6 defers it.

### 3.6 One loop at a time

Two experiments open at once means the newer one is "the loop" and the older is absent
from the panel. It stays reachable at `/app/experiments`. The MVP proves one pass of
the loop (`mvp.md` §3), so this is accepted rather than designed around with a
multi-loop UI.

### 3.7 The checklist swaps rather than stacking or dying

While any setup step is incomplete, the checklist is the hero and the loop panel is
absent — `loop` is `null` in the contract, so this is not a rendering preference. Once
all five pass, the loop panel becomes the hero and the checklist collapses to a single
expandable `Setup 5/5` row.

The alternatives were stacking both forever, which leaves a day-30 founder staring at
a permanently complete checklist, and deleting the checklist on the grounds that the
next-action fallback already names the first setup gap. The fallback does name it, but
a single next action gives no sense of distance to activation, and `mvp.md` §9 targets
that distance in days. The existing component and its tests survive.

## 4. Contract

`GET /dashboard`, `operationId: getDashboard`, workspace-scoped, read-only.

```ts
{
  setup: { business: bool, icp: bool, goal: bool, research: bool,
           strategy: bool, completed: int, total: 5 },

  stage: 'BUSINESS'|'ICP'|'GOAL'|'RESEARCH'|'STRATEGY'
       | 'EXPERIMENT'|'RUN'|'OUTCOME'|'LEARN'|'VALIDATE'|'COMPLETE',

  nextAction: {
    kind: 'SET_UP_BUSINESS'|'DEFINE_ICP'|'SET_GOAL'|'RUN_RESEARCH'|'CHOOSE_STRATEGY'
        | 'DESIGN_EXPERIMENT'|'PLAN_EXPERIMENT'|'APPROVE_EXPERIMENT'|'START_EXPERIMENT'
        | 'WAIT_FOR_EXPERIMENT'|'COMPLETE_EXPERIMENT'|'RESUME_EXPERIMENT'
        | 'RECORD_OUTCOME'|'WRITE_LEARNING'|'VALIDATE_LEARNING'|'START_NEXT_LOOP',
    subjectLabel: string | null,   // the experiment's own name
    experimentId: uuid | null,
    learningId: uuid | null,
    endDate: string | null,        // set only for WAIT_FOR_EXPERIMENT
  },

  loop: null | {                   // null whenever setup is incomplete
    number: int,
    goal:       { id, name, metric, targetValue, unit } | null,
    strategy:   { id, name } | null,
    experiment: { id, name, status, metric, endDate } | null,
    rail: [{ node: 'STRATEGY'|'EXPERIMENT'|'OUTCOME'|'LEARNING',
             state: 'DONE'|'CURRENT'|'TODO' }],
  },

  recent: [{                       // max 8, `at` desc
    at: string,
    kind: 'GOAL_SET'|'RESEARCH_COMPLETED'|'STRATEGY_ACCEPTED'|'STRATEGY_CREATED'
        | 'EXPERIMENT_CREATED'|'EXPERIMENT_COMPLETED'|'OUTCOME_RECORDED'
        | 'LEARNING_CREATED'|'LEARNING_VALIDATED',
    refType: 'GOAL'|'STRATEGY'|'EXPERIMENT'|'OUTCOME'|'LEARNING'|'AGENT_RUN',
    refId: string,
    label: string,                 // user data: the entity's own name
    count: int | null,             // findings, on RESEARCH_COMPLETED
    value: float | null,           // on OUTCOME_RECORDED
    unit: string | null,           // on OUTCOME_RECORDED
  }],
}
```

**The rail** is four nodes derived from the stage, never stored. `DONE` first:
`STRATEGY` once setup passes, `EXPERIMENT` when the spine is `COMPLETED`, `OUTCOME`
with ≥1 outcome, `LEARNING` when a `VALIDATED` learning exists. Then one node is
promoted to `CURRENT` by the stage, since the stage names and the node names are not
the same set:

| Stage | `CURRENT` node |
|---|---|
| `EXPERIMENT`, `RUN` | `EXPERIMENT` |
| `OUTCOME` | `OUTCOME` |
| `LEARN`, `VALIDATE` | `LEARNING` |
| `COMPLETE` | none — all four are `DONE` |

Anything neither `DONE` nor `CURRENT` is `TODO`. Setup stages never reach the rail;
`loop` is `null` there.

**Which goal is *the* goal.** `Strategy ↔ Goal` is many-to-many, so this needs a rule
or it drifts. With a spine: the spine's strategy's goals, `createdAt asc`, take the
first. Without a spine: the latest `ACTIVE` Goal, falling back to the latest Goal of
any status.

**Which strategy.** With a spine: the spine's `strategyId`, always — the experiment
names its own strategy. Without a spine: the latest Strategy where
`status != ARCHIVED`, `createdAt desc`. Both are non-null whenever `loop` is non-null,
because setup completing requires ≥1 strategy; the schema keeps them nullable so a
strategy archived after the fact cannot 500 the dashboard.

## 5. Backend structure

```
src/http/api/dashboard/
  dashboard.schema.ts        the zod contract above
  dashboard.repository.ts    the reads, every one filtered on workspaceId
  dashboard.domain.ts        pure: snapshot -> { stage, nextAction, rail }
  dashboard.domain.test.ts   §3.2 case by case
  get-dashboard/
    get-dashboard.controller.ts
    get-dashboard.service.ts
    get-dashboard.test.ts    route-level, seeded workspaces
  index.ts
```

`dashboard.domain.ts` takes a plain snapshot and touches neither Prisma nor Fastify,
which is what makes the §3.2 table testable as unit cases with no HTTP and no
database.

The repository issues its reads in one `Promise.all`. The feed reads take 8 rows
ordered descending; the setup checks are counts or first-row lookups, not lists. Every
table involved is indexed on `workspaceId`.

Being a `GET`, the route never meets `denyReadOnly` (`src/plugins/tenant.ts`). The
route test asserts that read-only members can reach it, so a later refactor cannot
quietly turn this endpoint into a write.

## 6. Web structure

```
src/components/dashboard/
  SetupChecklist.tsx     today's five-step list, extracted, plus a `collapsed` prop
  LoopPanel.tsx          loop number, goal header, rail
  NextActionCard.tsx     the NEXT box and its button
  RecentActivity.tsx     the feed
src/lib/dashboard-actions.ts   nextAction.kind -> { route, i18nKey, variant }
```

`DashboardPage.tsx` drops its five hooks (`useGetBusiness`, `useListIcps`,
`useListGoals`, `useListStrategies`, `useListAgentRuns`) for one generated
`useGetDashboard` and branches once on `setup.completed === setup.total`.

`dashboard-actions.ts` follows the existing `experiment-actions.ts` and
`learning-actions.ts` pattern: a pure map with a unit test, no JSX. Route knowledge
lives only there.

| kind | route |
|---|---|
| `SET_UP_BUSINESS` | `/app/business/setup` — this kind only occurs when no business exists |
| `DEFINE_ICP` | `/app/icps/new` |
| `SET_GOAL` | `/app/goals/new` |
| `RUN_RESEARCH` | `/app/research` |
| `CHOOSE_STRATEGY` | `/app/strategies` |
| `DESIGN_EXPERIMENT`, `START_NEXT_LOOP` | `/app/experiments/new` |
| `PLAN_`/`APPROVE_`/`START_`/`RESUME_`/`COMPLETE_EXPERIMENT`, `RECORD_OUTCOME`, `WRITE_LEARNING`, `VALIDATE_LEARNING` | `/app/experiments/:experimentId` |
| `WAIT_FOR_EXPERIMENT` | none — text, no button |

Outcome and learning actions land on the experiment detail page because
`OutcomesSection` and `LearningsSection` already live there. Per §2 this spec adds no
write UI.

**Help coverage.** `web/CLAUDE.md` rule 2 requires every user-facing domain term to be
explainable in-app. The rail introduces *Loop*, and puts *Outcome* and *Learning* on
the dashboard for the first time, so each rail node carries a `Help` popover. The
checklist's five steps already have theirs.

**i18n.** New keys under `app.dashboard.`: `next.<KIND>`, `recent.<KIND>`,
`rail.<NODE>`, and the collapsed-setup row — in all three locales.
`src/i18n/dashboard-keys.test.ts` mirrors `research-keys.test.ts` and asserts every
enum member has a key in EN, PT and ES, so a kind added later cannot ship as a raw
key in Portuguese. The enum lists that test walks are read from the generated
constants, not hand-mirrored — a hand-copied list makes the guarantee decorative,
because a new server-side enum member changes nothing in it.

**`stage` gets no copy and is rendered nowhere.** It ships on the response as the
machine-readable answer to "where am I", and the rail is the founder-facing one: the
node marked `CURRENT` already says the same thing in the vocabulary the screen
teaches. An eleven-value stage label beside it would restate the rail in words a
non-technical founder has no use for. The field stays in the contract because the
next iteration — activation progress, or a stage-specific empty state — will want to
branch on it without another round trip.

`recent.OUTCOME_RECORDED` interpolates `{{label}} {{value}} {{unit}}` — the metric's
name, not just its number, or the row reads "Outcome recorded: 18" and the founder
cannot tell what was measured. `next.WAIT_FOR_EXPERIMENT` interpolates `{{date}}`, and
`recent.RESEARCH_COMPLETED` needs `_one`/`_other` in each locale, since PT and ES do
not pluralize as EN does.

Two test files split that guarantee, as they already do for research:
`dashboard-keys.test.ts` asserts every key the components use — including every enum
member behind a template-literal lookup — resolves in `en.json`, and the existing
`locales.test.ts` asserts PT and ES have exactly the keys EN has. Neither file alone
covers it; together they do.

**States.** Loading renders skeletons for both cards. Errors use the existing
`api-errors` treatment with a retry. Setup incomplete means checklist only. Setup
complete with no experiment shows the rail with `STRATEGY` done and a
`DESIGN_EXPERIMENT` call to action.

**Tests.** Web tests here stub `fetch` at the boundary via `src/test/stub-fetch.ts` and
render through `renderWithProviders`, exercising the real generated hook against
`src/api/client.ts` — the house pattern, and not hook mocking.
`DashboardPage.test.tsx` currently stubs five endpoints; it is rewritten to stub
`/dashboard` alone. New tests cover
`SetupChecklist` in both states, `LoopPanel` (rail states, null goal, null
experiment), `NextActionCard` (button versus text-only `WAIT_FOR_EXPERIMENT`),
`RecentActivity` (every kind, plus empty), and `dashboard-actions` as a table test
that fails when a kind is added without a route.

## 7. Order of work

The backend slice lands first. Then `pnpm api:generate` regenerates the Kubb client.
Only then can the web work start, since it consumes the generated `useGetDashboard`
hook.

## 8. Exit criteria

- A founder mid-setup sees the checklist and the first missing step as their next
  action; `loop` is `null`.
- A founder with all five setup steps done sees loop number, goal, rail and one next
  action drawn from §3.2.
- Every next action offered is a legal transition per `experiments.domain.ts`.
- `WAIT_FOR_EXPERIMENT` renders the end date and no button.
- A rejected learning candidate returns the founder to `WRITE_LEARNING`, not to a
  dead loop.
- The recent feed shows at most eight items, newest first, covering goals, research,
  strategies, experiments, outcomes and learnings.
- No next action, recent kind or rail node is missing a key in EN, PT or ES —
  `dashboard-keys.test.ts` for resolution, `locales.test.ts` for parity, with the
  enum lists read from the generated constants rather than hand-mirrored. `stage`
  carries no copy by design (§6).
- The page header does not tell a founder past setup to finish setting up.
- With several `CANDIDATE` learnings, `VALIDATE_LEARNING` names the oldest one.
- The endpoint is reachable by a read-only member.
- No new table and no migration.

## 9. Known drift, recorded not fixed

- `phase-06-experiments.md` §2 documents a `startedAt` column that does not exist
  (§3.3).
- The `WorkspaceProviderKey` naming drift noted during the Strategy Agent review is
  still open and unrelated to this work.
