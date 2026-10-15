import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Prisma } from '@prisma/client';
import { ActionNotEditableError, NotFoundError } from '../../../../lib/errors.js';
import { assertWriter } from '../../../../lib/tenant.js';
import { socialClientFactory, type SocialRoutesOptions } from '../../integrations/social-accounts.service.js';
import { resolveTargetAccounts } from '../actions.accounts.js';
import { assertOwnMedia } from '../actions.media.js';
import { assertPlatformsAcceptPayload } from '../actions.capabilities.js';
import { parseActionPayload } from '../actions.payload.js';
import { createActionsRepository } from '../actions.repository.js';
import { presentActionWithTargets } from '../actions.presenter.js';
import { actionIdParam, actionResponse } from '../actions.schema.js';
import { updateActionBody } from './update-action.schema.js';

export const updateActionRoute: FastifyPluginAsync<SocialRoutesOptions> = async (app, opts) => {
  const clientFor = opts.social ?? socialClientFactory;

  app.withTypeProvider<ZodTypeProvider>().patch(
    '/actions/:id',
    {
      schema: {
        tags: ['actions'],
        operationId: 'updateAction',
        params: actionIdParam,
        body: updateActionBody,
        response: { 200: actionResponse },
      },
    },
    async (req, reply) => {
      assertWriter(req.tenant);
      // A mesma guarda da criação: editar não é a porta dos fundos para uma URL
      // de imagem que não saiu do nosso upload.
      assertOwnMedia(req.tenant.workspaceId, req.body.payload?.media);
      const repo = createActionsRepository(app.prisma);

      const current = await repo.findById(req.tenant.workspaceId, req.params.id);
      if (!current) throw new NotFoundError('Action not found');

      // Editar depois de submetido mudaria o texto e as redes que o aprovador
      // leu, e aprovação sobre o que já não está lá não é aprovação. Código
      // próprio, e não 400 genérico: a tela sabe explicar este caso.
      if (current.status !== 'PROPOSED') throw new ActionNotEditableError();

      /**
       * A regra de capacidade vale sobre o **resultado** da edição, e não sobre o
       * que veio no corpo.
       *
       * Um PATCH pode mandar só `platforms`, ou só `payload`. Checar apenas o que
       * chegou abriria a porta dos fundos: criar um post de texto para o X e depois
       * acrescentar o YouTube num segundo PATCH, sem mídia e sem título.
       */
      const effectivePlatforms = req.body.platforms ?? current.targets.map((target) => target.platform);
      const effectivePayload = req.body.payload ?? parseActionPayload(current.type, current.payload);
      assertPlatformsAcceptPayload(effectivePlatforms, effectivePayload);

      // As redes novas são validadas como na criação: aceitar uma desconectada
      // aqui só falharia na publicação, depois de alguém aprovar.
      const accounts = req.body.platforms
        ? await resolveTargetAccounts({ prisma: app.prisma, clientFor }, req.tenant.workspaceId, req.body.platforms)
        : null;

      const data: Prisma.ActionUpdateInput = {
        ...(req.body.name !== undefined ? { name: req.body.name } : {}),
        ...(req.body.description !== undefined ? { description: req.body.description } : {}),
        ...(req.body.payload !== undefined ? { payload: req.body.payload } : {}),
      };

      const updated =
        Object.keys(data).length > 0 ? await repo.update(current.id, data) : current;

      // Os alvos por último: `replaceTargets` relê a ação inteira, então o
      // resultado dele já contém o que `update` acabou de escrever.
      const action =
        req.body.platforms && accounts
          ? await repo.replaceTargets(
              req.tenant.workspaceId,
              current.id,
              req.body.platforms.map((platform) => ({ platform, socialAccountId: accounts.get(platform)! })),
            )
          : updated;

      return reply.send(presentActionWithTargets(action));
    },
  );
};
