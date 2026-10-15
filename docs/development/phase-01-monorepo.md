# AUREA Phase 01 — Monorepo

This phase establishes the code structure of AUREA.

It maps to the structure portion of product roadmap Phase 0 (Foundation).

It creates the package layout, the shared build tooling, the database package, the event bus interface, and thin API and web skeletons that later phases fill in.

---

# 1. Objective

Turn the foundation into a working monorepo.

Establish the package boundaries that enforce the architecture: domain and data at the center, AI and integrations at the edges, presentation on top.

Deliver bootable but nearly empty API and web applications, a Prisma package ready for schema, and an EventBus interface that domain code can depend on without knowing the transport.

---

# 2. Scope (what gets built)

Monorepo layout.

```text
apps/
  web/            Vite + React + TypeScript application
  api/            Fastify + TypeScript application

packages/
  shared/         Shared types, constants, result/error helpers, env schema
  db/             Prisma client, schema, migrations, seed
  ai/             Model Router interface + provider abstraction (stub)
  integrations/   External provider client interfaces (stub)
```

Shared tooling across packages.

```text
- Shared tsconfig extended by every package.
- Consistent build (tsc / bundler) and test runner across packages.
- Workspace-aware scripts: build, typecheck, lint, test, dev.
- Internal package references via the workspace, not relative deep imports.
```

Database package (`packages/db`).

```text
- Prisma installed and configured against the phase-00 PostgreSQL.
- Prisma schema file present (empty of domain models; ready for phase 02+).
- Generated Prisma client exported from the package.
- Migration and seed scripts wired.
```

Event bus interface (`packages/shared` or a dedicated events module).

```text
- EventBus interface stub, transport-agnostic:

    interface EventBus {
      publish(event: DomainEvent): Promise<void>
      subscribe(type, handler): void
    }

- DomainEvent envelope type matching docs/architecture/event-architecture.md
  (id, type, version, occurredAt, organizationId, workspaceId, actor,
   correlationId, causationId, payload).
- An in-memory implementation for local/dev and tests.
- A Redis/BullMQ-backed implementation may be stubbed but not required to
  be complete; the interface must not leak Redis types.
```

Base API skeleton (`apps/api`).

```text
- Fastify server bootstrapping with the phase-00 logger and env validation.
- Health and readiness endpoints.
- Plugin structure for routes, error handling, and request context.
- Prisma client injected from packages/db.
- No domain routes yet.
```

Base web skeleton (`apps/web`).

```text
- Vite + React + TypeScript app that builds and serves.
- Basic routing shell and an app layout.
- A typed API client pointing at apps/api.
- A single page that calls the API health endpoint to prove connectivity.
```

---

# 3. Dependencies (which earlier phases / must-haves)

```text
- Phase 00 — Foundation
    Tooling, CI, PostgreSQL + Redis, env validation, logger.
```

Architecture references:

```text
- docs/architecture/system-overview.md  (layer boundaries)
- docs/architecture/event-architecture.md (event envelope)
- docs/architecture/persistance-model.md (entities to be modeled from phase 02)
```

---

# 4. Deliverables (concrete artifacts)

```text
Layout
  apps/web, apps/api
  packages/shared, packages/db, packages/ai, packages/integrations
  Workspace configuration linking them

Shared config
  tsconfig.base.json extended per package
  Shared lint/test config
  Root scripts: build, typecheck, lint, test, dev (workspace aware)

packages/shared
  DomainEvent envelope type
  EventBus interface
  In-memory EventBus implementation
  Shared Result/Error helpers and common types

packages/db
  Prisma schema (no domain models yet)
  Exported Prisma client
  Migration + seed scripts

packages/ai
  ModelRouter interface + LLMProvider interface (stubs, no real calls)

packages/integrations
  IntegrationClient interface (stub)

apps/api
  Fastify bootstrap with logger + env + Prisma
  GET /health and GET /ready endpoints
  Error handling + request context plugins

apps/web
  Vite/React app shell with routing and layout
  Typed API client
  Health-check page proving web → api connectivity
```

---

# 5. Out of Scope (explicitly deferred)

```text
- Any Prisma domain model (User, Organization, ...)   → phase 02
- Authentication and tenancy                           → phase 02
- Growth Brain entities and services                   → phase 03
- Real LLM provider implementations                    → phase 04+
- Real external integrations                            → phase 07+
- Redis/BullMQ production event transport (interface only here) → later
- UI beyond a connectivity shell                        → later phases
```

---

# 6. Exit Criteria (verifiable conditions)

```text
[ ] pnpm build (or equivalent) builds every package and app.
[ ] Typecheck and lint pass across the whole workspace.
[ ] apps/api boots, /health and /ready return healthy.
[ ] apps/web builds and its health page shows a successful API call.
[ ] packages/db generates a Prisma client and can run a no-op migration.
[ ] EventBus interface exists with a working in-memory implementation,
    and a unit test publishes and receives a DomainEvent.
[ ] No package imports Redis or a specific provider type through the
    EventBus, AI, or integrations interfaces.
[ ] CI builds and tests the full workspace.
```

---

# 7. Package Boundary Diagram

```text
                    apps/web  (Vite + React + TS)
                          │  typed API client
                          ▼
                    apps/api  (Fastify + TS)
                          │
        ┌─────────────────┼──────────────────────┐
        ▼                 ▼                       ▼
  packages/db       packages/ai            packages/integrations
  (Prisma client)   (Model Router IF)      (Integration IF)
        │                 │                       │
        └────────┬────────┴───────────┬───────────┘
                 ▼                    ▼
           packages/shared      EventBus (interface)
           (types, env,         in-memory impl now,
            DomainEvent)         Redis/BullMQ later
```

Dependencies point inward toward `shared` and `db`.

`ai` and `integrations` are edges and must not be depended on by the domain core.
