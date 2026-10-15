# AUREA — Orientation for AI Coding Agents

This file orients AI coding agents and contributors working in this repository.

It complements `CLAUDE.md`. It does not replace it.

Read `CLAUDE.md` for the full engineering rules. Read this file to know where things live and what to read before you touch anything.

---

## 1. What AUREA Is

AUREA is an AI Growth Operating System.

It helps a business define growth goals, understand its market, create strategies, run measurable experiments, execute actions across channels, measure outcomes, learn, and improve.

The core growth loop is:

```text
Goal
→ Research
→ Strategy
→ Hypothesis
→ Experiment
→ Action
→ Execute
→ Outcome
→ Learning
→ Updated Context
→ repeat
```

AUREA is not a content tool, scheduler, CRM, analytics platform, or ad manager.

It is the intelligent orchestration layer that connects business context, strategy, AI agents, integrations, execution, and measurement.

---

## 2. Documentation Map

Documentation is organized by responsibility.

```text
docs/product/       What AUREA is and the problems it solves.
                    Vision, product model, roadmap.

docs/architecture/  How the system is structured.
                    System overview, domain model, data and
                    persistence, events, integrations,
                    agent-architecture, ai-architecture.

docs/domains/       Business concepts and rules.
                    Growth Brain, business context, goals,
                    strategies, experiments, analytics, knowledge.

docs/agents/        Agent responsibilities and behavioral contracts.
                    Overview, Growth Manager, Research, Strategy,
                    Analytics, Content.

docs/development/   How and in what order to build.
                    Phases 00–12, workflow.
```

Two architecture docs are easy to confuse:

```text
agent-architecture.md   The agents themselves (what reasons).
ai-architecture.md      The AI layer (Model Router, providers,
                        prompt assembly, guardrails, AgentRun).
```

---

## 3. Source-of-Truth Rules

```text
Product behavior      → docs/product/
Architecture          → docs/architecture/
Business domain rules → docs/domains/
Agent responsibilities → docs/agents/
Integration contracts → docs/architecture/ + integration docs
Implementation phases → docs/development/
```

The Growth Brain is the single source of business truth.

Documentation is the source of truth for intended behavior.

When documentation conflicts with implementation, investigate the discrepancy before changing code.

Do not silently change documented product or architectural behavior.

---

## 4. Key Engineering Principles

These are summarized here. The authoritative version is in `CLAUDE.md`.

```text
1.  Goal-driven          Actions connect to a business goal.
2.  Experiment-driven    Prefer measurable experiments over
                         arbitrary actions.
3.  Growth Brain as truth Agents consume context; they never
                         own canonical state.
4.  Human-in-the-loop    Consequential actions need approval
                         by default.
5.  Provider-agnostic    AI accessed through an abstraction and
                         a Model Router.
6.  Integration-first    Reuse specialized systems; own the
                         growth intelligence.
7.  Auditable            Preserve input, decision, rationale,
                         approval, execution, result.
8.  Cost-aware           Cheap models for simple tasks; capable
                         models for high-value reasoning.
9.  Incremental autonomy Copilot → Operator → Autopilot.
10. One phase at a time  Build incrementally; do not implement
                         future phases unprompted.
```

---

## 5. Rules That Constrain Agents

Two rules govern the agent layer and must not be broken.

```text
Golden Rule
    Agents NEVER call each other directly.
    All coordination flows through the Growth Brain.
    The Growth Manager orchestrates.

Stateless Agents
    Agents load context, reason, produce structured output,
    persist through Growth Brain domain services, and exit.
    Agents never own state or become a source of truth.
```

Agents propose and analyze.

Integrations execute.

The Growth Brain owns truth.

---

## 6. Where to Look Before You Implement

Before writing code for a feature:

```text
1. Read CLAUDE.md.
2. Read the relevant docs/development/phase-*.md.
3. Read the relevant docs/product, docs/domains, docs/architecture,
   and docs/agents documentation.
4. Inspect the existing implementation (back/ and web/).
5. Identify dependencies and affected boundaries.
6. Implement only the requested scope.
7. Validate using the appropriate agent skills.
8. Update documentation when product or architecture behavior changes.
```

Technical execution workflows live in agent skills (not included in this public snapshot).

Skills are the authoritative source for technical workflows.

Do not duplicate skill instructions into project documentation.

---

## 7. Orientation Principle

Read before you build.

```text
Understand the business → docs/product
Understand the rules    → docs/domains
Understand the shape    → docs/architecture
Understand the agents   → docs/agents
Understand the order    → docs/development
```

AUREA's value is a coherent growth loop, not a pile of features.

Optimize for validating the loop, not for building the largest possible system.
