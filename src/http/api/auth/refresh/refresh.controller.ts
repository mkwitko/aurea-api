import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createAuthRepository } from '../auth.repository.js';
import { refreshBody, tokensSchema } from '../auth.schema.js';
import { rotateRefreshToken } from '../auth.tokens.js';

export const refreshRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/refresh',
    { schema: { tags: ['auth'], operationId: 'refresh', body: refreshBody, response: { 200: tokensSchema } } },
    async (req) => {
      const repo = createAuthRepository(app.prisma);
      const { user, refreshToken } = await rotateRefreshToken(repo, req.body.refreshToken);
      const accessToken = app.jwt.sign({ sub: user.id, email: user.email });
      return { accessToken, refreshToken };
    },
  );
};
