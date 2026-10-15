import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { createIcpsRepository } from '../icps.repository.js';
import { presentIcp } from '../icps.presenter.js';
import { icpIdParam, icpResponse } from '../icps.schema.js';

export const getIcpRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/icps/:id',
    { schema: { tags: ['icps'], operationId: 'getIcp', params: icpIdParam, response: { 200: icpResponse } } },
    async (req) => {
      const repo = createIcpsRepository(app.prisma);
      const icp = await repo.findById(req.tenant.workspaceId, req.params.id);
      if (!icp) throw new NotFoundError('ICP not found');
      return { icp: presentIcp(icp) };
    },
  );
};
