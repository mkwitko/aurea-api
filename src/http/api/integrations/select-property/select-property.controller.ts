import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createGa4Provider, minterFor } from '../../../../integrations/analytics/index.js';
import { NotFoundError } from '../../../../lib/errors.js';
import { assertAdmin } from '../../../../lib/tenant.js';
import { createIntegrationsRepository } from '../integrations.repository.js';
import { integrationResponse } from '../integrations.schema.js';
import { openIntegrationCredential } from '../integrations.service.js';
import { selectPropertyBody } from './select-property.schema.js';

/** Uma credencial guardada + uma property = dá para ler? */
export type PropertyCheck = (
  row: { authKind: string; ciphertext: Uint8Array; iv: Uint8Array; authTag: Uint8Array },
  propertyId: string,
  signal: AbortSignal,
) => Promise<{ ok: true } | { ok: false; reason: string }>;

export type SelectPropertyOptions = { check?: PropertyCheck };

const TIMEOUT_MS = 10_000;
const PROVIDER = 'GA4';

/**
 * A verificação real, e ela **é** a validação da property: se a conta não vê
 * aquela property, o `health()` falha. Uma segunda ida à lista de properties
 * custaria outra chamada para responder pior.
 */
const checkWithSource: PropertyCheck = async (row, propertyId, signal) => {
  try {
    const provider = createGa4Provider({
      propertyId,
      mintToken: minterFor(row.authKind, openIntegrationCredential(row)),
    });
    await provider.health(signal);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'unknown error' };
  }
};

export const selectPropertyRoute: FastifyPluginAsync<SelectPropertyOptions> = async (app, opts) => {
  const check = opts.check ?? checkWithSource;

  app.withTypeProvider<ZodTypeProvider>().put(
    '/integrations/google/property',
    {
      schema: {
        tags: ['integrations'],
        operationId: 'selectGoogleProperty',
        body: selectPropertyBody,
        response: { 200: integrationResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);

      const repo = createIntegrationsRepository(app.prisma);
      const row = await repo.find(req.tenant.workspaceId, PROVIDER);
      if (!row) throw new NotFoundError('No data source is connected');

      const verified = await check(row, req.body.propertyId, AbortSignal.timeout(TIMEOUT_MS));

      // Grava nos dois casos, e é de propósito: uma property que não responde
      // ainda é a escolha do fundador, e `FAILED` com a mensagem da fonte é o
      // que permite a tela explicar. Perder a escolha o obrigaria a escolher de
      // novo sem saber o que deu errado.
      const integration = await repo.setProperty(row.id, req.body.propertyId, {
        status: verified.ok ? 'OK' : 'FAILED',
        lastError: verified.ok ? null : verified.reason,
        checkedAt: new Date(),
      });

      return reply.send({ integration });
    },
  );
};
