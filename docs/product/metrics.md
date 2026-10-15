# AUREA Product Metrics

## 1. Purpose

This document defines how AUREA measures its own success.

AUREA's vision claims it produces "better growth decisions".

A claim that cannot be measured cannot be sold, funded, or improved.

This document turns that claim into measurable metrics.

---

# 2. The Measurement Problem

AUREA must measure two different things and never confuse them:

```text
Customer outcomes
  Did the customer's business grow?

Product engagement
  Did the customer use AUREA?
```

Engagement without outcomes is a vanity trap.

Outcomes without engagement means AUREA got lucky, not useful.

AUREA succeeds only when engagement causes outcomes.

---

# 3. North Star Metric

The North Star should express value delivered, not activity.

```text
North Star:

Number of VALIDATED LEARNINGS per active workspace per month.
```

Why this metric:

```text
A validated learning requires the full loop to work:
  a goal, a strategy, an experiment, a measured outcome,
  and a conclusion the customer trusts.

It is hard to fake.

It compounds into the moat (see [[moat]]).

It correlates with customer outcomes and retention.
```

Supporting North Star (business-outcome proxy):

```text
% of workspaces whose primary goal metric improved
versus their own baseline, within a period.
```

---

# 4. The AAARRR Funnel for AUREA

```text
Acquisition
  Signups from the wedge segment.

Activation
  Reached first value (see §5).

Retention
  Still running the loop after 30 / 60 / 90 days.

Revenue
  Converted to paid; expanded.

Referral
  Recommended AUREA (founder networks are dense).

Return
  Came back for the next growth decision.
```

---

# 5. Activation Definition

Activation is the most important early metric.

A customer is activated when they complete one full micro-loop:

```text
Business context defined
      ↓
One goal set
      ↓
One strategy accepted
      ↓
One experiment launched
      ↓
One outcome measured
      ↓
One learning recorded
```

Target: a new customer reaches activation within their first 7 days.

If activation is slow, retention will collapse regardless of long-term value.

See cold-start handling in `[[gtm]]`.

---

# 6. Retention Metrics

```text
Loop retention
  % of workspaces that run at least one experiment per period.

Decision cadence
  Frequency of accepted recommendations / decisions per workspace.

Logo retention
  % of paying accounts retained month over month.

Net revenue retention
  Revenue retained + expanded, net of churn. Target > 110%.
```

Net revenue retention is the clearest signal that the moat is compounding.

---

# 7. Product Quality Metrics

Because AUREA is AI-driven, output quality must be measured directly.

```text
Recommendation acceptance rate
  % of AUREA recommendations a human approves.

Strategy → experiment conversion
  % of proposed strategies that become live experiments.

Experiment success rate
  % of experiments that meet their success criteria,
  measured against the customer's own baseline.

Learning validation rate
  % of learning candidates that survive validation.

Time to first validated learning
  Onboarding → first trustworthy conclusion.
```

A low acceptance rate signals AUREA's intelligence is not yet trusted.

---

# 8. Trust and Safety Metrics

```text
Guardrail interventions
  How often guardrails blocked or flagged an action.

Reversal rate
  % of executed actions the customer later undid.

Incident count
  Actions that caused customer harm (spend, brand, compliance).
```

These must trend toward zero as autonomy increases.

See `[[../domains/guardrails]]`.

---

# 9. Economic Metrics

```text
ARPA
CAC and CAC payback
LTV and LTV:CAC
Gross margin (after AI COGS)
AI cost per active workspace
```

AI cost per workspace is a product metric, not only a finance metric.

If it rises faster than value, routing and packaging must change (see `[[business-model]]`).

---

# 10. Anti-Metrics

AUREA should refuse to celebrate these in isolation:

```text
Number of AI-generated posts.
Number of automations run.
Number of agents.
Number of integrations connected.
Tokens consumed.
```

These measure activity, not value.

The vision document explicitly warns against them.

---

# 11. Metrics Principle

AUREA should be judged by whether customers make better decisions and get better results, and whether AUREA improves at helping them over time.

```text
Measure value, not activity.
Prove that engagement causes outcomes.
Watch the North Star: validated learnings that compound.
Treat AI quality and trust as first-class metrics.
```

If AUREA cannot show a customer got measurably better, AUREA has not yet earned the price.
