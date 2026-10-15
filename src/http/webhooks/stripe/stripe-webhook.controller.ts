import type { FastifyPluginAsync } from 'fastify';
import { createBillingRepository } from '../../../billing/billing.repository.js';
import { createCreditRepository } from '../../../billing/credit.repository.js';
import { createCreditService } from '../../../billing/credit.service.js';
import { createStripeClient, WebhookSignatureError } from '../../../billing/stripe-client.js';
import { normalizeEvent } from '../../../billing/stripe-event.js';
import { createSubscriptionService } from '../../../billing/subscription.service.js';

// 1 MiB. O maior evento do Stripe fica muito abaixo disso; o limite existe para
// um corpo cru não virar memória à toa numa rota pública.
const MAX_BODY_BYTES = 1_048_576;

export const stripeWebhookRoute: FastifyPluginAsync = async (app) => {
  // O parser cru vale só neste escopo encapsulado: a verificação de assinatura
  // precisa do byte exato que o Stripe enviou, e o parser JSON global do
  // Fastify o destrói. Nenhuma outra rota muda de parser.
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: MAX_BODY_BYTES }, (_req, body, done) => {
    done(null, body);
  });

  const repo = createBillingRepository(app.prisma);
  const creditRepo = createCreditRepository(app.prisma);
  const subscriptions =
    app.subscriptionsOverride ??
    createSubscriptionService({
      repo,
      credits: createCreditService({ repo: creditRepo }),
      periods: creditRepo,
      log: (info) => app.log.info(info, 'stripe event'),
    });

  app.post('/webhooks/stripe', { schema: { hide: true } }, async (req, reply) => {
    const signature = req.headers['stripe-signature'];
    // Assinatura inválida responde 400 cru, sem passar pelo catálogo de erros:
    // quem lê é o Stripe, não uma pessoa.
    if (typeof signature !== 'string') return reply.code(400).send({ received: false });

    const stripe = (app.stripe ?? createStripeClient)();

    let payload;
    try {
      payload = stripe.constructEvent(req.body as Buffer, signature);
    } catch (err) {
      // Só o tipo dedicado vira 400: qualquer outro erro (JSON corrompido após
      // assinatura válida, bug do SDK) propaga para o handler de erro padrão,
      // que responde 500 e deixa o evento sem marca de processado — não
      // "simplificar" isto de volta a um catch largo.
      if (!(err instanceof WebhookSignatureError)) throw err;
      req.log.warn('stripe webhook signature rejected');
      return reply.code(400).send({ received: false });
    }

    if (await repo.alreadyProcessed(payload.id)) {
      req.log.info({ event: payload.id, type: payload.type, result: 'duplicate' }, 'stripe event');
      return reply.code(200).send({ received: true });
    }

    // Marca depois do despacho: erro no handler não pode deixar o evento como
    // processado, senão o retry do Stripe não acha trabalho por fazer. O efeito
    // que dói — o crédito — é idempotente por conta própria, pelo id da sessão.
    const result = await subscriptions.apply(normalizeEvent(payload), new Date());

    // Evento que não deu para resolver não recebe marca: 500 devolve o problema
    // para a janela de retry do Stripe, que é a recuperação automática desenhada
    // para isto. Marcar como processado descartaria essa janela para sempre.
    if (result === 'unresolved') {
      req.log.info({ event: payload.id, type: payload.type, result }, 'stripe event');
      return reply.code(500).send({ received: false });
    }

    await repo.markProcessed(payload.id, payload.type);

    req.log.info({ event: payload.id, type: payload.type, result }, 'stripe event');
    return reply.code(200).send({ received: true });
  });
};
