import { describe, expect, it, vi } from 'vitest';
import { ExperimentStatus } from '@prisma/client';
import { createExperimentsRepository } from './experiments.repository.js';
import { clockCutoff, dueTransition } from './experiments.clock.js';

const NOW = new Date('2026-08-10T12:00:00.000Z');

/** Um prisma que só registra o argumento: o que se afirma aqui é o `where`. */
function capturingPrisma() {
  const findMany = vi.fn().mockResolvedValue([]);
  return { prisma: { experiment: { findMany } }, findMany };
}

async function whereOf(now: Date) {
  const { prisma, findMany } = capturingPrisma();
  await createExperimentsRepository(prisma as never).findDueSystemWide(now);
  const [call] = findMany.mock.calls;
  // Sem consulta não há o que afirmar, e um `where` vazio não pode passar por
  // acidente como um `where` correto.
  if (!call) throw new Error('findDueSystemWide did not query the database');
  return call[0] as {
    where: { OR: [{ startDate: { lte: Date } }, { endDate: { lt: Date } }] };
    take: number;
    orderBy: unknown;
  };
}

describe('findDueSystemWide', () => {
  it('filtra por status e data, mais antigos primeiro, com teto de linhas', async () => {
    const args = await whereOf(NOW);

    expect(args.where.OR).toEqual([
      { status: ExperimentStatus.APPROVED, startDate: { lte: NOW } },
      { status: ExperimentStatus.RUNNING, endDate: { lt: clockCutoff(NOW) } },
    ]);
    expect(args.take).toBe(200);
    expect(args.orderBy).toEqual([{ updatedAt: 'asc' }, { id: 'asc' }]);
  });

  /**
   * A trava contra a fome do relógio.
   *
   * Uma linha que a consulta traz e `dueTransition` descarta não é escrita, então
   * seu `updatedAt` não muda — e com `orderBy updatedAt asc` ela volta na mesma
   * página no tick seguinte, indefinidamente. Duzentos experimentos terminando
   * hoje ocupariam o `take` inteiro e nenhum vencido de verdade sairia.
   *
   * Por isso a afirmação é uma equivalência, e não um valor: o que a consulta
   * admite tem de ser exatamente o que a regra move, nos dois sentidos.
   */
  it('admite exatamente as linhas que a regra move', async () => {
    const cutoff = (await whereOf(NOW)).where.OR[1].endDate.lt;

    const endDates = [
      new Date('2026-08-08T00:00:00.000Z'),
      new Date('2026-08-09T23:59:59.999Z'),
      new Date('2026-08-10T00:00:00.000Z'),
      new Date('2026-08-10T11:59:59.999Z'),
      new Date('2026-08-10T23:59:59.999Z'),
      new Date('2026-08-11T00:00:00.000Z'),
    ];

    for (const endDate of endDates) {
      const admittedByQuery = endDate.getTime() < cutoff.getTime();
      const movedByRule =
        dueTransition(
          { id: 'e1', workspaceId: 'ws-1', status: ExperimentStatus.RUNNING, startDate: null, endDate },
          NOW,
        ) !== null;

      expect(admittedByQuery, `endDate ${endDate.toISOString()}`).toBe(movedByRule);
    }
  });
});
