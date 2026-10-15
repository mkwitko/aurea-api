# Ações executáveis: Action, Approval e publicação via Postiz — Design

Data: 2026-08-04
Escopo: `aurea-back` + `aurea-web`
Origem: `docs/development/phase-08-social.md`, recortado. Este design é a **fatia fina** dessa fase — ver §12 para o que ficou de fora e por quê.

---

## 1. Problema

O loop de AUREA mede sozinho desde hoje. Ele não age.

O que existe: Goal, Strategy, Hypothesis, Experiment, relógio de domínio que move `APPROVED → RUNNING → COMPLETED` pelas datas, conexão GA4 por OAuth, leitura automática da métrica amarrada, Outcome com proveniência, Learning. O fundador declara um experimento, AUREA lê o número da fonte e ele confirma.

O que falta é o meio: entre "este experimento existe" e "este número apareceu", alguém tem de **fazer** a coisa. Hoje esse alguém é sempre o humano, fora de AUREA, sem registro. O experimento diz "post no Instagram sobre redução de custo operacional" e o post é escrito no celular, publicado à mão, e nada em AUREA sabe que aconteceu.

Isso é o primeiro comportamento de Operator (`CLAUDE.md` §9): o sistema analisa, propõe e **executa ações aprovadas**. Não é autonomia — é execução com humano no gatilho.

### 1.1 Nada disto existe ainda

Nenhum dos três modelos deste design está no schema: não há `Action`, não há `Approval`, não há `ExternalReference`. A phase-07 (conteúdo) nunca foi implementada, então também não existe "approved CONTENT_DRAFT Action" de onde partir — este design cria a Action e o conteúdo dela.

O que existe e é reusado sem alteração:

- `WorkspaceIntegration` com credencial selada (AES-256-GCM, `seal`/`open` de `src/billing/crypto.ts`).
- O padrão de connector (`src/integrations/analytics/ga4/`) e de verificação na gravação (`verify-integration.ts`).
- A fila BullMQ e o processo de worker separado (`src/ai/queue/`, `src/worker.ts`), com heartbeat e reaper.
- A família de nove *fill agents* (`src/ai/agents/fill/`) e seu contrato.
- O catálogo de erros (`src/shared/errors/catalog.ts`, até `AUR-T0040`) com três bundles i18n.
- Tabela de transições por recurso (`experiments.domain.ts`).

---

## 2. Decisões tomadas antes do design

Registradas porque cada uma corta trabalho, e porque quem ler o plano precisa saber que não são omissões:

1. **Fatia fina, não a phase-08 inteira.** Uma Action `SOCIAL_POST` escrita pelo fundador (com assistência de IA), aprovada por humano, publicada no Postiz. Ponta a ponta, um spec.
2. **Postiz self-hosted, credencial por workspace.** API key + base URL do fundador, selada em `WorkspaceIntegration`. Não há instância compartilhada de AUREA: as contas sociais de clientes diferentes não vão para o mesmo Postiz.
3. **`experimentId` é opcional.** A Action pode existir solta. Consequência aceita: AUREA pode ser usada como agendador de posts sem hipótese. Consequência de projeto: a Action tem página própria (`/app/actions`), não apenas uma aba do experimento.
4. **Aprovador é OWNER/ADMIN, e o autor pode aprovar a própria.** Em workspace de fundador solo, exigir um segundo par de olhos travaria o piloto inteiro. Mas em **dois atos**: aprovar nunca acontece no mesmo request que cria, e o `Approval` grava `requestedBy` e `reviewedBy` separados. Aprovação embutida na criação seria só o nome de quem escreveu.
5. **Execução por fila.** Não síncrona. Retry com backoff, e o worker é o único lugar que escreve no Postiz.
6. **Sem `riskLevel` e sem `requiresApproval`.** `persistance-model.md` §21 os prevê; este design não os implementa. Publicar em canal público é sempre consequencial, e um campo que permite dispensar a aprovação é autonomia (phase-11) entrando pela porta dos fundos. Quando phase-11 chegar, ela adiciona os campos com a política que os justifica.

---

## 3. A API do Postiz, como ela é

Verificada na documentação oficial, não de memória. Os fatos que mudam o design:

```text
Base URL (self-hosted): {baseUrl}/public/v1
Autenticação:           Authorization: <apiKey>        ← cru, sem "Bearer"
```

**`GET /integrations`** — lista os canais já conectados **dentro do Postiz**:

```json
[{ "id": "...", "name": "...", "providerIdentifier": "instagram", "picture": "..." }]
```

**`POST /posts`** — cria o post:

```json
{
  "type": "now",
  "posts": [
    {
      "integration": { "id": "<channelId>" },
      "value": [{ "content": "<texto>" }],
      "settings": { "__type": "<providerIdentifier>" }
    }
  ]
}
```

Resposta: `{ "id": "post_12345", "createdAt": "...", "updatedAt": "...", "state": "..." }`.

**`GET /posts?startDate&endDate`** — lista por janela de datas, com `state` em `QUEUE | PUBLISHED | ERROR | DRAFT` e `releaseURL`.

Quatro consequências, todas load-bearing:

### 3.1 Conectar contas sociais não é nosso

`GET /integrations` devolve o que o fundador já ligou **no Postiz**. Autorizar Instagram, X ou LinkedIn acontece lá. AUREA só escolhe entre o que existe.

Isso apaga `phase-08-social.md` §2.3 (Connect Account / Disconnect Account / Get Profile) do escopo. A tela precisa **dizer** isso, com link para o Postiz do fundador: sem esse texto ele procura em AUREA um botão que não existe e conclui que o produto está quebrado.

### 3.2 Não existe idempotency-key

`phase-08-social.md` §2.7 diz "Provider request: idempotency-key = action-123". A API do Postiz não aceita esse header. A idempotência tem de ser inteiramente nossa — §6.

### 3.3 `POST /posts` não devolve a URL do post

Só `id` e `state`. `releaseURL` aparece apenas no `GET /posts`, que busca por janela de datas e **não** por id. Então nesta fatia não há link "ver no canal", e não há como confirmar publicação consultando o provider por id.

### 3.4 Publicar é assíncrono lá dentro

O `state` na criação é `QUEUE`. Virar `PUBLISHED` ou `ERROR` acontece depois, dentro do Postiz. Consequência de vocabulário, que a tela obedece: **`EXECUTED` em AUREA significa "entregue ao Postiz", não "publicado no Instagram."**

É a mesma família de `COMPLETED ≠ sucesso` dos experimentos. A tela mostra "entregue ao Postiz" com o `state` cru do provider ao lado, e não afirma publicação que ninguém confirmou. Confirmar de verdade exige webhook — fora desta fatia (§12).

---

## 4. Modelos

### 4.1 `Action`

Campos de `persistance-model.md` §21 e §22, menos os dois de §2.6:

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
  heartbeatAt  DateTime?
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt

  workspace  Workspace   @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  experiment Experiment? @relation(fields: [experimentId], references: [id], onDelete: SetNull)
  approvals  Approval[]

  @@index([workspaceId])
  @@index([experimentId])
  @@index([workspaceId, status])
}
```

`onDelete: SetNull` no experimento: apagar um experimento não pode apagar o registro de um post que foi publicado no mundo.

`heartbeatAt` existe para o reaper (§7.3), pela mesma razão que o `AgentRun` tem um: separa lento de morto.

`goalId` e `strategyId` de `persistance-model.md` §21 ficam fora — quando há experimento, os dois são alcançáveis por ele; quando não há, a Action é solta por decisão (§2.3) e não haveria o que preencher.

### 4.2 Payload de `SOCIAL_POST`

```ts
export const socialPostPayload = z.object({
  channelId: z.string().min(1).max(128),
  channelName: z.string().min(1).max(200),
  providerIdentifier: z.string().min(1).max(64),
  content: z.string().min(1).max(5000),
});
```

`channelName` e `providerIdentifier` são **snapshot deliberado**. A lista de canais é lida ao vivo no Postiz e nunca persistida (§5.3); sem o snapshot, a Action de ontem não saberia dizer para onde foi, e uma Action executada precisa saber isso mais do que precisa estar atualizada.

`providerIdentifier` vira `settings.__type` na chamada. Validação por tipo mora em `actions.payload.ts` com união discriminada por `type`, mesmo com um tipo só: é o que faz o segundo tipo custar um `case` em vez de uma refatoração.

**Limitação conhecida:** alguns provedores do Postiz exigem campos extras em `settings` (subreddit no Reddit, título no YouTube). Esta fatia manda apenas `__type`, então esses canais respondem 400. O erro do provider sobe literal ao fundador (§7.2, `VALIDATION`) em vez de virar "falha ao publicar". Não há allowlist de canais: esconder o canal seria esconder que o Postiz dele o suporta.

### 4.3 `Approval`

Campos de `persistance-model.md` §27, sem `EXPIRED`:

```prisma
enum ApprovalStatus {
  PENDING
  APPROVED
  REJECTED
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
```

`EXPIRED` fica fora porque nada expira nesta fatia — não há prazo de aprovação, e um status que nenhum código escreve é vocabulário morto.

**Uma Action tem vários `Approval`.** Rejeitar devolve a Action a `PROPOSED`; o fundador corrige e submete de novo, criando um segundo `Approval`. O histórico é a lista; `Action.status` é a verdade. A tela mostra os dois.

### 4.4 `ExternalReference`

Campos de `persistance-model.md` §29, mais `workspaceId`:

```prisma
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

  workspace   Workspace           @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  integration WorkspaceIntegration @relation(fields: [integrationId], references: [id], onDelete: Cascade)

  @@unique([integrationId, entityType, externalId])
  @@unique([integrationId, entityType, entityId])
  @@index([workspaceId])
  @@index([entityType, entityId])
}
```

`workspaceId` é redundante com `integrationId` e existe assim mesmo: isolamento de tenant é regra de repositório, e uma tabela onde o `where` precisa de um join para ser escopado é uma tabela onde alguém vai esquecer o join.

A primeira unique é a do doc: um `externalId` do provider mapeia uma coisa só.

A segunda é deste design, e é a trava de duplicação no banco: **uma Action não pode ter dois posts na mesma integração.** Se a corrida de §6 vazar por alguma fenda que não previmos, o insert falha em vez de publicar duas vezes.

---

## 5. Conexão com o Postiz

### 5.1 Onde a credencial mora

Reusa `WorkspaceIntegration`:

```text
provider:     'POSTIZ'
authKind:     'API_KEY'
externalId:   null            (não há property a escolher)
accountLabel: host do baseUrl  (ex.: "postiz.acme.com")
credencial:   seal(JSON.stringify({ apiKey, baseUrl }))
```

`@@unique([workspaceId, provider])` continua valendo: uma conexão Postiz por workspace. `externalId` já é nulável desde `b5cad5d`.

**O segredo nunca sai numa resposta.** Nenhuma rota devolve `ciphertext`, `iv`, `authTag` nem `apiKey`. `accountLabel` é o host, e host não é segredo.

### 5.2 Rota própria de gravação

`PUT /integrations/postiz`, e **não** o `PUT /integrations` existente. Aquele body exige `externalId: z.string().regex(/^\d+$/, 'the GA4 property id is only digits')`. Enfiar Postiz ali criaria uma união onde metade dos campos é ignorada dependendo do provider, e a mensagem de validação mentiria sobre o que se espera.

```ts
export const putPostizBody = z.object({
  apiKey: z.string().min(1).max(512),
  baseUrl: z.string().url().max(512),
});
```

Verificação na gravação: `GET {baseUrl}/public/v1/integrations`, timeout 10s — é uma listagem, não um relatório. Mesmo formato de `verify-integration.ts`: `{ ok: true, accountLabel }` ou `{ ok: false, reason }`, e o status guardado é `OK` ou `FAILED` com a mensagem do provider. Uma credencial que não responde ainda é gravada, com o erro visível: gravar é a escolha do fundador, e recusar silenciosamente esconderia um Postiz que está apenas fora do ar.

`baseUrl` normalizado sem barra final antes de selar, porque `{baseUrl}/public/v1` com barra dupla é 404 em alguns proxies.

`DELETE /integrations/:provider` já funciona sem alteração: o `revoke` best-effort só age quando `authKind === 'OAUTH'`.

### 5.3 Canais, lidos ao vivo

`GET /integrations/postiz/channels` → `{ channels: [{ id, name, providerIdentifier, picture }] }`.

Proxy da chamada ao Postiz, com a credencial aberta no servidor. Nada de canal é persistido: sincronizar uma cópia de algo que muda do outro lado é dívida que aparece como canal fantasma no formulário. Mesma decisão do `PropertyPicker` do GA4.

Sem conexão Postiz: `POSTIZ_NOT_CONNECTED` (400). O Postiz respondendo erro: `POSTIZ_REQUEST_FAILED` (502) com o `reason` do provider.

---

## 6. Idempotência, sem idempotency-key

Publicar duas vezes é dano público e irreversível pelo nosso lado. Sem header de idempotência no provider (§3.2), três camadas, nesta ordem:

**1. Compare-and-swap na transição.** A rota de execução não lê-e-depois-escreve:

```ts
const { count } = await prisma.action.updateMany({
  where: { id, workspaceId, status: { in: ['APPROVED', 'FAILED'] } },
  data: { status: 'EXECUTING', attempts: { increment: 1 } },
});
if (count === 0) throw new ConflictError('This action is not waiting to be executed');
```

Dois cliques simultâneos não podem ambos encontrar um estado executável. Só quem ganhou o `updateMany` enfileira.

`FAILED` está no `in` porque reexecutar uma falha é ato humano legítimo (§7.2) — e a corrida a proteger é a mesma: dois cliques em "tentar de novo".

**2. `jobId = actionId`.** O BullMQ recusa job duplicado enquanto ele existe na fila. Não é a defesa principal — `removeOnComplete` eventualmente apaga o job — mas fecha a janela quente.

**3. `ExternalReference` no começo do processor.** Antes de tocar na rede:

```ts
const existing = await prisma.externalReference.findFirst({
  where: { workspaceId, entityType: 'SOCIAL_POST', entityId: actionId },
});
if (existing) { /* já publicou: marca EXECUTED e sai sem chamar o Postiz */ }
```

É a checagem que `phase-08-social.md` §2.7 pede ("Before executing, the system checks for an existing ExternalReference"), e a segunda unique de §4.4 é o que a garante no banco quando a checagem perde a corrida.

---

## 7. Execução

### 7.1 O caminho

```text
POST /actions/:id/execute   (OWNER/ADMIN)
   ↓ CAS APPROVED → EXECUTING, attempts += 1
   ↓ enfileira { actionId }, jobId = actionId
   → 202 Accepted
   
worker (processo separado)
   ↓ ExternalReference já existe? → EXECUTED, fim
   ↓ carimba heartbeatAt
   ↓ abre a credencial POSTIZ, monta o cliente
   ↓ POST {baseUrl}/public/v1/posts   type: 'now'
   ↓ grava ExternalReference(SOCIAL_POST, actionId, post.id, { state, channelId })
   → EXECUTED, executedAt = now
```

Fila `action-executions`, `attempts: 3`, backoff exponencial de 5s, `removeOnComplete: { age: 3_600 }`, `removeOnFail: { age: 86_400 }` — espelhando `src/ai/queue/queue.ts`. O worker sobe em `src/worker.ts` ao lado do de agentes, no mesmo processo e pela mesma razão: a API reinicia a cada deploy, e trabalho em voo não pode morrer com ela.

O processor é **o único lugar do sistema que escreve no Postiz.**

### 7.2 Classificação de falha, e retry que não duplica post

Retry cego é o perigo central: a tentativa 1 publicou e morreu antes de gravar, a tentativa 2 publica de novo. Então a política não pergunta "isto é transiente?" — pergunta **o que se sabe sobre a chamada**:

| Falha | O que se sabe | `failureKind` | Decisão |
|---|---|---|---|
| 401 / 403 | Postiz respondeu; não criou | `AUTH` | `FAILED`, sem retry — backoff não conserta API key errada |
| 400 | respondeu; não criou | `VALIDATION` | `FAILED`, sem retry — mesmo payload, mesmo 400 |
| 429 | respondeu; não criou | `RATE_LIMIT` | relança: BullMQ retenta com backoff |
| 5xx | respondeu; quase certamente não criou | `PROVIDER` | relança: BullMQ retenta com backoff |
| timeout, socket, DNS, `AbortError` | **nada** | `NETWORK` | `DELIVERY_UNKNOWN`, **nunca** retenta |
| qualquer outra | nada | `UNKNOWN` | `DELIVERY_UNKNOWN`, nunca retenta |

`phase-08-social.md` §2.11 diz "transient failures are retried with controlled backoff" e lista `Network Error` entre as transientes. **Este design discorda ali, de propósito:** uma falha de rede é o caso em que não se sabe se o post existe, e é exatamente o caso em que retentar duplica. Erro de rede é o único que precisa de humano, não de backoff.

`FAILED` e `DELIVERY_UNKNOWN` são gravados pelo processor com `lastError` = a mensagem do provider, e o job **não** relança nesses casos: relançar produziria retry que a tabela acabou de proibir.

De `FAILED` a Action volta a ser executável por ato humano (`POST /actions/:id/execute` aceita `FAILED` como origem além de `APPROVED`) — a checagem de `ExternalReference` do §6 protege o caso de o `FAILED` ter sido classificado errado.

### 7.3 `DELIVERY_UNKNOWN`, o oitavo estado

`persistance-model.md` §21 lista sete status. Este design adiciona um, porque a API do Postiz obriga.

Quando a chamada morre sem resposta — timeout, socket fechado, ou o processo do worker derrubado no meio — o post **pode** existir do outro lado, e não há como perguntar: `GET /posts` busca por janela de datas, nunca por id (§3.3).

- `FAILED` mentiria, e a mentira convida a republicar → post duplicado num canal público.
- `EXECUTED` mentiria na direção oposta, e o fundador contaria com um post que não existe.

O nome diz o que se sabe: não se sabe. Sai dele **somente por ato humano**:

```text
POST /actions/:id/resolve    (OWNER/ADMIN, só de DELIVERY_UNKNOWN)
  { outcome: 'PUBLISHED',     externalId?: string }  → EXECUTED
  { outcome: 'NOT_PUBLISHED' }                       → APPROVED (reexecutável)
```

Com `externalId` informado, grava o `ExternalReference` correspondente; sem ele, marca `EXECUTED` sem referência — porque um `externalId` inventado é pior que a ausência dele.

A tela desse estado não oferece "tentar de novo" como botão neutro: ela manda conferir o canal primeiro, com o nome do canal e o horário da tentativa.

### 7.4 O reaper

Mesmo padrão de `startStaleRunReaper` (`src/ai/queue/worker.ts`), no mesmo processo: intervalo fixo, `unref`, busca `Action` em `EXECUTING` com `heartbeatAt` mais velho que o limite (ou nulo, com `updatedAt` velho) e move para `DELIVERY_UNKNOWN` com `lastError` dizendo há quanto tempo não há sinal.

Não para `FAILED`, pela razão de §7.3: o processo morto pode ter publicado.

---

## 8. Rotas

`src/http/api/actions/`, slice por use-case. `workspaceId` sempre de `req.tenant`, nunca de body, query ou params.

| Rota | Transição | Autorização |
|---|---|---|
| `POST /actions` | → `PROPOSED` | `assertWriter` |
| `GET /actions` (filtros `status`, `experimentId`) | — | autenticado |
| `GET /actions/:id` | — | autenticado |
| `PATCH /actions/:id` | só em `PROPOSED` | `assertWriter` |
| `POST /actions/:id/submit` | `PROPOSED` → `PENDING_APPROVAL`, cria `Approval(PENDING)` | `assertWriter` |
| `POST /actions/:id/approve` | `PENDING_APPROVAL` → `APPROVED`, `approvedAt` | `assertApprover` |
| `POST /actions/:id/reject` (`comment` obrigatório) | `PENDING_APPROVAL` → `PROPOSED` | `assertApprover` |
| `POST /actions/:id/cancel` | `PROPOSED`/`PENDING_APPROVAL`/`APPROVED` → `CANCELLED` | `assertWriter` |
| `POST /actions/:id/execute` → **202** | `APPROVED`/`FAILED` → `EXECUTING` (CAS) + enfileira | `assertApprover` |
| `POST /actions/:id/resolve` | `DELIVERY_UNKNOWN` → `EXECUTED`/`APPROVED` | `assertApprover` |

`operationId` e `response` em toda rota — sem eles não há contrato OpenAPI nem hook Kubb.

`assertApprover(tenant)` é novo e mais estrito que `assertWriter`: só `OWNER` e `ADMIN`. Executar exige aprovador, e não apenas escritor, porque executar é o ato que sai para o mundo.

`reject` exige `comment` não vazio: uma rejeição sem motivo devolve o trabalho ao autor sem dizer o que corrigir.

### 8.1 Transições

`actions.domain.ts`, no formato de `experiments.domain.ts`:

```ts
export const TRANSITIONS: Record<ActionStatus, ActionStatus[]> = {
  PROPOSED:         [PENDING_APPROVAL, CANCELLED],
  PENDING_APPROVAL: [APPROVED, PROPOSED, CANCELLED],
  APPROVED:         [EXECUTING, CANCELLED],
  EXECUTING:        [EXECUTED, FAILED, DELIVERY_UNKNOWN],
  FAILED:           [EXECUTING, CANCELLED],
  DELIVERY_UNKNOWN: [EXECUTED, APPROVED],
  EXECUTED:         [],
  CANCELLED:        [],
};
```

`EXECUTED` e `CANCELLED` são terminais. `EXECUTING` só sai pelo worker ou pelo reaper.

### 8.2 Erros novos

| Nome | Código | Status | Quando |
|---|---|---|---|
| `POSTIZ_NOT_CONNECTED` | `AUR-T0041` | 400 | executar ou listar canais sem conexão Postiz |
| `POSTIZ_CHANNEL_NOT_FOUND` | `AUR-T0042` | 400 | o `channelId` do payload não está mais nos canais do Postiz |
| `POSTIZ_REQUEST_FAILED` | `AUR-T0043` | 502 | o Postiz recusou uma leitura nossa; `details: { reason }` |
| `ACTION_NOT_RESOLVABLE` | `AUR-T0044` | 409 | `resolve` numa Action que não está em `DELIVERY_UNKNOWN` |

502 em `POSTIZ_REQUEST_FAILED` pela mesma razão de `MEASUREMENT_READ_FAILED`: a requisição está correta e o recurso existe, quem recusou foi o provider. Um 400 mandaria o fundador corrigir o que ele acertou.

As quatro entram nos três bundles (`pt-BR`, `en-US`, `es-ES`) — o teste de paridade de chaves não deixa passar menos que isso.

---

## 9. Assistência de IA

`propose-social-post`, décimo agente da família `fill/`, mesmo contrato dos outros nove:

```text
taskType:    'propose_social_post'
tier:        baixo
input:       { experimentId?: string, providerIdentifier: string, brief?: string }
tools:       get-business-context, get-icp, e get-hypothesis quando há experimento
output:      { content: string, rationale: string }
```

Ele **preenche o campo do formulário**. Não cria a Action, não submete, não aprova. Confirmar segue sendo humano — é a regra da casa, e aqui ela é mais que estética: o texto vai para um canal público com o nome da empresa.

`rationale` aparece na tela ao lado do conteúdo proposto, como nos outros fill agents: um texto que o fundador vai publicar merece dizer por que ficou assim.

---

## 10. Frontend

Tailwind + shadcn/ui, hooks gerados pelo Kubb, i18next em `pt-BR`/`en-US`/`es-ES`. Sem `fetch` cru, sem CSS solto, sem `style={{}}`.

- **`/app/actions`** — lista com badge de status, filtro por status, botão de criar. Entrada no `secondaryNav` do `AppLayout`.
- **Formulário de criação** — canal (lido ao vivo do Postiz), conteúdo com botão de IA, experimento opcional. Sem conexão Postiz, o formulário não finge: mostra o caminho para conectar.
- **Detalhe da Action** — conteúdo, canal, histórico de `Approval` (quem pediu, quem revisou, comentário), e os botões conforme o estado. `EXECUTED` mostra "entregue ao Postiz" com o `state` cru do provider ao lado, nunca "publicado".
- **Painel de `DELIVERY_UNKNOWN`** — o texto que manda conferir o canal, com nome do canal e horário da tentativa, e só então os dois botões (*já publicou* / *não publicou*).
- **`EXECUTING`** faz polling, no padrão dos agent runs.
- **Card Postiz** na tela de integrações existente, ao lado do GA4, com o aviso de §3.1: conectar Instagram/X/LinkedIn acontece dentro do Postiz, com link para a instância do fundador.

Termos de domínio (`Action`, `Approval`, "entregue ao Postiz") ganham `Help`, como o resto do produto.

---

## 11. Testes

Regra que não se negocia: **nenhum teste toca a rede.** O cliente Postiz entra por opção de plugin (`{ postiz?: PostizClient }`), no padrão de `{ verify? }` / `{ read? }` / `{ list? }` já usado nas integrações. Um teste que esquecesse de decorar sairia falando com o Postiz de dentro da suíte — foi por isso que este seam existe nos outros.

Cobertura obrigatória:

- Isolamento de tenant em toda rota: id de outro workspace lê como 404.
- Cada transição inválida da tabela §8.1 recusada com o código próprio.
- `VIEWER` recusado em toda escrita; `MEMBER` recusado em `approve`, `execute` e `resolve`.
- Aprovar não pode acontecer no mesmo request que cria (não existe rota que faça as duas coisas).
- CAS: com a Action já em `EXECUTING`, `execute` responde 409 e **não** enfileira.
- Processor: com `ExternalReference` existente, `EXECUTED` sem nenhuma chamada ao cliente.
- Uma linha por classificação de falha da tabela §7.2, cada uma verificando o status final **e** se relançou ou não.
- Rede morta → `DELIVERY_UNKNOWN`, e o cliente **não** chamado uma segunda vez.
- Reaper: `EXECUTING` sem heartbeat → `DELIVERY_UNKNOWN`; `EXECUTED` intacto.
- `resolve` fora de `DELIVERY_UNKNOWN` → `AUR-T0044`.
- Credencial: nenhuma resposta contém `apiKey`, `ciphertext`, `iv` ou `authTag`.
- Paridade de chaves nos três bundles i18n.

---

## 12. Fora de escopo

Cortado desta fatia, com a razão:

- **`type: 'schedule'` e `type: 'draft'`.** Só `now`. Agendar é um campo de data e uma decisão sobre de quem é o relógio — nosso ou do Postiz — que merece seu próprio parágrafo.
- **Mídia e imagem.** Exige o endpoint de upload do Postiz mais nosso storage no meio.
- **Webhooks e validação de assinatura.** É o que faria `EXECUTED` significar "publicado" de verdade. Maior peça do que sobrou da phase-08.
- **`GET /metrics` do post.** Depende do webhook para saber quando faz sentido buscar.
- **DLQ.** `attempts: 3` e depois `FAILED` visível na tela já dá ao humano o que uma DLQ daria, sem infra nova.
- **`ExternalReference` para conta social** (`entityType: 'SOCIAL_ACCOUNT'`). Não há conta social nossa a mapear (§3.1).
- **Outros `ActionType`.** `SOCIAL_POST` só. A união discriminada do payload é o ponto de extensão.
- **Conectores diretos de plataforma.** Postiz cobre 28 canais; um conector direto se justifica quando um canal precisar de algo que ele não faz.
- **`Outcome.actionId`** (`persistance-model.md` §23). A medição hoje é por experimento, e ligar Outcome a Action muda o significado de proveniência — decisão para quando houver mais de um tipo de Action.
- **Eventos no Event Bus** (`ActionExecuted`, `ExternalActionFailed`). Não existe EventBus implementado; inventar um para dois eventos que ninguém consome é infra sem consumidor.
- **Autonomia.** Nada publica sem aprovação humana explícita. É phase-11, e é o motivo de `riskLevel` não existir aqui (§2, decisão 6).

---

## 13. Critérios de saída

```text
O fundador conecta um Postiz self-hosted colando API key e base URL, e vê o estado da conexão.
A tela deixa claro que conectar contas sociais acontece dentro do Postiz.
Os canais do Postiz aparecem ao vivo no formulário de Action.
Uma Action SOCIAL_POST é criada com conteúdo escrito à mão ou proposto por IA.
Nenhuma Action é executada sem aprovação humana explícita, em ato separado da criação.
MEMBER propõe e submete; só OWNER/ADMIN aprova, executa e resolve; VIEWER não escreve.
Rejeitar devolve a Action a PROPOSED com o comentário, e o histórico de Approval fica visível.
Executar enfileira e responde 202; o worker publica e grava ExternalReference.
Duas execuções simultâneas da mesma Action produzem um post, não dois.
Uma Action com ExternalReference já gravado não chama o Postiz de novo.
Falha de autenticação e de validação falham na hora, sem retry.
429 e 5xx retentam com backoff.
Falha de rede vai para DELIVERY_UNKNOWN e nunca retenta sozinha.
Um worker derrubado no meio deixa a Action em DELIVERY_UNKNOWN, não em FAILED.
A tela de DELIVERY_UNKNOWN manda conferir o canal antes de oferecer qualquer botão.
A tela nunca afirma "publicado" — diz "entregue ao Postiz" e mostra o state do provider.
Nenhuma resposta da API contém apiKey, ciphertext, iv ou authTag.
Nenhum teste toca a rede.
```
