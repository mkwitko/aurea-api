import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { NotFoundError } from '../../../../lib/errors.js';
import { assertWriter } from '../../../../lib/tenant.js';
import { socialClientFactory, type SocialRoutesOptions } from '../../integrations/social-accounts.service.js';
import { resolveTargetAccounts } from '../actions.accounts.js';
import { assertOwnMedia } from '../actions.media.js';
import { assertPlatformsAcceptPayload } from '../actions.capabilities.js';
import { createActionsRepository } from '../actions.repository.js';
import { presentActionWithTargets } from '../actions.presenter.js';
import { actionResponse } from '../actions.schema.js';
import { createActionBody } from './create-action.schema.js';

export const createActionRoute: FastifyPluginAsync<SocialRoutesOptions> = async (app, opts) => {
  const clientFor = opts.social ?? socialClientFactory;

  app.withTypeProvider<ZodTypeProvider>().post(
    '/actions',
    {
      schema: {
        tags: ['actions'],
        operationId: 'createAction',
        body: createActionBody,
        response: { 201: actionResponse },
      },
    },
    async (req, reply) => {
      assertWriter(req.tenant);
      const { workspaceId } = req.tenant;

      // A mídia tem de ter saído do nosso upload, deste workspace: a URL é
      // buscada pela Post for Me na hora de publicar.
      assertOwnMedia(workspaceId, req.body.payload.media);
      // E a combinação tem de ser publicável em toda rede escolhida. Descobrir no
      // worker que o YouTube não aceita imagem seria um post aprovado que falha
      // sozinho depois — com as outras redes já publicadas.
      assertPlatformsAcceptPayload(req.body.platforms, req.body.payload);

      // O experimento é opcional, mas quando vem tem de ser deste workspace — e
      // um id de outro tenant lê como ausente.
      if (req.body.experimentId) {
        const experiment = await app.prisma.experiment.findFirst({
          where: { id: req.body.experimentId, workspaceId },
          select: { id: true },
        });
        if (!experiment) throw new NotFoundError('Experiment not found');
      }

      // As contas que cada rede vai receber. É aqui que uma rede sem conta
      // conectada é recusada, nomeando qual.
      const accounts = await resolveTargetAccounts({ prisma: app.prisma, clientFor }, workspaceId, req.body.platforms);

      const action = await createActionsRepository(app.prisma).createWithTargets(
        workspaceId,
        {
          experimentId: req.body.experimentId ?? null,
          type: req.body.type,
          name: req.body.name,
          description: req.body.description ?? null,
          // Texto e imagens: onde o post vai mora nos alvos, com o desfecho de
          // cada rede. Campos listados um a um, e não espalhados, para um campo
          // novo no corpo nunca entrar no payload sem alguém decidir.
          payload: {
            content: req.body.payload.content,
            ...(req.body.payload.media?.length ? { media: req.body.payload.media } : {}),
            ...(req.body.payload.title ? { title: req.body.payload.title } : {}),
          },
          createdBy: req.tenant.userId,
        },
        req.body.platforms.map((platform) => ({ platform, socialAccountId: accounts.get(platform)! })),
      );

      return reply.code(201).send(presentActionWithTargets(action));
    },
  );
};
