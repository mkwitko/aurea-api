# AUREA Security Architecture

## 1. Purpose

AUREA holds a customer's growth strategy, business data, connected accounts, and — over time — the ability to spend money and publish in the customer's name.

This makes security and trust existential, not optional.

A single breach or rogue autonomous action can destroy the trust the entire moat depends on (see `[[../product/moat]]`).

This document defines the security requirements.

It complements the guardrail rules for autonomous actions in `[[../domains/guardrails]]`.

---

# 2. Security Principles

```text
1. Least privilege everywhere.
2. Tenant isolation is absolute.
3. Secrets are never stored in plain text.
4. Every consequential action is authorized and audited.
5. AI has no ambient authority; it acts only through governed tools.
6. Customer data is never exposed across tenants.
7. Fail closed, not open.
```

---

# 3. Tenant Isolation

The primary security boundary is the Organization (see `[[persistance-model]]`).

```text
Organization
    └── Workspace
          └── Business data
```

Requirements:

```text
Every query is scoped by organization / workspace.
No cross-tenant read or write is possible through any API path.
Isolation is enforced at the data-access layer, not only in the UI.
Tests must include cross-tenant access attempts that must fail.
```

Data must never leak across organizations.

---

# 4. Authentication and Authorization

```text
Authentication
  Handled via an identity provider; AUREA stores minimal user identity.

Authorization
  Role-based: OWNER / ADMIN / MEMBER / VIEWER (see [[persistance-model]]).
  Every mutation checks role + tenant scope.

API auth
  Scoped tokens; short-lived where practical.
```

Consequential capabilities (spend, publish, connect integrations) require elevated roles.

---

# 5. Secrets and Credentials

AUREA connects to many external platforms holding powerful credentials.

```text
Integration tokens are encrypted at rest.
The database stores references / encrypted blobs, never plain secrets.
Access to secrets is scoped to the minimum required operation.
Tokens use the least permission the provider allows.
Rotation and revocation are supported.
```

A leaked ad-account or CRM token is a direct financial and reputational risk.

---

# 6. AI-Specific Security

AI introduces attack surfaces traditional software does not have.

## Prompt Injection

```text
External content (web pages, documents, messages, integration data)
may contain instructions attempting to hijack an agent.

Defenses:
  Treat all retrieved/external content as untrusted data, not instructions.
  Agents act only through defined tools with their own authorization.
  No tool grants ambient authority from free text.
  Consequential tools require approval regardless of agent intent.
```

## No Ambient Authority

```text
An agent cannot spend, publish, or modify configuration
simply because its reasoning concluded it should.

It can only PROPOSE.

Execution passes through the guardrail + approval layer.
See [[../domains/guardrails]].
```

## Output Containment

```text
AI inference is not fact until validated (see [[ai-architecture]]).
AI output is validated against schemas before it drives actions.
```

---

# 7. Data Privacy and Compliance

AUREA operates in Brazil first; LGPD applies. GDPR applies for EU data.

```text
Lawful basis and consent for personal data processing.
Data minimization: collect only what the growth loop needs.
Right to access, correct, and delete (data subject requests).
Data residency and processor agreements for sub-processors (LLMs, integrations).
Clear separation of customer PII from cross-account learning.
```

Cross-account learning must use anonymized, aggregated patterns only, with consent — never raw customer data (see `[[../product/moat]]` §5).

---

# 8. LLM and Sub-Processor Data Handling

```text
Customer data sent to model providers must respect:
  provider data-use terms (no training on customer data),
  regional routing where required,
  redaction of unnecessary PII before inference.

Every model provider is a sub-processor and must be disclosed.
```

Provider-agnostic routing (see `[[ai-architecture]]`) must respect per-customer data-handling constraints.

---

# 9. Audit and Traceability

Every consequential action and important decision is recorded.

```text
Actor (USER / AGENT / SYSTEM / INTEGRATION)
Action
Entity + entity ID
Before / after state where applicable
Timestamp
```

See AuditLog and Decision in `[[persistance-model]]`.

The system must not rely on conversational history as the only record.

Auditability is both a security control and a trust feature.

---

# 10. Execution Safety

For actions that touch the outside world:

```text
Idempotency keys prevent duplicate execution.
Requested / Executing / Succeeded / Failed / Unknown states are explicit.
An accepted API request is never assumed to be a successful action.
Rollback / undo is supported where the provider allows.
```

See `[[integration-architecture]]`.

---

# 11. Operational Security

```text
Encryption in transit and at rest.
Environment separation (dev / staging / prod).
Secret management outside source control.
Dependency and vulnerability scanning.
Rate limiting and abuse prevention.
Backups and disaster recovery with tested restore.
Incident response plan.
```

These mature through Phase 12 (see `[[../development/phase-12-production]]`).

---

# 12. Security Principle

```text
AUREA earns increasing autonomy by proving it can be trusted.

Trust requires that AUREA never leaks a tenant's data,
never acts beyond its authority,
and can always explain and audit what it did.
```

Security is not a phase.

It is a precondition for every phase that grants AUREA more power.
