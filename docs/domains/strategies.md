# AUREA Strategies Domain

## 1. Purpose

The Strategies domain defines how AUREA transforms business objectives, context, research, and insights into coherent growth approaches.

A Strategy explains:

```text
What are we going to try to achieve?
Why do we believe this approach can work?
Who are we targeting?
What growth mechanism are we using?
Which channels are relevant?
What assumptions are we making?
How will we validate the strategy?
```

The Strategy is the bridge between:

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

AUREA should not jump directly from a Goal to a list of marketing activities.

---

# 2. Domain Responsibility

The Strategies domain is responsible for:

* Defining strategic approaches
* Connecting strategies to Goals
* Connecting strategies to ICPs
* Incorporating Research
* Defining strategic hypotheses
* Identifying growth mechanisms
* Defining strategic channels
* Defining strategic assumptions
* Prioritizing strategic opportunities
* Managing strategy lifecycle
* Maintaining strategy versions

The Strategies domain is not responsible for:

* Defining the canonical Business Context
* Collecting raw analytics data
* Executing actions
* Publishing content
* Managing advertising campaigns
* Running experiments

Those responsibilities belong to other domains.

---

# 3. Strategy Philosophy

A strategy is not a list of tasks.

Bad Strategy:

```text
Post on Instagram 3 times per week.
Run Google Ads.
Send email campaigns.
```

This describes activities.

Better Strategy:

```text
Position the business as the specialized solution for
high-intent B2B SaaS companies and capture demand through
search-driven acquisition, supported by educational content
that increases trust and conversion.
```

The strategy explains the mechanism.

The activities are generated later.

---

# 4. Strategy in the Growth Loop

The Strategy domain sits between Goal and Experiment.

```text
Business Context
      ↓
Goal
      ↓
Research
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

The strategy should remain stable enough to guide multiple experiments.

---

# 5. Strategy Inputs

A Strategy should be generated from:

```text
Business Context
+
ICP
+
Goal
+
Research
+
Historical Learnings
+
Constraints
```

The Strategy Agent should not operate only from a user prompt.

It should receive structured Growth Brain context.

---

# 6. Strategy Structure

A Strategy should contain:

```text
Name
Description
Objective
Strategic Thesis
Target ICP
Growth Mechanism
Channels
Key Assumptions
Constraints
Expected Outcome
Priority
Status
```

Example:

```text
Name:
High-Intent Demand Capture

Objective:
Increase qualified pipeline.

Strategic Thesis:
Capture users already searching for solutions to the problem
through high-intent search and reinforce trust through
educational content.

Target ICP:
B2B SaaS companies with 10-50 employees.

Growth Mechanism:
Demand capture.

Channels:
Google Search
SEO
LinkedIn

Key Assumption:
High-intent search traffic will convert at a lower CAC
than broad paid social acquisition.
```

---

# 7. Strategic Thesis

The Strategic Thesis is the central belief behind a Strategy.

It should answer:

```text
Why do we believe this approach can achieve the Goal?
```

Example:

```text
If we target customers with existing problem awareness
through high-intent search and reinforce credibility
through educational content, we expect to increase
qualified pipeline while maintaining acceptable CAC.
```

The thesis should be testable.

---

# 8. Strategy Objective

The Strategy Objective describes what the strategy intends to accomplish.

Example:

```text
Increase qualified pipeline from high-intent demand.
```

The Strategy Objective must align with at least one Goal.

---

# 9. Strategy and Goal

Every active Strategy must be connected to one or more Goals.

```text
Goal
  ↓
Strategy
```

Example:

```text
Goal:
Generate 1,000 qualified leads per month.

Strategy:
High-Intent Demand Capture.
```

The Strategy should explain how it intends to contribute to the Goal.

---

# 10. Strategy and ICP

A Strategy should identify its target ICP.

Example:

```text
Strategy:
High-Intent Demand Capture

ICP:
B2B SaaS companies with 10-50 employees.
```

A Strategy may target:

* One primary ICP
* Multiple ICPs

The initial MVP should prioritize one primary ICP per Strategy.

---

# 11. Growth Mechanism

The Growth Mechanism describes how growth is expected to happen.

Examples:

```text
Demand Capture
Demand Generation
Referral
Virality
Retention
Expansion
Activation
Conversion Optimization
Partnerships
Community
Outbound
Product-Led Growth
```

A Strategy may combine multiple mechanisms.

However, the primary mechanism should be explicit.

---

# 12. Channel Strategy

Channels are the means through which a Strategy operates.

Examples:

```text
Google Search
SEO
LinkedIn
Instagram
TikTok
Email
YouTube
Community
Partnerships
Outbound Sales
Paid Advertising
```

A Strategy should not assume that every channel is appropriate.

Channel selection should be based on:

* ICP behavior
* Goal
* Cost
* Expected impact
* Existing capabilities
* Historical performance
* Research

---

# 13. Channel Selection

AUREA should reason about channels before recommending execution.

The system should consider:

```text
Where does the ICP spend time?

Where does the ICP search for solutions?

Where can the business reach the ICP?

What channels are already performing?

What is the expected cost?

How measurable is the channel?

How quickly can results be obtained?
```

The answer should influence the Strategy.

---

# 14. Strategic Assumptions

Strategies are based on assumptions.

Examples:

```text
Customers are actively searching for this problem.

LinkedIn is an effective channel for reaching the ICP.

The current positioning resonates with buyers.

The market is sufficiently large.

The business can serve increased demand.
```

Assumptions should be explicit.

Hidden assumptions make strategies difficult to evaluate.

---

# 15. Assumption Confidence

Each strategic assumption may have a confidence level.

Possible values:

```text
LOW
MEDIUM
HIGH
VERIFIED
```

Example:

```text
Assumption:
B2B SaaS founders actively search for this problem.

Confidence:
MEDIUM

Evidence:
Keyword research + customer interviews.
```

---

# 16. Strategy Evidence

Strategies should be supported by evidence.

Evidence may come from:

```text
Business Context
Research
Analytics
Historical Experiments
Customer Data
User Input
External Market Data
```

A Strategy should distinguish between:

```text
Evidence
Assumption
Inference
Hypothesis
```

These are not interchangeable.

---

# 17. Strategy Evidence Model

Conceptually:

```text
Evidence
    ↓
Observation
    ↓
Inference
    ↓
Strategic Assumption
    ↓
Strategic Thesis
```

Example:

```text
Evidence:
Customers frequently search for "AI customer support".

Observation:
Search demand exists.

Inference:
There is active problem awareness.

Assumption:
Search can generate qualified demand.

Strategy:
Capture high-intent search demand.
```

---

# 18. Strategy Constraints

A Strategy may have constraints.

Examples:

```text
Budget
Team Capacity
Brand Rules
Legal Restrictions
Geography
Available Channels
Technology
Time
```

Example:

```text
Constraint:
Maximum marketing budget of $20,000/month.
```

Constraints must be visible to agents.

A Strategy that ignores constraints is invalid.

---

# 19. Strategy Priority

Strategies may have a priority.

Possible values:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

Priority should consider:

* Expected impact
* Confidence
* Cost
* Time to result
* Strategic alignment
* Risk

---

# 20. Strategy Status

Initial lifecycle:

```text
DRAFT
PROPOSED
APPROVED
ACTIVE
PAUSED
ARCHIVED
```

---

# 21. DRAFT

A Draft Strategy is incomplete.

It may be missing:

* Evidence
* Target ICP
* Strategic Thesis
* Growth Mechanism
* Channels

Draft strategies should not generate execution actions.

---

# 22. PROPOSED

A Proposed Strategy has been generated and is ready for review.

It may have been created by:

```text
User
Strategy Agent
Growth Brain
```

The Strategy should include its supporting context.

---

# 23. APPROVED

An Approved Strategy has been explicitly accepted.

Approval may be performed by:

```text
User
Authorized Team Member
```

Approval indicates that the organization accepts the strategic direction.

---

# 24. ACTIVE

An Active Strategy is currently being pursued.

Active Strategies may generate:

* Hypotheses
* Experiments
* Recommendations

---

# 25. PAUSED

A Strategy may be paused without being discarded.

Existing experiments may:

* Continue
* Pause
* Complete

depending on their individual status.

---

# 26. ARCHIVED

A Strategy may be archived when:

* It is no longer relevant
* The Goal changes
* The Business Context changes
* Evidence invalidates the approach
* A better strategy replaces it

Historical records remain available.

---

# 27. Strategy Versioning

Strategies should support versioning.

Example:

```text
Strategy v1

Thesis:
Use paid search to capture high-intent users.

Strategy v2

Thesis:
Use SEO and educational content to reduce CAC
while maintaining high-intent acquisition.
```

The original strategy should remain historically available.

---

# 28. Why Strategy Versioning Matters

Consider:

```text
Strategy v1
      ↓
Experiment A
      ↓
Outcome
      ↓
Learning
      ↓
Strategy v2
```

Without versioning, AUREA cannot reliably explain why the system changed direction.

Versioning creates strategic traceability.

---

# 29. Strategy Creation

Strategies may be created by:

```text
USER
STRATEGY_AGENT
SYSTEM
```

AI-generated strategies should initially be Proposed.

The default flow is:

```text
Goal
  ↓
Research
  ↓
Strategy Agent
  ↓
Strategy Proposal
  ↓
Human Review
  ↓
Approved
  ↓
Active
```

---

# 30. Strategy Proposal

A Strategy Proposal should contain:

```text
Strategic Thesis
Objective
Target ICP
Growth Mechanism
Channels
Assumptions
Evidence
Expected Outcome
Risks
Constraints
```

The user should be able to understand why AUREA is recommending the strategy.

---

# 31. Strategy Approval

Approval should capture:

```text
Approver
Timestamp
Strategy Version
Optional Comment
```

Approval should not mutate the Strategy silently.

---

# 32. Strategy Risks

Every meaningful Strategy should identify risks.

Examples:

```text
Channel saturation
High CAC
Low demand
Weak positioning
Insufficient budget
Execution complexity
Low measurement quality
```

Risks should be considered when designing Experiments.

---

# 33. Strategy Alternatives

AUREA should eventually generate multiple strategic options.

Example:

```text
Strategy A:
Paid Demand Capture

Expected Impact:
High

Cost:
High

Speed:
Fast

Confidence:
Medium
```

```text
Strategy B:
Organic Demand Generation

Expected Impact:
Medium

Cost:
Low

Speed:
Slow

Confidence:
Medium
```

The user can then choose a strategic direction.

---

# 34. Strategy Comparison

Strategies may be evaluated using:

```text
Expected Impact
Confidence
Cost
Time to Result
Risk
Scalability
Strategic Fit
```

AUREA should explain trade-offs rather than presenting a single recommendation without context.

---

# 35. Strategy Selection

The selected Strategy becomes the active strategic direction.

Example:

```text
Research
    ↓
Three Strategy Proposals
    ↓
User Review
    ↓
Strategy Selected
    ↓
Strategy Approved
    ↓
Strategy Active
```

The Growth Brain should preserve rejected alternatives where useful.

---

# 36. Strategy and Hypothesis

A Strategy contains assumptions.

Hypotheses convert important assumptions into testable statements.

Example:

```text
Strategy:
High-Intent Demand Capture

Assumption:
Users searching for the problem have strong purchase intent.

Hypothesis:
Search campaigns targeting high-intent keywords will generate
qualified leads at a lower CAC than broad social campaigns.
```

Therefore:

```text
Strategy
  ↓
Assumption
  ↓
Hypothesis
```

---

# 37. Strategy and Experiment

Strategies may generate multiple experiments.

Example:

```text
Strategy:
High-Intent Demand Capture

        ↓

Experiment A:
Google Search

Experiment B:
SEO Landing Page

Experiment C:
LinkedIn Retargeting
```

The Strategy provides coherence across experiments.

---

# 38. Strategy-to-Experiment Invariant

Every Experiment should belong to a Strategy.

An Experiment without strategic context should be considered:

```text
UNALIGNED
```

The system should surface this condition.

---

# 39. Strategy and Actions

Actions should be derived from Experiments.

Preferred hierarchy:

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

A Strategy should not directly create arbitrary execution tasks unless explicitly defined as a strategic operation.

---

# 40. Strategy Context

Agents should receive a Strategy Context.

Conceptually:

```text
Strategy Context
├── Business Context
├── ICP
├── Goal
├── Research
├── Historical Learnings
├── Existing Strategies
├── Constraints
└── Strategic Risks
```

The Strategy Agent should use this context to produce recommendations.

---

# 41. Strategy Context Snapshot

When generating a Strategy, AUREA should preserve:

```text
Business Context Version
ICP Version
Goal Version
Research Set
Historical Learnings
Constraints
```

This creates traceability.

---

# 42. Strategy Agent

The Strategy Agent is responsible for:

```text
Analyze Goal
Analyze Business Context
Analyze ICP
Analyze Research
Analyze Existing Strategies
Identify Opportunities
Generate Strategic Options
Evaluate Trade-offs
Recommend Strategy
```

The Strategy Agent should not:

```text
Publish content
Launch ads
Send emails
Change budgets
Modify integrations
```

Those are execution responsibilities.

---

# 43. Strategy Agent Output

The Strategy Agent should produce structured output.

Conceptually:

```text
{
  "name": "...",
  "objective": "...",
  "strategicThesis": "...",
  "targetIcp": "...",
  "growthMechanism": "...",
  "channels": [],
  "assumptions": [],
  "evidence": [],
  "risks": [],
  "expectedOutcome": "...",
  "confidence": "MEDIUM"
}
```

The exact schema is implementation-dependent.

---

# 44. Strategy Quality Criteria

A Strategy should be evaluated on:

```text
Goal Alignment
Context Alignment
ICP Relevance
Evidence Quality
Strategic Coherence
Testability
Feasibility
Risk Awareness
```

A Strategy that fails these criteria should not automatically become Active.

---

# 45. Strategy Validation

Before approval, AUREA should check:

```text
Does the Strategy support an active Goal?

Does it target a defined ICP?

Is there a clear strategic thesis?

Are assumptions explicit?

Is evidence available?

Are constraints considered?

Can the strategy be tested?

Are risks identified?
```

---

# 46. Strategy Learning

Strategy effectiveness should be evaluated through experiments.

```text
Strategy
    ↓
Experiments
    ↓
Outcomes
    ↓
Learnings
    ↓
Strategy Evaluation
```

Possible outcomes:

```text
Strategy Validated
Strategy Partially Validated
Strategy Invalidated
Strategy Requires Modification
```

---

# 47. Strategy Adaptation

AUREA should not immediately discard a Strategy after one failed experiment.

Example:

```text
Strategy:
Content-led Demand Generation

Experiment:
LinkedIn organic posts

Result:
Poor performance
```

Possible interpretation:

```text
Channel failed.
```

Not necessarily:

```text
Strategy failed.
```

The system should distinguish:

```text
Strategy Failure
Channel Failure
Execution Failure
Experiment Failure
Measurement Failure
```

---

# 48. Strategy Learning Loop

The preferred loop is:

```text
Strategy
    ↓
Experiment
    ↓
Outcome
    ↓
Learning
    ↓
Strategy Evaluation
    ↓
Continue
Modify
Pause
Replace
```

---

# 49. Strategy Metrics

A Strategy may have multiple relevant metrics.

Example:

```text
Primary Metric:
Qualified Leads

Secondary Metrics:
CAC
Conversion Rate
Pipeline Value
```

The primary metric should connect to the associated Goal.

---

# 50. Strategy Data Model

Conceptually:

```text
Strategy
├── id
├── workspaceId
├── name
├── description
├── objective
├── strategicThesis
├── growthMechanism
├── expectedOutcome
├── priority
├── status
├── version
├── constraints
├── risks
├── assumptions
├── createdAt
├── updatedAt
└── archivedAt
```

Relationships:

```text
Strategy
├── Goals
├── ICPs
├── Hypotheses
├── Experiments
├── Research
└── Learnings
```

---

# 51. Initial MVP Scope

The first implementation should support:

```text
Create Strategy
View Strategy
Update Strategy
Propose Strategy
Approve Strategy
Activate Strategy
Pause Strategy
Archive Strategy
```

The MVP Strategy should contain:

* Name
* Objective
* Strategic Thesis
* Target ICP
* Growth Mechanism
* Channels
* Assumptions
* Evidence
* Risks
* Status

---

# 52. First Strategy Experience

The initial user journey should be:

```text
Active Goal
      ↓
Research
      ↓
AUREA identifies opportunities
      ↓
Strategy Agent generates options
      ↓
User reviews strategic alternatives
      ↓
Strategy selected
      ↓
Strategy approved
      ↓
Strategy active
      ↓
Hypotheses generated
      ↓
Experiments designed
```

---

# 53. Strategic Alternatives Example

AUREA may present:

```text
Goal:
Generate 1,000 qualified leads/month.

Option A:
Paid Search Demand Capture

Expected Impact:
High

Cost:
High

Speed:
Fast

Confidence:
Medium
```

```text
Option B:
SEO + Educational Content

Expected Impact:
Medium

Cost:
Low

Speed:
Slow

Confidence:
Medium
```

```text
Option C:
LinkedIn Outbound

Expected Impact:
Medium

Cost:
Medium

Speed:
Fast

Confidence:
Low
```

The user selects the strategic direction.

---

# 54. Strategy Principle

AUREA should always distinguish:

```text
Goal
What we want to achieve.

Strategy
How we intend to achieve it.

Hypothesis
What we believe must be true.

Experiment
How we will test it.

Action
What we will do.

Outcome
What happened.

Learning
What we discovered.
```

This distinction is fundamental to the AUREA Growth Brain.

---

# 55. Strategic Traceability

AUREA should be able to answer:

```text
Why are we running this experiment?

→ Because it tests this Hypothesis.

Why this Hypothesis?

→ Because it supports this Strategy.

Why this Strategy?

→ Because it pursues this Goal.

Why this Goal?

→ Because it addresses this Business Objective.
```

If this chain cannot be established, the system should flag the activity as potentially unaligned.

---

# 56. Core Strategy Principle

The Strategy domain exists to prevent AUREA from becoming a task generator.

The system should not behave like:

```text
User:
I want to grow.

AI:
Here are 30 social media posts.
```

It should behave like:

```text
User:
I want to grow.

AUREA:
What outcome are we pursuing?

↓

Goal

↓

Who are we targeting?

↓

ICP

↓

What do we know about the market?

↓

Research

↓

What strategic approaches are available?

↓

Strategy

↓

What assumptions should we test?

↓

Hypothesis

↓

What experiment should validate them?

↓

Experiment

↓

What actions should we execute?

↓

Action
```

This is the strategic intelligence layer that differentiates AUREA from traditional marketing automation software.
