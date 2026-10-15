import { type PrismaClient, type Prisma, StrategyStatus, Priority } from '@prisma/client';

const include = {
  goals: { include: { goal: true } },
  icps: { include: { icp: true } },
} satisfies Prisma.StrategyInclude;

export interface StrategyData {
  name: string;
  description?: string;
  objective?: string;
  strategicThesis?: string;
  growthMechanism?: string;
  expectedOutcome?: string;
  channels?: string[];
  risks?: string[];
  assumptions?: unknown[];
  evidence?: unknown[];
  constraints?: Record<string, unknown>;
  priority?: Priority;
}

function jsonFields(data: Partial<StrategyData>) {
  return {
    channels: data.channels as Prisma.InputJsonValue | undefined,
    risks: data.risks as Prisma.InputJsonValue | undefined,
    assumptions: data.assumptions as Prisma.InputJsonValue | undefined,
    evidence: data.evidence as Prisma.InputJsonValue | undefined,
    constraints: data.constraints as Prisma.InputJsonValue | undefined,
  };
}

// Forma comum de uma Strategy nova, compartilhada por `create` (mão do
// founder) e `createWithHypotheses` (aceite de proposta do agente): os
// defaults de uma estratégia nova não podem divergir entre os dois caminhos
// só porque um deles foi escrito depois.
function newStrategyData(workspaceId: string, data: StrategyData) {
  const { channels, risks, assumptions, evidence, constraints, priority, ...rest } = data;
  return {
    ...rest,
    ...jsonFields(data),
    priority: priority ?? Priority.MEDIUM,
    status: StrategyStatus.DRAFT,
    version: 1,
    workspaceId,
  };
}

export function createStrategiesRepository(prisma: PrismaClient) {
  return {
    list(workspaceId: string) {
      return prisma.strategy.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, include });
    },
    findById(workspaceId: string, id: string) {
      return prisma.strategy.findFirst({ where: { id, workspaceId }, include });
    },
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
    /**
     * Quais opções desta proposta já sustentam alguma estratégia. Uma opção
     * gasta é uma opção gasta mesmo que tenha entrado num plano combinado — sem
     * isto, combinar 0+1 e depois adotar 1 sozinha criaria duas estratégias
     * dizendo a mesma coisa, e a unicidade do banco (que só vê o índice
     * primário) não pegaria.
     */
    async usedOptionIndexes(workspaceId: string, agentRunId: string): Promise<number[]> {
      const rows = await prisma.strategy.findMany({
        where: { workspaceId, sourceAgentRunId: agentRunId },
        select: { sourceOptionIndex: true, sourceOptionIndexes: true },
      });
      return [
        ...new Set(
          rows.flatMap((row) => [
            ...row.sourceOptionIndexes,
            ...(row.sourceOptionIndex === null ? [] : [row.sourceOptionIndex]),
          ]),
        ),
      ];
    },
    countGoals(workspaceId: string, goalIds: string[]) {
      return prisma.goal.count({ where: { id: { in: goalIds }, workspaceId } });
    },
    countIcps(workspaceId: string, icpIds: string[]) {
      return prisma.icp.count({ where: { id: { in: icpIds }, workspaceId, deletedAt: null } });
    },
    create(workspaceId: string, data: StrategyData, goalIds: string[], icpIds: string[]) {
      return prisma.strategy.create({
        data: {
          ...newStrategyData(workspaceId, data),
          goals: { create: goalIds.map((goalId) => ({ goalId })) },
          icps: { create: icpIds.map((icpId) => ({ icpId })) },
        },
        include,
      });
    },
    update(id: string, data: Partial<StrategyData>, goalIds?: string[], icpIds?: string[]) {
      const { channels, risks, assumptions, evidence, constraints, priority, ...rest } = data;
      return prisma.$transaction(async (tx) => {
        if (goalIds) {
          await tx.strategyGoal.deleteMany({ where: { strategyId: id } });
          await tx.strategyGoal.createMany({ data: goalIds.map((goalId) => ({ strategyId: id, goalId })) });
        }
        if (icpIds) {
          await tx.strategyIcp.deleteMany({ where: { strategyId: id } });
          await tx.strategyIcp.createMany({ data: icpIds.map((icpId) => ({ strategyId: id, icpId })) });
        }
        return tx.strategy.update({
          where: { id },
          data: { ...rest, ...jsonFields(data), ...(priority ? { priority } : {}) },
          include,
        });
      });
    },
    setStatus(id: string, status: StrategyStatus) {
      const archivedAt = status === StrategyStatus.ARCHIVED ? { archivedAt: new Date() } : {};
      return prisma.strategy.update({ where: { id }, data: { status, ...archivedAt }, include });
    },
    /**
     * Estratégia e hipóteses em uma única instrução: um create aninhado do
     * Prisma é atômico, então não existe estado intermediário com a estratégia
     * criada e as hipóteses faltando.
     */
    createWithHypotheses(
      workspaceId: string,
      data: StrategyData,
      goalIds: string[],
      // `optionIndexes` é o conjunto que entrou no plano; `optionIndex` é o
      // primário (o menor), derivado aqui para que nenhum chamador possa
      // discordar do outro — a unicidade do banco protege esse campo.
      source: { agentRunId: string; optionIndexes: number[] },
      hypotheses: Array<{
        statement: string;
        rationale: string;
        targetMetric: string;
        expectedOutcome: string;
        confidence: 'LOW' | 'MEDIUM' | 'HIGH';
      }>,
    ) {
      return prisma.strategy.create({
        data: {
          ...newStrategyData(workspaceId, data),
          sourceAgentRunId: source.agentRunId,
          sourceOptionIndex: Math.min(...source.optionIndexes),
          sourceOptionIndexes: source.optionIndexes,
          goals: { create: goalIds.map((goalId) => ({ goalId })) },
          hypotheses: {
            create: hypotheses.map((hypothesis) => ({ ...hypothesis, workspaceId })),
          },
        },
        include,
      });
    },
  };
}

export type StrategiesRepository = ReturnType<typeof createStrategiesRepository>;
