# AUREA Product Model

## 1. Overview

AUREA is organized around the concept of a continuous growth operating cycle.

The product is not centered on individual tools or channels.

The primary object of the product is the relationship between:

```text
Business
↓
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
```

---

## 2. Business

A Business represents the organization or business unit using AUREA.

The business context may include:

* Business description
* Products
* Services
* Business model
* Revenue model
* Market
* Geographic scope
* Competitive environment
* Positioning
* Value proposition
* Constraints

This information provides context for AI reasoning.

---

## 3. ICP

The Ideal Customer Profile represents the type of customer the business wants to acquire.

An ICP may include:

* Industry
* Company size
* Geography
* Role
* Demographics
* Behavioral characteristics
* Pain points
* Goals
* Buying triggers
* Objections
* Existing alternatives

AUREA should allow multiple ICPs.

Each goal or strategy may prioritize one or more ICPs.

---

## 4. Goal

A Goal defines a desired business outcome.

Examples:

* Generate 1,000 leads
* Acquire 500 customers
* Reach R$100,000 in monthly recurring revenue
* Reduce CAC below R$30
* Increase conversion rate to 5%
* Increase retention by 10%

A goal should ideally contain:

* Name
* Description
* Metric
* Baseline
* Target
* Deadline
* Priority
* Status

A goal is the primary driver of the growth loop.

---

## 5. Strategy

A Strategy defines the approach used to achieve one or more goals.

A strategy may define:

* Target audience
* Positioning
* Messaging
* Channels
* Offers
* Acquisition approach
* Retention approach
* Strategic hypotheses
* Experiments

A strategy should explain not only what AUREA recommends, but why.

---

## 6. Hypothesis

A Hypothesis is a testable assumption about how a specific action may influence a measurable outcome.

Example:

> If we position the product around reducing operational costs instead of increasing revenue, SaaS founders will convert at a higher rate.

A hypothesis should contain:

* Statement
* Reasoning
* Expected outcome
* Target metric
* Confidence
* Related strategy

---

## 7. Experiment

An Experiment tests a hypothesis.

An experiment should define:

* Hypothesis
* Objective
* Variables
* Audience
* Channel
* Baseline
* Target
* Metric
* Duration
* Success criteria

The experiment is the bridge between strategy and execution.

---

## 8. Action

An Action represents an executable activity.

Examples:

* Publish a social post
* Create an advertisement
* Launch a campaign
* Change a budget
* Send an email
* Create a landing page
* Modify an offer

Actions should be traceable to their origin.

Ideally:

```text
Goal
→ Strategy
→ Hypothesis
→ Experiment
→ Action
```

Some operational actions may be generated directly by the system, but they should still have a recorded reason.

---

## 9. Outcome

An Outcome represents the measured result of an action or experiment.

Examples:

* 100 leads generated
* CAC of R$25
* CTR increased by 20%
* Conversion rate decreased by 5%

Outcomes should be associated with metrics whenever possible.

---

## 10. Learning

Learning represents knowledge extracted from outcomes.

Examples:

* A message performs better for a specific ICP.
* A channel has become too expensive.
* A creative pattern consistently produces higher CTR.
* A landing page variant converts better.

Learning should improve future decisions.

The long-term objective is:

```text
Experiment
→ Outcome
→ Learning
→ Better Strategy
→ Better Experiment
```

---

## 11. Growth Brain

The Growth Brain connects all product concepts.

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
       └──────────────→ Growth Brain
```

The Growth Brain is the central context layer.

---

## 12. Product Hierarchy

The conceptual hierarchy is:

```text
Organization
    │
    └── Business
          │
          ├── ICPs
          │
          ├── Goals
          │     │
          │     └── Strategies
          │            │
          │            └── Hypotheses
          │                   │
          │                   └── Experiments
          │                          │
          │                          └── Actions
          │                                 │
          │                                 └── Outcomes
          │
          └── Knowledge
```

This hierarchy is conceptual.

The physical data model may use different relationships when required by the implementation.

---

## 13. Product State

AUREA should maintain a distinction between:

### Desired State

What the business wants to achieve.

Examples:

* Goal
* Target
* Deadline

### Strategic State

What AUREA believes should be done.

Examples:

* Strategy
* Hypothesis
* Experiment

### Operational State

What is currently being executed.

Examples:

* Action
* Campaign
* Content
* Workflow

### Observed State

What actually happened.

Examples:

* Metrics
* Outcomes
* Performance

### Learned State

What the system believes it has learned.

Examples:

* Insights
* Patterns
* Knowledge
* Updated assumptions

This separation is critical for the architecture.

```text
Desired
   ↓
Strategic
   ↓
Operational
   ↓
Observed
   ↓
Learned
   ↓
Strategic
```
