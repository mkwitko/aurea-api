import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  listWorkspaceAccounts,
  socialClientFactory,
  type SocialRoutesOptions,
} from '../social-accounts.service.js';
import { socialAccountsResponse } from './social-accounts.schema.js';

export const socialAccountsRoute: FastifyPluginAsync<SocialRoutesOptions> = async (app, opts) => {
  const clientFor = opts.social ?? socialClientFactory;

  app.withTypeProvider<ZodTypeProvider>().get(
    '/integrations/social/accounts',
    {
      schema: {
        tags: ['integrations'],
        operationId: 'listSocialAccounts',
        response: { 200: socialAccountsResponse },
      },
    },
    async (req, reply) => {
      // Sem `assertAdmin`: ler quais contas existem é informação de tela, e o
      // formulário de ação depende dela. Conectar e desconectar seguem sendo de
      // OWNER/ADMIN.
      const accounts = await listWorkspaceAccounts({ prisma: app.prisma, clientFor }, req.tenant.workspaceId);
      return reply.send({ accounts });
    },
  );
};
