# AUREA Analytics Agent

## 1. Purpose

The Analytics Agent reads results and explains what happened.

It reasons over outcomes and metrics to produce insights, detect anomalies, and recommend next steps.

It feeds the learning loop with candidate learnings.

```text
Outcomes + Metrics
        ↓
Analytics Agent
        ↓
Insights, Anomalies, Recommendations, Learning Candidates
        ↓
Growth Brain
```

The Analytics Agent closes the loop between execution and learning.

It recommends.

It does not decide autonomously.

---

# 2. Responsibility

The Analytics Agent is responsible for:

```text
Reading outcomes and metrics
Interpreting dashboards
Producing insights
Detecting anomalies
Recommending next actions
Proposing learning candidates
```

The Analytics Agent is not responsible for:

```text
Deciding strategy on its own
Executing actions
Changing budgets
Validating learning without human or evidence review
Owning the metric data itself
```

It reads and interprets.

It does not act.

---

# 3. Position in the Growth Loop

The Analytics Agent operates after execution.

```text
Experiment
  ↓
Action
  ↓
Execution
  ↓
Outcome   ◀── collected via integrations
  ↓
Analytics Agent
  ↓
Learning Candidate
  ↓
Updated Context
```

Its output frequently re-enters the loop as a new experiment, a strategy adaptation, or validated learning.

---

# 4. Inputs

The Analytics Agent operates from assembled context.

```text
Analytics Context
├── Outcomes
├── Experiments
├── Goals and target metrics
├── Strategy (for interpretation)
└── External analytics (GA4, PostHog, platform data)
```

Raw metric data is collected by integrations and recorded as Outcomes in the Growth Brain.

The Analytics Agent reads that structured data.

It does not own or replace the analytics platforms themselves.

---

# 5. Insights

An insight is an interpretation of observed data.

Example:

```text
Insight:
Messaging focused on operational cost reduction generated
32% more qualified leads than revenue-growth messaging for
SaaS founders.
```

An insight connects a metric movement to a plausible explanation.

An insight is not yet validated learning.

It carries a confidence level and its supporting evidence.

---

# 6. Anomaly Detection

The Analytics Agent watches for anomalies.

Examples:

```text
A sudden drop in conversion rate.
A spike in CAC.
A channel underperforming its baseline.
An experiment beating its target early.
```

An anomaly is a signal, not a conclusion.

An anomaly may trigger:

```text
A recommendation
A new experiment
Fresh research
A strategy review
```

The Analytics Agent surfaces the anomaly and its evidence.

The Growth Manager decides what to invoke next.

---

# 7. Recommendations

The Analytics Agent produces recommendations, not decisions.

Example:

```text
Recommendation:
Increase investment in high-intent search, where CAC is
40% below the paid social channel, and pause the
underperforming display experiment.
```

A recommendation must reference the evidence behind it.

The recommendation is routed for human review or an explicit autonomy policy.

The Analytics Agent never executes the recommendation itself.

---

# 8. Learning Candidates

The Analytics Agent feeds the learning loop.

```text
Observed Outcome
      ↓
Analysis
      ↓
Learning Candidate   ◀── Analytics Agent
      ↓
Validation
      ↓
Knowledge
      ↓
Future Context
```

A learning candidate is proposed, not confirmed.

```text
Learning Lifecycle
CANDIDATE   ◀── Analytics Agent proposes here
VALIDATED
REJECTED
ARCHIVED
```

Not every insight should become validated learning.

Validated learning must have supporting evidence and a validation step.

---

# 9. Distinguishing Failure Types

When an experiment underperforms, the Analytics Agent must distinguish causes.

```text
Strategy Failure
Channel Failure
Execution Failure
Experiment Failure
Measurement Failure
```

A single failed experiment does not prove the strategy failed.

The Analytics Agent should not collapse these into a generic "it did not work."

Precise attribution is what lets AUREA adapt intelligently rather than discard good strategies.

---

# 10. Outputs

The Analytics Agent produces structured output.

Conceptually:

```text
{
  "insights": [
    { "statement": "...", "evidence": "...", "confidence": "MEDIUM" }
  ],
  "anomalies": [
    { "metric": "...", "observed": "...", "expected": "...", "severity": "..." }
  ],
  "recommendations": [
    { "action": "...", "rationale": "...", "evidence": [] }
  ],
  "learningCandidates": [
    { "statement": "...", "evidence": "...", "confidence": "MEDIUM",
      "relatedExperiment": "..." }
  ]
}
```

The exact schema is implementation-dependent.

Each element carries evidence and confidence.

---

# 11. Persistence

Analytics output is persisted through Growth Brain domain services.

```text
Analytics Agent
  ↓
Growth Brain Domain Service
  ↓
Insights, Learning Candidates, Recommendations
```

Learning candidates are stored with status CANDIDATE.

The Analytics Agent never marks its own learning VALIDATED and never mutates Outcomes.

---

# 12. Boundaries

The Analytics Agent does not:

```text
Decide autonomously
Execute actions
Change budgets or launch campaigns
Validate its own learning candidates
Own or overwrite metric data
Call other agents directly
```

The Analytics Agent interprets and recommends.

It hands its conclusions to humans and to the Growth Manager.

---

# 13. Analytics Agent Principle

The Analytics Agent answers what happened and what it might mean.

```text
What did the metrics do?
Why, most plausibly?
What is anomalous?
What should we consider next?
What have we possibly learned?
```

It answers with insights, evidence, and confidence.

It never confuses a recommendation with a decision, or a candidate with validated learning.

The Analytics Agent is how AUREA turns outcomes into knowledge without pretending interpretation is certainty.

---

# 14. Shipped slice: `interpret-outcome` (lite)

Sections 1-13 describe the Analytics Agent's full intended shape. What actually shipped
(`docs/superpowers/specs/2026-07-30-analytics-agent-lite-design.md`) is one narrow slice
of it, registered as `taskType: interpret-outcome`, `agentType: outcome-analyst`
(`src/ai/agents/interpret-outcome.ts`) — TIER2, 2 credits, one tool
(`get_experiment_result`, workspace-scoped, experiment id taken from the run's own
input, never from the model's tool arguments or the request body).

**What it does.** Given a completed experiment with at least one recorded outcome, it
reads the metric, baseline, target, success criteria, hypothesis, strategy and every
outcome back to the founder, and drafts one learning candidate. It refuses at run
creation (before any credit is charged) if the experiment is not `COMPLETED` or has no
outcomes.

**Output contract:**

```ts
{
  reading:  string,   // what the numbers show vs baseline and target
  drivers:  string[], // 1-3 plausible explanations
  caveats:  string[], // 0-3 reasons to distrust the signal
  learning: {
    title: string, statement: string,
    evidence: string[],           // must cite numbers/dates the tool actually returned
    confidence: 'LOW'|'MEDIUM'|'HIGH', // no VERIFIED — one experiment verifies nothing
  },
}
```

**The no-verdict rule.** Per `docs/domains/experiments.md` §14, completing an experiment
must not imply success anywhere in the system. The agent may describe and explain; it
may never rule. This is enforced two ways, not one:

- **Structurally** — the schema has no verdict field, no `met` boolean, no score, and
  is `.strict()` at both the top level and inside `learning`, so an invented key (e.g.
  `verdict`, `met`) fails validation instead of passing through silently.
- **In prose** — because `reading`, `drivers`, `caveats` and `learning.title`/
  `statement` are free strings rendered and persisted verbatim, a `superRefine` rejects
  any of them that contain a verdict word ("success", "failed", "worked", …). Added on
  final review once it was clear the structural checks alone do not see prose.

A separate runtime check (`verifyEvidence`) cross-references every number or date in
`learning.evidence` against what `get_experiment_result` actually returned that run,
refusing a citation the tool never produced.

Both checks run inside the runner's guardrail retry loop: a first offence is fed back to
the model as corrective feedback and can self-correct within the run's budget, rather
than failing outright.

Accepting the draft (`POST /learnings/from-run`) creates one `Learning` with
`status: CANDIDATE` and `sourceAgentRunId` set — provenance, and an idempotency key that
makes a second accept of the same run a 400, never a duplicate row. Validating,
rejecting or replacing the candidate stays a separate, human act; the agent never marks
its own output validated.
