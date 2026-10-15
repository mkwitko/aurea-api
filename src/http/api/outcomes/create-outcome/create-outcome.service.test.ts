import { describe, expect, it, vi } from 'vitest';
import { createOutcomeService } from './create-outcome.service.js';

const EXPERIMENT = {
  id: 'exp-1',
  metric: 'conversion_rate',
  baselineValue: 4.2,
  targetValue: 6,
};

const ROW = {
  id: 'out-1',
  workspaceId: 'ws-1',
  experimentId: 'exp-1',
  metric: 'conversion_rate',
  value: 6.1,
  unit: '%',
  observedAt: new Date('2026-08-11T00:00:00.000Z'),
  source: 'USER',
  createdAt: new Date('2026-08-11T00:00:00.000Z'),
  updatedAt: new Date('2026-08-11T00:00:00.000Z'),
};

const TENANT = { userId: 'u1', organizationId: 'org-1', workspaceId: 'ws-1', role: 'MEMBER' as const };

function deps(startRun: ReturnType<typeof vi.fn>, readMeasurement = vi.fn()) {
  return {
    repo: {
      experimentInWorkspace: vi.fn().mockResolvedValue(EXPERIMENT),
      create: vi.fn().mockResolvedValue(ROW),
    } as never,
    startRun,
    readMeasurement,
  };
}

describe('createOutcomeService — interpretação', () => {
  it('enfileira a interpretação do experimento depois de gravar o número', async () => {
    const startRun = vi.fn().mockResolvedValue({ id: 'run-1' });
    const service = createOutcomeService(deps(startRun));

    const result = await service({ value: 6.1, workspaceId: 'ws-1', experimentId: 'exp-1', tenant: TENANT });

    expect(result.interpretation).toEqual({ agentRunId: 'run-1', reason: null });
    expect(startRun).toHaveBeenCalledWith({
      tenant: TENANT,
      taskType: 'interpret-outcome',
      input: { experimentId: 'exp-1' },
    });
  });

  // A medição é fato observado; o faturamento não pode apagá-la. Saldo curto
  // devolve o número gravado e a razão, nunca uma exceção (spec §5.1).
  it('mantém o número gravado quando o disparo é recusado', async () => {
    const startRun = vi.fn().mockRejectedValue(new Error('Insufficient credits'));
    const d = deps(startRun);
    const service = createOutcomeService(d);

    const result = await service({ value: 6.1, workspaceId: 'ws-1', experimentId: 'exp-1', tenant: TENANT });

    expect(result.outcome.value).toBe(6.1);
    expect(result.interpretation).toEqual({ agentRunId: null, reason: 'Insufficient credits' });
    expect((d.repo as unknown as { create: ReturnType<typeof vi.fn> }).create).toHaveBeenCalled();
  });

  // Ordem obrigatória: gravar, depois disparar. Se o disparo viesse primeiro,
  // uma falha de escrita deixaria um run pago sobre um número que não existe.
  it('grava antes de disparar', async () => {
    const order: string[] = [];
    const startRun = vi.fn().mockImplementation(() => {
      order.push('start');
      return Promise.resolve({ id: 'run-1' });
    });
    const d = deps(startRun);
    (d.repo as unknown as { create: ReturnType<typeof vi.fn> }).create.mockImplementation(() => {
      order.push('create');
      return Promise.resolve(ROW);
    });

    await createOutcomeService(d)({ value: 6.1, workspaceId: 'ws-1', experimentId: 'exp-1', tenant: TENANT });

    expect(order).toEqual(['create', 'start']);
  });

  it('continua recusando uma observação no futuro, sem disparar nada', async () => {
    const startRun = vi.fn();
    const service = createOutcomeService(deps(startRun));

    await expect(
      service({
        value: 6.1,
        workspaceId: 'ws-1',
        experimentId: 'exp-1',
        tenant: TENANT,
        observedAt: new Date('2027-01-01T00:00:00.000Z'),
        now: new Date('2026-08-11T00:00:00.000Z'),
      }),
    ).rejects.toThrow(/future/i);
    expect(startRun).not.toHaveBeenCalled();
  });
});

const READING = {
  value: 42,
  unit: null,
  periodStart: new Date('2026-07-01T00:00:00Z'),
  periodEnd: new Date('2026-07-14T00:00:00Z'),
  externalRef: 'properties/123456789:conversions',
  query: { metrics: [{ name: 'conversions' }] },
  source: 'GA4',
};

describe('createOutcomeService — leitura de fonte', () => {
  // A trava central do spec §8: confirmar é concordar com a leitura, não
  // transportá-la. O servidor refaz a leitura pelo conector.
  it('refaz a leitura e grava o que o conector devolveu, com proveniência', async () => {
    const read = vi.fn().mockResolvedValue(READING);
    const d = deps(vi.fn().mockResolvedValue({ id: 'run-1' }), read);

    await createOutcomeService(d)({
      fromSource: true,
      workspaceId: 'ws-1',
      experimentId: 'exp-1',
      tenant: TENANT,
    });

    expect(read).toHaveBeenCalledWith('ws-1', 'exp-1', expect.anything());
    const create = (d.repo as unknown as { create: ReturnType<typeof vi.fn> }).create;
    expect(create).toHaveBeenCalledWith('ws-1', expect.objectContaining({
      value: 42,
      source: 'GA4',
      periodStart: READING.periodStart,
      periodEnd: READING.periodEnd,
      externalRef: 'properties/123456789:conversions',
      sourceDetail: { metrics: [{ name: 'conversions' }] },
    }));
  });

  it('não chama o conector no caminho manual, e não grava proveniência', async () => {
    const read = vi.fn();
    const d = deps(vi.fn().mockResolvedValue({ id: 'run-1' }), read);

    await createOutcomeService(d)({ value: 6.1, workspaceId: 'ws-1', experimentId: 'exp-1', tenant: TENANT });

    expect(read).not.toHaveBeenCalled();
    const create = (d.repo as unknown as { create: ReturnType<typeof vi.fn> }).create;
    const data = create.mock.calls[0]![1] as Record<string, unknown>;
    expect(data).toMatchObject({ value: 6.1, source: 'USER' });
    expect(data.externalRef).toBeUndefined();
    expect(data.periodStart).toBeUndefined();
  });

  // A recusa da fonte não pode virar um Outcome vazio: sem número não há
  // medição, e gravar zero por falta de leitura seria inventar o resultado.
  it('não grava nada quando a leitura falha', async () => {
    const read = vi.fn().mockRejectedValue(new Error('Caller does not have permission.'));
    const startRun = vi.fn();
    const d = deps(startRun, read);

    await expect(
      createOutcomeService(d)({ fromSource: true, workspaceId: 'ws-1', experimentId: 'exp-1', tenant: TENANT }),
    ).rejects.toThrow(/permission/i);

    expect((d.repo as unknown as { create: ReturnType<typeof vi.fn> }).create).not.toHaveBeenCalled();
    expect(startRun).not.toHaveBeenCalled();
  });

  // Defesa em profundidade: o schema da rota já recusa, e um chamador interno
  // futuro não pode gravar um outcome sem número.
  it('recusa um pedido sem valor e sem fonte', async () => {
    const d = deps(vi.fn(), vi.fn());

    await expect(
      createOutcomeService(d)({ workspaceId: 'ws-1', experimentId: 'exp-1', tenant: TENANT } as never),
    ).rejects.toThrow(/value/i);
  });

  it('a unidade informada pelo humano vence a da fonte', async () => {
    const read = vi.fn().mockResolvedValue({ ...READING, unit: null });
    const d = deps(vi.fn().mockResolvedValue({ id: 'run-1' }), read);

    await createOutcomeService(d)({
      fromSource: true,
      unit: 'calls',
      workspaceId: 'ws-1',
      experimentId: 'exp-1',
      tenant: TENANT,
    });

    const create = (d.repo as unknown as { create: ReturnType<typeof vi.fn> }).create;
    expect(create.mock.calls[0]![1]).toMatchObject({ unit: 'calls' });
  });
});
