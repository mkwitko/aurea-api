# AUREA Guardrails Domain

## 1. Purpose

The Guardrails domain defines the rules that constrain what AUREA is allowed to do, especially as it gains autonomy.

AUREA progresses from Copilot to Operator to Autopilot (see `[[../product/roadmap]]`).

Every step increases the power AUREA has over a customer's money, brand, and customers.

Guardrails are what make that power safe.

Without guardrails, autonomy is a liability, not a feature.

---

# 2. Domain Responsibility

The Guardrails domain is responsible for:

```text
Classifying actions by risk.
Deciding when human approval is required.
Enforcing spend, rate, and scope limits.
Providing a kill switch.
Recording why an action was allowed or blocked.
```

The Guardrails domain is NOT responsible for:

```text
Deciding strategy (that is the Strategy domain).
Executing actions (that is the Integration layer).
Owning business truth (that is the Growth Brain).
```

Guardrails sit between a proposed action and its execution.

```text
Agent proposes Action
        ↓
Guardrail evaluation
        ↓
Allow  /  Require Approval  /  Block
        ↓
Execution (if permitted)
```

---

# 3. Risk Classification

Every action carries a risk level.

```text
LOW
  Reversible, no external cost, no brand exposure.
  Example: draft a strategy, generate an internal report.

MEDIUM
  External visibility or minor cost, reversible with effort.
  Example: publish an organic social post.

HIGH
  Spends money, contacts customers, or is hard to reverse.
  Example: launch a paid campaign, change a budget, email a list.
```

Risk level drives the approval requirement.

See Action.riskLevel in `[[../architecture/persistance-model]]`.

---

# 4. Approval Policy

Approval requirements depend on risk level and the workspace's autonomy setting.

```text
                 Copilot        Operator          Autopilot
LOW              auto            auto              auto
MEDIUM           approve         approve           auto within limits
HIGH             approve         approve           approve or hard limit
```

The default is conservative.

A workspace opts into higher autonomy explicitly, per action type.

Autonomy is granted, never assumed.

---

# 5. Autonomy Is Earned

A workspace's autonomy level should increase based on demonstrated trust.

```text
Track record of safe, approved actions
        ↓
Customer grants more autonomy for specific action types
        ↓
AUREA operates within tighter, explicit limits
        ↓
Guardrails still enforce hard ceilings
```

Trust is per action type, not global.

A customer may auto-approve social posts while still approving every budget change.

---

# 6. Limits

Autonomous actions operate inside hard limits the customer sets.

```text
Spend limits
  Max daily / monthly spend per channel and total.
  Max single-action spend.

Rate limits
  Max posts / emails / changes per period.

Scope limits
  Which channels, accounts, audiences, and budgets AUREA may touch.

Time limits
  Windows in which autonomous action is permitted.
```

A proposed action that exceeds a limit is downgraded to require approval or blocked.

The system fails closed.

---

# 7. Brand and Content Safety

Actions that speak in the customer's name carry brand risk.

```text
Content is checked against:
  brand rules and tone,
  prohibited topics / claims,
  compliance constraints,
  factual grounding (no invented claims about the product).

Sensitive content escalates to human approval regardless of autonomy level.
```

AI inference is not fact (see `[[../architecture/ai-architecture]]`); customer-facing claims must be grounded.

---

# 8. The Kill Switch

Every customer must be able to stop AUREA instantly.

```text
Pause all autonomous action for a workspace.
Pause a specific channel or action type.
Cancel in-flight proposed actions.
```

The kill switch is a first-class product feature, always one click away.

Its existence is part of why customers trust AUREA with autonomy.

---

# 9. Approval Workflow

```text
Action proposed (by agent or system)
        ↓
Guardrail evaluation → requires approval
        ↓
Approval request created (Approval entity)
        ↓
Authorized human reviews with full context and rationale
        ↓
Approve  /  Reject  /  Modify
        ↓
Execution or cancellation
        ↓
Audit record
```

Approvals are part of the audit trail (see `[[../architecture/security-architecture]]`).

The reviewer sees why AUREA proposed the action, not just what.

---

# 10. Explainability

For any action, AUREA must be able to answer:

```text
What did you do or propose?
Why? (goal → strategy → hypothesis → experiment → action)
What did you expect?
What limits applied?
Who approved it?
What happened?
```

Explainability is required for trust, debugging, and compliance.

An action AUREA cannot explain should not execute.

---

# 11. Data Model

Conceptually:

```text
GuardrailPolicy
├── id
├── workspaceId
├── actionType
├── autonomyLevel        (COPILOT / OPERATOR / AUTOPILOT)
├── requiresApproval     (by risk level)
├── limits               (spend / rate / scope / time)
├── createdAt
└── updatedAt

GuardrailEvaluation
├── id
├── workspaceId
├── actionId
├── riskLevel
├── decision             (ALLOW / REQUIRE_APPROVAL / BLOCK)
├── reason
├── appliedLimits
├── evaluatedAt
```

These relate to Action and Approval in `[[../architecture/persistance-model]]`.

---

# 12. Initial MVP Scope

```text
Risk level on every action.
Conservative default policy (approve MEDIUM and HIGH).
Spend and rate limits for executable actions.
Approval workflow.
Kill switch.
Audit of allow / block decisions.
```

Autopilot policies are introduced only after Operator execution is proven safe (see `[[../development/phase-11-autonomy]]`).

---

# 13. Guardrails Principle

```text
AUREA may only do what it can be trusted to do,
within limits the customer set,
that it can explain and audit,
and that the customer can stop at any moment.
```

Guardrails are not a brake on the product.

They are the reason customers will ever let AUREA drive.
