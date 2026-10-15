import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { assertAdmin } from '../../../../lib/tenant.js';
import { createIntegrationsRepository } from '../integrations.repository.js';
import { integrationQuery } from '../integrations.schema.js';
import { createIntegrationsService } from '../integrations.service.js';
import { verifyIntegration } from '../verify-integration.js';
import { revokeGoogleCredential } from '../google/google-client.js';

/**
 * O revogador entra por opção, não por decorator ambiente: um teste que
 * esquecesse de substituí-lo sairia falando com o Google de dentro da suíte.
 */
export type RemoveIntegrationOptions = { revoke?: (credentialsJson: string) => Promise<void> };

export const removeIntegrationRoute: FastifyPluginAsync<RemoveIntegrationOptions> = async (app, opts) => {
  const revoke = opts.revoke ?? revokeGoogleCredential;

  app.withTypeProvider<ZodTypeProvider>().delete(
    '/integrations',
    {
      schema: {
        tags: ['integrations'],
        operationId: 'removeIntegration',
        querystring: integrationQuery,
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);
      const service = createIntegrationsService({
        repo: createIntegrationsRepository(app.prisma),
        verify: verifyIntegration,
        revoke,
      });
      // Sem integração, os experimentos amarrados voltam ao caminho manual: a
      // amarração sobrevive, e a proposta de medição passa a recusar por falta
      // de fonte. Nada de apagar binding em cascata aqui.
      await service.remove(req.tenant.workspaceId, req.query.provider);
      return reply.code(204).send();
    },
  );
};
