# AUREA Experiments Domain

## 1. Purpose

The Experiments domain defines how AUREA converts strategic beliefs into measurable tests.

An Experiment is the bridge between strategy and execution.

It answers:

```text
What are we trying to learn?
Which hypothesis are we testing?
What will we change?
Who is the audience?
Which channel will we use?
What is the baseline?
What is the target?
How will we measure it?
How long will it run?
What counts as success?
```

A Strategy explains what approach to pursue.

An Experiment turns that approach into something the business can actually observe.

Without experiments, a strategy remains an untested belief.

---

# 2. Domain Responsibility

The Experiments domain is responsible for:

* Designing experiments from hypotheses
* Defining the variables under test
* Defining the audience and channel
* Defining baseline, target, and metric
* Defining success criteria
* Defining experiment duration
* Managing the experiment lifecycle
* Connecting experiments to outcomes
* Feeding results into learning

The Experiments domain is not responsible for:

* Defining the Business Context
* Defining Strategies
* Executing actions
* Publishing content or launching campaigns
* Collecting raw analytics data
* Deciding canonical truth

Those responsibilities belong to other domains.

The Experiments domain designs the test.

It does not perform the execution and it does not own the measurement.

---

# 3. Experiments in the Growth Loop

An Experiment sits between Hypothesis and Action.

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

The Experiment is the point where belief becomes observation.

Actions execute inside experiments.

Outcomes are measured against experiments.

---

# 4. Hypothesis to Experiment

Every Experiment must test a Hypothesis.

```text
Hypothesis
    ↓
Experiment
```

A Hypothesis is a testable belief.

An Experiment is the structured test of that belief.

Example:

```text
Hypothesis:
Search campaigns targeting high-intent keywords will generate
qualified leads at a lower CAC than broad social campaigns.

Experiment:
Run a Google Search campaign on high-intent keywords for 4 weeks
and compare CAC against the current paid social baseline.
```

An Experiment without a Hypothesis should be considered:

```text
UNGROUNDED
```

The system should surface this condition.

---

# 5. Hypothesis, Experiment, Action, Outcome

The relationship chain is:

```text
Hypothesis
    ↓
Experiment
    ↓
Action
    ↓
Outcome
```

The Hypothesis defines the belief.

The Experiment defines the test.

The Actions perform the work inside the test.

The Outcome records what was measured.

Example:

```text
Hypothesis:
Operational-cost messaging converts SaaS founders better.

Experiment:
Test operational-cost landing page against the current page.

Actions:
Create landing page variant.
Publish landing page variant.
Route traffic to both variants.

Outcome:
Variant conversion rate: 6.1%
Baseline conversion rate: 4.2%
```

One Experiment may generate multiple Actions.

One Experiment may produce multiple Outcomes.

---

# 6. Experiment Structure

An Experiment should contain:

```text
Name
Description
Objective
Hypothesis
Variables
Audience
Channel
Metric
Baseline
Target
Duration
Success Criteria
Status
```

Example:

```text
Name:
High-Intent Search Test

Objective:
Determine whether high-intent search reduces CAC.

Hypothesis:
High-intent search generates qualified leads at lower CAC
than broad paid social.

Variables:
Channel (Search vs Social)

Audience:
B2B SaaS companies, 10-50 employees.

Channel:
Google Search

Metric:
Cost per Qualified Lead

Baseline:
$120 per qualified lead

Target:
$80 per qualified lead

Duration:
4 weeks

Success Criteria:
CAC below $90 with at least 50 qualified leads.
```

The structure makes the test unambiguous before it starts.

---

# 7. Experiment Objective

The Objective describes what the Experiment intends to learn.

Example:

```text
Determine whether high-intent search reduces the cost
per qualified lead relative to paid social.
```

An Objective is about learning.

It is not about completing an activity.

---

# 8. Experiment Variables

Variables describe what is being changed.

Examples:

```text
Channel
Message
Audience
Offer
Creative
Landing Page
Price
Timing
```

A good Experiment isolates the variable under test.

Example:

```text
Variable:
Landing page message.

Held constant:
Traffic source, audience, offer, budget.
```

If too many variables change at once, the result becomes difficult to interpret.

---

# 9. Experiment Audience

The Audience defines who the Experiment is applied to.

Example:

```text
Audience:
B2B SaaS founders at companies with 10-50 employees
actively searching for customer support solutions.
```

The Audience should align with the target ICP of the parent Strategy.

---

# 10. Experiment Channel

The Channel defines where the Experiment operates.

Examples:

```text
Google Search
SEO
LinkedIn
Instagram
Email
Paid Advertising
Landing Page
```

The Channel should be consistent with the Strategy's channel plan.

---

# 11. Experiment Metric

Every Experiment must define a primary metric.

Example:

```text
Primary Metric:
Cost per Qualified Lead

Secondary Metrics:
Conversion Rate
Click-Through Rate
Lead Volume
```

The primary metric should connect back to the Goal.

An Experiment without a metric cannot produce a meaningful outcome.

---

# 12. Baseline and Target

An Experiment should define a baseline and a target.

```text
Baseline:
The current known value of the metric.

Target:
The value that would indicate success.
```

Example:

```text
Baseline:
Conversion rate of 4.2%.

Target:
Conversion rate of 5.5%.
```

The baseline should come from Analytics or historical data whenever possible.

If no baseline exists, the Experiment may be exploratory.

---

# 13. Success Criteria

Success Criteria define what result would confirm or reject the hypothesis.

Example:

```text
Success:
Conversion rate above 5.5% with sufficient validity.

Partial:
Conversion rate between 4.5% and 5.5%.

Failure:
Conversion rate at or below baseline.
```

Success Criteria must be defined before the Experiment runs.

Defining success after seeing results invalidates the test.

---

# 14. Success Is Not Completion

An Experiment is not successful because it finished.

```text
Completed ≠ Successful
```

Completion means the Experiment ran to its planned end.

Success means the result met the success criteria.

A completed Experiment may be:

```text
Successful
Partially Successful
Unsuccessful
Inconclusive
```

An unsuccessful Experiment is still valuable.

A rejected hypothesis is a valid and useful result.

---

# 15. Experiment Duration

An Experiment should define a duration.

Example:

```text
Duration:
4 weeks
```

Duration should be long enough to gather sufficient data.

Ending an Experiment early may compromise validity.

Running an Experiment too long may waste budget and delay learning.

---

# 16. Experiment Lifecycle

The experiment lifecycle is:

```text
DRAFT
PLANNED
APPROVED
RUNNING
PAUSED
COMPLETED
CANCELLED
```

The lifecycle records the state of the test within AUREA.

External execution state may be tracked separately.

---

# 17. DRAFT

A Draft Experiment is incomplete.

It may be missing:

* Hypothesis
* Metric
* Baseline
* Target
* Success Criteria
* Audience or Channel

Draft experiments should not generate actions.

---

# 18. PLANNED

A Planned Experiment has a complete design.

It defines:

```text
Hypothesis
Variables
Audience
Channel
Metric
Baseline
Target
Duration
Success Criteria
```

A Planned Experiment is ready for review.

---

# 19. APPROVED

An Approved Experiment has been explicitly accepted.

Approval may be performed by:

```text
User
Authorized Team Member
```

Approval indicates the organization accepts the cost and risk of running the test.

Approval should capture:

```text
Approver
Timestamp
Optional Comment
```

---

# 20. RUNNING

A Running Experiment is actively being executed.

Running Experiments may:

* Generate Actions
* Produce Outcomes
* Accumulate measurements

The system should record the start of the running period.

---

# 21. PAUSED

A Running Experiment may be paused.

Reasons may include:

```text
Budget hold
Data quality issue
External disruption
Strategic reprioritization
```

A paused Experiment retains its accumulated data.

Pausing should be recorded, since it may affect validity.

---

# 22. COMPLETED

A Completed Experiment has reached the end of its planned run.

Completion triggers evaluation against success criteria.

Completion does not imply success.

A Completed Experiment should produce:

```text
Outcomes
An evaluation against success criteria
Learning candidates
```

---

# 23. CANCELLED

A Cancelled Experiment was stopped before producing a valid result.

Reasons may include:

```text
Strategy invalidated
Goal changed
Design flaw discovered
Insufficient budget
```

Cancelled Experiments should remain in history.

They should not be deleted.

---

# 24. Experiment Validity

An Experiment result is only as trustworthy as its validity.

AUREA should reason about validity pragmatically.

Key validity concerns:

```text
Sample Size
Confidence
Confounding Factors
Measurement Quality
Duration
```

The goal is not academic rigor.

The goal is to avoid drawing confident conclusions from weak evidence.

---

# 25. Sample Size

An Experiment needs enough data to be meaningful.

Example:

```text
Conversion rate difference observed.

Sample:
40 visitors.

Assessment:
Sample too small to be conclusive.
```

AUREA should flag results based on insufficient sample size.

Small samples produce noisy results.

---

# 26. Confidence

Results should carry a confidence assessment.

Possible values:

```text
LOW
MEDIUM
HIGH
```

Example:

```text
Result:
Variant improved conversion by 30%.

Confidence:
LOW

Reason:
Only 60 total conversions observed.
```

Confidence should influence how strongly AUREA acts on a result.

---

# 27. Confounding Factors

A confounder is an external influence that distorts results.

Examples:

```text
A seasonal spike in demand.
A competitor outage.
A pricing change during the test.
A holiday period.
A parallel campaign affecting the same audience.
```

AUREA should record known confounders alongside outcomes.

A result explained by a confounder should not be treated as a clean learning.

---

# 28. Pragmatic Validity Principle

AUREA is not a statistics engine.

It is a growth system that must avoid two failures:

```text
Believing a false result.
Ignoring a real signal.
```

The pragmatic stance is:

```text
Prefer clear, well-measured tests.
State confidence honestly.
Flag weak evidence.
Do not overclaim.
```

Perfect statistical rigor is not always achievable in growth.

Honest confidence is.

---

# 29. Experiment to Outcome

An Experiment produces one or more Outcomes.

```text
Experiment
    ↓
Outcome
```

An Outcome records what was measured.

Example:

```text
Experiment:
High-Intent Search Test

Outcome:
Metric: Cost per Qualified Lead
Observed: $78
Baseline: $120
```

Outcomes are recorded by the Analytics domain.

The Experiment defines what should be measured.

---

# 30. Outcome to Learning

An Outcome, once evaluated against success criteria, produces Learning.

```text
Experiment
    ↓
Outcome
    ↓
Evaluation
    ↓
Learning
```

Example:

```text
Outcome:
High-intent search produced $78 CAC vs $120 baseline.

Evaluation:
Success criteria met with medium confidence.

Learning:
High-intent search reduces cost per qualified lead
for the B2B SaaS ICP.
```

Learning candidates are proposed.

They are validated before entering canonical knowledge.

---

# 31. Experiment Result Interpretation

A result should be interpreted carefully.

The system should distinguish:

```text
Hypothesis validated
Hypothesis rejected
Hypothesis inconclusive
Execution failure
Measurement failure
```

Example:

```text
Result:
Poor performance.

Possible interpretations:
The hypothesis was wrong.
The channel was wrong.
The execution was poor.
The measurement was flawed.
```

A poor result does not automatically invalidate the parent Strategy.

---

# 32. Experiment and Strategy

Every Experiment belongs to a Strategy.

```text
Strategy
    ↓
Hypothesis
    ↓
Experiment
```

An Experiment inherits strategic context.

An Experiment without a Strategy should be considered:

```text
UNALIGNED
```

The Strategy provides coherence across multiple experiments.

---

# 33. Experiment Traceability

AUREA should be able to answer:

```text
Why are we running this Experiment?

→ Because it tests this Hypothesis.

Why this Hypothesis?

→ Because it supports this Strategy.

Why this Strategy?

→ Because it pursues this Goal.
```

If this chain cannot be established, the Experiment should be flagged.

---

# 34. Experiment Context Snapshot

When an Experiment runs, AUREA should preserve:

```text
Business Context Version
ICP Version
Strategy Version
Hypothesis
Baseline
Success Criteria
```

This creates historical integrity.

If context later changes, the Experiment retains the context under which it ran.

The system should not silently rewrite the conditions of a past test.

---

# 35. Experiment Data Model

Conceptually:

```text
Experiment
├── id
├── workspaceId
├── strategyId
├── hypothesisId
├── name
├── description
├── objective
├── channel
├── audience
├── variables
├── metric
├── baselineValue
├── targetValue
├── successCriteria
├── startDate
├── endDate
├── status
├── createdAt
├── updatedAt
└── completedAt
```

Relationships:

```text
Experiment
├── Strategy
├── Hypothesis
├── Actions
├── Outcomes
└── Learnings
```

This aligns with the AUREA Persistence Model.

An Experiment must reference a Hypothesis.

An Experiment must belong to a Workspace.

---

# 36. Experiment Creation

Experiments may be created by:

```text
USER
STRATEGY_AGENT
EXPERIMENT_AGENT
SYSTEM
```

AI-generated experiments should initially be Draft or Planned.

They should require human review before running.

The default flow is:

```text
Strategy
  ↓
Hypothesis
  ↓
Experiment Design
  ↓
Human Review
  ↓
Approved
  ↓
Running
  ↓
Completed
  ↓
Outcome
  ↓
Learning
```

---

# 37. Experiment Approval and Human-in-the-Loop

Experiments consume budget and carry risk.

Running an Experiment should require human approval.

AUREA proposes.

The human authorizes.

The system should not silently launch experiments that spend money or affect customers.

---

# 38. Initial MVP Scope

The first implementation should support:

```text
Create Experiment
View Experiment
Update Experiment
Plan Experiment
Approve Experiment
Start Experiment
Pause Experiment
Complete Experiment
Cancel Experiment
```

The MVP Experiment should contain:

* Name
* Objective
* Hypothesis reference
* Variables
* Audience
* Channel
* Metric
* Baseline
* Target
* Success Criteria
* Duration
* Status

Outcome recording and Learning generation may follow once Analytics is connected.

---

# 39. First Experiment Experience

The initial user journey should be:

```text
Active Strategy
      ↓
Hypothesis defined
      ↓
Experiment Agent proposes an experiment
      ↓
User reviews design and success criteria
      ↓
Experiment approved
      ↓
Experiment running
      ↓
Outcome recorded
      ↓
Result evaluated against success criteria
      ↓
Learning candidate created
```

---

# 40. Experiment Principle

The Experiments domain exists to ensure AUREA learns instead of merely acting.

The system should never behave like:

```text
User:
I want more leads.

AI:
Here are 30 ads. They are live.
```

It should behave like:

```text
User:
I want more leads.

AUREA:
What do we believe will work?

↓

Hypothesis

↓

How will we test it, and what would prove it?

↓

Experiment

↓

What did we observe?

↓

Outcome

↓

What did we learn?

↓

Learning
```

An Experiment is a question posed to reality.

Its value is the answer, whether the answer is yes or no.

This is what allows AUREA to improve over time rather than simply generate activity.
