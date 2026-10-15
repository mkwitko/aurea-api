# AUREA Content Agent

## 1. Purpose

The Content Agent produces the words and creative that a strategy needs.

It develops content strategy, content briefs, copy, CTAs, and campaign assets.

Everything it produces is adapted to a channel, an ICP, and a strategy.

```text
Strategy + Experiment + ICP + Channel
              ↓
Content Agent
              ↓
Drafts and Proposed Actions
              ↓
Human Review → Integration Layer
```

The Content Agent produces drafts.

It never publishes.

---

# 2. Responsibility

The Content Agent is responsible for:

```text
Content strategy
Content briefs
Content generation
Calls to action (CTAs)
Campaign copy
Channel-appropriate adaptation
```

The Content Agent is not responsible for:

```text
Setting growth strategy
Selecting channels as a decision
Publishing content
Scheduling to external platforms
Managing ad campaigns
Approving its own drafts
```

It creates.

The integration layer distributes.

---

# 3. Position in the Growth Loop

The Content Agent operates downstream of Strategy and Experiment.

```text
Strategy
  ↓
Hypothesis
  ↓
Experiment
  ↓
Content   ◀── Content Agent
  ↓
Action (proposed)
  ↓
Execution (integrations)
```

Content is an input to Actions.

An Action carries the content to the channel.

---

# 4. Inputs

The Content Agent operates from assembled context.

```text
Content Context
├── Strategy
├── Experiment
├── ICP
├── Channel
├── Brand and voice constraints
└── Relevant Learnings
```

The strategy tells the agent the mechanism and message.

The ICP tells the agent who it is speaking to.

The channel tells the agent the format and constraints.

The Content Agent should not generate content from a bare prompt without this context.

---

# 5. Adaptation to Channel, ICP, and Strategy

Content must fit three things at once.

```text
Channel
    Format, length, tone, medium constraints.

ICP
    Language, pains, triggers, objections.

Strategy
    The mechanism and message being tested.
```

The same idea produces different content per channel.

```text
Strategy message
      ↓
├── LinkedIn post      (professional, longer)
├── Instagram caption  (visual, concise)
├── Email              (personal, sequenced)
└── Landing page copy  (conversion-focused)
```

Content that ignores channel, ICP, or strategy is misaligned.

---

# 6. Content Briefs

Before generating content, the Content Agent may produce a brief.

A brief defines the intent before the words.

```text
Content Brief
├── Objective
├── Target ICP
├── Channel
├── Key message
├── Primary CTA
├── Tone and voice
├── Constraints
└── Related Experiment
```

The brief connects the content to the strategy and experiment it serves.

It makes the content reviewable before it is written.

---

# 7. Outputs

The Content Agent produces structured output.

Conceptually:

```text
{
  "brief": { "objective": "...", "channel": "...", "icp": "..." },
  "assets": [
    {
      "type": "POST | EMAIL | AD_COPY | LANDING_COPY | CTA",
      "channel": "...",
      "content": "...",
      "cta": "...",
      "variants": []
    }
  ],
  "proposedActions": [
    {
      "type": "PUBLISH_POST | SEND_EMAIL | CREATE_AD",
      "payload": {},
      "requiresApproval": true
    }
  ]
}
```

The content is a draft.

Any distribution is expressed as a proposed Action, not an executed one.

The exact schema is implementation-dependent.

---

# 8. Drafts and Proposed Actions

The Content Agent produces two kinds of output.

```text
Draft
    The creative asset itself. Reviewable and editable.

Proposed Action
    A request to distribute the asset through a channel.
```

A proposed Action enters the Action lifecycle at PROPOSED.

```text
PROPOSED
PENDING_APPROVAL
APPROVED
EXECUTING
EXECUTED
```

Publishing content is a consequential action.

It requires approval before execution.

---

# 9. Approval Before Publishing

Content is not published on the agent's authority.

```text
Content Agent
  ↓ (draft + proposed Action)
Growth Brain
  ↓
Human Review / Autonomy Policy
  ↓ (if approved)
Integration Layer
  ↓
Channel
```

Under Copilot autonomy, the human publishes.

Under Operator autonomy, the human approves and the system publishes.

Under Autopilot, publishing may proceed within explicit constraints.

The default is human approval before publishing.

---

# 10. The Integration Layer Executes

The Content Agent never touches an external platform.

```text
Content Agent
    produces the post

Postiz / platform integration
    publishes the post
```

Scheduling, publishing, and ad creation are integration responsibilities.

This keeps content generation provider-agnostic and keeps every publish action auditable through the Action and integration records.

---

# 11. Persistence

Content and proposed Actions are persisted through Growth Brain domain services.

```text
Content Agent
  ↓
Growth Brain Domain Service
  ↓
Content assets + Action (status: PROPOSED)
```

The domain service enforces the Action lifecycle and approval requirements.

The Content Agent never writes an EXECUTED action and never bypasses approval.

---

# 12. Boundaries

The Content Agent does not:

```text
Set growth strategy
Decide channels as a final decision
Publish or schedule content directly
Send emails or launch ads directly
Approve its own content
Call other agents directly
Own business truth
```

The Content Agent writes and proposes.

Distribution belongs to the integration layer, after approval.

---

# 13. Content Agent Principle

The Content Agent gives the strategy a voice.

```text
What are we saying?
To whom?
On which channel?
Toward which experiment?
With what call to action?
```

It produces drafts and proposes their distribution, then waits for approval.

It never publishes on its own, because in AUREA the reasoning that creates content and the execution that distributes it are deliberately kept apart.
