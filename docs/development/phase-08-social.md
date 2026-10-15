# AUREA Social Distribution

This phase delivers the first real execution capability in AUREA.

Approved content drafts from Phase 07 are distributed to social channels.

Execution runs through the integration layer, using Postiz and, where appropriate, direct platform connectors.

This is the first Operator-style behavior.

AUREA executes.

A human still approves every consequential action.

Integrations execute.

Integrations never decide.

---

# 1. Objective

Enable AUREA to execute approved social content Actions against external social platforms.

The system connects social accounts, creates drafts on the provider, schedules and publishes posts, retrieves metrics, and maintains a reliable mapping between AUREA entities and external entities.

The objective is to prove controlled, auditable, idempotent execution while keeping human approval in the loop.

```text
Approved Content Action
        ↓
Social Distribution Adapter
        ↓
Connector (Postiz / Direct)
        ↓
External Platform
        ↓
ExternalReference + Events
        ↓
Growth Brain (execution record)
```

---

# 2. Scope

## 2.1 Social Integration Capability

Implement the social integration capability described in `integration-architecture.md`.

The capability exposes a consistent conceptual interface.

```text
connect()
disconnect()
health()
capabilities()
execute()
sync()
handleWebhook()
```

The domain depends on the capability.

The domain does not depend on the provider.

## 2.2 Connectors

Provider-specific implementations behind the capability.

```text
SocialIntegration
    ├── PostizConnector
    └── DirectConnectors (progressive)
```

Postiz is the initial distribution infrastructure.

Direct connectors may be added where a platform requires capabilities Postiz does not cover.

Connectors translate AUREA concepts into provider APIs through adapters.

## 2.3 Account Connection

Support connecting and disconnecting social accounts.

```text
Connect Account
Disconnect Account
Get Profile
```

Connection state is stored in the Integration entity.

Credentials follow the integration authentication rules.

```text
Secrets are not stored in plain database fields.
Tokens are encrypted.
Access is scoped to the minimum required permissions.
```

## 2.4 Distribution Operations

Support the core social operations.

```text
Create Draft
Schedule
Publish
Get Post
Get Metrics
Handle Webhook
```

The exact set depends on provider capabilities exposed through `capabilities()`.

## 2.5 Execution Flow

Execution is driven by an approved content Action.

```text
Action (CONTENT_DRAFT, APPROVED)
        ↓
Distribution requested
        ↓
Action status: EXECUTING
        ↓
Connector.execute()
        ↓
Provider draft / schedule / publish
        ↓
ExternalReference created
        ↓
Action status: EXECUTED or FAILED
```

The Action lifecycle uses the statuses defined in `persistance-model.md`.

```text
APPROVED
EXECUTING
EXECUTED
FAILED
```

## 2.6 ExternalReference Mapping

Every external entity created is mapped to an AUREA entity.

Use the ExternalReference entity from `persistance-model.md`.

```text
ExternalReference
├── integrationId
├── entityType   (SOCIAL_POST, SOCIAL_ACCOUNT)
├── entityId     (AUREA Action or Integration id)
├── externalId   (provider post id)
└── metadata     (platform, url, scheduledAt)
```

A unique constraint applies on:

```text
integrationId + entityType + externalId
```

This lets providers change without breaking the domain model.

## 2.7 Idempotency

Write operations must be idempotent.

The AUREA Action ID is used as the idempotency key.

```text
Action ID: action-123
Provider request: idempotency-key = action-123
```

Re-execution of the same Action must not create duplicate posts.

Before executing, the system checks for an existing ExternalReference.

## 2.8 Webhooks

Providers may notify AUREA of state changes.

The webhook flow follows `integration-architecture.md`.

```text
Provider
   ↓
Webhook Endpoint
   ↓
Signature Validation
   ↓
Event Normalization
   ↓
Internal Event
   ↓
Event Bus
   ↓
Consumer
```

Webhook handlers must be idempotent.

Normalized events update the corresponding Action and ExternalReference.

## 2.9 Metrics Retrieval

Basic post metrics are fetched after publication.

```text
Get Metrics
```

Metrics are retrieved and stored as raw provider data linked to the ExternalReference.

Full normalization and Outcome recording are handled in Phase 09.

This phase only guarantees that metrics can be fetched and associated.

## 2.10 Events

Emit integration events defined in `event-architecture.md`.

```text
IntegrationConnected
IntegrationDisconnected
ExternalActionRequested
ExternalActionSucceeded
ExternalActionFailed
SocialPostPublished
```

Domain Action events are also emitted.

```text
ActionExecuted
ActionFailed
```

Events carry correlation IDs linking to the originating experiment workflow.

## 2.11 Failure Handling

External failures are classified per `integration-architecture.md`.

```text
Authentication Error
Rate Limit
Validation Error
Provider Error
Network Error
Unknown Error
```

Transient failures are retried with controlled backoff.

Non-retryable failures fail the Action immediately and record the reason.

Repeated failures move the job to a dead letter queue.

---

# 3. Dependencies

```text
Phase 07 — Content (approved CONTENT_DRAFT Actions)
Phase 03 — Growth Brain (Action lifecycle)
```

Shared platform capabilities.

```text
Integration and ExternalReference entities
Approval entity
Event Bus (Redis + BullMQ)
Encrypted credential storage
Object storage for media assets
Webhook ingestion endpoint
```

A connected Postiz account or platform account is required to execute.

---

# 4. Deliverables

```text
Social integration capability implementation
PostizConnector
Connector adapter layer for social concepts
Account connect / disconnect / profile flows
Create draft, schedule, publish operations
Post retrieval and metrics fetch
Webhook endpoint with signature validation
Event normalization for social events
ExternalReference mapping with unique constraint
Idempotent execution keyed on Action ID
Action lifecycle transitions (EXECUTING → EXECUTED / FAILED)
Retry, backoff, and dead letter handling
Integration health reporting
Integration and social events on the Event Bus
API endpoints for connection, distribution, and status
Frontend views for account connection and post status
Audit log entries for execution and approvals
```

---

# 5. Out of Scope

```text
Analytics normalization and Outcome recording
Experiment result computation
Paid advertising execution
Email distribution
CRM synchronization
Autonomous publishing without approval
Cross-channel content optimization
```

Measurement and Outcome recording are delivered in Phase 09.

Autonomy expansion is delivered in Phase 11.

---

# 6. Exit Criteria

```text
A user can connect and disconnect a social account.
Integration status and health are reported accurately.
An approved content Action can be published or scheduled through a connector.
Every external post is mapped through an ExternalReference.
Execution is idempotent and cannot create duplicate posts for one Action.
Action status transitions correctly through EXECUTING, EXECUTED, and FAILED.
Webhooks are validated, normalized, and processed idempotently.
Post metrics can be fetched and associated with the ExternalReference.
Transient failures retry with backoff and permanent failures fail cleanly.
Integration and social events are published to the Event Bus.
Every execution and approval is recorded in the audit log.
No consequential action is executed without human approval.
```
