import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createDashboardRepository } from '../dashboard.repository.js';
import { dashboardResponse } from '../dashboard.schema.js';
import { getDashboardService } from './get-dashboard.service.js';

export const getDashboardRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/dashboard',
    { schema: { tags: ['dashboard'], operationId: 'getDashboard', response: { 200: dashboardResponse } } },
    async (req) => {
      const repo = createDashboardRepository(app.prisma);
      return getDashboardService({ repo })({ workspaceId: req.tenant.workspaceId, now: new Date() });
    },
  );
};
