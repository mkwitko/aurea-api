# AUREA Growth Loop

This phase closes the complete growth loop.

Outcomes become Learning candidates.

Learning candidates are validated.

Validated Learning becomes Knowledge.

Knowledge updates the Business Context.

Improved context produces better Strategy.

This is AUREA's core differentiator.

AUREA does not just execute and measure.

AUREA learns and improves.

---

# 1. Objective

Enable AUREA to convert measured Outcomes into validated Learning, feed that Learning into the Knowledge base and Business Context, and use it to improve future Strategy and Research.

The objective is to prove that the system improves its recommendations over time based on real results.

```text
Outcome
   ↓
Learning Candidate
   ↓
Validation
   ↓
Validated Learning
   ↓
Knowledge
   ↓
Updated Business Context
   ↓
Better Strategy / Research
   ↓
Better Experiments
   ↓
Outcome
```

The loop repeats.

Each iteration should improve the quality of decisions.

---

# 2. Scope

## 2.1 Learning Generation

Outcomes and completed Experiments are analyzed to produce Learning candidates.

A Learning candidate is a proposed insight derived from evidence.

Use the Learning entity defined in `persistance-model.md`.

```text
Learning
├── experimentId
├── title
├── statement
├── evidence
├── confidence
└── status: CANDIDATE
```

A candidate must reference the evidence that produced it.

```text
Outcomes
Experiment results
Hypothesis result
Research
```

Learning generation is triggered by `OutcomeRecorded` and `ExperimentCompleted` events.

## 2.2 Learning Lifecycle

Learning follows an explicit lifecycle.

```text
CANDIDATE
   ↓
VALIDATED
   ↓ (or)
REJECTED
   ↓
ARCHIVED
```

The transitions map to the events in `event-architecture.md`.

```text
LearningCreated
LearningValidated
```

Rejected candidates are retained for audit and analysis.

They are not silently deleted.

## 2.3 Validation

A candidate must be validated before it becomes Knowledge.

Validation confirms:

```text
The evidence supports the statement.
The confidence level is justified.
The sample or measurement period is sufficient.
The insight is not contradicted by existing Knowledge.
```

Validation may be performed by a human or, later, within autonomy constraints.

In this phase, consequential validation requires human confirmation.

A validated Learning must have supporting evidence.

## 2.4 Knowledge Integration

Validated Learning is promoted into the Knowledge base.

Use the KnowledgeDocument entity defined in `persistance-model.md`.

```text
Validated Learning
        ↓
KnowledgeDocument (sourceType: GENERATED)
        ↓
KnowledgeChunk (retrievable)
```

Knowledge is retrievable by agents during future reasoning.

Provenance is preserved.

```text
Which Experiment produced it
Which Outcomes support it
When it was validated
```

## 2.5 Business Context Update

Validated Learning may update the Business Context.

Business Context uses versioned records per `persistance-model.md`.

```text
Learning validated
        ↓
Proposed BusinessContextVersion
        ↓
source: AI
confidence: derived from Learning
        ↓
Human review (consequential updates)
        ↓
New current version
```

The previous version is superseded, not overwritten.

Context history remains traceable.

## 2.6 Feedback into Strategy and Research

Updated context and Knowledge feed the next loop iteration.

```text
Updated Business Context + Knowledge
        ↓
Strategy Agent (Phase 05)
Research Agent (Phase 04)
        ↓
Improved Strategy
Improved Research direction
        ↓
New Hypotheses and Experiments
```

Agents must consume the latest validated Knowledge.

The Strategy Agent should reference relevant Learning when proposing strategies.

Recommendations should be able to cite the Learning that informed them.

## 2.7 Decisions

Significant loop transitions are recorded as Decisions.

Use the Decision entity defined in `persistance-model.md`.

```text
Decision
├── type (e.g. VALIDATE_LEARNING, UPDATE_CONTEXT, ADJUST_STRATEGY)
├── description
├── rationale
├── actorType
└── evidence (Outcomes, Learning, Research)
```

Decisions preserve the evidence used to reach them.

This satisfies the auditable-decisions principle.

## 2.8 Events

Emit events defined in `event-architecture.md`.

```text
OutcomeRecorded
LearningCreated
LearningValidated
DecisionCreated
BusinessContextUpdated
StrategyUpdated
RecommendationCreated
```

Events carry correlation IDs so a full loop iteration can be traced end to end.

---

# 3. Dependencies

```text
Phase 04 — Research (consumes updated context)
Phase 05 — Strategy (consumes validated Learning)
Phase 06 — Experimentation (source of results)
Phase 09 — Analytics (source of Outcomes and experiment results)
```

Shared platform capabilities.

```text
Learning, Knowledge, Decision, BusinessContextVersion entities
Event Bus (Redis + BullMQ)
Model Router
Knowledge retrieval / vector storage
```

Recorded Outcomes and completed Experiments are required inputs.

---

# 4. Deliverables

```text
Learning candidate generation from Outcomes and Experiments
Learning lifecycle (CANDIDATE → VALIDATED / REJECTED → ARCHIVED)
Learning validation workflow with evidence checks
Promotion of validated Learning into Knowledge
Knowledge document and chunk creation with provenance
Business Context update proposals as new versions
Human review for consequential context updates
Feedback of Knowledge into Strategy and Research agents
Learning citation in recommendations
Decision records for loop transitions
Growth loop events with end-to-end correlation
API endpoints for learning, validation, and knowledge
Frontend views for Learning review and loop tracing
```

---

# 5. Out of Scope

```text
Autonomous validation without human confirmation
Autonomous context updates without review
Paid growth optimization (Phase 11)
Autopilot decisions and guardrails (Phase 11)
Production scaling and compliance (Phase 12)
```

Autonomy expansion happens after the loop is proven with a human in control.

---

# 6. Exit Criteria

```text
Outcomes and completed Experiments generate Learning candidates with evidence.
Learning follows the full lifecycle with validation and rejection recorded.
Validated Learning is promoted into the Knowledge base with preserved provenance.
Validated Learning can update the Business Context as a new version.
Previous context versions are superseded, not overwritten.
The Strategy and Research agents consume the latest validated Knowledge.
Recommendations can cite the Learning that informed them.
Loop transitions are recorded as auditable Decisions with evidence.
A complete loop iteration can be traced end to end via correlation IDs.
The system demonstrably improves at least one recommendation based on real results.
```
