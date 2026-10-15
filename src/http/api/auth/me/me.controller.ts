import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { createAuthRepository } from '../auth.repository.js';
import { meResponse } from '../auth.schema.js';

export const meRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/me',
    { preHandler: [app.authenticate], schema: { tags: ['auth'], operationId: 'me', response: { 200: meResponse } } },
    async (req) => {
      const repo = createAuthRepository(app.prisma);
      const user = await repo.userById(req.user.sub);
      if (!user) throw new NotFoundError('User not found');
      return {
        user: { id: user.id, email: user.email, name: user.name },
        memberships: user.memberships.map((m) => ({
          organizationId: m.organizationId,
          workspaceId: m.workspaceId,
          role: m.role,
        })),
      };
    },
  );
};
