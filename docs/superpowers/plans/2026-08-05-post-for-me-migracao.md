# Migração para Post for Me — plano de implementação

**Spec:** `docs/superpowers/specs/2026-08-05-post-for-me-migracao-design.md` — é a
fonte. Ele é um delta: o spec de ontem
(`2026-08-05-upload-post-multicanal-design.md`) continua valendo em tudo que o
delta não contradiz.

**Goal:** trocar o provider social por Post for Me, mantendo aprovação, alvo por
rede, agregação e poll intactos.

**Arquitetura:** conector novo (`src/integrations/social/post-for-me/`), contas em
vez de perfil, `ActionTarget.socialAccountId`, `DELIVERY_UNKNOWN` sem saída
automática.

## Global Constraints

Valem as do plano anterior, na íntegra. Reforçando as que esta migração estressa:

- **`back/` e `web/` são repos git independentes.** Commits separados.
- **Commit exige aprovação explícita.** `git add` + `git status`, sem `git commit`.
- **NUNCA `prisma migrate dev`.** Migração à mão + `pnpm prisma:deploy`.
- **Toda leitura de contas filtra por `external_id = ws-${req.tenant.workspaceId}`,
  e toda publicação envia apenas ids que aquela leitura devolveu.**
- **`access_token`/`refresh_token` nunca saem numa resposta nem num log.** O
  presenter lista campos por nome; nunca espalha o objeto do provider.
- **Nenhum teste toca a rede nem o Redis.** Cliente por opção de plugin
  (`socialClient`), fila por opção (`enqueue`).
- **`PUBLISHED` só a partir do poll**, com `platform_data.id` da fonte.
- **Falha de rede nunca retenta.**
- `operationId` + `response` em toda rota. Mensagem de erro nos três locales.
- `pnpm typecheck` limpo e `pnpm test` verde ao fim de cada task.

---

## Task 1: Conector Post for Me

**Arquivos:** criar `src/integrations/social/post-for-me/{post-for-me-client,platforms}.ts`
+ testes; apagar `src/integrations/social/upload-post/**`; reescrever
`src/integrations/social/index.ts`; `src/config/env.ts`;
`src/shared/errors/catalog.ts` + `src/lib/errors.ts` + 3 i18n.

**Produz:**

```ts
export type PostForMeConfig = { apiKey: string; baseUrl: string };
export type SocialFailureKind = 'AUTH' | 'VALIDATION' | 'RATE_LIMIT' | 'PROVIDER' | 'NETWORK' | 'UNKNOWN';
export class SocialProviderError extends Error { kind: SocialFailureKind; status?: number }
export function isRetriable(kind): boolean;      // RATE_LIMIT | PROVIDER
export function isIndeterminate(kind): boolean;  // NETWORK | UNKNOWN
export type SocialAccount = { id: string; platform: SocialPlatform; username: string | null; pictureUrl: string | null; connected: boolean };
export type PlatformOutcome = { socialAccountId: string; success: boolean; message: string | null; externalId: string | null; postUrl: string | null };
export type SocialClient = {
  connectUrl(input: { platform: SocialPlatform; externalId: string }, signal: AbortSignal): Promise<{ url: string }>;
  listAccounts(externalId: string, signal: AbortSignal): Promise<SocialAccount[]>;
  publishText(input: { caption: string; socialAccountIds: string[]; externalId: string }, signal: AbortSignal): Promise<{ postId: string }>;
  results(postId: string, signal: AbortSignal): Promise<PlatformOutcome[]>;
  disconnect(accountId: string, signal: AbortSignal): Promise<void>;
};
export function createSocialClient(config: PostForMeConfig): SocialClient;
export function socialExternalId(workspaceId: string): string; // `ws-${workspaceId}`
```

Cinco funções, não seis: `ensureProfile` desaparece (não há perfil) e `retry` some
(não existe endpoint).

- [ ] **Passo 1: `platforms.ts`.** `Record<SocialPlatform, string>` completo, com
  `LINKEDIN: 'linkedin'`, `X: 'x'`, `FACEBOOK: 'facebook'`, `THREADS: 'threads'`, e
  `platformFromSlug` devolvendo `null` para slug não modelado — nunca throw, pela
  mesma razão de antes: uma rede nova do provider não pode derrubar a listagem.

- [ ] **Passo 2: testes do cliente primeiro**, com `vi.stubGlobal('fetch', …)`:
  1. `connectUrl` manda `{platform, external_id}` e devolve `url`; sem `url` na
     resposta, lança `UNKNOWN` (uma URL vazia levaria o cliente a uma página em
     branco);
  2. header é `authorization: Bearer k`, e entra **por último** no spread — um
     header do caller não substitui a credencial da conta;
  3. `permissions` não pede `feeds`;
  4. `classify`: 401/403→AUTH, 400/404/405/422→VALIDATION, 429→RATE_LIMIT,
     5xx→PROVIDER, erro de `fetch`→NETWORK, resto→UNKNOWN;
  5. `isRetriable` e `isIndeterminate` disjuntos para todo kind;
  6. `listAccounts` filtra por `external_id` na query, mapeia
     `status: 'disconnected'` para `connected: false`, e **ignora** conta de
     plataforma não modelada;
  7. `listAccounts` **não devolve** `access_token` nem `refresh_token` no objeto
     que sai da função — teste com os dois presentes na resposta do provider;
  8. `publishText` manda `caption` + `social_accounts` e **nenhum `media`**;
     devolve `postId`; sem `id`, lança `UNKNOWN`;
  9. `results` mapeia `platform_data.{id,url}` para `externalId`/`postUrl`;
  10. `results` extrai mensagem de `error`/`details` sendo **objeto**, e cai numa
      frase nossa quando não há nada legível — nunca `"[object Object]"`;
  11. `disconnect` chama `POST /v1/social-accounts/{id}/disconnect`, e **nunca**
      `DELETE` (que destruiria o histórico).

- [ ] **Passo 3: rode e veja falhar.**

- [ ] **Passo 4: o cliente.** Espelhe `upload-post-client.ts` — que você vai
  apagar — em estrutura: um `request()` que classifica toda falha, schemas Zod de
  resposta **sem `.default()`**, e `classify` idêntico ao anterior (a tabela de
  evidência não muda de fornecedor). Diferenças: base `/v1`, `Bearer`, e o mapa de
  resposta por conta.

```ts
/** A mensagem legível de um `error`/`details` que o provider manda como objeto. */
function providerReason(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['message', 'error', 'detail']) {
      const inner = record[key];
      if (typeof inner === 'string' && inner.trim()) return inner;
    }
  }
  return null;
}
```

- [ ] **Passo 5: rode e veja passar.** Apague `upload-post/` e reescreva
  `social/index.ts` exportando só o novo. `grep -ri "upload-post\|uploadpost" src`
  tem de voltar vazio.

- [ ] **Passo 6: env.** `UPLOAD_POST_*` saem; entram `POST_FOR_ME_API_KEY`
  (opcional) e `POST_FOR_ME_BASE_URL` (default `https://api.postforme.dev`).
  `ACTION_POLL_MAX_ATTEMPTS` fica.

- [ ] **Passo 7: erros.** Renomeie as chaves `UPLOAD_POST_*` para `SOCIAL_*`
  **mantendo os códigos** `AUR-T0045..0049` — o significado não mudou, só o
  fornecedor. As classes viram `SocialNotConfiguredError`,
  `SocialNotConnectedError`, `SocialAccountNotConnectedError` (mantendo
  `details: { platform }`), `SocialRequestFailedError` (`details: { reason }`),
  `SocialPlanLimitError`. Mensagens nos três locales, sem citar fornecedor.

- [ ] **Passo 8:** `pnpm vitest run src/integrations/social/ src/shared/errors/` +
  `git add` + `git status`. **Sem commit.**

---

## Task 2: Contas em vez de perfil

**Arquivos:** `src/http/api/integrations/social-profile.service.ts` →
`social-accounts.service.ts`; `social-connect-link/` → `social-connect-url/`;
`social-accounts/`; `disconnect-social/` → `disconnect-social-account/`;
`integrations.{repository,schema,index}.ts`; `social.test.ts`.

**Produz:**

```ts
export const SOCIAL_PROVIDER = 'POST_FOR_ME';
export type SocialClientFactory = () => SocialClient;
export type SocialRoutesOptions = { social?: SocialClientFactory };
export async function ensureSocialIntegration(deps, workspaceId, userId): Promise<{ integrationId: string; externalId: string }>;
export async function findSocialIntegration(prisma, workspaceId): Promise<{ integrationId: string; externalId: string } | null>;
/** As contas do workspace, lidas ao vivo e filtradas por external_id. */
export async function listWorkspaceAccounts(deps, workspaceId): Promise<SocialAccount[]>;
```

`ensureSocialIntegration` **não chama o provider**: não há perfil a criar. Ela só
garante a linha local (selando `{}` como antes, e pela mesma razão). Some com ela o
tratamento de `409` e o `SocialPlanLimitError` no caminho de conexão — o código
fica no catálogo porque o provider pode recusar por plano em `publish`.

- [ ] **Passo 1:** `POST /integrations/social/connect-url`, body
  `{ platform }` validado pelo enum, `operationId: createSocialConnectUrl`,
  resposta `201 { url }`. `assertAdmin`. Garante a linha local, chama
  `connectUrl({ platform, externalId })`.

- [ ] **Passo 2:** `GET /integrations/social/accounts` — igual em forma, agora
  devolvendo `{ id, platform, username, pictureUrl, connected }`. Sem `assertAdmin`
  (o formulário de ação depende dela). Sem linha local ⇒ `{ accounts: [] }`, sem
  tocar o provider.

- [ ] **Passo 3:** `POST /integrations/social/accounts/:accountId/disconnect`,
  `operationId: disconnectSocialAccount`, `204`. `assertAdmin`. **Verifica que a
  conta pertence ao workspace** lendo as contas antes — um id de outra conta
  responde 404, nunca 403. `DELETE /integrations/social` é apagada.

- [ ] **Passo 4: testes** (`social.test.ts` reescrito): contrato do `connect-url`
  (o que foi enviado, incluindo `external_id` do workspace do token); `accounts`
  mapeando `disconnected`; **404 ao desconectar conta de outro workspace, sem
  chamar o provider**; 503 sem chave; e que **nenhuma resposta contém
  `access_token`** (o fake do provider devolve os dois).

- [ ] **Passo 5:** `git add` + `git status`. **Sem commit.**

---

## Task 3: O alvo aponta para uma conta

**Arquivos:** `prisma/schema.prisma` + migração; `actions.domain.ts`;
`actions.schema.ts`; `actions.platforms.ts`; `actions.repository.ts`;
`actions.presenter.ts`; `create-action/`, `update-action/`, `execute-action/`;
`src/actions/{processor,poll,queue,worker,reaper}.ts`; e os testes de todos.

- [ ] **Passo 1: schema.** `SocialPlatform` fica com quatro valores.
  `ActionTarget.socialAccountId String?`. `Action.providerRequestId` →
  `providerPostId`.

- [ ] **Passo 2: migração à mão** em
  `prisma/migrations/20260805190000_post_for_me/migration.sql`:

```sql
-- Sem dado de produção: os alvos existentes apontam para contas de um provider
-- que sai, e migrá-los produziria publicação para conta inexistente (spec §3).
-- Se isto rodar depois de qualquer publicação real, está errado.
DELETE FROM "ExternalReference" WHERE "entityType" = 'SOCIAL_POST_TARGET';
DELETE FROM "ActionTarget";
DELETE FROM "Approval";
DELETE FROM "Action";

ALTER TABLE "Action" RENAME COLUMN "providerRequestId" TO "providerPostId";
ALTER TABLE "ActionTarget" ADD COLUMN "socialAccountId" TEXT;

-- Postgres não remove valor de enum: o tipo é recriado sem DISCORD e TELEGRAM.
-- Seguro porque a tabela está vazia depois dos DELETEs acima.
ALTER TABLE "ActionTarget" ALTER COLUMN "platform" TYPE TEXT;
DROP TYPE "SocialPlatform";
CREATE TYPE "SocialPlatform" AS ENUM ('LINKEDIN', 'X', 'FACEBOOK', 'THREADS');
ALTER TABLE "ActionTarget" ALTER COLUMN "platform" TYPE "SocialPlatform" USING "platform"::"SocialPlatform";
```

Rode `pnpm prisma:deploy` e `pnpm prisma:generate`. Se o `ALTER TYPE` reclamar,
**pare e reporte** — não improvise um enum paralelo.

- [ ] **Passo 3: domínio.** `DELIVERY_UNKNOWN` sai de `EXECUTABLE_FROM`, e a
  aresta `DELIVERY_UNKNOWN → EXECUTING` sai de `TRANSITIONS`. Comentário
  explicando: sem endpoint de retry, não há id que o provider reconheça para
  retentar, e retentar às cegas duplica post público. As saídas continuam
  `EXECUTED`, `PARTIALLY_EXECUTED` e `APPROVED`, todas por ato humano. Atualize
  `actions.domain.test.ts` — inclusive o teste que hoje afirma o contrário.

- [ ] **Passo 4: criação.** `assertPlatformsConnected` vira
  `resolveTargetAccounts(deps, workspaceId, platforms) → Map<platform, accountId>`:
  lê as contas do workspace, recusa plataforma sem conta **conectada** com
  `SocialAccountNotConnectedError({ platform })`, e devolve o id a gravar no alvo.
  `createWithTargets` passa a receber `{platform, socialAccountId}[]`.

- [ ] **Passo 5: execução.** No processor: sem `providerPostId`, `publishText` com
  os `socialAccountId` dos alvos publicáveis; **com** `providerPostId`, não há
  retry de provider — publica de novo **apenas** os alvos `PENDING`/`FAILED`, e
  grava o `postId` novo. Alvo sem `socialAccountId` é `FAILED` com mensagem clara
  (não deveria existir; é a guarda).
  No poll: `results(postId)` casado por `socialAccountId`, não por plataforma.
  `queue`, `worker` e `reaper` mudam só no nome do campo.

- [ ] **Passo 6: testes.** Adapte os 52 de `src/actions/` e os 18 de execução.
  Casos novos obrigatórios:
  - publicar manda ids de conta, e **só** os dos alvos publicáveis;
  - um `socialAccountId` que não pertence ao workspace **não** chega ao provider;
  - `DELIVERY_UNKNOWN` não é executável: a rota recusa com
    `ACTION_NOTHING_TO_PUBLISH`;
  - `results` com `error` objeto vira mensagem legível no alvo.

- [ ] **Passo 7:** `pnpm typecheck`, `pnpm test`, `pnpm openapi:dump` (sem
  `git add` do `api.json` — é do outro repo), `git add` + `git status`. **Sem commit.**

---

## Task 4: Web — contas em vez de redes

**Arquivos:** `SocialSourceCard.tsx`, `PlatformPicker.tsx` → `AccountPicker.tsx`,
`ActionTargetList.tsx`, `ActionNewPage.tsx`, `ActionDetailPage.tsx`, `PlatformNames.ts`,
os 3 locales, e os testes de todos. `pnpm api:generate` primeiro.

- [ ] **Passo 1:** `pnpm api:generate`. Hooks de mutação com path param recebem
  `{ accountId }` / `{ id, data }` — **não** `{ params }`.

- [ ] **Passo 2: `SocialSourceCard`** — um botão por rede **não conectada**
  (`window.open(url)` do `connect-url`), a conta conectada listada com
  `username` e foto, conta `disconnected` com o rótulo de reconectar (que é o botão
  daquela rede), e desconectar **por conta** com `AlertDialog` nomeando a rede.
- [ ] **Passo 3: `AccountPicker`** — escolhe contas, rótulo `LinkedIn · @acme`,
  conta desconectada desabilitada com o motivo. O `platforms` do body vira
  `platforms: [{ platform, socialAccountId }]`? **Não**: o backend resolve a conta
  a partir da plataforma (Task 3, passo 4), então o body continua
  `platforms: string[]`. O picker escolhe conta e envia a plataforma dela — e
  recusa duas contas da mesma rede na mesma ação, porque o alvo é unique por
  `[actionId, platform]`.
- [ ] **Passo 4: i18n** nos três locales: `PLATFORM_LABEL` perde Discord e
  Telegram; a cópia de vazio do card explica que Instagram e TikTok chegam com
  mídia. Nenhuma cópia nova repete outra — o teste de `getByText` quebra com
  duplicata.
- [ ] **Passo 5:** testes de cada componente e das páginas; `pnpm typecheck`;
  `pnpm vitest run`; `git add` + `git status`. **Sem commit.**

---

## Ordem e bateladas

1 → 2 → 3 → 4, sequencial. Duas bateladas: **1-2** (conector e contas) e
**3-4** (alvo com conta, e web).

`pnpm typecheck` fica vermelho entre a Task 1 e a Task 3, pelos chamadores do
conector antigo. Limpo ao fim da batelada 2.

## Verificação final

- `pnpm typecheck` limpo nos dois repos; `pnpm test` verde nos dois, contagem
  informada (baseline back 1311/136, web 771/105 — a do back **cai** com os testes
  do conector antigo).
- `pnpm prisma migrate status` → up to date.
- `grep -ri "upload-post\|uploadpost" back/src web/src` vazio.
- `grep -rn "access_token\|refresh_token" back/src` só no conector.
- Nenhum teste importando o cliente real ou a fila real.
