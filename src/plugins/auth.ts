import fp from 'fastify-plugin';
import fastifyJwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '../lib/errors.js';

// Registers JWT (access tokens) and exposes an `authenticate` preHandler.
// Refresh tokens are opaque and revocable — handled in the auth module, not here.
export default fp(async function authPlugin(app: FastifyInstance) {
  await app.register(fastifyJwt, {
    secret: app.config.JWT_ACCESS_SECRET,
    sign: { expiresIn: app.config.JWT_ACCESS_TTL },
  });

  app.decorate(
    'authenticate',
    async function (request: FastifyRequest, _reply: FastifyReply) {
      try {
        await request.jwtVerify();
      } catch {
        throw new UnauthorizedError('Invalid or expired token');
      }
    },
  );
});
