# Publicação multicanal via Upload-Post — plano de implementação

> **Para executores:** use `superpowers:subagent-driven-development` ou
> `superpowers:executing-plans`. Passos usam checkbox (`- [ ]`).

**Spec:** `docs/superpowers/specs/2026-08-05-upload-post-multicanal-design.md` —
**é a fonte**. Onde este plano e o spec divergirem, o spec ganha e o plano está
errado. Cite a seção (`§8.1`) ao decidir.

**Goal:** o cliente conecta as redes dele com um clique dentro da AUREA e publica
um post em várias de uma vez, com desfecho por rede.

**Arquitetura:** conector isolado (`src/integrations/social/upload-post/`) com
seis funções; `Action` + `ActionTarget` no Growth Brain; execução em fila BullMQ
com dois tipos de job (`execute` e `poll`); status da Action derivado dos alvos
por função pura.

**Stack:** Node 22, Fastify 5, TypeScript strict ESM, Zod 3, Prisma 6, BullMQ 5,
Vitest · web: Vite, React 19, Tailwind + shadcn/ui, Kubb + React Query, i18next.

## Global Constraints

Valem para **toda** task. Copiadas do spec §14 e das regras do projeto.

- **`back/` e `web/` são dois repositórios git independentes.** Nunca
  `git add ../web/...` de dentro de `back`. Commits separados, um por repo.
- **Commit exige aprovação explícita.** Cada task termina em `git add` +
  `git status` + diff resumido; **não rode `git commit` sem o "ok" do humano.**
- **NUNCA rode `prisma migrate dev` nem `migrate reset`.** Escreva
  `migration.sql` à mão e aplique com `pnpm prisma:deploy`. Drift ⇒ pare e
  reporte.
- **Isolamento de tenant absoluto:** `workspaceId` sempre de `req.tenant`, nunca
  de body/query/params. Id de outro workspace lê como **404**, nunca 403.
- **O `user` (profile) de toda chamada ao provider vem do
  `WorkspaceIntegration` lido por `workspaceId`.** Nunca do payload do job além
  dos ids. É o invariante do spec §5.1.
- **Nenhum teste toca a rede nem o Redis.** Cliente e fila entram por **opção de
  plugin** (`{ social? }`, `{ enqueue? }`, `{ createClient? }`), nunca por
  decorator ambiente.
- **O segredo nunca sai numa resposta.** Nenhuma rota devolve `ciphertext`,
  `iv`, `authTag` nem a API key.
- **Nada publica sem aprovação humana explícita**, em ato separado da criação.
- **Falha de rede nunca retenta** no caminho de publicação. `NETWORK`/`UNKNOWN` →
  `DELIVERY_UNKNOWN`. (O **poll** é `GET` e pode retentar sempre — ler nunca
  publica.)
- **`PUBLISHED` só é escrito a partir do poll**, com `post_id` da fonte, ou por
  ato humano explícito. Nunca da resposta do `POST`.
- **Nenhum código gera, infere ou assume `baselineValue`, `targetValue`,
  `startDate` ou `endDate`.**
- **Nenhuma cópia afirma publicação sem `postUrl`/`externalId` da fonte.**
- `operationId` + `response` obrigatórios em toda rota.
- Toda mensagem de erro nova entra nos três locales (`pt-BR`, `en-US`, `es-ES`).
- Web: Tailwind + shadcn/ui, nunca CSS puro. Todo termo de domínio explicável
  pelo `Help`.
- `pnpm typecheck` limpo e `pnpm test` verde ao fim de cada task.

## Estrutura de arquivos

**Criados (back):**

```
src/integrations/social/upload-post/upload-post-client.ts        conector, 6 funções
src/integrations/social/upload-post/upload-post-client.test.ts
src/integrations/social/upload-post/platforms.ts                 enum ↔ slug
src/integrations/social/upload-post/platforms.test.ts
src/http/api/integrations/social-connect-link/…controller|schema.ts
src/http/api/integrations/social-accounts/…controller|schema.ts
src/http/api/integrations/disconnect-social/…controller.ts
src/http/api/integrations/social-profile.service.ts              ensureSocialProfile
src/http/api/actions/actions.targets.ts                          agregação + tabela de alvo
src/http/api/actions/actions.targets.test.ts
src/http/api/actions/resolve-target/…controller|schema.ts
src/actions/poll.ts                                              o processador do poll
src/actions/poll.test.ts
prisma/migrations/20260805…_action_targets_and_upload_post/migration.sql
```

**Modificados (back):** `prisma/schema.prisma`, `src/config/env.ts`,
`src/shared/errors/catalog.ts` + 3 i18n, `src/lib/errors.ts`,
`src/http/api/actions/{actions.domain,actions.schema,actions.payload,actions.presenter,actions.repository,actions.transition,index}.ts`,
os controllers de `create/update/execute/resolve`,
`src/http/api/integrations/{index,integrations.repository,integrations.schema}.ts`,
`src/actions/{queue,processor,worker,reaper}.ts`,
`src/ai/agents/fill/propose-social-post.ts`, `src/billing/operation-cost.ts`,
`src/integrations/social/index.ts`, `src/app.ts`.

**Apagados (back):** `src/integrations/social/postiz/**`,
`src/http/api/integrations/{put-postiz,postiz-channels}/**`,
`src/http/api/integrations/postiz.test.ts`, `compose.postiz.yml`,
`dynamicconfig/`.

**Criados (web):** `src/components/integrations/SocialSourceCard.tsx` + teste,
`src/components/actions/ActionTargetList.tsx` + teste,
`src/components/actions/PlatformPicker.tsx` + teste,
`src/components/actions/ActionTargetResolvePanel.tsx` + teste.

**Modificados (web):** `IntegrationsPage.tsx`, `ActionNewPage.tsx`,
`ActionDetailPage.tsx`, `ActionsListPage.tsx`,
`components/actions/{ActionStatusBadge,ActionApprovalPanel}.tsx`, os 3 locales,
`api.json` + `src/api/generated/**` (regenerado).

**Apagados (web):** `src/components/integrations/PostizSourceCard.tsx` + teste,
`src/components/actions/ActionDeliveryPanel.tsx` + teste (substituído pelo painel
por alvo).

---

## Task 1: Schema, migração, domínio e erros

**Arquivos:** `prisma/schema.prisma`, a migração,
`src/http/api/actions/actions.domain.ts`, `actions.targets.ts` (+testes),
`src/shared/errors/catalog.ts`, `src/lib/errors.ts`, os 3 i18n de erro,
`src/config/env.ts`.

**Interfaces produzidas** (as tasks seguintes dependem destes nomes exatos):

```ts
// actions.targets.ts
export type TargetStatusView = { status: ActionTargetStatus };
export function aggregateActionStatus(targets: TargetStatusView[]): ActionStatus | null;
export const PUBLISHABLE_TARGET: ActionTargetStatus[]; // ['PENDING', 'FAILED']
// actions.domain.ts
export const TRANSITIONS: Record<ActionStatus, ActionStatus[]>;
export const EXECUTABLE_FROM: ActionStatus[];
export function assertActionTransition(from: ActionStatus, to: ActionStatus): void; // já existe
```

- [ ] **Passo 1: Prisma.** Adicione, em `prisma/schema.prisma`:

```prisma
/// A interseção de "publica texto" com "pode ser conectada pelo nosso link"
/// (spec §3.4.1). Seis, não nove: Reddit, Bluesky e Google Business publicam mas
/// não são oferecíveis na conexão, então ninguém teria conta delas.
enum SocialPlatform {
  LINKEDIN
  X
  FACEBOOK
  THREADS
  DISCORD
  TELEGRAM
}

/// O ciclo de *entrega* de um alvo. Não confundir com `ActionStatus`, que é o de
/// *aprovação*: aprovar é ato humano sobre o post inteiro, publicar acontece
/// rede por rede.
enum ActionTargetStatus {
  PENDING
  PUBLISHING
  PUBLISHED
  FAILED
  DELIVERY_UNKNOWN
}

model ActionTarget {
  id          String             @id @default(uuid())
  workspaceId String
  actionId    String
  platform    SocialPlatform
  status      ActionTargetStatus @default(PENDING)
  /// O id do post na rede, como o provider devolveu. Nunca inventado.
  externalId  String?
  /// A URL pública do post, quando o provider a devolve. É o que o fundador
  /// clica para conferir — e o que torna "publicado" verificável por ele.
  postUrl     String?
  /// A mensagem da fonte, literal. "Missing subreddit" diz o que corrigir;
  /// "falha ao publicar" não diz nada.
  lastError   String?
  failureKind String?
  attempts    Int                @default(0)
  publishedAt DateTime?
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  action    Action    @relation(fields: [actionId], references: [id], onDelete: Cascade)

  /// Uma rede aparece uma vez por Action: a trava no banco contra publicar duas
  /// vezes no mesmo lugar pelo mesmo post.
  @@unique([actionId, platform])
  @@index([workspaceId])
  @@index([actionId])
}
```

Em `enum ActionStatus`, acrescente `PARTIALLY_EXECUTED` **depois de `EXECUTED`**.

Em `model Action`: remova `attempts`, `lastError`, `failureKind` (vão para o
alvo); mantenha `heartbeatAt` (é do job); adicione

```prisma
  /// O `request_id` da chamada assíncrona ao provider. É o que permite consultar
  /// o desfecho e retentar só o que falhou. Nulo até a primeira execução, e
  /// preservado depois dela.
  providerRequestId String?
```

e a relação `targets ActionTarget[]`. Em `model Workspace`, adicione
`actionTargets ActionTarget[]`.

- [ ] **Passo 2: migração à mão.** Crie
`prisma/migrations/20260805120000_action_targets_and_upload_post/migration.sql`:

```sql
-- Apaga as Actions existentes antes de mudar o modelo: elas referenciam
-- `payload.channelId` de um provider aposentado, e migrá-las produziria alvos
-- apontando para plataformas que ninguém autorizou. Válido porque não há dado de
-- produção — o Postiz nunca foi conectado a uma instância real (spec §4.5).
DELETE FROM "ExternalReference" WHERE "entityType" = 'SOCIAL_POST';
DELETE FROM "Approval";
DELETE FROM "Action";

CREATE TYPE "SocialPlatform" AS ENUM ('LINKEDIN', 'X', 'FACEBOOK', 'THREADS', 'DISCORD', 'TELEGRAM');
CREATE TYPE "ActionTargetStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'DELIVERY_UNKNOWN');

ALTER TYPE "ActionStatus" ADD VALUE 'PARTIALLY_EXECUTED';

ALTER TABLE "Action" DROP COLUMN "attempts";
ALTER TABLE "Action" DROP COLUMN "lastError";
ALTER TABLE "Action" DROP COLUMN "failureKind";
ALTER TABLE "Action" ADD COLUMN "providerRequestId" TEXT;

CREATE TABLE "ActionTarget" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "status" "ActionTargetStatus" NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT,
    "postUrl" TEXT,
    "lastError" TEXT,
    "failureKind" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ActionTarget_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ActionTarget_actionId_platform_key" ON "ActionTarget"("actionId", "platform");
CREATE INDEX "ActionTarget_workspaceId_idx" ON "ActionTarget"("workspaceId");
CREATE INDEX "ActionTarget_actionId_idx" ON "ActionTarget"("actionId");

ALTER TABLE "ActionTarget" ADD CONSTRAINT "ActionTarget_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActionTarget" ADD CONSTRAINT "ActionTarget_actionId_fkey"
  FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

> `ALTER TYPE … ADD VALUE` não roda dentro de transação em Postgres < 12; o
> Prisma aplica cada arquivo em transação. Se `pnpm prisma:deploy` reclamar,
> **pare e reporte** — a saída é dois arquivos de migração, não um `-- CreateEnum`
> improvisado.

- [ ] **Passo 3: `pnpm prisma:deploy && pnpm prisma:generate`** e
`pnpm prisma migrate status` (espera-se "Database schema is up to date!").

- [ ] **Passo 4: teste da agregação primeiro.** Crie
`src/http/api/actions/actions.targets.test.ts` cobrindo os sete casos do spec
§4.3, na ordem de precedência:

```ts
import { describe, expect, it } from 'vitest';
import { aggregateActionStatus } from './actions.targets.js';

const t = (status: string) => ({ status } as never);

describe('aggregateActionStatus', () => {
  it('sem alvo, não decide nada', () => {
    expect(aggregateActionStatus([])).toBeNull();
  });

  // Regra 1 antes de tudo: um alvo em voo mantém a ação em voo, mesmo que outro
  // já tenha publicado.
  it('algum PUBLISHING é EXECUTING', () => {
    expect(aggregateActionStatus([t('PUBLISHED'), t('PUBLISHING')])).toBe('EXECUTING');
  });

  // A ação ainda não executou: o status dela é o do ciclo de aprovação, e
  // devolver algo aqui sobrescreveria PROPOSED/APPROVED com um status de entrega.
  it('todos PENDING não decide nada', () => {
    expect(aggregateActionStatus([t('PENDING'), t('PENDING')])).toBeNull();
  });

  it('todos PUBLISHED é EXECUTED', () => {
    expect(aggregateActionStatus([t('PUBLISHED'), t('PUBLISHED')])).toBe('EXECUTED');
  });

  // O caso que existe para não mentir: dizer FAILED negaria um post público real.
  it('publicado em um e falho em outro é PARTIALLY_EXECUTED', () => {
    expect(aggregateActionStatus([t('PUBLISHED'), t('FAILED')])).toBe('PARTIALLY_EXECUTED');
  });

  it('publicado em um e incerto em outro é PARTIALLY_EXECUTED', () => {
    expect(aggregateActionStatus([t('PUBLISHED'), t('DELIVERY_UNKNOWN')])).toBe('PARTIALLY_EXECUTED');
  });

  it('nada publicado e algo incerto é DELIVERY_UNKNOWN', () => {
    expect(aggregateActionStatus([t('FAILED'), t('DELIVERY_UNKNOWN')])).toBe('DELIVERY_UNKNOWN');
  });

  // O caminho de volta: o humano disse que o incerto não publicou, o alvo virou
  // PENDING, e a ação fica executável de novo.
  it('nada publicado e algo PENDING volta para APPROVED', () => {
    expect(aggregateActionStatus([t('FAILED'), t('PENDING')])).toBe('APPROVED');
  });

  it('todos FAILED é FAILED', () => {
    expect(aggregateActionStatus([t('FAILED'), t('FAILED')])).toBe('FAILED');
  });
});
```

- [ ] **Passo 5: rode e veja falhar** (`pnpm vitest run src/http/api/actions/actions.targets.test.ts`)
com "does not provide an export named" / módulo não encontrado.

- [ ] **Passo 6: `actions.targets.ts`.**

```ts
import type { ActionStatus, ActionTargetStatus } from '@prisma/client';

/** Os alvos que **nós** enviamos numa publicação (spec §8.1, passo 2). */
export const PUBLISHABLE_TARGET: ActionTargetStatus[] = ['PENDING', 'FAILED'];

export type TargetStatusView = { status: ActionTargetStatus };

/**
 * O status da Action derivado dos alvos.
 *
 * `null` significa "não escreva nada": ou não há alvo, ou nenhum alvo saiu do
 * `PENDING` e o status da Action é o do ciclo de aprovação. Escrever aqui
 * sobrescreveria o ato humano com o estado da entrega.
 *
 * A ordem das regras é a do spec §4.3 e importa: `PARTIALLY_EXECUTED` vem antes
 * de `DELIVERY_UNKNOWN` porque, com um post público no ar, a pergunta
 * "publicou?" já tem resposta parcial afirmativa — e o alvo incerto continua
 * visível no detalhe.
 */
export function aggregateActionStatus(targets: TargetStatusView[]): ActionStatus | null {
  if (targets.length === 0) return null;

  const has = (status: ActionTargetStatus): boolean => targets.some((t) => t.status === status);
  const every = (status: ActionTargetStatus): boolean => targets.every((t) => t.status === status);

  if (has('PUBLISHING')) return 'EXECUTING';
  if (every('PENDING')) return null;
  if (every('PUBLISHED')) return 'EXECUTED';
  if (has('PUBLISHED')) return 'PARTIALLY_EXECUTED';
  if (has('DELIVERY_UNKNOWN')) return 'DELIVERY_UNKNOWN';
  if (has('PENDING')) return 'APPROVED';
  return 'FAILED';
}
```

- [ ] **Passo 7: rode e veja passar.**

- [ ] **Passo 8: transições.** Em `actions.domain.ts`, substitua a tabela e o
conjunto executável (mantendo `assertActionTransition` como está):

```ts
export const TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  PROPOSED: ['PENDING_APPROVAL', 'CANCELLED'],
  PENDING_APPROVAL: ['APPROVED', 'PROPOSED', 'CANCELLED'],
  APPROVED: ['EXECUTING', 'CANCELLED'],
  EXECUTING: ['EXECUTED', 'PARTIALLY_EXECUTED', 'FAILED', 'DELIVERY_UNKNOWN'],
  // Executável: `/posts/retry` do provider reenfileira só o que falhou, então
  // republicar não duplica o que já saiu (spec §4.4).
  PARTIALLY_EXECUTED: ['EXECUTING', 'CANCELLED'],
  FAILED: ['EXECUTING', 'CANCELLED'],
  // Executável agora — diferente do design do Postiz — porque `providerRequestId`
  // existe: retentar dali é `/posts/retry` sobre um id conhecido, não um tiro no
  // escuro. Sem esse id, a rota recusa com ACTION_NOTHING_TO_PUBLISH.
  DELIVERY_UNKNOWN: ['EXECUTING', 'EXECUTED', 'PARTIALLY_EXECUTED', 'APPROVED'],
  EXECUTED: [],
  CANCELLED: [],
};

export const EXECUTABLE_FROM: ActionStatus[] = ['APPROVED', 'PARTIALLY_EXECUTED', 'FAILED', 'DELIVERY_UNKNOWN'];
```

Atualize `actions.domain.test.ts`: cada estado novo com um caso legal e um
ilegal, e um teste de que `EXECUTED` e `CANCELLED` são terminais.

- [ ] **Passo 9: erros.** Em `src/shared/errors/catalog.ts`, **remova**
`POSTIZ_NOT_CONNECTED`, `POSTIZ_CHANNEL_NOT_FOUND` e `POSTIZ_REQUEST_FAILED`, e
adicione (números novos — AUR-T0041..0043 ficam queimados de propósito: um código
já citado em log ou ticket não pode passar a significar outra coisa):

```ts
  UPLOAD_POST_NOT_CONFIGURED: { code: 'AUR-T0045', status: 503 },
  UPLOAD_POST_NOT_CONNECTED: { code: 'AUR-T0046', status: 400 },
  UPLOAD_POST_PLATFORM_NOT_CONNECTED: { code: 'AUR-T0047', status: 400 },
  UPLOAD_POST_REQUEST_FAILED: { code: 'AUR-T0048', status: 502 },
  UPLOAD_POST_PLAN_LIMIT: { code: 'AUR-T0049', status: 409 },
  ACTION_NOT_EDITABLE: { code: 'AUR-T0050', status: 409 },
  ACTION_NOTHING_TO_PUBLISH: { code: 'AUR-T0051', status: 409 },
```

Em `src/lib/errors.ts`, troque as três classes `Postiz*Error` pelas sete novas,
seguindo exatamente a forma das existentes (`UploadPostRequestFailedError` leva
`details: { reason }`, como a antiga `PostizRequestFailedError`).

Mensagens nos três locales (`src/shared/errors/i18n/*.json`) — remova as três do
Postiz e acrescente, em pt-BR:

```
UPLOAD_POST_NOT_CONFIGURED: "A publicação em redes sociais não está configurada nesta instância."
UPLOAD_POST_NOT_CONNECTED: "Nenhuma rede social conectada neste workspace."
UPLOAD_POST_PLATFORM_NOT_CONNECTED: "Esta rede não está conectada: conecte-a antes de publicar nela."
UPLOAD_POST_REQUEST_FAILED: "O serviço de publicação não respondeu como esperado."
UPLOAD_POST_PLAN_LIMIT: "O limite de perfis do plano foi atingido."
ACTION_NOT_EDITABLE: "Esta ação não pode mais ser editada."
ACTION_NOTHING_TO_PUBLISH: "Não há nada a publicar nesta ação."
```

en-US e es-ES equivalentes. Se existir teste de paridade de chaves de erro, ele
tem de passar.

- [ ] **Passo 10: env.** Em `src/config/env.ts`, ao lado das `GOOGLE_OAUTH_*`:

```ts
  // A chave é da conta AUREA, não de um workspace (spec §3.1). Opcional: sem
  // ela as rotas sociais respondem 503 e o resto do produto sobe normal.
  UPLOAD_POST_API_KEY: optionalText,
  UPLOAD_POST_BASE_URL: z.string().url().default('https://api.upload-post.com/api'),
  /** Quantas leituras de status antes de desistir e marcar entrega incerta. */
  ACTION_POLL_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(200).default(20),
```

- [ ] **Passo 11:** `pnpm typecheck` (vai acusar os usos de `action.lastError` e
do Postiz — **deixe acusando**, as tasks 4-6 e 9 resolvem; anote no relatório
quais arquivos ficaram vermelhos) e `pnpm vitest run src/http/api/actions/`.

- [ ] **Passo 12:** `git add prisma src/http/api/actions src/shared/errors src/lib/errors.ts src/config/env.ts` + `git status` + diff resumido. **Sem commit.**

---

## Task 2: O conector Upload-Post

**Arquivos:** `src/integrations/social/upload-post/{upload-post-client,platforms}.ts`
(+ testes), `src/integrations/social/index.ts`.

**Consome:** nada da Task 1 além dos tipos do Prisma (`SocialPlatform`).

**Interfaces produzidas:**

```ts
export type UploadPostConfig = { apiKey: string; baseUrl: string };
export type UploadPostFailureKind = 'AUTH' | 'VALIDATION' | 'RATE_LIMIT' | 'PROVIDER' | 'NETWORK' | 'UNKNOWN' | 'PLAN_LIMIT';
export class UploadPostError extends Error { kind: UploadPostFailureKind; status?: number }
export function isRetriable(kind: UploadPostFailureKind): boolean;
export function isIndeterminate(kind: UploadPostFailureKind): boolean;
export type SocialAccount = { platform: SocialPlatform; handle: string | null; displayName: string | null; pictureUrl: string | null; reauthRequired: boolean };
export type PublishResult = { requestId: string; totalPlatforms: number };
export type PlatformOutcome = { platform: SocialPlatform; success: boolean; message: string | null; externalId: string | null; postUrl: string | null };
export type StatusResult = { status: 'pending' | 'in_progress' | 'completed'; completed: number; total: number; results: PlatformOutcome[] };
export type UploadPostClient = {
  ensureProfile(username: string, signal: AbortSignal): Promise<void>;
  connectLink(input: ConnectLinkInput, signal: AbortSignal): Promise<{ accessUrl: string; expiresIn: string }>;
  listAccounts(username: string, signal: AbortSignal): Promise<SocialAccount[]>;
  publishText(input: { username: string; platforms: SocialPlatform[]; content: string }, signal: AbortSignal): Promise<PublishResult>;
  getStatus(requestId: string, signal: AbortSignal): Promise<StatusResult>;
  retry(requestId: string, signal: AbortSignal): Promise<{ requestId: string | null; nothingToRetry: boolean; unknownRequest: boolean }>;
  deleteProfile(username: string, signal: AbortSignal): Promise<void>;
};
export function createUploadPostClient(config: UploadPostConfig): UploadPostClient;
export function socialProfileUsername(workspaceId: string): string; // `ws-${workspaceId}`
```

- [ ] **Passo 1: `platforms.ts`** — o mapa nos dois sentidos, com o slug exato do
provider:

```ts
import type { SocialPlatform } from '@prisma/client';

/** Slug do provider por plataforma. Verificado no OpenAPI (spec §3.4). */
export const PLATFORM_SLUG: Record<SocialPlatform, string> = {
  LINKEDIN: 'linkedin',
  X: 'x',
  FACEBOOK: 'facebook',
  THREADS: 'threads',
  DISCORD: 'discord',
  TELEGRAM: 'telegram',
};

const BY_SLUG = new Map<string, SocialPlatform>(
  Object.entries(PLATFORM_SLUG).map(([platform, slug]) => [slug, platform as SocialPlatform]),
);

/**
 * `null` para slug desconhecido, e nunca um throw: o provider pode devolver uma
 * rede que a AUREA não modela (o cliente conectou algo fora do nosso filtro, ou
 * eles adicionaram uma rede nova), e derrubar a listagem por isso esconderia as
 * contas que funcionam.
 */
export function platformFromSlug(slug: string): SocialPlatform | null {
  return BY_SLUG.get(slug.toLowerCase()) ?? null;
}
```

Teste: ida e volta para as seis; `platformFromSlug('instagram')` → `null`;
`platformFromSlug('LinkedIn')` → `'LINKEDIN'`.

- [ ] **Passo 2: testes do cliente primeiro** (`upload-post-client.test.ts`),
com `vi.stubGlobal('fetch', …)`. Cubra:

1. `publishText` manda `multipart/form-data` com `user`, um `platform[]` por
   plataforma, `title` e `async_upload=true`; devolve `requestId`.
2. header `authorization` é exatamente `Apikey k` — sem `Bearer`.
3. **um header `authorization` passado por um caller não substitui a chave** (o
   spread do caller vem antes; a credencial vem depois).
4. `classify`: 401→AUTH, 403→AUTH, 400/404/405/422→VALIDATION, 429→RATE_LIMIT,
   500→PROVIDER, erro de `fetch`→NETWORK, 418→UNKNOWN.
5. `isRetriable` e `isIndeterminate` **disjuntos** para todos os kinds.
6. `getStatus` mapeia `results[]` por slug, ignorando slug desconhecido.
7. `retry` → 409 devolve `{ nothingToRetry: true }`, 404 devolve
   `{ unknownRequest: true }`, e nenhum dos dois lança.
8. `ensureProfile` trata **409 como sucesso** (não lança).
9. `ensureProfile` com resposta de limite de plano → `UploadPostError` com kind
   `PLAN_LIMIT`.
10. `listAccounts` lê as três formas de `social_accounts` (objeto, string, null)
    sem lançar, e marca `reauthRequired` quando presente.
11. `connectLink` manda `show_calendar: false` e os seis slugs em `platforms`.

- [ ] **Passo 3: rode e veja falhar.**

- [ ] **Passo 4: `upload-post-client.ts`.** Pontos que o teste trava e que **não
podem** ser reescritos por conveniência:

```ts
function classify(status: number): UploadPostFailureKind {
  if (status === 401 || status === 403) return 'AUTH';
  // 404 e 405 vêm de roteamento — baseUrl errada, proxy na frente — e roteamento
  // acontece antes de qualquer criação: o post não existe. Tratá-los como
  // indeterminado mandaria o fundador conferir uma rede que nada recebeu.
  if (status === 400 || status === 404 || status === 405 || status === 422) return 'VALIDATION';
  if (status === 429) return 'RATE_LIMIT';
  if (status >= 500) return 'PROVIDER';
  return 'UNKNOWN';
}

/** Retentável = o provider respondeu, então não criou nada. */
export function isRetriable(kind: UploadPostFailureKind): boolean {
  return kind === 'RATE_LIMIT' || kind === 'PROVIDER';
}

/** Indeterminado = não sabemos se criou. Nunca retenta (spec §8.4). */
export function isIndeterminate(kind: UploadPostFailureKind): boolean {
  return kind === 'NETWORK' || kind === 'UNKNOWN';
}
```

```ts
  const headers = {
    ...(init.headers ?? {}),
    // Por último de propósito: um caller que passasse `authorization` por engano
    // não pode substituir a credencial da conta.
    authorization: `Apikey ${config.apiKey}`,
  };
```

`publishText` monta `FormData` (não JSON — o endpoint é multipart):

```ts
    const form = new FormData();
    form.set('user', input.username);
    for (const platform of input.platforms) form.append('platform[]', PLATFORM_SLUG[platform]);
    form.set('title', input.content);
    // Assíncrono sempre: a resposta síncrona depende do provider caber no
    // timeout dele, e um caminho que às vezes devolve `results` e às vezes
    // `request_id` teria dois desfechos para testar em todo lugar. Com
    // `async_upload`, existe um só, e é o poll que fala (spec §8.1).
    form.set('async_upload', 'true');
```

Schemas Zod de resposta **sem `.default()`** (um default esconde campo ausente do
provider e vira "publicado" silencioso). Falha de parse → `UploadPostError` kind
`UNKNOWN` — não `VALIDATION`: se o corpo não casa, não sabemos o que aconteceu.

`retry` faz `POST /uploadposts/posts/retry` e trata 409/404 **antes** de
`classify`, devolvendo os dois booleanos em vez de lançar — o processor decide o
caminho por eles (spec §8.1, passo 4).

`socialProfileUsername(workspaceId)` = `` `ws-${workspaceId}` ``, com comentário
de por que é opaco: o nome do workspace muda e não é nosso para vazar ao
fornecedor.

- [ ] **Passo 5: rode e veja passar.** `pnpm vitest run src/integrations/social/`

- [ ] **Passo 6:** `src/integrations/social/index.ts` reexporta só o
Upload-Post (o Postiz sai na Task 9; se ainda estiver referenciado aqui, deixe a
linha e anote).

- [ ] **Passo 7:** `git add src/integrations/social` + `git status`. **Sem commit.**

---

## Task 3: Rotas de conexão social

**Arquivos:** `src/http/api/integrations/social-profile.service.ts`,
`social-connect-link/{controller,schema}.ts`, `social-accounts/{controller,schema}.ts`,
`disconnect-social/controller.ts`, `integrations.repository.ts`,
`integrations.schema.ts`, `index.ts`, `src/app.ts`, teste
`src/http/api/integrations/social.test.ts`.

**Consome:** Task 2 (`createUploadPostClient`, `socialProfileUsername`,
`SocialAccount`), Task 1 (erros novos, env).

**Produz:**

```ts
export type SocialClientFactory = () => UploadPostClient;      // opção de plugin
export type SocialRoutesOptions = { social?: SocialClientFactory };
export async function ensureSocialProfile(deps: {...}, workspaceId: string, userId: string): Promise<{ integrationId: string; username: string }>;
```

- [ ] **Passo 1: repositório.** Em `integrations.repository.ts`, troque
`upsertApiKey` (do Postiz) por:

```ts
    /**
     * A linha do provider social. Diferente do GA4 e do antigo Postiz, **não há
     * segredo por workspace**: a chave é da conta AUREA (spec §3.1). As três
     * colunas de cifra são `Bytes` não-nulas, então selamos `{}` — inventar uma
     * nulidade nova para um caso mudaria a tabela por nada. Nenhuma rota devolve
     * essas colunas.
     */
    upsertAccountProfile(
      workspaceId: string,
      data: { provider: string; externalId: string; accountLabel: string; status: string; createdBy: string; sealedEmpty: Sealed },
    ) { … }
```

Mantenha `authKind: 'ACCOUNT_KEY'`. Um comentário de uma linha por quê.

- [ ] **Passo 2: `ensureSocialProfile`** (`social-profile.service.ts`):
chama `client.ensureProfile(username)` (409 já é sucesso, tratado no cliente),
grava/atualiza a linha com `status: 'OK'`, devolve `{ integrationId, username }`.
Em `UploadPostError` kind `PLAN_LIMIT` → lança `UploadPostPlanLimitError`. Em
qualquer outro erro → grava `status: 'FAILED'` + `lastError` **e** lança
`UploadPostRequestFailedError` com `details: { reason }`.

> Diferente do GA4, que recusa gravar quando a verificação falha: aqui a linha
> gravada com `FAILED` é o que faz a tela mostrar o motivo em vez de um estado
> vazio. Mesma escolha do antigo `put-postiz`.

- [ ] **Passo 3: rotas.** Três, cada uma numa pasta, com o formato dos vizinhos
(`google-properties/` é o modelo mais próximo: cliente por opção, tenant do
`req.tenant`).

```
POST   /integrations/social/connect-link   createSocialConnectLink   201 { accessUrl, expiresIn }
GET    /integrations/social/accounts       listSocialAccounts        200 { accounts: SocialAccountResponse[] }
DELETE /integrations/social                disconnectSocial          204
```

`connect-link` monta:

```ts
      const link = await client.connectLink(
        {
          username,
          redirectUrl: `${env.APP_URL}/integrations?social=connected`,
          logoImage: `${env.APP_URL}/logo.png`,
          title: req.t('social.connect.title'),
          description: req.t('social.connect.description'),
          buttonText: req.t('social.connect.button'),
          // Explícito, e sem Instagram/TikTok/YouTube: omitir o campo mostra
          // todas as redes, e um cliente que autoriza o Instagram e depois não
          // pode postar nele foi enganado pela nossa tela (spec §6).
          platforms: SOCIAL_PLATFORMS,
          showCalendar: false,
          language: connectLanguage(req),
        },
        AbortSignal.timeout(15_000),
      );
```

Se o backend não tiver `req.t`, passe os textos em pt fixos e **anote no
relatório** — não invente um mecanismo de i18n novo no servidor.

`DELETE` chama `deleteProfile` e apaga a linha de integração; **não** apaga
`Action`, `ActionTarget` nem `ExternalReference`. `204`.

Sem `UPLOAD_POST_API_KEY` no ambiente, as três respondem
`UploadPostNotConfiguredError` (503) — teste explícito.

- [ ] **Passo 4: registrar.** `integrations/index.ts` ganha as três com
`{ social: opts.social }`, e `IntegrationsRoutesOptions` ganha
`SocialRoutesOptions`. `integrationProvider` em `integrations.schema.ts` passa a
`z.enum(['GA4', 'UPLOAD_POST'])`. Em `app.ts`, nada muda além de repassar a
opção, se ela for repassada lá.

- [ ] **Passo 5: testes** (`social.test.ts`), todos com cliente falso por opção:
contrato de `connect-link` (o que foi enviado ao provider, incluindo
`showCalendar: false` e as seis plataformas), `accounts` mapeando `reauthRequired`,
`DELETE` chamando `deleteProfile`, 503 sem chave, **404 para workspace alheio**, e
que nenhuma resposta contém `ciphertext`/`iv`/`authTag`/`apiKey`.

- [ ] **Passo 6:** `pnpm typecheck` e `pnpm vitest run src/http/api/integrations/`.
- [ ] **Passo 7:** `git add src/http/api/integrations src/app.ts` + `git status`. **Sem commit.**

---

## Task 4: Actions com alvos — criar, editar, listar, ler

**Arquivos:** `actions.payload.ts`, `actions.schema.ts`, `actions.presenter.ts`,
`actions.repository.ts`, `create-action/`, `update-action/`, `list-actions/`,
`get-action/`, `actions.test.ts`.

**Consome:** Task 1 (`aggregateActionStatus`, `PUBLISHABLE_TARGET`, erros),
Task 2 (`SocialPlatform`, cliente), Task 3 (`listAccounts` para validar).

**Produz:**

```ts
export const SOCIAL_PLATFORMS: SocialPlatform[]; // actions.schema.ts
export const socialPostPayload: z.ZodType<{ content: string }>;
// actions.repository.ts
createWithTargets(workspaceId, data, platforms): Promise<ActionWithTargets>
findByIdWithTargets(workspaceId, id): Promise<ActionWithTargets | null>
replaceTargets(workspaceId, actionId, platforms): Promise<void>
claimForExecution(workspaceId, id): Promise<boolean>
writeAggregatedStatus(tx, actionId): Promise<void>
```

- [ ] **Passo 1: payload.** `socialPostPayload` fica **só** com
`content: z.string().min(1).max(5000)`, `.strict()`. Apague `channelId`,
`channelName`, `providerIdentifier` e o comentário do snapshot de canal — o alvo
substituiu o snapshot. `parseActionPayload` continua com `.parse` (não
`safeParse`) e o comentário de por quê.

- [ ] **Passo 2: schema.** Em `actions.schema.ts`:

```ts
export const socialPlatform = z.enum(['LINKEDIN', 'X', 'FACEBOOK', 'THREADS', 'DISCORD', 'TELEGRAM']);
export const SOCIAL_PLATFORMS = socialPlatform.options;

export const actionTargetEntity = z.object({
  id: z.string(),
  platform: socialPlatform,
  status: z.enum(['PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'DELIVERY_UNKNOWN']),
  externalId: z.string().nullable(),
  postUrl: z.string().nullable(),
  lastError: z.string().nullable(),
  failureKind: z.string().nullable(),
  attempts: z.number().int(),
  publishedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});
```

`actionEntity` perde `lastError`, `failureKind`, `attempts` e ganha
`status` com `PARTIALLY_EXECUTED` no enum. `actionResponse` passa a
`{ action, targets }`; `actionDetailResponse` a `{ action, targets, approvals }`
(o `delivery` singular morre — a proveniência agora é por alvo).

`createActionBody`: `platforms: socialPlatform.array().min(1).max(6)` com refine
de "sem repetição" e mensagem própria.

- [ ] **Passo 3: presenter.** `presentAction(action)` e
`presentTarget(target)`; datas em ISO. Nenhum campo do provider é renomeado para
algo mais bonito: `postUrl` é a URL que ele deu.

- [ ] **Passo 4: o tipo de entidade da proveniência.** Em
`actions.repository.ts`, `SOCIAL_POST_ENTITY = 'SOCIAL_POST'` passa a
`SOCIAL_POST_TARGET_ENTITY = 'SOCIAL_POST_TARGET'`: a proveniência agora é de um
alvo, não da Action. As duas uniques de `ExternalReference` continuam servindo sem
migração — com `entityId = target.id`, `[integrationId, entityType, entityId]`
passa a significar "um post por rede por ação", que é exatamente a trava que se
quer. Apague `findDelivery` (o `delivery` singular morreu) e ajuste os
importadores (`processor.ts` fica vermelho até a Task 6 — esperado).

- [ ] **Passo 5: repositório.** `createWithTargets` numa transação
(`action.create` + `actionTarget.createMany`). `findByIdWithTargets` com
`include: { targets: { orderBy: { platform: 'asc' } } }` — ordem estável para a
tela e para o teste. `replaceTargets`:

```ts
    /**
     * Troca o conjunto de alvos de uma Action em PROPOSED.
     *
     * Nunca apaga alvo `PUBLISHED`: um post no mundo é fato, e sumir com a linha
     * apagaria a proveniência. Em `PROPOSED` isso não deveria acontecer — a
     * verificação existe porque "não deveria" não é trava.
     */
```

`claimForExecution` passa a filtrar `status: { in: EXECUTABLE_FROM }` e **não
mexe mais em `attempts`/`lastError`/`failureKind` da Action** (são do alvo);
continua zerando `heartbeatAt`. `writeAggregatedStatus(tx, actionId)` lê os
alvos, chama `aggregateActionStatus`, e **só escreve se não for `null`**.

- [ ] **Passo 6: create.** No controller, na ordem: `assertWriter`, ler as contas
conectadas ao vivo (cliente por opção), recusar plataforma não conectada com
`UploadPostPlatformNotConnectedError` citando qual, criar Action + alvos.
Plataforma conectada com `reauthRequired: true` **também** é recusada, com a
mesma mensagem — publicar nela falharia, e o cliente precisa reconectar primeiro.

- [ ] **Passo 7: update.** `PATCH` só em `PROPOSED`; qualquer outro status →
`ActionNotEditableError`. Valida plataformas do mesmo jeito do create.

- [ ] **Passo 8: testes** (`actions.test.ts`, adaptando o que existe): criar com
3 plataformas cria 3 alvos `PENDING`; plataforma repetida → 400; plataforma não
conectada → 400 citando a rede; `reauthRequired` → 400; `PATCH` em
`PENDING_APPROVAL` → 409; **404 para id de outro workspace**; `GET` devolve
alvos em ordem estável; nenhuma resposta traz `payload.channelId` (o campo não
existe mais).

- [ ] **Passo 9: opções de plugin.** `create-action` e `update-action` precisam do
cliente social para validar plataforma; ele entra por opção
(`ActionsRoutesOptions & { social?: SocialClientFactory }`), repassada em
`actions/index.ts` e em `app.ts`. Nunca por decorator ambiente — um teste que
esquecesse de decorar sairia falando com o provider de dentro da suíte.
- [ ] **Passo 10:** `pnpm vitest run src/http/api/actions/` + `pnpm typecheck`.
- [ ] **Passo 11:** `git add src/http/api/actions src/app.ts` + `git status`. **Sem commit.**

---

## Task 5: Aprovação e transições sobre o novo modelo

**Arquivos:** `actions.transition.ts`, `submit-action/`, `approve-action/`,
`reject-action/`, `cancel-action/`, `actions-approval.test.ts`.

**Consome:** Tasks 1 e 4.

O ciclo de aprovação **não muda de regra**: OWNER/ADMIN via `assertAdmin`, autor
pode aprovar a própria, em ato separado, rejeitar exige comentário. O trabalho é
mecânico: tirar as referências a `lastError`/`failureKind`/`attempts` da Action e
fazer as respostas devolverem `{ action, targets }`.

- [ ] **Passo 1:** ajuste `actions.transition.ts` e os quatro controllers para o
novo `actionResponse`. Nada de logica nova.
- [ ] **Passo 2:** `cancel-action` continua recusando cancelar o que não tem
aresta para `CANCELLED` — agora inclui `PARTIALLY_EXECUTED` (tem aresta) e
`DELIVERY_UNKNOWN` (**não** tem: cancelar o que talvez tenha publicado esconderia
o fato). Teste para os dois.
- [ ] **Passo 3:** `actions-approval.test.ts` verde, mais um caso: aprovar não
cria nem mexe em alvo nenhum.
- [ ] **Passo 4:** `git add` + `git status`. **Sem commit.**

---

## Task 6: Execução — fila, publicação, poll, worker, reaper

A task mais delicada. Leia o spec §8 inteiro antes de escrever.

**Arquivos:** `src/actions/{queue,processor,poll,worker,reaper}.ts` + testes,
`execute-action/execute-action.controller.ts`.

**Consome:** Tasks 1, 2, 4.

**Produz:**

```ts
// queue.ts
export type ActionExecutionJob = { actionId: string; workspaceId: string };
export type ActionPollJob = { actionId: string; workspaceId: string; poll: number };
export async function enqueueActionExecution(job: ActionExecutionJob): Promise<void>;
export async function enqueueActionPoll(job: ActionPollJob): Promise<void>;
// processor.ts
export async function executeAction(deps: ActionProcessorDeps, job: ActionExecutionJob): Promise<void>;
// poll.ts
export async function pollAction(deps: ActionProcessorDeps, job: ActionPollJob): Promise<void>;
```

- [ ] **Passo 1: fila.** Dois nomes de job na mesma fila. O `execute` mantém
`jobId = actionId` (camada 2 da idempotência). O `poll` usa
`jobId = ${actionId}:poll:${n}` — sem o sufixo, o segundo poll seria recusado
como duplicado. Delays:

```ts
/**
 * O ritmo do poll: rápido no começo, porque a maioria completa em segundos, e
 * espaçado depois, para não gastar 20 leituras nos 3 primeiros minutos. Depois
 * do último valor, repete o último.
 */
const POLL_DELAYS_MS = [2_000, 3_000, 5_000, 8_000, 13_000, 21_000, 30_000];
export function pollDelay(poll: number): number {
  return POLL_DELAYS_MS[Math.min(poll, POLL_DELAYS_MS.length - 1)] ?? 30_000;
}
```

O job de poll leva `attempts: 1`: retentativa de leitura é problema nosso, pelo
contador, não do BullMQ — e assim existe **um** mecanismo, não dois.

- [ ] **Passo 2: teste do processor primeiro** (`processor.test.ts`, reescrito).
Casos obrigatórios:

1. publica só os alvos `PENDING`/`FAILED`; um alvo `PUBLISHED` e um
   `DELIVERY_UNKNOWN` **não** entram no `platform[]` enviado;
2. grava `providerRequestId` e enfileira o primeiro poll;
3. **job com `actionId` de um workspace e `workspaceId` de outro não publica
   nada** (nem toca no cliente);
4. o `user` enviado é o profile do workspace da Action — duas Actions de
   workspaces diferentes produzem `user` diferentes;
5. sem integração social → todos os alvos elegíveis `FAILED` com kind `AUTH` e
   mensagem clara (nada saiu: `FAILED`, não `DELIVERY_UNKNOWN`);
6. `RATE_LIMIT` → alvos ficam `PUBLISHING`, mensagem gravada, e **relança** (é o
   que faz o BullMQ tentar de novo);
7. `NETWORK` → alvos elegíveis `DELIVERY_UNKNOWN`, **não relança**, e
   `providerRequestId` continua nulo;
8. `VALIDATION` → alvos `FAILED`, não relança;
9. com `providerRequestId` presente, chama `retry` e **não** `publishText`;
10. `retry` devolvendo `nothingToRetry` → segue para o poll, sem publicar;
11. `retry` devolvendo `unknownRequest` → publica de novo, **só** com os alvos
    `PENDING`/`FAILED` (o `DELIVERY_UNKNOWN` continua fora);
12. montar o cliente falhando (chave ausente) → `FAILED`, sem tocar na rede;
13. status da Action recalculado pela agregação em todos os desfechos acima.

- [ ] **Passo 3: processor.** Estrutura, com os comentários que explicam as
escolhas não-óbvias:

```ts
export async function executeAction(deps: ActionProcessorDeps, job: ActionExecutionJob): Promise<void> {
  const now = deps.now ?? (() => new Date());

  // Os dois ids vêm do job e são reconferidos juntos: o `workspaceId` não é
  // decoração, é a fronteira. Uma Action lida sem ele publicaria com o profile
  // de quem enfileirou, e a chave do provider é a mesma para todos os clientes
  // (spec §5.1).
  const action = await deps.prisma.action.findFirst({
    where: { id: job.actionId, workspaceId: job.workspaceId },
    include: { targets: true },
  });
  if (!action) { /* log e return */ }
  if (action.status !== 'EXECUTING') { /* log e return */ }
  …
}
```

- alvos a enviar: `action.targets.filter((t) => PUBLISHABLE_TARGET.includes(t.status))`;
- `heartbeatAt` gravado **antes** da chamada (separa lento de morto para o reaper);
- `providerRequestId` gravado **antes** de qualquer outra escrita pós-resposta —
  é o que torna a falha seguinte recuperável;
- no `catch`: `isRetriable` → grava `lastError`/`failureKind` **nos alvos** e
  relança; `isIndeterminate` → alvos `DELIVERY_UNKNOWN` e **return**; resto →
  alvos `FAILED` e return. Em todos, `writeAggregatedStatus` depois.

- [ ] **Passo 4: poll.** `pollAction`:

```ts
/**
 * A única fonte de "publicado".
 *
 * Ler é seguro: `GET /uploadposts/status` não cria nada, então qualquer falha
 * aqui apenas agenda a próxima leitura — sem risco de duplicar post, que é o que
 * proíbe retentar no caminho de publicação.
 */
```

- lê `getStatus(requestId)`; para cada `results[]`, escreve o alvo: `success` →
  `PUBLISHED` + `externalId` + `postUrl` + `publishedAt`, e cria o
  `ExternalReference` (`entityType: 'SOCIAL_POST_TARGET'`, `entityId: target.id`,
  `metadata: { platform, url }`), tratando **P2002 como sucesso**; `!success` →
  `FAILED` + `message` literal (é sempre `FAILED`, nunca indeterminado: o
  provider tentou e está nos dizendo);
- `status !== 'completed'` e `poll + 1 < env.ACTION_POLL_MAX_ATTEMPTS` →
  `enqueueActionPoll({ …, poll: poll + 1 })`;
- contador esgotado com alvo ainda `PUBLISHING` → `DELIVERY_UNKNOWN` nesses
  alvos, preservando `lastError`;
- `writeAggregatedStatus` no fim, sempre, e `heartbeatAt` zerado quando não há
  mais poll pela frente.

Testes (`poll.test.ts`): escreve `PUBLISHED` com id e URL da fonte; um
`success: false` vira `FAILED` com a mensagem literal; parcial reagenda; P2002
não derruba; contador esgotado marca `DELIVERY_UNKNOWN` só nos `PUBLISHING`;
`GET` falhando reagenda em vez de marcar qualquer coisa; slug desconhecido é
ignorado sem quebrar os outros.

- [ ] **Passo 5: worker.** Despacha por `job.name`:

```ts
  const worker = new Worker(ACTION_EXECUTIONS_QUEUE, async (job) => {
    if (job.name === 'poll') return pollAction(deps, job.data as ActionPollJob);
    return runExecute(deps, job.data as ActionExecutionJob);
  }, { connection: getConnection(), concurrency: 1 });
```

`reconcileExhaustedAction` passa a decidir **por alvo** (`failureKind` mora no
alvo agora): `RATE_LIMIT`/`PROVIDER` → `FAILED`, resto → `DELIVERY_UNKNOWN`;
depois `writeAggregatedStatus`. Mantenha o `if (job.attemptsMade < limit) return;`
e ignore jobs `poll` no `failed` (o contador já cobre).

- [ ] **Passo 6: reaper.** `EXECUTING` sem sinal de vida → alvos `PUBLISHING`
viram `DELIVERY_UNKNOWN`, **preservando o `lastError` de cada alvo**, nunca
`FAILED`; depois `writeAggregatedStatus`. Nunca escreve `Action.status` à mão.

- [ ] **Passo 7: rota.** `execute-action.controller.ts`, nesta ordem:

1. `assertWriter`;
2. `findByIdWithTargets` — 404 se não for do workspace;
3. se não há alvo publicável **e** não há `providerRequestId`, responde
   `ACTION_NOTHING_TO_PUBLISH` (409) **antes** do CAS. A verificação vem antes de
   propósito: reverter um CAS já feito exigiria uma segunda escrita que pode
   falhar, deixando a Action presa em `EXECUTING`;
4. `claimForExecution` — `false` ⇒ outro clique ganhou a corrida, responde 409 com
   o mesmo código de transição inválida que as outras rotas usam;
5. marca os alvos publicáveis como `PUBLISHING` e `attempts++`;
6. `enqueue({ actionId, workspaceId })`;
7. `202` montado dos valores conhecidos, **sem reler** (um `updateMany` não
   devolve linha).

Teste: os passos 3 e 4 têm caso próprio, e o do passo 3 verifica que a fila
**não** foi chamada.

- [ ] **Passo 8:** `pnpm vitest run src/actions/ src/http/api/actions/` e
`pnpm typecheck`.
- [ ] **Passo 9:** `git add src/actions src/http/api/actions` + `git status`. **Sem commit.**

---

## Task 7: Resolver um alvo incerto

**Arquivos:** `resolve-target/{controller,schema}.ts`, `actions.repository.ts`,
`actions/index.ts`, teste em `actions-execution.test.ts`.

`POST /actions/:id/targets/:targetId/resolve`, `operationId: resolveActionTarget`,
body `{ outcome: 'PUBLISHED' | 'NOT_PUBLISHED', externalId?: string }`.

- [ ] **Passo 1:** só alvo `DELIVERY_UNKNOWN` é resolvível; qualquer outro →
`ACTION_NOT_RESOLVABLE` (409). O alvo é buscado por `{ id: targetId, actionId,
workspaceId }` — os três, sempre.
- [ ] **Passo 2:** `PUBLISHED` → alvo `PUBLISHED` + `publishedAt`; com
`externalId`, grava `ExternalReference`; **sem ele, não grava** (comentário:
proveniência de mentira é pior que ausente), e `postUrl` fica nulo — não é nosso
para construir.
- [ ] **Passo 3:** `NOT_PUBLISHED` → alvo volta a **`PENDING`**, com
`lastError`/`failureKind` limpos. A agregação (regra 6) devolve a Action a
`APPROVED`.
- [ ] **Passo 4:** testes: os dois desfechos, o 409 em alvo publicado, **404
para alvo de outra Action** (mesmo que o id exista), e que resolver um alvo de
uma Action com outro alvo já publicado deixa a Action em `PARTIALLY_EXECUTED`.
- [ ] **Passo 5:** `git add` + `git status`. **Sem commit.**

---

## Task 8: O agente que redige o post

**Arquivos:** `src/ai/agents/fill/propose-social-post.ts` (+ teste),
`src/billing/operation-cost.ts`.

- [ ] **Passo 1:** `filledSchema` passa a cobrir `name`, `payload.content` **e**
`platforms` (array dos seis slugs em maiúsculas). Comentário: o modelo sugere
**rede**, nunca conta — não há conta para ele escolher, há uma por rede.
- [ ] **Passo 2:** a proposta é filtrada contra as redes conectadas antes de
chegar à tela, e rede não conectada é **descartada em silêncio** — o modelo não
sabe o que o cliente autorizou, então isso não é erro dele.
- [ ] **Passo 3:** `taskType: 'propose-social-post'` continua no
`operation-cost.ts` (`registry-coverage.test.ts` exige preço por taskType) e
`maxOutputTokens` continua ≥ o piso que `output-budget.test.ts` cobra — não
baixe.
- [ ] **Passo 4:** `get_experiment_result` só entra na toolbox com
`experimentId`; `precheck` continua retornando cedo, sem consulta ao banco, sem
experimento.
- [ ] **Passo 5:** testes + `git add` + `git status`. **Sem commit.**

---

## Task 9: Aposentar o Postiz e regenerar o contrato

- [ ] **Passo 1:** apague `src/integrations/social/postiz/`,
`src/http/api/integrations/{put-postiz,postiz-channels}/`,
`src/http/api/integrations/postiz.test.ts`, `compose.postiz.yml`,
`dynamicconfig/`, e os scripts `postiz:up|down|logs` do `package.json`.
- [ ] **Passo 2:** `grep -ri postiz src prisma docs/superpowers/plans package.json`
tem de voltar **vazio** (o spec e o plano antigos são história e ficam).
- [ ] **Passo 3:** `pnpm typecheck` limpo, `pnpm test` verde.
- [ ] **Passo 4:** `pnpm openapi:dump` (escreve `../web/api.json`) — e **não**
`git add ../web/api.json`: são dois repos, e o `api.json` é commitado do lado do
`web`, na Task 10.
- [ ] **Passo 5:** `git add -A` (só `back`) + `git status`. **Sem commit.**

---

## Task 10: Web — conectar redes

**Arquivos:** `web/src/components/integrations/SocialSourceCard.tsx` + teste,
`IntegrationsPage.tsx`, os 3 locales, `api.json` + hooks regenerados.
**Apaga:** `PostizSourceCard.tsx` + teste.

- [ ] **Passo 1:** `pnpm api:generate` no `web` (o `api.json` foi escrito pela
Task 9, do lado do `back`). Hooks de mutação com path param recebem `{ id }` /
`{ id, data }` — **não** `{ params }`.
- [ ] **Passo 2:** `SocialSourceCard`: lista as contas (`avatar`, `handle`,
`displayName`), badge de reconectar quando `reauthRequired`, botão "Conectar
redes" → `useCreateSocialConnectLink` → `window.open(accessUrl, '_blank')`, e
"Desconectar tudo" com `AlertDialog` nomeando o que se perde. Estado vazio
explica que é um clique, e que Instagram e TikTok chegam quando a AUREA publicar
imagem.
- [ ] **Passo 3:** ao voltar com `?social=connected`, invalida a query das contas
e limpa o parâmetro da URL.
- [ ] **Passo 4:** chaves i18n (pt/en/es) sob `pages.integrations.social.*`;
apague as `pages.integrations.postiz.*`. O teste de paridade de chaves tem de
passar, e **nenhuma cópia nova pode repetir texto de outra chave** — o teste que
usa `getByText` quebra com duplicata.
- [ ] **Passo 5:** teste do card com `renderWithProviders` + `stubFetch`.
- [ ] **Passo 6:** `pnpm typecheck` + `pnpm vitest run` + `git add` + `git status`. **Sem commit.**

---

## Task 11: Web — a ação multicanal

**Arquivos:** `PlatformPicker.tsx`, `ActionTargetList.tsx`,
`ActionTargetResolvePanel.tsx` (+ testes), `ActionNewPage.tsx`,
`ActionDetailPage.tsx`, `ActionsListPage.tsx`, `ActionStatusBadge.tsx`,
os 3 locales. **Apaga:** `ActionDeliveryPanel.tsx` + teste.

- [ ] **Passo 1: `PlatformPicker`** — checkbox por rede conectada, contagem
("publicar em {{count}} redes"), rede com `reauthRequired` desabilitada com o
motivo, e nenhuma rede conectada ⇒ caminho para conectar em vez de formulário.
- [ ] **Passo 2: `ActionStatusBadge`** — `EXECUTED` passa a ser **"Publicado"**
(agora é verdade: o status vem do poll com id e URL da fonte), e entra
`PARTIALLY_EXECUTED` = "Publicado em parte". A ênfase de erro continua
`variant="outline"` + `border-destructive/40 text-destructive` — `badge.tsx`
**não** tem variante `destructive`.
- [ ] **Passo 3: `ActionTargetList`** — uma linha por alvo: badge, `postUrl` como
link quando existe, `lastError` literal quando falhou.
- [ ] **Passo 4: `ActionTargetResolvePanel`** — o aviso **antes** dos botões,
nomeando a rede e o horário da tentativa; `externalId` opcional que só viaja se
não estiver vazio; nenhum botão neutro de "tentar de novo".
- [ ] **Passo 5: `ActionDetailPage`** — `refetchInterval` de 5s enquanto
`EXECUTING`; `EXECUTABLE` = `['APPROVED', 'PARTIALLY_EXECUTED', 'FAILED',
'DELIVERY_UNKNOWN']`; aprovar e publicar nunca renderizam juntos. O
`AlertDialog` de publicação **lista as redes** que vão receber, e em
`PARTIALLY_EXECUTED`/`FAILED`/`DELIVERY_UNKNOWN` diz que só as que não
publicaram serão tentadas — que é o que `/posts/retry` faz.
- [ ] **Passo 6: `ActionsListPage`** — a coluna de canal vira a lista de redes do
post (ícone ou sigla por alvo), e o filtro ganha `PARTIALLY_EXECUTED`. A cópia do
filtro **não pode repetir** a cópia de status: o teste que usa `getByText` quebra
com texto duplicado — foi exatamente o que aconteceu na fatia anterior.
- [ ] **Passo 7: i18n** nos três locales; apague as chaves de canal e a cópia
"Entregue ao Postiz".
- [ ] **Passo 8:** testes de cada componente + os das páginas: criar com 3 redes
manda 3 plataformas; o diálogo lista as redes; alvo publicado mostra link; alvo
incerto mostra o painel; cancelar o diálogo não dispara requisição.
- [ ] **Passo 9:** `pnpm typecheck` + `pnpm vitest run` + `git add` +
`git status`. **Sem commit.**

---

## Ordem e bateladas

Dependências: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11. As tasks 1-2 podem
sair em paralelo (não se tocam); da 3 em diante é sequencial.

Bateladas sugeridas, para não pagar um ciclo de revisão por task:

1. **Tasks 1-2** — base e conector.
2. **Tasks 3-5** — rotas de conexão e CRUD com alvos.
3. **Tasks 6-7** — execução (a mais delicada; revisão dedicada).
4. **Tasks 8-9** — agente e remoção do Postiz.
5. **Tasks 10-11** — web.

`pnpm typecheck` fica vermelho entre a Task 1 e a Task 6: as colunas saíram do
modelo antes de os chamadores serem reescritos. Isso é esperado, e cada task
anota no relatório o que ficou pendente. **Ao fim da batelada 3 ele tem de estar
limpo.**

## Verificação final

- `pnpm typecheck` limpo nos dois repos.
- `pnpm test` verde nos dois; contagem informada. Baseline: back 1244/134, web
  756/103 — e a contagem do `back` **cai** com a Task 9, que apaga os testes do
  Postiz. Uma queda ali é esperada; uma queda em qualquer outro ponto não.
- `pnpm prisma migrate status` → "Database schema is up to date!".
- `grep -ri postiz src prisma package.json` vazio no `back`; `grep -ri postiz src`
  vazio no `web`.
- `grep -rn "apiKey" src` só nos arquivos que montam o cliente ou recebem a
  credencial — nunca num presenter, schema de resposta ou log.
- Nenhum teste importando o cliente real ou a fila real.
