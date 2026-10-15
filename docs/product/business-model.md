# AUREA Business Model

## 1. Purpose

This document defines how AUREA makes money and why the economics can support a multi-million business.

A system that produces value but not margin is not a business.

The numbers below are initial assumptions, expressed in Brazilian Reais (R$), to be validated with real customers.

They exist to force the unit-economics conversation early, not to lock in pricing.

---

# 2. Economic Thesis

```text
AUREA replaces or augments a growth function
that would otherwise cost a customer
tens of thousands of Reais per month
in salaries, agencies, and wasted spend.

AUREA should capture a fraction of that value
while costing a fraction of that price.
```

The value anchor is the cost of a growth hire or agency, not the cost of a SaaS tool.

---

# 3. Pricing Model

AUREA uses a hybrid model: a subscription for access plus metered AI for consumption.

```text
Subscription (predictable access + seats + features)
        +
Metered AI usage (variable cost pass-through with margin)
```

The subscription funds the platform.

The metered layer protects gross margin against variable LLM cost.

---

# 4. Tiers (Assumption)

```text
STARTER          ~R$ 297 / month
  1 workspace
  Business context + goals + research + strategy (Copilot)
  Limited monthly AI credits
  Core analytics read-only integrations

GROWTH           ~R$ 897 / month
  Experiments + content + social distribution (Operator, human-approved)
  More AI credits
  Ads + CRM integrations
  Benchmarks for the segment

SCALE            ~R$ 2.500+ / month
  Higher autonomy within guardrails
  Paid growth experiments
  Priority models, higher AI credits
  Multiple workspaces / seats
```

Overage AI usage is billed as metered credits above the included allowance.

---

# 5. Why Metered AI Is Non-Negotiable

AI inference is cost of goods sold (COGS).

```text
Autonomous agents consume tokens.

Uncapped agents on a flat subscription
can drive gross margin negative
for a single heavy customer.
```

Therefore:

```text
Every workspace has an AI cost budget.

Every AgentRun records model, tokens, and estimated cost
(see [[../architecture/persistance-model]]).

Cost-aware routing selects the cheapest model that meets the task
(see [[../architecture/ai-architecture]]).

Included credits per tier bound expected cost.

Overage converts additional cost into additional revenue.
```

---

# 6. Gross Margin Model

The target is healthy SaaS gross margin despite AI COGS.

```text
Revenue per workspace
   − LLM / AI inference cost
   − Third-party API costs (research, data)
   − Infrastructure (compute, DB, storage)
   − Payment processing
   = Gross profit

Target gross margin: 70%+ at maturity.
Minimum acceptable: 60% during early scaling.
```

If a customer's AI cost approaches a fixed ceiling of their subscription (e.g. 30%), routing must downgrade models or usage must convert to metered overage.

Margin is a product constraint, not just a finance concern.

---

# 7. Unit Economics Targets (Assumption)

```text
ARPA (avg revenue per account):   R$ 900 / month  →  R$ 10.8k / year
Gross margin:                     70%
CAC target:                       < R$ 5.4k  (payback < 6 months at gross)
LTV:CAC target:                   > 3 : 1
Logo churn target:                < 3% / month early, < 2% at maturity
Net revenue retention target:     > 110% (expansion via usage + tiers)
```

Net revenue retention above 100% is the single most important number.

It means the base grows even without new logos, and it signals the moat is working (see `[[moat]]`).

---

# 8. Path to Multiple Millions

```text
1.000 customers × R$ 900 / month × 12  ≈  R$ 10.8M ARR

500 customers × R$ 1.800 / month × 12  ≈  R$ 10.8M ARR
```

The multi-million outcome does not require millions of users.

It requires a few hundred to a few thousand of the right customers (see `[[personas]]`) retained and expanded.

This is why the wedge and retention matter more than top-of-funnel volume.

---

# 9. Expansion Levers

Revenue per account grows through:

```text
Usage
  More experiments, more channels → more AI credits.

Tier upgrade
  Copilot → Operator → higher autonomy.

Seats
  Growth hire, agency, team members added.

Workspaces
  Multiple brands / units.

Paid growth
  Higher-value autonomous ad experiments (Scale tier).
```

Expansion should be a natural consequence of the customer growing, not a forced upsell.

---

# 10. What AUREA Does Not Monetize (Initially)

```text
Selling customer data.
  Forbidden. It would destroy the trust the moat depends on.

Reselling ad spend as markup.
  Avoided; it misaligns AUREA's incentive with the customer's outcome.
```

AUREA's incentive must stay aligned with the customer's growth.

---

# 11. Business Model Principle

AUREA charges for better growth decisions and outcomes, not for AI tokens or generated content.

```text
Price against the value of a growth function.
Protect margin with metered AI and cost-aware routing.
Grow revenue by growing with the customer.
Never monetize in a way that breaks trust or alignment.
```

Pricing is a hypothesis.

It should be tested and revised like any other experiment in AUREA.
