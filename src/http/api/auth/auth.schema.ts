import { z } from 'zod';

export const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
});

export const tokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
});

export const authResponse = z.object({ user: userSchema, tokens: tokensSchema });

export const meResponse = z.object({
  user: userSchema,
  memberships: z.array(
    z.object({
      organizationId: z.string().uuid(),
      workspaceId: z.string().uuid().nullable(),
      role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
    }),
  ),
});

export const refreshBody = z.object({ refreshToken: z.string().min(1) });
