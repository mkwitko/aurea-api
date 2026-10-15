# AUREA Phase 03 — Growth Brain

This phase builds the structural heart of AUREA.

It maps to product roadmap Phase 1 (Business Context), Phase 2 (Goals), and Phase 3 (Growth Brain), delivered together as one coherent domain.

The Growth Brain is the canonical source of business growth state. It is not an agent, a model, or a prompt (see `docs/domains/growth-brain.md` section 30).

---

# 1. Objective

Implement the core Growth Brain domain: persistence, domain services, and invariants for the entities that hold business growth state.

Deliver `Business`, `BusinessContext` (with versions), `ICP`, `Goal`, `Strategy`, `Hypothesis`, and `Experiment` as persisted, related, queryable entities with enforced lifecycle rules.

Deliver the `AgentRun` recording scaffold and emit the domain events that later phases and agents react to.

After this phase the database can answer "what is true now" for a business's growth context, and agents (phase 04+) have a domain surface to read from and propose into.

---

# 2. Scope (what gets built)

Core entities (see `docs/architecture/persistance-model.md` sections 10–20 and 32; do not redefine them here).

```text
Business               (workspace-owned; one per workspace initially)
BusinessContext        (per business; points at current version)
BusinessContextVersion (immutable versions; data JSON, source, confidence)
ICP                    (workspace-owned; characteristics, pains, triggers)
Goal                   (workspace-owned; metric, baseline, target, deadline)
Strategy               (workspace-owned; references ≥1 Goal; versioned)
Hypothesis             (references a Strategy)
Experiment             (references a Hypothesis)
AgentRun               (operational scaffold; records agent executions)

Join entities:
GoalICP, StrategyGoal, StrategyICP
```

Domain services (conceptual commands, see growth-brain.md section 24).

```text
Business / Context
  CreateBusiness
  CreateBusinessContext
  UpdateBusinessContext   → creates a new BusinessContextVersion
  CreateICP / UpdateICP

Goal
  CreateGoal, ActivateGoal, CompleteGoal, PauseGoal, CancelGoal

Strategy
  CreateStrategy (DRAFT), ProposeStrategy, ApproveStrategy, ActivateStrategy, ArchiveStrategy

Hypothesis
  CreateHypothesis

Experiment
  CreateExperiment (DRAFT), PlanExperiment
  (full lifecycle transitions land in phase 06)
```

Invariants enforced in domain services and, where practical, by database constraints (growth-brain.md section 26, persistance-model.md section 41).

```text
- A Goal must belong to a workspace.
- A Strategy must reference at least one Goal.
- A Hypothesis must reference a Strategy.
- An Experiment must reference a Hypothesis.
- Context updates never overwrite history; they create a new version and
  set the previous version's supersededAt.
- Active/historical goals and strategies are not deleted; they transition
  state (COMPLETED, CANCELLED, ARCHIVED).
- AI-inferred context is not automatically a fact; source and confidence
  are recorded on every context version.
```

AgentRun scaffold.

```text
- Persist AgentRun (agentType, taskType, status, model, provider,
  token counts, estimatedCost, timestamps, error).
- A service to open, update, and close an AgentRun.
- No real agent executes yet; the scaffold records runs that phase 04+ create.
- AgentRun is operational data and never replaces domain entities.
```

Domain events (growth-brain.md section 25, event-architecture.md section 11).

```text
BusinessContextCreated, BusinessContextUpdated
GoalCreated, GoalActivated, GoalCompleted
StrategyCreated, StrategyApproved, StrategyActivated
HypothesisCreated
ExperimentCreated
```

All events use the DomainEvent envelope and are published through the EventBus from phase 01.

API and UI.

```text
- CRUD + lifecycle endpoints for each entity, workspace-scoped and role-guarded.
- Read models that assemble the Growth Brain view for a workspace.
- Minimal UI to create and view a Business, its Context, ICPs, Goals,
  Strategies, Hypotheses, and Experiments.
```

---

# 3. Dependencies (which earlier phases / must-haves)

```text
- Phase 00 — Foundation
- Phase 01 — Monorepo   (Prisma package, EventBus, API/web skeletons)
- Phase 02 — Identity   (workspace scoping, roles, tenant context)
```

References:

```text
- docs/domains/growth-brain.md         (domain model, lifecycles, invariants)
- docs/domains/business-context.md     (context structure)
- docs/domains/goals.md                (goal rules)
- docs/domains/strategies.md           (strategy rules)
- docs/architecture/persistance-model.md (entities, versioning, constraints)
- docs/architecture/event-architecture.md (envelope, domain events)
```

---

# 4. Deliverables (concrete artifacts)

```text
Schema (packages/db)
  Prisma models: Business, BusinessContext, BusinessContextVersion, ICP,
    Goal, Strategy, Hypothesis, Experiment, AgentRun
  Join models: GoalICP, StrategyGoal, StrategyICP
  Enums: Goal.status, Strategy.status, Hypothesis.status, Experiment.status,
    context source + confidence, AgentRun.status
  Constraints: workspaceId required on workspace-owned entities;
    Hypothesis.strategyId required; Experiment.hypothesisId required
  Migrations + seed (a demo business with context, an ICP, a goal)

Domain services (packages/shared or apps/api domain layer)
  Business/Context/ICP services with versioned context updates
  Goal service with lifecycle transitions
  Strategy service with lifecycle transitions and versioning
  Hypothesis and Experiment creation services
  Invariant checks with clear domain errors
  AgentRun service (open/update/close)

Events
  Emission of all domain events listed in section 2, via EventBus

API (apps/api)
  Workspace-scoped, role-guarded endpoints for every entity + lifecycle action
  A Growth Brain read endpoint assembling the workspace growth state

Web (apps/web)
  Screens to create/view Business, Context (with version history), ICPs,
  Goals, Strategies, Hypotheses, and draft Experiments

Tests
  Invariant tests (Strategy→Goal, Hypothesis→Strategy, Experiment→Hypothesis)
  Context versioning test (update creates version, supersedes prior)
  Lifecycle transition tests (valid and rejected transitions)
  Tenant isolation tests
  Event emission tests
```

---

# 5. Out of Scope (explicitly deferred)

```text
- Research Agent and knowledge ingestion                  → phase 04
- AI-generated strategies (Strategy Agent)                → phase 05
- Full Experiment run lifecycle (RUNNING/PAUSED/COMPLETED)→ phase 06
- Action, Outcome, Learning, Decision, Approval           → phases 09–11
- Real agent execution feeding AgentRun                   → phase 04+
- Content, social, analytics, autonomy                    → later phases
```

Strategies and experiments exist here structurally but are created by humans; agents fill them in later phases.

---

# 6. Exit Criteria (verifiable conditions)

```text
[ ] All listed entities persist and are queryable, scoped by workspace.
[ ] A Strategy cannot be created without at least one Goal (rejected + tested).
[ ] A Hypothesis cannot be created without a Strategy (rejected + tested).
[ ] An Experiment cannot be created without a Hypothesis (rejected + tested).
[ ] Updating business context creates a new BusinessContextVersion and
    supersedes the previous one; history is retained (tested).
[ ] Goal and Strategy lifecycle transitions enforce valid state changes.
[ ] Domain events are emitted on create/activate/approve as specified,
    carrying the correct workspace and actor (tested).
[ ] AgentRun records can be opened, updated, and closed with token/cost fields.
[ ] The Growth Brain read endpoint returns a coherent view of a workspace's
    business, context, ICPs, goals, strategies, hypotheses, experiments.
[ ] Tenant isolation holds for every new entity.
```

---

# 7. Growth Brain Domain Flow

```text
Business
   └── BusinessContext ── version history (v1 → v2 → …)
ICP(s)
   │
   ▼
Goal ───────────────┐
   │ references      │ (GoalICP)
   ▼                 ▼
Strategy ── references ≥1 Goal ── targets ICP(s)
   │  (versioned; DRAFT→PROPOSED→APPROVED→ACTIVE→ARCHIVED)
   ▼
Hypothesis ── references Strategy
   │
   ▼
Experiment ── references Hypothesis
   (DRAFT / PLANNED here; run lifecycle in phase 06)

Every mutation:
  → enforce invariant
  → persist
  → emit domain event (EventBus)
  → optionally recorded against an AgentRun (when agent-driven)
```

The database answers "what is true now."

Events answer "what happened."

AgentRun answers "how did the AI work."

These separations are the foundation of AUREA intelligence infrastructure.
