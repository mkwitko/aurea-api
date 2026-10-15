import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createCreditRepository } from './credit.repository.js';
import { createCreditService } from './credit.service.js';

const prisma = new PrismaClient();
const service = createCreditService({ repo: createCreditRepository(prisma) });

const NOW = new Date('2026-07-15T10:00:00Z');
const PERIOD = new Date('2026-07-01T00:00:00Z');

let workspaceId = '';
let runA = '';
let runB = '';

beforeEach(async () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const org = await prisma.organization.create({ data: { name: 'Billing IT', slug: `it-${suffix}` } });
  const workspace = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'IT', slug: `it-${suffix}` },
  });
  workspaceId = workspace.id;

  // Período com exatamente um crédito sobrando: é o cenário que expõe a corrida.
  await prisma.creditPeriod.create({
    data: { workspaceId, periodStart: PERIOD, allowance: 1, consumed: 0 },
  });

  const mkRun = (hash: string) =>
    prisma.agentRun.create({
      data: {
        workspaceId,
        agentType: 'context-analyst',
        taskType: 'summarize-business-context',
        tier: 'TIER1',
        status: 'PENDING',
        inputHash: hash,
        input: {},
      },
    });

  runA = (await mkRun('a')).id;
  runB = (await mkRun('b')).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('credit concurrency', () => {
  it('charges exactly one of two simultaneous runs when one credit is left', async () => {
    const results = await Promise.all([
      service.authorizeAndCharge({
        workspaceId,
        taskType: 'summarize-business-context',
        agentRunId: runA,
        byok: false,
        now: NOW,
      }),
      service.authorizeAndCharge({
        workspaceId,
        taskType: 'summarize-business-context',
        agentRunId: runB,
        byok: false,
        now: NOW,
      }),
    ]);

    expect(results.filter((r) => r.allowed)).toHaveLength(1);

    expect(await prisma.creditLedger.count({ where: { workspaceId, kind: 'DEBIT' } })).toBe(1);

    const period = await prisma.creditPeriod.findFirstOrThrow({ where: { workspaceId } });
    expect(period.consumed).toBe(1);
  });

  it('opens the month exactly once under concurrency', async () => {
    await prisma.creditPeriod.deleteMany({ where: { workspaceId } });

    await Promise.all([
      service.authorizeAndCharge({
        workspaceId,
        taskType: 'summarize-business-context',
        agentRunId: runA,
        byok: false,
        now: NOW,
      }),
      service.authorizeAndCharge({
        workspaceId,
        taskType: 'summarize-business-context',
        agentRunId: runB,
        byok: false,
        now: NOW,
      }),
    ]);

    expect(await prisma.creditPeriod.count({ where: { workspaceId } })).toBe(1);
  });

  it('refunds a failed run back into the allowance, and only once', async () => {
    await service.authorizeAndCharge({
      workspaceId,
      taskType: 'summarize-business-context',
      agentRunId: runA,
      byok: false,
      now: NOW,
    });

    await service.refund({ agentRunId: runA, now: NOW });
    await service.refund({ agentRunId: runA, now: NOW });

    const period = await prisma.creditPeriod.findFirstOrThrow({ where: { workspaceId } });
    expect(period.consumed).toBe(0);
    expect(await prisma.creditLedger.count({ where: { agentRunId: runA, kind: 'REFUND' } })).toBe(1);
  });
});

// Toda garantia de "não credita duas vezes" deste branch se apoia num detalhe do
// Postgres: `INSERT ... ON CONFLICT DO NOTHING` devolve 1 na inserção nova e 0 na
// colisão, mesmo com duas transações concorrentes disputando a mesma chave. Isso
// só era exercitado contra um fake que devolvia 1, ou seja, contra nada.
describe('grantOnce concurrency', () => {
  it('inserts exactly one ledger row when the same key arrives twice at the same time', async () => {
    const input = {
      idempotencyKey: `cs_it_${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      eventType: 'credit-pack',
      entryKind: 'PURCHASE' as const,
      workspaceId,
      credits: 100,
      reason: 'credit pack SMALL',
    };

    const results = await Promise.all([service.grantOnce(input), service.grantOnce(input)]);

    // Uma concessão, uma linha, e o saldo comprado com o valor de UM pacote.
    expect(results.filter((granted) => granted)).toHaveLength(1);
    expect(await prisma.creditLedger.count({ where: { workspaceId, kind: 'PURCHASE' } })).toBe(1);
    expect(await createCreditRepository(prisma).purchasedBalance(workspaceId)).toBe(100);
  });
});
