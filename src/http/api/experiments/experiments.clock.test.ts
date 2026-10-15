import { describe, expect, it } from 'vitest';
import { ExperimentStatus } from '@prisma/client';
import { TRANSITIONS } from './experiments.domain.js';
import { dueTransition, type ClockRow } from './experiments.clock.js';

const row = (over: Partial<ClockRow>): ClockRow => ({
  id: 'e1',
  workspaceId: 'ws-1',
  status: ExperimentStatus.APPROVED,
  startDate: null,
  endDate: null,
  ...over,
});

const NOW = new Date('2026-08-10T12:00:00.000Z');

describe('dueTransition', () => {
  it('inicia um aprovado cuja data de início já chegou', () => {
    const at = dueTransition(row({ startDate: new Date('2026-08-10T00:00:00.000Z') }), NOW);

    expect(at).toBe(ExperimentStatus.RUNNING);
  });

  it('não inicia um aprovado cuja data de início ainda não chegou', () => {
    expect(dueTransition(row({ startDate: new Date('2026-08-11T00:00:00.000Z') }), NOW)).toBeNull();
  });

  // A ausência da data é a ausência da declaração. Inventar o dia envenena a
  // leitura do resultado tanto quanto inventar o baseline — é a restrição de
  // domínio do spec §2.
  it('não inicia um aprovado sem data de início', () => {
    expect(dueTransition(row({ startDate: null }), NOW)).toBeNull();
  });

  it('completa um em execução cujo dia de fim já passou inteiro', () => {
    const at = dueTransition(
      row({ status: ExperimentStatus.RUNNING, endDate: new Date('2026-08-09T00:00:00.000Z') }),
      NOW,
    );

    expect(at).toBe(ExperimentStatus.COMPLETED);
  });

  // A fronteira. Um teste que termina hoje não fecha hoje: fechar um dia antes
  // corta medição que o fundador contava ter; fechar um dia depois só atrasa a
  // cobrança (spec §3.2).
  it('não completa no próprio dia de fim, nem no último instante dele', () => {
    const today = row({ status: ExperimentStatus.RUNNING, endDate: new Date('2026-08-10T00:00:00.000Z') });

    expect(dueTransition(today, NOW)).toBeNull();
    expect(dueTransition(today, new Date('2026-08-10T23:59:59.999Z'))).toBeNull();
    expect(dueTransition(today, new Date('2026-08-11T00:00:00.000Z'))).toBe(ExperimentStatus.COMPLETED);
  });

  it('não completa um em execução sem data de fim', () => {
    expect(dueTransition(row({ status: ExperimentStatus.RUNNING, endDate: null }), NOW)).toBeNull();
  });

  // Pausar tem motivo humano (docs/domains/experiments.md §21) e retomar por
  // relógio apagaria essa decisão. DRAFT e PLANNED não têm o que cumprir ainda,
  // e COMPLETED/CANCELLED são terminais.
  it('não toca nenhum outro status, mesmo com as datas vencidas', () => {
    const past = { startDate: new Date('2026-01-01T00:00:00.000Z'), endDate: new Date('2026-01-02T00:00:00.000Z') };

    for (const status of [
      ExperimentStatus.DRAFT,
      ExperimentStatus.PLANNED,
      ExperimentStatus.PAUSED,
      ExperimentStatus.COMPLETED,
      ExperimentStatus.CANCELLED,
    ]) {
      expect(dueTransition(row({ status, ...past }), NOW)).toBeNull();
    }
  });

  // A trava contra o relógio virar um caminho paralelo de escrita: tudo que ele
  // propõe tem de ser uma aresta que a tabela já permite.
  it('só propõe passos que a tabela de transições permite', () => {
    const proposals = [
      dueTransition(row({ startDate: new Date('2026-08-01T00:00:00.000Z') }), NOW),
      dueTransition(row({ status: ExperimentStatus.RUNNING, endDate: new Date('2026-08-01T00:00:00.000Z') }), NOW),
    ];

    expect(proposals).toEqual([ExperimentStatus.RUNNING, ExperimentStatus.COMPLETED]);
    expect(TRANSITIONS[ExperimentStatus.APPROVED]).toContain(ExperimentStatus.RUNNING);
    expect(TRANSITIONS[ExperimentStatus.RUNNING]).toContain(ExperimentStatus.COMPLETED);
  });
});
