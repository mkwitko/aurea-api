# Auto-plano e proposal-usage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Esconder do deck as opções de proposta já adotadas, e fazer a adoção de um plano gerar automaticamente os experimentos `DRAFT` das suas hipóteses.

**Architecture:** Backend em slices verticais por caso de uso (`src/http/api/<domínio>/<caso-de-uso>/`), cada um com controller + service + schema + test, serviço recebendo dependências por injeção. Frontend consome só hooks Kubb gerados do OpenAPI. Nenhum passo pós-run no worker: a materialização do experimento é uma rota explícita chamada pelo cliente, no mesmo padrão de `strategies/create-from-proposal`, `learnings/from-run` e `business/context-from-research`.

**Tech Stack:** Fastify + `fastify-type-provider-zod`, Prisma/PostgreSQL, BullMQ, Vitest (back e web), React 19 + Vite + Tailwind + shadcn/ui, Kubb + React Query, i18next.

**Spec:** `docs/superpowers/specs/2026-08-03-auto-plano-e-proposal-usage-design.md`

## Global Constraints

- Nenhum valor de `baselineValue`, `targetValue`, `startDate` ou `endDate` pode ser gerado por IA ou inventado por código. Citação literal do spec §2, de `src/ai/agents/fill/propose-experiment.ts:13-23`: "Sem `baselineValue`, `targetValue`, `startDate` nem `endDate`: o número de onde se parte, a barra a superar e quando o teste roda são do fundador. Um baseline inventado envenena toda leitura posterior do resultado — e `verifyEvidence`, no interpret-outcome, existe para impedir exatamente esse tipo de número sem origem."
- `workspaceId` vem sempre de `req.tenant.workspaceId`, nunca de body/query/params.
- Todo slice de escrita chama `assertWriter` ou herda `app.denyReadOnly` (já registrado nos `index.ts` de `strategies` e `experiments`).
- Web: **Tailwind + shadcn/ui apenas**. Nenhum CSS puro, nenhum `style={{}}`.
- Web: nenhuma chamada `fetch` crua — só hooks gerados em `src/api/generated/hooks/`.
- Web: todo termo de domínio novo exibido ganha `Help`.
- TypeScript estrito nos dois repos. Nenhum `any`.
- `propose-experiment` custa **2 créditos** (`src/billing/operation-cost.ts:25`). Nenhum disparo em lote sem o custo total na tela.
- Textos de UI em i18n `pt`, `en`, `es` — nunca literais no JSX.
- Comentários de código em português, explicando *por que*, no estilo dos arquivos vizinhos.
- Backend segue a skill `aurea-backend` (`back/.claude/skills/aurea-backend/SKILL.md`): slice vertical por caso de uso, controller fino (`FastifyPluginAsync` + `app.withTypeProvider<ZodTypeProvider>()`), service como factory `createXService(deps)` devolvendo `async (input) => ...` (sem classe, sem `.execute`), repositório `createXRepository(prisma)` com `workspaceId` como primeiro argumento, **`operationId` e `response` obrigatórios** em toda rota, erros só como subclasses de `AppError` de `src/lib/errors.ts`.
- Zod **3** (`import { z } from 'zod'`) + `fastify-type-provider-zod` 4. Não usar API de Zod 4.
- Todo slice com escopo de tenant ganha um teste de negação cross-tenant.
- **Commit exige aprovação explícita** (regra da skill `aurea-backend` §6). Os passos de commit deste plano significam: `git add` dos caminhos listados, mostrar `git status` + resumo do diff, e **esperar** o ok antes de `git commit`.

**Caminhos:** `back/` = `/home/mauricio.oliveira/Documentos/Coding/futuro/aurea/back`, `web/` = `.../aurea/web`. Comandos rodam na raiz do repo correspondente.

---

## File Structure

**Backend (`back/`)**

| Arquivo | Responsabilidade |
|---|---|
| `src/http/api/strategies/proposal-usage/proposal-usage.schema.ts` | Query e resposta de `GET /strategies/proposal-usage` |
| `src/http/api/strategies/proposal-usage/proposal-usage.service.ts` | Delega a `usedOptionIndexes` |
| `src/http/api/strategies/proposal-usage/proposal-usage.controller.ts` | Rota |
| `src/http/api/strategies/proposal-usage/proposal-usage.test.ts` | Teste de rota |
| `src/http/api/strategies/plan-experiments/*` | Disparo em lote de `propose-experiment` |
| `src/http/api/experiments/from-proposal/*` | Materializa um `Experiment` DRAFT do output de um run |
| `src/http/api/experiments/experiments.domain.ts` | + `PLAN_REQUIRED_FIELDS`, `assertReadyToPlan` |
| `src/http/api/experiments/experiments.transition.ts` | + `guard` opcional |
| `src/http/api/experiments/experiments.repository.ts` | + `findBySourceRun`, `sourceAgentRunId` em `ExperimentData` |
| `src/http/api/strategies/strategies.repository.ts` | + `findPlannableHypotheses`, `findStrategyById` |
| `prisma/schema.prisma` + `prisma/migrations/20260803190000_experiment_source_run/` | Coluna de proveniência |

**Frontend (`web/`)**

| Arquivo | Responsabilidade |
|---|---|
| `src/components/strategies/StrategyDeck.tsx` | Recebe `usedOptionIndexes` e não mostra opção gasta |
| `src/components/strategies/ProposeStrategies.tsx` | Busca o uso, decide entre deck e "propor de novo" |
| `src/lib/experiment-plan-gate.ts` | Espelha `PLAN_REQUIRED_FIELDS` para o marcador "faltam N" |
| `src/components/strategies/PlanExperimentsPanel.tsx` | Botão de auto-plano, custo, saldo, lista de runs |
| `src/components/strategies/PlanExperimentRun.tsx` | Um run: polling próprio + materialização |
| `src/pages/StrategyDetailPage.tsx` | Integra o painel |
| `src/locales/{pt,en,es}.json` | Textos |

---

### Task 1: `GET /strategies/proposal-usage`

**Files:**
- Create: `back/src/http/api/strategies/proposal-usage/proposal-usage.schema.ts`
- Create: `back/src/http/api/strategies/proposal-usage/proposal-usage.service.ts`
- Create: `back/src/http/api/strategies/proposal-usage/proposal-usage.controller.ts`
- Test: `back/src/http/api/strategies/proposal-usage/proposal-usage.test.ts`
- Modify: `back/src/http/api/strategies/index.ts`

**Interfaces:**
- Consumes: `createStrategiesRepository(prisma).usedOptionIndexes(workspaceId: string, agentRunId: string): Promise<number[]>` — já existe em `strategies.repository.ts:64`.
- Produces: rota `GET /strategies/proposal-usage?agentRunId=<uuid>` → `200 { usedOptionIndexes: number[] }`, `operationId: 'getProposalUsage'`. A Task 2 consome via hook gerado `useGetProposalUsage`.

- [ ] **Step 1: Write the failing test**

Create `back/src/http/api/strategies/proposal-usage/proposal-usage.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { proposalUsageRoute } from './proposal-usage.controller.js';

const RUN_ID = '11111111-1111-1111-1111-111111111111';

// Só o que o serviço usa do repositório: um `findMany` de estratégias com as
// duas colunas de proveniência.
const buildApp = async (rows: { sourceOptionIndex: number | null; sourceOptionIndexes: number[] }[]) => {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('prisma', { strategy: { findMany: vi.fn().mockResolvedValue(rows) } } as never);
  app.addHook('preHandler', async (req) => {
    (req as { tenant?: unknown }).tenant = { workspaceId: 'ws-1', userId: 'u-1', organizationId: 'org-1', role: 'OWNER' };
  });
  await app.register(proposalUsageRoute);
  return app;
};

describe('GET /strategies/proposal-usage', () => {
  it('devolve as opções que já sustentam uma estratégia', async () => {
    const app = await buildApp([{ sourceOptionIndex: 0, sourceOptionIndexes: [0, 2] }]);

    const res = await app.inject({ method: 'GET', url: `/strategies/proposal-usage?agentRunId=${RUN_ID}` });

    expect(res.statusCode).toBe(200);
    // Um plano combinado gasta todas as opções que entraram nele, não só a
    // primeira: é o que impede adotar a 2 sozinha depois de combinar 0+2.
    expect(res.json().usedOptionIndexes.sort()).toEqual([0, 2]);
  });

  it('devolve lista vazia quando nada foi adotado', async () => {
    const app = await buildApp([]);

    const res = await app.inject({ method: 'GET', url: `/strategies/proposal-usage?agentRunId=${RUN_ID}` });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ usedOptionIndexes: [] });
  });

  it('recusa um agentRunId que não é uuid', async () => {
    const app = await buildApp([]);

    const res = await app.inject({ method: 'GET', url: '/strategies/proposal-usage?agentRunId=nope' });

    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd back && pnpm vitest run src/http/api/strategies/proposal-usage`
Expected: FAIL — `Cannot find module './proposal-usage.controller.js'`

- [ ] **Step 3: Write the schema**

Create `back/src/http/api/strategies/proposal-usage/proposal-usage.schema.ts`:

```ts
import { z } from 'zod';

export const proposalUsageQuery = z.object({ agentRunId: z.string().uuid() });

/**
 * Quais opções desta proposta já viraram estratégia.
 *
 * O deck precisa disto para não oferecer uma opção que o servidor vai recusar:
 * a recuperação da tela adota o run mais novo mesmo depois de COMPLETED, então
 * sem esta resposta o fundador vê para sempre opções que já gastou.
 */
export const proposalUsageResponse = z.object({ usedOptionIndexes: z.array(z.number().int().nonnegative()) });

export type ProposalUsageQuery = z.infer<typeof proposalUsageQuery>;
```

- [ ] **Step 4: Write the service**

Create `back/src/http/api/strategies/proposal-usage/proposal-usage.service.ts`:

```ts
import type { StrategiesRepository } from '../strategies.repository.js';

export type ProposalUsageDeps = { repo: StrategiesRepository };

export function createProposalUsageService(deps: ProposalUsageDeps) {
  return async (input: { agentRunId: string; workspaceId: string }) => {
    // Sem 404: o recurso é o uso das opções neste workspace, não o run. Um run
    // inexistente, de outro workspace, ou existente e nunca adotado dão a mesma
    // resposta honesta — nenhuma opção gasta aqui.
    const usedOptionIndexes = await deps.repo.usedOptionIndexes(input.workspaceId, input.agentRunId);
    return { usedOptionIndexes };
  };
}
```

- [ ] **Step 5: Write the controller**

Create `back/src/http/api/strategies/proposal-usage/proposal-usage.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createStrategiesRepository } from '../strategies.repository.js';
import { proposalUsageQuery, proposalUsageResponse } from './proposal-usage.schema.js';
import { createProposalUsageService } from './proposal-usage.service.js';

export const proposalUsageRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/strategies/proposal-usage',
    {
      schema: {
        tags: ['strategies'],
        operationId: 'getProposalUsage',
        querystring: proposalUsageQuery,
        response: { 200: proposalUsageResponse },
      },
    },
    async (req) => {
      const service = createProposalUsageService({ repo: createStrategiesRepository(app.prisma) });
      return service({ agentRunId: req.query.agentRunId, workspaceId: req.tenant.workspaceId });
    },
  );
};
```

- [ ] **Step 6: Register the route**

Modify `back/src/http/api/strategies/index.ts` — adicionar o import junto dos outros (ordem alfabética) e o register **antes** de `proposeStrategyRoute`, junto de `proposalDraftRoute`:

```ts
import { proposalUsageRoute } from './proposal-usage/proposal-usage.controller.js';
```

```ts
  await app.register(proposalDraftRoute);
  await app.register(proposalUsageRoute);
```

Atenção à ordem de registro: `/strategies/proposal-usage` é uma rota estática e precisa ser registrada antes de qualquer rota `/strategies/:id` para não ser capturada como um id. `getStrategyRoute` já está registrado antes — verifique com o teste do Step 7 que `GET /strategies/proposal-usage?agentRunId=...` não cai no handler de `:id` (o schema de `:id` exige uuid, então a captura apareceria como 400 "params/id must match format uuid").

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd back && pnpm vitest run src/http/api/strategies && pnpm typecheck`
Expected: PASS, sem erro de tipo.

- [ ] **Step 8: Regenerate the OpenAPI dump**

Run: `cd back && pnpm openapi:dump`
Expected: o arquivo de OpenAPI passa a conter `getProposalUsage`.

- [ ] **Step 9: Commit**

```bash
cd back
git add src/http/api/strategies/proposal-usage src/http/api/strategies/index.ts
git commit -m "feat(strategies): expose which proposal options were already adopted"
```

---

### Task 2: Deck esconde opção gasta

**Files:**
- Modify: `web/src/components/strategies/StrategyDeck.tsx`
- Modify: `web/src/components/strategies/ProposeStrategies.tsx:217-257`
- Test: `web/src/components/strategies/StrategyDeck.test.tsx` (criar se não existir)
- Test: `web/src/components/strategies/ProposeStrategies.test.tsx` (criar se não existir)

**Interfaces:**
- Consumes: hook gerado `useGetProposalUsage({ agentRunId })` → `{ data?: { usedOptionIndexes: number[] } }` (Task 1).
- Produces: `StrategyDeckProps` ganha `usedOptionIndexes: number[]`. `onAdopt` continua recebendo **índices originais da proposta**, não posições visíveis.

- [ ] **Step 1: Regenerate the typed client**

Run: `cd web && pnpm api:generate`
Expected: aparece `src/api/generated/hooks/strategiesHooks/useGetProposalUsage.ts`.

- [ ] **Step 2: Write the failing deck test**

Create/modify `web/src/components/strategies/StrategyDeck.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StrategyDeck } from './StrategyDeck';
import type { Proposal } from '@/schemas/strategy-proposal';

vi.mock('@/api/generated/hooks/strategiesHooks/useGetProposalDraft', () => ({
  useGetProposalDraft: () => ({ data: undefined, isError: false, refetch: vi.fn() }),
}));

const option = (name: string) => ({
  name,
  strategicThesis: 'T',
  growthMechanism: 'M',
  expectedOutcome: 'O',
  channels: ['Email'],
  assumptions: ['A'],
  risks: ['R'],
  tradeoffs: 'X',
  hypotheses: [],
});

const proposal = {
  options: [option('Outbound'), option('Conteúdo'), option('Parcerias')],
  recommendedIndex: 0,
  rationale: 'Mais barato para aprender.',
} as unknown as Proposal;

describe('StrategyDeck', () => {
  it('não mostra a opção já adotada', () => {
    render(
      <StrategyDeck runId="r-1" proposal={proposal} saving={false} error={null} usedOptionIndexes={[0]} onAdopt={vi.fn()} />,
    );

    expect(screen.queryByText('Outbound')).not.toBeInTheDocument();
    expect(screen.getByText('Conteúdo')).toBeInTheDocument();
  });

  it('adota com o índice original, não com a posição na tela', async () => {
    const onAdopt = vi.fn();
    render(
      <StrategyDeck runId="r-1" proposal={proposal} saving={false} error={null} usedOptionIndexes={[0]} onAdopt={onAdopt} />,
    );

    // A primeira opção visível é a de índice 1 na proposta.
    await screen.getByLabelText(/incluir/i).click();
    await screen.getByRole('button', { name: /revisar/i }).click();

    // O editor pede o rascunho ao servidor; o que importa aqui é que a seleção
    // guardada é 1, e não 0.
    expect(onAdopt).not.toHaveBeenCalledWith([0], expect.anything());
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd web && pnpm vitest run src/components/strategies/StrategyDeck.test.tsx`
Expected: FAIL — a prop `usedOptionIndexes` não existe e "Outbound" ainda é renderizada.

- [ ] **Step 4: Implement the visible-index mapping in the deck**

Modify `web/src/components/strategies/StrategyDeck.tsx`.

Na interface de props:

```ts
interface StrategyDeckProps {
  runId: string;
  proposal: Proposal;
  /** Opções que já viraram estratégia. Saem do deck: o fundador já decidiu. */
  usedOptionIndexes: number[];
  saving: boolean;
  error: string | null;
  onAdopt: (optionIndexes: number[], strategy?: StrategyDraft) => void;
}
```

Substituir o estado inicial e derivar a lista visível. A ordem importa: `proposal.options` **não** é filtrado, porque `onAdopt` e `useGetProposalDraft` falam em índices da proposta — reindexar aqui adotaria a opção errada.

```ts
export function StrategyDeck({ runId, proposal, usedOptionIndexes, saving, error, onAdopt }: StrategyDeckProps) {
  const { t } = useTranslation();

  // Índices originais que ainda podem ser escolhidos. Tudo que a tela mostra é
  // posição dentro desta lista; tudo que o servidor recebe é o índice original.
  const visible = proposal.options
    .map((_, index) => index)
    .filter((index) => !usedOptionIndexes.includes(index));

  // Abre na recomendação quando ela sobreviveu; senão, na primeira disponível.
  // Guardar a posição visível (não o índice original) é o que mantém o
  // CardDeck, que fala em 0..count-1, coerente com o que está na tela.
  const recommendedAt = visible.indexOf(proposal.recommendedIndex);
  const [at, setAt] = useState(recommendedAt === -1 ? 0 : recommendedAt);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState(false);

  // A seleção guarda índices originais, e descarta os que foram gastos por
  // outra aba enquanto esta tela estava aberta — sem isto o editor abriria
  // sobre uma opção que já não existe no deck.
  const indexes = [...picked].filter((index) => visible.includes(index)).sort((a, b) => a - b);
```

No corpo do render, trocar toda leitura posicional pelo mapeamento:

```ts
  const position = Math.min(at, visible.length - 1);
  const currentIndex = visible[position]!;
  const current = proposal.options[currentIndex]!;
  const isRecommended = (index: number) => index === proposal.recommendedIndex;
```

No `CardDeck`: `count={visible.length}`, e dentro de `renderCard`, `dotClass` e `dotLabel` converter a posição recebida:

```tsx
        dotClass={(index) => (picked.has(visible[index]!) ? 'bg-primary/40' : 'bg-muted-foreground/30')}
        renderCard={(index) => {
          const optionIndex = visible[index]!;
          return (
            <ProposalOptionCard
              option={proposal.options[optionIndex]!}
              isRecommended={isRecommended(optionIndex)}
              footer={
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`pick-option-${optionIndex}`}
                    checked={picked.has(optionIndex)}
                    disabled={saving}
                    onCheckedChange={() => toggle(optionIndex)}
                  />
                  <label htmlFor={`pick-option-${optionIndex}`} className="text-sm">
                    {t('pages.strategies.propose.includeLabel')}
                  </label>
                </div>
              }
            />
          );
        }}
```

E nas duas leituras finais, usar `position`/`currentIndex`:

```tsx
            {t('pages.strategies.propose.planPosition', { position: position + 1, total: visible.length })}
```

```tsx
      {isRecommended(currentIndex) && (
        <p className="text-xs text-muted-foreground">
          {t('pages.strategies.propose.recommendedHint', { name: current.name })}
        </p>
      )}
```

`combining` no `StrategyPlanEditor` já usa `indexes` (índices originais) — não muda.

- [ ] **Step 5: Run the deck test**

Run: `cd web && pnpm vitest run src/components/strategies/StrategyDeck.test.tsx`
Expected: PASS

- [ ] **Step 6: Write the failing ProposeStrategies test**

Create/modify `web/src/components/strategies/ProposeStrategies.test.tsx`. Siga o padrão de mock dos testes de página existentes (`src/pages/BusinessPage.test.tsx`) para os hooks gerados. O caso novo:

```tsx
  it('mostra propor de novo quando todas as opções foram adotadas', async () => {
    // run COMPLETED com 2 opções, uso = [0, 1]
    renderWithUsage({ usedOptionIndexes: [0, 1] });

    expect(await screen.findByRole('button', { name: /propor de novo/i })).toBeInTheDocument();
    expect(screen.queryByText('Outbound')).not.toBeInTheDocument();
  });

  it('não renderiza o deck enquanto o uso carrega', () => {
    renderWithUsage({ loading: true });

    expect(screen.queryByText('Outbound')).not.toBeInTheDocument();
  });
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd web && pnpm vitest run src/components/strategies/ProposeStrategies.test.tsx`
Expected: FAIL — o deck aparece nos dois casos.

- [ ] **Step 8: Wire the usage query into ProposeStrategies**

Modify `web/src/components/strategies/ProposeStrategies.tsx`.

Imports:

```ts
import { useGetProposalUsage } from '@/api/generated/hooks/strategiesHooks/useGetProposalUsage';
```

Depois de `const proposal = ...` (linha ~184), antes do branch do deck:

```ts
  // Buscado só quando existe proposta legível: um run FAILED ou de output
  // inválido não tem opção nenhuma para gastar.
  const usage = useGetProposalUsage(
    { agentRunId: activeId ?? '' },
    { query: { enabled: activeId !== null && proposal?.ok === true } },
  );
```

Substituir o branch `if (proposal?.ok && activeId)` por:

```tsx
  if (proposal?.ok && activeId) {
    // O uso ainda carregando não pode mostrar o deck: renderizar todas as
    // opções e removê-las depois é oferecer e retirar.
    if (usage.isLoading) return <SectionLoading />;
    // Falhar e mostrar o deck completo seria voltar ao bug que esta query
    // existe para corrigir — o servidor recusaria a adoção duplicada.
    if (usage.isError) return <SectionLoadError refetch={[usage.refetch]} />;

    const used = usage.data?.usedOptionIndexes ?? [];
    const remaining = proposal.value.options.length - used.length;

    if (remaining > 0) {
      return (
        <div className="space-y-3">
          {/* …cabeçalho e forGoal como já estão… */}
          <StrategyDeck
            key={activeId}
            runId={activeId}
            proposal={proposal.value}
            usedOptionIndexes={used}
            saving={accept.isPending}
            error={acceptError}
            onAdopt={(optionIndexes, strategy) =>
              accept.mutate({ data: { agentRunId: activeId, optionIndexes, ...(strategy ? { strategy } : {}) } })
            }
          />
          {/* …botão startAnotherBtn como já está… */}
        </div>
      );
    }
    // Todas gastas: cai fora deste branch e o formulário/botão de nova
    // proposta abaixo assume. Sem isto a tela seria um beco sem saída.
  }
```

Quando `remaining === 0`, o fluxo continua para os branches seguintes. Como `activeId !== null`, `latest.isLoading`/`latest.isError` já resolveram; a tela cai no formulário de nova proposta com o custo e o seletor de goal — que é exatamente "propor de novo".

Adicionar a invalidação no `onSuccess` do `accept` (linhas 61-64):

```ts
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: STRATEGIES.queryKeyRoot }),
          queryClient.invalidateQueries({ queryKey: HYPOTHESES.queryKeyRoot }),
          queryClient.invalidateQueries({ queryKey: [{ url: '/strategies/proposal-usage' }] }),
        ]);
```

- [ ] **Step 9: Run tests and typecheck**

Run: `cd web && pnpm vitest run src/components/strategies && pnpm typecheck`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
cd web
git add src/components/strategies src/api/generated
git commit -m "fix(strategies): stop offering proposal options already adopted"
```

---

### Task 3: Migração de proveniência + trava do PLANNED

**Files:**
- Modify: `back/prisma/schema.prisma` (model `Experiment`, ~linha 395-426)
- Create: `back/prisma/migrations/20260803190000_experiment_source_run/migration.sql`
- Modify: `back/src/http/api/experiments/experiments.domain.ts`
- Modify: `back/src/http/api/experiments/experiments.transition.ts`
- Modify: `back/src/http/api/experiments/plan-experiment/plan-experiment.controller.ts`
- Test: `back/src/http/api/experiments/experiments.test.ts`

**Interfaces:**
- Produces:
  - `Experiment.sourceAgentRunId: String? @unique` — usado pela Task 4.
  - `PLAN_REQUIRED_FIELDS: readonly ['metric','baselineValue','targetValue','startDate','endDate','successCriteria','audience','channel']`
  - `assertReadyToPlan(experiment: PlanCandidate): void` — lança `BadRequestError` nomeando os campos ausentes.
  - `transitionExperimentService` aceita `guard?: (current) => void`.

- [ ] **Step 1: Write the failing domain test**

Modify `back/src/http/api/experiments/experiments.test.ts` — adicionar:

```ts
import { assertReadyToPlan, PLAN_REQUIRED_FIELDS } from './experiments.domain.js';

const ready = {
  metric: 'reply_rate',
  baselineValue: 4.2,
  targetValue: 6,
  startDate: new Date('2026-08-10'),
  endDate: new Date('2026-09-07'),
  successCriteria: 'Acima de 6% com pelo menos 50 respostas',
  audience: 'Fundadores B2B SaaS',
  channel: 'Email',
};

describe('assertReadyToPlan', () => {
  it('aceita um experimento com o design completo', () => {
    expect(() => assertReadyToPlan(ready)).not.toThrow();
  });

  // docs/domains/experiments.md §18: "A Planned Experiment has a complete
  // design" — Baseline, Target e Duration incluídos.
  it.each(PLAN_REQUIRED_FIELDS)('recusa quando falta %s', (field) => {
    expect(() => assertReadyToPlan({ ...ready, [field]: null })).toThrow(/not ready/i);
  });

  it('nomeia todos os campos ausentes de uma vez', () => {
    try {
      assertReadyToPlan({ ...ready, baselineValue: null, targetValue: null });
      expect.unreachable('deveria ter lançado');
    } catch (error) {
      expect(JSON.stringify(error)).toContain('baselineValue');
      expect(JSON.stringify(error)).toContain('targetValue');
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd back && pnpm vitest run src/http/api/experiments/experiments.test.ts`
Expected: FAIL — `assertReadyToPlan` não existe.

- [ ] **Step 3: Implement the gate**

Modify `back/src/http/api/experiments/experiments.domain.ts` — adicionar ao final:

```ts
/**
 * O que um design completo tem, segundo docs/domains/experiments.md §18: um
 * PLANNED define Hypothesis, Variables, Audience, Channel, Metric, Baseline,
 * Target, Duration e Success Criteria.
 *
 * `hypothesisId` fica fora porque é NOT NULL no banco — não há experimento sem
 * hipótese. `variables` também: é Json livre, e a maioria dos testes tem uma
 * variável só, descrita no próprio nome.
 *
 * A trava passou a importar com o auto-plano: nove rascunhos criados de uma vez
 * sem baseline poderiam chegar a RUNNING, e cada Outcome seria comparado com
 * null.
 */
export const PLAN_REQUIRED_FIELDS = [
  'metric',
  'baselineValue',
  'targetValue',
  'startDate',
  'endDate',
  'successCriteria',
  'audience',
  'channel',
] as const;

export type PlanRequiredField = (typeof PLAN_REQUIRED_FIELDS)[number];
export type PlanCandidate = Partial<Record<PlanRequiredField, unknown>>;

export function missingPlanFields(experiment: PlanCandidate): PlanRequiredField[] {
  return PLAN_REQUIRED_FIELDS.filter((field) => {
    const value = experiment[field];
    return value === null || value === undefined || value === '';
  });
}

export function assertReadyToPlan(experiment: PlanCandidate): void {
  const missing = missingPlanFields(experiment);
  if (missing.length) {
    throw new BadRequestError(
      'This experiment is not ready to be planned',
      missing.map((field) => ({ path: field, message: 'required before PLANNED' })),
    );
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd back && pnpm vitest run src/http/api/experiments/experiments.test.ts`
Expected: PASS

- [ ] **Step 5: Thread the guard through the transition**

Modify `back/src/http/api/experiments/experiments.transition.ts`:

```ts
export function transitionExperimentService(deps: TransitionExperimentDeps) {
  return async (input: {
    workspaceId: string;
    id: string;
    to: ExperimentStatus;
    // Regra de conteúdo, não de aresta: a tabela de transições diz se o passo
    // existe, o guard diz se este experimento tem o que o passo exige.
    guard?: (current: NonNullable<Row>) => void;
    extra?: (current: NonNullable<Row>) => Prisma.ExperimentUpdateInput;
  }) => {
    const current = await deps.repo.findById(input.workspaceId, input.id);
    if (!current) throw new NotFoundError('Experiment not found');
    assertExperimentTransition(current.status, input.to);
    input.guard?.(current);
    return deps.repo.setStatus(input.id, input.to, input.extra?.(current) ?? {});
  };
}
```

Modify `back/src/http/api/experiments/plan-experiment/plan-experiment.controller.ts` — passar o guard:

```ts
import { assertReadyToPlan } from '../experiments.domain.js';
```

```ts
      return {
        experiment: await service({
          workspaceId: req.tenant.workspaceId,
          id: req.params.id,
          to: ExperimentStatus.PLANNED,
          guard: assertReadyToPlan,
        }),
      };
```

- [ ] **Step 6: Add the migration**

Modify `back/prisma/schema.prisma`, no model `Experiment`, depois de `completedAt`:

```prisma
  // Proveniência: de qual run de propose-experiment este rascunho nasceu.
  // Unique porque materializar o mesmo run duas vezes tem de devolver o mesmo
  // experimento, não criar um segundo dizendo a mesma coisa.
  sourceAgentRunId String? @unique
```

Create `back/prisma/migrations/20260803190000_experiment_source_run/migration.sql`:

```sql
-- Aditiva: coluna nula em toda linha existente, nenhum backfill.
ALTER TABLE "Experiment" ADD COLUMN "sourceAgentRunId" TEXT;

CREATE UNIQUE INDEX "Experiment_sourceAgentRunId_key" ON "Experiment"("sourceAgentRunId");
```

- [ ] **Step 7: Apply and verify**

Run: `cd back && pnpm prisma:migrate && pnpm prisma:generate && pnpm test && pnpm typecheck`
Expected: migração aplicada, testes PASS, typecheck limpo.

- [ ] **Step 8: Commit**

```bash
cd back
git add prisma src/http/api/experiments
git commit -m "feat(experiments): require a complete design before PLANNED, track source run"
```

---

### Task 4: `POST /experiments/from-proposal`

**Files:**
- Create: `back/src/http/api/experiments/from-proposal/from-proposal.schema.ts`
- Create: `back/src/http/api/experiments/from-proposal/from-proposal.service.ts`
- Create: `back/src/http/api/experiments/from-proposal/from-proposal.controller.ts`
- Test: `back/src/http/api/experiments/from-proposal/from-proposal.test.ts`
- Modify: `back/src/http/api/experiments/experiments.repository.ts`
- Modify: `back/src/http/api/experiments/index.ts`

**Interfaces:**
- Consumes: `proposeExperimentAgent` (`src/ai/agents/fill/propose-experiment.ts`) — `taskType: 'propose-experiment'`, `inputSchema` = `{ hypothesisId: uuid }`, `outputSchema` com `filled` opcional em todos os campos; `ExperimentsRepository.findHypothesis`, `.create`; `Experiment.sourceAgentRunId` (Task 3).
- Produces: rota `POST /experiments/from-proposal`, body `{ agentRunId: uuid }`, `201 { experiment }`, `operationId: 'createExperimentFromProposal'`. Repositório ganha `findBySourceRun(workspaceId: string, agentRunId: string)`.

- [ ] **Step 1: Write the failing test**

Create `back/src/http/api/experiments/from-proposal/from-proposal.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createFromProposalExperimentService } from './from-proposal.service.js';

const RUN_ID = '11111111-1111-1111-1111-111111111111';
const HYPOTHESIS_ID = '22222222-2222-2222-2222-222222222222';

const filled = {
  name: 'Teste de outbound em texto puro',
  metric: 'reply_rate',
  description: 'Desenhado a partir do aprendizado "Templates lidos como marketing".',
  objective: 'Saber se texto puro responde melhor que template',
  channel: 'Email',
  audience: 'Fundadores B2B SaaS, 10-50 pessoas',
  successCriteria: 'Resposta acima do baseline com pelo menos 50 envios',
};

const RUN = {
  taskType: 'propose-experiment',
  status: 'COMPLETED',
  input: { hypothesisId: HYPOTHESIS_ID },
  output: { filled, questions: [] },
};

const buildDeps = (over: Partial<Record<string, unknown>> = {}) => ({
  repo: {
    findHypothesis: vi.fn().mockResolvedValue({ id: HYPOTHESIS_ID, strategyId: 's-1' }),
    findBySourceRun: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation((workspaceId: string, data: object) => ({ id: 'e-1', workspaceId, ...data })),
  },
  findRun: vi.fn().mockResolvedValue(RUN),
  ...over,
});

describe('createFromProposalExperimentService', () => {
  it('cria o rascunho com os campos que a IA pode saber e os quatro números nulos', async () => {
    const deps = buildDeps();
    const service = createFromProposalExperimentService(deps as never);

    const experiment = await service({ agentRunId: RUN_ID, workspaceId: 'ws-1' });

    expect(experiment.name).toBe(filled.name);
    expect(experiment.metric).toBe('reply_rate');
    expect(experiment.strategyId).toBe('s-1');
    expect(experiment.sourceAgentRunId).toBe(RUN_ID);
    // Os quatro números são do fundador. Ver spec §2.
    expect(experiment.baselineValue).toBeUndefined();
    expect(experiment.targetValue).toBeUndefined();
    expect(experiment.startDate).toBeUndefined();
    expect(experiment.endDate).toBeUndefined();
  });

  it('devolve o experimento existente em vez de criar um segundo', async () => {
    const existing = { id: 'e-existente', sourceAgentRunId: RUN_ID };
    const deps = buildDeps({
      repo: { ...buildDeps().repo, findBySourceRun: vi.fn().mockResolvedValue(existing) },
    });
    const service = createFromProposalExperimentService(deps as never);

    await expect(service({ agentRunId: RUN_ID, workspaceId: 'ws-1' })).resolves.toBe(existing);
    expect(deps.repo.create).not.toHaveBeenCalled();
  });

  it('recusa sem escrever quando falta name ou metric', async () => {
    const deps = buildDeps({
      findRun: vi.fn().mockResolvedValue({ ...RUN, output: { filled: { ...filled, metric: undefined }, questions: [] } }),
    });
    const service = createFromProposalExperimentService(deps as never);

    await expect(service({ agentRunId: RUN_ID, workspaceId: 'ws-1' })).rejects.toThrow(/name and metric/i);
    expect(deps.repo.create).not.toHaveBeenCalled();
  });

  it('recusa um run que não terminou', async () => {
    const deps = buildDeps({ findRun: vi.fn().mockResolvedValue({ ...RUN, status: 'RUNNING' }) });
    const service = createFromProposalExperimentService(deps as never);

    await expect(service({ agentRunId: RUN_ID, workspaceId: 'ws-1' })).rejects.toThrow(/RUNNING/);
  });

  it('recusa um run de outro task type', async () => {
    const deps = buildDeps({ findRun: vi.fn().mockResolvedValue({ ...RUN, taskType: 'propose-strategies' }) });
    const service = createFromProposalExperimentService(deps as never);

    await expect(service({ agentRunId: RUN_ID, workspaceId: 'ws-1' })).rejects.toThrow(/did not design an experiment/i);
  });

  it('trata run de outro workspace como inexistente', async () => {
    const deps = buildDeps({ findRun: vi.fn().mockResolvedValue(null) });
    const service = createFromProposalExperimentService(deps as never);

    await expect(service({ agentRunId: RUN_ID, workspaceId: 'ws-1' })).rejects.toThrow(/not found/i);
  });

  it('recusa quando a hipótese do run não está neste workspace', async () => {
    const deps = buildDeps({
      repo: { ...buildDeps().repo, findHypothesis: vi.fn().mockResolvedValue(null) },
    });
    const service = createFromProposalExperimentService(deps as never);

    await expect(service({ agentRunId: RUN_ID, workspaceId: 'ws-1' })).rejects.toThrow(/Hypothesis not found/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd back && pnpm vitest run src/http/api/experiments/from-proposal`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Extend the repository**

Modify `back/src/http/api/experiments/experiments.repository.ts`:

Em `ExperimentData`, adicionar:

```ts
  sourceAgentRunId?: string;
```

E um leitor por proveniência, ao lado de `findById`:

```ts
    /**
     * O experimento que já nasceu deste run, se algum.
     *
     * A materialização é chamada pelo cliente e pode chegar duas vezes — duas
     * abas abertas, um retry depois de um timeout de rede. Ler antes de escrever
     * transforma isso numa resposta repetida em vez de um segundo rascunho.
     */
    findBySourceRun(workspaceId: string, agentRunId: string) {
      return prisma.experiment.findFirst({ where: { workspaceId, sourceAgentRunId: agentRunId } });
    },
```

- [ ] **Step 4: Write the schema**

Create `back/src/http/api/experiments/from-proposal/from-proposal.schema.ts`:

```ts
import { z } from 'zod';

export const experimentFromProposalBody = z.object({ agentRunId: z.string().uuid() });

export type ExperimentFromProposalBody = z.infer<typeof experimentFromProposalBody>;
```

- [ ] **Step 5: Write the service**

Create `back/src/http/api/experiments/from-proposal/from-proposal.service.ts`:

```ts
import { BadRequestError, NotFoundError } from '../../../../lib/errors.js';
import { proposeExperimentAgent } from '../../../../ai/agents/fill/propose-experiment.js';
import type { ExperimentsRepository } from '../experiments.repository.js';

export type FromProposalExperimentDeps = {
  repo: ExperimentsRepository;
  findRun(id: string, workspaceId: string): Promise<{
    taskType: string;
    status: string;
    input: unknown;
    output: unknown;
  } | null>;
};

export function createFromProposalExperimentService(deps: FromProposalExperimentDeps) {
  return async (input: { agentRunId: string; workspaceId: string }) => {
    // Antes de qualquer leitura do run: se este run já virou experimento, a
    // resposta é aquele experimento, e nada mais precisa ser decidido.
    const existing = await deps.repo.findBySourceRun(input.workspaceId, input.agentRunId);
    if (existing) return existing;

    const run = await deps.findRun(input.agentRunId, input.workspaceId);
    if (!run) throw new NotFoundError('Agent run not found');

    if (run.taskType !== proposeExperimentAgent.taskType) {
      throw new BadRequestError('This run did not design an experiment');
    }
    if (run.status !== 'COMPLETED') {
      throw new BadRequestError(`This run is ${run.status}, so it has nothing to accept yet`);
    }

    const runInput = proposeExperimentAgent.inputSchema.safeParse(run.input);
    if (!runInput.success) throw new BadRequestError('This run input is not readable');

    const output = proposeExperimentAgent.outputSchema.safeParse(run.output);
    if (!output.success) throw new BadRequestError('This run output is not a readable proposal');

    const filled = output.data.filled;

    // name e metric são NOT NULL no banco e opcionais no schema do agente.
    // Inventar qualquer um dos dois seria fabricar a definição do próprio teste
    // — a tela manda o fundador ao formulário com o resto pré-preenchido.
    if (!filled.name || !filled.metric) {
      throw new BadRequestError('This proposal has no name and metric, so it cannot become an experiment yet');
    }

    // A hipótese vem do input do run, e é relida aqui com escopo de workspace:
    // o run guarda um uuid, não uma prova de que ele ainda pertence a este
    // workspace.
    const hypothesis = await deps.repo.findHypothesis(input.workspaceId, runInput.data.hypothesisId);
    if (!hypothesis) throw new BadRequestError('Hypothesis not found in this workspace');

    // baselineValue, targetValue, startDate e endDate ficam de fora de
    // propósito — spec §2. Nascem nulos e a trava do PLANNED os cobra.
    return deps.repo.create(input.workspaceId, {
      hypothesisId: hypothesis.id,
      strategyId: hypothesis.strategyId,
      name: filled.name,
      metric: filled.metric,
      ...(filled.description ? { description: filled.description } : {}),
      ...(filled.objective ? { objective: filled.objective } : {}),
      ...(filled.channel ? { channel: filled.channel } : {}),
      ...(filled.audience ? { audience: filled.audience } : {}),
      ...(filled.successCriteria ? { successCriteria: filled.successCriteria } : {}),
      sourceAgentRunId: input.agentRunId,
    });
  };
}
```

- [ ] **Step 6: Write the controller and register it**

Create `back/src/http/api/experiments/from-proposal/from-proposal.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createExperimentsRepository } from '../experiments.repository.js';
import { experimentResponse } from '../experiments.schema.js';
import { experimentFromProposalBody } from './from-proposal.schema.js';
import { createFromProposalExperimentService } from './from-proposal.service.js';

export const experimentFromProposalRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/experiments/from-proposal',
    {
      schema: {
        tags: ['experiments'],
        operationId: 'createExperimentFromProposal',
        body: experimentFromProposalBody,
        response: { 201: experimentResponse },
      },
    },
    async (req, reply) => {
      const service = createFromProposalExperimentService({
        repo: createExperimentsRepository(app.prisma),
        // Run de outro workspace é indistinguível de inexistente.
        findRun: (id, workspaceId) => app.prisma.agentRun.findFirst({ where: { id, workspaceId } }),
      });

      const experiment = await service({ agentRunId: req.body.agentRunId, workspaceId: req.tenant.workspaceId });
      return reply.code(201).send({ experiment });
    },
  );
};
```

Modify `back/src/http/api/experiments/index.ts` — import junto dos outros e register **antes** de `updateExperimentRoute` (rotas estáticas antes de `/experiments/:id`):

```ts
import { experimentFromProposalRoute } from './from-proposal/from-proposal.controller.js';
```

```ts
  await app.register(createExperimentRoute);
  await app.register(experimentFromProposalRoute);
```

- [ ] **Step 7: Run tests, typecheck, dump OpenAPI**

Run: `cd back && pnpm vitest run src/http/api/experiments && pnpm typecheck && pnpm openapi:dump`
Expected: PASS; OpenAPI contém `createExperimentFromProposal`.

- [ ] **Step 8: Commit**

```bash
cd back
git add src/http/api/experiments
git commit -m "feat(experiments): materialize a draft experiment from a propose-experiment run"
```

---

### Task 5: `POST /strategies/:id/plan-experiments`

**Files:**
- Create: `back/src/http/api/strategies/plan-experiments/plan-experiments.schema.ts`
- Create: `back/src/http/api/strategies/plan-experiments/plan-experiments.service.ts`
- Create: `back/src/http/api/strategies/plan-experiments/plan-experiments.controller.ts`
- Test: `back/src/http/api/strategies/plan-experiments/plan-experiments.test.ts`
- Modify: `back/src/http/api/strategies/strategies.repository.ts`
- Modify: `back/src/http/api/strategies/index.ts`

**Interfaces:**
- Consumes: `createAgentRunService` (`src/http/api/agent-runs/create-agent-run/create-agent-run.service.ts`) — `({ tenant, taskType, input }) => Promise<{ id: string }>`; a chave de concorrência padrão é `` `${taskType}:${inputHash}` `` (`create-agent-run.service.ts:77`), então `hypothesisId` diferente ⇒ runs paralelos que não se bloqueiam.
- Produces: rota `POST /strategies/:id/plan-experiments` → `202 { runs: [{ hypothesisId, agentRunId }], failed: [{ hypothesisId, reason }] }`, `operationId: 'planStrategyExperiments'`. Repositório ganha `findPlannableHypotheses(workspaceId, strategyId): Promise<{ id: string }[]>` e `findStrategyById(workspaceId, id): Promise<{ id: string } | null>`.

- [ ] **Step 1: Write the failing test**

Create `back/src/http/api/strategies/plan-experiments/plan-experiments.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createPlanExperimentsService } from './plan-experiments.service.js';

const STRATEGY_ID = '33333333-3333-3333-3333-333333333333';
const H1 = '44444444-4444-4444-4444-444444444444';
const H2 = '55555555-5555-5555-5555-555555555555';
const TENANT = { workspaceId: 'ws-1', userId: 'u-1', organizationId: 'org-1', role: 'OWNER' as const };

const buildDeps = (over: Record<string, unknown> = {}) => ({
  repo: {
    findStrategyById: vi.fn().mockResolvedValue({ id: STRATEGY_ID }),
    findPlannableHypotheses: vi.fn().mockResolvedValue([{ id: H1 }, { id: H2 }]),
  },
  startRun: vi.fn().mockImplementation(async ({ input }: { input: { hypothesisId: string } }) => ({
    id: `run-${input.hypothesisId}`,
  })),
  ...over,
});

describe('createPlanExperimentsService', () => {
  it('dispara um run propose-experiment por hipótese pendente', async () => {
    const deps = buildDeps();
    const service = createPlanExperimentsService(deps as never);

    const result = await service({ strategyId: STRATEGY_ID, tenant: TENANT });

    expect(deps.startRun).toHaveBeenCalledTimes(2);
    expect(deps.startRun).toHaveBeenCalledWith({ tenant: TENANT, taskType: 'propose-experiment', input: { hypothesisId: H1 } });
    expect(result.runs).toEqual([
      { hypothesisId: H1, agentRunId: `run-${H1}` },
      { hypothesisId: H2, agentRunId: `run-${H2}` },
    ]);
    expect(result.failed).toEqual([]);
  });

  it('uma hipótese que falha não impede as outras', async () => {
    const deps = buildDeps({
      startRun: vi.fn().mockImplementation(async ({ input }: { input: { hypothesisId: string } }) => {
        if (input.hypothesisId === H1) throw new Error('Not enough credits');
        return { id: `run-${input.hypothesisId}` };
      }),
    });
    const service = createPlanExperimentsService(deps as never);

    const result = await service({ strategyId: STRATEGY_ID, tenant: TENANT });

    expect(result.runs).toEqual([{ hypothesisId: H2, agentRunId: `run-${H2}` }]);
    expect(result.failed).toEqual([{ hypothesisId: H1, reason: 'Not enough credits' }]);
  });

  it('não dispara nada quando nenhuma hipótese está pendente', async () => {
    const deps = buildDeps({
      repo: { findStrategyById: vi.fn().mockResolvedValue({ id: STRATEGY_ID }), findPlannableHypotheses: vi.fn().mockResolvedValue([]) },
    });
    const service = createPlanExperimentsService(deps as never);

    const result = await service({ strategyId: STRATEGY_ID, tenant: TENANT });

    expect(result).toEqual({ runs: [], failed: [] });
    expect(deps.startRun).not.toHaveBeenCalled();
  });

  it('trata estratégia de outro workspace como inexistente', async () => {
    const deps = buildDeps({
      repo: { findStrategyById: vi.fn().mockResolvedValue(null), findPlannableHypotheses: vi.fn() },
    });
    const service = createPlanExperimentsService(deps as never);

    await expect(service({ strategyId: STRATEGY_ID, tenant: TENANT })).rejects.toThrow(/not found/i);
    expect(deps.startRun).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd back && pnpm vitest run src/http/api/strategies/plan-experiments`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Extend the strategies repository**

Modify `back/src/http/api/strategies/strategies.repository.ts` — adicionar:

```ts
    findStrategyById(workspaceId: string, id: string) {
      return prisma.strategy.findFirst({ where: { id, workspaceId }, select: { id: true } });
    },
    /**
     * As hipóteses desta estratégia que ainda faltam ter um experimento.
     *
     * `experiments: { none: {} }` é o que torna o auto-plano repetível: rodar de
     * novo depois de uma falha parcial cobre só o que ficou faltando, em vez de
     * pagar outra vez pelo que já foi desenhado.
     *
     * VALIDATED e REJECTED ficam fora: um experimento existe para testar uma
     * hipótese, e depois de validada ou rejeitada não há mais nada a aprender
     * rodando o teste. Espelha `canCarryExperiment` no web
     * (`web/src/lib/hypothesis-actions.ts`).
     */
    findPlannableHypotheses(workspaceId: string, strategyId: string) {
      return prisma.hypothesis.findMany({
        where: {
          workspaceId,
          strategyId,
          status: { in: ['DRAFT', 'PROPOSED', 'TESTED'] },
          experiments: { none: {} },
        },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
    },
```

- [ ] **Step 4: Write the schema**

Create `back/src/http/api/strategies/plan-experiments/plan-experiments.schema.ts`:

```ts
import { z } from 'zod';

export const planExperimentsParams = z.object({ id: z.string().uuid() });

/**
 * Resultado por hipótese, não um número só.
 *
 * Um lote de nove pedidos pode ter um recusado por crédito e outro por já ter
 * um run em voo, e um "5 de 9" sem dizer quais deixa a tela sem como oferecer
 * retry do que faltou.
 */
export const planExperimentsResponse = z.object({
  runs: z.array(z.object({ hypothesisId: z.string().uuid(), agentRunId: z.string().uuid() })),
  failed: z.array(z.object({ hypothesisId: z.string().uuid(), reason: z.string() })),
});
```

- [ ] **Step 5: Write the service**

Create `back/src/http/api/strategies/plan-experiments/plan-experiments.service.ts`:

```ts
import { NotFoundError } from '../../../../lib/errors.js';
import { proposeExperimentAgent } from '../../../../ai/agents/fill/propose-experiment.js';
import type { TenantContext } from '../../../../lib/tenant.js';
import type { StrategiesRepository } from '../strategies.repository.js';

export type PlanExperimentsDeps = {
  repo: StrategiesRepository;
  startRun(args: { tenant: TenantContext; taskType: string; input: unknown }): Promise<{ id: string }>;
};

export function createPlanExperimentsService(deps: PlanExperimentsDeps) {
  return async (input: { strategyId: string; tenant: TenantContext }) => {
    const strategy = await deps.repo.findStrategyById(input.tenant.workspaceId, input.strategyId);
    if (!strategy) throw new NotFoundError('Strategy not found');

    const pending = await deps.repo.findPlannableHypotheses(input.tenant.workspaceId, input.strategyId);

    const runs: { hypothesisId: string; agentRunId: string }[] = [];
    const failed: { hypothesisId: string; reason: string }[] = [];

    // Sequencial de propósito: cada `startRun` autoriza crédito, e disparar os
    // nove em paralelo faria nove autorizações correrem sobre o mesmo saldo. O
    // trabalho pesado é do worker — aqui só se enfileira.
    for (const hypothesis of pending) {
      try {
        const run = await deps.startRun({
          tenant: input.tenant,
          taskType: proposeExperimentAgent.taskType,
          input: { hypothesisId: hypothesis.id },
        });
        runs.push({ hypothesisId: hypothesis.id, agentRunId: run.id });
      } catch (error) {
        // Uma recusa numa hipótese — crédito curto, run igual já em voo — não
        // pode derrubar o lote: o que passou fica enfileirado e o que falhou
        // volta nomeado, com retry individual na tela.
        failed.push({ hypothesisId: hypothesis.id, reason: error instanceof Error ? error.message : 'unknown error' });
      }
    }

    return { runs, failed };
  };
}
```

- [ ] **Step 6: Write the controller and register it**

Create `back/src/http/api/strategies/plan-experiments/plan-experiments.controller.ts`:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createAgentRunRepository } from '../../../../ai/agent-run/agent-run.repository.js';
import { createAgentRunService } from '../../agent-runs/create-agent-run/create-agent-run.service.js';
import { enqueueAgentRun } from '../../../../ai/queue/queue.js';
import { createStrategiesRepository } from '../strategies.repository.js';
import { planExperimentsParams, planExperimentsResponse } from './plan-experiments.schema.js';
import { createPlanExperimentsService } from './plan-experiments.service.js';

export const planExperimentsRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/strategies/:id/plan-experiments',
    {
      schema: {
        tags: ['strategies'],
        operationId: 'planStrategyExperiments',
        params: planExperimentsParams,
        response: { 202: planExperimentsResponse },
      },
    },
    async (req, reply) => {
      // Reusa o serviço de criação de run: é ele que valida input, roda o
      // precheck, cobra e deduplica. Reimplementar isso aqui seria um segundo
      // caminho de cobrança livre para divergir.
      const startRun = createAgentRunService({
        repo: createAgentRunRepository(app.prisma),
        enqueue: enqueueAgentRun,
        prisma: app.prisma,
      });

      const service = createPlanExperimentsService({
        repo: createStrategiesRepository(app.prisma),
        startRun,
      });

      const result = await service({ strategyId: req.params.id, tenant: req.tenant });
      return reply.code(202).send(result);
    },
  );
};
```

**Antes de escrever este arquivo**, confirme os nomes reais das duas dependências de infraestrutura — elas já existem, mas os nomes exportados devem ser lidos, não adivinhados:

```bash
cd back
grep -rn "export function createAgentRunRepository" src/ai/agent-run/
grep -rn "^export" src/ai/queue/queue.ts
grep -rn "createAgentRunService({" src/http/api/agent-runs/create-agent-run/create-agent-run.controller.ts
```

Use exatamente o que aparecer, copiando a montagem de deps do `create-agent-run.controller.ts`.

Modify `back/src/http/api/strategies/index.ts` — import junto dos outros e register **depois** de `proposalUsageRoute`:

```ts
import { planExperimentsRoute } from './plan-experiments/plan-experiments.controller.js';
```

```ts
  await app.register(planExperimentsRoute);
```

- [ ] **Step 7: Run tests, typecheck, dump OpenAPI**

Run: `cd back && pnpm vitest run src/http/api/strategies && pnpm typecheck && pnpm openapi:dump`
Expected: PASS; OpenAPI contém `planStrategyExperiments`.

- [ ] **Step 8: Commit**

```bash
cd back
git add src/http/api/strategies
git commit -m "feat(strategies): design every pending hypothesis experiment in one batch"
```

---

### Task 6: Painel de auto-plano na estratégia

**Files:**
- Create: `web/src/lib/experiment-plan-gate.ts`
- Create: `web/src/lib/experiment-plan-gate.test.ts`
- Create: `web/src/components/strategies/PlanExperimentRun.tsx`
- Create: `web/src/components/strategies/PlanExperimentsPanel.tsx`
- Create: `web/src/components/strategies/PlanExperimentsPanel.test.tsx`
- Modify: `web/src/pages/StrategyDetailPage.tsx`
- Modify: `web/src/locales/pt.json`, `en.json`, `es.json`

**Interfaces:**
- Consumes: hooks gerados `usePlanStrategyExperiments`, `useCreateExperimentFromProposal`, `useListExperiments`, `useGetAgentRun`, `useListAgentRuns`, `useGetCredits`, `useGetCreditPricing`; `availableCredits` (`@/lib/credits`); `canCarryExperiment` (`@/lib/hypothesis-actions`); `EXPERIMENTS` (`@/api/modules`).
- Produces: `missingPlanFields(experiment): PlanRequiredField[]` em `@/lib/experiment-plan-gate`; `<PlanExperimentsPanel strategyId hypotheses />`.

- [ ] **Step 1: Regenerate the typed client**

Run: `cd web && pnpm api:generate`
Expected: aparecem `usePlanStrategyExperiments` e `useCreateExperimentFromProposal`.

- [ ] **Step 2: Write the failing gate test**

Create `web/src/lib/experiment-plan-gate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { missingPlanFields, PLAN_REQUIRED_FIELDS } from './experiment-plan-gate';

const ready = {
  metric: 'reply_rate',
  baselineValue: 4.2,
  targetValue: 6,
  startDate: '2026-08-10',
  endDate: '2026-09-07',
  successCriteria: 'Acima de 6%',
  audience: 'Fundadores B2B SaaS',
  channel: 'Email',
};

describe('missingPlanFields', () => {
  it('não acha nada faltando num design completo', () => {
    expect(missingPlanFields(ready)).toEqual([]);
  });

  it('acha os quatro números que a IA não preenche', () => {
    const draft = { ...ready, baselineValue: null, targetValue: null, startDate: null, endDate: null };
    expect(missingPlanFields(draft)).toEqual(['baselineValue', 'targetValue', 'startDate', 'endDate']);
  });

  // Espelho de back/src/http/api/experiments/experiments.domain.ts.
  it('cobre os oito campos que o servidor exige', () => {
    expect(PLAN_REQUIRED_FIELDS).toHaveLength(8);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd web && pnpm vitest run src/lib/experiment-plan-gate.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 4: Implement the gate mirror**

Create `web/src/lib/experiment-plan-gate.ts`:

```ts
/**
 * Espelha `PLAN_REQUIRED_FIELDS` em
 * `back/src/http/api/experiments/experiments.domain.ts`. O servidor recusa o
 * PLANNED de novo — isto só existe para dizer ao fundador o que falta antes de
 * ele tentar, e para contar os campos no marcador do rascunho.
 */
export const PLAN_REQUIRED_FIELDS = [
  'metric',
  'baselineValue',
  'targetValue',
  'startDate',
  'endDate',
  'successCriteria',
  'audience',
  'channel',
] as const;

export type PlanRequiredField = (typeof PLAN_REQUIRED_FIELDS)[number];

export function missingPlanFields(experiment: Partial<Record<PlanRequiredField, unknown>>): PlanRequiredField[] {
  return PLAN_REQUIRED_FIELDS.filter((field) => {
    const value = experiment[field];
    return value === null || value === undefined || value === '';
  });
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `cd web && pnpm vitest run src/lib/experiment-plan-gate.test.ts`
Expected: PASS

- [ ] **Step 6: Write the run row**

Create `web/src/components/strategies/PlanExperimentRun.tsx`:

```tsx
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useGetAgentRun } from '@/api/generated/hooks/agent-runsHooks/useGetAgentRun';
import { useCreateExperimentFromProposal } from '@/api/generated/hooks/experimentsHooks/useCreateExperimentFromProposal';
import type { GetAgentRun200StatusEnumKey } from '@/api/generated/types/GetAgentRun';
import { EXPERIMENTS } from '@/api/modules';
import { apiErrorMessage } from '@/lib/api-errors';
import { Button } from '@/components/ui/button';

const TERMINAL: GetAgentRun200StatusEnumKey[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

interface PlanExperimentRunProps {
  agentRunId: string;
  /** Nome da hipótese que este run está desenhando — o fundador não lê uuid. */
  label: string;
}

/**
 * Um run do lote: espera, e ao terminar transforma o output em experimento.
 *
 * A materialização é chamada daqui, do cliente, e não do worker: não existe
 * passo pós-run no runner, e criar esse conceito é maior que este escopo. Fechar
 * o navegador não perde nada — o run termina, o output fica gravado, e o painel
 * oferece a criação na próxima visita. `POST /experiments/from-proposal` é
 * idempotente pela unique de `sourceAgentRunId`, então duas abas fazendo isto ao
 * mesmo tempo criam um experimento só.
 */
export function PlanExperimentRun({ agentRunId, label }: PlanExperimentRunProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const run = useGetAgentRun(agentRunId, {
    query: {
      refetchInterval: (query) =>
        query.state.status === 'error' || (query.state.data && TERMINAL.includes(query.state.data.status))
          ? false
          : 2000,
    },
  });

  const create = useCreateExperimentFromProposal({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: EXPERIMENTS.queryKeyRoot }),
    },
  });

  const done = run.data?.status === 'COMPLETED';

  // Dispara uma vez, quando o run fica COMPLETED. `isIdle` é a trava: sem ela o
  // efeito reenviaria a cada refetch, e mesmo sendo idempotente no servidor
  // seria uma chamada por polling.
  useEffect(() => {
    if (done && create.isIdle) create.mutate({ data: { agentRunId } });
  }, [done, create, agentRunId]);

  if (run.isError || run.data?.status === 'FAILED' || run.data?.status === 'CANCELLED') {
    return (
      <li className="flex items-center justify-between gap-2 text-sm">
        <span className="text-destructive">{t('pages.strategies.autoPlan.runFailed', { name: label })}</span>
      </li>
    );
  }

  if (create.isError) {
    return (
      <li className="flex items-center justify-between gap-2 text-sm">
        <span className="text-destructive">{apiErrorMessage(create.error, t('pages.strategies.autoPlan.createFailed'))}</span>
        <Button size="sm" variant="outline" onClick={() => create.mutate({ data: { agentRunId } })}>
          {t('pages.strategies.autoPlan.retryBtn')}
        </Button>
      </li>
    );
  }

  if (create.isSuccess) {
    return (
      <li className="text-sm text-muted-foreground">{t('pages.strategies.autoPlan.runDone', { name: label })}</li>
    );
  }

  return (
    <li className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      {t('pages.strategies.autoPlan.runWorking', { name: label })}
    </li>
  );
}
```

- [ ] **Step 7: Write the failing panel test**

Create `web/src/components/strategies/PlanExperimentsPanel.test.tsx`. Siga o padrão de mock de hooks gerados usado em `src/pages/BusinessPage.test.tsx`. Casos:

```tsx
  it('mostra o custo total das hipóteses pendentes', () => {
    // 3 hipóteses pendentes × 2 créditos
    renderPanel({ pending: 3, credits: 100, costPerRun: 2 });

    expect(screen.getByText(/6/)).toBeInTheDocument();
  });

  it('bloqueia o disparo quando o saldo não cobre o lote', () => {
    renderPanel({ pending: 3, credits: 4, costPerRun: 2 });

    expect(screen.getByRole('button', { name: /gerar/i })).toBeDisabled();
  });

  it('não oferece nada quando toda hipótese já tem experimento', () => {
    renderPanel({ pending: 0, credits: 100, costPerRun: 2 });

    expect(screen.queryByRole('button', { name: /gerar/i })).not.toBeInTheDocument();
  });

  it('lista os campos que faltam num rascunho gerado', () => {
    renderPanel({ pending: 0, credits: 100, costPerRun: 2, experiments: [{ id: 'e-1', name: 'Teste', metric: 'reply_rate', baselineValue: null, targetValue: null, startDate: null, endDate: null, audience: 'X', channel: 'Email', successCriteria: 'Y' }] });

    expect(screen.getByText(/4/)).toBeInTheDocument();
  });
```

- [ ] **Step 8: Run it to verify it fails**

Run: `cd web && pnpm vitest run src/components/strategies/PlanExperimentsPanel.test.tsx`
Expected: FAIL — componente não existe.

- [ ] **Step 9: Write the panel**

Create `web/src/components/strategies/PlanExperimentsPanel.tsx`:

```tsx
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useListExperiments } from '@/api/generated/hooks/experimentsHooks/useListExperiments';
import { usePlanStrategyExperiments } from '@/api/generated/hooks/strategiesHooks/usePlanStrategyExperiments';
import { useGetCredits } from '@/api/generated/hooks/creditsHooks/useGetCredits';
import { useGetCreditPricing } from '@/api/generated/hooks/creditsHooks/useGetCreditPricing';
import { availableCredits } from '@/lib/credits';
import { apiErrorMessage } from '@/lib/api-errors';
import { canCarryExperiment } from '@/lib/hypothesis-actions';
import { missingPlanFields } from '@/lib/experiment-plan-gate';
import { PlanExperimentRun } from '@/components/strategies/PlanExperimentRun';
import { Help } from '@/components/Help';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

const TASK_TYPE = 'propose-experiment';

interface PanelHypothesis {
  id: string;
  statement: string;
  status: Parameters<typeof canCarryExperiment>[0];
}

interface PlanExperimentsPanelProps {
  strategyId: string;
  hypotheses: PanelHypothesis[];
}

/**
 * Desenha de uma vez os testes que faltam neste plano.
 *
 * Existia um formulário por hipótese: um plano de três opções com três
 * hipóteses cada custava nove idas ao formulário antes de qualquer teste sair
 * do papel. O que a IA pode saber ela preenche; o que é do fundador — baseline,
 * meta e datas — fica pendente e nomeado no rascunho.
 */
export function PlanExperimentsPanel({ strategyId, hypotheses }: PlanExperimentsPanelProps) {
  const { t } = useTranslation();
  const [started, setStarted] = useState<{ hypothesisId: string; agentRunId: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const experiments = useListExperiments({ strategyId });
  const credits = useGetCredits();
  const pricing = useGetCreditPricing();

  const designed = experiments.data?.experiments ?? [];

  // Mesma seleção que o servidor faz em `findPlannableHypotheses`: sem
  // experimento e ainda testável. Espelho para poder mostrar o custo antes do
  // clique — a decisão de valer é do servidor.
  const pending = hypotheses.filter(
    (hypothesis) => canCarryExperiment(hypothesis.status) && !designed.some((e) => e.hypothesisId === hypothesis.id),
  );

  const costPerRun = pricing.data?.operations.find((operation) => operation.taskType === TASK_TYPE)?.credits ?? null;
  const total = costPerRun === null ? null : costPerRun * pending.length;
  const balance = credits.data ? availableCredits(credits.data) : null;
  // Orientação, não autorização: o worker autoriza cada run de novo. Até os dois
  // números resolverem, `short` fica falso para não bloquear quem tem saldo.
  const short = total !== null && balance !== null && balance < total;

  const plan = usePlanStrategyExperiments({
    mutation: {
      onMutate: () => setError(null),
      onSuccess: (data) => {
        setStarted(data.runs);
        // O que o servidor recusou volta nomeado, para o fundador saber o que
        // ficou de fora em vez de contar cartões.
        if (data.failed.length) {
          setError(t('pages.strategies.autoPlan.partial', { count: data.failed.length }));
        }
      },
      onError: (mutationError) => setError(apiErrorMessage(mutationError, t('pages.strategies.autoPlan.startFailed'))),
    },
  });

  const nameOf = (hypothesisId: string) =>
    hypotheses.find((hypothesis) => hypothesis.id === hypothesisId)?.statement ?? hypothesisId;

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <p className="text-sm font-medium">
          {t('pages.strategies.autoPlan.title')}
          <Help title={t('pages.strategies.autoPlan.helpTitle')}>{t('pages.strategies.autoPlan.help')}</Help>
        </p>

        {pending.length > 0 && (
          <>
            <p className="text-sm text-muted-foreground">
              {t('pages.strategies.autoPlan.summary', { count: pending.length })}
              {total !== null && ` · ${t('pages.strategies.autoPlan.cost', { credits: total })}`}
            </p>

            {short && (
              <p className="text-sm text-destructive">
                {t('pages.strategies.autoPlan.short')}{' '}
                <Link to="/app/settings/billing" className="underline">
                  {t('pages.strategies.autoPlan.topUp')}
                </Link>
              </p>
            )}

            <Button
              size="sm"
              disabled={short || plan.isPending || started.length > 0}
              onClick={() => plan.mutate({ id: strategyId })}
            >
              {t('pages.strategies.autoPlan.startBtn', { count: pending.length })}
            </Button>
          </>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {started.length > 0 && (
          <ul className="space-y-2">
            {started.map((run) => (
              <PlanExperimentRun key={run.agentRunId} agentRunId={run.agentRunId} label={nameOf(run.hypothesisId)} />
            ))}
          </ul>
        )}

        {designed.length > 0 && (
          <ul className="space-y-2">
            {designed.map((experiment) => {
              const missing = missingPlanFields(experiment);
              return (
                <li key={experiment.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Link to={`/app/experiments/${experiment.id}`} className="underline">
                    {experiment.name}
                  </Link>
                  {missing.length > 0 && (
                    <Badge variant="outline">{t('pages.strategies.autoPlan.missing', { count: missing.length })}</Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

Confirme a forma real de duas coisas antes de fechar este arquivo, lendo em vez de adivinhar:

```bash
cd web
grep -rn "operations" src/api/generated/types/GetCreditPricing.ts | head
grep -rn "export function availableCredits" -A 6 src/lib/credits.ts
grep -rn "experiments/:id" src/App.tsx
```

Ajuste `costPerRun`, `availableCredits` e o `to=` do link ao que existir.

- [ ] **Step 9b: Recover runs started in an earlier visit (spec §4.5)**

Sem isto, fechar a aba durante o lote deixa os runs órfãos: eles terminam no
worker, o output fica gravado, e nenhuma tela oferece a criação. `started` é
estado em memória e morre com a aba.

Test primeiro, em `PlanExperimentsPanel.test.tsx`:

```tsx
  it('adota runs de propose-experiment já concluídos de hipóteses pendentes', async () => {
    renderPanel({
      pending: 1,
      pendingHypothesisId: 'h-1',
      agentRuns: [{ id: 'run-1', taskType: 'propose-experiment', status: 'COMPLETED', input: { hypothesisId: 'h-1' } }],
    });

    // Sem novo disparo: o run já foi pago.
    expect(await screen.findByText(/criado|desenhando/i)).toBeInTheDocument();
  });
```

Implementação, em `PlanExperimentsPanel.tsx`:

```tsx
import { useListAgentRuns } from '@/api/generated/hooks/agent-runsHooks/useListAgentRuns';
import { z } from 'zod';
```

```tsx
// O input do run chega como unknown na resposta, igual ao output: parseado,
// nunca convertido com `as`.
const runInputSchema = z.object({ hypothesisId: z.string().uuid() });

function runHypothesisId(input: unknown): string | null {
  const parsed = runInputSchema.safeParse(input);
  return parsed.success ? parsed.data.hypothesisId : null;
}
```

Dentro do componente, depois de `pending`:

```tsx
  // Runs deste task type já em voo ou concluídos. Limite generoso: um plano de
  // três opções com três hipóteses cada gera nove.
  const history = useListAgentRuns({ taskType: TASK_TYPE, limit: 30 });

  // Um run recuperado só interessa se a hipótese dele ainda está pendente: se
  // já existe experimento, o run virou o que tinha de virar.
  const recovered = (history.data?.runs ?? [])
    .map((run) => ({ agentRunId: run.id, hypothesisId: runHypothesisId(run.input) }))
    .filter((run): run is { agentRunId: string; hypothesisId: string } => run.hypothesisId !== null)
    .filter((run) => pending.some((hypothesis) => hypothesis.id === run.hypothesisId));

  // O que esta sessão disparou vence: é a lista com a ordem do lote. O
  // recuperado entra só para o que não está nela.
  const tracked = [
    ...started,
    ...recovered.filter((run) => !started.some((s) => s.agentRunId === run.agentRunId)),
  ];
```

Trocar as duas leituras de `started` no render por `tracked`:

```tsx
        {tracked.length > 0 && (
          <ul className="space-y-2">
            {tracked.map((run) => (
              <PlanExperimentRun key={run.agentRunId} agentRunId={run.agentRunId} label={nameOf(run.hypothesisId)} />
            ))}
          </ul>
        )}
```

E desabilitar o botão de disparo quando há run rastreado, não só quando esta
sessão disparou:

```tsx
              disabled={short || plan.isPending || tracked.length > 0}
```

Confirme a forma de `useListAgentRuns` e se a resposta traz `input` por run:

```bash
cd web
grep -rn "input" src/api/generated/types/ListAgentRuns.ts | head
```

Se `input` não vier na listagem, use `useGetAgentRun` por id dentro de
`PlanExperimentRun` e mova o filtro por hipótese para lá — nunca adivinhe o
campo.

- [ ] **Step 10: Add the i18n keys**

Modify `web/src/locales/pt.json` sob `pages.strategies`:

```json
    "autoPlan": {
      "title": "Testes deste plano",
      "helpTitle": "O que a AUREA desenha",
      "help": "A AUREA desenha o teste de cada hipótese: nome, métrica, canal, público e critério de sucesso. O número de onde você parte, a meta e as datas são seus — um baseline inventado seria lido depois como medição.",
      "summary": "{{count}} hipótese sem teste desenhado",
      "summary_plural": "{{count}} hipóteses sem teste desenhado",
      "cost": "{{credits}} créditos",
      "startBtn": "Gerar {{count}} teste",
      "startBtn_plural": "Gerar {{count}} testes",
      "short": "Saldo insuficiente para o lote inteiro.",
      "topUp": "Adicionar créditos",
      "startFailed": "Não foi possível começar. Tente de novo.",
      "partial": "{{count}} hipótese ficou de fora. Tente novamente para cobrir o que faltou.",
      "partial_plural": "{{count}} hipóteses ficaram de fora. Tente novamente para cobrir o que faltou.",
      "runWorking": "Desenhando o teste de \"{{name}}\"…",
      "runDone": "Teste de \"{{name}}\" criado.",
      "runFailed": "O desenho do teste de \"{{name}}\" falhou.",
      "createFailed": "O teste foi desenhado, mas não foi possível criá-lo.",
      "retryBtn": "Tentar de novo",
      "missing": "faltam {{count}} campo seu",
      "missing_plural": "faltam {{count}} campos seus"
    }
```

Traduza as mesmas chaves em `en.json` e `es.json`. Confira a convenção de plural usada nos arquivos existentes (`_plural` vs `_other`) e siga a que estiver lá.

- [ ] **Step 11: Integrate into the page**

Modify `web/src/pages/StrategyDetailPage.tsx` — importar e renderizar o painel acima da lista de hipóteses (o `<h2>` da linha ~164):

```tsx
import { PlanExperimentsPanel } from '@/components/strategies/PlanExperimentsPanel';
```

```tsx
      {id && hypotheses.data && (
        <PlanExperimentsPanel
          strategyId={id}
          hypotheses={hypotheses.data.hypotheses.map((hypothesis) => ({
            id: hypothesis.id,
            statement: hypothesis.statement,
            status: hypothesis.status,
          }))}
        />
      )}
```

- [ ] **Step 12: Run everything**

Run: `cd web && pnpm vitest run && pnpm typecheck && pnpm build`
Expected: todos os testes PASS, typecheck limpo, build OK.

- [ ] **Step 13: Commit**

```bash
cd web
git add src/lib/experiment-plan-gate.ts src/lib/experiment-plan-gate.test.ts src/components/strategies src/pages/StrategyDetailPage.tsx src/locales src/api/generated
git commit -m "feat(strategies): design every pending experiment of a plan in one click"
```

---

## Verificação final

- [ ] `cd back && pnpm test && pnpm typecheck`
- [ ] `cd web && pnpm test && pnpm typecheck && pnpm build`
- [ ] Manual, com `pnpm dev:all` no back: adotar uma opção de proposta → recarregar `/app/strategies` → a opção adotada não aparece mais no deck; adotar todas → aparece o formulário de nova proposta.
- [ ] Manual: numa estratégia com hipóteses sem teste → o painel mostra a contagem e o custo → gerar → os rascunhos aparecem com "faltam 4 campos seus" → tentar mover um deles para PLANNED sem preencher → recusa nomeando os campos.

## Fora deste plano (spec §5)

Publicação em canal, Outcome automático (GA4/Ads/CRM), otimização autônoma, preenchimento de baseline/target/datas por IA, passo pós-run no runner.
