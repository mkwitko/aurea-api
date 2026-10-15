import type { Plan, Prisma, PrismaClient, SubscriptionStatus } from '@prisma/client';

export type OrgBilling = {
  id: string;
  name: string;
  plan: Plan;
  subscriptionStatus: SubscriptionStatus;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEnd: Date | null;
  lastSyncedAt: Date | null;
};

const SELECT = {
  id: true,
  name: true,
  plan: true,
  subscriptionStatus: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  currentPeriodEnd: true,
  lastSyncedAt: true,
} as const;

// PrismaClient e Prisma.TransactionClient têm a mesma interface de delegates
// (organization.*, workspace.*, $queryRaw): as leituras abaixo aceitam os dois,
// para servir tanto a leitura solta quanto a leitura dentro de um $transaction.
// Quem exige transação é o workspaceLimitRepo, e o tipo dele diz isso.
type Client = PrismaClient | Prisma.TransactionClient;
type TxClient = Prisma.TransactionClient;

function organizationByIdOn(client: Client, id: string): Promise<OrgBilling | null> {
  return client.organization.findUnique({ where: { id }, select: SELECT });
}

function countActiveWorkspacesOn(client: Client, organizationId: string): Promise<number> {
  return client.workspace.count({ where: { organizationId, deletedAt: null, status: 'ACTIVE' } });
}

// Trava a linha da organização antes de qualquer contagem: sem isso, dois
// POST /workspaces concorrentes no mesmo org leem o mesmo `current` antes de
// qualquer um committar seu insert, e os dois passam do teto. FOR UPDATE
// serializa por organização — o segundo espera o primeiro liberar a linha e
// reconta já com o workspace dele contado.
async function lockOrganizationOn(client: Client, organizationId: string): Promise<void> {
  await client.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE`;
}

// Repo estreito para o teto de workspaces, e só dentro de transação: o parâmetro
// é Prisma.TransactionClient de propósito. Com um PrismaClient solto, o
// `SELECT ... FOR UPDATE` do lockOrganization pega e solta o lock no mesmo
// statement — o lock não faz nada e a corrida do teto volta, em silêncio. O único
// chamador de hoje está correto; o tipo é o que impede o próximo de não estar.
// Quem é dono da transação continua sendo o chamador: este repo só sabe responder
// "esta organização pode criar mais um workspace?".
export function workspaceLimitRepo(client: TxClient) {
  return {
    lockOrganization: (organizationId: string) => lockOrganizationOn(client, organizationId),
    organizationById: (id: string) => organizationByIdOn(client, id),
    countActiveWorkspaces: (organizationId: string) => countActiveWorkspacesOn(client, organizationId),
  };
}

export function createBillingRepository(prisma: PrismaClient) {
  return {
    organizationById(id: string): Promise<OrgBilling | null> {
      return organizationByIdOn(prisma, id);
    },

    organizationByCustomerId(customerId: string): Promise<OrgBilling | null> {
      return prisma.organization.findUnique({ where: { stripeCustomerId: customerId }, select: SELECT });
    },

    // Reivindicação, não sobrescrita: grava só sobre stripeCustomerId nulo e
    // devolve o id que REALMENTE ficou na organização. Dois checkouts
    // concorrentes numa org que nunca chegou ao Stripe criavam dois Customers
    // (a Search API do Stripe é eventualmente consistente) e o segundo update
    // vencia; o Customer do primeiro ficava órfão, e um pagamento nele chegava
    // como evento de um customer que o banco não conhece. Quem perde a corrida
    // aqui recebe o vencedor de volta e segue o checkout nele.
    async claimCustomerId(organizationId: string, customerId: string): Promise<string> {
      const claimed = await prisma.organization.updateMany({
        where: { id: organizationId, stripeCustomerId: null },
        data: { stripeCustomerId: customerId },
      });
      if (claimed.count === 1) return customerId;

      const stored = await prisma.organization.findUnique({
        where: { id: organizationId },
        select: { stripeCustomerId: true },
      });
      return stored?.stripeCustomerId ?? customerId;
    },

    async saveSubscription(
      organizationId: string,
      input: { plan: Plan; status: SubscriptionStatus; subscriptionId: string; currentPeriodEnd: Date },
    ): Promise<void> {
      await prisma.organization.update({
        where: { id: organizationId },
        data: {
          plan: input.plan,
          subscriptionStatus: input.status,
          stripeSubscriptionId: input.subscriptionId,
          currentPeriodEnd: input.currentPeriodEnd,
        },
      });
    },

    // Cancelar não mexe no plano gravado: ele explica o que o cliente teve, e a
    // franquia já é zero por causa do status.
    async cancelSubscription(organizationId: string): Promise<void> {
      await prisma.organization.update({
        where: { id: organizationId },
        data: { subscriptionStatus: 'CANCELED' },
      });
    },

    async touchSync(organizationId: string, now: Date): Promise<void> {
      await prisma.organization.update({ where: { id: organizationId }, data: { lastSyncedAt: now } });
    },

    async workspaceBelongsTo(workspaceId: string, organizationId: string): Promise<boolean> {
      const count = await prisma.workspace.count({ where: { id: workspaceId, organizationId } });
      return count > 0;
    },

    countActiveWorkspaces(organizationId: string): Promise<number> {
      return countActiveWorkspacesOn(prisma, organizationId);
    },

    async alreadyProcessed(eventId: string): Promise<boolean> {
      const found = await prisma.stripeEvent.findUnique({ where: { id: eventId }, select: { id: true } });
      return found !== null;
    },

    async markProcessed(eventId: string, type: string): Promise<void> {
      await prisma.$executeRaw`
        INSERT INTO "StripeEvent" ("id", "type", "processedAt")
        VALUES (${eventId}, ${type}, now())
        ON CONFLICT ("id") DO NOTHING
      `;
    },
  };
}

export type BillingRepository = ReturnType<typeof createBillingRepository>;
