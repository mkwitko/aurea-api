import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createAuthRepository } from '../auth.repository.js';
import { authResponse } from '../auth.schema.js';
import { issueRefreshToken } from '../auth.tokens.js';
import { registerBody } from './register.schema.js';
import { registerService } from './register.service.js';

export const registerRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/register',
    { schema: { tags: ['auth'], operationId: 'register', body: registerBody, response: { 201: authResponse } } },
    async (req, reply) => {
      const repo = createAuthRepository(app.prisma);
      const user = await registerService({ repo })(req.body);
      const accessToken = app.jwt.sign({ sub: user.id, email: user.email });
      const refreshToken = await issueRefreshToken(repo, user.id);
      return reply.code(201).send({
        user: { id: user.id, email: user.email, name: user.name },
        tokens: { accessToken, refreshToken },
      });
    },
  );
};
