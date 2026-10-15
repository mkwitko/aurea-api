# Analytics Agent lite — AUREA reads the result, the human rules on it

**Status:** approved design, not yet planned
**Repos:** `aurea-back` (agent, tool, accept route, migration, dashboard stage) and `aurea-web` (the panel)
**Phase:** MVP Step 6 (`docs/development/mvp.md` §8), the lite slice of engineering phase 09

## 1. Why now

`docs/development/mvp.md` §4 lists, in scope: *"Analytics Agent (lite): interpret the
outcome, propose a learning candidate."* It is the last open MVP gap. Research,
Strategy and the dashboard have shipped; a founder can now be told to record an
outcome, and then is handed an empty form and asked to work out what it meant.

That empty form is the weakest point in the loop. `mvp.md` §10 names the failure
signal it produces: *"Nobody returns with an outcome → loop too slow or low value."* A
founder who records a number and gets nothing back has done data entry, not growth
work — and §2 promises the opposite: *"gets a learning that improves the next
decision."*

This closes the loop AUREA exists to prove.

## 2. Scope

One agent, one tool, one accept route, one migration, one dashboard stage row, one web
panel.

Explicitly **not** in this spec:

- **Analytics integrations.** `mvp.md` §7 makes GA4/PostHog optional and non-blocking.
  Outcomes are entered by hand, and this agent reads what was entered.
- **Learning → Knowledge promotion.** `phase-10-growth-loop.md` §2.4 promotes validated
  learning into `KnowledgeDocument`; `mvp.md` §6 defers the knowledge entities. A
  validated learning stays a `Learning`.
- **Editing the draft before accepting.** See §3.4.
- **Statistical significance.** One experiment, one metric, no control group. Anything
  claiming significance here would be theatre.

## 3. Decisions

### 3.1 The agent interprets; it never adjudicates

This is the decision the whole design turns on, and it is constrained by a ruling
already made. `docs/superpowers/plans/2026-07-28-outcome-learning.md` froze the
measurement contract:

> **No stored success verdict.** Deliberate. `successCriteria` is free text; deriving
> "successful" from it would be invention, and deriving it from completion is what §14
> forbids. Show the number against the target and let the human write the learning.

And `docs/domains/experiments.md` §14, restated in that plan's constraint table:
*"completing an experiment must not imply success anywhere in the UI."*

So the agent may describe, explain and draft. It may not rule. The enforcement is
**structural, not editorial**: the output schema has no verdict field, no `met`
boolean, no score. There is nothing for a later screen to render, so no later screen
can accidentally render one. A prompt instruction would have been a request; a missing
field is a guarantee.

`successCriteria` is still passed to the model. It is what the experiment was for, and
prose may reason about it — but there is nowhere to record a ruling on it.

**Amendment, final whole-branch review.** The schema still has no verdict *field* —
that guarantee is unchanged. But `reading`, `drivers`, `caveats` and
`learning.statement`/`title` are unconstrained strings, rendered verbatim and persisted
into `Learning` on accept, and the three structural checks above (unknown key at the
top level, unknown key inside `learning`, `VERIFIED` confidence) only reject unknown
*keys* — none of them reads the words inside a string. A model can write `reading:
"This experiment was a success"` and pass every one of them. `interpret-outcome.ts` now
adds a `superRefine` to each of those fields that rejects prose matching a small set of
verdict words (success/successful/succeeded/fail/failed/failure/worked/didn't work).
This is deliberately narrower than the structural guarantee: it is a content check, not
an absent field, so it can be fooled by phrasing the guard's regex does not anticipate.
It is the same order of guarantee as the system prompt's own instruction not to rule —
fallible — but checked in code instead of trusted to the model, and it runs inside the
runner's existing guardrail retry loop, so a first offence self-corrects rather than
failing the run.

The frozen phrase says *let the human write the learning*. This spec changes that to
*let the human rule on the learning*: AUREA drafts, the founder validates, rejects or
replaces. `Learning`'s lifecycle was built for exactly this — `create-learning`'s
repository hard-codes `status: CANDIDATE` with the comment *"Always a candidate.
Validation is a separate, human act."* Nothing in this spec relaxes that, and
`mvp.md` §4 anticipated it by naming the agent's job as *propose a learning candidate*.

### 3.2 The agent

```text
taskType:       interpret-outcome
agentType:      outcome-analyst
tier:           TIER2
credits:        2
requiresSearch: false
input:          { experimentId }
```

TIER2 matches `propose-strategies`: reading numbers against a hypothesis is reasoning,
not summarising. Two credits sits between `summarize-business-context` (1) and
`propose-strategies` (3) on the effort anchor `operation-cost.ts` documents — one model
call over one experiment, no web search.

**Output:**

```ts
{
  reading:  string,        // max 1500. what the numbers show vs baseline and target
  drivers:  string[],      // 1-3 entries, max 500 each, stated as plausible
  caveats:  string[],      // 0-3 entries, max 500 each, reasons to distrust the signal
  learning: {
    title:      string,    // max 200
    statement:  string,    // max 1000
    evidence:   string[],  // 1-5 entries, max 300 each; each cites a number or
                           // a date the tool returned
    confidence: 'LOW' | 'MEDIUM' | 'HIGH',
  },
}
```

Bounds follow `propose-strategies`' conventions. They are not cosmetic: `title` and
`statement` land in `Learning` columns that carry no length limit of their own, so the
agent's schema is the only thing standing between a runaway generation and a row no UI
can render.

`confidence` deliberately omits `VERIFIED`, which the `ConfidenceLevel` enum offers.
One experiment does not verify anything, and a model claiming it would be the same
invention §3.1 refuses.

The system prompt forbids "successful", "failed", "worked" and "didn't work" as
characterisations of the experiment, and requires every number in `evidence` to appear
in the tool's response. Both are prompt-level and therefore fallible, so both get a
test with a stubbed model that tries anyway.

**`drivers` is the field most likely to invent.** The model sees one experiment's
numbers and no attribution data, so "the gain concentrated in the first week" is honest
only if the outcomes carry dates that show it. The prompt binds drivers to what the
tool returned; this is the field to watch in the first real runs, and the reason
`caveats` exists as a sibling rather than an afterthought.

### 3.3 The tool

One new tool, `get_experiment_result`, following `get_growth_context`'s rule exactly:
**the experiment id comes from the run's input, never from the model's arguments.**
Content injected into the context cannot reach another workspace's experiment.

It returns the experiment's `metric`, `baselineValue`, `targetValue`,
`successCriteria`, `startDate`, `endDate`; its hypothesis (`statement`,
`expectedOutcome`, `targetMetric`); its strategy's name; its goal; and every `Outcome`
ordered by `observedAt`. All scoped to `ctx.tenant.workspaceId`.

### 3.4 Accepting the draft

**Migration** `20260730000000_learning_source_run`, shaped after
`20260729123445_strategy_source_proposal`:

```sql
ALTER TABLE "Learning" ADD COLUMN "sourceAgentRunId" TEXT;
CREATE UNIQUE INDEX "Learning_sourceAgentRunId_key" ON "Learning"("sourceAgentRunId");
```

Nullable, so every existing learning stays valid and hand-written ones keep `null`.
Postgres treats `NULL`s as distinct in a unique index, so any number of manual
learnings coexist while each run is acceptable exactly once.

The column buys two things. Provenance — a founder can tell which learnings AUREA
drafted, which `CLAUDE.md` principle 7 asks for. And **idempotency** — the unique
constraint is what stops a double-click creating two identical learnings.

**Route** `POST /learnings/from-run`, body `{ agentRunId }`. Mirrors
`/strategies/from-proposal` rather than nesting under the experiment: the run already
names its experiment, so a pair in the URL would only be a second thing to validate.

The service is `create-from-proposal.service.ts` with the nouns changed, and reuses its
hardest-won piece verbatim — the `P2002` translation. That file carries a comment
recording that Postgres reports a unique-violation target three ways (a column-name
array, a bare index name, or a single-element array) and that an earlier version
checking only `Array.isArray` let two of them escape as a 500. The constraint here is
named `Learning_sourceAgentRunId_key`, so the same substring predicate on
`sourceAgentRunId` covers all three. A second accept is a 400, not a 500 and not a
duplicate.

Refusals before insert, each distinct:

- run not found in this workspace → 404
- `taskType !== 'interpret-outcome'` → 400
- `status !== 'COMPLETED'` → 400
- run `output` no longer parses against the agent's `outputSchema` → 400, rather than
  half-reading a run that predates a schema change
- `experimentId` is read from the **run's input**, never from the request body

The created row takes `title`, `statement` and `confidence` from the draft, and
`status: CANDIDATE` from the repository's own hard-coded default. `evidence` is a Json
column and stores exactly:

```ts
{ points: string[], reading: string, caveats: string[] }
```

— the draft's evidence strings, plus the reading and the caveats, so a validated
learning still carries why AUREA thought so. Hand-written learnings keep whatever
`evidence` the existing form sends; nothing here changes that path.

**The founder cannot edit the draft on the way in.** Accept creates it verbatim;
editing happens afterwards through the existing learning routes, or they dismiss it and
write their own. An edit-before-accept path would mean the accept route trusting body
content over run output — exactly the hole the id-from-input rule closes.

### 3.5 The dashboard offers the agent, and stops offering the form

The `LEARN` stage's next action changes from `WRITE_LEARNING` to a new
`INTERPRET_OUTCOME`, routing to the experiment detail page. One row of the stage table
in `2026-07-29-dashboard-design.md` §3.2, one enum member, one route-map entry, three
locale strings. The route map is total over the kind union, so the compiler names every
site that must change.

`WRITE_LEARNING` is **replaced, not kept alongside**. Keeping both would require the
stage machine to ask "has a completed interpret run already happened for this
experiment", and `AgentRun` has no `experimentId` column — it lives inside the `input`
JSON, so that question costs a Postgres JSON-path query to pick a label.

The cost of replacing, stated plainly: **a founder out of credits sees a dashboard
offering an action they cannot afford.** The dashboard reads no credit balance. They
are not stuck — the run refuses with the existing insufficient-credits error, and the
manual form sits on the same page — but the next-action card will have pointed them at
a paywall. Accepted for the MVP; revisit if design partners hit it.

### 3.6 Refusing before charging

Two gates at run creation, following `SearchNotConfiguredError` at
`create-agent-run.service.ts:48`:

- experiment not `COMPLETED` → refuse. Nothing final to interpret.
- zero outcomes → refuse. There is no measurement.

Both refuse at creation rather than inside the agent, so the founder is never charged
for a run with nothing to read. This is the part that costs the customer real money if
it is wrong, and it is tested as such.

## 4. Web

`OutcomeInterpretation`, on the experiment detail page, built on `ResearchPanel`'s
shape — run→poll→recover is already solved there, including the stale-index recovery
this codebase fixed once already.

- A run button labelled with the 2-credit cost.
- The reading as prose; drivers and caveats as lists.
- The draft learning in a card with **Accept** and **Dismiss**, plus a plain link —
  *"or write it yourself"* — to the `LearningsSection` form directly below.
- Dismiss is client-side only. Nothing is written; the run stays readable in its
  history.

Copy in EN, PT and ES. `dashboard-keys.test.ts` derives its enum lists from the
generated constants, so `INTERPRET_OUTCOME` is picked up without anyone remembering.

## 5. Testing

| Layer | What it pins |
|---|---|
| Tool | Returns only this workspace's experiment; a foreign `experimentId` in the run input is not-found, never another tenant's row |
| Agent | Stubbed model: missing field refused; unknown field refused; **an `evidence` entry citing a number absent from the tool response refused** |
| Refusals | Experiment not `COMPLETED`, and zero outcomes — both asserted to refuse **before** any credit is debited |
| Accept route | Happy path; second accept → 400, no duplicate row; wrong `taskType`; run not `COMPLETED`; run from another workspace; output that no longer parses |
| Dashboard | The `LEARN` row yields `INTERPRET_OUTCOME`; the transition-legality test still passes |
| Web | Panel states (idle, running, failed, complete); accept calls the route once; dismiss writes nothing |

The invention guard is the test worth reading closely — it is the only thing standing
between a plausible sentence and a fabricated one.

## 6. Exit criteria

- A completed experiment with at least one outcome can be interpreted, and the run
  costs 2 credits.
- An experiment that is not `COMPLETED`, or has no outcomes, refuses **before** a
  credit is charged.
- The output contains no success verdict, and no field in which one could be stored.
- Every number in the draft's evidence appears in the tool's response.
- Accepting creates one `Learning` with `status: CANDIDATE` and `sourceAgentRunId` set.
- Accepting the same run twice returns 400 and leaves exactly one row.
- A hand-written learning still saves, with `sourceAgentRunId` null, and several can
  coexist.
- The dashboard's `LEARN` stage offers `INTERPRET_OUTCOME`, with copy in all three
  locales.
- Dismissing writes nothing.

## 7. Known drift and accepted costs

- The frozen phrase *"let the human write the learning"* becomes *"let the human rule
  on the learning"* (§3.1). Recorded here rather than edited into the older plan, which
  is a historical record of what was built then.
- A founder without credits is offered an action they cannot take (§3.5).
- **Dismissing re-offers the paid action.** Dismiss writes nothing, so no `Learning`
  exists, so the stage stays `LEARN` and the dashboard again says "let AUREA read the
  result" — at 2 more credits. The escape is real but unadvertised: writing the
  learning by hand creates a `CANDIDATE` and moves the stage to `VALIDATE`. Accepted
  for the MVP because the alternative is either persisting a dismissal (a new column
  for a UI preference) or having the dashboard query runs by JSON path, which §3.5
  already declined for the same reason. Watch whether design partners dismiss at all —
  if they do, this is the first thing to fix.
- `drivers` is the field most exposed to invention (§3.2).
- No significance testing, and none claimed (§2).
