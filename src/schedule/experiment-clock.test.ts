import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExperimentStatus } from '@prisma/client';
import { tickExperimentClock } from './experiment-clock.js';

const NOW = new Date('2026-08-10T12:00:00.000Z');

const logger = { info: vi.fn(), error: vi.fn() };

function repoWith(rows: unknown[]) {
  return {
    findDueSystemWide: vi.fn().mockResolvedValue(rows),
    findById: vi.fn(),
    setStatus: vi.fn().mockResolvedValue({}),
  };
}

beforeEach(() => vi.clearAllMocks());

describe('tickExperimentClock', () => {
  it('inicia o aprovado vencido e completa o em execução vencido', async () => {
    const approved = {
      id: 'a1',
      workspaceId: 'ws-1',
      status: ExperimentStatus.APPROVED,
      startDate: new Date('2026-08-09T00:00:00.000Z'),
      endDate: new Date('2026-08-20T00:00:00.000Z'),
    };
    const running = {
      id: 'r1',
      workspaceId: 'ws-2',
      status: ExperimentStatus.RUNNING,
      startDate: new Date('2026-08-01T00:00:00.000Z'),
      endDate: new Date('2026-08-09T00:00:00.000Z'),
    };
    const repo = repoWith([approved, running]);
    // `findById` é o que o transitionExperimentService lê antes de escrever.
    repo.findById.mockImplementation((_ws: string, id: string) =>
      Promise.resolve(id === 'a1' ? approved : running),
    );

    const moved = await tickExperimentClock({ repo: repo as never, logger }, { now: NOW });

    expect(moved).toBe(2);
    expect(repo.setStatus).toHaveBeenNthCalledWith(1, 'a1', ExperimentStatus.RUNNING, {});
    expect(repo.setStatus).toHaveBeenNthCalledWith(2, 'r1', ExperimentStatus.COMPLETED, { completedAt: NOW });
  });

  // O filtro do SQL é mais grosso que a regra do dia (spec §3.4): a decisão
  // pura é a autoridade, e uma linha que a consulta trouxe sem estar vencida
  // não pode virar escrita.
  it('ignora a linha que a consulta trouxe mas a regra não considera vencida', async () => {
    const today = {
      id: 'r2',
      workspaceId: 'ws-1',
      status: ExperimentStatus.RUNNING,
      startDate: new Date('2026-08-01T00:00:00.000Z'),
      endDate: new Date('2026-08-10T00:00:00.000Z'),
    };
    const repo = repoWith([today]);

    const moved = await tickExperimentClock({ repo: repo as never, logger }, { now: NOW });

    expect(moved).toBe(0);
    expect(repo.setStatus).not.toHaveBeenCalled();
    expect(repo.findById).not.toHaveBeenCalled();
  });

  // Um experimento que falha não pode derrubar o tick: o próximo ainda tem de
  // ser tratado. Mesma postura do reconcileDeadRun no worker de runs.
  it('registra a falha de um experimento e segue com os demais', async () => {
    const first = {
      id: 'a1',
      workspaceId: 'ws-1',
      status: ExperimentStatus.APPROVED,
      startDate: new Date('2026-08-01T00:00:00.000Z'),
      endDate: null,
    };
    const second = { ...first, id: 'a2', workspaceId: 'ws-2' };
    const repo = repoWith([first, second]);
    repo.findById.mockImplementation((_ws: string, id: string) =>
      id === 'a1' ? Promise.reject(new Error('database is on fire')) : Promise.resolve(second),
    );

    const moved = await tickExperimentClock({ repo: repo as never, logger }, { now: NOW });

    expect(moved).toBe(1);
    expect(repo.setStatus).toHaveBeenCalledTimes(1);
    expect(repo.setStatus).toHaveBeenCalledWith('a2', ExperimentStatus.RUNNING, {});
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ experimentId: 'a1', to: ExperimentStatus.RUNNING }),
      expect.any(String),
    );
  });

  // O relógio escreve por tenant mesmo lendo system-wide (spec §3.4).
  it('lê cruzando workspaces e escreve com o workspace da linha', async () => {
    const row = {
      id: 'a1',
      workspaceId: 'ws-9',
      status: ExperimentStatus.APPROVED,
      startDate: new Date('2026-08-01T00:00:00.000Z'),
      endDate: null,
    };
    const repo = repoWith([row]);
    repo.findById.mockResolvedValue(row);

    await tickExperimentClock({ repo: repo as never, logger }, { now: NOW });

    expect(repo.findDueSystemWide).toHaveBeenCalledWith(NOW);
    expect(repo.findById).toHaveBeenCalledWith('ws-9', 'a1');
  });

  // A trava contra escrita direta: a transição passa pelo serviço compartilhado,
  // que aplica assertExperimentTransition. Um estado que a tabela não permite
  // vira erro logado, não uma linha atualizada.
  it('não escreve quando a tabela de transições recusa o passo', async () => {
    const row = {
      id: 'a1',
      workspaceId: 'ws-1',
      status: ExperimentStatus.APPROVED,
      startDate: new Date('2026-08-01T00:00:00.000Z'),
      endDate: null,
    };
    const repo = repoWith([row]);
    // O que o banco realmente tem já mudou desde a leitura: cancelado no meio.
    repo.findById.mockResolvedValue({ ...row, status: ExperimentStatus.CANCELLED });

    const moved = await tickExperimentClock({ repo: repo as never, logger }, { now: NOW });

    expect(moved).toBe(0);
    expect(repo.setStatus).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});
