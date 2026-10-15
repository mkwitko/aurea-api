import { type PrismaClient, type Prisma, GoalStatus, Priority } from '@prisma/client';

const include = { icps: { include: { icp: true } } } satisfies Prisma.GoalInclude;

export interface CreateGoalData {
  name: string;
  description?: string;
  metric: string;
  baselineValue?: number;
  targetValue?: number;
  unit?: string;
  deadline?: Date;
  priority: Priority;
}

// Data access for the goals aggregate. All queries are scoped by workspaceId.
export function createGoalsRepository(prisma: PrismaClient) {
  return {
    list(workspaceId: string) {
      return prisma.goal.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, include });
    },
    findById(workspaceId: string, id: string) {
      return prisma.goal.findFirst({ where: { id, workspaceId }, include });
    },
    countIcps(workspaceId: string, icpIds: string[]) {
      return prisma.icp.count({ where: { id: { in: icpIds }, workspaceId, deletedAt: null } });
    },
    create(workspaceId: string, data: CreateGoalData, icpIds: string[]) {
      return prisma.goal.create({
        data: {
          ...data,
          status: GoalStatus.DRAFT,
          workspaceId,
          icps: { create: icpIds.map((icpId) => ({ icpId })) },
        },
        include,
      });
    },
    update(workspaceId: string, id: string, data: Prisma.GoalUpdateInput, icpIds?: string[]) {
      return prisma.$transaction(async (tx) => {
        if (icpIds) {
          await tx.goalIcp.deleteMany({ where: { goalId: id } });
          await tx.goalIcp.createMany({ data: icpIds.map((icpId) => ({ goalId: id, icpId })) });
        }
        return tx.goal.update({ where: { id }, data, include });
      });
    },
    setStatus(id: string, status: GoalStatus, extra: Prisma.GoalUpdateInput = {}) {
      return prisma.goal.update({ where: { id }, data: { status, ...extra }, include });
    },
  };
}

export type GoalsRepository = ReturnType<typeof createGoalsRepository>;
