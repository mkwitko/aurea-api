import type { FastifyPluginAsync } from 'fastify';
import { createOutcomeRoute, type CreateOutcomeOptions } from './create-outcome/create-outcome.controller.js';
import { listOutcomesRoute } from './list-outcomes/list-outcomes.controller.js';

/** Registers all `outcomes` routes. Auth, tenant and the read-only guard apply here. */
export const outcomesRoutes: FastifyPluginAsync<CreateOutcomeOptions> = async (app, opts) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.resolveTenant);
  app.addHook('preHandler', app.denyReadOnly);

  await app.register(listOutcomesRoute);
  // O leitor viaja como opção para o teste poder substituí-lo. Sem opção, o
  // leitor real é usado.
  await app.register(createOutcomeRoute, { read: opts.read });
};
