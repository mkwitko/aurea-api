# AUREA Phase 05 — Strategy

This phase makes AUREA recommend how to pursue a goal.

It maps to product roadmap Phase 5 (Strategy).

It adds the Strategy Agent and the human review flow that turns AI proposals into approved, active strategies.

---

# 1. Objective

Transform business context, goals, and research into coherent growth strategies.

Deliver the Strategy Agent that produces `DRAFT` strategies with explicit options and trade-offs, a human review flow to approve and activate strategies, and strategy versioning so proposals and iterations are traceable.

AI-generated strategies always begin as proposals. Human approval is required before activation (see `docs/domains/growth-brain.md` section 11).

---

# 2. Scope (what gets built)

Strategy generation (Strategy Agent, `packages/ai`).

```text
- Given a Goal, business context, ICPs, and available research, the agent
  produces one or more strategy proposals.
- Each proposal includes: objective, positioning, messaging, proposed
  channels, and candidate hypotheses.
- The agent presents options and trade-offs, not a single opaque answer.
- Every generation is recorded as an AgentRun (model, provider, cost).
- The Model Router selects the model by task complexity and cost.
```

Options and trade-offs.

```text
- A proposal set expresses alternatives (for example: paid-led vs
  content-led approach) with the trade-offs of each.
- The rationale for each option is captured so the human can decide.
```

Human review flow.

```text
- Strategies enter as DRAFT (per strategy lifecycle).
- A reviewer can compare options, edit, approve, or reject.
- Approval moves a strategy to APPROVED; activation moves it to ACTIVE.
- Rejected alternatives are NOT persisted as Strategy rows. A proposal set
  lives in AgentRun.output; accepting one option creates a single Strategy.
  The alternatives stay readable in the run, which is the audit record
  CLAUDE.md principle 7 asks for. Persisting every option would mean the
  agent writing canonical rows nobody chose (principle 3), and would leave
  an ARCHIVED row behind for every option ever declined.
  See docs/superpowers/specs/2026-07-28-strategy-agent-design.md §3.1.
```

Strategy versioning.

```text
- Strategy carries a version (persistance-model.md section 16, section 40).
- Editing an approved/active strategy creates a new version rather than
  silently overwriting the prior one.
- Prior versions remain retrievable for audit and learning.
```

Candidate hypotheses.

```text
- Proposals include candidate hypotheses tied to the strategy.
- Hypotheses are created (HypothesisCreated) but their experiment lifecycle
  is handled in phase 06.
```

Events (growth-brain.md section 25, event-architecture.md).

```text
StrategyCreated, StrategyUpdated, StrategyApproved, StrategyActivated
HypothesisCreated
RecommendationCreated, RecommendationApproved, RecommendationRejected
AgentRunStarted, AgentRunCompleted, AgentRunFailed
```

API and UI.

```text
- Endpoint to generate strategy proposals for a goal.
- Endpoints to review, edit, approve, activate, and archive strategies.
- UI to compare proposal options with their trade-offs and act on them.
```

---

# 3. Dependencies (which earlier phases / must-haves)

```text
- Phase 02 — Identity   (workspace scoping, roles: approval needs ADMIN/OWNER)
- Phase 03 — Growth Brain (Goal, Strategy, Hypothesis, versioning, AgentRun)
- Phase 04 — Research   (research + context that strategies build on)
```

References:

```text
- docs/agents/strategy-agent.md        (agent contract)
- docs/domains/strategies.md           (strategy rules)
- docs/domains/growth-brain.md         (strategy lifecycle, invariants)
- docs/architecture/ai-architecture.md (Model Router)
- docs/architecture/persistance-model.md (Strategy, versioning)
```

---

# 4. Deliverables (concrete artifacts)

```text
Schema (packages/db)
  Strategy versioning support confirmed (version field + version records)
  Storage for proposal options and trade-offs
    (structured JSON acceptable where structure is not yet stable)
  Migration if fields are added

AI (packages/ai)
  Strategy Agent generating DRAFT strategies with options + trade-offs
  Prompt/task definitions grounded in Growth Brain context + research
  AgentRun recording

API (apps/api)
  POST /goals/:id/strategies/generate   produce proposals (async → AgentRun)
  GET  /strategies                      list, with status + version
  GET  /strategies/:id                  detail incl. options + trade-offs
  PATCH /strategies/:id                 edit → new version
  POST /strategies/:id/approve          → APPROVED (role-guarded)
  POST /strategies/:id/activate         → ACTIVE (role-guarded)
  POST /strategies/:id/archive          → ARCHIVED

Web (apps/web)
  Proposal comparison view (options side by side with trade-offs + rationale)
  Approve / activate / reject / edit actions
  Version history view

Events
  StrategyCreated/Updated/Approved/Activated, HypothesisCreated,
  Recommendation*, AgentRun*

Tests
  A generated strategy is DRAFT and references its Goal
  Approval requires an authorized role; VIEWER is denied
  Editing an active strategy creates a new version; history retained
  Rejected options are never persisted as Strategy rows (Human review flow)
  Strategy→Goal invariant holds; tenant isolation holds
  AgentRun recorded for each generation
```

---

# 5. Out of Scope (explicitly deferred)

```text
- Full experiment lifecycle and metrics tracking   → phase 06
- Content and distribution to execute a strategy    → phases 07–08
- Outcomes / measurement feeding strategy iteration → phases 09–10
- Autonomous approval of strategies                  → never; human-in-the-loop
- Paid channel execution                             → phase 11
```

The Strategy Agent proposes. A human approves and activates.

---

# 6. Exit Criteria (verifiable conditions)

```text
[ ] Generating strategies for a goal produces one or more DRAFT strategies,
    each with explicit options and trade-offs.
[ ] Each proposal references its Goal. It carries no ICP link — the founder
    adds ICPs afterward through the existing strategy routes (design spec §4.1).
[ ] A strategy cannot become ACTIVE without human approval.
[ ] Approval and activation are role-guarded (ADMIN/OWNER); VIEWER denied.
[ ] Editing an approved/active strategy creates a new version; prior versions
    remain retrievable.
[ ] Activating a strategy has no alternatives to archive; they were never
    Strategy rows — see the Human review flow note above.
[ ] Candidate hypotheses are created and emit HypothesisCreated.
[ ] StrategyApproved and StrategyActivated events are emitted.
[ ] Each generation records a complete AgentRun.
```

---

# 7. Strategy Flow

```text
Goal + Business Context + ICPs + Research
        │  generate
        ▼
Strategy Agent  (AgentRun; Model Router)
        │  produces
        ▼
Proposal set  (DRAFT)
   Option A ── trade-offs ── candidate hypotheses
   Option B ── trade-offs ── candidate hypotheses
        │  StrategyCreated / RecommendationCreated
        ▼
Human review  (compare, edit, decide)
        │  approve → APPROVED   (StrategyApproved)
        ▼
Activate → ACTIVE  (StrategyActivated; alternatives stay in AgentRun.output)
        │
        ▼
Hypotheses ready for experiments  (phase 06)
```

Strategies are the bridge from understanding to testable belief.

They must always be approved by a human before they become active.
