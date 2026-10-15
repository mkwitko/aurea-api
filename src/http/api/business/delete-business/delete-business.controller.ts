import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createBusinessRepository } from '../business.repository.js';
import { deleteBusinessService } from './delete-business.service.js';

export const deleteBusinessRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().delete(
    '/business',
    {
      schema: {
        tags: ['business'],
        operationId: 'deleteBusiness',
        response: { 200: z.object({ ok: z.literal(true) }) },
      },
    },
    async (req, reply) => {
      const service = deleteBusinessService({ repo: createBusinessRepository(app.prisma) });
      await service({ workspaceId: req.tenant.workspaceId });
      return reply.send({ ok: true });
    },
  );
};
