import { z } from 'zod';
import { socialPostPayload } from '../actions.payload.js';
import { platformsField } from '../create-action/create-action.schema.js';

export const updateActionBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    payload: socialPostPayload.optional(),
    /** O conjunto inteiro, não um delta: `[a, b]` substitui o que havia. */
    platforms: platformsField.optional(),
  })
  // Um PATCH vazio não é edição, é um round-trip que faz o cliente acreditar
  // que salvou algo.
  .refine((body) => Object.keys(body).length > 0, { message: 'Send at least one field to change' });

export type UpdateActionBody = z.infer<typeof updateActionBody>;
