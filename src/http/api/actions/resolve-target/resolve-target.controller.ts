import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ActionNotResolvableError, NotFoundError, SocialNotConnectedError } from '../../../../lib/errors.js';
import { assertAdmin } from '../../../../lib/tenant.js';
import { findSocialIntegration } from '../../integrations/social-accounts.service.js';
import { createActionsRepository } from '../actions.repository.js';
import { presentActionWithTargets } from '../actions.presenter.js';
import { actionResponse, actionTargetParams } from '../actions.schema.js';
import { resolveTargetBody } from './resolve-target.schema.js';

/**
 * A saída da entrega incerta, alvo por alvo, e ela é **a única**.
 *
 * O provider não tem endpoint de retry, então não existe id que ele reconheça
 * para "retentar o que falhou": um alvo incerto sai daqui ou não sai. Quem sabe se
 * o post existe é quem olha a rede (spec de migração §2.5).
 */
export const resolveTargetRoute: FastifyPluginAsync = async (app) => {
  app.withTypeProvider<ZodTypeProvider>().post(
    '/actions/:id/targets/:targetId/resolve',
    {
      schema: {
        tags: ['actions'],
        operationId: 'resolveActionTarget',
        params: actionTargetParams,
        body: resolveTargetBody,
        response: { 200: actionResponse },
      },
    },
    async (req, reply) => {
      assertAdmin(req.tenant);
      const { workspaceId } = req.tenant;
      const repo = createActionsRepository(app.prisma);

      // Os três ids sempre juntos: o do alvo, o da ação e o do workspace. Um alvo
      // que existe mas é de outra ação lê como ausente.
      const target = await repo.findTarget(workspaceId, req.params.id, req.params.targetId);
      if (!target) throw new NotFoundError('Action target not found');

      // 409 com código próprio: o alvo existe e o pedido está bem formado — o que
      // não existe é uma decisão pendente sobre entrega.
      if (target.status !== 'DELIVERY_UNKNOWN') throw new ActionNotResolvableError();

      if (req.body.outcome === 'NOT_PUBLISHED') {
        const action = await repo.resolveTarget(workspaceId, target, { outcome: 'NOT_PUBLISHED' });
        return reply.send(presentActionWithTargets(action));
      }

      const integration = await findSocialIntegration(app.prisma, workspaceId);
      // A proveniência precisa de uma integração a que se pendurar. Sem ela, o
      // `ExternalReference` não teria dono.
      if (!integration) throw new SocialNotConnectedError();

      const action = await repo.resolveTarget(workspaceId, target, {
        outcome: 'PUBLISHED',
        integrationId: integration.integrationId,
        externalId: req.body.externalId ?? null,
        now: new Date(),
      });

      return reply.send(presentActionWithTargets(action));
    },
  );
};
