import type { CreditEntryKind, Plan, Prisma, PrismaClient, SubscriptionStatus } from '@prisma/client';

export type PeriodRow = { id: string; periodStart: Date; allowance: number; consumed: number };

export type WorkspaceBilling = { plan: Plan; status: SubscriptionStatus };

export type LedgerEntryInput = {
  workspaceId: string;
  kind: CreditEntryKind;
  credits: number;
  fromAllowance?: number;
  fromPurchased?: number;
  agentRunId?: string;
  reason: string;
};

export type LedgerRow = {
  id: string;
  kind: CreditEntryKind;
  credits: number;
  agentRunId: string | null;
  reason: string;
  createdAt: Date;
};

type TxClient = Prisma.TransactionClient;

// O saldo comprado nunca soma linhas em memória: uma agregação em SQL sobre o
// ledger é a única fonte, e ela distingue os dois baldes pelas colunas
// fromAllowance/fromPurchased em vez de reinterpretar o sinal de `credits`.
async function purchasedBalanceOn(client: TxClient | PrismaClient, workspaceId: string): Promise<number> {
  const rows = await client.$queryRaw<{ balance: number }[]>`
    SELECT COALESCE(SUM(
      CASE
        WHEN kind IN ('PURCHASE', 'GRANT') THEN credits
        WHEN kind = 'DEBIT'  THEN -"fromPurchased"
        WHEN kind = 'REFUND' THEN  "fromPurchased"
        ELSE 0
      END
    ), 0)::int AS balance
    FROM "CreditLedger"
    WHERE "workspaceId" = ${workspaceId}
  `;
  return rows[0]?.balance ?? 0;
}

// Quanto de GRANT com um dado motivo o workspace já recebeu dentro de uma
// janela de tempo. Agregação em SQL pela mesma razão de purchasedBalanceOn: o
// total é conta do banco, não de linhas somadas em memória.
//
// O prefixo do motivo entra por parâmetro em vez de ficar escrito aqui: quem
// grava o lançamento e quem o lê usam a MESMA constante exportada, então
// reescrever o texto do motivo depois não desalinha os dois lados.
async function grantedInPeriodByReasonOn(
  client: TxClient | PrismaClient,
  workspaceId: string,
  from: Date,
  to: Date,
  reasonPrefix: string,
): Promise<number> {
  const rows = await client.$queryRaw<{ total: number }[]>`
    SELECT COALESCE(SUM("credits"), 0)::int AS total
    FROM "CreditLedger"
    WHERE "workspaceId" = ${workspaceId}
      AND "kind" = 'GRANT'
      AND "createdAt" >= ${from}
      AND "createdAt" < ${to}
      AND "reason" LIKE ${`${reasonPrefix}%`}
  `;
  return rows[0]?.total ?? 0;
}

function txApi(tx: TxClient) {
  return {
    // Cria-se-não-existe e trava. O INSERT ... ON CONFLICT DO NOTHING evita a
    // corrida entre dois runs que abrem o mês ao mesmo tempo; o FOR UPDATE
    // serializa o débito por workspace.
    async lockPeriod(workspaceId: string, periodStart: Date, allowance: number): Promise<PeriodRow> {
      await tx.$executeRaw`
        INSERT INTO "CreditPeriod" ("id", "workspaceId", "periodStart", "allowance", "consumed", "createdAt", "updatedAt")
        VALUES (gen_random_uuid(), ${workspaceId}, ${periodStart}, ${allowance}, 0, now(), now())
        ON CONFLICT ("workspaceId", "periodStart") DO NOTHING
      `;

      const rows = await tx.$queryRaw<PeriodRow[]>`
        SELECT "id", "periodStart", "allowance", "consumed"
        FROM "CreditPeriod"
        WHERE "workspaceId" = ${workspaceId} AND "periodStart" = ${periodStart}
        FOR UPDATE
      `;

      const period = rows[0];
      if (!period) throw new Error('credit period vanished inside the transaction');
      return period;
    },

    // Irmão do lockPeriod acima, com uma diferença que é regra do B2b: trava se
    // existir, e NÃO cria. Quem abre o período é o authorizeAndCharge, no
    // primeiro run do mês, já no allowance vigente; criá-lo aqui, do lado do
    // evento de troca de plano, entregaria a franquia nova duas vezes — a
    // franquia dupla que o C1 fechou. Mês não aberto devolve null, e o chamador
    // trata isso como "nada a complementar".
    //
    // O FOR UPDATE é o que serializa duas entregas concorrentes com planos alvo
    // DIFERENTES: as chaves de idempotência delas diferem, então nada mais as
    // separa, e sem a trava as duas leem "nada concedido ainda" e lançam o
    // complemento inteiro cada uma.
    async lockOpenPeriod(workspaceId: string, periodStart: Date): Promise<PeriodRow | null> {
      const rows = await tx.$queryRaw<PeriodRow[]>`
        SELECT "id", "periodStart", "allowance", "consumed"
        FROM "CreditPeriod"
        WHERE "workspaceId" = ${workspaceId} AND "periodStart" = ${periodStart}
        FOR UPDATE
      `;
      return rows[0] ?? null;
    },

    purchasedBalance(workspaceId: string): Promise<number> {
      return purchasedBalanceOn(tx, workspaceId);
    },

    grantedInPeriodByReason(workspaceId: string, from: Date, to: Date, reasonPrefix: string): Promise<number> {
      return grantedInPeriodByReasonOn(tx, workspaceId, from, to, reasonPrefix);
    },

    async addConsumed(periodId: string, delta: number): Promise<void> {
      await tx.creditPeriod.update({
        where: { id: periodId },
        data: { consumed: { increment: delta } },
      });
    },

    insertEntry(entry: LedgerEntryInput): Promise<{ id: string }> {
      return tx.creditLedger.create({
        data: {
          workspaceId: entry.workspaceId,
          kind: entry.kind,
          credits: entry.credits,
          fromAllowance: entry.fromAllowance ?? 0,
          fromPurchased: entry.fromPurchased ?? 0,
          agentRunId: entry.agentRunId ?? null,
          reason: entry.reason,
        },
        select: { id: true },
      });
    },

    findEntryByRun(agentRunId: string, kind: CreditEntryKind) {
      return tx.creditLedger.findFirst({
        where: { agentRunId, kind },
        select: { id: true, credits: true, fromAllowance: true, fromPurchased: true, createdAt: true },
      });
    },

    findPeriod(workspaceId: string, periodStart: Date) {
      return tx.creditPeriod.findUnique({
        where: { workspaceId_periodStart: { workspaceId, periodStart } },
        select: { id: true, periodStart: true, allowance: true, consumed: true },
      });
    },

    // A marca de idempotência e o lançamento têm que commitar juntos: marcar
    // antes deixa crédito perdido se o insert falhar, marcar depois credita
    // duas vezes numa entrega concorrente. Por isso o StripeEvent aparece aqui,
    // dentro da transação do ledger, e não só no repositório de billing.
    async markStripeEvent(id: string, type: string): Promise<boolean> {
      const inserted = await tx.$executeRaw`
        INSERT INTO "StripeEvent" ("id", "type", "processedAt")
        VALUES (${id}, ${type}, now())
        ON CONFLICT ("id") DO NOTHING
      `;
      return inserted === 1;
    },
  };
}

export type CreditTx = ReturnType<typeof txApi>;

export function createCreditRepository(prisma: PrismaClient) {
  return {
    transaction<T>(fn: (tx: CreditTx) => Promise<T>): Promise<T> {
      return prisma.$transaction((tx) => fn(txApi(tx)));
    },

    // O plano vive na organização desde o B2b: quem assina é quem tem cartão e
    // CNPJ, e o workspace herda.
    async workspaceBilling(workspaceId: string): Promise<WorkspaceBilling> {
      const workspace = await prisma.workspace.findUniqueOrThrow({
        where: { id: workspaceId },
        select: { organization: { select: { plan: true, subscriptionStatus: true } } },
      });
      return { plan: workspace.organization.plan, status: workspace.organization.subscriptionStatus };
    },

    // O estorno chega com o id do run e nada mais; é aqui que ele descobre em
    // que workspace lançar.
    async workspaceOfRun(agentRunId: string): Promise<string> {
      const run = await prisma.agentRun.findUniqueOrThrow({
        where: { id: agentRunId },
        select: { workspaceId: true },
      });
      return run.workspaceId;
    },

    purchasedBalance(workspaceId: string): Promise<number> {
      return purchasedBalanceOn(prisma, workspaceId);
    },

    findPeriod(workspaceId: string, periodStart: Date) {
      return prisma.creditPeriod.findUnique({
        where: { workspaceId_periodStart: { workspaceId, periodStart } },
        select: { id: true, periodStart: true, allowance: true, consumed: true },
      });
    },

    grantedInPeriodByReason(workspaceId: string, from: Date, to: Date, reasonPrefix: string): Promise<number> {
      return grantedInPeriodByReasonOn(prisma, workspaceId, from, to, reasonPrefix);
    },

    listLedger(workspaceId: string, limit: number, before?: Date): Promise<LedgerRow[]> {
      return prisma.creditLedger.findMany({
        where: { workspaceId, ...(before ? { createdAt: { lt: before } } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        select: { id: true, kind: true, credits: true, agentRunId: true, reason: true, createdAt: true },
      });
    },
  };
}

export type CreditRepository = ReturnType<typeof createCreditRepository>;
