import { type PrismaClient, ConfidenceLevel, LearningStatus, type Prisma } from '@prisma/client';

export interface LearningData {
  experimentId?: string;
  title: string;
  statement: string;
  evidence?: Prisma.InputJsonValue;
  confidence?: ConfidenceLevel;
}

export function createLearningsRepository(prisma: PrismaClient) {
  return {
    list(workspaceId: string, filters: { experimentId?: string; status?: LearningStatus }) {
      return prisma.learning.findMany({
        where: {
          workspaceId,
          ...(filters.experimentId ? { experimentId: filters.experimentId } : {}),
          ...(filters.status ? { status: filters.status } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });
    },
    findById(workspaceId: string, id: string) {
      return prisma.learning.findFirst({ where: { id, workspaceId } });
    },
    experimentInWorkspace(workspaceId: string, experimentId: string) {
      return prisma.experiment.findFirst({ where: { id: experimentId, workspaceId }, select: { id: true } });
    },
    create(workspaceId: string, data: LearningData) {
      const { confidence, ...rest } = data;
      return prisma.learning.create({
        data: {
          ...rest,
          confidence: confidence ?? ConfidenceLevel.MEDIUM,
          // Always a candidate. Validation is a separate, human act.
          status: LearningStatus.CANDIDATE,
          workspaceId,
        },
      });
    },
    setStatus(id: string, status: LearningStatus, extra: Prisma.LearningUpdateInput = {}) {
      return prisma.learning.update({ where: { id }, data: { status, ...extra } });
    },
    createFromRun(workspaceId: string, data: {
      experimentId: string;
      sourceAgentRunId: string;
      title: string;
      statement: string;
      confidence: ConfidenceLevel;
      evidence: Prisma.InputJsonValue;
    }) {
      return prisma.learning.create({
        data: {
          ...data,
          // Sempre candidato, como no create manual: validar é ato humano.
          status: LearningStatus.CANDIDATE,
          workspaceId,
        },
      });
    },
  };
}

export type LearningsRepository = ReturnType<typeof createLearningsRepository>;
