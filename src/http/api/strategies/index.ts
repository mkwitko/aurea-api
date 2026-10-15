import type { FastifyPluginAsync } from 'fastify';
import { activateStrategyRoute } from './activate-strategy/activate-strategy.controller.js';
import { approveStrategyRoute } from './approve-strategy/approve-strategy.controller.js';
import { archiveStrategyRoute } from './archive-strategy/archive-strategy.controller.js';
import { createFromProposalRoute } from './create-from-proposal/create-from-proposal.controller.js';
import { createStrategyRoute } from './create-strategy/create-strategy.controller.js';
import { getStrategyRoute } from './get-strategy/get-strategy.controller.js';
import { listStrategiesRoute } from './list-strategies/list-strategies.controller.js';
import { pauseStrategyRoute } from './pause-strategy/pause-strategy.controller.js';
import { planExperimentsRoute } from './plan-experiments/plan-experiments.controller.js';
import { proposalDraftRoute } from './proposal-draft/proposal-draft.controller.js';
import { proposalUsageRoute } from './proposal-usage/proposal-usage.controller.js';
import { proposeStrategyRoute } from './propose-strategy/propose-strategy.controller.js';
import { updateStrategyRoute } from './update-strategy/update-strategy.controller.js';

export const strategiesRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.resolveTenant);
  app.addHook('preHandler', app.denyReadOnly);

  await app.register(listStrategiesRoute);
  await app.register(getStrategyRoute);
  await app.register(createStrategyRoute);
  await app.register(createFromProposalRoute);
  await app.register(proposalDraftRoute);
  await app.register(proposalUsageRoute);
  await app.register(planExperimentsRoute);
  await app.register(updateStrategyRoute);
  await app.register(proposeStrategyRoute);
  await app.register(approveStrategyRoute);
  await app.register(activateStrategyRoute);
  await app.register(pauseStrategyRoute);
  await app.register(archiveStrategyRoute);
};
