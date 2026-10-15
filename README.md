# Aurea API

Backend for Aurea, an "AI growth operating system": a founder states a growth goal and the system drives research, strategy, experiments, execution on social channels, measurement and learning through AI agents over a shared business model.

**Status:** Prototype, not in production. Documentation is mixed Portuguese and English.

## What it does

- Growth domain model: business context, goals, strategies, experiments, actions, analytics, knowledge (`docs/domains/`).
- AI agent runner with proposal/fill flows, per-run budgets and timeouts, and queue-based workers (BullMQ).
- Credit-based AI billing with Stripe subscriptions, credit packs and an append-only ledger (`src/billing/`, `docs/architecture/billing.md`).
- Social publishing through a provider client and a worker with retry/reaper logic (`src/actions/`, `src/integrations/social/`).
- Automatic measurement from GA4 (`src/measurement/`).
- Per-tenant encrypted AI provider keys; Langfuse observability for LLM calls.

## Architecture

```mermaid
flowchart LR
  Web[aurea-web-app] --> API[Fastify API]
  API --> PG[(PostgreSQL / Prisma)]
  API --> Q[(Redis / BullMQ)]
  Q --> W[Worker: AI runs, actions, reaper]
  W --> LLM[LLM provider]
  W --> Social[Social publishing provider]
  W --> LF[Langfuse]
  API --> S3[(R2 / S3 storage)]
  API --> Stripe
```

- HTTP layer in `src/http`, domain/services in feature folders, integrations behind small clients in `src/integrations`.
- Environment is validated at boot (`src/config/env.ts`); missing secrets fail fast.
- Architecture docs: `docs/architecture/`.

## Tech stack

Node 22, TypeScript, Fastify 5, Prisma (PostgreSQL), Redis + BullMQ, Zod, Stripe, S3-compatible storage, Vitest.

## Getting started

Prerequisites: Node 22, pnpm 10, Docker.

```bash
cp .env.example .env      # fill the values; see the table below
pnpm install
pnpm infra:up             # Postgres, Redis, local Langfuse stack
pnpm prisma:generate && pnpm prisma:migrate
pnpm dev
```

All variables are listed in `.env.example`; main groups:

| Variables | Purpose |
|---|---|
| `DATABASE_URL`, `REDIS_URL` | Postgres and Redis |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Token signing |
| `AI_PROVIDER_*`, `AI_MODEL_*`, `AI_KEY_ENCRYPTION_KEY` | LLM provider and key encryption |
| `STRIPE_*` | Billing |
| `R2_*` | Object storage |
| `LANGFUSE_*` | LLM tracing; `LANGFUSE_SALT`, `LANGFUSE_ENCRYPTION_KEY`, `LANGFUSE_NEXTAUTH_SECRET` are required by the local compose stack (`openssl rand -hex 32`) |
| `POST_FOR_ME_*`, `TAVILY_API_KEY` | Social publishing, web search |

## Testing

`pnpm test` (unit), `pnpm test:integration` (needs Postgres), `pnpm typecheck`. About 260 test files.

## Project structure

```
src/        http, ai, billing, actions, integrations, measurement, config
prisma/     schema and migrations
docs/       product, domains, architecture, agents
scripts/    dev and asset helpers
```

## Related repositories

- [aurea-api](https://github.com/mkwitko/aurea-api): backend (Growth Brain, AI agents, billing).
- [aurea-web-app](https://github.com/mkwitko/aurea-web-app): React frontend.

## License

All rights reserved. Source available for portfolio review.
