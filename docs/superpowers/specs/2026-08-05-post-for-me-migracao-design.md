# Migração Upload-Post → Post for Me — design

**Data:** 2026-08-05
**Status:** aprovado para plano
**Delta sobre:** `2026-08-05-upload-post-multicanal-design.md` — aquele spec continua
valendo em tudo que não está aqui: aprovação em ato separado, alvo por rede,
agregação, CAS, poll como única fonte de "publicado", `DELIVERY_UNKNOWN` só onde
não se sabe.

---

## 1. Por que trocar

O modelo de cobrança é invertido, e a AUREA está do lado caro dele.

| | Upload-Post | Post for Me |
|---|---|---|
| cobra por | conta conectada | volume de post |
| $10/mês | — | 1.000 posts, contas ilimitadas |
| 20 clientes × 3 redes | 60 contas → **$147** | 240 posts → **$10** |

A AUREA tem muitos clientes publicando pouco cada. É o formato exato onde cobrar
por conta é caro. Dois ganhos secundários: os tokens são legíveis por nós, então
migrar de novo é possível; e contas são por conta, não por rede, o que resolve
"duas contas na mesma rede" — registrado como impossível no spec anterior (§3.2).

## 2. Contrato verificado

Verificado no OpenAPI embutido em `https://api.postforme.dev/docs`
(`Post for Me API 1.0`, 13 paths, lido em 2026-08-05). Base:
`https://api.postforme.dev`. Auth: `Authorization: Bearer <KEY>`.

### 2.1 Conectar — uma URL por rede

`POST /v1/social-accounts/auth-url` `{platform, external_id?, platform_data?,
permissions?}` → `{url, platform}`.

**Uma plataforma por chamada.** Consequência de produto: a lista de redes é a
**nossa** tela, o botão é nosso, e o cliente vai direto para o consentimento da
rede. Não existe página intermediária de terceiro — é mais white-label que o
fluxo anterior, não menos.

O que aparece no consentimento da rede depende do modo do projeto: com as
credenciais deles ("quickstart"), o nome deles; com as nossas ("white label"),
AUREA — e aí exige aprovação como desenvolvedor em cada plataforma.
**Começamos em quickstart**, e trocar é configuração no painel deles, não código.

`external_id` é nosso identificador na conta. É o que faz a tenancy (§4).

`permissions` default é só `posts`. Não pedimos `feeds`: ler timeline não é escopo,
e permissão que não se usa é permissão pedida ao cliente por nada.

### 2.2 As redes que sobram

`platform_data.bluesky` exige `{handle, app_password}` — **Bluesky não é OAuth**.
O cliente teria de gerar uma senha de app e colá-la, que é a fricção de que
saímos do Postiz. Fica fora.

Cruzando "publica texto" com "conecta em um clique":

| rede | texto | um clique |
|---|---|---|
| linkedin, x, facebook, threads | ✅ | ✅ |
| bluesky | ✅ | ❌ (senha de app) |
| instagram, tiktok, youtube, pinterest | ❌ (mídia) | ✅ |

**`SocialPlatform` = `LINKEDIN X FACEBOOK THREADS`.** Quatro, não seis: Discord e
Telegram não existem no provider. Quando mídia entrar, entram quatro de uma vez.

`platform_data.linkedin.connection_type` é `personal | organization` — publicar
como pessoa ou como página da empresa. Default `personal`, e expor a escolha é
decisão de produto fora desta fatia (§8).

### 2.3 Contas

`GET /v1/social-accounts?external_id=…&platform=…` → `{data[], meta}` com
`{id, platform, username, profile_photo_url, status, external_id, access_token,
refresh_token, metadata}`.

`status` é **`connected | disconnected`** — estado explícito, e substitui o
`reauthRequired` do provider anterior. Uma conta `disconnected` é recusada na
criação de ação com a mesma mensagem de antes.

`POST /v1/social-accounts/{id}/disconnect` apaga os tokens e **preserva o
registro**. `DELETE /v1/social-accounts/{id}` destrói o histórico. Usamos
**disconnect**: nossos `ExternalReference` apontam para o alvo, e o alvo guarda o
id da conta — apagar a conta lá deixaria a proveniência apontando para o vazio.

`access_token` e `refresh_token` voltam nessa leitura. **Nenhuma rota nossa os
devolve, e nenhum log os escreve** — o presenter lista campos por nome, nunca
espalha o objeto do provider.

### 2.4 Publicar

`POST /v1/social-posts` `{caption, social_accounts[], media?, scheduled_at?,
isDraft?, external_id?, platform_configurations?, account_configurations?}` →
`{id, status, …}`, com `status` em `draft | scheduled | processing | processed`.

Texto puro é **omitir `media`**. `social_accounts` são ids de conta, não slugs de
rede — é o que permite duas contas na mesma rede.

`GET /v1/social-post-results?post_id=…` → por conta:
`{social_account_id, success, error, details, platform_data: {id, url}}`.

`platform_data.id` e `platform_data.url` são exatamente `externalId` e `postUrl`
do nosso alvo. `error` e `details` são **objetos**, não strings: a leitura extrai
mensagem com cuidado e cai numa frase nossa quando não há nada legível — nunca
`"[object Object]"` na tela.

### 2.5 O que não existe, e o que muda por causa disso

**Não há endpoint de retry.** Todo o caminho "o provider retenta o que registrou
como falho" morre. O substituto:

> Retentar é um `POST /v1/social-posts` novo, **só com as contas cujo resultado
> anterior disse `success: false`**. É seguro pela mesma regra de evidência do
> spec anterior (§8.4): sobre essas contas o provider respondeu que não criou.

Consequência dura, e aceita: **um alvo `DELIVERY_UNKNOWN` não tem mais saída
automática.** Antes, `/posts/retry` sabia o desfecho de um alvo incerto. Agora
não há quem saiba além do humano. Então:

- `DELIVERY_UNKNOWN` sai **apenas** por `POST /actions/:id/targets/:targetId/resolve`;
- `DELIVERY_UNKNOWN` deixa de ser executável: sai de `EXECUTABLE_FROM` e a aresta
  `DELIVERY_UNKNOWN → EXECUTING` sai de `TRANSITIONS`.

Isso é uma volta ao desenho do Postiz nesse ponto, e pelo mesmo motivo: sem id
que o provider reconheça, retentar é tiro no escuro. O `providerRequestId` (agora
`providerPostId`) continua existindo — ele serve para **ler** o desfecho, que é
seguro, e não para retentar.

**Não há `409 nada a retentar`.** O caminho que tratava isso desaparece.

### 2.6 Webhooks

`POST /v1/webhooks` `{url, event_types[]}` com
`social.post.result.created`, `social.account.updated`, entre outros. Fora de
escopo pela mesma razão de antes: o poll já dá a verdade autenticada, e webhook
só tiraria latência. `social.account.updated` é o de maior valor — avisaria
desconexão antes de a publicação falhar.

## 3. Modelo de dados

Uma coluna nova e um enum menor. Nada mais.

```prisma
enum SocialPlatform {
  LINKEDIN
  X
  FACEBOOK
  THREADS
}

model ActionTarget {
  …
  /// A conta do provider que este alvo atinge. É ela que a publicação recebe —
  /// slug de rede não basta, porque duas contas podem viver na mesma rede.
  ///
  /// Snapshot deliberado: a conta pode ser desconectada depois, e o alvo precisa
  /// continuar dizendo por onde o post saiu.
  socialAccountId String?
}
```

`Action.providerRequestId` → **`providerPostId`**: é o id do post no provider, e o
nome antigo descrevia um pedido de outro fornecedor.

`socialAccountId` nulável porque alvo criado antes da migração não tem conta — e
não há dado de produção, então a migração apaga as Actions existentes de novo,
pela mesma justificativa registrada no spec anterior (§4.5). **Se isto rodar
depois de qualquer publicação real, a migração está errada.**

`SOCIAL_POST_TARGET_ENTITY` e as duas uniques de `ExternalReference` continuam
como estão.

## 4. Tenancy

O `external_id` que mandamos ao conectar é `ws-${workspaceId}` — o mesmo formato
opaco de antes, agora carimbado na **conta** e não num perfil.

O invariante do spec anterior (§5.1) vale inteiro, com uma diferença de forma:

> Toda leitura de contas filtra por `external_id = ws-${req.tenant.workspaceId}`,
> e **toda publicação envia apenas ids de conta que aquela leitura devolveu.**

Mais estreito que antes: lá o profile era um parâmetro; aqui a lista de ids é
verificada contra o workspace antes de virar `social_accounts`. Um id de conta de
outro cliente não passa nem por acidente, porque nunca esteve na lista.

Testes nomeados, além dos que já existem: publicar com um `socialAccountId` que
não pertence ao workspace não chama o provider; e duas Actions de workspaces
diferentes produzem `external_id` diferentes na leitura.

Não há mais `WorkspaceIntegration` para o provider social — não há perfil a
guardar. A linha continua existindo, com `provider: 'POST_FOR_ME'` e
`externalId: ws-<uuid>`, por dois motivos: é onde `ExternalReference.integrationId`
se pendura, e é o que a tela lê para saber que o workspace já passou por aqui.

## 5. Rotas

Três mudam de forma; o resto do spec anterior fica.

| Método | Rota | `operationId` | nota |
|---|---|---|---|
| POST | `/integrations/social/connect-url` | `createSocialConnectUrl` | body `{ platform }`, devolve `{ url }` |
| GET | `/integrations/social/accounts` | `listSocialAccounts` | igual, agora com `id` e `status` |
| POST | `/integrations/social/accounts/:accountId/disconnect` | `disconnectSocialAccount` | por conta, não global |

`DELETE /integrations/social` sai: desconectar passa a ser por conta, porque
conectar é por conta. Um "desconectar tudo" viraria N chamadas e uma promessa de
atomicidade que não temos.

`connect-url` é `POST` e não `GET` porque cria estado do outro lado (um fluxo de
OAuth pendente) e porque leva body.

### 5.1 Erros

`UPLOAD_POST_*` são renomeados para `SOCIAL_*` mantendo **os mesmos códigos**
`AUR-T0045..0049`: o significado de cada um não mudou, só o fornecedor por trás.
Renumerar quebraria log e ticket sem ganho.

`ACTION_NOTHING_TO_PUBLISH` (AUR-T0051) fica, e passa a cobrir mais casos: sem
alvo publicável, agora **sempre** recusa, porque não há mais retry de provider a
tentar.

## 6. Configuração

```
POST_FOR_ME_API_KEY   opcional
POST_FOR_ME_BASE_URL  default https://api.postforme.dev
```

Mesma disciplina: sem chave, as rotas sociais respondem 503 e o resto sobe. A
suíte roda sem chave, e nenhum teste toca a rede.

## 7. Frontend

- O card de redes deixa de ter um botão "Conectar redes" e passa a ter **um botão
  por rede não conectada** — é o que a API impõe, e é melhor: o cliente vê o que
  vai autorizar antes de clicar.
- Conta `disconnected` aparece com o rótulo de reconectar, e reconectar é o mesmo
  botão de conectar daquela rede.
- Desconectar é por conta, com `AlertDialog` nomeando a rede.
- O picker escolhe **contas**, não redes: `LinkedIn · @acme` é o rótulo, porque
  duas contas na mesma rede passam a ser possíveis.
- Cópia: "Publicado" fica. Nada mais muda de significado.

## 8. Fora de escopo

Herdado do spec anterior, mais:

- **Bluesky** — exige senha de app, e um campo de senha no nosso formulário é a
  fricção que este design existe para eliminar.
- **`connection_type` do LinkedIn** (pessoa vs página da empresa) — decisão de
  produto, e default `personal` é o comportamento honesto até ela existir.
- **`platform_configurations` e `account_configurations`** — texto por rede, e
  campos específicos de cada uma.
- **`feeds`** e as métricas que dependem dessa permissão.
- **`isDraft` e `scheduled_at`** do provider — a AUREA tem relógio próprio.

## 9. Riscos

1. **Contas ilimitadas, posts contados.** Não sabemos se "1.000 posts" conta post
   ou post-por-rede. Muda a conta por até 4× no nosso caso. É a pergunta a fazer
   ao fornecedor antes de depender do plano de $10, e não muda nada no código.
2. **Sem retry do provider**, um alvo incerto depende de humano. Aceito: era o
   desenho do Postiz, e a incerteza é rara (só falha de rede no POST).
3. **`access_token` chega na nossa resposta do provider.** O raio de alcance de
   um vazamento da nossa chave cresceu: antes era publicar, agora é publicar e ler
   token. Mitigação: nenhum presenter espalha objeto do provider, e o teste de
   "nenhuma resposta contém token" cobre as três rotas.
4. **Quatro redes de texto**, contra seis no desenho anterior. Discord e Telegram
   não existem lá. Aceito por quem decidiu, com o fato registrado.
