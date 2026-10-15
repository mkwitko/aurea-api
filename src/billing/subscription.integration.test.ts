import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createBillingRepository } from './billing.repository.js';
import { createCreditRepository } from './credit.repository.js';
import { createCreditService, nextMonthUtc, startOfMonthUtc } from './credit.service.js';
import type { BillingEvent } from './stripe-event.js';
import { createSubscriptionService, PLAN_CHANGE_REASON } from './subscription.service.js';

// Contra Postgres real porque é o único lugar onde a conta do delta se prova:
// o "já concedido neste período" é uma agregação no ledger, e nenhum fake
// consegue reproduzir o efeito de um lançamento commitado sobre a conta do
// lançamento seguinte.
const prisma = new PrismaClient();
const creditRepo = createCreditRepository(prisma);
const service = createSubscriptionService({
  repo: createBillingRepository(prisma),
  credits: createCreditService({ repo: creditRepo }),
  periods: creditRepo,
});

// Derivado da data corrente, e não fixado num mês: `grantedInPeriodByReason`
// filtra por `CreditLedger.createdAt`, que é `now()` do banco e não entra por
// parâmetro. Com um mês fixo no passado, o agregado passa a devolver 0 na virada
// do mês e a asserção anti-empilhamento continua verde sem provar nada — o pior
// tipo de teste. Em produção não há esse descolamento: `now` e `now()` concordam.
const NOW = new Date();
const PERIOD_START = startOfMonthUtc(NOW);
const PERIOD_END = nextMonthUtc(PERIOD_START);

let organizationId = '';
let workspaceId = '';
let customerId = '';
let subscriptionId = '';

beforeEach(async () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  customerId = `cus_it_${suffix}`;
  subscriptionId = `sub_it_${suffix}`;

  const org = await prisma.organization.create({
    data: {
      name: 'Subscription IT',
      slug: `sub-it-${suffix}`,
      plan: 'STARTER',
      subscriptionStatus: 'ACTIVE',
      stripeCustomerId: customerId,
    },
  });
  organizationId = org.id;

  const workspace = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'IT', slug: `sub-it-${suffix}` },
  });
  workspaceId = workspace.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

type PlanName = 'STARTER' | 'GROWTH' | 'SCALE';

type Ids = { customerId: string; subscriptionId: string; workspaceId: string };

function stateEventFor(ids: Ids, plan: PlanName): BillingEvent {
  return {
    kind: 'subscription-state',
    customerId: ids.customerId,
    subscriptionId: ids.subscriptionId,
    plan,
    status: 'ACTIVE',
    // O Stripe mantém a âncora de cobrança numa troca de plano no meio do ciclo,
    // então o fim do período é o MESMO em todas as trocas do mês. É o que faz as
    // chaves de idempotência diferirem apenas pelo plano alvo.
    currentPeriodEnd: PERIOD_END,
    workspaceId: ids.workspaceId,
  };
}

function stateEvent(plan: PlanName): BillingEvent {
  return stateEventFor({ customerId, subscriptionId, workspaceId }, plan);
}

// Uma rodada: organização e workspace novos, um período congelado no allowance
// dado, e as entregas disparadas juntas. Devolve o total de crédito de troca de
// plano lançado no período.
//
// Repetida algumas vezes de propósito: sem a trava na linha do período, o
// intercalamento das leituras é probabilístico, e uma rodada isolada passava por
// sorte em cerca de metade das execuções. Rodadas repetidas transformam a corrida
// de "às vezes aparece" em "aparece".
async function concurrentRound(allowance: number, plans: PlanName[]): Promise<number> {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const org = await prisma.organization.create({
    data: {
      name: 'Race IT',
      slug: `race-${suffix}`,
      plan: 'STARTER',
      subscriptionStatus: 'ACTIVE',
      stripeCustomerId: `cus_race_${suffix}`,
    },
  });
  const workspace = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'IT', slug: `race-${suffix}` },
  });
  await prisma.creditPeriod.create({
    data: { workspaceId: workspace.id, periodStart: PERIOD_START, allowance, consumed: 0 },
  });

  const ids = {
    customerId: `cus_race_${suffix}`,
    subscriptionId: `sub_race_${suffix}`,
    workspaceId: workspace.id,
  };
  await Promise.all(plans.map((plan) => service.apply(stateEventFor(ids, plan), NOW)));

  return creditRepo.grantedInPeriodByReason(workspace.id, PERIOD_START, PERIOD_END, PLAN_CHANGE_REASON);
}

const ROUNDS = 4;

function planChangeTotal(): Promise<number> {
  return creditRepo.grantedInPeriodByReason(workspaceId, PERIOD_START, PERIOD_END, PLAN_CHANGE_REASON);
}

describe('mid-period plan change against real postgres', () => {
  it('never grants more than the top plan franchise, however many upward changes land in one period', async () => {
    // Período congelado no STARTER: é o cenário do upgrade no meio do mês.
    await prisma.creditPeriod.create({
      data: { workspaceId, periodStart: PERIOD_START, allowance: 200, consumed: 0 },
    });

    // A sequência que empilhava: sobe, desce, sobe de novo por outro par de
    // planos. Cada par era uma chave de idempotência nova e uma franquia
    // inteira a mais no extrato.
    await service.apply(stateEvent('SCALE'), NOW);
    await service.apply(stateEvent('STARTER'), NOW);
    await service.apply(stateEvent('GROWTH'), NOW);
    await service.apply(stateEvent('SCALE'), NOW);

    // 200 congelados + 3800 de complemento = 4000, a franquia SCALE do mês.
    expect(await planChangeTotal()).toBe(3_800);

    const period = await prisma.creditPeriod.findFirstOrThrow({ where: { workspaceId } });
    expect(period.allowance).toBe(200);
    expect(period.allowance + (await creditRepo.purchasedBalance(workspaceId))).toBe(4_000);
  });

  it('grants nothing when the period was never opened, and still saves the plan', async () => {
    await service.apply(stateEvent('GROWTH'), NOW);

    expect(await prisma.creditLedger.count({ where: { workspaceId } })).toBe(0);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    expect(org.plan).toBe('GROWTH');
    expect(org.subscriptionStatus).toBe('ACTIVE');
  });

  // O empilhamento que a chave NÃO barra, e que só a trava na linha do período
  // barra: dois alvos diferentes na mesma assinatura e no mesmo período são duas
  // chaves distintas, então nenhuma das duas entregas vê a outra na dedupe. Com a
  // leitura do "já concedido" fora da transação do lançamento, as duas leiam zero,
  // GROWTH lançava 800 e SCALE 3800: 4600 contra um teto de 3800.
  it('caps the total when two different upgrades land at the same time', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      // Teto: a franquia do plano mais alto alcançado menos o allowance
      // congelado, 4000 − 200. Nem um crédito além, em nenhuma rodada.
      expect(await concurrentRound(200, ['GROWTH', 'SCALE'])).toBe(3_800);
    }
  });

  it('caps the total when three different upgrades land at the same time on a trial period', async () => {
    // Pior caso: período aberto enquanto a org era TRIAL, congelado em 0. Sem a
    // trava, os três lançavam contra a mesma leitura: 200 + 1000 + 4000 = 5200.
    for (let round = 0; round < ROUNDS; round += 1) {
      expect(await concurrentRound(0, ['STARTER', 'GROWTH', 'SCALE'])).toBe(4_000);
    }
  });

  it('grants once when the same upgrade is delivered twice at the same time', async () => {
    await prisma.creditPeriod.create({
      data: { workspaceId, periodStart: PERIOD_START, allowance: 200, consumed: 0 },
    });

    // Reentrega concorrente: as duas cópias leem "nada concedido" antes de
    // qualquer uma commitar. Só a chave de idempotência as separa.
    await Promise.all([service.apply(stateEvent('GROWTH'), NOW), service.apply(stateEvent('GROWTH'), NOW)]);

    expect(await planChangeTotal()).toBe(800);
    expect(await prisma.creditLedger.count({ where: { workspaceId, kind: 'GRANT' } })).toBe(1);
  });
});
