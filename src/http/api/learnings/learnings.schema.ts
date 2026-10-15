import { z } from 'zod';

export const learningConfidence = z.enum(['LOW', 'MEDIUM', 'HIGH', 'VERIFIED']);
export const learningStatus = z.enum(['CANDIDATE', 'VALIDATED', 'REJECTED', 'ARCHIVED']);

export const learningSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  experimentId: z.string().uuid().nullable(),
  title: z.string(),
  statement: z.string(),
  evidence: z.unknown().nullable(),
  confidence: learningConfidence,
  status: learningStatus,
  createdAt: z.date(),
  validatedAt: z.date().nullable(),
  archivedAt: z.date().nullable(),
  sourceAgentRunId: z.string().nullable(),
});

export const learningResponse = z.object({ learning: learningSchema });
export const learningListResponse = z.object({ learnings: z.array(learningSchema) });
export const learningIdParam = z.object({ id: z.string().uuid() });
export const learningListQuery = z.object({
  experimentId: z.string().uuid().optional(),
  status: learningStatus.optional(),
});

// O corpo não carrega o experimento: o servidor relê o input gravado do run,
// para que o browser não possa anexar a aprendizagem a um experimento à
// sua escolha.
export const learningFromRunBody = z.object({ agentRunId: z.string().uuid() });
export type LearningFromRunBody = z.infer<typeof learningFromRunBody>;
