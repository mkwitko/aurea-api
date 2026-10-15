# Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the setup-only `/app` screen with one that says where the growth loop stands and what the founder should do next.

**Architecture:** One read-only backend slice, `GET /dashboard`, computes stage, next action, rail and a recent-activity feed from data that already exists — the latest non-cancelled Experiment is the spine, everything else is derived. The stage machine is a pure function over a snapshot object, so it is unit-tested with no HTTP and no database. The web page then holds one generated hook and four presentational components.

**Tech Stack:** Backend Fastify + zod (`fastify-type-provider-zod`) + Prisma, vitest. Frontend Vite + React 19 + TypeScript strict, react-router-dom 7, Tailwind + shadcn/ui, react-i18next, Kubb-generated client, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-07-29-dashboard-design.md`

## Global Constraints

- **No new table, no migration, no new write path, no new agent.** Spec §2.
- **The payload carries no prose.** Every string in the response is an enum member or data the founder typed. Display copy is rendered client-side through `t(...)`. Spec §3.4.
- **The payload carries no URLs.** Recent items carry `refType` + `refId`; next actions carry `experimentId` / `learningId`. Route knowledge lives only in `web/src/lib/dashboard-actions.ts`. Spec §3.4.
- **Every action offered must be a legal transition** under `src/http/api/experiments/experiments.domain.ts`. Spec §3.2.
- **All backend reads are filtered on `workspaceId`.** No query in this slice may omit it.
- **Frontend styling is Tailwind + shadcn/ui only. Never plain CSS, no ad-hoc `style={{}}`** (except an inline `width: %` on a progress bar, which the existing `DashboardPage.tsx` already does). `web/CLAUDE.md` rule 1.
- **Every user-facing domain term gets a `Help` popover.** `web/CLAUDE.md` rule 2.
- **All server calls go through the generated client / `src/lib/api.ts`. No raw `fetch`.** `web/CLAUDE.md` rule 3.
- **Typed everything. No `any`.** `web/CLAUDE.md` rule 6.
- **Backend `pnpm test` and `pnpm typecheck` must pass at every commit.** Same for the web repo.
- Backend repo: `/home/mauricio.oliveira/Documentos/Coding/futuro/aurea/back`. Web repo: `/home/mauricio.oliveira/Documentos/Coding/futuro/aurea/web`. Tasks 1–4 are backend; 5–10 are web.

### The stage table, quoted verbatim from spec §3.2

Setup gate — evaluated in order, the first false one is the stage:

| Stage | True when |
|---|---|
| `BUSINESS` | `GET /business` returns a business |
| `ICP` | ≥1 ICP |
| `GOAL` | ≥1 Goal |
| `RESEARCH` | ≥1 AgentRun with `taskType: research-growth-context`, **any status** |
| `STRATEGY` | ≥1 Strategy |

Loop stages, once all five setup steps pass:

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

> "The four `COMPLETED` rows are evaluated in exactly that order: outcomes, then validated, then candidate, then fall through to `LEARN`."
>
> "When more than one `CANDIDATE` learning exists, `nextAction.learningId` is the oldest of them (`createdAt asc`, `id asc` to break ties)."

Rail `CURRENT` mapping, verbatim from spec §4:

| Stage | `CURRENT` node |
|---|---|
| `EXPERIMENT`, `RUN` | `EXPERIMENT` |
| `OUTCOME` | `OUTCOME` |
| `LEARN`, `VALIDATE` | `LEARNING` |
| `COMPLETE` | none — all four are `DONE` |

> "`DONE` first: `STRATEGY` once setup passes, `EXPERIMENT` when the spine is `COMPLETED`, `OUTCOME` with ≥1 outcome, `LEARNING` when a `VALIDATED` learning exists." Anything neither `DONE` nor `CURRENT` is `TODO`.

Spine pick, verbatim from spec §3.1:

> "the latest `Experiment` where `status != CANCELLED`, ordered `createdAt desc, id desc`."
>
> "**Loop number** = the count of non-cancelled experiments in the workspace. […] When setup is complete and no experiment exists yet, the number is `1`."

## File Structure

**Backend** (`back/src/http/api/dashboard/`)

| File | Responsibility |
|---|---|
| `dashboard.schema.ts` | The zod response contract and every enum in it. Source of the exported TS types. |
| `dashboard.domain.ts` | Pure. Snapshot → `{ stage, nextAction, rail }`, plus the recent-feed builder. No Prisma, no Fastify. |
| `dashboard.domain.test.ts` | Stage table case by case. |
| `dashboard.recent.test.ts` | Recent-feed builder: kind mapping, ordering, cap. |
| `dashboard.repository.ts` | The reads. Every one filtered on `workspaceId`. Returns raw rows; derives nothing. |
| `dashboard.repository.test.ts` | Asserts scoping, spine ordering, and non-cancelled filter. |
| `get-dashboard/get-dashboard.service.ts` | Wires repository → domain → response shape. |
| `get-dashboard/get-dashboard.controller.ts` | Route registration and schema binding. |
| `get-dashboard/get-dashboard.test.ts` | Route level, prisma fake, read-only reachability. |
| `index.ts` | Registers the route with the auth/tenant/read-only hooks. |

Modified: `back/src/app.ts` (register the module).

**Web**

| File | Responsibility |
|---|---|
| `src/lib/dashboard-actions.ts` | Pure map: `nextAction.kind` → route + i18n key + button variant; `refType` → route. |
| `src/lib/dashboard-actions.test.ts` | Table test over every enum member. |
| `src/components/dashboard/SetupChecklist.tsx` | Today's five-step list, extracted, plus a `collapsed` prop. |
| `src/components/dashboard/LoopPanel.tsx` | Loop number, goal header, rail with `Help` per node. |
| `src/components/dashboard/NextActionCard.tsx` | The NEXT box; button, or text when `WAIT_FOR_EXPERIMENT`. |
| `src/components/dashboard/RecentActivity.tsx` | The feed. |
| `src/i18n/dashboard-keys.test.ts` | Every `app.dashboard.*` key the components use resolves in `en.json`. |

Modified: `src/pages/DashboardPage.tsx` (thin, one hook), `src/pages/DashboardPage.test.tsx` (rewritten against `/dashboard`), `src/i18n/locales/{en,pt,es}.json`.

---

## Task 1: Response contract and the stage machine

**Files:**
- Create: `back/src/http/api/dashboard/dashboard.schema.ts`
- Create: `back/src/http/api/dashboard/dashboard.domain.ts`
- Test: `back/src/http/api/dashboard/dashboard.domain.test.ts`

**Interfaces:**
- Consumes: `ExperimentStatus`, `LearningStatus` from `@prisma/client`.
- Produces:
  - `dashboardResponse` (zod object), `dashboardStage`, `nextActionKind`, `railNode`, `railState`, `recentKind`, `recentRefType` (zod enums)
  - types `DashboardStage`, `NextActionKind`, `RailNode`, `DashboardResponse`, `DashboardRecentItem`
  - `interface DashboardSnapshot`, `interface SpineExperiment`, `interface SpineLearning`
  - `resolveDashboardState(snapshot: DashboardSnapshot): { stage: DashboardStage; nextAction: DashboardNextAction; rail: DashboardRailEntry[] }`
  - `isSetupComplete(snapshot: DashboardSnapshot): boolean`
  - `setupFlags(snapshot: DashboardSnapshot): { business: boolean; icp: boolean; goal: boolean; research: boolean; strategy: boolean; completed: number; total: 5 }`

- [ ] **Step 1: Write the failing test**

Create `back/src/http/api/dashboard/dashboard.domain.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ExperimentStatus, LearningStatus } from '@prisma/client';
import {
  isSetupComplete,
  resolveDashboardState,
  setupFlags,
  type DashboardSnapshot,
  type SpineExperiment,
} from './dashboard.domain.js';

const NOW = new Date('2026-07-29T12:00:00Z');

function snapshot(overrides: Partial<DashboardSnapshot> = {}): DashboardSnapshot {
  return {
    now: NOW,
    hasBusiness: true,
    icpCount: 1,
    goalCount: 1,
    researchRunCount: 1,
    strategyCount: 1,
    spine: null,
    ...overrides,
  };
}

function spine(overrides: Partial<SpineExperiment> = {}): SpineExperiment {
  return {
    id: 'e1',
    name: 'LinkedIn DM test',
    status: ExperimentStatus.DRAFT,
    metric: 'replies',
    endDate: null,
    strategyId: 's1',
    outcomeCount: 0,
    learnings: [],
    ...overrides,
  };
}

describe('setup gate', () => {
  // The first false step is the stage, in the order business, icp, goal,
  // research, strategy. Each case leaves everything before it satisfied.
  it.each([
    [{ hasBusiness: false }, 'BUSINESS', 'SET_UP_BUSINESS'],
    [{ icpCount: 0 }, 'ICP', 'DEFINE_ICP'],
    [{ goalCount: 0 }, 'GOAL', 'SET_GOAL'],
    [{ researchRunCount: 0 }, 'RESEARCH', 'RUN_RESEARCH'],
    [{ strategyCount: 0 }, 'STRATEGY', 'CHOOSE_STRATEGY'],
  ] as const)('%o resolves to %s', (patch, stage, kind) => {
    const state = resolveDashboardState(snapshot(patch));
    expect(state.stage).toBe(stage);
    expect(state.nextAction.kind).toBe(kind);
  });

  it('reports the earliest gap even when a later step is already done', () => {
    // A founder who set a goal before defining an ICP is still sent to the ICP.
    const state = resolveDashboardState(snapshot({ icpCount: 0, goalCount: 3 }));
    expect(state.stage).toBe('ICP');
  });

  it('counts a research run of any status as done', () => {
    // Spec §3.2: a founder whose run failed still did the step.
    expect(setupFlags(snapshot({ researchRunCount: 1 })).research).toBe(true);
  });

  it('reports progress as a count out of five', () => {
    const flags = setupFlags(snapshot({ researchRunCount: 0, strategyCount: 0 }));
    expect(flags.completed).toBe(3);
    expect(flags.total).toBe(5);
    expect(isSetupComplete(snapshot({ strategyCount: 0 }))).toBe(false);
    expect(isSetupComplete(snapshot())).toBe(true);
  });

  it('leaves the rail empty while setup is incomplete', () => {
    expect(resolveDashboardState(snapshot({ hasBusiness: false })).rail).toEqual([]);
  });
});

describe('loop stages', () => {
  it('asks for an experiment when setup is done and none exists', () => {
    const state = resolveDashboardState(snapshot({ spine: null }));
    expect(state.stage).toBe('EXPERIMENT');
    expect(state.nextAction.kind).toBe('DESIGN_EXPERIMENT');
  });

  it.each([
    [ExperimentStatus.DRAFT, 'PLAN_EXPERIMENT'],
    [ExperimentStatus.PLANNED, 'APPROVE_EXPERIMENT'],
    [ExperimentStatus.APPROVED, 'START_EXPERIMENT'],
    [ExperimentStatus.PAUSED, 'RESUME_EXPERIMENT'],
  ] as const)('%s offers %s', (status, kind) => {
    const state = resolveDashboardState(snapshot({ spine: spine({ status }) }));
    expect(state.stage).toBe('RUN');
    expect(state.nextAction.kind).toBe(kind);
    expect(state.nextAction.experimentId).toBe('e1');
    expect(state.nextAction.subjectLabel).toBe('LinkedIn DM test');
  });

  it('waits while a running experiment has not reached its end date', () => {
    const endDate = new Date('2026-08-10T00:00:00Z');
    const state = resolveDashboardState(
      snapshot({ spine: spine({ status: ExperimentStatus.RUNNING, endDate }) }),
    );
    expect(state.nextAction.kind).toBe('WAIT_FOR_EXPERIMENT');
    expect(state.nextAction.endDate).toEqual(endDate);
  });

  it('waits when a running experiment has no end date at all', () => {
    const state = resolveDashboardState(
      snapshot({ spine: spine({ status: ExperimentStatus.RUNNING, endDate: null }) }),
    );
    expect(state.nextAction.kind).toBe('WAIT_FOR_EXPERIMENT');
    expect(state.nextAction.endDate).toBeNull();
  });

  it('asks to complete a running experiment once its end date has passed', () => {
    const state = resolveDashboardState(
      snapshot({
        spine: spine({ status: ExperimentStatus.RUNNING, endDate: new Date('2026-07-27T00:00:00Z') }),
      }),
    );
    expect(state.nextAction.kind).toBe('COMPLETE_EXPERIMENT');
    // Only the ask changes; the stage is still RUN.
    expect(state.stage).toBe('RUN');
  });

  it('treats an end date exactly at now as reached', () => {
    const state = resolveDashboardState(
      snapshot({ spine: spine({ status: ExperimentStatus.RUNNING, endDate: NOW }) }),
    );
    expect(state.nextAction.kind).toBe('COMPLETE_EXPERIMENT');
  });
});

describe('after the experiment completes', () => {
  const completed = { status: ExperimentStatus.COMPLETED } as const;

  it('asks for an outcome first', () => {
    const state = resolveDashboardState(snapshot({ spine: spine({ ...completed, outcomeCount: 0 }) }));
    expect(state.stage).toBe('OUTCOME');
    expect(state.nextAction.kind).toBe('RECORD_OUTCOME');
  });

  it('asks for a learning once an outcome exists', () => {
    const state = resolveDashboardState(snapshot({ spine: spine({ ...completed, outcomeCount: 1 }) }));
    expect(state.stage).toBe('LEARN');
    expect(state.nextAction.kind).toBe('WRITE_LEARNING');
  });

  it('asks to validate a candidate learning', () => {
    const state = resolveDashboardState(
      snapshot({
        spine: spine({
          ...completed,
          outcomeCount: 1,
          learnings: [{ id: 'l1', status: LearningStatus.CANDIDATE, createdAt: new Date('2026-07-28T00:00:00Z') }],
        }),
      }),
    );
    expect(state.stage).toBe('VALIDATE');
    expect(state.nextAction.kind).toBe('VALIDATE_LEARNING');
    expect(state.nextAction.learningId).toBe('l1');
  });

  it('names the oldest candidate when several are waiting', () => {
    const state = resolveDashboardState(
      snapshot({
        spine: spine({
          ...completed,
          outcomeCount: 1,
          learnings: [
            { id: 'newer', status: LearningStatus.CANDIDATE, createdAt: new Date('2026-07-28T00:00:00Z') },
            { id: 'older', status: LearningStatus.CANDIDATE, createdAt: new Date('2026-07-26T00:00:00Z') },
          ],
        }),
      }),
    );
    expect(state.nextAction.learningId).toBe('older');
  });

  it('closes the loop once a learning is validated', () => {
    const state = resolveDashboardState(
      snapshot({
        spine: spine({
          ...completed,
          outcomeCount: 1,
          learnings: [
            { id: 'l1', status: LearningStatus.CANDIDATE, createdAt: new Date('2026-07-27T00:00:00Z') },
            { id: 'l2', status: LearningStatus.VALIDATED, createdAt: new Date('2026-07-28T00:00:00Z') },
          ],
        }),
      }),
    );
    // Validated wins over a still-open candidate: the loop did produce a
    // learning, so the next move is the next loop.
    expect(state.stage).toBe('COMPLETE');
    expect(state.nextAction.kind).toBe('START_NEXT_LOOP');
  });

  it('sends a rejected-only candidate back to writing a learning', () => {
    const state = resolveDashboardState(
      snapshot({
        spine: spine({
          ...completed,
          outcomeCount: 1,
          learnings: [
            { id: 'l1', status: LearningStatus.REJECTED, createdAt: new Date('2026-07-27T00:00:00Z') },
            { id: 'l2', status: LearningStatus.ARCHIVED, createdAt: new Date('2026-07-28T00:00:00Z') },
          ],
        }),
      }),
    );
    expect(state.stage).toBe('LEARN');
    expect(state.nextAction.kind).toBe('WRITE_LEARNING');
  });
});

describe('rail', () => {
  it('marks strategy done and experiment current before an experiment exists', () => {
    expect(resolveDashboardState(snapshot({ spine: null })).rail).toEqual([
      { node: 'STRATEGY', state: 'DONE' },
      { node: 'EXPERIMENT', state: 'CURRENT' },
      { node: 'OUTCOME', state: 'TODO' },
      { node: 'LEARNING', state: 'TODO' },
    ]);
  });

  it('keeps experiment current while it runs', () => {
    const rail = resolveDashboardState(
      snapshot({ spine: spine({ status: ExperimentStatus.RUNNING }) }),
    ).rail;
    expect(rail).toEqual([
      { node: 'STRATEGY', state: 'DONE' },
      { node: 'EXPERIMENT', state: 'CURRENT' },
      { node: 'OUTCOME', state: 'TODO' },
      { node: 'LEARNING', state: 'TODO' },
    ]);
  });

  it('moves to outcome once the experiment completed', () => {
    const rail = resolveDashboardState(
      snapshot({ spine: spine({ status: ExperimentStatus.COMPLETED }) }),
    ).rail;
    expect(rail).toEqual([
      { node: 'STRATEGY', state: 'DONE' },
      { node: 'EXPERIMENT', state: 'DONE' },
      { node: 'OUTCOME', state: 'CURRENT' },
      { node: 'LEARNING', state: 'TODO' },
    ]);
  });

  it('marks every node done when the loop is complete', () => {
    const rail = resolveDashboardState(
      snapshot({
        spine: spine({
          status: ExperimentStatus.COMPLETED,
          outcomeCount: 2,
          learnings: [{ id: 'l1', status: LearningStatus.VALIDATED, createdAt: NOW }],
        }),
      }),
    ).rail;
    expect(rail.every((entry) => entry.state === 'DONE')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && pnpm vitest run src/http/api/dashboard/dashboard.domain.test.ts`
Expected: FAIL — `Failed to resolve import "./dashboard.domain.js"`.

- [ ] **Step 3: Write the schema**

Create `back/src/http/api/dashboard/dashboard.schema.ts`:

```ts
import { z } from 'zod';

export const dashboardStage = z.enum([
  'BUSINESS',
  'ICP',
  'GOAL',
  'RESEARCH',
  'STRATEGY',
  'EXPERIMENT',
  'RUN',
  'OUTCOME',
  'LEARN',
  'VALIDATE',
  'COMPLETE',
]);

export const nextActionKind = z.enum([
  'SET_UP_BUSINESS',
  'DEFINE_ICP',
  'SET_GOAL',
  'RUN_RESEARCH',
  'CHOOSE_STRATEGY',
  'DESIGN_EXPERIMENT',
  'PLAN_EXPERIMENT',
  'APPROVE_EXPERIMENT',
  'START_EXPERIMENT',
  'WAIT_FOR_EXPERIMENT',
  'COMPLETE_EXPERIMENT',
  'RESUME_EXPERIMENT',
  'RECORD_OUTCOME',
  'WRITE_LEARNING',
  'VALIDATE_LEARNING',
  'START_NEXT_LOOP',
]);

export const railNode = z.enum(['STRATEGY', 'EXPERIMENT', 'OUTCOME', 'LEARNING']);
export const railState = z.enum(['DONE', 'CURRENT', 'TODO']);

export const recentKind = z.enum([
  'GOAL_SET',
  'RESEARCH_COMPLETED',
  'STRATEGY_ACCEPTED',
  'STRATEGY_CREATED',
  'EXPERIMENT_CREATED',
  'EXPERIMENT_COMPLETED',
  'OUTCOME_RECORDED',
  'LEARNING_CREATED',
  'LEARNING_VALIDATED',
]);

export const recentRefType = z.enum(['GOAL', 'STRATEGY', 'EXPERIMENT', 'OUTCOME', 'LEARNING', 'AGENT_RUN']);

// Deliberately free of prose and of URLs: `label` is what the founder typed,
// everything else is an enum or an id. Display copy is the web app's job
// (three locales), and route shapes are React Router's (spec §3.4).
export const dashboardRecentItem = z.object({
  at: z.date(),
  kind: recentKind,
  refType: recentRefType,
  refId: z.string(),
  label: z.string(),
  count: z.number().int().nullable(),
  value: z.number().nullable(),
  unit: z.string().nullable(),
});

export const dashboardNextAction = z.object({
  kind: nextActionKind,
  subjectLabel: z.string().nullable(),
  experimentId: z.string().nullable(),
  learningId: z.string().nullable(),
  endDate: z.date().nullable(),
});

export const dashboardSetup = z.object({
  business: z.boolean(),
  icp: z.boolean(),
  goal: z.boolean(),
  research: z.boolean(),
  strategy: z.boolean(),
  completed: z.number().int(),
  total: z.literal(5),
});

export const dashboardRailEntry = z.object({ node: railNode, state: railState });

export const dashboardLoop = z.object({
  number: z.number().int(),
  goal: z
    .object({
      id: z.string(),
      name: z.string(),
      metric: z.string(),
      targetValue: z.number().nullable(),
      unit: z.string().nullable(),
    })
    .nullable(),
  strategy: z.object({ id: z.string(), name: z.string() }).nullable(),
  experiment: z
    .object({
      id: z.string(),
      name: z.string(),
      status: z.enum(['DRAFT', 'PLANNED', 'APPROVED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED']),
      metric: z.string(),
      endDate: z.date().nullable(),
    })
    .nullable(),
  rail: z.array(dashboardRailEntry),
});

export const dashboardResponse = z.object({
  setup: dashboardSetup,
  stage: dashboardStage,
  nextAction: dashboardNextAction,
  // Null while setup is incomplete: there is no loop to describe yet, and the
  // web app should not have to decide that for itself (spec §3.7).
  loop: dashboardLoop.nullable(),
  recent: z.array(dashboardRecentItem),
});

export type DashboardStage = z.infer<typeof dashboardStage>;
export type NextActionKind = z.infer<typeof nextActionKind>;
export type RailNode = z.infer<typeof railNode>;
export type DashboardRailEntry = z.infer<typeof dashboardRailEntry>;
export type DashboardNextAction = z.infer<typeof dashboardNextAction>;
export type DashboardRecentItem = z.infer<typeof dashboardRecentItem>;
export type DashboardSetup = z.infer<typeof dashboardSetup>;
export type DashboardResponse = z.infer<typeof dashboardResponse>;
```

- [ ] **Step 4: Write the stage machine**

Create `back/src/http/api/dashboard/dashboard.domain.ts`:

```ts
import { ExperimentStatus, LearningStatus } from '@prisma/client';
import type {
  DashboardNextAction,
  DashboardRailEntry,
  DashboardSetup,
  DashboardStage,
  NextActionKind,
  RailNode,
} from './dashboard.schema.js';

export interface SpineLearning {
  id: string;
  status: LearningStatus;
  createdAt: Date;
}

export interface SpineExperiment {
  id: string;
  name: string;
  status: ExperimentStatus;
  metric: string;
  endDate: Date | null;
  /** Carried so `loopContext` needs no second read for the strategy. */
  strategyId: string;
  outcomeCount: number;
  learnings: SpineLearning[];
}

/**
 * Everything the stage machine needs, and nothing it does not. Kept as plain
 * data so the whole of spec §3.2 is testable without HTTP or a database — the
 * repository's job is to fill this in, not to decide anything with it.
 */
export interface DashboardSnapshot {
  now: Date;
  hasBusiness: boolean;
  icpCount: number;
  goalCount: number;
  researchRunCount: number;
  strategyCount: number;
  /** Latest non-cancelled experiment, or null. See spec §3.1. */
  spine: SpineExperiment | null;
}

/**
 * The setup gate, in order. The first entry whose `done` is false is the
 * stage. `RESEARCH` counts a run of any status on purpose: a founder whose run
 * failed still did the step, and this screen moves them along rather than
 * grading the outcome (spec §3.2).
 */
const SETUP: { key: keyof Omit<DashboardSetup, 'completed' | 'total'>; stage: DashboardStage; kind: NextActionKind; done: (s: DashboardSnapshot) => boolean }[] = [
  { key: 'business', stage: 'BUSINESS', kind: 'SET_UP_BUSINESS', done: (s) => s.hasBusiness },
  { key: 'icp', stage: 'ICP', kind: 'DEFINE_ICP', done: (s) => s.icpCount > 0 },
  { key: 'goal', stage: 'GOAL', kind: 'SET_GOAL', done: (s) => s.goalCount > 0 },
  { key: 'research', stage: 'RESEARCH', kind: 'RUN_RESEARCH', done: (s) => s.researchRunCount > 0 },
  { key: 'strategy', stage: 'STRATEGY', kind: 'CHOOSE_STRATEGY', done: (s) => s.strategyCount > 0 },
];

export function setupFlags(snapshot: DashboardSnapshot): DashboardSetup {
  const flags = {
    business: SETUP[0]!.done(snapshot),
    icp: SETUP[1]!.done(snapshot),
    goal: SETUP[2]!.done(snapshot),
    research: SETUP[3]!.done(snapshot),
    strategy: SETUP[4]!.done(snapshot),
  };
  const completed = Object.values(flags).filter(Boolean).length;
  return { ...flags, completed, total: 5 };
}

export function isSetupComplete(snapshot: DashboardSnapshot): boolean {
  return SETUP.every((step) => step.done(snapshot));
}

type Resolution = { stage: DashboardStage; kind: NextActionKind; learningId?: string };

function resolveCompleted(spine: SpineExperiment): Resolution {
  // Order is load-bearing (spec §3.2): outcomes, then validated, then
  // candidate, then fall through to LEARN.
  if (spine.outcomeCount === 0) return { stage: 'OUTCOME', kind: 'RECORD_OUTCOME' };
  if (spine.learnings.some((l) => l.status === LearningStatus.VALIDATED)) {
    return { stage: 'COMPLETE', kind: 'START_NEXT_LOOP' };
  }
  const candidates = spine.learnings
    .filter((l) => l.status === LearningStatus.CANDIDATE)
    // Oldest first: the one that has been waiting longest, and a
    // deterministic answer when timestamps collide.
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const oldest = candidates[0];
  if (oldest) return { stage: 'VALIDATE', kind: 'VALIDATE_LEARNING', learningId: oldest.id };
  // No learnings, or every one of them rejected/archived: the loop is not
  // closed, so ask for a learning again rather than stranding it.
  return { stage: 'LEARN', kind: 'WRITE_LEARNING' };
}

function resolveLoop(spine: SpineExperiment | null, now: Date): Resolution {
  if (!spine) return { stage: 'EXPERIMENT', kind: 'DESIGN_EXPERIMENT' };
  switch (spine.status) {
    case ExperimentStatus.DRAFT:
      return { stage: 'RUN', kind: 'PLAN_EXPERIMENT' };
    case ExperimentStatus.PLANNED:
      return { stage: 'RUN', kind: 'APPROVE_EXPERIMENT' };
    case ExperimentStatus.APPROVED:
      return { stage: 'RUN', kind: 'START_EXPERIMENT' };
    case ExperimentStatus.PAUSED:
      return { stage: 'RUN', kind: 'RESUME_EXPERIMENT' };
    case ExperimentStatus.RUNNING:
      // `endDate` is the *planned* end — there is no startedAt/actual-end
      // column on the model (spec §3.3).
      return spine.endDate !== null && spine.endDate.getTime() <= now.getTime()
        ? { stage: 'RUN', kind: 'COMPLETE_EXPERIMENT' }
        : { stage: 'RUN', kind: 'WAIT_FOR_EXPERIMENT' };
    case ExperimentStatus.COMPLETED:
      return resolveCompleted(spine);
    case ExperimentStatus.CANCELLED:
      // Unreachable: the spine query excludes CANCELLED. Handled rather than
      // thrown so a future query change degrades to "design an experiment"
      // instead of 500ing the dashboard.
      return { stage: 'EXPERIMENT', kind: 'DESIGN_EXPERIMENT' };
  }
}

const RAIL_ORDER: RailNode[] = ['STRATEGY', 'EXPERIMENT', 'OUTCOME', 'LEARNING'];

/** Which rail node a loop stage puts the founder on. COMPLETE promotes none. */
const CURRENT_NODE: Partial<Record<DashboardStage, RailNode>> = {
  EXPERIMENT: 'EXPERIMENT',
  RUN: 'EXPERIMENT',
  OUTCOME: 'OUTCOME',
  LEARN: 'LEARNING',
  VALIDATE: 'LEARNING',
};

function resolveRail(stage: DashboardStage, spine: SpineExperiment | null): DashboardRailEntry[] {
  const done: Record<RailNode, boolean> = {
    // Reaching the rail at all means setup passed, which required a strategy.
    STRATEGY: true,
    EXPERIMENT: spine?.status === ExperimentStatus.COMPLETED,
    OUTCOME: (spine?.outcomeCount ?? 0) > 0,
    LEARNING: spine?.learnings.some((l) => l.status === LearningStatus.VALIDATED) ?? false,
  };
  const current = CURRENT_NODE[stage];
  return RAIL_ORDER.map((node) => ({
    node,
    state: done[node] ? 'DONE' : node === current ? 'CURRENT' : 'TODO',
  }));
}

export function resolveDashboardState(snapshot: DashboardSnapshot): {
  stage: DashboardStage;
  nextAction: DashboardNextAction;
  rail: DashboardRailEntry[];
} {
  const gap = SETUP.find((step) => !step.done(snapshot));
  if (gap) {
    return {
      stage: gap.stage,
      nextAction: {
        kind: gap.kind,
        subjectLabel: null,
        experimentId: null,
        learningId: null,
        endDate: null,
      },
      // No loop yet, so no rail. `loop` is null in the response either way.
      rail: [],
    };
  }

  const { stage, kind, learningId } = resolveLoop(snapshot.spine, snapshot.now);
  return {
    stage,
    nextAction: {
      kind,
      subjectLabel: snapshot.spine?.name ?? null,
      experimentId: snapshot.spine?.id ?? null,
      learningId: learningId ?? null,
      endDate: kind === 'WAIT_FOR_EXPERIMENT' ? (snapshot.spine?.endDate ?? null) : null,
    },
    rail: resolveRail(stage, snapshot.spine),
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd back && pnpm vitest run src/http/api/dashboard/dashboard.domain.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Typecheck**

Run: `cd back && pnpm typecheck`
Expected: no output, exit 0.

- [ ] **Step 7: Commit**

```bash
cd back
git add src/http/api/dashboard/dashboard.schema.ts src/http/api/dashboard/dashboard.domain.ts src/http/api/dashboard/dashboard.domain.test.ts
git commit -m "feat(dashboard): derive the loop stage and the next action

The stage machine is a pure function over a snapshot: the setup gate in
order, then the spine experiment's status, then outcomes and learnings.
Every action it offers is a legal experiment transition."
```

---

## Task 2: Recent-activity feed

**Files:**
- Modify: `back/src/http/api/dashboard/dashboard.domain.ts` (append the builder)
- Test: `back/src/http/api/dashboard/dashboard.recent.test.ts`

**Interfaces:**
- Consumes: `DashboardRecentItem` from `dashboard.schema.ts` (Task 1).
- Produces: `interface RecentSources`, `buildRecent(sources: RecentSources, limit?: number): DashboardRecentItem[]` — default limit 8.

- [ ] **Step 1: Write the failing test**

Create `back/src/http/api/dashboard/dashboard.recent.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildRecent, type RecentSources } from './dashboard.domain.js';

function sources(overrides: Partial<RecentSources> = {}): RecentSources {
  return {
    goals: [],
    researchRuns: [],
    strategies: [],
    experiments: [],
    outcomes: [],
    learnings: [],
    ...overrides,
  };
}

describe('buildRecent', () => {
  it('is empty for a workspace with nothing in it', () => {
    expect(buildRecent(sources())).toEqual([]);
  });

  it('maps a goal to GOAL_SET carrying its own name', () => {
    const items = buildRecent(
      sources({ goals: [{ id: 'g1', name: '30 trial signups/mo', createdAt: new Date('2026-07-19T00:00:00Z') }] }),
    );
    expect(items).toEqual([
      {
        at: new Date('2026-07-19T00:00:00Z'),
        kind: 'GOAL_SET',
        refType: 'GOAL',
        refId: 'g1',
        label: '30 trial signups/mo',
        count: null,
        value: null,
        unit: null,
      },
    ]);
  });

  it('counts the findings on a completed research run', () => {
    const items = buildRecent(
      sources({
        researchRuns: [
          {
            id: 'r1',
            completedAt: new Date('2026-07-20T00:00:00Z'),
            output: { findings: [{}, {}, {}, {}, {}, {}] },
          },
        ],
      }),
    );
    expect(items[0]).toMatchObject({ kind: 'RESEARCH_COMPLETED', refType: 'AGENT_RUN', refId: 'r1', count: 6 });
  });

  it('survives a research run whose output is not the shape it expects', () => {
    // AgentRun.output is Json: a refused or half-written run can hold
    // anything. A dashboard is not the place to 500 over it.
    const items = buildRecent(
      sources({
        researchRuns: [
          { id: 'r1', completedAt: new Date('2026-07-20T00:00:00Z'), output: null },
          { id: 'r2', completedAt: new Date('2026-07-21T00:00:00Z'), output: { findings: 'nope' } },
          { id: 'r3', completedAt: new Date('2026-07-22T00:00:00Z'), output: 'a string' },
        ],
      }),
    );
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.count === null)).toBe(true);
  });

  it('skips a research run that never completed', () => {
    expect(buildRecent(sources({ researchRuns: [{ id: 'r1', completedAt: null, output: null }] }))).toEqual([]);
  });

  it('separates an agent-proposed strategy from a hand-written one', () => {
    const items = buildRecent(
      sources({
        strategies: [
          {
            id: 's1',
            name: 'founder-led outbound',
            createdAt: new Date('2026-07-22T00:00:00Z'),
            sourceAgentRunId: 'run-9',
          },
          { id: 's2', name: 'SEO', createdAt: new Date('2026-07-21T00:00:00Z'), sourceAgentRunId: null },
        ],
      }),
    );
    expect(items.map((i) => i.kind)).toEqual(['STRATEGY_ACCEPTED', 'STRATEGY_CREATED']);
  });

  it('emits both creation and completion for one experiment', () => {
    const items = buildRecent(
      sources({
        experiments: [
          {
            id: 'e1',
            name: 'LinkedIn DM test',
            createdAt: new Date('2026-07-24T00:00:00Z'),
            completedAt: new Date('2026-07-27T00:00:00Z'),
          },
        ],
      }),
    );
    expect(items.map((i) => i.kind)).toEqual(['EXPERIMENT_COMPLETED', 'EXPERIMENT_CREATED']);
  });

  it('carries an outcome value and unit through, labelled by its metric', () => {
    const items = buildRecent(
      sources({
        outcomes: [
          {
            id: 'o1',
            metric: 'replies',
            value: 18,
            unit: 'replies',
            observedAt: new Date('2026-07-27T00:00:00Z'),
          },
        ],
      }),
    );
    expect(items[0]).toMatchObject({ kind: 'OUTCOME_RECORDED', label: 'replies', value: 18, unit: 'replies' });
  });

  it('emits both creation and validation for one learning', () => {
    const items = buildRecent(
      sources({
        learnings: [
          {
            id: 'l1',
            title: 'personalization beats volume',
            createdAt: new Date('2026-07-28T00:00:00Z'),
            validatedAt: new Date('2026-07-29T00:00:00Z'),
          },
        ],
      }),
    );
    expect(items.map((i) => i.kind)).toEqual(['LEARNING_VALIDATED', 'LEARNING_CREATED']);
  });

  it('sorts every source together, newest first', () => {
    const items = buildRecent(
      sources({
        goals: [{ id: 'g1', name: 'goal', createdAt: new Date('2026-07-19T00:00:00Z') }],
        learnings: [{ id: 'l1', title: 'learning', createdAt: new Date('2026-07-28T00:00:00Z'), validatedAt: null }],
        outcomes: [{ id: 'o1', metric: 'replies', value: 18, unit: null, observedAt: new Date('2026-07-27T00:00:00Z') }],
      }),
    );
    expect(items.map((i) => i.kind)).toEqual(['LEARNING_CREATED', 'OUTCOME_RECORDED', 'GOAL_SET']);
  });

  it('caps the feed at eight items, keeping the newest', () => {
    const goals = Array.from({ length: 12 }, (_, index) => ({
      id: `g${index}`,
      name: `goal ${index}`,
      // index 11 is the newest.
      createdAt: new Date(Date.UTC(2026, 6, index + 1)),
    }));
    const items = buildRecent(sources({ goals }));
    expect(items).toHaveLength(8);
    expect(items[0]!.refId).toBe('g11');
    expect(items[7]!.refId).toBe('g4');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && pnpm vitest run src/http/api/dashboard/dashboard.recent.test.ts`
Expected: FAIL — `buildRecent is not a function` / no exported member.

- [ ] **Step 3: Append the builder**

Append to `back/src/http/api/dashboard/dashboard.domain.ts`:

```ts
import type { DashboardRecentItem } from './dashboard.schema.js';

/**
 * Raw rows the feed is derived from. Every field here is a column that
 * already exists: this screen adds no events table and no AuditLog, which
 * `mvp.md` §6 defers (spec §3.5). The cost is that the feed shows creations
 * and terminal timestamps, never intermediate status changes.
 */
export interface RecentSources {
  goals: { id: string; name: string; createdAt: Date }[];
  researchRuns: { id: string; completedAt: Date | null; output: unknown }[];
  strategies: { id: string; name: string; createdAt: Date; sourceAgentRunId: string | null }[];
  experiments: { id: string; name: string; createdAt: Date; completedAt: Date | null }[];
  outcomes: { id: string; metric: string; value: number; unit: string | null; observedAt: Date }[];
  learnings: { id: string; title: string; createdAt: Date; validatedAt: Date | null }[];
}

type PartialItem = Omit<DashboardRecentItem, 'count' | 'value' | 'unit'> &
  Partial<Pick<DashboardRecentItem, 'count' | 'value' | 'unit'>>;

function item(partial: PartialItem): DashboardRecentItem {
  return { count: null, value: null, unit: null, ...partial };
}

/**
 * How many findings a research run produced, or null when the output is not
 * the shape this expects. `AgentRun.output` is Json — a refused or
 * half-written run can hold anything, and a dashboard is the wrong place to
 * throw over it.
 */
function findingCount(output: unknown): number | null {
  if (typeof output !== 'object' || output === null) return null;
  const findings = (output as { findings?: unknown }).findings;
  return Array.isArray(findings) ? findings.length : null;
}

export function buildRecent(sources: RecentSources, limit = 8): DashboardRecentItem[] {
  const items: DashboardRecentItem[] = [];

  for (const goal of sources.goals) {
    items.push(item({ at: goal.createdAt, kind: 'GOAL_SET', refType: 'GOAL', refId: goal.id, label: goal.name }));
  }

  for (const run of sources.researchRuns) {
    if (!run.completedAt) continue;
    items.push(
      item({
        at: run.completedAt,
        kind: 'RESEARCH_COMPLETED',
        refType: 'AGENT_RUN',
        refId: run.id,
        // The run has no name of its own; the count is what the web app
        // renders, through a pluralized key.
        label: '',
        count: findingCount(run.output),
      }),
    );
  }

  for (const strategy of sources.strategies) {
    items.push(
      item({
        at: strategy.createdAt,
        // A strategy with a source run came out of the Strategy Agent and was
        // accepted; one without was written by hand.
        kind: strategy.sourceAgentRunId ? 'STRATEGY_ACCEPTED' : 'STRATEGY_CREATED',
        refType: 'STRATEGY',
        refId: strategy.id,
        label: strategy.name,
      }),
    );
  }

  for (const experiment of sources.experiments) {
    items.push(
      item({
        at: experiment.createdAt,
        kind: 'EXPERIMENT_CREATED',
        refType: 'EXPERIMENT',
        refId: experiment.id,
        label: experiment.name,
      }),
    );
    if (experiment.completedAt) {
      items.push(
        item({
          at: experiment.completedAt,
          kind: 'EXPERIMENT_COMPLETED',
          refType: 'EXPERIMENT',
          refId: experiment.id,
          label: experiment.name,
        }),
      );
    }
  }

  for (const outcome of sources.outcomes) {
    items.push(
      item({
        at: outcome.observedAt,
        kind: 'OUTCOME_RECORDED',
        refType: 'OUTCOME',
        refId: outcome.id,
        label: outcome.metric,
        value: outcome.value,
        unit: outcome.unit,
      }),
    );
  }

  for (const learning of sources.learnings) {
    items.push(
      item({
        at: learning.createdAt,
        kind: 'LEARNING_CREATED',
        refType: 'LEARNING',
        refId: learning.id,
        label: learning.title,
      }),
    );
    if (learning.validatedAt) {
      items.push(
        item({
          at: learning.validatedAt,
          kind: 'LEARNING_VALIDATED',
          refType: 'LEARNING',
          refId: learning.id,
          label: learning.title,
        }),
      );
    }
  }

  return items.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}
```

Move the added `import type { DashboardRecentItem }` up into the existing type-import from `./dashboard.schema.js` at the top of the file rather than leaving a second import statement.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd back && pnpm vitest run src/http/api/dashboard/dashboard.recent.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the whole backend suite and typecheck**

Run: `cd back && pnpm test && pnpm typecheck`
Expected: all green, no type errors.

- [ ] **Step 6: Commit**

```bash
cd back
git add src/http/api/dashboard/dashboard.domain.ts src/http/api/dashboard/dashboard.recent.test.ts
git commit -m "feat(dashboard): build the recent feed from columns that exist

Goals, completed research runs, strategies, experiments, outcomes and
learnings merge into one list, newest first, capped at eight. No events
table: the cost is that intermediate status changes are not in it."
```

---

## Task 3: Repository

**Files:**
- Create: `back/src/http/api/dashboard/dashboard.repository.ts`
- Test: `back/src/http/api/dashboard/dashboard.repository.test.ts`

**Interfaces:**
- Consumes: `RecentSources`, `SpineExperiment` from `dashboard.domain.ts` (Tasks 1–2).
- Produces: `createDashboardRepository(prisma: PrismaClient)` returning `{ snapshot(workspaceId: string, now: Date), recentSources(workspaceId: string), loopContext(workspaceId: string, spine: SpineExperiment | null) }`; type `DashboardRepository`.
  - `snapshot` returns `DashboardSnapshot`
  - `recentSources` returns `RecentSources`
  - `loopContext` returns `{ number: number; goal: {...} | null; strategy: {...} | null }`

- [ ] **Step 1: Write the failing test**

Create `back/src/http/api/dashboard/dashboard.repository.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExperimentStatus } from '@prisma/client';
import { createDashboardRepository } from './dashboard.repository.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const NOW = new Date('2026-07-29T12:00:00Z');

const SPINE_ROW = {
  id: 'e1',
  name: 'LinkedIn DM test',
  status: ExperimentStatus.COMPLETED,
  metric: 'replies',
  endDate: null,
  strategyId: 's1',
  _count: { outcomes: 2 },
  learnings: [],
};

function prismaFake(overrides: Record<string, unknown> = {}) {
  return {
    business: { findFirst: vi.fn().mockResolvedValue({ id: 'b1' }) },
    icp: { count: vi.fn().mockResolvedValue(1) },
    goal: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    agentRun: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([]) },
    strategy: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([]), findFirst: vi.fn().mockResolvedValue(null) },
    experiment: {
      findFirst: vi.fn().mockResolvedValue(SPINE_ROW),
      count: vi.fn().mockResolvedValue(3),
      findMany: vi.fn().mockResolvedValue([]),
    },
    outcome: { findMany: vi.fn().mockResolvedValue([]) },
    learning: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('snapshot', () => {
  it('reads the setup counts and the spine', async () => {
    const prisma = prismaFake();
    const repo = createDashboardRepository(prisma as never);

    const snapshot = await repo.snapshot(WORKSPACE_ID, NOW);

    expect(snapshot.hasBusiness).toBe(true);
    expect(snapshot.icpCount).toBe(1);
    expect(snapshot.spine).toEqual({
      id: 'e1',
      name: 'LinkedIn DM test',
      status: ExperimentStatus.COMPLETED,
      metric: 'replies',
      endDate: null,
      outcomeCount: 2,
      learnings: [],
    });
    expect(snapshot.now).toBe(NOW);
  });

  it('scopes every read to the workspace', async () => {
    const prisma = prismaFake();
    const repo = createDashboardRepository(prisma as never);

    await repo.snapshot(WORKSPACE_ID, NOW);

    // A read that forgets the tenant filter is the one bug in this slice that
    // leaks another customer's data, so it is asserted per call, not in bulk.
    for (const call of [
      prisma.business.findFirst,
      prisma.icp.count,
      prisma.goal.count,
      prisma.agentRun.count,
      prisma.strategy.count,
      prisma.experiment.findFirst,
    ]) {
      expect(call).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workspaceId: WORKSPACE_ID }) }));
    }
  });

  it('counts only research runs, of any status', async () => {
    const prisma = prismaFake();
    const repo = createDashboardRepository(prisma as never);

    await repo.snapshot(WORKSPACE_ID, NOW);

    expect(prisma.agentRun.count).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, taskType: 'research-growth-context' },
    });
  });

  it('picks the latest non-cancelled experiment, newest first, id breaking ties', async () => {
    const prisma = prismaFake();
    const repo = createDashboardRepository(prisma as never);

    await repo.snapshot(WORKSPACE_ID, NOW);

    expect(prisma.experiment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: WORKSPACE_ID, status: { not: ExperimentStatus.CANCELLED } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('reports a null spine for a workspace with no experiments', async () => {
    const prisma = prismaFake({
      experiment: { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
    });
    const repo = createDashboardRepository(prisma as never);

    expect((await repo.snapshot(WORKSPACE_ID, NOW)).spine).toBeNull();
  });
});

describe('loopContext', () => {
  it('numbers the loop by the count of non-cancelled experiments', async () => {
    const prisma = prismaFake({
      strategy: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue({ id: 's1', name: 'founder-led outbound' }),
      },
      goal: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue({ id: 'g1', name: '30 trials', metric: 'signups', targetValue: 30, unit: 'signups' }),
      },
    });
    const repo = createDashboardRepository(prisma as never);

    const context = await repo.loopContext(WORKSPACE_ID, {
      id: 'e1',
      name: 'LinkedIn DM test',
      status: ExperimentStatus.RUNNING,
      metric: 'replies',
      endDate: null,
      strategyId: 's1',
      outcomeCount: 0,
      learnings: [],
    });

    expect(context.number).toBe(3);
    expect(context.strategy).toEqual({ id: 's1', name: 'founder-led outbound' });
    expect(context.goal?.id).toBe('g1');
    expect(prisma.experiment.count).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, status: { not: ExperimentStatus.CANCELLED } },
    });
  });

  it('numbers the first loop 1 when no experiment exists yet', async () => {
    const prisma = prismaFake({
      experiment: { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      strategy: {
        count: vi.fn().mockResolvedValue(1),
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue({ id: 's1', name: 'founder-led outbound' }),
      },
    });
    const repo = createDashboardRepository(prisma as never);

    // Spec §3.1: the loop being set up is loop 1, not loop 0.
    expect((await repo.loopContext(WORKSPACE_ID, null)).number).toBe(1);
  });

  it('falls back to the latest non-archived strategy when there is no spine', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 's9', name: 'newest' });
    const prisma = prismaFake({
      experiment: { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
      strategy: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([]), findFirst },
    });
    const repo = createDashboardRepository(prisma as never);

    await repo.loopContext(WORKSPACE_ID, null);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: WORKSPACE_ID, status: { not: 'ARCHIVED' } },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });
});

describe('recentSources', () => {
  it('takes eight of each, newest first, scoped to the workspace', async () => {
    const prisma = prismaFake();
    const repo = createDashboardRepository(prisma as never);

    await repo.recentSources(WORKSPACE_ID);

    for (const call of [
      prisma.goal.findMany,
      prisma.strategy.findMany,
      prisma.experiment.findMany,
      prisma.outcome.findMany,
      prisma.learning.findMany,
      prisma.agentRun.findMany,
    ]) {
      expect(call).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 8,
          where: expect.objectContaining({ workspaceId: WORKSPACE_ID }),
        }),
      );
    }
  });

  it('reads only completed research runs for the feed', async () => {
    const prisma = prismaFake();
    const repo = createDashboardRepository(prisma as never);

    await repo.recentSources(WORKSPACE_ID);

    expect(prisma.agentRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: WORKSPACE_ID, taskType: 'research-growth-context', status: 'COMPLETED' },
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && pnpm vitest run src/http/api/dashboard/dashboard.repository.test.ts`
Expected: FAIL — cannot resolve `./dashboard.repository.js`.

- [ ] **Step 3: Write the repository**

Create `back/src/http/api/dashboard/dashboard.repository.ts`:

```ts
import { type PrismaClient, ExperimentStatus, StrategyStatus, GoalStatus, AgentRunStatus } from '@prisma/client';
import type { DashboardSnapshot, RecentSources, SpineExperiment } from './dashboard.domain.js';

/** The task type the Research Agent runs under. Mirrors `src/ai/agents/registry.ts`. */
const RESEARCH_TASK_TYPE = 'research-growth-context';

const NON_CANCELLED = { status: { not: ExperimentStatus.CANCELLED } } as const;

export function createDashboardRepository(prisma: PrismaClient) {
  return {
    /**
     * Everything the stage machine needs, in one round of parallel reads. The
     * setup checks are counts and first-row lookups, never lists — this screen
     * asks whether a step happened, not what it produced.
     */
    async snapshot(workspaceId: string, now: Date): Promise<DashboardSnapshot> {
      const [business, icpCount, goalCount, researchRunCount, strategyCount, spineRow] = await Promise.all([
        prisma.business.findFirst({ where: { workspaceId }, select: { id: true } }),
        prisma.icp.count({ where: { workspaceId } }),
        prisma.goal.count({ where: { workspaceId } }),
        // Any status on purpose (spec §3.2): a failed run still means the
        // founder did the step.
        prisma.agentRun.count({ where: { workspaceId, taskType: RESEARCH_TASK_TYPE } }),
        prisma.strategy.count({ where: { workspaceId } }),
        prisma.experiment.findFirst({
          where: { workspaceId, ...NON_CANCELLED },
          // id breaks ties so the spine is deterministic (spec §3.1).
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            name: true,
            status: true,
            metric: true,
            endDate: true,
            strategyId: true,
            _count: { select: { outcomes: true } },
            learnings: { select: { id: true, status: true, createdAt: true } },
          },
        }),
      ]);

      const spine: SpineExperiment | null = spineRow
        ? {
            id: spineRow.id,
            name: spineRow.name,
            status: spineRow.status,
            metric: spineRow.metric,
            endDate: spineRow.endDate,
            strategyId: spineRow.strategyId,
            outcomeCount: spineRow._count.outcomes,
            learnings: spineRow.learnings,
          }
        : null;

      return {
        now,
        hasBusiness: business !== null,
        icpCount,
        goalCount,
        researchRunCount,
        strategyCount,
        spine,
      };
    },

    /**
     * The loop's header: which number it is, and the goal and strategy it
     * serves. Both tie-breaks are spec §4 — with a spine the experiment names
     * its own strategy, without one the newest non-archived strategy stands in.
     */
    async loopContext(workspaceId: string, spine: SpineExperiment | null) {
      const GOAL_FIELDS = { id: true, name: true, metric: true, targetValue: true, unit: true } as const;

      const activeGoal = () =>
        prisma.goal.findFirst({
          where: { workspaceId, status: GoalStatus.ACTIVE },
          orderBy: { createdAt: 'desc' },
          select: GOAL_FIELDS,
        });

      const [count, strategy] = await Promise.all([
        prisma.experiment.count({ where: { workspaceId, ...NON_CANCELLED } }),
        // `spine.strategyId` comes off the spine row `snapshot()` already read —
        // no second round-trip for a field this slice has in hand.
        spine
          ? prisma.strategy.findFirst({ where: { id: spine.strategyId, workspaceId }, select: { id: true, name: true } })
          : prisma.strategy.findFirst({
              where: { workspaceId, status: { not: StrategyStatus.ARCHIVED } },
              orderBy: { createdAt: 'desc' },
              select: { id: true, name: true },
            }),
      ]);

      // Keyed on `spine`, NOT on `strategy`. Setup completing guarantees a
      // strategy exists, so branching on `strategy` would make the no-spine
      // path unreachable and hand loop 1 a goal linked to some strategy
      // instead of the founder's active one. Spec §4: the strategy's own goals
      // are consulted only when there is a spine.
      const goal =
        spine && strategy
          ? // The strategy's own oldest goal. Strategy <-> Goal is many-to-many,
            // so without an order this answer drifts between requests.
            (await prisma.goal.findFirst({
              where: { workspaceId, strategies: { some: { strategyId: strategy.id } } },
              orderBy: { createdAt: 'asc' },
              select: GOAL_FIELDS,
            })) ?? (await activeGoal())
          : await activeGoal();

      return {
        // Zero non-cancelled experiments still means loop 1 — the one being
        // set up (spec §3.1).
        number: Math.max(count, 1),
        strategy: strategy ?? null,
        goal:
          goal ??
          (await prisma.goal.findFirst({
            where: { workspaceId },
            orderBy: { createdAt: 'desc' },
            select: GOAL_FIELDS,
          })),
      };
    },

    /** Raw rows for the feed. Derives nothing — `buildRecent` does that. */
    async recentSources(workspaceId: string): Promise<RecentSources> {
      const take = 8;
      const [goals, researchRuns, strategies, experiments, outcomes, learnings] = await Promise.all([
        prisma.goal.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'desc' },
          take,
          select: { id: true, name: true, createdAt: true },
        }),
        prisma.agentRun.findMany({
          where: { workspaceId, taskType: RESEARCH_TASK_TYPE, status: AgentRunStatus.COMPLETED },
          orderBy: { completedAt: 'desc' },
          take,
          select: { id: true, completedAt: true, output: true },
        }),
        prisma.strategy.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'desc' },
          take,
          select: { id: true, name: true, createdAt: true, sourceAgentRunId: true },
        }),
        prisma.experiment.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'desc' },
          take,
          select: { id: true, name: true, createdAt: true, completedAt: true },
        }),
        prisma.outcome.findMany({
          where: { workspaceId },
          orderBy: { observedAt: 'desc' },
          take,
          select: { id: true, metric: true, value: true, unit: true, observedAt: true },
        }),
        prisma.learning.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'desc' },
          take,
          select: { id: true, title: true, createdAt: true, validatedAt: true },
        }),
      ]);

      return { goals, researchRuns, strategies, experiments, outcomes, learnings };
    },
  };
}

export type DashboardRepository = ReturnType<typeof createDashboardRepository>;
```

`AgentRunStatus`, `StrategyStatus`, `GoalStatus` and `ExperimentStatus` are all exported Prisma enums (verified against `prisma/schema.prisma`), and `Goal.strategies` is the `StrategyGoal[]` join field, so `{ strategies: { some: { strategyId } } }` is the correct filter. No substitutions needed.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd back && pnpm vitest run src/http/api/dashboard/dashboard.repository.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `cd back && pnpm typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
cd back
git add src/http/api/dashboard/dashboard.repository.ts src/http/api/dashboard/dashboard.repository.test.ts
git commit -m "feat(dashboard): read the snapshot, the loop header and the feed

Every query is filtered on workspaceId and asserted to be, per call. The
spine is the latest non-cancelled experiment with id breaking ties; loop
number is the count of them, floored at 1."
```

---

## Task 4: Route, service and registration

**Files:**
- Create: `back/src/http/api/dashboard/get-dashboard/get-dashboard.service.ts`
- Create: `back/src/http/api/dashboard/get-dashboard/get-dashboard.controller.ts`
- Create: `back/src/http/api/dashboard/index.ts`
- Modify: `back/src/app.ts` (import + register)
- Test: `back/src/http/api/dashboard/get-dashboard/get-dashboard.test.ts`

**Interfaces:**
- Consumes: `createDashboardRepository` (Task 3), `resolveDashboardState` / `setupFlags` / `isSetupComplete` / `buildRecent` (Tasks 1–2), `dashboardResponse` (Task 1).
- Produces: `getDashboardService(deps: { repo: DashboardRepository })` returning `(input: { workspaceId: string; now: Date }) => Promise<DashboardResponse>`; `getDashboardRoute: FastifyPluginAsync`; `dashboardRoutes: FastifyPluginAsync`.

- [ ] **Step 1: Write the failing test**

Create `back/src/http/api/dashboard/get-dashboard/get-dashboard.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../../lib/errors.js';
import { denyReadOnly } from '../../../../plugins/tenant.js';
import { getDashboardRoute } from './get-dashboard.controller.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';

const EMPTY = {
  business: { findFirst: vi.fn().mockResolvedValue(null) },
  icp: { count: vi.fn().mockResolvedValue(0) },
  goal: { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
  agentRun: { count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
  strategy: { count: vi.fn().mockResolvedValue(0), findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
  experiment: { findFirst: vi.fn().mockResolvedValue(null), count: vi.fn().mockResolvedValue(0), findMany: vi.fn().mockResolvedValue([]) },
  outcome: { findMany: vi.fn().mockResolvedValue([]) },
  learning: { findMany: vi.fn().mockResolvedValue([]) },
};

function prismaFake(overrides: Partial<typeof EMPTY> = {}) {
  return { ...EMPTY, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
});

async function buildApp(prisma: unknown, role: 'OWNER' | 'MEMBER' | 'VIEWER' = 'MEMBER') {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prisma as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: WORKSPACE_ID, role };
  });
  // The real guard, not a copy of it — the point of the read-only test below.
  app.addHook('preHandler', denyReadOnly);
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  await app.register(getDashboardRoute);
  return app;
}

describe('GET /dashboard', () => {
  it('sends an empty workspace to setting up the business', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'GET', url: '/dashboard' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stage).toBe('BUSINESS');
    expect(body.nextAction.kind).toBe('SET_UP_BUSINESS');
    expect(body.setup).toMatchObject({ business: false, completed: 0, total: 5 });
    // No loop to describe yet — the client should not have to infer that.
    expect(body.loop).toBeNull();
    expect(body.recent).toEqual([]);
  });

  it('describes the loop once setup is complete', async () => {
    const app = await buildApp(
      prismaFake({
        business: { findFirst: vi.fn().mockResolvedValue({ id: 'b1' }) },
        icp: { count: vi.fn().mockResolvedValue(1) },
        goal: {
          count: vi.fn().mockResolvedValue(1),
          findFirst: vi.fn().mockResolvedValue({ id: 'g1', name: '30 trials', metric: 'signups', targetValue: 30, unit: 'signups' }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        agentRun: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([]) },
        strategy: {
          count: vi.fn().mockResolvedValue(1),
          findFirst: vi.fn().mockResolvedValue({ id: 's1', name: 'founder-led outbound' }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        experiment: {
          findFirst: vi
            .fn()
            // First call resolves the spine, second resolves its strategyId.
            .mockResolvedValueOnce({
              id: 'e1',
              name: 'LinkedIn DM test',
              status: 'COMPLETED',
              metric: 'replies',
              endDate: null,
              strategyId: 's1',
              _count: { outcomes: 0 },
              learnings: [],
            })
            .mockResolvedValue({ strategyId: 's1' }),
          count: vi.fn().mockResolvedValue(1),
          findMany: vi.fn().mockResolvedValue([]),
        },
      }),
    );

    const res = await app.inject({ method: 'GET', url: '/dashboard' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.stage).toBe('OUTCOME');
    expect(body.nextAction).toMatchObject({ kind: 'RECORD_OUTCOME', experimentId: 'e1', subjectLabel: 'LinkedIn DM test' });
    expect(body.loop).toMatchObject({ number: 1, strategy: { id: 's1' }, experiment: { id: 'e1', status: 'COMPLETED' } });
    expect(body.loop.rail).toEqual([
      { node: 'STRATEGY', state: 'DONE' },
      { node: 'EXPERIMENT', state: 'DONE' },
      { node: 'OUTCOME', state: 'CURRENT' },
      { node: 'LEARNING', state: 'TODO' },
    ]);
  });

  it('serves a read-only member', async () => {
    // Reading where the loop stands is not a write. denyReadOnly returns early
    // on GET; this pins that so a later refactor cannot make this endpoint
    // write without a failing test.
    const app = await buildApp(prismaFake(), 'VIEWER');

    const res = await app.inject({ method: 'GET', url: '/dashboard' });

    expect(res.statusCode).toBe(200);
  });

  it('never sends display copy — only enums, ids and what the founder typed', async () => {
    const app = await buildApp(prismaFake());

    const body = await app.inject({ method: 'GET', url: '/dashboard' }).then((r) => r.json());

    // Spec §3.4. A sentence here cannot be translated into PT or ES.
    expect(JSON.stringify(body)).not.toMatch(/[Ss]et up your|Record the|Loading/);
    expect(body).not.toHaveProperty('nextAction.href');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && pnpm vitest run src/http/api/dashboard/get-dashboard/get-dashboard.test.ts`
Expected: FAIL — cannot resolve `./get-dashboard.controller.js`.

- [ ] **Step 3: Write the service**

Create `back/src/http/api/dashboard/get-dashboard/get-dashboard.service.ts`:

```ts
import {
  buildRecent,
  isSetupComplete,
  resolveDashboardState,
  setupFlags,
} from '../dashboard.domain.js';
import type { DashboardRepository } from '../dashboard.repository.js';
import type { DashboardResponse } from '../dashboard.schema.js';

export type GetDashboardDeps = { repo: DashboardRepository };

export function getDashboardService(deps: GetDashboardDeps) {
  return async (input: { workspaceId: string; now: Date }): Promise<DashboardResponse> => {
    const snapshot = await deps.repo.snapshot(input.workspaceId, input.now);
    const { stage, nextAction, rail } = resolveDashboardState(snapshot);
    const setup = setupFlags(snapshot);

    // The feed is worth reading even mid-setup: a founder who ran research
    // yesterday should see it. The loop header is not — there is no loop.
    const [recentSources, loopContext] = await Promise.all([
      deps.repo.recentSources(input.workspaceId),
      isSetupComplete(snapshot) ? deps.repo.loopContext(input.workspaceId, snapshot.spine) : null,
    ]);

    return {
      setup,
      stage,
      nextAction,
      loop: loopContext
        ? {
            number: loopContext.number,
            goal: loopContext.goal,
            strategy: loopContext.strategy,
            experiment: snapshot.spine
              ? {
                  id: snapshot.spine.id,
                  name: snapshot.spine.name,
                  status: snapshot.spine.status,
                  metric: snapshot.spine.metric,
                  endDate: snapshot.spine.endDate,
                }
              : null,
            rail,
          }
        : null,
      recent: buildRecent(recentSources),
    };
  };
}
```

- [ ] **Step 4: Write the controller and the module index**

Create `back/src/http/api/dashboard/get-dashboard/get-dashboard.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createDashboardRepository } from '../dashboard.repository.js';
import { dashboardResponse } from '../dashboard.schema.js';
import { getDashboardService } from './get-dashboard.service.js';

export const getDashboardRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/dashboard',
    { schema: { tags: ['dashboard'], operationId: 'getDashboard', response: { 200: dashboardResponse } } },
    async (req) => {
      const repo = createDashboardRepository(app.prisma);
      return getDashboardService({ repo })({ workspaceId: req.tenant.workspaceId, now: new Date() });
    },
  );
};
```

Create `back/src/http/api/dashboard/index.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import { getDashboardRoute } from './get-dashboard/get-dashboard.controller.js';

/**
 * Registers the `dashboard` route. The read-only guard is added for the same
 * reason every other module adds it: it covers routes not written yet.
 * `denyReadOnly` returns early on GET, so today it is a no-op here.
 */
export const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.resolveTenant);
  app.addHook('preHandler', app.denyReadOnly);

  await app.register(getDashboardRoute);
};
```

- [ ] **Step 5: Register the module**

In `back/src/app.ts`, add the import next to the other `http/api` imports (after the `workspacesRoutes` import at line 33):

```ts
import { dashboardRoutes } from './http/api/dashboard/index.js';
```

and register it next to the others (after `await app.register(workspacesRoutes);` at line 97):

```ts
  await app.register(dashboardRoutes);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd back && pnpm vitest run src/http/api/dashboard/get-dashboard/get-dashboard.test.ts`
Expected: PASS.

- [ ] **Step 7: Run the whole suite and typecheck**

Run: `cd back && pnpm test && pnpm typecheck`
Expected: all green. Existing count before this plan was 487 tests / 58 files; expect strictly more, none failing.

- [ ] **Step 8: Verify the endpoint appears in the OpenAPI document**

Run: `cd back && pnpm openapi:dump && python3 -c "import json; print('/dashboard' in json.load(open('../web/api.json'))['paths'])"`
Expected: `True`. The dump builds the app in-process — no dev server needed. This is the file Kubb reads in Task 5; if the path is missing, the web tasks cannot start.

- [ ] **Step 9: Commit**

```bash
cd back
git add src/http/api/dashboard/get-dashboard src/http/api/dashboard/index.ts src/app.ts
git commit -m "feat(dashboard): serve GET /dashboard

One read for the whole screen: setup flags, stage, next action, loop
header and the recent feed. Read-only members can reach it, and the
payload carries no display copy and no URLs."
```

---

## Task 5: Web — generated client and the action map

**Files:**
- Modify: `web/src/api/generated/**` (regenerated, committed as-is)
- Create: `web/src/lib/dashboard-actions.ts`
- Test: `web/src/lib/dashboard-actions.test.ts`

**Interfaces:**
- Consumes: the generated `useGetDashboard` hook and `GetDashboard` types from Task 4's OpenAPI document.
- Produces:
  - `type NextActionKey` (the 16 next-action kinds), `type RecentRefTypeKey`
  - `interface NextActionRoute { to: string | null; i18nKey: string }`
  - `nextActionRoute(kind: NextActionKey, ids: { experimentId: string | null }): NextActionRoute`
  - `recentHref(refType: RecentRefTypeKey, refId: string): string | null`

- [ ] **Step 1: Regenerate the client**

Kubb reads the tracked `web/api.json`, not a live endpoint, and `back`'s
`pnpm openapi:dump` builds the Fastify app in-process to write that file. **No dev
server is involved.** With Task 4 committed:

```bash
cd back && pnpm openapi:dump
cd ../web && pnpm api:generate
```

Expected: `api.json` gains the `/dashboard` path, and new files appear under
`src/api/generated/hooks/dashboardHooks/` and `src/api/generated/types/GetDashboard.ts`.

Note `web/.gitignore:3` ignores `src/api/generated/` — nothing under it has ever been
tracked. `api.json` is the committed record of the contract; the generated client is
rebuilt locally from it. Commit `api.json`, never the generated tree.

- [ ] **Step 2: Confirm what was generated before writing code against it**

Run: `cd web && ls src/api/generated/hooks/dashboardHooks/ && grep -n "Key\b" src/api/generated/types/GetDashboard.ts | head -40`
Expected: a `useGetDashboard.ts`, and the enum key types. Note the exact exported names — Kubb's suffixes (`…Enum2Key`, as in `ExperimentStatusEnum2Key` used by `experiment-actions.ts`) depend on how many enums the document holds, so read them rather than assuming.

- [ ] **Step 3: Write the failing test**

Create `web/src/lib/dashboard-actions.test.ts`. Replace the imported type names with the ones Step 2 printed:

```ts
import { describe, expect, it } from 'vitest';
import { nextActionRoute, recentHref, type NextActionKey, type RecentRefTypeKey } from './dashboard-actions';

const EXPERIMENT_ID = 'e1';

/**
 * Every kind the backend can send. Listed literally rather than derived from
 * the generated type, so adding a kind on the server fails this test until
 * someone decides where it should route.
 */
const ALL_KINDS: NextActionKey[] = [
  'SET_UP_BUSINESS',
  'DEFINE_ICP',
  'SET_GOAL',
  'RUN_RESEARCH',
  'CHOOSE_STRATEGY',
  'DESIGN_EXPERIMENT',
  'PLAN_EXPERIMENT',
  'APPROVE_EXPERIMENT',
  'START_EXPERIMENT',
  'WAIT_FOR_EXPERIMENT',
  'COMPLETE_EXPERIMENT',
  'RESUME_EXPERIMENT',
  'RECORD_OUTCOME',
  'WRITE_LEARNING',
  'VALIDATE_LEARNING',
  'START_NEXT_LOOP',
];

describe('nextActionRoute', () => {
  it('routes every kind, and names a copy key for every one', () => {
    for (const kind of ALL_KINDS) {
      const route = nextActionRoute(kind, { experimentId: EXPERIMENT_ID });
      expect(route.i18nKey, `${kind} has no copy key`).toBe(`app.dashboard.next.${kind}`);
    }
  });

  it.each([
    ['SET_UP_BUSINESS', '/app/business/setup'],
    ['DEFINE_ICP', '/app/icps/new'],
    ['SET_GOAL', '/app/goals/new'],
    ['RUN_RESEARCH', '/app/research'],
    ['CHOOSE_STRATEGY', '/app/strategies'],
    ['DESIGN_EXPERIMENT', '/app/experiments/new'],
    ['START_NEXT_LOOP', '/app/experiments/new'],
  ] as const)('%s goes to %s', (kind, to) => {
    expect(nextActionRoute(kind, { experimentId: null }).to).toBe(to);
  });

  it.each([
    'PLAN_EXPERIMENT',
    'APPROVE_EXPERIMENT',
    'START_EXPERIMENT',
    'RESUME_EXPERIMENT',
    'COMPLETE_EXPERIMENT',
    'RECORD_OUTCOME',
    'WRITE_LEARNING',
    'VALIDATE_LEARNING',
  ] as const)('%s goes to the experiment it names', (kind) => {
    // Outcomes and learnings live in sections on the experiment detail page,
    // so all of these land there.
    expect(nextActionRoute(kind, { experimentId: EXPERIMENT_ID }).to).toBe('/app/experiments/e1');
  });

  it('has nowhere to send a waiting founder', () => {
    // WAIT_FOR_EXPERIMENT is a stage with no action: it renders as text.
    expect(nextActionRoute('WAIT_FOR_EXPERIMENT', { experimentId: EXPERIMENT_ID }).to).toBeNull();
  });

  it('falls back to the experiment list when the id is missing', () => {
    // Should not happen — the backend sends experimentId with all of these —
    // but a dead link is worse than a list.
    expect(nextActionRoute('RECORD_OUTCOME', { experimentId: null }).to).toBe('/app/experiments');
  });
});

describe('recentHref', () => {
  it.each([
    ['GOAL', '/app/goals'],
    ['STRATEGY', '/app/strategies/s1'],
    ['EXPERIMENT', '/app/experiments/s1'],
    ['LEARNING', '/app/experiments'],
    ['OUTCOME', '/app/experiments'],
  ] as const)('links a %s', (refType, href) => {
    expect(recentHref(refType as RecentRefTypeKey, 's1')).toBe(href);
  });

  it('does not link an agent run', () => {
    // There is no per-run page; research history lives on /app/research.
    expect(recentHref('AGENT_RUN', 'r1')).toBe('/app/research');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/lib/dashboard-actions.test.ts`
Expected: FAIL — cannot resolve `./dashboard-actions`.

- [ ] **Step 5: Write the action map**

Create `web/src/lib/dashboard-actions.ts`. Import the key types from the generated `GetDashboard` types using the names Step 2 printed:

```ts
import type {
  GetDashboardNextActionKindEnumKey,
  GetDashboardRecentRefTypeEnumKey,
} from '@/api/generated/types/GetDashboard';

export type NextActionKey = GetDashboardNextActionKindEnumKey;
export type RecentRefTypeKey = GetDashboardRecentRefTypeEnumKey;

export interface NextActionRoute {
  /** Where the button goes, or null when this kind has no action at all. */
  to: string | null;
  i18nKey: string;
}

/** Sentinel for "the experiment detail page", whose id is only known per call. */
const EXPERIMENT = Symbol('experiment-detail');

/**
 * Total, deliberately: `Record` over the full union with no catch-all, so a kind
 * added on the server fails to compile here until someone decides where it goes.
 * `EXPERIMENT` means "the experiment detail page, id substituted at call time";
 * `null` means the kind has no action at all.
 */
const TARGET: Record<NextActionKey, string | typeof EXPERIMENT | null> = {
  // Only sent when no business exists, so the setup screen is the only target.
  SET_UP_BUSINESS: '/app/business/setup',
  DEFINE_ICP: '/app/icps/new',
  SET_GOAL: '/app/goals/new',
  RUN_RESEARCH: '/app/research',
  CHOOSE_STRATEGY: '/app/strategies',
  DESIGN_EXPERIMENT: '/app/experiments/new',
  START_NEXT_LOOP: '/app/experiments/new',
  PLAN_EXPERIMENT: EXPERIMENT,
  APPROVE_EXPERIMENT: EXPERIMENT,
  START_EXPERIMENT: EXPERIMENT,
  RESUME_EXPERIMENT: EXPERIMENT,
  COMPLETE_EXPERIMENT: EXPERIMENT,
  // Outcomes and learnings are sections on that page, not screens of their own.
  RECORD_OUTCOME: EXPERIMENT,
  WRITE_LEARNING: EXPERIMENT,
  VALIDATE_LEARNING: EXPERIMENT,
  // A stage with no action. Rendered as text, never as a dead button.
  WAIT_FOR_EXPERIMENT: null,
};

/**
 * The only place in the web app that knows what a `nextAction.kind` means in
 * terms of routes. The backend deliberately sends no URLs (spec §3.4), so a
 * route change is one edit here.
 */
export function nextActionRoute(kind: NextActionKey, ids: { experimentId: string | null }): NextActionRoute {
  const i18nKey = `app.dashboard.next.${kind}`;
  const target = TARGET[kind];
  if (target === null) return { to: null, i18nKey };
  if (target === EXPERIMENT) {
    // A dead link is worse than a list.
    return { to: ids.experimentId ? `/app/experiments/${ids.experimentId}` : '/app/experiments', i18nKey };
  }
  return { to: target, i18nKey };
}

/** Where a recent-activity row links. */
export function recentHref(refType: RecentRefTypeKey, refId: string): string | null {
  switch (refType) {
    case 'STRATEGY':
      return `/app/strategies/${refId}`;
    case 'EXPERIMENT':
      return `/app/experiments/${refId}`;
    case 'GOAL':
      // No goal detail page exists; the list is the honest target.
      return '/app/goals';
    case 'OUTCOME':
    case 'LEARNING':
      // Both live in sections of an experiment, and the row does not carry
      // the experiment id.
      return '/app/experiments';
    case 'AGENT_RUN':
      return '/app/research';
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/lib/dashboard-actions.test.ts`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `cd web && pnpm typecheck`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
cd web
git add api.json src/lib/dashboard-actions.ts src/lib/dashboard-actions.test.ts
git commit -m "feat(dashboard): map next actions and activity rows to routes

The API sends enums and ids, never URLs, so this is the one file that
knows where a kind goes. A kind added on the server fails the table test
until someone decides its route."
```

---

## Task 6: SetupChecklist extraction

**Files:**
- Create: `web/src/components/dashboard/SetupChecklist.tsx`
- Test: `web/src/components/dashboard/SetupChecklist.test.tsx`
- Modify: `web/src/i18n/locales/{en,pt,es}.json` (add `app.dashboard.setupTitle`, `app.dashboard.setupDone`)

**Interfaces:**
- Consumes: nothing from earlier web tasks.
- Produces: `SetupChecklist` component with props `{ setup: SetupFlags; collapsed: boolean }` where `interface SetupFlags { business: boolean; icp: boolean; goal: boolean; research: boolean; strategy: boolean; completed: number; total: number }`.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/dashboard/SetupChecklist.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/render';
import { SetupChecklist } from './SetupChecklist';

const HALF = { business: true, icp: true, goal: true, research: false, strategy: false, completed: 3, total: 5 };
const DONE = { business: true, icp: true, goal: true, research: true, strategy: true, completed: 5, total: 5 };

function rowFor(link: HTMLElement): HTMLElement {
  const row = link.closest('.group');
  if (!row) throw new Error('step row not found');
  return row as HTMLElement;
}

describe('SetupChecklist expanded', () => {
  it('renders five steps with research at 04 and strategy at 05', () => {
    renderWithProviders(<SetupChecklist setup={HALF} collapsed={false} />);

    const research = screen.getByRole('link', { name: i18n.t('app.dashboard.steps.research.title') });
    const strategy = screen.getByRole('link', { name: i18n.t('app.dashboard.steps.strategy.title') });

    expect(within(rowFor(research)).getByText('04')).toBeInTheDocument();
    expect(within(rowFor(strategy)).getByText('05')).toBeInTheDocument();
  });

  it('shows progress as a count and a percentage', () => {
    renderWithProviders(<SetupChecklist setup={HALF} collapsed={false} />);

    expect(screen.getByText('3 / 5')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
  });
});

describe('SetupChecklist collapsed', () => {
  it('hides the step rows behind a summary', () => {
    renderWithProviders(<SetupChecklist setup={DONE} collapsed />);

    expect(screen.getByText(i18n.t('app.dashboard.setupDone', { completed: 5, total: 5 }))).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: i18n.t('app.dashboard.steps.research.title') })).not.toBeInTheDocument();
  });

  it('reveals the rows when the summary is opened', async () => {
    const { user } = renderWithProviders(<SetupChecklist setup={DONE} collapsed />) as never as {
      user: { click: (el: Element) => Promise<void> };
    };
    void user;

    // <details>/<summary>: opening is a native toggle, so the test drives the
    // element rather than simulating a pointer.
    const details = document.querySelector('details');
    expect(details).not.toBeNull();
    (details as HTMLDetailsElement).open = true;

    expect(await screen.findByRole('link', { name: i18n.t('app.dashboard.steps.research.title') })).toBeInTheDocument();
  });
});
```

If `renderWithProviders` does not return a `user`, drop the unused destructuring and keep the `details` manipulation — the second test only needs the DOM toggle.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/components/dashboard/SetupChecklist.test.tsx`
Expected: FAIL — cannot resolve `./SetupChecklist`.

- [ ] **Step 3: Add the two copy keys**

In `web/src/i18n/locales/en.json`, inside `app.dashboard`, next to `"continue"`:

```json
    "setupTitle": "Set up your growth brain",
    "setupDone": "Setup complete · {{completed}} / {{total}}",
```

`pt.json`:

```json
    "setupTitle": "Configure seu cérebro de crescimento",
    "setupDone": "Configuração concluída · {{completed}} / {{total}}",
```

`es.json`:

```json
    "setupTitle": "Configura tu cerebro de crecimiento",
    "setupDone": "Configuración completa · {{completed}} / {{total}}",
```

- [ ] **Step 4: Write the component**

Create `web/src/components/dashboard/SetupChecklist.tsx`. The step rows, icons and classes are lifted verbatim from the current `src/pages/DashboardPage.tsx` lines 20–107 so the extraction is not also a redesign:

```tsx
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Building2, Check, Compass, Target, Telescope, Users } from 'lucide-react';
import { Help } from '../Help';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface SetupFlags {
  business: boolean;
  icp: boolean;
  goal: boolean;
  research: boolean;
  strategy: boolean;
  completed: number;
  total: number;
}

const stepDefs = [
  { key: 'business', to: '/app/business', n: '01', icon: Building2 },
  { key: 'icp', to: '/app/icps', n: '02', icon: Users },
  { key: 'goal', to: '/app/goals', n: '03', icon: Target },
  { key: 'research', to: '/app/research', n: '04', icon: Telescope },
  { key: 'strategy', to: '/app/strategies', n: '05', icon: Compass },
] as const;

function Rows({ setup }: { setup: SetupFlags }) {
  const { t } = useTranslation();
  return (
    <div className="divide-y divide-border">
      {stepDefs.map(({ key, to, n, icon: Icon }) => {
        const isDone = setup[key];
        return (
          <div key={key} className="group relative flex items-center gap-4 p-5 transition-colors hover:bg-accent/40">
            <div
              className={cn(
                'grid size-11 shrink-0 place-items-center rounded-xl border transition-colors',
                isDone
                  ? 'border-transparent bg-gradient-to-br from-brand to-aura text-white'
                  : 'border-border bg-card text-muted-foreground group-hover:text-foreground',
              )}
            >
              {isDone ? <Check className="size-5" /> : <Icon className="size-5" />}
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Link to={to} className="font-medium after:absolute after:inset-0 hover:text-primary">
                {t(`app.dashboard.steps.${key}.title`)}
              </Link>
              <Help title={t(`app.dashboard.steps.${key}.help`)}>{t(`app.dashboard.steps.${key}.helpText`)}</Help>
            </div>
            <span className="font-mono text-xs text-muted-foreground">{n}</span>
            <ArrowRight className="size-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
          </div>
        );
      })}
    </div>
  );
}

/**
 * The activation checklist. Hero while setup is unfinished; once every step is
 * done it collapses to one summary row, because a founder on day 30 does not
 * need a permanent 5/5 at the top of their dashboard (spec §3.7).
 */
export function SetupChecklist({ setup, collapsed }: { setup: SetupFlags; collapsed: boolean }) {
  const { t } = useTranslation();
  const pct = setup.total === 0 ? 0 : Math.round((setup.completed / setup.total) * 100);

  if (collapsed) {
    return (
      <details className="rounded-xl border border-border bg-card px-5 py-3">
        <summary className="cursor-pointer font-mono text-xs tracking-wider text-muted-foreground">
          {t('app.dashboard.setupDone', { completed: setup.completed, total: setup.total })}
        </summary>
        <div className="mt-3 -mx-5 -mb-3 border-t border-border">
          <Rows setup={setup} />
        </div>
      </details>
    );
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="border-b border-border p-5">
        <div className="mb-2 flex items-center justify-between font-mono text-xs">
          <span className="tracking-wider text-foreground">
            {setup.completed} / {setup.total}
          </span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-brand to-aura transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <Rows setup={setup} />
    </Card>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/components/dashboard/SetupChecklist.test.tsx`
Expected: PASS.

- [ ] **Step 6: Confirm the locale files still match each other**

Run: `cd web && pnpm vitest run src/i18n/locales.test.ts`
Expected: PASS — pt and es have exactly the keys en has.

- [ ] **Step 7: Commit**

```bash
cd web
git add src/components/dashboard/SetupChecklist.tsx src/components/dashboard/SetupChecklist.test.tsx src/i18n/locales
git commit -m "refactor(dashboard): extract the setup checklist, and let it collapse

Same rows, same copy, now a component that takes flags instead of firing
five queries — and a collapsed form for founders who are past setup."
```

---

## Task 7: LoopPanel

**Files:**
- Create: `web/src/components/dashboard/LoopPanel.tsx`
- Test: `web/src/components/dashboard/LoopPanel.test.tsx`
- Modify: `web/src/i18n/locales/{en,pt,es}.json`

**Interfaces:**
- Consumes: `RailNode` / rail state key types from `@/api/generated/types/GetDashboard`.
- Produces: `LoopPanel` component with props `{ loop: DashboardLoop }` where `DashboardLoop` is the generated response's `loop` (non-null); re-exported as `type DashboardLoop` from this file for the page to use.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/dashboard/LoopPanel.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/render';
import { LoopPanel, type DashboardLoop } from './LoopPanel';

const LOOP: DashboardLoop = {
  number: 2,
  goal: { id: 'g1', name: '30 trial signups/mo', metric: 'signups', targetValue: 30, unit: 'signups' },
  strategy: { id: 's1', name: 'founder-led outbound' },
  experiment: { id: 'e1', name: 'LinkedIn DM test', status: 'COMPLETED', metric: 'replies', endDate: null },
  rail: [
    { node: 'STRATEGY', state: 'DONE' },
    { node: 'EXPERIMENT', state: 'DONE' },
    { node: 'OUTCOME', state: 'CURRENT' },
    { node: 'LEARNING', state: 'TODO' },
  ],
};

describe('LoopPanel', () => {
  it('names the loop and the goal it serves', () => {
    renderWithProviders(<LoopPanel loop={LOOP} />);

    expect(screen.getByText(i18n.t('app.dashboard.loopTitle', { number: 2 }))).toBeInTheDocument();
    expect(screen.getByText('30 trial signups/mo')).toBeInTheDocument();
  });

  it('renders one rail node per entry, labelled and with its state exposed', () => {
    renderWithProviders(<LoopPanel loop={LOOP} />);

    const nodes = screen.getAllByTestId('rail-node');
    expect(nodes).toHaveLength(4);
    expect(nodes.map((node) => node.getAttribute('data-state'))).toEqual(['DONE', 'DONE', 'CURRENT', 'TODO']);
    expect(screen.getByText(i18n.t('app.dashboard.rail.OUTCOME'))).toBeInTheDocument();
  });

  it('explains every rail node in-app', () => {
    renderWithProviders(<LoopPanel loop={LOOP} />);

    // web/CLAUDE.md rule 2: Loop, Outcome and Learning appear here for the
    // first time, so each node carries its own Help — four nodes plus the
    // loop itself. `Help` exposes role="button" with an "Explain: <title>"
    // accessible name (src/components/Help.tsx:21-25).
    expect(screen.getAllByRole('button', { name: /^Explain:/ })).toHaveLength(5);
  });

  it('renders without a goal', () => {
    renderWithProviders(<LoopPanel loop={{ ...LOOP, goal: null }} />);

    expect(screen.getByText(i18n.t('app.dashboard.loopTitle', { number: 2 }))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('app.dashboard.noGoal'))).toBeInTheDocument();
  });

  it('renders before an experiment exists', () => {
    renderWithProviders(
      <LoopPanel
        loop={{
          ...LOOP,
          experiment: null,
          rail: [
            { node: 'STRATEGY', state: 'DONE' },
            { node: 'EXPERIMENT', state: 'CURRENT' },
            { node: 'OUTCOME', state: 'TODO' },
            { node: 'LEARNING', state: 'TODO' },
          ],
        }}
      />,
    );

    expect(screen.getAllByTestId('rail-node')).toHaveLength(4);
    expect(screen.queryByText('LinkedIn DM test')).not.toBeInTheDocument();
  });
});
```

Note that `Help`'s accessible name is the English literal `Explain: <title>` in every locale — existing behaviour in `src/components/Help.tsx:22`, out of scope here, but it means the assertion above stays valid after a language switch.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/components/dashboard/LoopPanel.test.tsx`
Expected: FAIL — cannot resolve `./LoopPanel`.

- [ ] **Step 3: Add the copy keys**

In `en.json`, inside `app.dashboard`:

```json
    "loopTitle": "Loop {{number}}",
    "noGoal": "No goal set yet",
    "loopHelp": "Loop",
    "loopHelpText": "One pass of the growth loop: a strategy becomes an experiment, the experiment produces an outcome, and the outcome becomes a learning that improves the next pass.",
    "rail": {
      "STRATEGY": "Strategy",
      "EXPERIMENT": "Experiment",
      "OUTCOME": "Outcome",
      "LEARNING": "Learning"
    },
    "railHelp": {
      "STRATEGY": "How you intend to reach the goal — the growth mechanism and the channels.",
      "EXPERIMENT": "A bounded, measurable test of one belief, with a metric, a target and success criteria. Completing it is not the same as it working.",
      "OUTCOME": "What actually happened: the measured value of the experiment's metric.",
      "LEARNING": "What the outcome means, stated so it can improve the next decision. You validate it before AUREA relies on it."
    },
```

`pt.json`:

```json
    "loopTitle": "Ciclo {{number}}",
    "noGoal": "Nenhuma meta definida ainda",
    "loopHelp": "Ciclo",
    "loopHelpText": "Uma passagem pelo ciclo de crescimento: a estratégia se torna um experimento, o experimento produz um resultado, e o resultado se torna um aprendizado que melhora a próxima passagem.",
    "rail": {
      "STRATEGY": "Estratégia",
      "EXPERIMENT": "Experimento",
      "OUTCOME": "Resultado",
      "LEARNING": "Aprendizado"
    },
    "railHelp": {
      "STRATEGY": "Como você pretende alcançar a meta — o mecanismo de crescimento e os canais.",
      "EXPERIMENT": "Um teste delimitado e mensurável de uma crença, com métrica, alvo e critérios de sucesso. Concluí-lo não é o mesmo que ele ter funcionado.",
      "OUTCOME": "O que de fato aconteceu: o valor medido da métrica do experimento.",
      "LEARNING": "O que o resultado significa, dito de forma que melhore a próxima decisão. Você o valida antes de a AUREA confiar nele."
    },
```

`es.json`:

```json
    "loopTitle": "Ciclo {{number}}",
    "noGoal": "Aún no hay una meta definida",
    "loopHelp": "Ciclo",
    "loopHelpText": "Una vuelta del ciclo de crecimiento: la estrategia se convierte en un experimento, el experimento produce un resultado, y el resultado se convierte en un aprendizaje que mejora la vuelta siguiente.",
    "rail": {
      "STRATEGY": "Estrategia",
      "EXPERIMENT": "Experimento",
      "OUTCOME": "Resultado",
      "LEARNING": "Aprendizaje"
    },
    "railHelp": {
      "STRATEGY": "Cómo pretendes alcanzar la meta — el mecanismo de crecimiento y los canales.",
      "EXPERIMENT": "Una prueba acotada y medible de una creencia, con métrica, objetivo y criterios de éxito. Completarla no es lo mismo que haya funcionado.",
      "OUTCOME": "Lo que ocurrió en realidad: el valor medido de la métrica del experimento.",
      "LEARNING": "Lo que significa el resultado, expresado de modo que mejore la próxima decisión. Lo validas antes de que AUREA se apoye en él."
    },
```

- [ ] **Step 4: Write the component**

Create `web/src/components/dashboard/LoopPanel.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Check, Circle, Dot } from 'lucide-react';
import type { GetDashboardQueryResponse } from '@/api/generated/types/GetDashboard';
import { Help } from '../Help';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** The response's `loop`, narrowed to the non-null case. */
export type DashboardLoop = NonNullable<GetDashboardQueryResponse['loop']>;

const ICONS = { DONE: Check, CURRENT: Dot, TODO: Circle } as const;

export function LoopPanel({ loop }: { loop: DashboardLoop }) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <h2 className="font-mono text-xs uppercase tracking-[0.15em] text-primary">
            {t('app.dashboard.loopTitle', { number: loop.number })}
          </h2>
          <Help title={t('app.dashboard.loopHelp')}>{t('app.dashboard.loopHelpText')}</Help>
        </div>

        <p className="mb-1 text-lg font-medium">{loop.goal ? loop.goal.name : t('app.dashboard.noGoal')}</p>
        {loop.strategy && <p className="mb-5 text-sm text-muted-foreground">{loop.strategy.name}</p>}

        <ol className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {loop.rail.map(({ node, state }) => {
            const Icon = ICONS[state];
            return (
              <li key={node} data-testid="rail-node" data-state={state} className="flex items-center gap-1.5">
                <Icon
                  className={cn(
                    'size-4',
                    state === 'DONE' && 'text-primary',
                    state === 'CURRENT' && 'text-foreground',
                    state === 'TODO' && 'text-muted-foreground/50',
                  )}
                />
                <span className={cn('font-mono text-sm', state === 'TODO' && 'text-muted-foreground')}>
                  {t(`app.dashboard.rail.${node}`)}
                </span>
                <Help title={t(`app.dashboard.rail.${node}`)}>{t(`app.dashboard.railHelp.${node}`)}</Help>
              </li>
            );
          })}
        </ol>

        {loop.experiment && (
          <p className="mt-5 border-t border-border pt-4 text-sm text-muted-foreground">{loop.experiment.name}</p>
        )}
      </CardContent>
    </Card>
  );
}
```

If Kubb named the response type differently, use the name from Task 5 Step 2 rather than `GetDashboardQueryResponse`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/components/dashboard/LoopPanel.test.tsx src/i18n/locales.test.ts`
Expected: PASS both.

- [ ] **Step 6: Commit**

```bash
cd web
git add src/components/dashboard/LoopPanel.tsx src/components/dashboard/LoopPanel.test.tsx src/i18n/locales
git commit -m "feat(dashboard): show which loop the founder is in and where it stands

Four rail nodes, each with its own Help — Loop, Outcome and Learning
reach the dashboard for the first time here, and the app is the docs."
```

---

## Task 8: NextActionCard

**Files:**
- Create: `web/src/components/dashboard/NextActionCard.tsx`
- Test: `web/src/components/dashboard/NextActionCard.test.tsx`
- Modify: `web/src/i18n/locales/{en,pt,es}.json`

**Interfaces:**
- Consumes: `nextActionRoute` (Task 5).
- Produces: `NextActionCard` with props `{ nextAction: DashboardNextAction }`, where `DashboardNextAction` is the generated response's `nextAction`, re-exported from this file.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/dashboard/NextActionCard.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/render';
import { NextActionCard, type DashboardNextAction } from './NextActionCard';

function action(overrides: Partial<DashboardNextAction> = {}): DashboardNextAction {
  return {
    kind: 'RECORD_OUTCOME',
    subjectLabel: 'LinkedIn DM test',
    experimentId: 'e1',
    learningId: null,
    endDate: null,
    ...overrides,
  };
}

describe('NextActionCard', () => {
  it('renders the copy for the kind, with the subject interpolated', () => {
    renderWithProviders(<NextActionCard nextAction={action()} />);

    expect(
      screen.getByText(i18n.t('app.dashboard.next.RECORD_OUTCOME', { subject: 'LinkedIn DM test' })),
    ).toBeInTheDocument();
  });

  it('links the button at the route for the kind', () => {
    renderWithProviders(<NextActionCard nextAction={action()} />);

    expect(screen.getByRole('link', { name: i18n.t('app.dashboard.go') })).toHaveAttribute(
      'href',
      '/app/experiments/e1',
    );
  });

  it('renders no button at all while an experiment is still running', () => {
    renderWithProviders(
      <NextActionCard nextAction={action({ kind: 'WAIT_FOR_EXPERIMENT', endDate: '2026-08-10T00:00:00.000Z' })} />,
    );

    // A dashboard that always demands a click invents work.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByTestId('next-action-text')).toBeInTheDocument();
  });

  it('survives a waiting experiment with no end date', () => {
    renderWithProviders(<NextActionCard nextAction={action({ kind: 'WAIT_FOR_EXPERIMENT', endDate: null })} />);

    expect(screen.getByTestId('next-action-text')).toBeInTheDocument();
  });

  it('renders a setup action that names no subject', () => {
    renderWithProviders(
      <NextActionCard nextAction={action({ kind: 'SET_UP_BUSINESS', subjectLabel: null, experimentId: null })} />,
    );

    expect(screen.getByRole('link', { name: i18n.t('app.dashboard.go') })).toHaveAttribute(
      'href',
      '/app/business/setup',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/components/dashboard/NextActionCard.test.tsx`
Expected: FAIL — cannot resolve `./NextActionCard`.

- [ ] **Step 3: Add the copy keys**

In `en.json`, inside `app.dashboard`:

```json
    "nextLabel": "Next",
    "go": "Go",
    "next": {
      "SET_UP_BUSINESS": "Tell AUREA about your business",
      "DEFINE_ICP": "Define who your ideal customer is",
      "SET_GOAL": "Set one measurable growth goal",
      "RUN_RESEARCH": "Let AUREA research your market",
      "CHOOSE_STRATEGY": "Choose a strategy to pursue",
      "DESIGN_EXPERIMENT": "Design an experiment to test it",
      "PLAN_EXPERIMENT": "Finish planning \"{{subject}}\"",
      "APPROVE_EXPERIMENT": "Approve \"{{subject}}\" so it can start",
      "START_EXPERIMENT": "Start \"{{subject}}\"",
      "WAIT_FOR_EXPERIMENT": "\"{{subject}}\" is running until {{date}}",
      "COMPLETE_EXPERIMENT": "\"{{subject}}\" has reached its end date — close it out",
      "RESUME_EXPERIMENT": "Resume \"{{subject}}\"",
      "RECORD_OUTCOME": "Record what \"{{subject}}\" produced",
      "WRITE_LEARNING": "Write what you learned from \"{{subject}}\"",
      "VALIDATE_LEARNING": "Validate the learning from \"{{subject}}\"",
      "START_NEXT_LOOP": "Start your next experiment"
    },
```

`pt.json`:

```json
    "nextLabel": "Próximo",
    "go": "Ir",
    "next": {
      "SET_UP_BUSINESS": "Conte à AUREA sobre seu negócio",
      "DEFINE_ICP": "Defina quem é seu cliente ideal",
      "SET_GOAL": "Defina uma meta de crescimento mensurável",
      "RUN_RESEARCH": "Deixe a AUREA pesquisar seu mercado",
      "CHOOSE_STRATEGY": "Escolha uma estratégia para seguir",
      "DESIGN_EXPERIMENT": "Desenhe um experimento para testá-la",
      "PLAN_EXPERIMENT": "Termine de planejar \"{{subject}}\"",
      "APPROVE_EXPERIMENT": "Aprove \"{{subject}}\" para que possa começar",
      "START_EXPERIMENT": "Inicie \"{{subject}}\"",
      "WAIT_FOR_EXPERIMENT": "\"{{subject}}\" está rodando até {{date}}",
      "COMPLETE_EXPERIMENT": "\"{{subject}}\" chegou à data final — encerre",
      "RESUME_EXPERIMENT": "Retome \"{{subject}}\"",
      "RECORD_OUTCOME": "Registre o que \"{{subject}}\" produziu",
      "WRITE_LEARNING": "Escreva o que você aprendeu com \"{{subject}}\"",
      "VALIDATE_LEARNING": "Valide o aprendizado de \"{{subject}}\"",
      "START_NEXT_LOOP": "Comece seu próximo experimento"
    },
```

`es.json`:

```json
    "nextLabel": "Siguiente",
    "go": "Ir",
    "next": {
      "SET_UP_BUSINESS": "Cuéntale a AUREA sobre tu negocio",
      "DEFINE_ICP": "Define quién es tu cliente ideal",
      "SET_GOAL": "Define una meta de crecimiento medible",
      "RUN_RESEARCH": "Deja que AUREA investigue tu mercado",
      "CHOOSE_STRATEGY": "Elige una estrategia a seguir",
      "DESIGN_EXPERIMENT": "Diseña un experimento para probarla",
      "PLAN_EXPERIMENT": "Termina de planificar \"{{subject}}\"",
      "APPROVE_EXPERIMENT": "Aprueba \"{{subject}}\" para que pueda empezar",
      "START_EXPERIMENT": "Inicia \"{{subject}}\"",
      "WAIT_FOR_EXPERIMENT": "\"{{subject}}\" está en marcha hasta el {{date}}",
      "COMPLETE_EXPERIMENT": "\"{{subject}}\" llegó a su fecha final — ciérralo",
      "RESUME_EXPERIMENT": "Reanuda \"{{subject}}\"",
      "RECORD_OUTCOME": "Registra lo que produjo \"{{subject}}\"",
      "WRITE_LEARNING": "Escribe lo que aprendiste de \"{{subject}}\"",
      "VALIDATE_LEARNING": "Valida el aprendizaje de \"{{subject}}\"",
      "START_NEXT_LOOP": "Empieza tu próximo experimento"
    },
```

- [ ] **Step 4: Write the component**

Create `web/src/components/dashboard/NextActionCard.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight } from 'lucide-react';
import type { GetDashboardQueryResponse } from '@/api/generated/types/GetDashboard';
import { nextActionRoute } from '@/lib/dashboard-actions';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export type DashboardNextAction = GetDashboardQueryResponse['nextAction'];

export function NextActionCard({ nextAction }: { nextAction: DashboardNextAction }) {
  const { t, i18n } = useTranslation();
  const { to, i18nKey } = nextActionRoute(nextAction.kind, { experimentId: nextAction.experimentId });

  const copy = t(i18nKey, {
    subject: nextAction.subjectLabel ?? '',
    date: nextAction.endDate
      ? new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(nextAction.endDate))
      : '',
  });

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
          {t('app.dashboard.nextLabel')}
        </div>
        {/* No route means the stage has no action — waiting is not a click. */}
        {to === null ? (
          <p data-testid="next-action-text" className="text-lg font-medium">
            {copy}
          </p>
        ) : (
          <>
            <p className="text-lg font-medium">{copy}</p>
            <Button asChild className="mt-5">
              <Link to={to}>
                {t('app.dashboard.go')} <ArrowRight className="size-4" />
              </Link>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/components/dashboard/NextActionCard.test.tsx src/i18n/locales.test.ts`
Expected: PASS both.

- [ ] **Step 6: Commit**

```bash
cd web
git add src/components/dashboard/NextActionCard.tsx src/components/dashboard/NextActionCard.test.tsx src/i18n/locales
git commit -m "feat(dashboard): say what to do next, or that there is nothing to do

Copy comes from the kind, the subject is interpolated, and the date is
formatted in the founder's own locale. WAIT_FOR_EXPERIMENT renders as
text with no button."
```

---

## Task 9: RecentActivity

**Files:**
- Create: `web/src/components/dashboard/RecentActivity.tsx`
- Test: `web/src/components/dashboard/RecentActivity.test.tsx`
- Modify: `web/src/i18n/locales/{en,pt,es}.json`

**Interfaces:**
- Consumes: `recentHref` (Task 5).
- Produces: `RecentActivity` with props `{ items: DashboardRecentItem[] }`; `type DashboardRecentItem` re-exported from this file.

- [ ] **Step 1: Write the failing test**

Create `web/src/components/dashboard/RecentActivity.test.tsx`:

```tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/render';
import { RecentActivity, type DashboardRecentItem } from './RecentActivity';

function item(overrides: Partial<DashboardRecentItem> = {}): DashboardRecentItem {
  return {
    at: '2026-07-28T00:00:00.000Z',
    kind: 'GOAL_SET',
    refType: 'GOAL',
    refId: 'g1',
    label: '30 trial signups/mo',
    count: null,
    value: null,
    unit: null,
    ...overrides,
  };
}

describe('RecentActivity', () => {
  it('says so when nothing has happened yet', () => {
    renderWithProviders(<RecentActivity items={[]} />);

    expect(screen.getByText(i18n.t('app.dashboard.recentEmpty'))).toBeInTheDocument();
  });

  it('renders one row per item, in the order given', () => {
    renderWithProviders(
      <RecentActivity
        items={[
          item({ kind: 'LEARNING_VALIDATED', refType: 'LEARNING', refId: 'l1', label: 'personalization wins' }),
          item(),
        ]}
      />,
    );

    // The server already sorted them newest-first; the component must not
    // reorder and must not sort by kind.
    const rows = screen.getAllByTestId('recent-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('personalization wins');
  });

  it('pluralizes the research findings count', () => {
    renderWithProviders(
      <RecentActivity
        items={[
          item({ kind: 'RESEARCH_COMPLETED', refType: 'AGENT_RUN', refId: 'r1', label: '', count: 6 }),
          item({ kind: 'RESEARCH_COMPLETED', refType: 'AGENT_RUN', refId: 'r2', label: '', count: 1 }),
        ]}
      />,
    );

    expect(screen.getByText(i18n.t('app.dashboard.recent.RESEARCH_COMPLETED', { count: 6 }))).toBeInTheDocument();
    expect(screen.getByText(i18n.t('app.dashboard.recent.RESEARCH_COMPLETED', { count: 1 }))).toBeInTheDocument();
  });

  it('renders an outcome with its value and unit', () => {
    renderWithProviders(
      <RecentActivity
        items={[item({ kind: 'OUTCOME_RECORDED', refType: 'OUTCOME', refId: 'o1', label: 'replies', value: 18, unit: 'replies' })]}
      />,
    );

    expect(
      screen.getByText(
        i18n.t('app.dashboard.recent.OUTCOME_RECORDED', { label: 'replies', value: 18, unit: 'replies' }),
      ),
    ).toBeInTheDocument();
  });

  it('renders an outcome with no unit without printing "null"', () => {
    renderWithProviders(
      <RecentActivity
        items={[item({ kind: 'OUTCOME_RECORDED', refType: 'OUTCOME', refId: 'o1', label: 'replies', value: 18, unit: null })]}
      />,
    );

    expect(screen.getByTestId('recent-row')).not.toHaveTextContent('null');
  });

  it('links each row at the route for its ref type', () => {
    renderWithProviders(
      <RecentActivity items={[item({ kind: 'STRATEGY_ACCEPTED', refType: 'STRATEGY', refId: 's1', label: 'outbound' })]} />,
    );

    expect(screen.getByRole('link')).toHaveAttribute('href', '/app/strategies/s1');
  });

  it.each([
    'GOAL_SET',
    'RESEARCH_COMPLETED',
    'STRATEGY_ACCEPTED',
    'STRATEGY_CREATED',
    'EXPERIMENT_CREATED',
    'EXPERIMENT_COMPLETED',
    'OUTCOME_RECORDED',
    'LEARNING_CREATED',
    'LEARNING_VALIDATED',
  ] as const)('renders %s without falling back to a raw key', (kind) => {
    renderWithProviders(<RecentActivity items={[item({ kind, count: 2, value: 1, unit: 'x' })]} />);

    const row = screen.getByTestId('recent-row');
    expect(row.textContent).not.toContain('app.dashboard.recent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/components/dashboard/RecentActivity.test.tsx`
Expected: FAIL — cannot resolve `./RecentActivity`.

- [ ] **Step 3: Add the copy keys**

In `en.json`, inside `app.dashboard`:

```json
    "recentTitle": "Recent",
    "recentEmpty": "Nothing yet. Your first steps will show up here.",
    "recent": {
      "GOAL_SET": "Goal set: {{label}}",
      "RESEARCH_COMPLETED_one": "Research found {{count}} finding",
      "RESEARCH_COMPLETED_other": "Research found {{count}} findings",
      "STRATEGY_ACCEPTED": "Strategy accepted: {{label}}",
      "STRATEGY_CREATED": "Strategy created: {{label}}",
      "EXPERIMENT_CREATED": "Experiment designed: {{label}}",
      "EXPERIMENT_COMPLETED": "Experiment completed: {{label}}",
      "OUTCOME_RECORDED": "Outcome recorded: {{value}} {{unit}}",
      "LEARNING_CREATED": "Learning written: {{label}}",
      "LEARNING_VALIDATED": "Learning validated: {{label}}"
    },
```

`pt.json`:

```json
    "recentTitle": "Recente",
    "recentEmpty": "Nada ainda. Seus primeiros passos vão aparecer aqui.",
    "recent": {
      "GOAL_SET": "Meta definida: {{label}}",
      "RESEARCH_COMPLETED_one": "A pesquisa encontrou {{count}} achado",
      "RESEARCH_COMPLETED_other": "A pesquisa encontrou {{count}} achados",
      "STRATEGY_ACCEPTED": "Estratégia aceita: {{label}}",
      "STRATEGY_CREATED": "Estratégia criada: {{label}}",
      "EXPERIMENT_CREATED": "Experimento desenhado: {{label}}",
      "EXPERIMENT_COMPLETED": "Experimento concluído: {{label}}",
      "OUTCOME_RECORDED": "Resultado registrado: {{value}} {{unit}}",
      "LEARNING_CREATED": "Aprendizado escrito: {{label}}",
      "LEARNING_VALIDATED": "Aprendizado validado: {{label}}"
    },
```

`es.json`:

```json
    "recentTitle": "Reciente",
    "recentEmpty": "Nada todavía. Tus primeros pasos aparecerán aquí.",
    "recent": {
      "GOAL_SET": "Meta definida: {{label}}",
      "RESEARCH_COMPLETED_one": "La investigación encontró {{count}} hallazgo",
      "RESEARCH_COMPLETED_other": "La investigación encontró {{count}} hallazgos",
      "STRATEGY_ACCEPTED": "Estrategia aceptada: {{label}}",
      "STRATEGY_CREATED": "Estrategia creada: {{label}}",
      "EXPERIMENT_CREATED": "Experimento diseñado: {{label}}",
      "EXPERIMENT_COMPLETED": "Experimento completado: {{label}}",
      "OUTCOME_RECORDED": "Resultado registrado: {{value}} {{unit}}",
      "LEARNING_CREATED": "Aprendizaje escrito: {{label}}",
      "LEARNING_VALIDATED": "Aprendizaje validado: {{label}}"
    },
```

Note the `_one` / `_other` suffixes: `locales.test.ts` compares leaf paths, so all three locales must carry both suffixes even where the two readings are identical.

- [ ] **Step 4: Write the component**

Create `web/src/components/dashboard/RecentActivity.tsx`:

```tsx
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { GetDashboardQueryResponse } from '@/api/generated/types/GetDashboard';
import { recentHref } from '@/lib/dashboard-actions';
import { Card, CardContent } from '@/components/ui/card';

export type DashboardRecentItem = GetDashboardQueryResponse['recent'][number];

export function RecentActivity({ items }: { items: DashboardRecentItem[] }) {
  const { t, i18n } = useTranslation();
  const relative = new Intl.DateTimeFormat(i18n.language, { day: '2-digit', month: 'short' });

  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-4 font-mono text-[11px] uppercase tracking-[0.15em] text-muted-foreground">
          {t('app.dashboard.recentTitle')}
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('app.dashboard.recentEmpty')}</p>
        ) : (
          <ul className="space-y-3">
            {items.map((entry) => {
              const href = recentHref(entry.refType, entry.refId);
              const copy = t(`app.dashboard.recent.${entry.kind}`, {
                label: entry.label,
                // i18next picks the plural form from `count`; passing null
                // would print "null", so it is normalised here.
                count: entry.count ?? 0,
                value: entry.value ?? '',
                unit: entry.unit ?? '',
              });
              return (
                <li key={`${entry.kind}-${entry.refId}`} data-testid="recent-row" className="flex gap-3 text-sm">
                  <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                    {relative.format(new Date(entry.at))}
                  </span>
                  {href ? (
                    <Link to={href} className="hover:text-primary">
                      {copy}
                    </Link>
                  ) : (
                    <span>{copy}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/components/dashboard/RecentActivity.test.tsx src/i18n/locales.test.ts`
Expected: PASS both.

- [ ] **Step 6: Commit**

```bash
cd web
git add src/components/dashboard/RecentActivity.tsx src/components/dashboard/RecentActivity.test.tsx src/i18n/locales
git commit -m "feat(dashboard): render the recent-activity feed

Copy is resolved from the kind in the founder's locale, findings are
pluralized properly in all three, and a missing unit never prints null."
```

---

## Task 10: Wire the page, and guard the copy

**Files:**
- Modify: `web/src/pages/DashboardPage.tsx` (rewritten)
- Modify: `web/src/pages/DashboardPage.test.tsx` (rewritten)
- Create: `web/src/i18n/dashboard-keys.test.ts`

**Interfaces:**
- Consumes: `useGetDashboard` (Task 5), `SetupChecklist` (Task 6), `LoopPanel` (Task 7), `NextActionCard` (Task 8), `RecentActivity` (Task 9).
- Produces: the `/app` screen. No new exports.

- [ ] **Step 1: Write the failing page test**

Replace `web/src/pages/DashboardPage.test.tsx` entirely:

```tsx
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n';
import { AuthProvider } from '@/lib/auth';
import { renderWithProviders } from '@/test/render';
import { stubFetch } from '@/test/stub-fetch';
import { DashboardPage } from './DashboardPage';

const MID_SETUP = {
  setup: { business: true, icp: true, goal: true, research: false, strategy: false, completed: 3, total: 5 },
  stage: 'RESEARCH',
  nextAction: {
    kind: 'RUN_RESEARCH',
    subjectLabel: null,
    experimentId: null,
    learningId: null,
    endDate: null,
  },
  loop: null,
  recent: [],
};

const IN_LOOP = {
  setup: { business: true, icp: true, goal: true, research: true, strategy: true, completed: 5, total: 5 },
  stage: 'OUTCOME',
  nextAction: {
    kind: 'RECORD_OUTCOME',
    subjectLabel: 'LinkedIn DM test',
    experimentId: 'e1',
    learningId: null,
    endDate: null,
  },
  loop: {
    number: 1,
    goal: { id: 'g1', name: '30 trial signups/mo', metric: 'signups', targetValue: 30, unit: 'signups' },
    strategy: { id: 's1', name: 'founder-led outbound' },
    experiment: { id: 'e1', name: 'LinkedIn DM test', status: 'COMPLETED', metric: 'replies', endDate: null },
    rail: [
      { node: 'STRATEGY', state: 'DONE' },
      { node: 'EXPERIMENT', state: 'DONE' },
      { node: 'OUTCOME', state: 'CURRENT' },
      { node: 'LEARNING', state: 'TODO' },
    ],
  },
  recent: [
    {
      at: '2026-07-27T00:00:00.000Z',
      kind: 'EXPERIMENT_COMPLETED',
      refType: 'EXPERIMENT',
      refId: 'e1',
      label: 'LinkedIn DM test',
      count: null,
      value: null,
      unit: null,
    },
  ],
};

function renderDashboard() {
  return renderWithProviders(
    <AuthProvider>
      <DashboardPage />
    </AuthProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('DashboardPage mid-setup', () => {
  it('shows the checklist and no loop panel', async () => {
    stubFetch({ '/dashboard': { body: MID_SETUP } });

    renderDashboard();

    expect(await screen.findByText('3 / 5')).toBeInTheDocument();
    // loop is null, so there is nothing to describe yet.
    expect(screen.queryByTestId('rail-node')).not.toBeInTheDocument();
  });

  it('names the first missing step as the next action', async () => {
    stubFetch({ '/dashboard': { body: MID_SETUP } });

    renderDashboard();

    expect(await screen.findByText(i18n.t('app.dashboard.next.RUN_RESEARCH'))).toBeInTheDocument();
  });
});

describe('DashboardPage in the loop', () => {
  it('makes the loop the hero and collapses the checklist', async () => {
    stubFetch({ '/dashboard': { body: IN_LOOP } });

    renderDashboard();

    expect(await screen.findByText(i18n.t('app.dashboard.loopTitle', { number: 1 }))).toBeInTheDocument();
    expect(screen.getAllByTestId('rail-node')).toHaveLength(4);
    expect(screen.getByText(i18n.t('app.dashboard.setupDone', { completed: 5, total: 5 }))).toBeInTheDocument();
    // Collapsed: the step rows are not on screen.
    expect(screen.queryByRole('link', { name: i18n.t('app.dashboard.steps.research.title') })).not.toBeInTheDocument();
  });

  it('shows the next action and the feed', async () => {
    stubFetch({ '/dashboard': { body: IN_LOOP } });

    renderDashboard();

    expect(
      await screen.findByText(i18n.t('app.dashboard.next.RECORD_OUTCOME', { subject: 'LinkedIn DM test' })),
    ).toBeInTheDocument();
    expect(screen.getByTestId('recent-row')).toHaveTextContent('LinkedIn DM test');
  });

  it('issues exactly one request for the whole screen', async () => {
    const calls: { method: string; path: string; body: unknown }[] = [];
    stubFetch({ '/dashboard': { body: IN_LOOP } }, calls);

    renderDashboard();
    await screen.findByText(i18n.t('app.dashboard.loopTitle', { number: 1 }));

    // The point of the backend slice: no fan-out, no waterfall.
    expect(calls.filter((call) => call.path === '/dashboard')).toHaveLength(1);
    expect(calls.every((call) => call.path === '/dashboard')).toBe(true);
  });
});

describe('DashboardPage failure', () => {
  it('shows an error instead of an empty screen', async () => {
    stubFetch({ '/dashboard': { status: 500, body: { error: { code: 'INTERNAL' } } } });

    renderDashboard();

    expect(await screen.findByText(i18n.t('app.dashboard.error'))).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && pnpm vitest run src/pages/DashboardPage.test.tsx`
Expected: FAIL — the page still queries `/business`, `/icps`, `/goals`, `/strategies`, `/agent-runs`, so `stubFetch` throws `unstubbed /business`.

- [ ] **Step 3: Add the two remaining copy keys**

In `en.json` inside `app.dashboard`: `"error": "Could not load your dashboard. Try again."`
In `pt.json`: `"error": "Não foi possível carregar seu painel. Tente novamente."`
In `es.json`: `"error": "No se pudo cargar tu panel. Inténtalo de nuevo."`

- [ ] **Step 4: Rewrite the page**

Replace `web/src/pages/DashboardPage.tsx` entirely:

```tsx
import { useTranslation } from 'react-i18next';
import { useGetDashboard } from '@/api/generated/hooks/dashboardHooks/useGetDashboard';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/PageHeader';
import { SetupChecklist } from '../components/dashboard/SetupChecklist';
import { LoopPanel } from '../components/dashboard/LoopPanel';
import { NextActionCard } from '../components/dashboard/NextActionCard';
import { RecentActivity } from '../components/dashboard/RecentActivity';

export function DashboardPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const dashboard = useGetDashboard();

  const firstName = user?.name?.split(' ')[0] ?? '';
  const header = <PageHeader title={t('app.dashboard.welcome', { name: firstName })} subtitle={t('app.dashboard.subtitle')} />;

  if (dashboard.isLoading) {
    return (
      <div>
        {header}
        <div className="space-y-6">
          <div className="h-40 animate-pulse rounded-xl bg-muted" />
          <div className="h-24 animate-pulse rounded-xl bg-muted" />
        </div>
      </div>
    );
  }

  if (dashboard.isError || !dashboard.data) {
    return (
      <div>
        {header}
        <p className="text-sm text-destructive">{t('app.dashboard.error')}</p>
      </div>
    );
  }

  const { setup, nextAction, loop, recent } = dashboard.data;
  const setupComplete = setup.completed === setup.total;

  return (
    <div>
      {header}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {/* Before setup finishes the checklist is the hero and there is no
              loop to show; after, they swap (spec §3.7). */}
          {setupComplete && loop ? <LoopPanel loop={loop} /> : <SetupChecklist setup={setup} collapsed={false} />}
          <NextActionCard nextAction={nextAction} />
          {setupComplete && <SetupChecklist setup={setup} collapsed />}
        </div>

        <RecentActivity items={recent} />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && pnpm vitest run src/pages/DashboardPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Write the copy-coverage test**

Create `web/src/i18n/dashboard-keys.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import en from './locales/en.json';

type Tree = Record<string, unknown>;

/**
 * `locales.test.ts` only compares the three locale files against each other,
 * so a key missing from all three passes it cleanly while the founder reads
 * `app.dashboard.next.RECORD_OUTCOME` on screen. This guards the other
 * direction for the dashboard, exactly as `research-keys.test.ts` does for
 * research: every key the components actually ask for must resolve in en.
 */
const FILES = [
  'src/pages/DashboardPage.tsx',
  'src/components/dashboard/SetupChecklist.tsx',
  'src/components/dashboard/LoopPanel.tsx',
  'src/components/dashboard/NextActionCard.tsx',
  'src/components/dashboard/RecentActivity.tsx',
];

function literalKeys(source: string): string[] {
  const matches = source.matchAll(/\bt\(\s*['"](app\.dashboard(?:\.[A-Za-z0-9_]+)+)['"]/g);
  return [...matches].map((m) => m[1]!);
}

function dynamicPrefixes(source: string): string[] {
  const matches = source.matchAll(/\bt\(\s*`(app\.dashboard(?:\.[A-Za-z0-9_]+)+)\.\$\{[^}]+\}`/g);
  return [...matches].map((m) => m[1]!);
}

function get(tree: unknown, keyPath: string): unknown {
  return keyPath.split('.').reduce<unknown>((node, key) => (node as Tree | undefined)?.[key], tree);
}

/**
 * Mirrors the enums in the backend's `dashboard.schema.ts`. A kind added
 * there and rendered through a template-literal lookup fails here until its
 * copy exists — which is the whole point.
 */
const DYNAMIC_ENUMS: Record<string, string[]> = {
  'app.dashboard.steps': ['business', 'icp', 'goal', 'research', 'strategy'],
  'app.dashboard.rail': ['STRATEGY', 'EXPERIMENT', 'OUTCOME', 'LEARNING'],
  'app.dashboard.railHelp': ['STRATEGY', 'EXPERIMENT', 'OUTCOME', 'LEARNING'],
  'app.dashboard.recent': [
    'GOAL_SET',
    'STRATEGY_ACCEPTED',
    'STRATEGY_CREATED',
    'EXPERIMENT_CREATED',
    'EXPERIMENT_COMPLETED',
    'OUTCOME_RECORDED',
    'LEARNING_CREATED',
    'LEARNING_VALIDATED',
    // RESEARCH_COMPLETED is pluralized, so it lives under _one/_other and is
    // asserted separately below.
  ],
};

const NEXT_ACTION_KINDS = [
  'SET_UP_BUSINESS',
  'DEFINE_ICP',
  'SET_GOAL',
  'RUN_RESEARCH',
  'CHOOSE_STRATEGY',
  'DESIGN_EXPERIMENT',
  'PLAN_EXPERIMENT',
  'APPROVE_EXPERIMENT',
  'START_EXPERIMENT',
  'WAIT_FOR_EXPERIMENT',
  'COMPLETE_EXPERIMENT',
  'RESUME_EXPERIMENT',
  'RECORD_OUTCOME',
  'WRITE_LEARNING',
  'VALIDATE_LEARNING',
  'START_NEXT_LOOP',
];

describe('app.dashboard keys the dashboard components use', () => {
  const bySource = FILES.map((file) => ({ file, source: readFileSync(path.join(process.cwd(), file), 'utf8') }));

  // A regex that stops matching would make every assertion below vacuously
  // pass. Pin a floor so that failure stays loud.
  it('extracted a non-trivial number of keys', () => {
    const total = bySource.reduce((sum, { source }) => sum + literalKeys(source).length, 0);
    expect(total).toBeGreaterThan(8);
  });

  for (const { file, source } of bySource) {
    for (const key of literalKeys(source)) {
      it(`${file} — ${key} resolves in en.json`, () => {
        const value = get(en, key);
        expect(typeof value, `${key} is missing from en.json`).toBe('string');
        expect((value as string).trim().length).toBeGreaterThan(0);
      });
    }

    for (const prefix of dynamicPrefixes(source)) {
      it(`${file} — every value ${prefix} is indexed with resolves in en.json`, () => {
        const values = DYNAMIC_ENUMS[prefix];
        expect(values, `unrecognized dynamic prefix "${prefix}" — extend DYNAMIC_ENUMS`).toBeDefined();
        for (const value of values ?? []) {
          expect(typeof get(en, `${prefix}.${value}`), `${prefix}.${value} is missing`).toBe('string');
        }
      });
    }
  }

  // NextActionCard builds its key inside dashboard-actions.ts, so the regexes
  // above cannot see it. Assert the whole enum directly.
  it('every next-action kind has copy', () => {
    for (const kind of NEXT_ACTION_KINDS) {
      expect(typeof get(en, `app.dashboard.next.${kind}`), `next.${kind} is missing`).toBe('string');
    }
  });

  it('the research findings count has both plural forms', () => {
    expect(typeof get(en, 'app.dashboard.recent.RESEARCH_COMPLETED_one')).toBe('string');
    expect(typeof get(en, 'app.dashboard.recent.RESEARCH_COMPLETED_other')).toBe('string');
  });
});
```

- [ ] **Step 7: Run the whole web suite and typecheck**

Run: `cd web && pnpm test && pnpm typecheck`
Expected: all green. Baseline before this plan was 352 tests / 51 files; expect strictly more, none failing. If `locales.test.ts` fails, a key was added to one locale and not the other two.

- [ ] **Step 8: Check it by eye**

Run: `cd web && pnpm dev`, log in, open `/app`.
Expected: with setup incomplete, the checklist plus a next action and no rail. With setup complete, the loop panel with a four-node rail, a next action whose button lands on the right page, a collapsed `Setup 5/5` row that expands, and a recent feed. Switch language to PT and confirm no raw key paths appear.

- [ ] **Step 9: Commit**

```bash
cd web
git add src/pages/DashboardPage.tsx src/pages/DashboardPage.test.tsx src/i18n
git commit -m "feat(dashboard): make /app say where the loop stands

One request replaces five. Mid-setup the checklist leads; once setup is
done the loop panel leads and the checklist collapses. A copy-coverage
test fails when a kind ships without a translation."
```

---

## Self-Review

**Spec coverage.** Every section maps to a task: §3.1 spine and loop number → Tasks 1, 3; §3.2 stage machine → Task 1 (`dashboard.domain.test.ts` covers all eleven stages and all four `COMPLETED` branches, including the oldest-candidate rule); §3.3 `endDate` as planned end → Task 1 Step 4 comment plus the two RUNNING tests; §3.4 no prose, no URLs → Task 4's payload test and Task 5's action map; §3.5 derived history → Task 2; §3.6 one loop at a time → falls out of the spine query in Task 3, asserted by the `findFirst` ordering test; §3.7 checklist swap → Tasks 6 and 10; §4 contract → Task 1's schema, with the rail `CURRENT` table in Task 1 and both tie-breaks in Task 3; §5 backend structure → Tasks 1–4; §6 web structure → Tasks 5–10; §7 order of work → Task 4 Step 8 gates Task 5 Step 1.

Exit criteria: all nine have a test, except "no new table and no migration", which is a property of the plan touching no `prisma/` file — worth a reviewer's eye rather than a test.

**Placeholders.** None. Every code step carries the actual code; every test step carries the actual assertions. One step deliberately says *read the real name before writing against it* — Kubb's generated type names in Task 5 Step 2, because the suffix it picks (`…Enum2Key`, as `experiment-actions.ts` shows) depends on how many enums the OpenAPI document holds and therefore cannot be known until Task 4 has merged. That is a verification instruction with a stated fallback, not a deferred decision. The Prisma enum names, the `StrategyGoal` relation field and `Help`'s accessible name were all verified against the source while writing this plan.

**Type consistency.** `DashboardSnapshot`, `SpineExperiment`, `SpineLearning`, `RecentSources` are defined in Task 1/2 and consumed with those exact names in Tasks 3–4. `resolveDashboardState`, `setupFlags`, `isSetupComplete`, `buildRecent` keep one spelling throughout. `nextActionRoute(kind, { experimentId })` has the same signature in Task 5's test, Task 5's implementation and Task 8's component. The web components each re-export the response slice they take (`DashboardLoop`, `DashboardNextAction`, `DashboardRecentItem`), and Task 10 imports the components, not those types — so a Kubb rename lands in one file per type.

One thing a reviewer should watch: Task 3's `loopContext` calls `prisma.experiment.findFirst` a second time to read `strategyId`, which the spine query already selected. It is written this way so `loopContext` does not depend on the caller having passed the full row, but folding `strategyId` into `SpineExperiment` and dropping that read would be a fair simplification to accept if proposed during review.
