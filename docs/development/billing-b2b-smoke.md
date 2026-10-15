# Smoke da assinatura Stripe (B2b)

Ponta a ponta contra a conta Stripe em **test mode**. **Não** faz parte de `pnpm test`:
precisa de uma chave `sk_test_...` real e do `whsec_` que `stripe listen` imprime, nenhum
dos dois disponível em CI, e não deve ser automatizado sem supervisão — qualquer
divergência aqui é bug, não ajuste de teste.

## Pré-requisitos

- `.env` preenchido com `STRIPE_SECRET_KEY` (test mode) e os seis `STRIPE_PRICE_*`
  (já preenchidos em `.env.example` com os ids reais, não são segredo)
- `STRIPE_WEBHOOK_SECRET` — vem do `stripe listen` do passo abaixo, não é fixo
- Stripe CLI instalada e autenticada (`stripe login`)
- Postgres e Redis de pé

## Subir o ambiente

```bash
pnpm infra:up && pnpm dev          # terminal 1 — API em localhost:3337
stripe listen --forward-to localhost:3337/webhooks/stripe   # terminal 2
```

`stripe listen` imprime um `whsec_...`: copiar para `STRIPE_WEBHOOK_SECRET` em `.env` e
reiniciar `pnpm dev` antes de seguir — sem os dois, `STRIPE_SECRET_KEY` e
`STRIPE_WEBHOOK_SECRET`, a rota do webhook nunca é registrada.

## Passos

1. Registrar uma conta nova. Neste ponto a organização ainda não tem workspace nenhum —
   `GET /credits` responde 403 (`resolveTenant` recusa sem `workspaceId`) — e é esperado:
   o registro não cria mais um workspace `Default`.
2. `POST /workspaces` com `{"name":"Acme"}`. É aqui, na criação do primeiro workspace da
   organização, que o trial é concedido — não mais no registro. Conferir `GET /credits`:
   `allowance` **0** (`TRIAL`), `purchasedBalance` **50** (o grant de trial). **Não**
   rodar nenhum agente antes do passo 3: o primeiro run é o que abre o `CreditPeriod` do
   mês, e o passo 6 depende de ele ainda não existir.
3. `POST /billing/checkout/subscription` com `{"plan":"GROWTH"}`. Abrir a URL devolvida,
   aplicar o cupom `LANCAMENTO20`, pagar com o cartão de teste `4242 4242 4242 4242`.
4. Conferir no log da API (terminal 1) uma linha `stripe event` com
   `result: "plan GROWTH ACTIVE"`.
5. `GET /billing` → `plan: "GROWTH"`, `status: "ACTIVE"`, `hasSubscription: true`,
   `maxWorkspaces: 3`.
6. `GET /credits` → `allowance: 1000`, `purchasedBalance: 50`. O extrato
   (`GET /credits/ledger`) mostra **um** `GRANT`, o de 50 do trial, e **nenhum**
   `"plan change ..."`: a conta nunca rodou um agente, o `CreditPeriod` do mês ainda não
   existe, e quem vai abri-lo (`lockPeriod`, no primeiro run) já o abre com a franquia
   GROWTH inteira. Um `GRANT` de troca de plano aqui seria uma segunda franquia
   permanente em cima dessa.

   **Total gastável no mês: 1.050** (1.000 de franquia + 50 de trial). Este total é a
   verificação que importa — qualquer valor acima dele é crédito concedido em dobro.

   Para ver o complemento de upgrade, que é o outro caminho: rodar **um** agente agora
   (abre o período em 1.000), assinar SCALE pelo portal, e conferir no extrato um `GRANT`
   de **3.000** com motivo `"plan change GROWTH→SCALE"` — 4.000 da franquia SCALE menos os
   1.000 congelados no período. Total gastável: 4.050 menos o que o run consumiu.
7. `POST /billing/checkout/credits` com `{"packId":"SMALL"}`, pagar com o mesmo cartão de
   teste. `GET /credits` → `purchasedBalance` sobe **100**.
8. Reenviar o mesmo evento pelo dashboard ou `stripe events resend <evt_id>`.
   `GET /credits` → `purchasedBalance` **não muda** (idempotência pelo id da Checkout
   Session).
9. No dashboard do Stripe, cancelar a assinatura. `GET /billing` → `status: "CANCELED"`;
   `GET /credits` → `allowance: 0`, `purchasedBalance` intacto (o crédito comprado não é
   afetado por status).

## O que verificar

Os nove passos batem exatamente com os valores acima. Em particular:

- O passo 1 prova que `GET /credits` exige workspace — a conta recém-registrada não tem
  nenhum.
- O passo 2 prova que o trial é `GRANT` único, não franquia, e que ele nasce com o
  primeiro workspace, não no registro.
- Os passos 4–6 provam que o webhook é o caminho primário, que a assinatura sem período
  aberto não lança GRANT nenhum, e que o upgrade com período aberto lança só o
  complemento — sem reescrever o `allowance` congelado.
- O passo 8 prova a idempotência do webhook — o mesmo `event.id` não credita duas vezes.
- O passo 9 prova que cancelar zera a franquia sem tocar o crédito comprado.

## Se o webhook não chegar

`POST /billing/sync` (papel OWNER/ADMIN) busca a assinatura corrente e as sessões pagas
recentes da organização no Stripe e aplica os mesmos handlers do webhook — útil se
`stripe listen` cair no meio do teste, ou para repetir os passos 3–8 sem o túnel.

## Estado deste smoke test

Documentado e **não executado**: falta a chave `sk_test_...` real e o `whsec_` de
`stripe listen`, e obter as duas não é algo a se automatizar sem o dono do produto.
Quem tiver acesso à conta Stripe da AUREA roda os passos acima e confirma.
