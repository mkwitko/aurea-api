import type { BillingRepository, OrgBilling } from './billing.repository.js';
import type { CreditRepository } from './credit.repository.js';
import { nextMonthUtc, startOfMonthUtc, type CreditService } from './credit.service.js';
import { packCredits } from './credit-packs.js';
import { effectiveAllowance } from './plan-catalog.js';
import type { BillingEvent } from './stripe-event.js';

// Prefixo do motivo dos lançamentos de troca de plano. É por ele que a conta do
// delta descobre o que o período já recebeu, então escrever e ler usam esta
// mesma constante — mudar o texto muda os dois lados de uma vez.
export const PLAN_CHANGE_REASON = 'plan change';

// Três destinos, não dois. 'ignored' é "este evento não é nosso" (price
// desconhecido, tipo não tratado, checkout de assinatura) e pode ser marcado como
// processado. 'unresolved' é "não consegui resolver a organização AINDA" — a
// corrida da reivindicação do Customer, metadata que não bate — e aí a janela de
// retry do Stripe é a única recuperação automática que existe. Colapsar os dois
// em 'ignored' joga essa janela fora, em silêncio, num evento que trouxe dinheiro.
export type ApplyResult = 'applied' | 'ignored' | 'unresolved';

export type SubscriptionServiceDeps = {
  repo: BillingRepository;
  credits: Pick<CreditService, 'grantOnce' | 'grantOnceIn'>;
  // O período corrente do B2a: a diferença de upgrade é um complemento do
  // allowance CONGELADO daquele mês, não de níveis de plano em abstrato. Entra
  // como `transaction` e não como leituras soltas porque a leitura do que o
  // período já recebeu só vale travada junto com o lançamento.
  periods: Pick<CreditRepository, 'transaction'>;
  log?: (info: { event: string; result: string }) => void;
};

export function createSubscriptionService(deps: SubscriptionServiceDeps) {
  const { repo, credits, periods } = deps;
  const log = deps.log ?? (() => {});

  // Metadata é entrada não confiável (spec §10), e a verificação vive num lugar
  // só porque os dois caminhos que creditam precisam dela: a compra de pacote e a
  // diferença de troca de plano. Ter uma cópia em cada um foi o que deixou o
  // caminho da assinatura sem checagem nenhuma.
  //
  // São duas perguntas, e nenhuma das duas é dispensável. A organização do
  // metadata é a dona do Customer que PAGOU? Conferir só que ela tem algum
  // stripeCustomerId aceita um Payment Link ou um comp do dashboard com metadata
  // digitado à mão creditando outra empresa. E o workspace é dela? Sem isso o
  // crédito vai para um workspace de terceiro — ou para um id que não resolve
  // mais, e aí o FK estoura dentro do grantOnce.
  //
  // Devolve o motivo da recusa, ou null quando passa.
  async function untrustedMetadata(
    organization: OrgBilling | null,
    input: { customerId: string; workspaceId: string },
  ): Promise<string | null> {
    if (!organization?.stripeCustomerId) return 'organization without customer';
    if (organization.stripeCustomerId !== input.customerId) return 'customer does not belong to the organization';
    if (!(await repo.workspaceBelongsTo(input.workspaceId, organization.id))) return 'workspace outside the organization';
    return null;
  }

  async function applyPurchase(event: Extract<BillingEvent, { kind: 'credit-purchase' }>): Promise<ApplyResult> {
    const organization = await repo.organizationById(event.organizationId);

    const untrusted = await untrustedMetadata(organization, event);
    if (untrusted || !organization) {
      log({ event: event.sourceId, result: untrusted ?? 'unknown organization' });
      return 'unresolved';
    }

    const granted = await credits.grantOnce({
      idempotencyKey: event.sourceId,
      eventType: 'credit-pack',
      entryKind: 'PURCHASE',
      workspaceId: event.workspaceId,
      credits: packCredits(event.packId),
      reason: `credit pack ${event.packId}`,
    });

    log({ event: event.sourceId, result: granted ? 'granted' : 'already granted' });
    return granted ? 'applied' : 'ignored';
  }

  // Spec §7.4: a diferença é lançada "com o período corrente já aberto". A
  // conta é sempre sobre o que o PERÍODO já recebeu, nunca sobre a distância
  // entre dois níveis de plano:
  //
  //   delta = franquia do plano novo − allowance congelado − já concedido no mês
  //
  // Duas coisas caem por terra com isso. A primeira: sem linha de período, o
  // mês ainda não foi aberto, e quem o abre é o lockPeriod do B2a — já no
  // allowance novo. Um GRANT aqui seria uma segunda franquia, permanente
  // (purchasedBalance soma PURCHASE e GRANT sem filtro de período), em cima da
  // franquia que o lockPeriod vai criar. Por isso: sem período, sem grant.
  // A segunda: descontar o que o mês já recebeu torna impossível empilhar. Dois
  // pares de planos crescentes no mesmo período somam no máximo a franquia do
  // plano de cima, e um downgrade seguido de re-upgrade não gera nada.
  //
  // A chave leva assinatura, fim do período e plano ALVO. Não leva o plano
  // gravado: numa reentrega concorrente da mesma troca, as duas cópias têm que
  // colidir na mesma chave antes de qualquer uma commitar seu lançamento. E
  // leva o plano alvo porque um segundo upgrade legítimo no mesmo mês
  // (STARTER→GROWTH e depois GROWTH→SCALE) precisa poder lançar o complemento
  // dele — a conta acima já garante que o total não passe do teto.
  async function grantPlanChange(
    event: Extract<BillingEvent, { kind: 'subscription-state' }>,
    organization: OrgBilling,
    now: Date,
  ): Promise<void> {
    if (!event.workspaceId) return;

    // Recusa aqui não cancela o evento: o estado da assinatura é gravado de
    // qualquer jeito. Assinatura travada — o grant estourando FK antes do save,
    // com o Stripe reentregando o mesmo evento por três dias — é pior que um
    // grant perdido, e o perdido aparece no log.
    const untrusted = await untrustedMetadata(organization, {
      customerId: event.customerId,
      workspaceId: event.workspaceId,
    });
    if (untrusted) {
      log({ event: event.subscriptionId, result: `grant skipped: ${untrusted}` });
      return;
    }

    const workspaceId = event.workspaceId;
    const periodStart = startOfMonthUtc(now);

    // Travar, ler e lançar na MESMA transação. A chave de idempotência separa
    // duas entregas do mesmo alvo, mas não separa alvos diferentes: um
    // STARTER→GROWTH e um GROWTH→SCALE concorrentes têm chaves distintas (o
    // Stripe mantém a âncora de cobrança na troca no meio do ciclo, então só o
    // plano difere), e nada os impedia de ler "nada concedido ainda" ao mesmo
    // tempo e lançarem o complemento inteiro cada um — 4600 contra um teto de
    // 3800. A trava na linha do período é o que os põe em fila.
    //
    // A leitura tem que estar DENTRO da transação que lança: soltar a trava antes
    // do insert é o mesmo bug com outra roupa.
    await periods.transaction(async (tx) => {
      const period = await tx.lockOpenPeriod(workspaceId, periodStart);
      if (!period) return;

      const alreadyGranted = await tx.grantedInPeriodByReason(
        workspaceId,
        periodStart,
        nextMonthUtc(periodStart),
        PLAN_CHANGE_REASON,
      );

      // O allowance congelado do B2a não é reescrito: a diferença entra como
      // GRANT, e o extrato explica de onde vieram os créditos. Downgrade não tira
      // nada — vale a partir da próxima virada, e aqui dá delta negativo, logo 0.
      const delta = Math.max(0, effectiveAllowance(event.plan, event.status) - period.allowance - alreadyGranted);
      if (delta === 0) return;

      await credits.grantOnceIn(tx, {
        idempotencyKey: `${event.subscriptionId}:${event.currentPeriodEnd.toISOString()}:${event.plan}`,
        eventType: 'plan-upgrade',
        entryKind: 'GRANT',
        workspaceId,
        credits: delta,
        reason: `${PLAN_CHANGE_REASON} ${organization.plan}→${event.plan}`,
      });
    });
  }

  async function applyState(
    event: Extract<BillingEvent, { kind: 'subscription-state' }>,
    now: Date,
  ): Promise<ApplyResult> {
    const organization = await repo.organizationByCustomerId(event.customerId);
    if (!organization) {
      log({ event: event.subscriptionId, result: 'unknown customer' });
      return 'unresolved';
    }

    // O Stripe não garante ordem e reentrega por até três dias. Um `updated` de
    // OUTRA assinatura, cujo período já terminou antes do que está gravado, é
    // notícia velha: aplicá-lo empurra o plano de um cliente pagante para trás.
    // Assinatura diferente com período terminando DEPOIS é a assinatura nova —
    // essa aplica.
    const otherSubscription =
      organization.stripeSubscriptionId !== null && organization.stripeSubscriptionId !== event.subscriptionId;
    if (otherSubscription && organization.currentPeriodEnd && event.currentPeriodEnd < organization.currentPeriodEnd) {
      log({ event: event.subscriptionId, result: 'stale event for a superseded subscription' });
      return 'ignored';
    }

    // O grant acontece ANTES do saveSubscription, e de propósito: se o processo
    // morrer entre os dois (queda de conexão, timeout), o plano gravado continua
    // o antigo, e o retry do Stripe recalcula a conta contra o extrato — que já
    // tem o lançamento da primeira passada e devolve delta 0. Se a ordem fosse
    // invertida, uma falha depois do save deixaria o crédito da troca sem
    // ninguém para lançá-lo. Não inverter essa ordem.
    await grantPlanChange(event, organization, now);

    await repo.saveSubscription(organization.id, {
      plan: event.plan,
      status: event.status,
      subscriptionId: event.subscriptionId,
      currentPeriodEnd: event.currentPeriodEnd,
    });

    log({ event: event.subscriptionId, result: `plan ${event.plan} ${event.status}` });
    return 'applied';
  }

  return {
    async apply(event: BillingEvent, now: Date): Promise<ApplyResult> {
      if (event.kind === 'credit-purchase') return applyPurchase(event);
      if (event.kind === 'subscription-state') return applyState(event, now);

      if (event.kind === 'subscription-canceled') {
        const organization = await repo.organizationByCustomerId(event.customerId);
        if (!organization) {
          log({ event: event.customerId, result: 'unknown customer' });
          return 'unresolved';
        }
        // Cancela sub_1, reassina em sub_2, e o `deleted` atrasado de sub_1
        // chega depois: cancelar sem olhar qual assinatura morreu zera a
        // franquia de um cliente pagante até alguém lembrar de chamar o sync.
        //
        // Id gravado nulo é "ainda não sei qual é", não "é outra": o Stripe não
        // garante ordem, e um `deleted` que chega antes do primeiro
        // `created`/`updated` seria descartado para sempre — 'ignored' recebe
        // marca de processado e não há retry. Mesma leitura da guarda de ordem
        // do applyState.
        if (organization.stripeSubscriptionId !== null && organization.stripeSubscriptionId !== event.subscriptionId) {
          log({ event: event.subscriptionId, result: 'cancellation for a subscription that is not the current one' });
          return 'ignored';
        }
        await repo.cancelSubscription(organization.id);
        log({ event: event.customerId, result: 'canceled' });
        return 'applied';
      }

      log({ event: 'ignored', result: event.reason });
      return 'ignored';
    },
  };
}

export type SubscriptionService = ReturnType<typeof createSubscriptionService>;
