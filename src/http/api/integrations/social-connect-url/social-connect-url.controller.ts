import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { SocialRequestFailedError } from '../../../../lib/errors.js';
import { assertAdmin } from '../../../../lib/tenant.js';
import {
  ensureSocialIntegration,
  socialClientFactory,
  type SocialRoutesOptions,
} from '../social-accounts.service.js';
import { socialConnectUrlBody, socialConnectUrlResponse } from './social-connect-url.schema.js';

const TIMEOUT_MS = 15_000;

/**
 * A URL que leva o cliente ao consentimento de **uma** rede.
 *
 * `POST` e não `GET` porque cria estado do outro lado — um fluxo de OAuth
 * pendente — e porque leva body.
 */
export const socialConnectUrlRoute: FastifyPluginAsync<SocialRoutesOptions> = async (app, opts) => {
  const clientFor = opts.social ?? socialClientFactory;

  app.withTypeProvider<ZodTypeProvider>().post(
    '/integrations/social/connect-url',
    {
      schema: {
        tags: ['integrations'],
        operationId: 'createSocialConnectUrl',
        body: socialConnectUrlBody,
        response: { 201: socialConnectUrlResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);

      const client = clientFor();
      // O `external_id` vem do workspace do token, nunca de entrada do usuário: é
      // ele que amarra a conta autorizada a este cliente, e a chave do provider é
      // a mesma para todos (spec de migração §4).
      const { externalId } = await ensureSocialIntegration(app.prisma, req.tenant.workspaceId, req.tenant.userId);

      try {
        const link = await client.connectUrl(
          {
            platform: req.body.platform,
            externalId,
            // Bluesky: as credenciais atravessam para o provider e não ficam aqui.
            // Nomeadas campo a campo, e nunca espalhando `req.body`, para nenhum
            // campo novo do corpo viajar por acidente.
            ...(req.body.handle && req.body.appPassword
              ? { credentials: { handle: req.body.handle, appPassword: req.body.appPassword } }
              : {}),
          },
          AbortSignal.timeout(TIMEOUT_MS),
        );
        return reply.code(201).send(link);
      } catch (error) {
        // A mensagem do provider chega ao fundador: ela diz o que fazer, e um
        // "não foi possível gerar o link" não diz nada.
        throw new SocialRequestFailedError({
          reason: error instanceof Error ? error.message : 'unknown error',
        });
      }
    },
  );
};
