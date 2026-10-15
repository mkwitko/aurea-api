# AUREA Phase 06 — Experiments

This phase completes the intelligence loop up to measurable experiments.

It maps to product roadmap Phase 6 (Experimentation).

It turns hypotheses into planned, tracked experiments with success criteria and a full lifecycle. This is the last phase of the Copilot-level intelligence loop before execution.

---

# 1. Objective

Implement the full `Hypothesis` and `Experiment` lifecycle.

Deliver experiment definition with success criteria and metrics, an experiment planning UI, enforced state transitions, and the lifecycle events that later execution and analytics phases depend on.

After this phase AUREA can define and track a growth experiment end to end, up to (but not including) automated execution and measurement.

An experiment is not successful merely because it completed. Success is determined by its metrics and success criteria (see `docs/domains/growth-brain.md` section 14).

---

# 2. Scope (what gets built)

Hypothesis lifecycle (persistance-model.md section 19).

```text
Statuses: DRAFT → PROPOSED → (TESTED) → VALIDATED | REJECTED
- A hypothesis references a strategy (invariant from phase 03).
- Validation/rejection is driven later by outcomes; here the transitions
  and their guards are implemented.
```

Experiment definition (persistance-model.md section 20, growth-brain.md section 13).

```text
An experiment specifies:
  objective, hypothesisId, strategyId, channel, audience, variables,
  metric, baselineValue, targetValue, successCriteria, startDate, endDate
- Every experiment references a hypothesis (invariant).
- successCriteria is explicit and testable (e.g. "qualified leads ≥ 1000
  over 30 days" or "conversion uplift ≥ 20% vs baseline").
```

Experiment lifecycle (growth-brain.md section 14).

```text
DRAFT → PLANNED → APPROVED → RUNNING → (PAUSED ↔ RUNNING) → COMPLETED
                                     └────────────────────→ CANCELLED
- Transitions are validated; invalid transitions are rejected.
- Approval is role-guarded and required before RUNNING.
- Start/complete set startedAt/completedAt timestamps.
- Experiments are historical entities: not deleted, only CANCELLED/COMPLETED.
```

Experiment planning UI.

```text
- Define an experiment from a hypothesis: metric, baseline, target,
  success criteria, channel, audience, variables, duration.
- Review and approve an experiment plan.
- Track experiment state and see its success criteria.
```

Success criteria and metrics.

```text
- A metric with baseline and target is required to move beyond DRAFT.
- Success criteria are stored in a form the system can later evaluate
  against outcomes (phase 09 supplies the actual measurement).
```

Events (growth-brain.md section 25, event-architecture.md).

```text
HypothesisCreated, HypothesisValidated, HypothesisRejected
ExperimentCreated, ExperimentStarted, ExperimentPaused, ExperimentCompleted
```

Emitted through the EventBus with correlationId so the full workflow
(Goal → Strategy → Hypothesis → Experiment) is traceable.

---

# 3. Dependencies (which earlier phases / must-haves)

```text
- Phase 02 — Identity     (workspace scoping, approval roles)
- Phase 03 — Growth Brain (Hypothesis, Experiment persistence + invariants, events)
- Phase 05 — Strategy     (strategies + candidate hypotheses to test)
```

References:

```text
- docs/domains/experiments.md          (experiment domain rules)
- docs/domains/growth-brain.md         (hypothesis + experiment lifecycles)
- docs/architecture/persistance-model.md (Experiment, Hypothesis, constraints)
- docs/architecture/event-architecture.md (lifecycle events, correlation)
```

---

# 4. Deliverables (concrete artifacts)

```text
Schema (packages/db)
  Experiment fields for success criteria + metrics confirmed/added
  Lifecycle timestamps: startedAt/startDate, completedAt, endDate
  Enums: Experiment.status, Hypothesis.status
  Constraint: Experiment.hypothesisId required
  Migration if fields are added

Domain services (apps/api domain layer)
  Hypothesis transitions: propose, validate, reject (with guards)
  Experiment services:
    CreateExperiment, PlanExperiment, ApproveExperiment,
    StartExperiment, PauseExperiment, ResumeExperiment,
    CompleteExperiment, CancelExperiment
  State-machine guard rejecting invalid transitions
  Requirement that metric + baseline + target + successCriteria exist
    before leaving DRAFT

API (apps/api)
  POST /hypotheses/:id/{propose|validate|reject}
  POST /experiments                         create (DRAFT)
  PATCH /experiments/:id                     edit plan
  POST /experiments/:id/plan                 → PLANNED
  POST /experiments/:id/approve              → APPROVED (role-guarded)
  POST /experiments/:id/{start|pause|resume|complete|cancel}
  GET  /experiments, GET /experiments/:id    with status + criteria

Web (apps/web)
  Experiment planning form (from a hypothesis)
  Experiment board grouped by lifecycle state
  Experiment detail with success criteria and transition controls

Events
  Hypothesis* and Experiment* lifecycle events via EventBus (correlated)

Tests
  Experiment→Hypothesis invariant enforced
  Cannot leave DRAFT without metric + baseline + target + successCriteria
  Invalid transitions rejected (e.g. DRAFT→RUNNING, COMPLETED→RUNNING)
  Approval role-guarded; VIEWER denied
  Start/complete set timestamps; completion does not imply success
  Lifecycle events emitted with correct workspace, actor, correlationId
  Tenant isolation holds
```

---

# 5. Out of Scope (explicitly deferred)

```text
- Content creation to run the experiment            → phase 07
- Social/paid distribution (actual execution)        → phases 08, 11
- Outcome recording and success evaluation            → phase 09
- Learning extraction from results                    → phase 10
- Automatic experiment iteration                       → phases 10–11
- AI-generated experiment plans                        → optional later;
    here experiments may be human-planned from hypotheses
```

Experiments are planned and tracked here.

They are executed and measured in later phases.

---

# 6. Exit Criteria (verifiable conditions)

```text
[ ] An experiment can be created only from a hypothesis (invariant enforced).
[ ] An experiment cannot leave DRAFT without metric, baseline, target,
    and explicit success criteria.
[ ] The lifecycle state machine enforces valid transitions and rejects
    invalid ones (tested).
[ ] Approval is required before RUNNING and is role-guarded.
[ ] Starting and completing an experiment set the correct timestamps.
[ ] Completion records the experiment as COMPLETED without asserting success;
    success evaluation is deferred to phase 09.
[ ] Hypothesis and Experiment lifecycle events are emitted with a shared
    correlationId across the Goal→Strategy→Hypothesis→Experiment chain.
[ ] Experiments and hypotheses are workspace-isolated.
[ ] The planning UI can create, plan, approve, and track an experiment.
```

---

# 7. Experiment Lifecycle Flow

```text
Hypothesis (from a Strategy)
        │  define experiment
        ▼
Experiment  DRAFT
        │  metric + baseline + target + success criteria
        ▼
     PLANNED
        │  approve (role-guarded)   ExperimentCreated
        ▼
     APPROVED
        │  start                    ExperimentStarted
        ▼
     RUNNING  ⇄  PAUSED             ExperimentPaused
        │  complete                 ExperimentCompleted
        ▼
   COMPLETED  ──►  (success evaluated against criteria in phase 09)
        │
        └── may lead to HypothesisValidated / HypothesisRejected (phase 09–10)

Any state → CANCELLED (recorded, never deleted)
```

Completing the Copilot intelligence loop:

```text
Business Context → Goal → Research → Strategy → Hypothesis → Experiment
```

After this phase AUREA can produce genuinely useful growth intelligence.

Execution, measurement, and autonomy build on top of it.
