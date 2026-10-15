# AUREA Event Architecture

## 1. Purpose

AUREA uses events to connect business state changes, asynchronous processing, integrations, analytics, and AI workflows.

Events allow the system to evolve without tightly coupling every component.

The event architecture supports:

* Asynchronous processing
* Agent workflows
* Integration synchronization
* Analytics
* Notifications
* Audit
* Learning loops

---

# 2. Event Philosophy

An event represents something that already happened.

Events should use past tense.

Examples:

```text
GoalCreated
ExperimentStarted
ExperimentCompleted
OutcomeRecorded
LearningCreated
```

Commands represent something that should happen.

Examples:

```text
CreateGoal
StartExperiment
RecordOutcome
GenerateStrategy
```

The distinction is:

```text
Command
"What should happen?"

Event
"What happened?"
```

---

# 3. Core Event Flow

The AUREA growth loop may produce:

```text
GoalCreated
      ↓
ResearchRequested
      ↓
ResearchCompleted
      ↓
StrategyCreated
      ↓
HypothesisCreated
      ↓
ExperimentCreated
      ↓
ExperimentStarted
      ↓
ActionProposed
      ↓
ActionApproved
      ↓
ActionExecuted
      ↓
OutcomeRecorded
      ↓
ExperimentCompleted
      ↓
LearningCreated
```

The exact sequence may vary.

Not every event requires every subsequent event.

---

# 4. Event Categories

Events are divided into:

## Domain Events

Represent meaningful business state changes.

Examples:

* GoalCreated
* StrategyCreated
* ExperimentStarted
* ExperimentCompleted
* OutcomeRecorded

---

## Integration Events

Represent external system interactions.

Examples:

* ExternalCampaignCreated
* ExternalCampaignUpdated
* SocialPostPublished
* AnalyticsDataSynced

---

## AI Events

Represent AI execution.

Examples:

* AgentRunStarted
* AgentRunCompleted
* AgentRunFailed
* RecommendationCreated

---

## System Events

Represent infrastructure or platform events.

Examples:

* WorkspaceCreated
* IntegrationConnected
* UserInvited

---

# 5. Event Envelope

All events should use a consistent envelope.

Conceptually:

```text
Event
├── id
├── type
├── version
├── occurredAt
├── organizationId
├── workspaceId
├── actor
├── correlationId
├── causationId
└── payload
```

---

# 6. Actor

Events should identify who or what caused them.

Possible actors:

```text
USER
AGENT
SYSTEM
INTEGRATION
```

Example:

```text
actor:
{
  type: AGENT,
  id: strategy-agent-run-123
}
```

---

# 7. Correlation

AUREA must support tracing complex workflows.

Example:

```text
GoalCreated
correlationId: workflow-123

ResearchCompleted
correlationId: workflow-123

StrategyCreated
correlationId: workflow-123

ExperimentCreated
correlationId: workflow-123
```

This allows the entire growth workflow to be traced.

---

# 8. Causation

Events may reference the event or command that caused them.

Example:

```text
StrategyCreated

causationId:
ResearchCompleted
```

This creates a causal chain.

---

# 9. Event Processing

Events may be processed synchronously or asynchronously.

Synchronous processing should be reserved for operations where immediate consistency is required.

Asynchronous processing should be preferred for:

* AI tasks
* External integrations
* Analytics synchronization
* Notifications
* Long-running workflows

---

# 10. Event Bus

The initial architecture may use Redis and BullMQ for asynchronous jobs.

The event abstraction should not be tightly coupled to Redis.

The system should expose an internal event interface.

Example:

```text
EventBus.publish(event)
```

The implementation may initially use:

```text
Redis
+
BullMQ
```

Future implementations may use:

* Kafka
* NATS
* AWS EventBridge
* Other event infrastructure

without changing domain logic.

---

# 11. Domain Events

Initial domain events include:

```text
BusinessContextCreated
BusinessContextUpdated

GoalCreated
GoalUpdated
GoalCompleted

StrategyCreated
StrategyUpdated

HypothesisCreated
HypothesisValidated
HypothesisRejected

ExperimentCreated
ExperimentStarted
ExperimentPaused
ExperimentCompleted

ActionProposed
ActionApproved
ActionRejected
ActionExecuted
ActionFailed

OutcomeRecorded

LearningCreated
LearningValidated
```

---

# 12. AI Events

Initial AI events include:

```text
AgentRunStarted
AgentRunCompleted
AgentRunFailed

RecommendationCreated
RecommendationApproved
RecommendationRejected

DecisionCreated
```

---

# 13. Integration Events

Initial integration events include:

```text
IntegrationConnected
IntegrationDisconnected

ExternalDataSyncStarted
ExternalDataSyncCompleted
ExternalDataSyncFailed

ExternalActionRequested
ExternalActionSucceeded
ExternalActionFailed
```

---

# 14. Event Consumers

Possible consumers include:

```text
Growth Brain
AI Orchestrator
Analytics
Notifications
Audit
Integration Services
Learning Engine
```

Consumers should be independently deployable where practical.

---

# 15. Idempotency

Event consumers must be idempotent.

Processing the same event twice should not create duplicate business effects.

Every event should have a unique identifier.

Consumers should track processed event IDs where necessary.

---

# 16. Retry

Transient failures should be retried.

Permanent failures should be recorded.

The system should distinguish:

```text
Retryable Error
Permanent Error
Unknown Error
```

Retries should use controlled backoff.

---

# 17. Dead Letter Queue

Events that repeatedly fail should be moved to a dead letter queue.

Operators should be able to:

* Inspect failure
* Retry
* Ignore
* Resolve manually

---

# 18. Event Ordering

The system should not assume global event ordering.

Ordering should only be guaranteed where required by a specific aggregate or workflow.

---

# 19. Event History

Important domain events should be retained for audit and analysis.

Event history is not necessarily the same as event sourcing.

AUREA does not initially require full event sourcing.

The primary database remains the source of current state.

Events provide history and asynchronous communication.

---

# 20. Growth Loop Events

The most important event chain is:

```text
Goal
  ↓
Research
  ↓
Strategy
  ↓
Experiment
  ↓
Action
  ↓
Outcome
  ↓
Learning
```

Each transition may generate events.

These events allow AUREA to react to changes without requiring a single monolithic workflow.

---

# 21. Event Architecture Principle

The system should be:

```text
Synchronous where correctness requires it.

Asynchronous where scalability and decoupling benefit from it.

Event-driven where multiple independent capabilities need to react.
```

The architecture should avoid turning every database mutation into an event.

Events should represent meaningful changes in system behavior or business state.
