import { z } from 'zod';

export const icpSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  painPoints: z.array(z.string()).nullable(),
  status: z.enum(['ACTIVE', 'ARCHIVED']),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const icpResponse = z.object({ icp: icpSchema });
export const icpListResponse = z.object({ icps: z.array(icpSchema) });
export const icpIdParam = z.object({ id: z.string().uuid() });
