# AUREA Content Agent

This phase introduces the Content Agent.

AUREA begins to turn strategies and experiments into concrete content proposals.

Content is generated, structured, and proposed as Actions.

Content is not yet published to any external channel.

Publishing execution is delivered in Phase 08.

This phase remains inside the Copilot autonomy level.

The system proposes.

The human approves.

---

# 1. Objective

Enable AUREA to translate growth strategies and experiments into content strategy, content briefs, and generated content drafts.

Every generated draft becomes a proposed Action that a human can review, edit, approve, or reject.

The objective is to prove that AUREA can produce useful, on-context, experiment-linked content while keeping a human in control of every consequential output.

```text
Strategy / Experiment
        ↓
Content Strategy
        ↓
Content Brief
        ↓
Content Generation
        ↓
Proposed Action (draft)
        ↓
Approval Workflow
        ↓
Approved Draft (ready for Phase 08)
```

---

# 2. Scope

## 2.1 Content Agent

A new agent defined under `docs/agents/` responsible for content reasoning.

The Content Agent consumes context from the Growth Brain.

It reads Business Context, ICP, Goal, Strategy, Hypothesis, and Experiment.

It does not own business truth.

It analyzes, generates, and proposes.

Every execution is recorded as an AgentRun with associated AgentToolCall records.

## 2.2 Content Strategy

A structured plan describing what content should be produced for a Strategy or Experiment.

A content strategy defines:

```text
Themes
Angles
Formats
Channels
Tone of voice
Target ICP
Supporting Goal
Supporting Experiment
```

The content strategy is derived from the active Strategy.

It is stored as structured data linked to the originating Strategy.

## 2.3 Content Brief

A brief is the concrete instruction for a single content piece.

A brief defines:

```text
Objective
Target ICP
Channel intent
Format
Key message
Call to action
Constraints
Reference material
Associated Experiment
```

Briefs are the bridge between strategy and generation.

A brief must reference the Experiment or Strategy it supports.

## 2.4 Content Generation

The Content Agent generates content drafts from a brief.

Generation uses the Model Router.

Simple drafts should use lower-cost models.

Complex or high-value drafts may use more capable models.

Each draft preserves:

```text
The brief used
The model and provider
The generation input context summary
The generated variants
```

Multiple variants may be generated for a single brief.

## 2.5 Drafts as Proposed Actions

Each accepted draft is persisted as an Action.

The Action uses the entities defined in `persistance-model.md`.

The Action is created with:

```text
type: CONTENT_DRAFT
status: PROPOSED
requiresApproval: true
riskLevel: LOW or MEDIUM
```

The Action links to `goalId`, `strategyId`, and `experimentId` where available.

The draft content is stored in the Action `payload` as structured JSON.

Example payload:

```json
{
  "briefId": "brief-123",
  "channelIntent": "instagram",
  "format": "single_image_caption",
  "body": "Draft caption text",
  "assets": [],
  "callToAction": "Learn more",
  "variantOf": null
}
```

No provider-specific publishing fields are added in this phase.

## 2.6 Approval Workflow

Content drafts require explicit human authorization.

The workflow uses the Approval entity defined in `persistance-model.md`.

```text
Draft generated
        ↓
Action (PROPOSED)
        ↓
Approval requested (PENDING)
        ↓
Human review
        ↓
APPROVED or REJECTED
        ↓
Action status updated
```

An approving human may:

```text
Approve
Reject with comment
Request regeneration
Edit before approval
```

An approved content Action is marked ready for distribution.

It is not executed in this phase.

## 2.7 Events

This phase emits events defined in `event-architecture.md`.

```text
AgentRunStarted
AgentRunCompleted
RecommendationCreated
ActionProposed
ActionApproved
ActionRejected
```

`ActionApproved` for a content draft signals readiness for Phase 08.

Events carry a `correlationId` linking back to the originating Strategy or Experiment workflow.

---

# 3. Dependencies

This phase depends on prior phases.

```text
Phase 03 — Growth Brain (Strategy, Experiment, Action entities)
Phase 05 — Strategy (source of content direction)
Phase 06 — Experimentation (experiment linkage)
```

It also depends on shared platform capabilities.

```text
Model Router
Event Bus (Redis + BullMQ)
Approval entity
AgentRun and AgentToolCall persistence
Object storage for generated assets
```

The Growth Brain must expose readable Strategy and Experiment context.

---

# 4. Deliverables

```text
Content Agent definition and runtime integration
Content Strategy data model and generation
Content Brief data model and generation
Content generation pipeline via Model Router
Draft-to-Action mapping (type CONTENT_DRAFT)
Multi-variant draft support
Approval workflow for content Actions
Draft editing before approval
Content events emitted to the Event Bus
API endpoints for briefs, drafts, and approvals
Frontend views for review, edit, and approval
AgentRun cost and token tracking for content generation
```

---

# 5. Out of Scope

```text
Publishing to social channels
Scheduling posts
Fetching post metrics
Postiz or platform connector execution
Paid advertising content
Email content execution
Autonomous approval
Outcome recording
```

Distribution execution begins in Phase 08.

Measurement begins in Phase 09.

---

# 6. Exit Criteria

```text
The Content Agent can generate a content strategy from an active Strategy.
The Content Agent can generate briefs linked to an Experiment.
The Content Agent can generate one or more drafts per brief.
Each draft is persisted as an Action with type CONTENT_DRAFT and status PROPOSED.
Every draft requires approval before it is considered ready.
A human can approve, reject, edit, or request regeneration.
Approved content Actions are marked ready for distribution.
All content generation is recorded as an AgentRun with cost tracking.
Content events are published to the Event Bus with correlation IDs.
No content is published to any external channel in this phase.
```
