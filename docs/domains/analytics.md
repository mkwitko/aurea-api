# AUREA Analytics Domain

## 1. Purpose

The Analytics domain connects execution to measurable results.

It is responsible for observing what actually happened.

In the growth loop, Analytics supplies the Observed State.

```text
Desired State
      ↓
Strategic State
      ↓
Operational State
      ↓
Observed State  ← Analytics
      ↓
Learned State
```

Analytics answers:

```text
What did we actually measure?

Did the experiment move the metric?

Where did the result come from?

Is the signal real or noise?

What should we learn from it?
```

Analytics turns raw platform data into structured Outcomes the Growth Brain can reason over.

---

# 2. What AUREA Analytics Is Not

AUREA Analytics is not another business intelligence platform.

It is not a dashboard product.

It is not a replacement for GA4, PostHog, or ad platform reporting.

```text
A BI platform answers:
What are the numbers?

AUREA Analytics answers:
What do the numbers mean for our decisions?
```

AUREA does not exist to display charts.

It exists to connect observed results to hypotheses, experiments, and learning.

The dashboards remain useful.

AUREA reasons on top of them.

---

# 3. Domain Responsibility

The Analytics domain is responsible for:

* Connecting to external data sources
* Ingesting metrics and events
* Normalizing data into a common representation
* Recording Outcomes with provenance
* Associating Outcomes with experiments and actions
* Detecting anomalies
* Producing insights and Learning candidates
* Supplying the Observed State to the Growth Brain

The Analytics domain is not responsible for:

* Defining Goals or Strategies
* Designing experiments
* Executing actions
* Deciding canonical business truth
* Storing secrets or managing integration authentication
* Replacing external analytics tools

Analytics observes and interprets.

It does not decide strategy and it does not execute.

---

# 4. Analytics in the Growth Loop

Analytics is the feedback path of the loop.

```text
Experiment
      ↓
Action
      ↓
Execution on external platforms
      ↓
Analytics ingests results
      ↓
Outcome
      ↓
Insight / Learning candidate
      ↓
Updated Context
```

Without Analytics, the loop cannot close.

An experiment with no observed outcome produces no learning.

---

# 5. Data Sources

Analytics may ingest data from many sources.

Examples:

```text
GA4
PostHog
Meta Ads
Google Ads
LinkedIn Ads
TikTok Ads
CRM (HubSpot, Salesforce)
Social platforms
Email platforms
User input
```

Each source has its own schema, vocabulary, and quirks.

Analytics must reconcile them into one internal model.

---

# 6. Source Types

Sources fall into broad categories.

```text
Web Analytics
Product Analytics
Advertising Platforms
CRM and Sales
Social Platforms
Email and Messaging
Manual User Input
```

User input is a valid source.

Not every meaningful metric is available through an API.

Some outcomes are entered by a human.

---

# 7. Raw Ingestion

Analytics first ingests raw data.

```text
External Source
      ↓
Raw Metric / Event
```

Raw data reflects the source's native structure.

Examples:

```text
GA4:
sessions, conversions, engagementRate

Meta Ads:
spend, impressions, clicks, ctr, cpl

CRM:
qualified_leads, opportunities, closed_won
```

Raw data should retain its origin.

---

# 8. Metric Normalization

Raw metrics are normalized into a common internal representation.

```text
Raw Metric
      ↓
Normalized Metric
```

Normalization reconciles differences such as:

```text
Different names for the same concept
Different units
Different currencies
Different time granularities
Different attribution windows
```

Example:

```text
GA4 "conversions"
Meta "results"
CRM "qualified_leads"

→ Normalized concept: Qualified Lead
```

Normalization is what allows AUREA to compare across platforms.

---

# 9. Normalized Metric Representation

A normalized metric should carry:

```text
Metric Name
Value
Unit
Time Period
Source
Confidence
External Reference
```

Example:

```text
Metric:
Cost per Qualified Lead

Value:
78

Unit:
USD

Period:
2026-07-01 to 2026-07-28

Source:
GOOGLE_ADS + CRM

Confidence:
MEDIUM
```

The normalized representation is the internal currency of Analytics.

---

# 10. Outcome Recording

An Outcome is an observed result recorded against the growth model.

```text
Normalized Metric
      ↓
Outcome
```

An Outcome should reference an Experiment or Action whenever possible.

Example:

```text
Outcome:
Metric: Cost per Qualified Lead
Value: 78
Unit: USD
Experiment: High-Intent Search Test
Source: GOOGLE_ADS
ObservedAt: 2026-07-28
```

Outcomes are the primary product of the Analytics domain.

---

# 11. Outcome Provenance

Every Outcome must carry provenance.

Provenance records:

```text
Source
External Reference
Observed At
Ingestion Method
Confidence
```

Provenance answers:

```text
Where did this number come from?

How was it measured?

How much should we trust it?
```

An Outcome without provenance is not trustworthy.

Observed data is a fact only to the extent that its source is known.

---

# 12. Observed Data Is Not Automatically Truth

A recorded Outcome is observed data.

Observed data can still be wrong.

Sources of error include:

```text
Broken tracking
Duplicate events
Attribution misconfiguration
Currency mismatches
Timezone mismatches
Bot traffic
Sampling
```

Analytics should flag suspicious data rather than silently trusting it.

```text
Observed Data
      ↓
Validated Observation
```

---

# 13. Attribution

Attribution connects an Outcome to the cause that produced it.

Example:

```text
Which channel produced this lead?

Which experiment drove this conversion?

Which action caused this change?
```

Attribution is difficult and imperfect.

AUREA treats attribution pragmatically.

---

# 14. Attribution Limits

AUREA acknowledges the limits of attribution.

Known challenges:

```text
Multi-touch journeys
Cross-device behavior
Privacy restrictions
Cookie loss
Dark social
Delayed conversions
Overlapping campaigns
```

The pragmatic stance is:

```text
Prefer directional attribution over false precision.

State attribution confidence explicitly.

Do not present modeled attribution as exact fact.
```

Approximate attribution honestly labeled is more useful than precise attribution that is wrong.

---

# 15. Attribution Model

Conceptually:

```text
Action / Experiment
      ↓
Attributed Metric Movement
      ↓
Outcome
      ↓
Attribution Confidence
```

Example:

```text
Experiment:
High-Intent Search Test

Attributed Result:
120 qualified leads

Attribution Method:
Last-touch via UTM + CRM source

Attribution Confidence:
MEDIUM
```

The attribution method should be recorded alongside the outcome.

---

# 16. Anomaly Detection

Analytics should detect anomalies in observed data.

Examples:

```text
A sudden spike in cost.
A collapse in conversion rate.
Traffic without corresponding conversions.
A metric that stopped reporting.
A value far outside the historical range.
```

An anomaly is a signal that something changed.

The change may be an opportunity, a problem, or a data error.

---

# 17. Anomaly Response

An anomaly should trigger a response.

```text
Anomaly Detected
      ↓
Classify
      ↓
Data Error
Opportunity
Risk
      ↓
Notify / Investigate / Create Experiment
```

Example:

```text
Anomaly:
CAC dropped 40% overnight.

Possible interpretations:
A real efficiency gain.
A tracking error.
A billing lag.

Action:
Flag for review before acting.
```

An anomaly should not automatically trigger consequential action without validation.

---

# 18. Insights

Analytics produces insights.

An insight is an interpretation of observed data.

Example:

```text
Insight:
Search traffic converts at roughly twice the rate
of paid social for the B2B SaaS ICP.
```

An insight is not yet validated Learning.

It is a candidate interpretation.

---

# 19. Learning Candidates

Analytics feeds Learning candidates into the Growth Brain.

```text
Outcome
      ↓
Analysis
      ↓
Insight
      ↓
Learning Candidate
      ↓
Validation
      ↓
Knowledge
```

A Learning candidate should include:

```text
Statement
Evidence
Confidence
Source
Related Experiment
```

Learning candidates are proposed by Analytics.

They are validated before becoming canonical knowledge.

---

# 20. The Analytics Agent

The Analytics Agent operates within the Analytics domain.

The Analytics Agent may:

```text
Interpret normalized metrics
Compare outcomes against baselines and targets
Evaluate experiment success criteria
Detect and explain anomalies
Propose insights
Propose Learning candidates
```

The Analytics Agent should not:

```text
Decide canonical truth
Change strategy
Execute actions
Validate its own learnings without review
```

The Analytics Agent proposes.

The Growth Brain and the human validate.

---

# 21. Analytics Agent Output

The Analytics Agent should produce structured output.

Conceptually:

```text
{
  "experimentId": "...",
  "metric": "...",
  "observedValue": 0,
  "baselineValue": 0,
  "targetValue": 0,
  "result": "SUCCESS | PARTIAL | FAILURE | INCONCLUSIVE",
  "confidence": "MEDIUM",
  "anomalies": [],
  "insights": [],
  "learningCandidates": []
}
```

The exact schema is implementation-dependent.

---

# 22. Baseline and Comparison

Analytics compares observed values against expectations.

```text
Observed
   vs
Baseline
   vs
Target
```

Example:

```text
Metric: Conversion Rate
Baseline: 4.2%
Target: 5.5%
Observed: 6.1%

Result:
Target exceeded.
```

The comparison drives the evaluation of experiment success.

**Implementation, 2026-08-03.** `compareMeasurement`
(`src/http/api/outcomes/outcomes.domain.ts`) computes `delta` and `deltaPct`
against the baseline and `progressPct` against the target, and every outcome in
the API and in `get_experiment_result` carries it. It is arithmetic and nothing
else: no field names a winner, because `experiments.md` §14 forbids deriving one
from a free-text `successCriteria`. Any of the three is null when the number it
needs is missing or zero — an undefined ratio is reported as absent, never as
100%.

---

# 23. Metric Types

Analytics handles several metric types.

Examples:

```text
Volume metrics (leads, signups, sales)
Rate metrics (conversion rate, CTR)
Cost metrics (CAC, CPL, CPC)
Value metrics (revenue, pipeline, LTV)
Engagement metrics (sessions, retention)
```

Different metric types require different normalization and comparison logic.

---

# 24. Time and Periods

Metrics are always tied to a time period.

```text
Metric + Period
```

Analytics must reconcile:

```text
Different reporting windows
Timezones
Attribution windows
Delayed conversions
```

A metric without a defined period is ambiguous.

---

# 25. Data Model

Conceptually, Analytics contributes the following entities.

### Outcome

```text
Outcome
├── id
├── workspaceId
├── experimentId
├── actionId
├── metric
├── value
├── unit
├── observedAt
├── source
├── externalReferenceId
├── createdAt
└── updatedAt
```

An Outcome should reference an Experiment or Action whenever possible.

### Metric (normalized)

```text
Metric
├── name
├── value
├── unit
├── period
├── source
├── confidence
└── externalReference
```

### Normalized Event

```text
NormalizedEvent
├── id
├── workspaceId
├── source
├── eventType
├── entity
├── value
├── occurredAt
├── externalReferenceId
└── metadata
```

Possible sources:

```text
GA4
POSTHOG
GOOGLE_ADS
META_ADS
LINKEDIN_ADS
CRM
SOCIAL
EMAIL
USER_INPUT
```

### Relationships

```text
Experiment
      ↓
Outcome
      ↓
Learning
```

```text
Integration
      ↓
ExternalReference
      ↓
Outcome
```

The raw source data may live in external systems.

The canonical Outcome lives in AUREA.

This aligns with the AUREA Persistence Model.

---

# 26. Provenance and Confidence Model

Every observed value carries provenance and confidence.

```text
Value
├── source
├── externalReference
├── observedAt
├── confidence
└── attributionMethod
```

Possible confidence levels:

```text
LOW
MEDIUM
HIGH
VERIFIED
```

Confidence should reflect data quality, sample size, and attribution certainty.

---

# 27. Feeding the Growth Brain

Analytics supplies the Growth Brain with observed reality.

```text
Analytics
   ↓
Outcomes
   ↓
Experiment Evaluation
   ↓
Learning Candidates
   ↓
Updated Context
```

The Growth Brain owns the canonical interpretation.

Analytics supplies the evidence.

---

# 28. Initial MVP Scope

The first implementation should support:

```text
Manual Outcome entry
Basic metric normalization
Outcome recording with provenance
Comparison against baseline and target
Experiment success evaluation
Basic anomaly flagging
Learning candidate proposal
```

The MVP may begin with:

```text
GA4
One advertising platform
CRM or user input
```

Full multi-source ingestion and automated attribution may follow.

Manual Outcome entry ensures the loop can close before every integration exists.

---

# 29. First Analytics Experience

The initial user journey should be:

```text
Experiment running
      ↓
Analytics ingests or user enters results
      ↓
Metric normalized
      ↓
Outcome recorded with source and confidence
      ↓
Result compared to success criteria
      ↓
Insight proposed
      ↓
Learning candidate created
      ↓
Human reviews and validates
```

---

# 30. Analytics Principle

The Analytics domain exists to connect action to reality.

It should never behave like:

```text
User:
Did it work?

AI:
Here is a dashboard with 40 charts.
```

It should behave like:

```text
User:
Did it work?

AUREA:
The experiment targeted a CAC of $80.

We observed $78 from Google Ads and CRM data.

Confidence is medium due to a short measurement window.

This suggests high-intent search reduces CAC for this ICP.

Do you want to validate this as a Learning?
```

Analytics does not exist to report numbers.

It exists to turn observed reality into learning the Growth Brain can trust.

```text
Data
+
Normalization
+
Provenance
+
Interpretation
=
Trustworthy Observed State
```
