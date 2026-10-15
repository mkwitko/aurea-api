import { afterAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createBillingRepository } from './billing.repository.js';

const prisma = new PrismaClient();
const repo = createBillingRepository(prisma);

afterAll(async () => {
  await prisma.$disconnect();
});

describe('billing b2b migration', () => {
  it('gives every organization a plan and a subscription status', async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const org = await prisma.organization.create({ data: { name: 'B2b IT', slug: `b2b-${suffix}` } });

    expect(org.plan).toBe('STARTER');
    expect(org.subscriptionStatus).toBe('TRIAL');
    expect(org.stripeCustomerId).toBeNull();
    expect(org.currentPeriodEnd).toBeNull();
  });

  it('keeps a StripeEvent id unique so a redelivery cannot be processed twice', async () => {
    const id = `evt_${Date.now()}`;
    await prisma.stripeEvent.create({ data: { id, type: 'checkout.session.completed' } });

    const inserted = await prisma.$executeRaw`
      INSERT INTO "StripeEvent" ("id", "type", "processedAt")
      VALUES (${id}, 'checkout.session.completed', now())
      ON CONFLICT ("id") DO NOTHING
    `;

    expect(inserted).toBe(0);
  });
});

describe('claimCustomerId', () => {
  // Um update simples deixava o segundo gravador vencer e transformava o
  // Customer do primeiro em órfão: um pagamento nele chega com um customer que o
  // banco não conhece. A reivindicação grava só sobre nulo, e quem perde recebe
  // o vencedor de volta em vez de seguir com um id que ninguém vai reconhecer.
  it('lets exactly one of two concurrent claims win, and tells the loser who won', async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const org = await prisma.organization.create({ data: { name: 'Claim IT', slug: `claim-${suffix}` } });

    const [a, b] = await Promise.all([
      repo.claimCustomerId(org.id, `cus_a_${suffix}`),
      repo.claimCustomerId(org.id, `cus_b_${suffix}`),
    ]);

    const stored = await prisma.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(a).toBe(stored.stripeCustomerId);
    expect(b).toBe(stored.stripeCustomerId);
  });

  it('keeps the stored customer when one is already claimed', async () => {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const org = await prisma.organization.create({
      data: { name: 'Claim IT', slug: `claim2-${suffix}`, stripeCustomerId: `cus_first_${suffix}` },
    });

    expect(await repo.claimCustomerId(org.id, `cus_second_${suffix}`)).toBe(`cus_first_${suffix}`);
  });
});
