# AUREA AI Architecture

> **Estado (2026-07-28):** núcleo de execução (B1), controle de consumo (B2a) e Stripe com
> assinatura, cupom e compra de crédito (B2b) existem — abstração de provider, Model
> Router, guardrails, loop de ferramentas, fila, `AgentRun`, ledger de créditos com
> bloqueio e estorno, BYOK cifrada por workspace, e a franquia efetiva por status de
> assinatura (ver `docs/architecture/billing.md`). Ainda não existem: avaliação de
> qualidade (§13) e `AgentToolCall` para tools server-side de terceiros.

## 1. Purpose

This document describes the AI layer of AUREA.

The AI layer is the infrastructure that lets AUREA reason with language models.

It is distinct from the agent layer.

```text
Agents
    what reasoning is performed
    (see docs/architecture/agent-architecture.md)

AI Layer
    how that reasoning is executed against models
    (this document)
```

Agents decide what to think about.

The AI layer decides which model runs, how the prompt is assembled, how the result is validated, and how the execution is recorded.

---

# 2. Responsibility

The AI layer is responsible for:

```text
Reasoning, planning, and recommendation execution
Routing tasks to appropriate models
Abstracting AI providers
Assembling prompts and context from the Growth Brain
Applying cost-aware model selection
Recording every execution as an AgentRun
Enforcing guardrails on model output
Evaluating output quality
```

The AI layer is not responsible for:

```text
Owning business data
Deciding business truth
Executing integrations
Storing canonical state
```

The AI layer produces inference.

Inference is not fact until it is validated and persisted through the Growth Brain.

---

# 3. The AI Layer Never Owns Data

The AI layer is stateless with respect to business truth.

```text
Growth Brain
    owns data and truth
        ↓
AI Layer
    reasons over provided context
        ↓
Growth Brain
    validates and persists results
```

Models do not hold the business state.

Prompts are assembled from the Growth Brain for each execution and discarded after.

The AI layer is a reasoning engine, not a system of record.

---

# 4. The Model Router

The Model Router selects which model executes a given task.

It routes based on:

```text
Task complexity
Cost
Latency
Required capabilities
Reliability
```

```text
Task
  ↓
Model Router
  ├── simple task      → low-cost model
  ├── high-value task  → capable model
  ├── latency-sensitive → fast model
  └── fallback on failure → alternate provider
  ↓
Selected Model
```

The Model Router centralizes model selection so that no agent hard-codes a provider or model.

Changing model strategy is a routing change, not an agent change.

---

# 5. Provider-Agnostic Abstraction

AUREA avoids coupling to a single AI provider.

Models are accessed through an abstraction that allows providers to be changed or combined.

```text
Agent / AI Layer
        ↓
Provider Abstraction
        ↓
┌───────────┬───────────┬───────────┐
Provider A  Provider B  Provider C
```

The abstraction normalizes:

```text
Prompt format
Message roles
Tool calling
Token accounting
Error handling
```

An agent expresses a reasoning task.

The abstraction and router decide which provider fulfills it.

A provider can be swapped without rewriting agents.

---

# 6. Prompt and Context Assembly

Prompts are assembled from Growth Brain context, not from raw user text alone.

```text
Growth Brain
  ↓
Context Assembly
  ├── Business Context
  ├── ICP
  ├── Goal
  ├── Strategy / Research / Outcomes (as relevant)
  └── Constraints
  ↓
Prompt
  ↓
Model
```

Context assembly is where structured business truth becomes model input.

The assembled context is recorded so that a past execution can be explained and, where useful, reproduced.

The model sees only what the assembly provides.

---

# 7. Cost-Aware Model Tiers

The AI layer optimizes cost by matching model capability to task value.

```text
Tier 1: Low-cost models
    Simple, high-volume, low-risk tasks.
    Classification, extraction, formatting, summarization.

Tier 2: Mid-tier models
    Routine reasoning with moderate value.

Tier 3: Capable models
    High-value reasoning: strategy, complex analysis,
    consequential recommendations.
```

Simple tasks should use lower-cost models.

More capable models are reserved for tasks where added reasoning quality creates meaningful value.

The Model Router applies this tiering automatically.

---

# 8. AgentRun Recording

Every AI execution is recorded as an AgentRun.

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

Tool invocations within a run are recorded as AgentToolCall records.

The AgentRun is operational data.

It records how the AI worked, separate from the business entities the run produced.

See `docs/architecture/persistance-model.md`.

---

# 9. Observability

The AgentRun record makes the AI layer observable.

Because model, provider, tokens, cost, and outcome are recorded per run, AUREA can:

```text
Track spend per workspace and task type
Compare model performance and cost
Detect failures, retries, and timeouts
Explain a past decision
Audit AI behavior over time
```

Observability is built into the execution path.

It is not bolted on afterward.

---

# 10. Guardrails

Model output passes through guardrails before it is trusted.

```text
Model Output
      ↓
Structured Output Enforcement
      ↓
Schema Validation
      ↓
Retry / Repair on failure
      ↓
Hallucination Containment
      ↓
Validated Result
```

### Structured Output

Reasoning tasks must return structured output, not free-form prose alone.

### Validation

Output is validated against the expected schema.

Invalid output is not persisted.

### Retries

Failed or malformed outputs may be retried, repaired, or escalated to a more capable model.

### Hallucination Containment

Claims are checked against provided context.

Output that asserts facts not grounded in context is treated as inference, marked with source and confidence, and never promoted to fact automatically.

---

# 11. Inference Is Not Fact

The central guardrail principle of the AI layer:

```text
AI inference is not fact until validated.
```

The Growth Brain distinguishes:

```text
Known Fact
User Provided
Observed Data
AI Inference
Hypothesis
```

The AI layer produces inference.

It attaches source and confidence to what it produces.

Only after validation, and where appropriate human approval, does inference enter the Growth Brain as anything stronger than inference.

---

# 12. Separation of AI Execution and Business State

AI execution and business state are two different systems.

```text
Business State (Growth Brain)
    What is true now.
    Goals, Strategies, Experiments, Outcomes, Learnings.

AI Execution (AI Layer)
    How the AI worked.
    AgentRuns, tool calls, tokens, cost, models.
```

An AgentRun never replaces a domain entity.

A domain entity never depends on model internals.

This separation keeps business truth stable even as models, providers, and prompts change.

---

# 13. Evaluation and Quality

The AI layer supports evaluation of output quality.

Quality signals may include:

```text
Schema validity
Groundedness in provided context
Alignment to the task
Downstream approval and rejection rates
Cost per successful outcome
Human feedback
```

Evaluation informs routing.

A task type that fails quality on a cheap model may be routed to a more capable one.

Quality is measured, not assumed.

---

# 14. AI Layer in the Whole

```text
Growth Brain
    +
Agents
    +
AI Layer (Model Router + Providers + Guardrails)
    +
Tools
    +
Integrations
    =
AUREA Intelligence
```

The Growth Brain owns truth.

Agents own reasoning tasks.

The AI layer executes those tasks against models, safely and cost-aware.

Integrations execute in the world.

---

# 15. AI Architecture Principle

The AI layer makes AUREA think without letting AUREA confuse thinking with truth.

```text
Route to the right model.
Assemble context from truth.
Spend only what the task is worth.
Record every run.
Validate before trusting.
Never turn inference into fact by default.
```

The AI layer is powerful because it is disciplined.

It reasons over the Growth Brain's truth, and it always hands its conclusions back for validation rather than assuming them.
