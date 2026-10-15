import { z } from 'zod';
import { goalPriority } from '../goals.schema.js';

export const createGoalBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  metric: z.string().min(1).max(160),
  baselineValue: z.number().optional(),
  targetValue: z.number().optional(),
  unit: z.string().max(40).optional(),
  deadline: z.coerce.date().optional(),
  priority: goalPriority.optional(),
  icpIds: z.array(z.string().uuid()).optional(),
});

export type CreateGoalBody = z.infer<typeof createGoalBody>;
