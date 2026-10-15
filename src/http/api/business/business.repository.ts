import { type PrismaClient, Prisma, ContextSource, ConfidenceLevel } from '@prisma/client';

export interface BusinessData {
  name: string;
  description?: string;
  website?: string;
  industry?: string;
  businessModel?: string;
  revenueModel?: string;
  valueProposition?: string;
  positioning?: string;
}

export function createBusinessRepository(prisma: PrismaClient) {
  return {
    getByWorkspace(workspaceId: string) {
      return prisma.business.findFirst({ where: { workspaceId, deletedAt: null } });
    },
    create(workspaceId: string, data: BusinessData) {
      return prisma.business.create({ data: { ...data, workspaceId } });
    },
    update(id: string, data: Prisma.BusinessUpdateInput) {
      return prisma.business.update({ where: { id }, data });
    },
    getContext(businessId: string) {
      return prisma.businessContext.findUnique({ where: { businessId }, include: { currentVersion: true } });
    },
    addContextVersion(
      businessId: string,
      input: {
        data: Prisma.InputJsonValue;
        // Proveniência por seção — ver o comentário do campo `meta` no schema
        // Prisma. Ausente (não `Prisma.JsonNull` explícito) grava `null`, igual
        // a toda versão escrita antes deste campo existir.
        meta?: Prisma.InputJsonValue;
        source: ContextSource;
        confidence: ConfidenceLevel;
        // Opcional: uma versão aplicada pelo runner (ver
        // propose-business-context.apply.ts) não tem um humano por trás — é o
        // próprio agente, autorizado pelo run, quem escreve.
        createdBy?: string;
        // Os campos de aterrissagem do contexto são string[], então anexar um
        // achado perde a url dele. O vínculo com o run devolve a proveniência:
        // o run guarda cada achado com sua citação e sua fonte.
        sourceAgentRunId?: string;
      },
    ) {
      return prisma.$transaction(async (tx) => {
        const context = await tx.businessContext.upsert({
          where: { businessId },
          create: { businessId },
          update: {},
        });
        const count = await tx.businessContextVersion.count({ where: { businessContextId: context.id } });
        if (context.currentVersionId) {
          await tx.businessContextVersion.update({
            where: { id: context.currentVersionId },
            data: { supersededAt: new Date() },
          });
        }
        const version = await tx.businessContextVersion.create({
          data: {
            businessContextId: context.id,
            version: count + 1,
            data: input.data,
            meta: input.meta ?? Prisma.JsonNull,
            source: input.source,
            confidence: input.confidence,
            createdBy: input.createdBy,
            sourceAgentRunId: input.sourceAgentRunId,
          },
        });
        await tx.businessContext.update({ where: { id: context.id }, data: { currentVersionId: version.id } });
        return version;
      });
    },
    softDelete(id: string) {
      return prisma.business.update({ where: { id }, data: { deletedAt: new Date() } });
    },
  };
}

export type BusinessRepository = ReturnType<typeof createBusinessRepository>;
