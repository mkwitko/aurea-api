import { type PrismaClient, type Prisma, ExperimentStatus } from '@prisma/client';
import { clockCutoff } from './experiments.clock.js';

export interface ExperimentData {
  hypothesisId: string;
  strategyId: string;
  name: string;
  metric: string;
  description?: string;
  objective?: string;
  channel?: string;
  audience?: string;
  variables?: Record<string, unknown>;
  baselineValue?: number;
  targetValue?: number;
  successCriteria?: string;
  startDate?: Date;
  endDate?: Date;
  sourceAgentRunId?: string;
}

export function createExperimentsRepository(prisma: PrismaClient) {
  return {
    list(workspaceId: string, filter: { hypothesisId?: string; strategyId?: string }) {
      return prisma.experiment.findMany({
        where: {
          workspaceId,
          ...(filter.hypothesisId ? { hypothesisId: filter.hypothesisId } : {}),
          ...(filter.strategyId ? { strategyId: filter.strategyId } : {}),
        },
        orderBy: { createdAt: 'desc' },
      });
    },
    findById(workspaceId: string, id: string) {
      return prisma.experiment.findFirst({ where: { id, workspaceId } });
    },
    findHypothesis(workspaceId: string, hypothesisId: string) {
      return prisma.hypothesis.findFirst({
        where: { id: hypothesisId, workspaceId },
        select: { id: true, strategyId: true },
      });
    },
    /**
     * O experimento que já nasceu deste run, se algum.
     *
     * A materialização é chamada pelo cliente e pode chegar duas vezes — duas
     * abas abertas, um retry depois de um timeout de rede. Ler antes de escrever
     * transforma isso numa resposta repetida em vez de um segundo rascunho.
     */
    findBySourceRun(workspaceId: string, agentRunId: string) {
      return prisma.experiment.findFirst({ where: { workspaceId, sourceAgentRunId: agentRunId } });
    },
    /**
     * Os experimentos que podem estar com a data vencida, em TODOS os
     * workspaces.
     *
     * Esta é a segunda função do sistema sem escopo de tenant — a primeira é
     * `reapStaleRuns`. O relógio não roda dentro de uma requisição: não há
     * `req.tenant` de onde tirar o workspace, e um relógio por workspace só
     * andaria para quem estivesse com a tela aberta, que é exatamente o
     * problema. A leitura cruza; a escrita continua por tenant, com o
     * `workspaceId` da própria linha.
     *
     * O filtro usa a MESMA fronteira que a regra (`clockCutoff`), e não uma mais
     * larga. Quem decide continua sendo `dueTransition` — mas uma linha que ele
     * descarta não é escrita, então seu `updatedAt` não muda, e com `orderBy
     * updatedAt asc` ela reaparece na mesma página no tick seguinte. Duzentos
     * experimentos terminando hoje travariam a fila inteira, e nenhum vencido de
     * verdade sairia. Filtro largo aqui não é conservador: é fome.
     */
    findDueSystemWide(now: Date, limit = 200) {
      return prisma.experiment.findMany({
        where: {
          OR: [
            { status: ExperimentStatus.APPROVED, startDate: { lte: now } },
            { status: ExperimentStatus.RUNNING, endDate: { lt: clockCutoff(now) } },
          ],
        },
        // Mais antigos primeiro: com mais linhas vencidas que `limit`, quem
        // espera há mais tempo sai na frente, e o tick seguinte pega o resto.
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: limit,
        select: { id: true, workspaceId: true, status: true, startDate: true, endDate: true },
      });
    },
    create(workspaceId: string, data: ExperimentData) {
      const { variables, ...rest } = data;
      return prisma.experiment.create({
        data: {
          ...rest,
          variables: variables as Prisma.InputJsonValue | undefined,
          status: ExperimentStatus.DRAFT,
          workspaceId,
        },
      });
    },
    update(id: string, data: Partial<Omit<ExperimentData, 'hypothesisId' | 'strategyId'>>) {
      const { variables, ...rest } = data;
      return prisma.experiment.update({
        where: { id },
        data: { ...rest, ...(variables ? { variables: variables as Prisma.InputJsonValue } : {}) },
      });
    },
    setStatus(id: string, status: ExperimentStatus, extra: Prisma.ExperimentUpdateInput = {}) {
      return prisma.experiment.update({ where: { id }, data: { status, ...extra } });
    },
  };
}

export type ExperimentsRepository = ReturnType<typeof createExperimentsRepository>;
