import { z } from 'zod';

export const experimentStatus = z.enum([
  'DRAFT',
  'PLANNED',
  'APPROVED',
  'RUNNING',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
]);

export const experimentSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  strategyId: z.string().uuid(),
  hypothesisId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  objective: z.string().nullable(),
  channel: z.string().nullable(),
  audience: z.string().nullable(),
  metric: z.string(),
  baselineValue: z.number().nullable(),
  targetValue: z.number().nullable(),
  successCriteria: z.string().nullable(),
  startDate: z.date().nullable(),
  endDate: z.date().nullable(),
  status: experimentStatus,
  createdAt: z.date(),
  updatedAt: z.date(),
  completedAt: z.date().nullable(),
});

export const experimentResponse = z.object({ experiment: experimentSchema });
export const experimentListResponse = z.object({ experiments: z.array(experimentSchema) });
export const experimentIdParam = z.object({ id: z.string().uuid() });
export const experimentListQuery = z.object({
  hypothesisId: z.string().uuid().optional(),
  strategyId: z.string().uuid().optional(),
});
