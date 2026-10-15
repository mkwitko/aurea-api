import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createBusinessRepository } from '../business.repository.js';
import { presentContextVersion } from '../business.presenter.js';
import { fromResearchBody, fromResearchResponse } from './context-from-research.schema.js';
import { createFromResearchService } from './context-from-research.service.js';

export const contextFromResearchRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/business/context/from-research',
    {
      schema: {
        tags: ['business'],
        operationId: 'createContextVersionFromResearch',
        body: fromResearchBody,
        response: { 201: fromResearchResponse },
      },
    },
    async (req, reply) => {
      const service = createFromResearchService({
        repo: createBusinessRepository(app.prisma),
        // Run de outro workspace é indistinguível de inexistente.
        findRun: (id, workspaceId) => app.prisma.agentRun.findFirst({ where: { id, workspaceId } }),
      });

      const result = await service({
        ...req.body,
        workspaceId: req.tenant.workspaceId,
        userId: req.tenant.userId,
      });

      // 201 continua sendo 201 mesmo quando nada foi criado: o cliente lê
      // `created`. Trocar o status por 200 aqui quebraria todo cliente que
      // afirma 201 para um aceite bem-sucedido, e o aceite foi bem-sucedido —
      // o contexto está exatamente como o fundador pediu.
      return reply.code(201).send({ ...result, version: presentContextVersion(result.version) });
    },
  );
};
