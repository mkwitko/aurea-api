import type { FastifyPluginAsync } from 'fastify';
import { approveExperimentRoute } from './approve-experiment/approve-experiment.controller.js';
import { cancelExperimentRoute } from './cancel-experiment/cancel-experiment.controller.js';
import { completeExperimentRoute } from './complete-experiment/complete-experiment.controller.js';
import { createExperimentRoute } from './create-experiment/create-experiment.controller.js';
import { experimentFromProposalRoute } from './from-proposal/from-proposal.controller.js';
import { getExperimentRoute } from './get-experiment/get-experiment.controller.js';
import { getMetricBindingRoute } from './get-metric-binding/get-metric-binding.controller.js';
import { listExperimentsRoute } from './list-experiments/list-experiments.controller.js';
import {
  measurementProposalRoute,
  type MeasurementProposalOptions,
} from './measurement-proposal/measurement-proposal.controller.js';
import { pauseExperimentRoute } from './pause-experiment/pause-experiment.controller.js';
import { planExperimentRoute } from './plan-experiment/plan-experiment.controller.js';
import { putMetricBindingRoute } from './put-metric-binding/put-metric-binding.controller.js';
import { removeMetricBindingRoute } from './remove-metric-binding/remove-metric-binding.controller.js';
import { startExperimentRoute } from './start-experiment/start-experiment.controller.js';
import { updateExperimentRoute } from './update-experiment/update-experiment.controller.js';

export const experimentsRoutes: FastifyPluginAsync<MeasurementProposalOptions> = async (app, opts) => {
  app.addHook('preHandler', app.authenticate);
  app.addHook('preHandler', app.resolveTenant);
  app.addHook('preHandler', app.denyReadOnly);

  await app.register(listExperimentsRoute);
  await app.register(getExperimentRoute);
  await app.register(createExperimentRoute);
  await app.register(experimentFromProposalRoute);
  await app.register(updateExperimentRoute);
  await app.register(planExperimentRoute);
  await app.register(approveExperimentRoute);
  await app.register(startExperimentRoute);
  await app.register(pauseExperimentRoute);
  await app.register(completeExperimentRoute);
  await app.register(cancelExperimentRoute);
  await app.register(getMetricBindingRoute);
  await app.register(putMetricBindingRoute);
  await app.register(removeMetricBindingRoute);
  // O leitor viaja como opção para o teste poder substituí-lo. Sem opção, o
  // leitor real é usado.
  await app.register(measurementProposalRoute, { read: opts.read });
};
