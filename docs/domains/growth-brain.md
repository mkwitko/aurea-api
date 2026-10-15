# AUREA Growth Brain

## 1. Purpose

The Growth Brain is the central business intelligence domain of AUREA.

It maintains the structured representation of a business's growth context and connects goals, strategies, experiments, actions, outcomes, and learning.

The Growth Brain is the canonical source of business growth state.

---

# 2. Core Responsibility

The Growth Brain answers:

```text
Who are we?

What are we selling?

Who do we serve?

What do we want to achieve?

What strategy are we following?

What do we believe will work?

What are we testing?

What are we doing?

What happened?

What did we learn?

What should we do next?
```

---

# 3. Growth Brain Model

The Growth Brain is represented by:

```text
Business Context
      │
      ▼
Goals
      │
      ▼
Strategies
      │
      ▼
Hypotheses
      │
      ▼
Experiments
      │
      ▼
Actions
      │
      ▼
Outcomes
      │
      ▼
Learning
      │
      └───────────────→ Updated Context
```

---

# 4. Business Context

Business Context represents the current understanding of the business.

It may include:

* Business description
* Products
* Services
* Market
* Business model
* Revenue model
* Positioning
* Value proposition
* ICP
* Personas
* Competitors
* Constraints

Business Context is partially structured and partially knowledge-based.

---

# 5. Context Sources

Business context may originate from:

```text
User Input
Research
Documents
Integrations
Experiments
Analytics
AI Inference
```

The source should be recorded whenever possible.

---

# 6. Context Confidence

AI-generated context may have uncertainty.

Important contextual information may have:

```text
Confidence
Source
Last Verified
```

The system should distinguish:

```text
Known Fact
User Provided
Observed Data
AI Inference
Hypothesis
```

AI inference must not automatically become fact.

---

# 7. ICP

The Growth Brain may maintain multiple ICPs.

Each ICP should contain:

* Name
* Description
* Characteristics
* Pain Points
* Goals
* Buying Triggers
* Objections

ICP information may evolve based on research and experiments.

---

# 8. Goals

Goals represent desired outcomes.

A goal should define:

* Name
* Description
* Metric
* Baseline
* Target
* Deadline
* Priority
* Status

Example:

```text
Goal:

Generate 1,000 qualified leads.

Metric:

Qualified Leads

Baseline:

400/month

Target:

1,000/month

Deadline:

2026-12-31
```

---

# 9. Goal Lifecycle

A goal may move through:

```text
DRAFT
ACTIVE
PAUSED
COMPLETED
CANCELLED
```

A goal should not be deleted after becoming active.

Historical goals contribute to learning.

---

# 10. Strategy

A Strategy defines how a goal should be pursued.

A strategy may include:

* Strategic objective
* ICP
* Positioning
* Messaging
* Channels
* Offers
* Hypotheses
* Experiments

A strategy should reference the goal it supports.

---

# 11. Strategy Lifecycle

A strategy may move through:

```text
DRAFT
PROPOSED
APPROVED
ACTIVE
ARCHIVED
```

AI-generated strategies should initially be proposed.

Human approval may be required before activation.

---

# 12. Hypothesis

A Hypothesis represents a testable belief.

Example:

```text
If we target SaaS founders with messaging around reducing operational costs,
we expect qualified lead conversion to increase by 20%.
```

A hypothesis should include:

* Statement
* Rationale
* Expected outcome
* Metric
* Confidence

---

# 13. Experiment

An Experiment tests a hypothesis.

It should define:

* Objective
* Hypothesis
* Audience
* Channel
* Variables
* Metric
* Baseline
* Target
* Duration
* Success Criteria

---

# 14. Experiment Lifecycle

```text
DRAFT
PLANNED
APPROVED
RUNNING
PAUSED
COMPLETED
CANCELLED
```

An experiment should not be considered successful simply because it completed.

Success is determined by its metrics and success criteria.

---

# 15. Action

An Action represents something the system intends to execute.

Examples:

```text
Create Social Post
Publish Social Post
Create Advertisement
Change Budget
Create Landing Page
Send Email
```

An Action should reference:

* Goal
* Strategy
* Experiment
* Execution target

Not every action must have every relationship.

However, consequential actions should have an identifiable reason.

---

# 16. Action Lifecycle

```text
PROPOSED
PENDING_APPROVAL
APPROVED
EXECUTING
EXECUTED
FAILED
CANCELLED
```

The lifecycle records AUREA's action state.

External execution state may be stored separately.

---

# 17. Outcome

An Outcome represents an observed result.

Example:

```text
Metric:
Qualified Leads

Expected:
1,000

Observed:
1,250
```

Outcomes may originate from:

* Analytics
* Advertising platforms
* CRM
* Social platforms
* User input

---

# 18. Learning

Learning represents knowledge extracted from outcomes.

Example:

```text
Learning:

Messaging focused on operational cost reduction
generated 32% more qualified leads than revenue-growth messaging
for SaaS founders.
```

Learning should contain:

* Statement
* Evidence
* Confidence
* Source
* Related experiment

---

# 19. Learning Lifecycle

```text
CANDIDATE
VALIDATED
REJECTED
ARCHIVED
```

Not every AI-generated insight should become validated learning.

---

# 20. Decision

A Decision represents an important choice made by AUREA or a human.

Examples:

```text
Increase investment in Meta Ads.

Stop Experiment X.

Start Experiment Y.

Change positioning.

Prioritize ICP B.
```

A Decision should reference its evidence.

---

# 21. Decision Evidence

Evidence may include:

* Metrics
* Research
* Outcomes
* User input
* Historical experiments
* External sources

The system should preserve the evidence used to support important decisions.

---

# 22. Growth Loop

The Growth Brain continuously operates around:

```text
Goal
  ↓
Strategy
  ↓
Hypothesis
  ↓
Experiment
  ↓
Action
  ↓
Outcome
  ↓
Learning
  ↓
Strategy Update
```

The loop may begin at different points.

For example:

A market research discovery may create a new strategy opportunity.

An analytics anomaly may trigger a new experiment.

A user request may create a new goal.

---

# 23. AI Interaction

AI agents interact with the Growth Brain through domain services.

Agents may:

* Read context
* Propose strategies
* Propose hypotheses
* Create experiments
* Analyze outcomes
* Suggest learning

Agents should not bypass domain rules.

---

# 24. Domain Commands

Conceptual commands include:

```text
CreateBusinessContext
UpdateBusinessContext

CreateICP
UpdateICP

CreateGoal
ActivateGoal
CompleteGoal

CreateStrategy
ApproveStrategy
ActivateStrategy

CreateHypothesis

CreateExperiment
ApproveExperiment
StartExperiment
CompleteExperiment

ProposeAction
ApproveAction
ExecuteAction

RecordOutcome

CreateLearning
ValidateLearning

CreateDecision
```

The actual API and service boundaries may differ.

---

# 25. Domain Events

The Growth Brain may emit:

```text
BusinessContextCreated
BusinessContextUpdated

GoalCreated
GoalActivated
GoalCompleted

StrategyCreated
StrategyApproved
StrategyActivated

HypothesisCreated

ExperimentCreated
ExperimentStarted
ExperimentCompleted

ActionProposed
ActionApproved
ActionExecuted

OutcomeRecorded

LearningCreated
LearningValidated

DecisionCreated
```

---

# 26. Invariants

The following rules must be enforced.

### Goal

A goal must belong to a workspace.

---

### Strategy

A strategy must reference at least one goal.

---

### Hypothesis

A hypothesis must reference a strategy.

---

### Experiment

An experiment must reference a hypothesis.

---

### Action

A consequential action must have a traceable reason.

---

### Outcome

An outcome should reference an experiment or action whenever possible.

---

### Learning

Validated learning must have evidence.

---

### Decision

Important decisions must preserve their supporting evidence.

---

# 27. Historical Integrity

The Growth Brain must preserve historical context.

The system should not silently rewrite history.

For example:

If an ICP changes, previous experiments must retain the ICP context under which they were executed.

This may require snapshots or versioned context.

---

# 28. Context Versioning

Business context should support versioning.

Example:

```text
Business Context v1
      ↓
Experiment A

Business Context v2
      ↓
Experiment B
```

This allows AUREA to understand the context under which decisions were made.

---

# 29. Learning Loop

The Growth Brain should support:

```text
Observed Outcome
      ↓
Analysis
      ↓
Learning Candidate
      ↓
Validation
      ↓
Knowledge
      ↓
Future Context
```

The learning loop is one of the primary differentiators of AUREA.

---

# 30. Growth Brain Principle

The Growth Brain is not an AI agent.

It is not an LLM.

It is not a vector database.

It is not a prompt.

It is the structured business intelligence layer that allows AI agents to reason consistently over time.

```text
Growth Brain
    +
AI Agents
    +
Models
    +
Tools
    +
Integrations
    =
AUREA Intelligence
```
