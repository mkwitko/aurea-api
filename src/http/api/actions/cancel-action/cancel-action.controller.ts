import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertWriter } from '../../../../lib/tenant.js';
import { createActionsRepository } from '../actions.repository.js';
import { presentActionWithTargets } from '../actions.presenter.js';
import { actionIdParam, actionResponse } from '../actions.schema.js';
import { transitionActionService } from '../actions.transition.js';

/**
 * Cancelar só existe antes de a ação sair. Depois de entregue, cancelar não
 * despublica nada, e o status mentiria sobre o que existe no mundo — a tabela
 * de transições é quem recusa (`EXECUTED` e `EXECUTING` não levam a
 * `CANCELLED`).
 */
export const cancelActionRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/actions/:id/cancel',
    {
      schema: {
        tags: ['actions'],
        operationId: 'cancelAction',
        params: actionIdParam,
        response: { 200: actionResponse },
      },
    },
    async (req, reply) => {
      assertWriter(req.tenant);

      const action = await transitionActionService({ repo: createActionsRepository(app.prisma) })({
        workspaceId: req.tenant.workspaceId,
        id: req.params.id,
        to: 'CANCELLED',
      });

      return reply.send(presentActionWithTargets(action));
    },
  );
};
