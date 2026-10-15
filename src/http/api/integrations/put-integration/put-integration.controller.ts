import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { assertAdmin } from '../../../../lib/tenant.js';
import { createIntegrationsRepository } from '../integrations.repository.js';
import { integrationResponse } from '../integrations.schema.js';
import { createIntegrationsService, type VerifyIntegration } from '../integrations.service.js';
import { verifyIntegration } from '../verify-integration.js';
import { putIntegrationBody } from './put-integration.schema.js';

/**
 * O verificador entra por opção de plugin, não por decorator no `app`.
 *
 * Um decorator ambiente (`app.verifyIntegration`) parece mais barato, mas cria
 * um seam invisível: um teste futuro que esqueça de decorá-lo — ou erre o nome —
 * cai no verificador real e sai chamando o Google de dentro da suíte. Como
 * opção, quem registra a rota é obrigado a decidir, e o default fica explícito
 * num lugar só.
 */
export type PutIntegrationOptions = { verify?: VerifyIntegration };

export const putIntegrationRoute: FastifyPluginAsync<PutIntegrationOptions> = async (app, opts) => {
  const verify = opts.verify ?? verifyIntegration;

  app.withTypeProvider<ZodTypeProvider>().put(
    '/integrations',
    {
      schema: {
        tags: ['integrations'],
        operationId: 'putIntegration',
        body: putIntegrationBody,
        response: { 200: integrationResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);
      const service = createIntegrationsService({ repo: createIntegrationsRepository(app.prisma), verify });

      const integration = await service.put({
        ...req.body,
        // O workspace vem do tenant. Um `workspaceId` no corpo é ignorado, não
        // respeitado.
        workspaceId: req.tenant.workspaceId,
        userId: req.tenant.userId,
      });

      return reply.send({ integration });
    },
  );
};
