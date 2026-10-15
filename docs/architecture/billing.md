# AUREA Billing Architecture

## 1. Purpose

This document describes how money becomes AI credit in AUREA, and how the loss of a
subscription takes it away again.

It covers the Stripe integration built in sub-project B2b: the organization subscribes
to a plan, its workspaces inherit that plan, a one-off credit pack becomes a ledger row,
a mid-period upgrade grants the difference immediately, and losing the subscription
zeroes the monthly franchise without touching credit that was already paid for.

This document does not cover the credit ledger itself (append-only entries, atomic
debit, refund) or BYOK — both were built in sub-project B2a and are unchanged here.

## 2. The Organization subscribes, the Workspace inherits

One Stripe Customer per `Organization` — it is the organization that holds a card and a
tax id, not an individual workspace. `Plan` and `SubscriptionStatus` live on
`Organization`:

```prisma
enum SubscriptionStatus {
  TRIAL
  ACTIVE
  PAST_DUE
  CANCELED
}

model Organization {
  plan                 Plan               @default(STARTER)
  subscriptionStatus   SubscriptionStatus @default(TRIAL)
  stripeCustomerId     String?            @unique
  stripeSubscriptionId String?
  currentPeriodEnd     DateTime?
  lastSyncedAt         DateTime?
}
```

`Workspace.plan` does not exist. Every workspace in an organization pays the same
monthly franchise, at the plan the organization is on.

## 3. Money flow

```text
  POST /billing/checkout/*  ──►  Checkout Session  ──►  customer pays  ──►  return redirect
                                        │
                                        ▼
                                  signed event
                                        │
                                        ▼
                              POST /webhooks/stripe                       POST /billing/sync
                                        │                                        │
                                  verify signature ─invalid─► 400                │
                                        │ valid                                  │
                                        ▼                                        │
                          SELECT StripeEvent by id ─found─► 200 (duplicate, skip) │
                                        │ not found                               │
                                        ▼                                        │
                                    event handlers  ◄─────────────────────────────┘
                                        │
              ┌─────────────────────────┼─────────────────────┐
              ▼                         ▼                     ▼
     Organization.plan           ledger GRANT          subscriptionStatus
              │                         │                     │
              └─────────────────────────┴─────────────────────┘
                                        │
                              B2a: authorizeAndCharge
```

**The webhook and `POST /billing/sync` deliver the same `BillingEvent` to the same
handlers.** They converge at the handlers, not upstream of them: `sync` skips the entire
left-hand column — it never verifies a Stripe signature and never touches the
`StripeEvent` table (it calls neither `alreadyProcessed` nor `markProcessed`). Instead it
fetches the organization's current subscription and recent paid Checkout Sessions
straight from Stripe and converts them into the same `BillingEvent` shape the webhook
produces. Its protection against double-crediting comes entirely from each handler's own
`grantOnce` idempotency key — the Checkout Session id for a credit-pack purchase,
`${subscriptionId}:{periodEnd}:{newPlan}` for an upgrade grant (see §6) — the same key
a resent webhook event would also produce. `sync` is not a second implementation of the
billing rules; it is a second way to reach the same handlers. A bug fixed in one handler
is fixed for both delivery paths, by construction.

## 4. Effective franchise by subscription status

The monthly franchise ("allowance") a workspace draws from depends on the
organization's plan **and** its subscription status — not the plan alone:

```ts
// ACTIVE and PAST_DUE pay the plan's franchise; TRIAL and CANCELED pay zero.
export function effectiveAllowance(plan: Plan, status: SubscriptionStatus): number;
```

| Status | Franchise | Why |
|---|---|---|
| `TRIAL` | 0 | No subscription yet. The organization instead received a one-time 50-credit `GRANT` when it created its first workspace (see §6). |
| `ACTIVE` | plan's franchise | Subscription in good standing. |
| `PAST_DUE` | plan's franchise | Stripe is retrying the card for about two weeks. A card that failed once is not bad faith, and cutting off on the first failed charge loses a good customer. |
| `CANCELED` | 0 | No subscription. |

Purchased credit (from a credit pack) is never affected by subscription status: a
customer who paid for a pack can spend it even with a canceled subscription. Only the
monthly franchise is gated by status.

Franchise per workspace per month, by plan: STARTER 200, GROWTH 1 000, SCALE 4 000.
Because the franchise multiplies by workspace count, each plan also caps how many
workspaces an organization may have: STARTER 1, GROWTH 3, SCALE 10 — without this cap a
STARTER organization could create twenty workspaces and draw 4 000 credits for the price
of one seat. `POST /workspaces` enforces the cap inside the same transaction that
inserts the workspace, with a `SELECT ... FOR UPDATE` lock on the `Organization` row, so
two concurrent creations cannot both pass the cap.

## 5. Events handled

The webhook (`POST /webhooks/stripe`) and the sync endpoint both normalize Stripe
payloads into the same `BillingEvent` union (`src/billing/stripe-event.ts`) and apply it
through `subscription.service.ts`:

| Event | Effect |
|---|---|
| `checkout.session.completed`, `mode=payment` | `grantOnce` the credit pack's credits into the workspace named in the Checkout Session's metadata, keyed by the Checkout Session id (idempotent: a resend of the same event does not credit twice). |
| `customer.subscription.created` / `customer.subscription.updated` | Saves plan, status, and `currentPeriodEnd`. If the current period is already open and its frozen allowance is below the new plan's franchise, grants the difference as a `GRANT` (see §6). |
| `customer.subscription.deleted` | Sets `subscriptionStatus` to `CANCELED` — but only if the subscription that died is the one stored on the organization. The franchise falls to zero on the next authorization; the plan field itself is left as-is, since it still records what the organization had. |

Every event that can move credit carries the identity it needs to be verified, and both
crediting handlers run the same check (`untrustedMetadata` in
`src/billing/subscription.service.ts`) before anything reaches the ledger: the
organization named in the metadata must be the owner of the Stripe Customer that actually
paid, and the workspace must belong to that organization. Metadata is untrusted input
(spec §10) — it is written from the authenticated tenant context by our own routes today,
but a Payment Link or a Dashboard comp with hand-typed metadata reaches the same handlers.

Ordering matters too, because Stripe guarantees none and retries for up to three days. A
`customer.subscription.deleted` for a subscription that is not the stored one is ignored,
so a delayed cancellation of `sub_1` cannot zero the franchise of an organization that
has already resubscribed on `sub_2`. A `customer.subscription.updated` for a different
subscription whose period ended *earlier* than the stored `currentPeriodEnd` is ignored
for the same reason; if its period ends later it is the newer subscription and is
applied.

No `invoice.*` event is handled. `customer.subscription.updated` already carries
`past_due` in its `status` field, so there is exactly one path to that state, not two.

## 6. Trial credit and the mid-period upgrade grant

**Trial is a `GRANT`, not a franchise.** Registration creates only the `Organization`,
the `User` and an organization-level `Membership` — no `Workspace` and no ledger entry.
The trial is granted when the organization creates its **first** `Workspace`:
`createWorkspaceForOrg` (`src/billing/create-workspace.ts`), inside the same transaction
that inserts the workspace and its membership, writes a single ledger entry granting 50
credits with reason `"trial credits"` when the organization had zero workspaces before
this one. There is no `trialUsed` flag: the ledger entry itself is the record that the
grant happened, and it is only ever written from that one place in the code — every
workspace after the first gets no welcome credits.

**An upgrade in the middle of a billing period tops the period up to the new plan's
franchise**, instead of rewriting the frozen `allowance` on the current `CreditPeriod`
(owned by B2a). Spec §7.4 grants the difference "com o período corrente já aberto" — with
the current period **already open** — and that clause is load-bearing, so the amount is
computed from what the period has actually received, never from the distance between two
plan levels:

```text
period = CreditPeriod(workspaceId, startOfMonthUtc(now))

if period does not exist:            grant nothing
else: delta = max(0, effectiveAllowance(newPlan, newStatus)
                     − period.allowance
                     − credits already granted this period by a plan change)
      if delta > 0: grantOnce(workspaceId, delta, "plan change OLD→NEW")
```

**No period row means no grant.** The only writer of `CreditPeriod` is B2a's
`lockPeriod`, reached on the first agent run of the month, and it creates the row at the
*current* effective allowance. An organization that subscribes before its first run of
the month therefore gets the full new franchise from `lockPeriod` itself; granting the
difference as well would hand it a second, **permanent** franchise on top — permanent
because `purchasedBalance` sums `PURCHASE` and `GRANT` across the whole ledger with no
period filter. A GROWTH customer would start the month with 2 000 credits instead of
1 000.

Plan-change entries are recognised by a reserved reason prefix (`plan change`), held in a
single exported constant that both the writer and the SQL aggregate use. **This makes the
prefix operationally reserved:** a manual grant through `pnpm ai:grant` whose `--reason`
starts with those words would be counted against the month's top-up and would silently
shrink a later legitimate one. The CLI refuses that prefix for exactly this reason (see
`docs/development/ai-layer-smoke.md`).

**Subtracting what the period already received is what makes stacking impossible.** Two
upward changes inside one period can never add up to more than the top plan's franchise:
`STARTER→SCALE` (+3 800), a downgrade, then `STARTER→GROWTH` and `GROWTH→SCALE` together
add nothing further, because 4 000 − 200 − 3 800 = 0. Downgrade never grants or removes
anything; it takes effect at the next period rollover, same as B2a's regular franchise
renewal.

The grant is idempotent under the key
`${subscriptionId}:${currentPeriodEnd}:${newPlan}`. The key deliberately does **not**
carry the stored plan: two concurrent deliveries of the same change must collide on the
same key before either commits its ledger entry, which is the only thing standing between
them and a double credit. It does carry the target plan, so a genuine second upgrade in
the same month (`STARTER→GROWTH`, later `GROWTH→SCALE`) can still post its own top-up —
the amount formula above already caps the total.

The grant runs **before** the new subscription state is saved to `Organization`. If the
process dies between the grant and the save, the organization is still recorded under the
old plan; a Stripe retry recomputes the amount against the ledger, which already holds
the first entry, and arrives at zero. Had the order been reversed (save first, grant
second), a crash after the save would leave the new plan already recorded with nobody
left to post the credit, and it would be lost silently. This ordering is deliberate and
must not be inverted.

## 7. Webhook mechanics

```text
verify signature ─── invalid ──► 400, nothing processed
        │ valid
        ▼
SELECT StripeEvent by id ─── found ──► 200 (already processed, handlers not called again)
        │ not found
        ▼
    dispatch to handlers ─── throws ──────► 500, no INSERT — stays unmarked, Stripe retries
        │                  ─── 'unresolved' ──► 500, no INSERT — stays unmarked, Stripe retries
        │ 'applied' | 'ignored'
        ▼
INSERT StripeEvent (mark processed, ON CONFLICT DO NOTHING)
        │
        ▼
      200
```

The duplicate check (`repo.alreadyProcessed`) is a plain `SELECT` on `StripeEvent`,
run **before** dispatch. The processed mark (`repo.markProcessed`) is a separate
`INSERT ... ON CONFLICT DO NOTHING`, run **after** the handler returns successfully — it
is not the duplicate-detection step, and the two must not be conflated into one
"insert-or-detect" operation. A throwing handler skips the `INSERT` on purpose, so
Stripe's automatic retry still finds an unmarked event to redeliver — the alternative
(marking it processed regardless of outcome) would silently drop the effect of a failed
webhook delivery.

A handler returns one of three results, and the third exists because two very different
outcomes used to collapse into one. `'applied'` and `'ignored'` are both final and get
the processed mark: `'ignored'` means *this event is not ours* — an unknown price, an
unhandled type, a subscription-mode checkout — and resending it would change nothing.
`'unresolved'` means *the organization could not be resolved yet*: an unknown Customer, or
metadata that does not verify against the Customer that paid. That is either transient
(the Customer claim of §2 not yet committed) or a misconfiguration, and in both cases
money may already have moved while nothing was credited. It answers 500 without marking
the event, so Stripe's retry window becomes the repair mechanism it was designed to be.

The route is registered only when both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`
are set (`src/app.ts`): better for the route not to exist at all than to exist without
signature verification. It carries `schema: { hide: true }`, so it is excluded from the
OpenAPI contract generated for the Kubb frontend client — its caller is Stripe, not
`aurea-web` (verified in the Task 14 report: `grep -c "webhooks/stripe" openapi.json` →
`0`).

A dedicated raw-body content-type parser is registered only inside this route's
encapsulated plugin scope, capped at 1 MiB: signature verification needs the exact bytes
Stripe sent, and Fastify's global JSON parser would destroy them. No other route changes
its body parser.

## 8. Client HTTP contract

| Route | `operationId` | Role | Response |
|---|---|---|---|
| `GET /billing` | `getBilling` | any member | plan, status, `currentPeriodEnd`, `hasSubscription`, `maxWorkspaces`, `workspaceCount` |
| `GET /billing/plans` | `getBillingPlans` | any member | catalog: per plan `monthlyCredits`, `maxWorkspaces`, `priceCents`, `currency`; per pack `credits`, `priceCents`, `currency` |
| `POST /billing/checkout/subscription` | `createSubscriptionCheckout` | OWNER | `{ url }` |
| `POST /billing/checkout/credits` | `createCreditPackCheckout` | OWNER/ADMIN | `{ url }` |
| `POST /billing/portal` | `createBillingPortal` | OWNER | `{ url }` |
| `POST /billing/sync` | `syncBilling` | OWNER/ADMIN | same shape as `GET /billing` |
| `POST /billing/subscription/plan` | `changeSubscriptionPlan` | OWNER | same shape as `GET /billing` |
| `GET /workspaces` | `listWorkspaces` | any member (own memberships only) | list of workspaces |
| `POST /workspaces` | `createWorkspace` | OWNER/ADMIN | created workspace |
| `POST /webhooks/stripe` | — (`hide: true`) | Stripe only, signature-verified | `200` / `400` |

**`POST /billing/subscription/plan` does not open a second Checkout Session.**
`POST /billing/checkout/subscription` only knows how to *create* a subscription
(`mode: 'subscription'`); calling it again on an organization that already has an
`ACTIVE` or `PAST_DUE` subscription would open a second one, and the customer would pay
for both until someone noticed. Changing plan on an existing subscription instead calls
`stripe.subscriptions.update` on the existing subscription item, with
`proration_behavior: 'create_prorations'` — the same operation the Stripe Customer
Portal itself performs for a plan switch. It requires the organization to already carry
a `stripeSubscriptionId` and a status of `ACTIVE` or `PAST_DUE`; anything else answers
`NO_ACTIVE_SUBSCRIPTION` (`AUR-T0019`, 409) without calling Stripe. The updated
subscription is converted into the same `subscription-state` `BillingEvent` the webhook
produces (`eventFromSnapshot`) and applied through the same `subscription.service.apply`
— so plan, status and `currentPeriodEnd` persist and a mid-period upgrade grants its
delta (§6) through the one code path that both the route and the webhook share.

Stripe still delivers `customer.subscription.updated` for this same change — the route
does not suppress it, and does not need to. That event normalizes to the exact same
`BillingEvent` the route already applied (same subscription, same target plan, same
`currentPeriodEnd`, because Stripe keeps the billing anchor on a mid-cycle change), so
it carries the identical delta-grant idempotency key. The second delivery re-saves the
same subscription state and finds the ledger entry already there — the upgrade grant
lands exactly once, regardless of which of the two deliveries arrives first.

> **Divergência consciente do §8 do design do B2b (2026-07-28).** Aquele
> documento dizia que preço em dinheiro não aparece nas respostas. `GET
> /billing/plans` devolve `priceCents`, porque a tela de cobrança precisa
> deixar o fundador comparar planos antes de clicar em "assinar". O que
> continua valendo: as respostas de estado (`GET /billing`, `GET /credits`)
> não têm dinheiro, e o cliente conta em créditos.

`hasSubscription` says exactly one thing: a subscription id is recorded on the
organization. It is deliberately not called `hasPaymentMethod`, which was wrong in both
directions — a pack-only customer has a card on file and would read `false`, and a
cancelled customer keeps its `stripeSubscriptionId` (cancellation only moves the status)
and would read `true` forever. A client that wants "subscription in good standing" reads
`hasSubscription` together with `status`.

Outside the catalog exception above, no route in this table returns a price in money —
the customer reasons in credits (the B2a rule), and the only other place a Brazilian
Real amount is shown is Stripe's own Checkout and portal pages.

## 9. Configuration

| Variable | Required | Note |
|---|---|---|
| `STRIPE_SECRET_KEY` | to charge | absent turns off the billing checkout/portal routes (`BILLING_NOT_CONFIGURED`) |
| `STRIPE_WEBHOOK_SECRET` | to receive events | absent means the webhook route is never registered |
| `STRIPE_PRICE_STARTER` / `_GROWTH` / `_SCALE` | yes | subscription price id per plan |
| `STRIPE_PRICE_PACK_SMALL` / `_MEDIUM` / `_LARGE` | yes | credit pack price ids |
| `APP_URL` | yes | base for the checkout success/cancel URLs and the portal return URL |

The franchise table, the workspace cap, and the credit-pack sizes stay in code
(`src/billing/plan-catalog.ts`, `src/billing/credit-packs.ts`), not in the database or in
Stripe: changing what a plan grants is a product decision that goes through code review,
not an `UPDATE` run against production.
