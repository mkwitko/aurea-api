import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createBusinessRepository } from '../business.repository.js';
import { presentContextVersion } from '../business.presenter.js';
import { contextVersionResponse } from '../business.schema.js';
import { contextUpdateBody } from './update-context.schema.js';
import { updateContextService } from './update-context.service.js';

export const updateContextRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().put(
    '/business/context',
    { schema: { tags: ['business'], operationId: 'updateBusinessContext', body: contextUpdateBody, response: { 200: contextVersionResponse } } },
    async (req) => {
      const service = updateContextService({ repo: createBusinessRepository(app.prisma) });
      const version = await service({
        ...req.body,
        workspaceId: req.tenant.workspaceId,
        userId: req.tenant.userId,
      });
      return { version: presentContextVersion(version) };
    },
  );
};
