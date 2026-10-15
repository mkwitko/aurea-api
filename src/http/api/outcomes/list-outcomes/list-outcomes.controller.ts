import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { createOutcomesRepository } from '../outcomes.repository.js';
import { experimentIdParam, outcomeListResponse } from '../outcomes.schema.js';
import { presentOutcome } from '../outcomes.presenter.js';

export const listOutcomesRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/experiments/:id/outcomes',
    {
      schema: {
        tags: ['outcomes'],
        operationId: 'listOutcomes',
        params: experimentIdParam,
        response: { 200: outcomeListResponse },
      },
    },
    async (req) => {
      const repo = createOutcomesRepository(app.prisma);
      // 404 rather than an empty list for an experiment that is not this
      // tenant's: an empty list would say "no measurements yet" about something
      // the caller cannot see at all.
      const experiment = await repo.experimentInWorkspace(req.tenant.workspaceId, req.params.id);
      if (!experiment) throw new NotFoundError('Experiment not found');

      const outcomes = await repo.list(req.tenant.workspaceId, req.params.id);
      return {
        outcomes: outcomes.map((outcome) =>
          presentOutcome(outcome, {
            baselineValue: experiment.baselineValue,
            targetValue: experiment.targetValue,
          }),
        ),
      };
    },
  );
};
