# AUREA Analytics Agent

This phase connects execution with measurable outcomes.

AUREA gains the ability to ingest data from analytics platforms, normalize it, and record Outcomes.

The Analytics Agent interprets measured data against experiments.

This phase turns raw external metrics into structured AUREA Outcomes.

Outcomes are the evidence the growth loop needs.

Analytics integrations collect data.

They do not decide.

---

# 1. Objective

Enable AUREA to measure the results of its actions and experiments.

The system integrates with analytics providers, ingests events and metrics, normalizes them into a common representation, and records Outcomes linked to Experiments and Actions.

The Analytics Agent computes experiment results against success criteria and surfaces insights and anomalies.

The objective is to prove that AUREA can reliably measure what happened after execution.

```text
Execution (Phase 08)
        ↓
Analytics Integrations (GA4 / PostHog / Platform)
        ↓
Event & Metric Ingestion
        ↓
Metric Normalization
        ↓
Outcome Recording
        ↓
Experiment Result Computation
        ↓
Dashboards / Insights / Anomalies
```

---

# 2. Scope

## 2.1 Analytics Agent

A new agent defined under `docs/agents/` responsible for measurement reasoning.

The Analytics Agent consumes context from the Growth Brain.

It reads Experiment success criteria, metrics, baselines, and targets.

It interprets normalized data and computes results.

It analyzes and reports.

It does not modify business truth without evidence.

Every execution is recorded as an AgentRun.

## 2.2 Analytics Integrations

Implement analytics integrations described in `integration-architecture.md`.

```text
GA4
PostHog
Platform analytics (social insights from Phase 08)
```

Each integration implements the analytics capability.

```text
Fetch Metrics
Fetch Events
Fetch Conversions
Fetch Attribution Data
Sync Historical Data
```

Credentials follow integration authentication rules.

## 2.3 Event Ingestion

Support both pull and push synchronization.

```text
Pull   — AUREA periodically fetches provider data
Push   — Providers send webhooks / events
Hybrid — AUREA uses both
```

Ingested data is associated with the workspace and, where possible, an Experiment or Action through ExternalReference.

Ingestion jobs run asynchronously on the Event Bus.

Ingestion must be idempotent.

## 2.4 Metric Normalization

External systems use different schemas.

AUREA normalizes cross-provider concepts into a common internal representation.

```text
External Metric
      ↓
Normalized Metric
```

The normalized model preserves:

```text
Provider
External ID
Original metadata
Metric name (canonical)
Value
Unit
Observation timestamp
```

Normalization is limited to concepts that provide real cross-provider value.

AUREA does not attempt to abstract every provider-specific metric.

## 2.5 Outcome Recording

Normalized measurements are recorded as Outcomes.

Use the Outcome entity defined in `persistance-model.md`.

```text
Outcome
├── experimentId
├── actionId
├── metric
├── value
├── unit
├── observedAt
├── source
└── externalReferenceId
```

An Outcome references an Experiment or Action whenever possible.

Outcomes are the canonical measured evidence inside AUREA.

Outcome recording emits the `OutcomeRecorded` event.

## 2.6 Experiment Result Computation

The Analytics Agent compares Outcomes against Experiment success criteria.

```text
Experiment baseline + target
        ↓
Observed Outcomes
        ↓
Result: met / not met / inconclusive
        ↓
Experiment status update
```

Computation respects the Experiment measurement period.

When an Experiment reaches its end date and sufficient data exists, the agent proposes completion.

The system emits `ExperimentCompleted` where criteria are satisfied.

Hypothesis status may move toward `VALIDATED` or `REJECTED` based on evidence.

## 2.7 Dashboards, Insights, and Anomalies

Provide measurement surfaces for users.

```text
Dashboards      — metrics per Goal, Experiment, channel
Insights        — agent-generated interpretation of results
Anomalies       — significant deviations from expected values
```

Insights and anomalies are proposals.

They do not change business state automatically.

Anomaly detection may trigger notifications.

## 2.8 Events

Emit events defined in `event-architecture.md`.

```text
ExternalDataSyncStarted
ExternalDataSyncCompleted
ExternalDataSyncFailed
AnalyticsDataSynced
OutcomeRecorded
ExperimentCompleted
HypothesisValidated
HypothesisRejected
RecommendationCreated
```

Events carry correlation IDs tracing back to the originating experiment workflow.

---

# 3. Dependencies

```text
Phase 06 — Experimentation (success criteria, metrics, baselines)
Phase 08 — Social Distribution (executed Actions and ExternalReferences)
Phase 03 — Growth Brain (Experiment, Outcome entities)
```

Shared platform capabilities.

```text
Integration and ExternalReference entities
Event Bus (Redis + BullMQ)
Model Router
Scheduled sync jobs
Encrypted credential storage
```

Executed Actions with ExternalReferences are required to attribute measurements.

---

# 4. Deliverables

```text
Analytics Agent definition and runtime integration
GA4 integration
PostHog integration
Platform analytics ingestion (social insights)
Pull, push, and hybrid synchronization
Idempotent ingestion pipeline
Metric normalization model and mapping
Outcome recording linked to Experiments and Actions
Experiment result computation against success criteria
Hypothesis validation / rejection driven by evidence
Dashboards for Goals, Experiments, and channels
Agent-generated insights
Anomaly detection and notifications
Analytics events on the Event Bus
API endpoints for metrics, outcomes, and experiment results
Frontend analytics and results views
```

---

# 5. Out of Scope

```text
Closing the learning loop into Knowledge (Phase 10)
Updating Business Context from results (Phase 10)
Paid advertising analytics and optimization (Phase 11)
Autonomous decisions based on results (Phase 11)
Full attribution modeling across all channels
CRM revenue attribution
```

Learning generation and feedback into Strategy are delivered in Phase 10.

---

# 6. Exit Criteria

```text
GA4 and PostHog integrations can connect and report health.
Platform analytics from executed social posts can be ingested.
Ingestion runs via pull, push, and hybrid modes and is idempotent.
External metrics are normalized into a common internal representation.
Normalized measurements are recorded as Outcomes linked to Experiments or Actions.
The Analytics Agent computes experiment results against success criteria.
Experiments can complete and hypotheses can be validated or rejected on evidence.
Dashboards display metrics per Goal, Experiment, and channel.
Insights and anomalies are generated as proposals, not automatic state changes.
Analytics and outcome events are published to the Event Bus with correlation IDs.
Every agent computation is recorded as an AgentRun with cost tracking.
```
