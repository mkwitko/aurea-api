import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { TRIAL_CREDITS } from './plan-catalog.js';

const prisma = new PrismaClient();

const SQL = readFileSync(
  new URL('../../prisma/migrations/20260803120000_drop_untouched_default_workspaces/migration.sql', import.meta.url),
  'utf8',
);

// O arquivo é o que roda em produção: ler dele em vez de reescrever o SELECT
// aqui é o que impede o teste de aprovar critérios que a migração não tem.
//
// A regex de comentário (`--[^\n]*`) e o split em `;` são só uma aproximação
// do parser real do Postgres — comeriam um `--` dentro de uma string literal,
// por exemplo. Este arquivo não tem nenhum, então a aproximação hoje é exata;
// a asserção de contagem abaixo é o que faz uma edição futura que engane o
// splitter (uma string com `--`, um corpo `$$`-quoted) falhar alto em vez de
// silenciosamente testar um script diferente do que roda de verdade.
function splitStatements(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);
}

// $executeRawUnsafe não aceita múltiplos comandos em uma só chamada (protocolo
// estendido do Postgres exige um comando por statement preparado). Por isso o
// arquivo é dividido em statements e cada um roda dentro de uma única
// $transaction — mesma conexão, então a temporary table sobrevive entre eles.
async function runCleanup() {
  const statements = splitStatements(SQL);
  await prisma.$transaction(statements.map((stmt) => prisma.$executeRawUnsafe(stmt)));
}

// Organizações seedadas nesta suíte, para apagar no afterEach. `runCleanup`
// roda contra o banco inteiro (é o mesmo texto que roda em produção, sem
// escopo por id) — sem isto, um workspace `default` intocado que sobra de um
// teste seria varrido pela chamada de outro teste, ou por outro arquivo de
// integração rodando em paralelo.
const seededOrganizationIds: string[] = [];

async function seedDefaultWorkspace(label: string) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}-${label}`;
  const org = await prisma.organization.create({
    data: { name: `Cleanup ${label}`, slug: `cleanup-${suffix}`, plan: 'STARTER' },
  });
  seededOrganizationIds.push(org.id);
  const user = await prisma.user.create({
    data: { email: `cleanup-${suffix}@example.com`, passwordHash: 'x', name: 'Owner' },
  });
  const workspace = await prisma.workspace.create({
    data: { organizationId: org.id, name: 'Default', slug: 'default' },
  });
  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId: org.id, workspaceId: workspace.id, role: 'OWNER' },
  });
  await prisma.creditLedger.create({
    data: { workspaceId: workspace.id, kind: 'GRANT', credits: TRIAL_CREDITS, reason: 'trial credits' },
  });
  return { organizationId: org.id, userId: user.id, workspaceId: workspace.id, membershipId: membership.id };
}

afterEach(async () => {
  // `Organization` deleta em cascata `Workspace`, `Membership` e o que penda
  // deles; `User` não é filho de `Organization` no schema, então os ids saem
  // das memberships ANTES do cascade apagá-las, e o usuário é removido à
  // parte depois.
  while (seededOrganizationIds.length > 0) {
    const organizationId = seededOrganizationIds.pop();
    if (!organizationId) continue;
    const memberships = await prisma.membership.findMany({ where: { organizationId }, select: { userId: true } });
    await prisma.organization.deleteMany({ where: { id: organizationId } }).catch(() => undefined);
    const userIds = memberships.map((m) => m.userId);
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } }).catch(() => undefined);
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('untouched default workspace cleanup', () => {
  // M7 do final-review: se uma edição futura no arquivo escapar da aproximação
  // do splitter (um `--` dentro de uma string, um corpo `$$`-quoted que quebra
  // no `;`), este número muda e o teste fala alto em vez de silenciosamente
  // rodar um script diferente do arquivo real.
  it('splits the migration file into exactly the four statements it is written as', () => {
    // CREATE TEMPORARY TABLE ... SELECT ... FOR UPDATE, UPDATE "Membership",
    // DELETE FROM "Workspace", DROP TABLE.
    expect(splitStatements(SQL)).toHaveLength(4);
  });

  it('deletes the workspace and leaves the membership at organization level', async () => {
    const seeded = await seedDefaultWorkspace('plain');

    await runCleanup();

    expect(await prisma.workspace.findUnique({ where: { id: seeded.workspaceId } })).toBeNull();
    const membership = await prisma.membership.findUnique({ where: { id: seeded.membershipId } });
    expect(membership).toMatchObject({ organizationId: seeded.organizationId, workspaceId: null, role: 'OWNER' });
  });

  it('keeps a default workspace that holds a business', async () => {
    const seeded = await seedDefaultWorkspace('with-business');
    await prisma.business.create({
      data: { workspaceId: seeded.workspaceId, name: 'Acme' },
    });

    await runCleanup();

    expect(await prisma.workspace.findUnique({ where: { id: seeded.workspaceId } })).not.toBeNull();
  });

  it('keeps a default workspace whose ledger has a second entry', async () => {
    const seeded = await seedDefaultWorkspace('spent');
    await prisma.creditLedger.create({
      data: { workspaceId: seeded.workspaceId, kind: 'DEBIT', credits: -1, reason: 'agent run' },
    });

    await runCleanup();

    expect(await prisma.workspace.findUnique({ where: { id: seeded.workspaceId } })).not.toBeNull();
  });

  it('keeps a default workspace in an organization that has a second workspace', async () => {
    const seeded = await seedDefaultWorkspace('two-workspaces');
    await prisma.workspace.create({
      data: { organizationId: seeded.organizationId, name: 'Growth', slug: `growth-${seeded.workspaceId}` },
    });

    await runCleanup();

    expect(await prisma.workspace.findUnique({ where: { id: seeded.workspaceId } })).not.toBeNull();
  });
});
