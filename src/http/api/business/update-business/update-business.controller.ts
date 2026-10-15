import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createBusinessRepository } from '../business.repository.js';
import { businessCreatedResponse } from '../business.schema.js';
import { businessUpdateBody } from './update-business.schema.js';
import { updateBusinessService } from './update-business.service.js';

export const updateBusinessRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().patch(
    '/business',
    { schema: { tags: ['business'], operationId: 'updateBusiness', body: businessUpdateBody, response: { 200: businessCreatedResponse } } },
    async (req) => {
      const service = updateBusinessService({ repo: createBusinessRepository(app.prisma) });
      return { business: await service({ workspaceId: req.tenant.workspaceId, body: req.body }) };
    },
  );
};
