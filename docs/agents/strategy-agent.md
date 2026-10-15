# AUREA Strategy Agent

## 1. Purpose

The Strategy Agent turns evidence into strategic options.

It reasons over a Goal, an ICP, and research to propose how growth should be pursued.

It explains the mechanism, not a list of tasks.

```text
Goal + ICP + Research
        ↓
Strategy Agent
        ↓
Proposed Strategies
        ↓
Human Review
```

The Strategy Agent produces proposals.

Humans decide the strategic direction.

---

# 2. Responsibility

The Strategy Agent is responsible for:

```text
Analyzing the Goal, Business Context, ICP, and Research
Identifying strategic opportunities
Generating strategic options
Defining the growth mechanism
Selecting candidate channels
Stating assumptions and evidence
Identifying risks and trade-offs
Recommending a strategic direction
```

The Strategy Agent is not responsible for:

```text
Publishing content
Launching ads
Sending emails
Changing budgets
Modifying integrations
Approving its own strategies
```

Those are execution and approval responsibilities.

See `docs/domains/strategies.md`.

---

# 3. Position in the Growth Loop

The Strategy Agent sits between Research and Experiment.

```text
Goal
  ↓
Research
  ↓
Strategy   ◀── Strategy Agent
  ↓
Hypothesis
  ↓
Experiment
  ↓
Action
```

A strategy should be stable enough to guide multiple experiments.

The Strategy Agent produces that stable direction.

---

# 4. Alignment to Goal and ICP

Every strategy the agent produces must align to a Goal and an ICP.

```text
Goal
  ↓
Strategy (aligned)
  ↓
Target ICP
```

A strategy that does not support an active Goal is invalid.

A strategy without a defined target ICP is incomplete.

The agent must not produce a strategy that floats free of a Goal.

---

# 5. Inputs

The Strategy Agent operates from assembled Strategy Context.

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

The Strategy Agent should not operate only from a user prompt.

It reasons over structured Growth Brain context.

**Implementation, 2026-08-03.** Two tools carry this context: `get_growth_context`
(goal, ICPs, business context) and `get_learnings` (Historical Learnings). Until
this date only the first existed, so the agent proposed from the present alone
and the loop did not compound — `knowledge.md` §21's promise had no code behind
it. `get_learnings` returns **validated Learnings only**, with the measurement
behind each one: a candidate is an unconfirmed reading, and composing the next
strategy on top of it is how a misreading becomes permanent (CLAUDE.md §4,
human-in-the-loop). `propose-hypothesis` and `propose-experiment` read the same
tool, and all three are told not to propose again what a learning ruled out.

Still absent from the assembled context: Existing Strategies, Constraints and
Strategic Risks.

---

# 6. Strategy Is a Mechanism, Not a Task List

The Strategy Agent must explain how growth happens.

Bad output:

```text
Post on Instagram 3 times per week.
Run Google Ads.
Send email campaigns.
```

Good output:

```text
Position the business as the specialized solution for
high-intent B2B SaaS companies and capture demand through
search-driven acquisition, supported by educational content
that increases trust and conversion.
```

The mechanism explains why the approach can work.

The activities are generated later, downstream, by experiments and content.

---

# 7. Growth Mechanism

The Strategy Agent must name a primary growth mechanism.

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

A strategy may combine mechanisms.

The primary mechanism must be explicit.

---

# 8. Channel Selection

The Strategy Agent proposes candidate channels with reasoning.

It should consider:

```text
Where does the ICP spend time?
Where does the ICP search for solutions?
Where can the business reach the ICP?
What channels already perform?
What is the expected cost?
How measurable is the channel?
How quickly can results be obtained?
```

Channel selection is a proposal, not a launch.

The Strategy Agent recommends channels.

It never activates them.

---

# 9. Assumptions and Evidence

The Strategy Agent must state assumptions explicitly and separate them from evidence.

```text
Evidence
    Something supported by research or data.

Assumption
    Something believed but not yet proven.

Inference
    A conclusion drawn from evidence.

Hypothesis
    A testable statement derived from an assumption.
```

These are not interchangeable.

Each assumption should carry a confidence level:

```text
LOW
MEDIUM
HIGH
VERIFIED
```

Hidden assumptions make a strategy impossible to evaluate.

---

# 10. Risks and Trade-offs

Every meaningful strategy must identify risks.

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

The Strategy Agent should also express trade-offs when producing alternatives.

```text
Option A: Paid Demand Capture
    Impact: High | Cost: High | Speed: Fast | Confidence: Medium

Option B: Organic Demand Generation
    Impact: Medium | Cost: Low | Speed: Slow | Confidence: Medium
```

AUREA should explain trade-offs rather than present a single recommendation without context.

---

# 11. Structured Output Schema

The Strategy Agent produces structured output aligned with the Strategies domain (see `docs/domains/strategies.md`, section 43).

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

When producing alternatives, the agent returns multiple such proposals with comparative attributes.

The exact schema is implementation-dependent.

---

# 12. Proposed for Human Review

AI-generated strategies are always created as PROPOSED.

```text
Goal
  ↓
Research
  ↓
Strategy Agent
  ↓
Strategy Proposal (PROPOSED)
  ↓
Human Review
  ↓
APPROVED
  ↓
ACTIVE
```

A proposal must include its supporting context so a human can understand why AUREA recommends it.

A strategy does not become ACTIVE without explicit human approval.

The Strategy Agent never approves its own work.

Human review is not a yes/no on one option. A human may:

```text
Adopt one option
Combine two or three options into a single Strategy
Edit any field of the plan before it exists — including its hypotheses
```

A combined Strategy records every option that went into it, so the proposal it
came from stays auditable. An option that has already gone into a Strategy —
alone or combined — cannot be adopted again.

Editing before adoption does not make the plan less traceable: the Strategy still
records the run that proposed it. It makes the plan the human's, which is what
review means.

---

# 13. Persistence

Strategies are persisted through Growth Brain domain services.

```text
Strategy Agent
  ↓
Growth Brain Domain Service
  ↓
Strategy (status: PROPOSED)
```

The domain service enforces the lifecycle, the Goal reference invariant, and versioning.

The Strategy Agent never writes strategy state directly.

Rejected alternatives may be preserved where useful.

---

# 14. Boundaries

The Strategy Agent does not:

```text
Publish or launch anything
Spend money or change budgets
Send messages
Design experiments in detail (that is the Experiment Agent)
Approve or activate strategies
Call other agents directly
Own business truth
```

The Strategy Agent reasons and proposes.

Experiments, content, and execution happen downstream.

---

# 15. Strategy Agent Principle

The Strategy Agent exists to stop AUREA from becoming a task generator.

```text
User: I want to grow.

Wrong: Here are 30 social posts.

Right:
  What outcome? → Goal
  For whom?     → ICP
  What do we know? → Research
  What approach?  → Strategy
  What must be true? → Assumptions
```

The Strategy Agent produces a coherent, evidence-based, testable direction and hands it to humans to approve.

It is the strategic intelligence that separates AUREA from marketing automation.
