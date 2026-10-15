import type { FastifyPluginAsync } from 'fastify';
import { cancelAgentRunRoute } from './cancel-agent-run/cancel-agent-run.controller.js';
import { createAgentRunRoute } from './create-agent-run/create-agent-run.controller.js';
import { getAgentRunRoute } from './get-agent-run/get-agent-run.controller.js';
import { listAgentRunsRoute } from './list-agent-runs/list-agent-runs.controller.js';

/** Registers all `agent-runs` routes. Auth + tenant resolution applied at this scope. */
export const agentRunsRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.resolveTenant);
  // denyReadOnly retorna cedo para GET/HEAD/OPTIONS: um VIEWER pode acompanhar
  // runs, só não pode iniciar um.
  app.addHook('preHandler', app.denyReadOnly);

  await app.register(createAgentRunRoute);
  await app.register(cancelAgentRunRoute);
  await app.register(getAgentRunRoute);
  await app.register(listAgentRunsRoute);
};
