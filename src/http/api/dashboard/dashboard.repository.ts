import { type PrismaClient, ExperimentStatus, StrategyStatus, GoalStatus, AgentRunStatus } from '@prisma/client';
import type { DashboardSnapshot, RecentSources, SpineExperiment } from './dashboard.domain.js';

/** The task type the Research Agent runs under. Mirrors `src/ai/agents/registry.ts`. */
const RESEARCH_TASK_TYPE = 'research-growth-context';

const NON_CANCELLED = { status: { not: ExperimentStatus.CANCELLED } } as const;

export function createDashboardRepository(prisma: PrismaClient) {
  return {
    /**
     * Everything the stage machine needs, in one round of parallel reads. The
     * setup checks are counts and first-row lookups, never lists — this screen
     * asks whether a step happened, not what it produced.
     */
    async snapshot(workspaceId: string, now: Date): Promise<DashboardSnapshot> {
      const [
        business,
        icpCount,
        openGoalCount,
        activeGoalCount,
        draftGoal,
        researchRunCount,
        strategyCount,
        hypothesisCount,
        experimentCount,
        spineRow,
      ] = await Promise.all([
        // deletedAt: null em ambos. Business e Icp são soft delete, e sem o
        // filtro o dashboard continua contando o que o fundador já apagou —
        // ele exclui o negócio e a home segue dizendo que a etapa está feita.
        // Goal não tem a coluna: seu ciclo de vida é o status.
        prisma.business.findFirst({ where: { workspaceId, deletedAt: null }, select: { id: true } }),
        prisma.icp.count({ where: { workspaceId, deletedAt: null } }),
        // Só os que ainda dá para perseguir. Um objetivo pausado, concluído ou
        // cancelado não é um objetivo que o fundador tem — se todos estiverem
        // nesses estados a home tem que voltar a pedir um, e não dizer que a
        // etapa está feita porque um dia existiu. DRAFT conta: ele existe, e o
        // empurrão certo ali é ativá-lo, não criar outro.
        prisma.goal.count({ where: { workspaceId, status: { in: [GoalStatus.DRAFT, GoalStatus.ACTIVE] } } }),
        prisma.goal.count({ where: { workspaceId, status: GoalStatus.ACTIVE } }),
        // O rascunho mais recente, para o painel poder nomear qual ativar.
        // id desempata para a resposta ser determinística.
        prisma.goal.findFirst({
          where: { workspaceId, status: GoalStatus.DRAFT },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true, name: true },
        }),
        // Só as concluídas. A spec original contava run de qualquer status —
        // "o fundador fez a etapa" — mas uma pesquisa que falhou não deixou
        // nada no contexto do negócio, e marcar a etapa como feita esconde o
        // erro atrás de um check verde. Quem tentou e falhou precisa ver que
        // precisa tentar de novo, não seguir para a estratégia sem pesquisa.
        prisma.agentRun.count({
          where: { workspaceId, taskType: RESEARCH_TASK_TYPE, status: AgentRunStatus.COMPLETED },
        }),
        prisma.strategy.count({ where: { workspaceId } }),
        prisma.hypothesis.count({ where: { workspaceId } }),
        prisma.experiment.count({ where: { workspaceId } }),
        prisma.experiment.findFirst({
          where: { workspaceId, ...NON_CANCELLED },
          // id breaks ties so the spine is deterministic (spec §3.1).
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            name: true,
            status: true,
            metric: true,
            endDate: true,
            strategyId: true,
            _count: { select: { outcomes: true } },
            learnings: { select: { id: true, status: true, createdAt: true } },
          },
        }),
      ]);

      const spine: SpineExperiment | null = spineRow
        ? {
            id: spineRow.id,
            name: spineRow.name,
            status: spineRow.status,
            metric: spineRow.metric,
            endDate: spineRow.endDate,
            outcomeCount: spineRow._count.outcomes,
            learnings: spineRow.learnings,
            strategyId: spineRow.strategyId,
          }
        : null;

      const context = business
        ? await prisma.businessContext.findUnique({
            where: { businessId: business.id },
            include: { currentVersion: true },
          })
        : null;

      // Narrowing of a Prisma JSON column, not unvalidated external input.
      const data = (context?.currentVersion?.data ?? {}) as Record<string, unknown>;
      const contextSectionCount = countFilledSections(data);

      return {
        now,
        hasBusiness: business !== null,
        icpCount,
        openGoalCount,
        activeGoalCount,
        draftGoal,
        researchRunCount,
        strategyCount,
        contextSectionCount,
        hypothesisCount,
        experimentCount,
        spine,
      };
    },

    /**
     * The loop's header: which number it is, and the goal and strategy it
     * serves. Both tie-breaks are spec's goal/strategy rules: with a spine,
     * the spine's own `strategyId` names the strategy and that strategy's
     * linked goals (oldest first) name the goal; without a spine, the newest
     * non-archived strategy stands in and the goal is the latest ACTIVE one.
     */
    async loopContext(workspaceId: string, spine: SpineExperiment | null) {
      const [count, strategy] = await Promise.all([
        prisma.experiment.count({ where: { workspaceId, ...NON_CANCELLED } }),
        spine
          ? prisma.strategy.findFirst({ where: { id: spine.strategyId, workspaceId }, select: { id: true, name: true } })
          : prisma.strategy.findFirst({
              where: { workspaceId, status: { not: StrategyStatus.ARCHIVED } },
              orderBy: { createdAt: 'desc' },
              select: { id: true, name: true },
            }),
      ]);

      const activeGoal = () =>
        prisma.goal.findFirst({
          where: { workspaceId, status: GoalStatus.ACTIVE },
          orderBy: { createdAt: 'desc' },
          select: { id: true, name: true, metric: true, targetValue: true, unit: true },
        });

      const goal = spine
        ? // The spine's own strategy's oldest goal. Strategy <-> Goal is
          // many-to-many, so without an order this answer drifts between
          // requests. Only consulted when there is a spine — without one the
          // strategy's linked goals are never the answer.
          ((await prisma.goal.findFirst({
              where: { workspaceId, strategies: { some: { strategyId: spine.strategyId } } },
              orderBy: { createdAt: 'asc' },
              select: { id: true, name: true, metric: true, targetValue: true, unit: true },
            })) ?? (await activeGoal()))
        : await activeGoal();

      return {
        // Zero non-cancelled experiments still means loop 1 — the one being
        // set up (spec §3.1).
        number: Math.max(count, 1),
        strategy: strategy ?? null,
        goal:
          goal ??
          (await prisma.goal.findFirst({
            where: { workspaceId },
            orderBy: { createdAt: 'desc' },
            select: { id: true, name: true, metric: true, targetValue: true, unit: true },
          })),
      };
    },

    /** Raw rows for the feed. Derives nothing — `buildRecent` does that. */
    async recentSources(workspaceId: string): Promise<RecentSources> {
      const take = 8;
      const [goals, researchRuns, strategies, experiments, outcomes, learnings] = await Promise.all([
        prisma.goal.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'desc' },
          take,
          select: { id: true, name: true, createdAt: true },
        }),
        prisma.agentRun.findMany({
          where: { workspaceId, taskType: RESEARCH_TASK_TYPE, status: AgentRunStatus.COMPLETED },
          orderBy: { completedAt: 'desc' },
          take,
          select: { id: true, completedAt: true, output: true },
        }),
        prisma.strategy.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'desc' },
          take,
          select: { id: true, name: true, createdAt: true, sourceAgentRunId: true },
        }),
        prisma.experiment.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'desc' },
          take,
          select: { id: true, name: true, createdAt: true, completedAt: true },
        }),
        prisma.outcome.findMany({
          where: { workspaceId },
          orderBy: { observedAt: 'desc' },
          take,
          select: { id: true, metric: true, value: true, unit: true, observedAt: true },
        }),
        prisma.learning.findMany({
          where: { workspaceId },
          orderBy: { createdAt: 'desc' },
          take,
          select: { id: true, title: true, createdAt: true, validatedAt: true },
        }),
      ]);

      return { goals, researchRuns, strategies, experiments, outcomes, learnings };
    },

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
  };
}

export type DashboardRepository = ReturnType<typeof createDashboardRepository>;

/**
 * Quantas seções do contexto têm conteúdo. Espelha `filledSectionCount` em
 * `src/ai/agents/fill/propose-icp.ts`: as duas decidem a mesma coisa, e se
 * divergirem o guia dirá "feito" num passo cujo agente seguinte recusa.
 */
function countFilledSections(data: Record<string, unknown>): number {
  return Object.entries(data).filter(([key, value]) => {
    if (['completeness', 'lastReviewedAt', 'notes'].includes(key)) return false;
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === 'object') return Object.keys(value).length > 0;
    return false;
  }).length;
}
