import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createWorkspaceForOrg } from './create-workspace.js';

const prisma = new PrismaClient();

let organizationId = '';
let ownerId = '';

beforeEach(async () => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const org = await prisma.organization.create({
    data: { name: 'Workspace Cap IT', slug: `wcap-${suffix}`, plan: 'GROWTH' },
  });
  organizationId = org.id;

  const owner = await prisma.user.create({
    data: { email: `owner-${suffix}@example.com`, passwordHash: 'x', name: 'Owner' },
  });
  ownerId = owner.id;

  // GROWTH tem teto de 3 workspaces; semear com 2 deixa a org exatamente uma
  // criação abaixo do teto — é a fronteira onde a corrida aparece.
  await prisma.workspace.create({ data: { organizationId, name: 'W1', slug: `w1-${suffix}` } });
  await prisma.workspace.create({ data: { organizationId, name: 'W2', slug: `w2-${suffix}` } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('workspace cap concurrency', () => {
  it('lets exactly one of two simultaneous creations through at the cap boundary', async () => {
    const results = await Promise.allSettled([
      createWorkspaceForOrg(prisma, organizationId, { name: 'Race A', creatorUserId: ownerId, creatorRole: 'OWNER' }),
      createWorkspaceForOrg(prisma, organizationId, { name: 'Race B', creatorUserId: ownerId, creatorRole: 'OWNER' }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'AUR-T0017' });

    // A prova final: a organização nunca passa de 3 workspaces ativos, não
    // importa quantas criações concorrentes cheguem na fronteira do teto.
    const count = await prisma.workspace.count({
      where: { organizationId, deletedAt: null, status: 'ACTIVE' },
    });
    expect(count).toBe(3);
  });
});

describe('trial credits', () => {
  async function freshOrg() {
    const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const org = await prisma.organization.create({
      data: { name: 'Trial IT', slug: `trial-${suffix}`, plan: 'GROWTH' },
    });
    const user = await prisma.user.create({
      data: { email: `trial-${suffix}@example.com`, passwordHash: 'x', name: 'Trial' },
    });
    return { organizationId: org.id, userId: user.id };
  }

  function ledgerOf(workspaceId: string) {
    return prisma.creditLedger.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } });
  }

  it('grants the one-off trial to the first workspace of an organization', async () => {
    const { organizationId, userId } = await freshOrg();

    const first = await createWorkspaceForOrg(prisma, organizationId, {
      name: 'Acme',
      creatorUserId: userId,
      creatorRole: 'OWNER',
    });

    expect(await ledgerOf(first.id)).toMatchObject([
      { kind: 'GRANT', credits: 50, reason: 'trial credits' },
    ]);
  });

  it('grants nothing to the second workspace', async () => {
    const { organizationId, userId } = await freshOrg();
    await createWorkspaceForOrg(prisma, organizationId, {
      name: 'Acme',
      creatorUserId: userId,
      creatorRole: 'OWNER',
    });

    const second = await createWorkspaceForOrg(prisma, organizationId, {
      name: 'Acme Two',
      creatorUserId: userId,
      creatorRole: 'OWNER',
    });

    expect(await ledgerOf(second.id)).toEqual([]);
  });

  // O trial é UM. Duas criações simultâneas no org vazio não podem lançar dois:
  // a decisão é tomada com a linha da organização travada, então a segunda
  // recount já vê o workspace da primeira.
  it('grants exactly one trial when two first-workspace creations race', async () => {
    const { organizationId, userId } = await freshOrg();

    const created = await Promise.all([
      createWorkspaceForOrg(prisma, organizationId, { name: 'Race A', creatorUserId: userId, creatorRole: 'OWNER' }),
      createWorkspaceForOrg(prisma, organizationId, { name: 'Race B', creatorUserId: userId, creatorRole: 'OWNER' }),
    ]);

    const entries = await prisma.creditLedger.findMany({
      where: { workspaceId: { in: created.map((w) => w.id) } },
    });
    expect(entries).toHaveLength(1);
  });
});
