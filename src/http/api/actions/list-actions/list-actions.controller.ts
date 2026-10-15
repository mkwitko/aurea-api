import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createActionsRepository } from '../actions.repository.js';
import { presentActionListItem } from '../actions.presenter.js';
import { actionsListResponse } from '../actions.schema.js';
import { listActionsQuery } from './list-actions.schema.js';

export const listActionsRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/actions',
    {
      schema: {
        tags: ['actions'],
        operationId: 'listActions',
        querystring: listActionsQuery,
        response: { 200: actionsListResponse },
      },
    },
    async (req, reply) => {
      const rows = await createActionsRepository(app.prisma).list(req.tenant.workspaceId, {
        ...(req.query.status ? { status: req.query.status } : {}),
        ...(req.query.experimentId ? { experimentId: req.query.experimentId } : {}),
      });
      return reply.send({ actions: rows.map(presentActionListItem) });
    },
  );
};
