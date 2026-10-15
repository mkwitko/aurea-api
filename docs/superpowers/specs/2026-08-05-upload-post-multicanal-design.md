# Publicação multicanal via Upload-Post — design

**Data:** 2026-08-05
**Status:** aprovado para plano
**Substitui:** `2026-08-04-acoes-execucao-postiz-design.md` (o Postiz é aposentado; ver §13)

---

## 1. O problema

O que existe hoje funciona e não serve. Uma Action publica **um** post em **um**
canal, e para chegar até ali o cliente precisa: criar conta num segundo produto
(Postiz), conectar as redes dentro dele, gerar uma API key numa tela de
desenvolvedor, e colar essa key na AUREA. Quatro passos, dois produtos, um token
copiado à mão.

O requisito é outro: **o cliente conecta as redes dele com um clique, dentro da
AUREA, e publica em todas de uma vez.**

O Postiz não entrega isso e não é questão de esforço: a API pública dele expõe
`GET /integrations` e `POST /posts`, e **nenhum endpoint para iniciar a conexão
de um canal**. Autorizar o Instagram acontece na interface do Postiz, e ponto.
O teto do self-host é "um popup com a marca de outro produto no meio do fluxo".

A Upload-Post entrega. O fluxo inteiro é três chamadas nossas, e o cliente nunca
vê a marca dela.

## 2. Decisões tomadas

| # | Decisão | Consequência aceita |
|---|---|---|
| 1 | **Upload-Post** como provider social | Os tokens das redes dos clientes ficam no fornecedor, não conosco. É o preço do "poucos cliques" — nenhuma opção com fluxo de conexão por API guarda os tokens localmente. |
| 2 | **Só texto** nesta fatia | Instagram, TikTok e YouTube **não entram**: exigem mídia (§2.4). Não vão nem aparecer para conectar. |
| 3 | **Postiz aposentado**, código apagado | Perde-se a opção self-host. Menos dois conectores para manter. |
| 4 | **Uma Action, N redes** | Desfecho por rede; a máquina de estados da Action muda (§4). É a parte grande do trabalho. |
| 5 | Escopo **sem** webhooks | O poll de `GET /uploadposts/status` já dá a verdade autenticada; webhook só tiraria latência (§12). |

## 3. Contrato verificado da Upload-Post

Verificado no OpenAPI oficial (`https://docs.upload-post.com/openapi.json`,
`Upload-Post API 1.0.0`, 36 paths, baixado em 2026-08-05). **Nada aqui vem de
memória.** Notas completas em `scratchpad/upload-post-contract.md`.

Base: `https://api.upload-post.com/api`.
Auth: header `Authorization: Apikey <KEY>` — o literal `Apikey `, com espaço,
não `Bearer`.

### 3.1 A chave é uma, e é nossa

`ApiKeyAuth` autentica a **conta AUREA**, não o cliente. O que separa clientes é
o **profile `username`**, enviado como o campo `user` em cada publicação.

Isso inverte o modelo de segurança do Postiz, onde cada workspace selava sua
credencial e o segredo *era* a fronteira. Aqui o segredo é global e a fronteira
somos nós. Ver §5 — é o invariante mais importante deste design.

### 3.2 Perfis

- `POST /uploadposts/users` `{username}` → `201 {success, profile}`; **`409`** se
  o username já existe.
- `GET /uploadposts/users` → `{limit, plan, profiles[]}` — o limite do plano vem
  na resposta.
- `GET /uploadposts/users/{username}` → um profile.
- `DELETE /uploadposts/users` `{username}` → apaga o profile **e as conexões
  sociais**.

`profile.social_accounts` é um objeto **chaveado por plataforma**:

```json
{ "linkedin": { "username": "...", "handle": "...", "display_name": "...",
                "social_images": "https://...", "reauth_required": false } }
```

Duas leituras obrigatórias disso:

1. **Uma conta por plataforma por profile.** Um cliente com dois Instagram
   precisaria de dois profiles. Fora de escopo; a tela não promete o contrário.
2. O `additionalProperties` é um `oneOf` frouxo — objeto, **ou string, ou
   null**. O parser lê defensivamente: o que não casar com o objeto conta como
   "conectado, sem metadados", nunca como erro.

### 3.3 Conexão white-label

`POST /uploadposts/users/generate-jwt`:

| campo | uso nosso |
|---|---|
| `username` | obrigatório |
| `redirect_url` | volta para a AUREA |
| `logo_image` | logo da AUREA |
| `connect_title`, `connect_description`, `redirect_button_text` | textos nossos, em pt |
| `platforms[]` | `tiktok instagram linkedin youtube facebook x threads discord telegram` |
| `show_calendar` | **`false`** — o calendário é produto deles |
| `language` | `en es de fr pt pl tr` → **`pt` existe** |
| `ui_labels` | overrides de i18n por chave (≤100 entradas, ≤300 chars) |

→ `{success, access_url, duration: "48h"}`. Link de uso único, 48h de validade.

### 3.4 Publicar

`POST /upload_text`, **`multipart/form-data`**. Obrigatórios: `user`,
`platform[]`, `title` (o texto do post). `description` só é usado no Reddit.

`TextPlatformEnum` = **`linkedin x facebook threads reddit bluesky
google_business discord telegram`**.

**Instagram, TikTok e YouTube não estão nessa lista.** Post de texto não chega
nessas redes — exigem `/upload_photos` ou `/upload` com mídia. É o fato que
define a decisão 2.

### 3.4.1 Publicar e conectar não são o mesmo conjunto

O enum de `platforms[]` do `generate-jwt` (§3.3) é `tiktok instagram linkedin
youtube facebook x threads discord telegram`. Cruzando com o de publicação:

| rede | publica texto | oferecível na conexão |
|---|---|---|
| linkedin, x, facebook, threads, discord, telegram | ✅ | ✅ |
| reddit, bluesky, google_business | ✅ | ❌ |
| instagram, tiktok, youtube | ❌ (exige mídia) | ✅ |

Como conectar acontece **apenas** pelo nosso link, uma rede fora do enum de
conexão é inalcançável: ninguém nunca terá conta dela no profile. Então
`SocialPlatform` tem **seis** valores — a interseção — e não nove. Reddit,
Bluesky e Google Business ficam fora com motivo registrado em §15; incluí-las
criaria opção morta na tela, e o Reddit ainda exigiria subreddit e flair por post,
que é modelo novo.

A API cria thread automática quando o texto passa do limite da rede: X (>280),
Threads (>500), Bluesky (>300). Não fazemos nada a respeito, e a tela também
não avisa — é comportamento do provider, e inventar um aviso nosso seria afirmar
uma regra que ele pode mudar.

Resposta `200` em dois formatos (`oneOf`):

```
síncrono:  { success, results: { "<platform>": { success, url, post_id,
                                                 publish_id, error } },
             usage: { count, limit, last_reset } }
async:     { success, request_id, total_platforms }   // com async_upload: true
```

`GET /uploadposts/status?request_id=` →
`{status: pending|in_progress|completed, completed, total,
results: [{platform, success, message, upload_timestamp}]}`.

`POST /uploadposts/posts/retry` `{request_id}` → reenfileira **só as plataformas
que falharam**, reusando o snapshot. `409` = nada a retentar. `404` = id
desconhecido.

### 3.5 O que existe e não usamos

`/upload`, `/upload_photos`, `/upload_document`, agendamento
(`scheduled_date`, `add_to_queue`, `/uploadposts/queue/*`), `/analytics`,
comentários, DMs, FFmpeg, `/uploadposts/history`, `/uploadposts/posts/unpublish`,
texto por rede (`x_title`, `linkedin_title`, …), `first_comment`, e os campos
específicos do X (`reply_settings`, `quote_tweet_id`, `nullcast`, …).

Cada um está fora por escopo, não por dúvida. `unpublish` merece nota: existe, e
**não** vira botão nesta fatia — despublicar tem semântica própria (o post foi ao
ar e voltou) e precisa de registro próprio para não virar apagamento de
histórico.

## 4. Modelo de dados

### 4.1 `ActionTarget` — o desfecho é por rede

```prisma
/// A interseção de "publica texto" com "pode ser conectada pelo nosso link"
/// (§3.4.1). Seis, não nove.
enum SocialPlatform {
  LINKEDIN
  X
  FACEBOOK
  THREADS
  DISCORD
  TELEGRAM
}

/// O ciclo de *entrega* de um alvo. Não confundir com `ActionStatus`, que é o
/// ciclo de *aprovação* da Action: aprovar é ato humano sobre o post inteiro,
/// publicar acontece rede por rede.
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

  /// Uma rede aparece uma vez por Action. É a trava no banco contra publicar
  /// duas vezes no mesmo lugar pelo mesmo post.
  @@unique([actionId, platform])
  @@index([workspaceId])
  @@index([actionId])
}
```

`onDelete: Cascade` do `actionId` — diferente do `SetNull` que a Action usa para
`experimentId`. O alvo não tem existência sem o post; o registro do que foi
publicado no mundo é o `ExternalReference`, que não é apagado por cascade de
Action nenhuma.

### 4.2 O que muda na `Action`

Sai: `payload.channelId`, `payload.channelName`, `payload.providerIdentifier`.
Fica: `payload.content`.

Entra:

```prisma
/// O `request_id` da chamada assíncrona à Upload-Post. É o que permite
/// consultar o desfecho e retentar só o que falhou. Nulo até a primeira
/// execução; preservado depois dela.
providerRequestId String?
```

Saem de `Action`, porque agora vivem no alvo: `lastError`, `failureKind`,
`attempts`. `heartbeatAt` **fica** — é do job, não do alvo.

Novo estado em `ActionStatus`:

```prisma
enum ActionStatus {
  PROPOSED
  PENDING_APPROVAL
  APPROVED
  EXECUTING
  EXECUTED
  PARTIALLY_EXECUTED   // novo
  FAILED
  CANCELLED
  DELIVERY_UNKNOWN
}
```

`PARTIALLY_EXECUTED` não é conveniência de UI. Sem ele, um post que saiu no
LinkedIn e falhou no X só pode ser gravado como `EXECUTED` (que esconde a falha)
ou `FAILED` (que nega uma publicação pública real). As duas são mentira.

### 4.3 A agregação

Função pura em `actions.domain.ts`, com tabela de teste. Precedência, em ordem:

1. algum alvo `PUBLISHING` → **`EXECUTING`**
2. **todos `PENDING` → `null`: não escreve nada.** A Action ainda não executou, e
   seu status é o da aprovação (`PROPOSED`, `APPROVED`). Uma agregação que
   devolvesse status aqui sobrescreveria o ciclo humano com o ciclo de entrega.
3. todos `PUBLISHED` → **`EXECUTED`**
4. ≥1 `PUBLISHED` e ≥1 não → **`PARTIALLY_EXECUTED`**
5. nenhum `PUBLISHED` e algum `DELIVERY_UNKNOWN` → **`DELIVERY_UNKNOWN`**
6. nenhum `PUBLISHED` e algum `PENDING` → **`APPROVED`** — o caminho de volta:
   um alvo que o humano resolveu como não-publicado vira `PENDING`, e a Action
   volta a ser executável.
7. resto (todos `FAILED`) → **`FAILED`**

Sem alvo nenhum, `null` — mas a rota de criação exige ao menos uma plataforma,
então esse caso só existe como guarda.

O valor é **derivado e persistido** na mesma transação que escreve os alvos: a
lista filtra por status, e recalcular por render custaria uma agregação por
linha. Nenhum outro lugar escreve `Action.status` durante execução.

Regra 4 antes da 5 de propósito: com um post público no ar, a pergunta
"publicou?" já tem resposta parcial afirmativa, e o alvo incerto continua
visível no detalhe. `DELIVERY_UNKNOWN` na Action é reservado para o caso em que
**nada** se sabe.

### 4.4 Transições

`TRANSITIONS` da Action, atualizada:

```
PROPOSED           → PENDING_APPROVAL, CANCELLED
PENDING_APPROVAL   → APPROVED, PROPOSED, CANCELLED
APPROVED           → EXECUTING, CANCELLED
EXECUTING          → EXECUTED, PARTIALLY_EXECUTED, FAILED, DELIVERY_UNKNOWN
PARTIALLY_EXECUTED → EXECUTING, CANCELLED
FAILED             → EXECUTING, CANCELLED
DELIVERY_UNKNOWN   → EXECUTING, EXECUTED, PARTIALLY_EXECUTED, APPROVED
EXECUTED           → (nada)
CANCELLED          → (nada)
```

`EXECUTABLE_FROM = [APPROVED, PARTIALLY_EXECUTED, FAILED, DELIVERY_UNKNOWN]`.

`DELIVERY_UNKNOWN` executável é novidade em relação ao design anterior, e só
porque agora **temos** `providerRequestId`: retentar dali não é um tiro no
escuro, é `/posts/retry` sobre um id conhecido, que reenfileira apenas o que
falhou. Quando não há `providerRequestId` (a conexão morreu antes da resposta), a
Action fica `DELIVERY_UNKNOWN` e o único caminho é humano — §8.3.

### 4.5 Migração

`ActionType` continua com `SOCIAL_POST` só.

Uma migração `.sql` escrita à mão, nunca `prisma migrate dev`:

1. cria `SocialPlatform`, `ActionTargetStatus`, `ActionTarget`;
2. adiciona `PARTIALLY_EXECUTED` ao enum `ActionStatus`;
3. adiciona `Action.providerRequestId`; remove `lastError`, `failureKind`,
   `attempts` de `Action`;
4. `WorkspaceIntegration.provider` aceita `'UPLOAD_POST'` (é `String`, não enum
   — nada a migrar no banco);
5. apaga as Actions existentes e suas `Approval`/`ExternalReference`.

O passo 5 exige justificativa explícita, e é esta: não há dado de produção — o
Postiz nunca foi conectado a uma instância real, e as Actions existentes
referenciam `channelId` de um provider que deixa de existir. Migrá-las produziria
alvos apontando para plataformas que ninguém autorizou. **Se este spec for
executado depois de qualquer publicação real, o passo 5 é inválido e a migração
precisa ser reescrita.**

## 5. Identidade do cliente, e o isolamento

O profile na Upload-Post é derivado do workspace:

```
username = `ws-${workspaceId}`
```

Opaco e estável de propósito: o nome do workspace muda e não é nosso para
vazar ao fornecedor.

Criação sob demanda, idempotente: `POST /uploadposts/users` e **`409` conta como
sucesso** — o profile já existir é exatamente o estado desejado. O resultado é
gravado como `WorkspaceIntegration`:

```
provider: 'UPLOAD_POST'
authKind: 'ACCOUNT_KEY'   // a credencial é da conta AUREA, não deste workspace
externalId: 'ws-<uuid>'   // o profile
accountLabel: 'Upload-Post'
status: 'OK' | 'FAILED'
ciphertext/iv/authTag: selado de `{}`
```

O último item é feio e deliberado: as três colunas são `Bytes` não-nulas, e
inventar uma nulidade nova só para este provider muda a tabela por causa de um
caso. Selar um objeto vazio mantém o schema e não guarda segredo nenhum. Uma
linha do repositório documenta isso, e nenhuma rota devolve as três colunas.

### 5.1 O invariante

> **O `user` de toda chamada de publicação vem do `WorkspaceIntegration` lido
> por `req.tenant.workspaceId`. Nunca do body, nunca da query, nunca de um
> parâmetro.**

Com o Postiz, uma credencial errada publicava no lugar errado — mas a
credencial era do próprio cliente, então o raio de alcance de um bug era um
workspace. Aqui a chave é global: um profile resolvido errado publica **na conta
de outro cliente**, e um post público não volta atrás.

Por isso, obrigatoriamente:

- o profile é lido junto com a Action, na mesma consulta escopada por
  `workspaceId`;
- o processor recebe `{ actionId, workspaceId }` e relê os dois — não confia em
  nada que veio no payload do job além dos ids;
- teste explícito: um job com `actionId` de um workspace e `workspaceId` de
  outro não publica nada;
- teste explícito: duas Actions de workspaces diferentes produzem `user`
  diferentes na chamada.

### 5.2 Limite de plano

`POST /uploadposts/users` pode recusar por limite do plano. O erro sobe como
`UPLOAD_POST_PLAN_LIMIT` (409), com a mensagem da fonte, e a tela diz que o
plano da AUREA atingiu o limite de perfis — não "não foi possível conectar", que
mandaria o fundador procurar defeito onde não tem.

`GET /uploadposts/users` devolve `limit` e `plan`. Não vira tela nesta fatia.

## 6. Conectar as redes

`POST /integrations/social/connect-link` (autenticada, tenant-scoped):

1. garante o profile (§5);
2. chama `generate-jwt` com `redirect_url = ${APP_URL}/integrations?social=connected`,
   `logo_image = ${APP_URL}/logo.png`, textos em pt, `show_calendar: false`,
   `platforms[]` = **as 6 de `SocialPlatform`**, `language` = idioma do usuário;
3. devolve `{ accessUrl, expiresIn: '48h' }`.

O front abre `accessUrl` em nova aba e, na volta, invalida a query das contas.

`platforms[]` explícito, e sem Instagram/TikTok/YouTube, é decisão de produto,
não omissão: omitir o campo mostra **todas** as redes, e um cliente que autorizou
o Instagram e depois não pode postar nele foi enganado pela nossa tela. Quando
mídia entrar, elas entram junto.

`GET /integrations/social/accounts` proxia `GET /uploadposts/users/{username}` ao
vivo e devolve, por plataforma: `platform`, `handle`, `displayName`,
`pictureUrl`, `reauthRequired`. **Nunca persistido** — a lista muda no
fornecedor, e um cache nosso mostraria uma conta que o cliente já desconectou.

`reauthRequired: true` é o que permite avisar antes de falhar: a tela mostra
"reconectar" no card, e a criação de ação avisa se uma rede selecionada está
nesse estado.

## 7. Criar e aprovar

`POST /actions` recebe `{ name, description?, experimentId?, content, platforms[] }`.

- `platforms` mínimo 1, máximo 6, sem repetição;
- cada plataforma é validada contra as contas **conectadas ao vivo** — mesma
  disciplina do `POSTIZ_CHANNEL_NOT_FOUND` de antes, agora
  `UPLOAD_POST_PLATFORM_NOT_CONNECTED` (400), citando a plataforma;
- cria a Action `PROPOSED` e um `ActionTarget` `PENDING` por plataforma, em
  transação.

`PATCH /actions/:id` edita `content` e `platforms` **somente** em `PROPOSED`,
recusando com `ACTION_NOT_EDITABLE` (409) em qualquer outro status: adicionar e
remover alvos depois da aprovação mudaria o que foi aprovado. Em `PROPOSED` nenhum
alvo pode estar `PUBLISHED` — mas a remoção verifica o status do alvo de todo
jeito, e nunca apaga um alvo publicado. Um post no mundo é fato; sumir com a
linha apagaria a proveniência.

Aprovação: sem mudança de regra. OWNER/ADMIN, o autor pode aprovar a própria, e
em ato separado da criação. O diálogo de confirmação de publicação **lista todas
as redes** que vão receber — o dado que faltava quando era um canal só.

## 8. Executar

`POST /actions/:id/execute` → `202`. Quem publica é o worker.

### 8.1 O caminho

1. **CAS**: `updateMany` de `EXECUTING` sobre `status IN (APPROVED,
   PARTIALLY_EXECUTED, FAILED, DELIVERY_UNKNOWN)`, mais `heartbeatAt = null`. A
   condição *é* a transição: quem não pegou a linha não enfileira.
2. **alvos que nós enviamos = `PENDING` ∪ `FAILED`.** Nunca `PUBLISHED` (o post
   existe), nunca `DELIVERY_UNKNOWN` (não sabemos se existe). Marcados
   `PUBLISHING`, `attempts++`, `lastError = null`. Conjunto vazio **e** sem
   `providerRequestId` → a rota recusa com `ACTION_NOTHING_TO_PUBLISH` (409) em
   vez de enfileirar um job que nada faria.
3. `jobId = actionId` na fila BullMQ — segunda camada de idempotência.
4. no worker:
   - **se há `providerRequestId`**: `POST /uploadposts/posts/retry
     {request_id}`. Retry do provider é preferido a um POST novo porque ele
     retenta apenas o que ele mesmo registrou como falho, reusando o snapshot; e
     porque ele é a única parte que sabe o desfecho de um alvo
     `DELIVERY_UNKNOWN` — por isso este caminho pode tocar alvos incertos, e o
     nosso POST não pode.
     `409` (nada a retentar) → segue direto para o poll, que lê o desfecho real.
     `404` (o provider não conhece esse `request_id`) → cai no caminho de baixo,
     mas **só com os alvos `PENDING` ∪ `FAILED`**: sobre esses o poll anterior já
     nos disse `success: false`, então republicar não duplica. Alvos
     `DELIVERY_UNKNOWN` continuam incertos e só saem por ato humano.
   - **senão**: `POST /upload_text` com `async_upload: true`, `user` = profile,
     `platform[]` = os alvos do passo 2, `title` = `content`. Grava
     `providerRequestId` **antes** de qualquer outra escrita — é o que torna a
     falha seguinte recuperável.
5. **poll**: `GET /uploadposts/status?request_id=` com backoff, até `completed`
   ou o teto de tentativas. Cada leitura grava o que já se sabe: alvo com
   `success: true` → `PUBLISHED` + `externalId` + `postUrl` + `publishedAt`;
   `success: false` → `FAILED` + `message` literal.
6. `ExternalReference` por alvo publicado: `entityType: 'SOCIAL_POST_TARGET'`,
   `entityId: target.id`, `externalId: post_id`, `metadata: { platform, url }`.
   Violação de unique (P2002) conta como **sucesso** — significa que outra
   passagem já registrou o mesmo post.
7. status da Action recalculado pela agregação (§4.3), na mesma transação.

### 8.2 `EXECUTED` passa a significar publicado

Com o Postiz, `EXECUTED` significava "entregue" — o `state` devolvido era
`QUEUE`, e a publicação acontecia depois, lá dentro, sem nos avisar.

Aqui o desfecho vem de `GET /uploadposts/status`, leitura autenticada da fonte,
com `post_id` e `url` do post real. Então:

> **`PUBLISHED` num alvo significa publicado, e a tela pode dizer isso.** A URL
> é mostrada como link — o fundador confere em um clique.

O que continua proibido: afirmar publicação a partir da resposta do `POST`. Um
`request_id` não é um post. Só o poll fala.

### 8.3 O que sobrou de incerteza

`DELIVERY_UNKNOWN` num alvo, e só em dois casos:

1. o `POST /upload_text` morreu na rede **sem** devolver `request_id` — não há o
   que consultar, e um segundo POST pode duplicar. Todos os alvos elegíveis vão
   para `DELIVERY_UNKNOWN`.
2. o poll esgotou o teto de tentativas com o alvo ainda `PUBLISHING`.

No caso 2 ainda existe `providerRequestId`, então a saída é retentar (§4.4). No
caso 1 a única saída é humana: `POST /actions/:id/targets/:targetId/resolve`
`{ outcome: 'PUBLISHED' | 'NOT_PUBLISHED', externalId? }`.

- `PUBLISHED` → alvo `PUBLISHED`, `publishedAt = now`. Com `externalId`, grava o
  `ExternalReference`; sem ele, **não grava** — proveniência de mentira é pior
  que proveniência ausente. `postUrl` fica nulo: não é nosso para construir.
- `NOT_PUBLISHED` → alvo volta a **`PENDING`**, e a agregação (regra 6) devolve a
  Action a `APPROVED`. É o que torna o retry seguro: o alvo deixou de ser
  incerto porque um humano olhou a rede.

Só alvos `DELIVERY_UNKNOWN` são resolvíveis; qualquer outro responde
`ACTION_NOT_RESOLVABLE` (409).

A tela desse caso avisa **antes** dos botões, nomeia a rede e o horário da
tentativa, e não oferece nenhum botão neutro de "tentar de novo".

### 8.4 Falha: classificação por evidência

A pergunta não é "o erro é transitório?", é **"o que sabemos sobre a chamada?"**.

| Evidência | `kind` | Ação |
|---|---|---|
| `401`, `403` | `AUTH` | `FAILED`. Retentar com a mesma chave dá o mesmo 401. |
| `400`, `404`, `405`, `422` | `VALIDATION` | `FAILED`. Roteamento e validação precedem a criação: não existe post. |
| `429` | `RATE_LIMIT` | retenta. O provider respondeu, então não criou. |
| `5xx` | `PROVIDER` | retenta. Idem. |
| erro de `fetch` | `NETWORK` | **`DELIVERY_UNKNOWN`. Nunca retenta.** |
| resto | `UNKNOWN` | `DELIVERY_UNKNOWN`. |

`isRetriable` e `isIndeterminate` são disjuntos, com teste que garante isso.

Uma falha **por plataforma** vinda do poll (`results[].success === false`) é
sempre `FAILED` naquele alvo, qualquer que seja a mensagem: o provider tentou,
sabe o que aconteceu, e está nos dizendo. Não é indeterminação.

Erro ao montar o cliente (chave ausente, base inválida) é `FAILED`, em `try`
próprio, antes de qualquer rede: marcar indeterminado o que nunca saiu mandaria
o fundador conferir uma rede que nada recebeu.

### 8.5 Reaper

`EXECUTING` sem sinal de vida além do corte → `DELIVERY_UNKNOWN` nos alvos
`PUBLISHING`, **nunca** `FAILED`, e **preservando** o `lastError` de cada alvo.
Job que esgota tentativas → `FAILED` nos alvos cujo `failureKind` é
`RATE_LIMIT` ou `PROVIDER`, `DELIVERY_UNKNOWN` nos demais: nesses dois o provider
respondeu todas as vezes, então sabemos que não criou. `failureKind` mora no
alvo, não na Action (§4.2), então a decisão é por alvo.

Depois de escrever os alvos, o reaper recalcula o status da Action pela
agregação — nunca escreve status de Action à mão.

## 9. Rotas

| Método | Rota | `operationId` |
|---|---|---|
| POST | `/integrations/social/connect-link` | `createSocialConnectLink` |
| GET | `/integrations/social/accounts` | `listSocialAccounts` |
| DELETE | `/integrations/social` | `disconnectSocial` |
| GET | `/actions` | `listActions` |
| POST | `/actions` | `createAction` |
| GET | `/actions/:id` | `getAction` |
| PATCH | `/actions/:id` | `updateAction` |
| POST | `/actions/:id/submit` | `submitAction` |
| POST | `/actions/:id/approve` | `approveAction` |
| POST | `/actions/:id/reject` | `rejectAction` |
| POST | `/actions/:id/execute` | `executeAction` |
| POST | `/actions/:id/cancel` | `cancelAction` |
| POST | `/actions/:id/targets/:targetId/resolve` | `resolveActionTarget` |

`DELETE /integrations/social` chama `DELETE /uploadposts/users` — que apaga as
conexões sociais do cliente no fornecedor. Irreversível, e a tela confirma com
diálogo nomeando o que se perde. Actions já executadas e seus
`ExternalReference` **não** são apagados.

`operationId` e `response` obrigatórios em todas, como sempre — é o que gera os
hooks do Kubb.

### 9.1 Códigos de erro

Novos: `UPLOAD_POST_NOT_CONFIGURED` (503 — a instância não tem chave),
`UPLOAD_POST_NOT_CONNECTED` (400), `UPLOAD_POST_PLATFORM_NOT_CONNECTED` (400),
`UPLOAD_POST_REQUEST_FAILED` (502, com `details: { reason }`),
`UPLOAD_POST_PLAN_LIMIT` (409), `ACTION_NOT_EDITABLE` (409),
`ACTION_NOTHING_TO_PUBLISH` (409).

Continuam: `ACTION_NOT_RESOLVABLE` (409).

Aposentados, e seus números **nunca reusados**: `POSTIZ_NOT_CONNECTED`
(AUR-T0041), `POSTIZ_CHANNEL_NOT_FOUND` (AUR-T0042), `POSTIZ_REQUEST_FAILED`
(AUR-T0043). Um código já citado num log ou num ticket não pode passar a
significar outra coisa.

Toda mensagem nova em pt-BR, en-US e es-ES.

## 10. Configuração

```
UPLOAD_POST_API_KEY   opcional
```

Opcional como as `GOOGLE_OAUTH_*`: sem ela, as rotas sociais respondem
`UPLOAD_POST_NOT_CONFIGURED` (503) e o resto do produto sobe normal. Um
ambiente de teste não precisa de chave — e **nenhum teste toca a rede**: o
cliente entra por opção de plugin, nunca por decorator ambiente. Um teste que
esquecesse de decorar sairia publicando de dentro da suíte.

`APP_URL` já existe e é a base do `redirect_url` e do `logo_image`.

## 11. Agente de IA

`propose-social-post` continua sendo o décimo agente `fill`, tier TIER2, e passa
a propor `{ name, content, platforms[] }`.

`platforms` é sugestão sobre **rede**, nunca sobre conta: o modelo não escolhe
onde publicar dentro de uma rede porque não há escolha para ele fazer — há uma
conta por rede. A proposta é validada contra as contas conectadas antes de
chegar à tela, e uma rede não conectada é silenciosamente descartada da
sugestão (não é erro do modelo; ele não sabe o que o cliente autorizou).

`get_experiment_result` continua entrando na toolbox só quando há `experimentId`,
e o `precheck` continua retornando cedo, sem consulta ao banco, quando não há.

## 12. Frontend

- **`SocialSourceCard`** substitui `PostizSourceCard`: lista as contas
  conectadas com avatar e handle, badge de "reconectar" quando
  `reauthRequired`, botão "Conectar redes" (abre `accessUrl` em nova aba) e
  "Desconectar tudo" com `AlertDialog`. Estado vazio explica que conectar é um
  clique e que Instagram e TikTok chegam quando a AUREA publicar imagem.
- **`ActionNewPage`**: campo de texto + seleção múltipla das redes conectadas,
  com contagem ("publicar em 4 redes"). Rede com `reauthRequired` aparece
  desabilitada com o motivo. Sem rede nenhuma conectada, o formulário não
  aparece: aparece o caminho para conectar.
- **`ActionDetailPage`**: uma linha por alvo, com badge de status, link do post
  publicado (`postUrl`), a mensagem de erro literal quando falhou, e o painel de
  resolução no alvo incerto. `refetchInterval` enquanto a Action está
  `EXECUTING`.
- **`ActionStatusBadge`**: copy de `EXECUTED` passa a ser "Publicado" — agora é
  verdade (§8.2). Novo: `PARTIALLY_EXECUTED` = "Publicado em parte".
- **Confirmação de publicação**: o `AlertDialog` que já existe passa a listar as
  redes. Em `PARTIALLY_EXECUTED`/`FAILED`/`DELIVERY_UNKNOWN`, o corpo diz que
  apenas as redes que não publicaram serão tentadas — que é exatamente o que
  `/posts/retry` faz.

Tailwind + shadcn/ui, `Help` em todo termo de domínio, i18n pt/en/es com teste
de paridade de chaves, `renderWithProviders` + `stubFetch` nos testes. Nenhuma
chave `pages.actions.*` de canal do Postiz sobrevive.

## 13. O que é apagado

Backend: `src/integrations/social/postiz/` (client, credential, testes),
`put-postiz/`, `postiz-channels/`, `postiz.test.ts`, os três códigos
`POSTIZ_*` e suas mensagens, e as menções em `actions.payload.ts`,
`actions.schema.ts`, `processor.ts`, `worker.ts` e nos controllers.

Frontend: `PostizSourceCard.tsx` + teste, hooks e tipos gerados
(`usePutPostizIntegration`, `useListPostizChannels`, …) — vão embora na
regeneração do Kubb —, e as chaves i18n do Postiz nos três locales.

Infra: `compose.postiz.yml`, `dynamicconfig/`, os scripts `postiz:*` do
`package.json`.

`integrationProvider` volta a `z.enum(['GA4', 'UPLOAD_POST'])`.

Nada disso é "limpeza depois": código morto que fala com um provider aposentado é
convite a alguém religá-lo.

## 14. Testes e invariantes

Invariantes que o plano precisa provar, com teste nomeado:

1. **Isolamento de tenant absoluto.** `user` sempre derivado de
   `req.tenant.workspaceId`. Job com ids cruzados não publica. Id de outro
   workspace lê como 404, nunca 403.
2. **Nada publica sem aprovação humana explícita**, em ato separado da criação.
3. **Nenhum teste toca a rede nem o Redis.** Cliente e fila entram por opção de
   plugin.
4. **O segredo nunca sai numa resposta.** Nenhuma rota devolve `ciphertext`,
   `iv`, `authTag` nem a API key.
5. **Falha de rede nunca retenta.**
6. **`isRetriable` e `isIndeterminate` são disjuntos.**
7. **O nosso `POST` nunca inclui alvo `PUBLISHED` nem `DELIVERY_UNKNOWN`.**
   Teste que executa uma Action `PARTIALLY_EXECUTED` com um alvo de cada estado e
   confere o `platform[]` enviado.
8. **`PUBLISHED` só é escrito a partir do poll**, com `post_id` da fonte. Nunca
   da resposta do `POST`.
9. **Tabela de agregação** completa: os cinco casos da §4.3, mais o vazio.
10. **P2002 no `ExternalReference` conta como sucesso.**
11. **Nenhum código gera, infere ou assume `baselineValue`, `targetValue`,
    `startDate` ou `endDate`.**
12. **Nenhuma cópia afirma publicação sem `postUrl`/`externalId` da fonte.**

## 15. Fora de escopo

Com o motivo, para ninguém reabrir por engano:

- **Mídia** (imagem/vídeo) e com ela Instagram, TikTok, YouTube — dobra o
  escopo: upload, storage no R2, URL pública, e validação por rede.
- **Webhooks** (`upload_completed`, `social_account.*`) — o payload **não é
  assinado e não traz `request_id`**, então não pode escrever desfecho. Serviria
  como gatilho para o poll, tirando latência. `social_account.reauth_required`
  é o de maior valor: avisaria o cliente antes de a publicação falhar.
- **Agendamento** (`scheduled_date`, fila do provider) — a AUREA tem relógio
  próprio de experimentos; misturar dois agendadores precisa de design.
- **Texto por rede** (`x_title`, `linkedin_title`) — o campo existe; o produto
  ainda não decidiu se o agente escreve variações.
- **`unpublish`** — despublicar é ato com semântica própria, não desfazer.
- **Analytics do post**, comentários, DMs, FFmpeg.
- **Reddit, Bluesky e Google Business** — publicáveis, mas fora do enum de
  conexão do provider (§3.4.1), logo inalcançáveis pelo nosso fluxo. O Reddit
  ainda exigiria subreddit e flair por post.
- **Múltiplas contas na mesma rede** — o provider não suporta dentro de um
  profile.
- **Autonomia** (fase 11). `riskLevel` e `requiresApproval` continuam **fora** do
  modelo: seriam autonomia entrando pela porta dos fundos.
- **`Outcome.actionId`** e eventos de Event Bus.

## 16. Riscos assumidos

1. **Um fornecedor, uma chave, todos os clientes.** Um bug na resolução de
   profile publica na conta de outro. Mitigação: §5.1, com testes nomeados. É o
   risco mais sério deste design.
2. **Upload-Post é fornecedor novo e pequeno.** Se sumir, a AUREA fica sem canal
   de execução. Mitigação: o conector é uma unidade isolada com contrato
   estreito (`ensureProfile`, `connectLink`, `listAccounts`, `publishText`,
   `status`, `retry`); trocar de provider é implementar essas seis funções, não
   reescrever as Actions.
3. **Os tokens das redes dos clientes ficam no fornecedor.** Consequência aceita
   da decisão 1; era o que o self-host dava e o que ele cobrava em UX.
4. **`social_accounts` tem `oneOf` frouxo.** Um formato novo do fornecedor pode
   ser lido como "sem metadados". Mitigação: parse defensivo e teste com as três
   formas.
