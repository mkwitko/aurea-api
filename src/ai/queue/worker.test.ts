import { describe, expect, it, vi } from 'vitest';
import { createAgentRunProcessor, reapStaleRuns } from './worker.js';
import type { RunnerDeps } from '../runner/runner.js';

function reaperDeps(stale: Array<Record<string, unknown>>) {
  const repo = {
    findStale: vi.fn().mockResolvedValue(stale),
    findById: vi.fn(async (id: string) => stale.find((run) => run.id === id) ?? null),
    markFailed: vi.fn(),
  };
  const policy = { onRunFailed: vi.fn() };
  const logger = { info: vi.fn(), error: vi.fn() };
  const deps = { repo, policy, logger } as unknown as RunnerDeps;
  return { deps, repo, policy, logger };
}

describe('agent run processor', () => {
  it('passes the job id to the runner', async () => {
    const executed: string[] = [];
    const process = createAgentRunProcessor(
      { logger: { info: vi.fn(), error: vi.fn() } } as unknown as RunnerDeps,
      async (_deps, id) => {
        executed.push(id);
      },
    );

    await process({ data: { agentRunId: 'run-9' } });

    expect(executed).toEqual(['run-9']);
  });

  it('logs and rethrows so BullMQ can retry infrastructure failures', async () => {
    const logger = { info: vi.fn(), error: vi.fn() };
    const process = createAgentRunProcessor(
      { logger } as unknown as RunnerDeps,
      async () => {
        throw new Error('db down');
      },
    );

    await expect(process({ data: { agentRunId: 'run-9' } })).rejects.toThrow('db down');
    expect(logger.error).toHaveBeenCalled();
  });
});

// O evento `failed` do BullMQ só alcança um job que a fila ainda conhece.
// Quando o job some (perdido entre o insert e o enqueue, fila apagada, worker
// derrubado antes de registrar a falha) a linha fica RUNNING para sempre: o
// crédito segue debitado e a deduplicação por inputHash devolve esse fantasma a
// cada nova tentativa. O reaper é o único caminho que fecha esses runs.
describe('reapStaleRuns', () => {
  const RUN = {
    id: 'run-dead',
    status: 'RUNNING',
    workspaceId: 'ws-1',
    requestedBy: 'u1',
    modelCalls: 2,
  };

  it('fails and refunds a run with no heartbeat', async () => {
    const { deps, repo, policy } = reaperDeps([RUN]);

    const reaped = await reapStaleRuns(deps, { staleMs: 600_000, now: new Date('2026-07-31T12:00:00Z') });

    expect(reaped).toBe(1);
    expect(repo.findStale).toHaveBeenCalledWith(new Date('2026-07-31T11:50:00Z'), 100);
    expect(repo.markFailed).toHaveBeenCalledWith(
      'run-dead',
      expect.objectContaining({ inputTokens: 0, estimatedCost: 0, modelCalls: 2 }),
    );
    // Sem o estorno o fundador paga por um run que morreu sem entregar nada.
    expect(policy.onRunFailed).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-1' }), 'run-dead');
  });

  // O reaper corre em paralelo com o runner: se o run terminou entre a
  // varredura e a reconciliação, o resultado do runner é o que vale.
  it('leaves a run that finished in the meantime alone', async () => {
    const { deps, repo, policy } = reaperDeps([RUN]);
    repo.findById.mockResolvedValue({ ...RUN, status: 'COMPLETED' });

    await reapStaleRuns(deps);

    expect(repo.markFailed).not.toHaveBeenCalled();
    expect(policy.onRunFailed).not.toHaveBeenCalled();
  });
});
