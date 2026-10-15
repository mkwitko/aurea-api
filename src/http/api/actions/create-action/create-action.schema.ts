import { z } from 'zod';
import { socialPostPayload } from '../actions.payload.js';
import { actionTypeEnum, socialPlatformEnum, SOCIAL_PLATFORMS } from '../actions.schema.js';

/**
 * As redes que este post vai atingir.
 *
 * Mínimo 1: um post sem destino não é rascunho, é linha que nenhuma tela sabe
 * explicar. Máximo é o número de redes que existem — derivado, e não escrito, para
 * não ficar atrás do enum como já ficou. E sem repetição porque
 * `[actionId, platform]` é unique: deixar passar viraria erro de banco onde devia
 * haver mensagem de validação.
 *
 * Que combinação de rede e arquivo é publicável não se decide aqui — está em
 * `assertPlatformsAcceptPayload`, que precisa do payload junto.
 */
export const platformsField = socialPlatformEnum
  .array()
  .min(1)
  .max(SOCIAL_PLATFORMS.length)
  .refine((values) => new Set(values).size === values.length, {
    message: 'each platform can appear only once',
  });

export const createActionBody = z.object({
  type: actionTypeEnum,
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  /** Opcional por decisão de escopo: a ação pode existir solta (spec §2, decisão 3). */
  experimentId: z.string().uuid().optional(),
  payload: socialPostPayload,
  platforms: platformsField,
});

export type CreateActionBody = z.infer<typeof createActionBody>;
