import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { createActionsRepository } from '../actions.repository.js';
import { presentActionWithTargets, presentApproval } from '../actions.presenter.js';
import { actionDetailResponse, actionIdParam } from '../actions.schema.js';

export const getActionRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/actions/:id',
    {
      schema: {
        tags: ['actions'],
        operationId: 'getAction',
        params: actionIdParam,
        response: { 200: actionDetailResponse },
      },
    },
    async (req, reply) => {
      const repo = createActionsRepository(app.prisma);
      const { workspaceId } = req.tenant;

      const action = await repo.findById(workspaceId, req.params.id);
      if (!action) throw new NotFoundError('Action not found');

      const approvals = await repo.findApprovals(workspaceId, action.id);

      // A proveniência não é mais um campo à parte: cada alvo carrega o id e a
      // URL do post dele, porque o desfecho é por rede.
      return reply.send({
        ...presentActionWithTargets(action),
        approvals: approvals.map(presentApproval),
      });
    },
  );
};
