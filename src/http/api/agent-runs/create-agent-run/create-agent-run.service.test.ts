import { describe, expect, it, vi } from 'vitest';
import { createAgentRunService, hashInput } from './create-agent-run.service.js';
import { AgentRunInProgressError, NotFoundError, SearchNotConfiguredError, UnknownTaskTypeHttpError } from '../../../../lib/errors.js';
import { isSearchConfigured } from '../../../../integrations/search/index.js';

// Mock com factory para não depender de espionar o namespace ESM vivo — o
// serviço importa o binding diretamente, então um vi.spyOn no módulo real não
// intercepta a chamada.
vi.mock('../../../../integrations/search/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../integrations/search/index.js')>();
  return { ...actual, isSearchConfigured: vi.fn() };
});

const tenant = { userId: 'u1', organizationId: 'o1', workspaceId: 'ws-1', role: 'OWNER' as const };
const input = { businessId: '3f1e8f6e-1f1a-4f0e-9b0e-0f6d3b7a1c22' };
const GOAL_ID = '9c4e2a1e-6b3d-4f2a-8e1c-2d5f7a9b0c3e';

function deps(overrides: Record<string, unknown> = {}) {
  const repo = {
    findActiveByKey: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: 'run-1', status: 'PENDING' }),
    ...overrides,
  };
  const enqueue = vi.fn().mockResolvedValue(undefined);
  // Fake Prisma: no test in this file exercises a task type with a precheck,
  // but the field is required (not optional) so a future agent's precheck
  // can never silently no-op for lack of a prisma handle.
  const prisma = {
    experiment: { findFirst: vi.fn().mockResolvedValue(null) },
    business: { findFirst: vi.fn().mockResolvedValue({ id: input.businessId }) },
  };
  return { repo, enqueue, prisma, service: createAgentRunService({ repo, enqueue, prisma } as never) };
}

describe('createAgentRunService', () => {
  it('creates and enqueues a run for a known task type', async () => {
    const { service, repo, enqueue } = deps();

    const run = await service({ tenant, taskType: 'summarize-business-context', input });

    expect(repo.create).toHaveBeenCalled();
    expect(repo.create.mock.calls[0]![0].agentType).toBe('context-analyst');
    expect(enqueue).toHaveBeenCalledWith({ agentRunId: 'run-1' });
    expect(run.id).toBe('run-1');
  });

  it('rejects an unknown task type', async () => {
    const { service } = deps();
    await expect(service({ tenant, taskType: 'ghost', input })).rejects.toBeInstanceOf(UnknownTaskTypeHttpError);
  });

  it('rejects input that does not match the agent input schema', async () => {
    const { service } = deps();
    await expect(
      service({ tenant, taskType: 'summarize-business-context', input: { businessId: 'not-a-uuid' } }),
    ).rejects.toThrow();
  });

  it('returns the in-flight run instead of enqueueing a duplicate', async () => {
    const { service, repo, enqueue } = deps({
      findActiveByKey: vi.fn().mockResolvedValue({
        id: 'run-existing',
        status: 'RUNNING',
        inputHash: hashInput(input),
        heartbeatAt: new Date(),
        createdAt: new Date(),
      }),
    });

    const run = await service({ tenant, taskType: 'summarize-business-context', input });

    expect(run.id).toBe('run-existing');
    expect(repo.create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  // A regressão que este teste tranca: um run cujo processo morreu fica
  // RUNNING no banco, e devolvê-lo aqui bloqueia aquela tarefa para sempre —
  // nada é enfileirado, nada aparece no Langfuse, a tela espera um resultado
  // que nunca vem. O reaper do worker fecha e estorna a linha morta; este
  // caminho só não pode mais tratá-la como viva.
  it('enqueues a new run when the in-flight one stopped sending a heartbeat', async () => {
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    const { service, repo, enqueue } = deps({
      findActiveByKey: vi.fn().mockResolvedValue({
        id: 'run-zombie',
        status: 'RUNNING',
        inputHash: hashInput(input),
        heartbeatAt: longAgo,
        createdAt: longAgo,
      }),
    });

    const run = await service({ tenant, taskType: 'summarize-business-context', input });

    expect(run.id).toBe('run-1');
    expect(repo.create).toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledWith({ agentRunId: 'run-1' });
  });

  // Linhas anteriores à coluna heartbeatAt: a idade delas vem do createdAt.
  it('treats an old run with no heartbeat column as dead', async () => {
    const { service, enqueue } = deps({
      findActiveByKey: vi.fn().mockResolvedValue({
        id: 'run-legacy',
        status: 'PENDING',
        inputHash: hashInput(input),
        heartbeatAt: null,
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
      }),
    });

    await service({ tenant, taskType: 'summarize-business-context', input });

    expect(enqueue).toHaveBeenCalledWith({ agentRunId: 'run-1' });
  });

  // As sete seções do contexto gravam na MESMA BusinessContextVersion, então
  // o agente declara uma chave por negócio. Sem a recusa, o serviço devolvia o
  // run alheio como se fosse a resposta deste pedido, e a tela ficava
  // esperando uma proposta sobre outra seção.
  it('refuses a different request that shares the concurrency scope', async () => {
    const { service, repo, enqueue } = deps({
      findActiveByKey: vi.fn().mockResolvedValue({
        id: 'run-company',
        taskType: 'propose-context-section',
        status: 'RUNNING',
        inputHash: 'hash-de-outra-secao',
        heartbeatAt: new Date(),
        createdAt: new Date(),
        startedAt: new Date(),
      }),
    });

    await expect(
      service({ tenant, taskType: 'propose-context-section', input: { ...input, section: 'market' } }),
    ).rejects.toBeInstanceOf(AgentRunInProgressError);

    expect(repo.create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    // O escopo é o negócio, não o input — é o que faz seção A bloquear seção B.
    expect(repo.findActiveByKey).toHaveBeenCalledWith('ws-1', `business-context:${input.businessId}`);
  });

  it('hashes input independent of key order', () => {
    expect(hashInput({ a: 1, b: 2 })).toBe(hashInput({ b: 2, a: 1 }));
  });

  it('denies a VIEWER', async () => {
    const { service } = deps();
    await expect(
      service({ tenant: { ...tenant, role: 'VIEWER' }, taskType: 'summarize-business-context', input }),
    ).rejects.toThrow();
  });

  describe('when the task type needs web search', () => {
    it('refuses before anything is persisted if search is unconfigured', async () => {
      vi.mocked(isSearchConfigured).mockReturnValue(false);
      const { service, repo } = deps();

      await expect(
        service({ tenant, taskType: 'research-growth-context', input: { goalId: GOAL_ID } }),
      ).rejects.toBeInstanceOf(SearchNotConfiguredError);

      expect(repo.create).not.toHaveBeenCalled();
    });

    it('still accepts a task type that does not need search', async () => {
      vi.mocked(isSearchConfigured).mockReturnValue(false);
      const { service, repo } = deps();

      await service({ tenant, taskType: 'propose-strategies', input: { goalId: GOAL_ID } });

      expect(repo.create).toHaveBeenCalled();
    });
  });

  describe('when the task type has a precheck', () => {
    const EXPERIMENT_ID = '11111111-1111-1111-1111-111111111111';

    // The requiresSearch analogue for interpret-outcome's precheck: refuse
    // before a credit is spent, not after. Moving the precheck call below
    // repo.create in create-agent-run.service.ts would break no test without
    // this one — that regression charges (or half-writes) a run for an
    // experiment the precheck would have refused.
    it('refuses before anything is persisted if the precheck throws', async () => {
      const { service, repo, prisma } = deps();
      prisma.experiment.findFirst.mockResolvedValue(null);

      await expect(
        service({ tenant, taskType: 'interpret-outcome', input: { experimentId: EXPERIMENT_ID } }),
      ).rejects.toBeInstanceOf(NotFoundError);

      expect(repo.create).not.toHaveBeenCalled();
    });

    it('still accepts a task type whose precheck passes', async () => {
      const { service, repo, prisma } = deps();
      prisma.experiment.findFirst.mockResolvedValue({ status: 'COMPLETED', _count: { outcomes: 1 } });

      await service({ tenant, taskType: 'interpret-outcome', input: { experimentId: EXPERIMENT_ID } });

      expect(repo.create).toHaveBeenCalled();
    });
  });
});
