import { describe, expect, it, vi } from 'vitest';
import { createFromProposalExperimentService } from './from-proposal.service.js';

const RUN_ID = '11111111-1111-1111-1111-111111111111';
const HYPOTHESIS_ID = '22222222-2222-2222-2222-222222222222';

const filled = {
  name: 'Teste de outbound em texto puro',
  metric: 'reply_rate',
  description: 'Desenhado a partir do aprendizado "Templates lidos como marketing".',
  objective: 'Saber se texto puro responde melhor que template',
  channel: 'Email',
  audience: 'Fundadores B2B SaaS, 10-50 pessoas',
  successCriteria: 'Resposta acima do baseline com pelo menos 50 envios',
};

const RUN = {
  taskType: 'propose-experiment',
  status: 'COMPLETED',
  input: { hypothesisId: HYPOTHESIS_ID },
  // `confidence` é exigido por `buildFillOutputSchema` (contract.ts) — sem ele
  // o output nem valida, e o serviço recusaria o run como "não legível" antes
  // de chegar em qualquer regra deste teste.
  output: { filled, questions: [], confidence: 'MEDIUM' },
};

const buildDeps = (over: Partial<Record<string, unknown>> = {}) => ({
  repo: {
    findHypothesis: vi.fn().mockResolvedValue({ id: HYPOTHESIS_ID, strategyId: 's-1' }),
    findBySourceRun: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockImplementation((workspaceId: string, data: object) => ({ id: 'e-1', workspaceId, ...data })),
  },
  findRun: vi.fn().mockResolvedValue(RUN),
  ...over,
});

describe('createFromProposalExperimentService', () => {
  it('cria o rascunho com os campos que a IA pode saber e os quatro números nulos', async () => {
    const deps = buildDeps();
    const service = createFromProposalExperimentService(deps as never);

    const experiment = await service({ agentRunId: RUN_ID, workspaceId: 'ws-1' });

    expect(experiment.name).toBe(filled.name);
    expect(experiment.metric).toBe('reply_rate');
    expect(experiment.strategyId).toBe('s-1');
    expect(experiment.sourceAgentRunId).toBe(RUN_ID);
    // Os quatro números são do fundador. Ver spec §2.
    expect(experiment.baselineValue).toBeUndefined();
    expect(experiment.targetValue).toBeUndefined();
    expect(experiment.startDate).toBeUndefined();
    expect(experiment.endDate).toBeUndefined();
  });

  it('devolve o experimento existente em vez de criar um segundo', async () => {
    const existing = { id: 'e-existente', sourceAgentRunId: RUN_ID };
    const deps = buildDeps({
      repo: { ...buildDeps().repo, findBySourceRun: vi.fn().mockResolvedValue(existing) },
    });
    const service = createFromProposalExperimentService(deps as never);

    await expect(service({ agentRunId: RUN_ID, workspaceId: 'ws-1' })).resolves.toBe(existing);
    expect(deps.repo.create).not.toHaveBeenCalled();
  });

  it('devolve o experimento existente quando a segunda chamada concorrente esbarra na unique', async () => {
    // Duas abas passam pelo `findBySourceRun` antes de qualquer `create` — a
    // primeira grava, a segunda esbarra em P2002 na unique de
    // `sourceAgentRunId`. Isso é o mesmo run virando experimento duas vezes,
    // não uma falha do servidor: a resposta certa é a linha que a outra aba
    // criou.
    const existing = { id: 'e-existente', sourceAgentRunId: RUN_ID };
    const conflict = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['sourceAgentRunId'] },
    });
    const deps = buildDeps({
      repo: {
        ...buildDeps().repo,
        create: vi.fn().mockRejectedValue(conflict),
        findBySourceRun: vi
          .fn()
          .mockResolvedValueOnce(null) // primeira leitura: ainda não existe
          .mockResolvedValueOnce(existing), // reler depois do conflito
      },
    });
    const service = createFromProposalExperimentService(deps as never);

    await expect(service({ agentRunId: RUN_ID, workspaceId: 'ws-1' })).resolves.toBe(existing);
  });

  it('recusa sem escrever quando falta name ou metric', async () => {
    const deps = buildDeps({
      findRun: vi.fn().mockResolvedValue({
        ...RUN,
        output: { filled: { ...filled, metric: undefined }, questions: [], confidence: 'MEDIUM' },
      }),
    });
    const service = createFromProposalExperimentService(deps as never);

    await expect(service({ agentRunId: RUN_ID, workspaceId: 'ws-1' })).rejects.toThrow(/name and metric/i);
    expect(deps.repo.create).not.toHaveBeenCalled();
  });

  it('recusa um run que não terminou', async () => {
    const deps = buildDeps({ findRun: vi.fn().mockResolvedValue({ ...RUN, status: 'RUNNING' }) });
    const service = createFromProposalExperimentService(deps as never);

    await expect(service({ agentRunId: RUN_ID, workspaceId: 'ws-1' })).rejects.toThrow(/RUNNING/);
  });

  it('recusa um run de outro task type', async () => {
    const deps = buildDeps({ findRun: vi.fn().mockResolvedValue({ ...RUN, taskType: 'propose-strategies' }) });
    const service = createFromProposalExperimentService(deps as never);

    await expect(service({ agentRunId: RUN_ID, workspaceId: 'ws-1' })).rejects.toThrow(/did not design an experiment/i);
  });

  it('trata run de outro workspace como inexistente', async () => {
    const deps = buildDeps({ findRun: vi.fn().mockResolvedValue(null) });
    const service = createFromProposalExperimentService(deps as never);

    await expect(service({ agentRunId: RUN_ID, workspaceId: 'ws-1' })).rejects.toThrow(/not found/i);
  });

  it('recusa quando a hipótese do run não está neste workspace', async () => {
    const deps = buildDeps({
      repo: { ...buildDeps().repo, findHypothesis: vi.fn().mockResolvedValue(null) },
    });
    const service = createFromProposalExperimentService(deps as never);

    await expect(service({ agentRunId: RUN_ID, workspaceId: 'ws-1' })).rejects.toThrow(/Hypothesis not found/i);
  });
});
