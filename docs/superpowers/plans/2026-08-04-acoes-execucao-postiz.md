# Ações executáveis: Action, Approval e publicação via Postiz — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma Action `SOCIAL_POST` escrita pelo fundador (com assistência de IA), aprovada por um humano em ato separado, publicada por um worker num Postiz self-hosted, com proveniência em `ExternalReference` e sem nunca publicar duas vezes.

**Architecture:** Três modelos novos (`Action`, `Approval`, `ExternalReference`) no Growth Brain, com tabela de transições no estilo de `experiments.domain.ts`. Um cliente Postiz em `src/integrations/social/postiz/`, no formato do conector GA4 (fetch + Zod + erro tipado). Execução por fila BullMQ própria, processada no worker existente; o processor é o único lugar do sistema que escreve no Postiz. Frontend: página de ações + card de conexão, com hooks Kubb gerados do contrato.

**Tech Stack:** Node 22, Fastify 5, TypeScript strict ESM, Zod 3 + `fastify-type-provider-zod`, Prisma 6 + PostgreSQL, BullMQ 5 + ioredis, Vitest. Web: Vite + React 19, react-router-dom 7, Tailwind + shadcn/ui, Kubb + React Query, i18next.

**Spec:** `docs/superpowers/specs/2026-08-04-acoes-execucao-postiz-design.md` (commit `f6262e6`). Onde este plano e o spec divergirem, **o spec governa** — pare e pergunte.

## Global Constraints

Valores exatos, copiados do spec. As requisitos de toda task incluem esta seção.

- **Isolamento de tenant absoluto.** `workspaceId` sempre de `req.tenant`, nunca de body, query ou params. Todo `where` de repositório é escopado por `workspaceId`. Um id de outro workspace lê como 404, nunca como 403.
- **`operationId` e `response` obrigatórios em toda rota.** Sem eles não há contrato OpenAPI nem hook Kubb.
- **O segredo nunca sai numa resposta.** Nenhuma rota devolve `ciphertext`, `iv`, `authTag` nem `apiKey`. `accountLabel` é o host do Postiz, e host não é segredo.
- **Nenhum teste toca a rede.** O cliente Postiz entra por opção de plugin (`{ postiz?: ... }` / `{ createClient?: ... }`), nunca por decorator ambiente: um teste que esquecesse de decorar sairia falando com o Postiz de dentro da suíte.
- **`EXECUTED` significa "entregue ao Postiz", não "publicado no Instagram".** Nenhuma cópia de tela, mensagem de erro ou nome de campo pode afirmar publicação. O `state` do provider aparece cru ao lado.
- **Falha de rede nunca retenta.** `NETWORK` e `UNKNOWN` vão para `DELIVERY_UNKNOWN` e param. Só `RATE_LIMIT` e `PROVIDER` relançam para o BullMQ retentar.
- **Nada publica sem aprovação humana explícita, em ato separado da criação.** Não existe rota que crie e aprove no mesmo request.
- **Autorização:** `assertWriter` em toda escrita; `assertAdmin` (OWNER/ADMIN, já existe em `src/lib/tenant.ts`) em `approve`, `reject`, `execute` e `resolve`. O spec chama isso de `assertApprover`; **não crie função nova** — `assertAdmin` já é exatamente essa guarda.
- **`Authorization: <apiKey>` cru** nas chamadas ao Postiz. Sem `Bearer`.
- **Base do Postiz:** `{baseUrl}/public/v1`, com `baseUrl` normalizado sem barra final antes de selar.
- **NUNCA rode `prisma migrate dev` nem `migrate reset`.** Escreva o `migration.sql` à mão e rode `pnpm prisma:deploy`. Se houver drift, pare e reporte.
- **`back/` e `web/` são dois repositórios git independentes**, não um monorepo. `pnpm openapi:dump` escreve `../web/api.json`, que pertence ao repo do web — ele é staged nas tasks do web (8-10), nunca de dentro do `back`.
- **Commit exige aprovação explícita.** Cada task termina em `git add` + `git status` + diff resumido; **não rode `git commit` sem o "ok" do humano.**
- **Nenhum código gera, infere ou assume `baselineValue`, `targetValue`, `startDate` ou `endDate`.**
- Toda entrada nova no catálogo de erros ganha as três traduções (`pt-BR`, `en-US`, `es-ES`) — o teste de paridade de chaves não deixa passar menos.
- Web: Tailwind + shadcn/ui apenas. Sem CSS solto, sem `style={{}}`, sem `fetch` cru, sem `any`. Termos de domínio ganham `Help`.

## Estrutura de arquivos

**Backend, criado:**

| Arquivo | Responsabilidade |
|---|---|
| `prisma/migrations/20260804160000_actions_and_external_references/migration.sql` | os três modelos e três enums |
| `src/integrations/social/postiz/postiz-client.ts` | fetch + Zod contra a API do Postiz; classifica a falha |
| `src/integrations/social/postiz/postiz-credential.ts` | abre/valida o JSON selado `{ apiKey, baseUrl }` |
| `src/integrations/social/index.ts` | reexporta o que sai deste diretório |
| `src/http/api/integrations/put-postiz/put-postiz.{controller,schema}.ts` | `PUT /integrations/postiz` |
| `src/http/api/integrations/postiz-channels/postiz-channels.{controller,schema}.ts` | `GET /integrations/postiz/channels` |
| `src/http/api/actions/actions.{schema,repository,domain,payload,presenter,transition}.ts` | compartilhados do recurso |
| `src/http/api/actions/index.ts` | registra as rotas |
| `src/http/api/actions/create-action/*`, `list-actions/*`, `get-action/*`, `update-action/*` | CRUD |
| `src/http/api/actions/submit-action/*`, `approve-action/*`, `reject-action/*`, `cancel-action/*` | aprovação |
| `src/http/api/actions/execute-action/*`, `resolve-action/*` | execução e resolução |
| `src/actions/queue.ts` | fila `action-executions` |
| `src/actions/processor.ts` | `executeAction` — o único lugar que escreve no Postiz |
| `src/actions/reaper.ts` | `reapStuckActions` + `startActionReaper` |
| `src/actions/worker.ts` | `startActionWorker` |
| `src/ai/agents/fill/propose-social-post.ts` | o décimo fill agent |

**Backend, modificado:** `prisma/schema.prisma`, `src/config/env.ts`, `src/shared/errors/catalog.ts`, `src/shared/errors/i18n/{pt-BR,en-US,es-ES}.json`, `src/lib/errors.ts`, `src/http/api/integrations/{index.ts,integrations.schema.ts,integrations.repository.ts}`, `src/ai/agents/registry.ts`, `src/app.ts`, `src/worker.ts`.

**Web, criado:** `src/pages/ActionsPage.tsx`, `src/pages/ActionNewPage.tsx`, `src/pages/ActionDetailPage.tsx`, `src/components/actions/{ActionStatusBadge,ActionApprovalPanel,ActionDeliveryPanel,SocialPostFields}.tsx`, `src/components/integrations/PostizSourceCard.tsx`, `src/schemas/social-post.ts`, mais um `.test.tsx` por peça.

**Web, modificado:** `src/App.tsx`, `src/components/AppLayout.tsx`, `src/pages/IntegrationsPage.tsx`, `src/i18n/locales/{pt,en,es}.json`, `api.json` + `src/api/generated/` (gerados).

**Ordem e lotes:** Tasks 1–7 são backend e vão em sequência (cada uma consome a anterior). Tasks 8–10 são web e dependem de 1–7 estarem no contrato.

---

## Task 1: Modelos, transições, payload e erros

Fundação. Nenhuma rota ainda — o entregável é o schema no banco mais as três peças de domínio puras, com teste próprio.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260804160000_actions_and_external_references/migration.sql`
- Create: `src/http/api/actions/actions.domain.ts`
- Create: `src/http/api/actions/actions.domain.test.ts`
- Create: `src/http/api/actions/actions.payload.ts`
- Create: `src/http/api/actions/actions.payload.test.ts`
- Modify: `src/shared/errors/catalog.ts`
- Modify: `src/shared/errors/i18n/pt-BR.json`, `en-US.json`, `es-ES.json`
- Modify: `src/lib/errors.ts`

**Interfaces:**
- Consumes: `AppError`, `getErrorDef`, `translateError` de `src/lib/errors.ts` e `src/shared/errors/catalog.ts`.
- Produces:
  - Prisma: `ActionType`, `ActionStatus`, `ApprovalStatus`, modelos `Action`, `Approval`, `ExternalReference`.
  - `TRANSITIONS: Record<ActionStatus, ActionStatus[]>` e `assertActionTransition(from: ActionStatus, to: ActionStatus): void` de `actions.domain.ts`.
  - `socialPostPayload` (Zod), `type SocialPostPayload`, `parseActionPayload(type: ActionType, payload: unknown): SocialPostPayload` de `actions.payload.ts`.
  - `PostizNotConnectedError`, `PostizChannelNotFoundError`, `PostizRequestFailedError`, `ActionNotResolvableError` de `src/lib/errors.ts`.

- [ ] **Step 1: Escreva o teste de transições**

Crie `src/http/api/actions/actions.domain.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ActionStatus } from '@prisma/client';
import { assertActionTransition, TRANSITIONS } from './actions.domain.js';

describe('assertActionTransition', () => {
  it('deixa o caminho feliz inteiro passar', () => {
    expect(() => assertActionTransition(ActionStatus.PROPOSED, ActionStatus.PENDING_APPROVAL)).not.toThrow();
    expect(() => assertActionTransition(ActionStatus.PENDING_APPROVAL, ActionStatus.APPROVED)).not.toThrow();
    expect(() => assertActionTransition(ActionStatus.APPROVED, ActionStatus.EXECUTING)).not.toThrow();
    expect(() => assertActionTransition(ActionStatus.EXECUTING, ActionStatus.EXECUTED)).not.toThrow();
  });

  // Rejeitar devolve a Action ao autor com o comentário, e não a mata: o
  // fundador corrige o texto e submete de novo (spec §4.3).
  it('permite a rejeição voltar para PROPOSED', () => {
    expect(() => assertActionTransition(ActionStatus.PENDING_APPROVAL, ActionStatus.PROPOSED)).not.toThrow();
  });

  // Reexecutar uma falha é ato humano legítimo (spec §7.2).
  it('permite reexecutar de FAILED', () => {
    expect(() => assertActionTransition(ActionStatus.FAILED, ActionStatus.EXECUTING)).not.toThrow();
  });

  // As duas saídas do oitavo estado, e só elas (spec §7.3).
  it('sai de DELIVERY_UNKNOWN só para EXECUTED ou APPROVED', () => {
    expect(() => assertActionTransition(ActionStatus.DELIVERY_UNKNOWN, ActionStatus.EXECUTED)).not.toThrow();
    expect(() => assertActionTransition(ActionStatus.DELIVERY_UNKNOWN, ActionStatus.APPROVED)).not.toThrow();
    expect(() => assertActionTransition(ActionStatus.DELIVERY_UNKNOWN, ActionStatus.EXECUTING)).toThrow();
    expect(() => assertActionTransition(ActionStatus.DELIVERY_UNKNOWN, ActionStatus.FAILED)).toThrow();
  });

  it('recusa aprovar o que não foi submetido', () => {
    expect(() => assertActionTransition(ActionStatus.PROPOSED, ActionStatus.APPROVED)).toThrow(
      /Cannot move action from PROPOSED to APPROVED/,
    );
  });

  // Executar sem aprovação é a coisa que este sistema existe para impedir.
  it('recusa executar direto de PROPOSED ou de PENDING_APPROVAL', () => {
    expect(() => assertActionTransition(ActionStatus.PROPOSED, ActionStatus.EXECUTING)).toThrow();
    expect(() => assertActionTransition(ActionStatus.PENDING_APPROVAL, ActionStatus.EXECUTING)).toThrow();
  });

  it('EXECUTED e CANCELLED são terminais', () => {
    expect(TRANSITIONS[ActionStatus.EXECUTED]).toEqual([]);
    expect(TRANSITIONS[ActionStatus.CANCELLED]).toEqual([]);
  });

  // Uma Action executada não pode ser cancelada: cancelar não despublica nada,
  // e o status mentiria sobre o que existe no mundo.
  it('recusa cancelar depois de executado', () => {
    expect(() => assertActionTransition(ActionStatus.EXECUTED, ActionStatus.CANCELLED)).toThrow();
  });

  it('cancela de qualquer estado pré-execução', () => {
    expect(() => assertActionTransition(ActionStatus.PROPOSED, ActionStatus.CANCELLED)).not.toThrow();
    expect(() => assertActionTransition(ActionStatus.PENDING_APPROVAL, ActionStatus.CANCELLED)).not.toThrow();
    expect(() => assertActionTransition(ActionStatus.APPROVED, ActionStatus.CANCELLED)).not.toThrow();
    expect(() => assertActionTransition(ActionStatus.FAILED, ActionStatus.CANCELLED)).not.toThrow();
  });

  // A tabela cobre o enum inteiro: um status novo sem aresta declarada estoura
  // aqui, e não em produção com `TRANSITIONS[status]` undefined.
  it('tem uma entrada por status do enum', () => {
    for (const status of Object.values(ActionStatus)) {
      expect(TRANSITIONS[status]).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Escreva o teste do payload**

Crie `src/http/api/actions/actions.payload.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ActionType } from '@prisma/client';
import { parseActionPayload, socialPostPayload } from './actions.payload.js';

const VALID = {
  channelId: 'chan-1',
  channelName: 'AUREA no Instagram',
  providerIdentifier: 'instagram',
  content: 'Como cortamos 30% do custo operacional em três meses.',
};

describe('socialPostPayload', () => {
  it('aceita o payload completo', () => {
    expect(socialPostPayload.parse(VALID)).toEqual(VALID);
  });

  // O snapshot do canal é o que permite a Action de ontem dizer para onde foi
  // (spec §4.2). Sem ele, a lista de canais ao vivo é a única fonte, e ela muda.
  it('recusa um payload sem o snapshot do canal', () => {
    expect(socialPostPayload.safeParse({ channelId: 'chan-1', content: 'oi' }).success).toBe(false);
  });

  it('recusa conteúdo vazio', () => {
    expect(socialPostPayload.safeParse({ ...VALID, content: '' }).success).toBe(false);
  });

  it('recusa conteúdo acima de 5000 caracteres', () => {
    expect(socialPostPayload.safeParse({ ...VALID, content: 'a'.repeat(5001) }).success).toBe(false);
  });

  // `.strict()`: um campo extra no payload é dado que ninguém lê e que a próxima
  // pessoa vai acreditar que funciona.
  it('recusa campo desconhecido', () => {
    expect(socialPostPayload.safeParse({ ...VALID, scheduledAt: '2026-08-05T10:00:00Z' }).success).toBe(false);
  });
});

describe('parseActionPayload', () => {
  it('devolve o payload tipado para SOCIAL_POST', () => {
    expect(parseActionPayload(ActionType.SOCIAL_POST, VALID)).toEqual(VALID);
  });

  it('estoura num payload gravado que não é o contrato', () => {
    expect(() => parseActionPayload(ActionType.SOCIAL_POST, { content: 'só isso' })).toThrow();
  });
});
```

- [ ] **Step 3: Rode os dois testes e confirme que falham**

Run: `pnpm vitest run src/http/api/actions`
Expected: FAIL — `Cannot find module './actions.domain.js'` e `'./actions.payload.js'`.

- [ ] **Step 4: Adicione os enums e modelos ao `prisma/schema.prisma`**

Ao fim do arquivo:

```prisma
enum ActionType {
  SOCIAL_POST
}

enum ActionStatus {
  PROPOSED
  PENDING_APPROVAL
  APPROVED
  EXECUTING
  EXECUTED
  FAILED
  CANCELLED
  DELIVERY_UNKNOWN
}

enum ApprovalStatus {
  PENDING
  APPROVED
  REJECTED
}

model Action {
  id           String       @id @default(uuid())
  workspaceId  String
  experimentId String?
  type         ActionType
  name         String
  description  String?
  payload      Json
  status       ActionStatus @default(PROPOSED)
  createdBy    String
  approvedAt   DateTime?
  executedAt   DateTime?
  attempts     Int          @default(0)
  lastError    String?
  failureKind  String?
  /** Sinal de vida do processor. Separa "lento" de "morto" para o reaper. */
  heartbeatAt  DateTime?
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  workspace  Workspace   @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  // SetNull, e não Cascade: apagar um experimento não pode apagar o registro de
  // um post que foi publicado no mundo.
  experiment Experiment? @relation(fields: [experimentId], references: [id], onDelete: SetNull)
  approvals  Approval[]

  @@index([workspaceId])
  @@index([experimentId])
  @@index([workspaceId, status])
}

model Approval {
  id          String         @id @default(uuid())
  workspaceId String
  actionId    String
  requestedBy String
  reviewedBy  String?
  status      ApprovalStatus @default(PENDING)
  comment     String?
  requestedAt DateTime       @default(now())
  reviewedAt  DateTime?

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  action    Action    @relation(fields: [actionId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
  @@index([actionId])
}

model ExternalReference {
  id            String   @id @default(uuid())
  workspaceId   String
  integrationId String
  entityType    String
  entityId      String
  externalId    String
  metadata      Json?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  workspace   Workspace            @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  integration WorkspaceIntegration @relation(fields: [integrationId], references: [id], onDelete: Cascade)

  // Do doc: um externalId do provider mapeia uma coisa só.
  @@unique([integrationId, entityType, externalId])
  // Deste design: uma Action não pode ter dois posts na mesma integração. É a
  // trava de duplicação no banco, para quando a checagem do processor perder a
  // corrida (spec §6).
  @@unique([integrationId, entityType, entityId])
  @@index([workspaceId])
  @@index([entityType, entityId])
}
```

Adicione as relações inversas. Em `model Workspace`, junto das outras listas:

```prisma
  actions            Action[]
  approvals          Approval[]
  externalReferences ExternalReference[]
```

Em `model Experiment`:

```prisma
  actions       Action[]
```

Em `model WorkspaceIntegration`:

```prisma
  externalReferences ExternalReference[]
```

- [ ] **Step 5: Escreva a migração à mão**

Crie `prisma/migrations/20260804160000_actions_and_external_references/migration.sql`:

```sql
CREATE TYPE "ActionType" AS ENUM ('SOCIAL_POST');

CREATE TYPE "ActionStatus" AS ENUM ('PROPOSED', 'PENDING_APPROVAL', 'APPROVED', 'EXECUTING', 'EXECUTED', 'FAILED', 'CANCELLED', 'DELIVERY_UNKNOWN');

CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "experimentId" TEXT,
    "type" "ActionType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "payload" JSONB NOT NULL,
    "status" "ActionStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "failureKind" TEXT,
    "heartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "reviewedBy" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalReference" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalReference_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Action_workspaceId_idx" ON "Action"("workspaceId");
CREATE INDEX "Action_experimentId_idx" ON "Action"("experimentId");
CREATE INDEX "Action_workspaceId_status_idx" ON "Action"("workspaceId", "status");

CREATE INDEX "Approval_workspaceId_idx" ON "Approval"("workspaceId");
CREATE INDEX "Approval_actionId_idx" ON "Approval"("actionId");

CREATE UNIQUE INDEX "ExternalReference_integrationId_entityType_externalId_key" ON "ExternalReference"("integrationId", "entityType", "externalId");
CREATE UNIQUE INDEX "ExternalReference_integrationId_entityType_entityId_key" ON "ExternalReference"("integrationId", "entityType", "entityId");
CREATE INDEX "ExternalReference_workspaceId_idx" ON "ExternalReference"("workspaceId");
CREATE INDEX "ExternalReference_entityType_entityId_idx" ON "ExternalReference"("entityType", "entityId");

ALTER TABLE "Action" ADD CONSTRAINT "Action_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Action" ADD CONSTRAINT "Action_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Approval" ADD CONSTRAINT "Approval_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ExternalReference" ADD CONSTRAINT "ExternalReference_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalReference" ADD CONSTRAINT "ExternalReference_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "WorkspaceIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 6: Aplique a migração e regenere o cliente**

Run: `pnpm prisma:deploy && pnpm prisma:generate`
Expected: uma migração nova aplicada, cliente regenerado. Se aparecer drift, **pare e reporte** — não rode `migrate dev` nem `migrate reset`.

- [ ] **Step 7: Escreva `actions.domain.ts`**

```ts
import { ActionStatus } from '@prisma/client';
import { BadRequestError } from '../../../lib/errors.js';

/**
 * As arestas que existem. Formato de `experiments.domain.ts`, e pela mesma
 * razão: a tabela é lida por humano, e uma condição espalhada por controllers
 * não é.
 *
 * `EXECUTING` não tem saída aqui porque nenhuma rota o move: quem o tira do
 * lugar é o processor (EXECUTED/FAILED) ou o reaper (DELIVERY_UNKNOWN).
 * `DELIVERY_UNKNOWN` sai só por ato humano, e para dois lugares — nunca de
 * volta para EXECUTING sozinho, que seria republicar às cegas (spec §7.3).
 */
export const TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  [ActionStatus.PROPOSED]: [ActionStatus.PENDING_APPROVAL, ActionStatus.CANCELLED],
  [ActionStatus.PENDING_APPROVAL]: [ActionStatus.APPROVED, ActionStatus.PROPOSED, ActionStatus.CANCELLED],
  [ActionStatus.APPROVED]: [ActionStatus.EXECUTING, ActionStatus.CANCELLED],
  [ActionStatus.EXECUTING]: [ActionStatus.EXECUTED, ActionStatus.FAILED, ActionStatus.DELIVERY_UNKNOWN],
  [ActionStatus.FAILED]: [ActionStatus.EXECUTING, ActionStatus.CANCELLED],
  [ActionStatus.DELIVERY_UNKNOWN]: [ActionStatus.EXECUTED, ActionStatus.APPROVED],
  [ActionStatus.EXECUTED]: [],
  [ActionStatus.CANCELLED]: [],
};

export function assertActionTransition(from: ActionStatus, to: ActionStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new BadRequestError(`Cannot move action from ${from} to ${to}`);
  }
}

/** Os estados de onde uma execução pode partir. Usado pelo compare-and-swap. */
export const EXECUTABLE_FROM: ActionStatus[] = [ActionStatus.APPROVED, ActionStatus.FAILED];
```

- [ ] **Step 8: Escreva `actions.payload.ts`**

```ts
import { ActionType } from '@prisma/client';
import { z } from 'zod';

/**
 * O payload de um post social.
 *
 * `channelName` e `providerIdentifier` são snapshot deliberado: a lista de
 * canais é lida ao vivo no Postiz e nunca persistida, e sem o snapshot a Action
 * de ontem não saberia dizer para onde foi. Uma Action executada precisa mais
 * de saber isso do que de estar atualizada (spec §4.2).
 *
 * `providerIdentifier` vira `settings.__type` na chamada ao Postiz.
 */
export const socialPostPayload = z
  .object({
    channelId: z.string().min(1).max(128),
    channelName: z.string().min(1).max(200),
    providerIdentifier: z.string().min(1).max(64),
    content: z.string().min(1).max(5000),
  })
  .strict();

export type SocialPostPayload = z.infer<typeof socialPostPayload>;

/**
 * União discriminada por `type`, com um tipo só. Existe assim para o segundo
 * tipo custar um `case` em vez de uma refatoração.
 *
 * `.parse` e não `.safeParse`: o payload é escrito só por nós, e validado na
 * entrada da rota. Um parse que falha aqui é bug nosso, e um 500 é o sinal
 * certo — devolver silenciosamente um payload vazio esconderia corrupção.
 */
export function parseActionPayload(type: ActionType, payload: unknown): SocialPostPayload {
  switch (type) {
    case ActionType.SOCIAL_POST:
      return socialPostPayload.parse(payload);
  }
}
```

- [ ] **Step 9: Rode os testes de domínio e payload**

Run: `pnpm vitest run src/http/api/actions`
Expected: PASS, todos.

- [ ] **Step 10: Adicione os quatro códigos ao catálogo**

Em `src/shared/errors/catalog.ts`, depois de `NO_ANALYTICS_PROPERTY`:

```ts
  POSTIZ_NOT_CONNECTED: { code: 'AUR-T0041', status: 400 },
  POSTIZ_CHANNEL_NOT_FOUND: { code: 'AUR-T0042', status: 400 },
  // 502 pela mesma razão de MEASUREMENT_READ_FAILED: a requisição está correta
  // e o recurso existe — quem recusou foi o provider. Um 400 mandaria o
  // fundador corrigir o que ele acertou.
  POSTIZ_REQUEST_FAILED: { code: 'AUR-T0043', status: 502 },
  ACTION_NOT_RESOLVABLE: { code: 'AUR-T0044', status: 409 },
```

- [ ] **Step 11: Adicione as três traduções**

`src/shared/errors/i18n/pt-BR.json`:

```json
  "AUR-T0041": "Nenhuma conta do Postiz está conectada neste workspace.",
  "AUR-T0042": "Este canal não está mais na sua conta do Postiz.",
  "AUR-T0043": "O Postiz recusou o pedido: {{reason}}",
  "AUR-T0044": "Esta ação não está aguardando uma decisão sobre a entrega."
```

`en-US.json`:

```json
  "AUR-T0041": "No Postiz account is connected to this workspace.",
  "AUR-T0042": "That channel is no longer in your Postiz account.",
  "AUR-T0043": "Postiz refused the request: {{reason}}",
  "AUR-T0044": "This action is not waiting on a delivery decision."
```

`es-ES.json`:

```json
  "AUR-T0041": "No hay ninguna cuenta de Postiz conectada a este espacio de trabajo.",
  "AUR-T0042": "Ese canal ya no está en tu cuenta de Postiz.",
  "AUR-T0043": "Postiz rechazó la solicitud: {{reason}}",
  "AUR-T0044": "Esta acción no está esperando una decisión sobre la entrega."
```

- [ ] **Step 12: Adicione as quatro classes de erro**

Ao fim de `src/lib/errors.ts`:

```ts
/**
 * As quatro recusas da execução de ações. Códigos distintos porque a tela faz
 * coisas diferentes com cada uma: mandar conectar o Postiz, recarregar a lista
 * de canais, mostrar a mensagem do provider, ou dizer que não há decisão
 * pendente.
 */
export class PostizNotConnectedError extends AppError {
  constructor() {
    const def = getErrorDef('POSTIZ_NOT_CONNECTED');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

export class PostizChannelNotFoundError extends AppError {
  constructor() {
    const def = getErrorDef('POSTIZ_CHANNEL_NOT_FOUND');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}

/** A recusa do próprio provider, com a mensagem dele nos detalhes. */
export class PostizRequestFailedError extends AppError {
  constructor(params: { reason: string }) {
    const def = getErrorDef('POSTIZ_REQUEST_FAILED');
    super(def.status, def.code, translateError(def.code, 'pt-BR', params), params);
  }
}

export class ActionNotResolvableError extends AppError {
  constructor() {
    const def = getErrorDef('ACTION_NOT_RESOLVABLE');
    super(def.status, def.code, translateError(def.code, 'pt-BR'));
  }
}
```

- [ ] **Step 13: Rode a suíte inteira e o typecheck**

Run: `pnpm typecheck && pnpm test`
Expected: tsc exit 0; suíte verde, incluindo o teste de paridade de chaves do i18n (as quatro chaves nos três bundles).

- [ ] **Step 14: Stage e reporte**

```bash
git add prisma/schema.prisma prisma/migrations/20260804160000_actions_and_external_references src/http/api/actions src/shared/errors src/lib/errors.ts
git status --short
git diff --cached --stat
```

**Não rode `git commit`.** Reporte o diff resumido e a contagem de testes.

---

## Task 2: Cliente Postiz

O conector. Nada de HTTP nosso, nada de Prisma — só a API do Postiz atrás de uma interface, com a falha classificada. Formato do conector GA4 (`src/integrations/analytics/ga4/ga4-admin.ts`): `fetch` + Zod + erro tipado.

**Files:**
- Create: `src/integrations/social/postiz/postiz-client.ts`
- Create: `src/integrations/social/postiz/postiz-client.test.ts`
- Create: `src/integrations/social/postiz/postiz-credential.ts`
- Create: `src/integrations/social/postiz/postiz-credential.test.ts`
- Create: `src/integrations/social/index.ts`

**Interfaces:**
- Consumes: nada das tasks anteriores.
- Produces, de `src/integrations/social/index.ts`:
  - `type PostizChannel = { id: string; name: string; providerIdentifier: string; picture: string | null }`
  - `type PostizCreatedPost = { id: string; state: string | null }`
  - `type PostizFailureKind = 'AUTH' | 'VALIDATION' | 'RATE_LIMIT' | 'PROVIDER' | 'NETWORK' | 'UNKNOWN'`
  - `class PostizError extends Error { readonly kind: PostizFailureKind; readonly status: number | null }`
  - `type PostizConfig = { apiKey: string; baseUrl: string }`
  - `type PostizClient = { listChannels(signal: AbortSignal): Promise<PostizChannel[]>; createPost(input: { channelId: string; providerIdentifier: string; content: string }, signal: AbortSignal): Promise<PostizCreatedPost> }`
  - `function createPostizClient(config: PostizConfig): PostizClient`
  - `function isRetriable(kind: PostizFailureKind): boolean`
  - `function isIndeterminate(kind: PostizFailureKind): boolean`
  - `function normalizeBaseUrl(raw: string): string`
  - `function parsePostizCredential(credentialsJson: string): PostizConfig`

- [ ] **Step 1: Escreva o teste do cliente**

Crie `src/integrations/social/postiz/postiz-client.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPostizClient, isIndeterminate, isRetriable, normalizeBaseUrl, PostizError } from './postiz-client.js';

const CONFIG = { apiKey: 'pos_abc', baseUrl: 'https://postiz.acme.com' };

const client = () => createPostizClient(CONFIG);
const signal = () => AbortSignal.timeout(1000);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => vi.restoreAllMocks());

describe('createPostizClient.listChannels', () => {
  it('lê os canais e devolve o que a tela mostra', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse([
        { id: 'chan-1', name: 'AUREA no Instagram', providerIdentifier: 'instagram', picture: 'https://p/1.png' },
        { id: 'chan-2', name: 'AUREA no X', providerIdentifier: 'x' },
      ]),
    );

    const channels = await client().listChannels(signal());

    expect(channels).toEqual([
      { id: 'chan-1', name: 'AUREA no Instagram', providerIdentifier: 'instagram', picture: 'https://p/1.png' },
      // `picture` ausente vira null, e não some: a tela decide o placeholder.
      { id: 'chan-2', name: 'AUREA no X', providerIdentifier: 'x', picture: null },
    ]);
    // Authorization crua, sem "Bearer": é o que a API do Postiz aceita.
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://postiz.acme.com/public/v1/integrations');
    expect((init as RequestInit).headers).toMatchObject({ authorization: 'pos_abc' });
  });

  // Sem `.default([])` no schema: um corpo que não traz o contrato não é uma
  // conta sem canais, é um corpo que não entendemos. Confundir os dois faria a
  // tela dizer "nenhum canal conectado" para um Postiz que respondeu HTML.
  it('recusa um corpo que não é o contrato', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ items: [] }));

    await expect(client().listChannels(signal())).rejects.toMatchObject({ kind: 'UNKNOWN' });
  });

  it('recusa um canal sem providerIdentifier', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([{ id: 'chan-1', name: 'sem tipo' }]));

    await expect(client().listChannels(signal())).rejects.toBeInstanceOf(PostizError);
  });

  it('uma conta sem canais é lista vazia, não erro', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]));

    await expect(client().listChannels(signal())).resolves.toEqual([]);
  });
});

describe('createPostizClient.createPost', () => {
  const INPUT = { channelId: 'chan-1', providerIdentifier: 'instagram', content: 'texto do post' };

  it('monta o corpo que a API do Postiz espera', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ id: 'post_1', state: 'QUEUE' }));

    const created = await client().createPost(INPUT, signal());

    expect(created).toEqual({ id: 'post_1', state: 'QUEUE' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://postiz.acme.com/public/v1/posts');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      // `now`, e não `schedule`: agendar está fora desta fatia (spec §12).
      type: 'now',
      posts: [
        {
          integration: { id: 'chan-1' },
          value: [{ content: 'texto do post' }],
          settings: { __type: 'instagram' },
        },
      ],
    });
  });

  // O `id` é o que vai para `ExternalReference.externalId`. Sem ele não há
  // proveniência, e gravar sem proveniência é pior que falhar.
  it('recusa uma resposta sem id', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ state: 'QUEUE' }));

    await expect(client().createPost(INPUT, signal())).rejects.toMatchObject({ kind: 'UNKNOWN' });
  });

  it('aceita uma resposta sem state', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ id: 'post_1' }));

    await expect(client().createPost(INPUT, signal())).resolves.toEqual({ id: 'post_1', state: null });
  });
});

// A classificação é o coração da política de retry (spec §7.2): ela não
// pergunta "é transiente?", pergunta o que se sabe sobre a chamada.
describe('classificação da falha', () => {
  const cases: Array<[number, string]> = [
    [401, 'AUTH'],
    [403, 'AUTH'],
    [400, 'VALIDATION'],
    [422, 'VALIDATION'],
    [429, 'RATE_LIMIT'],
    [500, 'PROVIDER'],
    [503, 'PROVIDER'],
    [418, 'UNKNOWN'],
  ];

  for (const [status, kind] of cases) {
    it(`status ${status} vira ${kind}`, async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'nope' }, status));

      await expect(client().listChannels(signal())).rejects.toMatchObject({ kind, status });
    });
  }

  it('usa a mensagem do provider quando ela vem no corpo', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ message: 'Missing subreddit' }, 400));

    await expect(client().listChannels(signal())).rejects.toMatchObject({
      kind: 'VALIDATION',
      message: 'Missing subreddit',
    });
  });

  it('cai num texto com o status quando o corpo não diz nada', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('<html>502</html>', { status: 502 }));

    await expect(client().listChannels(signal())).rejects.toMatchObject({
      kind: 'PROVIDER',
      message: 'postiz request failed with status 502',
    });
  });

  // Rede morta é o caso em que não se sabe se o post existe. É por isso que ela
  // tem kind próprio, e é por isso que ela nunca retenta.
  it('um fetch que estoura vira NETWORK, sem status', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));

    await expect(client().listChannels(signal())).rejects.toMatchObject({ kind: 'NETWORK', status: null });
  });

  it('um abort vira NETWORK', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }),
    );

    await expect(client().listChannels(signal())).rejects.toMatchObject({ kind: 'NETWORK' });
  });
});

describe('isRetriable / isIndeterminate', () => {
  it('só 429 e 5xx retentam', () => {
    expect(isRetriable('RATE_LIMIT')).toBe(true);
    expect(isRetriable('PROVIDER')).toBe(true);
    expect(isRetriable('AUTH')).toBe(false);
    expect(isRetriable('VALIDATION')).toBe(false);
    expect(isRetriable('NETWORK')).toBe(false);
    expect(isRetriable('UNKNOWN')).toBe(false);
  });

  it('indeterminado é exatamente o que não pode retentar sozinho', () => {
    expect(isIndeterminate('NETWORK')).toBe(true);
    expect(isIndeterminate('UNKNOWN')).toBe(true);
    expect(isIndeterminate('AUTH')).toBe(false);
    expect(isIndeterminate('RATE_LIMIT')).toBe(false);
  });

  // As duas listas não podem se sobrepor: um kind que retenta E é indeterminado
  // republicaria post público.
  it('nenhum kind é retentável e indeterminado ao mesmo tempo', () => {
    const kinds = ['AUTH', 'VALIDATION', 'RATE_LIMIT', 'PROVIDER', 'NETWORK', 'UNKNOWN'] as const;
    for (const kind of kinds) {
      expect(isRetriable(kind) && isIndeterminate(kind)).toBe(false);
    }
  });
});

describe('normalizeBaseUrl', () => {
  it('tira a barra final', () => {
    expect(normalizeBaseUrl('https://postiz.acme.com/')).toBe('https://postiz.acme.com');
  });

  it('tira várias barras finais', () => {
    expect(normalizeBaseUrl('https://postiz.acme.com///')).toBe('https://postiz.acme.com');
  });

  it('deixa uma url já normalizada em paz', () => {
    expect(normalizeBaseUrl('https://postiz.acme.com')).toBe('https://postiz.acme.com');
  });
});
```

- [ ] **Step 2: Escreva o teste da credencial**

Crie `src/integrations/social/postiz/postiz-credential.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parsePostizCredential } from './postiz-credential.js';

describe('parsePostizCredential', () => {
  it('abre o JSON selado', () => {
    expect(parsePostizCredential(JSON.stringify({ apiKey: 'pos_abc', baseUrl: 'https://p.acme.com' }))).toEqual({
      apiKey: 'pos_abc',
      baseUrl: 'https://p.acme.com',
    });
  });

  it('normaliza a base url na leitura também', () => {
    expect(parsePostizCredential(JSON.stringify({ apiKey: 'k', baseUrl: 'https://p.acme.com/' }))).toMatchObject({
      baseUrl: 'https://p.acme.com',
    });
  });

  // Uma credencial gravada que não é o contrato tem de recusar com kind próprio,
  // e não estourar um SyntaxError cru no meio do worker.
  it('recusa um JSON que não é o contrato', () => {
    expect(() => parsePostizCredential(JSON.stringify({ token: 'x' }))).toThrowError(
      /postiz credential is unreadable/,
    );
  });

  it('recusa texto que não é JSON', () => {
    expect(() => parsePostizCredential('pos_abc')).toThrowError(/postiz credential is unreadable/);
  });
});
```

- [ ] **Step 3: Rode e confirme a falha**

Run: `pnpm vitest run src/integrations/social`
Expected: FAIL — `Cannot find module './postiz-client.js'`.

- [ ] **Step 4: Escreva `postiz-client.ts`**

```ts
import { z } from 'zod';

/** Onde a API pública do Postiz mora, dentro de qualquer instância. */
const API_PREFIX = '/public/v1';

/**
 * O que se sabe sobre a chamada — não "é transiente?".
 *
 * Essa distinção é a política de retry inteira (spec §7.2): `NETWORK` é o caso
 * em que o post pode existir do outro lado e ninguém sabe, e retentar ali
 * duplica post num canal público.
 */
export type PostizFailureKind = 'AUTH' | 'VALIDATION' | 'RATE_LIMIT' | 'PROVIDER' | 'NETWORK' | 'UNKNOWN';

export class PostizError extends Error {
  readonly kind: PostizFailureKind;
  /** Null quando não houve resposta — rede morta, abort, DNS. */
  readonly status: number | null;

  constructor(kind: PostizFailureKind, message: string, status: number | null = null) {
    super(message);
    this.name = 'PostizError';
    this.kind = kind;
    this.status = status;
  }
}

/** O Postiz respondeu e não criou nada: retentar o mesmo pedido pode dar certo. */
export function isRetriable(kind: PostizFailureKind): boolean {
  return kind === 'RATE_LIMIT' || kind === 'PROVIDER';
}

/** Não se sabe se criou. Nunca retenta sozinho — precisa de humano. */
export function isIndeterminate(kind: PostizFailureKind): boolean {
  return kind === 'NETWORK' || kind === 'UNKNOWN';
}

/**
 * `{baseUrl}/public/v1` com barra dupla é 404 em alguns proxies, e o fundador
 * cola a URL com barra final metade das vezes.
 */
export function normalizeBaseUrl(raw: string): string {
  return raw.replace(/\/+$/, '');
}

export type PostizConfig = { apiKey: string; baseUrl: string };

export type PostizChannel = {
  id: string;
  name: string;
  providerIdentifier: string;
  /** Null quando o Postiz não manda foto: a tela decide o placeholder. */
  picture: string | null;
};

export type PostizCreatedPost = {
  id: string;
  /** `QUEUE` na criação. Virar PUBLISHED é assíncrono lá dentro (spec §3.4). */
  state: string | null;
};

export type PostizClient = {
  listChannels(signal: AbortSignal): Promise<PostizChannel[]>;
  createPost(
    input: { channelId: string; providerIdentifier: string; content: string },
    signal: AbortSignal,
  ): Promise<PostizCreatedPost>;
};

// Sem `.default()` em nada que defina o contrato: um corpo sem `id` não é um
// post sem id, é um corpo que não entendemos — e tratar os dois igual faria a
// tela afirmar entrega que não houve.
const channelsSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    providerIdentifier: z.string(),
    picture: z.string().nullish(),
  }),
);

const createdPostSchema = z.object({
  id: z.string(),
  state: z.string().nullish(),
});

/** A mensagem do provider quando ela existe: "Missing subreddit" diz o que fazer. */
const providerMessageSchema = z.object({ message: z.string().min(1) });

function classify(status: number): PostizFailureKind {
  if (status === 401 || status === 403) return 'AUTH';
  // 404 e 405 vêm de roteamento — uma `baseUrl` errada, um proxy na frente —
  // e roteamento acontece antes de qualquer criação: o post não existe. Ficam
  // com `VALIDATION`, a família de "respondeu, não criou, e retentar não
  // conserta". Caíssem em `UNKNOWN` e toda publicação de uma instância mal
  // configurada viraria "entrega incerta", mandando o fundador conferir um
  // canal onde o pedido nunca chegou ao endpoint que publica.
  if (status === 400 || status === 404 || status === 405 || status === 422) return 'VALIDATION';
  if (status === 429) return 'RATE_LIMIT';
  if (status >= 500) return 'PROVIDER';
  return 'UNKNOWN';
}

async function providerMessage(response: Response): Promise<string | null> {
  return response
    .json()
    .then((json: unknown) => {
      const parsed = providerMessageSchema.safeParse(json);
      return parsed.success ? parsed.data.message : null;
    })
    .catch(() => null);
}

export function createPostizClient(config: PostizConfig): PostizClient {
  const base = `${normalizeBaseUrl(config.baseUrl)}${API_PREFIX}`;

  /**
   * Toda chamada passa por aqui, e toda falha sai como `PostizError` com kind.
   * Um erro cru de `fetch` escapando daqui viraria 500 sem classificação — e o
   * processor decide retry pelo kind.
   */
  async function request(path: string, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${base}${path}`, {
        ...init,
        headers: { authorization: config.apiKey, ...(init.headers ?? {}) },
        signal,
      });
    } catch (error) {
      // Rede morta, abort, DNS: não houve resposta, então não se sabe nada.
      throw new PostizError('NETWORK', error instanceof Error ? error.message : 'the postiz request failed');
    }

    if (!response.ok) {
      const detail = await providerMessage(response);
      throw new PostizError(
        classify(response.status),
        detail ?? `postiz request failed with status ${response.status}`,
        response.status,
      );
    }

    return response.json().catch(() => null);
  }

  return {
    async listChannels(signal) {
      const body = await request('/integrations', { method: 'GET' }, signal);
      const parsed = channelsSchema.safeParse(body);
      if (!parsed.success) throw new PostizError('UNKNOWN', 'postiz returned an unreadable channel list');
      return parsed.data.map((channel) => ({
        id: channel.id,
        name: channel.name,
        providerIdentifier: channel.providerIdentifier,
        picture: channel.picture ?? null,
      }));
    },

    async createPost(input, signal) {
      const body = await request(
        '/posts',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            // `now`: agendar está fora desta fatia (spec §12).
            type: 'now',
            posts: [
              {
                integration: { id: input.channelId },
                value: [{ content: input.content }],
                settings: { __type: input.providerIdentifier },
              },
            ],
          }),
        },
        signal,
      );

      const parsed = createdPostSchema.safeParse(body);
      // Sem `id` não há proveniência, e gravar entrega sem proveniência é pior
      // que falhar: o `id` é o que vai para `ExternalReference.externalId`.
      if (!parsed.success) throw new PostizError('UNKNOWN', 'postiz returned an unreadable post');
      return { id: parsed.data.id, state: parsed.data.state ?? null };
    },
  };
}
```

- [ ] **Step 5: Escreva `postiz-credential.ts`**

```ts
import { z } from 'zod';
import { normalizeBaseUrl, PostizError, type PostizConfig } from './postiz-client.js';

const credentialSchema = z.object({
  apiKey: z.string().min(1).max(512),
  baseUrl: z.string().url().max(512),
});

/** O contrato do texto claro que vai selado em `WorkspaceIntegration`. */
export const postizCredentialSchema = credentialSchema;

/**
 * Abre o JSON da credencial. Recusa como `PostizError` e não como
 * `SyntaxError`: quem chama isto é o processor, e ele decide o que fazer pelo
 * kind — um erro cru viraria 500 sem classificação.
 *
 * `UNKNOWN` e não `AUTH`: a credencial não foi recusada pelo Postiz, ela está
 * ilegível para nós.
 */
export function parsePostizCredential(credentialsJson: string): PostizConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(credentialsJson);
  } catch {
    throw new PostizError('UNKNOWN', 'the postiz credential is unreadable');
  }

  const parsed = credentialSchema.safeParse(raw);
  if (!parsed.success) throw new PostizError('UNKNOWN', 'the postiz credential is unreadable');

  return { apiKey: parsed.data.apiKey, baseUrl: normalizeBaseUrl(parsed.data.baseUrl) };
}
```

- [ ] **Step 6: Escreva `src/integrations/social/index.ts`**

```ts
export {
  createPostizClient,
  isIndeterminate,
  isRetriable,
  normalizeBaseUrl,
  PostizError,
  type PostizChannel,
  type PostizClient,
  type PostizConfig,
  type PostizCreatedPost,
  type PostizFailureKind,
} from './postiz/postiz-client.js';
export { parsePostizCredential, postizCredentialSchema } from './postiz/postiz-credential.js';
```

- [ ] **Step 7: Rode os testes**

Run: `pnpm vitest run src/integrations/social`
Expected: PASS, todos.

- [ ] **Step 8: Typecheck e suíte**

Run: `pnpm typecheck && pnpm test`
Expected: tsc exit 0; suíte verde.

- [ ] **Step 9: Stage e reporte**

```bash
git add src/integrations/social
git status --short
git diff --cached --stat
```

**Não rode `git commit`.**

---

## Task 3: Conectar o Postiz e listar canais

Duas rotas. Reusa `WorkspaceIntegration`, e a listagem de canais é ao vivo — nada de canal é persistido.

**Files:**
- Modify: `src/http/api/integrations/integrations.schema.ts`
- Modify: `src/http/api/integrations/integrations.repository.ts`
- Create: `src/http/api/integrations/put-postiz/put-postiz.schema.ts`
- Create: `src/http/api/integrations/put-postiz/put-postiz.controller.ts`
- Create: `src/http/api/integrations/postiz-channels/postiz-channels.schema.ts`
- Create: `src/http/api/integrations/postiz-channels/postiz-channels.controller.ts`
- Modify: `src/http/api/integrations/index.ts`
- Create: `src/http/api/integrations/postiz.test.ts`

**Interfaces:**
- Consumes: `createPostizClient`, `PostizError`, `normalizeBaseUrl`, `parsePostizCredential`, `type PostizChannel`, `type PostizClient` de `src/integrations/social/index.js` (Task 2). `PostizNotConnectedError`, `PostizRequestFailedError` de `src/lib/errors.js` (Task 1).
- Produces:
  - `upsertApiKey(input)` em `IntegrationsRepository`.
  - `PutPostizOptions = { verifyPostiz?: VerifyPostiz }` e `putPostizRoute`.
  - `PostizChannelsOptions = { postiz?: (config: PostizConfig) => PostizClient }` e `postizChannelsRoute`.
  - `type VerifyPostiz = (config: PostizConfig) => Promise<{ ok: true; accountLabel: string } | { ok: false; reason: string }>`
  - `integrationProvider` passa a ser `z.enum(['GA4', 'POSTIZ'])`.

- [ ] **Step 1: Escreva o teste das duas rotas**

Crie `src/http/api/integrations/postiz.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../lib/errors.js';
import { seal } from '../../../billing/crypto.js';
import { PostizError } from '../../../integrations/social/index.js';
import { integrationsRoutes } from './index.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';

// Bytes selados de verdade: `postizChannelsRoute` decifra a credencial, e bytes
// de mentira falhariam no `open` antes de qualquer coisa interessante.
const SEALED = seal(JSON.stringify({ apiKey: 'pos_abc', baseUrl: 'https://postiz.acme.com' }));

const ROW = {
  id: 'int-postiz',
  workspaceId: WORKSPACE_ID,
  provider: 'POSTIZ',
  authKind: 'API_KEY',
  ciphertext: new Uint8Array(SEALED.ciphertext),
  iv: new Uint8Array(SEALED.iv),
  authTag: new Uint8Array(SEALED.authTag),
  externalId: null,
  accountLabel: 'postiz.acme.com',
  status: 'OK',
  lastCheckedAt: new Date('2026-08-04T00:00:00.000Z'),
  lastError: null,
  createdBy: 'u1',
  createdAt: new Date('2026-08-04T00:00:00.000Z'),
  updatedAt: new Date('2026-08-04T00:00:00.000Z'),
};

/**
 * `'key' in over`, e não `??`: o caso negativo passa `null` de propósito, e
 * `??` devolveria a linha default de qualquer jeito — o teste de "não
 * conectado" passaria sem que a recusa existisse.
 */
function prismaFake(over: { integration?: unknown } = {}) {
  return {
    workspaceIntegration: {
      findFirst: vi.fn().mockResolvedValue('integration' in over ? over.integration : ROW),
      findMany: vi.fn().mockResolvedValue([ROW]),
      upsert: vi.fn().mockResolvedValue({ ...ROW, ciphertext: undefined, iv: undefined, authTag: undefined }),
      update: vi.fn().mockResolvedValue(ROW),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

const CHANNELS = [
  { id: 'chan-1', name: 'AUREA no Instagram', providerIdentifier: 'instagram', picture: null },
  { id: 'chan-2', name: 'AUREA no X', providerIdentifier: 'x', picture: null },
];

/** Um cliente que nunca sai da máquina. Entra por opção de plugin, jamais por decorator. */
const clientFake = (listChannels = vi.fn().mockResolvedValue(CHANNELS)) => ({
  listChannels,
  createPost: vi.fn(),
});

const acceptingVerify = (accountLabel = 'postiz.acme.com') =>
  vi.fn().mockResolvedValue({ ok: true as const, accountLabel });

beforeEach(() => vi.clearAllMocks());

async function buildApp(
  prisma: unknown,
  opts: {
    role?: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
    verifyPostiz?: ReturnType<typeof acceptingVerify>;
    postiz?: ReturnType<typeof clientFake>;
  } = {},
) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prisma as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = {
      userId: 'u1',
      organizationId: 'org-1',
      workspaceId: WORKSPACE_ID,
      role: opts.role ?? 'ADMIN',
    };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, details: error.details } });
    }
    throw error;
  });
  await app.register(integrationsRoutes, {
    verify: vi.fn().mockResolvedValue({ ok: true, accountLabel: 'ga4' }),
    verifyPostiz: opts.verifyPostiz ?? acceptingVerify(),
    postiz: opts.postiz ? () => opts.postiz as never : undefined,
  });
  return app;
}

describe('PUT /integrations/postiz', () => {
  it('grava a credencial verificada e devolve o host como rótulo', async () => {
    const prisma = prismaFake();
    const verifyPostiz = acceptingVerify();
    const app = await buildApp(prisma, { verifyPostiz });

    const res = await app.inject({
      method: 'PUT',
      url: '/integrations/postiz',
      payload: { apiKey: 'pos_abc', baseUrl: 'https://postiz.acme.com' },
    });

    expect(res.statusCode).toBe(200);
    expect(verifyPostiz).toHaveBeenCalledWith({ apiKey: 'pos_abc', baseUrl: 'https://postiz.acme.com' });
    expect(prisma.workspaceIntegration.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId_provider: { workspaceId: WORKSPACE_ID, provider: 'POSTIZ' } },
      }),
    );
  });

  // O segredo nunca sai numa resposta.
  it('não devolve a chave nem os bytes selados', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({
      method: 'PUT',
      url: '/integrations/postiz',
      payload: { apiKey: 'pos_abc', baseUrl: 'https://postiz.acme.com' },
    });

    expect(res.body).not.toContain('pos_abc');
    expect(res.body).not.toContain('ciphertext');
    expect(res.body).not.toContain('authTag');
  });

  // Barra dupla em `{baseUrl}/public/v1` é 404 em alguns proxies.
  it('normaliza a barra final antes de verificar e de selar', async () => {
    const verifyPostiz = acceptingVerify();
    const app = await buildApp(prismaFake(), { verifyPostiz });

    await app.inject({
      method: 'PUT',
      url: '/integrations/postiz',
      payload: { apiKey: 'pos_abc', baseUrl: 'https://postiz.acme.com/' },
    });

    expect(verifyPostiz).toHaveBeenCalledWith({ apiKey: 'pos_abc', baseUrl: 'https://postiz.acme.com' });
  });

  /**
   * Grava mesmo assim, com o erro visível: gravar é a escolha do fundador, e
   * recusar em silêncio esconderia um Postiz que está apenas fora do ar (spec
   * §5.2). É a diferença deste caminho para o do GA4, que recusa.
   */
  it('grava com status FAILED quando a verificação não passa', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma, {
      verifyPostiz: vi.fn().mockResolvedValue({ ok: false as const, reason: 'connect ECONNREFUSED' }),
    });

    const res = await app.inject({
      method: 'PUT',
      url: '/integrations/postiz',
      payload: { apiKey: 'pos_abc', baseUrl: 'https://postiz.acme.com' },
    });

    expect(res.statusCode).toBe(200);
    const write = prisma.workspaceIntegration.upsert.mock.calls[0]![0] as {
      create: { status: string; lastError: string; accountLabel: string };
    };
    expect(write.create.status).toBe('FAILED');
    expect(write.create.lastError).toBe('connect ECONNREFUSED');
    // Sem rótulo do provider, o host é o que o fundador reconhece.
    expect(write.create.accountLabel).toBe('postiz.acme.com');
  });

  it('recusa uma baseUrl que não é url', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({
      method: 'PUT',
      url: '/integrations/postiz',
      payload: { apiKey: 'pos_abc', baseUrl: 'postiz.acme.com' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('MEMBER não conecta fonte', async () => {
    const app = await buildApp(prismaFake(), { role: 'MEMBER' });

    const res = await app.inject({
      method: 'PUT',
      url: '/integrations/postiz',
      payload: { apiKey: 'pos_abc', baseUrl: 'https://postiz.acme.com' },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('GET /integrations/postiz/channels', () => {
  it('devolve os canais lidos ao vivo', async () => {
    const postiz = clientFake();
    const app = await buildApp(prismaFake(), { postiz });

    const res = await app.inject({ method: 'GET', url: '/integrations/postiz/channels' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ channels: CHANNELS });
    expect(postiz.listChannels).toHaveBeenCalled();
  });

  it('lê apenas dentro do workspace do tenant', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma, { postiz: clientFake() });

    await app.inject({ method: 'GET', url: '/integrations/postiz/channels' });

    expect(prisma.workspaceIntegration.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: WORKSPACE_ID, provider: 'POSTIZ' },
    });
  });

  it('recusa com código próprio quando não há Postiz conectado', async () => {
    const app = await buildApp(prismaFake({ integration: null }), { postiz: clientFake() });

    const res = await app.inject({ method: 'GET', url: '/integrations/postiz/channels' });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUR-T0041');
  });

  // 502 com a mensagem do provider: "Unauthorized" diz ao fundador o que fazer.
  it('devolve 502 com a razão quando o Postiz recusa', async () => {
    const postiz = clientFake(vi.fn().mockRejectedValue(new PostizError('AUTH', 'Unauthorized', 401)));
    const app = await buildApp(prismaFake(), { postiz });

    const res = await app.inject({ method: 'GET', url: '/integrations/postiz/channels' });

    expect(res.statusCode).toBe(502);
    expect(res.json().error).toMatchObject({ code: 'AUR-T0043', details: { reason: 'Unauthorized' } });
  });

  it('uma conta sem canais é lista vazia, não erro', async () => {
    const app = await buildApp(prismaFake(), { postiz: clientFake(vi.fn().mockResolvedValue([])) });

    const res = await app.inject({ method: 'GET', url: '/integrations/postiz/channels' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ channels: [] });
  });

  it('MEMBER não lista canais', async () => {
    const app = await buildApp(prismaFake(), { role: 'MEMBER', postiz: clientFake() });

    const res = await app.inject({ method: 'GET', url: '/integrations/postiz/channels' });

    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Rode e confirme a falha**

Run: `pnpm vitest run src/http/api/integrations/postiz.test.ts`
Expected: FAIL — as rotas não existem (404) e `verifyPostiz` não é opção conhecida.

- [ ] **Step 3: Amplie `integrations.schema.ts`**

Troque a linha 3:

```ts
// POSTIZ entra ao lado do GA4: é outra fonte, com outro papel (executa, não
// mede), e a mesma tabela guarda as duas.
export const integrationProvider = z.enum(['GA4', 'POSTIZ']);
```

- [ ] **Step 4: Adicione `upsertApiKey` ao repositório**

Em `src/http/api/integrations/integrations.repository.ts`, depois de `upsertOauth`:

```ts
    /**
     * A gravação da chave de API do Postiz.
     *
     * Separada de `upsert` porque grava o resultado da verificação **como ele
     * veio**, inclusive `FAILED`: `upsert` sempre grava `OK` porque só é
     * chamada depois de uma verificação que passou. Aqui uma verificação que
     * não passou ainda grava — recusar em silêncio esconderia um Postiz que
     * está apenas fora do ar (spec §5.2).
     */
    upsertApiKey(input: {
      workspaceId: string;
      provider: string;
      ciphertext: Buffer;
      iv: Buffer;
      authTag: Buffer;
      accountLabel: string;
      createdBy: string;
      status: string;
      lastError: string | null;
      checkedAt: Date;
    }) {
      const { workspaceId, provider, createdBy, checkedAt, ciphertext, iv, authTag, ...rest } = input;
      const written = {
        ...rest,
        authKind: 'API_KEY',
        // Uint8Array, não Buffer: é o que a coluna `Bytes` do Prisma aceita.
        ciphertext: new Uint8Array(ciphertext),
        iv: new Uint8Array(iv),
        authTag: new Uint8Array(authTag),
        // Sem property a escolher: o Postiz não tem o equivalente.
        externalId: null,
        lastCheckedAt: checkedAt,
      };
      return prisma.workspaceIntegration.upsert({
        where: { workspaceId_provider: { workspaceId, provider } },
        create: { workspaceId, provider, createdBy, ...written },
        update: written,
        select: PUBLIC_SELECT,
      });
    },
```

- [ ] **Step 5: Escreva `put-postiz/put-postiz.schema.ts`**

```ts
import { z } from 'zod';

/**
 * Rota própria, e não o `PUT /integrations` do GA4: aquele body exige
 * `externalId` só-dígitos ("the GA4 property id is only digits"), e o Postiz não
 * tem property. Uma união onde metade dos campos é ignorada por provider faria
 * a mensagem de validação mentir sobre o que se espera (spec §5.2).
 */
export const putPostizBody = z.object({
  /** A chave de Settings → Developers → Public API. Nunca volta em resposta nenhuma. */
  apiKey: z.string().min(1).max(512),
  /** A raiz da instância, sem `/public/v1`. Normalizada antes de selar. */
  baseUrl: z.string().url().max(512),
});

export type PutPostizBody = z.infer<typeof putPostizBody>;
```

- [ ] **Step 6: Escreva `put-postiz/put-postiz.controller.ts`**

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createPostizClient, normalizeBaseUrl, type PostizConfig } from '../../../../integrations/social/index.js';
import { seal } from '../../../../billing/crypto.js';
import { assertAdmin } from '../../../../lib/tenant.js';
import { createIntegrationsRepository } from '../integrations.repository.js';
import { integrationResponse } from '../integrations.schema.js';
import { putPostizBody } from './put-postiz.schema.js';

/** Uma listagem de canais, não uma publicação. */
const TIMEOUT_MS = 10_000;

const PROVIDER = 'POSTIZ';

export type VerifyPostiz = (
  config: PostizConfig,
) => Promise<{ ok: true; accountLabel: string } | { ok: false; reason: string }>;

/**
 * Uma leitura real contra a instância, barata e rara (só na gravação). Mesma
 * forma de `verify-integration.ts`, e pela mesma razão: uma credencial errada
 * aceita em silêncio só apareceria como publicação falhando dias depois.
 */
export const verifyPostizCredential: VerifyPostiz = async (config) => {
  try {
    await createPostizClient(config).listChannels(AbortSignal.timeout(TIMEOUT_MS));
    // Sem rótulo do provider a copiar: o host é o que o fundador reconhece, e
    // host não é segredo.
    return { ok: true, accountLabel: new URL(config.baseUrl).host };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'unknown error' };
  }
};

export type PutPostizOptions = { verifyPostiz?: VerifyPostiz };

export const putPostizRoute: FastifyPluginAsync<PutPostizOptions> = async (app, opts) => {
  const verify = opts.verifyPostiz ?? verifyPostizCredential;

  app.withTypeProvider<ZodTypeProvider>().put(
    '/integrations/postiz',
    {
      schema: {
        tags: ['integrations'],
        operationId: 'putPostizIntegration',
        body: putPostizBody,
        response: { 200: integrationResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);

      const config: PostizConfig = {
        apiKey: req.body.apiKey,
        baseUrl: normalizeBaseUrl(req.body.baseUrl),
      };
      const verified = await verify(config);

      // Grava nos dois casos, com o resultado visível. Diferente do GA4, que
      // recusa: lá a credencial é a única coisa que a conexão faz, aqui uma
      // instância fora do ar volta sozinha e a chave continua boa (spec §5.2).
      const integration = await createIntegrationsRepository(app.prisma).upsertApiKey({
        workspaceId: req.tenant.workspaceId,
        provider: PROVIDER,
        accountLabel: verified.ok ? verified.accountLabel : new URL(config.baseUrl).host,
        createdBy: req.tenant.userId,
        status: verified.ok ? 'OK' : 'FAILED',
        lastError: verified.ok ? null : verified.reason,
        checkedAt: new Date(),
        ...seal(JSON.stringify(config)),
      });

      return reply.send({ integration });
    },
  );
};
```

- [ ] **Step 7: Escreva `postiz-channels/postiz-channels.schema.ts`**

```ts
import { z } from 'zod';

/**
 * O canal como a tela precisa dele. Nada disto é persistido: sincronizar uma
 * cópia de algo que muda do outro lado aparece como canal fantasma no
 * formulário (spec §5.3).
 */
export const postizChannel = z.object({
  id: z.string(),
  name: z.string(),
  /** Vira `settings.__type` na publicação. */
  providerIdentifier: z.string(),
  picture: z.string().nullable(),
});

export const postizChannelsResponse = z.object({ channels: z.array(postizChannel) });
```

- [ ] **Step 8: Escreva `postiz-channels/postiz-channels.controller.ts`**

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  createPostizClient,
  parsePostizCredential,
  type PostizClient,
  type PostizConfig,
} from '../../../../integrations/social/index.js';
import { PostizNotConnectedError, PostizRequestFailedError } from '../../../../lib/errors.js';
import { assertAdmin } from '../../../../lib/tenant.js';
import { createIntegrationsRepository } from '../integrations.repository.js';
import { openIntegrationCredential } from '../integrations.service.js';
import { postizChannelsResponse } from './postiz-channels.schema.js';

const TIMEOUT_MS = 10_000;

const PROVIDER = 'POSTIZ';

/**
 * A fábrica do cliente, injetável. É este o seam que mantém a suíte fora da
 * rede: nenhum teste precisa lembrar de substituir um decorator ambiente.
 */
export type PostizChannelsOptions = { postiz?: (config: PostizConfig) => PostizClient };

export const postizChannelsRoute: FastifyPluginAsync<PostizChannelsOptions> = async (app, opts) => {
  const clientFor = opts.postiz ?? createPostizClient;

  app.withTypeProvider<ZodTypeProvider>().get(
    '/integrations/postiz/channels',
    {
      schema: {
        tags: ['integrations'],
        operationId: 'listPostizChannels',
        response: { 200: postizChannelsResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);

      const row = await createIntegrationsRepository(app.prisma).find(req.tenant.workspaceId, PROVIDER);
      // Código próprio, e não 404: a tela oferece conectar, não recarregar.
      if (!row) throw new PostizNotConnectedError();

      try {
        const client = clientFor(parsePostizCredential(openIntegrationCredential(row)));
        const channels = await client.listChannels(AbortSignal.timeout(TIMEOUT_MS));
        return reply.send({ channels });
      } catch (error) {
        // A mensagem do provider chega ao fundador: "Unauthorized" diz o que
        // fazer, "falha ao listar" não diz nada.
        throw new PostizRequestFailedError({
          reason: error instanceof Error ? error.message : 'unknown error',
        });
      }
    },
  );
};
```

- [ ] **Step 9: Registre as duas rotas**

Em `src/http/api/integrations/index.ts`, adicione os imports e amplie as opções:

```ts
import { putPostizRoute, type PutPostizOptions } from './put-postiz/put-postiz.controller.js';
import {
  postizChannelsRoute,
  type PostizChannelsOptions,
} from './postiz-channels/postiz-channels.controller.js';
```

```ts
export type IntegrationsRoutesOptions = PutIntegrationOptions &
  GooglePropertiesOptions &
  SelectPropertyOptions &
  RemoveIntegrationOptions &
  PutPostizOptions &
  PostizChannelsOptions;
```

E no corpo do plugin, depois de `selectPropertyRoute`:

```ts
  // Verificador e cliente entram por opção pela mesma razão dos do Google: sem
  // elas, um teste sairia falando com o Postiz de dentro da suíte.
  await app.register(putPostizRoute, { verifyPostiz: opts.verifyPostiz });
  await app.register(postizChannelsRoute, { postiz: opts.postiz });
```

- [ ] **Step 10: Rode o teste do Postiz**

Run: `pnpm vitest run src/http/api/integrations`
Expected: PASS, incluindo `integrations.test.ts`, que não muda.

- [ ] **Step 11: Typecheck, suíte e contrato**

Run: `pnpm typecheck && pnpm test && pnpm openapi:dump`
Expected: tsc exit 0; suíte verde; `../web/api.json` com `putPostizIntegration` e `listPostizChannels`.

- [ ] **Step 12: Stage e reporte**

```bash
git add src/http/api/integrations
git status --short
git diff --cached --stat
```

**Não rode `git commit`.**

---

## Task 4: Compartilhados do recurso e CRUD

Os arquivos compartilhados de `actions/` mais as quatro rotas que criam, listam, leem e editam. Nada de aprovação nem execução ainda.

**Files:**
- Create: `src/http/api/actions/actions.schema.ts`
- Create: `src/http/api/actions/actions.repository.ts`
- Create: `src/http/api/actions/actions.presenter.ts`
- Create: `src/http/api/actions/index.ts`
- Create: `src/http/api/actions/create-action/create-action.{schema,controller}.ts`
- Create: `src/http/api/actions/list-actions/list-actions.{schema,controller}.ts`
- Create: `src/http/api/actions/get-action/get-action.controller.ts`
- Create: `src/http/api/actions/update-action/update-action.{schema,controller}.ts`
- Create: `src/http/api/actions/actions.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Consumes: `socialPostPayload`, `parseActionPayload` (Task 1); `PostizNotConnectedError`, `PostizChannelNotFoundError` (Task 1); `createPostizClient`, `parsePostizCredential`, `type PostizClient`, `type PostizConfig` (Task 2); `createIntegrationsRepository`, `openIntegrationCredential` (existentes).
- Produces:
  - `actionStatus`, `actionTypeEnum`, `approvalStatusEnum`, `actionEntity`, `approvalEntity`, `deliveryEntity`, `actionResponse`, `actionsListResponse`, `actionDetailResponse`, `actionIdParam` de `actions.schema.ts`.
  - `createActionsRepository(prisma)` com `list`, `findById`, `create`, `update`, `findApprovals`, `findDelivery` de `actions.repository.ts`.
  - `presentAction(row)`, `presentApproval(row)`, `presentDelivery(row)` de `actions.presenter.ts`.
  - `actionsRoutes` e `ActionsRoutesOptions = { postiz?: (config: PostizConfig) => PostizClient }` de `index.ts`.

- [ ] **Step 1: Escreva o teste do CRUD**

Crie `src/http/api/actions/actions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../lib/errors.js';
import { seal } from '../../../billing/crypto.js';
import { actionsRoutes } from './index.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const ACTION_ID = '33333333-3333-3333-3333-333333333333';
const EXPERIMENT_ID = '44444444-4444-4444-4444-444444444444';

const SEALED = seal(JSON.stringify({ apiKey: 'pos_abc', baseUrl: 'https://postiz.acme.com' }));

const INTEGRATION = {
  id: 'int-postiz',
  workspaceId: WORKSPACE_ID,
  provider: 'POSTIZ',
  authKind: 'API_KEY',
  ciphertext: new Uint8Array(SEALED.ciphertext),
  iv: new Uint8Array(SEALED.iv),
  authTag: new Uint8Array(SEALED.authTag),
  externalId: null,
  accountLabel: 'postiz.acme.com',
  status: 'OK',
  lastCheckedAt: new Date('2026-08-04T00:00:00.000Z'),
  lastError: null,
  createdBy: 'u1',
  createdAt: new Date('2026-08-04T00:00:00.000Z'),
  updatedAt: new Date('2026-08-04T00:00:00.000Z'),
};

const PAYLOAD = {
  channelId: 'chan-1',
  channelName: 'AUREA no Instagram',
  providerIdentifier: 'instagram',
  content: 'Como cortamos 30% do custo operacional.',
};

const ACTION = {
  id: ACTION_ID,
  workspaceId: WORKSPACE_ID,
  experimentId: null,
  type: 'SOCIAL_POST',
  name: 'Post sobre custo operacional',
  description: null,
  payload: PAYLOAD,
  status: 'PROPOSED',
  createdBy: 'u1',
  approvedAt: null,
  executedAt: null,
  attempts: 0,
  lastError: null,
  failureKind: null,
  heartbeatAt: null,
  createdAt: new Date('2026-08-04T10:00:00.000Z'),
  updatedAt: new Date('2026-08-04T10:00:00.000Z'),
};

const CHANNELS = [{ id: 'chan-1', name: 'AUREA no Instagram', providerIdentifier: 'instagram', picture: null }];

/**
 * `'key' in over`, e não `??`: os casos negativos passam `null` de propósito
 * (ação de outro workspace, sem Postiz conectado), e `??` devolveria o default
 * de qualquer jeito — o teste passaria sem que a recusa existisse.
 */
function prismaFake(
  over: { action?: unknown; integration?: unknown; experiment?: unknown; delivery?: unknown } = {},
) {
  return {
    action: {
      findFirst: vi.fn().mockResolvedValue('action' in over ? over.action : ACTION),
      findMany: vi.fn().mockResolvedValue([ACTION]),
      create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...ACTION, ...data })),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...ACTION, ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    approval: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    externalReference: {
      findFirst: vi.fn().mockResolvedValue('delivery' in over ? over.delivery : null),
    },
    experiment: {
      findFirst: vi.fn().mockResolvedValue(
        'experiment' in over ? over.experiment : { id: EXPERIMENT_ID },
      ),
    },
    workspaceIntegration: {
      findFirst: vi.fn().mockResolvedValue('integration' in over ? over.integration : INTEGRATION),
    },
  };
}

const clientFake = (channels = CHANNELS) => ({
  listChannels: vi.fn().mockResolvedValue(channels),
  createPost: vi.fn(),
});

beforeEach(() => vi.clearAllMocks());

async function buildApp(
  prisma: unknown,
  opts: { role?: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'; postiz?: ReturnType<typeof clientFake> } = {},
) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prisma as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = {
      userId: 'u1',
      organizationId: 'org-1',
      workspaceId: WORKSPACE_ID,
      role: opts.role ?? 'ADMIN',
    };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, details: error.details } });
    }
    throw error;
  });
  const client = opts.postiz ?? clientFake();
  await app.register(actionsRoutes, { postiz: () => client as never });
  return app;
}

const newBody = (over: Record<string, unknown> = {}) => ({
  type: 'SOCIAL_POST',
  name: 'Post sobre custo operacional',
  payload: PAYLOAD,
  ...over,
});

describe('POST /actions', () => {
  it('cria a ação em PROPOSED, com o autor do request', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'POST', url: '/actions', payload: newBody() });

    expect(res.statusCode).toBe(201);
    expect(res.json().action).toMatchObject({ status: 'PROPOSED', name: 'Post sobre custo operacional' });
    expect(prisma.action.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ workspaceId: WORKSPACE_ID, createdBy: 'u1', status: 'PROPOSED' }),
      }),
    );
  });

  // O canal escolhido tem de existir na conta do fundador AGORA. Aceitar um
  // channelId qualquer só falharia na hora de publicar, depois da aprovação.
  it('recusa um canal que não está na conta do Postiz', async () => {
    const app = await buildApp(prismaFake(), { postiz: clientFake([]) });

    const res = await app.inject({ method: 'POST', url: '/actions', payload: newBody() });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUR-T0042');
  });

  it('recusa criar sem Postiz conectado', async () => {
    const app = await buildApp(prismaFake({ integration: null }));

    const res = await app.inject({ method: 'POST', url: '/actions', payload: newBody() });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUR-T0041');
  });

  // O snapshot do canal é gravado do que o Postiz respondeu, não do que o
  // cliente mandou: um nome inventado no body viraria proveniência falsa.
  it('grava o snapshot do canal com o nome que o Postiz devolveu', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    await app.inject({
      method: 'POST',
      url: '/actions',
      payload: newBody({ payload: { ...PAYLOAD, channelName: 'Nome inventado', providerIdentifier: 'x' } }),
    });

    const written = prisma.action.create.mock.calls[0]![0] as { data: { payload: Record<string, unknown> } };
    expect(written.data.payload).toMatchObject({
      channelName: 'AUREA no Instagram',
      providerIdentifier: 'instagram',
    });
  });

  it('aceita vincular a um experimento do mesmo workspace', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    const res = await app.inject({
      method: 'POST',
      url: '/actions',
      payload: newBody({ experimentId: EXPERIMENT_ID }),
    });

    expect(res.statusCode).toBe(201);
    expect(prisma.experiment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: EXPERIMENT_ID, workspaceId: WORKSPACE_ID } }),
    );
  });

  // Um experimento de outro workspace é indistinguível de inexistente.
  it('recusa um experimento que não é do workspace', async () => {
    const app = await buildApp(prismaFake({ experiment: null }));

    const res = await app.inject({
      method: 'POST',
      url: '/actions',
      payload: newBody({ experimentId: EXPERIMENT_ID }),
    });

    expect(res.statusCode).toBe(404);
  });

  it('recusa um payload que não é o contrato', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({
      method: 'POST',
      url: '/actions',
      payload: newBody({ payload: { content: 'só isso' } }),
    });

    expect(res.statusCode).toBe(400);
  });

  it('VIEWER não cria', async () => {
    const app = await buildApp(prismaFake(), { role: 'VIEWER' });

    const res = await app.inject({ method: 'POST', url: '/actions', payload: newBody() });

    expect(res.statusCode).toBe(403);
  });

  // MEMBER propõe: é o papel de quem escreve conteúdo (spec §2, decisão 4).
  it('MEMBER cria', async () => {
    const app = await buildApp(prismaFake(), { role: 'MEMBER' });

    const res = await app.inject({ method: 'POST', url: '/actions', payload: newBody() });

    expect(res.statusCode).toBe(201);
  });
});

describe('GET /actions', () => {
  it('lista as ações do workspace', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'GET', url: '/actions' });

    expect(res.statusCode).toBe(200);
    expect(res.json().actions).toHaveLength(1);
    expect(prisma.action.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: WORKSPACE_ID } }),
    );
  });

  it('filtra por status', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    await app.inject({ method: 'GET', url: '/actions?status=PENDING_APPROVAL' });

    expect(prisma.action.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: WORKSPACE_ID, status: 'PENDING_APPROVAL' } }),
    );
  });

  it('filtra por experimento', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    await app.inject({ method: 'GET', url: `/actions?experimentId=${EXPERIMENT_ID}` });

    expect(prisma.action.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: WORKSPACE_ID, experimentId: EXPERIMENT_ID } }),
    );
  });

  it('recusa um status que não existe', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'GET', url: '/actions?status=PUBLISHED' });

    expect(res.statusCode).toBe(400);
  });

  it('VIEWER lê', async () => {
    const app = await buildApp(prismaFake(), { role: 'VIEWER' });

    const res = await app.inject({ method: 'GET', url: '/actions' });

    expect(res.statusCode).toBe(200);
  });
});

describe('GET /actions/:id', () => {
  it('devolve a ação, o histórico de aprovação e a entrega', async () => {
    const prisma = prismaFake({
      delivery: {
        id: 'ref-1',
        externalId: 'post_1',
        metadata: { state: 'QUEUE', channelId: 'chan-1' },
        createdAt: new Date('2026-08-04T11:00:00.000Z'),
      },
    });
    prisma.approval.findMany.mockResolvedValue([
      {
        id: 'ap-1',
        requestedBy: 'u1',
        reviewedBy: 'u2',
        status: 'APPROVED',
        comment: null,
        requestedAt: new Date('2026-08-04T10:30:00.000Z'),
        reviewedAt: new Date('2026-08-04T10:40:00.000Z'),
      },
    ]);
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'GET', url: `/actions/${ACTION_ID}` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.action.id).toBe(ACTION_ID);
    expect(body.approvals).toHaveLength(1);
    // `externalId` e `state`, e nenhum campo chamado "published": o state é do
    // provider e a entrega é o que sabemos (spec §3.4).
    expect(body.delivery).toMatchObject({ externalId: 'post_1', state: 'QUEUE' });
  });

  // Uma ação sem entrega devolve null explícito, e não a chave ausente: a tela
  // distingue "não entregue" de "não sei".
  it('devolve delivery nulo quando não houve entrega', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'GET', url: `/actions/${ACTION_ID}` });

    expect(res.json().delivery).toBeNull();
  });

  it('uma ação de outro workspace é indistinguível de inexistente', async () => {
    const app = await buildApp(prismaFake({ action: null }));

    const res = await app.inject({ method: 'GET', url: `/actions/${ACTION_ID}` });

    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /actions/:id', () => {
  it('edita o texto de uma ação em PROPOSED', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    const res = await app.inject({
      method: 'PATCH',
      url: `/actions/${ACTION_ID}`,
      payload: { name: 'Outro nome', payload: { ...PAYLOAD, content: 'Texto revisado.' } },
    });

    expect(res.statusCode).toBe(200);
    expect(prisma.action.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ACTION_ID } }),
    );
  });

  /**
   * Editar depois de submetido mudaria o que o aprovador leu. Aprovação sobre
   * texto que já não está lá não é aprovação.
   */
  it('recusa editar depois de submetido', async () => {
    const app = await buildApp(prismaFake({ action: { ...ACTION, status: 'PENDING_APPROVAL' } }));

    const res = await app.inject({
      method: 'PATCH',
      url: `/actions/${ACTION_ID}`,
      payload: { name: 'Outro nome' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('recusa editar depois de executado', async () => {
    const app = await buildApp(prismaFake({ action: { ...ACTION, status: 'EXECUTED' } }));

    const res = await app.inject({
      method: 'PATCH',
      url: `/actions/${ACTION_ID}`,
      payload: { name: 'Outro nome' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('VIEWER não edita', async () => {
    const app = await buildApp(prismaFake(), { role: 'VIEWER' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/actions/${ACTION_ID}`,
      payload: { name: 'Outro nome' },
    });

    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Rode e confirme a falha**

Run: `pnpm vitest run src/http/api/actions/actions.test.ts`
Expected: FAIL — `Cannot find module './index.js'`.

- [ ] **Step 3: Escreva `actions.schema.ts`**

```ts
import { z } from 'zod';
import { socialPostPayload } from './actions.payload.js';

export const actionTypeEnum = z.enum(['SOCIAL_POST']);

export const actionStatusEnum = z.enum([
  'PROPOSED',
  'PENDING_APPROVAL',
  'APPROVED',
  'EXECUTING',
  'EXECUTED',
  'FAILED',
  'CANCELLED',
  'DELIVERY_UNKNOWN',
]);

export const approvalStatusEnum = z.enum(['PENDING', 'APPROVED', 'REJECTED']);

export const actionEntity = z.object({
  id: z.string().uuid(),
  experimentId: z.string().uuid().nullable(),
  type: actionTypeEnum,
  name: z.string(),
  description: z.string().nullable(),
  payload: socialPostPayload,
  status: actionStatusEnum,
  createdBy: z.string(),
  approvedAt: z.date().nullable(),
  executedAt: z.date().nullable(),
  attempts: z.number().int(),
  lastError: z.string().nullable(),
  failureKind: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const approvalEntity = z.object({
  id: z.string().uuid(),
  requestedBy: z.string(),
  reviewedBy: z.string().nullable(),
  status: approvalStatusEnum,
  comment: z.string().nullable(),
  requestedAt: z.date(),
  reviewedAt: z.date().nullable(),
});

/**
 * O que o Postiz devolveu, e nada além. Chama-se `delivery` e não `publication`
 * de propósito: `state` é `QUEUE` na criação, e virar `PUBLISHED` acontece
 * depois, lá dentro (spec §3.4).
 */
export const deliveryEntity = z.object({
  externalId: z.string(),
  state: z.string().nullable(),
  deliveredAt: z.date(),
});

export const actionResponse = z.object({ action: actionEntity });
export const actionsListResponse = z.object({ actions: z.array(actionEntity) });
export const actionDetailResponse = z.object({
  action: actionEntity,
  approvals: z.array(approvalEntity),
  delivery: deliveryEntity.nullable(),
});

export const actionIdParam = z.object({ id: z.string().uuid() });
```

- [ ] **Step 4: Escreva `actions.repository.ts`**

```ts
import type { ActionStatus, ActionType, Prisma, PrismaClient } from '@prisma/client';

/** O tipo de entidade do post social no `ExternalReference`. */
export const SOCIAL_POST_ENTITY = 'SOCIAL_POST';

export function createActionsRepository(prisma: PrismaClient) {
  return {
    list(workspaceId: string, filter: { status?: ActionStatus; experimentId?: string }) {
      return prisma.action.findMany({
        // Só as chaves presentes entram no `where`: um `status: undefined`
        // explícito é ignorado pelo Prisma, mas o objeto montado assim é o que
        // o teste consegue afirmar sem adivinhar.
        where: {
          workspaceId,
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.experimentId ? { experimentId: filter.experimentId } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });
    },

    findById(workspaceId: string, id: string) {
      return prisma.action.findFirst({ where: { id, workspaceId } });
    },

    create(
      workspaceId: string,
      data: {
        experimentId: string | null;
        type: ActionType;
        name: string;
        description: string | null;
        payload: Prisma.InputJsonValue;
        createdBy: string;
      },
    ) {
      return prisma.action.create({ data: { workspaceId, status: 'PROPOSED', ...data } });
    },

    update(id: string, data: Prisma.ActionUpdateInput) {
      return prisma.action.update({ where: { id }, data });
    },

    /** O histórico completo, mais velho primeiro: a tela lê como linha do tempo. */
    findApprovals(workspaceId: string, actionId: string) {
      return prisma.approval.findMany({
        where: { workspaceId, actionId },
        orderBy: { requestedAt: 'asc' },
      });
    },

    findDelivery(workspaceId: string, actionId: string) {
      return prisma.externalReference.findFirst({
        where: { workspaceId, entityType: SOCIAL_POST_ENTITY, entityId: actionId },
      });
    },
  };
}

export type ActionsRepository = ReturnType<typeof createActionsRepository>;
```

- [ ] **Step 5: Escreva `actions.presenter.ts`**

```ts
import type { Action, Approval, ExternalReference } from '@prisma/client';
import { parseActionPayload } from './actions.payload.js';

/**
 * `?? null` em todo campo nulável, e não passagem direta.
 *
 * Um fixture montado à mão tem essas chaves **ausentes** (`undefined`), e
 * `z.date().nullable()` recusa `undefined` — a serialização estouraria 500 num
 * caso que o teste escreveu para valer null. Já custou isso uma vez, no
 * presenter de outcomes.
 */
export function presentAction(row: Action) {
  return {
    id: row.id,
    experimentId: row.experimentId ?? null,
    type: row.type,
    name: row.name,
    description: row.description ?? null,
    payload: parseActionPayload(row.type, row.payload),
    status: row.status,
    createdBy: row.createdBy,
    approvedAt: row.approvedAt ?? null,
    executedAt: row.executedAt ?? null,
    attempts: row.attempts,
    lastError: row.lastError ?? null,
    failureKind: row.failureKind ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function presentApproval(row: Approval) {
  return {
    id: row.id,
    requestedBy: row.requestedBy,
    reviewedBy: row.reviewedBy ?? null,
    status: row.status,
    comment: row.comment ?? null,
    requestedAt: row.requestedAt,
    reviewedAt: row.reviewedAt ?? null,
  };
}

/**
 * O `state` vive em `metadata` porque é do provider e pode ser qualquer coisa
 * que ele decida mandar. Lido com cuidado: um metadata sem `state` devolve
 * null, e não a string "undefined".
 */
export function presentDelivery(row: ExternalReference | null) {
  if (!row) return null;
  const metadata = row.metadata as { state?: unknown } | null;
  const state = typeof metadata?.state === 'string' ? metadata.state : null;
  return { externalId: row.externalId, state, deliveredAt: row.createdAt };
}
```

- [ ] **Step 6: Escreva o schema e o controller de criação**

`create-action/create-action.schema.ts`:

```ts
import { z } from 'zod';
import { socialPostPayload } from '../actions.payload.js';
import { actionTypeEnum } from '../actions.schema.js';

export const createActionBody = z.object({
  type: actionTypeEnum,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  /** Opcional por decisão de escopo: a ação pode existir solta (spec §2, decisão 3). */
  experimentId: z.string().uuid().optional(),
  payload: socialPostPayload,
});

export type CreateActionBody = z.infer<typeof createActionBody>;
```

`create-action/create-action.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  createPostizClient,
  parsePostizCredential,
  type PostizClient,
  type PostizConfig,
} from '../../../../integrations/social/index.js';
import {
  NotFoundError,
  PostizChannelNotFoundError,
  PostizNotConnectedError,
  PostizRequestFailedError,
} from '../../../../lib/errors.js';
import { assertWriter } from '../../../../lib/tenant.js';
import { createIntegrationsRepository } from '../../integrations/integrations.repository.js';
import { openIntegrationCredential } from '../../integrations/integrations.service.js';
import { createActionsRepository } from '../actions.repository.js';
import { presentAction } from '../actions.presenter.js';
import { actionResponse } from '../actions.schema.js';
import { createActionBody } from './create-action.schema.js';

const TIMEOUT_MS = 10_000;
const PROVIDER = 'POSTIZ';

export type CreateActionOptions = { postiz?: (config: PostizConfig) => PostizClient };

export const createActionRoute: FastifyPluginAsync<CreateActionOptions> = async (app, opts) => {
  const clientFor = opts.postiz ?? createPostizClient;

  app.withTypeProvider<ZodTypeProvider>().post(
    '/actions',
    {
      schema: {
        tags: ['actions'],
        operationId: 'createAction',
        body: createActionBody,
        response: { 201: actionResponse },
      },
    },
    async (req, reply) => {
      assertWriter(req.tenant);
      const { workspaceId } = req.tenant;

      const row = await createIntegrationsRepository(app.prisma).find(workspaceId, PROVIDER);
      if (!row) throw new PostizNotConnectedError();

      // O experimento é opcional, mas quando vem tem de ser deste workspace —
      // e um id de outro tenant lê como ausente.
      if (req.body.experimentId) {
        const experiment = await app.prisma.experiment.findFirst({
          where: { id: req.body.experimentId, workspaceId },
          select: { id: true },
        });
        if (!experiment) throw new NotFoundError('Experiment not found');
      }

      let channels;
      try {
        const client = clientFor(parsePostizCredential(openIntegrationCredential(row)));
        channels = await client.listChannels(AbortSignal.timeout(TIMEOUT_MS));
      } catch (error) {
        throw new PostizRequestFailedError({
          reason: error instanceof Error ? error.message : 'unknown error',
        });
      }

      // O canal tem de existir na conta AGORA. Aceitar um id qualquer só
      // falharia na publicação — depois de alguém ter aprovado o texto.
      const channel = channels.find((candidate) => candidate.id === req.body.payload.channelId);
      if (!channel) throw new PostizChannelNotFoundError();

      const action = await createActionsRepository(app.prisma).create(workspaceId, {
        experimentId: req.body.experimentId ?? null,
        type: req.body.type,
        name: req.body.name,
        description: req.body.description ?? null,
        // O snapshot vem do que o Postiz respondeu, não do que o cliente
        // mandou: um nome vindo do body viraria proveniência inventada.
        payload: {
          channelId: channel.id,
          channelName: channel.name,
          providerIdentifier: channel.providerIdentifier,
          content: req.body.payload.content,
        },
        createdBy: req.tenant.userId,
      });

      return reply.code(201).send({ action: presentAction(action) });
    },
  );
};
```

- [ ] **Step 7: Escreva a listagem**

`list-actions/list-actions.schema.ts`:

```ts
import { z } from 'zod';
import { actionStatusEnum } from '../actions.schema.js';

export const listActionsQuery = z.object({
  status: actionStatusEnum.optional(),
  experimentId: z.string().uuid().optional(),
});
```

`list-actions/list-actions.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createActionsRepository } from '../actions.repository.js';
import { presentAction } from '../actions.presenter.js';
import { actionsListResponse } from '../actions.schema.js';
import { listActionsQuery } from './list-actions.schema.js';

export const listActionsRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/actions',
    {
      schema: {
        tags: ['actions'],
        operationId: 'listActions',
        querystring: listActionsQuery,
        response: { 200: actionsListResponse },
      },
    },
    async (req, reply) => {
      const rows = await createActionsRepository(app.prisma).list(req.tenant.workspaceId, {
        ...(req.query.status ? { status: req.query.status } : {}),
        ...(req.query.experimentId ? { experimentId: req.query.experimentId } : {}),
      });
      return reply.send({ actions: rows.map(presentAction) });
    },
  );
};
```

- [ ] **Step 8: Escreva o detalhe**

`get-action/get-action.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { createActionsRepository } from '../actions.repository.js';
import { presentAction, presentApproval, presentDelivery } from '../actions.presenter.js';
import { actionDetailResponse, actionIdParam } from '../actions.schema.js';

export const getActionRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/actions/:id',
    {
      schema: {
        tags: ['actions'],
        operationId: 'getAction',
        params: actionIdParam,
        response: { 200: actionDetailResponse },
      },
    },
    async (req, reply) => {
      const repo = createActionsRepository(app.prisma);
      const { workspaceId } = req.tenant;

      const action = await repo.findById(workspaceId, req.params.id);
      if (!action) throw new NotFoundError('Action not found');

      const [approvals, delivery] = await Promise.all([
        repo.findApprovals(workspaceId, action.id),
        repo.findDelivery(workspaceId, action.id),
      ]);

      return reply.send({
        action: presentAction(action),
        approvals: approvals.map(presentApproval),
        delivery: presentDelivery(delivery),
      });
    },
  );
};
```

- [ ] **Step 9: Escreva a edição**

`update-action/update-action.schema.ts`:

```ts
import { z } from 'zod';
import { socialPostPayload } from '../actions.payload.js';

export const updateActionBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    payload: socialPostPayload.optional(),
  })
  // Um PATCH vazio não é edição, é um round-trip que faz o cliente acreditar
  // que salvou algo.
  .refine((body) => Object.keys(body).length > 0, { message: 'Send at least one field to change' });

export type UpdateActionBody = z.infer<typeof updateActionBody>;
```

`update-action/update-action.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { BadRequestError, NotFoundError } from '../../../../lib/errors.js';
import { assertWriter } from '../../../../lib/tenant.js';
import { createActionsRepository } from '../actions.repository.js';
import { presentAction } from '../actions.presenter.js';
import { actionIdParam, actionResponse } from '../actions.schema.js';
import { updateActionBody } from './update-action.schema.js';

export const updateActionRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().patch(
    '/actions/:id',
    {
      schema: {
        tags: ['actions'],
        operationId: 'updateAction',
        params: actionIdParam,
        body: updateActionBody,
        response: { 200: actionResponse },
      },
    },
    async (req, reply) => {
      assertWriter(req.tenant);
      const repo = createActionsRepository(app.prisma);

      const current = await repo.findById(req.tenant.workspaceId, req.params.id);
      if (!current) throw new NotFoundError('Action not found');

      // Editar depois de submetido mudaria o texto que o aprovador leu, e
      // aprovação sobre texto que já não está lá não é aprovação.
      if (current.status !== 'PROPOSED') {
        throw new BadRequestError('Only a proposed action can be edited');
      }

      const data: Prisma.ActionUpdateInput = {
        ...(req.body.name !== undefined ? { name: req.body.name } : {}),
        ...(req.body.description !== undefined ? { description: req.body.description } : {}),
        // O canal do payload já foi validado contra o Postiz na criação, e o
        // schema garante o snapshot completo: o que muda aqui é o texto.
        ...(req.body.payload !== undefined ? { payload: req.body.payload } : {}),
      };

      return reply.send({ action: presentAction(await repo.update(current.id, data)) });
    },
  );
};
```

- [ ] **Step 10: Escreva `index.ts`**

```ts
import type { FastifyPluginAsync } from 'fastify';
import { createActionRoute, type CreateActionOptions } from './create-action/create-action.controller.js';
import { listActionsRoute } from './list-actions/list-actions.controller.js';
import { getActionRoute } from './get-action/get-action.controller.js';
import { updateActionRoute } from './update-action/update-action.controller.js';

export type ActionsRoutesOptions = CreateActionOptions;

/**
 * Registra as rotas de ações. Auth e tenant são aplicados pelo chamador
 * (`app.ts`), não aqui: o teste registra este plugin contra um Fastify nu que
 * não tem os decorators, só um hook que põe `req.tenant` — mesma forma de
 * `integrationsRoutes`.
 */
export const actionsRoutes: FastifyPluginAsync<ActionsRoutesOptions> = async (app, opts) => {
  // O cliente Postiz viaja como opção para o teste poder substituir a chamada
  // real. Sem opção, o cliente real é usado.
  await app.register(createActionRoute, { postiz: opts.postiz });
  await app.register(listActionsRoute);
  await app.register(getActionRoute);
  await app.register(updateActionRoute);
};
```

- [ ] **Step 11: Registre em `src/app.ts`**

Import, junto dos outros:

```ts
import { actionsRoutes } from './http/api/actions/index.js';
```

E dentro do escopo autenticado, na mesma lista onde `experimentsRoutes` e `outcomesRoutes` já estão registrados (logo depois de `outcomesRoutes`):

```ts
  await app.register(actionsRoutes, {});
```

- [ ] **Step 12: Rode o teste**

Run: `pnpm vitest run src/http/api/actions`
Expected: PASS, todos.

- [ ] **Step 13: Typecheck, suíte e contrato**

Run: `pnpm typecheck && pnpm test && pnpm openapi:dump`
Expected: tsc exit 0; suíte verde; `../web/api.json` com `createAction`, `listActions`, `getAction`, `updateAction`.

- [ ] **Step 14: Stage e reporte**

```bash
git add src/http/api/actions src/app.ts
git status --short
git diff --cached --stat
```

**Não rode `git commit`.**

---

## Task 5: Submeter, aprovar, rejeitar, cancelar

O ciclo humano. Quatro rotas finas sobre um serviço de transição compartilhado, mais os dois escritos de `Approval`.

**Files:**
- Create: `src/http/api/actions/actions.transition.ts`
- Modify: `src/http/api/actions/actions.repository.ts`
- Create: `src/http/api/actions/submit-action/submit-action.controller.ts`
- Create: `src/http/api/actions/approve-action/approve-action.controller.ts`
- Create: `src/http/api/actions/reject-action/reject-action.{schema,controller}.ts`
- Create: `src/http/api/actions/cancel-action/cancel-action.controller.ts`
- Modify: `src/http/api/actions/index.ts`
- Create: `src/http/api/actions/actions-approval.test.ts`

**Interfaces:**
- Consumes: `assertActionTransition` (Task 1); `createActionsRepository`, `presentAction`, `actionResponse`, `actionIdParam` (Task 4); `assertWriter`, `assertAdmin` (existentes).
- Produces:
  - `transitionActionService(deps: { repo: ActionsRepository })` → `async (input: { workspaceId: string; id: string; to: ActionStatus; extra?: (current: Action) => Prisma.ActionUpdateInput }) => Promise<Action>` de `actions.transition.ts`.
  - `submit(workspaceId, actionId, requestedBy)`, `review(workspaceId, actionId, review)` em `ActionsRepository`.
  - `submitActionRoute`, `approveActionRoute`, `rejectActionRoute`, `cancelActionRoute`.

- [ ] **Step 1: Escreva o teste das quatro rotas**

Crie `src/http/api/actions/actions-approval.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../lib/errors.js';
import { actionsRoutes } from './index.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const ACTION_ID = '33333333-3333-3333-3333-333333333333';

const PAYLOAD = {
  channelId: 'chan-1',
  channelName: 'AUREA no Instagram',
  providerIdentifier: 'instagram',
  content: 'Como cortamos 30% do custo operacional.',
};

const ACTION = {
  id: ACTION_ID,
  workspaceId: WORKSPACE_ID,
  experimentId: null,
  type: 'SOCIAL_POST',
  name: 'Post sobre custo operacional',
  description: null,
  payload: PAYLOAD,
  status: 'PROPOSED',
  createdBy: 'u1',
  approvedAt: null,
  executedAt: null,
  attempts: 0,
  lastError: null,
  failureKind: null,
  heartbeatAt: null,
  createdAt: new Date('2026-08-04T10:00:00.000Z'),
  updatedAt: new Date('2026-08-04T10:00:00.000Z'),
};

/**
 * `'action' in over`, e não `??`: os casos que passam `null` de propósito
 * (ação de outro workspace) exigem que o null chegue — com `??` o default
 * voltaria e o 404 passaria sem existir.
 *
 * `$transaction` executa o callback contra o mesmo objeto: submeter e rever
 * escrevem duas tabelas de uma vez, e um fake que não passasse por isso
 * deixaria o par sem cobertura.
 */
function prismaFake(over: { action?: unknown } = {}) {
  const db = {
    action: {
      findFirst: vi.fn().mockResolvedValue('action' in over ? over.action : ACTION),
      findMany: vi.fn().mockResolvedValue([ACTION]),
      create: vi.fn(),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...ACTION, ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    approval: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 'ap-1' }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    externalReference: { findFirst: vi.fn().mockResolvedValue(null) },
    experiment: { findFirst: vi.fn().mockResolvedValue(null) },
    workspaceIntegration: { findFirst: vi.fn().mockResolvedValue(null) },
  };
  return { ...db, $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)) };
}

beforeEach(() => vi.clearAllMocks());

async function buildApp(prisma: unknown, role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER' = 'ADMIN') {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prisma as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = { userId: 'u2', organizationId: 'org-1', workspaceId: WORKSPACE_ID, role };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, details: error.details } });
    }
    throw error;
  });
  await app.register(actionsRoutes, {});
  return app;
}

describe('POST /actions/:id/submit', () => {
  it('move para PENDING_APPROVAL e abre um Approval pendente', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/submit` });

    expect(res.statusCode).toBe(200);
    expect(res.json().action.status).toBe('PENDING_APPROVAL');
    expect(prisma.approval.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          actionId: ACTION_ID,
          requestedBy: 'u2',
          status: 'PENDING',
        }),
      }),
    );
    // O par vai numa transação: um Approval pendente sobre uma ação que ficou
    // em PROPOSED seria um pedido que ninguém vê.
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('recusa submeter o que já está submetido', async () => {
    const app = await buildApp(prismaFake({ action: { ...ACTION, status: 'PENDING_APPROVAL' } }));

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/submit` });

    expect(res.statusCode).toBe(400);
  });

  it('uma ação de outro workspace é indistinguível de inexistente', async () => {
    const app = await buildApp(prismaFake({ action: null }));

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/submit` });

    expect(res.statusCode).toBe(404);
  });

  it('VIEWER não submete', async () => {
    const app = await buildApp(prismaFake(), 'VIEWER');

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/submit` });

    expect(res.statusCode).toBe(403);
  });

  it('MEMBER submete', async () => {
    const app = await buildApp(prismaFake(), 'MEMBER');

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/submit` });

    expect(res.statusCode).toBe(200);
  });
});

describe('POST /actions/:id/approve', () => {
  const pending = () => prismaFake({ action: { ...ACTION, status: 'PENDING_APPROVAL' } });

  it('aprova, carimba approvedAt e fecha o Approval com o revisor', async () => {
    const prisma = pending();
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/approve` });

    expect(res.statusCode).toBe(200);
    expect(res.json().action).toMatchObject({ status: 'APPROVED' });
    expect(res.json().action.approvedAt).not.toBeNull();
    expect(prisma.approval.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // Só o pendente: aprovar de novo não pode reescrever a decisão de
        // ontem, que é histórico.
        where: { workspaceId: WORKSPACE_ID, actionId: ACTION_ID, status: 'PENDING' },
        data: expect.objectContaining({ status: 'APPROVED', reviewedBy: 'u2' }),
      }),
    );
  });

  /**
   * O autor pode aprovar o que escreveu — em workspace de fundador solo, exigir
   * um segundo par de olhos travaria o piloto (spec §2, decisão 4). O que não
   * pode é acontecer no mesmo request que criou, e isso está garantido por não
   * existir rota que faça as duas coisas.
   */
  it('o autor pode aprovar a própria ação', async () => {
    const prisma = prismaFake({ action: { ...ACTION, status: 'PENDING_APPROVAL', createdBy: 'u2' } });
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/approve` });

    expect(res.statusCode).toBe(200);
  });

  it('recusa aprovar o que não foi submetido', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/approve` });

    expect(res.statusCode).toBe(400);
  });

  // Aprovar é o ato que autoriza sair para o mundo: MEMBER escreve, não autoriza.
  it('MEMBER não aprova', async () => {
    const app = await buildApp(pending(), 'MEMBER');

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/approve` });

    expect(res.statusCode).toBe(403);
  });

  it('VIEWER não aprova', async () => {
    const app = await buildApp(pending(), 'VIEWER');

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/approve` });

    expect(res.statusCode).toBe(403);
  });
});

describe('POST /actions/:id/reject', () => {
  const pending = () => prismaFake({ action: { ...ACTION, status: 'PENDING_APPROVAL' } });

  it('devolve para PROPOSED com o comentário no Approval', async () => {
    const prisma = pending();
    const app = await buildApp(prisma);

    const res = await app.inject({
      method: 'POST',
      url: `/actions/${ACTION_ID}/reject`,
      payload: { comment: 'Trocar o número: 30% não é o que medimos.' },
    });

    expect(res.statusCode).toBe(200);
    // Volta editável, e não morre: o fundador corrige e submete de novo.
    expect(res.json().action.status).toBe('PROPOSED');
    expect(prisma.approval.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REJECTED',
          reviewedBy: 'u2',
          comment: 'Trocar o número: 30% não é o que medimos.',
        }),
      }),
    );
  });

  // Uma rejeição sem motivo devolve o trabalho ao autor sem dizer o que corrigir.
  it('recusa rejeitar sem comentário', async () => {
    const app = await buildApp(pending());

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/reject`, payload: {} });

    expect(res.statusCode).toBe(400);
  });

  it('recusa comentário vazio', async () => {
    const app = await buildApp(pending());

    const res = await app.inject({
      method: 'POST',
      url: `/actions/${ACTION_ID}/reject`,
      payload: { comment: '   ' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('MEMBER não rejeita', async () => {
    const app = await buildApp(pending(), 'MEMBER');

    const res = await app.inject({
      method: 'POST',
      url: `/actions/${ACTION_ID}/reject`,
      payload: { comment: 'não' },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('POST /actions/:id/cancel', () => {
  it('cancela uma ação proposta', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/cancel` });

    expect(res.statusCode).toBe(200);
    expect(res.json().action.status).toBe('CANCELLED');
  });

  it('cancela uma ação aprovada que ainda não saiu', async () => {
    const app = await buildApp(prismaFake({ action: { ...ACTION, status: 'APPROVED' } }));

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/cancel` });

    expect(res.statusCode).toBe(200);
  });

  /**
   * Cancelar não despublica nada. Deixar o status virar CANCELLED depois de
   * entregue faria a tela mentir sobre o que existe no mundo.
   */
  it('recusa cancelar o que já foi executado', async () => {
    const app = await buildApp(prismaFake({ action: { ...ACTION, status: 'EXECUTED' } }));

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/cancel` });

    expect(res.statusCode).toBe(400);
  });

  // Em voo: quem tira do EXECUTING é o processor ou o reaper, nunca uma rota.
  it('recusa cancelar o que está em execução', async () => {
    const app = await buildApp(prismaFake({ action: { ...ACTION, status: 'EXECUTING' } }));

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/cancel` });

    expect(res.statusCode).toBe(400);
  });

  it('VIEWER não cancela', async () => {
    const app = await buildApp(prismaFake(), 'VIEWER');

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/cancel` });

    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 2: Rode e confirme a falha**

Run: `pnpm vitest run src/http/api/actions/actions-approval.test.ts`
Expected: FAIL — 404 nas quatro rotas.

- [ ] **Step 3: Adicione `submit` e `review` ao repositório**

Em `src/http/api/actions/actions.repository.ts`, dentro do objeto devolvido:

```ts
    /**
     * O par submeter: status e pedido de aprovação numa transação.
     *
     * Separado porque as duas escritas não podem divergir — um `Approval`
     * pendente sobre uma ação que ficou em `PROPOSED` é um pedido que ninguém
     * vê, e uma ação em `PENDING_APPROVAL` sem pedido é uma fila sem item.
     */
    submit(workspaceId: string, actionId: string, requestedBy: string) {
      return prisma.$transaction(async (tx) => {
        const action = await tx.action.update({
          where: { id: actionId },
          data: { status: 'PENDING_APPROVAL' },
        });
        await tx.approval.create({
          data: { workspaceId, actionId, requestedBy, status: 'PENDING' },
        });
        return action;
      });
    },

    /**
     * A decisão: status da ação e fechamento do pedido pendente, numa transação.
     *
     * `updateMany` filtrando `status: 'PENDING'` de propósito: uma segunda
     * decisão não pode reescrever a de ontem, que é histórico (spec §4.3).
     */
    review(
      workspaceId: string,
      actionId: string,
      review: {
        to: ActionStatus;
        approvalStatus: 'APPROVED' | 'REJECTED';
        reviewedBy: string;
        comment: string | null;
        reviewedAt: Date;
        actionExtra?: Prisma.ActionUpdateInput;
      },
    ) {
      return prisma.$transaction(async (tx) => {
        const action = await tx.action.update({
          where: { id: actionId },
          data: { status: review.to, ...(review.actionExtra ?? {}) },
        });
        await tx.approval.updateMany({
          where: { workspaceId, actionId, status: 'PENDING' },
          data: {
            status: review.approvalStatus,
            reviewedBy: review.reviewedBy,
            comment: review.comment,
            reviewedAt: review.reviewedAt,
          },
        });
        return action;
      });
    },
```

- [ ] **Step 4: Escreva `actions.transition.ts`**

```ts
import type { Action, ActionStatus, Prisma } from '@prisma/client';
import { NotFoundError } from '../../../lib/errors.js';
import { assertActionTransition } from './actions.domain.js';
import type { ActionsRepository } from './actions.repository.js';

export type TransitionActionDeps = { repo: ActionsRepository };

/**
 * O caminho comum das mudanças de estado feitas por humano: achar dentro do
 * workspace, checar a aresta, escrever. Mesma forma de
 * `experiments.transition.ts`.
 *
 * `write` existe para as rotas que escrevem mais de uma tabela (submeter,
 * decidir): elas fazem a checagem aqui e delegam a escrita ao repositório, que
 * a faz numa transação.
 */
export function transitionActionService(deps: TransitionActionDeps) {
  return async (input: {
    workspaceId: string;
    id: string;
    to: ActionStatus;
    extra?: (current: Action) => Prisma.ActionUpdateInput;
    write?: (current: Action) => Promise<Action>;
  }): Promise<Action> => {
    const current = await deps.repo.findById(input.workspaceId, input.id);
    // Escopado pelo workspace: um id de outro tenant lê como ausente.
    if (!current) throw new NotFoundError('Action not found');
    assertActionTransition(current.status, input.to);

    if (input.write) return input.write(current);
    return deps.repo.update(current.id, { status: input.to, ...(input.extra?.(current) ?? {}) });
  };
}
```

- [ ] **Step 5: Escreva `submit-action/submit-action.controller.ts`**

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertWriter } from '../../../../lib/tenant.js';
import { createActionsRepository } from '../actions.repository.js';
import { presentAction } from '../actions.presenter.js';
import { actionIdParam, actionResponse } from '../actions.schema.js';
import { transitionActionService } from '../actions.transition.js';

export const submitActionRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/actions/:id/submit',
    {
      schema: {
        tags: ['actions'],
        operationId: 'submitAction',
        params: actionIdParam,
        response: { 200: actionResponse },
      },
    },
    async (req, reply) => {
      assertWriter(req.tenant);
      const repo = createActionsRepository(app.prisma);

      const action = await transitionActionService({ repo })({
        workspaceId: req.tenant.workspaceId,
        id: req.params.id,
        to: 'PENDING_APPROVAL',
        write: (current) => repo.submit(req.tenant.workspaceId, current.id, req.tenant.userId),
      });

      return reply.send({ action: presentAction(action) });
    },
  );
};
```

- [ ] **Step 6: Escreva `approve-action/approve-action.controller.ts`**

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertAdmin } from '../../../../lib/tenant.js';
import { createActionsRepository } from '../actions.repository.js';
import { presentAction } from '../actions.presenter.js';
import { actionIdParam, actionResponse } from '../actions.schema.js';
import { transitionActionService } from '../actions.transition.js';

/**
 * Aprovar é o ato que autoriza sair para o mundo, e por isso é de OWNER/ADMIN:
 * MEMBER escreve conteúdo, não autoriza publicação (spec §2, decisão 4).
 *
 * O autor pode aprovar o que escreveu — em workspace de fundador solo, exigir
 * um segundo par de olhos travaria o piloto. Mas em dois atos: não existe rota
 * que crie e aprove no mesmo request, e o `Approval` guarda `requestedBy` e
 * `reviewedBy` separados.
 */
export const approveActionRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/actions/:id/approve',
    {
      schema: {
        tags: ['actions'],
        operationId: 'approveAction',
        params: actionIdParam,
        response: { 200: actionResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);
      const repo = createActionsRepository(app.prisma);
      const now = new Date();

      const action = await transitionActionService({ repo })({
        workspaceId: req.tenant.workspaceId,
        id: req.params.id,
        to: 'APPROVED',
        write: (current) =>
          repo.review(req.tenant.workspaceId, current.id, {
            to: 'APPROVED',
            approvalStatus: 'APPROVED',
            reviewedBy: req.tenant.userId,
            comment: null,
            reviewedAt: now,
            actionExtra: { approvedAt: now },
          }),
      });

      return reply.send({ action: presentAction(action) });
    },
  );
};
```

- [ ] **Step 7: Escreva a rejeição**

`reject-action/reject-action.schema.ts`:

```ts
import { z } from 'zod';

export const rejectActionBody = z.object({
  /**
   * Obrigatório, e com `trim`: uma rejeição sem motivo devolve o trabalho ao
   * autor sem dizer o que corrigir. `min(1)` depois do trim recusa espaços.
   */
  comment: z.string().trim().min(1).max(2000),
});
```

`reject-action/reject-action.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertAdmin } from '../../../../lib/tenant.js';
import { createActionsRepository } from '../actions.repository.js';
import { presentAction } from '../actions.presenter.js';
import { actionIdParam, actionResponse } from '../actions.schema.js';
import { transitionActionService } from '../actions.transition.js';
import { rejectActionBody } from './reject-action.schema.js';

export const rejectActionRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/actions/:id/reject',
    {
      schema: {
        tags: ['actions'],
        operationId: 'rejectAction',
        params: actionIdParam,
        body: rejectActionBody,
        response: { 200: actionResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);
      const repo = createActionsRepository(app.prisma);

      // Volta para PROPOSED, e não para um estado morto: o fundador corrige o
      // texto e submete de novo, criando um segundo Approval. O histórico é a
      // lista de Approvals; `Action.status` é a verdade (spec §4.3).
      const action = await transitionActionService({ repo })({
        workspaceId: req.tenant.workspaceId,
        id: req.params.id,
        to: 'PROPOSED',
        write: (current) =>
          repo.review(req.tenant.workspaceId, current.id, {
            to: 'PROPOSED',
            approvalStatus: 'REJECTED',
            reviewedBy: req.tenant.userId,
            comment: req.body.comment,
            reviewedAt: new Date(),
          }),
      });

      return reply.send({ action: presentAction(action) });
    },
  );
};
```

- [ ] **Step 8: Escreva o cancelamento**

`cancel-action/cancel-action.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertWriter } from '../../../../lib/tenant.js';
import { createActionsRepository } from '../actions.repository.js';
import { presentAction } from '../actions.presenter.js';
import { actionIdParam, actionResponse } from '../actions.schema.js';
import { transitionActionService } from '../actions.transition.js';

/**
 * Cancelar só existe antes de a ação sair. Depois de entregue, cancelar não
 * despublica nada, e o status mentiria sobre o que existe no mundo — a tabela
 * de transições é quem recusa (`EXECUTED` e `EXECUTING` não levam a
 * `CANCELLED`).
 */
export const cancelActionRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/actions/:id/cancel',
    {
      schema: {
        tags: ['actions'],
        operationId: 'cancelAction',
        params: actionIdParam,
        response: { 200: actionResponse },
      },
    },
    async (req, reply) => {
      assertWriter(req.tenant);

      const action = await transitionActionService({ repo: createActionsRepository(app.prisma) })({
        workspaceId: req.tenant.workspaceId,
        id: req.params.id,
        to: 'CANCELLED',
      });

      return reply.send({ action: presentAction(action) });
    },
  );
};
```

- [ ] **Step 9: Registre as quatro rotas**

Em `src/http/api/actions/index.ts`, adicione os imports e os registros depois de `updateActionRoute`:

```ts
import { submitActionRoute } from './submit-action/submit-action.controller.js';
import { approveActionRoute } from './approve-action/approve-action.controller.js';
import { rejectActionRoute } from './reject-action/reject-action.controller.js';
import { cancelActionRoute } from './cancel-action/cancel-action.controller.js';
```

```ts
  await app.register(submitActionRoute);
  await app.register(approveActionRoute);
  await app.register(rejectActionRoute);
  await app.register(cancelActionRoute);
```

- [ ] **Step 10: Rode os testes de ações**

Run: `pnpm vitest run src/http/api/actions`
Expected: PASS, incluindo `actions.test.ts`, que não muda.

- [ ] **Step 11: Typecheck, suíte e contrato**

Run: `pnpm typecheck && pnpm test && pnpm openapi:dump`
Expected: tsc exit 0; suíte verde; `../web/api.json` com `submitAction`, `approveAction`, `rejectAction`, `cancelAction`.

- [ ] **Step 12: Stage e reporte**

```bash
git add src/http/api/actions
git status --short
git diff --cached --stat
```

**Não rode `git commit`.**

---

## Task 6: Fila, processor, reaper e as duas rotas de execução

A peça central. Aqui vive a única escrita no Postiz do sistema inteiro, a política de retry que não duplica post, e o oitavo estado.

**Files:**
- Modify: `src/config/env.ts`
- Create: `src/actions/queue.ts`
- Create: `src/actions/processor.ts`
- Create: `src/actions/processor.test.ts`
- Create: `src/actions/reaper.ts`
- Create: `src/actions/reaper.test.ts`
- Create: `src/actions/worker.ts`
- Modify: `src/http/api/actions/actions.repository.ts`
- Create: `src/http/api/actions/execute-action/execute-action.controller.ts`
- Create: `src/http/api/actions/resolve-action/resolve-action.{schema,controller}.ts`
- Modify: `src/http/api/actions/index.ts`
- Create: `src/http/api/actions/actions-execution.test.ts`
- Modify: `src/worker.ts`

**Interfaces:**
- Consumes: `EXECUTABLE_FROM` (Task 1); `PostizError`, `isRetriable`, `isIndeterminate`, `createPostizClient`, `parsePostizCredential`, `type PostizClient`, `type PostizConfig` (Task 2); `SOCIAL_POST_ENTITY`, `createActionsRepository` (Task 4); `transitionActionService` (Task 5); `getConnection` de `src/ai/queue/queue.js`; `openIntegrationCredential`, `createIntegrationsRepository` (existentes); `ActionNotResolvableError`, `PostizNotConnectedError` (Task 1).
- Produces:
  - `ACTION_EXECUTIONS_QUEUE`, `type ActionExecutionJob = { actionId: string }`, `getActionQueue()`, `enqueueActionExecution(job)`, `closeActionQueue()` de `src/actions/queue.ts`.
  - `type ActionProcessorDeps`, `executeAction(deps, actionId): Promise<void>` de `src/actions/processor.ts`.
  - `reapStuckActions(deps, options?): Promise<number>`, `startActionReaper(deps): NodeJS.Timeout` de `src/actions/reaper.ts`.
  - `startActionWorker(deps): Worker<ActionExecutionJob>` de `src/actions/worker.ts`.
  - `claimForExecution(workspaceId, id): Promise<boolean>`, `resolveDelivery(...)` em `ActionsRepository`.
  - Env: `ACTION_STALE_MS` (default `120_000`), `ACTION_REAPER_INTERVAL_MS` (default `60_000`), `ACTION_EXECUTION_ATTEMPTS` (default `3`).

- [ ] **Step 1: Escreva o teste do processor**

Crie `src/actions/processor.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { seal } from '../billing/crypto.js';
import { PostizError } from '../integrations/social/index.js';
import { executeAction } from './processor.js';

const WORKSPACE_ID = 'ws-1';
const ACTION_ID = 'act-1';

const SEALED = seal(JSON.stringify({ apiKey: 'pos_abc', baseUrl: 'https://postiz.acme.com' }));

const INTEGRATION = {
  id: 'int-postiz',
  workspaceId: WORKSPACE_ID,
  provider: 'POSTIZ',
  authKind: 'API_KEY',
  ciphertext: new Uint8Array(SEALED.ciphertext),
  iv: new Uint8Array(SEALED.iv),
  authTag: new Uint8Array(SEALED.authTag),
  externalId: null,
  accountLabel: 'postiz.acme.com',
  status: 'OK',
  lastCheckedAt: new Date('2026-08-04T00:00:00.000Z'),
  lastError: null,
};

const ACTION = {
  id: ACTION_ID,
  workspaceId: WORKSPACE_ID,
  type: 'SOCIAL_POST',
  status: 'EXECUTING',
  payload: {
    channelId: 'chan-1',
    channelName: 'AUREA no Instagram',
    providerIdentifier: 'instagram',
    content: 'texto do post',
  },
  attempts: 1,
};

/** `'key' in over`: os casos negativos passam `null` de propósito. */
function prismaFake(over: { action?: unknown; integration?: unknown; delivery?: unknown } = {}) {
  const db = {
    action: {
      findUnique: vi.fn().mockResolvedValue('action' in over ? over.action : ACTION),
      update: vi.fn().mockResolvedValue(ACTION),
    },
    externalReference: {
      findFirst: vi.fn().mockResolvedValue('delivery' in over ? over.delivery : null),
      create: vi.fn().mockResolvedValue({ id: 'ref-1' }),
    },
    workspaceIntegration: {
      findFirst: vi.fn().mockResolvedValue('integration' in over ? over.integration : INTEGRATION),
    },
  };
  return { ...db, $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)) };
}

const logger = { info: vi.fn(), error: vi.fn() };

const clientFake = (createPost = vi.fn().mockResolvedValue({ id: 'post_1', state: 'QUEUE' })) => ({
  listChannels: vi.fn(),
  createPost,
});

function deps(prisma: ReturnType<typeof prismaFake>, client = clientFake()) {
  return { prisma: prisma as never, logger, createClient: () => client as never, client };
}

beforeEach(() => vi.clearAllMocks());

describe('executeAction — caminho feliz', () => {
  it('publica, grava a referência externa e marca EXECUTED', async () => {
    const prisma = prismaFake();
    const d = deps(prisma);

    await executeAction(d, ACTION_ID);

    expect(d.client.createPost).toHaveBeenCalledWith(
      { channelId: 'chan-1', providerIdentifier: 'instagram', content: 'texto do post' },
      expect.anything(),
    );
    expect(prisma.externalReference.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workspaceId: WORKSPACE_ID,
          integrationId: 'int-postiz',
          entityType: 'SOCIAL_POST',
          entityId: ACTION_ID,
          externalId: 'post_1',
          metadata: { state: 'QUEUE', channelId: 'chan-1' },
        }),
      }),
    );
    const written = prisma.action.update.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(written.data).toMatchObject({ status: 'EXECUTED', lastError: null, failureKind: null });
    expect(written.data.executedAt).toBeInstanceOf(Date);
  });

  it('carimba o heartbeat antes de chamar o provider', async () => {
    const prisma = prismaFake();

    await executeAction(deps(prisma), ACTION_ID);

    const first = prisma.action.update.mock.calls[0]![0] as { data: Record<string, unknown> };
    expect(first.data.heartbeatAt).toBeInstanceOf(Date);
  });
});

describe('executeAction — idempotência', () => {
  /**
   * A terceira camada de idempotência (spec §6): se já existe referência, esta
   * ação já publicou, e a única coisa correta é convergir o status sem tocar na
   * rede.
   */
  it('com referência já gravada, marca EXECUTED sem chamar o provider', async () => {
    const prisma = prismaFake({ delivery: { id: 'ref-1', externalId: 'post_1' } });
    const d = deps(prisma);

    await executeAction(d, ACTION_ID);

    expect(d.client.createPost).not.toHaveBeenCalled();
    expect(prisma.action.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'EXECUTED' }) }),
    );
  });

  /**
   * A corrida que a segunda unique de ExternalReference protege: outra
   * tentativa gravou entre a checagem e o insert. O post existe uma vez, e é
   * sucesso — não falha.
   */
  it('um P2002 no insert da referência é sucesso, não falha', async () => {
    const prisma = prismaFake();
    prisma.externalReference.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    await executeAction(deps(prisma), ACTION_ID);

    expect(prisma.action.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'EXECUTED' }) }),
    );
  });

  // Cancelada ou já resolvida enquanto o job esperava na fila: nada a fazer.
  it('não publica quando a ação já não está em EXECUTING', async () => {
    const prisma = prismaFake({ action: { ...ACTION, status: 'CANCELLED' } });
    const d = deps(prisma);

    await executeAction(d, ACTION_ID);

    expect(d.client.createPost).not.toHaveBeenCalled();
    expect(prisma.action.update).not.toHaveBeenCalled();
  });

  it('não estoura quando a ação já não existe', async () => {
    const prisma = prismaFake({ action: null });

    await expect(executeAction(deps(prisma), ACTION_ID)).resolves.toBeUndefined();
  });
});

describe('executeAction — falha de setup', () => {
  /**
   * Sem Postiz conectado e com credencial ilegível o pedido **não saiu**. Então
   * é FAILED, e não DELIVERY_UNKNOWN: marcar indeterminado aqui mandaria o
   * fundador conferir um canal onde nada foi tentado.
   */
  it('sem conexão Postiz falha na hora, sem retry e sem tocar na rede', async () => {
    const prisma = prismaFake({ integration: null });
    const d = deps(prisma);

    await expect(executeAction(d, ACTION_ID)).resolves.toBeUndefined();

    expect(d.client.createPost).not.toHaveBeenCalled();
    expect(prisma.action.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', failureKind: 'AUTH' }),
      }),
    );
  });

  it('credencial ilegível falha na hora, sem retry', async () => {
    const broken = seal('não é json');
    const prisma = prismaFake({
      integration: {
        ...INTEGRATION,
        ciphertext: new Uint8Array(broken.ciphertext),
        iv: new Uint8Array(broken.iv),
        authTag: new Uint8Array(broken.authTag),
      },
    });
    const d = deps(prisma);

    await expect(executeAction(d, ACTION_ID)).resolves.toBeUndefined();

    expect(d.client.createPost).not.toHaveBeenCalled();
    const written = prisma.action.update.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(written.data.status).toBe('FAILED');
  });
});

/**
 * A tabela de §7.2 do spec, linha por linha. Cada caso verifica o status final
 * **e** se relançou — relançar é o que faz o BullMQ retentar, e retentar o que
 * não devia é o que duplica post público.
 */
describe('executeAction — classificação da falha', () => {
  it('AUTH falha e não relança', async () => {
    const prisma = prismaFake();
    const d = deps(prisma, clientFake(vi.fn().mockRejectedValue(new PostizError('AUTH', 'Unauthorized', 401))));

    await expect(executeAction(d, ACTION_ID)).resolves.toBeUndefined();

    expect(prisma.action.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', failureKind: 'AUTH', lastError: 'Unauthorized' }),
      }),
    );
  });

  it('VALIDATION falha e não relança, com a mensagem do provider', async () => {
    const prisma = prismaFake();
    const d = deps(
      prisma,
      clientFake(vi.fn().mockRejectedValue(new PostizError('VALIDATION', 'Missing subreddit', 400))),
    );

    await expect(executeAction(d, ACTION_ID)).resolves.toBeUndefined();

    expect(prisma.action.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', lastError: 'Missing subreddit' }),
      }),
    );
  });

  it('RATE_LIMIT relança para o BullMQ retentar, e mantém EXECUTING', async () => {
    const prisma = prismaFake();
    const d = deps(prisma, clientFake(vi.fn().mockRejectedValue(new PostizError('RATE_LIMIT', 'slow down', 429))));

    await expect(executeAction(d, ACTION_ID)).rejects.toBeInstanceOf(PostizError);

    const written = prisma.action.update.mock.calls.at(-1)![0] as { data: Record<string, unknown> };
    expect(written.data.status).toBeUndefined();
    expect(written.data.lastError).toBe('slow down');
  });

  it('PROVIDER relança', async () => {
    const prisma = prismaFake();
    const d = deps(prisma, clientFake(vi.fn().mockRejectedValue(new PostizError('PROVIDER', 'bad gateway', 502))));

    await expect(executeAction(d, ACTION_ID)).rejects.toBeInstanceOf(PostizError);
  });

  /**
   * O caso que dá nome ao oitavo estado: não houve resposta, o post pode existir
   * e não há como perguntar. Nunca relança — retentar aqui duplica.
   */
  it('NETWORK vai para DELIVERY_UNKNOWN e não relança', async () => {
    const prisma = prismaFake();
    const d = deps(prisma, clientFake(vi.fn().mockRejectedValue(new PostizError('NETWORK', 'fetch failed'))));

    await expect(executeAction(d, ACTION_ID)).resolves.toBeUndefined();

    expect(prisma.action.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DELIVERY_UNKNOWN', failureKind: 'NETWORK' }),
      }),
    );
  });

  it('UNKNOWN vai para DELIVERY_UNKNOWN e não relança', async () => {
    const prisma = prismaFake();
    const d = deps(prisma, clientFake(vi.fn().mockRejectedValue(new PostizError('UNKNOWN', 'weird', 418))));

    await expect(executeAction(d, ACTION_ID)).resolves.toBeUndefined();

    expect(prisma.action.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DELIVERY_UNKNOWN' }) }),
    );
  });

  // Um erro que não é PostizError chegou de onde não devia. Tratado como
  // indeterminado pelo mesmo motivo: não se sabe se o post existe.
  it('um erro qualquer vai para DELIVERY_UNKNOWN', async () => {
    const prisma = prismaFake();
    const d = deps(prisma, clientFake(vi.fn().mockRejectedValue(new Error('boom'))));

    await expect(executeAction(d, ACTION_ID)).resolves.toBeUndefined();

    expect(prisma.action.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DELIVERY_UNKNOWN' }) }),
    );
  });
});
```

- [ ] **Step 2: Escreva o teste do reaper**

Crie `src/actions/reaper.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reapStuckActions } from './reaper.js';

const NOW = new Date('2026-08-04T12:00:00.000Z');
const OLD = new Date('2026-08-04T11:00:00.000Z');

const STUCK = { id: 'act-1', workspaceId: 'ws-1', status: 'EXECUTING', heartbeatAt: OLD, updatedAt: OLD };

function prismaFake(rows: unknown[] = [STUCK]) {
  return {
    action: {
      findMany: vi.fn().mockResolvedValue(rows),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

const logger = { info: vi.fn(), error: vi.fn() };

beforeEach(() => vi.clearAllMocks());

describe('reapStuckActions', () => {
  /**
   * O processo do worker morre no meio — deploy, OOM, `tsx watch` recarregando.
   * A ação fica EXECUTING para sempre, e o post pode ter saído. É a mesma razão
   * do reaper de agent runs, com o desfecho diferente: aqui não é FAILED.
   */
  it('move uma execução sem sinal de vida para DELIVERY_UNKNOWN', async () => {
    const prisma = prismaFake();

    const reaped = await reapStuckActions({ prisma: prisma as never, logger }, { now: NOW, staleMs: 120_000 });

    expect(reaped).toBe(1);
    expect(prisma.action.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        // O `status: 'EXECUTING'` no where é o que impede sobrescrever um
        // desfecho que o processor gravou entre a busca e a escrita.
        where: { id: 'act-1', status: 'EXECUTING' },
        data: expect.objectContaining({ status: 'DELIVERY_UNKNOWN', failureKind: 'NETWORK' }),
      }),
    );
  });

  it('nunca marca FAILED — o processo morto pode ter publicado', async () => {
    const prisma = prismaFake();

    await reapStuckActions({ prisma: prisma as never, logger }, { now: NOW });

    const written = prisma.action.updateMany.mock.calls[0]![0] as { data: { status: string } };
    expect(written.data.status).not.toBe('FAILED');
  });

  it('busca só EXECUTING sem heartbeat recente', async () => {
    const prisma = prismaFake();

    await reapStuckActions({ prisma: prisma as never, logger }, { now: NOW, staleMs: 120_000 });

    const cutoff = new Date(NOW.getTime() - 120_000);
    expect(prisma.action.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'EXECUTING',
          // Heartbeat nulo com updatedAt velho conta: é a execução que morreu
          // antes de carimbar o primeiro sinal.
          OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null, updatedAt: { lt: cutoff } }],
        },
      }),
    );
  });

  it('não escreve nada quando não há execução travada', async () => {
    const prisma = prismaFake([]);

    const reaped = await reapStuckActions({ prisma: prisma as never, logger }, { now: NOW });

    expect(reaped).toBe(0);
    expect(prisma.action.updateMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Rode e confirme a falha**

Run: `pnpm vitest run src/actions`
Expected: FAIL — `Cannot find module './processor.js'` e `'./reaper.js'`.

- [ ] **Step 4: Adicione as três variáveis de ambiente**

Em `src/config/env.ts`, junto de `AI_RUN_STALE_MS`:

```ts
  // Dois minutos sem sinal de vida é morte, não lentidão: uma publicação é uma
  // chamada HTTP, não um run de modelo.
  ACTION_STALE_MS: z.coerce.number().int().positive().default(120_000),
  ACTION_REAPER_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  ACTION_EXECUTION_ATTEMPTS: z.coerce.number().int().positive().default(3),
```

- [ ] **Step 5: Escreva `src/actions/queue.ts`**

```ts
import { Queue } from 'bullmq';
import { env } from '../config/env.js';
import { getConnection } from '../ai/queue/queue.js';

export const ACTION_EXECUTIONS_QUEUE = 'action-executions';

export type ActionExecutionJob = { actionId: string };

let queue: Queue<ActionExecutionJob> | undefined;

/**
 * Fila própria, conexão compartilhada com a dos agent runs: são trabalhos
 * diferentes com concorrência e retry diferentes, no mesmo Redis.
 */
export function getActionQueue(): Queue<ActionExecutionJob> {
  queue ??= new Queue<ActionExecutionJob>(ACTION_EXECUTIONS_QUEUE, {
    connection: getConnection(),
    defaultJobOptions: {
      attempts: env.ACTION_EXECUTION_ATTEMPTS,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 3_600, count: 1_000 },
      removeOnFail: { age: 86_400 },
    },
  });
  return queue;
}

/**
 * `jobId` é o id da ação: enquanto o job existe, o BullMQ recusa duplicado.
 * Não é a defesa principal da idempotência — `removeOnComplete` acaba apagando
 * o job — mas fecha a janela quente entre dois cliques (spec §6, camada 2).
 */
export async function enqueueActionExecution(job: ActionExecutionJob): Promise<void> {
  await getActionQueue().add('execute', job, { jobId: job.actionId });
}

export async function closeActionQueue(): Promise<void> {
  await queue?.close();
  queue = undefined;
}
```

- [ ] **Step 6: Escreva `src/actions/processor.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import {
  createPostizClient,
  isIndeterminate,
  isRetriable,
  parsePostizCredential,
  PostizError,
  type PostizClient,
  type PostizConfig,
} from '../integrations/social/index.js';
import { openIntegrationCredential } from '../http/api/integrations/integrations.service.js';
import { SOCIAL_POST_ENTITY } from '../http/api/actions/actions.repository.js';
import { parseActionPayload } from '../http/api/actions/actions.payload.js';

const PROVIDER = 'POSTIZ';

/** Uma publicação, não um relatório. */
const TIMEOUT_MS = 20_000;

export type ActionProcessorDeps = {
  prisma: PrismaClient;
  logger: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
  /** A fábrica do cliente, injetável: é o seam que mantém a suíte fora da rede. */
  createClient?: (config: PostizConfig) => PostizClient;
  now?: () => Date;
};

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2002';
}

/**
 * O único lugar do sistema que escreve no Postiz.
 *
 * Relança **apenas** quando o kind é retentável (`RATE_LIMIT`, `PROVIDER`):
 * relançar é o que faz o BullMQ tentar de novo, e tentar de novo o que não
 * devia é o que publica duas vezes num canal público (spec §7.2).
 */
export async function executeAction(deps: ActionProcessorDeps, actionId: string): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const createClient = deps.createClient ?? createPostizClient;

  // Sem `workspaceId` no where: o job só nasce de uma rota já escopada pelo
  // tenant, e o id dele é o próprio id da ação. Não há entrada de usuário aqui.
  const action = await deps.prisma.action.findUnique({ where: { id: actionId } });
  if (!action) {
    deps.logger.info({ actionId }, 'action execution skipped: the action is gone');
    return;
  }

  // Cancelada, resolvida ou já concluída enquanto o job esperava na fila.
  if (action.status !== 'EXECUTING') {
    deps.logger.info({ actionId, status: action.status }, 'action execution skipped: not executing');
    return;
  }

  const markAction = (data: Record<string, unknown>): Promise<unknown> =>
    deps.prisma.action.update({ where: { id: action.id }, data });

  const markExecuted = (): Promise<unknown> =>
    markAction({ status: 'EXECUTED', executedAt: now(), lastError: null, failureKind: null, heartbeatAt: null });

  // Camada 3 da idempotência: se já há referência, esta ação já publicou, e a
  // única coisa correta é convergir o status sem tocar na rede (spec §6).
  const existing = await deps.prisma.externalReference.findFirst({
    where: { workspaceId: action.workspaceId, entityType: SOCIAL_POST_ENTITY, entityId: action.id },
  });
  if (existing) {
    deps.logger.info({ actionId, externalId: existing.externalId }, 'action already delivered');
    await markExecuted();
    return;
  }

  const integration = await deps.prisma.workspaceIntegration.findFirst({
    where: { workspaceId: action.workspaceId, provider: PROVIDER },
  });
  // Nada saiu, então FAILED e não DELIVERY_UNKNOWN: mandar o fundador conferir
  // um canal onde nada foi tentado é pior que dizer que falhou.
  if (!integration) {
    await markAction({
      status: 'FAILED',
      failureKind: 'AUTH',
      lastError: 'no postiz account is connected to this workspace',
      heartbeatAt: null,
    });
    return;
  }

  /**
   * Montar o cliente pode falhar por si — credencial ilegível, payload gravado
   * fora do contrato — e isso acontece **antes** de qualquer pedido sair. Fica
   * em try próprio, com desfecho `FAILED`, e não no try da chamada: usar a
   * tabela de classificação aqui marcaria indeterminado o que nunca saiu.
   *
   * É a mesma lição de `read-measurement.ts`, onde montar o conector fora do
   * try virava 500 sem mensagem.
   */
  let client: PostizClient;
  let payload;
  try {
    client = createClient(parsePostizCredential(openIntegrationCredential(integration)));
    payload = parseActionPayload(action.type, action.payload);
  } catch (error) {
    await markAction({
      status: 'FAILED',
      failureKind: error instanceof PostizError ? error.kind : 'VALIDATION',
      lastError: error instanceof Error ? error.message : 'unknown error',
      heartbeatAt: null,
    });
    return;
  }

  // O sinal de vida vai antes da chamada: é o que separa lento de morto para o
  // reaper, e a chamada é justamente a parte que pode demorar.
  await markAction({ heartbeatAt: now() });

  let created;
  try {
    created = await client.createPost(
      {
        channelId: payload.channelId,
        providerIdentifier: payload.providerIdentifier,
        content: payload.content,
      },
      AbortSignal.timeout(TIMEOUT_MS),
    );
  } catch (error) {
    const kind = error instanceof PostizError ? error.kind : 'UNKNOWN';
    const reason = error instanceof Error ? error.message : 'unknown error';

    if (isRetriable(kind)) {
      // Status intacto: continua EXECUTING, e o BullMQ tenta de novo. Só a
      // mensagem é gravada, para a tela mostrar o motivo da espera.
      await markAction({ lastError: reason, failureKind: kind });
      throw error;
    }

    if (isIndeterminate(kind)) {
      // Não se sabe se o post existe, e não há como perguntar: `GET /posts` do
      // Postiz busca por janela de datas, nunca por id (spec §3.3, §7.3).
      await markAction({ status: 'DELIVERY_UNKNOWN', lastError: reason, failureKind: kind, heartbeatAt: null });
      deps.logger.error({ actionId, kind }, 'action delivery is unknown');
      return;
    }

    await markAction({ status: 'FAILED', lastError: reason, failureKind: kind, heartbeatAt: null });
    return;
  }

  try {
    await deps.prisma.externalReference.create({
      data: {
        workspaceId: action.workspaceId,
        integrationId: integration.id,
        entityType: SOCIAL_POST_ENTITY,
        entityId: action.id,
        externalId: created.id,
        // `state` é do provider e vale como ele veio: `QUEUE` na criação.
        metadata: { state: created.state, channelId: payload.channelId },
      },
    });
  } catch (error) {
    // A corrida que a segunda unique protege: outra tentativa gravou entre a
    // checagem e o insert. O post existe uma vez, e isso é sucesso.
    if (!isUniqueViolation(error)) throw error;
    deps.logger.info({ actionId }, 'another attempt already recorded this delivery');
  }

  await markExecuted();
}
```

- [ ] **Step 7: Escreva `src/actions/reaper.ts`**

```ts
import type { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

export type ActionReaperDeps = {
  prisma: PrismaClient;
  logger: { info: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void };
};

/**
 * Fecha as execuções que pararam de dar sinal de vida.
 *
 * O processo do worker pode morrer no meio de uma publicação — deploy, OOM, o
 * `tsx watch` recarregando em desenvolvimento. A ação fica `EXECUTING` para
 * sempre, e o post pode ter saído.
 *
 * O desfecho é `DELIVERY_UNKNOWN`, **nunca** `FAILED`: um processo morto pode
 * ter publicado, e `FAILED` convida a republicar (spec §7.4).
 */
export async function reapStuckActions(
  deps: ActionReaperDeps,
  options: { staleMs?: number; limit?: number; now?: Date } = {},
): Promise<number> {
  const staleMs = options.staleMs ?? env.ACTION_STALE_MS;
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - staleMs);

  const stuck = await deps.prisma.action.findMany({
    where: {
      status: 'EXECUTING',
      // Heartbeat nulo com `updatedAt` velho conta: é a execução que morreu
      // antes de carimbar o primeiro sinal.
      OR: [{ heartbeatAt: { lt: cutoff } }, { heartbeatAt: null, updatedAt: { lt: cutoff } }],
    },
    select: { id: true, workspaceId: true, lastError: true },
    take: options.limit ?? 100,
    orderBy: { updatedAt: 'asc' },
  });

  for (const action of stuck) {
    // `status: 'EXECUTING'` no where, e `updateMany` em vez de `update`: se o
    // processor gravou um desfecho entre a busca e esta escrita, o dele vale.
    await deps.prisma.action.updateMany({
      where: { id: action.id, status: 'EXECUTING' },
      data: {
        status: 'DELIVERY_UNKNOWN',
        failureKind: 'NETWORK',
        // A mensagem que a tentativa já tinha gravado é preservada: se o
        // provider disse algo antes de o processo morrer, essa é a única pista
        // que existe, e o texto do reaper a apagaria.
        lastError:
          action.lastError ??
          `no sign of life for ${Math.round(staleMs / 1000)}s — check the channel before trying again`,
        heartbeatAt: null,
      },
    });
  }

  return stuck.length;
}

/**
 * Roda no boot e em intervalo fixo. `unref` para não segurar o processo aberto
 * no desligamento — mesma forma de `startStaleRunReaper`.
 */
export function startActionReaper(deps: ActionReaperDeps): NodeJS.Timeout {
  const tick = async (): Promise<void> => {
    try {
      const reaped = await reapStuckActions(deps);
      if (reaped > 0) deps.logger.info({ reaped }, 'reaped action executions without a heartbeat');
    } catch (error) {
      deps.logger.error({ err: error }, 'the action reaper failed');
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), env.ACTION_REAPER_INTERVAL_MS);
  timer.unref();
  return timer;
}
```

- [ ] **Step 8: Escreva `src/actions/worker.ts`**

```ts
import { Worker } from 'bullmq';
import { getConnection } from '../ai/queue/queue.js';
import { ACTION_EXECUTIONS_QUEUE, type ActionExecutionJob } from './queue.js';
import { executeAction, type ActionProcessorDeps } from './processor.js';

type Execute = (deps: ActionProcessorDeps, actionId: string) => Promise<void>;

export function createActionProcessor(deps: ActionProcessorDeps, execute: Execute = executeAction) {
  return async (job: { data: ActionExecutionJob }): Promise<void> => {
    try {
      await execute(deps, job.data.actionId);
    } catch (error) {
      // O processor só relança o que é retentável, e já gravou o motivo. Chegar
      // aqui é o sinal para o BullMQ tentar de novo.
      deps.logger.error({ actionId: job.data.actionId, err: error }, 'action execution job failed');
      throw error;
    }
  };
}

/**
 * Fecha a ação cujo job esgotou as tentativas.
 *
 * Sem isto, ela ficaria `EXECUTING` até o reaper passar — e o reaper só sabe
 * dizer "sem sinal de vida", o que apagaria a razão real e mandaria o fundador
 * conferir o canal.
 *
 * O desfecho depende do que se sabe. `RATE_LIMIT` e `PROVIDER` são as únicas
 * falhas que o processor relança, e as duas significam que o Postiz respondeu e
 * não criou nada — em toda tentativa. Então é `FAILED`, reexecutável sem
 * conferir canal nenhum. Qualquer outra coisa que chegue aqui não tem essa
 * garantia, e aí vale a regra conservadora: `DELIVERY_UNKNOWN`.
 */
export async function reconcileExhaustedAction(deps: ActionProcessorDeps, actionId: string): Promise<void> {
  const action = await deps.prisma.action.findUnique({
    where: { id: actionId },
    select: { status: true, failureKind: true, lastError: true },
  });
  // Já resolvido pelo processor ou por um humano: o desfecho dele é o que vale.
  if (!action || action.status !== 'EXECUTING') return;

  const answered = action.failureKind === 'RATE_LIMIT' || action.failureKind === 'PROVIDER';

  await deps.prisma.action.updateMany({
    where: { id: actionId, status: 'EXECUTING' },
    data: {
      status: answered ? 'FAILED' : 'DELIVERY_UNKNOWN',
      // A mensagem da fonte é preservada: "slow down" diz o que aconteceu, e
      // sobrescrevê-la com um texto nosso perderia a única pista que existe.
      lastError: action.lastError ?? 'the execution job ran out of attempts',
      heartbeatAt: null,
    },
  });

  deps.logger.info({ actionId, answered }, 'reconciled an action whose job ran out of attempts');
}

/**
 * Concorrência 1 de propósito: publicações de um mesmo workspace disputariam
 * limite de taxa do provider, e o ganho de paralelizar uma chamada HTTP curta
 * não paga o risco.
 *
 * O `failed` cobre o job que esgotou tentativas; o reaper cobre o processo que
 * morreu sem chegar a emitir `failed`.
 */
export function startActionWorker(deps: ActionProcessorDeps): Worker<ActionExecutionJob> {
  const worker = new Worker<ActionExecutionJob>(ACTION_EXECUTIONS_QUEUE, createActionProcessor(deps), {
    connection: getConnection(),
    concurrency: 1,
  });

  // `failed` é emitido a cada tentativa. Só a última fecha a ação — reconciliar
  // na primeira mataria a retentativa que o backoff ainda vai fazer.
  worker.on('failed', (job) => {
    if (!job) return;
    const limit = job.opts.attempts ?? 1;
    if (job.attemptsMade < limit) return;
    void reconcileExhaustedAction(deps, job.data.actionId);
  });

  return worker;
}
```

Escreva também `src/actions/worker.test.ts` cobrindo `reconcileExhaustedAction`: `RATE_LIMIT` e `PROVIDER` viram `FAILED` com o `lastError` preservado; `failureKind` nulo ou `NETWORK` vira `DELIVERY_UNKNOWN`; uma ação que já saiu de `EXECUTING` não é tocada; e uma ação inexistente não estoura.

- [ ] **Step 9: Rode os testes de `src/actions`**

Run: `pnpm vitest run src/actions`
Expected: PASS, todos.

- [ ] **Step 10: Escreva o teste das duas rotas de execução**

Crie `src/http/api/actions/actions-execution.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { AppError } from '../../../lib/errors.js';
import { actionsRoutes } from './index.js';

const WORKSPACE_ID = '22222222-2222-2222-2222-222222222222';
const ACTION_ID = '33333333-3333-3333-3333-333333333333';

const PAYLOAD = {
  channelId: 'chan-1',
  channelName: 'AUREA no Instagram',
  providerIdentifier: 'instagram',
  content: 'texto do post',
};

const ACTION = {
  id: ACTION_ID,
  workspaceId: WORKSPACE_ID,
  experimentId: null,
  type: 'SOCIAL_POST',
  name: 'Post',
  description: null,
  payload: PAYLOAD,
  status: 'APPROVED',
  createdBy: 'u1',
  approvedAt: new Date('2026-08-04T10:30:00.000Z'),
  executedAt: null,
  attempts: 0,
  lastError: null,
  failureKind: null,
  heartbeatAt: null,
  createdAt: new Date('2026-08-04T10:00:00.000Z'),
  updatedAt: new Date('2026-08-04T10:00:00.000Z'),
};

const INTEGRATION = { id: 'int-postiz', workspaceId: WORKSPACE_ID, provider: 'POSTIZ' };

function prismaFake(over: { action?: unknown; claimed?: number; integration?: unknown } = {}) {
  const db = {
    action: {
      findFirst: vi.fn().mockResolvedValue('action' in over ? over.action : ACTION),
      findMany: vi.fn().mockResolvedValue([ACTION]),
      create: vi.fn(),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ ...ACTION, ...data })),
      updateMany: vi.fn().mockResolvedValue({ count: 'claimed' in over ? over.claimed : 1 }),
    },
    approval: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), updateMany: vi.fn() },
    externalReference: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    experiment: { findFirst: vi.fn().mockResolvedValue(null) },
    workspaceIntegration: {
      findFirst: vi.fn().mockResolvedValue('integration' in over ? over.integration : INTEGRATION),
    },
  };
  return { ...db, $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)) };
}

beforeEach(() => vi.clearAllMocks());

async function buildApp(
  prisma: unknown,
  opts: { role?: 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER'; enqueue?: ReturnType<typeof vi.fn> } = {},
) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', prisma as never);
  app.addHook('preHandler', async (req) => {
    req.tenant = {
      userId: 'u2',
      organizationId: 'org-1',
      workspaceId: WORKSPACE_ID,
      role: opts.role ?? 'ADMIN',
    };
  });
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({ error: { code: error.code, details: error.details } });
    }
    throw error;
  });
  // A fila entra por opção: sem isso, um teste abriria conexão com o Redis.
  await app.register(actionsRoutes, { enqueue: opts.enqueue ?? vi.fn().mockResolvedValue(undefined) });
  return app;
}

describe('POST /actions/:id/execute', () => {
  it('reivindica a execução e enfileira, respondendo 202', async () => {
    const prisma = prismaFake();
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const app = await buildApp(prisma, { enqueue });

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/execute` });

    // 202: o pedido foi aceito, e a publicação acontece fora da requisição.
    expect(res.statusCode).toBe(202);
    expect(res.json().action.status).toBe('EXECUTING');
    expect(enqueue).toHaveBeenCalledWith({ actionId: ACTION_ID });
  });

  /**
   * O compare-and-swap (spec §6, camada 1): a transição é a própria condição do
   * `updateMany`. `FAILED` entra no `in` porque reexecutar uma falha é ato
   * humano legítimo, e a corrida a proteger é a mesma — dois cliques em "tentar
   * de novo".
   */
  it('move de APPROVED ou FAILED numa escrita condicional, incrementando attempts', async () => {
    const prisma = prismaFake();
    const app = await buildApp(prisma);

    await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/execute` });

    expect(prisma.action.updateMany).toHaveBeenCalledWith({
      where: { id: ACTION_ID, workspaceId: WORKSPACE_ID, status: { in: ['APPROVED', 'FAILED'] } },
      data: expect.objectContaining({
        status: 'EXECUTING',
        attempts: { increment: 1 },
        lastError: null,
        failureKind: null,
      }),
    });
  });

  it('reexecuta uma ação em FAILED', async () => {
    const app = await buildApp(prismaFake({ action: { ...ACTION, status: 'FAILED', failureKind: 'AUTH' } }));

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/execute` });

    expect(res.statusCode).toBe(202);
  });

  // A corrida perdida: outra requisição já levou a ação. 409, e nada vai para a
  // fila — enfileirar aqui produziria a segunda publicação.
  it('responde 409 e não enfileira quando a reivindicação falha', async () => {
    const enqueue = vi.fn();
    const app = await buildApp(prismaFake({ claimed: 0 }), { enqueue });

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/execute` });

    expect(res.statusCode).toBe(409);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('recusa executar o que não foi aprovado', async () => {
    const enqueue = vi.fn();
    const app = await buildApp(prismaFake({ action: { ...ACTION, status: 'PROPOSED' } }), { enqueue });

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/execute` });

    expect(res.statusCode).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('recusa executar sem Postiz conectado, sem enfileirar', async () => {
    const enqueue = vi.fn();
    const app = await buildApp(prismaFake({ integration: null }), { enqueue });

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/execute` });

    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('AUR-T0041');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('uma ação de outro workspace é indistinguível de inexistente', async () => {
    const app = await buildApp(prismaFake({ action: null }));

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/execute` });

    expect(res.statusCode).toBe(404);
  });

  // Executar é o ato que sai para o mundo: exige aprovador, não escritor.
  it('MEMBER não executa', async () => {
    const app = await buildApp(prismaFake(), { role: 'MEMBER' });

    const res = await app.inject({ method: 'POST', url: `/actions/${ACTION_ID}/execute` });

    expect(res.statusCode).toBe(403);
  });
});

describe('POST /actions/:id/resolve', () => {
  const unknown = () => prismaFake({ action: { ...ACTION, status: 'DELIVERY_UNKNOWN', failureKind: 'NETWORK' } });

  it('publicou: marca EXECUTED e grava a referência com o id informado', async () => {
    const prisma = unknown();
    const app = await buildApp(prisma);

    const res = await app.inject({
      method: 'POST',
      url: `/actions/${ACTION_ID}/resolve`,
      payload: { outcome: 'PUBLISHED', externalId: 'post_1' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().action.status).toBe('EXECUTED');
    expect(prisma.externalReference.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entityId: ACTION_ID, externalId: 'post_1' }),
      }),
    );
  });

  // Um externalId inventado é pior que a ausência dele: viraria proveniência
  // falsa de um post real.
  it('publicou sem id: marca EXECUTED e não grava referência', async () => {
    const prisma = unknown();
    const app = await buildApp(prisma);

    const res = await app.inject({
      method: 'POST',
      url: `/actions/${ACTION_ID}/resolve`,
      payload: { outcome: 'PUBLISHED' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().action.status).toBe('EXECUTED');
    expect(prisma.externalReference.create).not.toHaveBeenCalled();
  });

  it('não publicou: volta para APPROVED, limpando o erro', async () => {
    const prisma = unknown();
    const app = await buildApp(prisma);

    const res = await app.inject({
      method: 'POST',
      url: `/actions/${ACTION_ID}/resolve`,
      payload: { outcome: 'NOT_PUBLISHED' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().action).toMatchObject({ status: 'APPROVED', lastError: null, failureKind: null });
  });

  it('recusa resolver o que não está em DELIVERY_UNKNOWN', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({
      method: 'POST',
      url: `/actions/${ACTION_ID}/resolve`,
      payload: { outcome: 'PUBLISHED' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('AUR-T0044');
  });

  it('recusa um outcome fora do vocabulário', async () => {
    const app = await buildApp(unknown());

    const res = await app.inject({
      method: 'POST',
      url: `/actions/${ACTION_ID}/resolve`,
      payload: { outcome: 'MAYBE' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('MEMBER não resolve', async () => {
    const app = await buildApp(unknown(), { role: 'MEMBER' });

    const res = await app.inject({
      method: 'POST',
      url: `/actions/${ACTION_ID}/resolve`,
      payload: { outcome: 'PUBLISHED' },
    });

    expect(res.statusCode).toBe(403);
  });
});
```

- [ ] **Step 11: Adicione `claimForExecution` e `resolveDelivery` ao repositório**

Em `src/http/api/actions/actions.repository.ts`:

```ts
    /**
     * O compare-and-swap que serializa a execução (spec §6, camada 1).
     *
     * A transição é a própria condição do `updateMany`: dois cliques
     * simultâneos não podem ambos encontrar um estado executável. Devolve
     * `false` para quem perdeu, e só quem ganhou enfileira.
     *
     * `FAILED` está no `in` porque reexecutar uma falha é ato humano legítimo
     * (spec §7.2), e a corrida a proteger é a mesma.
     */
    async claimForExecution(workspaceId: string, id: string): Promise<boolean> {
      const { count } = await prisma.action.updateMany({
        where: { id, workspaceId, status: { in: ['APPROVED', 'FAILED'] } },
        data: {
          status: 'EXECUTING',
          attempts: { increment: 1 },
          // O erro da tentativa anterior sai agora: mantê-lo faria a tela
          // mostrar a falha de ontem ao lado de uma execução em voo.
          lastError: null,
          failureKind: null,
          heartbeatAt: null,
        },
      });
      return count === 1;
    },

    /**
     * A decisão humana sobre uma entrega incerta.
     *
     * `externalId` opcional: sem ele, marca executado sem referência — um id
     * inventado seria proveniência falsa de um post real (spec §7.3).
     */
    resolveDelivery(
      workspaceId: string,
      actionId: string,
      resolution:
        | { outcome: 'PUBLISHED'; integrationId: string; externalId: string | null; channelId: string; now: Date }
        | { outcome: 'NOT_PUBLISHED' },
    ) {
      if (resolution.outcome === 'NOT_PUBLISHED') {
        return prisma.action.update({
          where: { id: actionId },
          data: { status: 'APPROVED', lastError: null, failureKind: null, heartbeatAt: null },
        });
      }

      const { integrationId, externalId, channelId, now } = resolution;
      return prisma.$transaction(async (tx) => {
        if (externalId) {
          await tx.externalReference.create({
            data: {
              workspaceId,
              integrationId,
              entityType: SOCIAL_POST_ENTITY,
              entityId: actionId,
              externalId,
              // `state: null`: quem confirmou foi o humano, e o provider não nos
              // disse estado nenhum. Inventar 'PUBLISHED' aqui seria afirmar o
              // que não veio da fonte.
              metadata: { state: null, channelId },
            },
          });
        }
        return tx.action.update({
          where: { id: actionId },
          data: {
            status: 'EXECUTED',
            executedAt: now,
            lastError: null,
            failureKind: null,
            heartbeatAt: null,
          },
        });
      });
    },
```

- [ ] **Step 12: Escreva `execute-action/execute-action.controller.ts`**

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ConflictError, NotFoundError, PostizNotConnectedError } from '../../../../lib/errors.js';
import { assertAdmin } from '../../../../lib/tenant.js';
import { assertActionTransition } from '../actions.domain.js';
import { createIntegrationsRepository } from '../../integrations/integrations.repository.js';
import { createActionsRepository } from '../actions.repository.js';
import { presentAction } from '../actions.presenter.js';
import { actionIdParam, actionResponse } from '../actions.schema.js';
import { enqueueActionExecution, type ActionExecutionJob } from '../../../../actions/queue.js';

const PROVIDER = 'POSTIZ';

/** A fila entra por opção: sem isso um teste abriria conexão com o Redis. */
export type ExecuteActionOptions = { enqueue?: (job: ActionExecutionJob) => Promise<void> };

export const executeActionRoute: FastifyPluginAsync<ExecuteActionOptions> = async (app, opts) => {
  const enqueue = opts.enqueue ?? enqueueActionExecution;

  app.withTypeProvider<ZodTypeProvider>().post(
    '/actions/:id/execute',
    {
      schema: {
        tags: ['actions'],
        operationId: 'executeAction',
        params: actionIdParam,
        response: { 202: actionResponse },
      },
    },
    async (req, reply) => {
      // Executar é o ato que sai para o mundo: exige aprovador, não escritor.
      assertAdmin(req.tenant);
      const { workspaceId } = req.tenant;
      const repo = createActionsRepository(app.prisma);

      const current = await repo.findById(workspaceId, req.params.id);
      if (!current) throw new NotFoundError('Action not found');
      // A mensagem nomeada vem daqui: sem esta checagem, executar uma ação em
      // PROPOSED cairia no 409 genérico do compare-and-swap e o fundador leria
      // "conflito" onde o problema é falta de aprovação.
      assertActionTransition(current.status, 'EXECUTING');

      // Recusa antes de reivindicar: sem conexão a ação iria para EXECUTING e
      // voltaria FAILED alguns segundos depois, gastando uma tentativa.
      const integration = await createIntegrationsRepository(app.prisma).find(workspaceId, PROVIDER);
      if (!integration) throw new PostizNotConnectedError();

      const claimed = await repo.claimForExecution(workspaceId, current.id);
      // Perdeu a corrida: outra requisição já levou. Nada vai para a fila —
      // enfileirar aqui produziria a segunda publicação.
      if (!claimed) throw new ConflictError('This action is not waiting to be executed');

      await enqueue({ actionId: current.id });

      const action = await repo.findById(workspaceId, current.id);
      if (!action) throw new NotFoundError('Action not found');
      return reply.code(202).send({ action: presentAction(action) });
    },
  );
};
```

- [ ] **Step 13: Escreva a resolução**

`resolve-action/resolve-action.schema.ts`:

```ts
import { z } from 'zod';

export const resolveActionBody = z.object({
  /**
   * Vocabulário fechado: o humano diz o que viu no canal. Não há terceira
   * opção — "não sei" é o estado em que a ação já está.
   */
  outcome: z.enum(['PUBLISHED', 'NOT_PUBLISHED']),
  /** O id do post no provider, quando o fundador consegue copiá-lo. */
  externalId: z.string().min(1).max(200).optional(),
});
```

`resolve-action/resolve-action.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  ActionNotResolvableError,
  NotFoundError,
  PostizNotConnectedError,
} from '../../../../lib/errors.js';
import { assertAdmin } from '../../../../lib/tenant.js';
import { createIntegrationsRepository } from '../../integrations/integrations.repository.js';
import { parseActionPayload } from '../actions.payload.js';
import { createActionsRepository } from '../actions.repository.js';
import { presentAction } from '../actions.presenter.js';
import { actionIdParam, actionResponse } from '../actions.schema.js';
import { resolveActionBody } from './resolve-action.schema.js';

const PROVIDER = 'POSTIZ';

/**
 * A saída do oitavo estado, e ela é humana por construção.
 *
 * Não existe caminho automático de `DELIVERY_UNKNOWN`: o Postiz não permite
 * consultar um post por id (spec §3.3), então quem sabe se o post existe é
 * quem olha o canal.
 */
export const resolveActionRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/actions/:id/resolve',
    {
      schema: {
        tags: ['actions'],
        operationId: 'resolveAction',
        params: actionIdParam,
        body: resolveActionBody,
        response: { 200: actionResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);
      const { workspaceId } = req.tenant;
      const repo = createActionsRepository(app.prisma);

      const current = await repo.findById(workspaceId, req.params.id);
      if (!current) throw new NotFoundError('Action not found');
      // 409 com código próprio: a ação existe e o pedido está bem formado — o
      // que não existe é uma decisão pendente sobre entrega.
      if (current.status !== 'DELIVERY_UNKNOWN') throw new ActionNotResolvableError();

      if (req.body.outcome === 'NOT_PUBLISHED') {
        const action = await repo.resolveDelivery(workspaceId, current.id, { outcome: 'NOT_PUBLISHED' });
        return reply.send({ action: presentAction(action) });
      }

      const integration = await createIntegrationsRepository(app.prisma).find(workspaceId, PROVIDER);
      if (!integration) throw new PostizNotConnectedError();

      const action = await repo.resolveDelivery(workspaceId, current.id, {
        outcome: 'PUBLISHED',
        integrationId: integration.id,
        externalId: req.body.externalId ?? null,
        channelId: parseActionPayload(current.type, current.payload).channelId,
        now: new Date(),
      });

      return reply.send({ action: presentAction(action) });
    },
  );
};
```

- [ ] **Step 14: Registre as duas rotas**

Em `src/http/api/actions/index.ts`:

```ts
import { executeActionRoute, type ExecuteActionOptions } from './execute-action/execute-action.controller.js';
import { resolveActionRoute } from './resolve-action/resolve-action.controller.js';
```

```ts
export type ActionsRoutesOptions = CreateActionOptions & ExecuteActionOptions;
```

E no corpo, depois de `cancelActionRoute`:

```ts
  await app.register(executeActionRoute, { enqueue: opts.enqueue });
  await app.register(resolveActionRoute);
```

- [ ] **Step 15: Suba o worker e o reaper no processo do worker**

Em `src/worker.ts`, adicione os imports:

```ts
import { startActionWorker } from './actions/worker.js';
import { startActionReaper } from './actions/reaper.js';
import { closeActionQueue } from './actions/queue.js';
```

Depois de `const clock = startExperimentClock(...)`:

```ts
// A execução de ações vive no mesmo processo do worker de IA, e pela mesma
// razão: a API reinicia a cada deploy, e uma publicação em voo não pode morrer
// com ela. O reaper ao lado, porque é ele quem fecha o que morreu.
const actionWorker = startActionWorker({ prisma, logger });
const actionReaper = startActionReaper({ prisma, logger });
```

No `shutdown`, junto dos outros:

```ts
  clearInterval(actionReaper);
```

e, dentro do `try` onde `worker.close()` e `closeQueue()` já são chamados:

```ts
    await actionWorker.close();
    await closeActionQueue();
```

- [ ] **Step 16: Rode os testes de ações**

Run: `pnpm vitest run src/http/api/actions src/actions`
Expected: PASS, todos.

- [ ] **Step 17: Typecheck, suíte e contrato**

Run: `pnpm typecheck && pnpm test && pnpm openapi:dump`
Expected: tsc exit 0; suíte verde; `../web/api.json` com `executeAction` e `resolveAction`.

- [ ] **Step 18: Confira que nenhum teste abre rede ou Redis**

Run: `grep -rn "createPostizClient\|enqueueActionExecution" src --include=*.test.ts`
Expected: nenhuma linha — os testes usam sempre o seam de opção. Se aparecer alguma, corrija o teste antes de seguir.

- [ ] **Step 19: Stage e reporte**

```bash
git add src/actions src/http/api/actions src/config/env.ts src/worker.ts
git status --short
git diff --cached --stat
```

**Não rode `git commit`.**

---

## Task 7: O agente `propose-social-post`

Décimo agente da família `fill/`. Preenche o formulário; não cria a Action, não submete, não aprova.

**Files:**
- Create: `src/ai/agents/fill/propose-social-post.ts`
- Create: `src/ai/agents/fill/propose-social-post.test.ts`
- Modify: `src/ai/agents/registry.ts`

**Interfaces:**
- Consumes: `buildFillOutputSchema`, `fillSystemPrompt`, `type FillOutput` de `./contract.js`; `createGetLearningsTool()` de `../../tools/get-learnings.js`; `createGetExperimentResultTool(experimentId)` de `../../tools/get-experiment-result.js`; `type AgentDefinition`, `type AgentContext` de `../registry.js`; `NotFoundError` de `../../../lib/errors.js`.
- Produces: `proposeSocialPostAgent` com `taskType: 'propose-social-post'`, e a entrada dele no `AGENT_REGISTRY`.

- [ ] **Step 1: Escreva o teste**

Crie `src/ai/agents/fill/propose-social-post.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { proposeSocialPostAgent } from './propose-social-post.js';

const TENANT = { userId: 'u1', organizationId: 'org-1', workspaceId: 'ws-1', role: 'ADMIN' as const };

const EXPERIMENT_ID = '44444444-4444-4444-4444-444444444444';

describe('proposeSocialPostAgent', () => {
  it('aceita um input sem experimento', () => {
    expect(proposeSocialPostAgent.inputSchema.safeParse({ providerIdentifier: 'instagram' }).success).toBe(true);
  });

  it('aceita brief e experimento', () => {
    const parsed = proposeSocialPostAgent.inputSchema.safeParse({
      providerIdentifier: 'instagram',
      experimentId: EXPERIMENT_ID,
      brief: 'Falar do corte de custo, sem número inventado.',
    });
    expect(parsed.success).toBe(true);
  });

  // O canal muda o formato do texto: um post de X não é um post de LinkedIn.
  it('recusa um input sem o canal', () => {
    expect(proposeSocialPostAgent.inputSchema.safeParse({ brief: 'qualquer coisa' }).success).toBe(false);
  });

  it('recusa um experimentId que não é uuid', () => {
    expect(
      proposeSocialPostAgent.inputSchema.safeParse({ providerIdentifier: 'x', experimentId: 'nope' }).success,
    ).toBe(false);
  });

  it('aceita a saída do contrato de preenchimento', () => {
    const parsed = proposeSocialPostAgent.outputSchema.safeParse({
      filled: { name: 'Post sobre custo', payload: { content: 'Texto do post.' } },
      questions: [],
      confidence: 'MEDIUM',
    });
    expect(parsed.success).toBe(true);
  });

  // O modelo escreve o texto e o nome, e nada além: um canal escolhido pelo
  // modelo é o modelo decidindo onde publicar.
  it('recusa uma saída que tenta escolher o canal', () => {
    const parsed = proposeSocialPostAgent.outputSchema.safeParse({
      filled: { payload: { content: 'Texto.', channelId: 'chan-9' } },
      questions: [],
      confidence: 'HIGH',
    });
    expect(parsed.success).toBe(false);
  });

  it('só lê aprendizados quando não há experimento', () => {
    const tools = proposeSocialPostAgent.buildTools({ providerIdentifier: 'instagram' });

    expect(tools.map((tool) => tool.name)).toEqual(['get_learnings']);
  });

  it('lê o experimento também quando ele existe', () => {
    const tools = proposeSocialPostAgent.buildTools({
      providerIdentifier: 'instagram',
      experimentId: EXPERIMENT_ID,
    });

    expect(tools.map((tool) => tool.name)).toContain('get_experiment_result');
  });

  it('põe o canal e o brief na conversa', () => {
    const messages = proposeSocialPostAgent.buildMessages(
      { providerIdentifier: 'linkedin', brief: 'Tom sóbrio.' },
      { tenant: TENANT },
    );

    const text = messages.map((message) => message.content).join('\n');
    expect(text).toContain('linkedin');
    expect(text).toContain('Tom sóbrio.');
  });

  // Recusar aqui é recusar antes de cobrar o crédito — é para isso que o
  // precheck existe.
  it('recusa no precheck um experimento de outro workspace', async () => {
    const prisma = { experiment: { findFirst: vi.fn().mockResolvedValue(null) } };

    await expect(
      proposeSocialPostAgent.precheck?.(
        { providerIdentifier: 'instagram', experimentId: EXPERIMENT_ID },
        { prisma: prisma as never, tenant: TENANT },
      ),
    ).rejects.toMatchObject({ code: 'AUR-T0005' });
  });

  it('não consulta o banco quando não há experimento', async () => {
    const prisma = { experiment: { findFirst: vi.fn() } };

    await proposeSocialPostAgent.precheck?.(
      { providerIdentifier: 'instagram' },
      { prisma: prisma as never, tenant: TENANT },
    );

    expect(prisma.experiment.findFirst).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rode e confirme a falha**

Run: `pnpm vitest run src/ai/agents/fill/propose-social-post.test.ts`
Expected: FAIL — `Cannot find module './propose-social-post.js'`.

- [ ] **Step 3: Escreva o agente**

```ts
import { z, type ZodType } from 'zod';
import type { AgentContext, AgentDefinition } from '../registry.js';
import { buildFillOutputSchema, fillSystemPrompt, type FillOutput } from './contract.js';
import { createGetLearningsTool } from '../../tools/get-learnings.js';
import { createGetExperimentResultTool } from '../../tools/get-experiment-result.js';
import type { Tool } from '../../tools/tool.js';
import type { AiMessage } from '../../providers/provider.js';
import { NotFoundError } from '../../../lib/errors.js';

const inputSchema = z.object({
  /** O canal escolhido pelo fundador. Um post de X não é um post de LinkedIn. */
  providerIdentifier: z.string().min(1).max(64),
  /** Opcional: a ação pode existir sem experimento (spec §2, decisão 3). */
  experimentId: z.string().uuid().optional(),
  /** O que o fundador quer dizer, quando ele já sabe. */
  brief: z.string().min(1).max(2000).optional(),
});
type Input = z.infer<typeof inputSchema>;

/**
 * `channelId` e `providerIdentifier` não estão aqui: o canal vem do formulário.
 * Um modelo que escolhe o canal é o modelo escolhendo onde publicar.
 */
const filledSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    payload: z.object({ content: z.string().min(1).max(5000).optional() }).strict().optional(),
  })
  .strict();

export type SocialPostFilled = z.infer<typeof filledSchema>;
export type ProposeSocialPostOutput = FillOutput<SocialPostFilled>;

const FILLS: readonly string[] = ['name', 'payload.content'];

const SYSTEM = fillSystemPrompt({
  role: 'You are a growth copywriter for AUREA.',
  mission: 'Draft one social post the founder can publish, for the channel they picked.',
  toolRule:
    'Call get_learnings first, and get_experiment_result when it is available. They are your only sources. Never restate a claim a learning already ruled out.',
  fills: FILLS,
  extra: [
    'payload.content: the post itself, ready to publish, in the language of the business context. Write for the channel named in the request — length, tone and formatting differ per channel.',
    'Never invent a number. If no tool returned a figure, write the post without one, and ask for it as a question instead.',
    'name: a short internal label for the founder to recognize this action in a list. It is not a headline and is never published.',
    'The founder publishes this under their own brand: no hype, no fake urgency, no claim the tools did not support.',
  ],
});

export const proposeSocialPostAgent: AgentDefinition<Input, ProposeSocialPostOutput> = {
  taskType: 'propose-social-post',
  agentType: 'copywriter',
  tier: 'TIER2',
  // Uma leitura de aprendizados, uma do experimento, um texto curto. O teto de
  // saída sai do próprio schema (ai/runner/output-budget.ts).
  budget: { maxToolIterations: 4, maxModelCalls: 5, maxOutputTokens: 3072 },
  requiresSearch: false,
  inputSchema,
  outputSchema: buildFillOutputSchema(filledSchema, FILLS) as unknown as ZodType<ProposeSocialPostOutput>,

  buildTools(input: Input): readonly Tool<never>[] {
    const tools: Tool<never>[] = [createGetLearningsTool() as unknown as Tool<never>];
    // Sem experimento não há resultado a ler, e uma tool que não pode responder
    // gasta iteração do run.
    if (input.experimentId) {
      tools.push(createGetExperimentResultTool(input.experimentId) as unknown as Tool<never>);
    }
    return tools;
  },

  buildMessages(input: Input, _ctx: AgentContext): AiMessage[] {
    const ask = [`Write a post for the ${input.providerIdentifier} channel.`];
    if (input.brief) ask.push(`What the founder wants to say: ${input.brief}`);
    if (!input.experimentId) {
      // Dizer isso explicitamente evita o modelo inventar um experimento para
      // justificar o texto.
      ask.push('This post is not tied to an experiment.');
    }
    return [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: ask.join('\n') },
    ];
  },

  async precheck(input, { prisma, tenant }) {
    if (!input.experimentId) return;
    // Um experimento de outro workspace lê como ausente, e recusar aqui é
    // recusar antes de cobrar o crédito.
    const experiment = await prisma.experiment.findFirst({
      where: { id: input.experimentId, workspaceId: tenant.workspaceId },
      select: { id: true },
    });
    if (!experiment) throw new NotFoundError('Experiment not found');
  },
};
```

- [ ] **Step 4: Registre o agente**

Em `src/ai/agents/registry.ts`, o import junto dos outros de `fill/`:

```ts
import { proposeSocialPostAgent } from './fill/propose-social-post.js';
```

E a entrada no `AGENT_REGISTRY`, depois de `proposeMetricBindingAgent`:

```ts
  [proposeSocialPostAgent.taskType]: proposeSocialPostAgent as AgentDefinition,
```

- [ ] **Step 5: Rode os testes de agentes**

Run: `pnpm vitest run src/ai/agents`
Expected: PASS, incluindo `registry-coverage.test.ts` — se ele exigir algo por agente (tier, budget, cobertura de taskType), atenda o que ele pede sem afrouxar o teste.

- [ ] **Step 6: Typecheck e suíte**

Run: `pnpm typecheck && pnpm test`
Expected: tsc exit 0; suíte verde.

- [ ] **Step 7: Stage e reporte**

```bash
git add src/ai/agents
git status --short
git diff --cached --stat
```

**Não rode `git commit`.**

---

> **Tasks 8 a 10 rodam em `../web`.** Todo comando desta parte é executado com o cwd em `web/`, não em `back/`. Rodar `pnpm test` de `back/` roda a suíte do backend e não diz nada sobre o frontend — já custou isso uma vez.

---

## Task 8: Contrato regenerado e o card do Postiz

**Files:**
- Modify (gerado): `web/src/api/generated/**` via `pnpm api:generate`
- Create: `web/src/components/integrations/PostizSourceCard.tsx`
- Create: `web/src/components/integrations/PostizSourceCard.test.tsx`
- Modify: `web/src/pages/IntegrationsPage.tsx`
- Modify: `web/src/i18n/locales/pt.json`, `en.json`, `es.json`

**Interfaces:**
- Consumes: `api.json` já contendo `putPostizIntegration`, `listPostizChannels`, `listIntegrations`, `removeIntegration`.
- Produces: hooks `usePutPostizIntegration`, `useListPostizChannels` em `@/api/generated/hooks/integrationsHooks/`; componente `PostizSourceCard`.

- [ ] **Step 1: Regenere o cliente**

Run (cwd `web/`): `pnpm api:generate && pnpm typecheck`
Expected: `src/api/generated/hooks/integrationsHooks/usePutPostizIntegration.ts` e `useListPostizChannels.ts` existem; tsc exit 0.

Nota: `src/api/generated/` é gitignored — não tente `git add` nesse diretório. O que entra no commit é `api.json` (já staged pelo backend) e o código escrito à mão.

- [ ] **Step 2: Escreva o teste do card**

Crie `web/src/components/integrations/PostizSourceCard.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/render';
import { stubFetch, type StubFetchCall } from '@/test/stub-fetch';
import { PostizSourceCard } from './PostizSourceCard';

const CONNECTED = {
  id: 'int-postiz',
  provider: 'POSTIZ',
  authKind: 'API_KEY',
  externalId: null,
  accountLabel: 'postiz.acme.com',
  status: 'OK',
  lastCheckedAt: '2026-08-04T12:00:00.000Z',
  lastError: null,
  createdAt: '2026-08-04T10:00:00.000Z',
};

afterEach(() => vi.unstubAllGlobals());

describe('PostizSourceCard', () => {
  it('mostra o formulário quando nada está conectado', async () => {
    stubFetch({ '/integrations': { body: { integrations: [] } } });

    renderWithProviders(<PostizSourceCard />);

    expect(await screen.findByLabelText(i18n.t('pages.integrations.postiz.apiKeyLabel'))).toBeInTheDocument();
  });

  /**
   * O aviso mais importante da tela: autorizar Instagram/X/LinkedIn acontece
   * DENTRO do Postiz (spec §3.1). Sem este texto o fundador procura em AUREA um
   * botão que não existe e conclui que o produto está quebrado.
   */
  it('diz que as contas sociais são conectadas dentro do Postiz', async () => {
    stubFetch({ '/integrations': { body: { integrations: [] } } });

    renderWithProviders(<PostizSourceCard />);

    expect(await screen.findByText(i18n.t('pages.integrations.postiz.accountsElsewhere'))).toBeInTheDocument();
  });

  it('envia a chave e a base url', async () => {
    const calls: StubFetchCall[] = [];
    stubFetch(
      {
        // Três respostas: a leitura inicial, a que o invalidateQueries dispara
        // depois do PUT, e uma sobra. Sem a terceira, o refetch consumiria a
        // resposta do PUT e o render estouraria.
        '/integrations': [
          { body: { integrations: [] } },
          { body: { integrations: [CONNECTED] } },
          { body: { integrations: [CONNECTED] } },
        ],
        '/integrations/postiz': { body: { integration: CONNECTED } },
      },
      calls,
    );

    renderWithProviders(<PostizSourceCard />);

    await userEvent.type(
      await screen.findByLabelText(i18n.t('pages.integrations.postiz.apiKeyLabel')),
      'pos_abc',
    );
    await userEvent.type(
      screen.getByLabelText(i18n.t('pages.integrations.postiz.baseUrlLabel')),
      'https://postiz.acme.com',
    );
    await userEvent.click(screen.getByRole('button', { name: i18n.t('pages.integrations.connect') }));

    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
        apiKey: 'pos_abc',
        baseUrl: 'https://postiz.acme.com',
      }),
    );
  });

  it('mostra o host e os canais quando está conectado', async () => {
    stubFetch({
      '/integrations': { body: { integrations: [CONNECTED] } },
      '/integrations/postiz/channels': {
        body: {
          channels: [
            { id: 'chan-1', name: 'AUREA no Instagram', providerIdentifier: 'instagram', picture: null },
          ],
        },
      },
    });

    renderWithProviders(<PostizSourceCard />);

    expect(await screen.findByText('postiz.acme.com')).toBeInTheDocument();
    expect(await screen.findByText('AUREA no Instagram')).toBeInTheDocument();
  });

  // Conectado e sem canal nenhum é estado real: o Postiz está de pé e o fundador
  // ainda não autorizou nenhuma rede lá dentro.
  it('diz o que fazer quando não há canal nenhum', async () => {
    stubFetch({
      '/integrations': { body: { integrations: [CONNECTED] } },
      '/integrations/postiz/channels': { body: { channels: [] } },
    });

    renderWithProviders(<PostizSourceCard />);

    expect(await screen.findByText(i18n.t('pages.integrations.postiz.noChannels'))).toBeInTheDocument();
  });

  it('mostra o último erro guardado da conexão', async () => {
    stubFetch({
      '/integrations': {
        body: { integrations: [{ ...CONNECTED, status: 'FAILED', lastError: 'connect ECONNREFUSED' }] },
      },
      '/integrations/postiz/channels': { status: 502, body: { error: { code: 'AUR-T0043' } } },
    });

    renderWithProviders(<PostizSourceCard />);

    expect(await screen.findByText('connect ECONNREFUSED')).toBeInTheDocument();
  });

  it('desconecta', async () => {
    const calls: StubFetchCall[] = [];
    stubFetch(
      {
        '/integrations': [
          { body: { integrations: [CONNECTED] } },
          { body: { integrations: [] } },
          { body: { integrations: [] } },
        ],
        '/integrations/postiz/channels': { body: { channels: [] } },
        '/integrations/POSTIZ': { body: { ok: true } },
      },
      calls,
    );

    renderWithProviders(<PostizSourceCard />);

    await userEvent.click(await screen.findByRole('button', { name: i18n.t('pages.integrations.disconnect') }));

    await waitFor(() => expect(calls.some((call) => call.method === 'DELETE')).toBe(true));
  });

  // A chave sai da tela assim que a gravação passa: um campo que continua com
  // ela é o segredo exposto por tempo indefinido.
  it('limpa o campo da chave depois de conectar', async () => {
    stubFetch({
      '/integrations': [
        { body: { integrations: [] } },
        { body: { integrations: [CONNECTED] } },
        { body: { integrations: [CONNECTED] } },
      ],
      '/integrations/postiz': { body: { integration: CONNECTED } },
      '/integrations/postiz/channels': { body: { channels: [] } },
    });

    renderWithProviders(<PostizSourceCard />);

    const key = await screen.findByLabelText(i18n.t('pages.integrations.postiz.apiKeyLabel'));
    await userEvent.type(key, 'pos_abc');
    await userEvent.type(
      screen.getByLabelText(i18n.t('pages.integrations.postiz.baseUrlLabel')),
      'https://postiz.acme.com',
    );
    await userEvent.click(screen.getByRole('button', { name: i18n.t('pages.integrations.connect') }));

    await waitFor(() => expect(screen.queryByDisplayValue('pos_abc')).not.toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Rode e confirme a falha**

Run (cwd `web/`): `pnpm vitest run src/components/integrations/PostizSourceCard.test.tsx`
Expected: FAIL — o módulo não existe.

- [ ] **Step 4: Adicione as chaves de i18n**

Em `src/i18n/locales/pt.json`, dentro de `pages.integrations`, um objeto `postiz`:

```json
"postiz": {
  "title": "Postiz",
  "helpTitle": "O que é o Postiz",
  "help": "O Postiz é a ferramenta que publica nas redes. AUREA decide o que publicar e quando; o Postiz executa.",
  "apiKeyLabel": "Chave da API",
  "apiKeyHelpTitle": "Onde achar a chave",
  "apiKeyHelp": "No seu Postiz: Settings → Developers → Public API.",
  "baseUrlLabel": "Endereço da sua instância",
  "baseUrlHelpTitle": "Qual endereço",
  "baseUrlHelp": "A raiz do seu Postiz, por exemplo https://postiz.suaempresa.com — sem /public/v1 no fim.",
  "accountsElsewhere": "Instagram, X, LinkedIn e as outras contas são conectadas dentro do próprio Postiz. AUREA só escolhe entre os canais que já estão lá.",
  "openPostiz": "Abrir meu Postiz",
  "channels": "Canais disponíveis",
  "noChannels": "Nenhum canal ainda. Conecte uma rede social dentro do Postiz e ela aparece aqui.",
  "channelsFailed": "Não foi possível ler os canais agora."
}
```

`en.json`:

```json
"postiz": {
  "title": "Postiz",
  "helpTitle": "What Postiz is",
  "help": "Postiz is the tool that publishes to social channels. AUREA decides what to publish and when; Postiz carries it out.",
  "apiKeyLabel": "API key",
  "apiKeyHelpTitle": "Where to find the key",
  "apiKeyHelp": "In your Postiz: Settings → Developers → Public API.",
  "baseUrlLabel": "Your instance address",
  "baseUrlHelpTitle": "Which address",
  "baseUrlHelp": "The root of your Postiz, e.g. https://postiz.yourcompany.com — without /public/v1 at the end.",
  "accountsElsewhere": "Instagram, X, LinkedIn and the other accounts are connected inside Postiz itself. AUREA only picks from the channels already there.",
  "openPostiz": "Open my Postiz",
  "channels": "Available channels",
  "noChannels": "No channels yet. Connect a social account inside Postiz and it shows up here.",
  "channelsFailed": "Could not read the channels right now."
}
```

`es.json`:

```json
"postiz": {
  "title": "Postiz",
  "helpTitle": "Qué es Postiz",
  "help": "Postiz es la herramienta que publica en las redes. AUREA decide qué publicar y cuándo; Postiz lo ejecuta.",
  "apiKeyLabel": "Clave de la API",
  "apiKeyHelpTitle": "Dónde encontrar la clave",
  "apiKeyHelp": "En tu Postiz: Settings → Developers → Public API.",
  "baseUrlLabel": "Dirección de tu instancia",
  "baseUrlHelpTitle": "Qué dirección",
  "baseUrlHelp": "La raíz de tu Postiz, por ejemplo https://postiz.tuempresa.com — sin /public/v1 al final.",
  "accountsElsewhere": "Instagram, X, LinkedIn y las demás cuentas se conectan dentro de Postiz. AUREA solo elige entre los canales que ya están allí.",
  "openPostiz": "Abrir mi Postiz",
  "channels": "Canales disponibles",
  "noChannels": "Aún no hay canales. Conecta una red social dentro de Postiz y aparecerá aquí.",
  "channelsFailed": "No se pudieron leer los canales ahora."
}
```

- [ ] **Step 5: Escreva `PostizSourceCard.tsx`**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListIntegrations,
  listIntegrationsQueryKey,
} from '@/api/generated/hooks/integrationsHooks/useListIntegrations';
import { usePutPostizIntegration } from '@/api/generated/hooks/integrationsHooks/usePutPostizIntegration';
import { useListPostizChannels } from '@/api/generated/hooks/integrationsHooks/useListPostizChannels';
import { useRemoveIntegration } from '@/api/generated/hooks/integrationsHooks/useRemoveIntegration';
import { apiErrorMessage } from '@/lib/api-errors';
import { Help } from '@/components/Help';
import { SectionLoading } from '@/components/SectionState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TextField } from '@/components/form/TextField';

const PROVIDER = 'POSTIZ';

/**
 * A conexão com o Postiz: uma chave, um endereço, e a lista de canais que ele
 * já tem.
 *
 * O aviso de `accountsElsewhere` é a peça que não pode sair: autorizar
 * Instagram, X ou LinkedIn acontece dentro do Postiz, não aqui (spec §3.1). Sem
 * dizer isso, o fundador procura em AUREA um botão que não existe.
 */
export function PostizSourceCard() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [error, setError] = useState<string | null>(null);

  const integrations = useListIntegrations();
  const connected = integrations.data?.integrations.find((row) => row.provider === PROVIDER) ?? null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: listIntegrationsQueryKey() });

  // A lista de canais só é buscada quando há conexão: sem ela a rota responde
  // AUR-T0041, e um erro previsível não é informação.
  const channels = useListPostizChannels({ query: { enabled: connected !== null } });

  const connect = usePutPostizIntegration({
    mutation: {
      onMutate: () => setError(null),
      onSuccess: async () => {
        // A chave sai da tela assim que a gravação passa: um campo que continua
        // com ela é o segredo exposto por tempo indefinido.
        setApiKey('');
        setBaseUrl('');
        await invalidate();
      },
      onError: (err) => setError(apiErrorMessage(err, t('pages.integrations.connectFailed'))),
    },
  });

  const disconnect = useRemoveIntegration({
    mutation: {
      onMutate: () => setError(null),
      onSuccess: () => invalidate(),
      onError: (err) => setError(apiErrorMessage(err, t('pages.integrations.connectFailed'))),
    },
  });

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <p className="text-sm font-medium">
          {t('pages.integrations.postiz.title')}
          <Help title={t('pages.integrations.postiz.helpTitle')}>{t('pages.integrations.postiz.help')}</Help>
        </p>

        <p className="rounded-md border border-border/70 bg-muted/30 p-3 text-xs text-muted-foreground">
          {t('pages.integrations.postiz.accountsElsewhere')}
        </p>

        {integrations.isLoading && <SectionLoading />}

        {integrations.data && !connected && (
          <div className="space-y-4">
            <TextField
              htmlFor="postiz-api-key"
              label={t('pages.integrations.postiz.apiKeyLabel')}
              helpTitle={t('pages.integrations.postiz.apiKeyHelpTitle')}
              help={t('pages.integrations.postiz.apiKeyHelp')}
              value={apiKey}
              onChange={setApiKey}
            />
            <TextField
              htmlFor="postiz-base-url"
              label={t('pages.integrations.postiz.baseUrlLabel')}
              helpTitle={t('pages.integrations.postiz.baseUrlHelpTitle')}
              help={t('pages.integrations.postiz.baseUrlHelp')}
              value={baseUrl}
              onChange={setBaseUrl}
            />
            <Button
              size="sm"
              disabled={connect.isPending || apiKey.trim() === '' || baseUrl.trim() === ''}
              onClick={() => connect.mutate({ data: { apiKey: apiKey.trim(), baseUrl: baseUrl.trim() } })}
            >
              {connect.isPending ? t('pages.integrations.connecting') : t('pages.integrations.connect')}
            </Button>
          </div>
        )}

        {connected && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant="muted">{t(`pages.integrations.status.${connected.status}`)}</Badge>
              <span className="text-sm text-muted-foreground">{connected.accountLabel}</span>
            </div>

            {/* O erro guardado, e não uma chamada ao Postiz por render: a tela
                de conexão não pode custar uma ida ao provider a cada visita. */}
            {connected.lastError && <p className="text-sm text-destructive">{connected.lastError}</p>}

            <div>
              <p className="text-sm font-medium">{t('pages.integrations.postiz.channels')}</p>
              {channels.isLoading && <SectionLoading />}
              {channels.isError && (
                <p className="text-sm text-muted-foreground">{t('pages.integrations.postiz.channelsFailed')}</p>
              )}
              {channels.data?.channels.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('pages.integrations.postiz.noChannels')}</p>
              )}
              <ul className="mt-1 space-y-1">
                {channels.data?.channels.map((channel) => (
                  <li key={channel.id} className="text-sm text-muted-foreground">
                    {channel.name} <span className="font-mono text-xs">({channel.providerIdentifier})</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-t pt-3">
              <Button
                size="sm"
                variant="outline"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate({ params: { provider: PROVIDER } })}
              >
                {t('pages.integrations.disconnect')}
              </Button>
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
```

Se o `useRemoveIntegration` gerado usar outra forma de parâmetro que não `{ params: { provider } }`, siga a assinatura gerada — `Ga4SourceCard.tsx` mostra a forma real em uso.

- [ ] **Step 6: Monte o card na página**

Em `web/src/pages/IntegrationsPage.tsx`, importe e renderize depois do `Ga4SourceCard`, com espaçamento entre os dois:

```tsx
import { PostizSourceCard } from '@/components/integrations/PostizSourceCard';
```

```tsx
      <div className="space-y-4">
        <Ga4SourceCard />
        <PostizSourceCard />
      </div>
```

- [ ] **Step 7: Rode os testes de integrações**

Run (cwd `web/`): `pnpm vitest run src/components/integrations`
Expected: PASS, incluindo os testes existentes do GA4.

- [ ] **Step 8: Typecheck e suíte inteira do web**

Run (cwd `web/`): `pnpm typecheck && pnpm test`
Expected: tsc exit 0; suíte verde, incluindo o teste de paridade de chaves dos três locales.

- [ ] **Step 9: Stage e reporte**

```bash
cd ../web && git add src/components/integrations src/pages/IntegrationsPage.tsx src/i18n/locales api.json
git status --short
git diff --cached --stat
```

**Não rode `git commit`.**

---

## Task 9: A lista de ações e a criação com IA

**Files:**
- Create: `web/src/components/actions/ActionStatusBadge.tsx` + `.test.tsx`
- Create: `web/src/schemas/social-post.ts`
- Create: `web/src/pages/ActionsPage.tsx` + `.test.tsx`
- Create: `web/src/pages/ActionNewPage.tsx` + `.test.tsx`
- Modify: `web/src/App.tsx`, `web/src/components/AppLayout.tsx`
- Modify: `web/src/i18n/locales/pt.json`, `en.json`, `es.json`

**Interfaces:**
- Consumes: hooks `useListActions`, `useCreateAction`, `useListPostizChannels`, `useListIntegrations`, `useListExperiments`; `useFillRun` de `@/components/ai/useFillRun`.
- Produces: `ActionStatusBadge({ status })`, `proposeSocialPostOutput` (Zod) de `@/schemas/social-post`, `ActionsPage`, `ActionNewPage`, rota `/app/actions` e `/app/actions/new`, entrada `actions` no nav.

- [ ] **Step 1: Escreva os testes**

Crie `web/src/components/actions/ActionStatusBadge.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/render';
import { ActionStatusBadge } from './ActionStatusBadge';

describe('ActionStatusBadge', () => {
  it('mostra a cópia do estado', () => {
    renderWithProviders(<ActionStatusBadge status="PENDING_APPROVAL" />);

    expect(screen.getByText(i18n.t('pages.actions.status.PENDING_APPROVAL'))).toBeInTheDocument();
  });

  /**
   * A tela nunca diz "publicado": o que sabemos é que o Postiz recebeu (spec
   * §3.4). Este teste é a trava dessa regra na cópia.
   */
  it('não afirma publicação em EXECUTED', () => {
    renderWithProviders(<ActionStatusBadge status="EXECUTED" />);

    const label = i18n.t('pages.actions.status.EXECUTED');
    expect(label.toLowerCase()).not.toContain('publish');
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('tem cópia para os oito estados', () => {
    const statuses = [
      'PROPOSED',
      'PENDING_APPROVAL',
      'APPROVED',
      'EXECUTING',
      'EXECUTED',
      'FAILED',
      'CANCELLED',
      'DELIVERY_UNKNOWN',
    ] as const;

    for (const status of statuses) {
      const key = `pages.actions.status.${status}`;
      // `t` devolve a própria chave quando ela não existe: é assim que um
      // estado sem cópia aparece na tela como "pages.actions.status.X".
      expect(i18n.t(key)).not.toBe(key);
    }
  });
});
```

Crie `web/src/pages/ActionsPage.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/render';
import { stubFetch } from '@/test/stub-fetch';
import { ActionsPage } from './ActionsPage';

const ACTION = {
  id: '33333333-3333-3333-3333-333333333333',
  experimentId: null,
  type: 'SOCIAL_POST',
  name: 'Post sobre custo operacional',
  description: null,
  payload: {
    channelId: 'chan-1',
    channelName: 'AUREA no Instagram',
    providerIdentifier: 'instagram',
    content: 'Texto do post.',
  },
  status: 'PENDING_APPROVAL',
  createdBy: 'u1',
  approvedAt: null,
  executedAt: null,
  attempts: 0,
  lastError: null,
  failureKind: null,
  createdAt: '2026-08-04T10:00:00.000Z',
  updatedAt: '2026-08-04T10:00:00.000Z',
};

afterEach(() => vi.unstubAllGlobals());

describe('ActionsPage', () => {
  it('lista as ações com estado e canal', async () => {
    stubFetch({ '/actions': { body: { actions: [ACTION] } } });

    renderWithProviders(<ActionsPage />);

    expect(await screen.findByText('Post sobre custo operacional')).toBeInTheDocument();
    expect(screen.getByText('AUREA no Instagram')).toBeInTheDocument();
    expect(screen.getByText(i18n.t('pages.actions.status.PENDING_APPROVAL'))).toBeInTheDocument();
  });

  it('mostra o vazio com o caminho para criar', async () => {
    stubFetch({ '/actions': { body: { actions: [] } } });

    renderWithProviders(<ActionsPage />);

    expect(await screen.findByText(i18n.t('pages.actions.empty'))).toBeInTheDocument();
  });

  it('filtra por estado', async () => {
    stubFetch({ '/actions': { body: { actions: [ACTION] } } });

    renderWithProviders(<ActionsPage />);
    await screen.findByText('Post sobre custo operacional');

    await userEvent.click(screen.getByRole('button', { name: i18n.t('pages.actions.filter.PENDING_APPROVAL') }));

    // O filtro vira query string: a lista é do servidor, não filtrada no cliente
    // — uma lista longa filtrada no cliente esconde o que não veio na página.
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('status=PENDING_APPROVAL'))).toBe(true);
  });

  it('mostra o erro de leitura em vez de uma lista vazia falsa', async () => {
    stubFetch({ '/actions': { status: 500, body: { error: { code: 'AUR-T0007' } } } });

    renderWithProviders(<ActionsPage />);

    expect(await screen.findByText(i18n.t('common.loadFailed'))).toBeInTheDocument();
  });
});
```

Nota: use a chave de falha de carregamento que o repositório já tem (`common.loadFailed` ou o texto que `SectionLoadError` renderiza). Confira em `src/components/SectionState.tsx` antes de escrever a asserção — não invente chave nova para isto.

Crie `web/src/pages/ActionNewPage.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/render';
import { stubFetch, type StubFetchCall } from '@/test/stub-fetch';
import { ActionNewPage } from './ActionNewPage';

const CONNECTED = {
  id: 'int-postiz',
  provider: 'POSTIZ',
  authKind: 'API_KEY',
  externalId: null,
  accountLabel: 'postiz.acme.com',
  status: 'OK',
  lastCheckedAt: '2026-08-04T12:00:00.000Z',
  lastError: null,
  createdAt: '2026-08-04T10:00:00.000Z',
};

const CHANNELS = {
  channels: [{ id: 'chan-1', name: 'AUREA no Instagram', providerIdentifier: 'instagram', picture: null }],
};

const base = () => ({
  '/integrations': { body: { integrations: [CONNECTED] } },
  '/integrations/postiz/channels': { body: CHANNELS },
  '/experiments': { body: { experiments: [] } },
  '/agent-runs': { body: { runs: [] } },
});

afterEach(() => vi.unstubAllGlobals());

describe('ActionNewPage', () => {
  it('cria a ação com o canal escolhido e o texto escrito', async () => {
    const calls: StubFetchCall[] = [];
    stubFetch({ ...base(), '/actions': { status: 201, body: { action: { id: 'a1' } } } }, calls);

    renderWithProviders(<ActionNewPage />);

    await userEvent.type(
      await screen.findByLabelText(i18n.t('pages.actions.form.nameLabel')),
      'Post sobre custo',
    );
    await userEvent.click(screen.getByRole('button', { name: /AUREA no Instagram/ }));
    await userEvent.click(screen.getByLabelText(i18n.t('pages.actions.form.contentLabel')));
    await userEvent.paste('Texto do post.');
    await userEvent.click(screen.getByRole('button', { name: i18n.t('pages.actions.form.create') }));

    await waitFor(() =>
      expect(calls.find((call) => call.method === 'POST' && call.path === '/actions')?.body).toMatchObject({
        type: 'SOCIAL_POST',
        name: 'Post sobre custo',
        payload: { channelId: 'chan-1', content: 'Texto do post.' },
      }),
    );
  });

  /**
   * Sem Postiz conectado o formulário não finge: criar responderia AUR-T0041, e
   * deixar o fundador escrever um post para descobrir isso no fim é desperdício
   * do trabalho dele.
   */
  it('sem Postiz conectado, mostra o caminho para conectar em vez do formulário', async () => {
    stubFetch({ ...base(), '/integrations': { body: { integrations: [] } } });

    renderWithProviders(<ActionNewPage />);

    expect(await screen.findByText(i18n.t('pages.actions.form.needsPostiz'))).toBeInTheDocument();
    expect(screen.queryByLabelText(i18n.t('pages.actions.form.contentLabel'))).not.toBeInTheDocument();
  });

  it('não cria sem canal escolhido', async () => {
    stubFetch(base());

    renderWithProviders(<ActionNewPage />);

    await userEvent.type(await screen.findByLabelText(i18n.t('pages.actions.form.nameLabel')), 'Post');
    expect(screen.getByRole('button', { name: i18n.t('pages.actions.form.create') })).toBeDisabled();
  });

  it('não cria sem texto', async () => {
    stubFetch(base());

    renderWithProviders(<ActionNewPage />);

    await userEvent.click(await screen.findByRole('button', { name: /AUREA no Instagram/ }));
    await userEvent.type(screen.getByLabelText(i18n.t('pages.actions.form.nameLabel')), 'Post');
    expect(screen.getByRole('button', { name: i18n.t('pages.actions.form.create') })).toBeDisabled();
  });

  // O botão de IA existe em todo formulário do produto, e aqui ele manda o canal
  // escolhido: um post de X não é um post de LinkedIn.
  it('dispara o agente com o canal escolhido', async () => {
    const calls: StubFetchCall[] = [];
    stubFetch({ ...base(), '/agent-runs': [{ body: { runs: [] } }, { body: { id: 'run-1' } }] }, calls);

    renderWithProviders(<ActionNewPage />);

    await userEvent.click(await screen.findByRole('button', { name: /AUREA no Instagram/ }));
    await userEvent.click(screen.getByRole('button', { name: i18n.t('pages.actions.form.generate') }));

    await waitFor(() =>
      expect(calls.find((call) => call.method === 'POST' && call.path === '/agent-runs')?.body).toMatchObject({
        taskType: 'propose-social-post',
        input: { providerIdentifier: 'instagram' },
      }),
    );
  });
});
```

- [ ] **Step 2: Rode e confirme a falha**

Run (cwd `web/`): `pnpm vitest run src/pages/ActionsPage.test.tsx src/pages/ActionNewPage.test.tsx src/components/actions`
Expected: FAIL — os módulos não existem.

- [ ] **Step 3: Adicione as chaves de i18n**

Em `pt.json`, `pages.actions`:

```json
"actions": {
  "title": "Ações",
  "helpTitle": "O que é uma ação",
  "help": "Uma ação é algo que AUREA vai executar por você — hoje, publicar um post. Toda ação passa por aprovação humana antes de sair.",
  "subtitle": "O que AUREA vai fazer, e o que já fez.",
  "empty": "Nenhuma ação ainda. Crie a primeira e ela aparece aqui.",
  "new": "Nova ação",
  "channel": "Canal",
  "status": {
    "PROPOSED": "Rascunho",
    "PENDING_APPROVAL": "Aguardando aprovação",
    "APPROVED": "Aprovada",
    "EXECUTING": "Enviando",
    "EXECUTED": "Entregue ao Postiz",
    "FAILED": "Falhou",
    "CANCELLED": "Cancelada",
    "DELIVERY_UNKNOWN": "Entrega incerta"
  },
  "filter": {
    "all": "Todas",
    "PROPOSED": "Rascunhos",
    "PENDING_APPROVAL": "Aguardando aprovação",
    "APPROVED": "Aprovadas",
    "EXECUTED": "Entregues",
    "FAILED": "Falhas",
    "DELIVERY_UNKNOWN": "Entrega incerta"
  },
  "form": {
    "nameLabel": "Nome interno",
    "nameHelpTitle": "Para que serve o nome",
    "nameHelp": "É como você reconhece esta ação numa lista. Não é o título do post e não vai publicado.",
    "channelLabel": "Canal",
    "channelHelpTitle": "De onde vêm os canais",
    "channelHelp": "São as contas que você já conectou dentro do Postiz.",
    "contentLabel": "Texto do post",
    "briefLabel": "O que você quer dizer (opcional)",
    "experimentLabel": "Experimento (opcional)",
    "experimentHelpTitle": "Por que ligar a um experimento",
    "experimentHelp": "Ligar a ação a um experimento é o que permite comparar o que você fez com o que foi medido depois.",
    "noExperiment": "Sem experimento",
    "generate": "Escrever com IA",
    "create": "Criar rascunho",
    "creating": "Criando…",
    "needsPostiz": "Conecte o Postiz antes de criar uma ação: sem ele não há para onde publicar.",
    "goToIntegrations": "Ir para integrações",
    "createFailed": "Não foi possível criar a ação."
  }
}
```

`en.json` — mesmas chaves, com atenção à cópia de `EXECUTED`, que **não** pode dizer "published":

```json
"actions": {
  "title": "Actions",
  "helpTitle": "What an action is",
  "help": "An action is something AUREA will carry out for you — today, publishing a post. Every action goes through human approval before it leaves.",
  "subtitle": "What AUREA is about to do, and what it has done.",
  "empty": "No actions yet. Create the first one and it shows up here.",
  "new": "New action",
  "channel": "Channel",
  "status": {
    "PROPOSED": "Draft",
    "PENDING_APPROVAL": "Waiting for approval",
    "APPROVED": "Approved",
    "EXECUTING": "Sending",
    "EXECUTED": "Handed to Postiz",
    "FAILED": "Failed",
    "CANCELLED": "Cancelled",
    "DELIVERY_UNKNOWN": "Delivery unknown"
  },
  "filter": {
    "all": "All",
    "PROPOSED": "Drafts",
    "PENDING_APPROVAL": "Waiting for approval",
    "APPROVED": "Approved",
    "EXECUTED": "Handed over",
    "FAILED": "Failures",
    "DELIVERY_UNKNOWN": "Delivery unknown"
  },
  "form": {
    "nameLabel": "Internal name",
    "nameHelpTitle": "What the name is for",
    "nameHelp": "It is how you recognize this action in a list. It is not the post's headline and is never published.",
    "channelLabel": "Channel",
    "channelHelpTitle": "Where the channels come from",
    "channelHelp": "These are the accounts you already connected inside Postiz.",
    "contentLabel": "Post text",
    "briefLabel": "What you want to say (optional)",
    "experimentLabel": "Experiment (optional)",
    "experimentHelpTitle": "Why tie it to an experiment",
    "experimentHelp": "Tying the action to an experiment is what lets you compare what you did with what was measured afterwards.",
    "noExperiment": "No experiment",
    "generate": "Write with AI",
    "create": "Create draft",
    "creating": "Creating…",
    "needsPostiz": "Connect Postiz before creating an action: without it there is nowhere to publish.",
    "goToIntegrations": "Go to integrations",
    "createFailed": "Could not create the action."
  }
}
```

`es.json` — mesmas chaves, com `"EXECUTED": "Entregado a Postiz"`, `"DELIVERY_UNKNOWN": "Entrega incierta"`, e as demais traduzidas na mesma linha. Toda chave presente nos três arquivos: o teste de paridade não passa com menos.

- [ ] **Step 4: Escreva `ActionStatusBadge.tsx`**

```tsx
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

/**
 * A cópia de `EXECUTED` diz "entregue ao Postiz", não "publicado" — o `state`
 * que o Postiz devolve na criação é `QUEUE`, e virar `PUBLISHED` acontece depois,
 * lá dentro (spec §3.4). A tela não afirma o que ninguém confirmou.
 */
export function ActionStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  // DELIVERY_UNKNOWN e FAILED pedem atenção; o resto é neutro. A distinção é de
  // ênfase, não de cor semântica inventada.
  const variant = status === 'FAILED' || status === 'DELIVERY_UNKNOWN' ? 'destructive' : 'muted';

  return <Badge variant={variant}>{t(`pages.actions.status.${status}`)}</Badge>;
}
```

Se `badge.tsx` não tiver a variante `destructive`, use a que existir para ênfase de erro — confira `src/components/ui/badge.tsx` em vez de inventar.

- [ ] **Step 5: Escreva `schemas/social-post.ts`**

```ts
import { z } from 'zod';

/**
 * O que o agente `propose-social-post` devolve, validado no cliente antes de
 * tocar no formulário.
 *
 * Sem `.default()` em nada: um run que voltou sem `filled` não é um run que
 * propôs texto vazio, e preencher o campo com string vazia apagaria o que o
 * fundador já tinha escrito.
 */
export const proposeSocialPostOutput = z.object({
  filled: z.object({
    name: z.string().optional(),
    payload: z.object({ content: z.string().optional() }).optional(),
  }),
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
});

export type ProposeSocialPostOutput = z.infer<typeof proposeSocialPostOutput>;
```

- [ ] **Step 6: Escreva `ActionsPage.tsx`**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useListActions } from '@/api/generated/hooks/actionsHooks/useListActions';
import { PageHeader } from '@/components/PageHeader';
import { Help } from '@/components/Help';
import { SectionLoading, SectionLoadError } from '@/components/SectionState';
import { ActionStatusBadge } from '@/components/actions/ActionStatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

const FILTERS = ['all', 'PROPOSED', 'PENDING_APPROVAL', 'APPROVED', 'EXECUTED', 'FAILED', 'DELIVERY_UNKNOWN'] as const;

export function ActionsPage() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');

  // O filtro vai para o servidor, e não é aplicado no cliente: filtrar uma
  // página no cliente esconde o que não veio nela.
  const actions = useListActions(filter === 'all' ? {} : { status: filter });

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t('app.nav.actions')}
        title={t('pages.actions.title')}
        help={<Help title={t('pages.actions.helpTitle')}>{t('pages.actions.help')}</Help>}
        subtitle={t('pages.actions.subtitle')}
        action={
          <Button asChild size="sm">
            <Link to="/app/actions/new">{t('pages.actions.new')}</Link>
          </Button>
        }
      />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((option) => (
          <Button
            key={option}
            size="sm"
            variant={filter === option ? 'default' : 'outline'}
            onClick={() => setFilter(option)}
          >
            {t(`pages.actions.filter.${option}`)}
          </Button>
        ))}
      </div>

      {actions.isLoading && <SectionLoading />}
      {actions.isError && <SectionLoadError refetch={[actions.refetch]} />}

      {actions.data?.actions.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('pages.actions.empty')}</p>
      )}

      <ul className="space-y-3">
        {actions.data?.actions.map((action) => (
          <li key={action.id}>
            <Card>
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <Link to={`/app/actions/${action.id}`} className="text-sm font-medium hover:underline">
                    {action.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">{action.payload.channelName}</p>
                </div>
                <ActionStatusBadge status={action.status} />
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

Se `PageHeader` não aceitar `action`, ponha o botão logo abaixo do header em vez de inventar prop — confira `src/components/PageHeader.tsx`.

- [ ] **Step 7: Escreva `ActionNewPage.tsx`**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useCreateAction } from '@/api/generated/hooks/actionsHooks/useCreateAction';
import { useListIntegrations } from '@/api/generated/hooks/integrationsHooks/useListIntegrations';
import { useListPostizChannels } from '@/api/generated/hooks/integrationsHooks/useListPostizChannels';
import { useListExperiments } from '@/api/generated/hooks/experimentsHooks/useListExperiments';
import { useFillRun } from '@/components/ai/useFillRun';
import { apiErrorMessage } from '@/lib/api-errors';
import { proposeSocialPostOutput } from '@/schemas/social-post';
import { PageHeader } from '@/components/PageHeader';
import { Help } from '@/components/Help';
import { SectionLoading } from '@/components/SectionState';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TextField } from '@/components/form/TextField';
import { TextAreaField } from '@/components/form/TextAreaField';
import { SelectField } from '@/components/form/SelectField';

const TASK_TYPE = 'propose-social-post';
const PROVIDER = 'POSTIZ';

export function ActionNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [channelId, setChannelId] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [brief, setBrief] = useState('');
  const [experimentId, setExperimentId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const integrations = useListIntegrations();
  const connected = integrations.data?.integrations.some((row) => row.provider === PROVIDER) ?? false;

  const channels = useListPostizChannels({ query: { enabled: connected } });
  const experiments = useListExperiments({});

  const channel = channels.data?.channels.find((candidate) => candidate.id === channelId) ?? null;

  /**
   * O agente recebe o canal, porque o formato do texto depende dele. Sem canal
   * escolhido não há o que pedir — `input: null` deixa `start()` inerte, que é o
   * comportamento do hook.
   */
  const run = useFillRun({
    taskType: TASK_TYPE,
    input: channel
      ? {
          providerIdentifier: channel.providerIdentifier,
          ...(experimentId ? { experimentId } : {}),
          ...(brief.trim() ? { brief: brief.trim() } : {}),
        }
      : null,
    startFailedMessage: t('ai.fill.failed'),
  });

  const proposal = run.state === 'done' ? proposeSocialPostOutput.safeParse(run.output) : null;

  const create = useCreateAction({
    mutation: {
      onMutate: () => setError(null),
      onSuccess: (data) => navigate(`/app/actions/${data.action.id}`),
      onError: (err) => setError(apiErrorMessage(err, t('pages.actions.form.createFailed'))),
    },
  });

  if (integrations.isLoading) return <SectionLoading />;

  // Sem Postiz não há para onde publicar. Deixar o fundador escrever um post
  // inteiro para descobrir isso no fim é desperdiçar o trabalho dele.
  if (!connected) {
    return (
      <div className="space-y-4">
        <PageHeader eyebrow={t('app.nav.actions')} title={t('pages.actions.new')} />
        <Card>
          <CardContent className="space-y-3 p-5">
            <p className="text-sm">{t('pages.actions.form.needsPostiz')}</p>
            <Button asChild size="sm">
              <Link to="/app/settings/integrations">{t('pages.actions.form.goToIntegrations')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const ready = name.trim() !== '' && content.trim() !== '' && channel !== null;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t('app.nav.actions')}
        title={t('pages.actions.new')}
        help={<Help title={t('pages.actions.helpTitle')}>{t('pages.actions.help')}</Help>}
      />

      <Card>
        <CardContent className="space-y-4 p-5">
          <TextField
            htmlFor="action-name"
            label={t('pages.actions.form.nameLabel')}
            helpTitle={t('pages.actions.form.nameHelpTitle')}
            help={t('pages.actions.form.nameHelp')}
            value={name}
            onChange={setName}
          />

          <div>
            <p className="text-sm font-medium">
              {t('pages.actions.form.channelLabel')}
              <Help title={t('pages.actions.form.channelHelpTitle')}>{t('pages.actions.form.channelHelp')}</Help>
            </p>
            {channels.isLoading && <SectionLoading />}
            <div className="mt-2 flex flex-wrap gap-2">
              {channels.data?.channels.map((candidate) => (
                <Button
                  key={candidate.id}
                  size="sm"
                  variant={candidate.id === channelId ? 'default' : 'outline'}
                  onClick={() => setChannelId(candidate.id)}
                >
                  {candidate.name}
                </Button>
              ))}
            </div>
          </div>

          <SelectField
            htmlFor="action-experiment"
            label={t('pages.actions.form.experimentLabel')}
            helpTitle={t('pages.actions.form.experimentHelpTitle')}
            help={t('pages.actions.form.experimentHelp')}
            value={experimentId}
            onChange={setExperimentId}
            options={[
              { value: '', label: t('pages.actions.form.noExperiment') },
              ...(experiments.data?.experiments ?? []).map((item) => ({ value: item.id, label: item.name })),
            ]}
          />

          <TextAreaField
            htmlFor="action-brief"
            label={t('pages.actions.form.briefLabel')}
            value={brief}
            onChange={setBrief}
          />

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={channel === null || run.isStarting || run.state === 'running'}
              onClick={() => run.start()}
            >
              {t('pages.actions.form.generate')}
            </Button>
            {run.error && <span className="text-sm text-destructive">{run.error}</span>}
          </div>

          {/* A proposta preenche o campo; ela não cria nada. Confirmar é humano. */}
          {proposal?.success && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (proposal.data.filled.name) setName(proposal.data.filled.name);
                if (proposal.data.filled.payload?.content) setContent(proposal.data.filled.payload.content);
              }}
            >
              {t('ai.fill.apply')}
            </Button>
          )}

          <TextAreaField
            htmlFor="action-content"
            label={t('pages.actions.form.contentLabel')}
            value={content}
            onChange={setContent}
          />

          <Button
            size="sm"
            disabled={!ready || create.isPending}
            onClick={() => {
              if (!channel) return;
              create.mutate({
                data: {
                  type: 'SOCIAL_POST',
                  name: name.trim(),
                  ...(experimentId ? { experimentId } : {}),
                  payload: {
                    channelId: channel.id,
                    channelName: channel.name,
                    providerIdentifier: channel.providerIdentifier,
                    content,
                  },
                },
              });
            }}
          >
            {create.isPending ? t('pages.actions.form.creating') : t('pages.actions.form.create')}
          </Button>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
```

Ajuste `SelectField` e `useListExperiments` às assinaturas reais (`src/components/form/SelectField.tsx`, e o hook gerado) em vez de forçar as usadas aqui. Se `ai.fill.apply` não existir como chave, use a que os outros cards de IA já usam.

- [ ] **Step 8: Registre a rota e o item de nav**

Em `web/src/App.tsx`, junto dos outros lazy:

```tsx
const ActionsPage = lazy(() => import('./pages/ActionsPage').then((m) => ({ default: m.ActionsPage })));
const ActionNewPage = lazy(() => import('./pages/ActionNewPage').then((m) => ({ default: m.ActionNewPage })));
```

E as rotas, depois das de experimentos:

```tsx
      <Route path="/app/actions" element={<Protected><ActionsPage /></Protected>} />
      <Route path="/app/actions/new" element={<Protected><ActionNewPage /></Protected>} />
```

Em `web/src/components/AppLayout.tsx`, no array `nav` (o primário, **não** `secondaryNav`), entre `experiments` e `learnings` — é etapa do loop, não configuração:

```tsx
  // Entre experimento e aprendizado, porque é onde ela fica no loop: o
  // experimento diz o que testar, a ação é o que sai para o mundo.
  { to: '/app/actions', key: 'actions', icon: Send, end: false },
```

Importe `Send` de `lucide-react` junto dos outros ícones, e adicione `app.nav.actions` aos três locales ("Ações" / "Actions" / "Acciones").

- [ ] **Step 9: Rode os testes**

Run (cwd `web/`): `pnpm vitest run src/pages/ActionsPage.test.tsx src/pages/ActionNewPage.test.tsx src/components/actions`
Expected: PASS.

- [ ] **Step 10: Typecheck e suíte**

Run (cwd `web/`): `pnpm typecheck && pnpm test`
Expected: tsc exit 0; suíte verde. Se `App.test.tsx` verificar as rotas, atualize-o.

- [ ] **Step 11: Stage e reporte**

```bash
cd ../web && git add src/pages src/components/actions src/schemas src/App.tsx src/components/AppLayout.tsx src/i18n/locales
git status --short
git diff --cached --stat
```

**Não rode `git commit`.**

---

## Task 10: O detalhe da ação — aprovar, executar, resolver

A última peça, e a que carrega a cópia mais delicada do produto.

**Files:**
- Create: `web/src/components/actions/ActionApprovalPanel.tsx` + `.test.tsx`
- Create: `web/src/components/actions/ActionDeliveryPanel.tsx` + `.test.tsx`
- Create: `web/src/pages/ActionDetailPage.tsx` + `.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/i18n/locales/pt.json`, `en.json`, `es.json`

**Interfaces:**
- Consumes: hooks `useGetAction`, `useSubmitAction`, `useApproveAction`, `useRejectAction`, `useCancelAction`, `useExecuteAction`, `useResolveAction`; `ActionStatusBadge` (Task 9).
- Produces: `ActionApprovalPanel({ action, approvals, onChanged })`, `ActionDeliveryPanel({ action, onChanged })`, `ActionDetailPage`, rota `/app/actions/:id`.

- [ ] **Step 1: Escreva o teste do detalhe**

Crie `web/src/pages/ActionDetailPage.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/render';
import { stubFetch, type StubFetchCall } from '@/test/stub-fetch';
import { ActionDetailPage } from './ActionDetailPage';

const ACTION_ID = '33333333-3333-3333-3333-333333333333';

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useParams: () => ({ id: ACTION_ID }) };
});

const action = (over: Record<string, unknown> = {}) => ({
  id: ACTION_ID,
  experimentId: null,
  type: 'SOCIAL_POST',
  name: 'Post sobre custo operacional',
  description: null,
  payload: {
    channelId: 'chan-1',
    channelName: 'AUREA no Instagram',
    providerIdentifier: 'instagram',
    content: 'Texto do post.',
  },
  status: 'PROPOSED',
  createdBy: 'u1',
  approvedAt: null,
  executedAt: null,
  attempts: 0,
  lastError: null,
  failureKind: null,
  createdAt: '2026-08-04T10:00:00.000Z',
  updatedAt: '2026-08-04T10:00:00.000Z',
  ...over,
});

const detail = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  action: action(over),
  approvals: [],
  delivery: null,
  ...extra,
});

const url = `/actions/${ACTION_ID}`;

afterEach(() => vi.unstubAllGlobals());

describe('ActionDetailPage', () => {
  it('mostra o texto, o canal e o estado', async () => {
    stubFetch({ [url]: { body: detail() } });

    renderWithProviders(<ActionDetailPage />);

    expect(await screen.findByText('Texto do post.')).toBeInTheDocument();
    expect(screen.getByText('AUREA no Instagram')).toBeInTheDocument();
    expect(screen.getByText(i18n.t('pages.actions.status.PROPOSED'))).toBeInTheDocument();
  });

  it('submete um rascunho', async () => {
    const calls: StubFetchCall[] = [];
    stubFetch(
      {
        // Três: a leitura inicial, o refetch do invalidateQueries, e a sobra.
        // Sem a terceira, o refetch consumiria a resposta do POST.
        [url]: [{ body: detail() }, { body: detail({ status: 'PENDING_APPROVAL' }) }, { body: detail({ status: 'PENDING_APPROVAL' }) }],
        [`${url}/submit`]: { body: { action: action({ status: 'PENDING_APPROVAL' }) } },
      },
      calls,
    );

    renderWithProviders(<ActionDetailPage />);

    await userEvent.click(await screen.findByRole('button', { name: i18n.t('pages.actions.detail.submit') }));

    await waitFor(() => expect(calls.some((call) => call.path === `${url}/submit`)).toBe(true));
  });

  it('aprova o que está aguardando', async () => {
    const calls: StubFetchCall[] = [];
    stubFetch(
      {
        [url]: [
          { body: detail({ status: 'PENDING_APPROVAL' }) },
          { body: detail({ status: 'APPROVED' }) },
          { body: detail({ status: 'APPROVED' }) },
        ],
        [`${url}/approve`]: { body: { action: action({ status: 'APPROVED' }) } },
      },
      calls,
    );

    renderWithProviders(<ActionDetailPage />);

    await userEvent.click(await screen.findByRole('button', { name: i18n.t('pages.actions.detail.approve') }));

    await waitFor(() => expect(calls.some((call) => call.path === `${url}/approve`)).toBe(true));
  });

  // Rejeitar sem motivo devolve o trabalho ao autor sem dizer o que corrigir: o
  // botão fica indisponível até haver comentário.
  it('não deixa rejeitar sem comentário', async () => {
    stubFetch({ [url]: { body: detail({ status: 'PENDING_APPROVAL' }) } });

    renderWithProviders(<ActionDetailPage />);

    expect(await screen.findByRole('button', { name: i18n.t('pages.actions.detail.reject') })).toBeDisabled();
  });

  it('rejeita com o comentário escrito', async () => {
    const calls: StubFetchCall[] = [];
    stubFetch(
      {
        [url]: [
          { body: detail({ status: 'PENDING_APPROVAL' }) },
          { body: detail() },
          { body: detail() },
        ],
        [`${url}/reject`]: { body: { action: action() } },
      },
      calls,
    );

    renderWithProviders(<ActionDetailPage />);

    await userEvent.type(
      await screen.findByLabelText(i18n.t('pages.actions.detail.commentLabel')),
      'Trocar o número.',
    );
    await userEvent.click(screen.getByRole('button', { name: i18n.t('pages.actions.detail.reject') }));

    await waitFor(() =>
      expect(calls.find((call) => call.path === `${url}/reject`)?.body).toEqual({ comment: 'Trocar o número.' }),
    );
  });

  it('executa o que está aprovado', async () => {
    const calls: StubFetchCall[] = [];
    stubFetch(
      {
        [url]: [
          { body: detail({ status: 'APPROVED' }) },
          { body: detail({ status: 'EXECUTING' }) },
          { body: detail({ status: 'EXECUTING' }) },
        ],
        [`${url}/execute`]: { status: 202, body: { action: action({ status: 'EXECUTING' }) } },
      },
      calls,
    );

    renderWithProviders(<ActionDetailPage />);

    await userEvent.click(await screen.findByRole('button', { name: i18n.t('pages.actions.detail.execute') }));

    await waitFor(() => expect(calls.some((call) => call.path === `${url}/execute`)).toBe(true));
  });

  // Aprovar e executar são atos distintos, e a tela não os junta: em APPROVED não
  // existe botão de aprovar, e em PENDING_APPROVAL não existe botão de executar.
  it('não oferece executar antes da aprovação', async () => {
    stubFetch({ [url]: { body: detail({ status: 'PENDING_APPROVAL' }) } });

    renderWithProviders(<ActionDetailPage />);

    await screen.findByRole('button', { name: i18n.t('pages.actions.detail.approve') });
    expect(screen.queryByRole('button', { name: i18n.t('pages.actions.detail.execute') })).not.toBeInTheDocument();
  });

  it('mostra o id do post entregue, e não a palavra publicado', async () => {
    stubFetch({
      [url]: {
        body: detail(
          { status: 'EXECUTED', executedAt: '2026-08-04T11:00:00.000Z' },
          { delivery: { externalId: 'post_1', state: 'QUEUE', deliveredAt: '2026-08-04T11:00:00.000Z' } },
        ),
      },
    });

    renderWithProviders(<ActionDetailPage />);

    expect(await screen.findByText('post_1')).toBeInTheDocument();
    // O state cru do provider ao lado: é o que sabemos, sem tradução que
    // afirme mais do que ele diz.
    expect(screen.getByText('QUEUE')).toBeInTheDocument();
  });

  it('mostra o histórico de aprovação com o comentário', async () => {
    stubFetch({
      [url]: {
        body: detail(
          {},
          {
            approvals: [
              {
                id: 'ap-1',
                requestedBy: 'u1',
                reviewedBy: 'u2',
                status: 'REJECTED',
                comment: 'Trocar o número.',
                requestedAt: '2026-08-04T10:30:00.000Z',
                reviewedAt: '2026-08-04T10:40:00.000Z',
              },
            ],
          },
        ),
      },
    });

    renderWithProviders(<ActionDetailPage />);

    expect(await screen.findByText('Trocar o número.')).toBeInTheDocument();
  });

  it('mostra a falha com a mensagem da fonte e oferece tentar de novo', async () => {
    stubFetch({
      [url]: { body: detail({ status: 'FAILED', failureKind: 'VALIDATION', lastError: 'Missing subreddit' }) },
    });

    renderWithProviders(<ActionDetailPage />);

    expect(await screen.findByText('Missing subreddit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: i18n.t('pages.actions.detail.execute') })).toBeInTheDocument();
  });
});
```

Crie `web/src/components/actions/ActionDeliveryPanel.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/render';
import { stubFetch, type StubFetchCall } from '@/test/stub-fetch';
import { ActionDeliveryPanel } from './ActionDeliveryPanel';

const ACTION_ID = '33333333-3333-3333-3333-333333333333';

const UNKNOWN = {
  id: ACTION_ID,
  status: 'DELIVERY_UNKNOWN',
  payload: {
    channelId: 'chan-1',
    channelName: 'AUREA no Instagram',
    providerIdentifier: 'instagram',
    content: 'Texto.',
  },
  lastError: 'fetch failed',
  updatedAt: '2026-08-04T11:00:00.000Z',
};

afterEach(() => vi.unstubAllGlobals());

describe('ActionDeliveryPanel', () => {
  /**
   * A cópia mais importante da tela inteira. O painel manda conferir o canal
   * ANTES de oferecer qualquer botão: republicar às cegas duplica um post
   * público, e é isso que o oitavo estado existe para impedir (spec §7.3).
   */
  it('manda conferir o canal, com nome e horário da tentativa', async () => {
    stubFetch({});

    renderWithProviders(<ActionDeliveryPanel action={UNKNOWN as never} onChanged={vi.fn()} />);

    expect(screen.getByText(i18n.t('pages.actions.delivery.checkFirst'))).toBeInTheDocument();
    expect(screen.getByText(/AUREA no Instagram/)).toBeInTheDocument();
  });

  it('confirma que publicou, com o id opcional', async () => {
    const calls: StubFetchCall[] = [];
    stubFetch({ [`/actions/${ACTION_ID}/resolve`]: { body: { action: { ...UNKNOWN, status: 'EXECUTED' } } } }, calls);

    renderWithProviders(<ActionDeliveryPanel action={UNKNOWN as never} onChanged={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(i18n.t('pages.actions.delivery.externalIdLabel')), 'post_1');
    await userEvent.click(screen.getByRole('button', { name: i18n.t('pages.actions.delivery.published') }));

    await waitFor(() =>
      expect(calls[0]?.body).toEqual({ outcome: 'PUBLISHED', externalId: 'post_1' }),
    );
  });

  // Sem id o pedido não manda a chave: um externalId vazio seria proveniência
  // inventada de um post real.
  it('confirma que publicou sem id', async () => {
    const calls: StubFetchCall[] = [];
    stubFetch({ [`/actions/${ACTION_ID}/resolve`]: { body: { action: { ...UNKNOWN, status: 'EXECUTED' } } } }, calls);

    renderWithProviders(<ActionDeliveryPanel action={UNKNOWN as never} onChanged={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: i18n.t('pages.actions.delivery.published') }));

    await waitFor(() => expect(calls[0]?.body).toEqual({ outcome: 'PUBLISHED' }));
  });

  it('confirma que não publicou', async () => {
    const calls: StubFetchCall[] = [];
    stubFetch({ [`/actions/${ACTION_ID}/resolve`]: { body: { action: { ...UNKNOWN, status: 'APPROVED' } } } }, calls);

    renderWithProviders(<ActionDeliveryPanel action={UNKNOWN as never} onChanged={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: i18n.t('pages.actions.delivery.notPublished') }));

    await waitFor(() => expect(calls[0]?.body).toEqual({ outcome: 'NOT_PUBLISHED' }));
  });
});
```

- [ ] **Step 2: Rode e confirme a falha**

Run (cwd `web/`): `pnpm vitest run src/pages/ActionDetailPage.test.tsx src/components/actions/ActionDeliveryPanel.test.tsx`
Expected: FAIL — os módulos não existem.

- [ ] **Step 3: Adicione as chaves de i18n**

Em `pt.json`, dentro de `pages.actions`:

```json
"detail": {
  "content": "Texto do post",
  "submit": "Enviar para aprovação",
  "approve": "Aprovar",
  "reject": "Rejeitar",
  "commentLabel": "Motivo da rejeição",
  "execute": "Publicar agora",
  "executing": "Enviando ao Postiz…",
  "cancel": "Cancelar ação",
  "history": "Histórico de aprovação",
  "requestedBy": "Pedido por",
  "reviewedBy": "Decidido por",
  "deliveredId": "Id do post no Postiz",
  "providerState": "Estado no Postiz",
  "attempts": "Tentativas",
  "actionFailed": "Não foi possível concluir a ação."
},
"delivery": {
  "title": "Entrega incerta",
  "checkFirst": "A conexão caiu no meio do envio, então não sabemos se o post saiu. Confira o canal antes de decidir — publicar de novo criaria um post duplicado.",
  "attemptedAt": "Tentativa em",
  "externalIdLabel": "Id do post (se você conseguir copiar)",
  "published": "Já publicou — marcar como entregue",
  "notPublished": "Não publicou — liberar para tentar de novo"
}
```

`en.json`:

```json
"detail": {
  "content": "Post text",
  "submit": "Send for approval",
  "approve": "Approve",
  "reject": "Reject",
  "commentLabel": "Reason for rejection",
  "execute": "Publish now",
  "executing": "Sending to Postiz…",
  "cancel": "Cancel action",
  "history": "Approval history",
  "requestedBy": "Requested by",
  "reviewedBy": "Decided by",
  "deliveredId": "Post id in Postiz",
  "providerState": "State in Postiz",
  "attempts": "Attempts",
  "actionFailed": "Could not complete the action."
},
"delivery": {
  "title": "Delivery unknown",
  "checkFirst": "The connection dropped mid-send, so we do not know whether the post went out. Check the channel before deciding — publishing again would create a duplicate post.",
  "attemptedAt": "Attempted at",
  "externalIdLabel": "Post id (if you can copy it)",
  "published": "It did publish — mark as delivered",
  "notPublished": "It did not publish — release it to try again"
}
```

`es.json`: as mesmas chaves traduzidas, com `"title": "Entrega incierta"` e o texto de `checkFirst` mantendo o aviso do post duplicado.

- [ ] **Step 4: Escreva `ActionDeliveryPanel.tsx`**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useResolveAction } from '@/api/generated/hooks/actionsHooks/useResolveAction';
import { apiErrorMessage } from '@/lib/api-errors';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TextField } from '@/components/form/TextField';

type ActionLike = {
  id: string;
  payload: { channelName: string };
  lastError: string | null;
  updatedAt: string | Date;
};

/**
 * A saída do oitavo estado, e a cópia mais delicada do produto.
 *
 * O aviso vem **antes** dos botões, e nomeia o canal e o horário: o fundador tem
 * de olhar o Instagram dele antes de decidir. Um botão neutro de "tentar de
 * novo" aqui produziria um segundo post público (spec §7.3).
 */
export function ActionDeliveryPanel({ action, onChanged }: { action: ActionLike; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const [externalId, setExternalId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const resolve = useResolveAction({
    mutation: {
      onMutate: () => setError(null),
      onSuccess: () => onChanged(),
      onError: (err) => setError(apiErrorMessage(err, t('pages.actions.detail.actionFailed'))),
    },
  });

  const attemptedAt = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(action.updatedAt));

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <p className="text-sm font-medium">{t('pages.actions.delivery.title')}</p>
        <p className="text-sm">{t('pages.actions.delivery.checkFirst')}</p>
        <p className="text-xs text-muted-foreground">
          {action.payload.channelName} · {t('pages.actions.delivery.attemptedAt')} {attemptedAt}
        </p>
        {action.lastError && <p className="text-xs text-muted-foreground">{action.lastError}</p>}

        <TextField
          htmlFor="delivery-external-id"
          label={t('pages.actions.delivery.externalIdLabel')}
          value={externalId}
          onChange={setExternalId}
        />

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={resolve.isPending}
            onClick={() =>
              resolve.mutate({
                params: { id: action.id },
                // Sem id, a chave não vai: um externalId vazio seria
                // proveniência inventada de um post real.
                data: {
                  outcome: 'PUBLISHED',
                  ...(externalId.trim() ? { externalId: externalId.trim() } : {}),
                },
              })
            }
          >
            {t('pages.actions.delivery.published')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate({ params: { id: action.id }, data: { outcome: 'NOT_PUBLISHED' } })}
          >
            {t('pages.actions.delivery.notPublished')}
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
```

Ajuste a forma dos argumentos de `useResolveAction` à assinatura gerada (`{ params, data }` é a forma usada pelos hooks com params + body neste repositório; confira o arquivo gerado).

- [ ] **Step 5: Escreva `ActionApprovalPanel.tsx`**

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSubmitAction } from '@/api/generated/hooks/actionsHooks/useSubmitAction';
import { useApproveAction } from '@/api/generated/hooks/actionsHooks/useApproveAction';
import { useRejectAction } from '@/api/generated/hooks/actionsHooks/useRejectAction';
import { apiErrorMessage } from '@/lib/api-errors';
import { Button } from '@/components/ui/button';
import { TextAreaField } from '@/components/form/TextAreaField';

type ActionLike = { id: string; status: string };

type ApprovalLike = {
  id: string;
  requestedBy: string;
  reviewedBy: string | null;
  status: string;
  comment: string | null;
  requestedAt: string | Date;
  reviewedAt: string | Date | null;
};

/**
 * O ciclo humano: submeter, aprovar, rejeitar.
 *
 * Os botões aparecem por estado, e nunca dois atos no mesmo lugar: aprovar em
 * `PROPOSED` não existe, e submeter em `PENDING_APPROVAL` também não. É a
 * mesma regra do backend, dita na tela.
 */
export function ActionApprovalPanel({
  action,
  approvals,
  onChanged,
}: {
  action: ActionLike;
  approvals: ApprovalLike[];
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onError = (err: unknown) => setError(apiErrorMessage(err, t('pages.actions.detail.actionFailed')));
  const mutation = { onMutate: () => setError(null), onSuccess: () => onChanged(), onError };

  const submit = useSubmitAction({ mutation });
  const approve = useApproveAction({ mutation });
  const reject = useRejectAction({ mutation });

  return (
    <div className="space-y-3">
      {action.status === 'PROPOSED' && (
        <Button size="sm" disabled={submit.isPending} onClick={() => submit.mutate({ params: { id: action.id } })}>
          {t('pages.actions.detail.submit')}
        </Button>
      )}

      {action.status === 'PENDING_APPROVAL' && (
        <div className="space-y-3">
          <Button
            size="sm"
            disabled={approve.isPending}
            onClick={() => approve.mutate({ params: { id: action.id } })}
          >
            {t('pages.actions.detail.approve')}
          </Button>
          <TextAreaField
            htmlFor="action-reject-comment"
            label={t('pages.actions.detail.commentLabel')}
            value={comment}
            onChange={setComment}
          />
          {/* Indisponível sem comentário: rejeitar sem motivo devolve o trabalho
              ao autor sem dizer o que corrigir. */}
          <Button
            size="sm"
            variant="outline"
            disabled={reject.isPending || comment.trim() === ''}
            onClick={() => reject.mutate({ params: { id: action.id }, data: { comment: comment.trim() } })}
          >
            {t('pages.actions.detail.reject')}
          </Button>
        </div>
      )}

      {approvals.length > 0 && (
        <div>
          <p className="text-sm font-medium">{t('pages.actions.detail.history')}</p>
          <ul className="mt-1 space-y-2">
            {approvals.map((approval) => (
              <li key={approval.id} className="text-xs text-muted-foreground">
                <span className="font-medium">{t(`pages.actions.approval.${approval.status}`)}</span>{' '}
                — {t('pages.actions.detail.requestedBy')} {approval.requestedBy}
                {approval.reviewedBy && `, ${t('pages.actions.detail.reviewedBy')} ${approval.reviewedBy}`}
                {approval.comment && <p className="mt-1 text-foreground">{approval.comment}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
```

Adicione `pages.actions.approval.{PENDING,APPROVED,REJECTED}` aos três locales ("Aguardando" / "Aprovado" / "Rejeitado", e equivalentes).

- [ ] **Step 6: Escreva `ActionDetailPage.tsx`**

> O nome da chave de query gerada varia com o operationId: confira o topo de `src/api/generated/hooks/actionsHooks/useGetAction.ts` e use o export que existir (`getActionQueryKey` é o padrão do Kubb neste repositório — `useListIntegrations` exporta `listIntegrationsQueryKey`). Não invente o nome.

```tsx
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useGetAction, getActionQueryKey } from '@/api/generated/hooks/actionsHooks/useGetAction';
import { useExecuteAction } from '@/api/generated/hooks/actionsHooks/useExecuteAction';
import { useCancelAction } from '@/api/generated/hooks/actionsHooks/useCancelAction';
import { apiErrorMessage } from '@/lib/api-errors';
import { PageHeader } from '@/components/PageHeader';
import { Help } from '@/components/Help';
import { SectionLoading, SectionLoadError } from '@/components/SectionState';
import { ActionStatusBadge } from '@/components/actions/ActionStatusBadge';
import { ActionApprovalPanel } from '@/components/actions/ActionApprovalPanel';
import { ActionDeliveryPanel } from '@/components/actions/ActionDeliveryPanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

/** Os estados de onde uma execução pode partir, iguais aos do backend. */
const EXECUTABLE = ['APPROVED', 'FAILED'];

export function ActionDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const action = useGetAction(id ?? '', {
    query: {
      enabled: Boolean(id),
      // Enquanto está em voo, a tela pesquisa: quem publica é o worker, e a
      // resposta de `execute` é 202, não o desfecho.
      refetchInterval: (query) => (query.state.data?.action.status === 'EXECUTING' ? 5000 : false),
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: getActionQueryKey(id ?? '') });

  const onError = (err: unknown) => setError(apiErrorMessage(err, t('pages.actions.detail.actionFailed')));
  const execute = useExecuteAction({
    mutation: { onMutate: () => setError(null), onSuccess: () => refresh(), onError },
  });
  const cancel = useCancelAction({
    mutation: { onMutate: () => setError(null), onSuccess: () => refresh(), onError },
  });

  if (action.isLoading) return <SectionLoading />;
  if (action.isError || !action.data) return <SectionLoadError refetch={[action.refetch]} />;

  const current = action.data.action;
  const delivery = action.data.delivery;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={t('app.nav.actions')}
        title={current.name}
        help={<Help title={t('pages.actions.helpTitle')}>{t('pages.actions.help')}</Help>}
      />

      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <ActionStatusBadge status={current.status} />
            <span className="text-xs text-muted-foreground">{current.payload.channelName}</span>
            {current.attempts > 0 && (
              <span className="text-xs text-muted-foreground">
                {t('pages.actions.detail.attempts')}: {current.attempts}
              </span>
            )}
          </div>

          <div>
            <p className="text-sm font-medium">{t('pages.actions.detail.content')}</p>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{current.payload.content}</p>
          </div>

          {/* A mensagem da fonte, literal: "Missing subreddit" diz o que fazer,
              "falha ao publicar" não diz nada. */}
          {current.lastError && current.status !== 'DELIVERY_UNKNOWN' && (
            <p className="text-sm text-destructive">{current.lastError}</p>
          )}

          {delivery && (
            <div className="space-y-1 border-t pt-3">
              <p className="text-xs text-muted-foreground">
                {t('pages.actions.detail.deliveredId')}: <span className="font-mono">{delivery.externalId}</span>
              </p>
              {/* O state cru do provider. Nenhuma tradução nossa afirma mais do
                  que ele diz. */}
              {delivery.state && (
                <p className="text-xs text-muted-foreground">
                  {t('pages.actions.detail.providerState')}: <span className="font-mono">{delivery.state}</span>
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {current.status === 'DELIVERY_UNKNOWN' && (
        <ActionDeliveryPanel action={current} onChanged={refresh} />
      )}

      <Card>
        <CardContent className="space-y-3 p-5">
          <ActionApprovalPanel action={current} approvals={action.data.approvals} onChanged={refresh} />

          {EXECUTABLE.includes(current.status) && (
            <Button
              size="sm"
              disabled={execute.isPending}
              onClick={() => execute.mutate({ params: { id: current.id } })}
            >
              {t('pages.actions.detail.execute')}
            </Button>
          )}

          {current.status === 'EXECUTING' && (
            <p className="text-sm text-muted-foreground">{t('pages.actions.detail.executing')}</p>
          )}

          {['PROPOSED', 'PENDING_APPROVAL', 'APPROVED', 'FAILED'].includes(current.status) && (
            <Button
              size="sm"
              variant="outline"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate({ params: { id: current.id } })}
            >
              {t('pages.actions.detail.cancel')}
            </Button>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 7: Registre a rota**

Em `web/src/App.tsx`:

```tsx
const ActionDetailPage = lazy(() =>
  import('./pages/ActionDetailPage').then((m) => ({ default: m.ActionDetailPage })),
);
```

```tsx
      <Route path="/app/actions/:id" element={<Protected><ActionDetailPage /></Protected>} />
```

Declare-a **depois** de `/app/actions/new`, para `new` não cair no `:id`.

- [ ] **Step 8: Rode os testes**

Run (cwd `web/`): `pnpm vitest run src/pages/ActionDetailPage.test.tsx src/components/actions`
Expected: PASS.

- [ ] **Step 9: Typecheck e suíte inteira**

Run (cwd `web/`): `pnpm typecheck && pnpm test`
Expected: tsc exit 0; suíte verde, incluindo a paridade dos três locales.

- [ ] **Step 10: Confira a regra de cópia nos três idiomas**

Run (cwd `web/`): `grep -in "publicad\|published\|publiziert" src/i18n/locales/*.json | grep -i "EXECUTED"`
Expected: nenhuma linha. A cópia de `EXECUTED` diz "entregue ao Postiz" / "handed to Postiz" / "entregado a Postiz". Se aparecer alguma, corrija a cópia — não o grep.

- [ ] **Step 11: Stage e reporte**

```bash
cd ../web && git add src/pages src/components/actions src/App.tsx src/i18n/locales
git status --short
git diff --cached --stat
```

**Não rode `git commit`.**

---

## Verificação final (depois da Task 10)

Rodar de `back/`:

```bash
pnpm typecheck && pnpm test
pnpm prisma migrate status
grep -rn "createPostizClient\|enqueueActionExecution" src --include=*.test.ts
grep -rn "apiKey" src --include=*.ts | grep -v "test\|postiz-client\|postiz-credential\|put-postiz"
```

Esperado: tsc 0; suíte verde; 17 migrações e "Database schema is up to date"; nenhum teste usando o cliente real ou a fila real; `apiKey` aparecendo só onde a credencial é montada, aberta ou recebida — nunca num presenter, schema de resposta ou log.

Rodar de `web/`:

```bash
pnpm typecheck && pnpm test
grep -rn "fetch(" src --include=*.tsx | grep -v test
```

Esperado: tsc 0; suíte verde; nenhum `fetch` cru em componente.
