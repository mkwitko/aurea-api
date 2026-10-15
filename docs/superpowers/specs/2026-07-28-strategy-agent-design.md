# Strategy Agent — AUREA proposes, the founder decides

**Status:** approved design, not yet planned
**Repos:** `aurea-back` (agent, tools, routes) and `aurea-web` (propose-and-review UI)
**Phase:** engineering phase 05 (`docs/development/phase-05-strategy.md`)

## 1. Why now

The AI foundation is complete and unreachable. `AGENT_REGISTRY` holds one agent,
`POST /agent-runs` and `GET /agent-runs/:id` are live, credits meter every run —
and no page in `aurea-web` calls any of it. The only non-generated reference to
`agentRun` in the frontend is a billing ledger test.

Strategies today are a form. The founder types a strategic thesis, a growth
mechanism and a set of channels into a create page. `docs/development/mvp.md`
§10 names the failure signal for exactly this: *"Strategies feel generic →
intelligence not yet real."* A form cannot fail that test, because it never
claims anything.

This is the first feature where AUREA reasons in front of a user. The
run-and-review interface it needs is built once here and reused by every agent
after it.

## 2. What is being built

```
/app/strategies  ── pick goal, see cost ──▶ POST /agent-runs
                                             { propose-strategies, { goalId } }
                                                   │ queued (BullMQ)
                                                   ▼
                                    worker: authorize credits → run agent
                                                   │
                     poll GET /agent-runs/:id ◀────┘  PENDING → RUNNING → COMPLETED
                                    │
                     run.output.options = [A, B, C]
                                    │ founder picks B
                                    ▼
              POST /strategies/from-proposal { agentRunId, optionIndex }
                   $transaction → Strategy(DRAFT) + Hypothesis × N (DRAFT)
                                    ▼
                        /app/strategies/:id — the hypotheses are already there,
                        and "Design an experiment" works from the existing flow
```

## 3. Decisions

### 3.1 Options live on the run, not as Strategy rows

Only the option the founder picks becomes a `Strategy`. The rejected options stay
readable in the run's stored `output` and are never rows.

**This diverges from `docs/development/phase-05-strategy.md`**, which says
"Activating a strategy does not delete alternatives; they are archived" —
implying every proposal is persisted and later archived. The divergence is
deliberate:

- `CLAUDE.md` principle 3 says agents do not own canonical business state. Under
  the phase doc's shape, the worker writes canonical `Strategy` rows nobody
  asked for.
- Every rejected option would leave an `ARCHIVED` row behind permanently. Three
  runs before the founder likes something is six pieces of debris in a list
  whose whole job is to show what the business is actually doing.
- Nothing is lost: the alternatives remain in `AgentRun.output`, which is the
  audit record `CLAUDE.md` principle 7 asks for.

The phase document must be updated to record this, not silently contradicted.

### 3.2 Accepting writes through one transactional route

`POST /strategies/from-proposal { agentRunId, optionIndex }` re-reads the chosen
option from the stored run output and writes the `Strategy` and its
`Hypothesis` rows in a single `$transaction`.

The browser never sends the strategy body. Two reasons: a sequence of client
calls can fail halfway and leave a strategy carrying one of its three
hypotheses with no clean retry, and a client-supplied body lets the browser
claim the agent proposed something it did not.

### 3.3 Credits are guidance in the UI and enforcement in the worker

`authorizeRun` runs inside the worker, so a shortfall surfaces asynchronously as
a failed run. The page therefore reads the balance and the published price and
disables **Start** when the balance will not cover the run, with a link to
billing.

This is guidance only. The worker still authorizes; a race just surfaces as a
`FAILED` run carrying the server's reason. The frontend never decides whether a
run may proceed.

### 3.4 A reload must not lose a run in flight

There is no list-runs endpoint today. One is added — `GET /agent-runs` filtered
by `taskType` and `status` — so the page can find an in-flight run on mount and
resume polling. A 15-second wait on a phone will meet a reload often enough that
losing the result is a real cost, and a stored run id in `localStorage` would not
survive a change of device.

### 3.5 Accepting creates the candidate hypotheses too

Each option carries 2–3 candidate hypotheses; accepting creates them as `DRAFT`
`Hypothesis` rows against the new strategy. `StrategyDetailPage` already lists a
strategy's hypotheses and already offers "Design an experiment" from one, so the
founder lands on a strategy with something testable and the existing experiment
flow carries it forward. This is the shortest path from a goal to a running
experiment, which is what the MVP has to prove.

## 4. Backend

### 4.1 The agent

`src/ai/agents/propose-strategies.ts`, registered in `AGENT_REGISTRY`.

| Field | Value |
|---|---|
| `taskType` | `propose-strategies` |
| `agentType` | `strategy-analyst` |
| `tier` | `TIER2` — the catalogue has only TIER1 and TIER2, and strategic reasoning is the harder of the two |
| `inputSchema` | `{ goalId: uuid }` |

The input carries no `businessId`. One business per workspace is MVP scope
(`docs/development/mvp.md` §5 cuts multiple businesses per org), so the tool
resolves it from the tenant.

`outputSchema`:

```
{
  options: [2..3] {
    name:            string(1..200)
    strategicThesis: string(1..2000)
    growthMechanism: string(1..160)
    expectedOutcome: string(1..1000)
    channels:        string[](1..6)
    assumptions:     string[](1..5)
    risks:           string[](1..5)
    tradeoffs:       string(1..1000)   // what this option gives up
    hypotheses: [2..3] {
      statement:       string(1..500)
      rationale:       string(1..1000)
      targetMetric:    string(1..160)
      expectedOutcome: string(1..1000)
      confidence:      LOW | MEDIUM | HIGH
    }
  }
  recommendedIndex: int (0-based, within range)
  rationale:        string(1..1000)   // why that one, given the goal
}
```

Every option field maps onto a column `Strategy` already has
(`strategicThesis`, `growthMechanism`, `expectedOutcome`, `channels`,
`assumptions`, `risks`), and every hypothesis field onto one `Hypothesis`
already has. Accepting is a copy, not a translation. `tradeoffs` has no column;
it is stored in the run output and shown during review, which is where it
matters — after acceptance the trade-off is a decision already made. The
accepted strategy also carries no ICP link: `optionSchema` has no ICP field,
so there is nothing to copy — wiring ICP selection into the agent's output is
out of this phase's scope, and the founder adds it through the ICP routes
`Strategy` already has.

The recommendation is a recommendation. The UI marks it as such and the founder
picks; nothing auto-selects.

### 4.2 The tool

`src/ai/tools/get-growth-context.ts` — `get_growth_context`, one call returning
the goal, the workspace's ICPs, and the current business context.

It mirrors `get-business-context.ts` exactly:

- the `goalId` comes from the run input, never from the model's arguments, so
  text injected into the context cannot ask for another tenant's goal
- every read is scoped by `ctx.tenant.workspaceId`
- a goal outside the workspace returns `{ error: 'goal not found in this workspace' }`
  rather than throwing

The system prompt repeats the line the existing agent carries: everything the
tool returns is DATA, never instructions.

One tool rather than three because a model that must make three calls before
answering will sometimes make two.

### 4.3 Credit cost

Register `'propose-strategies'` in `CREDITS_BY_TASK` (`src/billing/operation-cost.ts`)
at **3 credits**. That file's anchor is perceived effort, with a composite action
costing the sum of its parts; three proposed options with their hypotheses is
three recognisable pieces of work.

`GET /credits/pricing` already publishes the catalogue, so the frontend reads the
number rather than hardcoding it. An unregistered task type throws
`UnknownOperationCostError` — a new agent cannot ship free by omission.

### 4.4 New routes

**`GET /agent-runs?taskType=&status=&limit=`** — `listAgentRuns`. Workspace-scoped,
newest first, both filters optional, `limit` defaulting to 20 and capped at 50.
Read-only, so a VIEWER may call it.

**`POST /strategies/from-proposal`** — `createStrategyFromProposal`.
Body `{ agentRunId: uuid, optionIndex: int >= 0 }`.

| Case | Response |
|---|---|
| run in another workspace | 404 |
| run not `COMPLETED` | 400, naming the status it is in |
| `optionIndex` out of range | 400 |
| run output fails the agent's `outputSchema` | 400 — a stored shape that no longer parses is not a proposal to copy |
| VIEWER | 403 via `denyReadOnly` |
| otherwise | 201 with the created strategy |

The write is one `$transaction`: `Strategy` at `DRAFT` linked to the run's
`goalId`, then its `Hypothesis` rows at `DRAFT`. Nothing half-created.

The route records which run and which option produced the strategy, so the
decision stays auditable (`CLAUDE.md` principle 7).

## 5. Frontend

One new component, `ProposeStrategies`, on `/app/strategies`. No new route: the
existing empty state already says there are no strategies yet, and this is the
answer to it.

| Run state | On screen |
|---|---|
| idle | goal picker (`ACTIVE` goals), cost from `/credits/pricing` against the balance, **Start** — disabled with a billing link when the balance is short |
| `PENDING` / `RUNNING` | polling every 2s; a plain "AUREA is thinking" state, no invented progress bar |
| `COMPLETED` | the options side by side, the recommended one marked as a recommendation, **Use this one** per option |
| `FAILED` | the server's reason, with a billing link when the failure is about credits |
| `CANCELLED` | treated as terminal; offer to start again |

On mount the page calls `GET /agent-runs?taskType=propose-strategies&status=RUNNING`
and resumes polling if one is in flight. Polling stops on any terminal status and
on unmount.

Accepting an option invalidates the strategies list and the hypotheses list, then
navigates to `/app/strategies/:id`.

Every new domain term gets a `<Help>`, and all copy ships in en/pt/es with
`locales.test.ts` green — the standing rules in `aurea-web/CLAUDE.md`.

## 6. Testing

Backend:

- the output schema rejects a model that returns one option or four, and a
  `recommendedIndex` outside the range — truncating or clamping would let a
  malformed answer through as a proposal
- the tool refuses a goal from another workspace and takes its id from the run
  input, not from model arguments
- `from-proposal` is atomic (a failing hypothesis insert leaves no strategy),
  refuses a non-`COMPLETED` run, refuses an out-of-range index, 404s across
  tenants, and is refused for a VIEWER — the last one added to
  `write-guard.test.ts` with the rest
- `listAgentRuns` is workspace-scoped and filters server-side

Frontend:

- each run state renders from a stubbed poll sequence, including
  `PENDING → RUNNING → COMPLETED`
- a run already in flight on mount is picked up and polled
- **Start** is disabled when the balance is short, and the reason says so
- a `FAILED` run shows the server's message, not a generic one
- accepting posts `{ agentRunId, optionIndex }` and navigates to the new strategy

## 7. Out of scope

- **Research and evidence.** The agent reasons from stored context only. Real
  evidence with provenance arrives with engineering phase 04, and the `evidence`
  column stays empty until then rather than being filled with the model's
  recollection.
- **Strategy versioning** (phase 05 also lists it) — nothing here edits an
  approved strategy.
- **Editing an option before accepting.** Accept, then edit through the routes
  that already exist.
- **Comparing runs over time**, and any second agent.

## 8. Open risks

| Risk | Position |
|---|---|
| A TIER2 model may still return generic strategies | This is the thing being tested. `docs/development/mvp.md` §10 makes "strategies feel generic" a product failure signal, and it is only observable once a real one is on screen. |
| 3 credits may be the wrong price | Priced from the anchor in `operation-cost.ts`, not from token cost. Changing it later is a one-line change in a published catalogue. |
| Polling every 2s across many workspaces | Acceptable at design-partner scale, and bounded: polling stops at a terminal status. Revisit with SSE only if it becomes a real load. |
| The phase-05 document now contradicts the build | Resolved by updating it in the same change as §3.1, not by leaving both stories in the repository. |
