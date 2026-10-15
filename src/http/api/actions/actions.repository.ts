import type { ActionStatus, ActionType, Prisma, PrismaClient, SocialPlatform } from '@prisma/client';
import { EXECUTABLE_FROM } from './actions.domain.js';
import { aggregateActionStatus, PUBLISHABLE_TARGET } from './actions.targets.js';
import { writeAggregatedStatus } from '../../../actions/aggregate.js';

/**
 * O tipo de entidade da proveniência no `ExternalReference`.
 *
 * É do **alvo**, não da Action: um post por rede, e `entityId` é o id do alvo.
 * Com isso a unique `[integrationId, entityType, entityId]` passa a significar
 * "um post por rede por ação", que é exatamente a trava que se quer — e sem
 * migração nova (spec §8.1, passo 6).
 */
export const SOCIAL_POST_TARGET_ENTITY = 'SOCIAL_POST_TARGET';

/** Alvos em ordem estável: a tela lê como lista, e o teste consegue afirmar. */
const WITH_TARGETS = { targets: { orderBy: { platform: 'asc' } } } as const;

export function createActionsRepository(prisma: PrismaClient) {
  return {
    list(workspaceId: string, filter: { status?: ActionStatus; experimentId?: string }) {
      return prisma.action.findMany({
        // Só as chaves presentes entram no `where`: um `status: undefined`
        // explícito é ignorado pelo Prisma, mas o objeto montado assim é o que
        // o teste consegue afirmar sem adivinhar.
        where: {
          workspaceId,
          ...(filter.status ? { status: filter.status } : {}),
          ...(filter.experimentId ? { experimentId: filter.experimentId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        include: WITH_TARGETS,
      });
    },

    findById(workspaceId: string, id: string) {
      return prisma.action.findFirst({ where: { id, workspaceId }, include: WITH_TARGETS });
    },

    /**
     * A ação e seus alvos numa transação: uma Action sem alvo não tem para onde
     * publicar, e ficaria como rascunho que nenhuma tela sabe explicar.
     */
    createWithTargets(
      workspaceId: string,
      data: {
        experimentId: string | null;
        type: ActionType;
        name: string;
        description: string | null;
        payload: Prisma.InputJsonValue;
        createdBy: string;
      },
      targets: Array<{ platform: SocialPlatform; socialAccountId: string }>,
    ) {
      return prisma.$transaction(async (tx) => {
        const action = await tx.action.create({ data: { workspaceId, status: 'PROPOSED', ...data } });
        await tx.actionTarget.createMany({
          data: targets.map((target) => ({ workspaceId, actionId: action.id, ...target })),
        });
        return tx.action.findFirstOrThrow({ where: { id: action.id }, include: WITH_TARGETS });
      });
    },

    /**
     * Troca o conjunto de redes de uma ação.
     *
     * Nunca apaga alvo `PUBLISHED`: um post no mundo é fato, e sumir com a linha
     * apagaria a proveniência. A rota só permite editar em `PROPOSED`, onde isso
     * não deveria acontecer — a verificação existe porque "não deveria" não é
     * trava.
     */
    replaceTargets(
      workspaceId: string,
      actionId: string,
      targets: Array<{ platform: SocialPlatform; socialAccountId: string }>,
    ) {
      return prisma.$transaction(async (tx) => {
        const current = await tx.actionTarget.findMany({ where: { workspaceId, actionId } });
        const keep = new Set(targets.map((target) => target.platform));

        const removable = current.filter((target) => !keep.has(target.platform) && target.status !== 'PUBLISHED');
        if (removable.length > 0) {
          await tx.actionTarget.deleteMany({ where: { id: { in: removable.map((target) => target.id) } } });
        }

        const existing = new Set(current.map((target) => target.platform));
        const added = targets.filter((target) => !existing.has(target.platform));
        if (added.length > 0) {
          await tx.actionTarget.createMany({
            data: added.map((target) => ({ workspaceId, actionId, ...target })),
          });
        }

        return tx.action.findFirstOrThrow({ where: { id: actionId }, include: WITH_TARGETS });
      });
    },

    update(id: string, data: Prisma.ActionUpdateInput) {
      return prisma.action.update({ where: { id }, data, include: WITH_TARGETS });
    },

    /** O histórico completo, mais velho primeiro: a tela lê como linha do tempo. */
    findApprovals(workspaceId: string, actionId: string) {
      return prisma.approval.findMany({
        where: { workspaceId, actionId },
        orderBy: { requestedAt: 'asc' },
      });
    },

    /**
     * O par submeter: status e pedido de aprovação numa transação.
     *
     * Separado porque as duas escritas não podem divergir — um `Approval`
     * pendente sobre uma ação que ficou em `PROPOSED` é um pedido que ninguém
     * vê, e uma ação em `PENDING_APPROVAL` sem pedido é uma fila sem item.
     */
    submit(workspaceId: string, actionId: string, requestedBy: string) {
      return prisma.$transaction(async (tx) => {
        const action = await tx.action.update({
          where: { id: actionId },
          data: { status: 'PENDING_APPROVAL' },
          include: WITH_TARGETS,
        });
        await tx.approval.create({
          data: { workspaceId, actionId, requestedBy, status: 'PENDING' },
        });
        return action;
      });
    },

    /**
     * A decisão: status da ação e fechamento do pedido pendente, numa transação.
     *
     * `updateMany` filtrando `status: 'PENDING'` de propósito: uma segunda
     * decisão não pode reescrever a de ontem, que é histórico (spec §4.3).
     */
    review(
      workspaceId: string,
      actionId: string,
      review: {
        to: ActionStatus;
        approvalStatus: 'APPROVED' | 'REJECTED';
        reviewedBy: string;
        comment: string | null;
        reviewedAt: Date;
        actionExtra?: Prisma.ActionUpdateInput;
      },
    ) {
      return prisma.$transaction(async (tx) => {
        const action = await tx.action.update({
          where: { id: actionId },
          data: { status: review.to, ...(review.actionExtra ?? {}) },
          include: WITH_TARGETS,
        });
        await tx.approval.updateMany({
          where: { workspaceId, actionId, status: 'PENDING' },
          data: {
            status: review.approvalStatus,
            reviewedBy: review.reviewedBy,
            comment: review.comment,
            reviewedAt: review.reviewedAt,
          },
        });
        return action;
      });
    },

    /**
     * O compare-and-swap que serializa a execução (spec §6, camada 1).
     *
     * A transição é a própria condição do `updateMany`: dois cliques
     * simultâneos não podem ambos encontrar um estado executável. Devolve
     * `false` para quem perdeu, e só quem ganhou enfileira.
     *
     * `FAILED` está no `in` porque reexecutar uma falha é ato humano legítimo
     * (spec §7.2), e a corrida a proteger é a mesma.
     */
    async claimForExecution(workspaceId: string, id: string): Promise<boolean> {
      const { count } = await prisma.action.updateMany({
        where: { id, workspaceId, status: { in: EXECUTABLE_FROM } },
        // `attempts`, `lastError` e `failureKind` não estão aqui porque não estão
        // mais na Action: são do alvo, e quem os zera é `markTargetsPublishing`.
        data: { status: 'EXECUTING', heartbeatAt: null },
      });
      return count === 1;
    },

    /**
     * Marca como em voo os alvos que **nós** vamos enviar, e devolve quais.
     *
     * `PUBLISHABLE_TARGET` é a trava contra post duplicado: um alvo `PUBLISHED`
     * tem post no mundo, e um `DELIVERY_UNKNOWN` pode ter (spec §8.1).
     */
    async markTargetsPublishing(
      workspaceId: string,
      actionId: string,
    ): Promise<Array<{ platform: SocialPlatform; socialAccountId: string | null }>> {
      const targets = await prisma.actionTarget.findMany({
        where: { workspaceId, actionId, status: { in: PUBLISHABLE_TARGET } },
        orderBy: { platform: 'asc' },
      });
      if (targets.length === 0) return [];

      await prisma.actionTarget.updateMany({
        where: { id: { in: targets.map((target) => target.id) } },
        data: {
          status: 'PUBLISHING',
          attempts: { increment: 1 },
          // O erro da tentativa anterior sai agora: mantê-lo faria a tela mostrar
          // a falha de ontem ao lado de uma execução em voo.
          lastError: null,
          failureKind: null,
        },
      });

      return targets.map((target) => ({ platform: target.platform, socialAccountId: target.socialAccountId }));
    },

    /**
     * Escreve na Action o status derivado dos alvos, delegando ao único lugar que
     * faz isso (`src/actions/aggregate.ts`). Duas implementações da mesma regra
     * divergiriam, e a divergência apareceria como status mentindo sobre os alvos.
     */
    writeAggregatedStatus(actionId: string, extra: Prisma.ActionUpdateInput = {}): Promise<void> {
      return writeAggregatedStatus(prisma, actionId, extra);
    },

    /**
     * A decisão humana sobre uma entrega incerta, alvo por alvo.
     *
     * `PUBLISHED` sem `externalId` grava o alvo publicado **sem**
     * `ExternalReference`: um id inventado seria proveniência falsa de um post
     * real, e proveniência ausente é melhor que proveniência de mentira. `postUrl`
     * fica nulo pela mesma razão — não é nossa para construir.
     *
     * `NOT_PUBLISHED` devolve o alvo a `PENDING`, e é o que torna o retry seguro:
     * o alvo deixou de ser incerto porque um humano olhou a rede (spec §8.3).
     */
    resolveTarget(
      workspaceId: string,
      target: { id: string; actionId: string; platform: SocialPlatform },
      resolution:
        | { outcome: 'PUBLISHED'; integrationId: string; externalId: string | null; now: Date }
        | { outcome: 'NOT_PUBLISHED' },
    ) {
      // Fora da transação, e nulo no caminho NOT_PUBLISHED: `executedAt` só é
      // escrito por quem de fato fechou uma publicação.
      const publishedAt = resolution.outcome === 'PUBLISHED' ? resolution.now : null;

      return prisma.$transaction(async (tx) => {
        if (resolution.outcome === 'NOT_PUBLISHED') {
          await tx.actionTarget.update({
            where: { id: target.id },
            data: { status: 'PENDING', lastError: null, failureKind: null },
          });
        } else {
          if (resolution.externalId) {
            await tx.externalReference.create({
              data: {
                workspaceId,
                integrationId: resolution.integrationId,
                entityType: SOCIAL_POST_TARGET_ENTITY,
                entityId: target.id,
                externalId: resolution.externalId,
                // Sem `url`: quem confirmou foi o humano, e o provider não nos
                // disse endereço nenhum. Montar um afirmaria o que não veio da
                // fonte.
                metadata: { platform: target.platform, url: null },
              },
            });
          }
          await tx.actionTarget.update({
            where: { id: target.id },
            data: {
              status: 'PUBLISHED',
              externalId: resolution.externalId,
              publishedAt,
              lastError: null,
              failureKind: null,
            },
          });
        }

        const targets = await tx.actionTarget.findMany({
          where: { actionId: target.actionId },
          select: { status: true },
        });
        const status = aggregateActionStatus(targets);
        return tx.action.update({
          where: { id: target.actionId },
          data: {
            ...(status ? { status } : {}),
            heartbeatAt: null,
            ...(publishedAt && (status === 'EXECUTED' || status === 'PARTIALLY_EXECUTED')
              ? { executedAt: publishedAt }
              : {}),
          },
          include: WITH_TARGETS,
        });
      });
    },

    /** O alvo, sempre pelos três ids: o do alvo, o da ação e o do workspace. */
    findTarget(workspaceId: string, actionId: string, targetId: string) {
      return prisma.actionTarget.findFirst({ where: { id: targetId, actionId, workspaceId } });
    },
  };
}

export type ActionsRepository = ReturnType<typeof createActionsRepository>;
