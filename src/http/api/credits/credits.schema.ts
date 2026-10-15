import { z } from 'zod';

export const creditsResponse = z.object({
  plan: z.enum(['STARTER', 'GROWTH', 'SCALE']),
  allowance: z.number().int(),
  consumed: z.number().int(),
  purchasedBalance: z.number().int(),
  periodStart: z.string(),
  periodEnd: z.string(),
});

export const pricingResponse = z.object({
  operations: z.array(z.object({ taskType: z.string(), credits: z.number().int() })),
});

export const ledgerQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.coerce.date().optional(),
});

export const ledgerResponse = z.object({
  entries: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['DEBIT', 'REFUND', 'PURCHASE', 'GRANT']),
      credits: z.number().int(),
      agentRunId: z.string().nullable(),
      reason: z.string(),
      createdAt: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
