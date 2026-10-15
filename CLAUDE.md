# AUREA

AUREA is an AI Growth Operating System.

The system helps businesses define growth goals, understand their market, create strategies, run measurable experiments, execute actions across multiple channels, measure outcomes, learn from results, and continuously improve.

The core growth loop is:

Goal
→ Research
→ Strategy
→ Experiment
→ Execute
→ Measure
→ Learn
→ Repeat

---

## Project Context

AUREA is not primarily a content generation tool, social media scheduler, CRM, analytics platform, or advertising manager.

It is an intelligent orchestration layer that connects business context, growth strategy, AI agents, external tools, execution channels, and measurement systems.

The product's core value is helping a business move from:

"Here is my growth objective."

to:

"Here is the strategy, the experiments we should run, the actions required, the results we obtained, and what we should do next."

---

## Documentation

The project documentation is organized by responsibility.

### Product

`docs/product/`

Contains:

* Product vision
* Product model
* Personas
* Product roadmap

Product documentation defines what AUREA is and what problems it solves.

---

### Architecture

`docs/architecture/`

Contains:

* System architecture
* Domain architecture
* Agent architecture
* Integration architecture

Architecture documentation defines how the system is structured.

---

### Domains

`docs/domains/`

Contains documentation for the core AUREA business domains.

Examples:

* Growth Brain
* Goals
* Strategies
* Experiments
* Analytics
* Knowledge

Domain documentation defines business concepts and rules.

---

### Agents

`docs/agents/`

Contains the responsibilities and behavioral contracts of AUREA agents.

Agents must follow the domain rules defined in `docs/domains/`.

Agents must not become independent sources of business truth.

---

### Development

`docs/development/`

Contains:

* Implementation phases
* Development workflow
* Architectural decisions
* Project execution order

---

## Skills

Technical implementation workflows and specialized development instructions are provided through agent skills (not included in this public snapshot).

Skills are the authoritative source for technical execution workflows.

Do not duplicate skill instructions in project documentation.

Do not copy generic engineering practices from skills into product or domain documentation.

Project documentation should focus on AUREA-specific requirements and decisions.

---

## Source of Truth

The following rules apply:

* Product behavior → `docs/product/`
* Architecture → `docs/architecture/`
* Business domain rules → `docs/domains/`
* Agent responsibilities → `docs/agents/`
* Integration contracts → `docs/architecture/` and relevant integration documentation
* Implementation phases → `docs/development/`

When documentation conflicts with implementation, investigate the discrepancy before changing code.

Do not silently change documented product or architectural behavior.

---

## Engineering Principles

### 1. Goal-driven

AUREA actions should be connected to a business goal whenever possible.

The system should avoid executing actions without understanding their intended outcome.

---

### 2. Experiment-driven

AUREA should prefer measurable experiments over arbitrary actions.

An action should ideally have:

* A hypothesis
* An expected outcome
* A metric
* A measurement period
* A result

---

### 3. Growth Brain as source of truth

The Growth Brain owns the business growth context.

Agents consume context from the Growth Brain.

Agents may analyze information, generate hypotheses, recommend strategies, and propose actions.

Agents do not own the canonical business state.

---

### 4. Human-in-the-loop by default

Early versions of AUREA should require human approval for consequential actions.

Examples include:

* Spending money
* Changing advertising budgets
* Publishing sensitive content
* Sending messages to customers
* Modifying business-critical configurations

Autonomy should be introduced progressively.

---

### 5. Provider-agnostic AI

The system should avoid unnecessary coupling to a single AI provider.

AI capabilities should be accessed through an abstraction that allows model providers to be changed or combined.

The system should support model routing based on:

* Task complexity
* Cost
* Latency
* Required capabilities
* Reliability

---

### 6. Integration-first

AUREA should integrate with existing specialized systems whenever doing so is more efficient than rebuilding equivalent functionality.

Examples include:

* Social publishing
* Advertising platforms
* Analytics
* CRM
* Email
* Automation

AUREA should focus its proprietary value on:

* Growth intelligence
* Business context
* Strategy
* Experimentation
* Decision-making
* Learning loops
* Agent orchestration

---

### 7. Auditable decisions

Important AI decisions and actions should be traceable.

Where applicable, the system should preserve:

* Input context
* Relevant data
* Decision
* Decision rationale summary
* Proposed action
* Approval
* Execution
* Result

The system should not rely on inaccessible conversational history as the only record of important decisions.

---

### 8. Cost-aware intelligence

The system should optimize AI costs.

Simple tasks should use lower-cost models when appropriate.

More capable models should be reserved for tasks where additional reasoning quality creates meaningful value.

---

### 9. Incremental autonomy

AUREA should evolve through three levels of autonomy.

#### Copilot

The system analyzes and recommends.

The human executes.

#### Operator

The system analyzes, proposes, and executes approved actions.

#### Autopilot

The system analyzes, decides, executes, measures, and optimizes within predefined constraints.

The system should not begin at full autonomy.

---

### 10. One phase at a time

Implementation should proceed incrementally.

Before implementing a phase:

1. Read this file.
2. Read the relevant phase documentation.
3. Read the relevant product, domain, architecture, and agent documentation.
4. Inspect the existing implementation.
5. Identify dependencies and affected boundaries.
6. Implement the requested scope.
7. Validate the implementation using the appropriate agent skills.
8. Update documentation when product behavior or architecture changes.

Do not implement future phases unless explicitly requested.

---

## Current Strategic Architecture

At a high level, AUREA is composed of:

```text
User
  ↓
Growth Goal
  ↓
Growth Brain
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
Execution
  ↓
Measurement
  ↓
Outcome
  ↓
Learning
  ↓
Growth Brain
```

External systems provide execution and data capabilities.

AUREA provides intelligence, orchestration, context, experimentation, and learning.

---

## Initial Technology Direction

The initial technical direction is:

### Frontend

* Vite
* React
* TypeScript

### Backend

* Fastify
* TypeScript

### Data

* PostgreSQL
* Prisma

### Async Processing

* Redis
* BullMQ

### AI

* Model Router
* Configurable LLM providers

### Agent Runtime

* OpenClaw

### Workflow Automation

* n8n

### Social Execution

* Postiz and/or direct platform integrations

### Analytics

* GA4
* PostHog
* Platform-specific analytics

### Advertising

* Meta Ads
* Google Ads
* TikTok Ads

### Storage

* S3-compatible object storage

These technologies are architectural direction, not immutable requirements.

Any change to the core technology direction should be documented as an architectural decision.

---

## Initial Product Direction

AUREA should initially focus on the following journey:

```text
Business Setup
  ↓
Business Context
  ↓
ICP Definition
  ↓
Growth Goal
  ↓
Research
  ↓
Growth Strategy
  ↓
Experiment Plan
  ↓
Content / Distribution
  ↓
Measurement
  ↓
Recommendations
```

The first product versions should prioritize the intelligence and learning loop before attempting full autonomous execution.

---

## Important Architectural Boundary

AUREA should not become a collection of unrelated AI agents.

The system should maintain a centralized growth context.

The preferred architecture is:

```text
                 Growth Brain
                      │
                Source of Truth
                      │
          ┌───────────┴───────────┐
          │                       │
       Agents                Integrations
          │                       │
    Analyze / Propose       Execute / Collect
          │                       │
          └───────────┬───────────┘
                      │
                   Outcomes
                      │
                      ▼
                 Growth Brain
```

The Growth Brain coordinates the lifecycle.

Agents are specialized capabilities.

Integrations are execution and data boundaries.

---

## Development Rule

Do not optimize for building the largest possible system.

Optimize for validating the AUREA growth loop.

The product should progressively prove:

1. The system understands a business.
2. The system understands a goal.
3. The system can research opportunities.
4. The system can generate useful strategies.
5. The system can create measurable experiments.
6. The system can execute experiments.
7. The system can measure outcomes.
8. The system can learn from outcomes.
9. The system can improve future decisions.

The complete autonomous loop is the long-term goal.

The first implementation should prove the smallest valuable version of that loop.
