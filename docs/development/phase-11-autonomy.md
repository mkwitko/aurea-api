# AUREA Autonomy

This phase matures AUREA from Operator toward controlled Autopilot.

Execution becomes orchestrated, policy-governed, and guarded.

AUREA can execute approved actions reliably and, within strict constraints, begin acting on pre-authorized decisions.

Paid growth is introduced as controlled experiments.

Autonomy is introduced progressively.

The system does not begin at full autonomy.

Guardrails are mandatory before any autonomous behavior.

---

# 1. Objective

Establish the Operator maturity and the controlled foundations for Autopilot.

The system orchestrates multi-step actions, enforces approval policies, applies guardrails on budget and risk, monitors execution, and maintains a complete audit trail.

Paid growth on Meta, Google, and TikTok Ads is executed as controlled experiments under human-authorized limits.

The objective is to prove that AUREA can execute increasingly consequential actions safely, with autonomy expanding only where guardrails demonstrably hold.

```text
Decision / Approved Plan
        ↓
Approval Policy Check
        ↓
Guardrail Evaluation (budget / risk)
        ↓
Action Orchestration
        ↓
Integration Execution
        ↓
Execution Monitoring
        ↓
Audit Trail + Outcomes
```

---

# 2. Autonomy Model

AUREA autonomy progresses through defined levels.

```text
COPILOT
  Analyze + Recommend. Human executes.

OPERATOR
  Analyze + Propose + Execute approved actions.

AUTOPILOT
  Analyze + Decide + Execute within predefined constraints.
```

This phase completes Operator and introduces constrained Autopilot.

Autopilot is enabled per workspace, per action type, and only within guardrails.

Autonomy level is an explicit configuration, never an implicit default.

---

# 3. Scope

## 3.1 Action Orchestration

Support multi-step action plans, not only single actions.

An orchestration coordinates a sequence of Actions toward an Experiment.

```text
Plan
 ├── Action 1
 ├── Action 2
 └── Action 3
```

Orchestration handles ordering, dependencies, partial failure, and compensation.

Each step remains an Action with its own lifecycle from `persistance-model.md`.

Orchestration is driven asynchronously via the Event Bus.

## 3.2 Approval Policies

Approval requirements become policy-driven.

A policy determines whether an Action requires human approval.

Policy inputs include:

```text
Action type
Risk level
Estimated cost / budget impact
Autonomy level of the workspace
Channel
Historical reliability
```

```text
Action proposed
        ↓
Approval Policy
        ↓
Auto-approve (within constraints)  or  Require human approval
```

Auto-approval is only permitted where guardrails and autonomy configuration allow it.

Consequential actions always require approval unless explicitly pre-authorized within limits.

## 3.3 Guardrails

Guardrails constrain what AUREA may do autonomously.

```text
Budget limits (per campaign / per period / per workspace)
Risk limits (max risk level for auto-execution)
Rate limits (actions per period)
Spend velocity limits
Blocked actions and channels
Kill switch (immediate halt)
```

A guardrail violation blocks execution and escalates to a human.

Guardrails are evaluated before every autonomous or auto-approved action.

Guardrail configuration and every evaluation are recorded.

## 3.4 Paid Growth Execution

Introduce advertising integrations described in `integration-architecture.md`.

```text
Meta Ads
Google Ads
TikTok Ads
```

Supported operations.

```text
Get Accounts
Get Campaigns
Get Ad Sets
Get Ads
Get Metrics

Create Campaign
Update Campaign
Pause Campaign
Update Budget
```

High-risk operations require authorization.

All paid actions run as controlled experiments with defined budgets and success criteria.

Budget changes are always subject to guardrails.

Ad execution creates ExternalReferences and emits integration events.

## 3.5 Execution Monitoring

Running executions are monitored continuously.

```text
Execution status
Progress of orchestrated steps
Spend against budget
Error and failure rates
Guardrail proximity (approaching limits)
```

Monitoring can pause an orchestration or trigger the kill switch.

Anomalies surfaced by Phase 09 analytics can feed monitoring.

## 3.6 Audit Trail

Every consequential step is auditable.

Use the AuditLog entity defined in `persistance-model.md`.

```text
AuditLog
├── actorType (USER / AGENT / SYSTEM / INTEGRATION)
├── action
├── entityType
├── entityId
├── before
├── after
└── createdAt
```

The trail preserves the auditable-decisions chain.

```text
Input context
Decision
Rationale summary
Proposed action
Approval (or auto-approval policy)
Guardrail evaluation
Execution
Result
```

The system must not rely on conversational history as the only record.

## 3.7 Events

Emit events defined in `event-architecture.md`.

```text
ActionProposed
ActionApproved
ActionRejected
ActionExecuted
ActionFailed
DecisionCreated
ExternalActionRequested
ExternalActionSucceeded
ExternalActionFailed
ExternalCampaignCreated
ExternalCampaignUpdated
```

Events carry correlation and causation IDs so an orchestration can be traced.

---

# 4. Dependencies

```text
Phase 08 — Social Distribution (execution foundation)
Phase 09 — Analytics (metrics, monitoring, budget tracking)
Phase 10 — Growth Loop (Learning and Decisions that inform autonomy)
Phase 03 — Growth Brain (Action, Decision, Approval entities)
```

Shared platform capabilities.

```text
Integration and ExternalReference entities
Approval and Decision entities
AuditLog entity
Event Bus (Redis + BullMQ)
Encrypted credential storage
Advertising provider accounts
```

Reliable measurement from Phase 09 is required before enabling autonomy.

---

# 5. Deliverables

```text
Action orchestration engine for multi-step plans
Partial failure handling and compensation
Approval policy engine
Guardrail engine (budget, risk, rate, velocity, kill switch)
Autonomy level configuration per workspace and action type
Meta Ads integration
Google Ads integration
TikTok Ads integration
Paid actions as controlled experiments with budgets
Budget-change execution under guardrails
Execution monitoring with pause and kill switch
Complete audit trail for consequential actions
Autonomy and orchestration events on the Event Bus
API endpoints for policies, guardrails, and monitoring
Frontend views for approvals, guardrails, and live execution
```

---

# 6. Out of Scope

```text
Unbounded autonomous decisions
Autonomy without configured guardrails
Production scaling, SLOs, and DR (Phase 12)
Billing and subscription (Phase 12)
Full compliance program (Phase 12)
New channels beyond social and the three ad platforms
```

Full production readiness is delivered in Phase 12.

---

# 7. Exit Criteria

```text
Multi-step action plans can be orchestrated with dependency and failure handling.
Approval policies determine when human approval is required.
Auto-approval only occurs within configured autonomy and guardrails.
Guardrails block execution on budget, risk, rate, or velocity violations.
A kill switch can immediately halt orchestrations.
Meta, Google, and TikTok Ads can execute controlled experiments with budgets.
Budget changes are always subject to guardrail evaluation.
Execution monitoring reports status, spend, and guardrail proximity.
Every consequential action has a complete audit trail with decision, approval, and result.
Autonomy events carry correlation and causation IDs for full tracing.
No autonomous action executes without configured guardrails in place.
```
