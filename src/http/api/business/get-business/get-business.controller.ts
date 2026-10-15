import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createBusinessRepository } from '../business.repository.js';
import { businessResponse } from '../business.schema.js';

export const getBusinessRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/business',
    { schema: { tags: ['business'], operationId: 'getBusiness', response: { 200: businessResponse } } },
    async (req) => {
      const repo = createBusinessRepository(app.prisma);
      return { business: await repo.getByWorkspace(req.tenant.workspaceId) };
    },
  );
};
