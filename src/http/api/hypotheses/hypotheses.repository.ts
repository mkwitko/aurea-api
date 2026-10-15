import { type PrismaClient, ConfidenceLevel, HypothesisStatus } from '@prisma/client';

export interface HypothesisData {
  strategyId: string;
  statement: string;
  rationale?: string;
  expectedOutcome?: string;
  targetMetric?: string;
  confidence?: ConfidenceLevel;
}

export function createHypothesesRepository(prisma: PrismaClient) {
  return {
    list(workspaceId: string, strategyId?: string) {
      return prisma.hypothesis.findMany({
        where: { workspaceId, ...(strategyId ? { strategyId } : {}) },
        orderBy: { createdAt: 'desc' },
      });
    },
    findById(workspaceId: string, id: string) {
      return prisma.hypothesis.findFirst({ where: { id, workspaceId } });
    },
    strategyInWorkspace(workspaceId: string, strategyId: string) {
      return prisma.strategy.findFirst({ where: { id: strategyId, workspaceId }, select: { id: true } });
    },
    create(workspaceId: string, data: HypothesisData) {
      const { confidence, ...rest } = data;
      return prisma.hypothesis.create({
        data: { ...rest, confidence: confidence ?? ConfidenceLevel.MEDIUM, status: HypothesisStatus.DRAFT, workspaceId },
      });
    },
    update(id: string, data: Partial<Omit<HypothesisData, 'strategyId'>>) {
      return prisma.hypothesis.update({ where: { id }, data });
    },
    setStatus(id: string, status: HypothesisStatus) {
      return prisma.hypothesis.update({ where: { id }, data: { status } });
    },
  };
}

export type HypothesesRepository = ReturnType<typeof createHypothesesRepository>;
