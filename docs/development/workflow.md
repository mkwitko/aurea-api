# AUREA Development Workflow

# 1. Purpose

This document defines how development is carried out in AUREA.

It describes the branch model, the pre-implementation checklist, the definition of done, testing expectations, code review, the documentation-as-source-of-truth rule, and how architectural decisions are proposed.

The workflow applies to every engineering phase in `docs/development/phases.md`.

The workflow exists to keep AUREA coherent as it grows across many phases and contributors.

---

# 2. Core Principle

AUREA is built one phase at a time.

```text
Understand the phase.
Understand the documentation.
Understand the existing code.
Implement only the phase scope.
Validate.
Update documentation.
```

Do not implement future phases unless explicitly requested.

Do not optimize for the largest possible system.

Optimize for validating the AUREA growth loop.

---

# 3. Branch Model

AUREA uses a trunk-based model with short-lived branches.

```text
main
 │
 ├── feat/phase-03-growth-brain
 ├── feat/phase-03-experiment-service
 ├── fix/workspace-isolation-leak
 └── chore/ci-cache
```

Rules:

`main` is always releasable.

Branches are short-lived and scoped to a single unit of work.

Branch names use a type prefix and a phase or area:

```text
feat/    new capability
fix/     defect correction
chore/   tooling, config, housekeeping
docs/    documentation only
refactor/ internal change with no behavior change
```

Work merges into `main` through a pull request.

Never commit directly to `main`.

---

# 4. Pre-Implementation Checklist

Before writing code for any phase, complete this checklist.

This checklist is derived from the "One phase at a time" rule in `CLAUDE.md`.

```text
1. Read CLAUDE.md
      Absorb principles, boundaries, and technology direction.

2. Read the phase document
      docs/development/phase-NN-*.md
      Understand objective, scope, dependencies, exit criteria.

3. Read the relevant product, domain, architecture, and agent docs
      docs/product/       what the capability is for
      docs/domains/       business concepts and rules
      docs/architecture/  how the system is structured
      docs/agents/        agent responsibilities and contracts

4. Inspect the existing implementation
      Read the code that already exists in the affected packages.
      Do not assume; verify current state.

5. Identify dependencies and affected boundaries
      Which earlier phases must be complete.
      Which packages, entities, events, and tenants are touched.

6. Implement the requested scope
      Only the scope of the active phase.

7. Validate with the appropriate .claude skills
      Run tests, linters, and validation workflows.

8. Update documentation
      When product behavior or architecture changes.
```

Steps must be done in order.

Skipping straight to implementation is not permitted.

---

# 5. Definition of Done

A unit of work is done only when all of the following hold.

```text
[ ] Scope matches the active phase, no more, no less.
[ ] Code compiles and type-checks with no errors.
[ ] Linting passes.
[ ] Tests for the new behavior exist and pass.
[ ] Existing tests still pass.
[ ] Multi-tenant isolation is preserved (workspace scoping).
[ ] Domain invariants are enforced (see the domain docs).
[ ] Domain events are emitted where the domain requires them.
[ ] Secrets are not committed and not logged.
[ ] Documentation is updated if behavior or architecture changed.
[ ] The relevant phase Exit Criteria are satisfied.
```

A phase is done only when its documented Exit Criteria are verifiably met.

"It runs on my machine" is not a definition of done.

---

# 6. Testing Expectations

Tests are written alongside the implementation, not after the phase.

```text
Unit tests
  Domain services, invariants, pure functions.
  A domain invariant must have a test that proves it is enforced.

Integration tests
  API endpoints, database access, event emission.
  Tenant isolation must be covered: a workspace must never
  read or write another workspace's data.

End-to-end / workflow tests
  Reserved for growth-loop transitions once the relevant
  phases exist (research → strategy → experiment → outcome).
```

Guidelines:

Every domain invariant listed in a domain doc must have a corresponding test.

Every state transition (Goal, Strategy, Hypothesis, Experiment, Action) must have a test that rejects invalid transitions.

Tests must not depend on external network services; external providers are mocked or stubbed.

AI model calls are stubbed in tests. Prompt and routing logic is tested without real provider calls.

---

# 7. Code Review

Every change is reviewed before merge.

```text
Author
  Opens a pull request describing scope, phase, and decisions.
  Links the phase document and any relevant domain docs.

Reviewer
  Verifies scope matches the phase.
  Verifies the Definition of Done.
  Verifies invariants, tenant isolation, and events.
  Verifies documentation was updated where required.
```

Review focuses on correctness, boundaries, and adherence to documented behavior.

A reviewer should reject a change that silently alters documented product or architectural behavior.

If behavior must change, the documentation change is part of the same pull request.

---

# 8. Documentation as Source of Truth

Documentation is authoritative.

```text
Product behavior        →  docs/product/
Architecture            →  docs/architecture/
Business domain rules   →  docs/domains/
Agent responsibilities  →  docs/agents/
Integration contracts   →  docs/architecture/ + integration docs
Implementation phases   →  docs/development/
```

Rules:

When documentation conflicts with implementation, investigate the discrepancy before changing code.

Do not silently change documented product or architectural behavior.

When a change alters documented behavior, update the documentation in the same change.

Do not duplicate `.claude` skill instructions into project documentation.

Do not redefine persistence entities in phase docs; reference `docs/architecture/persistance-model.md`.

---

# 9. Architectural Decisions

Significant architectural choices are recorded as Architecture Decision Records (ADRs).

An ADR is required when a change:

```text
- Alters the technology direction in CLAUDE.md.
- Changes a persistence entity, relationship, or invariant.
- Changes the event envelope or event flow.
- Changes a tenant isolation or security boundary.
- Introduces a new external provider or integration boundary.
- Changes how AI providers are routed or abstracted.
```

ADRs live under `docs/architecture/` (for example `docs/architecture/adr/NNNN-title.md`).

An ADR should contain:

```text
Title
Status        (PROPOSED | ACCEPTED | SUPERSEDED)
Context       Why a decision is needed.
Decision      What was decided.
Alternatives  What else was considered.
Consequences  Trade-offs and follow-on effects.
```

Proposing an ADR:

```text
1. Write the ADR with status PROPOSED.
2. Open it for review alongside the affected work.
3. On agreement, set status ACCEPTED and merge.
4. Superseding a decision creates a new ADR referencing the old one.
```

An accepted ADR that changes a documented behavior must be reflected in the relevant `docs/` file.

---

# 10. Workflow Summary

```text
Pick the active phase
        ↓
Run the pre-implementation checklist
        ↓
Branch
        ↓
Implement the phase scope
        ↓
Write and run tests
        ↓
Validate with .claude skills
        ↓
Update documentation
        ↓
Open pull request
        ↓
Review against Definition of Done + Exit Criteria
        ↓
Merge to main
```

One phase at a time.

Prove the growth loop before expanding the system.
