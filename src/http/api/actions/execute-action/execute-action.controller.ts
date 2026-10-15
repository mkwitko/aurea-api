import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  ActionNothingToPublishError,
  ConflictError,
  NotFoundError,
  SocialNotConnectedError,
} from '../../../../lib/errors.js';
import { assertAdmin } from '../../../../lib/tenant.js';
import { assertActionTransition } from '../actions.domain.js';
import { PUBLISHABLE_TARGET } from '../actions.targets.js';
import { findSocialIntegration } from '../../integrations/social-accounts.service.js';
import { createActionsRepository } from '../actions.repository.js';
import { presentActionWithTargets } from '../actions.presenter.js';
import { actionIdParam, actionResponse } from '../actions.schema.js';
import { enqueueActionExecution, type ActionExecutionJob } from '../../../../actions/queue.js';

/** A fila entra por opção: sem isso um teste abriria conexão com o Redis. */
export type ExecuteActionOptions = { enqueue?: (job: ActionExecutionJob) => Promise<void> };

export const executeActionRoute: FastifyPluginAsync<ExecuteActionOptions> = async (app, opts) => {
  const enqueue = opts.enqueue ?? enqueueActionExecution;

  app.withTypeProvider<ZodTypeProvider>().post(
    '/actions/:id/execute',
    {
      schema: {
        tags: ['actions'],
        operationId: 'executeAction',
        params: actionIdParam,
        response: { 202: actionResponse },
      },
    },
    async (req, reply) => {
      // Executar é o ato que sai para o mundo: exige aprovador, não escritor.
      assertAdmin(req.tenant);
      const { workspaceId } = req.tenant;
      const repo = createActionsRepository(app.prisma);

      const current = await repo.findById(workspaceId, req.params.id);
      if (!current) throw new NotFoundError('Action not found');
      // A mensagem nomeada vem daqui: sem esta checagem, executar uma ação em
      // PROPOSED cairia no 409 genérico do compare-and-swap e o fundador leria
      // "conflito" onde o problema é falta de aprovação.
      assertActionTransition(current.status, 'EXECUTING');

      // Recusa antes de reivindicar: sem conexão a ação iria para EXECUTING e
      // voltaria FAILED alguns segundos depois, gastando uma tentativa.
      const integration = await findSocialIntegration(app.prisma, workspaceId);
      if (!integration) throw new SocialNotConnectedError();

      /**
       * Sem alvo publicável não há nada a fazer, e agora **sempre**: não existe
       * retry de provider a tentar, então um `providerPostId` guardado só serve
       * para ler o desfecho (spec de migração §2.5).
       *
       * A verificação vem antes do CAS de propósito — reverter um CAS já feito
       * exigiria uma segunda escrita, que pode falhar e deixaria a ação presa em
       * `EXECUTING`.
       */
      const publishable = current.targets.filter((target) => PUBLISHABLE_TARGET.includes(target.status));
      if (publishable.length === 0) throw new ActionNothingToPublishError();

      const claimed = await repo.claimForExecution(workspaceId, current.id);
      // Perdeu a corrida: outra requisição já levou. Nada vai para a fila —
      // enfileirar aqui produziria a segunda publicação.
      if (!claimed) throw new ConflictError('This action is not waiting to be executed');

      const publishing = await repo.markTargetsPublishing(workspaceId, current.id);
      const flying = new Set(publishing.map((target) => target.platform));

      await enqueue({ actionId: current.id, workspaceId });

      // Sem reler do banco: as duas escritas acima são `updateMany`, que não
      // devolvem linha, e o que elas gravam é exatamente isto.
      return reply.code(202).send(
        presentActionWithTargets({
          ...current,
          status: 'EXECUTING',
          heartbeatAt: null,
          targets: current.targets.map((target) =>
            flying.has(target.platform)
              ? { ...target, status: 'PUBLISHING', attempts: target.attempts + 1, lastError: null, failureKind: null }
              : target,
          ),
        }),
      );
    },
  );
};
