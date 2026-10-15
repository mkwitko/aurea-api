import { z } from 'zod';

export const strategyStatus = z.enum(['DRAFT', 'PROPOSED', 'APPROVED', 'ACTIVE', 'PAUSED', 'ARCHIVED']);
export const strategyPriority = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const strategySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  objective: z.string().nullable(),
  strategicThesis: z.string().nullable(),
  growthMechanism: z.string().nullable(),
  expectedOutcome: z.string().nullable(),
  priority: strategyPriority,
  status: strategyStatus,
  version: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
  archivedAt: z.date().nullable(),
});

export const strategyResponse = z.object({ strategy: strategySchema });
export const strategyListResponse = z.object({ strategies: z.array(strategySchema) });
export const strategyIdParam = z.object({ id: z.string().uuid() });
