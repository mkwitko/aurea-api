# AUREA Data Architecture

## 1. Purpose

This document defines how AUREA stores, organizes, and relates business data.

The data architecture must support the core AUREA growth loop:

```text
Business Context
→ Goals
→ Strategy
→ Hypotheses
→ Experiments
→ Actions
→ Outcomes
→ Learning
→ Updated Context
```

The data architecture must prioritize:

* Clear ownership
* Traceability
* Historical preservation
* Multi-tenancy
* Auditability
* Extensibility
* AI context retrieval

---

# 2. Data Ownership

The AUREA database is the canonical source of truth for the platform's business state.

External systems may contain operational data, but AUREA maintains its own representation of relevant state.

Examples:

Meta Ads may own campaign execution.

AUREA owns:

* Why the campaign exists
* Which goal it supports
* Which experiment it belongs to
* Which hypothesis it tests
* What outcome it produced

This distinction is fundamental.

```text
External System
      │
      │ Execution Data
      ▼
Integration Layer
      │
      ▼
AUREA
      │
      ├── Business Context
      ├── Goal
      ├── Strategy
      ├── Experiment
      ├── Action
      └── Outcome
```

---

# 3. Multi-Tenancy

AUREA is a multi-tenant platform.

The primary tenant boundary is the Organization.

```text
Organization
    │
    ├── Users
    │
    ├── Workspaces
    │
    ├── Integrations
    │
    └── Business Data
```

Every business object must be associated with an organization directly or indirectly.

Data must never leak across organizations.

---

# 4. Organization

Represents the customer account using AUREA.

An organization may represent:

* A startup
* A company
* An agency
* An enterprise
* A business unit

An organization owns users, workspaces, integrations, and growth data.

---

# 5. Workspace

A workspace provides an operational boundary within an organization.

Possible use cases:

```text
Organization
│
├── Marketing
├── Sales
├── Product
└── Brand A
```

A workspace may have its own:

* Goals
* Strategies
* Experiments
* Integrations
* AI configuration
* Permissions

The initial implementation may use a single workspace per organization while preserving the data model for future expansion.

---

# 6. Business

Represents the business context managed by AUREA.

A workspace may contain one primary business context.

The Business entity represents:

* Business identity
* Products
* Services
* Market
* Positioning
* Business model
* Revenue model

The Business entity should remain separate from users and authentication.

---

# 7. Core Domain Entities

The primary domain entities are:

```text
Organization
    │
    └── Workspace
          │
          ├── Business
          │
          ├── ICP
          │
          ├── Goal
          │     │
          │     └── Strategy
          │            │
          │            └── Hypothesis
          │                   │
          │                   └── Experiment
          │                          │
          │                          └── Action
          │                                 │
          │                                 └── Outcome
          │
          └── Knowledge
```

---

# 8. Business Context

Business Context is a structured representation of the organization's current understanding.

It may contain:

* Market
* Products
* Services
* ICP
* Personas
* Competitors
* Positioning
* Offers
* Brand information
* Constraints

Business Context should be versionable.

Changes to critical business context should be historically traceable.

---

# 9. ICP

A workspace may have multiple ICP definitions.

An ICP may include:

* Name
* Description
* Industry
* Company size
* Geography
* Role
* Pain points
* Goals
* Buying triggers
* Objections

Goals and strategies may reference one or more ICPs.

---

# 10. Goals

Goals represent desired outcomes.

A goal must be measurable whenever possible.

A goal may contain:

* Name
* Description
* Metric
* Baseline
* Target
* Deadline
* Priority
* Status

Goals may have hierarchical relationships.

Example:

```text
Company Goal
    ↓
Marketing Goal
    ↓
Acquisition Goal
```

The initial implementation may support only one level of goals.

The data model should not prevent future goal hierarchies.

---

# 11. Strategies

A Strategy belongs to one or more Goals.

A strategy may reference:

* ICPs
* Channels
* Positioning
* Messaging
* Hypotheses
* Experiments

A strategy should preserve its historical versions.

---

# 12. Hypotheses

A Hypothesis belongs to a Strategy.

It represents a testable assumption.

A hypothesis should contain:

* Statement
* Rationale
* Expected outcome
* Confidence
* Target metric

---

# 13. Experiments

An Experiment tests one or more hypotheses.

An experiment may contain:

* Hypothesis
* Objective
* Channel
* Audience
* Metric
* Baseline
* Target
* Duration
* Success criteria

Experiments must preserve historical state transitions.

---

# 14. Actions

Actions represent executable operations.

An action should reference:

* Experiment
* Integration
* Execution target

Examples:

```text
Publish Social Post
Create Campaign
Send Email
Create Landing Page
Modify Budget
```

Actions should be idempotent where possible.

---

# 15. Outcomes

Outcomes represent observed results.

An outcome may contain:

* Metric
* Value
* Timestamp
* Source
* Experiment
* Action

Outcomes should preserve source provenance.

---

# 16. Knowledge

Knowledge represents persistent organizational learning.

Knowledge may originate from:

* Research
* Experiments
* Outcomes
* Customer feedback
* User input
* External documents

Knowledge should include provenance whenever possible.

---

# 17. Decisions

Important AI or human decisions should be persisted.

A Decision may reference:

* Goal
* Strategy
* Experiment
* Evidence
* Recommendation
* Selected action
* Decision maker

Decisions should be immutable after finalization.

Corrections should create new records or revisions rather than silently changing history.

---

# 18. Approvals

Approvals represent explicit authorization for consequential actions.

An approval should include:

* Requested action
* Requester
* Approver
* Timestamp
* Decision
* Optional comment

Approvals are part of the audit trail.

---

# 19. Agent Runs

Agent executions should be recorded separately from business entities.

An AgentRun may include:

* Agent type
* Task
* Input context reference
* Model
* Provider
* Token usage
* Cost
* Duration
* Status
* Result reference

AgentRun is operational data.

It should not replace domain data.

---

# 20. AI Execution vs Business State

AUREA must separate:

```text
AI Execution
```

from:

```text
Business State
```

Example:

An AI agent may execute five times while generating a strategy.

The database should contain:

```text
5 AgentRuns

1 Strategy
```

The AgentRuns explain how the strategy was produced.

The Strategy is the business artifact.

---

# 21. External IDs

External integrations may assign IDs to objects.

AUREA should maintain mappings.

Example:

```text
AUREA Action
    │
    └── External Reference
          │
          ├── Provider
          ├── External ID
          └── Metadata
```

External IDs should never replace AUREA's internal IDs.

---

# 22. Auditability

Important mutations should be auditable.

The audit system should record:

* Actor
* Action
* Entity
* Entity ID
* Previous state where appropriate
* New state where appropriate
* Timestamp

The actor may be:

* User
* Agent
* System
* Integration

---

# 23. Eventual Consistency

External integrations may be eventually consistent.

AUREA should distinguish between:

```text
Requested
Executing
Succeeded
Failed
Unknown
```

The system must not assume that an external action succeeded simply because an API request was accepted.

---

# 24. Data Lifecycle

Business data should generally follow:

```text
Created
→ Active
→ Completed
→ Archived
```

Historical data should not be deleted merely because it is no longer active.

Historical outcomes and experiments are essential to AUREA's learning system.

---

# 25. Database Direction

The initial primary database is PostgreSQL.

Prisma is the initial ORM.

The primary database should contain canonical structured data.

Vector or semantic search infrastructure may be introduced for knowledge retrieval.

The vector layer is complementary to PostgreSQL.

It does not replace the relational database.

---

# 26. Data Architecture Principle

The central rule is:

```text
PostgreSQL
    ↓
Canonical Business State

Semantic Search
    ↓
Knowledge Retrieval

External Systems
    ↓
Execution and External Data

Agent Runtime
    ↓
AI Execution

AUREA
    ↓
Connects all of them
```
