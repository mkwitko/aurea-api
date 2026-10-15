import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { createBusinessRepository } from '../business.repository.js';
import { presentContextVersion } from '../business.presenter.js';
import { contextResponse } from '../business.schema.js';

export const getContextRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/business/context',
    { schema: { tags: ['business'], operationId: 'getBusinessContext', response: { 200: contextResponse } } },
    async (req) => {
      const repo = createBusinessRepository(app.prisma);
      const business = await repo.getByWorkspace(req.tenant.workspaceId);
      if (!business) throw new NotFoundError('No business in this workspace');
      const context = await repo.getContext(business.id);
      return { currentVersion: context?.currentVersion ? presentContextVersion(context.currentVersion) : null };
    },
  );
};
