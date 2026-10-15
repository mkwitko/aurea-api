import { describe, expect, it, vi } from 'vitest';
import { cancelAgentRunService } from './cancel-agent-run.service.js';
import { NotFoundError, RunAlreadyFinishedError } from '../../../../lib/errors.js';

const tenant = { userId: 'u1', organizationId: 'o1', workspaceId: 'ws-1', role: 'OWNER' as const };
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const RUNNING = { id: RUN_ID, status: 'RUNNING', workspaceId: 'ws-1' };

function deps(overrides: Record<string, unknown> = {}) {
  const repo = {
    findInWorkspace: vi.fn().mockResolvedValue(RUNNING),
    cancel: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  const removeJob = vi.fn().mockResolvedValue(undefined);
  const refund = vi.fn().mockResolvedValue(undefined);
  const notify = vi.fn().mockResolvedValue(undefined);
  return { repo, removeJob, refund, notify, service: cancelAgentRunService({ repo, removeJob, refund, notify } as never) };
}

describe('cancelAgentRunService', () => {
  it('cancels, drops the job and refunds the credit', async () => {
    const { service, repo, removeJob, refund, notify } = deps();

    await service({ tenant, id: RUN_ID });

    expect(repo.cancel).toHaveBeenCalledWith(RUN_ID, 'ws-1');
    expect(removeJob).toHaveBeenCalledWith(RUN_ID);
    // Run cancelado não é run entregue: sem o estorno o fundador paga por nada.
    expect(refund).toHaveBeenCalledWith(RUN_ID);
    expect(notify).toHaveBeenCalledWith('ws-1', RUN_ID);
  });

  // Ordem importa: marcar no banco antes de tirar da fila. O contrário deixa
  // uma janela em que o job some e a linha continua RUNNING — o run-fantasma.
  it('marks the row before dropping the job', async () => {
    const order: string[] = [];
    const service = cancelAgentRunService({
      repo: {
        findInWorkspace: vi.fn().mockResolvedValue(RUNNING),
        cancel: vi.fn(async () => {
          order.push('db');
          return true;
        }),
      },
      removeJob: vi.fn(async () => void order.push('queue')),
      refund: vi.fn(async () => void order.push('refund')),
      notify: vi.fn(async () => void order.push('notify')),
    } as never);

    await service({ tenant, id: RUN_ID });

    expect(order).toEqual(['db', 'queue', 'refund', 'notify']);
  });

  it('refuses a run that already finished', async () => {
    const { service, refund } = deps({
      findInWorkspace: vi.fn().mockResolvedValue({ ...RUNNING, status: 'COMPLETED' }),
      cancel: vi.fn().mockResolvedValue(false),
    });

    await expect(service({ tenant, id: RUN_ID })).rejects.toBeInstanceOf(RunAlreadyFinishedError);
    // O resultado que o fundador pagou continua valendo — nada de estorno.
    expect(refund).not.toHaveBeenCalled();
  });

  it('treats a run from another workspace as missing', async () => {
    const { service, repo } = deps({ findInWorkspace: vi.fn().mockResolvedValue(null) });

    await expect(service({ tenant, id: RUN_ID })).rejects.toBeInstanceOf(NotFoundError);
    expect(repo.cancel).not.toHaveBeenCalled();
  });
});
