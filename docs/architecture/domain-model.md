# Domain Model

The platform revolves around a single concept:

Business Growth.

Everything exists to improve business growth.

---

Business

↓

Business Context

↓

Goals

↓

Strategies

↓

Hypotheses

↓

Experiments

↓

Actions

↓

Outcomes

↓

Knowledge

↓

Business Context

This creates a continuous learning cycle.

---

## Business

Represents a company.

---

## Workspace

A company may own multiple workspaces.

Examples:

Marketing

Sales

Product

Regional Business

---

## Business Context

The accumulated understanding of a business.

Contains:

- ICP
- Personas
- Market
- Competitors
- Products
- Positioning
- Brand
- Offers
- Revenue model

Business Context continuously evolves.

---

## Goal

Represents a measurable objective.

Examples

Increase MRR

Reduce CAC

Increase Leads

Improve Retention

---

## Strategy

Explains HOW goals will be achieved.

---

## Hypothesis

A measurable assumption.

---

## Experiment

Tests a hypothesis.

What the experiment measures — metric, baseline, target, success criteria — is
frozen from `APPROVED` onward (`AUR-T0020`). Per
`docs/domains/experiments.md` §13, deciding success after seeing results
invalidates the test. Descriptive fields stay editable at any status.

---

## Action

Something executable.

Publish

Create Ad

Send Email

Change Budget

Generate Landing Page

---

## Outcome

Measured result.

Routes: `POST /experiments/:id/outcomes`, `GET /experiments/:id/outcomes`.
An experiment may have many; they are ordered by when the measurement was
observed, not by when it was entered.

The metric defaults to the experiment's own — an outcome on a different metric
cannot be read against that experiment's baseline and target.

**Provenance is currently partial.** `docs/domains/analytics.md` §11 asks for
source, external reference, observed-at, ingestion method and confidence. Manual
entry records `source` (always `USER` today) and `observedAt` only. The
remaining three arrive with the first real analytics integration, which is when
there is something to put in them; recording empty fields now would look like
provenance without being any.

---

## Knowledge

Persistent organizational learning.

Knowledge survives experiments.

A `Learning` is the candidate form. Routes: `POST /learnings`,
`GET /learnings?experimentId=&status=`, and
`POST /learnings/:id/{validate,reject,archive}`.

Creation always produces a `CANDIDATE`; a request asking for `VALIDATED` is
ignored, because validation is the step that turns a candidate into knowledge
(`docs/domains/analytics.md` §19).

Transitions — a decided learning stays decided, and archiving files it away
rather than reopening it:

```text
CANDIDATE → VALIDATED, REJECTED
VALIDATED → ARCHIVED
REJECTED  → ARCHIVED
ARCHIVED  → (terminal)
```

A learning may exist with no experiment behind it: not everything learned comes
out of a formal experiment.

---

# Relationships

Business

└── Workspace

└── Growth Brain

├── Goals

├── Strategies

├── Experiments

├── Outcomes

└── Knowledge