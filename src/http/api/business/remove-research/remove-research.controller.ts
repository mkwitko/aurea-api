import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createBusinessRepository } from '../business.repository.js';
import { presentContextVersion } from '../business.presenter.js';
import { removeResearchBody, removeResearchResponse } from './remove-research.schema.js';
import { createRemoveResearchService } from './remove-research.service.js';

export const removeResearchRoute: FastifyPluginAsync = async (app) => {
  // DELETE com corpo: a carga é uma seleção (um run e os índices dentro dele),
  // não um recurso identificável por url, e é exatamente a mesma carga do
  // aceite. Uma url por achado inventaria ids que nenhum lado guarda.
  app.withTypeProvider<ZodTypeProvider>().delete(
    '/business/context/from-research',
    {
      schema: {
        tags: ['business'],
        operationId: 'removeContextVersionFromResearch',
        body: removeResearchBody,
        response: { 200: removeResearchResponse },
      },
    },
    async (req, reply) => {
      const service = createRemoveResearchService({
        repo: createBusinessRepository(app.prisma),
        findRun: (id, workspaceId) => app.prisma.agentRun.findFirst({ where: { id, workspaceId } }),
      });

      const result = await service({
        ...req.body,
        workspaceId: req.tenant.workspaceId,
        userId: req.tenant.userId,
      });

      return reply.send({
        ...result,
        version: result.version ? presentContextVersion(result.version) : null,
      });
    },
  );
};
