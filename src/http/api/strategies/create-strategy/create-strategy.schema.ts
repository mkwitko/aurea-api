import { z } from 'zod';
import { strategyPriority } from '../strategies.schema.js';

export const strategyCreateBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  objective: z.string().max(1000).optional(),
  strategicThesis: z.string().max(2000).optional(),
  growthMechanism: z.string().max(160).optional(),
  expectedOutcome: z.string().max(1000).optional(),
  channels: z.array(z.string().min(1)).optional(),
  risks: z.array(z.string().min(1)).optional(),
  assumptions: z.array(z.record(z.string(), z.unknown())).optional(),
  evidence: z.array(z.record(z.string(), z.unknown())).optional(),
  constraints: z.record(z.string(), z.unknown()).optional(),
  priority: strategyPriority.optional(),
  goalIds: z.array(z.string().uuid()).min(1),
  icpIds: z.array(z.string().uuid()).optional(),
});

export type StrategyCreateBody = z.infer<typeof strategyCreateBody>;
