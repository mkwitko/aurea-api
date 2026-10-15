# AUREA Agents Overview

## 1. Purpose

The agent layer is where AUREA reasons.

Agents are specialized AI capabilities that analyze context, generate options, and propose work.

Agents do not run the business.

The Growth Brain runs the business.

Agents help the Growth Brain think.

```text
Growth Brain
    provides context and owns truth
        ↓
Agents
    analyze and propose
        ↓
Growth Brain
    records decisions and state
```

The agent layer exists to turn structured business context into strategic reasoning, research, experiments, content, and insight.

It never becomes the source of that context.

---

# 2. What an Agent Is

An agent is a stateless specialist.

It receives a task and a context.

It reasons.

It produces structured output.

It persists a record of its execution.

It exits.

An agent has no memory between runs.

An agent has no private database.

An agent has no authority over business state.

Everything an agent needs must arrive as context.

Everything an agent produces must be written back through the Growth Brain.

---

# 3. Why Agents Are Stateless

Stateless agents are:

```text
Observable
Auditable
Reproducible
Replaceable
```

If an agent held private memory, AUREA could not explain why it behaved the way it did.

The reasoning would live inside a model instead of inside the Growth Brain.

By keeping agents stateless, every input, decision, and output remains inspectable in the Growth Brain and in the AgentRun record.

The knowledge lives in the system, not in the agent.

---

# 4. The Roster

AUREA operates a small set of specialized agents.

```text
Growth Manager
    Orchestration. Never specializes.

Research Agent
    Market, competitor, customer, and trend research.

Strategy Agent
    Strategic options, growth mechanisms, channel selection.

Experiment Agent
    Hypotheses, experiment design, success metrics.

Content Agent
    Content strategy, briefs, copy, CTAs, campaign assets.

Analytics Agent
    Outcomes, insights, anomalies, recommendations.
```

Each specialist owns a single kind of reasoning.

The Growth Manager owns coordination.

No agent owns business truth.

---

# 5. The Shared Agent Contract

Every agent follows the same lifecycle.

```text
Receive Task
      ↓
Load Context (from Growth Brain)
      ↓
Reason
      ↓
Produce Structured Output
      ↓
Persist (through Growth Brain domain services)
      ↓
Record AgentRun
      ↓
Exit
```

This contract is identical for every agent in the roster.

Only the reasoning step differs.

The contract is what makes agents interchangeable and auditable.

---

# 6. Loading Context

An agent must not operate from a raw user prompt alone.

An agent operates from assembled Growth Brain context.

Depending on the agent, context may include:

```text
Business Context
ICP
Goal
Strategy
Research
Historical Learnings
Constraints
Outcomes
```

The Growth Manager assembles the context for each agent.

The agent consumes only what it is given.

If context is missing, the agent should surface the gap rather than invent it.

---

# 7. Structured Output Requirement

Agents must produce structured output.

Free-form text alone is not acceptable as an agent result.

Structured output allows AUREA to:

```text
Validate the result
Persist it as domain entities
Trace it to its inputs
Present it for human review
Compare alternatives
```

Each agent has an output schema aligned with the domain it serves.

For example, the Strategy Agent produces a Strategy proposal schema aligned with the Strategies domain.

The exact schema is implementation-dependent.

The requirement for structure is not.

---

# 8. Reading and Writing Only Through the Growth Brain

Agents interact with business state exclusively through Growth Brain domain services.

Agents do not query the database directly.

Agents do not mutate entities directly.

Agents do not bypass domain rules or invariants.

```text
Agent
  ↓
Growth Brain Domain Service
  ↓
Business State
```

This ensures that lifecycle rules, invariants, versioning, and audit are always enforced.

An agent cannot create an Experiment that skips its Hypothesis.

The domain service will not allow it.

---

# 9. The Golden Rule

Agents NEVER call each other directly.

All coordination flows through the Growth Brain.

The Growth Manager orchestrates.

```text
        Research Agent
              │
              ▼
        Growth Brain  ◀── Growth Manager
              ▲
              │
        Strategy Agent
```

The Research Agent never calls the Strategy Agent.

It writes findings to the Growth Brain.

The Growth Manager then invokes the Strategy Agent with those findings as context.

This guarantees observability, auditability, reproducibility, and historical reasoning.

A direct agent-to-agent call would hide a decision from the record.

---

# 10. Agent Runs

Every agent execution is recorded as an AgentRun.

An AgentRun captures the operational reality of the execution.

```text
AgentRun
├── agentType
├── taskType
├── status
├── model
├── provider
├── inputTokens
├── outputTokens
├── estimatedCost
├── startedAt
├── completedAt
└── error
```

Tool invocations during a run are recorded as AgentToolCall records.

The AgentRun is operational data.

It does not replace domain entities.

It explains how the AI worked, not what is true.

See `docs/architecture/persistance-model.md`.

---

# 11. Cost and Audit

The AgentRun record makes AI cost and behavior visible.

Because every run records model, provider, tokens, and estimated cost, AUREA can:

```text
Attribute cost to a workspace
Attribute cost to a task type
Compare model choices
Detect runaway or failing runs
Explain a past decision
```

Auditability is not an afterthought.

Input context, reasoning summary, proposed output, and the resulting AgentRun together form an auditable trail for every agent action.

---

# 12. Autonomy Levels Applied to Agents

Agents inherit the AUREA autonomy model.

```text
Copilot
    Agent analyzes and recommends.
    Human executes.

Operator
    Agent analyzes and proposes.
    Human approves.
    Approved actions are executed.

Autopilot
    Agent decides and executes within predefined constraints.
```

By default, consequential agent output requires human approval.

An agent proposes.

A human, or an explicitly configured autonomy policy, authorizes.

Autonomy is introduced progressively, per action type, never as a default.

---

# 13. Agent Boundaries

Agents have firm boundaries.

Agents do not:

```text
Own business state
Become a source of truth
Call other agents directly
Execute integrations directly
Publish content
Launch or modify advertising
Send messages to customers
Change budgets
Approve their own proposals
```

Execution belongs to the integration layer.

Truth belongs to the Growth Brain.

Approval belongs to humans, or to an explicit autonomy policy.

Reasoning belongs to agents.

---

# 14. Agents and Integrations

Agents propose actions.

Integrations execute them.

```text
Agent
  ↓ (proposes Action)
Growth Brain
  ↓ (after approval)
Integration Layer
  ↓
External Platform
```

A Content Agent produces a post draft.

It does not publish it.

The Postiz or platform integration publishes it after the Action is approved.

This separation keeps reasoning provider-agnostic and execution auditable.

---

# 15. Agent Boundaries Map

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

Agents live on the analyze-and-propose side.

They never cross into execution.

---

# 16. Agents Principle

An agent is a specialist that reasons and disappears.

```text
Load context.
Reason.
Propose.
Persist.
Exit.
```

The agent is temporary.

The Growth Brain is permanent.

AUREA is intelligent because its agents are disciplined enough to remain stateless, structured, and subordinate to the Growth Brain.
