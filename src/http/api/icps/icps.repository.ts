import { type PrismaClient, type Prisma, EntityStatus } from '@prisma/client';

export interface IcpData {
  name: string;
  description?: string;
  painPoints?: string[];
  characteristics?: string[];
  customerGoals?: string[];
  buyingTriggers?: string[];
  objections?: string[];
}

function toJson(data: IcpData): Prisma.IcpUncheckedCreateInput {
  return {
    workspaceId: '',
    name: data.name,
    description: data.description,
    painPoints: data.painPoints,
    characteristics: data.characteristics,
    customerGoals: data.customerGoals,
    buyingTriggers: data.buyingTriggers,
    objections: data.objections,
  };
}

export function createIcpsRepository(prisma: PrismaClient) {
  return {
    list(workspaceId: string) {
      return prisma.icp.findMany({ where: { workspaceId, deletedAt: null }, orderBy: { createdAt: 'desc' } });
    },
    findById(workspaceId: string, id: string) {
      return prisma.icp.findFirst({ where: { id, workspaceId, deletedAt: null } });
    },
    create(workspaceId: string, data: IcpData) {
      return prisma.icp.create({ data: { ...toJson(data), workspaceId } });
    },
    update(id: string, data: Partial<IcpData>) {
      return prisma.icp.update({
        where: { id },
        data: {
          name: data.name,
          description: data.description,
          painPoints: data.painPoints,
          characteristics: data.characteristics,
          customerGoals: data.customerGoals,
          buyingTriggers: data.buyingTriggers,
          objections: data.objections,
        },
      });
    },
    archive(id: string) {
      return prisma.icp.update({ where: { id }, data: { status: EntityStatus.ARCHIVED, deletedAt: new Date() } });
    },
  };
}

export type IcpsRepository = ReturnType<typeof createIcpsRepository>;
