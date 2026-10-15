import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createAuthRepository } from '../auth.repository.js';
import { refreshBody } from '../auth.schema.js';
import { revokeRefreshToken } from '../auth.tokens.js';

export const logoutRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/logout',
    { schema: { tags: ['auth'], operationId: 'logout', body: refreshBody } },
    async (req, reply) => {
      const repo = createAuthRepository(app.prisma);
      await revokeRefreshToken(repo, req.body.refreshToken);
      return reply.code(204).send();
    },
  );
};
