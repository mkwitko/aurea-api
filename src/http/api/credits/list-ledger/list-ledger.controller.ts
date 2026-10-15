import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { createCreditRepository } from '../../../../billing/credit.repository.js';
import { ledgerQuery, ledgerResponse } from '../credits.schema.js';
import { presentLedger } from '../credits.presenter.js';

export const listLedgerRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().get(
    '/credits/ledger',
    {
      schema: {
        tags: ['credits'],
        operationId: 'listCreditLedger',
        querystring: ledgerQuery,
        response: { 200: ledgerResponse },
      },
    },
    async (req, reply) => {
      const repo = createCreditRepository(app.prisma);
      const rows = await repo.listLedger(req.tenant.workspaceId, req.query.limit, req.query.before);
      return reply.send(presentLedger(rows));
    },
  );
};
