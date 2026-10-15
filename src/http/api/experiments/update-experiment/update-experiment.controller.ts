import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { ExperimentStatus } from '@prisma/client';
import { MeasurementFrozenError, NotFoundError } from '../../../../lib/errors.js';
import { createExperimentsRepository } from '../experiments.repository.js';
import { experimentCreateBody } from '../create-experiment/create-experiment.schema.js';
import { experimentIdParam, experimentResponse } from '../experiments.schema.js';

const experimentUpdateBody = experimentCreateBody.omit({ hypothesisId: true }).partial();

/**
 * What the experiment measures and what would count as winning. Editable only
 * while the experiment is still being designed: per docs/domains/experiments.md
 * §13, "Success Criteria must be defined before the Experiment runs. Defining
 * success after seeing results invalidates the test." Everything else — name,
 * description, objective, channel, audience, dates — stays editable, because
 * fixing a typo in the audience is not moving the goalposts.
 */
const MEASUREMENT_FIELDS = ['metric', 'baselineValue', 'targetValue', 'successCriteria'] as const;

/** Design phase. From APPROVED on, the experiment is committed to. */
const DESIGN_STATUSES: ReadonlySet<ExperimentStatus> = new Set(['DRAFT', 'PLANNED']);

export const updateExperimentRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().patch(
    '/experiments/:id',
    { schema: { tags: ['experiments'], operationId: 'updateExperiment', params: experimentIdParam, body: experimentUpdateBody, response: { 200: experimentResponse } } },
    async (req) => {
      const repo = createExperimentsRepository(app.prisma);
      const existing = await repo.findById(req.tenant.workspaceId, req.params.id);
      if (!existing) throw new NotFoundError('Experiment not found');

      const touchesMeasurement = MEASUREMENT_FIELDS.some((field) => req.body[field] !== undefined);
      if (touchesMeasurement && !DESIGN_STATUSES.has(existing.status)) throw new MeasurementFrozenError();

      return { experiment: await repo.update(req.params.id, req.body) };
    },
  );
};
