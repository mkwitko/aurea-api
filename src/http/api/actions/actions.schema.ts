import { SocialPlatform } from '@prisma/client';
import { z } from 'zod';
import { socialPostPayload } from './actions.payload.js';

export const actionTypeEnum = z.enum(['SOCIAL_POST']);

export const actionStatusEnum = z.enum([
  'PROPOSED',
  'PENDING_APPROVAL',
  'APPROVED',
  'EXECUTING',
  'EXECUTED',
  'PARTIALLY_EXECUTED',
  'FAILED',
  'CANCELLED',
  'DELIVERY_UNKNOWN',
]);

/**
 * As redes que a AUREA publica, **derivadas do enum do Prisma** e não escritas
 * outra vez.
 *
 * Escrita à mão, esta lista ficou quatro redes atrás do banco no minuto em que o
 * enum cresceu, e o `tsc` só reclamou porque um presenter esbarrou nela. Derivar
 * significa que uma rede nova no schema aparece no contrato e nos hooks do
 * frontend sem uma segunda edição — e que nenhuma pode ficar de fora por
 * esquecimento.
 *
 * Fora do enum, e por isso fora daqui: Pinterest, cuja credencial não está
 * habilitada na conta do provider, e Bluesky, que pede senha de app em vez de
 * OAuth.
 */
export const socialPlatformEnum = z.nativeEnum(SocialPlatform);

export const SOCIAL_PLATFORMS = Object.values(SocialPlatform);

export const actionTargetStatusEnum = z.enum([
  'PENDING',
  'PUBLISHING',
  'PUBLISHED',
  'FAILED',
  'DELIVERY_UNKNOWN',
]);

/**
 * Uma rede que o post vai atingir, com o desfecho dela.
 *
 * `externalId` e `postUrl` vêm do provider ou são nulos. Nunca construídos: uma
 * URL montada por nós afirmaria publicação que ninguém confirmou.
 */
export const actionTargetEntity = z.object({
  id: z.string(),
  platform: socialPlatformEnum,
  status: actionTargetStatusEnum,
  externalId: z.string().nullable(),
  postUrl: z.string().nullable(),
  lastError: z.string().nullable(),
  failureKind: z.string().nullable(),
  attempts: z.number().int(),
  publishedAt: z.date().nullable(),
  updatedAt: z.date(),
});

export const approvalStatusEnum = z.enum(['PENDING', 'APPROVED', 'REJECTED']);

export const actionEntity = z.object({
  id: z.string().uuid(),
  experimentId: z.string().uuid().nullable(),
  type: actionTypeEnum,
  name: z.string(),
  description: z.string().nullable(),
  payload: socialPostPayload,
  status: actionStatusEnum,
  createdBy: z.string(),
  approvedAt: z.date().nullable(),
  executedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const approvalEntity = z.object({
  // Sem `.uuid()`: diferente de `actionEntity.id`, este id nunca vira parâmetro
  // de rota (não há `GET /approvals/:id`), então a checagem de formato aqui só
  // rejeitaria fixtures de teste com id legível sem proteger nada em produção.
  id: z.string(),
  requestedBy: z.string(),
  reviewedBy: z.string().nullable(),
  status: approvalStatusEnum,
  comment: z.string().nullable(),
  requestedAt: z.date(),
  reviewedAt: z.date().nullable(),
});

/**
 * Toda resposta de ação leva os alvos: sem eles não há como dizer onde o post
 * está, e o `status` da Action é só o resumo deles (spec §4.3).
 */
export const actionResponse = z.object({ action: actionEntity, targets: z.array(actionTargetEntity) });

export const actionsListResponse = z.object({
  actions: z.array(actionEntity.extend({ targets: z.array(actionTargetEntity) })),
});

export const actionDetailResponse = z.object({
  action: actionEntity,
  targets: z.array(actionTargetEntity),
  approvals: z.array(approvalEntity),
});

export const actionIdParam = z.object({ id: z.string().uuid() });

export const actionTargetParams = z.object({ id: z.string().uuid(), targetId: z.string().uuid() });
