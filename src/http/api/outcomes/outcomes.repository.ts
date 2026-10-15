import type { PrismaClient, Prisma } from '@prisma/client';

export interface OutcomeData {
  experimentId: string;
  metric: string;
  value: number;
  unit?: string;
  observedAt?: Date;
  source?: string;
  /** Proveniência do número lido de uma fonte. Ausente no caminho manual. */
  periodStart?: Date;
  periodEnd?: Date;
  externalRef?: string;
  sourceDetail?: Prisma.InputJsonValue;
}

export function createOutcomesRepository(prisma: PrismaClient) {
  return {
    /** Scoped by workspace so an id from another tenant reads as absent. */
    experimentInWorkspace(workspaceId: string, experimentId: string) {
      return prisma.experiment.findFirst({
        where: { id: experimentId, workspaceId },
        // Baseline and target come along because every measurement is reported
        // against them, and reading them here costs nothing extra.
        select: { id: true, metric: true, baselineValue: true, targetValue: true },
      });
    },
    // Ordered by when the measurement happened, not when it was typed in: a
    // number entered late still belongs at its own point in time.
    list(workspaceId: string, experimentId: string) {
      return prisma.outcome.findMany({
        where: { workspaceId, experimentId },
        orderBy: { observedAt: 'desc' },
      });
    },
    create(workspaceId: string, data: OutcomeData) {
      return prisma.outcome.create({ data: { ...data, workspaceId } });
    },
  };
}

export type OutcomesRepository = ReturnType<typeof createOutcomesRepository>;
