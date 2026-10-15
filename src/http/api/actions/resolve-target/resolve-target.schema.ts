import { z } from 'zod';

export const resolveTargetBody = z.object({
  /**
   * Vocabulário fechado: o humano diz o que viu na rede. Não há terceira opção —
   * "não sei" é o estado em que o alvo já está.
   */
  outcome: z.enum(['PUBLISHED', 'NOT_PUBLISHED']),
  /**
   * O id do post no provider, quando o fundador consegue copiá-lo. Sem ele, o
   * alvo é marcado publicado **sem** proveniência: um id inventado seria
   * proveniência falsa de um post real (spec §8.3).
   */
  externalId: z.string().min(1).max(200).optional(),
});
