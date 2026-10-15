import { z } from 'zod';

const stringList = z.array(z.string().min(1)).optional();

export const icpCreateBody = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  painPoints: stringList,
  characteristics: stringList,
  customerGoals: stringList,
  buyingTriggers: stringList,
  objections: stringList,
});

export type IcpCreateBody = z.infer<typeof icpCreateBody>;
