import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createIcpsRepository } from '../icps.repository.js';
import { presentIcp } from '../icps.presenter.js';
import { icpListResponse } from '../icps.schema.js';

export const listIcpsRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/icps',
    { schema: { tags: ['icps'], operationId: 'listIcps', response: { 200: icpListResponse } } },
    async (req) => {
      const repo = createIcpsRepository(app.prisma);
      const rows = await repo.list(req.tenant.workspaceId);
      return { icps: rows.map(presentIcp) };
    },
  );
};
