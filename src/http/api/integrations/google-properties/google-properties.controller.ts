import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { listGa4Properties, minterFor } from '../../../../integrations/analytics/index.js';
import { BadRequestError, NotFoundError } from '../../../../lib/errors.js';
import { assertAdmin } from '../../../../lib/tenant.js';
import { createIntegrationsRepository } from '../integrations.repository.js';
import { openIntegrationCredential } from '../integrations.service.js';
import { googlePropertiesResponse } from './google-properties.schema.js';

export type GooglePropertiesOptions = { list?: typeof listGa4Properties };

/** Uma listagem de metadata, não um relatório. */
const TIMEOUT_MS = 10_000;

const PROVIDER = 'GA4';

/**
 * Funciona para os dois `authKind`: uma service account com acesso concedido
 * também enxerga account summaries. Não é exclusiva do OAuth porque não precisa
 * ser, e assim "trocar de property" existe nos dois caminhos.
 */
export const googlePropertiesRoute: FastifyPluginAsync<GooglePropertiesOptions> = async (app, opts) => {
  const list = opts.list ?? listGa4Properties;

  app.withTypeProvider<ZodTypeProvider>().get(
    '/integrations/google/properties',
    {
      schema: {
        tags: ['integrations'],
        operationId: 'listGoogleProperties',
        response: { 200: googlePropertiesResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);

      const row = await createIntegrationsRepository(app.prisma).find(req.tenant.workspaceId, PROVIDER);
      if (!row) throw new NotFoundError('No data source is connected');

      try {
        const result = await list(
          minterFor(row.authKind, openIntegrationCredential(row)),
          AbortSignal.timeout(TIMEOUT_MS),
        );
        return reply.send(result);
      } catch (error) {
        // A mensagem da própria fonte: "Caller does not have permission" diz ao
        // fundador o que fazer.
        throw new BadRequestError(error instanceof Error ? error.message : 'could not list the properties');
      }
    },
  );
};
