import { z } from 'zod';

export const hypothesisConfidence = z.enum(['LOW', 'MEDIUM', 'HIGH', 'VERIFIED']);
export const hypothesisStatus = z.enum(['DRAFT', 'PROPOSED', 'TESTED', 'VALIDATED', 'REJECTED']);

export const hypothesisSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  strategyId: z.string().uuid(),
  statement: z.string(),
  rationale: z.string().nullable(),
  expectedOutcome: z.string().nullable(),
  targetMetric: z.string().nullable(),
  confidence: hypothesisConfidence,
  status: hypothesisStatus,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const hypothesisResponse = z.object({ hypothesis: hypothesisSchema });
export const hypothesisListResponse = z.object({ hypotheses: z.array(hypothesisSchema) });
export const hypothesisIdParam = z.object({ id: z.string().uuid() });
export const hypothesisListQuery = z.object({ strategyId: z.string().uuid().optional() });
