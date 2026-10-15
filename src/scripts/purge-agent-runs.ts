import { PrismaClient } from '@prisma/client';

const DAY_MS = 24 * 60 * 60 * 1000;

// AgentRun.input/output guardam dado de cliente fora do Growth Brain. Sem
// purga, auditoria vira passivo de LGPD (security-architecture.md §7).
export async function purgeAgentRuns(
  prisma: PrismaClient,
  olderThanDays: number,
  now: Date,
): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanDays * DAY_MS);

  const { count } = await prisma.agentRun.deleteMany({
    where: {
      status: { in: ['COMPLETED', 'FAILED', 'CANCELLED'] },
      createdAt: { lt: cutoff },
    },
  });

  return count;
}

if (process.argv[1]?.endsWith('purge-agent-runs.ts')) {
  const prisma = new PrismaClient();
  purgeAgentRuns(prisma, 90, new Date())
    .then((count) => {
      console.log(`purged ${count} agent runs`);
      return prisma.$disconnect();
    })
    .catch(async (error: unknown) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
