# B2b — Stripe: assinatura, cupom e compra de crédito: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer dinheiro entrar: assinatura do Stripe define o plano da organização, pacote avulso vira crédito no ledger do B2a, e a falta de pagamento zera a franquia sem tirar o que já foi comprado.

**Architecture:** `src/billing/` ganha um cliente fino sobre a SDK do Stripe (`stripe-client.ts`), um normalizador de evento (`stripe-event.ts`) e dois serviços — `subscription.service.ts` aplica um evento ao estado da organização, `checkout.service.ts` monta as sessões. O plano sai de `Workspace` e passa a viver em `Organization`. Webhook e `POST /billing/sync` entregam o **mesmo** `BillingEvent` aos **mesmos** handlers. O ponto de contato com o B2a é `credit.service.grant`.

**Tech Stack:** Fastify 5, Prisma/PostgreSQL, Zod 3, Vitest 2, `stripe` (SDK Node v19).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-28-ai-billing-b2b-design.md`. Onde o plano e o spec divergirem, o spec ganha — pare e reporte. As três divergências já resolvidas estão listadas em "Divergências do spec" logo abaixo; nenhuma outra é permitida sem consulta.
- TDD sem exceção: teste que falha antes de qualquer implementação. Rodar e **ver** falhar é um passo, não uma formalidade.
- Nenhuma dependência de Fastify dentro de `src/billing/`. `stripe-client.ts` é o **único** arquivo do repo que faz `import Stripe from 'stripe'`.
- Nenhum teste toca a rede. Todo teste de billing injeta um fake de `StripeClient` e payloads de evento fixos.
- Todo erro novo entra em `src/shared/errors/catalog.ts` e nos três locales (`pt-BR`, `en-US`, `es-ES`) com contagem de chaves idêntica (`src/shared/errors/i18n.test.ts` reprova o contrário).
- Nenhuma resposta HTTP e nenhum log podem conter `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` ou o corpo cru do evento. Log de webhook registra `id`, `type` e resultado — nada mais.
- **Dinheiro nunca aparece na API.** A regra do B2a continua valendo: nenhuma resposta de `/billing*` ou `/credits*` carrega valor em reais, token ou `estimatedCost`. O preço o cliente vê na tela do Stripe.
- **Metadata é entrada não confiável.** `organizationId` e `workspaceId` que chegam num evento são verificados contra o `stripeCustomerId` da organização antes de qualquer crédito.
- Crédito só entra no ledger por `credit.service.grant`/`grantOnce`, chamado por handler de evento verificado ou pela CLI do B2a. Nenhuma rota concede crédito.
- `now: Date` entra por parâmetro em toda função que depende do tempo. Nada de `new Date()` dentro de regra de negócio.
- Comentário de código explica **por quê**, nunca o que a linha já diz. Português nos comentários, inglês nas mensagens de commit, como no resto do repo.
- Cada task termina com `pnpm typecheck && pnpm test` verdes antes do commit.

### Valores de produto (confirmados com o dono do produto em 2026-07-28)

| Plano | Preço/mês | Franquia (por workspace) | Máx. workspaces |
|---|---|---|---|
| STARTER | R$ 297,00 | 200 cr | 1 |
| GROWTH | R$ 997,00 | 1.000 cr | 3 |
| SCALE | R$ 2.497,00 | 4.000 cr | 10 |

| Pacote avulso | Preço | Créditos |
|---|---|---|
| SMALL | R$ 197,00 | 100 |
| MEDIUM | R$ 797,00 | 500 |
| LARGE | R$ 2.497,00 | 2.000 |

Crédito de trial: **50**, uma vez, no registro.

Preço em reais vive **só no Stripe**. Franquia, teto de workspaces e créditos por pacote vivem em código. Nenhum dos dois no banco.

### Recursos já criados no Stripe (test mode, conta `acct_1Ty1HsAZf2sIrmum`)

| Env | Produto | Price ID (test) |
|---|---|---|
| `STRIPE_PRICE_STARTER` | `aurea_plan_starter` | `price_1Ty1LkAZf2sIrmumUQ9PZCQD` |
| `STRIPE_PRICE_GROWTH` | `aurea_plan_growth` | `price_1Ty1M0AZf2sIrmumF49lbgtg` |
| `STRIPE_PRICE_SCALE` | `aurea_plan_scale` | `price_1Ty1MIAZf2sIrmumPc0MybUw` |
| `STRIPE_PRICE_PACK_SMALL` | `aurea_pack_small` | `price_1Ty1MfAZf2sIrmum1IO1C11g` |
| `STRIPE_PRICE_PACK_MEDIUM` | `aurea_pack_medium` | `price_1Ty1MiAZf2sIrmumJ6LZ0AFL` |
| `STRIPE_PRICE_PACK_LARGE` | `aurea_pack_large` | `price_1Ty1N1AZf2sIrmumVF5nwt4V` |

Cupom `aurea_launch_20` (20%, 3 meses) e promotion code `LANCAMENTO20` existem para provar `allow_promotion_codes` no smoke test.

Ainda **não** configurado, e fora do escopo deste plano: endpoint de webhook no Stripe (não há domínio público — desenvolvimento usa `stripe listen`) e a configuração do Billing Portal em live mode (test mode usa a configuração default automática).

### Divergências do spec, já resolvidas

1. **Ordem da marca de idempotência no webhook (spec §7.3).** O diagrama do spec insere o `StripeEvent` *antes* de despachar, mas o próprio spec exige que "erro no handler não marca o evento como processado". As duas coisas só coexistem dentro de uma transação. Este plano marca **depois** do despacho bem-sucedido, e protege o efeito que realmente dói — o crédito — com uma segunda chave de idempotência (o id da Checkout Session) gravada **na mesma transação** do lançamento no ledger (`grantOnce`, Task 7). Resultado: entrega duplicada credita uma vez; handler que estoura não deixa marca; o retry do Stripe encontra trabalho por fazer.
2. **Um segundo arquivo, `src/billing/stripe-event.ts` (spec §4.2 lista o layout sem ele).** Traduzir o payload do Stripe para um `BillingEvent` nosso é o que deixa `subscription.service.ts` testável com objetos literais em vez de payloads da SDK. Aditivo, sem mudança de comportamento.
3. **`STRIPE_PRICE_*` são opcionais no schema de env (spec §12 as marca "obrigatória: sim").** Marcá-las obrigatórias derruba o boot de qualquer desenvolvedor sem Stripe, o que contradiz a própria regra do spec de que "ausente desliga as rotas de billing". A ausência vira `BILLING_NOT_CONFIGURED` na hora da chamada, não no boot.

## File Structure

```text
prisma/schema.prisma                     Organization.plan/subscriptionStatus/stripe*, StripeEvent, DROP Workspace.plan
prisma/migrations/*_billing_b2b/         migration com cópia de dado antes do DROP

src/config/env.ts                        STRIPE_*, APP_URL
vitest.config.ts                         price ids fixos para a suíte

src/billing/
  plan-catalog.ts        (existe) += maxWorkspaces, effectiveAllowance, planForPrice, TRIAL_CREDITS
  credit-packs.ts        packId → créditos, priceId → packId
  stripe-client.ts       ÚNICO import da SDK; mappers puros exportados para teste
  stripe-event.ts        payload do Stripe → BillingEvent nosso
  billing.repository.ts  Organization + StripeEvent
  subscription.service.ts  aplica um BillingEvent ao estado da org
  checkout.service.ts    sessões de checkout e portal
  workspace-limit.ts     assertCanCreateWorkspace
  credit.repository.ts   (existe) workspacePlan → workspaceBilling; tx.markStripeEvent
  credit.service.ts      (existe) effectiveAllowance; grantOnce

src/http/api/billing/
  billing.schema.ts, billing.presenter.ts, billing.test.ts, index.ts
  get-billing/get-billing.controller.ts
  create-subscription-checkout/create-subscription-checkout.controller.ts
  create-credit-pack-checkout/create-credit-pack-checkout.controller.ts
  create-portal/create-portal.controller.ts
  sync-billing/sync-billing.controller.ts

src/http/webhooks/stripe/
  stripe-webhook.controller.ts, stripe-webhook.test.ts

src/http/api/auth/auth.repository.ts     (existe) trial GRANT + teto de workspace no createAccount
src/app.ts                               registra billingRoutes e o webhook
```

---

## Task 1: Migration — plano muda de casa

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_billing_b2b/migration.sql` (gerada e editada)
- Create: `src/billing/billing.integration.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: enum Prisma `SubscriptionStatus`; campos `Organization.plan`, `Organization.subscriptionStatus`, `Organization.stripeCustomerId`, `Organization.stripeSubscriptionId`, `Organization.currentPeriodEnd`, `Organization.lastSyncedAt`; modelo `StripeEvent`. `Workspace.plan` deixa de existir.

- [ ] **Step 1: Escrever o teste de integração que falha**

Criar `src/billing/billing.integration.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe('billing b2b migration', () => {
  it('gives every organization a plan and a subscription status', async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const org = await prisma.organization.create({ data: { name: 'B2b IT', slug: `b2b-${suffix}` } });

    expect(org.plan).toBe('STARTER');
    expect(org.subscriptionStatus).toBe('TRIAL');
    expect(org.stripeCustomerId).toBeNull();
    expect(org.currentPeriodEnd).toBeNull();
  });

  it('keeps a StripeEvent id unique so a redelivery cannot be processed twice', async () => {
    const id = `evt_${Date.now()}`;
    await prisma.stripeEvent.create({ data: { id, type: 'checkout.session.completed' } });

    const inserted = await prisma.$executeRaw`
      INSERT INTO "StripeEvent" ("id", "type", "processedAt")
      VALUES (${id}, 'checkout.session.completed', now())
      ON CONFLICT ("id") DO NOTHING
    `;

    expect(inserted).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm infra:up && pnpm test:integration src/billing/billing.integration.test.ts`
Expected: FAIL — `Property 'plan' does not exist` no `org` e `prisma.stripeEvent` indefinido.

- [ ] **Step 3: Alterar o schema Prisma**

Em `prisma/schema.prisma`, junto dos outros enums:

```prisma
enum SubscriptionStatus {
  TRIAL
  ACTIVE
  PAST_DUE
  CANCELED
}
```

No `model Organization`, acrescentar os campos:

```prisma
  plan                 Plan               @default(STARTER)
  subscriptionStatus   SubscriptionStatus @default(TRIAL)
  stripeCustomerId     String?            @unique
  stripeSubscriptionId String?
  currentPeriodEnd     DateTime?
  lastSyncedAt         DateTime?
```

No `model Workspace`, **remover** a linha `plan Plan @default(STARTER)`.

E o modelo novo, no fim do arquivo:

```prisma
// O Stripe reentrega em retry e pode entregar o mesmo evento duas vezes. Sem
// esta chave, um `checkout.session.completed` reprocessado credita de novo.
model StripeEvent {
  id          String   @id
  type        String
  processedAt DateTime @default(now())
}
```

- [ ] **Step 4: Gerar a migration sem aplicar**

Run: `pnpm prisma migrate dev --create-only --name billing_b2b`
Expected: cria `prisma/migrations/<timestamp>_billing_b2b/migration.sql` com o `ADD COLUMN` na Organization e o `DROP COLUMN "plan"` na Workspace.

- [ ] **Step 5: Editar a migration para copiar o dado antes de dropar**

No arquivo gerado, **entre** o `ALTER TABLE "Organization" ADD COLUMN ...` e o `ALTER TABLE "Workspace" DROP COLUMN "plan"`, inserir:

```sql
-- O plano sai do workspace e vai para a organização. Copiar antes de dropar:
-- hoje todos são STARTER, mas uma migration não pode assumir isso e sumir com
-- dado. Org com workspaces de planos diferentes (hoje impossível) fica com o
-- maior — max() sobre enum segue a ordem de declaração STARTER < GROWTH < SCALE.
UPDATE "Organization" o
SET "plan" = w.max_plan
FROM (
  SELECT "organizationId", MAX("plan") AS max_plan
  FROM "Workspace"
  WHERE "deletedAt" IS NULL
  GROUP BY "organizationId"
) w
WHERE o."id" = w."organizationId";
```

- [ ] **Step 6: Aplicar e verificar a cópia à mão**

Antes de aplicar, semear um caso que prova a cópia (o banco ainda está pré-migration):

```bash
psql "$DATABASE_URL" -c "UPDATE \"Workspace\" SET plan = 'GROWTH' WHERE id = (SELECT id FROM \"Workspace\" LIMIT 1);"
psql "$DATABASE_URL" -c "SELECT o.id, w.plan FROM \"Workspace\" w JOIN \"Organization\" o ON o.id = w.\"organizationId\" WHERE w.plan = 'GROWTH';"
```

Anotar o `o.id` devolvido. Aplicar:

Run: `pnpm prisma migrate dev`

Conferir que a organização anotada ficou `GROWTH`:

```bash
psql "$DATABASE_URL" -c "SELECT id, plan, \"subscriptionStatus\" FROM \"Organization\";"
```

Expected: a organização anotada tem `plan = GROWTH`; as demais, `STARTER`; todas `subscriptionStatus = TRIAL`.

Esta conferência é manual de propósito: testar a cópia automaticamente exigiria um banco pré-migration descartável, que a suíte não tem. O teste automatizado do Step 1 cobre o resultado da migration, não a transição.

- [ ] **Step 7: Rodar o teste de integração e ver passar**

Run: `pnpm test:integration src/billing/billing.integration.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/billing/billing.integration.test.ts
git commit -m "feat(billing): move the plan from workspace to organization"
```

---

## Task 2: Catálogo — franquia efetiva, teto de workspaces e pacotes

**Files:**
- Modify: `src/billing/plan-catalog.ts`, `src/billing/plan-catalog.test.ts`
- Modify: `vitest.config.ts`
- Create: `src/billing/credit-packs.ts`, `src/billing/credit-packs.test.ts`

**Interfaces:**
- Consumes: enums `Plan` e `SubscriptionStatus` (Task 1); `env` (Task 5 acrescenta as chaves — este task já as lê, e `optionalText` devolve `undefined` até lá).
- Produces: `maxWorkspaces(plan: Plan): number`; `effectiveAllowance(plan: Plan, status: SubscriptionStatus): number`; `planForPrice(priceId: string): Plan | null`; `TRIAL_CREDITS: number`; `type PackId = 'SMALL' | 'MEDIUM' | 'LARGE'`; `packCredits(id: PackId): number`; `packForPrice(priceId: string): PackId | null`; `priceForPack(id: PackId): string`; `isPackId(value: string): value is PackId`.

> **Ordem:** este task depende das chaves `STRIPE_PRICE_*` existirem em `src/config/env.ts` e em `vitest.config.ts`. Execute o **Step 1 da Task 5** (acrescentar as chaves ao `envSchema`) antes deste task, ou os testes de `planForPrice` não compilam.

- [ ] **Step 1: Dar price ids fixos à suíte**

Em `vitest.config.ts`, dentro de `test.env`, acrescentar:

```ts
      STRIPE_PRICE_STARTER: 'price_test_starter',
      STRIPE_PRICE_GROWTH: 'price_test_growth',
      STRIPE_PRICE_SCALE: 'price_test_scale',
      STRIPE_PRICE_PACK_SMALL: 'price_test_pack_small',
      STRIPE_PRICE_PACK_MEDIUM: 'price_test_pack_medium',
      STRIPE_PRICE_PACK_LARGE: 'price_test_pack_large',
```

- [ ] **Step 2: Escrever os testes que falham**

Acrescentar a `src/billing/plan-catalog.test.ts`:

```ts
import { effectiveAllowance, maxWorkspaces, monthlyAllowance, planForPrice, TRIAL_CREDITS } from './plan-catalog.js';

describe('effectiveAllowance', () => {
  it('pays the plan allowance while the subscription is active', () => {
    expect(effectiveAllowance('GROWTH', 'ACTIVE')).toBe(monthlyAllowance('GROWTH'));
  });

  it('keeps the allowance during past_due, the window Stripe retries in', () => {
    expect(effectiveAllowance('GROWTH', 'PAST_DUE')).toBe(monthlyAllowance('GROWTH'));
  });

  it('gives nothing to trial and canceled', () => {
    expect(effectiveAllowance('GROWTH', 'TRIAL')).toBe(0);
    expect(effectiveAllowance('SCALE', 'CANCELED')).toBe(0);
  });
});

describe('maxWorkspaces', () => {
  it('caps every plan and grows with it', () => {
    expect(maxWorkspaces('STARTER')).toBe(1);
    expect(maxWorkspaces('GROWTH')).toBeGreaterThan(maxWorkspaces('STARTER'));
    expect(maxWorkspaces('SCALE')).toBeGreaterThan(maxWorkspaces('GROWTH'));
  });
});

describe('planForPrice', () => {
  it('maps a configured price to its plan', () => {
    expect(planForPrice('price_test_growth')).toBe('GROWTH');
  });

  it('refuses a price it does not know', () => {
    expect(planForPrice('price_someone_elses')).toBeNull();
  });
});

describe('TRIAL_CREDITS', () => {
  it('is a one-off grant, not an allowance', () => {
    expect(TRIAL_CREDITS).toBe(50);
  });
});
```

Criar `src/billing/credit-packs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isPackId, packCredits, packForPrice, priceForPack } from './credit-packs.js';

describe('credit packs', () => {
  it('grows credits with the pack', () => {
    expect(packCredits('SMALL')).toBe(100);
    expect(packCredits('MEDIUM')).toBeGreaterThan(packCredits('SMALL'));
    expect(packCredits('LARGE')).toBeGreaterThan(packCredits('MEDIUM'));
  });

  it('maps a configured price back to its pack', () => {
    expect(packForPrice('price_test_pack_medium')).toBe('MEDIUM');
    expect(packForPrice('price_test_plan_growth')).toBeNull();
  });

  it('resolves the price of a pack', () => {
    expect(priceForPack('LARGE')).toBe('price_test_pack_large');
  });

  it('recognises only the three pack ids', () => {
    expect(isPackId('SMALL')).toBe(true);
    expect(isPackId('HUGE')).toBe(false);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm vitest run src/billing/plan-catalog.test.ts src/billing/credit-packs.test.ts`
Expected: FAIL — `effectiveAllowance is not a function` e módulo `./credit-packs.js` inexistente.

- [ ] **Step 4: Estender o catálogo de planos**

Acrescentar a `src/billing/plan-catalog.ts`:

```ts
import type { Plan, SubscriptionStatus } from '@prisma/client';
import { env } from '../config/env.js';

// Franquia multiplica por workspace: uma org GROWTH com 3 workspaces tem 3.000
// créditos/mês. O teto é o que segura a margem — sem ele um STARTER cria vinte
// workspaces e leva 4.000 créditos por R$297.
const MAX_WORKSPACES: Record<Plan, number> = {
  STARTER: 1,
  GROWTH: 3,
  SCALE: 10,
};

// Crédito de boas-vindas. É GRANT e não franquia porque franquia renovaria todo
// mês para sempre; o lançamento no ledger é o registro de que já foi concedido.
export const TRIAL_CREDITS = 50;

export function maxWorkspaces(plan: Plan): number {
  return MAX_WORKSPACES[plan];
}

// PAST_DUE mantém a franquia: o Stripe recobra por ~2 semanas, cartão vencido
// não é má-fé, e cortar no primeiro erro perde cliente bom. TRIAL e CANCELED
// recebem zero — quem não paga usa o GRANT de boas-vindas e o crédito comprado,
// que não é afetado por status nenhum.
export function effectiveAllowance(plan: Plan, status: SubscriptionStatus): number {
  return status === 'ACTIVE' || status === 'PAST_DUE' ? monthlyAllowance(plan) : 0;
}

function priceToPlan(): Record<string, Plan> {
  const map: Record<string, Plan> = {};
  if (env.STRIPE_PRICE_STARTER) map[env.STRIPE_PRICE_STARTER] = 'STARTER';
  if (env.STRIPE_PRICE_GROWTH) map[env.STRIPE_PRICE_GROWTH] = 'GROWTH';
  if (env.STRIPE_PRICE_SCALE) map[env.STRIPE_PRICE_SCALE] = 'SCALE';
  return map;
}

// Price desconhecido não vira plano: um evento com o price de outra conta ou de
// um produto que não é nosso não pode promover ninguém.
export function planForPrice(priceId: string): Plan | null {
  return priceToPlan()[priceId] ?? null;
}
```

- [ ] **Step 5: Criar o catálogo de pacotes**

Criar `src/billing/credit-packs.ts`:

```ts
import { env } from '../config/env.js';
import { UnknownCreditPackError } from '../lib/errors.js';

const PACK_CREDITS = {
  SMALL: 100,
  MEDIUM: 500,
  LARGE: 2_000,
} as const;

export type PackId = keyof typeof PACK_CREDITS;

export function isPackId(value: string): value is PackId {
  return value in PACK_CREDITS;
}

export function packCredits(id: PackId): number {
  return PACK_CREDITS[id];
}

function packToPrice(): Record<PackId, string | undefined> {
  return {
    SMALL: env.STRIPE_PRICE_PACK_SMALL,
    MEDIUM: env.STRIPE_PRICE_PACK_MEDIUM,
    LARGE: env.STRIPE_PRICE_PACK_LARGE,
  };
}

export function packForPrice(priceId: string): PackId | null {
  const entries = Object.entries(packToPrice()) as [PackId, string | undefined][];
  return entries.find(([, price]) => price === priceId)?.[0] ?? null;
}

// Pacote sem price configurado é erro de operação, não do cliente pedindo
// errado — mas o cliente é quem esbarra nele, então vira 400 com o id no corpo.
export function priceForPack(id: PackId): string {
  const price = packToPrice()[id];
  if (!price) throw new UnknownCreditPackError({ packId: id });
  return price;
}
```

- [ ] **Step 6: Rodar os testes e ver passar**

Run: `pnpm vitest run src/billing/plan-catalog.test.ts src/billing/credit-packs.test.ts`
Expected: FAIL ainda — `UnknownCreditPackError` não existe. Ela nasce na Task 4. Comente o `import` e o `throw` **temporariamente** por `throw new Error('credit pack price not configured')`, veja PASS, e a Task 4 devolve o erro do catálogo.

- [ ] **Step 7: Commit**

```bash
git add src/billing/plan-catalog.ts src/billing/plan-catalog.test.ts src/billing/credit-packs.ts src/billing/credit-packs.test.ts vitest.config.ts
git commit -m "feat(billing): effective allowance, workspace cap and credit pack catalog"
```

---

## Task 3: B2a passa a ler plano e status da organização

**Files:**
- Modify: `src/billing/credit.repository.ts`, `src/billing/credit.repository.test.ts`
- Modify: `src/billing/credit.service.ts`, `src/billing/credit.service.test.ts`
- Modify: `src/http/api/credits/credits.test.ts`

**Interfaces:**
- Consumes: `effectiveAllowance` (Task 2); `Organization.plan`/`subscriptionStatus` (Task 1).
- Produces: `type WorkspaceBilling = { plan: Plan; status: SubscriptionStatus }`; `creditRepository.workspaceBilling(workspaceId): Promise<WorkspaceBilling>` (substitui `workspacePlan`). O shape de resposta de `GET /credits` **não muda**.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `src/billing/credit.service.test.ts`:

```ts
describe('subscription status drives the allowance', () => {
  it('denies a canceled organization the plan allowance', async () => {
    const repo = repoFake({ plan: 'GROWTH', status: 'CANCELED' });
    const service = createCreditService({ repo });

    const result = await service.authorizeAndCharge({
      workspaceId: 'ws-1',
      taskType: 'summarize-business-context',
      agentRunId: 'run-1',
      byok: false,
      now: new Date('2026-07-15T00:00:00Z'),
    });

    expect(result).toMatchObject({ allowed: false, available: 0 });
  });

  it('keeps paying a past_due organization', async () => {
    const repo = repoFake({ plan: 'GROWTH', status: 'PAST_DUE' });
    const service = createCreditService({ repo });

    const result = await service.authorizeAndCharge({
      workspaceId: 'ws-1',
      taskType: 'summarize-business-context',
      agentRunId: 'run-1',
      byok: false,
      now: new Date('2026-07-15T00:00:00Z'),
    });

    expect(result).toMatchObject({ allowed: true });
  });

  it('reports the effective allowance in the summary', async () => {
    const repo = repoFake({ plan: 'SCALE', status: 'TRIAL' });
    const summary = await createCreditService({ repo }).summary('ws-1', new Date('2026-07-15T00:00:00Z'));

    expect(summary).toMatchObject({ plan: 'SCALE', allowance: 0 });
  });
});
```

Ajustar o `repoFake` existente do arquivo para aceitar `{ plan, status }` e expor `workspaceBilling` no lugar de `workspacePlan`. Se o fake atual devolve um plano fixo, o parâmetro ganha default `{ plan: 'STARTER', status: 'ACTIVE' }` para os testes já escritos continuarem verdes sem edição — `ACTIVE` é o único status que preserva o comportamento que eles assumem.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/billing/credit.service.test.ts`
Expected: FAIL — `repo.workspaceBilling is not a function`.

- [ ] **Step 3: Trocar o método do repositório**

Em `src/billing/credit.repository.ts`, substituir `workspacePlan` por:

```ts
export type WorkspaceBilling = { plan: Plan; status: SubscriptionStatus };
```

```ts
    // O plano vive na organização desde o B2b: quem assina é quem tem cartão e
    // CNPJ, e o workspace herda.
    async workspaceBilling(workspaceId: string): Promise<WorkspaceBilling> {
      const workspace = await prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { organization: { select: { plan: true, subscriptionStatus: true } } },
      });
      return { plan: workspace.organization.plan, status: workspace.organization.subscriptionStatus };
    },
```

O import do topo passa a incluir `SubscriptionStatus`.

- [ ] **Step 4: Trocar a franquia no serviço**

Em `src/billing/credit.service.ts`, trocar o import `monthlyAllowance` por `effectiveAllowance`, e:

Em `authorizeAndCharge`:

```ts
      const required = creditCost(input.taskType);
      const { plan, status } = await repo.workspaceBilling(input.workspaceId);
      const periodStart = startOfMonthUtc(input.now);

      return repo.transaction(async (tx) => {
        const period = await tx.lockPeriod(input.workspaceId, periodStart, effectiveAllowance(plan, status));
```

Em `summary`:

```ts
      const { plan, status } = await repo.workspaceBilling(workspaceId);
      const periodStart = startOfMonthUtc(now);
      const period = await repo.findPeriod(workspaceId, periodStart);
      const purchasedBalance = await repo.purchasedBalance(workspaceId);

      return {
        plan,
        allowance: period?.allowance ?? effectiveAllowance(plan, status),
```

- [ ] **Step 5: Ajustar os fakes de Prisma dos testes de rota**

Em `src/http/api/credits/credits.test.ts`, o `prismaFake` devolve `{ plan: 'STARTER' }` de `workspace.findUniqueOrThrow`. Trocar por:

```ts
    workspace: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({ organization: { plan: 'STARTER', subscriptionStatus: 'ACTIVE' } }),
    },
```

- [ ] **Step 6: Rodar tudo e ver passar**

Run: `pnpm typecheck && pnpm test`
Expected: PASS. Qualquer chamada remanescente de `workspacePlan` aparece como erro de tipo — corrija-a para `workspaceBilling`.

- [ ] **Step 7: Commit**

```bash
git add src/billing/credit.repository.ts src/billing/credit.repository.test.ts src/billing/credit.service.ts src/billing/credit.service.test.ts src/http/api/credits/credits.test.ts
git commit -m "feat(billing): allowance follows the organization subscription status"
```

---

## Task 4: Erros e locales

**Files:**
- Modify: `src/shared/errors/catalog.ts`, `src/lib/errors.ts`
- Modify: `src/shared/errors/i18n/pt-BR.json`, `src/shared/errors/i18n/en-US.json`, `src/shared/errors/i18n/es-ES.json`
- Modify: `src/shared/errors/i18n.test.ts`
- Modify: `src/billing/credit-packs.ts` (devolve o `throw` real do Step 6 da Task 2)

**Interfaces:**
- Consumes: nada.
- Produces: `BillingNotConfiguredError` (`AUR-T0016`, 500), `WorkspaceLimitReachedError({ current, max })` (`AUR-T0017`, 403), `UnknownCreditPackError({ packId })` (`AUR-T0018`, 400).

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `src/shared/errors/i18n.test.ts`:

```ts
import { UnknownCreditPackError, WorkspaceLimitReachedError } from '../../lib/errors.js';

describe('billing errors', () => {
  it('tells the user which plan limit they hit', () => {
    const error = new WorkspaceLimitReachedError({ current: 1, max: 1 });
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe('AUR-T0017');
    expect(error.message).toContain('1');
  });

  it('names the pack it does not know', () => {
    const error = new UnknownCreditPackError({ packId: 'HUGE' });
    expect(error.statusCode).toBe(400);
    expect(error.message).toContain('HUGE');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/shared/errors/i18n.test.ts`
Expected: FAIL — `WorkspaceLimitReachedError` não existe.

- [ ] **Step 3: Acrescentar ao catálogo**

Em `src/shared/errors/catalog.ts`, dentro de `CATALOG`, após `ENCRYPTION_NOT_CONFIGURED`:

```ts
  BILLING_NOT_CONFIGURED: { code: 'AUR-T0016', status: 500 },
  WORKSPACE_LIMIT_REACHED: { code: 'AUR-T0017', status: 403 },
  UNKNOWN_CREDIT_PACK: { code: 'AUR-T0018', status: 400 },
```

- [ ] **Step 4: Acrescentar as classes**

No fim de `src/lib/errors.ts`:

```ts
export class BillingNotConfiguredError extends AppError {
  constructor() {
    const def = getErrorDef('BILLING_NOT_CONFIGURED');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class WorkspaceLimitReachedError extends AppError {
  constructor(params: { current: number; max: number }) {
    const def = getErrorDef('WORKSPACE_LIMIT_REACHED');
    super(def.status, def.code, translateError(def.code, 'pt-BR', params), params);
  }
}

export class UnknownCreditPackError extends AppError {
  constructor(params: { packId: string }) {
    const def = getErrorDef('UNKNOWN_CREDIT_PACK');
    super(def.status, def.code, translateError(def.code, 'pt-BR', params), params);
  }
}
```

- [ ] **Step 5: Traduzir nos três locales**

`pt-BR.json`:

```json
  "AUR-T0016": "Cobrança não configurada.",
  "AUR-T0017": "Seu plano permite {{max}} workspace(s) e você já tem {{current}}.",
  "AUR-T0018": "Pacote de crédito desconhecido: {{packId}}"
```

`en-US.json`:

```json
  "AUR-T0016": "Billing is not configured.",
  "AUR-T0017": "Your plan allows {{max}} workspace(s) and you already have {{current}}.",
  "AUR-T0018": "Unknown credit pack: {{packId}}"
```

`es-ES.json`:

```json
  "AUR-T0016": "La facturación no está configurada.",
  "AUR-T0017": "Tu plan permite {{max}} workspace(s) y ya tienes {{current}}.",
  "AUR-T0018": "Paquete de créditos desconocido: {{packId}}"
```

Atenção à vírgula da última chave existente (`AUR-T0015`) nos três arquivos.

- [ ] **Step 6: Devolver o throw real ao catálogo de pacotes**

Em `src/billing/credit-packs.ts`, desfazer o remendo do Step 6 da Task 2: reintroduzir `import { UnknownCreditPackError } from '../lib/errors.js';` e `throw new UnknownCreditPackError({ packId: id });`.

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm typecheck && pnpm test`
Expected: PASS, incluindo a paridade de chaves entre os três locales.

- [ ] **Step 8: Commit**

```bash
git add src/shared/errors src/lib/errors.ts src/billing/credit-packs.ts
git commit -m "feat(errors): billing configuration, workspace limit and credit pack errors"
```

---

## Task 5: Configuração

**Files:**
- Modify: `src/config/env.ts`, `src/config/env.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: nada.
- Produces: `env.STRIPE_SECRET_KEY`, `env.STRIPE_WEBHOOK_SECRET`, `env.STRIPE_PRICE_STARTER|_GROWTH|_SCALE`, `env.STRIPE_PRICE_PACK_SMALL|_MEDIUM|_LARGE` (todos `string | undefined`), `env.APP_URL` (`string`, default `http://localhost:5173`).

> O Step 1 deste task é pré-requisito da Task 2. Execute-o antes dela e volte para os demais steps depois, ou execute a Task 5 inteira primeiro.

- [ ] **Step 1: Acrescentar as chaves ao schema**

Em `src/config/env.ts`, depois do bloco `AI_*`:

```ts
  // Ausente desliga as rotas de billing e a rota do webhook: melhor a rota não
  // existir do que existir sem verificação de assinatura.
  STRIPE_SECRET_KEY: optionalText,
  STRIPE_WEBHOOK_SECRET: optionalText,
  STRIPE_PRICE_STARTER: optionalText,
  STRIPE_PRICE_GROWTH: optionalText,
  STRIPE_PRICE_SCALE: optionalText,
  STRIPE_PRICE_PACK_SMALL: optionalText,
  STRIPE_PRICE_PACK_MEDIUM: optionalText,
  STRIPE_PRICE_PACK_LARGE: optionalText,

  // Base do success/cancel do checkout e do retorno do portal. É o front, não a API.
  APP_URL: z.string().url().default('http://localhost:5173'),
```

- [ ] **Step 2: Escrever o teste que falha**

Acrescentar a `src/config/env.test.ts`, seguindo o padrão de parse já usado no arquivo:

```ts
describe('stripe configuration', () => {
  it('treats a blank stripe key as absent', () => {
    const parsed = envSchema.parse({ ...baseEnv, STRIPE_SECRET_KEY: '  ' });
    expect(parsed.STRIPE_SECRET_KEY).toBeUndefined();
  });

  it('defaults APP_URL to the local frontend', () => {
    expect(envSchema.parse(baseEnv).APP_URL).toBe('http://localhost:5173');
  });

  it('rejects an APP_URL that is not a url', () => {
    expect(() => envSchema.parse({ ...baseEnv, APP_URL: 'localhost:5173' })).toThrow();
  });
});
```

(`baseEnv` é o objeto mínimo válido já definido no arquivo; se ele não existir com esse nome, use o que o arquivo usa.)

- [ ] **Step 3: Rodar e ver passar**

Run: `pnpm vitest run src/config/env.test.ts`
Expected: PASS — o Step 1 já implementou. Se falhar, o schema está errado, não o teste.

- [ ] **Step 4: Documentar no `.env.example`**

No fim de `.env.example`:

```bash
# Stripe (test mode). Chave secreta ausente desliga as rotas de billing;
# webhook secret ausente não registra a rota do webhook.
# Em desenvolvimento: stripe listen --forward-to localhost:3337/webhooks/stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_STARTER=price_1Ty1LkAZf2sIrmumUQ9PZCQD
STRIPE_PRICE_GROWTH=price_1Ty1M0AZf2sIrmumF49lbgtg
STRIPE_PRICE_SCALE=price_1Ty1MIAZf2sIrmumPc0MybUw
STRIPE_PRICE_PACK_SMALL=price_1Ty1MfAZf2sIrmum1IO1C11g
STRIPE_PRICE_PACK_MEDIUM=price_1Ty1MiAZf2sIrmumJ6LZ0AFL
STRIPE_PRICE_PACK_LARGE=price_1Ty1N1AZf2sIrmumVF5nwt4V

# Base do success/cancel do checkout e do retorno do portal
APP_URL=http://localhost:5173
```

- [ ] **Step 5: Commit**

```bash
git add src/config/env.ts src/config/env.test.ts .env.example
git commit -m "feat(config): stripe keys, price ids and the app url"
```

---

## Task 6: Cliente Stripe

**Files:**
- Create: `src/billing/stripe-client.ts`, `src/billing/stripe-client.test.ts`
- Modify: `package.json` (dependência `stripe`)

**Interfaces:**
- Consumes: `env` (Task 5), `BillingNotConfiguredError` (Task 4).
- Produces:

```ts
export type StripeSubscriptionStatus =
  | 'active' | 'past_due' | 'canceled' | 'trialing'
  | 'incomplete' | 'incomplete_expired' | 'unpaid' | 'paused';

export type SubscriptionSnapshot = {
  subscriptionId: string;
  priceId: string;
  status: StripeSubscriptionStatus;
  currentPeriodEnd: Date;
  metadata: Record<string, string>;
};

export type PaidSession = {
  sessionId: string;
  metadata: Record<string, string>;
};

export type StripeEventPayload = { id: string; type: string; object: unknown };

export type StripeClient = {
  ensureCustomer(input: { organizationId: string; email: string; name: string }): Promise<string>;
  createSubscriptionCheckout(input: {
    customerId: string; priceId: string; organizationId: string; workspaceId: string;
    successUrl: string; cancelUrl: string;
  }): Promise<{ url: string }>;
  createPackCheckout(input: {
    customerId: string; priceId: string; organizationId: string; workspaceId: string; packId: string;
    successUrl: string; cancelUrl: string;
  }): Promise<{ url: string }>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  constructEvent(rawBody: Buffer, signature: string): StripeEventPayload;
  fetchSubscription(customerId: string): Promise<SubscriptionSnapshot | null>;
  listRecentPaidSessions(customerId: string): Promise<PaidSession[]>;
};

export function createStripeClient(): StripeClient;      // lança BillingNotConfiguredError sem chave
export function isBillingConfigured(): boolean;
export function toSubscriptionSnapshot(raw: RawSubscription): SubscriptionSnapshot;  // puro, testável
```

- [ ] **Step 1: Instalar a SDK**

Run: `pnpm add stripe`
Expected: `stripe` em `dependencies` (v19 ou superior).

- [ ] **Step 2: Escrever o teste que falha**

Criar `src/billing/stripe-client.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toSubscriptionSnapshot } from './stripe-client.js';

// current_period_end saiu da Subscription e vive no SubscriptionItem desde as
// versões recentes da API. Ler do lugar errado devolve undefined e grava um
// currentPeriodEnd inválido — este teste é o que trava esse erro.
const RAW = {
  id: 'sub_123',
  status: 'active',
  metadata: { organizationId: 'org-1', workspaceId: 'ws-1' },
  items: {
    data: [{ current_period_end: 1_790_000_000, price: { id: 'price_test_growth' } }],
  },
};

describe('toSubscriptionSnapshot', () => {
  it('reads the price and the period end off the subscription item', () => {
    expect(toSubscriptionSnapshot(RAW)).toEqual({
      subscriptionId: 'sub_123',
      priceId: 'price_test_growth',
      status: 'active',
      currentPeriodEnd: new Date(1_790_000_000 * 1000),
      metadata: { organizationId: 'org-1', workspaceId: 'ws-1' },
    });
  });

  it('refuses a subscription with no item', () => {
    expect(() => toSubscriptionSnapshot({ ...RAW, items: { data: [] } })).toThrow();
  });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm vitest run src/billing/stripe-client.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 4: Implementar o cliente**

Criar `src/billing/stripe-client.ts`:

```ts
import Stripe from 'stripe';
import { env } from '../config/env.js';
import { BillingNotConfiguredError } from '../lib/errors.js';

export type StripeSubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'trialing'
  | 'incomplete'
  | 'incomplete_expired'
  | 'unpaid'
  | 'paused';

export type SubscriptionSnapshot = {
  subscriptionId: string;
  priceId: string;
  status: StripeSubscriptionStatus;
  currentPeriodEnd: Date;
  metadata: Record<string, string>;
};

export type PaidSession = {
  sessionId: string;
  metadata: Record<string, string>;
};

export type StripeEventPayload = { id: string; type: string; object: unknown };

export type StripeClient = {
  ensureCustomer(input: { organizationId: string; email: string; name: string }): Promise<string>;
  createSubscriptionCheckout(input: {
    customerId: string;
    priceId: string;
    organizationId: string;
    workspaceId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }>;
  createPackCheckout(input: {
    customerId: string;
    priceId: string;
    organizationId: string;
    workspaceId: string;
    packId: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  constructEvent(rawBody: Buffer, signature: string): StripeEventPayload;
  fetchSubscription(customerId: string): Promise<SubscriptionSnapshot | null>;
  listRecentPaidSessions(customerId: string): Promise<PaidSession[]>;
};

type RawSubscriptionItem = { current_period_end: number; price: { id: string } };
export type RawSubscription = {
  id: string;
  status: string;
  metadata?: Record<string, string> | null;
  items: { data: RawSubscriptionItem[] };
};

// O fim do período corrente vive no item da assinatura, não na assinatura.
// Assinatura sem item é assinatura que não sabemos precificar: falha alto em
// vez de gravar um período inválido.
export function toSubscriptionSnapshot(raw: RawSubscription): SubscriptionSnapshot {
  const item = raw.items.data[0];
  if (!item) throw new Error(`subscription ${raw.id} has no item`);

  return {
    subscriptionId: raw.id,
    priceId: item.price.id,
    status: raw.status as StripeSubscriptionStatus,
    currentPeriodEnd: new Date(item.current_period_end * 1000),
    metadata: raw.metadata ?? {},
  };
}

export function isBillingConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

export function createStripeClient(): StripeClient {
  const secret = env.STRIPE_SECRET_KEY;
  if (!secret) throw new BillingNotConfiguredError();

  const stripe = new Stripe(secret);

  return {
    // Um Customer por organização. `search` em vez de guardar-e-torcer: se o id
    // gravado sumiu (conta trocada, banco restaurado), reencontra pelo metadata.
    async ensureCustomer(input) {
      const found = await stripe.customers.search({
        query: `metadata['organizationId']:'${input.organizationId}'`,
        limit: 1,
      });
      const existing = found.data[0];
      if (existing) return existing.id;

      const created = await stripe.customers.create({
        email: input.email,
        name: input.name,
        metadata: { organizationId: input.organizationId },
      });
      return created.id;
    },

    async createSubscriptionCheckout(input) {
      const metadata = { organizationId: input.organizationId, workspaceId: input.workspaceId };
      const session = await stripe.checkout.sessions.create({
        customer: input.customerId,
        mode: 'subscription',
        line_items: [{ price: input.priceId, quantity: 1 }],
        allow_promotion_codes: true,
        metadata,
        // A assinatura precisa carregar o metadata também: os eventos
        // customer.subscription.* não veem o metadata da sessão, e sem o
        // workspaceId o upgrade no meio do mês não sabe onde lançar a diferença.
        subscription_data: { metadata },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      });
      if (!session.url) throw new Error('stripe returned a checkout session without a url');
      return { url: session.url };
    },

    async createPackCheckout(input) {
      const session = await stripe.checkout.sessions.create({
        customer: input.customerId,
        mode: 'payment',
        line_items: [{ price: input.priceId, quantity: 1 }],
        allow_promotion_codes: true,
        // packId no metadata: o payload do webhook não traz line_items, então é
        // por aqui que o handler descobre quantos créditos lançar.
        metadata: {
          organizationId: input.organizationId,
          workspaceId: input.workspaceId,
          packId: input.packId,
        },
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
      });
      if (!session.url) throw new Error('stripe returned a checkout session without a url');
      return { url: session.url };
    },

    async createPortalSession(input) {
      const session = await stripe.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
      });
      return { url: session.url };
    },

    constructEvent(rawBody, signature) {
      const secretWebhook = env.STRIPE_WEBHOOK_SECRET;
      if (!secretWebhook) throw new BillingNotConfiguredError();
      const event = stripe.webhooks.constructEvent(rawBody, signature, secretWebhook);
      return { id: event.id, type: event.type, object: event.data.object };
    },

    async fetchSubscription(customerId) {
      const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 1 });
      const raw = list.data[0];
      return raw ? toSubscriptionSnapshot(raw as unknown as RawSubscription) : null;
    },

    async listRecentPaidSessions(customerId) {
      const list = await stripe.checkout.sessions.list({ customer: customerId, limit: 20 });
      return list.data
        .filter((s) => s.mode === 'payment' && s.payment_status === 'paid')
        .map((s) => ({ sessionId: s.id, metadata: (s.metadata ?? {}) as Record<string, string> }));
    },
  };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm typecheck && pnpm vitest run src/billing/stripe-client.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/billing/stripe-client.ts src/billing/stripe-client.test.ts
git commit -m "feat(billing): thin stripe client behind a testable contract"
```

---

## Task 7: Repositório de billing e crédito idempotente

**Files:**
- Create: `src/billing/billing.repository.ts`
- Modify: `src/billing/credit.repository.ts`
- Modify: `src/billing/credit.service.ts`, `src/billing/credit.service.test.ts`

**Interfaces:**
- Consumes: modelos da Task 1.
- Produces:

```ts
export type OrgBilling = {
  id: string;
  name: string;
  plan: Plan;
  subscriptionStatus: SubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  lastSyncedAt: Date | null;
};

createBillingRepository(prisma): {
  organizationById(id: string): Promise<OrgBilling | null>;
  organizationByCustomerId(customerId: string): Promise<OrgBilling | null>;
  saveCustomerId(organizationId: string, customerId: string): Promise<void>;
  saveSubscription(organizationId: string, input: {
    plan: Plan; status: SubscriptionStatus; subscriptionId: string; currentPeriodEnd: Date;
  }): Promise<void>;
  cancelSubscription(organizationId: string): Promise<void>;
  touchSync(organizationId: string, now: Date): Promise<void>;
  workspaceBelongsTo(workspaceId: string, organizationId: string): Promise<boolean>;
  countActiveWorkspaces(organizationId: string): Promise<number>;
  alreadyProcessed(eventId: string): Promise<boolean>;
  markProcessed(eventId: string, type: string): Promise<void>;
}
```

- e, no B2a: `creditTx.markStripeEvent(id: string, type: string): Promise<boolean>`; `creditService.grantOnce(input: { idempotencyKey: string; kind: string; workspaceId: string; credits: number; reason: string }): Promise<boolean>`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `src/billing/credit.service.test.ts`:

```ts
describe('grantOnce', () => {
  it('grants on the first delivery and refuses the second', async () => {
    const marks = new Set<string>();
    const entries: unknown[] = [];
    const repo = {
      ...repoFake(),
      transaction: async (fn: (tx: never) => Promise<unknown>) =>
        fn({
          markStripeEvent: async (id: string) => (marks.has(id) ? false : (marks.add(id), true)),
          insertEntry: async (entry: unknown) => (entries.push(entry), { id: 'l-1' }),
        } as never),
    };
    const service = createCreditService({ repo: repo as never });

    const input = {
      idempotencyKey: 'cs_123',
      kind: 'checkout.session.completed',
      workspaceId: 'ws-1',
      credits: 100,
      reason: 'credit pack MEDIUM',
    };

    expect(await service.grantOnce(input)).toBe(true);
    expect(await service.grantOnce(input)).toBe(false);
    expect(entries).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/billing/credit.service.test.ts`
Expected: FAIL — `service.grantOnce is not a function`.

- [ ] **Step 3: Marcar o evento dentro da transação do ledger**

Em `src/billing/credit.repository.ts`, dentro de `txApi(tx)`:

```ts
    // A marca de idempotência e o lançamento têm que commitar juntos: marcar
    // antes deixa crédito perdido se o insert falhar, marcar depois credita
    // duas vezes numa entrega concorrente. Por isso o StripeEvent aparece aqui,
    // dentro da transação do ledger, e não só no repositório de billing.
    async markStripeEvent(id: string, type: string): Promise<boolean> {
      const inserted = await tx.$executeRaw`
        INSERT INTO "StripeEvent" ("id", "type", "processedAt")
        VALUES (${id}, ${type}, now())
        ON CONFLICT ("id") DO NOTHING
      `;
      return inserted === 1;
    },
```

- [ ] **Step 4: Acrescentar `grantOnce` ao serviço**

Em `src/billing/credit.service.ts`, junto de `grant`:

```ts
    // Concessão amarrada a um objeto do Stripe: a chave é o id da Checkout
    // Session, não o id do evento, porque a mesma compra chega pelo webhook e
    // pelo /billing/sync com ids de evento diferentes.
    async grantOnce(input: {
      idempotencyKey: string;
      kind: string;
      workspaceId: string;
      credits: number;
      reason: string;
    }): Promise<boolean> {
      if (input.credits <= 0) throw new Error('grant credits must be positive');

      return repo.transaction(async (tx) => {
        const fresh = await tx.markStripeEvent(input.idempotencyKey, input.kind);
        if (!fresh) return false;

        await tx.insertEntry({
          workspaceId: input.workspaceId,
          kind: 'PURCHASE',
          credits: input.credits,
          reason: input.reason,
        });
        return true;
      });
    },
```

- [ ] **Step 5: Criar o repositório de billing**

Criar `src/billing/billing.repository.ts`:

```ts
import type { Plan, PrismaClient, SubscriptionStatus } from '@prisma/client';

export type OrgBilling = {
  id: string;
  name: string;
  plan: Plan;
  subscriptionStatus: SubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  lastSyncedAt: Date | null;
};

const SELECT = {
  id: true,
  name: true,
  plan: true,
  subscriptionStatus: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  currentPeriodEnd: true,
  lastSyncedAt: true,
} as const;

export function createBillingRepository(prisma: PrismaClient) {
  return {
    organizationById(id: string): Promise<OrgBilling | null> {
      return prisma.organization.findUnique({ where: { id }, select: SELECT });
    },

    organizationByCustomerId(customerId: string): Promise<OrgBilling | null> {
      return prisma.organization.findUnique({ where: { stripeCustomerId: customerId }, select: SELECT });
    },

    async saveCustomerId(organizationId: string, customerId: string): Promise<void> {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { stripeCustomerId: customerId },
      });
    },

    async saveSubscription(
      organizationId: string,
      input: { plan: Plan; status: SubscriptionStatus; subscriptionId: string; currentPeriodEnd: Date },
    ): Promise<void> {
      await prisma.organization.update({
        where: { id: organizationId },
        data: {
          plan: input.plan,
          subscriptionStatus: input.status,
          stripeSubscriptionId: input.subscriptionId,
          currentPeriodEnd: input.currentPeriodEnd,
        },
      });
    },

    // Cancelar não mexe no plano gravado: ele explica o que o cliente teve, e a
    // franquia já é zero por causa do status.
    async cancelSubscription(organizationId: string): Promise<void> {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { subscriptionStatus: 'CANCELED' },
      });
    },

    async touchSync(organizationId: string, now: Date): Promise<void> {
      await prisma.organization.update({ where: { id: organizationId }, data: { lastSyncedAt: now } });
    },

    async workspaceBelongsTo(workspaceId: string, organizationId: string): Promise<boolean> {
      const count = await prisma.workspace.count({ where: { id: workspaceId, organizationId } });
      return count > 0;
    },

    countActiveWorkspaces(organizationId: string): Promise<number> {
      return prisma.workspace.count({ where: { organizationId, deletedAt: null, status: 'ACTIVE' } });
    },

    async alreadyProcessed(eventId: string): Promise<boolean> {
      const found = await prisma.stripeEvent.findUnique({ where: { id: eventId }, select: { id: true } });
      return found !== null;
    },

    async markProcessed(eventId: string, type: string): Promise<void> {
      await prisma.$executeRaw`
        INSERT INTO "StripeEvent" ("id", "type", "processedAt")
        VALUES (${eventId}, ${type}, now())
        ON CONFLICT ("id") DO NOTHING
      `;
    },
  };
}

export type BillingRepository = ReturnType<typeof createBillingRepository>;
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/billing/billing.repository.ts src/billing/credit.repository.ts src/billing/credit.service.ts src/billing/credit.service.test.ts
git commit -m "feat(billing): organization billing repository and idempotent grant"
```

---

## Task 8: Normalização de evento

**Files:**
- Create: `src/billing/stripe-event.ts`, `src/billing/stripe-event.test.ts`

**Interfaces:**
- Consumes: `StripeEventPayload`, `SubscriptionSnapshot`, `PaidSession` (Task 6); `planForPrice` (Task 2); `isPackId` (Task 2).
- Produces:

```ts
export type BillingEvent =
  | { kind: 'credit-purchase'; sourceId: string; organizationId: string; workspaceId: string; packId: PackId }
  | { kind: 'subscription-state'; customerId: string; subscriptionId: string; plan: Plan;
      status: SubscriptionStatus; currentPeriodEnd: Date; workspaceId: string | null }
  | { kind: 'subscription-canceled'; customerId: string }
  | { kind: 'ignored'; reason: string };

export function toSubscriptionStatus(stripeStatus: string): SubscriptionStatus;
export function normalizeEvent(payload: StripeEventPayload): BillingEvent;
export function eventFromSnapshot(customerId: string, snapshot: SubscriptionSnapshot): BillingEvent;
export function eventFromPaidSession(session: PaidSession): BillingEvent;
```

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/billing/stripe-event.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { eventFromPaidSession, normalizeEvent, toSubscriptionStatus } from './stripe-event.js';

const SUB_PAYLOAD = {
  id: 'evt_1',
  type: 'customer.subscription.updated',
  object: {
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    metadata: { organizationId: 'org-1', workspaceId: 'ws-1' },
    items: { data: [{ current_period_end: 1_790_000_000, price: { id: 'price_test_growth' } }] },
  },
};

describe('toSubscriptionStatus', () => {
  it('maps the paying states', () => {
    expect(toSubscriptionStatus('active')).toBe('ACTIVE');
    expect(toSubscriptionStatus('trialing')).toBe('ACTIVE');
  });

  it('maps the retry window', () => {
    expect(toSubscriptionStatus('past_due')).toBe('PAST_DUE');
    expect(toSubscriptionStatus('unpaid')).toBe('PAST_DUE');
  });

  it('fails closed on anything else', () => {
    expect(toSubscriptionStatus('incomplete')).toBe('CANCELED');
    expect(toSubscriptionStatus('something_new_stripe_invented')).toBe('CANCELED');
  });
});

describe('normalizeEvent', () => {
  it('turns a subscription update into state', () => {
    expect(normalizeEvent(SUB_PAYLOAD)).toEqual({
      kind: 'subscription-state',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      plan: 'GROWTH',
      status: 'ACTIVE',
      currentPeriodEnd: new Date(1_790_000_000 * 1000),
      workspaceId: 'ws-1',
    });
  });

  it('ignores a subscription on a price that is not ours', () => {
    const foreign = {
      ...SUB_PAYLOAD,
      object: { ...SUB_PAYLOAD.object, items: { data: [{ current_period_end: 1, price: { id: 'price_x' } }] } },
    };
    expect(normalizeEvent(foreign)).toMatchObject({ kind: 'ignored' });
  });

  it('turns a paid checkout session into a credit purchase', () => {
    const payload = {
      id: 'evt_2',
      type: 'checkout.session.completed',
      object: {
        id: 'cs_1',
        mode: 'payment',
        payment_status: 'paid',
        customer: 'cus_1',
        metadata: { organizationId: 'org-1', workspaceId: 'ws-1', packId: 'MEDIUM' },
      },
    };

    expect(normalizeEvent(payload)).toEqual({
      kind: 'credit-purchase',
      sourceId: 'cs_1',
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      packId: 'MEDIUM',
    });
  });

  it('ignores a subscription-mode checkout: the subscription event already says it', () => {
    const payload = {
      id: 'evt_3',
      type: 'checkout.session.completed',
      object: { id: 'cs_2', mode: 'subscription', payment_status: 'paid', metadata: {} },
    };
    expect(normalizeEvent(payload)).toMatchObject({ kind: 'ignored' });
  });

  it('ignores a pack id it does not know', () => {
    const payload = {
      id: 'evt_4',
      type: 'checkout.session.completed',
      object: {
        id: 'cs_3',
        mode: 'payment',
        payment_status: 'paid',
        metadata: { organizationId: 'org-1', workspaceId: 'ws-1', packId: 'HUGE' },
      },
    };
    expect(normalizeEvent(payload)).toMatchObject({ kind: 'ignored' });
  });

  it('turns a deletion into a cancellation', () => {
    const payload = {
      id: 'evt_5',
      type: 'customer.subscription.deleted',
      object: { id: 'sub_1', customer: 'cus_1' },
    };
    expect(normalizeEvent(payload)).toEqual({ kind: 'subscription-canceled', customerId: 'cus_1' });
  });

  it('ignores an event type it does not handle', () => {
    expect(normalizeEvent({ id: 'evt_6', type: 'invoice.paid', object: {} })).toMatchObject({ kind: 'ignored' });
  });
});

describe('eventFromPaidSession', () => {
  it('produces the same purchase event the webhook produces', () => {
    expect(
      eventFromPaidSession({
        sessionId: 'cs_1',
        metadata: { organizationId: 'org-1', workspaceId: 'ws-1', packId: 'SMALL' },
      }),
    ).toEqual({
      kind: 'credit-purchase',
      sourceId: 'cs_1',
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      packId: 'SMALL',
    });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/billing/stripe-event.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

Criar `src/billing/stripe-event.ts`:

```ts
import type { Plan, SubscriptionStatus } from '@prisma/client';
import { isPackId, type PackId } from './credit-packs.js';
import { planForPrice } from './plan-catalog.js';
import type { PaidSession, StripeEventPayload, SubscriptionSnapshot } from './stripe-client.js';

export type BillingEvent =
  | { kind: 'credit-purchase'; sourceId: string; organizationId: string; workspaceId: string; packId: PackId }
  | {
      kind: 'subscription-state';
      customerId: string;
      subscriptionId: string;
      plan: Plan;
      status: SubscriptionStatus;
      currentPeriodEnd: Date;
      workspaceId: string | null;
    }
  | { kind: 'subscription-canceled'; customerId: string }
  | { kind: 'ignored'; reason: string };

// Fail closed: status que não conhecemos não paga franquia. Um estado novo
// inventado pelo Stripe não pode virar crédito de graça por omissão.
export function toSubscriptionStatus(stripeStatus: string): SubscriptionStatus {
  if (stripeStatus === 'active' || stripeStatus === 'trialing') return 'ACTIVE';
  if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') return 'PAST_DUE';
  return 'CANCELED';
}

function asRecord(value: unknown): Record<string, unknown> {
  return (value ?? {}) as Record<string, unknown>;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function purchaseFrom(sessionId: string, metadata: Record<string, unknown>): BillingEvent {
  const organizationId = text(metadata.organizationId);
  const workspaceId = text(metadata.workspaceId);
  const packId = text(metadata.packId);

  // Sem metadata, o pagamento existe e não sabemos onde creditar. Ignorar é a
  // única saída honesta: creditar por adivinhação é pior que não creditar.
  if (!organizationId || !workspaceId || !packId) return { kind: 'ignored', reason: 'purchase without metadata' };
  if (!isPackId(packId)) return { kind: 'ignored', reason: `unknown pack ${packId}` };

  return { kind: 'credit-purchase', sourceId: sessionId, organizationId, workspaceId, packId };
}

function subscriptionFrom(customerId: string, raw: Record<string, unknown>): BillingEvent {
  const items = asRecord(raw.items).data as { current_period_end: number; price: { id: string } }[] | undefined;
  const item = items?.[0];
  if (!item) return { kind: 'ignored', reason: 'subscription without item' };

  const plan = planForPrice(item.price.id);
  if (!plan) return { kind: 'ignored', reason: `unknown price ${item.price.id}` };

  const subscriptionId = text(raw.id);
  if (!subscriptionId) return { kind: 'ignored', reason: 'subscription without id' };

  return {
    kind: 'subscription-state',
    customerId,
    subscriptionId,
    plan,
    status: toSubscriptionStatus(String(raw.status)),
    currentPeriodEnd: new Date(item.current_period_end * 1000),
    workspaceId: text(asRecord(raw.metadata).workspaceId),
  };
}

export function normalizeEvent(payload: StripeEventPayload): BillingEvent {
  const object = asRecord(payload.object);
  const customerId = text(object.customer);

  if (payload.type === 'checkout.session.completed') {
    // Só o pagamento avulso interessa aqui: o checkout de assinatura já dispara
    // customer.subscription.created. Um caminho, uma verdade.
    if (object.mode !== 'payment') return { kind: 'ignored', reason: 'not a one-off payment' };
    if (object.payment_status !== 'paid') return { kind: 'ignored', reason: 'session not paid' };
    const sessionId = text(object.id);
    if (!sessionId) return { kind: 'ignored', reason: 'session without id' };
    return purchaseFrom(sessionId, asRecord(object.metadata));
  }

  if (payload.type === 'customer.subscription.created' || payload.type === 'customer.subscription.updated') {
    if (!customerId) return { kind: 'ignored', reason: 'subscription without customer' };
    return subscriptionFrom(customerId, object);
  }

  if (payload.type === 'customer.subscription.deleted') {
    if (!customerId) return { kind: 'ignored', reason: 'subscription without customer' };
    return { kind: 'subscription-canceled', customerId };
  }

  return { kind: 'ignored', reason: `unhandled type ${payload.type}` };
}

// O sync entrega o mesmo BillingEvent que o webhook entrega. Não é uma segunda
// implementação da regra; é outro jeito de entregar o mesmo evento.
export function eventFromSnapshot(customerId: string, snapshot: SubscriptionSnapshot): BillingEvent {
  return subscriptionFrom(customerId, {
    id: snapshot.subscriptionId,
    status: snapshot.status,
    metadata: snapshot.metadata,
    items: { data: [{ current_period_end: Math.floor(snapshot.currentPeriodEnd.getTime() / 1000), price: { id: snapshot.priceId } }] },
  });
}

export function eventFromPaidSession(session: PaidSession): BillingEvent {
  return purchaseFrom(session.sessionId, session.metadata);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/billing/stripe-event.test.ts`
Expected: PASS (11 testes).

- [ ] **Step 5: Commit**

```bash
git add src/billing/stripe-event.ts src/billing/stripe-event.test.ts
git commit -m "feat(billing): normalize stripe payloads into billing events"
```

---

## Task 9: Aplicação do evento

**Files:**
- Create: `src/billing/subscription.service.ts`, `src/billing/subscription.service.test.ts`

**Interfaces:**
- Consumes: `BillingRepository` (Task 7), `CreditService` (Task 7), `BillingEvent` (Task 8), `effectiveAllowance`/`packCredits` (Task 2).
- Produces:

```ts
createSubscriptionService(deps: {
  repo: BillingRepository;
  credits: Pick<CreditService, 'grant' | 'grantOnce'>;
  log?: (info: { event: string; result: string }) => void;
}): {
  apply(event: BillingEvent, now: Date): Promise<'applied' | 'ignored'>;
}
```

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/billing/subscription.service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSubscriptionService } from './subscription.service.js';
import type { BillingEvent } from './stripe-event.js';

const PERIOD_END = new Date('2026-08-01T00:00:00Z');
const NOW = new Date('2026-07-15T00:00:00Z');

function org(overrides: Record<string, unknown> = {}) {
  return {
    id: 'org-1',
    name: 'Acme',
    plan: 'STARTER',
    subscriptionStatus: 'TRIAL',
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: null,
    currentPeriodEnd: null,
    lastSyncedAt: null,
    ...overrides,
  };
}

function deps(organization = org()) {
  const repo = {
    organizationById: vi.fn().mockResolvedValue(organization),
    organizationByCustomerId: vi.fn().mockResolvedValue(organization),
    saveSubscription: vi.fn().mockResolvedValue(undefined),
    cancelSubscription: vi.fn().mockResolvedValue(undefined),
    workspaceBelongsTo: vi.fn().mockResolvedValue(true),
  };
  const credits = { grant: vi.fn().mockResolvedValue(undefined), grantOnce: vi.fn().mockResolvedValue(true) };
  return { repo, credits };
}

const purchase: BillingEvent = {
  kind: 'credit-purchase',
  sourceId: 'cs_1',
  organizationId: 'org-1',
  workspaceId: 'ws-1',
  packId: 'MEDIUM',
};

function upgrade(plan: 'STARTER' | 'GROWTH' | 'SCALE', workspaceId: string | null = 'ws-1'): BillingEvent {
  return {
    kind: 'subscription-state',
    customerId: 'cus_1',
    subscriptionId: 'sub_1',
    plan,
    status: 'ACTIVE',
    currentPeriodEnd: PERIOD_END,
    workspaceId,
  };
}

describe('credit purchase', () => {
  it('grants the pack credits once, keyed by the session id', async () => {
    const d = deps();
    const service = createSubscriptionService(d as never);

    expect(await service.apply(purchase, NOW)).toBe('applied');
    expect(d.credits.grantOnce).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'cs_1', workspaceId: 'ws-1', credits: 500 }),
    );
  });

  it('credits nothing when the metadata points at another organization', async () => {
    const d = deps();
    d.repo.workspaceBelongsTo.mockResolvedValue(false);
    const service = createSubscriptionService(d as never);

    expect(await service.apply(purchase, NOW)).toBe('ignored');
    expect(d.credits.grantOnce).not.toHaveBeenCalled();
  });

  it('credits nothing when the organization has no stripe customer', async () => {
    const d = deps(org({ stripeCustomerId: null }));
    const service = createSubscriptionService(d as never);

    expect(await service.apply(purchase, NOW)).toBe('ignored');
    expect(d.credits.grantOnce).not.toHaveBeenCalled();
  });
});

describe('subscription state', () => {
  it('writes plan, status and period end', async () => {
    const d = deps();
    await createSubscriptionService(d as never).apply(upgrade('GROWTH'), NOW);

    expect(d.repo.saveSubscription).toHaveBeenCalledWith('org-1', {
      plan: 'GROWTH',
      status: 'ACTIVE',
      subscriptionId: 'sub_1',
      currentPeriodEnd: PERIOD_END,
    });
  });

  it('grants exactly the difference when the plan goes up mid-period', async () => {
    const d = deps(org({ plan: 'STARTER', subscriptionStatus: 'ACTIVE' }));
    await createSubscriptionService(d as never).apply(upgrade('GROWTH'), NOW);

    // GROWTH 1000 − STARTER 200
    expect(d.credits.grant).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', credits: 800 }),
    );
  });

  it('grants the full allowance when the organization was on trial', async () => {
    const d = deps(org({ plan: 'STARTER', subscriptionStatus: 'TRIAL' }));
    await createSubscriptionService(d as never).apply(upgrade('STARTER'), NOW);

    expect(d.credits.grant).toHaveBeenCalledWith(expect.objectContaining({ credits: 200 }));
  });

  it('grants nothing on a downgrade', async () => {
    const d = deps(org({ plan: 'SCALE', subscriptionStatus: 'ACTIVE' }));
    await createSubscriptionService(d as never).apply(upgrade('GROWTH'), NOW);

    expect(d.credits.grant).not.toHaveBeenCalled();
  });

  it('grants nothing twice for the same state', async () => {
    const d = deps(org({ plan: 'GROWTH', subscriptionStatus: 'ACTIVE' }));
    await createSubscriptionService(d as never).apply(upgrade('GROWTH'), NOW);

    expect(d.credits.grant).not.toHaveBeenCalled();
  });

  it('skips the delta when the subscription carries no workspace', async () => {
    const d = deps(org({ plan: 'STARTER', subscriptionStatus: 'ACTIVE' }));
    await createSubscriptionService(d as never).apply(upgrade('GROWTH', null), NOW);

    expect(d.repo.saveSubscription).toHaveBeenCalled();
    expect(d.credits.grant).not.toHaveBeenCalled();
  });

  it('ignores a customer it does not know', async () => {
    const d = deps();
    d.repo.organizationByCustomerId.mockResolvedValue(null);

    expect(await createSubscriptionService(d as never).apply(upgrade('GROWTH'), NOW)).toBe('ignored');
    expect(d.repo.saveSubscription).not.toHaveBeenCalled();
  });
});

describe('cancellation', () => {
  it('marks the organization canceled', async () => {
    const d = deps();
    await createSubscriptionService(d as never).apply({ kind: 'subscription-canceled', customerId: 'cus_1' }, NOW);

    expect(d.repo.cancelSubscription).toHaveBeenCalledWith('org-1');
  });
});

describe('ignored events', () => {
  it('does nothing and does not throw', async () => {
    const d = deps();
    expect(await createSubscriptionService(d as never).apply({ kind: 'ignored', reason: 'x' }, NOW)).toBe('ignored');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/billing/subscription.service.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

Criar `src/billing/subscription.service.ts`:

```ts
import type { BillingRepository } from './billing.repository.js';
import type { CreditService } from './credit.service.js';
import { packCredits } from './credit-packs.js';
import { effectiveAllowance } from './plan-catalog.js';
import type { BillingEvent } from './stripe-event.js';

export type SubscriptionServiceDeps = {
  repo: BillingRepository;
  credits: Pick<CreditService, 'grant' | 'grantOnce'>;
  log?: (info: { event: string; result: string }) => void;
};

export function createSubscriptionService(deps: SubscriptionServiceDeps) {
  const { repo, credits } = deps;
  const log = deps.log ?? (() => {});

  async function applyPurchase(event: Extract<BillingEvent, { kind: 'credit-purchase' }>): Promise<'applied' | 'ignored'> {
    const organization = await repo.organizationById(event.organizationId);

    // Metadata é entrada não confiável: um evento apontando para uma org que
    // não é a dona do Customer, ou para um workspace de outra org, não credita.
    if (!organization?.stripeCustomerId) {
      log({ event: event.sourceId, result: 'organization without customer' });
      return 'ignored';
    }
    if (!(await repo.workspaceBelongsTo(event.workspaceId, organization.id))) {
      log({ event: event.sourceId, result: 'workspace outside the organization' });
      return 'ignored';
    }

    const granted = await credits.grantOnce({
      idempotencyKey: event.sourceId,
      kind: 'credit-pack',
      workspaceId: event.workspaceId,
      credits: packCredits(event.packId),
      reason: `credit pack ${event.packId}`,
    });

    log({ event: event.sourceId, result: granted ? 'granted' : 'already granted' });
    return granted ? 'applied' : 'ignored';
  }

  async function applyState(event: Extract<BillingEvent, { kind: 'subscription-state' }>): Promise<'applied' | 'ignored'> {
    const organization = await repo.organizationByCustomerId(event.customerId);
    if (!organization) {
      log({ event: event.subscriptionId, result: 'unknown customer' });
      return 'ignored';
    }

    const before = effectiveAllowance(organization.plan, organization.subscriptionStatus);
    const after = effectiveAllowance(event.plan, event.status);

    await repo.saveSubscription(organization.id, {
      plan: event.plan,
      status: event.status,
      subscriptionId: event.subscriptionId,
      currentPeriodEnd: event.currentPeriodEnd,
    });

    // O allowance congelado do período corrente não é reescrito: a diferença
    // entra como GRANT, e o extrato explica de onde vieram os créditos.
    // Downgrade não tira nada — vale a partir da próxima virada.
    const delta = after - before;
    if (delta > 0 && event.workspaceId) {
      await credits.grant({
        workspaceId: event.workspaceId,
        credits: delta,
        reason: `plan change ${organization.plan}→${event.plan}`,
      });
    }

    log({ event: event.subscriptionId, result: `plan ${event.plan} ${event.status}` });
    return 'applied';
  }

  return {
    async apply(event: BillingEvent, _now: Date): Promise<'applied' | 'ignored'> {
      if (event.kind === 'credit-purchase') return applyPurchase(event);
      if (event.kind === 'subscription-state') return applyState(event);

      if (event.kind === 'subscription-canceled') {
        const organization = await repo.organizationByCustomerId(event.customerId);
        if (!organization) return 'ignored';
        await repo.cancelSubscription(organization.id);
        log({ event: event.customerId, result: 'canceled' });
        return 'applied';
      }

      log({ event: 'ignored', result: event.reason });
      return 'ignored';
    },
  };
}

export type SubscriptionService = ReturnType<typeof createSubscriptionService>;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/billing/subscription.service.test.ts`
Expected: PASS (12 testes).

- [ ] **Step 5: Commit**

```bash
git add src/billing/subscription.service.ts src/billing/subscription.service.test.ts
git commit -m "feat(billing): apply a billing event to the organization state"
```

---

## Task 10: Checkout, portal e sync

**Files:**
- Create: `src/billing/checkout.service.ts`, `src/billing/checkout.service.test.ts`

**Interfaces:**
- Consumes: `StripeClient` (Task 6), `BillingRepository` (Task 7), `SubscriptionService` (Task 9), `eventFromSnapshot`/`eventFromPaidSession` (Task 8), `priceForPack` (Task 2), `env.APP_URL` (Task 5).
- Produces:

```ts
createCheckoutService(deps: {
  repo: BillingRepository;
  stripe: StripeClient;
  subscriptions: SubscriptionService;
}): {
  subscriptionUrl(input: { organizationId: string; workspaceId: string; plan: Plan; email: string }): Promise<string>;
  creditPackUrl(input: { organizationId: string; workspaceId: string; packId: PackId; email: string }): Promise<string>;
  portalUrl(input: { organizationId: string; email: string }): Promise<string>;
  sync(input: { organizationId: string; now: Date }): Promise<void>;
}
```

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/billing/checkout.service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createCheckoutService } from './checkout.service.js';

const ORG = {
  id: 'org-1',
  name: 'Acme',
  plan: 'STARTER' as const,
  subscriptionStatus: 'TRIAL' as const,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  currentPeriodEnd: null,
  lastSyncedAt: null,
};

function deps(organization = ORG) {
  const repo = {
    organizationById: vi.fn().mockResolvedValue(organization),
    saveCustomerId: vi.fn().mockResolvedValue(undefined),
    touchSync: vi.fn().mockResolvedValue(undefined),
  };
  const stripe = {
    ensureCustomer: vi.fn().mockResolvedValue('cus_new'),
    createSubscriptionCheckout: vi.fn().mockResolvedValue({ url: 'https://checkout/sub' }),
    createPackCheckout: vi.fn().mockResolvedValue({ url: 'https://checkout/pack' }),
    createPortalSession: vi.fn().mockResolvedValue({ url: 'https://portal' }),
    fetchSubscription: vi.fn().mockResolvedValue(null),
    listRecentPaidSessions: vi.fn().mockResolvedValue([]),
  };
  const subscriptions = { apply: vi.fn().mockResolvedValue('applied') };
  return { repo, stripe, subscriptions };
}

describe('subscriptionUrl', () => {
  it('creates the customer once and stores it', async () => {
    const d = deps();
    const url = await createCheckoutService(d as never).subscriptionUrl({
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      plan: 'GROWTH',
      email: 'owner@acme.com',
    });

    expect(url).toBe('https://checkout/sub');
    expect(d.repo.saveCustomerId).toHaveBeenCalledWith('org-1', 'cus_new');
    expect(d.stripe.createSubscriptionCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cus_new',
        priceId: 'price_test_growth',
        organizationId: 'org-1',
        workspaceId: 'ws-1',
      }),
    );
  });

  it('reuses the stored customer', async () => {
    const d = deps({ ...ORG, stripeCustomerId: 'cus_old' });
    await createCheckoutService(d as never).subscriptionUrl({
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      plan: 'STARTER',
      email: 'owner@acme.com',
    });

    expect(d.stripe.ensureCustomer).not.toHaveBeenCalled();
    expect(d.repo.saveCustomerId).not.toHaveBeenCalled();
  });
});

describe('creditPackUrl', () => {
  it('sends the pack id along so the webhook knows what to credit', async () => {
    const d = deps({ ...ORG, stripeCustomerId: 'cus_old' });
    await createCheckoutService(d as never).creditPackUrl({
      organizationId: 'org-1',
      workspaceId: 'ws-1',
      packId: 'LARGE',
      email: 'owner@acme.com',
    });

    expect(d.stripe.createPackCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ packId: 'LARGE', priceId: 'price_test_pack_large' }),
    );
  });
});

describe('sync', () => {
  it('feeds the subscription and the paid sessions through the same handlers', async () => {
    const d = deps({ ...ORG, stripeCustomerId: 'cus_old' });
    d.stripe.fetchSubscription.mockResolvedValue({
      subscriptionId: 'sub_1',
      priceId: 'price_test_growth',
      status: 'active',
      currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
      metadata: { workspaceId: 'ws-1' },
    });
    d.stripe.listRecentPaidSessions.mockResolvedValue([
      { sessionId: 'cs_1', metadata: { organizationId: 'org-1', workspaceId: 'ws-1', packId: 'SMALL' } },
    ]);

    await createCheckoutService(d as never).sync({ organizationId: 'org-1', now: new Date('2026-07-15T00:00:00Z') });

    expect(d.subscriptions.apply).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'subscription-state', plan: 'GROWTH' }),
      expect.any(Date),
    );
    expect(d.subscriptions.apply).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'credit-purchase', sourceId: 'cs_1' }),
      expect.any(Date),
    );
    expect(d.repo.touchSync).toHaveBeenCalled();
  });

  it('does nothing for an organization that never reached stripe', async () => {
    const d = deps();
    await createCheckoutService(d as never).sync({ organizationId: 'org-1', now: new Date() });

    expect(d.stripe.fetchSubscription).not.toHaveBeenCalled();
    expect(d.subscriptions.apply).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/billing/checkout.service.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar**

Criar `src/billing/checkout.service.ts`:

```ts
import type { Plan } from '@prisma/client';
import { env } from '../config/env.js';
import { NotFoundError } from '../lib/errors.js';
import type { BillingRepository, OrgBilling } from './billing.repository.js';
import { priceForPack, type PackId } from './credit-packs.js';
import { planForPrice } from './plan-catalog.js';
import type { StripeClient } from './stripe-client.js';
import { eventFromPaidSession, eventFromSnapshot } from './stripe-event.js';
import type { SubscriptionService } from './subscription.service.js';

const RETURN_PATH = '/app/settings/billing';

function successUrl(): string {
  return `${env.APP_URL}${RETURN_PATH}?checkout=success`;
}

function cancelUrl(): string {
  return `${env.APP_URL}${RETURN_PATH}?checkout=cancel`;
}

function priceForPlan(plan: Plan): string {
  const configured = { STARTER: env.STRIPE_PRICE_STARTER, GROWTH: env.STRIPE_PRICE_GROWTH, SCALE: env.STRIPE_PRICE_SCALE }[plan];
  // Price não configurado é a mesma falha operacional que chave ausente, e o
  // catálogo já sabe dizer isso: planForPrice devolveria null no caminho de
  // volta, então falhar aqui evita uma sessão que nenhum evento sabe aplicar.
  if (!configured || !planForPrice(configured)) throw new NotFoundError(`no stripe price configured for ${plan}`);
  return configured;
}

export type CheckoutServiceDeps = {
  repo: BillingRepository;
  stripe: StripeClient;
  subscriptions: SubscriptionService;
};

export function createCheckoutService(deps: CheckoutServiceDeps) {
  const { repo, stripe, subscriptions } = deps;

  async function organization(organizationId: string): Promise<OrgBilling> {
    const found = await repo.organizationById(organizationId);
    if (!found) throw new NotFoundError('Organization not found');
    return found;
  }

  async function customerId(org: OrgBilling, email: string): Promise<string> {
    if (org.stripeCustomerId) return org.stripeCustomerId;
    const created = await stripe.ensureCustomer({ organizationId: org.id, email, name: org.name });
    await repo.saveCustomerId(org.id, created);
    return created;
  }

  return {
    async subscriptionUrl(input: { organizationId: string; workspaceId: string; plan: Plan; email: string }) {
      const org = await organization(input.organizationId);
      const session = await stripe.createSubscriptionCheckout({
        customerId: await customerId(org, input.email),
        priceId: priceForPlan(input.plan),
        organizationId: org.id,
        workspaceId: input.workspaceId,
        successUrl: successUrl(),
        cancelUrl: cancelUrl(),
      });
      return session.url;
    },

    async creditPackUrl(input: { organizationId: string; workspaceId: string; packId: PackId; email: string }) {
      const org = await organization(input.organizationId);
      const session = await stripe.createPackCheckout({
        customerId: await customerId(org, input.email),
        priceId: priceForPack(input.packId),
        organizationId: org.id,
        workspaceId: input.workspaceId,
        packId: input.packId,
        successUrl: successUrl(),
        cancelUrl: cancelUrl(),
      });
      return session.url;
    },

    async portalUrl(input: { organizationId: string; email: string }) {
      const org = await organization(input.organizationId);
      const session = await stripe.createPortalSession({
        customerId: await customerId(org, input.email),
        returnUrl: `${env.APP_URL}${RETURN_PATH}`,
      });
      return session.url;
    },

    // Rede de segurança para evento perdido, servidor fora do ar na hora do
    // webhook, e desenvolvimento sem túnel. Não é uma segunda implementação da
    // regra: entrega os mesmos BillingEvent aos mesmos handlers.
    async sync(input: { organizationId: string; now: Date }) {
      const org = await organization(input.organizationId);
      if (!org.stripeCustomerId) return;

      const snapshot = await stripe.fetchSubscription(org.stripeCustomerId);
      if (snapshot) await subscriptions.apply(eventFromSnapshot(org.stripeCustomerId, snapshot), input.now);

      for (const session of await stripe.listRecentPaidSessions(org.stripeCustomerId)) {
        await subscriptions.apply(eventFromPaidSession(session), input.now);
      }

      await repo.touchSync(org.id, input.now);
    },
  };
}

export type CheckoutService = ReturnType<typeof createCheckoutService>;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm vitest run src/billing/checkout.service.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/billing/checkout.service.ts src/billing/checkout.service.test.ts
git commit -m "feat(billing): checkout sessions, portal and the sync safety net"
```

---

## Task 11: Rotas de billing

**Files:**
- Create: `src/http/api/billing/billing.schema.ts`, `src/http/api/billing/billing.presenter.ts`, `src/http/api/billing/index.ts`, `src/http/api/billing/billing.test.ts`
- Create: `src/http/api/billing/get-billing/get-billing.controller.ts`
- Create: `src/http/api/billing/create-subscription-checkout/create-subscription-checkout.controller.ts`
- Create: `src/http/api/billing/create-credit-pack-checkout/create-credit-pack-checkout.controller.ts`
- Create: `src/http/api/billing/create-portal/create-portal.controller.ts`
- Create: `src/http/api/billing/sync-billing/sync-billing.controller.ts`
- Modify: `src/app.ts`
- Modify: `src/lib/tenant.ts`

**Interfaces:**
- Consumes: `createCheckoutService` (Task 10), `createBillingRepository` (Task 7), `createSubscriptionService` (Task 9), `createStripeClient`/`isBillingConfigured` (Task 6), `maxWorkspaces` (Task 2).
- Produces: `assertOwner(tenant)` em `src/lib/tenant.ts`; `billingRoutes: FastifyPluginAsync`; `operationId`s `getBilling`, `createSubscriptionCheckout`, `createCreditPackCheckout`, `createBillingPortal`, `syncBilling`.

| Rota | `operationId` | Papel |
|---|---|---|
| `GET /billing` | `getBilling` | qualquer membro |
| `POST /billing/checkout/subscription` | `createSubscriptionCheckout` | OWNER |
| `POST /billing/checkout/credits` | `createCreditPackCheckout` | OWNER/ADMIN |
| `POST /billing/portal` | `createBillingPortal` | OWNER |
| `POST /billing/sync` | `syncBilling` | OWNER/ADMIN |

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/http/api/billing/billing.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../lib/errors.js';
import { getBillingRoute } from './get-billing/get-billing.controller.js';
import { createSubscriptionCheckoutRoute } from './create-subscription-checkout/create-subscription-checkout.controller.js';
import { createCreditPackCheckoutRoute } from './create-credit-pack-checkout/create-credit-pack-checkout.controller.js';
import { createPortalRoute } from './create-portal/create-portal.controller.js';
import { syncBillingRoute } from './sync-billing/sync-billing.controller.js';

const ORG = {
  id: 'org-1',
  name: 'Acme',
  plan: 'GROWTH',
  subscriptionStatus: 'ACTIVE',
  stripeCustomerId: 'cus_1',
  stripeSubscriptionId: 'sub_1',
  currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
  lastSyncedAt: null,
};

function prismaFake() {
  return {
    organization: { findUnique: vi.fn().mockResolvedValue(ORG), update: vi.fn().mockResolvedValue(ORG) },
    workspace: { count: vi.fn().mockResolvedValue(2) },
    user: { findUnique: vi.fn().mockResolvedValue({ email: 'owner@acme.com' }) },
  };
}

const stripeFake = {
  ensureCustomer: vi.fn().mockResolvedValue('cus_1'),
  createSubscriptionCheckout: vi.fn().mockResolvedValue({ url: 'https://checkout/sub' }),
  createPackCheckout: vi.fn().mockResolvedValue({ url: 'https://checkout/pack' }),
  createPortalSession: vi.fn().mockResolvedValue({ url: 'https://portal' }),
  fetchSubscription: vi.fn().mockResolvedValue(null),
  listRecentPaidSessions: vi.fn().mockResolvedValue([]),
  constructEvent: vi.fn(),
};

async function buildTestApp(role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' = 'OWNER') {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prismaFake() as never);
  app.decorate('stripe', () => stripeFake as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: 'ws-1', role };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) return reply.status(error.statusCode).send({ error: { code: error.code } });
    throw error;
  });
  await app.register(getBillingRoute);
  await app.register(createSubscriptionCheckoutRoute);
  await app.register(createCreditPackCheckoutRoute);
  await app.register(createPortalRoute);
  await app.register(syncBillingRoute);
  return app;
}

describe('GET /billing', () => {
  it('reports the plan, the status and the workspace cap', async () => {
    const res = await (await buildTestApp('VIEWER')).inject({ method: 'GET', url: '/billing' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      plan: 'GROWTH',
      status: 'ACTIVE',
      hasPaymentMethod: true,
      maxWorkspaces: 3,
      workspaceCount: 2,
      currentPeriodEnd: '2026-08-01T00:00:00.000Z',
    });
  });

  it('never leaks money', async () => {
    const res = await (await buildTestApp()).inject({ method: 'GET', url: '/billing' });
    expect(res.payload).not.toMatch(/amount|price|brl|R\$/i);
  });
});

describe('POST /billing/checkout/subscription', () => {
  it('gives an OWNER a checkout url', async () => {
    const res = await (await buildTestApp('OWNER')).inject({
      method: 'POST',
      url: '/billing/checkout/subscription',
      payload: { plan: 'GROWTH' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: 'https://checkout/sub' });
  });

  it('refuses an ADMIN', async () => {
    const res = await (await buildTestApp('ADMIN')).inject({
      method: 'POST',
      url: '/billing/checkout/subscription',
      payload: { plan: 'GROWTH' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a plan that does not exist', async () => {
    const res = await (await buildTestApp('OWNER')).inject({
      method: 'POST',
      url: '/billing/checkout/subscription',
      payload: { plan: 'ENTERPRISE' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /billing/checkout/credits', () => {
  it('lets an ADMIN buy a pack', async () => {
    const res = await (await buildTestApp('ADMIN')).inject({
      method: 'POST',
      url: '/billing/checkout/credits',
      payload: { packId: 'MEDIUM' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: 'https://checkout/pack' });
  });

  it('refuses a MEMBER', async () => {
    const res = await (await buildTestApp('MEMBER')).inject({
      method: 'POST',
      url: '/billing/checkout/credits',
      payload: { packId: 'MEDIUM' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects a pack that does not exist', async () => {
    const res = await (await buildTestApp('OWNER')).inject({
      method: 'POST',
      url: '/billing/checkout/credits',
      payload: { packId: 'HUGE' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /billing/portal', () => {
  it('gives an OWNER a portal url', async () => {
    const res = await (await buildTestApp('OWNER')).inject({ method: 'POST', url: '/billing/portal' });
    expect(res.json()).toEqual({ url: 'https://portal' });
  });
});

describe('POST /billing/sync', () => {
  it('answers with the same shape as GET /billing', async () => {
    const res = await (await buildTestApp('ADMIN')).inject({ method: 'POST', url: '/billing/sync' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ plan: 'GROWTH', status: 'ACTIVE', maxWorkspaces: 3 });
  });

  it('refuses a VIEWER', async () => {
    const res = await (await buildTestApp('VIEWER')).inject({ method: 'POST', url: '/billing/sync' });
    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/http/api/billing/billing.test.ts`
Expected: FAIL — controllers inexistentes.

- [ ] **Step 3: Acrescentar o guard de OWNER**

No fim de `src/lib/tenant.ts`:

```ts
// Assinar e abrir o portal de cobrança é do OWNER: é quem tem o cartão e o
// CNPJ. ADMIN administra o workspace, não a fatura da organização.
export function assertOwner(tenant: TenantContext): void {
  if (tenant.role !== 'OWNER') {
    throw new ForbiddenError('Only the organization owner can manage the subscription');
  }
}
```

- [ ] **Step 4: Schemas e presenter**

Criar `src/http/api/billing/billing.schema.ts`:

```ts
import { z } from 'zod';

export const billingResponse = z.object({
  plan: z.enum(['STARTER', 'GROWTH', 'SCALE']),
  status: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED']),
  currentPeriodEnd: z.string().nullable(),
  hasPaymentMethod: z.boolean(),
  maxWorkspaces: z.number().int(),
  workspaceCount: z.number().int(),
});

export const checkoutUrlResponse = z.object({ url: z.string().url() });

export const subscriptionCheckoutBody = z.object({
  plan: z.enum(['STARTER', 'GROWTH', 'SCALE']),
});

export const creditPackCheckoutBody = z.object({
  packId: z.enum(['SMALL', 'MEDIUM', 'LARGE']),
});
```

Criar `src/http/api/billing/billing.presenter.ts`:

```ts
import { maxWorkspaces } from '../../../billing/plan-catalog.js';
import type { OrgBilling } from '../../../billing/billing.repository.js';

export function presentBilling(org: OrgBilling, workspaceCount: number) {
  return {
    plan: org.plan,
    status: org.subscriptionStatus,
    currentPeriodEnd: org.currentPeriodEnd?.toISOString() ?? null,
    // Só existe assinatura depois de um meio de pagamento aceito. Um Customer
    // criado num checkout abandonado não conta.
    hasPaymentMethod: org.stripeSubscriptionId !== null,
    maxWorkspaces: maxWorkspaces(org.plan),
    workspaceCount,
  };
}
```

- [ ] **Step 5: Controllers**

Os cinco controllers compartilham a montagem das dependências. Criar `src/http/api/billing/billing.deps.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '../../../lib/errors.js';
import { createBillingRepository } from '../../../billing/billing.repository.js';
import { createCheckoutService } from '../../../billing/checkout.service.js';
import { createCreditRepository } from '../../../billing/credit.repository.js';
import { createCreditService } from '../../../billing/credit.service.js';
import { createStripeClient } from '../../../billing/stripe-client.js';
import { createSubscriptionService } from '../../../billing/subscription.service.js';

// `app.stripe` existe para o teste injetar um fake sem tocar a rede; em
// produção é createStripeClient, que lança BILLING_NOT_CONFIGURED sem chave.
export function billingDeps(app: FastifyInstance) {
  const repo = createBillingRepository(app.prisma);
  const stripe = (app.stripe ?? createStripeClient)();
  const subscriptions = createSubscriptionService({
    repo,
    credits: createCreditService({ repo: createCreditRepository(app.prisma) }),
    log: (info) => app.log.info(info, 'stripe event'),
  });
  return { repo, checkout: createCheckoutService({ repo, stripe, subscriptions }), subscriptions };
}

export async function actorEmail(app: FastifyInstance, userId: string): Promise<string> {
  const user = await app.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  if (!user) throw new NotFoundError('User not found');
  return user.email;
}
```

Declarar o decorator opcional em `src/types/fastify.d.ts` (ou no arquivo de declaração já usado pelo repo):

```ts
declare module 'fastify' {
  interface FastifyInstance {
    stripe?: () => import('../billing/stripe-client.js').StripeClient;
  }
}
```

Criar `src/http/api/billing/get-billing/get-billing.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { createBillingRepository } from '../../../../billing/billing.repository.js';
import { billingResponse } from '../billing.schema.js';
import { presentBilling } from '../billing.presenter.js';

export const getBillingRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/billing',
    { schema: { tags: ['billing'], operationId: 'getBilling', response: { 200: billingResponse } } },
    async (req, reply) => {
      // Ler o plano é para qualquer membro, inclusive VIEWER: saber em que
      // plano o time está não é escrita e não expõe dinheiro.
      const repo = createBillingRepository(app.prisma);
      const org = await repo.organizationById(req.tenant.organizationId);
      if (!org) throw new NotFoundError('Organization not found');
      const count = await repo.countActiveWorkspaces(org.id);
      return reply.send(presentBilling(org, count));
    },
  );
};
```

Criar `src/http/api/billing/create-subscription-checkout/create-subscription-checkout.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertOwner } from '../../../../lib/tenant.js';
import { actorEmail, billingDeps } from '../billing.deps.js';
import { checkoutUrlResponse, subscriptionCheckoutBody } from '../billing.schema.js';

export const createSubscriptionCheckoutRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/billing/checkout/subscription',
    {
      schema: {
        tags: ['billing'],
        operationId: 'createSubscriptionCheckout',
        body: subscriptionCheckoutBody,
        response: { 200: checkoutUrlResponse },
      },
    },
    async (req, reply) => {
      assertOwner(req.tenant);
      const url = await billingDeps(app).checkout.subscriptionUrl({
        organizationId: req.tenant.organizationId,
        workspaceId: req.tenant.workspaceId,
        plan: req.body.plan,
        email: await actorEmail(app, req.tenant.userId),
      });
      return reply.send({ url });
    },
  );
};
```

Criar `src/http/api/billing/create-credit-pack-checkout/create-credit-pack-checkout.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertAdmin } from '../../../../lib/tenant.js';
import { actorEmail, billingDeps } from '../billing.deps.js';
import { checkoutUrlResponse, creditPackCheckoutBody } from '../billing.schema.js';

export const createCreditPackCheckoutRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/billing/checkout/credits',
    {
      schema: {
        tags: ['billing'],
        operationId: 'createCreditPackCheckout',
        body: creditPackCheckoutBody,
        response: { 200: checkoutUrlResponse },
      },
    },
    async (req, reply) => {
      // Recarga é operação de quem administra o workspace, não só do dono da
      // fatura: quem está sem crédito no meio do trabalho precisa resolver.
      assertAdmin(req.tenant);
      const url = await billingDeps(app).checkout.creditPackUrl({
        organizationId: req.tenant.organizationId,
        workspaceId: req.tenant.workspaceId,
        packId: req.body.packId,
        email: await actorEmail(app, req.tenant.userId),
      });
      return reply.send({ url });
    },
  );
};
```

Criar `src/http/api/billing/create-portal/create-portal.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertOwner } from '../../../../lib/tenant.js';
import { actorEmail, billingDeps } from '../billing.deps.js';
import { checkoutUrlResponse } from '../billing.schema.js';

export const createPortalRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/billing/portal',
    { schema: { tags: ['billing'], operationId: 'createBillingPortal', response: { 200: checkoutUrlResponse } } },
    async (req, reply) => {
      assertOwner(req.tenant);
      const url = await billingDeps(app).checkout.portalUrl({
        organizationId: req.tenant.organizationId,
        email: await actorEmail(app, req.tenant.userId),
      });
      return reply.send({ url });
    },
  );
};
```

Criar `src/http/api/billing/sync-billing/sync-billing.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { assertAdmin } from '../../../../lib/tenant.js';
import { billingDeps } from '../billing.deps.js';
import { billingResponse } from '../billing.schema.js';
import { presentBilling } from '../billing.presenter.js';

export const syncBillingRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/billing/sync',
    { schema: { tags: ['billing'], operationId: 'syncBilling', response: { 200: billingResponse } } },
    async (req, reply) => {
      assertAdmin(req.tenant);
      const { repo, checkout } = billingDeps(app);
      await checkout.sync({ organizationId: req.tenant.organizationId, now: new Date() });

      const org = await repo.organizationById(req.tenant.organizationId);
      if (!org) throw new NotFoundError('Organization not found');
      return reply.send(presentBilling(org, await repo.countActiveWorkspaces(org.id)));
    },
  );
};
```

Criar `src/http/api/billing/index.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import { getBillingRoute } from './get-billing/get-billing.controller.js';
import { createSubscriptionCheckoutRoute } from './create-subscription-checkout/create-subscription-checkout.controller.js';
import { createCreditPackCheckoutRoute } from './create-credit-pack-checkout/create-credit-pack-checkout.controller.js';
import { createPortalRoute } from './create-portal/create-portal.controller.js';
import { syncBillingRoute } from './sync-billing/sync-billing.controller.js';

/** Registers all `billing` routes. Auth + tenant resolution applied at this scope. */
export const billingRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.resolveTenant);

  await app.register(getBillingRoute);
  await app.register(createSubscriptionCheckoutRoute);
  await app.register(createCreditPackCheckoutRoute);
  await app.register(createPortalRoute);
  await app.register(syncBillingRoute);
};
```

- [ ] **Step 6: Registrar no app**

Em `src/app.ts`, importar `billingRoutes` e registrá-lo logo após `providerKeyRoutes`:

```ts
  await app.register(billingRoutes);
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm typecheck && pnpm test`
Expected: PASS, incluindo os 11 testes novos de `billing.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/http/api/billing src/lib/tenant.ts src/app.ts src/types
git commit -m "feat(api): billing status, checkout, portal and sync endpoints"
```

---

## Task 12: Webhook

**Files:**
- Create: `src/http/webhooks/stripe/stripe-webhook.controller.ts`, `src/http/webhooks/stripe/stripe-webhook.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Consumes: `normalizeEvent` (Task 8), `SubscriptionService` (Task 9), `billingDeps` (Task 11), `env.STRIPE_WEBHOOK_SECRET` (Task 5).
- Produces: `stripeWebhookRoute: FastifyPluginAsync` — `POST /webhooks/stripe`, público, fora do contrato OpenAPI.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/http/webhooks/stripe/stripe-webhook.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { stripeWebhookRoute } from './stripe-webhook.controller.js';

const PAID_SESSION = {
  id: 'cs_1',
  mode: 'payment',
  payment_status: 'paid',
  customer: 'cus_1',
  metadata: { organizationId: 'org-1', workspaceId: 'ws-1', packId: 'SMALL' },
};

function prismaFake(processed: string[] = []) {
  return {
    stripeEvent: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        processed.includes(where.id) ? { id: where.id } : null,
      ),
    },
    organization: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
    workspace: { count: vi.fn().mockResolvedValue(1) },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn(),
  };
}

async function buildTestApp(options: {
  constructEvent?: () => unknown;
  apply?: () => Promise<'applied' | 'ignored'>;
  processed?: string[];
}) {
  const app = Fastify();
  const prisma = prismaFake(options.processed);
  app.decorate('prisma', prisma as never);
  app.decorate('stripe', () => ({
    constructEvent:
      options.constructEvent ??
      (() => ({ id: 'evt_1', type: 'checkout.session.completed', object: PAID_SESSION })),
  }) as never);
  const apply = vi.fn(options.apply ?? (async () => 'applied' as const));
  app.decorate('subscriptionsOverride', { apply } as never);
  await app.register(stripeWebhookRoute);
  return { app, apply, prisma };
}

function post(app: Awaited<ReturnType<typeof buildTestApp>>['app'], signature = 't=1,v1=deadbeef') {
  return app.inject({
    method: 'POST',
    url: '/webhooks/stripe',
    headers: { 'content-type': 'application/json', 'stripe-signature': signature },
    payload: JSON.stringify({ hello: 'world' }),
  });
}

describe('POST /webhooks/stripe', () => {
  it('applies a verified event and answers 200', async () => {
    const { app, apply } = await buildTestApp({});

    const res = await post(app);

    expect(res.statusCode).toBe(200);
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ kind: 'credit-purchase' }), expect.any(Date));
  });

  it('answers 400 and applies nothing when the signature is invalid', async () => {
    const { app, apply, prisma } = await buildTestApp({
      constructEvent: () => {
        throw new Error('No signatures found matching the expected signature for payload');
      },
    });

    const res = await post(app);

    expect(res.statusCode).toBe(400);
    expect(apply).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('answers 400 when the signature header is missing', async () => {
    const { app } = await buildTestApp({});
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/stripe',
      headers: { 'content-type': 'application/json' },
      payload: '{}',
    });

    expect(res.statusCode).toBe(400);
  });

  it('short-circuits a redelivery of an event it already processed', async () => {
    const { app, apply } = await buildTestApp({ processed: ['evt_1'] });

    const res = await post(app);

    expect(res.statusCode).toBe(200);
    expect(apply).not.toHaveBeenCalled();
  });

  it('leaves no processed mark when the handler throws, so stripe retries', async () => {
    const { app, prisma } = await buildTestApp({
      apply: async () => {
        throw new Error('database is on fire');
      },
    });

    const res = await post(app);

    expect(res.statusCode).toBe(500);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('never echoes the event body back', async () => {
    const { app } = await buildTestApp({});
    const res = await post(app);

    expect(res.payload).not.toContain('cus_1');
    expect(res.payload).not.toContain('packId');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/http/webhooks/stripe/stripe-webhook.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar a rota**

Criar `src/http/webhooks/stripe/stripe-webhook.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import { createBillingRepository } from '../../../billing/billing.repository.js';
import { createCreditRepository } from '../../../billing/credit.repository.js';
import { createCreditService } from '../../../billing/credit.service.js';
import { createStripeClient } from '../../../billing/stripe-client.js';
import { normalizeEvent } from '../../../billing/stripe-event.js';
import { createSubscriptionService } from '../../../billing/subscription.service.js';

// 1 MiB. O maior evento do Stripe fica muito abaixo disso; o limite existe para
// um corpo cru não virar memória à toa numa rota pública.
const MAX_BODY_BYTES = 1_048_576;

export const stripeWebhookRoute: FastifyPluginAsync = async (app) => {
  // O parser cru vale só neste escopo encapsulado: a verificação de assinatura
  // precisa do byte exato que o Stripe enviou, e o parser JSON global do
  // Fastify o destrói. Nenhuma outra rota muda de parser.
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: MAX_BODY_BYTES }, (_req, body, done) => {
    done(null, body);
  });

  const repo = createBillingRepository(app.prisma);
  const subscriptions =
    app.subscriptionsOverride ??
    createSubscriptionService({
      repo,
      credits: createCreditService({ repo: createCreditRepository(app.prisma) }),
      log: (info) => app.log.info(info, 'stripe event'),
    });

  app.post('/webhooks/stripe', async (req, reply) => {
    const signature = req.headers['stripe-signature'];
    // Assinatura inválida responde 400 cru, sem passar pelo catálogo de erros:
    // quem lê é o Stripe, não uma pessoa.
    if (typeof signature !== 'string') return reply.code(400).send({ received: false });

    const stripe = (app.stripe ?? createStripeClient)();

    let payload;
    try {
      payload = stripe.constructEvent(req.body as Buffer, signature);
    } catch {
      req.log.warn('stripe webhook signature rejected');
      return reply.code(400).send({ received: false });
    }

    if (await repo.alreadyProcessed(payload.id)) {
      req.log.info({ event: payload.id, type: payload.type, result: 'duplicate' }, 'stripe event');
      return reply.code(200).send({ received: true });
    }

    // Marca depois do despacho: erro no handler não pode deixar o evento como
    // processado, senão o retry do Stripe não acha trabalho por fazer. O efeito
    // que dói — o crédito — é idempotente por conta própria, pelo id da sessão.
    const result = await subscriptions.apply(normalizeEvent(payload), new Date());
    await repo.markProcessed(payload.id, payload.type);

    req.log.info({ event: payload.id, type: payload.type, result }, 'stripe event');
    return reply.code(200).send({ received: true });
  });
};
```

Declarar o segundo decorator opcional junto do `stripe` na declaração de tipos:

```ts
    subscriptionsOverride?: import('../billing/subscription.service.js').SubscriptionService;
```

- [ ] **Step 4: Registrar no app, só com o segredo presente**

Em `src/app.ts`, junto dos outros registros de rota:

```ts
  // Sem STRIPE_WEBHOOK_SECRET a rota não existe: melhor não existir do que
  // existir sem verificação de assinatura.
  if (env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET) {
    await app.register(stripeWebhookRoute);
  }
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm typecheck && pnpm test`
Expected: PASS (6 testes novos).

- [ ] **Step 6: Commit**

```bash
git add src/http/webhooks src/app.ts src/types
git commit -m "feat(webhooks): verified stripe webhook with idempotent dispatch"
```

---

## Task 13: Crédito de trial e teto de workspaces

**Files:**
- Create: `src/billing/workspace-limit.ts`, `src/billing/workspace-limit.test.ts`
- Modify: `src/http/api/auth/auth.repository.ts`
- Create: `src/http/api/auth/register/register.test.ts` (se não existir; caso exista, apenas modificar)

**Interfaces:**
- Consumes: `maxWorkspaces`/`TRIAL_CREDITS` (Task 2), `WorkspaceLimitReachedError` (Task 4), `BillingRepository` (Task 7).
- Produces: `assertCanCreateWorkspace(deps: { repo: Pick<BillingRepository, 'organizationById' | 'countActiveWorkspaces'> }, organizationId: string): Promise<void>`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `src/billing/workspace-limit.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { assertCanCreateWorkspace } from './workspace-limit.js';

function repoFake(plan: 'STARTER' | 'GROWTH' | 'SCALE', count: number) {
  return {
    organizationById: vi.fn().mockResolvedValue({ id: 'org-1', plan }),
    countActiveWorkspaces: vi.fn().mockResolvedValue(count),
  };
}

describe('assertCanCreateWorkspace', () => {
  it('lets a plan below its cap through', async () => {
    await expect(assertCanCreateWorkspace({ repo: repoFake('GROWTH', 2) as never }, 'org-1')).resolves.toBeUndefined();
  });

  it('blocks at the cap and says what the numbers are', async () => {
    await expect(
      assertCanCreateWorkspace({ repo: repoFake('STARTER', 1) as never }, 'org-1'),
    ).rejects.toMatchObject({ code: 'AUR-T0017', details: { current: 1, max: 1 } });
  });

  it('blocks above the cap too, in case a downgrade left it over', async () => {
    await expect(assertCanCreateWorkspace({ repo: repoFake('STARTER', 3) as never }, 'org-1')).rejects.toMatchObject({
      code: 'AUR-T0017',
    });
  });
});
```

Criar `src/http/api/auth/register/register.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createAuthRepository } from '../auth.repository.js';

describe('createAccount', () => {
  it('gives the new workspace its one-off trial credits', async () => {
    const created: Record<string, unknown>[] = [];
    const tx = {
      organization: { create: vi.fn().mockResolvedValue({ id: 'org-1' }), count: vi.fn().mockResolvedValue(0) },
      workspace: { create: vi.fn().mockResolvedValue({ id: 'ws-1' }), count: vi.fn().mockResolvedValue(0) },
      user: { create: vi.fn().mockResolvedValue({ id: 'u-1', email: 'a@b.com', name: 'A' }) },
      membership: { create: vi.fn().mockResolvedValue({}) },
      creditLedger: { create: vi.fn(async (args: { data: Record<string, unknown> }) => (created.push(args.data), {})) },
    };
    const prisma = { $transaction: (fn: (t: unknown) => unknown) => fn(tx) };

    await createAuthRepository(prisma as never).createAccount({
      name: 'A',
      email: 'a@b.com',
      passwordHash: 'hash',
      organizationName: 'Acme',
    });

    expect(created).toEqual([
      expect.objectContaining({ workspaceId: 'ws-1', kind: 'GRANT', credits: 50, reason: 'trial credits' }),
    ]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/billing/workspace-limit.test.ts src/http/api/auth/register/register.test.ts`
Expected: FAIL — `./workspace-limit.js` inexistente e nenhum lançamento no ledger.

- [ ] **Step 3: Implementar o teto**

Criar `src/billing/workspace-limit.ts`:

```ts
import { NotFoundError, WorkspaceLimitReachedError } from '../lib/errors.js';
import type { BillingRepository } from './billing.repository.js';
import { maxWorkspaces } from './plan-catalog.js';

export type WorkspaceLimitDeps = {
  repo: Pick<BillingRepository, 'organizationById' | 'countActiveWorkspaces'>;
};

// A franquia multiplica por workspace: sem teto, um STARTER cria vinte
// workspaces e leva 4.000 créditos por R$297. Este é o freio da margem.
export async function assertCanCreateWorkspace(deps: WorkspaceLimitDeps, organizationId: string): Promise<void> {
  const organization = await deps.repo.organizationById(organizationId);
  if (!organization) throw new NotFoundError('Organization not found');

  const current = await deps.repo.countActiveWorkspaces(organizationId);
  const max = maxWorkspaces(organization.plan);
  // `>=` e não `==`: um downgrade pode deixar a org acima do teto, e nesse
  // estado ela também não cria mais nenhum.
  if (current >= max) throw new WorkspaceLimitReachedError({ current, max });
}
```

- [ ] **Step 4: Conceder o trial no registro**

Em `src/http/api/auth/auth.repository.ts`, dentro da transação de `createAccount`, logo após a criação do `workspace`:

```ts
        // Trial é GRANT, não franquia: franquia renovaria todo mês para sempre.
        // Dentro da mesma transação da conta porque o lançamento no ledger *é*
        // o registro de que já foi concedido — não há campo `trialUsed`.
        await tx.creditLedger.create({
          data: {
            workspaceId: workspace.id,
            kind: 'GRANT',
            credits: TRIAL_CREDITS,
            reason: 'trial credits',
          },
        });
```

com `import { TRIAL_CREDITS } from '../../../billing/plan-catalog.js';` no topo.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm typecheck && pnpm test`
Expected: PASS (4 testes novos).

- [ ] **Step 6: Commit**

```bash
git add src/billing/workspace-limit.ts src/billing/workspace-limit.test.ts src/http/api/auth
git commit -m "feat(billing): trial credits on signup and the per-plan workspace cap"
```

> O guard nasce sem call site nesta task — o único nascimento de workspace hoje é o `Default` do registro, sempre o primeiro da org (`0 < 1`). A Task 13b abre a rota que o usa. Não a pule.

---

## Task 13b: `POST /workspaces`

> Acrescentada em 2026-07-28 por decisão do dono do produto: o teto de workspaces da Task 13 não vale nada sem a rota que ele freia.

**Files:**
- Create: `src/http/api/workspaces/workspaces.schema.ts`, `src/http/api/workspaces/workspaces.presenter.ts`, `src/http/api/workspaces/index.ts`, `src/http/api/workspaces/workspaces.test.ts`
- Create: `src/http/api/workspaces/create-workspace/create-workspace.controller.ts`
- Create: `src/http/api/workspaces/list-workspaces/list-workspaces.controller.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Consumes: `assertCanCreateWorkspace` (Task 13), `createBillingRepository` (Task 7), `assertAdmin` (existente), `uniqueSlug` (`src/lib/slug.ts`).
- Produces: `workspacesRoutes: FastifyPluginAsync`; `operationId`s `createWorkspace` e `listWorkspaces`.

| Rota | `operationId` | Papel | Resposta |
|---|---|---|---|
| `GET /workspaces` | `listWorkspaces` | qualquer membro | os workspaces da org em que o usuário tem membership |
| `POST /workspaces` | `createWorkspace` | OWNER/ADMIN | `201` com o workspace criado |

O `GET` existe porque, sem ele, o front não tem como oferecer o `x-workspace-id` que o `resolveTenant` já lê — criar um workspace que ninguém consegue selecionar não entrega valor nenhum.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/http/api/workspaces/workspaces.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../lib/errors.js';
import { createWorkspaceRoute } from './create-workspace/create-workspace.controller.js';
import { listWorkspacesRoute } from './list-workspaces/list-workspaces.controller.js';

const CREATED = {
  id: 'ws-2',
  name: 'Growth',
  slug: 'growth-a1b2c3',
  createdAt: new Date('2026-07-28T00:00:00Z'),
};

function prismaFake(options: { plan?: 'STARTER' | 'GROWTH' | 'SCALE'; workspaceCount?: number } = {}) {
  const created = vi.fn().mockResolvedValue(CREATED);
  return {
    organization: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'org-1',
        name: 'Acme',
        plan: options.plan ?? 'GROWTH',
        subscriptionStatus: 'ACTIVE',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        currentPeriodEnd: null,
        lastSyncedAt: null,
      }),
    },
    workspace: {
      count: vi.fn().mockResolvedValue(options.workspaceCount ?? 1),
      create: created,
      findMany: vi.fn().mockResolvedValue([CREATED]),
    },
    membership: { create: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        workspace: { create: created },
        membership: { create: vi.fn().mockResolvedValue({}) },
      }),
    ),
  };
}

async function buildTestApp(role: 'OWNER' | 'ADMIN' | 'MEMBER' = 'OWNER', prisma = prismaFake()) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prisma as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u1', organizationId: 'org-1', workspaceId: 'ws-1', role };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, details: error.details } });
    }
    throw error;
  });
  await app.register(createWorkspaceRoute);
  await app.register(listWorkspacesRoute);
  return app;
}

describe('POST /workspaces', () => {
  it('creates a workspace and makes the caller a member of it', async () => {
    const prisma = prismaFake({ plan: 'GROWTH', workspaceCount: 1 });
    const app = await buildTestApp('OWNER', prisma);

    const res = await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Growth' } });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: 'ws-2', name: 'Growth' });
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('blocks at the plan cap with the numbers in the error', async () => {
    const app = await buildTestApp('OWNER', prismaFake({ plan: 'STARTER', workspaceCount: 1 }));

    const res = await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Second' } });

    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatchObject({ code: 'AUR-T0017', details: { current: 1, max: 1 } });
  });

  it('refuses a MEMBER', async () => {
    const app = await buildTestApp('MEMBER');
    const res = await app.inject({ method: 'POST', url: '/workspaces', payload: { name: 'Growth' } });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an empty name', async () => {
    const app = await buildTestApp('OWNER');
    const res = await app.inject({ method: 'POST', url: '/workspaces', payload: { name: '  ' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /workspaces', () => {
  it('lists the workspaces of the caller organization', async () => {
    const app = await buildTestApp('MEMBER');

    const res = await app.inject({ method: 'GET', url: '/workspaces' });

    expect(res.statusCode).toBe(200);
    expect(res.json().workspaces[0]).toMatchObject({ id: 'ws-2', name: 'Growth' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm vitest run src/http/api/workspaces/workspaces.test.ts`
Expected: FAIL — controllers inexistentes.

- [ ] **Step 3: Schema e presenter**

Criar `src/http/api/workspaces/workspaces.schema.ts`:

```ts
import { z } from 'zod';

export const workspaceResponse = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string(),
});

export const workspaceListResponse = z.object({
  workspaces: z.array(workspaceResponse),
});

export const createWorkspaceBody = z.object({
  name: z.string().trim().min(1).max(80),
});
```

Criar `src/http/api/workspaces/workspaces.presenter.ts`:

```ts
export type WorkspaceRow = { id: string; name: string; slug: string; createdAt: Date };

export function presentWorkspace(row: WorkspaceRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt.toISOString(),
  };
}
```

- [ ] **Step 4: Controller de criação**

Criar `src/http/api/workspaces/create-workspace/create-workspace.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createBillingRepository } from '../../../../billing/billing.repository.js';
import { assertCanCreateWorkspace } from '../../../../billing/workspace-limit.js';
import { uniqueSlug } from '../../../../lib/slug.js';
import { assertAdmin } from '../../../../lib/tenant.js';
import { createWorkspaceBody, workspaceResponse } from '../workspaces.schema.js';
import { presentWorkspace } from '../workspaces.presenter.js';

export const createWorkspaceRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/workspaces',
    {
      schema: {
        tags: ['workspaces'],
        operationId: 'createWorkspace',
        body: createWorkspaceBody,
        response: { 201: workspaceResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);

      // O teto do plano é verificado antes do create, e não depois: a franquia
      // multiplica por workspace, então um workspace a mais é dinheiro a mais.
      await assertCanCreateWorkspace(
        { repo: createBillingRepository(app.prisma) },
        req.tenant.organizationId,
      );

      // Workspace e membership na mesma transação: um workspace sem membro
      // nenhum é invisível para o resolveTenant e ninguém consegue apagá-lo.
      const workspace = await app.prisma.$transaction(async (tx) => {
        const created = await tx.workspace.create({
          data: {
            organizationId: req.tenant.organizationId,
            name: req.body.name,
            slug: uniqueSlug(req.body.name),
          },
          select: { id: true, name: true, slug: true, createdAt: true },
        });

        await tx.membership.create({
          data: {
            userId: req.tenant.userId,
            organizationId: req.tenant.organizationId,
            workspaceId: created.id,
            role: req.tenant.role,
          },
        });

        return created;
      });

      // Nenhum crédito de boas-vindas aqui: o trial é da organização e acontece
      // uma vez, no registro. Este workspace já recebe a franquia do plano.
      return reply.code(201).send(presentWorkspace(workspace));
    },
  );
};
```

- [ ] **Step 5: Controller de listagem**

Criar `src/http/api/workspaces/list-workspaces/list-workspaces.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { workspaceListResponse } from '../workspaces.schema.js';
import { presentWorkspace } from '../workspaces.presenter.js';

export const listWorkspacesRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/workspaces',
    { schema: { tags: ['workspaces'], operationId: 'listWorkspaces', response: { 200: workspaceListResponse } } },
    async (req, reply) => {
      // Só os workspaces em que o usuário tem membership: pertencer à
      // organização não dá acesso a todo workspace dela.
      const rows = await app.prisma.workspace.findMany({
        where: {
          organizationId: req.tenant.organizationId,
          deletedAt: null,
          status: 'ACTIVE',
          memberships: { some: { userId: req.tenant.userId } },
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, slug: true, createdAt: true },
      });

      return reply.send({ workspaces: rows.map(presentWorkspace) });
    },
  );
};
```

- [ ] **Step 6: Registrar no app**

Criar `src/http/api/workspaces/index.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import { createWorkspaceRoute } from './create-workspace/create-workspace.controller.js';
import { listWorkspacesRoute } from './list-workspaces/list-workspaces.controller.js';

/** Registers all `workspaces` routes. Auth + tenant resolution applied at this scope. */
export const workspacesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.resolveTenant);

  await app.register(listWorkspacesRoute);
  await app.register(createWorkspaceRoute);
};
```

Em `src/app.ts`, importar e registrar junto dos outros:

```ts
  await app.register(workspacesRoutes);
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm typecheck && pnpm test`
Expected: PASS (5 testes novos).

- [ ] **Step 8: Commit**

```bash
git add src/http/api/workspaces src/app.ts
git commit -m "feat(api): create and list workspaces under the plan cap"
```

---

## Task 14: Contrato, documentação e smoke test

**Files:**
- Modify: `docs/architecture/` (arquivo de billing; criar `billing.md` se não houver)
- Modify: `back/README.md` ou `DEPLOY.md` — seção de webhook
- Gera: `openapi.json` via script existente

**Interfaces:**
- Consumes: tudo.
- Produces: contrato OpenAPI com as cinco rotas de billing e sem a rota de webhook.

- [ ] **Step 1: Verificar que o webhook ficou fora do contrato**

Run: `pnpm openapi:dump`

Then: `grep -c "webhooks/stripe" openapi.json`
Expected: `0` — quem chama o webhook é o Stripe, não o front. As cinco rotas de billing aparecem:

Run: `grep -o '"operationId":"[a-zA-Z]*[Bb]illing[a-zA-Z]*"' openapi.json`
Expected: `getBilling`, `syncBilling`, `createBillingPortal` (e `createSubscriptionCheckout`/`createCreditPackCheckout` num grep sem o filtro de nome).

- [ ] **Step 2: Documentar a arquitetura de billing**

Criar/estender `docs/architecture/billing.md` com: o fluxo do dinheiro (o diagrama do spec §4.1), a tabela de eventos tratados (spec §7.3), a regra de franquia efetiva por status, e a frase que amarra tudo — webhook e sync entregam o mesmo `BillingEvent` aos mesmos handlers.

- [ ] **Step 3: Documentar o webhook em desenvolvimento**

Em `DEPLOY.md`, seção nova:

````markdown
## Stripe

Test mode. Os produtos e prices já existem na conta (`aurea_plan_*`, `aurea_pack_*`);
os ids vão em `.env` como `STRIPE_PRICE_*`.

Em desenvolvimento não há webhook sem túnel. Duas saídas:

```bash
# caminho real: a CLI do Stripe imprime o whsec_ que vai em STRIPE_WEBHOOK_SECRET
stripe listen --forward-to localhost:3337/webhooks/stripe
```

ou `POST /billing/sync`, que busca a assinatura corrente e as sessões pagas
recentes e aplica os mesmos handlers.

Em produção, cadastrar o endpoint `https://<API_DOMAIN>/webhooks/stripe` no
dashboard do Stripe, assinando os eventos `checkout.session.completed`,
`customer.subscription.created`, `customer.subscription.updated` e
`customer.subscription.deleted`, e pôr o segredo devolvido em
`STRIPE_WEBHOOK_SECRET`.
````

- [ ] **Step 4: Smoke test de ponta a ponta (manual, test mode)**

Com `.env` preenchido com a chave de test e o `whsec_` do `stripe listen`:

```bash
pnpm infra:up && pnpm dev          # terminal 1
stripe listen --forward-to localhost:3337/webhooks/stripe   # terminal 2
```

1. Registrar uma conta nova. Conferir `GET /credits`: `allowance` 0 (TRIAL), `purchasedBalance` 50.
2. `POST /billing/checkout/subscription` com `{"plan":"GROWTH"}`. Abrir a URL, aplicar o cupom `LANCAMENTO20`, pagar com `4242 4242 4242 4242`.
3. Conferir no log da API um `stripe event` com `result: plan GROWTH ACTIVE`.
4. `GET /billing` → `plan: GROWTH`, `status: ACTIVE`, `hasPaymentMethod: true`, `maxWorkspaces: 3`.
5. `GET /credits` → `allowance: 1000`, e o extrato com o GRANT de 800 (`plan change STARTER→GROWTH`).
6. `POST /billing/checkout/credits` com `{"packId":"SMALL"}`, pagar. `GET /credits` → `purchasedBalance` sobe 100.
7. Reenviar o mesmo evento: `stripe events resend <evt_id>`. `purchasedBalance` **não** muda.
8. No dashboard do Stripe, cancelar a assinatura. `GET /billing` → `status: CANCELED`; `GET /credits` → `allowance: 0`, `purchasedBalance` intacto.

Expected: os oito passos batem. Qualquer divergência é bug, não ajuste de teste.

- [ ] **Step 5: Commit**

```bash
git add docs DEPLOY.md openapi.json
git commit -m "docs(billing): stripe architecture, webhook setup and the smoke test"
```

---

## Cobertura do spec

| Seção do spec | Onde |
|---|---|
| §3 org assina / workspace herda | Tasks 1, 3 |
| §3 webhook primário, sync rede de segurança | Tasks 10, 12 |
| §3 trial é GRANT | Task 13 |
| §3 `past_due` mantém, `canceled` zera | Task 2 (`effectiveAllowance`), Task 8 (`toSubscriptionStatus`) |
| §3 upgrade lança a diferença | Task 9 |
| §3 cupom é `promotion_code` | Task 6 (`allow_promotion_codes`), smoke test Task 14 |
| §3 teto de workspaces | Tasks 2, 13 |
| §4.2 layout | Tasks 6–10 (+ `stripe-event.ts`, divergência 2) |
| §4.3 contrato do cliente Stripe | Task 6 |
| §5.1 plano muda de casa | Task 1 |
| §5.2 idempotência | Tasks 1, 7, 12 |
| §6 franquia efetiva | Tasks 2, 3 |
| §7.1 trial | Task 13 |
| §7.2 checkout | Tasks 6, 10, 11 |
| §7.3 webhook | Task 12 (divergência 1) |
| §7.4 upgrade no meio do mês | Task 9 |
| §7.5 teto de workspaces | Task 13 (guard) + Task 13b (`POST /workspaces`, o call site) |
| §7.6 sync | Tasks 10, 11 |
| §8 contratos HTTP | Tasks 11, 14 |
| §9 erros | Task 4 |
| §10 segurança | Tasks 6, 9 (metadata), 12 (assinatura, corpo cru, log) |
| §11 testes | Todas as tasks; migration em Task 1 (parte manual documentada) |
| §12 configuração | Task 5 (divergência 3) |
