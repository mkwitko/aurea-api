import { z } from 'zod';

// Shared enums + response entity for the goals resource (drives OpenAPI → Kubb).
export const goalPriority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const goalStatus = z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED']);

export const goalSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  metric: z.string(),
  baselineValue: z.number().nullable(),
  targetValue: z.number().nullable(),
  unit: z.string().nullable(),
  deadline: z.date().nullable(),
  priority: goalPriority,
  status: goalStatus,
  createdAt: z.date(),
  updatedAt: z.date(),
  completedAt: z.date().nullable(),
});

export const goalResponse = z.object({ goal: goalSchema });
export const goalListResponse = z.object({ goals: z.array(goalSchema) });

export const goalIdParam = z.object({ id: z.string().uuid() });
