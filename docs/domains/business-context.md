# AUREA Business Context Domain

> **Note:** The detailed company overview lives in `docs/company/overview.md`. This file now references that central source and includes a concise summary for quick reference.

## 1. Purpose

The Business Context domain holds the structured accumulated understanding of the business.

It is the ground on which all AI reasoning stands.

Business Context answers:

```text
Who are we?

What do we sell?

Who do we serve?

How do we make money?

How are we positioned?

What makes us different?

What constraints do we operate under?
```

Every agent that reasons about goals, strategies, experiments, or content should read from Business Context first.

Without shared context, AI output is generic.

With shared context, AI output is specific to this business.

---

# 2. Domain Responsibility

The Business Context domain is responsible for:

* Maintaining the structured understanding of the business
* Recording products, services, market, and model
* Recording positioning and value proposition
* Maintaining ICPs and personas
* Recording competitors and offers
* Recording brand and constraints
* Tracking the source and confidence of each element
* Versioning context over time
* Preserving historical integrity

The Business Context domain is not responsible for:

* Defining Goals
* Defining Strategies
* Running experiments
* Collecting analytics data
* Executing actions

Business Context describes the business.

It does not decide what to do about it.

---

# 3. Business Context in the Growth Loop

Business Context is the starting point of the loop.

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
      ↓
Updated Business Context
```

The loop begins with context and returns to update it.

Business Context both grounds and receives learning.

---

# 4. What Business Context Contains

Business Context may include:

```text
Business Description
Products
Services
Market
Business Model
Revenue Model
Positioning
Value Proposition
ICP
Personas
Competitors
Offers
Brand
Constraints
```

Some of this is structured.

Some of this is narrative.

Business Context is partially structured and partially knowledge-based.

---

# 5. Business Description

The business description explains what the business is.

Example:

```text
A B2B SaaS company providing AI-powered customer support tooling
for small and mid-sized software companies.
```

This is the foundational framing every agent should share.

---

# 6. Products and Services

Products and services describe what the business offers.

Example:

```text
Product:
AI support assistant that resolves tier-1 tickets automatically.

Service:
Onboarding and integration support.
```

Agents should understand what is actually being sold.

---

# 7. Market and Model

Business Context records the market and business model.

```text
Market:
B2B SaaS customer support tooling.

Business Model:
Subscription SaaS.

Revenue Model:
Monthly recurring revenue with per-seat pricing.
```

The model shapes which goals and strategies make sense.

---

# 8. Positioning and Value Proposition

Positioning describes how the business wants to be perceived.

Value proposition describes the core promise.

Example:

```text
Positioning:
The specialized support automation tool for B2B SaaS.

Value Proposition:
Cut support costs in half without hurting customer satisfaction.
```

Positioning and value proposition directly inform messaging and strategy.

---

# 9. ICP

The Ideal Customer Profile defines who the business wants to acquire.

Business Context may maintain multiple ICPs.

Each ICP may include:

```text
Name
Description
Characteristics
Pain Points
Goals
Buying Triggers
Objections
```

Example:

```text
ICP:
B2B SaaS companies with 10-50 employees.

Pain Points:
Rising support costs.
Slow response times.

Buying Triggers:
Support team overwhelmed by ticket volume.
```

ICPs evolve as research and experiments produce evidence.

---

# 10. Personas

Personas describe the individuals within an ICP.

Example:

```text
Persona:
Head of Customer Support at a 30-person SaaS company.

Goals:
Reduce ticket backlog.
Keep CSAT high.

Objections:
Fear that automation will frustrate customers.
```

Personas make messaging concrete.

---

# 11. Competitors

Business Context records competitors.

Example:

```text
Competitor:
A general-purpose helpdesk platform.

Their Strength:
Broad feature set.

Our Difference:
Specialized automation for SaaS support.
```

Understanding competitors informs positioning and strategy.

---

# 12. Offers

Offers describe the specific commercial propositions.

Example:

```text
Offer:
14-day free trial with guided onboarding.

Offer:
Annual plan with two months free.
```

Offers are often the subject of experiments.

---

# 13. Brand

Brand describes tone, voice, and identity.

Example:

```text
Voice:
Confident, practical, no hype.

Tone:
Helpful and direct.

Avoid:
Overpromising and jargon.
```

Brand constraints guide generated content.

---

# 14. Constraints

Constraints describe the limits within which the business operates.

Examples:

```text
Budget
Team Capacity
Legal Restrictions
Geography
Brand Rules
Technology
Time
```

Constraints must be visible to agents.

A strategy or action that ignores constraints is invalid.

---

# 15. Context Sources

Business Context may originate from:

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

The source determines how much the information should be trusted.

---

# 16. Confidence, Source, and Last Verified

Each contextual element may carry metadata.

```text
Confidence
Source
Last Verified
```

Example:

```text
Element:
"Our ICP prioritizes integration ease."

Source:
Customer interviews.

Confidence:
MEDIUM

Last Verified:
2026-06-01
```

Context is not static truth.

It has an origin and a freshness.

---

# 17. Confidence Levels

Possible confidence levels:

```text
LOW
MEDIUM
HIGH
VERIFIED
```

Confidence should reflect the strength of the evidence.

AI-generated context should not automatically be high confidence.

---

# 18. The Fact and Inference Distinction

Business Context must distinguish the nature of each element.

```text
Known Fact
User Provided
Observed Data
AI Inference
Hypothesis
```

Definitions:

```text
Known Fact:
Established and reliable.

User Provided:
Stated by the user.

Observed Data:
Measured from analytics or integrations.

AI Inference:
Produced by AI reasoning.

Hypothesis:
A belief not yet validated.
```

AI inference must not automatically become fact.

The distinction must be preserved and visible.

---

# 19. Why the Distinction Matters

Consider two statements:

```text
"Our ICP is B2B SaaS companies." (User Provided)

"Our ICP probably values integration ease." (AI Inference)
```

These should not be treated identically.

An agent should treat validated facts differently from unvalidated inference.

Blurring the two leads to confident but unfounded decisions.

---

# 20. Context Evolution Through the Loop

Business Context evolves as the loop runs.

```text
Initial Context
      ↓
Research adds evidence
      ↓
Experiments produce outcomes
      ↓
Learnings validate or invalidate assumptions
      ↓
Context is updated
```

Example:

```text
Before:
"We believe our ICP values low price." (AI Inference)

After an experiment:
"Our ICP values integration ease over price." (Observed Data)
```

Context becomes more grounded over time.

Inferences are replaced by evidence.

---

# 21. Versioning

Business Context should support versioning.

```text
Business Context v1
      ↓
Business Context v2
      ↓
Business Context v3
```

Each version captures the state of understanding at a point in time.

The current version is what agents read by default.

Previous versions remain available.

---

# 22. Historical Integrity

Business Context must preserve history.

The system should not silently rewrite the past.

```text
Business Context v1
      ↓
Experiment A ran under v1

Business Context v2
      ↓
Experiment B ran under v2
```

If context changes, past experiments must retain the context version under which they ran.

An experiment's meaning depends on the context it was executed in.

Rewriting that context would corrupt the historical record.

---

# 23. Context Snapshots

When an experiment or strategy is created, AUREA should capture the relevant context version.

```text
Strategy
   references
Business Context Version

Experiment
   references
Business Context Version
```

This creates traceability.

AUREA can later explain what the business believed to be true when a decision was made.

---

# 24. Data Model

Conceptually, the Business Context domain contains:

### Business

```text
Business
├── id
├── workspaceId
├── name
├── description
├── website
├── industry
├── businessModel
├── revenueModel
├── valueProposition
├── positioning
├── createdAt
├── updatedAt
└── deletedAt
```

### Business Context

```text
BusinessContext
├── id
├── businessId
├── currentVersionId
├── createdAt
└── updatedAt
```

### Business Context Version

```text
BusinessContextVersion
├── id
├── businessContextId
├── version
├── data
├── source
├── confidence
├── createdBy
├── createdAt
└── supersededAt
```

### ICP

```text
ICP
├── id
├── workspaceId
├── name
├── description
├── characteristics
├── painPoints
├── goals
├── buyingTriggers
├── objections
├── status
├── createdAt
├── updatedAt
└── deletedAt
```

### Relationships

```text
Workspace
      ↓
Business
      ↓
BusinessContext
      ↓
BusinessContextVersion
```

```text
Workspace
      ↓
ICP
```

Possible sources:

```text
USER
RESEARCH
INTEGRATION
AI
SYSTEM
```

Possible confidence levels:

```text
LOW
MEDIUM
HIGH
VERIFIED
```

The actual contextual information is stored through versions.

The `data` field may initially be structured JSON, evolving toward typed fields as patterns stabilize.

This aligns with the AUREA Persistence Model.

---

# 25. Business Context and ICP

The ICP is part of the business understanding.

A Business may have multiple ICPs.

```text
Business
      ↓
ICP A
ICP B
```

Goals and Strategies reference ICPs.

The ICP connects Business Context to the rest of the growth loop.

---

# 26. Multi-Tenant Isolation

Business Context is scoped to a Workspace.

```text
Organization
      ↓
Workspace
      ↓
Business
      ↓
BusinessContext
```

Context must never leak across tenant boundaries.

Every context read must be scoped to the workspace.

---

# 27. Serving Context to Agents

Agents should receive structured Business Context.

Conceptually:

```text
Business Context
├── Business Description
├── Products and Services
├── Market and Model
├── Positioning and Value Proposition
├── ICPs and Personas
├── Competitors
├── Offers
├── Brand
├── Constraints
└── Confidence and Provenance
```

Each element carries its source and confidence.

Agents should reason accordingly, treating facts and inferences differently.

---

# 28. Initial MVP Scope

The first implementation should support:

```text
Create Business
Create Business Context
Create Business Context Version
View Current Context
Update Context (creating a new version)
Create ICP
Update ICP
```

The MVP context should capture:

* Business description
* Products and services
* Market and model
* Positioning and value proposition
* At least one ICP
* Constraints
* Source and confidence per element

Advanced personas, competitor tracking, and offer modeling may follow.

---

# 29. First Business Context Experience

The initial user journey should be:

```text
User describes the business
      ↓
AUREA structures the context
      ↓
AUREA proposes inferred elements (marked as AI Inference)
      ↓
User confirms or corrects
      ↓
Business Context v1 is established
      ↓
Agents reason from the shared context
```

---

# 30. Business Context Principle

The Business Context domain exists to ground AUREA in reality.

It should never behave like:

```text
User:
Write me a strategy.

AI:
Here is a generic strategy for any business.
```

It should behave like:

```text
User:
Write me a strategy.

AUREA:
Based on your positioning as a specialized support
automation tool, your B2B SaaS ICP, and your $20k
budget constraint, here is a grounded strategy.

Note: the claim about ICP price sensitivity is an
AI inference and has not yet been validated.
```

Business Context is what makes AUREA specific instead of generic.

```text
Structured Understanding
+
Source and Confidence
+
Fact vs Inference
+
Versioning
=
Trustworthy Ground for AI Reasoning
```
