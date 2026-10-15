import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createIcpsRepository } from '../icps.repository.js';
import { presentIcp } from '../icps.presenter.js';
import { icpResponse } from '../icps.schema.js';
import { icpCreateBody } from './create-icp.schema.js';

export const createIcpRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/icps',
    { schema: { tags: ['icps'], operationId: 'createIcp', body: icpCreateBody, response: { 201: icpResponse } } },
    async (req, reply) => {
      const repo = createIcpsRepository(app.prisma);
      const icp = await repo.create(req.tenant.workspaceId, req.body);
      return reply.code(201).send({ icp: presentIcp(icp) });
    },
  );
};
