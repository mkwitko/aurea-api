import { z } from 'zod';

export const putProviderKeyBody = z.object({
  provider: z.literal('deepseek'),
  apiKey: z.string().min(8),
});

export const providerKeyQuery = z.object({ provider: z.literal('deepseek').default('deepseek') });

// A chave nunca volta: só os quatro últimos dígitos, para o usuário reconhecer
// qual credencial está gravada.
export const providerKeyResponse = z.union([
  z.object({ configured: z.literal(false) }),
  z.object({
    configured: z.literal(true),
    provider: z.string(),
    last4: z.string(),
    createdAt: z.string(),
  }),
]);
