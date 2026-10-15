import { z } from 'zod';
import { hypothesisConfidence } from '../hypotheses.schema.js';

export const hypothesisCreateBody = z.object({
  strategyId: z.string().uuid(),
  statement: z.string().min(1).max(2000),
  rationale: z.string().max(2000).optional(),
  expectedOutcome: z.string().max(1000).optional(),
  targetMetric: z.string().max(160).optional(),
  confidence: hypothesisConfidence.optional(),
});

export type HypothesisCreateBody = z.infer<typeof hypothesisCreateBody>;
