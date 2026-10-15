import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createAuthRepository } from '../auth.repository.js';
import { authResponse } from '../auth.schema.js';
import { issueRefreshToken } from '../auth.tokens.js';
import { loginBody } from './login.schema.js';
import { loginService } from './login.service.js';

export const loginRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/login',
    { schema: { tags: ['auth'], operationId: 'login', body: loginBody, response: { 200: authResponse } } },
    async (req) => {
      const repo = createAuthRepository(app.prisma);
      const user = await loginService({ repo })(req.body);
      const accessToken = app.jwt.sign({ sub: user.id, email: user.email });
      const refreshToken = await issueRefreshToken(repo, user.id);
      return { user: { id: user.id, email: user.email, name: user.name }, tokens: { accessToken, refreshToken } };
    },
  );
};
