import { PrismaClient } from '@prisma/client';
import { createCreditRepository } from '../billing/credit.repository.js';
import { createCreditService } from '../billing/credit.service.js';
import { PLAN_CHANGE_REASON } from '../billing/subscription.service.js';

export type GrantArgs = { workspaceId: string; credits: number; reason: string };

// Mesma constante que o subscription.service usa para gravar e para ler os
// lançamentos de troca de plano, em minúsculas para comparar sem depender de caixa.
const RESERVED_REASON_PREFIX = PLAN_CHANGE_REASON.toLowerCase();

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
}

export function parseGrantArgs(argv: string[]): GrantArgs {
  const workspaceId = flag(argv, 'workspace');
  const credits = Number(flag(argv, 'credits'));
  const reason = flag(argv, 'reason');

  if (!workspaceId) throw new Error('--workspace is required');
  if (!Number.isInteger(credits) || credits <= 0) throw new Error('--credits must be a positive integer');
  // Sem motivo, o extrato deixa de explicar de onde veio o crédito — e ele é o
  // único registro de auditoria que existe.
  //
  // O prefixo reservado não é decoração: o complemento de franquia do B2b
  // identifica os lançamentos dele por `reason LIKE 'plan change%'`. Um grant
  // manual com esse prefixo entra na conta do mês e reduz, em silêncio, um
  // complemento legítimo posterior.
  if (!reason) throw new Error('--reason is required');
  if (reason.toLowerCase().startsWith(RESERVED_REASON_PREFIX)) {
    throw new Error(
      `--reason must not start with "${RESERVED_REASON_PREFIX}": that prefix is reserved for the ` +
        'automatic mid-period plan-change top-up, and a manual grant using it would be counted ' +
        "against the month's franchise top-up",
    );
  }

  return { workspaceId, credits, reason };
}

if (process.argv[1]?.endsWith('grant-credits.ts')) {
  const args = parseGrantArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const service = createCreditService({ repo: createCreditRepository(prisma) });

  service
    .grant(args)
    .then(async () => {
      console.log(`granted ${args.credits} credits to ${args.workspaceId}`);
      await prisma.$disconnect();
    })
    .catch(async (error: unknown) => {
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
