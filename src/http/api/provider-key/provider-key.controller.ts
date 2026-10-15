import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { createProviderKeyRepository } from '../../../billing/provider-key.repository.js';
import { createProviderKeyService } from '../../../billing/provider-key.service.js';
import type { ProviderKeyStatus } from '../../../billing/provider-key.service.js';
import { verifyProviderKey } from '../../../billing/verify-provider-key.js';
import { assertAdmin } from '../../../lib/tenant.js';
import { providerKeyQuery, providerKeyResponse, putProviderKeyBody } from './provider-key.schema.js';

function present(status: ProviderKeyStatus) {
  if (!status.configured) return { configured: false as const };
  return {
    configured: true as const,
    provider: status.provider,
    last4: status.last4,
    createdAt: status.createdAt.toISOString(),
  };
}

export const providerKeyController: FastifyPluginAsync = async (app) => {
  const service = () =>
    createProviderKeyService({
      repo: createProviderKeyRepository(app.prisma),
      verify: verifyProviderKey,
    });

  const typed = app.withTypeProvider<ZodTypeProvider>();

  typed.get(
    '/ai/provider-key',
    {
      schema: {
        tags: ['provider-key'],
        operationId: 'getProviderKey',
        querystring: providerKeyQuery,
        response: { 200: providerKeyResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);
      return reply.send(present(await service().status(req.tenant.workspaceId, req.query.provider)));
    },
  );

  typed.put(
    '/ai/provider-key',
    {
      schema: {
        tags: ['provider-key'],
        operationId: 'putProviderKey',
        body: putProviderKeyBody,
        response: { 200: providerKeyResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);
      const status = await service().put({
        workspaceId: req.tenant.workspaceId,
        provider: req.body.provider,
        apiKey: req.body.apiKey,
        userId: req.tenant.userId,
      });
      return reply.send(present(status));
    },
  );

  typed.delete(
    '/ai/provider-key',
    {
      schema: {
        tags: ['provider-key'],
        operationId: 'deleteProviderKey',
        querystring: providerKeyQuery,
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);
      // Sem chave própria, os runs seguintes voltam a consumir crédito.
      await service().remove(req.tenant.workspaceId, req.query.provider);
      return reply.code(204).send();
    },
  );
};
