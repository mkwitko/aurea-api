import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertAdmin } from '../../../../lib/tenant.js';
import { createActionsRepository } from '../actions.repository.js';
import { presentActionWithTargets } from '../actions.presenter.js';
import { actionIdParam, actionResponse } from '../actions.schema.js';
import { transitionActionService } from '../actions.transition.js';
import { rejectActionBody } from './reject-action.schema.js';

export const rejectActionRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/actions/:id/reject',
    {
      schema: {
        tags: ['actions'],
        operationId: 'rejectAction',
        params: actionIdParam,
        body: rejectActionBody,
        response: { 200: actionResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);
      const repo = createActionsRepository(app.prisma);

      // Volta para PROPOSED, e não para um estado morto: o fundador corrige o
      // texto e submete de novo, criando um segundo Approval. O histórico é a
      // lista de Approvals; `Action.status` é a verdade (spec §4.3).
      const action = await transitionActionService({ repo })({
        workspaceId: req.tenant.workspaceId,
        id: req.params.id,
        to: 'PROPOSED',
        write: (current) =>
          repo.review(req.tenant.workspaceId, current.id, {
            to: 'PROPOSED',
            approvalStatus: 'REJECTED',
            reviewedBy: req.tenant.userId,
            comment: req.body.comment,
            reviewedAt: new Date(),
          }),
      });

      return reply.send(presentActionWithTargets(action));
    },
  );
};
