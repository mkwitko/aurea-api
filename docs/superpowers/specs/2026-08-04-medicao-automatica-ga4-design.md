# Medição automática (GA4) — Design

Data: 2026-08-04
Escopo: `aurea-back` + `aurea-web`
Subprojeto: 3c de três. 3b (execução: `Action`, `Approval`, Postiz) fica fora — ver §10.

---

## 1. Problema

O relógio do experimento (`2026-08-03-relogio-do-experimento-design.md`) fechou o
loop, mas com o fundador no meio: o experimento vence, o dashboard cobra, e ele
digita o número. A entrada manual está certa como piso — `docs/domains/analytics.md`
§28: *"Manual Outcome entry ensures the loop can close before every integration
exists"* — mas é o elo mais fraco. Um número que ninguém digita é um learning que
não nasce.

Duas ausências concretas:

### 1.1 Não existe conector nenhum de analytics

`src/integrations/` tem `search/` (Tavily) e `tracing/` (Langfuse). Nada de
analytics, nada de credencial de integração por workspace, nada que saiba ler uma
métrica de fora.

### 1.2 `Experiment.metric` é texto livre

`prisma/schema.prisma:406`, `metric String`. O fundador escreve `conversion_rate`,
`reply_rate`, `discovery_calls_booked` — o que fizer sentido para ele. **Nenhum
código pode derivar disso uma consulta GA4.** É a mesma classe de problema do
baseline: a origem do número é declaração humana, não inferência.

---

## 2. O que muda, e o que não muda

Muda: o fundador deixa de precisar **saber** o número.

Não muda: ele continua tendo de **concordar** com ele. Um Outcome só nasce de
confirmação humana. `docs/domains/analytics.md` §12 é explícito — *"Observed Data
Is Not Automatically Truth"* — e lista as causas: tracking quebrado, evento
duplicado, atribuição mal configurada. Um número errado confirmado como fato
contamina a interpretação e o learning que vêm depois, e desfazer sai mais caro
que confirmar antes.

Continuam valendo, sem exceção:

- nenhum código gera, infere ou assume `baselineValue`, `targetValue`,
  `startDate` ou `endDate` (`src/ai/agents/fill/propose-experiment.ts`);
- nada produz veredito de sucesso a partir de aritmética
  (`docs/domains/experiments.md` §14);
- isolamento por `workspaceId` em toda leitura e escrita.

---

## 3. Conector: uma capacidade, três operações

`docs/architecture/integration-architecture.md` §4 lista sete operações
(`connect`, `disconnect`, `health`, `capabilities`, `execute`, `sync`,
`handleWebhook`). Este design implementa **três**, e a razão de cada ausência:

| operação | decisão |
|---|---|
| `health()` | **sim** — a tela precisa dizer se a conexão ainda vale antes de o fundador esperar por um número |
| `listMetrics()` | **sim** — é o que permite o formulário e o agente falarem das métricas que a property realmente tem |
| `readMetric()` | **sim** — a razão de existir |
| `execute()` | não — executar é 3b |
| `handleWebhook()` | não — o GA4 Data API não empurra nada; é pull |
| `capabilities()` | não — com uma fonte só não há o que negociar |
| `connect`/`disconnect` | vira CRUD de `WorkspaceIntegration`, não método de conector |

O contrato fica separado da implementação, no mesmo formato de
`src/integrations/search/search-provider.ts` (que existe separado justamente pelo
princípio 5 do `CLAUDE.md`, independência de fornecedor):

```ts
// src/integrations/analytics/analytics-provider.ts
export type MetricPeriod = { startDate: Date; endDate: Date };

export type MetricDescriptor = {
  /** Nome usável na consulta — `apiName` no GA4. */
  apiName: string;
  /** Nome que o humano vê na interface da fonte. */
  uiName: string;
  description: string;
  /** Métrica criada pelo próprio cliente na property, não universal do GA4. */
  custom: boolean;
};

export type MetricReading = {
  value: number;
  /** Null quando a fonte não declara unidade — não é o mesmo que adimensional. */
  unit: string | null;
  /** A referência externa do que foi lido: property + consulta, para auditoria. */
  externalRef: string;
  /** A consulta exata que produziu o número, como a fonte a recebeu. */
  query: unknown;
};

export interface AnalyticsProvider {
  readonly name: string;
  health(signal: AbortSignal): Promise<void>;
  listMetrics(signal: AbortSignal): Promise<{ metrics: MetricDescriptor[]; dimensions: MetricDescriptor[] }>;
  readMetric(config: unknown, period: MetricPeriod, signal: AbortSignal): Promise<MetricReading>;
}

export class AnalyticsProviderError extends Error {}
```

### 3.1 `GA4Connector`

`src/integrations/analytics/ga4/`. Chamadas verificadas contra a documentação do
Google (Data API v1beta):

- **ler**: `POST https://analyticsdata.googleapis.com/v1beta/properties/{propertyId}:runReport`
  com corpo
  ```json
  {
    "dateRanges": [{ "startDate": "2026-08-01", "endDate": "2026-08-14" }],
    "metrics": [{ "name": "conversions" }],
    "dimensionFilter": {
      "filter": { "fieldName": "eventName", "stringFilter": { "value": "sign_up" } }
    },
    "metricAggregations": ["TOTAL"]
  }
  ```
  Sem `dimensions`: a leitura quer um número do período inteiro, não uma série.
  O valor sai do total agregado.

  As datas viajam como `YYYY-MM-DD` em **UTC**, derivadas de `startDate`/`endDate`
  do experimento — a mesma fronteira de dia que `experiments.clock.ts` usa. Duas
  regras de dia divergindo mediriam um período diferente do que o relógio fechou.
- **listar**: `GET https://analyticsdata.googleapis.com/v1beta/properties/{propertyId}/metadata`
  → `{ name, dimensions: [{ apiName, uiName, description, customDefinition, category }], metrics: [...] }`.

A chamada HTTP é `fetch` cru com `AbortSignal`, igual a `tavily.ts`. **Uma
dependência nova**: `google-auth-library`, usada só para cunhar o token — assinar
JWT RS256 e fazer cache de token à mão é criptografia escrita em casa por
economia de 40 kB, e a mesma biblioteca cobre o caminho OAuth depois.

Escopo: `https://www.googleapis.com/auth/analytics.readonly`. Somente leitura, e
isso é decisão de design, não configuração: um token que pode escrever numa
property é um token que pode apagar a medição do cliente.

---

## 4. Credencial: `WorkspaceIntegration`

Modelo novo, no mesmo formato selado que o BYOK de IA já usa —
`seal`/`open` de `src/billing/crypto.ts`, AES-256-GCM com authTag (adulteração
falha em `final()`, nunca silenciosamente):

```prisma
model WorkspaceIntegration {
  id           String   @id @default(uuid())
  workspaceId  String
  /** 'GA4' hoje. A segunda fonte entra aqui, não num modelo novo. */
  provider     String
  /** 'SERVICE_ACCOUNT' | 'OAUTH' — como o conector obtém o token. */
  authKind     String
  ciphertext   Bytes
  iv           Bytes
  authTag      Bytes
  /** Property GA4. Fora do segredo: não é sigilo, e a tela precisa mostrá-la. */
  externalId   String
  /** O que o fundador reconhece: e-mail da service account, ou conta Google. */
  accountLabel String
  status       String   @default("UNVERIFIED")
  lastCheckedAt DateTime?
  lastError    String?
  createdBy    String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, provider])
}
```

`status`: `UNVERIFIED` ao criar, `OK` depois de um `health()` que passou,
`FAILED` com `lastError` quando não passou. Guardado em vez de recalculado a cada
tela: `health()` é uma chamada de rede, e a lista de integrações não pode custar
uma ida ao Google por render.

O segredo nunca sai em resposta nenhuma. A rota de leitura devolve `provider`,
`authKind`, `externalId`, `accountLabel`, `status`, `lastCheckedAt`, `lastError`
— e nada de `ciphertext`. Um teste afirma isso, porque é o tipo de vazamento que
passa despercebido num `select` acrescentado depois.

### 4.1 Os dois caminhos de autenticação, e por quê

`authKind` é o discriminador que deixa os dois coexistirem atrás do mesmo
conector:

- **`SERVICE_ACCOUNT`** (agora): o fundador — ou nós, no onboarding do piloto —
  cria uma service account e a adiciona como leitora da property. O JSON da chave
  é o segredo selado. Funciona hoje, sem depender de ninguém.
- **`OAUTH`** (depois): o fundador clica em conectar. É a UX certa para a persona
  e **não é construível no nosso prazo**: `analytics.readonly` é escopo sensível,
  e o Google exige verificação do app para produção — sem ela, o app fica preso a
  usuários de teste com aviso de "app não verificado". O trabalho de OAuth entra
  quando a verificação sair; a interface do conector não muda quando isso
  acontecer.

O que este design entrega é `SERVICE_ACCOUNT` funcionando ponta a ponta, com o
ponto de extensão nomeado. Nada de código morto de OAuth "preparando o terreno".

---

## 5. Amarração: `MetricBinding`

Onde o experimento diz de onde vem o número dele:

```prisma
model MetricBinding {
  id           String   @id @default(uuid())
  workspaceId  String
  /** 1:1 com o experimento hoje. Ver a nota de promoção abaixo. */
  experimentId String   @unique
  provider     String
  /** Config específica da fonte. GA4: { metric, dimensionFilter? }. */
  config       Json
  createdBy    String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  workspace  Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  experiment Experiment @relation(fields: [experimentId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
}
```

`config` é validada por um schema Zod **por provider** antes de gravar
(`ga4BindingConfig`: `metric: string`, `dimensionFilter?: { fieldName, value }`),
então um Json livre no banco não é um Json livre na entrada.

**Sem binding, nada muda.** O experimento segue no fluxo manual de hoje: o
dashboard cobra, o fundador digita. A adoção é por experimento, e nenhuma tela
existente passa a exigir integração.

**Promoção futura a catálogo** (`analytics.md` §8-9, normalização entre fontes):
relaxar o `@unique`, tornar `experimentId` nulável e apontar o experimento para a
entrada do catálogo. Não agora — vocabulário canônico decidido antes de dois
experimentos medidos é vocabulário chutado.

---

## 6. O agente que preenche: `propose-metric-binding`

A amarração é um formulário de dois campos, e um formulário de dois campos que o
fundador não sabe preencher é um formulário que ele não preenche: ele conhece
"taxa de conversão", não `conversions` com `eventName == sign_up`.

O agente lê:

- do experimento: `metric` (texto livre), `objective`, `channel`, `audience`;
- da fonte: `listMetrics()` — as métricas e dimensões que **aquela property
  realmente tem**, incluindo as customizadas do cliente.

E propõe `{ metric, dimensionFilter?, rationale }`.

Duas travas:

1. **O fundador confirma sempre.** A amarração é proveniência, e proveniência não
   se infere — a mesma razão pela qual `propose-experiment` não preenche baseline.
2. **Nenhuma métrica plausível ⇒ devolve vazio com o motivo.** O agente não
   escolhe a mais parecida. Uma amarração errada não erra o formulário: erra todos
   os números daquele experimento para sempre, e o erro chega disfarçado de dado.

Custo: **1 crédito**, registrado em `src/billing/operation-cost.ts` junto dos
outros de preenchimento, com o preço na tela antes do clique. `output-budget.ts`
deriva o teto de saída do próprio schema, como todos os agentes desde `9d8bb1e`.

---

## 7. Leitura sob demanda, sem tabela nova

O relógio já entrega "medição pendente" no dashboard. Ao abrir um experimento
pendente **que tenha binding**, a tela busca a proposta:

```text
GET /experiments/:id/measurement-proposal
→ 200 {
    value: number,
    unit: string | null,
    periodStart: Date,
    periodEnd: Date,
    externalRef: string,
    query: unknown,
    /** 'GA4' */
    source: string
  }
```

O período é `[startDate, endDate]` do próprio experimento — as datas que o
fundador declarou, as mesmas que o relógio cumpriu. Sem elas não há período e a
rota recusa: não se mede um teste que não disse quando rodou.

**Nada é persistido.** A proposta é transitória, e confirmar é o
`POST /experiments/:id/outcomes` que já existe, agora carregando a proveniência.

Por que sem job de fundo: a confirmação humana é obrigatória, então puxar antes
de alguém olhar não adianta — e evita uma tabela de propostas, um estado novo em
`Outcome`, e uma chamada de API por experimento que ninguém abriu. Quando (e se)
a confirmação deixar de ser obrigatória, o job entra; hoje ele seria trabalho
para ninguém.

---

## 8. Proveniência no `Outcome`

`source` deixa de ser sempre `'USER'`. Colunas novas:

```prisma
  periodStart  DateTime?
  periodEnd    DateTime?
  /** Referência externa do que foi lido: property + consulta. */
  externalRef  String?
  /** A consulta exata que produziu o número, como a fonte a recebeu. */
  sourceDetail Json?
```

Nuláveis porque o Outcome digitado à mão continua existindo e continua válido — a
proveniência dele é `source: 'USER'` e o `observedAt` que o fundador informou.

`analytics.md` §11 pede cinco coisas: source, external reference, observed at,
ingestion method, confidence. As quatro primeiras ficam cobertas (`source` +
`externalRef` + `observedAt` + `sourceDetail`, que é o método por extenso, não um
enum vago).

**`confidence` fica de fora, e isto é decisão, não esquecimento.** O modelo do §26
existe para reconciliar fontes que discordam. Com uma fonte só não há discordância
a modelar, e atribuir `MEDIUM` a toda leitura automática seria exatamente o número
sem origem que o resto do sistema recusa. Entra com a segunda fonte.

O corpo de `POST /experiments/:id/outcomes` ganha **um** campo:
`fromSource?: boolean`. Com `fromSource: true`, o cliente **não manda valor
nenhum** — o serviço lê pelo conector, usando o binding e o período do
experimento, e grava o que o conector devolveu junto da proveniência. O `value`
do corpo continua obrigatório no caminho manual e é recusado no caminho de fonte.

O contrário — aceitar `value` + `source: 'GA4'` do browser — seria um número sem
origem com selo de origem, pior que digitar à mão porque parece auditado. Confirmar
é concordar com a leitura, não transportá-la.

---

## 9. Erros

| situação | comportamento |
|---|---|
| workspace sem integração | a tela pede conectar; a rota de proposta responde 400 com código próprio |
| experimento sem binding | a tela oferece o agente ou o formulário; nada é buscado |
| experimento sem `startDate`/`endDate` | 400: sem período declarado não há o que medir |
| GA4 recusa (401, property removida, sem permissão) | mensagem da própria fonte + retry; `status: FAILED` e `lastError` gravados; o campo manual continua ao lado |
| a fonte responde zero linhas | mostra **zero explicitamente**, como "a fonte respondeu zero" — que é diferente de "não deu para ler". Confundir os dois é como o tracking quebrado entra no Growth Brain disfarçado de resultado ruim |
| segredo malformado / chave de cifra ausente | `EncryptionNotConfiguredError` já existente; nunca um stack trace na resposta |
| VIEWER | negado em toda escrita (`assertWriter`), coberto no `write-guard.test.ts` |
| timeout da fonte | `AbortSignal` com o mesmo teto de chamada externa que a busca usa; erro tipado, nunca pendura a requisição |

---

## 10. Fora de escopo

Cada item é decisão consciente:

- **Execução (3b)**: `Action`, `Approval`, `ExternalReference`, Postiz, webhooks,
  idempotência por Action. É `docs/development/phase-07-content.md` e
  `phase-08-social.md`, e é o único lado que gasta dinheiro e reputação do
  fundador se errar — `guardrails.md` §5, autonomia é conquistada.
- **Segunda fonte** (PostHog, Meta/Google Ads, CRM) e **normalização entre
  fontes**: a interface do conector existe para isso, mas normalizar sem duas
  fontes é adivinhar o vocabulário.
- **Catálogo de métricas do workspace**: caminho de promoção descrito em §5.
- **`confidence` no Outcome**: §8.
- **OAuth Google**: §4.1 — bloqueado por verificação de terceiro, não por escopo
  de código.
- **Job de fundo puxando medição**: §7.
- **Atribuição** (`analytics.md` §13-15) e **detecção de anomalia** (§16-17):
  ambas precisam de série histórica que o piloto ainda não tem.
- **Ingestão de evento cru e normalização de evento** (`analytics.md` §7 e o
  modelo `Normalized Event` do §25): este design lê métrica agregada de um
  período, não evento a evento.

---

## 11. Testes

Backend:

- `GA4Connector` contra `fetch` falso: leitura feliz, **401**, property removida
  (404), zero linhas, corpo inesperado (contrato quebrado ⇒
  `AnalyticsProviderError`, nunca `undefined` virando `NaN`);
- `listMetrics` mapeando `apiName`/`uiName`/`customDefinition` do formato real do
  Google, a partir de um fixture gravado da resposta de `metadata`;
- credencial: `seal`/`open` de ida e volta, e **o segredo ausente de toda
  resposta** de toda rota de integração;
- `health()` gravando `status` e `lastError`, e a tela não pagando uma ida ao
  Google por render;
- `ga4BindingConfig` recusando config malformada antes de gravar;
- `MetricBinding` com negação cross-tenant, e `measurement-proposal` de um
  experimento de outro workspace indistinguível de inexistente;
- `measurement-proposal` sem integração, sem binding e sem datas — três recusas
  distintas, com códigos distintos;
- `create-outcome` **refazendo a leitura** quando o cliente manda proveniência
  externa, e não confiando no `value` do corpo;
- proveniência realmente gravada (`source`, `externalRef`, `periodStart/End`,
  `sourceDetail`);
- o agente `propose-metric-binding`: output schema, e o caso "nenhuma métrica
  serve" devolvendo vazio com motivo em vez da mais parecida;
- **o caminho manual intacto**: um experimento sem binding continua medindo como
  hoje, e o teste que prova isso é o que impede a automação de virar requisito.

Frontend:

- tela de conexão: cria, mostra `status`, mostra `lastError`, nunca mostra o
  segredo;
- formulário de amarração com o botão de preencher com IA, custo e saldo antes do
  clique, e o caso "nenhuma métrica serve" explicando em vez de propor;
- proposta de medição: número, período e fonte visíveis, um clique para
  confirmar, campo manual ao lado;
- zero da fonte lido como zero, não como falha;
- i18n em pt/en/es, `Help` em cada termo novo (property, métrica da fonte,
  dimensão, proveniência).

---

## 12. Ordem

1. `WorkspaceIntegration` + `GA4Connector` (`health`, `listMetrics`) + rotas de
   conexão. Entrega valor sozinho: dá para conectar e verificar.
2. `MetricBinding` + `ga4BindingConfig` + rotas. Amarração à mão já funciona.
3. `propose-metric-binding`. A assistência de IA sobre o passo 2.
4. `readMetric` + `GET /experiments/:id/measurement-proposal` + proveniência no
   `Outcome` (migração + `create-outcome` refazendo a leitura).
5. Telas: conexão, amarração, proposta.

1 → 2 → 4 é a corrente obrigatória. 3 depende de 1 (precisa de `listMetrics`) e de
2 (precisa de onde gravar). 5 depende de tudo.
