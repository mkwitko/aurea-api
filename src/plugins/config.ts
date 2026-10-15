import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

// Exposes validated env as app.config so plugins/services never touch process.env.
export default fp(async function configPlugin(app: FastifyInstance) {
  app.decorate('config', env);
});
