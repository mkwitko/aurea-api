import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { createIcpsRepository } from '../icps.repository.js';
import { presentIcp } from '../icps.presenter.js';
import { icpIdParam, icpResponse } from '../icps.schema.js';
import { icpCreateBody } from '../create-icp/create-icp.schema.js';

const icpUpdateBody = icpCreateBody.partial();

export const updateIcpRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().patch(
    '/icps/:id',
    { schema: { tags: ['icps'], operationId: 'updateIcp', params: icpIdParam, body: icpUpdateBody, response: { 200: icpResponse } } },
    async (req) => {
      const repo = createIcpsRepository(app.prisma);
      const existing = await repo.findById(req.tenant.workspaceId, req.params.id);
      if (!existing) throw new NotFoundError('ICP not found');
      return { icp: presentIcp(await repo.update(req.params.id, req.body)) };
    },
  );
};
