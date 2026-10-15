import { z } from 'zod';

export const registerBody = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  organizationName: z.string().min(1).max(120),
});

export type RegisterBody = z.infer<typeof registerBody>;
