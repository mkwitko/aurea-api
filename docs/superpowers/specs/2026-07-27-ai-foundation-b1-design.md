# Sub-projeto B1 — Núcleo de execução da camada de IA

Data: 2026-07-27
Status: aprovado no design, pendente de plano de implementação
Repo afetado: `aurea/back` (o `aurea/web` só regenera o cliente do OpenAPI)

---

## 1. Contexto

O pedido original ("melhorar UX dos forms, adicionar IA para preencher") foi decomposto
em quatro sub-projetos no brainstorm de 2026-07-27, registrados em
`web/docs/superpowers/specs/2026-07-27-forms-ux-cleancode-design.md` §9:

- **A** — UX e clean code dos 12 forms. Concluído.
- **B** — Fundação da camada de IA. Este documento cobre metade dele.
- **C** — Preenchimento por IA do contexto de negócio.
- **D** — Propostas de IA para ICP / Goal / Strategy.

O B foi partido em dois porque são sete subsistemas:

- **B1 (este spec)** — núcleo de execução: abstração de provider, Model Router,
  `AgentRun` gravado, guardrails, fila BullMQ, loop de ferramentas.
- **B2 (spec futuro)** — controle comercial: BYOK com chave cifrada e ledger de
  créditos com bloqueio.

O C depende só do B1. O B1 já nasce com os dois pontos de extensão que o B2 preenche
(§4.5), para o B2 não virar retrofit no caminho de execução.

`back/docs/architecture/ai-architecture.md` descreve esta camada. Hoje ela não existe:
o `AgentRun` está no schema Prisma e nunca é escrito, o Redis está nos três composes e
nunca foi usado, e não há dependência de SDK de IA no `package.json`.

---

## 2. O que o B1 é e o que não é

**É** a máquina que executa uma tarefa de raciocínio contra um modelo, com registro,
custo e guardrail. **Não é** agente de negócio, não escreve entidade de domínio, não
decide verdade. O único agente que entra é o canary de §7.

Não-objetivos explícitos: BYOK, créditos, SSE, endpoint de listagem de runs, fallback
entre providers, scoring de qualidade, UI de AgentRun, orquestração multi-agente.

---

## 3. Decisões herdadas (não re-litigar)

Do apêndice §10 do spec do A:

- Execução assíncrona com **BullMQ e worker in-process** no container da API. O Redis
  já está nos três composes com volume nomeado.
- `AgentRun` no Postgres é o que a UI lê; Redis é só mecânica.
- Chave de IA híbrida (plataforma por default, BYOK opcional) — a metade BYOK é B2.
- Crédito por operação (1 seção = 1 crédito, run global = 9, franquia mensal, BYOK não
  consome) — B2.

Decididas neste brainstorm:

- **Provider: DeepSeek** ("V4 Pro"), pela relação qualidade/preço. A API é
  OpenAI-compatible (`base_url: https://api.deepseek.com`), então a implementação real
  é um provider "OpenAI-compatible" genérico, não um adaptador deepseek-específico.
- **Acompanhamento por polling** de `GET /agent-runs/:id`. Sem SSE.
- **Política do router em código**, com override de ids de modelo por env.
- **Auditoria completa**: `input` e `output` inteiros gravados em Json.
- **Guardrail**: 1 repair → 1 escalada de tier → FAILED, teto duro de 3 chamadas de
  modelo por run.
- **Loop de ferramentas próprio** no B1, provider-agnóstico. O DeepSeek não tem tools
  server-side.
- **Canary**: `summarize-business-context`, usando uma tool interna.

---

## 4. Arquitetura

### 4.1 Fluxo

```text
POST /agent-runs            src/http/api/agent-runs/create-agent-run/
  valida input contra o inputSchema do agente, cria AgentRun PENDING,
  enfileira, responde 202 { id, status }
        ↓
BullMQ (Redis)              src/ai/queue/
  worker in-process no container da API; o job carrega só o agentRunId
        ↓
Runner                      src/ai/runner/
  monta prompt → loop de tools → valida com Zod → repair → escalada
  → grava AgentRun / AgentToolCall
        ↓
Model Router                src/ai/model-router/
  taskType → tier → { provider, modelId, preços, capabilities }
        ↓
Provider                    src/ai/providers/
  OpenAI-compatible (DeepSeek) em produção, FakeProvider nos testes
```

### 4.2 Layout

O skill `aurea-backend` (PROJECT.md §4) prescreve `src/ai/{model-router,providers,agent-run}`
e módulos em `src/modules/`. O repo real usa `src/http/api/<módulo>/<caso-de-uso>/`. Este
spec segue o repo para o HTTP e o skill para a camada de IA.

```text
src/ai/
├── providers/
│   ├── provider.ts             # interface + tipos normalizados
│   ├── openai-compatible.ts    # impl real (DeepSeek e qualquer endpoint compatível)
│   └── fake.ts                 # impl determinística para teste
├── model-router/
│   ├── catalog.ts              # modelos: provider, id, preço in/cached/out, capabilities
│   └── router.ts               # taskType → tier → modelo; próximo tier na escalada
├── runner/
│   ├── runner.ts               # orquestra um run; único lugar com o loop
│   ├── guardrail.ts            # JSON.parse → Zod → erro formatado para repair
│   └── cost.ts                 # usage → estimatedCost, cache-aware
├── agents/
│   ├── registry.ts             # taskType → AgentDefinition
│   └── summarize-business-context.ts
├── tools/
│   ├── tool.ts                 # interface de tool
│   └── get-business-context.ts # única tool do B1; leitura pura, tenant-scoped
└── queue/
    ├── queue.ts                # conexão Redis + Queue
    └── worker.ts               # worker in-process, ligado no ciclo do app

src/http/api/agent-runs/
├── agent-runs.schema.ts
├── agent-runs.presenter.ts
├── create-agent-run/{controller,service}.ts
├── get-agent-run/{controller}.ts
└── index.ts
```

### 4.3 Contrato de provider

Escrito **antes** da implementação DeepSeek, para o formato OpenAI não vazar para o
resto da camada.

```ts
type AiUsage = { inputTokens: number; outputTokens: number; cachedInputTokens: number };
type AiToolCall = { id: string; name: string; args: unknown };

type AiMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: AiToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

type AiToolSpec = { name: string; description: string; parameters: unknown };

type AiCompletionRequest = {
  modelId: string;
  messages: AiMessage[];
  tools?: AiToolSpec[];
  jsonMode: boolean;      // response_format: { type: 'json_object' }
  maxTokens: number;
  signal: AbortSignal;
};

type AiCompletion = {
  text: string | null;
  toolCalls: AiToolCall[];
  usage: AiUsage;
  finishReason: 'stop' | 'tool_calls' | 'length' | 'other';
};

interface AiProvider {
  readonly name: string;
  complete(req: AiCompletionRequest): Promise<AiCompletion>;
}
```

`cachedInputTokens` existe na interface porque o DeepSeek devolve
`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`, e é o que separa custo estimado
de custo real.

O DeepSeek aceita `response_format: { type: 'json_object' }` junto com `tools` na mesma
chamada (confirmado pelo dono do projeto), então `jsonMode` fica ligado desde a primeira
chamada do loop.

### 4.4 Contrato de agente e de tool

O agente é dado. Quem executa é o runner — por isso é impossível um agente esquecer de
validar a saída.

```ts
type AgentDefinition<I, O> = {
  taskType: string;          // 'summarize-business-context'
  agentType: string;         // 'context-analyst'
  tier: Tier;                // ponto de entrada no router
  inputSchema: ZodType<I>;   // valida o que entra na fila
  outputSchema: ZodType<O>;  // o guardrail
  buildTools(input: I): readonly Tool[];   // [] é válido
  buildMessages(input: I, ctx: AgentContext): AiMessage[];
};

type Tool<A = unknown> = {
  name: string;
  description: string;
  argsSchema: ZodType<A>;
  execute(args: A, ctx: { tenant: TenantContext; prisma: PrismaClient }): Promise<unknown>;
};
```

`buildTools` recebe o input porque as tools são ligadas ao run: o
`get_business_context` fecha sobre o `businessId` já validado, em vez de aceitá-lo como
argumento do modelo (§7).

O `parameters` que a API recebe é derivado do `argsSchema` com `zod-to-json-schema`
(dependência nova; o back é zod 3). Declarar o schema duas vezes é o mesmo tipo de
divergência silenciosa que a Task 11 do sub-projeto A produziu.

### 4.5 Pontos de extensão do B2

Duas interfaces com uma implementação trivial cada no B1:

- `authorizeRun(tenant, taskType): Promise<{ allowed: boolean; reason?: string }>` —
  B1 sempre libera. B2 substitui pelo ledger de créditos. Chamada no runner, antes de
  qualquer chamada de modelo.
- `resolveProviderCredentials(tenant, provider): Promise<{ apiKey: string; source: 'PLATFORM' | 'BYOK' }>` —
  B1 devolve a chave da plataforma vinda do env. B2 decifra a chave do workspace.

---

## 5. Modelo de dados

Uma migration.

`AgentRun` ganha:

| Campo | Tipo | Razão |
|---|---|---|
| `input` | `Json?` | reproduzir e explicar o run (`ai-architecture` §6, `CLAUDE.md` §7) |
| `output` | `Json?` | resultado validado devolvido no GET |
| `tier` | `String?` | qual tier resolveu, para calibrar routing |
| `modelCalls` | `Int @default(0)` | teto de custo que sobrevive a retentativa de job |
| `cachedInputTokens` | `Int?` | custo cache-aware |
| `inputHash` | `String?` | detectar run ativo idêntico |
| `requestedBy` | `String?` | usuário que disparou |
| `queuedAt` | `DateTime?` | tempo de fila separado de tempo de execução |

Mais `@@index([status, createdAt])`, usado pela purga.

`AgentToolCall` novo: `id`, `agentRunId` (cascade), `name`, `args Json`, `result Json?`,
`ok Boolean`, `error String?`, `durationMs Int`, `startedAt DateTime`,
`@@index([agentRunId])`.

Duas consequências explícitas:

- **Retenção.** `input`/`output` completos são dado de cliente fora do Growth Brain.
  Vai junto `src/scripts/purge-agent-runs.ts`, que apaga runs terminados com mais de 90
  dias, rodado à mão por enquanto. Sem isso, "gravar tudo" vira passivo de LGPD em vez
  de auditoria.
- **Duplo disparo.** O serviço procura run ativo com o mesmo `(workspaceId, taskType,
  inputHash)` e devolve o existente em vez de enfileirar outro. Não é lock: há janela de
  corrida de milissegundos, aceita porque a alternativa é unique parcial, que o Prisma
  não expressa bem.

---

## 6. Execução

### 6.1 HTTP

- `POST /agent-runs` — body `{ taskType, input }`. O controller resolve a
  `AgentDefinition` no registry e valida `input` contra o `inputSchema` **na hora**:
  taskType desconhecido ou input inválido responde 400, em vez de virar job que falha no
  worker. Cria `AgentRun` PENDING, enfileira, devolve `202 { id, status }`.
- `GET /agent-runs/:id` — estado, mais `output` quando COMPLETED e `error` quando
  FAILED. Tenant-scoped: run de outro workspace é 404, nunca 403.
- Papéis: OWNER / ADMIN / MEMBER disparam; VIEWER só lê.

### 6.2 Fila e worker

Fila `agent-runs`. O job carrega **só o `agentRunId`** — o payload fica no Postgres, e
dado de cliente não é duplicado no Redis. Worker in-process ligado no ciclo do app, atrás
de `AI_WORKER_ENABLED` (off nos testes), concorrência por env com default 2. Shutdown
fecha o worker antes do app.

Redis ganha `--appendonly yes` e `maxmemory-policy noeviction` nos três composes, e
`REDIS_URL` entra no `env.ts`.

Retry de job e retry de modelo são coisas diferentes, e confundi-las custa dinheiro:
`attempts: 2` cobre queda de Redis/DB, mas o teto de 3 chamadas de modelo é persistido em
`modelCalls`. Uma retentativa de job continua no orçamento restante, nunca reinicia em 3.
Job que pega run já COMPLETED sai sem fazer nada.

### 6.3 Runner

```text
1. carrega AgentRun + AgentDefinition; status RUNNING, startedAt
2. authorizeRun(tenant, taskType)
3. router: tier → { provider, modelId, preços }
4. loop, no máximo 5 iterações de tool:
     provider.complete(...)  ── acumula usage, modelCalls++
     ├─ tool_calls → valida args com argsSchema
     │    ok       → executa, grava AgentToolCall ok=true
     │    inválido → grava AgentToolCall ok=false e devolve o erro AO MODELO
     │               como resultado da tool; o run não morre por isso
     └─ resposta final → sai do loop
5. guardrail: JSON.parse → outputSchema.safeParse
     falha 1 → repair: reenvia o JSON inválido + erros do Zod, mesmo tier
     falha 2 → escalada: próximo tier do router
     falha 3 → FAILED, último erro gravado
6. custo: soma o usage de TODAS as chamadas, inclusive as que falharam;
   preços separados para input, input cacheado e output
7. COMPLETED, output gravado, completedAt
```

Timeouts: 60s por chamada de modelo via `AbortSignal`, 180s por run; estouro vira FAILED
com motivo. Ambos por env.

### 6.4 Router

`catalog.ts` lista modelos com provider, id, preço de input, de input cacheado e de
output, e capabilities (`tools`, `jsonMode`, `serverSideWebSearch`). `router.ts` mapeia
taskType → tier e resolve tier → modelo. Escalada é o próximo tier do mesmo mapa. Env
sobrescreve **ids de modelo**, para apontar outra versão sem deploy de código; preço muda
por deploy, o que é aceitável na frequência em que muda.

O campo `serverSideWebSearch` nasce `false` para todo modelo DeepSeek. Existe porque o C
precisa decidir grounding (§10).

---

## 7. Canary

`summarize-business-context`, o único agente do B1.

- Input: `{ businessId }`, validado contra o workspace do tenant na criação do run.
- O agente **não** recebe o contexto montado no prompt: precisa chamar a tool interna
  `get_business_context` para obtê-lo. Isso exercita o loop de tools contra o modelo
  real, que é a parte mais delicada do núcleo.
- Output: `{ summary: string, risks: string[3], confidence: 'LOW'|'MEDIUM'|'HIGH' }`,
  validado pelo `outputSchema`.
- Nada é escrito em entidade de domínio. O resultado vive no `AgentRun`.

A tool `get_business_context` **não recebe `businessId` do modelo** — o business vem do
input do run. Se o id viesse nos args, um prompt injetado no conteúdo do contexto poderia
pedir o contexto de outro business. Assim esse grau de liberdade não existe.

---

## 8. Segurança

- **Injeção de prompt.** Conteúdo do Growth Brain e resultado de tool são dados, não
  instruções: entram delimitados e o system prompt declara isso
  (`security-architecture.md` §6).
- **Sem autoridade ambiente.** A tool executa com o `TenantContext` do run. Nenhuma tool
  do B1 escreve, gasta ou publica — só leitura.
- **Segredos.** Chave da plataforma só via env, nunca em log, nunca dentro de
  `input`/`output` do AgentRun. Erro de provider é sanitizado antes de ser gravado.
- **Sub-processador.** O DeepSeek passa a receber dado de cliente.
  `security-architecture.md` §8 exige termos de não-treinamento e disclosure de
  sub-processador. **Item aberto, decisão do dono do produto, não de código.** A
  mitigação técnica disponível é a retenção de 90 dias e não enviar PII que a tarefa não
  precisa.

---

## 9. Custo, observabilidade e testes

`estimatedCost` sai do catálogo com três preços por modelo. Usar preço cheio no token
cacheado infla a margem aparente, e `business-model.md` §6 trata margem como restrição de
produto.

Uma linha de log estruturada por run terminado: `taskType`, `workspaceId`, modelo,
tokens, `modelCalls`, custo, duração, status. Sem conteúdo.

`FakeProvider` roteirizado cobre o que o modelo real não cobre de forma determinística:

| Cenário | Prova |
|---|---|
| sequência com tool call | o loop |
| JSON inválido → válido | o repair |
| inválido sempre | escalada e FAILED com teto de 3 |
| `usage` fixo, com cache hit | a conta de custo |
| args de tool inválidos | o run sobrevive e o modelo recebe o erro |

Mais: isolamento de tenant (run de outro workspace = 404), input inválido = 400 antes da
fila, job que pega run COMPLETED não faz nada.

Um smoke manual documentado roda o canary contra o DeepSeek real. Não entra em CI: CI não
tem chave e não deve gastar dinheiro.

Gates por task: `pnpm typecheck` e `pnpm test`. No fim, `pnpm openapi:dump`; o `web`
precisa de `api:generate` para os dois endpoints novos — mudança cross-repo, a mesma
coordenação que a Task 10 do A exigiu.

---

## 10. Riscos e itens abertos

| Risco | Mitigação |
|---|---|
| Id do modelo "V4 Pro" não confirmado na doc indexada | id vem de env; conferir em `GET /models` na primeira task |
| `content` vazio em JSON mode (caso registrado na doc) | cai no caminho de repair, que já existe |
| Worker in-process disputa CPU com a API | concorrência 2 por default, ajustável por env |
| Registry + runner tem um consumidor só até o C | o C tem nove agentes da mesma forma, já desenhados |
| Termos de dado do DeepSeek | item aberto (§8), decidir antes de dado real de cliente |

**Consequência para o C.** A decisão travada do C era grounding com
`web_search_20260209` / `web_fetch_20260209` server-side da Anthropic, que vêm com
citações. Com DeepSeek isso não existe. O C vai precisar de uma tool de busca própria
(Tavily, Brave, Serper) plugada na camada de tools do B1, ou rotear as tarefas que exigem
citação para um provider que tenha. O B1 deixa o gancho pronto (`serverSideWebSearch` no
catálogo e a camada de tools); a escolha é do spec do C.

---

## 11. Configuração nova

`env.ts` ganha: `REDIS_URL`, `AI_PROVIDER_BASE_URL`, `AI_PROVIDER_API_KEY`,
`AI_MODEL_TIER1` / `AI_MODEL_TIER2` / `AI_MODEL_TIER3` (override de ids),
`AI_WORKER_ENABLED`, `AI_WORKER_CONCURRENCY`, `AI_CALL_TIMEOUT_MS`, `AI_RUN_TIMEOUT_MS`.

Dependências novas: `bullmq`, `ioredis` (peer do bullmq), `openai`, `zod-to-json-schema`.
