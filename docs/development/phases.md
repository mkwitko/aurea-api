# AUREA Engineering Phases

# 1. Purpose

This document indexes the AUREA engineering build order.

The build order is the sequence in which the system is implemented.

It follows engineering dependencies, not product marketing order.

Each engineering phase has its own document under `docs/development/`.

This index summarizes every phase, maps engineering phases to product roadmap phases, and states the guiding rule for how phases are executed.

---

# 2. Two Numbering Systems

AUREA uses two different phase numbering systems.

They exist for different reasons and must not be confused.

```text
Engineering phases  →  build order (this document, docs/development/)
Product roadmap     →  product capability order (docs/product/roadmap.md)
```

The engineering phases follow the order in which code must be built so that each layer can depend on the previous one.

The product roadmap follows the order in which user-facing capability is delivered.

The two are related but not identical.

Section 4 maps one to the other.

---

# 3. Engineering Phase Index

The engineering build order is 00 through 12.

## Phase 00 — Foundation

Establishes the repository, documentation structure, tooling, continuous integration, base infrastructure, environment configuration, secrets handling, and base observability.

Delivers a repository that builds, lints, tests, and boots locally with reproducible configuration.

## Phase 01 — Monorepo

Establishes the monorepo layout: `apps/web`, `apps/api`, `packages/shared`, `packages/db`, `packages/ai`, `packages/integrations`.

Delivers shared TypeScript config, build and test tooling, the Prisma package, an EventBus interface stub, a base Fastify API, and a base Vite/React web skeleton.

## Phase 02 — Identity

Establishes authentication and the multi-tenant model: `User`, `Organization`, `Workspace`, `Membership`, and the `OWNER`/`ADMIN`/`MEMBER`/`VIEWER` roles.

Delivers session and API authentication, tenant isolation, and workspace switching.

## Phase 03 — Growth Brain

Implements the core Growth Brain domain: `Business`, `BusinessContext` (with versions), `ICP`, `Goal`, `Strategy`, `Hypothesis`, and `Experiment` persistence, domain services, and invariants.

Delivers the `AgentRun` recording scaffold and emits domain events. This is the structural heart of AUREA.

## Phase 04 — Research

Adds the Research Agent and research integrations: web search and retrieval, document ingestion into `KnowledgeDocument` and `KnowledgeChunk`, and provenance tracking.

Delivers research that feeds structured context into the Growth Brain.

## Phase 05 — Strategy

Adds the Strategy Agent, producing `PROPOSED` strategies with options and trade-offs.

Delivers a human review, approve, and activate flow, plus strategy versioning.

## Phase 06 — Experiments

Implements the full `Hypothesis` and `Experiment` lifecycle with success criteria and metrics.

Delivers experiment planning UI, state transitions, and lifecycle events. This completes the intelligence loop up to measurable experiments.

## Phase 07 — Content

Turns strategies and experiments into content briefs and generated content.

Delivers content creation, review, and approval workflows.

## Phase 08 — Social

Adds social distribution through Postiz and/or direct platform integrations.

Delivers scheduling, publishing, and publish-state tracking against experiments.

## Phase 09 — Analytics

Connects execution to measurable outcomes through GA4, PostHog, and platform analytics.

Delivers event ingestion, `Outcome` recording, and experiment result analysis.

## Phase 10 — Growth Loop

Closes the learning loop: `Outcome` to `Learning` to updated `BusinessContext` and strategy iteration.

Delivers the complete Goal to Research to Strategy to Experiment to Measure to Learn cycle running end to end.

## Phase 11 — Autonomy

Introduces progressive autonomy: the Operator level (execute approved actions with audit trail) and the Autopilot level (bounded autonomous decisions within guardrails), including paid growth execution.

Delivers `Action`, `Approval`, and `Decision` orchestration, guardrails, and risk limits.

## Phase 12 — Production

Cross-cutting production hardening.

Delivers scaling, security review, cost controls, monitoring, alerting, backup and recovery, and general availability readiness.

---

# 4. Engineering to Product Roadmap Mapping

The product roadmap (`docs/product/roadmap.md`) uses product phase numbers.

The mapping between engineering phases and product roadmap phases is:

```text
Engineering                Product Roadmap
----------------------------------------------------------------
00 Foundation          →   Phase 0 — Foundation (infrastructure)
01 Monorepo            →   Phase 0 — Foundation (structure)
02 Identity            →   Phase 0 — Foundation (auth + org model)
03 Growth Brain        →   Phase 1 — Business Context
                           Phase 2 — Goals
                           Phase 3 — Growth Brain
04 Research            →   Phase 4 — Research
05 Strategy            →   Phase 5 — Strategy
06 Experiments         →   Phase 6 — Experimentation
07 Content             →   Phase 7 — Content and Distribution (creation)
08 Social              →   Phase 7 — Content and Distribution (distribution)
09 Analytics           →   Phase 8 — Analytics
10 Growth Loop         →   Phase 9 — Growth Loop
11 Autonomy            →   Phase 10 — Operator
                           Phase 11 — Paid Growth
                           Phase 12 — Autopilot
12 Production          →   Cross-cutting (enables Operator and
                           Autopilot to run in production)
----------------------------------------------------------------
```

Notes on the non-obvious mappings:

Product roadmap Phase 0 is a single "Foundation" phase.

Engineering splits it into three phases (00, 01, 02) because infrastructure, monorepo structure, and identity have distinct dependencies and must be built in sequence.

Product roadmap Phases 1, 2, and 3 (Business Context, Goals, Growth Brain) are delivered by a single engineering phase (03).

The persistence model treats these entities as one coherent domain, so they are built together rather than as three separate database and service efforts.

Product roadmap Phase 7 (Content and Distribution) is split into two engineering phases (07 Content, 08 Social) because content creation and content distribution have separate integration surfaces.

Product roadmap Phases 10, 11, and 12 (Operator, Paid Growth, Autopilot) are consolidated into engineering Phase 11 (Autonomy) because they share the same execution, approval, and guardrail machinery.

---

# 5. Autonomy Progression

AUREA advances through three autonomy levels, defined in `CLAUDE.md`.

The engineering phases map to these levels as follows:

```text
COPILOT
  The system analyzes and recommends. The human executes.
  Delivered by engineering phases 03 → 10.

        │
        ▼

OPERATOR
  The system analyzes, proposes, and executes approved actions.
  Delivered by engineering phase 11 (Operator level).

        │
        ▼

AUTOPILOT
  The system analyzes, decides, executes, measures, and optimizes
  within predefined constraints.
  Delivered by engineering phase 11 (Autopilot level),
  hardened by phase 12.
```

The system must never begin at full autonomy.

Each level requires the previous level to be proven.

---

# 6. Guiding Rule

One phase at a time.

Optimize for validating the growth loop, not maximum system.

```text
Do not optimize for building the largest possible system.
Optimize for validating the AUREA growth loop.
```

Concretely:

Build the smallest valuable version of each phase.

Do not implement a future phase unless it is explicitly requested.

The first milestone is proving that AUREA can produce genuinely useful growth intelligence (engineering phases 00 through 06).

Execution and autonomy become primary priorities only after the intelligence loop is validated.

---

# 7. Phase Documents

Each phase has a dedicated document.

```text
docs/development/phase-00-foundation.md
docs/development/phase-01-monorepo.md
docs/development/phase-02-identity.md
docs/development/phase-03-growth-brain.md
docs/development/phase-04-research.md
docs/development/phase-05-strategy.md
docs/development/phase-06-experiments.md
docs/development/phase-07-content.md
docs/development/phase-08-social.md
docs/development/phase-09-analytics.md
docs/development/phase-10-growth-loop.md
docs/development/phase-11-autonomy.md
docs/development/phase-12-production.md
```

Every phase document follows the same structure: Objective, Scope, Dependencies, Deliverables, Out of Scope, and Exit Criteria.

The development workflow that governs how a phase is executed is defined in `docs/development/workflow.md`.
