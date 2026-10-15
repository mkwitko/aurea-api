import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createBusinessRepository } from '../business.repository.js';
import { presentContextVersion } from '../business.presenter.js';
import { contextVersionResponse } from '../business.schema.js';
import { updateSectionService } from './update-section.service.js';
import { updateSectionBody } from './update-section.schema.js';

export const updateSectionRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().put(
    '/business/context/section',
    {
      schema: {
        tags: ['business'],
        operationId: 'updateBusinessContextSection',
        body: updateSectionBody,
        response: { 200: contextVersionResponse },
      },
    },
    async (req, reply) => {
      // Nada de .parse() aqui: o schema da rota já validou e estreitou o body,
      // e um erro nele volta como 400 VALIDATION com details por campo.
      const service = updateSectionService({ repo: createBusinessRepository(app.prisma) });
      const version = await service({
        workspaceId: req.tenant.workspaceId,
        userId: req.tenant.userId,
        body: req.body,
      });

      return reply.send({ version: presentContextVersion(version) });
    },
  );
};
