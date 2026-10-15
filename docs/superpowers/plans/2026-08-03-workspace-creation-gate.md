# Workspace Creation Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop registration from silently creating a workspace named `Default`; make the account create its first workspace explicitly, and move the trial credits to that creation.

**Architecture:** Registration leaves an organization-level `Membership` (`workspaceId: null`) and no workspace. `POST /workspaces` gains a second tenant resolver (`resolveOrgTenant`) so a user with no workspace can call it, and `createWorkspaceForOrg` grants `TRIAL_CREDITS` when the organization's workspace count is zero. The web app blocks every `/app/*` route behind a full-page create-your-first-workspace screen until `/auth/me` reports a membership with a `workspaceId`. A SQL migration deletes untouched legacy `default` workspaces so existing accounts enter the same flow.

**Tech Stack:** Node 22, Fastify 5, TypeScript strict ESM, Prisma 6 + PostgreSQL, Zod, Vitest (back); Vite 6, React 19, react-router-dom 7, TanStack Query, Kubb-generated hooks, Tailwind + shadcn/ui, react-i18next, Vitest + Testing Library (web).

**Spec:** `back/docs/superpowers/specs/2026-08-03-workspace-creation-gate-design.md`

## Global Constraints

- Two separate git repositories. Tasks 1–3 run in `back/`, Task 4 in `web/`. Never stage across them.
- Backend: vertical slice per use case, services as factories, repositories scoped by `workspaceId`, typed `AppError` subclasses. Every route keeps its `operationId` and response schema.
- Backend gate: `pnpm typecheck && pnpm test`. Integration tests (`*.integration.test.ts`) need the Docker Postgres up.
- Web: Tailwind + shadcn/ui only — no plain CSS, no `style={{}}`. All server calls through the Kubb-generated hooks. No `any`. Web gate: `pnpm typecheck && pnpm test`.
- Every user-facing string is an i18n key present in **all three** locales (`web/src/i18n/locales/en.json`, `pt.json`, `es.json`). `src/i18n/locales.test.ts` fails the build when a key exists in one file and not another. `en.json` is the reference.
- Trial credits value is `TRIAL_CREDITS = 50` from `back/src/billing/plan-catalog.ts`. The ledger entry is written verbatim as `{ workspaceId, kind: 'GRANT', credits: TRIAL_CREDITS, reason: 'trial credits' }`.
- Comments in this codebase explain *why*, in the language already used in the file being edited (several backend files are commented in Portuguese — match the file, do not translate it).
- The API contract does not change (`POST /workspaces` keeps its body and response), so no `pnpm openapi:dump` and no `pnpm api:generate` are needed.

---

### Task 1: Move the trial credits from registration to the first workspace

**Files:**
- Modify: `back/src/http/api/auth/auth.repository.ts:23-57` (`createAccount`)
- Modify: `back/src/billing/workspace-limit.ts:22-38` (`assertCanCreateWorkspace`)
- Modify: `back/src/billing/create-workspace.ts`
- Test: `back/src/http/api/auth/register/register.test.ts` (rewrite the existing test)
- Test: `back/src/billing/workspace-limit.test.ts` (add one case)
- Test: `back/src/billing/create-workspace.integration.test.ts` (add two cases)

**Interfaces:**
- Consumes: `TRIAL_CREDITS` from `back/src/billing/plan-catalog.js`; `workspaceLimitRepo(tx)` from `back/src/billing/billing.repository.js`.
- Produces: `assertCanCreateWorkspace(deps, organizationId): Promise<number>` — resolves to the count of active workspaces the organization had **before** this creation. `createWorkspaceForOrg` keeps its current signature and return type `Promise<CreatedWorkspace>`.

- [ ] **Step 1: Write the failing test for registration**

Replace the whole `describe('createAccount', …)` block in `back/src/http/api/auth/register/register.test.ts` with:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createAuthRepository } from '../auth.repository.js';

describe('createAccount', () => {
  function txFake() {
    return {
      organization: { create: vi.fn().mockResolvedValue({ id: 'org-1' }) },
      workspace: { create: vi.fn().mockResolvedValue({ id: 'ws-1' }) },
      user: { create: vi.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.com', name: 'A' }) },
      membership: { create: vi.fn().mockResolvedValue({}) },
      creditLedger: { create: vi.fn().mockResolvedValue({}) },
    };
  }

  async function register(tx: ReturnType<typeof txFake>) {
    const prisma = { $transaction: (fn: (t: unknown) => unknown) => fn(tx) };
    await createAuthRepository(prisma as never).createAccount({
      name: 'A',
      email: 'a@b.com',
      passwordHash: 'hash',
      organizationName: 'Acme',
    });
  }

  // O workspace deixou de ser criado no registro: quem escolhe o nome é o
  // usuário, na tela de primeiro workspace. Um workspace 'Default' aqui é
  // exatamente a regressão que este teste existe para pegar.
  it('creates no workspace', async () => {
    const tx = txFake();
    await register(tx);
    expect(tx.workspace.create).not.toHaveBeenCalled();
  });

  // O trial acompanha o workspace que o recebe (ver createWorkspaceForOrg):
  // sem workspace, não há onde lançar o crédito.
  it('writes no credit ledger entry', async () => {
    const tx = txFake();
    await register(tx);
    expect(tx.creditLedger.create).not.toHaveBeenCalled();
  });

  it('leaves an organization-level OWNER membership', async () => {
    const tx = txFake();
    await register(tx);
    expect(tx.membership.create).toHaveBeenCalledWith({
      data: { userId: 'u-1', organizationId: 'org-1', workspaceId: null, role: 'OWNER' },
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd back && pnpm vitest run src/http/api/auth/register/register.test.ts`
Expected: FAIL — `workspace.create` was called, `creditLedger.create` was called, and the membership carries `workspaceId: 'ws-1'`.

- [ ] **Step 3: Strip the workspace and the ledger out of `createAccount`**

In `back/src/http/api/auth/auth.repository.ts`, replace the body of `createAccount` (lines 23-57) with:

```ts
    createAccount(input: { name: string; email: string; passwordHash: string; organizationName: string }) {
      return prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: { name: input.organizationName, slug: uniqueSlug(input.organizationName) },
        });
        const user = await tx.user.create({
          data: { email: input.email, name: input.name, passwordHash: input.passwordHash },
        });
        // Membership de organização, sem workspace: o registro não cria mais um
        // workspace 'Default' que ninguém escolheu. O primeiro workspace — e com
        // ele o trial — nasce em createWorkspaceForOrg, quando o usuário
        // finalmente dá um nome à empresa ou marca dele.
        //
        // Membership.workspaceId é nullable no schema e /auth/me já devolve
        // null nele, então a sessão continua reportando OWNER: o web deriva o
        // papel atuante da primeira membership quando nenhuma tem workspace
        // (web/src/lib/auth.tsx).
        await tx.membership.create({
          data: { userId: user.id, organizationId: organization.id, workspaceId: null, role: Role.OWNER },
        });
        return user;
      });
    },
```

Then delete the now-unused `TRIAL_CREDITS` import at the top of the file (line 3). Keep the `uniqueSlug` and `Role` imports.

- [ ] **Step 4: Run the test again**

Run: `cd back && pnpm vitest run src/http/api/auth/register/register.test.ts src/http/api/auth/auth.repository.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing test for the count `assertCanCreateWorkspace` returns**

Add to `back/src/billing/workspace-limit.test.ts`:

```ts
  // createWorkspaceForOrg decide o trial por este número: ele já foi lido com a
  // linha da organização travada, então devolvê-lo evita uma segunda contagem
  // que poderia divergir da que autorizou a criação.
  it('returns how many active workspaces the organization already had', async () => {
    const deps = {
      repo: {
        lockOrganization: vi.fn().mockResolvedValue(undefined),
        organizationById: vi.fn().mockResolvedValue({ plan: 'GROWTH' as const }),
        countActiveWorkspaces: vi.fn().mockResolvedValue(0),
      },
    };

    await expect(assertCanCreateWorkspace(deps, 'org-1')).resolves.toBe(0);
  });
```

Match the import style already at the top of that file (`assertCanCreateWorkspace`, `vi`).

- [ ] **Step 6: Run it and watch it fail**

Run: `cd back && pnpm vitest run src/billing/workspace-limit.test.ts`
Expected: FAIL — resolves to `undefined`, not `0`.

- [ ] **Step 7: Return the count**

In `back/src/billing/workspace-limit.ts`, change the signature and the tail of `assertCanCreateWorkspace`:

```ts
// A franquia multiplica por workspace: sem teto, um STARTER cria vinte
// workspaces e leva 4.000 créditos por R$297. Este é o freio da margem.
//
// Devolve quantos workspaces ativos a organização JÁ tinha. Quem cria usa esse
// número para saber se este é o primeiro workspace do org (e portanto o que
// recebe o trial); ele vale porque foi lido com a linha da organização travada.
export async function assertCanCreateWorkspace(
  deps: WorkspaceLimitDeps,
  organizationId: string,
): Promise<number> {
```

and end the function with `return current;` after the `WorkspaceLimitReachedError` check. Leave the lock, the read order and both comments exactly as they are.

- [ ] **Step 8: Run the test again**

Run: `cd back && pnpm vitest run src/billing/workspace-limit.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing integration tests for the trial grant**

Add to `back/src/billing/create-workspace.integration.test.ts`. The existing `beforeEach` seeds two workspaces, so these two cases build their own organization:

```ts
describe('trial credits', () => {
  async function freshOrg() {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const org = await prisma.organization.create({
      data: { name: 'Trial IT', slug: `trial-${suffix}`, plan: 'GROWTH' },
    });
    const user = await prisma.user.create({
      data: { email: `trial-${suffix}@example.com`, passwordHash: 'x', name: 'Trial' },
    });
    return { organizationId: org.id, userId: user.id };
  }

  function ledgerOf(workspaceId: string) {
    return prisma.creditLedger.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
  }

  it('grants the one-off trial to the first workspace of an organization', async () => {
    const { organizationId, userId } = await freshOrg();

    const first = await createWorkspaceForOrg(prisma, organizationId, {
      name: 'Acme',
      creatorUserId: userId,
      creatorRole: 'OWNER',
    });

    expect(await ledgerOf(first.id)).toMatchObject([
      { kind: 'GRANT', credits: 50, reason: 'trial credits' },
    ]);
  });

  it('grants nothing to the second workspace', async () => {
    const { organizationId, userId } = await freshOrg();
    await createWorkspaceForOrg(prisma, organizationId, {
      name: 'Acme',
      creatorUserId: userId,
      creatorRole: 'OWNER',
    });

    const second = await createWorkspaceForOrg(prisma, organizationId, {
      name: 'Acme Two',
      creatorUserId: userId,
      creatorRole: 'OWNER',
    });

    expect(await ledgerOf(second.id)).toEqual([]);
  });

  // O trial é UM. Duas criações simultâneas no org vazio não podem lançar dois:
  // a decisão é tomada com a linha da organização travada, então a segunda
  // recount já vê o workspace da primeira.
  it('grants exactly one trial when two first-workspace creations race', async () => {
    const { organizationId, userId } = await freshOrg();

    const created = await Promise.all([
      createWorkspaceForOrg(prisma, organizationId, { name: 'Race A', creatorUserId: userId, creatorRole: 'OWNER' }),
      createWorkspaceForOrg(prisma, organizationId, { name: 'Race B', creatorUserId: userId, creatorRole: 'OWNER' }),
    ]);

    const entries = await prisma.creditLedger.findMany({
      where: { workspaceId: { in: created.map((w) => w.id) } },
    });
    expect(entries).toHaveLength(1);
  });
});
```

- [ ] **Step 10: Run them and watch them fail**

Run: `cd back && pnpm vitest run src/billing/create-workspace.integration.test.ts`
Expected: the two grant tests FAIL (empty ledger); the race test FAILS with 0 entries. The pre-existing cap-concurrency test still passes.

- [ ] **Step 11: Grant the trial in `createWorkspaceForOrg`**

Rewrite `back/src/billing/create-workspace.ts`:

```ts
import type { PrismaClient, Role } from '@prisma/client';
import { uniqueSlug } from '../lib/slug.js';
import { workspaceLimitRepo } from './billing.repository.js';
import { assertCanCreateWorkspace } from './workspace-limit.js';
import { TRIAL_CREDITS } from './plan-catalog.js';

export type CreatedWorkspace = { id: string; name: string; slug: string; createdAt: Date };

export type NewWorkspaceInput = {
  name: string;
  creatorUserId: string;
  creatorRole: Role;
};

// Teto e os dois inserts (workspace + membership) na mesma transação: fora
// dela, duas criações concorrentes no mesmo org podem ler o mesmo `current`
// antes de qualquer insert committar, e as duas passam do teto que
// AUR-T0017 existe para travar.
export async function createWorkspaceForOrg(
  prisma: PrismaClient,
  organizationId: string,
  input: NewWorkspaceInput,
): Promise<CreatedWorkspace> {
  return prisma.$transaction(async (tx) => {
    const existing = await assertCanCreateWorkspace({ repo: workspaceLimitRepo(tx) }, organizationId);

    const created = await tx.workspace.create({
      data: { organizationId, name: input.name, slug: uniqueSlug(input.name) },
      select: { id: true, name: true, slug: true, createdAt: true },
    });

    // Workspace sem membro nenhum é invisível para o resolveTenant e ninguém
    // consegue apagá-lo.
    await tx.membership.create({
      data: { userId: input.creatorUserId, organizationId, workspaceId: created.id, role: input.creatorRole },
    });

    // A ÚNICA exceção sancionada à regra "crédito entra no ledger só por
    // credit.service.grant/grantOnce", herdada do registro. O motivo é a
    // transação: o lançamento no ledger *é* o registro de que o trial foi
    // concedido (não há campo `trialUsed`), então ele tem que commitar junto
    // com o workspace que o recebe. Passar pelo credit.service abriria uma
    // segunda transação e deixaria a janela onde o workspace existe sem o
    // trial, ou o trial existe sem o workspace.
    //
    // Trial é GRANT e não franquia porque franquia renovaria todo mês, para
    // sempre, para quem nunca pagou.
    //
    // `existing === 0` é seguro porque assertCanCreateWorkspace contou com a
    // linha da organização travada: duas criações simultâneas num org vazio
    // não podem ver zero as duas. Só o PRIMEIRO workspace recebe o trial — do
    // segundo em diante vale a franquia do plano.
    if (existing === 0) {
      await tx.creditLedger.create({
        data: { workspaceId: created.id, kind: 'GRANT', credits: TRIAL_CREDITS, reason: 'trial credits' },
      });
    }

    return created;
  });
}
```

- [ ] **Step 12: Run the integration tests**

Run: `cd back && pnpm vitest run src/billing/create-workspace.integration.test.ts`
Expected: PASS (4 tests). If Postgres is not running, start it first (`docker compose up -d` per `back/README`), because these tests hit the real database.

- [ ] **Step 13: Update the stale comment in the create-workspace controller**

In `back/src/http/api/workspaces/create-workspace/create-workspace.controller.ts`, the comment above the `return` currently claims the trial happens at registration. Replace it with:

```ts
      // Nenhum crédito de boas-vindas aqui: o trial é da organização, acontece
      // uma vez e vai para o primeiro workspace dela (createWorkspaceForOrg).
      // Este workspace já recebe a franquia do plano.
```

- [ ] **Step 14: Full backend gate**

Run: `cd back && pnpm typecheck && pnpm test`
Expected: PASS. If another suite asserted the registration workspace, fix it here — the trial's home moved, and any test still expecting it at registration is asserting the old behavior.

- [ ] **Step 15: Commit**

```bash
cd back
git add src/http/api/auth/auth.repository.ts src/http/api/auth/register/register.test.ts \
  src/billing/workspace-limit.ts src/billing/workspace-limit.test.ts \
  src/billing/create-workspace.ts src/billing/create-workspace.integration.test.ts \
  src/http/api/workspaces/create-workspace/create-workspace.controller.ts
git commit -m "feat(auth): stop registration from creating a workspace, move the trial to the first one"
```

---

### Task 2: Let a user with no workspace call `POST /workspaces`

**Files:**
- Modify: `back/src/lib/tenant.ts`
- Modify: `back/src/plugins/tenant.ts`
- Modify: `back/src/types/fastify.d.ts`
- Modify: `back/src/http/api/workspaces/index.ts`
- Modify: `back/src/http/api/workspaces/create-workspace/create-workspace.controller.ts`
- Modify: `back/src/http/api/workspaces/list-workspaces/list-workspaces.controller.ts`
- Test: `back/src/plugins/tenant.test.ts` (create)
- Test: `back/src/http/api/workspaces/workspaces.test.ts` (modify)

**Interfaces:**
- Consumes: `createWorkspaceForOrg` from Task 1 (unchanged signature).
- Produces:
  - `OrgTenantContext = { userId: string; organizationId: string; role: Role }`, exported from `back/src/lib/tenant.js`.
  - `request.orgTenant: OrgTenantContext` — set only by `resolveOrgTenant`.
  - `app.resolveOrgTenant: (request: FastifyRequest, reply: FastifyReply) => Promise<void>`.
  - `assertWriter`, `assertAdmin`, `assertOwner` now accept any `{ role: Role }`.

- [ ] **Step 1: Write the failing test for `resolveOrgTenant`**

Create `back/src/plugins/tenant.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../lib/errors.js';
import tenantPlugin from './tenant.js';

function buildApp(membership: unknown) {
  const findFirst = vi.fn().mockResolvedValue(membership);
  const app = Fastify();
  app.decorate('prisma', { membership: { findFirst } } as never);
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  return { app, findFirst };
}

async function withRoute(membership: unknown) {
  const { app, findFirst } = buildApp(membership);
  await app.register(tenantPlugin);
  let seen: unknown;
  app.get('/probe', { preHandler: [app.resolveOrgTenant] }, async (req: FastifyRequest) => {
    seen = req.orgTenant;
    return { ok: true };
  });
  // `authenticate` normally puts this there; resolveOrgTenant only reads it.
  app.addHook('onRequest', async (req) => {
    (req as { user?: unknown }).user = { sub: 'u1', email: 'a@b.com' };
  });
  return { app, findFirst, seen: () => seen };
}

describe('resolveOrgTenant', () => {
  // O usuário recém-registrado tem membership de organização e nenhum
  // workspace. É exatamente ele que precisa criar o primeiro.
  it('resolves an organization-level membership', async () => {
    const probe = await withRoute({ userId: 'u1', organizationId: 'org-1', workspaceId: null, role: 'OWNER' });

    const res = await probe.app.inject({ method: 'GET', url: '/probe' });

    expect(res.statusCode).toBe(200);
    expect(probe.seen()).toEqual({ userId: 'u1', organizationId: 'org-1', role: 'OWNER' });
  });

  it('reads the oldest membership, the same one resolveTenant and /auth/me use', async () => {
    const probe = await withRoute({ userId: 'u1', organizationId: 'org-1', workspaceId: null, role: 'OWNER' });

    await probe.app.inject({ method: 'GET', url: '/probe' });

    expect(probe.findFirst).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('refuses a user with no membership at all', async () => {
    const probe = await withRoute(null);

    const res = await probe.app.inject({ method: 'GET', url: '/probe' });

    expect(res.statusCode).toBe(403);
  });
});

describe('resolveTenant', () => {
  // A contrapartida: o tenant de workspace continua recusando quem não tem
  // workspace. Toda rota de domínio é escopada por workspaceId, e afrouxar isto
  // para acomodar a conta recém-registrada abriria consulta sem escopo.
  it('still refuses an account whose only membership is organization-level', async () => {
    // `null`, porque é o que o Postgres devolve: a query do resolveTenant filtra
    // `workspaceId: { not: null }` quando não vem header, e a única membership
    // desta conta tem workspaceId null — nenhuma linha casa.
    const { app } = buildApp(null);
    await app.register(tenantPlugin);
    app.addHook('onRequest', async (req) => {
      (req as { user?: unknown }).user = { sub: 'u1', email: 'a@b.com' };
    });
    app.get('/domain', { preHandler: [app.resolveTenant] }, async () => ({ ok: true }));

    const res = await app.inject({ method: 'GET', url: '/domain' });

    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd back && pnpm vitest run src/plugins/tenant.test.ts`
Expected: FAIL — `app.resolveOrgTenant` is not a function.

- [ ] **Step 3: Narrow the role guards and add `OrgTenantContext`**

In `back/src/lib/tenant.ts`, add the type after `TenantContext` and change the three guards to take only what they read:

```ts
/**
 * O tenant de quem ainda não tem workspace. Existe uma rota só nesta situação
 * — POST /workspaces, criando o primeiro — e ela ganha uma propriedade própria
 * em vez de afrouxar `TenantContext.workspaceId` para `string | null`: todo
 * repositório de domínio é escopado por `workspaceId: string`, e o null
 * viajaria por dezenas de rotas que não têm o que fazer com ele, colecionando
 * `!` pelo caminho.
 */
export interface OrgTenantContext {
  userId: string;
  organizationId: string;
  role: Role;
}

/** O que as guardas de papel realmente leem — serve para os dois tenants. */
type HasRole = { role: Role };
```

Then change the three signatures to `assertWriter(tenant: HasRole)`, `assertAdmin(tenant: HasRole)`, `assertOwner(tenant: HasRole)`. Leave every comment and message untouched.

- [ ] **Step 4: Add the `resolveOrgTenant` decorator**

In `back/src/plugins/tenant.ts`, add inside the plugin, after the `resolveTenant` decoration:

```ts
  // O tenant de quem ainda não tem workspace, para POST /workspaces criar o
  // primeiro. resolveTenant continua recusando esse request — e está certo:
  // toda rota de domínio precisa de um workspace, e 403 lá é a resposta.
  //
  // Mesmo `orderBy: { createdAt: 'asc' }` do resolveTenant e do
  // auth.repository.userById: as três leituras têm que escolher a MESMA
  // membership, senão o papel que o front mostra não é o que o backend
  // aplica.
  app.decorate('resolveOrgTenant', async function (request: FastifyRequest, _reply: FastifyReply) {
    const userId = request.user?.sub;
    if (!userId) throw new UnauthorizedError('Not authenticated');

    const membership = await app.prisma.membership.findFirst({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    if (!membership) throw new ForbiddenError('No access to the requested workspace');

    request.orgTenant = {
      userId,
      organizationId: membership.organizationId,
      role: membership.role,
    };
  });
```

Also extend the block comment above the plugin: `resolveTenant` still describes itself, and one sentence says `resolveOrgTenant` resolves only the organization, for the route that creates the first workspace.

- [ ] **Step 5: Declare both on the Fastify types**

In `back/src/types/fastify.d.ts`, import `OrgTenantContext` alongside `TenantContext`, add to `FastifyInstance`:

```ts
    /**
     * Resolve só a organização, para POST /workspaces: é a única rota que um
     * usuário sem workspace precisa alcançar. Deve rodar após `authenticate`.
     */
    resolveOrgTenant: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
```

and to `FastifyRequest`:

```ts
    /** Preenchido só por `resolveOrgTenant`. Ver `src/lib/tenant.ts`. */
    orgTenant: OrgTenantContext;
```

- [ ] **Step 6: Run the plugin test**

Run: `cd back && pnpm vitest run src/plugins/tenant.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Write the failing route test**

In `back/src/http/api/workspaces/workspaces.test.ts`, change `buildTestApp` so the preHandler sets both properties — the create route will read `orgTenant`, the list route still reads `tenant`:

```ts
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: 'ws-1', role };
    // A rota de criação lê daqui: quem cria o primeiro workspace não tem
    // workspace nenhum, então ela não pode depender de `tenant`.
    req.orgTenant = { userId: 'u1', organizationId: 'org-1', role };
  });
```

Then add a test that the create route does not depend on `tenant` at all:

```ts
it('creates a workspace for a user who has no workspace yet', async () => {
  const prisma = prismaFake({ workspaceCount: 0 });
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prisma as never);
  // `tenant` deliberadamente ausente: é o estado real de quem acabou de se
  // registrar. Se o controller voltar a lê-lo, isto estoura.
  app.addHook('preHandler', async (req) => {
    req.orgTenant = { userId: 'u1', organizationId: 'org-1', role: 'OWNER' };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, details: error.details } });
    }
    throw error;
  });
  await app.register(createWorkspaceRoute);

  const res = await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Growth' } });

  expect(res.statusCode).toBe(201);
  expect(prisma._tx.workspaceCreate).toHaveBeenCalled();
});
```

`prismaFake` needs one addition for this path — the trial insert from Task 1 runs when `workspaceCount` is 0, so add `creditLedger: { create: vi.fn().mockResolvedValue({}) }` to the object the `$transaction` fake passes to its callback.

- [ ] **Step 8: Run it and watch it fail**

Run: `cd back && pnpm vitest run src/http/api/workspaces/workspaces.test.ts`
Expected: FAIL — the controller reads `req.tenant`, which is `undefined` in the new test.

- [ ] **Step 9: Point the create route at `orgTenant`**

In `back/src/http/api/workspaces/create-workspace/create-workspace.controller.ts`, add the preHandler and swap the three reads:

```ts
    {
      preHandler: [app.resolveOrgTenant],
      schema: {
        tags: ['workspaces'],
        operationId: 'createWorkspace',
        body: createWorkspaceBody,
        response: { 201: workspaceResponse },
      },
    },
    async (req, reply) => {
      // orgTenant e não tenant: esta é a rota que o usuário sem workspace
      // precisa alcançar, e resolveTenant recusaria o request dele.
      assertAdmin(req.orgTenant);

      const workspace = await createWorkspaceForOrg(app.prisma, req.orgTenant.organizationId, {
        name: req.body.name,
        creatorUserId: req.orgTenant.userId,
        creatorRole: req.orgTenant.role,
      });
```

Keep the existing comment about the plan cap and the locked organization row above the call.

- [ ] **Step 10: Give the list route its own preHandler**

In `back/src/http/api/workspaces/list-workspaces/list-workspaces.controller.ts`, add `preHandler: [app.resolveTenant],` to the route options (before `schema`). Nothing else changes — listing needs a real workspace tenant.

In `back/src/http/api/workspaces/index.ts`, drop the module-scoped tenant hook:

```ts
/**
 * Registers all `workspaces` routes. Auth is applied at this scope; a tenant is
 * NOT — as duas rotas precisam de tenants diferentes. Criar o primeiro
 * workspace é o único caminho de quem não tem nenhum (resolveOrgTenant);
 * listar exige um workspace de verdade (resolveTenant). Cada controller
 * declara o seu.
 */
export const workspacesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);

  await app.register(listWorkspacesRoute);
  await app.register(createWorkspaceRoute);
};
```

- [ ] **Step 11: Run the route tests**

Run: `cd back && pnpm vitest run src/http/api/workspaces/workspaces.test.ts`
Expected: PASS. The existing tests inject their own preHandlers, so `app.resolveOrgTenant`/`app.resolveTenant` are not decorated in those apps — if a test app now fails on a missing decorator, decorate it there with a no-op (`app.decorate('resolveOrgTenant', async () => {})`), exactly as `write-guard.test.ts` does for `resolveTenant`.

- [ ] **Step 12: Full backend gate**

Run: `cd back && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
cd back
git add src/lib/tenant.ts src/plugins/tenant.ts src/plugins/tenant.test.ts src/types/fastify.d.ts \
  src/http/api/workspaces/index.ts \
  src/http/api/workspaces/create-workspace/create-workspace.controller.ts \
  src/http/api/workspaces/list-workspaces/list-workspaces.controller.ts \
  src/http/api/workspaces/workspaces.test.ts
git commit -m "feat(workspaces): resolve an organization-level tenant so the first workspace can be created"
```

---

### Task 3: Migration — delete untouched legacy `default` workspaces

**Files:**
- Create: `back/prisma/migrations/20260803120000_drop_untouched_default_workspaces/migration.sql`
- Test: `back/src/billing/default-workspace-cleanup.integration.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks at runtime. The behavior it depends on (the trial re-granted on first workspace creation) is Task 1.
- Produces: no code interface. After this migration, an organization whose only workspace was an unused `default` has zero workspaces and one organization-level membership per member.

- [ ] **Step 1: Write the migration SQL**

Create `back/prisma/migrations/20260803120000_drop_untouched_default_workspaces/migration.sql`:

```sql
-- Workspaces que o registro criou com o nome 'Default' e que ninguém nunca
-- usou. O registro deixou de criá-los; estas contas entram no mesmo fluxo de
-- "crie seu primeiro workspace" no próximo login.
--
-- O crédito de trial some junto no cascade — e volta, no mesmo valor, quando a
-- conta criar o primeiro workspace (createWorkspaceForOrg). Os critérios abaixo
-- só casam com quem nunca gastou um crédito, então o saldo é preservado.
CREATE TEMPORARY TABLE untouched_default AS
SELECT w."id"
FROM "Workspace" w
WHERE w."slug" = 'default'
  -- Único workspace da organização. Uma org com dois já escolheu algum nome.
  AND (SELECT count(*) FROM "Workspace" w2 WHERE w2."organizationId" = w."organizationId") = 1
  AND NOT EXISTS (SELECT 1 FROM "Business" t WHERE t."workspaceId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "Icp" t WHERE t."workspaceId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "Goal" t WHERE t."workspaceId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "Strategy" t WHERE t."workspaceId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "Hypothesis" t WHERE t."workspaceId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "Experiment" t WHERE t."workspaceId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "Outcome" t WHERE t."workspaceId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "Learning" t WHERE t."workspaceId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "AgentRun" t WHERE t."workspaceId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "WorkspaceProviderKey" t WHERE t."workspaceId" = w."id")
  AND NOT EXISTS (SELECT 1 FROM "CreditPeriod" t WHERE t."workspaceId" = w."id")
  -- Exatamente o lançamento do trial, e nada mais: qualquer débito, compra ou
  -- franquia significa que a conta usou este workspace.
  AND (SELECT count(*) FROM "CreditLedger" l WHERE l."workspaceId" = w."id") = 1
  AND EXISTS (
    SELECT 1 FROM "CreditLedger" l
    WHERE l."workspaceId" = w."id" AND l."kind" = 'GRANT' AND l."reason" = 'trial credits'
  );

-- Ordem obrigatória. Membership."workspaceId" tem ON DELETE CASCADE, então
-- apagar o workspace primeiro apagaria a única membership do usuário — ele
-- ficaria sem papel nenhum em /auth/me e a tela de criar workspace tomaria 403
-- ao submeter. Soltar a membership do workspace a transforma na membership de
-- organização que o registro passou a criar.
UPDATE "Membership"
SET "workspaceId" = NULL
WHERE "workspaceId" IN (SELECT "id" FROM untouched_default);

DELETE FROM "Workspace" WHERE "id" IN (SELECT "id" FROM untouched_default);

DROP TABLE untouched_default;
```

- [ ] **Step 2: Write the failing integration test**

Create `back/src/billing/default-workspace-cleanup.integration.test.ts`. It re-runs the migration's SQL against seeded rows, which is what makes the criteria testable:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { TRIAL_CREDITS } from './plan-catalog.js';

const prisma = new PrismaClient();

const SQL = readFileSync(
  new URL('../../prisma/migrations/20260803120000_drop_untouched_default_workspaces/migration.sql', import.meta.url),
  'utf8',
);

// O arquivo é o que roda em produção: ler dele em vez de reescrever o SELECT
// aqui é o que impede o teste de aprovar critérios que a migração não tem.
async function runCleanup() {
  await prisma.$executeRawUnsafe(SQL);
}

async function seedDefaultWorkspace(label: string) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}-${label}`;
  const org = await prisma.organization.create({
    data: { name: `Cleanup ${label}`, slug: `cleanup-${suffix}`, plan: 'STARTER' },
  });
  const user = await prisma.user.create({
    data: { email: `cleanup-${suffix}@example.com`, passwordHash: 'x', name: 'Owner' },
  });
  const workspace = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'Default', slug: 'default' },
  });
  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId: org.id, workspaceId: workspace.id, role: 'OWNER' },
  });
  await prisma.creditLedger.create({
    data: { workspaceId: workspace.id, kind: 'GRANT', credits: TRIAL_CREDITS, reason: 'trial credits' },
  });
  return { organizationId: org.id, userId: user.id, workspaceId: workspace.id, membershipId: membership.id };
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe('untouched default workspace cleanup', () => {
  it('deletes the workspace and leaves the membership at organization level', async () => {
    const seeded = await seedDefaultWorkspace('plain');

    await runCleanup();

    expect(await prisma.workspace.findUnique({ where: { id: seeded.workspaceId } })).toBeNull();
    const membership = await prisma.membership.findUnique({ where: { id: seeded.membershipId } });
    expect(membership).toMatchObject({ organizationId: seeded.organizationId, workspaceId: null, role: 'OWNER' });
  });

  it('keeps a default workspace that holds a business', async () => {
    const seeded = await seedDefaultWorkspace('with-business');
    await prisma.business.create({
      data: { workspaceId: seeded.workspaceId, name: 'Acme', lifecycleStage: 'IDEA' },
    });

    await runCleanup();

    expect(await prisma.workspace.findUnique({ where: { id: seeded.workspaceId } })).not.toBeNull();
  });

  it('keeps a default workspace whose ledger has a second entry', async () => {
    const seeded = await seedDefaultWorkspace('spent');
    await prisma.creditLedger.create({
      data: { workspaceId: seeded.workspaceId, kind: 'DEBIT', credits: -1, reason: 'agent run' },
    });

    await runCleanup();

    expect(await prisma.workspace.findUnique({ where: { id: seeded.workspaceId } })).not.toBeNull();
  });

  it('keeps a default workspace in an organization that has a second workspace', async () => {
    const seeded = await seedDefaultWorkspace('two-workspaces');
    await prisma.workspace.create({
      data: { organizationId: seeded.organizationId, name: 'Growth', slug: `growth-${seeded.workspaceId}` },
    });

    await runCleanup();

    expect(await prisma.workspace.findUnique({ where: { id: seeded.workspaceId } })).not.toBeNull();
  });
});
```

Before running, confirm the field names used in the seeds against `back/prisma/schema.prisma`: `Business` (line 145) and `CreditLedger` (line 554) — if `Business.lifecycleStage` or the `CreditLedger.kind` enum values differ from the literals above, use the schema's, not these. The assertions do not depend on those values.

- [ ] **Step 3: Run the tests and watch them fail**

Run: `cd back && pnpm vitest run src/billing/default-workspace-cleanup.integration.test.ts`
Expected: FAIL — the first test finds the workspace still present, because the migration has not been applied and `runCleanup` reads a file whose SQL you must have written in Step 1. If the failure is `ENOENT`, the migration path is wrong.

- [ ] **Step 4: Apply the migration**

Run: `cd back && pnpm prisma migrate dev`
Expected: the new migration applies with no schema drift — it changes data only, so Prisma should report no schema change to generate.

- [ ] **Step 5: Run the tests again**

Run: `cd back && pnpm vitest run src/billing/default-workspace-cleanup.integration.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Full backend gate**

Run: `cd back && pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
cd back
git add prisma/migrations/20260803120000_drop_untouched_default_workspaces/migration.sql \
  src/billing/default-workspace-cleanup.integration.test.ts
git commit -m "feat(db): drop untouched default workspaces so legacy accounts name their first one"
```

---

### Task 4: Gate `/app/*` on having a workspace

**Files:**
- Modify: `web/src/lib/auth.tsx`
- Create: `web/src/components/WorkspaceGate.tsx`
- Create: `web/src/pages/WorkspaceNewPage.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/i18n/locales/en.json`, `pt.json`, `es.json`
- Test: `web/src/components/WorkspaceGate.test.tsx` (create)
- Test: `web/src/pages/WorkspaceNewPage.test.tsx` (create)

**Interfaces:**
- Consumes: `POST /workspaces` from Task 2 via the generated `useCreateWorkspace` hook (`web/src/api/generated/hooks/workspacesHooks/useCreateWorkspace`), and `/auth/me`'s `memberships[].workspaceId` — already `string | null` in the contract (`back/src/http/api/auth/auth.schema.ts`), so no regeneration is needed.
- Produces:
  - `useAuth().hasWorkspace: boolean` — true only when `/auth/me` succeeded and at least one membership has a non-null `workspaceId`.
  - `<WorkspaceGate>{children}</WorkspaceGate>` from `web/src/components/WorkspaceGate.tsx` — renders children when `hasWorkspace`, otherwise `<Navigate to="/app/workspaces/new" replace />`.
  - `WorkspaceNewPage` from `web/src/pages/WorkspaceNewPage.tsx`.

- [ ] **Step 1: Write the failing test for `hasWorkspace` and the gate**

Create `web/src/components/WorkspaceGate.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { renderWithProviders } from '@/test/render';
import { stubFetch } from '@/test/stub-fetch';
import { AuthProvider } from '@/lib/auth';
import { WorkspaceGate } from './WorkspaceGate';

function meBody(workspaceId: string | null) {
  return {
    user: { id: '11111111-1111-1111-1111-111111111111', email: 'a@b.com', name: 'A' },
    memberships: [{ organizationId: '22222222-2222-2222-2222-222222222222', workspaceId, role: 'OWNER' }],
  };
}

function renderGate() {
  return renderWithProviders(
    <AuthProvider>
      <Routes>
        <Route path="/" element={<WorkspaceGate><div>app shell</div></WorkspaceGate>} />
        <Route path="/app/workspaces/new" element={<div>create workspace</div>} />
      </Routes>
    </AuthProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('WorkspaceGate', () => {
  it('sends an account with no workspace to the create screen', async () => {
    localStorage.setItem('aurea.accessToken', 'token');
    stubFetch({ '/auth/me': { body: meBody(null) } });

    renderGate();

    expect(await screen.findByText('create workspace')).toBeInTheDocument();
  });

  it('renders the app once a workspace membership exists', async () => {
    localStorage.setItem('aurea.accessToken', 'token');
    stubFetch({ '/auth/me': { body: meBody('33333333-3333-3333-3333-333333333333') } });

    renderGate();

    expect(await screen.findByText('app shell')).toBeInTheDocument();
  });
});
```

Check the localStorage key for the access token in `web/src/lib/api.ts` and use that exact string; `aurea.accessToken` above is the expected name but the file is the authority. Same for the `/auth/me` pathname — read it off `web/src/api/generated/hooks/authHooks/useMe.ts` if the stub reports `unstubbed`.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd web && pnpm vitest run src/components/WorkspaceGate.test.tsx`
Expected: FAIL — `./WorkspaceGate` does not exist.

- [ ] **Step 3: Expose `hasWorkspace` from the auth context**

In `web/src/lib/auth.tsx`:

- add `hasWorkspace: boolean;` to `AuthContextValue`, right after `role`;
- derive it next to `role`:

```tsx
  // O que separa "conta criada" de "conta pronta para usar". A membership de
  // organização que o registro cria não tem workspace: enquanto for só ela, não
  // há o que renderizar no app — nenhuma rota de domínio responde sem workspace
  // (o backend devolve 403).
  const hasWorkspace: boolean = meQuery.isSuccess
    ? meQuery.data.memberships.some((m) => m.workspaceId !== null)
    : false;
```

- include it in the provider value: `value={{ user, role, hasWorkspace, status, login, register, logout }}`.

- [ ] **Step 4: Write the gate**

Create `web/src/components/WorkspaceGate.tsx`:

```tsx
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';

/**
 * Segura o app inteiro até a conta ter um workspace.
 *
 * Vai por `hasWorkspace` (memberships de /auth/me) e não pela lista de
 * workspaces: a lista é uma rota de domínio, e sem workspace ela responde 403 —
 * o gate teria que ler um erro para descobrir o estado normal de uma conta
 * recém-criada.
 *
 * Roda dentro do ProtectedRoute, então aqui a sessão já foi resolvida.
 */
export function WorkspaceGate({ children }: { children: ReactNode }) {
  const { hasWorkspace } = useAuth();
  if (!hasWorkspace) return <Navigate to="/app/workspaces/new" replace />;
  return <>{children}</>;
}
```

- [ ] **Step 5: Run the gate test**

Run: `cd web && pnpm vitest run src/components/WorkspaceGate.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Add the i18n keys to all three locales**

Add to `web/src/i18n/locales/en.json`, under the existing `app.workspace` object (keep the keys already there):

```json
      "firstTitle": "Name your first company or brand",
      "firstEyebrow": "One more step",
      "firstSubtitle": "A workspace holds one company or brand: its business context, its goals, its experiments and its credits. Everything AUREA learns is learned inside one.",
      "firstHint": "You can add more later, up to your plan's limit.",
      "firstSubmit": "Create and continue",
      "firstCreated": "Workspace created. Finishing setup…",
      "firstRetry": "Continue",
      "firstStalled": "Your workspace was created, but we could not load your session. Nothing was lost — try again."
```

`pt.json`:

```json
      "firstTitle": "Dê um nome à sua primeira empresa ou marca",
      "firstEyebrow": "Falta um passo",
      "firstSubtitle": "Um workspace guarda uma empresa ou marca: o contexto do negócio, as metas, os experimentos e os créditos dela. Tudo o que a AUREA aprende, aprende dentro de um.",
      "firstHint": "Você pode criar outros depois, até o limite do seu plano.",
      "firstSubmit": "Criar e continuar",
      "firstCreated": "Workspace criado. Finalizando…",
      "firstRetry": "Continuar",
      "firstStalled": "Seu workspace foi criado, mas não conseguimos carregar sua sessão. Nada foi perdido — tente de novo."
```

`es.json`:

```json
      "firstTitle": "Ponle nombre a tu primera empresa o marca",
      "firstEyebrow": "Falta un paso",
      "firstSubtitle": "Un workspace contiene una empresa o marca: su contexto de negocio, sus metas, sus experimentos y sus créditos. Todo lo que AUREA aprende, lo aprende dentro de uno.",
      "firstHint": "Puedes crear más después, hasta el límite de tu plan.",
      "firstSubmit": "Crear y continuar",
      "firstCreated": "Workspace creado. Finalizando…",
      "firstRetry": "Continuar",
      "firstStalled": "Tu workspace se creó, pero no pudimos cargar tu sesión. No se perdió nada: inténtalo de nuevo."
```

- [ ] **Step 7: Confirm the locales stay in sync**

Run: `cd web && pnpm vitest run src/i18n/locales.test.ts`
Expected: PASS. A failure names the exact path missing from a locale.

- [ ] **Step 8: Write the failing test for the create page**

Create `web/src/pages/WorkspaceNewPage.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '@/test/render';
import { stubFetch, type StubFetchCall } from '@/test/stub-fetch';
import { AuthProvider } from '@/lib/auth';
import { WorkspaceNewPage } from './WorkspaceNewPage';

const ME_NO_WORKSPACE = {
  user: { id: '11111111-1111-1111-1111-111111111111', email: 'a@b.com', name: 'A' },
  memberships: [{ organizationId: '22222222-2222-2222-2222-222222222222', workspaceId: null, role: 'OWNER' }],
};

const CREATED = {
  id: '33333333-3333-3333-3333-333333333333',
  name: 'Acme',
  slug: 'acme-a1b2c3',
  createdAt: '2026-08-03T00:00:00.000Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('WorkspaceNewPage', () => {
  it('posts the name and stores the new workspace as the active one', async () => {
    localStorage.setItem('aurea.accessToken', 'token');
    const calls: StubFetchCall[] = [];
    stubFetch({ '/auth/me': { body: ME_NO_WORKSPACE }, '/workspaces': { status: 201, body: CREATED } }, calls);

    renderWithProviders(
      <AuthProvider>
        <WorkspaceNewPage />
      </AuthProvider>,
    );

    await userEvent.type(await screen.findByLabelText(/name/i), 'Acme');
    await userEvent.click(screen.getByRole('button', { name: /create and continue/i }));

    await waitFor(() => {
      expect(calls.some((c) => c.method === 'POST' && c.path === '/workspaces')).toBe(true);
    });
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'Acme' });
    await waitFor(() => expect(localStorage.getItem('aurea.workspaceId')).toBe(CREATED.id));
  });

  it('refuses to submit an empty name', async () => {
    localStorage.setItem('aurea.accessToken', 'token');
    stubFetch({ '/auth/me': { body: ME_NO_WORKSPACE } });

    renderWithProviders(
      <AuthProvider>
        <WorkspaceNewPage />
      </AuthProvider>,
    );

    expect(await screen.findByRole('button', { name: /create and continue/i })).toBeDisabled();
  });

  // O workspace já existe: reenviar criaria um segundo. A saída é tentar a
  // sessão de novo, nunca o POST.
  it('offers a session retry instead of a second submit when the session read fails', async () => {
    localStorage.setItem('aurea.accessToken', 'token');
    stubFetch({
      '/auth/me': { body: ME_NO_WORKSPACE },
      '/workspaces': { status: 201, body: CREATED },
    });

    renderWithProviders(
      <AuthProvider>
        <WorkspaceNewPage />
      </AuthProvider>,
    );

    await userEvent.type(await screen.findByLabelText(/name/i), 'Acme');
    await userEvent.click(screen.getByRole('button', { name: /create and continue/i }));

    // /auth/me keeps reporting no workspace (the stub is fixed), so the page is
    // in its created-but-not-confirmed state and shows the retry, not the form.
    expect(await screen.findByRole('button', { name: /^continue$/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/name/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 9: Run it and watch it fail**

Run: `cd web && pnpm vitest run src/pages/WorkspaceNewPage.test.tsx`
Expected: FAIL — `./WorkspaceNewPage` does not exist.

- [ ] **Step 10: Write the create page**

Create `web/src/pages/WorkspaceNewPage.tsx`:

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AuthShell } from '@/components/AuthShell';
import { Button } from '@/components/ui/button';
import { useCreateWorkspace } from '@/api/generated/hooks/workspacesHooks/useCreateWorkspace';
import { listWorkspacesQueryKey } from '@/api/generated/hooks/workspacesHooks/useListWorkspaces';
import { meQueryKey } from '@/api/generated/hooks/authHooks/useMe';
import { useWorkspace } from '@/lib/workspace';
import { apiErrorMessage } from '@/lib/api-errors';

/**
 * O primeiro workspace da conta. Página cheia, fora do AppLayout: é a única
 * coisa que a conta pode fazer neste estado, e uma superfície fechável deixaria
 * o usuário parado num app vazio.
 *
 * A navegação espera o /auth/me: é a membership nova que levanta o WorkspaceGate,
 * e sair daqui antes dela chegar voltaria para cá na hora.
 */
export function WorkspaceNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setWorkspaceId } = useWorkspace();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  // O POST já passou. A partir daqui o formulário sai da tela: reenviar
  // criaria um segundo workspace com o mesmo nome.
  const [created, setCreated] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function confirmSession() {
    setConfirming(true);
    setError(null);
    try {
      await queryClient.refetchQueries({ queryKey: meQueryKey() });
      navigate('/app', { replace: true });
    } catch {
      setError(t('app.workspace.firstStalled'));
    } finally {
      setConfirming(false);
    }
  }

  const create = useCreateWorkspace({
    mutation: {
      onMutate: () => setError(null),
      onSuccess: async (workspace) => {
        setCreated(true);
        await queryClient.invalidateQueries({ queryKey: listWorkspacesQueryKey() });
        setWorkspaceId(workspace.id);
        await confirmSession();
      },
      // As palavras do backend: a mensagem do teto de plano cita a contagem e o
      // limite, coisa que copy genérica não faz.
      onError: (err) => setError(apiErrorMessage(err, t('app.workspace.createFailed'))),
    },
  });

  return (
    <AuthShell
      eyebrow={t('app.workspace.firstEyebrow')}
      title={t('app.workspace.firstTitle')}
      subtitle={t('app.workspace.firstSubtitle')}
    >
      {created ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('app.workspace.firstCreated')}</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="button" className="w-full" disabled={confirming} onClick={() => void confirmSession()}>
            {t('app.workspace.firstRetry')}
          </Button>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate({ data: { name: name.trim() } });
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="workspace-name" className="text-sm font-medium">
              {t('app.workspace.nameLabel')}
            </label>
            <input
              id="workspace-name"
              value={name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">{t('app.workspace.firstHint')}</p>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={create.isPending || name.trim() === ''}>
            {create.isPending ? t('common.saving') : t('app.workspace.firstSubmit')}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
```

`maxLength={80}` mirrors `createWorkspaceBody`'s `z.string().trim().min(1).max(80)` in `back/src/http/api/workspaces/workspaces.schema.ts` — the two must not drift.

Confirm `AuthShell`'s props (`eyebrow`, `title`, `subtitle`, `children`) and that `Button` lives at `@/components/ui/button` before running; both are read off the existing `LoginPage`/`RegisterPage` if anything differs.

- [ ] **Step 11: Run the page test**

Run: `cd web && pnpm vitest run src/pages/WorkspaceNewPage.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 12: Wire the gate and the route**

In `web/src/App.tsx`:

- add the lazy import next to the others:

```tsx
const WorkspaceNewPage = lazy(() => import('./pages/WorkspaceNewPage').then((m) => ({ default: m.WorkspaceNewPage })));
```

- import the gate: `import { WorkspaceGate } from './components/WorkspaceGate';`
- put the gate inside `Protected`, around `AppLayout`, so every existing `/app/*` route is covered without touching any of them:

```tsx
function Protected({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      {/* Sem workspace não há app: toda rota de domínio responde 403. O gate
          fica fora do AppLayout de propósito — a shell (nav, switcher, chip de
          crédito) não tem o que mostrar nesse estado. */}
      <WorkspaceGate>
        <AppLayout>
          <Suspense fallback={<div className="h-64" aria-busy="true" />}>{children}</Suspense>
        </AppLayout>
      </WorkspaceGate>
    </ProtectedRoute>
  );
}
```

- add the create route, which must NOT go through `Protected` (it is what the gate redirects to):

```tsx
      {/* Fora do `Protected`: é o destino do WorkspaceGate, e passar por ele
          aqui seria um laço de redirect. */}
      <Route
        path="/app/workspaces/new"
        element={
          <ProtectedRoute>
            <Suspense fallback={<div className="h-64" aria-busy="true" />}>
              <WorkspaceNewPage />
            </Suspense>
          </ProtectedRoute>
        }
      />
```

Place it before the `/app` route so the more specific path is registered alongside the rest of the `/app/*` block.

- [ ] **Step 13: Full web gate**

Run: `cd web && pnpm typecheck && pnpm test`
Expected: PASS. Existing page tests that render `Protected`-wrapped trees may now need a `/auth/me` stub with a non-null `workspaceId`; that is the gate doing its job, so fix the fixture, not the gate.

- [ ] **Step 14: Commit**

```bash
cd web
git add src/lib/auth.tsx src/components/WorkspaceGate.tsx src/components/WorkspaceGate.test.tsx \
  src/pages/WorkspaceNewPage.tsx src/pages/WorkspaceNewPage.test.tsx src/App.tsx \
  src/i18n/locales/en.json src/i18n/locales/pt.json src/i18n/locales/es.json
git commit -m "feat(web): ask for the first workspace instead of assuming a default one"
```

- [ ] **Step 15: Verify the whole flow by hand**

Run the stack (`pnpm dev:all` from the repo root, per `scripts/dev-all.sh`), then:

1. Register a new account.
2. Confirm you land on `/app/workspaces/new` and that typing any `/app/...` URL bounces back there.
3. Create a workspace named something other than "Default".
4. Confirm you land on `/app`, the switcher shows that name, and the credit chip shows 50.

Expected: all four. A 403 at step 3 means Task 2's preHandler is not wired; a bounce loop at step 4 means the `/auth/me` refetch is not being awaited.

---

## Notes for whoever adds `DELETE /workspaces/:id`

The trial grant in `createWorkspaceForOrg` keys off "the organization has zero active workspaces", not off a once-ever marker. With a delete route in place, an organization could delete its only workspace and create another to collect the trial again. Gate the grant behind `credit.service.grantOnce` with an organization-scoped idempotency key at that point. This is recorded in the spec under §2.
