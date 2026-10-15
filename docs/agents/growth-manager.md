# AUREA Growth Manager

## 1. Purpose

The Growth Manager is the orchestrator of the agent layer.

It does not perform specialized reasoning.

It decides which specialists to invoke, in what order, with what context, and what to do with their output.

```text
Goal
  ↓
Growth Manager
  ↓
plans the work
  ↓
invokes specialist agents
  ↓
aggregates results into the Growth Brain
```

The Growth Manager is the conductor.

The specialist agents are the instruments.

---

# 2. Responsibility

The Growth Manager is responsible for:

```text
Interpreting goals and requests
Planning which agents to invoke
Sequencing the growth loop
Assembling context for each agent
Invoking specialist agents
Aggregating and reconciling outputs
Deciding when human approval is required
Advancing the loop or pausing it
```

The Growth Manager is not responsible for:

```text
Market research
Strategy generation
Experiment design
Content creation
Analytics
Executing integrations
```

Those belong to specialists and to the integration layer.

---

# 3. The Growth Manager Never Specializes

The Growth Manager must never absorb specialist reasoning.

It does not write strategies.

It does not analyze metrics.

It does not draft content.

If the Growth Manager began to specialize, AUREA would lose the separation that makes reasoning auditable and replaceable.

```text
Growth Manager
    decides WHO reasons and WHEN

Specialist Agent
    performs the reasoning
```

This boundary is deliberate and permanent.

---

# 4. Position in the Architecture

The Growth Manager sits between the user's intent and the specialist agents.

```text
User / Goal
      ↓
Growth Manager
      ↓
┌──────────────┬───────────────┬───────────────┐
│              │               │               │
Research     Strategy      Experiment       Content
Agent         Agent          Agent           Agent
│              │               │               │
└──────────────┴───────┬───────┴───────────────┘
                       ↓
                 Growth Brain
```

All arrows pass through the Growth Brain for context and persistence.

The Growth Manager coordinates.

The Growth Brain remains the source of truth.

---

# 5. Interpreting Goals

The Growth Manager begins by interpreting intent.

It reads the active Goal and its Growth Brain context.

It determines what phase of the growth loop the work belongs to.

```text
Is this a new Goal that needs Research?

Is there Research that is ready for Strategy?

Is there an approved Strategy that needs Experiments?

Is there an Experiment that needs Content?

Are there Outcomes that need Analysis?
```

The answer determines which agents are relevant.

The Growth Manager does not guess a full plan blindly.

It reasons from the current state of the Growth Brain.

---

# 6. Planning the Work

The Growth Manager produces a plan.

A plan identifies:

```text
Which agents to invoke
In what order
With what context
What each agent should produce
Where each output should be persisted
Which outputs require human approval
```

The plan is itself an auditable artifact.

AUREA should be able to explain not only what an agent did, but why the Growth Manager chose to invoke it.

---

# 7. Sequencing the Growth Loop

The Growth Manager sequences agents according to the growth loop.

```text
Goal
  ↓
Research Agent          → research findings
  ↓
Strategy Agent          → proposed strategies
  ↓  (human approval)
Experiment Agent        → hypotheses and experiments
  ↓
Content Agent           → drafts and proposed actions
  ↓  (human approval)
Execution (integrations)
  ↓
Analytics Agent         → insights and learning candidates
  ↓
Updated Context
  ↓
(loop repeats)
```

The loop may begin at any point.

An analytics anomaly may trigger a new experiment.

A research discovery may trigger a new strategy.

The Growth Manager chooses the entry point based on the current context.

---

# 8. Assembling Context

Before invoking an agent, the Growth Manager assembles its context.

Each agent receives only what its task requires.

```text
Research Agent
    Business Context, ICP, Goal, Constraints

Strategy Agent
    Business Context, ICP, Goal, Research, Historical Learnings, Constraints

Experiment Agent
    Strategy, Hypotheses, ICP, Constraints

Content Agent
    Strategy, Experiment, ICP, Channel, Brand Constraints

Analytics Agent
    Outcomes, Experiments, external analytics
```

Context is read from the Growth Brain through domain services.

The Growth Manager never lets an agent operate from an unstructured prompt alone.

---

# 9. Orchestration Flow

A representative orchestration for a new Goal:

```text
Growth Manager receives Goal
      │
      ├── loads Business Context + ICP + Goal
      │
      ▼
Invoke Research Agent
      │
      ▼
Persist Research to Growth Brain
      │
      ▼
Assemble Strategy context (incl. Research)
      │
      ▼
Invoke Strategy Agent
      │
      ▼
Persist PROPOSED Strategies to Growth Brain
      │
      ▼
Request Human Approval
      │
      ├── rejected → stop or replan
      │
      └── approved
              │
              ▼
      Assemble Experiment context
              │
              ▼
      Invoke Experiment Agent
              │
              ▼
      Persist Hypotheses + Experiments
              │
              ▼
      (continue toward Content and Execution)
```

Every step reads from and writes to the Growth Brain.

No specialist agent is invoked without assembled context.

---

# 10. Aggregating Outputs

Specialist agents produce independent structured outputs.

The Growth Manager aggregates them.

Aggregation may involve:

```text
Persisting each output through the correct domain service
Reconciling overlapping recommendations
Detecting contradictions between agents
Ordering proposals for human review
Deciding what advances and what waits
```

The Growth Manager does not merge outputs into a new opinion of its own.

It coordinates and reconciles, but the specialist reasoning remains attributable to its author.

---

# 11. Deciding When Human Approval Is Needed

The Growth Manager enforces human-in-the-loop policy.

Approval is required for consequential actions.

```text
Spending money
Changing advertising budgets
Publishing content
Sending messages to customers
Activating a strategy
Modifying business-critical configuration
```

The Growth Manager routes such outputs to approval rather than execution.

```text
Agent proposes Action
      ↓
Growth Manager checks autonomy policy
      ↓
┌───────────────┬────────────────┐
│               │                │
Copilot       Operator        Autopilot
recommend    approve then    decide within
only         execute         constraints
```

The default is human approval.

Autonomy is granted explicitly, per action type.

---

# 12. Boundaries

The Growth Manager does not:

```text
Specialize in any domain
Own business truth
Call integrations directly
Approve consequential actions on its own by default
Bypass Growth Brain domain services
Invent context an agent did not receive
```

The Growth Manager coordinates.

It does not execute.

It does not decide business truth.

It sequences reasoning and enforces the loop.

---

# 13. Growth Manager Principle

The Growth Manager is the discipline of the agent layer.

```text
It decides who reasons.
It decides when they reason.
It decides what they reason over.
It decides what happens to the result.
```

It never reasons in their place.

By keeping orchestration separate from specialization, AUREA preserves a growth loop that is coherent, sequenced, and fully auditable from Goal to Learning.
