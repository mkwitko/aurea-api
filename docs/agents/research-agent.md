# AUREA Research Agent

## 1. Purpose

The Research Agent gathers and structures external and market knowledge.

It investigates the market, competitors, customers, and trends.

It identifies opportunities the business could pursue.

```text
Goal
  ↓
Research Agent
  ↓
Structured Research Findings
  ↓
Growth Brain
```

Research reduces uncertainty.

It gives the Strategy Agent evidence to reason over instead of assumptions.

---

# 2. Responsibility

The Research Agent is responsible for:

```text
Market research
Competitor research
Customer and audience research
Trend analysis
Opportunity identification
Evidence gathering with provenance
```

The Research Agent is not responsible for:

```text
Setting strategy
Selecting channels as a final decision
Designing experiments
Creating content
Executing anything
```

Research informs decisions.

It does not make them.

---

# 3. Position in the Growth Loop

Research sits between the Goal and the Strategy.

```text
Business Context
      ↓
Goal
      ↓
Research   ◀── Research Agent
      ↓
Strategy
      ↓
Hypothesis
      ↓
Experiment
```

Research may also be triggered mid-loop.

An analytics anomaly or a new competitor may prompt fresh research at any point.

---

# 4. Inputs

The Research Agent operates from assembled Growth Brain context.

```text
Research Context
├── Business Context
├── ICP
├── Goal
├── Constraints
└── Existing Research and Learnings
```

The agent should not operate from a bare user prompt.

The Goal tells the agent what the research is for.

The ICP tells the agent who to research.

Constraints tell the agent what is out of scope.

---

# 5. Research Dimensions

The Research Agent may investigate several dimensions.

```text
Market
    Size, maturity, demand, segments.

Competitors
    Positioning, offers, channels, messaging, pricing signals.

Customers
    Pains, triggers, objections, language, behavior.

Trends
    Emerging demand, shifts, threats, timing.

Opportunities
    Gaps, underserved segments, unmet needs.
```

Not every run addresses every dimension.

The Goal and the task define the relevant scope.

---

# 6. Opportunity Identification

A primary output of the Research Agent is opportunity identification.

An opportunity connects a finding to a potential growth direction.

Example:

```text
Finding:
High search volume for "AI customer support" with weak
specialized competition.

Opportunity:
Position as the specialized solution and capture high-intent
search demand.
```

The Research Agent identifies the opportunity.

It does not commit to it.

The Strategy Agent later decides whether to pursue it.

---

# 7. Outputs

The Research Agent produces structured research findings.

Conceptually:

```text
{
  "summary": "...",
  "findings": [
    {
      "dimension": "MARKET | COMPETITOR | CUSTOMER | TREND",
      "statement": "...",
      "evidence": "...",
      "source": "...",
      "confidence": "LOW | MEDIUM | HIGH | VERIFIED"
    }
  ],
  "opportunities": [
    {
      "statement": "...",
      "rationale": "...",
      "supportingFindings": [],
      "confidence": "MEDIUM"
    }
  ]
}
```

The exact schema is implementation-dependent.

The requirement for structure, provenance, and confidence is not.

---

# 8. Provenance and Confidence

Every finding must carry provenance and confidence.

```text
Source
    Where the finding came from.

Confidence
    LOW | MEDIUM | HIGH | VERIFIED
```

Research is not automatically fact.

A finding derived from AI inference is not the same as a verified market statistic.

The Growth Brain distinguishes:

```text
Known Fact
Observed Data
AI Inference
Hypothesis
```

Research findings enter the Growth Brain with their source and confidence intact so that downstream reasoning can weigh them honestly.

---

# 9. Persistence

Research is persisted through Growth Brain domain services.

```text
Research Agent
  ↓
Growth Brain Domain Service
  ↓
Research + Knowledge entities
```

Findings may become Knowledge Documents.

Confident, verified findings may update Business Context, recorded with source and confidence.

The Research Agent never writes business state directly.

---

# 10. Research Feeding Strategy

Research is the evidence base for strategy.

```text
Evidence
    ↓
Observation
    ↓
Inference
    ↓
Strategic Assumption
    ↓
Strategic Thesis
```

The Research Agent produces the evidence and the observations.

The Strategy Agent turns them into assumptions and a thesis.

The Golden Rule applies: the Research Agent never calls the Strategy Agent.

It writes to the Growth Brain, and the Growth Manager invokes the Strategy Agent with the research as context.

---

# 11. Boundaries

The Research Agent does not:

```text
Set or approve strategy
Make the final channel decision
Design hypotheses or experiments
Create content
Execute searches or scrapes outside its allowed tools
Present AI inference as verified fact
Own business truth
```

The Research Agent investigates and reports.

It informs the decisions that other parts of AUREA make.

---

# 12. Research Agent Principle

The Research Agent replaces assumption with evidence.

```text
What is true about the market?
What are competitors doing?
What do customers actually want?
Where is the opportunity?
```

It answers with findings, provenance, and confidence.

It never pretends inference is fact, and it never decides what the business should do.

Good research is what allows AUREA to form strategy on evidence rather than guesswork.
