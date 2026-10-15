# AUREA MVP Definition

## 1. Purpose

This document defines the smallest version of AUREA worth building.

It is deliberately narrower than engineering Phases 00–12 (see `[[phases]]`).

The goal of the MVP is not to build the platform.

The goal is to prove one claim with real customers:

```text
AUREA can take a business from a growth goal
to a measured outcome and a validated learning
that the customer trusts and would pay for.
```

Everything not required to prove that claim is cut.

---

# 2. The One Thing to Prove

```text
A wedge customer (see [[../product/personas]])
sets a goal,
receives a strategy and an experiment worth running,
runs it,
sees a measured outcome,
and gets a learning that improves the next decision.
```

If AUREA cannot do this for 10 real customers, no amount of features matters.

If it can, the moat (`[[../product/moat]]`) has its first data.

---

# 3. The MVP Loop

The MVP proves ONE pass of the growth loop, mostly in Copilot mode.

```text
Business Context   (guided, research-assisted)
      ↓
ICP                (proposed by AUREA, edited by user)
      ↓
Goal               (one measurable goal)
      ↓
Research           (segment + market, produces evidence)
      ↓
Strategy           (2–3 options, human picks one)
      ↓
Hypothesis         (from the chosen strategy)
      ↓
Experiment         (designed, with success criteria)
      ↓
[ human runs it in the real world ]
      ↓
Outcome            (entered by user or pulled from analytics)
      ↓
Learning           (AUREA concludes; human validates)
      ↓
Better next Strategy / Experiment
```

Execution is human-in-the-loop.

AUREA does the thinking; the customer does the doing.

---

# 4. In Scope

```text
Auth + one Organization + one Workspace per customer.
Business context capture (assisted by research).
One ICP.
One active Goal.
Research Agent (web search + summarization → evidence with provenance).
Strategy Agent (2–3 proposed options with trade-offs).
Hypothesis + Experiment creation with success criteria.
Manual Outcome entry (+ optional GA4 or PostHog read).
Analytics Agent (lite): interpret the outcome, propose a learning candidate.
Learning capture + human validation.
Growth Manager orchestration of the above.
AgentRun recording (model, tokens, cost) from day one.
Model Router with cost-aware selection.
Basic dashboard: the loop state and history.
```

---

# 5. Ruthlessly Out of Scope (for MVP)

```text
Autonomous execution of any kind (Operator/Autopilot).
Content generation + publishing (Content Agent, Postiz, social).
Paid ads integrations (Meta/Google/TikTok).
CRM + email integrations.
n8n workflows.
Multiple workspaces / businesses per org.
Goal hierarchies.
Multiple ICPs per strategy.
Vector DB / RAG at scale (use simple retrieval; defer embeddings infra).
Cross-account benchmarks (needs a data base first).
Billing/subscriptions (design pricing, charge manually early — see [[../product/business-model]]).
Full event bus (in-memory events are fine; defer Redis/BullMQ scale-out).
```

Cut lines are decisions, not omissions.

Anything here returns via the phase roadmap once the loop is proven.

---

# 6. Minimal Data Model

Only these entities are required for the MVP (subset of `[[../architecture/persistance-model]]`):

```text
Organization
Workspace
User
Membership

Business
BusinessContext (+ Version)
ICP

Goal
Strategy (+ version)
Hypothesis
Experiment
Outcome
Learning

AgentRun
```

Deferred: Action, Approval, Decision, KnowledgeChunk embeddings, ExternalReference, AuditLog (add a light audit as needed).

---

# 7. Minimal Integrations

```text
Required:
  One LLM provider via the Model Router.
  Web search / fetch for the Research Agent.

Optional (nice, not blocking):
  GA4 or PostHog read-only, to pull one outcome metric.

Everything else: none.
```

Outcomes can be entered manually in the MVP.

The loop must not depend on integration breadth.

---

# 8. Build Sequence

Compress the engineering phases into the shortest path to the loop.

```text
Step 1  Foundation + monorepo         (phase-00, phase-01)
Step 2  Identity + one workspace      (phase-02, minimal)
Step 3  Growth Brain core entities    (phase-03, MVP subset from §6)
Step 4  Research Agent                (phase-04, web search only)
Step 5  Strategy Agent + review UI    (phase-05)
Step 6  Experiment + Outcome + Learning (phase-06 + lite analytics)
Step 7  Dashboard + onboarding for activation
```

Ship Step 7 to 5–10 design-partner customers from the wedge.

---

# 9. Activation Target

The MVP succeeds at the product level when a new customer reaches activation fast.

```text
Activation = one full MVP loop completed
             (goal → strategy → experiment → outcome → learning)
Target:      within the first 7 days.
```

See `[[../product/metrics]]` §5.

---

# 10. MVP Success Criteria

The MVP is validated when, across design-partner customers:

```text
They complete the loop without hand-holding.
They rate the strategy and experiment as "worth running".
They run the experiment in the real world.
They return to record the outcome.
They agree the learning is useful.
Enough of them say they would pay (see [[../product/business-model]]).
```

Failure signals to watch:

```text
Strategies feel generic → intelligence not yet real.
Nobody runs the experiment → recommendations not trusted or too hard.
Nobody returns with an outcome → loop too slow or low value.
```

---

# 11. MVP Principle

```text
Build the smallest thing that proves AUREA makes
one real growth decision better,
for one kind of customer,
and produces one learning that compounds.

Prove the loop before scaling the system.
```

The complete autonomous platform is the destination.

The MVP is the proof that the destination is worth building.
