import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createBusinessRepository } from '../business.repository.js';
import { businessCreatedResponse } from '../business.schema.js';
import { businessCreateBody } from './create-business.schema.js';
import { createBusinessService } from './create-business.service.js';

export const createBusinessRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/business',
    { schema: { tags: ['business'], operationId: 'createBusiness', body: businessCreateBody, response: { 201: businessCreatedResponse } } },
    async (req, reply) => {
      const service = createBusinessService({ repo: createBusinessRepository(app.prisma) });
      const business = await service({ ...req.body, workspaceId: req.tenant.workspaceId });
      return reply.code(201).send({ business });
    },
  );
};
