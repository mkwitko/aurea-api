import { z } from 'zod';
import { businessContextDataSchema } from '../business-context-data.schema.js';

export const contextUpdateBody = z.object({
  data: businessContextDataSchema,
  source: z.enum(['USER', 'RESEARCH', 'INTEGRATION', 'AI', 'SYSTEM']).optional(),
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH', 'VERIFIED']).optional(),
});

export type ContextUpdateBody = z.infer<typeof contextUpdateBody>;
