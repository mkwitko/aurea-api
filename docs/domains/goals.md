# AUREA Goals Domain

## 1. Purpose

The Goals domain defines the measurable business outcomes AUREA is working to achieve.

A Goal is the primary driver of the growth loop.

Everything downstream exists to serve a Goal.

A Goal answers:

```text
What outcome do we want?

How will we measure it?

Where are we now?

Where do we want to be?

By when?

How important is it?
```

Without a Goal, there is nothing for strategy, experiments, or actions to serve.

A Goal is the reason the loop runs.

---

# 2. Domain Responsibility

The Goals domain is responsible for:

* Defining measurable desired outcomes
* Recording metric, baseline, target, and deadline
* Managing goal priority
* Managing the goal lifecycle
* Connecting Goals to ICPs
* Connecting Goals to Strategies
* Anchoring the traceability chain
* Preserving goal history

The Goals domain is not responsible for:

* Defining how to achieve the goal (Strategy)
* Testing beliefs (Experiments)
* Executing work (Actions)
* Measuring results (Analytics)
* Defining the Business Context

A Goal states the destination.

It does not choose the route.

---

# 3. Goals in the Growth Loop

The Goal sits at the top of the loop, below Business Context.

```text
Business Context
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

Business Context grounds the Goal.

The Goal anchors everything that follows.

---

# 4. What a Goal Represents

A Goal represents a desired business outcome.

Examples:

```text
Generate 1,000 qualified leads per month.
Acquire 500 customers.
Reach R$100,000 in monthly recurring revenue.
Reduce CAC below R$30.
Increase conversion rate to 5%.
Increase retention by 10%.
```

A Goal is about outcomes, not activities.

"Post on Instagram daily" is an activity.

"Increase qualified leads to 1,000 per month" is a goal.

---

# 5. Goal Structure

A Goal should contain:

```text
Name
Description
Metric
Baseline
Target
Unit
Deadline
Priority
Status
```

Example:

```text
Name:
Grow Qualified Pipeline

Description:
Increase qualified lead volume from high-intent channels.

Metric:
Qualified Leads

Baseline:
400 per month

Target:
1,000 per month

Unit:
leads/month

Deadline:
2026-12-31

Priority:
HIGH

Status:
ACTIVE
```

The structure makes the desired outcome unambiguous.

---

# 6. Measurability Requirement

Every Goal must be measurable.

```text
Goal = Metric + Baseline + Target + Deadline
```

A Goal without a metric cannot be evaluated.

A Goal without a baseline cannot show progress.

A Goal without a target has no definition of success.

A Goal without a deadline has no urgency.

Example of an unmeasurable goal:

```text
"Grow the business."
```

This is a wish, not a Goal.

AUREA should refuse to treat unmeasurable statements as Goals.

---

# 7. Metric

The metric defines what is being measured.

Examples:

```text
Qualified Leads
Customers
Monthly Recurring Revenue
CAC
Conversion Rate
Retention Rate
```

The metric connects the Goal to Analytics.

Analytics measures the metric.

The Goal defines the target for it.

---

# 8. Baseline and Target

The baseline is the current known value.

The target is the desired value.

```text
Baseline:
400 leads/month

Target:
1,000 leads/month
```

The baseline should come from Business Context or Analytics whenever possible.

The gap between baseline and target defines the work to be done.

---

# 9. Deadline

The deadline defines when the target should be reached.

Example:

```text
Deadline:
2026-12-31
```

The deadline shapes strategy.

A short deadline may favor fast, higher-cost approaches.

A longer deadline may allow slower, compounding approaches.

---

# 10. Priority

A Goal has a priority.

Possible values:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

Priority helps AUREA allocate attention and resources across multiple Goals.

Higher-priority Goals should receive strategic focus first.

---

# 11. Goal Lifecycle

The goal lifecycle is:

```text
DRAFT
ACTIVE
PAUSED
COMPLETED
CANCELLED
```

The lifecycle records where the Goal stands.

---

# 12. DRAFT

A Draft Goal is incomplete or not yet committed.

It may be missing:

```text
Metric
Baseline
Target
Deadline
```

Draft Goals should not drive strategy or experiments.

---

# 13. ACTIVE

An Active Goal is currently being pursued.

Active Goals may:

```text
Anchor Strategies
Drive Experiments
Justify Actions
```

An Active Goal is a live commitment.

---

# 14. PAUSED

A Goal may be paused without being cancelled.

Reasons may include:

```text
Shift in priorities
Resource constraints
External conditions
```

A paused Goal retains its history.

Related work may pause or continue depending on its own state.

---

# 15. COMPLETED

A Goal is completed when its target is reached, or when it is formally concluded.

Completion should record:

```text
Final Value
Completion Date
```

A completed Goal contributes to learning.

It shows what worked and how the target was reached.

---

# 16. CANCELLED

A Goal may be cancelled when it is no longer relevant.

Reasons may include:

```text
Business direction changed
Goal was superseded
Goal was invalid
```

A cancelled Goal remains in history.

It is not deleted.

---

# 17. Goals Must Not Be Deleted After Active

Once a Goal becomes Active, it must not be deleted.

```text
Active Goal
      ↓
Strategies, Experiments, Outcomes reference it
```

Deleting an active Goal would break the traceability of everything that served it.

Instead of deletion, Goals may be:

```text
COMPLETED
CANCELLED
PAUSED
```

Historical Goals contribute to learning.

They show the trajectory of the business over time.

---

# 18. Goal Hierarchy

Goals may exist at multiple levels.

Example:

```text
Company Goal:
Reach R$100k MRR.

Marketing Goal:
Generate 1,000 qualified leads/month.

Acquisition Goal:
Reduce CAC below R$30.
```

The conceptual hierarchy:

```text
Company Goal
      ↓
Marketing Goal
      ↓
Acquisition Goal
```

Higher-level Goals are served by lower-level Goals.

---

# 19. MVP One Level, Model Allows Expansion

The initial MVP should support a single level of Goals.

```text
MVP:
One flat set of Goals per Workspace.
```

However, the data model should allow future hierarchy.

```text
Goal
└── parentGoalId (optional, future)
```

The MVP keeps it simple.

The architecture does not prevent hierarchy later.

---

# 20. Goal and ICP

A Goal may target one or more ICPs.

```text
Goal N ─── N ICP
```

Example:

```text
Goal:
Generate 1,000 qualified leads/month.

ICP:
B2B SaaS companies with 10-50 employees.
```

Connecting a Goal to an ICP focuses the growth effort.

A join relationship is used:

```text
GoalICP
├── goalId
└── icpId
```

---

# 21. Goal and Strategy

A Goal is pursued through one or more Strategies.

```text
Goal
      ↓
Strategy A
Strategy B
```

Every active Strategy must reference at least one Goal.

```text
Strategy N ─── N Goal
```

Example:

```text
Goal:
Generate 1,000 qualified leads/month.

Strategy:
High-Intent Demand Capture.
```

The Goal defines the outcome.

The Strategy defines the approach.

---

# 22. Goals Anchor Traceability

A Goal is the root of the traceability chain.

AUREA should be able to answer:

```text
Why are we running this Experiment?

→ Because it tests this Hypothesis.

Why this Hypothesis?

→ Because it supports this Strategy.

Why this Strategy?

→ Because it pursues this Goal.

Why this Goal?

→ Because it addresses this Business Objective.
```

The Goal is where the chain terminates.

If no Goal can be found at the root, the activity is unaligned.

---

# 23. The Alignment Invariant

Every consequential growth activity should trace back to a Goal.

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
```

An activity with no Goal at its root should be flagged as:

```text
UNALIGNED
```

The Goal is what prevents AUREA from generating aimless activity.

---

# 24. Goal Progress

A Goal's progress is measured against its metric.

```text
Baseline
   ↓
Current Value (from Analytics)
   ↓
Target
```

Example:

```text
Metric: Qualified Leads
Baseline: 400/month
Current: 720/month
Target: 1,000/month
Progress: 53% of the gap closed
```

Analytics supplies the current value.

The Goal defines what progress means.

---

# 25. Data Model

Conceptually, the Goals domain contains:

### Goal

```text
Goal
├── id
├── workspaceId
├── name
├── description
├── metric
├── baselineValue
├── targetValue
├── unit
├── deadline
├── priority
├── status
├── createdAt
├── updatedAt
└── completedAt
```

Possible statuses:

```text
DRAFT
ACTIVE
PAUSED
COMPLETED
CANCELLED
```

### Goal-ICP Relationship

```text
GoalICP
├── goalId
└── icpId
```

### Goal-Strategy Relationship

```text
StrategyGoal
├── strategyId
└── goalId
```

### Relationships

```text
Workspace
      ↓
Goal
      ├── ICPs (N ─── N)
      └── Strategies (N ─── N)
```

A Goal must belong to a Workspace.

A Goal may reference multiple ICPs.

The initial implementation may enforce a single primary Strategy relationship while allowing future expansion.

This aligns with the AUREA Persistence Model.

---

# 26. Multi-Tenant Isolation

Goals are scoped to a Workspace.

```text
Organization
      ↓
Workspace
      ↓
Goal
```

Goals must never cross tenant boundaries.

Every Goal query must be scoped to the workspace.

---

# 27. Goal Creation

Goals may be created by:

```text
USER
SYSTEM
```

In the initial product, Goals are primarily created by the user.

AUREA may later propose Goals based on Business Context and opportunities.

The default flow is:

```text
Business Context
      ↓
User defines desired outcome
      ↓
AUREA structures it into a measurable Goal
      ↓
Goal activated
      ↓
Strategy generation begins
```

---

# 28. Initial MVP Scope

The first implementation should support:

```text
Create Goal
View Goal
Update Goal
Activate Goal
Pause Goal
Complete Goal
Cancel Goal
```

The MVP Goal should contain:

* Name
* Description
* Metric
* Baseline
* Target
* Unit
* Deadline
* Priority
* Status

Goal hierarchy and AUREA-proposed Goals may follow.

---

# 29. First Goal Experience

The initial user journey should be:

```text
Business Context established
      ↓
User states a desired outcome
      ↓
AUREA structures it into a measurable Goal
      ↓
Metric, baseline, target, deadline confirmed
      ↓
Goal activated
      ↓
Strategy Agent begins from the Goal
```

---

# 30. Goals Principle

The Goals domain exists to ensure AUREA is always working toward something measurable.

It should never behave like:

```text
User:
I want to grow.

AI:
Here are some marketing ideas.
```

It should behave like:

```text
User:
I want to grow.

AUREA:
Grow what, measured how?

↓

Metric

↓

Where are you now, and where do you want to be?

↓

Baseline and Target

↓

By when?

↓

Deadline

↓

Now we have a Goal, and everything we do will trace back to it.
```

A Goal is the anchor of intent.

```text
Metric
+
Baseline
+
Target
+
Deadline
+
Traceability
=
A Growth Loop With Direction
```
