import { z } from 'zod';

export const experimentFromProposalBody = z.object({ agentRunId: z.string().uuid() });

export type ExperimentFromProposalBody = z.infer<typeof experimentFromProposalBody>;
