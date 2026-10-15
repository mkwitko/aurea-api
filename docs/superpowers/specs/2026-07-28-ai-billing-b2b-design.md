# Sub-projeto B2b — Stripe: assinatura, cupom e compra de crédito

**Data:** 2026-07-28
**Status:** aprovado no brainstorm, pronto para plano
**Depende de:** B2a (`2026-07-27-ai-billing-b2a-design.md`), mergeado em `master` (`c82ab28`)

---

## 1. Contexto

O B2a fez a camada de IA cobrar antes de gastar: franquia mensal por workspace, ledger
append-only com débito atômico e estorno, BYOK cifrada. Falta a metade comercial —
**nenhum dinheiro entra**. A franquia vem de um catálogo em código, a recarga só existe em
CLI, e um workspace novo nasce com 200 créditos de graça porque não havia como cobrar.

O B2b liga o Stripe: assinatura que define o plano, pacote de crédito avulso, e cupom de
desconto. O ponto de contato com o B2a é uma função que já existe — `grant`.

---

## 2. O que o B2b é e o que não é

**É** o caminho pelo qual dinheiro vira plano e vira crédito, e pelo qual a falta de
dinheiro tira os dois.

**Não é** faturamento completo. Não emite nota, não calcula imposto, não cobra por
assento, não faz reembolso, não manda e-mail de cobrança.

Não-objetivos explícitos: multi-moeda, faturamento por assento, NF-e/imposto, reembolso de
assinatura, dunning por e-mail próprio (o Stripe já manda), painel administrativo,
relatório financeiro.

---

## 3. Decisões (não re-litigar)

Do brainstorm de 2026-07-28:

- **A Organization assina; o workspace herda.** Um Stripe Customer por organização — é
  quem tem cartão e CNPJ. `Workspace.plan` sai do schema e `plan` passa a viver na
  `Organization`.
- **Webhook é a fonte primária, pull é rede de segurança.** O usuário abriu mão da
  objeção ao webhook em favor de confiabilidade. `POST /billing/sync` existe para o caso
  de evento perdido ou servidor fora do ar, e usa exatamente os mesmos handlers.
- **Trial é `GRANT`, não franquia.** Org sem assinatura tem franquia zero e recebe, uma
  única vez no registro, um lançamento de 50 créditos. Franquia de trial renovaria todo
  mês para sempre.
- **`past_due` mantém a franquia; `canceled` zera.** O Stripe recobra por ~2 semanas.
  Cartão vencido não é má-fé, e cortar no primeiro erro perde cliente bom. Crédito
  comprado continua gastável em qualquer estado: foi pago.
- **Upgrade no meio do mês lança a diferença como `GRANT`.** O `allowance` congelado do
  B2a não é reescrito. Downgrade não tira nada; vale a partir da próxima virada.
- **Cupom é `promotion_code` do Stripe, só desconto.** Nenhuma tabela nossa, nenhuma regra
  de validade, limite ou acumulação para reimplementar.
- **Franquia é por workspace, e o plano limita quantos workspaces existem.** Uma org
  GROWTH com 3 workspaces tem 3.000 créditos/mês. Sem teto de workspaces, um STARTER cria
  vinte e leva 4.000 créditos por R$297.

---

## 4. Arquitetura

### 4.1 Fluxo do dinheiro

```text
                    ┌──────────────── Stripe ────────────────┐
                    │                                        │
  POST /billing/checkout/*  ──►  Checkout Session            │
                    │                    │                   │
                    │              cliente paga              │
                    │                    │                   │
                    │            evento assinado             │
                    ▼                    ▼                   │
              redirect de retorno   POST /webhooks/stripe     │
                    │                    │                   │
          POST /billing/sync        verifica assinatura       │
          (rede de segurança)            │                   │
                    │              StripeEvent (PK)           │
                    │                    │ novo?             │
                    └──────────┬─────────┘                   │
                               ▼                             │
                        handlers de evento                   │
                               │                             │
              ┌────────────────┼────────────────┐            │
              ▼                ▼                ▼            │
     Organization.plan   GRANT no ledger   subscriptionStatus │
              │                │                │            │
              └────────────────┴────────────────┘            │
                               │                             │
                        B2a: authorizeRun                    │
```

Os dois caminhos — webhook e sync — chamam os **mesmos** handlers. O sync não é uma
segunda implementação da regra; é outro jeito de entregar o mesmo evento.

### 4.2 Layout

```text
src/billing/
  stripe-client.ts       interface fina sobre a SDK (testável sem rede)
  plan-catalog.ts        (existe) ganha maxWorkspaces e o mapa priceId → Plan
  credit-packs.ts        priceId → créditos
  subscription.service.ts    aplica um evento ao estado da org
  billing.repository.ts      leitura/escrita de Organization e StripeEvent
  checkout.service.ts        monta as sessões de checkout e o portal

src/http/api/billing/      checkout, portal, status, sync
src/http/webhooks/stripe/  rota crua, verificada por assinatura
```

`src/billing/` continua sem conhecer Fastify. O `stripe-client.ts` é a única coisa que
importa a SDK.

### 4.3 Contrato do cliente Stripe

```ts
export type StripeClient = {
  ensureCustomer(input: { organizationId: string; email: string; name: string }): Promise<string>;
  createSubscriptionCheckout(input: {
    customerId: string; priceId: string; organizationId: string; workspaceId: string;
    successUrl: string; cancelUrl: string;
  }): Promise<{ url: string }>;
  createPackCheckout(input: {
    customerId: string; priceId: string; organizationId: string; workspaceId: string; packId: string;
    successUrl: string; cancelUrl: string;
  }): Promise<{ url: string }>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  constructEvent(rawBody: Buffer, signature: string): StripeEventPayload;
  fetchSubscription(customerId: string): Promise<SubscriptionSnapshot | null>;
  listRecentPaidSessions(customerId: string): Promise<PaidSession[]>;
};
```

Tudo que o resto do sistema sabe sobre Stripe passa por aqui. Os testes injetam um fake e
nenhum toca a rede.

---

## 5. Modelo de dados

Uma migration.

### 5.1 Plano muda de casa

```prisma
enum SubscriptionStatus {
  TRIAL
  ACTIVE
  PAST_DUE
  CANCELED
}

model Organization {
  // ...
  plan                 Plan               @default(STARTER)
  subscriptionStatus   SubscriptionStatus @default(TRIAL)
  stripeCustomerId     String?            @unique
  stripeSubscriptionId String?
  currentPeriodEnd     DateTime?
  lastSyncedAt         DateTime?
}
```

`Workspace.plan` é removido. No B2a, só `credit.repository.workspacePlan()` muda: passa a
ler pelo relacionamento `workspace → organization`. `credit.service` não é tocado.

A migration copia o plano de cada workspace para a organização antes de dropar a coluna
(hoje todos são `STARTER`, mas a migration não pode assumir isso e sumir com dado).

### 5.2 Idempotência do webhook

```prisma
model StripeEvent {
  id          String   @id          // o event.id do Stripe
  type        String
  processedAt DateTime @default(now())
}
```

Tabela de uma coluna útil. O Stripe reentrega em retry e pode entregar duplicado; sem
isso, um `checkout.session.completed` reprocessado credita duas vezes.

---

## 6. Franquia efetiva

O catálogo de planos ganha duas coisas:

```ts
export type PlanEntry = { monthlyCredits: number; maxWorkspaces: number };

// ACTIVE e PAST_DUE recebem a franquia do plano; TRIAL e CANCELED recebem zero.
// PAST_DUE é a janela de graça enquanto o Stripe recobra.
export function effectiveAllowance(plan: Plan, status: SubscriptionStatus): number;
export function maxWorkspaces(plan: Plan): number;
export function planForPrice(priceId: string): Plan | null;
```

`credit.service.authorizeAndCharge` passa a chamar `effectiveAllowance` em vez de
`monthlyAllowance`, e o repositório devolve plano **e** status juntos. Uma linha de mudança
no serviço do B2a.

Crédito comprado não é afetado por status: quem pagou por um pacote gasta o pacote mesmo
com a assinatura cancelada.

---

## 7. Execução

### 7.1 Trial

No registro, junto da criação de Organization e Workspace, um `GRANT` de 50 créditos com
reason `"trial credits"`. Uma vez, no ledger, visível no extrato.

Nada de campo `trialUsed`: o lançamento no ledger **é** o registro de que foi concedido, e
a concessão acontece num ponto único do código.

### 7.2 Checkout

`POST /billing/checkout/subscription` resolve (ou cria) o Customer da org pelo e-mail de
quem chamou, monta a Checkout Session com `allow_promotion_codes: true`, carrega
`organizationId` e `workspaceId` no metadata, e devolve a URL. O front redireciona.

`POST /billing/checkout/credits` faz o mesmo em `mode: 'payment'`, com `packId` no
metadata.

O metadata é o que amarra o pagamento ao workspace: sem ele, o webhook recebe um pagamento
e não sabe onde creditar.

### 7.3 Webhook

Rota fora da autenticação, com parser de corpo cru registrado **só nela** — a verificação
de assinatura precisa do byte exato, e o parser JSON global do Fastify o destrói.

```text
verifica assinatura ─── inválida ──► 400, nada é processado
        │ válida
        ▼
INSERT StripeEvent ─── colisão de PK ──► 200 (já processado)
        │ novo
        ▼
    despacha ─── erro ──► não marca como processado, 500, Stripe reentrega
        │ ok
        ▼
      200
```

Eventos tratados:

| Evento | Efeito |
|---|---|
| `checkout.session.completed` com `mode=payment` | `grant` dos créditos do pacote no workspace do metadata |
| `customer.subscription.created` / `updated` | grava plano, status, `currentPeriodEnd`; se o plano subiu no período corrente, `grant` da diferença |
| `customer.subscription.deleted` | `CANCELED`; franquia zera na próxima autorização |

Nada de `invoice.*`: `customer.subscription.updated` já traz `past_due`. Um caminho, uma
verdade.

### 7.4 Upgrade no meio do mês

Ao ver plano novo maior que o gravado, com o período corrente já aberto:

```text
delta = effectiveAllowance(novo) − effectiveAllowance(antigo)
grant(workspaceId, delta, "plan upgrade STARTER→GROWTH")
```

O `allowance` congelado do `CreditPeriod` não é reescrito, e o extrato explica de onde
vieram os créditos. Downgrade não gera lançamento nenhum.

### 7.5 Teto de workspaces

`assertCanCreateWorkspace(organizationId)` conta os workspaces ativos da org e compara com
`maxWorkspaces(plan)`. Excedeu → 403 com o plano necessário no erro. Chamado no serviço de
criação de workspace.

### 7.6 Sync

`POST /billing/sync` busca a assinatura corrente e as sessões pagas recentes do Customer e
aplica os mesmos handlers, idempotente pelo id do objeto Stripe. Serve para: evento
perdido, servidor fora do ar na hora do webhook, e ambiente de desenvolvimento sem túnel
para receber webhook.

---

## 8. Contratos HTTP

> **Nota posterior à implementação (2026-07-28):** o campo `hasPaymentMethod` da tabela
> abaixo foi implementado e depois renomeado para `hasSubscription` — o valor é
> `stripeSubscriptionId !== null`, que não é o mesmo que ter cartão. O contrato vigente
> está em `docs/architecture/billing.md` §8. Este registro de design fica como foi
> assinado; não implementar o nome antigo a partir daqui.

| Rota | `operationId` | Papel | Resposta |
|---|---|---|---|
| `GET /billing` | `getBilling` | qualquer membro | plano, status, `currentPeriodEnd`, `hasPaymentMethod`, `maxWorkspaces` |
| `POST /billing/checkout/subscription` | `createSubscriptionCheckout` | OWNER | `{ url }` |
| `POST /billing/checkout/credits` | `createCreditPackCheckout` | OWNER/ADMIN | `{ url }` |
| `POST /billing/portal` | `createBillingPortal` | OWNER | `{ url }` |
| `POST /billing/sync` | `syncBilling` | OWNER/ADMIN | mesmo shape de `GET /billing` |
| `POST /webhooks/stripe` | — | público, assinado | `200` / `400` |

O webhook não entra no contrato OpenAPI do cliente: quem chama é o Stripe, não o front.

Preço em dinheiro **não** aparece nessas respostas além do que o Stripe mostra na própria
tela de checkout. A regra do B2a continua: o cliente conta em créditos.

---

## 9. Erros

| Código | Chave | HTTP | Quando |
|---|---|---|---|
| `AUR-T0016` | `BILLING_NOT_CONFIGURED` | 500 | `STRIPE_SECRET_KEY` ausente |
| `AUR-T0017` | `WORKSPACE_LIMIT_REACHED` | 403 | teto do plano atingido; params `current`, `max` |
| `AUR-T0018` | `UNKNOWN_CREDIT_PACK` | 400 | `packId` fora do catálogo |

Assinatura de webhook inválida responde 400 cru, sem passar pelo catálogo: quem lê é o
Stripe, não uma pessoa.

---

## 10. Segurança

- **Assinatura do webhook é obrigatória.** Sem `STRIPE_WEBHOOK_SECRET` configurado, a rota
  não é registrada — melhor não existir do que existir sem verificação.
- **Corpo cru só na rota do webhook**, com limite de tamanho. Nenhuma outra rota muda de
  parser.
- **Nada de segredo em log:** nem chave do Stripe, nem corpo do evento. Log de evento
  registra `id`, `type` e resultado.
- **Metadata é entrada não confiável.** `organizationId` e `workspaceId` do metadata são
  verificados contra o `stripeCustomerId` da org antes de qualquer crédito: um evento com
  metadata apontando para outra org não credita nada.
- **Nenhuma rota concede crédito diretamente.** Crédito só entra por `grant`, chamado por
  handler de evento verificado ou pela CLI do B2a.

---

## 11. Testes

Unidade, com fake de `StripeClient` e payloads de evento fixos — nenhum teste toca a rede:

- despacho: cada tipo de evento produz o efeito esperado; tipo desconhecido é ignorado sem
  erro;
- idempotência: o mesmo `event.id` duas vezes credita uma vez;
- assinatura inválida → 400, e nenhum `StripeEvent` gravado;
- erro no handler não marca o evento como processado (o retry do Stripe precisa achar
  trabalho por fazer);
- `planForPrice` desconhecido não vira plano nem crédito;
- `effectiveAllowance`: `ACTIVE` e `PAST_DUE` dão a franquia do plano, `TRIAL` e `CANCELED`
  dão zero;
- upgrade lança exatamente a diferença; downgrade não lança nada;
- metadata apontando para org diferente do Customer não credita;
- teto de workspaces: no limite bloqueia com `current`/`max`, abaixo dele deixa passar;
- rotas por `app.inject`: papéis, e o `GET /billing` de um membro comum.

Integração (contra Postgres, na suíte `test:integration` do B2a): a migration que move
`plan` de workspace para organization preserva o valor.

---

## 12. Configuração nova

| Variável | Obrigatória | Nota |
|---|---|---|
| `STRIPE_SECRET_KEY` | para cobrar | ausente desliga as rotas de billing |
| `STRIPE_WEBHOOK_SECRET` | para receber evento | ausente não registra a rota do webhook |
| `STRIPE_PRICE_STARTER` / `_GROWTH` / `_SCALE` | sim | price de assinatura por plano |
| `STRIPE_PRICE_PACK_SMALL` / `_MEDIUM` / `_LARGE` | sim | pacotes de crédito |
| `APP_URL` | sim | base do success/cancel do checkout e do retorno do portal |

Franquia, teto de workspaces e créditos por pacote continuam em código.

---

## 13. Riscos e itens abertos

- **A franquia multiplica por workspace.** GROWTH com 2 workspaces = 2.000 créditos. O teto
  de workspaces por plano é o que segura isso; se o número de workspaces por plano mudar,
  a conta de margem muda junto.
- **Sem túnel, não há webhook em desenvolvimento.** `POST /billing/sync` cobre o
  desenvolvimento local; `stripe listen` cobre quem quiser o caminho real.
- **A migration mexe em coluna existente.** Mover `plan` de `Workspace` para `Organization`
  copia antes de dropar; se uma org tiver workspaces com planos diferentes (hoje
  impossível, todos `STARTER`), a migration fica com o maior.
- **Trial de 50 créditos é chute de produto**, como as franquias do B2a. Ajustar é uma
  linha.
- **`past_due` é janela de graça sem teto nosso**: quem define quanto dura é a política de
  retry do Stripe. Se ela for frouxa, alguém roda de graça por semanas.
