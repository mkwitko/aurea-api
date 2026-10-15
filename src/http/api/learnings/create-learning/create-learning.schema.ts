import { z } from 'zod';
import { learningConfidence } from '../learnings.schema.js';

// No `status`: a learning is always created as a candidate. Anything the body
// says about status is ignored rather than honoured — see the service.
export const learningCreateBody = z.object({
  title: z.string().min(1).max(200),
  statement: z.string().min(1).max(2000),
  experimentId: z.string().uuid().optional(),
  evidence: z.unknown().optional(),
  confidence: learningConfidence.optional(),
});

export type LearningCreateBody = z.infer<typeof learningCreateBody>;
