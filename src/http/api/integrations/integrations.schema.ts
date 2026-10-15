import { z } from 'zod';

// POST_FOR_ME entra ao lado do GA4: é outra fonte, com outro papel (executa, não
// mede), e a mesma tabela guarda as duas.
export const integrationProvider = z.enum(['GA4', 'POST_FOR_ME']);
export const integrationAuthKind = z.enum(['SERVICE_ACCOUNT']);

/**
 * A resposta. Sem `ciphertext`, sem `iv`, sem `authTag`, sem credencial: o
 * schema é a segunda trava (a primeira é o `select` do repositório), e é a que
 * falha em build quando alguém acrescenta um campo por engano.
 */
export const integrationSchema = z.object({
  id: z.string(),
  provider: z.string(),
  authKind: z.string(),
  externalId: z.string().nullable(),
  accountLabel: z.string(),
  status: z.string(),
  lastCheckedAt: z.date().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.date(),
});

export const integrationResponse = z.object({ integration: integrationSchema });
export const integrationListResponse = z.object({ integrations: z.array(integrationSchema) });
export const integrationQuery = z.object({ provider: integrationProvider });
