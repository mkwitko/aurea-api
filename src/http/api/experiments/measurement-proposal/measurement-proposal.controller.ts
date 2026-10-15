import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createMeasurementReader, type MeasurementReader } from '../../../../measurement/read-measurement.js';
import { experimentIdParam } from '../experiments.schema.js';
import { measurementProposalResponse } from './measurement-proposal.schema.js';

/**
 * O leitor entra por opção de plugin, não por decorator no `app` — mesma razão
 * de `put-integration.controller.ts`: um teste que esquecesse de decorá-lo
 * cairia no leitor real e sairia chamando o Google de dentro da suíte.
 */
export type MeasurementProposalOptions = { read?: MeasurementReader };

/** Um relatório é mais caro que um metadata; ainda assim, tem teto. */
const TIMEOUT_MS = 20_000;

export const measurementProposalRoute: FastifyPluginAsync<MeasurementProposalOptions> = async (app, opts) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/experiments/:id/measurement-proposal',
    {
      schema: {
        tags: ['experiments'],
        operationId: 'getMeasurementProposal',
        params: experimentIdParam,
        response: { 200: measurementProposalResponse },
      },
    },
    async (req, reply) => {
      const read = opts.read ?? createMeasurementReader({ prisma: app.prisma });
      const reading = await read(req.tenant.workspaceId, req.params.id, AbortSignal.timeout(TIMEOUT_MS));
      return reply.send(reading);
    },
  );
};
