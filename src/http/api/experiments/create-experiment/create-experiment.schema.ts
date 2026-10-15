import { z } from 'zod';

export const experimentCreateBody = z.object({
  hypothesisId: z.string().uuid(),
  name: z.string().min(1).max(200),
  metric: z.string().min(1).max(160),
  description: z.string().max(2000).optional(),
  objective: z.string().max(1000).optional(),
  channel: z.string().max(160).optional(),
  audience: z.string().max(500).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
  baselineValue: z.number().optional(),
  targetValue: z.number().optional(),
  successCriteria: z.string().max(1000).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

export type ExperimentCreateBody = z.infer<typeof experimentCreateBody>;
