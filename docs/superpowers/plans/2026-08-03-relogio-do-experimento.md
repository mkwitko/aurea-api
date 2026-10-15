# Relógio do experimento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** As datas que o fundador declarou passam a mover o status do experimento, o dashboard cobra o que está esperando número, e gravar o número dispara a interpretação sozinho.

**Architecture:** Uma decisão pura (`dueTransition`) diz para onde um experimento vai dado `now`; um scheduler no processo do worker aplica essa decisão pelo mesmo `transitionExperimentService` que os botões usam, então o relógio não pode fazer um movimento que um humano não poderia. O dashboard ganha um agregado de "medição pendente" (COMPLETED com zero outcomes) e `create-outcome` passa a enfileirar `interpret-outcome` depois de gravar, devolvendo o `agentRunId` para o painel de interpretação que já existe adotar.

**Tech Stack:** Node 22, Fastify 5, TypeScript strict ESM (`.js` nos imports), Zod 3 + `fastify-type-provider-zod` 4, Prisma 6 + PostgreSQL, BullMQ + Redis, Vitest. Frontend: Vite + React 19, react-router-dom 7, Tailwind + shadcn/ui, Kubb + React Query, i18next (pt/en/es).

Spec: `back/docs/superpowers/specs/2026-08-03-relogio-do-experimento-design.md`.

## Global Constraints

- **Commit exige aprovação explícita.** Cada task termina em `git add` + `git status` + diff resumido; **não rode `git commit` sem o "ok" do humano.**
- **Nenhum código gera, infere ou assume `baselineValue`, `targetValue`, `startDate` ou `endDate`.** O relógio **cumpre** datas declaradas; nunca as escreve. Experimento sem `startDate` não inicia sozinho; sem `endDate` não completa sozinho.
- **Completar não é ter sucesso** (`docs/domains/experiments.md` §14). Nada nesta entrega produz veredito, flag `met`, rótulo de sucesso ou cor semântica de resultado.
- **Zod 3**, não 4. `z.string().uuid()`, não `z.uuid()`.
- **Isolamento de tenant absoluto**, com uma exceção nomeada: `findDueSystemWide` cruza workspaces de propósito e tem teste que afirma isso. Todo o resto lê `workspaceId` de `req.tenant`, nunca de body/query/params.
- **Toda rota tem `operationId` e `response`** — é o que alimenta o OpenAPI e os hooks do Kubb.
- **Erros só tipados**: subclasses de `AppError` de `src/lib/errors.ts`. Nunca `throw new Error()` num caminho de requisição.
- **Rota tenant-scoped ganha teste de negação cross-tenant.**
- **Frontend: Tailwind + shadcn/ui apenas.** Sem CSS puro, sem `style={{}}`. Sem `fetch` cru — só hooks gerados pelo Kubb. `Help` em cada termo de domínio novo.
- **i18n nas três locales** (`pt`, `en`, `es`), sufixo plural CLDR `_other`.
- **`observedAt` no futuro continua 400.** Já implementado em `create-outcome.service.ts`.
- Fronteira de dia em **UTC**, errando para o lado de **não** fechar cedo.

---

## File Structure

### Backend (`aurea/back`)

| Arquivo | Responsabilidade |
|---|---|
| `src/http/api/experiments/experiments.clock.ts` **(criar)** | Decisão pura: dado `{status, startDate, endDate}` e `now`, para onde vai — ou null |
| `src/http/api/experiments/experiments.clock.test.ts` **(criar)** | Tabela de casos da decisão + fronteira de dia + coerência com `TRANSITIONS` |
| `src/http/api/experiments/experiments.repository.ts` **(modificar)** | `findDueSystemWide(now, limit)` — a exceção de tenant, nomeada |
| `src/schedule/experiment-clock.ts` **(criar)** | `tickExperimentClock` (aplica) e `startExperimentClock` (intervalo) |
| `src/schedule/experiment-clock.test.ts` **(criar)** | Aplica a decisão, tolera falha de um item, não fura `TRANSITIONS` |
| `src/config/env.ts` **(modificar)** | `EXPERIMENT_CLOCK_INTERVAL_MS`, default `900_000` |
| `src/worker.ts` **(modificar)** | Sobe o relógio junto do reaper; `clearInterval` no shutdown |
| `src/http/api/dashboard/dashboard.schema.ts` **(modificar)** | `dashboardPendingMeasurement` + campo `pendingMeasurement` na resposta |
| `src/http/api/dashboard/dashboard.repository.ts` **(modificar)** | `pendingMeasurement(workspaceId)` → `{ count, items }` |
| `src/http/api/dashboard/get-dashboard/get-dashboard.service.ts` **(modificar)** | Inclui o agregado na resposta |
| `src/http/api/dashboard/get-dashboard/get-dashboard.test.ts` **(modificar)** | Contagem, corte em 5, exclusão de quem já tem outcome, cross-tenant |
| `src/http/api/outcomes/outcomes.schema.ts` **(modificar)** | `outcomeInterpretation` + `outcomeCreatedResponse` |
| `src/http/api/outcomes/create-outcome/create-outcome.service.ts` **(modificar)** | Grava primeiro, dispara depois, nunca lança por causa do disparo |
| `src/http/api/outcomes/create-outcome/create-outcome.controller.ts` **(modificar)** | Injeta `startRun`; responde `outcomeCreatedResponse` |
| `src/http/api/outcomes/outcomes.test.ts` **(modificar)** | Disparo feliz, disparo recusado, `observedAt` futuro |

### Frontend (`aurea/web`)

| Arquivo | Responsabilidade |
|---|---|
| `src/components/dashboard/PendingMeasurementCard.tsx` **(criar)** | "N testes esperando o número", até 5 + "+N" |
| `src/components/dashboard/PendingMeasurementCard.test.tsx` **(criar)** | Contagem, corte, estado vazio |
| `src/pages/DashboardPage.tsx` **(modificar)** | Renderiza o card |
| `src/components/AppLayout.tsx` **(modificar)** | Badge no item de experimentos |
| `src/components/experiments/OutcomesSection.tsx` **(modificar)** | Custo + saldo no botão; propaga `interpretation` |
| `src/components/experiments/OutcomeInterpretation.tsx` **(modificar)** | Prop `adoptRunId` com precedência sobre a recuperação |
| `src/pages/ExperimentDetailPage.tsx` **(modificar)** | Guarda o `agentRunId` devolvido e passa para o painel |
| `src/locales/{pt,en,es}.json` **(modificar)** | Chaves novas |

---

## Task 1: Decisão do relógio (pura)

**Files:**
- Create: `back/src/http/api/experiments/experiments.clock.ts`
- Test: `back/src/http/api/experiments/experiments.clock.test.ts`

**Interfaces:**
- Consumes: `ExperimentStatus` de `@prisma/client`; `TRANSITIONS` de `./experiments.domain.js` (só no teste).
- Produces:
  - `export type ClockRow = { id: string; workspaceId: string; status: ExperimentStatus; startDate: Date | null; endDate: Date | null }`
  - `export function dueTransition(row: ClockRow, now: Date): ExperimentStatus | null`

- [ ] **Step 1: Escreva o teste que falha**

`back/src/http/api/experiments/experiments.clock.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ExperimentStatus } from '@prisma/client';
import { TRANSITIONS } from './experiments.domain.js';
import { dueTransition, type ClockRow } from './experiments.clock.js';

const row = (over: Partial<ClockRow>): ClockRow => ({
  id: 'e1',
  workspaceId: 'ws-1',
  status: ExperimentStatus.APPROVED,
  startDate: null,
  endDate: null,
  ...over,
});

const NOW = new Date('2026-08-10T12:00:00.000Z');

describe('dueTransition', () => {
  it('inicia um aprovado cuja data de início já chegou', () => {
    const at = dueTransition(row({ startDate: new Date('2026-08-10T00:00:00.000Z') }), NOW);

    expect(at).toBe(ExperimentStatus.RUNNING);
  });

  it('não inicia um aprovado cuja data de início ainda não chegou', () => {
    expect(dueTransition(row({ startDate: new Date('2026-08-11T00:00:00.000Z') }), NOW)).toBeNull();
  });

  // A ausência da data é a ausência da declaração. Inventar o dia envenena a
  // leitura do resultado tanto quanto inventar o baseline — é a restrição de
  // domínio do spec §2.
  it('não inicia um aprovado sem data de início', () => {
    expect(dueTransition(row({ startDate: null }), NOW)).toBeNull();
  });

  it('completa um em execução cujo dia de fim já passou inteiro', () => {
    const at = dueTransition(
      row({ status: ExperimentStatus.RUNNING, endDate: new Date('2026-08-09T00:00:00.000Z') }),
      NOW,
    );

    expect(at).toBe(ExperimentStatus.COMPLETED);
  });

  // A fronteira. Um teste que termina hoje não fecha hoje: fechar um dia antes
  // corta medição que o fundador contava ter; fechar um dia depois só atrasa a
  // cobrança (spec §3.2).
  it('não completa no próprio dia de fim, nem no último instante dele', () => {
    const today = row({ status: ExperimentStatus.RUNNING, endDate: new Date('2026-08-10T00:00:00.000Z') });

    expect(dueTransition(today, NOW)).toBeNull();
    expect(dueTransition(today, new Date('2026-08-10T23:59:59.999Z'))).toBeNull();
    expect(dueTransition(today, new Date('2026-08-11T00:00:00.000Z'))).toBe(ExperimentStatus.COMPLETED);
  });

  it('não completa um em execução sem data de fim', () => {
    expect(dueTransition(row({ status: ExperimentStatus.RUNNING, endDate: null }), NOW)).toBeNull();
  });

  // Pausar tem motivo humano (docs/domains/experiments.md §21) e retomar por
  // relógio apagaria essa decisão. DRAFT e PLANNED não têm o que cumprir ainda,
  // e COMPLETED/CANCELLED são terminais.
  it('não toca nenhum outro status, mesmo com as datas vencidas', () => {
    const past = { startDate: new Date('2026-01-01T00:00:00.000Z'), endDate: new Date('2026-01-02T00:00:00.000Z') };

    for (const status of [
      ExperimentStatus.DRAFT,
      ExperimentStatus.PLANNED,
      ExperimentStatus.PAUSED,
      ExperimentStatus.COMPLETED,
      ExperimentStatus.CANCELLED,
    ]) {
      expect(dueTransition(row({ status, ...past }), NOW)).toBeNull();
    }
  });

  // A trava contra o relógio virar um caminho paralelo de escrita: tudo que ele
  // propõe tem de ser uma aresta que a tabela já permite.
  it('só propõe passos que a tabela de transições permite', () => {
    const proposals = [
      dueTransition(row({ startDate: new Date('2026-08-01T00:00:00.000Z') }), NOW),
      dueTransition(row({ status: ExperimentStatus.RUNNING, endDate: new Date('2026-08-01T00:00:00.000Z') }), NOW),
    ];

    expect(proposals).toEqual([ExperimentStatus.RUNNING, ExperimentStatus.COMPLETED]);
    expect(TRANSITIONS[ExperimentStatus.APPROVED]).toContain(ExperimentStatus.RUNNING);
    expect(TRANSITIONS[ExperimentStatus.RUNNING]).toContain(ExperimentStatus.COMPLETED);
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd back && npx vitest run src/http/api/experiments/experiments.clock.test.ts`
Expected: FAIL — `Failed to resolve import "./experiments.clock.js"`.

- [ ] **Step 3: Implemente**

`back/src/http/api/experiments/experiments.clock.ts`:

```ts
import { ExperimentStatus } from '@prisma/client';

/** O que a decisão precisa saber de um experimento, e nada mais. */
export type ClockRow = {
  id: string;
  workspaceId: string;
  status: ExperimentStatus;
  startDate: Date | null;
  endDate: Date | null;
};

/**
 * O último instante do dia de `date`, em UTC.
 *
 * `Workspace` não tem timezone, então a fronteira do dia é uma escolha e não um
 * dado. UTC, e errando para o lado de não fechar cedo: um experimento com
 * `endDate` hoje não completa hoje. Quando o timezone por workspace existir,
 * esta função é o único lugar que muda.
 */
function endOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999);
}

/**
 * Para onde este experimento vai agora, ou null se fica onde está.
 *
 * Pura de propósito: `now` entra por parâmetro para o teste poder afirmar a
 * fronteira do dia sem mexer no relógio do processo.
 *
 * O relógio **cumpre** datas declaradas pelo humano; nunca as escreve. Sem
 * `startDate` não há início, e sem `endDate` não há fim — a ausência da data é
 * a ausência da declaração.
 */
export function dueTransition(row: ClockRow, now: Date): ExperimentStatus | null {
  if (row.status === ExperimentStatus.APPROVED) {
    return row.startDate && row.startDate.getTime() <= now.getTime() ? ExperimentStatus.RUNNING : null;
  }

  if (row.status === ExperimentStatus.RUNNING) {
    return row.endDate && now.getTime() > endOfUtcDay(row.endDate) ? ExperimentStatus.COMPLETED : null;
  }

  // PAUSED fora de propósito: pausar tem motivo humano (docs/domains/
  // experiments.md §21), e retomar por relógio apagaria essa decisão.
  return null;
}
```

- [ ] **Step 4: Rode e confirme que passa**

Run: `cd back && npx vitest run src/http/api/experiments/experiments.clock.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 5: Typecheck**

Run: `cd back && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Stage e mostre para aprovação**

```bash
cd back
git add src/http/api/experiments/experiments.clock.ts src/http/api/experiments/experiments.clock.test.ts
git status --short
git diff --cached --stat
```

Mensagem sugerida (só depois do "ok"):

```
feat(experiments): decide by date where an experiment should be

Regra pura, sem Prisma e sem relógio interno: APPROVED com startDate vencida vai
para RUNNING, RUNNING com o dia de endDate inteiro vencido vai para COMPLETED, e
todo o resto fica onde está. Fronteira de dia em UTC, errando para não fechar
cedo — fechar um dia antes corta medição que o fundador contava ter.

Sem data declarada não há transição: o relógio cumpre datas, nunca as escreve.
```

---

## Task 2: Aplicar o relógio no processo do worker

**Files:**
- Modify: `back/src/http/api/experiments/experiments.repository.ts` (adiciona `findDueSystemWide` depois de `findBySourceRun`)
- Create: `back/src/schedule/experiment-clock.ts`
- Create: `back/src/schedule/experiment-clock.test.ts`
- Modify: `back/src/config/env.ts` (junto de `AI_RUN_REAPER_INTERVAL_MS`, linha ~67)
- Modify: `back/src/worker.ts`

**Interfaces:**
- Consumes: `dueTransition`, `ClockRow` da Task 1; `transitionExperimentService({ repo })` de `src/http/api/experiments/experiments.transition.ts`; `createExperimentsRepository(prisma)`.
- Produces:
  - `findDueSystemWide(now: Date, limit?: number)` no `ExperimentsRepository`, devolvendo `{ id, workspaceId, status, startDate, endDate }[]`
  - `export async function tickExperimentClock(deps: ExperimentClockDeps, options?: { now?: Date }): Promise<number>`
  - `export function startExperimentClock(deps: ExperimentClockDeps): NodeJS.Timeout`
  - `export type ExperimentClockDeps = { repo: ExperimentsRepository; logger: ClockLogger }`
  - `export type ClockLogger = { info(obj: object, msg: string): void; error(obj: object, msg: string): void }`

- [ ] **Step 1: Escreva o teste que falha**

`back/src/schedule/experiment-clock.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExperimentStatus } from '@prisma/client';
import { tickExperimentClock } from './experiment-clock.js';

const NOW = new Date('2026-08-10T12:00:00.000Z');

const logger = { info: vi.fn(), error: vi.fn() };

function repoWith(rows: unknown[]) {
  return {
    findDueSystemWide: vi.fn().mockResolvedValue(rows),
    findById: vi.fn(),
    setStatus: vi.fn().mockResolvedValue({}),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('tickExperimentClock', () => {
  it('inicia o aprovado vencido e completa o em execução vencido', async () => {
    const approved = {
      id: 'a1',
      workspaceId: 'ws-1',
      status: ExperimentStatus.APPROVED,
      startDate: new Date('2026-08-09T00:00:00.000Z'),
      endDate: new Date('2026-08-20T00:00:00.000Z'),
    };
    const running = {
      id: 'r1',
      workspaceId: 'ws-2',
      status: ExperimentStatus.RUNNING,
      startDate: new Date('2026-08-01T00:00:00.000Z'),
      endDate: new Date('2026-08-09T00:00:00.000Z'),
    };
    const repo = repoWith([approved, running]);
    // `findById` é o que o transitionExperimentService lê antes de escrever.
    repo.findById.mockImplementation((_ws: string, id: string) =>
      Promise.resolve(id === 'a1' ? approved : running),
    );

    const moved = await tickExperimentClock({ repo: repo as never, logger }, { now: NOW });

    expect(moved).toBe(2);
    expect(repo.setStatus).toHaveBeenNthCalledWith(1, 'a1', ExperimentStatus.RUNNING, {});
    expect(repo.setStatus).toHaveBeenNthCalledWith(2, 'r1', ExperimentStatus.COMPLETED, { completedAt: NOW });
  });

  // O filtro do SQL é mais grosso que a regra do dia (spec §3.4): a decisão
  // pura é a autoridade, e uma linha que a consulta trouxe sem estar vencida
  // não pode virar escrita.
  it('ignora a linha que a consulta trouxe mas a regra não considera vencida', async () => {
    const today = {
      id: 'r2',
      workspaceId: 'ws-1',
      status: ExperimentStatus.RUNNING,
      startDate: new Date('2026-08-01T00:00:00.000Z'),
      endDate: new Date('2026-08-10T00:00:00.000Z'),
    };
    const repo = repoWith([today]);

    const moved = await tickExperimentClock({ repo: repo as never, logger }, { now: NOW });

    expect(moved).toBe(0);
    expect(repo.setStatus).not.toHaveBeenCalled();
    expect(repo.findById).not.toHaveBeenCalled();
  });

  // Um experimento que falha não pode derrubar o tick: o próximo ainda tem de
  // ser tratado. Mesma postura do reconcileDeadRun no worker de runs.
  it('registra a falha de um experimento e segue com os demais', async () => {
    const first = {
      id: 'a1',
      workspaceId: 'ws-1',
      status: ExperimentStatus.APPROVED,
      startDate: new Date('2026-08-01T00:00:00.000Z'),
      endDate: null,
    };
    const second = { ...first, id: 'a2', workspaceId: 'ws-2' };
    const repo = repoWith([first, second]);
    repo.findById.mockImplementation((_ws: string, id: string) =>
      id === 'a1' ? Promise.reject(new Error('database is on fire')) : Promise.resolve(second),
    );

    const moved = await tickExperimentClock({ repo: repo as never, logger }, { now: NOW });

    expect(moved).toBe(1);
    expect(repo.setStatus).toHaveBeenCalledTimes(1);
    expect(repo.setStatus).toHaveBeenCalledWith('a2', ExperimentStatus.RUNNING, {});
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ experimentId: 'a1', to: ExperimentStatus.RUNNING }),
      expect.any(String),
    );
  });

  // O relógio escreve por tenant mesmo lendo system-wide (spec §3.4).
  it('lê cruzando workspaces e escreve com o workspace da linha', async () => {
    const row = {
      id: 'a1',
      workspaceId: 'ws-9',
      status: ExperimentStatus.APPROVED,
      startDate: new Date('2026-08-01T00:00:00.000Z'),
      endDate: null,
    };
    const repo = repoWith([row]);
    repo.findById.mockResolvedValue(row);

    await tickExperimentClock({ repo: repo as never, logger }, { now: NOW });

    expect(repo.findDueSystemWide).toHaveBeenCalledWith(NOW);
    expect(repo.findById).toHaveBeenCalledWith('ws-9', 'a1');
  });

  // A trava contra escrita direta: a transição passa pelo serviço compartilhado,
  // que aplica assertExperimentTransition. Um estado que a tabela não permite
  // vira erro logado, não uma linha atualizada.
  it('não escreve quando a tabela de transições recusa o passo', async () => {
    const row = {
      id: 'a1',
      workspaceId: 'ws-1',
      status: ExperimentStatus.APPROVED,
      startDate: new Date('2026-08-01T00:00:00.000Z'),
      endDate: null,
    };
    const repo = repoWith([row]);
    // O que o banco realmente tem já mudou desde a leitura: cancelado no meio.
    repo.findById.mockResolvedValue({ ...row, status: ExperimentStatus.CANCELLED });

    const moved = await tickExperimentClock({ repo: repo as never, logger }, { now: NOW });

    expect(moved).toBe(0);
    expect(repo.setStatus).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd back && npx vitest run src/schedule/experiment-clock.test.ts`
Expected: FAIL — `Failed to resolve import "./experiment-clock.js"`.

- [ ] **Step 3: Acrescente `findDueSystemWide` ao repositório**

Em `back/src/http/api/experiments/experiments.repository.ts`, depois de `findBySourceRun` (linha 51) e antes de `create`:

```ts
    /**
     * Os experimentos que podem estar com a data vencida, em TODOS os
     * workspaces.
     *
     * Esta é a segunda função do sistema sem escopo de tenant — a primeira é
     * `reapStaleRuns`. O relógio não roda dentro de uma requisição: não há
     * `req.tenant` de onde tirar o workspace, e um relógio por workspace só
     * andaria para quem estivesse com a tela aberta, que é exatamente o
     * problema. A leitura cruza; a escrita continua por tenant, com o
     * `workspaceId` da própria linha.
     *
     * O filtro de data aqui é deliberadamente mais grosso que a regra: quem
     * decide é `dueTransition`, que conhece a fronteira do dia. Este `where`
     * só evita trazer a tabela inteira.
     */
    findDueSystemWide(now: Date, limit = 200) {
      return prisma.experiment.findMany({
        where: {
          OR: [
            { status: ExperimentStatus.APPROVED, startDate: { lte: now } },
            { status: ExperimentStatus.RUNNING, endDate: { lt: now } },
          ],
        },
        // Mais antigos primeiro: com mais linhas vencidas que `limit`, quem
        // espera há mais tempo sai na frente, e o tick seguinte pega o resto.
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: limit,
        select: { id: true, workspaceId: true, status: true, startDate: true, endDate: true },
      });
    },
```

- [ ] **Step 4: Implemente o scheduler**

`back/src/schedule/experiment-clock.ts`:

```ts
import { ExperimentStatus } from '@prisma/client';
import { env } from '../config/env.js';
import { dueTransition } from '../http/api/experiments/experiments.clock.js';
import type { ExperimentsRepository } from '../http/api/experiments/experiments.repository.js';
import { transitionExperimentService } from '../http/api/experiments/experiments.transition.js';

/** O mesmo contrato de log que o worker de runs usa: `info`/`error` sobre um objeto. */
export type ClockLogger = { info(obj: object, msg: string): void; error(obj: object, msg: string): void };

export type ExperimentClockDeps = { repo: ExperimentsRepository; logger: ClockLogger };

/**
 * Cumpre as datas que venceram, uma passada.
 *
 * Escreve pelo `transitionExperimentService` — o mesmo serviço dos botões — e
 * portanto passa por `assertExperimentTransition`. O relógio não pode fazer um
 * movimento que um humano não poderia, e não é um segundo caminho de escrita
 * livre para divergir da tabela de transições.
 *
 * Devolve quantos moveu, para o log só falar quando houve o que dizer.
 */
export async function tickExperimentClock(
  deps: ExperimentClockDeps,
  options: { now?: Date } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const due = await deps.repo.findDueSystemWide(now);
  const transition = transitionExperimentService({ repo: deps.repo });

  let moved = 0;

  for (const row of due) {
    const to = dueTransition(row, now);
    if (!to) continue;

    try {
      await transition({
        workspaceId: row.workspaceId,
        id: row.id,
        to,
        // `endDate` não é escrita aqui, ao contrário de complete-experiment,
        // que faz backfill quando o fundador completa à mão sem data: o
        // relógio só completa quem já tem `endDate`, então não há o que
        // preencher — e preencher seria inventar a data.
        extra: () => (to === ExperimentStatus.COMPLETED ? { completedAt: now } : {}),
      });
      moved++;
    } catch (error) {
      // Uma linha que falha não derruba a passada: o experimento pode ter sido
      // cancelado entre a leitura e a escrita, e o próximo tick reavalia.
      deps.logger.error(
        { experimentId: row.id, workspaceId: row.workspaceId, to, err: error },
        'the experiment clock could not move an experiment',
      );
    }
  }

  return moved;
}

/**
 * Roda o relógio no boot e em intervalo fixo. `unref` para não segurar o
 * processo aberto no desligamento — mesmo padrão de `startStaleRunReaper`.
 *
 * Idempotente por construção: a consulta é por status e data, não por evento.
 * Worker fora do ar significa transição atrasada, nunca perdida.
 */
export function startExperimentClock(deps: ExperimentClockDeps): NodeJS.Timeout {
  const tick = async (): Promise<void> => {
    try {
      const moved = await tickExperimentClock(deps);
      if (moved > 0) deps.logger.info({ moved }, 'the experiment clock moved experiments whose dates came due');
    } catch (error) {
      deps.logger.error({ err: error }, 'the experiment clock failed');
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), env.EXPERIMENT_CLOCK_INTERVAL_MS);
  timer.unref();
  return timer;
}
```

- [ ] **Step 5: Acrescente a variável de ambiente**

Em `back/src/config/env.ts`, imediatamente depois da linha `AI_RUN_REAPER_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),`:

```ts
  // O relógio dos experimentos. Granularidade de dia não precisa de mais: a
  // decisão compara datas, e atrasar quinze minutos é invisível para quem
  // declarou a duração em dias.
  EXPERIMENT_CLOCK_INTERVAL_MS: z.coerce.number().int().positive().default(900_000),
```

- [ ] **Step 6: Suba o relógio no worker**

Em `back/src/worker.ts`:

1. Nos imports, depois de `import { createWorkerDeps } from './ai/queue/worker-deps.js';`:

```ts
import { startExperimentClock } from './schedule/experiment-clock.js';
import { createExperimentsRepository } from './http/api/experiments/experiments.repository.js';
```

2. Depois de `const reaper = startStaleRunReaper(deps);`:

```ts
// O relógio de domínio vive no mesmo processo do worker, e não na API, pela
// mesma razão que o reaper: a API reinicia a cada deploy, e um intervalo que
// morre a cada deploy não é um relógio.
const clock = startExperimentClock({ repo: createExperimentsRepository(prisma), logger });
```

3. No `shutdown`, ao lado de `clearInterval(reaper);`:

```ts
  clearInterval(clock);
```

- [ ] **Step 7: Rode os testes e o typecheck**

Run: `cd back && npx vitest run src/schedule/experiment-clock.test.ts src/http/api/experiments/ && npx tsc --noEmit; echo "EXIT=$?"`
Expected: todos PASS, `EXIT=0`.

- [ ] **Step 8: Rode a suíte inteira**

Run: `cd back && npx vitest run 2>&1 | tail -6`
Expected: nenhuma falha nova (baseline: 947 passando antes desta task).

- [ ] **Step 9: Stage e mostre para aprovação**

```bash
cd back
git add src/schedule/ src/http/api/experiments/experiments.repository.ts src/config/env.ts src/worker.ts
git status --short
git diff --cached --stat
```

Mensagem sugerida (só depois do "ok"):

```
feat(experiments): let the declared dates move the experiment

O relógio roda no processo do worker, no mesmo padrão do reaper de runs
(setInterval + unref, 15 min por default), e aplica a decisão pura pelo mesmo
transitionExperimentService que os botões usam — não é um segundo caminho de
escrita livre para divergir da tabela de transições.

findDueSystemWide é a segunda função sem escopo de tenant do sistema, e por isso
tem nome explícito e teste que afirma o cruzamento: o relógio não roda dentro de
uma requisição, então lê cruzando workspaces e escreve com o workspaceId da
própria linha. Uma linha que falha é logada e a passada continua.
```

---

## Task 3: Medição pendente no dashboard

**Files:**
- Modify: `back/src/http/api/dashboard/dashboard.schema.ts`
- Modify: `back/src/http/api/dashboard/dashboard.repository.ts` (novo método depois de `recentSources`)
- Modify: `back/src/http/api/dashboard/get-dashboard/get-dashboard.service.ts`
- Test: `back/src/http/api/dashboard/get-dashboard/get-dashboard.test.ts`

**Interfaces:**
- Consumes: `createDashboardRepository(prisma)`, `getDashboardService({ repo })`.
- Produces:
  - `dashboardPendingMeasurement` (Zod) com `{ experimentId: string; name: string; metric: string; endDate: Date | null }`
  - campo `pendingMeasurement: { count: number; items: DashboardPendingMeasurement[] }` em `dashboardResponse`
  - `pendingMeasurement(workspaceId: string)` no `DashboardRepository`, devolvendo `{ count, items }`
  - `export type DashboardPendingMeasurement = z.infer<typeof dashboardPendingMeasurement>`

- [ ] **Step 1: Escreva o teste que falha**

O arquivo já tem os helpers `prismaFake(overrides)` e `buildApp(prisma, role)` e a constante `WORKSPACE_ID` (linhas 8-47). Não invente helpers novos: acrescente o helper local abaixo e o `describe` ao fim do arquivo.

```ts
type PendingRow = { id: string; name: string; metric: string; endDate: Date | null };

/**
 * `experiment.count` e `experiment.findMany` são usados por duas perguntas
 * diferentes — o snapshot conta experimentos sem filtro de status e lista os
 * recentes; a medição pendente conta e lista COMPLETED sem outcome. Uma
 * implementação só, ramificando pelo `where`, mantém os dois significados em vez
 * de fazer um valor fixo responder pelos dois.
 */
function pendingPrisma(count: number, rows: PendingRow[]) {
  const isPending = (args: { where?: { status?: string } } | undefined) => args?.where?.status === 'COMPLETED';
  return prismaFake({
    experiment: {
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockImplementation((args) => Promise.resolve(isPending(args) ? count : 0)),
      findMany: vi.fn().mockImplementation((args) => Promise.resolve(isPending(args) ? rows : [])),
    },
  });
}

describe('GET /dashboard — medição pendente', () => {
  // Um experimento COMPLETED sem nenhum outcome é o loop parado esperando o
  // fundador: o relógio já fechou o teste e o número não chegou.
  it('conta os experimentos completados que ainda não têm número', async () => {
    const prisma = pendingPrisma(3, [
      { id: 'e1', name: 'Landing A/B', metric: 'conversion_rate', endDate: new Date('2026-08-01T00:00:00.000Z') },
    ]);
    const app = await buildApp(prisma);

    const res = await app.inject({ method: 'GET', url: '/dashboard' });

    expect(res.statusCode).toBe(200);
    expect(res.json().pendingMeasurement.count).toBe(3);
    expect(res.json().pendingMeasurement.items).toEqual([
      {
        experimentId: 'e1',
        name: 'Landing A/B',
        metric: 'conversion_rate',
        endDate: '2026-08-01T00:00:00.000Z',
      },
    ]);
  });

  // `count` carrega a verdade e `items` é uma janela: um corte silencioso leria
  // como "é só isso" (spec §4.2).
  it('devolve a contagem real ao lado da janela de itens', async () => {
    const rows: PendingRow[] = Array.from({ length: 5 }, (_, i) => ({
      id: `e${i}`,
      name: `Teste ${i}`,
      metric: 'signups',
      endDate: null,
    }));
    const app = await buildApp(pendingPrisma(12, rows));

    const res = await app.inject({ method: 'GET', url: '/dashboard' });

    expect(res.json().pendingMeasurement.count).toBe(12);
    expect(res.json().pendingMeasurement.items).toHaveLength(5);
  });

  it('devolve zero e lista vazia quando nada está esperando número', async () => {
    const app = await buildApp(prismaFake());

    const res = await app.inject({ method: 'GET', url: '/dashboard' });

    expect(res.json().pendingMeasurement).toEqual({ count: 0, items: [] });
  });

  // Sem o filtro de outcomes, um experimento já medido continuaria sendo
  // cobrado; sem o workspace, o dashboard mostraria o experimento de outro
  // cliente. O `take: 5` entra na mesma asserção porque é o que sustenta o
  // "+N" da tela.
  it('pergunta pelos completados sem outcome, dentro do workspace', async () => {
    const prisma = pendingPrisma(0, []);
    const app = await buildApp(prisma);

    await app.inject({ method: 'GET', url: '/dashboard' });

    const where = { workspaceId: WORKSPACE_ID, status: 'COMPLETED', outcomes: { none: {} } };
    expect(prisma.experiment.count).toHaveBeenCalledWith({ where });
    expect(prisma.experiment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, take: 5 }));
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd back && npx vitest run src/http/api/dashboard/`
Expected: FAIL — `pendingMeasurement` é `undefined`.

- [ ] **Step 3: Acrescente o schema**

Em `back/src/http/api/dashboard/dashboard.schema.ts`, depois de `dashboardRailEntry` (linha 91):

```ts
/**
 * Um experimento cujo teste terminou e cujo número não chegou.
 *
 * Sem prosa e sem url, como o resto deste schema: a cópia é do frontend (três
 * locales) e a rota é do React Router.
 */
export const dashboardPendingMeasurement = z.object({
  experimentId: z.string(),
  name: z.string(),
  metric: z.string(),
  endDate: z.date().nullable(),
});
```

E, dentro de `dashboardResponse`, depois de `recent`:

```ts
  // `count` é a contagem real e `items` uma janela de cinco: a tela diz "+3" a
  // partir da diferença em vez de fingir que a lista é tudo.
  pendingMeasurement: z.object({
    count: z.number().int(),
    items: z.array(dashboardPendingMeasurement),
  }),
```

E, no bloco de tipos ao final do arquivo:

```ts
export type DashboardPendingMeasurement = z.infer<typeof dashboardPendingMeasurement>;
```

- [ ] **Step 4: Acrescente a consulta**

Em `back/src/http/api/dashboard/dashboard.repository.ts`, depois de `recentSources` e antes do fechamento do objeto:

```ts
    /**
     * O que está esperando o número: completado, e sem um único outcome.
     *
     * Uma definição só. O relógio garante que o experimento chega aqui na data
     * que o fundador declarou, e um experimento completado à mão sem número cai
     * na mesma lista — o problema é o mesmo.
     */
    async pendingMeasurement(workspaceId: string) {
      const where = {
        workspaceId,
        status: ExperimentStatus.COMPLETED,
        outcomes: { none: {} },
      } as const;

      const [count, rows] = await Promise.all([
        prisma.experiment.count({ where }),
        prisma.experiment.findMany({
          where,
          // Quem venceu primeiro cobra primeiro. Nulos ao fim porque um
          // experimento completado à mão pode não ter data; `id` desempata
          // para a resposta ser determinística.
          orderBy: [{ endDate: { sort: 'asc', nulls: 'last' } }, { completedAt: 'asc' }, { id: 'asc' }],
          take: 5,
          select: { id: true, name: true, metric: true, endDate: true },
        }),
      ]);

      return {
        count,
        items: rows.map((row) => ({
          experimentId: row.id,
          name: row.name,
          metric: row.metric,
          endDate: row.endDate,
        })),
      };
    },
```

- [ ] **Step 5: Inclua na resposta**

Em `back/src/http/api/dashboard/get-dashboard/get-dashboard.service.ts`, troque o `Promise.all` e o `return`:

```ts
    // A cobrança vale mesmo com o setup incompleto? Não: sem experimento não há
    // medição pendente, e a consulta devolve zero de graça. Fica no mesmo
    // Promise.all para não somar uma ida ao banco em série.
    const [recentSources, loopContext, pendingMeasurement] = await Promise.all([
      deps.repo.recentSources(input.workspaceId),
      isSetupComplete(snapshot) ? deps.repo.loopContext(input.workspaceId, snapshot.spine) : null,
      deps.repo.pendingMeasurement(input.workspaceId),
    ]);
```

E, no objeto retornado, depois de `recent: buildRecent(recentSources),`:

```ts
      pendingMeasurement,
```

- [ ] **Step 6: Rode os testes e o typecheck**

Run: `cd back && npx vitest run src/http/api/dashboard/ && npx tsc --noEmit; echo "EXIT=$?"`
Expected: PASS, `EXIT=0`.

- [ ] **Step 7: Regenere o contrato**

Run: `cd back && npx pnpm openapi:dump` (ou `pnpm openapi:dump`)
Expected: `../web/api.json` atualizado com `pendingMeasurement` em `getDashboard`.

- [ ] **Step 8: Stage e mostre para aprovação**

```bash
cd back
git add src/http/api/dashboard/
git status --short
git diff --cached --stat
cd ../web && git add api.json && git status --short
```

Mensagem sugerida (só depois do "ok"):

```
feat(dashboard): say how many experiments are waiting for their number

Completado com zero outcomes é o loop parado esperando o fundador. O dashboard
já é o agregador do estado do loop, então a pergunta fica nele e não numa rota
nova que a dividiria em dois lugares.

count é a contagem real, items uma janela de cinco ordenada por endDate com
nulos ao fim — a tela diz "+3" a partir da diferença em vez de fingir que a
lista é tudo.
```

---

## Task 4: Gravar o número dispara a interpretação

**Files:**
- Modify: `back/src/http/api/outcomes/outcomes.schema.ts`
- Modify: `back/src/http/api/outcomes/create-outcome/create-outcome.service.ts`
- Modify: `back/src/http/api/outcomes/create-outcome/create-outcome.controller.ts`
- Test: `back/src/http/api/outcomes/create-outcome/create-outcome.service.test.ts` **(criar)** — o disparo é regra de serviço, e testá-lo aqui não exige montar a fila nem o Prisma inteiro
- Test: `back/src/http/api/outcomes/outcomes.test.ts` **(ajustar fixtures)** — o corpo da resposta ganhou `interpretation`; o controller monta o `createAgentRunService` real, que sobre o Prisma mockado do arquivo vai recusar o disparo e devolver `{ agentRunId: null, reason }`. Isso é o comportamento correto e não quebra o 201. **Não troque asserções existentes**; se alguma comparava o corpo inteiro por igualdade, acrescente o campo novo à expectativa

**Interfaces:**
- Consumes: `createAgentRunService({ repo, enqueue, prisma })` de `src/http/api/agent-runs/create-agent-run/create-agent-run.service.ts`, `createAgentRunRepository`, `enqueueAgentRun`, `interpretOutcomeAgent.taskType` (`'interpret-outcome'`), `presentOutcome`.
- Produces:
  - `outcomeInterpretation` (Zod): `{ agentRunId: string | null; reason: string | null }`
  - `outcomeCreatedResponse` (Zod): `{ outcome, interpretation }`
  - `CreateOutcomeDeps` ganha `startRun(args: { tenant: TenantContext; taskType: string; input: unknown }): Promise<{ id: string }>`
  - o serviço passa a devolver `{ outcome, interpretation }`

- [ ] **Step 1: Escreva o teste que falha**

Crie `back/src/http/api/outcomes/create-outcome/create-outcome.service.test.ts`. O serviço recebe `startRun` por injeção, então o teste não monta fila nem HTTP:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createOutcomeService } from './create-outcome.service.js';

const EXPERIMENT = {
  id: 'exp-1',
  metric: 'conversion_rate',
  baselineValue: 4.2,
  targetValue: 6,
};

const ROW = {
  id: 'out-1',
  workspaceId: 'ws-1',
  experimentId: 'exp-1',
  metric: 'conversion_rate',
  value: 6.1,
  unit: '%',
  observedAt: new Date('2026-08-11T00:00:00.000Z'),
  source: 'USER',
  createdAt: new Date('2026-08-11T00:00:00.000Z'),
  updatedAt: new Date('2026-08-11T00:00:00.000Z'),
};

const TENANT = { userId: 'u1', organizationId: 'org-1', workspaceId: 'ws-1', role: 'MEMBER' as const };

function deps(startRun: ReturnType<typeof vi.fn>) {
  return {
    repo: {
      experimentInWorkspace: vi.fn().mockResolvedValue(EXPERIMENT),
      create: vi.fn().mockResolvedValue(ROW),
    } as never,
    startRun,
  };
}

describe('createOutcomeService — interpretação', () => {
  it('enfileira a interpretação do experimento depois de gravar o número', async () => {
    const startRun = vi.fn().mockResolvedValue({ id: 'run-1' });
    const service = createOutcomeService(deps(startRun));

    const result = await service({ value: 6.1, workspaceId: 'ws-1', experimentId: 'exp-1', tenant: TENANT });

    expect(result.interpretation).toEqual({ agentRunId: 'run-1', reason: null });
    expect(startRun).toHaveBeenCalledWith({
      tenant: TENANT,
      taskType: 'interpret-outcome',
      input: { experimentId: 'exp-1' },
    });
  });

  // A medição é fato observado; o faturamento não pode apagá-la. Saldo curto
  // devolve o número gravado e a razão, nunca uma exceção (spec §5.1).
  it('mantém o número gravado quando o disparo é recusado', async () => {
    const startRun = vi.fn().mockRejectedValue(new Error('Insufficient credits'));
    const d = deps(startRun);
    const service = createOutcomeService(d);

    const result = await service({ value: 6.1, workspaceId: 'ws-1', experimentId: 'exp-1', tenant: TENANT });

    expect(result.outcome.value).toBe(6.1);
    expect(result.interpretation).toEqual({ agentRunId: null, reason: 'Insufficient credits' });
    expect(d.repo.create).toHaveBeenCalled();
  });

  // Ordem obrigatória: gravar, depois disparar. Se o disparo viesse primeiro,
  // uma falha de escrita deixaria um run pago sobre um número que não existe.
  it('grava antes de disparar', async () => {
    const order: string[] = [];
    const startRun = vi.fn().mockImplementation(() => {
      order.push('start');
      return Promise.resolve({ id: 'run-1' });
    });
    const d = deps(startRun);
    (d.repo as unknown as { create: ReturnType<typeof vi.fn> }).create.mockImplementation(() => {
      order.push('create');
      return Promise.resolve(ROW);
    });

    await createOutcomeService(d)({ value: 6.1, workspaceId: 'ws-1', experimentId: 'exp-1', tenant: TENANT });

    expect(order).toEqual(['create', 'start']);
  });

  it('continua recusando uma observação no futuro, sem disparar nada', async () => {
    const startRun = vi.fn();
    const service = createOutcomeService(deps(startRun));

    await expect(
      service({
        value: 6.1,
        workspaceId: 'ws-1',
        experimentId: 'exp-1',
        tenant: TENANT,
        observedAt: new Date('2027-01-01T00:00:00.000Z'),
        now: new Date('2026-08-11T00:00:00.000Z'),
      }),
    ).rejects.toThrow(/future/i);
    expect(startRun).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd back && npx vitest run src/http/api/outcomes/`
Expected: FAIL — o serviço não aceita `startRun` nem devolve `interpretation`.

- [ ] **Step 3: Acrescente os schemas**

Em `back/src/http/api/outcomes/outcomes.schema.ts`, depois de `outcomeResponse`:

```ts
/**
 * O que aconteceu com a interpretação que gravar o número dispara.
 *
 * Ambos nuláveis porque o disparo é melhor-esforço: `agentRunId` quando entrou
 * na fila, `reason` quando não entrou. O número está gravado nos dois casos —
 * a medição é fato observado, e o faturamento não pode apagá-la.
 */
export const outcomeInterpretation = z.object({
  agentRunId: z.string().uuid().nullable(),
  reason: z.string().nullable(),
});

export const outcomeCreatedResponse = z.object({
  outcome: outcomeSchema,
  interpretation: outcomeInterpretation,
});
```

- [ ] **Step 4: Implemente o serviço**

Substitua `back/src/http/api/outcomes/create-outcome/create-outcome.service.ts` por:

```ts
import { BadRequestError, NotFoundError } from '../../../../lib/errors.js';
import { interpretOutcomeAgent } from '../../../../ai/agents/interpret-outcome.js';
import type { TenantContext } from '../../../../lib/tenant.js';
import type { OutcomesRepository } from '../outcomes.repository.js';
import { presentOutcome } from '../outcomes.presenter.js';
import type { OutcomeCreateBody } from './create-outcome.schema.js';

export type CreateOutcomeDeps = {
  repo: OutcomesRepository;
  /**
   * O serviço de criação de run, injetado. É ele que valida input, roda o
   * precheck, cobra e deduplica — reimplementar aqui seria um segundo caminho
   * de cobrança livre para divergir.
   */
  startRun(args: { tenant: TenantContext; taskType: string; input: unknown }): Promise<{ id: string }>;
};

export function createOutcomeService(deps: CreateOutcomeDeps) {
  return async (
    input: OutcomeCreateBody & { workspaceId: string; experimentId: string; tenant: TenantContext; now?: Date },
  ) => {
    const { workspaceId, experimentId, tenant, now = new Date(), ...body } = input;

    const experiment = await deps.repo.experimentInWorkspace(workspaceId, experimentId);
    if (!experiment) throw new NotFoundError('Experiment not found');

    // A measurement dated in the future has not been observed yet, so recording
    // it as an observation would be a claim about something that has not
    // happened.
    if (body.observedAt && body.observedAt.getTime() > now.getTime()) {
      throw new BadRequestError('An outcome cannot be observed in the future');
    }

    const row = await deps.repo.create(workspaceId, {
      experimentId,
      // Defaults to what the experiment measures: an outcome on a different
      // metric cannot be read against the experiment's baseline and target.
      metric: body.metric ?? experiment.metric,
      value: body.value,
      unit: body.unit,
      observedAt: body.observedAt,
      // Provenance for a hand-entered number. Left explicit rather than relying
      // on the column default so the value is visible where it is decided.
      source: 'USER',
    });

    // Depois de gravado, e só depois. O número é fato observado; um saldo curto
    // não pode custar a medição. Por isso o disparo é melhor-esforço e a recusa
    // volta nomeada, com retry na tela, em vez de virar exceção sobre um
    // outcome que já merece o 201.
    //
    // A deduplicação por `interpret-outcome:<hash de {experimentId}>` só olha
    // runs PENDING/RUNNING, então dois números gravados quase juntos
    // reaproveitam o run em voo — uma interpretação sobre os resultados atuais,
    // não duas — e um número gravado depois de a interpretação anterior ter
    // completado dispara um run novo.
    let interpretation: { agentRunId: string | null; reason: string | null } = { agentRunId: null, reason: null };
    try {
      const run = await deps.startRun({
        tenant,
        taskType: interpretOutcomeAgent.taskType,
        input: { experimentId },
      });
      interpretation = { agentRunId: run.id, reason: null };
    } catch (error) {
      interpretation = {
        agentRunId: null,
        reason: error instanceof Error ? error.message : 'unknown error',
      };
    }

    return {
      // Returned already read against the experiment's baseline and target, so
      // the number the caller just recorded comes back with its comparison.
      outcome: presentOutcome(row, {
        baselineValue: experiment.baselineValue,
        targetValue: experiment.targetValue,
      }),
      interpretation,
    };
  };
}
```

- [ ] **Step 5: Implemente o controller**

Substitua `back/src/http/api/outcomes/create-outcome/create-outcome.controller.ts` por:

```ts
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createAgentRunRepository } from '../../../../ai/agent-run/agent-run.repository.js';
import { createAgentRunService } from '../../agent-runs/create-agent-run/create-agent-run.service.js';
import { enqueueAgentRun } from '../../../../ai/queue/queue.js';
import { createOutcomesRepository } from '../outcomes.repository.js';
import { experimentIdParam, outcomeCreatedResponse } from '../outcomes.schema.js';
import { outcomeCreateBody } from './create-outcome.schema.js';
import { createOutcomeService } from './create-outcome.service.js';

export const createOutcomeRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/experiments/:id/outcomes',
    {
      schema: {
        tags: ['outcomes'],
        operationId: 'createOutcome',
        params: experimentIdParam,
        body: outcomeCreateBody,
        response: { 201: outcomeCreatedResponse },
      },
    },
    async (req, reply) => {
      // Mesmo serviço de criação de run que plan-experiments usa: input
      // validado, precheck, cobrança e deduplicação num só lugar.
      const startRun = createAgentRunService({
        repo: createAgentRunRepository(app.prisma),
        enqueue: enqueueAgentRun,
        prisma: app.prisma,
      });

      const service = createOutcomeService({ repo: createOutcomesRepository(app.prisma), startRun });
      const result = await service({
        ...req.body,
        workspaceId: req.tenant.workspaceId,
        experimentId: req.params.id,
        tenant: req.tenant,
      });

      return reply.code(201).send(result);
    },
  );
};
```

- [ ] **Step 6: Rode os testes e o typecheck**

Run: `cd back && npx vitest run src/http/api/outcomes/ src/http/api/write-guard.test.ts && npx tsc --noEmit; echo "EXIT=$?"`
Expected: PASS, `EXIT=0`. O `write-guard.test.ts` já cobre `POST /experiments/:id/outcomes` (linha 111) — se ele quebrar, o motivo é a forma da resposta, não a permissão.

- [ ] **Step 7: Rode a suíte inteira e regenere o contrato**

Run: `cd back && npx vitest run 2>&1 | tail -6 && pnpm openapi:dump`
Expected: nenhuma falha nova; `../web/api.json` com `interpretation` em `createOutcome`.

- [ ] **Step 8: Stage e mostre para aprovação**

```bash
cd back
git add src/http/api/outcomes/
git status --short
git diff --cached --stat
cd ../web && git add api.json && git status --short
```

Mensagem sugerida (só depois do "ok"):

```
feat(outcomes): interpret the experiment as soon as the number lands

Gravar a medição enfileira interpret-outcome no mesmo pedido, pelo mesmo serviço
de criação de run que plan-experiments usa — input validado, precheck, cobrança e
deduplicação num lugar só.

Ordem obrigatória: o outcome commita primeiro. A medição é fato observado e o
faturamento não pode apagá-la, então saldo curto devolve
{ agentRunId: null, reason } com o número gravado, e o retry fica na tela. A
deduplicação só olha runs PENDING/RUNNING, então dois números quase juntos
reaproveitam o run em voo e um número depois da interpretação anterior dispara
um novo.
```

---

## Task 5: Cobrança na tela — card no dashboard e badge na nav

**Files:**
- Create: `web/src/components/dashboard/PendingMeasurementCard.tsx`
- Create: `web/src/components/dashboard/PendingMeasurementCard.test.tsx`
- Modify: `web/src/pages/DashboardPage.tsx`
- Modify: `web/src/components/AppLayout.tsx`
- Modify: `web/src/locales/pt.json`, `web/src/locales/en.json`, `web/src/locales/es.json`

**Interfaces:**
- Consumes: `useGetDashboard` (`@/api/generated/hooks/dashboardHooks/useGetDashboard`) — a resposta ganhou `pendingMeasurement: { count: number; items: { experimentId: string; name: string; metric: string; endDate: Date | null }[] }` na Task 3.
- Produces:
  - `export type PendingMeasurementItem = { experimentId: string; name: string; metric: string; endDate: string | null }`
  - `export function PendingMeasurementCard({ count, items }: { count: number; items: PendingMeasurementItem[] })`

- [ ] **Step 1: Escreva o teste que falha**

`web/src/components/dashboard/PendingMeasurementCard.test.tsx`. Use `renderWithProviders` de `@/test/render` (é ele que traz i18n e router) e asserte com `i18n.t(...)`, como fazem os testes vizinhos — não compare contra a chave crua:

```tsx
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/render';
import { PendingMeasurementCard, type PendingMeasurementItem } from './PendingMeasurementCard';

const item = (over: Partial<PendingMeasurementItem> = {}): PendingMeasurementItem => ({
  experimentId: 'e1',
  name: 'Landing A/B',
  metric: 'conversion_rate',
  endDate: '2026-08-01T00:00:00.000Z',
  ...over,
});

describe('PendingMeasurementCard', () => {
  it('nomeia cada teste que está esperando o número, com link para medi-lo', () => {
    renderWithProviders(<PendingMeasurementCard count={1} items={[item()]} />);

    expect(screen.getByRole('link', { name: 'Landing A/B' })).toHaveAttribute('href', '/app/experiments/e1');
  });

  // `count` é a contagem real e `items` uma janela: sem o "+N" a tela leria
  // como se a lista fosse tudo.
  it('diz quantos ficaram fora da lista', () => {
    const items = Array.from({ length: 5 }, (_, i) => item({ experimentId: `e${i}`, name: `Teste ${i}` }));

    renderWithProviders(<PendingMeasurementCard count={8} items={items} />);

    expect(screen.getByText(i18n.t('app.dashboard.pendingMeasurement.more', { count: 3 }))).toBeInTheDocument();
  });

  it('não renderiza nada quando nada está esperando', () => {
    const { container } = renderWithProviders(<PendingMeasurementCard count={0} items={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd web && npx vitest run src/components/dashboard/PendingMeasurementCard.test.tsx`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implemente o card**

`web/src/components/dashboard/PendingMeasurementCard.tsx`:

```tsx
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import { Help } from '@/components/Help';
import { Card, CardContent } from '@/components/ui/card';

/**
 * Um teste que terminou e cujo número não chegou. `endDate` é string porque a
 * resposta chega como ISO — o Kubb tipa `Date` a partir do `date-time` do
 * OpenAPI, mas nada aqui recebe uma instância viva (mesmo fato que
 * `NextActionCard` e `LoopPanel` documentam).
 */
export type PendingMeasurementItem = {
  experimentId: string;
  name: string;
  metric: string;
  endDate: string | null;
};

/**
 * O que o loop está esperando do fundador.
 *
 * Sem veredito e sem cor de resultado: um teste sem número não é um teste que
 * deu errado, é um teste que ninguém leu ainda.
 */
export function PendingMeasurementCard({ count, items }: { count: number; items: PendingMeasurementItem[] }) {
  const { t, i18n } = useTranslation();

  if (count === 0) return null;

  const hidden = count - items.length;
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(new Date(value));

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <p className="text-sm font-medium">
          <FlaskConical className="mr-2 inline size-4" aria-hidden />
          {t('app.dashboard.pendingMeasurement.title', { count })}
          <Help title={t('app.dashboard.pendingMeasurement.helpTitle')}>
            {t('app.dashboard.pendingMeasurement.help')}
          </Help>
        </p>

        <ul className="space-y-2">
          {items.map((entry) => (
            <li key={entry.experimentId} className="text-sm">
              <Link
                to={`/app/experiments/${entry.experimentId}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {entry.name}
              </Link>
              <span className="text-muted-foreground">
                {' · '}
                {entry.metric}
                {entry.endDate && ` · ${t('app.dashboard.pendingMeasurement.ended', { date: formatDate(entry.endDate) })}`}
              </span>
            </li>
          ))}
        </ul>

        {hidden > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('app.dashboard.pendingMeasurement.more', { count: hidden })}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Acrescente as chaves de i18n**

Em `web/src/locales/pt.json`, dentro de `app.dashboard`:

```json
"pendingMeasurement": {
  "title": "{{count}} teste esperando o número",
  "title_other": "{{count}} testes esperando o número",
  "helpTitle": "Por que isto aparece",
  "help": "O teste chegou ao fim da duração que você definiu. AUREA não inventa o resultado: o número vem de você, e é ele que permite comparar com o ponto de partida e a meta.",
  "ended": "terminou em {{date}}",
  "more": "+{{count}} além destes",
  "badge": "{{count}} esperando o número"
},
```

`en.json`:

```json
"pendingMeasurement": {
  "title": "{{count}} experiment waiting for its number",
  "title_other": "{{count}} experiments waiting for their number",
  "helpTitle": "Why this is here",
  "help": "The experiment reached the end of the duration you set. AUREA does not invent the result: the number comes from you, and it is what makes the comparison against the baseline and the target possible.",
  "ended": "ended on {{date}}",
  "more": "+{{count}} more",
  "badge": "{{count}} waiting for a number"
},
```

`es.json`:

```json
"pendingMeasurement": {
  "title": "{{count}} experimento esperando su número",
  "title_other": "{{count}} experimentos esperando su número",
  "helpTitle": "Por qué aparece esto",
  "help": "El experimento llegó al final de la duración que definiste. AUREA no inventa el resultado: el número lo aportas tú, y es lo que permite comparar con el punto de partida y la meta.",
  "ended": "terminó el {{date}}",
  "more": "+{{count}} más",
  "badge": "{{count}} esperando número"
},
```

- [ ] **Step 5: Renderize no dashboard**

Em `web/src/pages/DashboardPage.tsx`:

1. Import, depois de `RecentActivity`:

```tsx
import { PendingMeasurementCard, type PendingMeasurementItem } from '../components/dashboard/PendingMeasurementCard';
```

2. Depois das narrowings existentes (`loopNarrowed`), acrescente:

```tsx
  // Mesma ponte `unknown` das outras datas: o campo chega como ISO string
  // apesar de o Kubb tipar `Date`.
  const pendingItems: PendingMeasurementItem[] = dashboard.data.pendingMeasurement.items.map((entry) => ({
    ...entry,
    endDate: entry.endDate as unknown as string | null,
  }));
```

3. No JSX, imediatamente **acima** do `NextActionCard` (a cobrança vem antes do próximo passo genérico: um número faltando é mais urgente que uma sugestão):

```tsx
        <PendingMeasurementCard count={dashboard.data.pendingMeasurement.count} items={pendingItems} />
```

- [ ] **Step 6: Badge na nav**

Em `web/src/components/AppLayout.tsx`:

1. Import, depois de `useAgentRunEvents`:

```tsx
import { useGetDashboard } from '@/api/generated/hooks/dashboardHooks/useGetDashboard';
```

2. Dentro de `AppLayout`, depois de `useAgentRunEvents();`:

```tsx
  // O mesmo dado do card do dashboard, e a mesma query: o React Query dedupe as
  // duas chamadas. O badge existe para o fundador que entra direto em outra
  // tela — que é justamente quem não veria a cobrança.
  const dashboard = useGetDashboard();
  const pendingMeasurement = dashboard.data?.pendingMeasurement.count ?? 0;
```

3. No `nav.map` do sidebar desktop, troque o `<span>` do número pelo bloco abaixo (mantendo o número quando não há pendência, para a coluna não piscar):

```tsx
                {key === 'experiments' && pendingMeasurement > 0 ? (
                  <span
                    className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 font-mono text-[10px] text-foreground"
                    title={t('app.dashboard.pendingMeasurement.badge', { count: pendingMeasurement })}
                  >
                    {pendingMeasurement}
                  </span>
                ) : (
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground/40 group-hover:text-muted-foreground/70">
                    {String(i).padStart(2, '0')}
                  </span>
                )}
```

- [ ] **Step 7: Rode testes e typecheck**

Run: `cd web && npx vitest run src/components/dashboard/ src/pages/DashboardPage.test.tsx && npx tsc --noEmit; echo "EXIT=$?"`
Expected: PASS, `EXIT=0`. Se `DashboardPage.test.tsx` quebrar, a causa é o mock da resposta sem `pendingMeasurement` — acrescente `pendingMeasurement: { count: 0, items: [] }` ao fixture, sem mexer nas asserções existentes.

- [ ] **Step 8: Rode a suíte inteira**

Run: `cd web && npx vitest run 2>&1 | tail -6`
Expected: nenhuma falha nova (baseline: 673 passando antes desta task). Se `i18n` tiver teste de paridade de chaves, ele cobre as três locales.

- [ ] **Step 9: Stage e mostre para aprovação**

```bash
cd web
git add src/components/dashboard/PendingMeasurementCard.tsx src/components/dashboard/PendingMeasurementCard.test.tsx src/pages/DashboardPage.tsx src/components/AppLayout.tsx src/locales/
git status --short
git diff --cached --stat
```

Mensagem sugerida (só depois do "ok"):

```
feat(web): ask for the number the loop is waiting on

Card no dashboard e badge no item de experimentos, do mesmo dado e da mesma
query — o badge existe para quem entra direto em outra tela, que é justamente
quem não veria a cobrança.

Sem veredito e sem cor de resultado: um teste sem número não é um teste que deu
errado, é um teste que ninguém leu ainda. `count` real ao lado de uma janela de
cinco, com "+N" no lugar de um corte silencioso.
```

---

## Task 6: O número dispara a leitura, sem segundo clique

**Files:**
- Modify: `web/src/components/experiments/OutcomesSection.tsx`
- Modify: `web/src/components/experiments/OutcomeInterpretation.tsx`
- Modify: `web/src/pages/ExperimentDetailPage.tsx`
- Modify: `web/src/locales/pt.json`, `web/src/locales/en.json`, `web/src/locales/es.json`
- Test: `web/src/components/experiments/OutcomesSection.test.tsx` (criar se não existir), `web/src/components/experiments/OutcomeInterpretation.test.tsx` (existe)

**Interfaces:**
- Consumes: `useCreateOutcome` — a resposta agora é `{ outcome, interpretation: { agentRunId: string | null; reason: string | null } }` (Task 4). `useGetCredits`, `useGetCreditPricing`, `availableCredits` de `@/lib/credits`.
- Produces:
  - `OutcomesSection` ganha a prop `onInterpretationStarted?: (agentRunId: string) => void`
  - `OutcomeInterpretation` ganha a prop `adoptRunId?: string | null`, com precedência sobre a recuperação

- [ ] **Step 1: Escreva o teste que falha**

Os dois arquivos existem e usam `renderWithProviders` de `@/test/render` + `stubFetch` de `@/test/stub-fetch`, com asserções contra `i18n.t(...)`. Siga esse padrão; não introduza `msw` nem `vi.mock` dos hooks gerados.

**Primeiro, um ajuste obrigatório em `OutcomesSection.test.tsx`:** o helper `stubOutcomesServer` (linhas 30-48) responde ao POST com `{ outcome }`. A resposta agora é `{ outcome, interpretation }`, então troque essa linha por:

```tsx
      return new Response(
        JSON.stringify(
          init?.method === 'POST'
            ? { outcome, interpretation: { agentRunId: null, reason: null } }
            : { outcomes: [...recorded] },
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
```

Em `web/src/components/experiments/OutcomeInterpretation.test.tsx`, acrescente ao `describe` existente (o helper local `render(canRun)` monta o componente; acrescente um segundo helper em vez de mudar a assinatura dele, para os testes existentes seguirem intactos):

```tsx
  const renderAdopting = (adoptRunId: string) =>
    renderWithProviders(
      <OutcomeInterpretation experimentId={EXPERIMENT_ID} canRun adoptRunId={adoptRunId} />,
    );

  // Gravar o número já enfileirou a leitura no servidor. Sem adotar esse run, o
  // painel mostraria o botão de rodar e o fundador pagaria de novo por uma
  // leitura que já está na fila.
  it('adota o run que o servidor acabou de enfileirar, em vez de oferecer outro', async () => {
    stubFetch({
      '/agent-runs': { body: { runs: [] } },
      [`/agent-runs/${RUN_ID}`]: { body: { ...completedRun, status: 'RUNNING', output: null } },
      '/learnings': { body: { learnings: [] } },
    });

    renderAdopting(RUN_ID);

    expect(await screen.findByText(i18n.t('pages.experiments.interpret.running'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: i18n.t('pages.experiments.interpret.run') })).not.toBeInTheDocument();
  });
```

E acrescente a `OutcomesSection.test.tsx`:

```tsx
  // Nada é cobrado sem estar escrito na tela antes do clique.
  it('diz o preço e o saldo antes de gravar', async () => {
    stubFetch({
      '/experiments/exp-1/outcomes': { body: { outcomes: [] } },
      '/credits': { body: { allowance: 100, consumed: 10, purchasedBalance: 0 } },
      '/credits/pricing': { body: { operations: [{ taskType: 'interpret-outcome', credits: 2 }] } },
    });

    renderWithProviders(<OutcomesSection experimentId="exp-1" metric="discovery_calls_booked" targetValue={10} />);

    expect(
      await screen.findByText(i18n.t('pages.experiments.outcomes.cost', { credits: 2 })),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: i18n.t('pages.experiments.outcomes.recordAndInterpret') }),
    ).toBeInTheDocument();
  });

  // A medição é fato observado: a leitura que não rodou é um aviso com o motivo,
  // nunca uma mensagem que sugira que o número se perdeu.
  it('avisa quando o número foi gravado mas a leitura não rodou', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const body =
          init?.method === 'POST'
            ? { outcome, interpretation: { agentRunId: null, reason: 'Insufficient credits' } }
            : { outcomes: [] };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );

    renderWithProviders(<OutcomesSection experimentId="exp-1" metric="discovery_calls_booked" targetValue={10} />);

    await userEvent.type(await screen.findByLabelText(i18n.t('pages.experiments.outcomes.value')), '9');
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('pages.experiments.outcomes.recordAndInterpret') }),
    );

    expect(
      await screen.findByText(
        i18n.t('pages.experiments.outcomes.recordedWithoutInterpretation', { reason: 'Insufficient credits' }),
      ),
    ).toBeInTheDocument();
  });

  it('entrega o run enfileirado para quem lê o resultado', async () => {
    const onInterpretationStarted = vi.fn();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const body =
          init?.method === 'POST'
            ? { outcome, interpretation: { agentRunId: 'run-1', reason: null } }
            : { outcomes: [] };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
      }),
    );

    renderWithProviders(
      <OutcomesSection
        experimentId="exp-1"
        metric="discovery_calls_booked"
        targetValue={10}
        onInterpretationStarted={onInterpretationStarted}
      />,
    );

    await userEvent.type(await screen.findByLabelText(i18n.t('pages.experiments.outcomes.value')), '9');
    await userEvent.click(
      screen.getByRole('button', { name: i18n.t('pages.experiments.outcomes.recordAndInterpret') }),
    );

    await waitFor(() => expect(onInterpretationStarted).toHaveBeenCalledWith('run-1'));
  });
```

Nota: `i18n.t('pages.experiments.outcomes.value')` é o rótulo do campo do número — confirme a chave exata que o formulário já usa em `OutcomesSection.tsx` antes de escrever o `findByLabelText`, e use essa.

- [ ] **Step 2: Rode e confirme que falha**

Run: `cd web && npx vitest run src/components/experiments/`
Expected: FAIL — `adoptRunId` e `onInterpretationStarted` não existem.

- [ ] **Step 3: `OutcomeInterpretation` aceita o run adotado**

Em `web/src/components/experiments/OutcomeInterpretation.tsx`:

1. Assinatura:

```tsx
export function OutcomeInterpretation({
  experimentId,
  canRun,
  adoptRunId = null,
}: {
  experimentId: string;
  canRun: boolean;
  /**
   * O run que gravar o número acabou de enfileirar no servidor. Tem precedência
   * sobre a recuperação: é o mais novo por definição, e sem ele o painel
   * ofereceria "rodar" enquanto uma leitura já está na fila — o fundador
   * pagaria duas vezes pela mesma resposta.
   */
  adoptRunId?: string | null;
}) {
```

2. Troque a linha do `activeId`:

```tsx
  const activeId = adoptRunId ?? runId ?? recovered;
```

- [ ] **Step 4: `OutcomesSection` mostra o custo e propaga o run**

Em `web/src/components/experiments/OutcomesSection.tsx`:

1. Imports novos:

```tsx
import { useGetCredits } from '@/api/generated/hooks/creditsHooks/useGetCredits';
import { useGetCreditPricing } from '@/api/generated/hooks/creditsHooks/useGetCreditPricing';
import { availableCredits } from '@/lib/credits';
```

2. Assinatura, acrescentando a prop:

```tsx
export function OutcomesSection({
  experimentId,
  metric,
  targetValue,
  onInterpretationStarted,
}: {
  experimentId: string;
  metric: string;
  targetValue: number | null;
  /**
   * Gravar o número enfileira a leitura no servidor. O run volta na resposta e
   * sobe para a página, que o entrega ao painel de interpretação — sem isso o
   * painel ofereceria rodar uma leitura que já está na fila.
   */
  onInterpretationStarted?: (agentRunId: string) => void;
}) {
```

3. Depois de `const outcomes = useListOutcomes(experimentId);`:

```tsx
  const credits = useGetCredits();
  const pricing = useGetCreditPricing();
  const [interpretationSkipped, setInterpretationSkipped] = useState<string | null>(null);

  const costPerRun =
    pricing.data?.operations.find((operation) => operation.taskType === 'interpret-outcome')?.credits ?? null;
  const balance = credits.data ? availableCredits(credits.data) : null;
  // Enquanto os números não resolvem, `short` fica falso para não bloquear quem
  // tem saldo.
  const short = costPerRun !== null && balance !== null && balance < costPerRun;
```

4. No `onSuccess` do `record`, depois das invalidações, acrescente:

```tsx
        // O número está gravado nos dois casos. Com run, a leitura já está na
        // fila e a página adota; sem run, o motivo aparece e o painel de
        // interpretação continua oferecendo o retry que já existe.
        if (data.interpretation.agentRunId) {
          setInterpretationSkipped(null);
          onInterpretationStarted?.(data.interpretation.agentRunId);
        } else {
          setInterpretationSkipped(data.interpretation.reason ?? t('pages.experiments.outcomes.interpretSkipped'));
        }
```

(assinatura do callback passa a ser `onSuccess: async (data) => { ... }`.)

5. No botão de gravar, troque o rótulo e acrescente o custo e o aviso — logo antes ou depois do botão, dentro do mesmo bloco de formulário:

```tsx
        {interpretationSkipped && (
          <p className="text-sm text-muted-foreground">
            {t('pages.experiments.outcomes.recordedWithoutInterpretation', { reason: interpretationSkipped })}
          </p>
        )}

        <Button type="submit" size="sm" disabled={record.isPending || short}>
          {t('pages.experiments.outcomes.recordAndInterpret')}
        </Button>

        {costPerRun !== null && (
          <p className="text-xs text-muted-foreground">
            {t('pages.experiments.outcomes.cost', { credits: costPerRun })}
            {balance !== null && ` · ${t('pages.experiments.outcomes.balance', { credits: balance })}`}
          </p>
        )}

        {short && <p className="text-sm text-destructive">{t('pages.experiments.outcomes.short')}</p>}
```

Mantenha o texto do botão anterior (`pages.experiments.outcomes.record`) apenas se ele for usado em outro lugar; caso contrário, substitua-o pela chave nova nas três locales.

- [ ] **Step 5: Ligue as duas na página**

Em `web/src/pages/ExperimentDetailPage.tsx`:

1. Junto dos outros `useState`:

```tsx
  // O run que a gravação do número acabou de enfileirar. Vive aqui porque quem
  // grava (OutcomesSection) e quem lê (OutcomeInterpretation) são irmãos.
  const [interpretRunId, setInterpretRunId] = useState<string | null>(null);
```

2. Na linha do `OutcomesSection` (208):

```tsx
        <OutcomesSection
          experimentId={id}
          metric={state.metric}
          targetValue={state.targetValue}
          onInterpretationStarted={setInterpretRunId}
        />
```

3. No `OutcomeInterpretation` (210), acrescente a prop:

```tsx
            adoptRunId={interpretRunId}
```

- [ ] **Step 6: Chaves de i18n**

`pt.json`, dentro de `pages.experiments.outcomes`:

```json
"recordAndInterpret": "Gravar e interpretar",
"cost": "{{credits}} crédito para AUREA ler o resultado",
"cost_other": "{{credits}} créditos para AUREA ler o resultado",
"balance": "saldo: {{credits}}",
"short": "Saldo insuficiente para a leitura. Você ainda pode gravar o número — a leitura fica para depois.",
"interpretSkipped": "a leitura não foi enfileirada",
"recordedWithoutInterpretation": "Número gravado. A leitura não rodou: {{reason}}",
```

`en.json`:

```json
"recordAndInterpret": "Record and interpret",
"cost": "{{credits}} credit for AUREA to read the result",
"cost_other": "{{credits}} credits for AUREA to read the result",
"balance": "balance: {{credits}}",
"short": "Not enough credits for the reading. You can still record the number — the reading can wait.",
"interpretSkipped": "the reading was not queued",
"recordedWithoutInterpretation": "Number recorded. The reading did not run: {{reason}}",
```

`es.json`:

```json
"recordAndInterpret": "Registrar e interpretar",
"cost": "{{credits}} crédito para que AUREA lea el resultado",
"cost_other": "{{credits}} créditos para que AUREA lea el resultado",
"balance": "saldo: {{credits}}",
"short": "Saldo insuficiente para la lectura. Aún puedes registrar el número — la lectura puede esperar.",
"interpretSkipped": "la lectura no se encoló",
"recordedWithoutInterpretation": "Número registrado. La lectura no se ejecutó: {{reason}}",
```

- [ ] **Step 7: Rode testes e typecheck**

Run: `cd web && npx vitest run src/components/experiments/ src/pages/ExperimentDetailPage.test.tsx && npx tsc --noEmit; echo "EXIT=$?"`
Expected: PASS, `EXIT=0`. Fixtures de `useCreateOutcome` em testes existentes precisam do campo `interpretation` — acrescente `interpretation: { agentRunId: null, reason: null }` sem mexer nas asserções.

- [ ] **Step 8: Rode a suíte inteira**

Run: `cd web && npx vitest run 2>&1 | tail -6`
Expected: nenhuma falha nova.

- [ ] **Step 9: Stage e mostre para aprovação**

```bash
cd web
git add src/components/experiments/ src/pages/ExperimentDetailPage.tsx src/locales/
git status --short
git diff --cached --stat
```

Mensagem sugerida (só depois do "ok"):

```
feat(web): read the result as soon as the number is recorded

Gravar o número já enfileira interpret-outcome no servidor, então o painel de
leitura adota esse run em vez de oferecer um segundo — sem isso o fundador
pagaria duas vezes pela mesma resposta.

Custo e saldo aparecem no botão antes do clique. Quando o disparo é recusado por
saldo curto, a tela diz que o número está gravado e qual foi o motivo: a medição
é fato observado, e perdê-la por falta de crédito seria perder o que o loop
existe para registrar.
```

---

## Ordem e dependências

```text
Task 1 (decisão pura)
   ↓
Task 2 (repo + scheduler + worker)        Task 4 (disparo no create-outcome)
   ↓                                          ↓
Task 3 (dashboard)                            │
   ↓                                          │
Task 5 (card + badge)  ←──────────────────────┘
   ↓
Task 6 (número dispara a leitura)
```

Task 4 é independente de 1-3. Task 5 depende de 3 (o campo na resposta). Task 6 depende de 4 (o campo `interpretation`).

---

## Self-review

**Cobertura do spec:**

| Seção do spec | Task |
|---|---|
| §2 restrição de domínio (nunca escrever datas) | Task 1 (testes de data nula), Task 2 (comentário do `extra`) |
| §3.1 decisão pura | Task 1 |
| §3.2 fronteira de dia UTC | Task 1 (`endOfUtcDay`, teste de fronteira) |
| §3.3 execução, env, wiring, idempotência | Task 2 |
| §3.4 exceção de tenant nomeada + teste | Task 2 |
| §3.5 reuso do guard | Task 2 (teste "não escreve quando a tabela recusa") |
| §4.1 definição de pendência | Task 3 |
| §4.2 forma da resposta, cap com `count` | Task 3 |
| §5.1 ordem grava→dispara, resposta, falha | Task 4 |
| §5.2 deduplicação | Task 4 (comentário + spec) |
| §5.3 custo visível antes | Task 6 |
| §5.4 Learning candidato | já implementado em `OutcomeInterpretation`/`learnings/from-run`; Task 6 não afrouxa |
| §6 card, badge, formulário, retry, materialização | Tasks 5 e 6 |
| §7 tabela de erros | Task 2 (falha por item), Task 4 (saldo curto), Task 6 (aviso na tela) |
| §9 testes | distribuídos, um bloco por task |

**Sem placeholders:** todo passo de código traz o código; nenhum "adicione tratamento de erro apropriado".

**Consistência de tipos:** `ClockRow` (Task 1) tem os cinco campos que `findDueSystemWide` seleciona (Task 2). `dueTransition` devolve `ExperimentStatus | null` e o scheduler só chama `transition` quando não é null. `pendingMeasurement` tem a mesma forma no schema Zod (Task 3), no card (Task 5) e no mapeamento da página. `interpretation` tem os mesmos dois campos no Zod (Task 4), no `onSuccess` (Task 6) e nos fixtures.

**Riscos conhecidos:**

- Os testes das Tasks 3, 5 e 6 tocam fixtures existentes (`get-dashboard.test.ts`, `DashboardPage.test.tsx`, testes de `useCreateOutcome`). Acrescentar o campo novo ao fixture é esperado; **mudar asserção existente não é** — se uma asserção antiga passar a falhar, o motivo é uma regressão, não um fixture desatualizado.
- `AppLayout` passa a chamar `useGetDashboard` em toda tela autenticada. Com `staleTime: 30_000` e a mesma query do dashboard, o React Query dedupe — mas se o badge vier a piscar entre navegações, o ajuste é no `staleTime` da query, não em um segundo endpoint.
