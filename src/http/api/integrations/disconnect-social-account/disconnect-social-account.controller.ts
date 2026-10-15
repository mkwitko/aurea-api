import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { NotFoundError, SocialRequestFailedError } from '../../../../lib/errors.js';
import { assertAdmin } from '../../../../lib/tenant.js';
import {
  listWorkspaceAccounts,
  socialClientFactory,
  type SocialRoutesOptions,
} from '../social-accounts.service.js';

const TIMEOUT_MS = 15_000;

/**
 * Desconecta **uma** conta.
 *
 * Não existe "desconectar tudo": conectar é por conta, e um botão global viraria N
 * chamadas com uma promessa de atomicidade que não temos.
 *
 * O provider apaga os tokens e **preserva o registro** da conta. `Action`,
 * `ActionTarget` e `ExternalReference` também ficam: desconectar não despublica
 * nada, e apagar o histórico faria a AUREA esquecer um post que existe.
 */
export const disconnectSocialAccountRoute: FastifyPluginAsync<SocialRoutesOptions> = async (app, opts) => {
  const clientFor = opts.social ?? socialClientFactory;

  app.withTypeProvider<ZodTypeProvider>().post(
    '/integrations/social/accounts/:accountId/disconnect',
    {
      schema: {
        tags: ['integrations'],
        operationId: 'disconnectSocialAccount',
        params: z.object({ accountId: z.string().min(1).max(200) }),
        response: { 204: z.null() },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);

      // A conta tem de estar na lista **deste** workspace. Sem esta leitura, um id
      // de conta de outro cliente seria desconectado por quem o adivinhasse — a
      // chave do provider é a mesma para todos (spec de migração §4).
      const accounts = await listWorkspaceAccounts({ prisma: app.prisma, clientFor }, req.tenant.workspaceId);
      const account = accounts.find((candidate) => candidate.id === req.params.accountId);
      // 404 e não 403: uma conta de outro workspace é indistinguível de
      // inexistente.
      if (!account) throw new NotFoundError('Social account not found');

      try {
        await clientFor().disconnect(account.id, AbortSignal.timeout(TIMEOUT_MS));
      } catch (error) {
        throw new SocialRequestFailedError({
          reason: error instanceof Error ? error.message : 'unknown error',
        });
      }

      return reply.code(204).send(null);
    },
  );
};
