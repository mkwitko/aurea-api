# Relógio do experimento — Design

Data: 2026-08-03
Escopo: `aurea-back` + `aurea-web`
Subprojeto: 3a de três (ver §8 — Fora de escopo)

---

## 1. Problema

O loop pós-`PLANNED` está construído e não roda.

Existe hoje:

- transições completas — `approve-experiment/`, `start-experiment/`,
  `pause-experiment/`, `complete-experiment/`, `cancel-experiment/`, todas sobre
  `transitionExperimentService` (`experiments.transition.ts`) e a tabela de
  arestas em `experiments.domain.ts`;
- `Outcome` com proveniência mínima (`source` default `"USER"`,
  `schema.prisma:433`), `create-outcome/` e `list-outcomes/`;
- comparação contra os dois números acordados antes —
  `compareMeasurement` em `outcomes.domain.ts`, que devolve
  `delta`/`deltaPct`/`progressPct` e nenhum veredito, porque
  `docs/domains/experiments.md` §14 proíbe transformar aritmética em sucesso;
- interpretação — agente `interpret-outcome` (input `{ experimentId }`,
  2 créditos em `billing/operation-cost.ts:13`) e materialização do Learning
  candidato em `learnings/from-run/`.

Não existe **o gatilho**. Três ausências concretas:

### 1.1 `startDate` e `endDate` são colunas mortas

`schema.prisma:410-411`. O fundador declara a duração do teste — é exigência do
gate de `PLANNED` (`PLAN_REQUIRED_FIELDS`, `experiments.domain.ts`) — e nada no
sistema lê essas datas depois. Um experimento aprovado fica `APPROVED` até
alguém clicar em iniciar; um experimento que terminou continua `RUNNING` para
sempre.

### 1.2 Nada existe periodicamente fora do worker de runs

`src/ai/queue/worker.ts:85` tem o único tick do sistema
(`setInterval(env.AI_RUN_REAPER_INTERVAL_MS)`, reaper de runs órfãos). Não há
job repetível, cron, nem scheduler de domínio.

### 1.3 Nada puxa o fundador de volta

O dashboard tem `RECORD_OUTCOME` no enum de próxima ação
(`dashboard.schema.ts:33`), mas o modelo é de um loop por vez — `loop.experiment`
é um objeto, não uma lista. Não há contagem do que está esperando número, e não
há e-mail nem notificação (nenhuma dependência de envio no `package.json`).

Consequência: o número só entra se o fundador lembrar sozinho, na data certa,
sem ninguém pedir. É o ponto exato onde o loop de aprendizado morre.

---

## 2. Restrição de domínio

Vale integralmente o que o auto-plano estabeleceu, e este design não a afrouxa:
**nenhum código gera, infere ou assume `baselineValue`, `targetValue`,
`startDate` ou `endDate`.**

O relógio não é exceção. Ele **cumpre** datas declaradas pelo humano; nunca as
escreve. Um experimento sem `startDate` nunca inicia sozinho, e um sem `endDate`
nunca completa sozinho — a ausência da data é a ausência da declaração, e
inventar o dia envenena a leitura do resultado tanto quanto inventar o baseline.

Também vale `docs/domains/experiments.md` §14: completar não é ter sucesso. O
relógio move status; a avaliação continua sendo aritmética (`compareMeasurement`)
mais um Learning que um humano valida.

---

## 3. O relógio (backend)

### 3.1 Decisão pura

Novo arquivo `src/http/api/experiments/experiments.clock.ts`. Funções puras,
sem Prisma, sem `Date.now()` interno — `now` entra por parâmetro:

```ts
export type ClockRow = {
  id: string;
  status: ExperimentStatus;
  startDate: Date | null;
  endDate: Date | null;
};

/** Para onde este experimento vai agora, ou null se fica onde está. */
export function dueTransition(row: ClockRow, now: Date): ExperimentStatus | null;
```

Regras, e nenhuma outra:

| de | condição | para |
|---|---|---|
| `APPROVED` | `startDate !== null` e `startDate <= now` | `RUNNING` |
| `RUNNING` | `endDate !== null` e o dia de `endDate` já passou inteiro em UTC | `COMPLETED` |

`DRAFT`, `PLANNED`, `PAUSED`, `COMPLETED` e `CANCELLED` não são tocados.
`PAUSED` em particular: pausar é decisão humana com motivo
(`docs/domains/experiments.md` §21), e retomar por relógio apagaria essa
decisão.

### 3.2 Fronteira de dia

`Workspace` não tem timezone (`schema.prisma:69`). Comparação em UTC, errando
para o lado de **não** fechar cedo: `RUNNING` só vira `COMPLETED` quando
`now` passou do fim do dia UTC de `endDate` — um experimento com `endDate` hoje
não completa hoje. Fechar um dia antes cortaria medição que o fundador contava
ter; fechar um dia depois só atrasa a cobrança.

Timezone por workspace fica fora de escopo (§8) e esta é a decisão que a torna
substituível depois: a fronteira mora numa função só.

### 3.3 Execução

Novo `src/schedule/experiment-clock.ts` (diretório novo — `src/ai/queue/` é do
runtime de IA e um relógio de domínio não pertence lá):

```ts
export function startExperimentClock(deps: ClockDeps): NodeJS.Timeout;
```

Mesmo padrão do reaper: `setInterval(env.EXPERIMENT_CLOCK_INTERVAL_MS)`, default
**900_000** (15 min) em `src/config/env.ts`. Granularidade de dia não precisa de
mais; atrasar 15 minutos é invisível.

Iniciado em `src/worker.ts` junto do reaper, com `clearInterval` no `shutdown` —
o mesmo tratamento que `reaper` já recebe. Roda no processo do worker, não na
API: a API reinicia a cada deploy.

Idempotente por construção: a consulta é por status + data, não por evento. O
worker fora do ar significa transição atrasada, nunca perdida — o tick seguinte
encontra o mesmo experimento ainda vencido.

Falha de uma transição não derruba o tick: cada experimento é tratado num
`try/catch`, o erro é logado com o id, e os demais continuam. Mesma postura de
`reconcileDeadRun`.

### 3.4 Escopo de tenant — a exceção, explícita

O relógio cruza workspaces. É a segunda função do sistema com essa
permissão (a primeira é `reapStaleRuns`), e por isso a exceção fica nomeada em
vez de acidental:

- novo método no `experiments.repository.ts` chamado **`findDueSystemWide`**, sem
  parâmetro `workspaceId`, com comentário dizendo por que;
- um teste que afirma que a consulta é system-wide de propósito e que filtra
  apenas `APPROVED` e `RUNNING` — se alguém acrescentar um status ao `in`, o
  teste cai;
- a transição em si passa pelo caminho normal, com `workspaceId`: o relógio lê
  system-wide e escreve por tenant.

### 3.5 Reuso do guard

A escrita usa `transitionExperimentService` — o mesmo serviço dos botões — e
portanto passa por `assertExperimentTransition`. O relógio **não pode fazer um
movimento que um humano não poderia**. `COMPLETED` recebe `completedAt` pelo
`extra`, igual a `complete-experiment`.

Teste explícito: se a aresta sai da tabela, o relógio falha em vez de escrever
direto.

---

## 4. Medição pendente (leitura)

### 4.1 Definição

**`status = COMPLETED` e zero outcomes.** Uma definição só, e o relógio garante
que todo experimento chega lá na data que o fundador declarou.

Um experimento completado à mão sem número cai na mesma lista, o que é correto:
o problema é o mesmo.

### 4.2 Onde aparece

`get-dashboard` passa a devolver mais um campo. Sem rota nova — o dashboard já é
o agregador do estado do loop, e um segundo endpoint dividiria a mesma pergunta
em dois lugares.

```ts
export const dashboardPendingMeasurement = z.object({
  experimentId: z.string(),
  name: z.string(),
  metric: z.string(),
  endDate: z.date().nullable(),
});

// dashboardResponse ganha:
pendingMeasurement: z.object({
  count: z.number().int(),
  // No máximo 5. `count` carrega a verdade — um corte silencioso leria como
  // "é só isso".
  items: z.array(dashboardPendingMeasurement),
});
```

`count` é a contagem real, `items` os 5 primeiros ordenados por `endDate`
crescente com nulos ao fim (um experimento completado à mão pode não ter data),
desempatando por `completedAt`. A tela diz "+3" a partir da diferença, nunca
finge que a lista é tudo.

---

## 5. O número fecha o loop

### 5.1 Disparo

`create-outcome` grava e, na mesma requisição, enfileira `interpret-outcome`.

Ordem obrigatória: **o outcome commita primeiro.** A medição é fato observado; o
faturamento não pode bloqueá-la. Só depois de gravado o run é disparado.

Resposta passa de `{ outcome }` para:

```ts
{
  outcome: outcomeResponse,
  // Null quando o disparo não aconteceu — o número está gravado do mesmo jeito.
  interpretation: z.object({
    agentRunId: z.string().nullable(),
    reason: z.string().nullable(),
  }),
}
```

A resposta muda de forma, então `openapi:dump` e o Kubb são regerados — o hook
`useCreateOutcome` passa a devolver `interpretation`.

O serviço recebe `startRun` como dependência, exatamente como
`plan-experiments.service.ts` faz: o controller injeta, o serviço não conhece a
fila. Falha de autorização de crédito ou de enfileiramento vira
`{ agentRunId: null, reason }`, nunca exceção — o 201 do outcome já está
merecido.

### 5.2 Deduplicação

`concurrencyKey` default é `${taskType}:${inputHash}`, e a busca é por
`status in ('PENDING','RUNNING')`
(`agent-run.repository.ts:51`). Consequências, ambas desejadas:

- dois outcomes gravados quase juntos no mesmo experimento reaproveitam o run em
  voo — uma interpretação sobre os resultados atuais, não duas;
- um outcome gravado depois de a interpretação anterior ter completado dispara um
  run novo, porque `COMPLETED` não bloqueia.

### 5.3 Custo visível antes

O botão diz o preço e o saldo antes do clique — "Gravar e interpretar · 2
créditos", com saldo e aviso de saldo curto, o mesmo padrão do painel de
auto-plano. Nada é cobrado sem estar escrito na tela.

### 5.4 Learning continua candidato

O run produz interpretação; `learnings/from-run` materializa o Learning como
`CANDIDATE`. Validar é humano. Automação aqui é sobre **quando o trabalho
começa**, nunca sobre quem aprova conhecimento.

---

## 6. Frontend

Tailwind + shadcn/ui, hooks gerados pelo Kubb, i18n em pt/en/es, `Help` em cada
termo de domínio novo.

- **Card no dashboard** — "N testes esperando o número", listando até 5 com nome,
  métrica e data de fim, e "+N" quando `count` excede. Clique abre o experimento
  na medição.
- **Badge na nav** — mesmo `count`, mesma query (React Query já compartilha o
  cache), para pegar quem entra direto em outra tela.
- **Formulário de medição** — no detalhe do experimento: valor, unidade,
  `observedAt` (default hoje, futuro recusado pelo backend), custo + saldo no
  botão.
- **Depois de gravar** — com `agentRunId`, acompanha o run e materializa o
  Learning **uma vez só**, com guarda de `isIdle` e nunca por polling (padrão de
  `PlanExperimentRun.tsx`). Com `agentRunId: null`, mostra "número gravado,
  interpretação não rodou: `reason`" e um botão de retry que dispara
  `interpret-outcome` pelo caminho existente.
- **Invalidação** — gravar invalida dashboard, outcomes e experimento; o saldo já
  é invalidado pelo `MutationCache` global (`api/query-client.ts`).

---

## 7. Erros

| situação | comportamento |
|---|---|
| `observedAt` no futuro | 400, já implementado em `create-outcome.service.ts` |
| saldo insuficiente no disparo | outcome gravado, `agentRunId: null`, retry na tela |
| worker fora do ar | transições atrasam, nada se perde; próximo tick resolve |
| transição inválida vinda do relógio | erro logado com o id, tick continua nos demais |
| experimento sem `endDate` em `RUNNING` | fica `RUNNING`; o relógio não inventa data |
| VIEWER | negado em toda escrita (`assertWriter`), coberto no `write-guard.test.ts` |

---

## 8. Fora de escopo

Cada item abaixo é decisão consciente, não esquecimento:

- **E-mail e push** — não há infra de envio; é subsistema próprio (provedor,
  entregabilidade, templates em três locales). A cobrança nasce in-app.
- **`Action` e conectores** (subprojeto 3b) — AUREA ainda não executa nada em
  canal externo. Enquanto isso, `RUNNING` significa "o fundador está rodando isto
  nas ferramentas dele", e o relógio é honesto sobre esse limite.
- **Ingestão automática de métrica** (subprojeto 3c) — GA4/PostHog/Ads,
  normalização, proveniência por fonte. `docs/domains/analytics.md` §28 é
  explícito: entrada manual existe para o loop fechar antes das integrações.
- **Timezone por workspace** — UTC agora, isolado numa função (§3.2).
- **Entrada em massa de outcomes** — um fundador no piloto não tem volume.
- **PAUSED automático** — pausar tem motivo humano.
- **Anomaly flagging** (`analytics.md` §16) — depende de série histórica.

---

## 9. Testes

Backend:

- `experiments.clock.ts` — tabela pura: `APPROVED` vencido/não vencido, `RUNNING`
  vencido/não vencido, `startDate`/`endDate` nulos, `PAUSED` e `CANCELLED`
  intocados;
- fronteira de dia — `endDate` hoje não completa hoje; `endDate` ontem completa;
- o relógio não fura a tabela de transições (aresta removida ⇒ falha, não
  escrita);
- `findDueSystemWide` — afirma o cruzamento de workspaces como intencional e o
  filtro exato de status;
- `create-outcome` — outcome persiste quando `startRun` rejeita (saldo curto), com
  `agentRunId: null` e `reason`; devolve `agentRunId` no caminho feliz;
  `observedAt` futuro segue 400;
- `get-dashboard` — `count` exclui experimentos que já têm outcome; `items`
  limitado a 5 com `count` maior; negação cross-tenant;
- `write-guard.test.ts` — a rota de outcome sob VIEWER.

Frontend:

- card do dashboard com `count` e "+N"; badge na nav;
- formulário mostra custo e saldo antes do clique;
- `agentRunId: null` mostra a razão e o retry;
- materialização do Learning acontece uma vez só, nunca por polling.

---

## 10. Ordem

1. Relógio: decisão pura + `findDueSystemWide` + scheduler + env + wiring no
   worker.
2. Medição pendente no `get-dashboard`.
3. Disparo de `interpret-outcome` no `create-outcome`.
4. Frontend: card, badge, formulário, retry.

1 entrega valor sozinho (as datas passam a valer algo). 2 depende de 1 para
existir população. 3 é independente de 1 e 2. 4 depende de 2 e 3.
