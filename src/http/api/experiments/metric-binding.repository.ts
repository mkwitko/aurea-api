import type { PrismaClient, Prisma } from '@prisma/client';

export function createMetricBindingRepository(prisma: PrismaClient) {
  return {
    /** O experimento existe neste workspace? Um de outro é indistinguível de inexistente. */
    experimentInWorkspace(workspaceId: string, experimentId: string) {
      return prisma.experiment.findFirst({ where: { id: experimentId, workspaceId }, select: { id: true } });
    },
    find(workspaceId: string, experimentId: string) {
      return prisma.metricBinding.findFirst({ where: { workspaceId, experimentId } });
    },
    upsert(input: {
      workspaceId: string;
      experimentId: string;
      provider: string;
      config: Prisma.InputJsonValue;
      createdBy: string;
    }) {
      const { workspaceId, experimentId, createdBy, ...rest } = input;
      return prisma.metricBinding.upsert({
        where: { experimentId },
        create: { workspaceId, experimentId, createdBy, ...rest },
        update: rest,
      });
    },
    remove(workspaceId: string, experimentId: string) {
      return prisma.metricBinding.deleteMany({ where: { workspaceId, experimentId } });
    },
  };
}

export type MetricBindingRepository = ReturnType<typeof createMetricBindingRepository>;
