import { z } from 'zod';

export const workspaceResponse = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  createdAt: z.string(),
});

export const workspaceListResponse = z.object({
  workspaces: z.array(workspaceResponse),
});

export const createWorkspaceBody = z.object({
  name: z.string().trim().min(1).max(80),
});
