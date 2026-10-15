import { z } from 'zod';

export const businessCreateBody = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(4000).optional(),
  website: z.string().url().optional(),
  industry: z.string().max(160).optional(),
  businessModel: z.string().max(160).optional(),
  revenueModel: z.string().max(160).optional(),
  valueProposition: z.string().max(2000).optional(),
  positioning: z.string().max(2000).optional(),
});

export type BusinessCreateBody = z.infer<typeof businessCreateBody>;
