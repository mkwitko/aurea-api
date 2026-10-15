# Auto-plano e proposal-usage — Design

Data: 2026-08-03
Escopo: `aurea-back` + `aurea-web`

---

## 1. Problema

Dois problemas, um deles bug e o outro ausência de automação.

### 1.1 Opções já adotadas continuam sendo oferecidas

O fundador roda `propose-strategies`, escolhe uma ou mais opções, adota, e a
estratégia nasce como rascunho. Ao voltar à tela de estratégias, **o deck da
proposta ainda mostra todas as opções**, incluindo as que já viraram estratégia.

Causa: o backend já sabe quais opções foram gastas —
`strategies.repository.ts:64`, `usedOptionIndexes()` — mas essa função só é
consumida internamente por `create-from-proposal` para recusar adoção
duplicada. **Não existe rota expondo isso ao frontend.**

Sem esse dado, `ProposeStrategies.tsx` não tem escolha:

- a recuperação adota o run mais novo do task type independente do status
  (`ProposeStrategies.tsx:74-76`), por decisão explícita — filtrar por `RUNNING`
  perderia o resultado de um run que terminou durante um reload;
- o run permanece `COMPLETED` com output válido para sempre;
- logo o branch `proposal?.ok && activeId` (`ProposeStrategies.tsx:217`) vence
  todas as vezes e redesenha o deck inteiro.

O banco protege contra a adoção dupla (`@@unique([sourceAgentRunId,
sourceOptionIndex])`, `schema.prisma:333`), então o dano é de confiança, não de
integridade: a tela oferece algo que o servidor vai recusar.

### 1.2 Adotar um plano não gera os testes

Adotar cria a estratégia e as hipóteses (`create-from-proposal` já anexa 2-3 por
opção). Os experimentos continuam sendo criados **um a um, à mão**, cada um
exigindo que o fundador abra o formulário, clique em preencher com IA, revise e
salve. Um plano de 3 opções × 3 hipóteses = 9 formulários.

---

## 2. Restrição de domínio que molda o desenho

"Gerar o teste inteiro automaticamente" é impossível hoje **por decisão de
domínio**, não por falta de código. O agente `propose-experiment` se recusa a
preencher quatro campos. Citação literal de `src/ai/agents/fill/propose-experiment.ts:13-23`:

> Sem `baselineValue`, `targetValue`, `startDate` nem `endDate`: o número de
> onde se parte, a barra a superar e quando o teste roda são do fundador. Um
> baseline inventado envenena toda leitura posterior do resultado — e
> `verifyEvidence`, no interpret-outcome, existe para impedir exatamente esse
> tipo de número sem origem.

E do próprio prompt do agente (`propose-experiment.ts:62`):

> Ask for the baseline, the target and the dates. A number you made up would be
> read later as a measurement.

Consequência aceita neste spec: **o auto-plano gera experimentos `DRAFT`
incompletos de propósito.** Os quatro números continuam sendo do fundador até
existir medição real (módulo B: GA4/Ads), onde o baseline passa a ser *lido* em
vez de chutado.

Isto está alinhado com `docs/domains/experiments.md` §17, que define DRAFT como
podendo estar sem Baseline, Target e Success Criteria, e §18, que define PLANNED
como "a complete design" contendo `Hypothesis, Variables, Audience, Channel,
Metric, Baseline, Target, Duration, Success Criteria`.

---

## 3. Parte 1 — `proposal-usage`

### 3.1 Backend

Novo slice vertical `src/http/api/strategies/proposal-usage/`:

```
GET /strategies/proposal-usage?agentRunId=<uuid>
→ 200 { usedOptionIndexes: number[] }
```

- Arquivos: `proposal-usage.controller.ts`, `proposal-usage.service.ts`,
  `proposal-usage.schema.ts`, `proposal-usage.service.test.ts`.
- O serviço apenas delega a `strategiesRepository.usedOptionIndexes(workspaceId,
  agentRunId)`. Zero lógica nova, zero migração.
- Escopo de tenant como nas demais rotas: `workspaceId` vem do
  `TenantContext`, nunca da query. Leitura → sem `assertWriter`.
- Run inexistente ou de outro workspace: `200` com `{ usedOptionIndexes: [] }`.
  A rota responde "quais opções deste run já foram gastas *neste workspace*";
  nenhuma foi. Não é 404 — o recurso é o uso, não o run.
- Índice existente cobre a consulta: `Strategy` já indexa `workspaceId`, e a
  unique `(sourceAgentRunId, sourceOptionIndex)` cobre o filtro por run.

### 3.2 Frontend

- Hook Kubb gerado a partir do OpenAPI (`pnpm generate:api` no web).
- `ProposeStrategies.tsx` busca o uso quando `activeId !== null` e a proposta é
  válida.
- `StrategyDeck` recebe `usedOptionIndexes: number[]`:
  - opção gasta é **removida** do deck (não riscada: o fundador já decidiu);
  - a numeração exibida se mantém estável — o índice original é o que o
    `onAdopt` envia, então a remoção não pode reindexar nada;
  - `at` (card aberto) e `picked` (seleção) devem descartar índices gastos, ou
    o editor de plano abriria sobre uma opção que não existe mais na tela.
- Todas as opções gastas → `ProposeStrategies` **não** entra no branch da
  proposta; cai no botão "propor de novo", com o custo em créditos visível.
- `onSuccess` do adopt invalida a query nova junto de `STRATEGIES` e
  `HYPOTHESES` (`ProposeStrategies.tsx:61-64`). Sem isso, voltar da página da
  estratégia mostraria a opção gasta outra vez.
- Enquanto o uso estiver carregando, o deck **não** renderiza opções: mostrar
  todas e depois removê-las é oferecer e retirar. Usa `SectionLoading`.
- Falha ao carregar o uso: `SectionLoadError` com retry. Renderizar o deck
  completo seria voltar ao bug; o servidor recusaria a adoção duplicada.

---

## 4. Parte 2 — Auto-plano

### 4.1 Fluxo

```
Estratégia adotada (DRAFT, com N hipóteses)
        ↓
[Gerar os N testes deste plano]   ← custo total + saldo na tela
        ↓
N runs propose-experiment (1 por hipótese, em paralelo)
        ↓
Cada run COMPLETED → Experiment DRAFT criado
        ↓
"Faltam 4 números seus" por experimento
```

### 4.2 Disparo em lote

Novo slice `src/http/api/strategies/plan-experiments/`:

```
POST /strategies/:id/plan-experiments
→ 202 { runs: [{ hypothesisId, agentRunId }] }
```

- Seleciona as hipóteses da estratégia **que ainda não têm experimento**
  (`Experiment.hypothesisId`). Reexecutar não duplica.
- Para cada uma, chama o `createAgentRunService` existente com
  `taskType: 'propose-experiment'`, `input: { hypothesisId }`.
- Não precisa de fila nova nem de `concurrencyKey` customizada: a chave padrão
  é `${taskType}:${inputHash}` (`create-agent-run.service.ts:77`), e
  `hypothesisId` diferente ⇒ chave diferente ⇒ os N runs correm em paralelo sem
  se bloquear. O clique duplo continua deduplicado pelo mesmo mecanismo.
- Tolerante a falha parcial: um `AgentRunInProgressError` ou uma recusa de
  crédito em uma hipótese não derruba as outras. A resposta traz o resultado por
  hipótese; o que falhou aparece com o motivo, e é retryável individualmente.
- `assertWriter`. Estratégia de outro workspace → 404.

### 4.3 Custo visível antes

`propose-experiment` custa **2 créditos** (`src/billing/operation-cost.ts:25`).
Um plano de 9 hipóteses = 18 créditos.

- O botão mostra `N testes · custo total · saldo` antes do clique, no padrão do
  `ProposeStrategies` (`cost`/`balance`/`short`, `ProposeStrategies.tsx:119-126`).
- Saldo insuficiente para o lote inteiro: oferece gerar só as hipóteses
  selecionadas, com o custo recalculado. **Nunca** dispara N runs sem o total
  na tela.
- A autorização real continua no worker; o número na tela é orientação, igual
  ao resto do produto.

### 4.4 Materialização do experimento

Novo slice `src/http/api/experiments/from-proposal/`:

```
POST /experiments/from-proposal  { agentRunId }
→ 201 { experiment }
```

Mesmo padrão dos materializadores que já existem: `strategies/create-from-proposal`,
`learnings/from-run`, `business/context-from-research`.

- Lê o run (`propose-experiment`, `COMPLETED`, do workspace), valida o output
  com o schema do agente, e cria o `Experiment`:
  - de `filled`: `name`, `metric`, `description`, `objective`, `channel`,
    `audience`, `successCriteria`;
  - `strategyId` e `hypothesisId` resolvidos pela hipótese do input do run;
  - `status: DRAFT`;
  - `baselineValue`, `targetValue`, `startDate`, `endDate`: **nulos**.
- `name` e `metric` são `NOT NULL` no banco (`schema.prisma:400,406`) mas
  `optional` no schema do agente (`propose-experiment.ts:26-27`). Se qualquer um
  dos dois faltar, **não materializa**: responde 422 e a UI manda o fundador ao
  formulário com o resto pré-preenchido. Inventar um nome ou uma métrica seria
  fabricar a própria definição do teste.
- Run não-`COMPLETED`, de outro task type, ou de outro workspace: 404/422, nunca
  criação parcial.

**Migração (aditiva).** `Experiment` não tem coluna de proveniência. Adicionar:

```prisma
sourceAgentRunId String? @unique
```

Serve a dois propósitos: idempotência (chamar `from-proposal` duas vezes com o
mesmo run devolve o mesmo experimento em vez de criar dois) e auditabilidade
(princípio 7 do `CLAUDE.md`). Violação de unique → devolve o experimento
existente, no mesmo padrão de tratamento de unique de
`create-from-proposal.service.ts:30-39`.

### 4.5 Quem chama `from-proposal`

O frontend, ao ver o run ficar `COMPLETED` — não o worker.

Não existe hook pós-run no runner hoje (`ai/queue/worker.ts` só reconcilia runs
mortos), e criar esse conceito é mudança arquitetural maior que este escopo.
Materializar pelo cliente é o padrão vigente em todos os materializadores
citados em 4.4.

O navegador fechar **não perde nada**: os runs terminam no worker e o output
fica persistido. Ao reabrir a estratégia, a tela lista os runs
`propose-experiment` das hipóteses sem experimento e oferece "3 propostas
prontas — criar", materializando então. A unique de `sourceAgentRunId` torna
essa recuperação segura contra corrida entre duas abas.

Registrado como trabalho futuro: um passo pós-run declarado pelo agente
tornaria a materialização server-side e dispensaria essa recuperação.

### 4.6 Trava do PLANNED

Hoje `DRAFT → PLANNED` só verifica a transição
(`experiments.domain.ts:5`, `experiments.transition.ts`); nenhum campo é exigido.
Isso contradiz `docs/domains/experiments.md` §18, que exige design completo.

Com o auto-plano criando `DRAFT` incompletos em lote, essa ausência passa a
importar: sem a trava, nove rascunhos sem baseline podem ir a PLANNED e depois a
RUNNING, e o Outcome de cada um seria comparado contra `null`.

Nova regra em `experiments.domain.ts`: `DRAFT → PLANNED` exige
`metric`, `baselineValue`, `targetValue`, `startDate`, `endDate`,
`successCriteria`, `audience` e `channel` presentes. Faltando algum, erro de
domínio 422 nomeando os campos ausentes. A UI usa a mesma lista para o marcador
"faltam N números seus".

Isto implementa comportamento já documentado; não é mudança de produto.

### 4.7 Frontend da parte 2

- `StrategyDetailPage`: botão de auto-plano com custo/saldo, progresso **por
  hipótese** (não uma barra única), e materialização por run concluído.
- Cada experimento criado aparece na lista com o marcador de campos pendentes e
  atalho para completar.
- i18n pt/en/es.

---

## 5. Fora de escopo

- Publicação em canal (Postiz, Meta Ads, Google Ads) — módulo de Execução.
- Outcome automático (GA4, Ads, CRM, atribuição) — módulo de Medição.
- Otimização autônoma / Autopilot.
- Preenchimento de baseline/target/datas por IA — proibido por §2.
- Passo pós-run no runner — citado em 4.5 como futuro.
- Piloto de validação comercial (a/b/c) — depende deste escopo, spec própria.

---

## 6. Testes

Backend:

- `proposal-usage`: plano combinado gasta todas as opções que entraram nele; run
  sem adoção devolve `[]`; run de outro workspace devolve `[]`.
- `plan-experiments`: pula hipótese que já tem experimento; N hipóteses ⇒ N
  runs; falha em uma não impede as outras; estratégia de outro workspace 404;
  leitor recusado.
- `from-proposal`: cria com os 7 campos e os 4 nulos; run repetido devolve o
  mesmo experimento; `name`/`metric` ausente ⇒ 422 sem escrita; run não
  concluído ⇒ 422; run de outro workspace ⇒ 404.
- `experiments.domain`: `DRAFT → PLANNED` recusado por cada campo ausente;
  aceito com todos presentes.

Frontend:

- `StrategyDeck`: esconde opção gasta; mantém índice original no `onAdopt`;
  descarta seleção gasta.
- `ProposeStrategies`: todas gastas ⇒ mostra "propor de novo"; uso carregando ⇒
  `SectionLoading`; uso com erro ⇒ `SectionLoadError`.
- `StrategyDetailPage`: custo total exibido antes do disparo; saldo curto ⇒
  disparo bloqueado; run concluído ⇒ experimento materializado; marcador de
  campos pendentes.

---

## 7. Ordem de implementação

1. Parte 1 (bug) — backend, frontend, testes. Entregável independente.
2. Migração `Experiment.sourceAgentRunId` + trava do PLANNED.
3. `from-proposal` (materialização de um).
4. `plan-experiments` (lote) + UI com custo.

Cada passo é mergeável isolado; nenhum depende do seguinte.
