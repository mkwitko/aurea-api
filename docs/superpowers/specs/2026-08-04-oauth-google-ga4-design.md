# Conexão da fonte de dados: OAuth Google, com service account ao lado — Design

Data: 2026-08-04
Escopo: `aurea-back` + `aurea-web`
Sucessor de: `2026-08-04-medicao-automatica-ga4-design.md` §4.1, que nomeou este ponto de extensão e o deixou vazio de propósito.

---

## 1. Problema

A medição automática funciona ponta a ponta desde hoje (`6ccdcb1`, `9f3bfa9`), e ninguém consegue usá-la.

Para conectar uma property, o fundador precisa: abrir o Google Cloud Console, criar um projeto, habilitar a Analytics Data API, criar uma service account, gerar uma chave JSON, abrir o Google Analytics, adicionar aquele e-mail como leitor da property, achar o ID numérico da property em Administrador → Configurações, e colar as duas coisas num formulário. São nove passos em três consoles, e o produto é para um fundador não técnico (`docs/product/personas.md`).

O caminho de service account está certo como **piso** — funciona sem depender de ninguém, e foi por isso que a Parte A o construiu primeiro. Ele está errado como **porta de entrada**.

### 1.1 O que a verificação do Google bloqueia, e o que não bloqueia

`analytics.readonly` é escopo sensível, e o Google exige verificação do app para publicá-lo. Isso **não** impede construir nem usar OAuth agora: em modo de teste o app autoriza até 100 contas Google listadas, com um aviso de "app não verificado" na tela de consentimento. Isso cobre o piloto inteiro.

O que a verificação muda é a data em que qualquer pessoa pode conectar sem estar numa lista. É processo com terceiro, não código, e não é pré-requisito deste design.

---

## 2. O que muda, e o que não muda

Muda: conectar passa a ser um clique e uma escolha de nome.

Não muda:

- **O conector.** `createGa4Provider` recebe `mintToken: () => Promise<string>` e não muda uma linha. Era exatamente para isto que `authKind` existia (`2026-08-04-medicao-automatica-ga4-design.md` §4.1).
- **O segredo selado.** Mesmo `seal`/`open` de `src/billing/crypto.ts`, AES-256-GCM com authTag. Para `OAUTH` o texto claro é `{"refresh_token":"…"}`.
- **Uma conexão por fonte por workspace.** `@@unique([workspaceId, provider])` continua. Duas credenciais para a mesma property seriam duas respostas possíveis para "de onde veio este número", e proveniência ambígua é o que este sistema recusa.
- **Somente leitura.** `analytics.readonly`. Um token que pode escrever numa property é um token que pode apagar a medição do cliente.
- **Nada de escrita sem confirmação humana.** Este design não toca em `Outcome`.

---

## 3. O fluxo, e por que tem quatro passos

```text
POST /integrations/google/authorize      (autenticada, ADMIN) → { url }
   ↓ o browser navega para a url
Google — tela de consentimento
   ↓ redirect com ?code&state
GET  /integrations/google/callback       (PÚBLICA)
   ↓ troca o code, sela o refresh_token, grava a integração SEM property
   ↓ 302 → APP_URL/app/settings/integrations?google=connected
GET  /integrations/google/properties     (autenticada, ADMIN) → o que a conta vê
PUT  /integrations/google/property       (autenticada, ADMIN) → grava + health()
```

**Por que `authorize` devolve URL em vez de redirecionar:** a navegação do browser não carrega o header `Authorization`. O frontend busca a URL pelo hook gerado (com o token) e só então navega. Um `GET` que redirecionasse teria de aceitar o token na query string, e token em URL vai para histórico e log de proxy.

**Por que o callback é público:** o Google redireciona o browser, sem header nenhum. Ele é registrado direto no `app.ts`, fora do escopo de `integrationsRoutes` (que aplica `authenticate`/`resolveTenant`), do mesmo jeito que `stripeWebhookRoute` já é.

**Por que escolher a property é um passo separado:** no instante do callback ninguém sabe qual property. Descobrir exige uma chamada à Admin API com o token que acabou de nascer, e a escolha é humana.

**Por que `google` no caminho e `GA4` no dado:** o segmento nomeia o fornecedor de identidade que autoriza (Google), e `provider` continua sendo `'GA4'`, o produto que responde pela métrica. Quando entrar um segundo produto Google, ele reusa este mesmo fluxo de autorização com outro `provider`.

### 3.1 O `state`, que é o que autoriza o callback

Um JWT assinado com `JWT_ACCESS_SECRET` (o mesmo `app.jwt` do login), TTL 10 minutos, com o payload:

```ts
{ workspaceId: string, userId: string, purpose: 'google-oauth' }
```

Três decisões dentro disso:

- **`purpose`** existe para que um access token não sirva de `state`. A verificação do callback recusa qualquer token sem `purpose === 'google-oauth'`.
- **`userId`, e não `sub`.** O access token do app usa `sub`; `authenticate`/`resolveTenant` leem `sub`. Um `state` sem `sub` não funciona como Bearer, então o vetor contrário também está fechado. As duas famílias de token compartilham o segredo e não compartilham forma.
- **TTL de 10 minutos** porque é uma ida ao Google e volta. Não há uso único: um replay dentro da janela reconecta o mesmo workspace à mesma conta Google, que é o resultado que o usuário pediu. Uma tabela de nonce compraria pouco e custaria uma tabela.

O `state` é o que diz **em qual workspace** gravar. Nada no callback aceita workspace de query string.

---

## 4. O segundo cunhador de token

`src/integrations/analytics/ga4/ga4-token.ts` ganha:

```ts
export function oauthMinter(credentialsJson: string, client: { clientId: string; clientSecret: string }): () => Promise<string>;
```

`OAuth2Client` com `setCredentials({ refresh_token })` e `getAccessToken()` — a renovação e o cache são da biblioteca, pela mesma razão que `serviceAccountMinter` já delega: renovar token é criptografia, e criptografia escrita em casa para economizar dependência custa um incidente.

E um seletor, que é o que impede a escolha de vazar para os chamadores:

```ts
export function minterFor(authKind: string, credentialsJson: string): () => Promise<string>;
```

Os três lugares que hoje chamam `serviceAccountMinter` direto passam a chamar `minterFor`: `src/measurement/read-measurement.ts`, `src/http/api/integrations/verify-integration.ts` e `src/ai/tools/list-source-metrics.ts`. Um `authKind` desconhecido é `AnalyticsProviderError`, não um default silencioso.

`minterFor` lê `GOOGLE_OAUTH_CLIENT_ID`/`SECRET` do env e recusa `OAUTH` quando não estão configurados — a mensagem diz que a conexão por Google não está habilitada neste ambiente, e a service account continua funcionando.

---

## 5. O estado que o modelo precisa admitir

**`externalId` passa a ser nulável.** Entre autorizar e escolher a property existe um intervalo real, e representá-lo com string vazia seria um valor-sentinela que todo leitor teria de conhecer para não montar `properties/:runReport` contra nada.

Migração: `ALTER TABLE "WorkspaceIntegration" ALTER COLUMN "externalId" DROP NOT NULL;` — as linhas existentes têm valor e não são tocadas.

Isso cria um quarto código de recusa:

| código | status | significado |
|---|---|---|
| `NO_ANALYTICS_PROPERTY` (`AUR-T0040`) | 400 | conectado, mas nenhuma property escolhida |

Sem ele, `read-measurement` devolveria `NO_ANALYTICS_SOURCE` para quem tem fonte conectada; o fundador iria à página, veria "Conectada", e ficaria sem saída. É o mesmo beco que o 404 da amarração criava antes da correção de hoje: uma recusa que descreve o estado errado manda o humano consertar o que não está quebrado.

`status` não ganha valor novo. `UNVERIFIED` já é exatamente verdade nesse intervalo: nenhum `health()` passou ainda.

---

## 6. `accountLabel`, e desconectar de verdade

**Escopos do OAuth:** `analytics.readonly`, `openid`, `email`. Os dois últimos não são sensíveis e não mexem na verificação; existem para `OAuth2Client.verifyIdToken({ idToken, audience })` devolver o e-mail da conta Google, que é o que o fundador reconhece na tela. Sem chamada de rede extra e sem decodificar JWT à mão.

Se o `id_token` vier ausente ou sem e-mail, `accountLabel` grava `'google account'` em vez de falhar: um rótulo genérico é pior que o e-mail e melhor que perder a conexão inteira.

**`DELETE /integrations` com uma linha `OAUTH`** chama `revokeToken(refresh_token)` no Google antes de apagar, melhor-esforço. Guardar um refresh token vivo depois de o fundador ter desconectado é ficar com uma credencial que prometemos parar de ter. Falha na revogação **não** bloqueia a remoção — o que ele pediu foi parar de usar, e o Google tem a tela dele para revogar do outro lado.

---

## 7. Listar e escolher a property

`GET /integrations/google/properties` abre a credencial guardada, cunha o token por `minterFor` e chama:

```text
GET https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200
→ { accountSummaries: [ { account, displayName, propertySummaries: [ { property, displayName, propertyType } ] } ] }
```

Achatado na resposta como `{ properties: [{ propertyId, displayName, accountName }] }`, onde `propertyId` é o sufixo numérico de `properties/{id}`. Escopo: o mesmo `analytics.readonly` que a leitura já usa — nenhum escopo novo.

Uma página, `pageSize=200` (o teto da API). Quem tiver mais de 200 contas não é o piloto, e um `nextPageToken` ignorado em silêncio seria pior: a resposta declara `truncated: boolean` — verdadeiro quando o Google devolveu `nextPageToken` —, do mesmo jeito que `list_source_metrics` declara o corte dela. É booleano e não contagem porque a API não informa total: dizer "faltaram N" seria um número sem origem.

A rota funciona para os dois `authKind` — uma service account com acesso concedido também enxerga account summaries. Ela não é exclusiva do OAuth porque não precisa ser, e assim "trocar de property" existe nos dois caminhos.

`PUT /integrations/google/property` com `{ propertyId }` grava `externalId` e roda `health()` na hora, gravando `OK` ou `FAILED` + `lastError`. **A validação da property é o próprio `health()`**, não uma segunda ida à lista: se a conta não vê aquela property, a leitura falha, e é essa a verdade que interessa.

---

## 8. Erros

| situação | comportamento |
|---|---|
| `state` ausente, inválido, expirado ou sem `purpose` | 400, nada gravado, nada na URL de volta |
| Google devolve `?error=access_denied` (fundador recusou) | 302 com `?google=error&reason=access_denied`, nada gravado |
| resposta de token sem `refresh_token` | recusa e 302 com erro: guardar só o access token seria uma conexão que morre em uma hora e volta como "medição falhou" depois |
| `id_token` ausente ou sem e-mail | conecta, `accountLabel: 'google account'` |
| `analyticsadmin` recusa a listagem | mensagem da própria fonte; `status: FAILED` + `lastError` |
| property escolhida que a conta não vê | `health()` falha, grava `FAILED` com a mensagem do Google, a tela oferece escolher outra |
| refresh token revogado no Google | a leitura falha com a mensagem dele, `status: FAILED`, a tela oferece reconectar |
| OAuth não configurado no ambiente | 400 nomeando isso; o caminho de service account segue intacto |
| VIEWER | negado em toda escrita (`assertAdmin`/`denyReadOnly`), coberto no `write-guard.test.ts` |
| segredo malformado / chave de cifra ausente | `EncryptionNotConfiguredError` já existente; nunca stack trace na resposta |

**Nada do callback entra na URL de volta além de `google=connected|error` e um `reason` de vocabulário fechado.** Código de autorização e token não passam por query string de redirect, nem por log.

---

## 9. Env novo

| variável | obrigatória | razão |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | não | ausente ⇒ só service account |
| `GOOGLE_OAUTH_CLIENT_SECRET` | não | idem |
| `GOOGLE_OAUTH_REDIRECT_URI` | não | explícita, não derivada: o Google exige correspondência exata com o que está registrado no console, e um valor derivado do host da requisição falha como `redirect_uri_mismatch` — o erro mais caro de diagnosticar deste fluxo |

Todas opcionais e validadas juntas: se uma existe, as três têm de existir. Meia configuração de OAuth é um botão que leva a uma tela de erro do Google.

---

## 10. A página

A tela de hoje (`Ga4ConnectionCard.tsx`, 153 linhas) é um formulário técnico exposto como se fosse o caminho normal. Ela se dissolve em quatro arquivos — ficaria em ~400 linhas como um só, e o estado dela agora tem três ramos:

| arquivo | responsabilidade |
|---|---|
| `Ga4SourceCard.tsx` | o ramo entre os três estados, e o banner de retorno |
| `GoogleConnectButton.tsx` | chama `authorize` e navega |
| `PropertyPicker.tsx` | lista, escolhe, confirma |
| `ServiceAccountForm.tsx` | o formulário de hoje, recolhido atrás de "usar chave de service account" |

Os três estados:

1. **nada conectado** → "Conectar com Google" em destaque; a service account atrás de um disclosure marcado como avançado.
2. **conectado, sem property** → o `PropertyPicker`, com nome da property e da conta. O fundador reconhece "Site institucional"; ele não reconhece `123456789`.
3. **conectado com property** → o que existe hoje (conta, property, status, `lastError`, desconectar) mais "trocar property", que reabre o picker.

**Banner de retorno** lendo `?google=connected|error&reason=…` e limpando o parâmetro depois (`replaceState`), para um F5 não ressuscitar a mensagem.

**Substituir pede confirmação.** Com uma fonte conectada, começar pelo outro caminho abre um `AlertDialog` dizendo que isto substitui a conexão atual. O `@@unique` garante que é substituição, não adição, e essa é a informação que falta na tela.

**Nada renderiza segredo.** O teste que afirma isso hoje continua, agora cobrindo também que nenhuma resposta de OAuth traz `refresh_token`.

---

## 11. Testes

Backend:

- `state`: assina e verifica de ida e volta; recusa expirado, recusa assinatura errada, **recusa um access token do app** (sem `purpose`);
- callback feliz: sela o `refresh_token`, grava `authKind: 'OAUTH'`, `externalId: null`, `status: 'UNVERIFIED'`, e redireciona para `APP_URL` com `google=connected`;
- callback com `?error=access_denied`: redireciona com erro e **não grava nada**;
- callback sem `refresh_token` na resposta do Google: recusa e não grava;
- callback com `state` de outro workspace: grava naquele workspace e em nenhum outro — o teste existe para fixar que o workspace vem do `state` assinado, nunca de query;
- `oauthMinter`: usa o `refresh_token` selado e devolve o access token; `minterFor` escolhe pelo `authKind` e estoura em `authKind` desconhecido; `minterFor('OAUTH')` sem env de OAuth recusa com mensagem própria;
- `properties`: achata `accountSummaries` → `{ propertyId, displayName, accountName }`, declara `omitted` quando trunca, e propaga a mensagem da fonte quando ela recusa;
- `PUT property`: grava `externalId` e o resultado do `health()` (`OK`, ou `FAILED` + `lastError`);
- `read-measurement`: linha OAUTH sem property recusa com `AUR-T0040`, e não chama a fonte;
- `DELETE`: revoga no Google numa linha OAUTH, **e apaga mesmo quando a revogação falha**; não tenta revogar numa linha de service account;
- o segredo ausente de toda resposta de toda rota de integração, incluindo as quatro novas;
- **o caminho de service account intacto**: o teste que prova que conectar por JSON continua funcionando é o que impede o OAuth de virar requisito.

Frontend:

- os três estados do card, cada um com o que oferece;
- `authorize` → navegação (a navegação é stubada; nenhum teste sai do jsdom);
- banner de `google=connected` e de `google=error`, e o parâmetro limpo depois;
- picker mostrando nome de property e de conta, e o `PUT` mandando o `propertyId` escolhido;
- confirmação antes de substituir uma conexão existente;
- nenhum segredo em tela, em nenhum dos três estados;
- i18n pt/en/es, `Help` em cada termo novo (property, conta Google, service account, escopo de leitura).

Nenhum teste toca a rede, nem no back nem no web.

---

## 12. Ordem

1. `minterFor` + `oauthMinter` + os três chamadores migrados + env novo. Nada de novo funciona ainda, e nada quebra.
2. `externalId` nulável + `AUR-T0040` no leitor. A recusa correta existe antes de existir quem a produza.
3. `state` + `authorize` + `callback` público. Dá para conectar; ainda não dá para medir.
4. `properties` + `PUT property` + revogação no `DELETE`. Fecha o backend.
5. As quatro telas.

1 → 2 → 3 → 4 é a corrente obrigatória. 5 depende de tudo.

---

## 13. Fora de escopo

Cada item é decisão consciente:

- **Verificação do app no Google**: processo com terceiro, não código. §1.1.
- **Rotação de refresh token**: o Google não rotaciona por padrão; construir o caminho de rotação agora seria código sem gatilho.
- **Múltiplas properties por workspace**: `@@unique` mantido. §2.
- **Segunda fonte** (PostHog, Ads, CRM): a interface do conector existe para isso, e normalizar sem duas fontes é adivinhar vocabulário.
- **OAuth para escrita** em qualquer produto Google: escopo de escrita não entra neste sistema.
- **Login com Google** (autenticação do próprio AUREA): é outro assunto — este OAuth autoriza leitura de dados, não identifica usuário do produto.
