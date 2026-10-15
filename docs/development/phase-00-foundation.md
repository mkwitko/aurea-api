# AUREA Phase 00 — Foundation

This is the first engineering phase.

It maps to the infrastructure portion of product roadmap Phase 0 (Foundation).

It builds nothing product-specific. It builds the ground everything else stands on.

---

# 1. Objective

Create a stable technical foundation for AUREA.

Deliver a repository that any contributor can clone, configure, build, lint, test, and boot locally with reproducible results.

Establish continuous integration, environment configuration, secrets handling, and base observability before any domain code exists.

---

# 2. Scope (what gets built)

Repository and project hygiene.

```text
- Git repository initialization and default branch policy.
- Documentation tree under docs/ (already established) kept as source of truth.
- License, README, and CONTRIBUTING pointing to docs/development/workflow.md.
- .gitignore, .editorconfig, .nvmrc (pinned Node version).
```

Tooling baseline (repository root, shared later by the monorepo).

```text
- Package manager selection and lockfile (pnpm recommended for workspaces).
- TypeScript baseline configuration.
- Linter and formatter (ESLint + Prettier) with a shared config.
- Commit conventions and pre-commit checks.
```

Continuous integration.

```text
- CI pipeline: install → typecheck → lint → test → build.
- CI runs on every pull request and on main.
- CI caches dependencies for speed.
```

Base infrastructure for local development.

```text
- Docker Compose for local PostgreSQL and Redis.
- Reproducible local bring-up documented and scripted.
```

Environment configuration and secrets.

```text
- Central environment schema with validation at boot.
- .env.example enumerating every required variable.
- Clear separation of secret and non-secret configuration.
- Secrets are never committed; loaded from environment or a secret manager.
```

Base observability.

```text
- Structured JSON logging with log levels.
- Request/correlation id propagation convention.
- Health and readiness endpoint conventions (implemented against the API in phase 01).
- Error reporting hook (provider-agnostic interface).
```

---

# 3. Dependencies (which earlier phases / must-haves)

None. This is the first phase.

External prerequisites:

```text
- A pinned Node.js runtime.
- Docker available for local PostgreSQL and Redis.
- The docs/ tree (product, architecture, domains, agents) as source of truth.
```

---

# 4. Deliverables (concrete artifacts)

```text
Repository
  README.md, CONTRIBUTING.md, LICENSE
  .gitignore, .editorconfig, .nvmrc

Tooling
  package.json (root) with workspace + script definitions
  Lockfile
  tsconfig.base.json
  .eslintrc / eslint config
  .prettierrc
  Pre-commit hook configuration

CI
  Pipeline definition running install, typecheck, lint, test, build
  Dependency cache configuration

Infrastructure
  docker-compose.yml with postgres and redis services
  Scripts: dev bring-up, dev teardown

Configuration
  Environment schema module with boot-time validation
  .env.example with every required variable documented

Observability
  Structured logger module (JSON, levels, correlation id)
  Error reporting interface (no vendor lock-in)
  Health/readiness endpoint conventions documented
```

---

# 5. Out of Scope (explicitly deferred)

```text
- Monorepo package layout (apps/*, packages/*)         → phase 01
- Prisma schema and database models                    → phase 01
- Fastify API and Vite/React app skeletons             → phase 01
- Authentication, users, organizations, workspaces     → phase 02
- Any Growth Brain domain entity or service            → phase 03
- Metrics dashboards and alerting                       → phase 12
- Production deployment topology                         → phase 12
```

No business logic is written in this phase.

---

# 6. Exit Criteria (verifiable conditions)

```text
[ ] A fresh clone builds with a single documented command.
[ ] typecheck, lint, and test commands run and pass with an empty/base project.
[ ] CI runs on pull requests and blocks merge on failure.
[ ] docker compose up starts PostgreSQL and Redis locally.
[ ] The app refuses to boot when a required environment variable is missing,
    with a clear validation error.
[ ] .env.example lists every required variable; no secret is committed.
[ ] The logger emits structured JSON with level and correlation id.
[ ] README explains local setup end to end and links workflow.md.
```

---

# 7. Foundation Flow

```text
Clone repository
      ↓
Install (pinned Node + package manager)
      ↓
Copy .env.example → .env
      ↓
docker compose up (postgres + redis)
      ↓
Environment validation at boot
      ↓
typecheck → lint → test → build
      ↓
CI enforces the same pipeline on every pull request
```
