import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertAdmin } from '../../../../lib/tenant.js';
import { createActionsRepository } from '../actions.repository.js';
import { presentActionWithTargets } from '../actions.presenter.js';
import { actionIdParam, actionResponse } from '../actions.schema.js';
import { transitionActionService } from '../actions.transition.js';

/**
 * Aprovar é o ato que autoriza sair para o mundo, e por isso é de OWNER/ADMIN:
 * MEMBER escreve conteúdo, não autoriza publicação (spec §2, decisão 4).
 *
 * O autor pode aprovar o que escreveu — em workspace de fundador solo, exigir
 * um segundo par de olhos travaria o piloto. Mas em dois atos: não existe rota
 * que crie e aprove no mesmo request, e o `Approval` guarda `requestedBy` e
 * `reviewedBy` separados.
 */
export const approveActionRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/actions/:id/approve',
    {
      schema: {
        tags: ['actions'],
        operationId: 'approveAction',
        params: actionIdParam,
        response: { 200: actionResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);
      const repo = createActionsRepository(app.prisma);
      const now = new Date();

      const action = await transitionActionService({ repo })({
        workspaceId: req.tenant.workspaceId,
        id: req.params.id,
        to: 'APPROVED',
        write: (current) =>
          repo.review(req.tenant.workspaceId, current.id, {
            to: 'APPROVED',
            approvalStatus: 'APPROVED',
            reviewedBy: req.tenant.userId,
            comment: null,
            reviewedAt: now,
            actionExtra: { approvedAt: now },
          }),
      });

      return reply.send(presentActionWithTargets(action));
    },
  );
};
