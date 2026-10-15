import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertWriter } from '../../../../lib/tenant.js';
import { createActionsRepository } from '../actions.repository.js';
import { presentActionWithTargets } from '../actions.presenter.js';
import { actionIdParam, actionResponse } from '../actions.schema.js';
import { transitionActionService } from '../actions.transition.js';

export const submitActionRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/actions/:id/submit',
    {
      schema: {
        tags: ['actions'],
        operationId: 'submitAction',
        params: actionIdParam,
        response: { 200: actionResponse },
      },
    },
    async (req, reply) => {
      assertWriter(req.tenant);
      const repo = createActionsRepository(app.prisma);

      const action = await transitionActionService({ repo })({
        workspaceId: req.tenant.workspaceId,
        id: req.params.id,
        to: 'PENDING_APPROVAL',
        write: (current) => repo.submit(req.tenant.workspaceId, current.id, req.tenant.userId),
      });

      return reply.send(presentActionWithTargets(action));
    },
  );
};
