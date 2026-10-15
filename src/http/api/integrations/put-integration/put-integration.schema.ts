import { z } from 'zod';
import { integrationAuthKind, integrationProvider } from '../integrations.schema.js';

export const putIntegrationBody = z.object({
  provider: integrationProvider,
  authKind: integrationAuthKind,
  /** A property GA4. Só dígitos: o resto é erro de cópia, e um id errado vira 404 do Google. */
  externalId: z.string().regex(/^\d+$/, 'the GA4 property id is only digits').max(32),
  /** O JSON da service account, inteiro. Nunca volta em resposta nenhuma. */
  credentials: z.string().min(1).max(8192),
});

export type PutIntegrationBody = z.infer<typeof putIntegrationBody>;
