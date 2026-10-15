import { BadRequestError, NotFoundError } from '../../../lib/errors.js';
import {
  researchGrowthContextAgent,
  type ResearchFinding,
  type ResearchOpportunity,
} from '../../../ai/agents/research-growth-context.js';

export type ResearchOutput = { findings: ResearchFinding[]; opportunities: ResearchOpportunity[] };

/** Lê um run pelo id dentro de um workspace. Run de outro workspace é indistinguível de inexistente. */
export type FindRun = (
  id: string,
  workspaceId: string,
) => Promise<{ taskType: string; status: string; output: unknown } | null>;

/**
 * O output de pesquisa de um run, relido do banco e validado pelo schema do
 * agente. Nenhum dos três casos de uso (guardar, remover, dizer o que já está
 * guardado) aceita achados do browser: o cliente manda índices, o servidor
 * decide o que eles significam.
 */
export async function loadResearchOutput(
  findRun: FindRun,
  agentRunId: string,
  workspaceId: string,
): Promise<ResearchOutput> {
  const run = await findRun(agentRunId, workspaceId);
  if (!run) throw new NotFoundError('Agent run not found');

  if (run.taskType !== researchGrowthContextAgent.taskType) {
    throw new BadRequestError('This run did not produce research');
  }
  if (run.status !== 'COMPLETED') {
    throw new BadRequestError(`This run is ${run.status}, so it has nothing to accept yet`);
  }

  const output = researchGrowthContextAgent.outputSchema.safeParse(run.output);
  if (!output.success) throw new BadRequestError('This run output is not readable research');

  return output.data;
}

export function pickFindings(output: ResearchOutput, indexes: number[]): ResearchFinding[] {
  return indexes.map((index) => {
    const found = output.findings[index];
    if (!found) throw new BadRequestError('That finding is not in this research');
    // Um achado NONE é para ler, não para arquivar: ele não tem campo de
    // destino, então nem guardar nem remover fariam nada, e o 201 mentiria.
    if (found.target === 'NONE') throw new BadRequestError('That finding does not belong in the business context');
    return found;
  });
}

export function pickOpportunities(output: ResearchOutput, indexes: number[]): ResearchOpportunity[] {
  return indexes.map((index) => {
    const found = output.opportunities[index];
    if (!found) throw new BadRequestError('That opportunity is not in this research');
    return found;
  });
}
