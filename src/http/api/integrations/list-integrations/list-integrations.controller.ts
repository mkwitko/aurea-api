import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertAdmin } from '../../../../lib/tenant.js';
import { createIntegrationsRepository } from '../integrations.repository.js';
import { integrationListResponse } from '../integrations.schema.js';

export const listIntegrationsRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/integrations',
    {
      schema: {
        tags: ['integrations'],
        operationId: 'listIntegrations',
        response: { 200: integrationListResponse },
      },
    },
    async (req, reply) => {
      // Credencial de fonte externa é assunto de admin, como a chave de IA.
      assertAdmin(req.tenant);
      const integrations = await createIntegrationsRepository(app.prisma).list(req.tenant.workspaceId);
      return reply.send({ integrations });
    },
  );
};
