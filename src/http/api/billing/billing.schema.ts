import { z } from 'zod';

export const billingResponse = z.object({
  plan: z.enum(['STARTER', 'GROWTH', 'SCALE']),
  status: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED']),
  currentPeriodEnd: z.string().nullable(),
  hasSubscription: z.boolean(),
  maxWorkspaces: z.number().int(),
  workspaceCount: z.number().int(),
});

export const checkoutUrlResponse = z.object({ url: z.string().url() });

export const subscriptionCheckoutBody = z.object({
  plan: z.enum(['STARTER', 'GROWTH', 'SCALE']),
});

export const creditPackCheckoutBody = z.object({
  packId: z.enum(['SMALL', 'MEDIUM', 'LARGE']),
});

// Este é o único lugar do contrato onde dinheiro aparece, divergindo do §8 do
// design do B2b: sem preço o fundador escolhe plano no escuro. Continua sendo
// preço de catálogo, não fatura — nada aqui é específico de um cliente.
export const plansResponse = z.object({
  plans: z.array(
    z.object({
      plan: z.enum(['STARTER', 'GROWTH', 'SCALE']),
      monthlyCredits: z.number().int(),
      maxWorkspaces: z.number().int(),
      priceCents: z.number().int(),
      currency: z.string(),
    }),
  ),
  packs: z.array(
    z.object({
      packId: z.enum(['SMALL', 'MEDIUM', 'LARGE']),
      credits: z.number().int(),
      priceCents: z.number().int(),
      currency: z.string(),
    }),
  ),
});
