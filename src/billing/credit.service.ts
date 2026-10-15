import type { CreditEntryKind, Plan } from '@prisma/client';
import { effectiveAllowance } from './plan-catalog.js';
import { creditCost } from './operation-cost.js';
import type { CreditRepository, CreditTx } from './credit.repository.js';

export type CreditCharge = {
  credits: number;
  fromAllowance: number;
  fromPurchased: number;
  ledgerEntryId: string;
};

export type AuthorizeResult =
  | { allowed: true; charge: CreditCharge | null }
  | { allowed: false; required: number; available: number };

export type CreditSummary = {
  plan: Plan;
  allowance: number;
  consumed: number;
  purchasedBalance: number;
  periodStart: Date;
  periodEnd: Date;
};

export function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function nextMonthUtc(periodStart: Date): Date {
  return new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1));
}

export type GrantOnceInput = {
  idempotencyKey: string;
  eventType: string;
  entryKind: CreditEntryKind;
  workspaceId: string;
  credits: number;
  reason: string;
};

// Concessão amarrada a um objeto do Stripe, dentro de uma transação dada. A marca
// de idempotência e o lançamento commitam juntos: marcar antes deixa crédito
// perdido se o insert falhar, marcar depois credita duas vezes numa entrega
// concorrente.
async function grantOnceIn(tx: CreditTx, input: GrantOnceInput): Promise<boolean> {
  if (input.credits <= 0) throw new Error('grant credits must be positive');

  const fresh = await tx.markStripeEvent(input.idempotencyKey, input.eventType);
  if (!fresh) return false;

  await tx.insertEntry({
    workspaceId: input.workspaceId,
    kind: input.entryKind,
    credits: input.credits,
    reason: input.reason,
  });
  return true;
}

export function createCreditService(deps: { repo: CreditRepository }) {
  const { repo } = deps;

  return {
    // Débito e verificação na mesma transação, com a linha do período travada:
    // é o que impede dois runs simultâneos de passarem com um crédito só.
    async authorizeAndCharge(input: {
      workspaceId: string;
      taskType: string;
      agentRunId: string;
      byok: boolean;
      now: Date;
    }): Promise<AuthorizeResult> {
      // Chave do cliente, conta do cliente: BYOK não consome crédito.
      if (input.byok) return { allowed: true, charge: null };

      const required = creditCost(input.taskType);
      const { plan, status } = await repo.workspaceBilling(input.workspaceId);
      const periodStart = startOfMonthUtc(input.now);

      return repo.transaction(async (tx) => {
        // Este run já foi cobrado. Acontece quando o BullMQ re-tenta um job que
        // falhou depois da cobrança: sem esta saída, a segunda tentativa bate na
        // unique de (agentRunId, kind), o job morre com P2002 e re-tenta de
        // novo — um laço que nunca converge e cujo erro não diz o que houve.
        //
        // A constraint continua sendo a última linha de defesa contra cobrança
        // dupla. O que muda é que a colisão passa a ser tratada em vez de
        // explodir: um run já pago está autorizado, e cobrar de novo seria o
        // bug de verdade.
        const charged = await tx.findEntryByRun(input.agentRunId, 'DEBIT');
        if (charged) return { allowed: true, charge: null };

        const period = await tx.lockPeriod(input.workspaceId, periodStart, effectiveAllowance(plan, status));
        const purchased = await tx.purchasedBalance(input.workspaceId);

        const allowanceLeft = Math.max(0, period.allowance - period.consumed);
        const available = allowanceLeft + purchased;
        if (available < required) return { allowed: false, required, available };

        const fromAllowance = Math.min(required, allowanceLeft);
        const fromPurchased = required - fromAllowance;

        if (fromAllowance > 0) await tx.addConsumed(period.id, fromAllowance);

        const entry = await tx.insertEntry({
          workspaceId: input.workspaceId,
          kind: 'DEBIT',
          credits: -required,
          fromAllowance,
          fromPurchased,
          agentRunId: input.agentRunId,
          reason: `agent run ${input.agentRunId} (${input.taskType})`,
        });

        return {
          allowed: true,
          charge: { credits: required, fromAllowance, fromPurchased, ledgerEntryId: entry.id },
        };
      });
    },

    // Falha nossa não é cobrança do cliente. Idempotente: o índice único
    // (agentRunId, kind) fecha a porta mesmo numa retentativa concorrente.
    async refund(input: { agentRunId: string; now: Date }): Promise<void> {
      const workspaceId = await repo.workspaceOfRun(input.agentRunId);

      await repo.transaction(async (tx) => {
        const debit = await tx.findEntryByRun(input.agentRunId, 'DEBIT');
        if (!debit) return;

        const already = await tx.findEntryByRun(input.agentRunId, 'REFUND');
        if (already) return;

        if (debit.fromAllowance > 0) {
          // A franquia volta para o mês que a cobrou, não para o mês corrente.
          const period = await tx.findPeriod(workspaceId, startOfMonthUtc(debit.createdAt));
          if (period) await tx.addConsumed(period.id, -debit.fromAllowance);
        }

        await tx.insertEntry({
          workspaceId,
          kind: 'REFUND',
          credits: -debit.credits,
          fromAllowance: debit.fromAllowance,
          fromPurchased: debit.fromPurchased,
          agentRunId: input.agentRunId,
          reason: `refund for failed agent run ${input.agentRunId}`,
        });
      });
    },

    async grant(input: { workspaceId: string; credits: number; reason: string }): Promise<void> {
      if (input.credits <= 0) throw new Error('grant credits must be positive');

      await repo.transaction((tx) =>
        tx.insertEntry({
          workspaceId: input.workspaceId,
          kind: 'GRANT',
          credits: input.credits,
          reason: input.reason,
        }),
      );
    },

    // Concessão amarrada a um objeto do Stripe: a chave é o id da Checkout
    // Session, não o id do evento, porque a mesma compra chega pelo webhook e
    // pelo /billing/sync com ids de evento diferentes.
    //
    // eventType e entryKind parecem redundantes, mas são duas identidades
    // diferentes: eventType é a chave de dedupe do Stripe (a coluna
    // StripeEvent.type), entryKind é o que o cliente vê no extrato do ledger.
    // Um pacote comprado e um upgrade de plano têm o mesmo formato de evento
    // (idempotencyKey + crédito), mas não podem virar a mesma linha no
    // extrato — daí os dois parâmetros em vez de um só reaproveitado.
    async grantOnce(input: GrantOnceInput): Promise<boolean> {
      return repo.transaction((tx) => grantOnceIn(tx, input));
    },

    // A mesma concessão, dentro de uma transação que o chamador já abriu. Existe
    // porque há um caso em que a decisão de conceder depende de uma leitura que
    // precisa estar travada junto com o lançamento: o complemento de franquia da
    // troca de plano lê "quanto este período já recebeu" e essa leitura só vale se
    // ninguém puder lançar entre ela e o insert. Abrir uma transação nova aqui
    // soltaria a trava do chamador antes do insert, que é exatamente o bug.
    //
    // Continua sendo este arquivo que escreve no ledger — nenhum chamador ganha
    // acesso ao insertEntry por causa disto.
    grantOnceIn,

    async summary(workspaceId: string, now: Date): Promise<CreditSummary> {
      const { plan, status } = await repo.workspaceBilling(workspaceId);
      const periodStart = startOfMonthUtc(now);
      const period = await repo.findPeriod(workspaceId, periodStart);
      const purchasedBalance = await repo.purchasedBalance(workspaceId);

      return {
        plan,
        // Workspace que nunca rodou nada não tem linha de período, e isso é
        // certo: ele tem a franquia inteira do plano à disposição.
        allowance: period?.allowance ?? effectiveAllowance(plan, status),
        consumed: period?.consumed ?? 0,
        purchasedBalance,
        periodStart,
        periodEnd: nextMonthUtc(periodStart),
      };
    },
  };
}

export type CreditService = ReturnType<typeof createCreditService>;
