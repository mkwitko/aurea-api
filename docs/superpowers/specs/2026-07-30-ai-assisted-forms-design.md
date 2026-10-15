# AI-Assisted Form Filling — Design

**Status:** approved for planning
**Date:** 2026-07-30
**Scope:** spec 1 of 2. Spec 2 (`ai-guided-onboarding`) composes this one and adds nothing to the agent layer.

---

## 1. Why

`docs/development/mvp.md` §3 draws the onboarding as:

```text
Business Context   (guided, research-assisted)
      ↓
ICP                (proposed by AUREA, edited by user)
```

§4 In Scope, line 78: `Business context capture (assisted by research).`

`docs/product/gtm.md` §5 closes the same flow with: *"Every step should reduce effort by proposing, not asking blank questions. Context over prompts."*

None of it was built. Business context, ICP, goal, hypothesis and experiment are blank forms today. The AI in the product starts only after a goal exists (research, strategies) and after an outcome exists (interpret). The onboarding — the part that decides whether a founder ever reaches activation — is the part with no AI in it.

`web/.claude/skills/aurea-frontend/references/UX_PRINCIPLES.md` §3 states the rule this spec implements: *"A blank required field is a last resort, not a default. Prefer: proposal → edit → confirm."*

This spec closes that gap for every form in the product that can honestly be pre-filled.

---

## 2. Scope

### In

Seven new agents, one shared output contract, one shared panel component, and a "generate with AI" affordance on the forms that already exist.

| Form | Route | Agent |
|---|---|---|
| Business | `/app/business/setup` | `propose-business-profile` |
| Business context, all sections | `/app/business` | `propose-business-context` |
| Business context, one section | `/app/business/context/:section` | `propose-context-section` |
| ICP | `/app/icps/new` | `propose-icp` |
| Goal | `/app/goals/new` | `propose-goal` |
| Hypothesis | `/app/strategies/:id` | `propose-hypothesis` |
| Experiment | `/app/experiments/new` | `propose-experiment` |

### Out, and why

**Outcome** (`OutcomesSection`). An outcome is a measurement of the real world. An AI that writes the result and then interprets its own result turns the learning loop into fiction. `docs/domains/experiments.md` §14 already forbids deriving a result from a conclusion, and `interpret-outcome`'s `verifyEvidence` exists precisely to stop invented numbers. This is a rule, not an omission.

**Strategy** and **Learning** already have their agents (`propose-strategies`, `interpret-outcome`). Untouched.

**Context sections `projects` and `campaigns`.** Both are entirely internal record-keeping — a project's name, budget, owner and objectives exist nowhere outside the company. There is nothing to propose and nothing worth asking in a proposal flow. Seven of the nine sections get the button; these two keep the plain form. Building a generator for them would be a button that always returns an empty proposal.

**The guided onboarding wizard** (`/app/onboarding`) — spec 2.

**Refunding credits for provider-side run failures.** Credit is debited at enqueue, so a run that dies on a provider error has already charged. That is the behaviour all four existing agents have; this spec inherits it rather than changing it. Worth a separate decision.

---

## 3. The output contract

Every filling agent returns the same shape. One contract, seven agents — no agent invents mechanics.

```ts
{
  filled: { /* a subset of the target entity's schema */ },
  questions: [{
    id: string,            // stable within the run
    ask: string,           // founder Portuguese/English, no jargon
    why: string,           // what this answer unlocks
    answerType: 'text' | 'number' | 'currency' | 'percent' | 'count' | 'choice',
    choices?: string[],    // required iff answerType === 'choice'
    fills: FieldPath,      // CLOSED ENUM per entity, never a free string
    impact: 1 | 2 | 3,     // 3 = ask first
  }],
  confidence: 'LOW' | 'MEDIUM' | 'HIGH',
}
```

Both objects are `.strict()`. An unknown key fails the whole result, the runner feeds the rejection back as a message, and the model corrects itself within `budget.maxModelCalls` — the same self-correcting loop `interpret-outcome` relies on. This is why `.strict()` and not bare `z.object`: bare `z.object` silently strips, which would turn a model that invents a field into a model that appears to comply.

### `fills` is the security-sensitive field

`fills` is a write target chosen by the model. It is a `z.enum` generated from the target entity's schema, one enum per agent. The model does not choose where to write; it chooses among destinations the schema already knows. A `fills` outside the enum fails the parse and re-enters the retry loop.

The blast radius is bounded anyway — nothing here writes to the database, the panel writes into a React form — but a model that can name an arbitrary field path is a model that can put a number where a string belongs and break the form's own validation. The enum is what makes the panel's `setValue` safe to call without a second validation layer.

The enum excludes derived fields. A model must not be able to ask *"what is your ARR?"* — that is a number the formula owns, and asking for it invites an answer that contradicts `mrr × 12`. Derived fields appear in neither `filled` nor `fills`; the same `z.enum` omission covers both.

### `questions` is capped at 6

Not because six is special, but because an unbounded list re-creates the blank form it replaces. The agent chooses which gaps are worth a founder's attention and ranks them by `impact`. A field that is neither filled nor asked simply stays empty — that is a legitimate outcome, not a failure.

### `confidence` excludes VERIFIED

Same reasoning as `interpret-outcome`: the Prisma `ConfidenceLevel` enum offers `VERIFIED`, and a proposal from one model call verifies nothing.

---

## 4. Three classes of field

This is not documentation taxonomy. It is the decision the agent makes per field and the state the form renders.

| Class | Filled by | Appears in |
|---|---|---|
| **Researchable** | the model, from the site and the web | `filled` |
| **Founder-only** | nobody — becomes a question | `questions` |
| **Derived** | a pure TypeScript formula | neither |

A fourth, smaller case: **system-generated**. `productSchema.id`, `projectSchema.id`, `campaignSchema.id` and `projectObjectiveSchema.id` are required strings. The agent never emits them — it returns array entries without `id`, and the client assigns ids before `setValue`. A model inventing ids is a model producing collisions the form cannot detect.

### The classification, per section

Written out because the implementer cannot derive it and guessing it wrong is invisible in tests.

**`companyProfile`** — researchable: `logoUrl`, `foundedYear`, `mission`, `vision`, `values`, `brandVoice`, `fundingStage`, `headquarters`, `employeeCount`. Excluded from both `filled` and `fills`: `documentUrls` — these are uploads, so the agent neither proposes a URL the user did not provide nor asks for one in a text box.

**`products`** — researchable: `name`, `description`, `targetAudience`, `differentiator`, `pricingModel`, `pricePoint`, `status`. System-generated: `id`.

**`competitiveLandscape`** — researchable: all of `competitors[]`, `ourDifferentiator`, `marketPosition`, `competitiveAdvantages`, `threatsFromCompetitors`.

**`marketContext`** — researchable: `trends`, `opportunities`, `threats`, `maturity`, `marketGrowthRate`, `tam`. Founder-only: `sam`, `som` — both depend on the company's own reach and channel access, and a model that estimates them is guessing with a number's authority.

**`constraints`** — researchable: `regulatoryConstraints` (from industry and geography). Founder-only: `monthlyGrowthBudget`, `teamSize`, `growthTeamSize`, `urgency`, `technicalCapabilities`, `limitations`.

**`currentPerformance`** — the section that motivates the whole design. Twelve fields, zero researchable.
- Derived: `arr`, `cac`, `ltv`, `ltvCacRatio`
- Founder-only: `mrr`, `totalCustomers`, `activeCustomers`, `churnRate`, `monthlySignups`, `conversionRate`, `timeToConvert`, `channels`, `baselineDate`

With the 6-question cap and `impact` ordering, a founder answers roughly four questions and four more fields fill themselves. That ratio is the product promise of this spec.

**`currentActivities`** — researchable: `activeChannels`, `partnerships`, `paidAdvertising.platforms`. Founder-only: `contentProduction.*`, `paidAdvertising.monthlySpend`.

### Derived fields are forbidden in `filled`

A `superRefine` on each agent's output schema rejects a derived field appearing in `filled`. Not a prompt instruction — a schema rule, so the retry loop enforces it.

Two reasons. Models are unreliable at arithmetic, and this is arithmetic on the founder's own money. And a computation the user can see (`R$ 18.000 ÷ 15 clientes`) is checkable; one the model asserted is not.

### The formulas

Pure functions, own module, one unit test each.

```ts
arr          = mrr * 12
cac          = currentActivities.paidAdvertising.monthlySpend / monthlySignups
ltv          = (mrr / activeCustomers) / churnRate
ltvCacRatio  = ltv / cac
```

`cac` and `ltv` read across sections — `cac` needs `currentActivities`, `ltv` needs two `currentPerformance` fields. The derivation module takes the whole `BusinessContextData`, not one section, and recomputes every derivable field whenever any input changes.

Every formula returns `undefined` — leaving the field empty — when any input is missing or when a divisor is zero. `churnRate: 0` is a real answer a founder can give, and it must produce an empty LTV, never `Infinity`. This is the test that matters most in the module.

A derived field the user types over breaks its link to the formula and stays as typed. The form is the source of truth; the formula is a convenience.

---

## 5. The seven agents

All TIER2. All `.strict()`. All carry `precheck`. Entity ids come from the run's `input`; the tool filters on `workspaceId` and never accepts an id from the model's arguments.

| taskType | reads | search | precheck refuses when | credits |
|---|---|---|---|---|
| `propose-business-profile` | the Business `website` | yes | `website` is empty | 2 |
| `propose-business-context` | Business + web | yes | Business not found | 5 |
| `propose-context-section` | Business + stored context | no | section unknown or not proposable | 1 |
| `propose-icp` | context | no | fewer than 3 context sections filled | 1 |
| `propose-goal` | context + ICP | no | no ACTIVE ICP in the workspace | 1 |
| `propose-hypothesis` | the chosen strategy | no | strategy not in a selected state | 1 |
| `propose-experiment` | the hypothesis | no | hypothesis not found | 2 |

### Why two task types for business context

`creditCost()` takes only a `taskType`. A single type whose price changed with the request would make the published operation catalog a lie. So: `propose-business-context` (5 credits, Tavily, fills all seven proposable sections in one run, used by the "fill everything" button and by spec 2's wizard) and `propose-context-section` (1 credit, no search, one section, used by the per-section button). The per-section version reads what the full run already stored, so re-running one section costs a fifth of re-running everything.

### `propose-business-profile` fills six of eight fields

`Business` has `name`, `website`, `description`, `industry`, `businessModel`, `revenueModel`, `valueProposition`, `positioning`. Only `name` and `website` are genuinely the user's. The other six come off the site. This is the product's first magic moment and the only step in the chain that depends on nothing before it — paste a URL, get six fields.

### Tools

`get-business-context` already exists and serves three agents. Two new ones, same shape as every existing tool — empty `argsSchema`, id captured in the factory, tenant-scoped read:

- `get-icp(icpId)`
- `get-hypothesis(hypothesisId)`

`propose-business-profile` and `propose-business-context` also use the existing web-search tool that `research-growth-context` uses.

### Prompt-injection posture

Everything a tool returns is data, not instructions — the system prompt says so, matching the existing agents. Website content is attacker-controllable in a way no other tool result in this system is: a founder pastes a URL, and the page behind it can contain text aimed at the model. The two searching agents state the rule explicitly and the `.strict()` + `fills`-enum contract is what makes a compromised model's output unusable rather than merely wrong.

---

## 6. Where the proposal lands

The run returns, the client fills the form that already exists, the user edits, the user saves through the normal `POST`/`PUT`. **No new write route for any of the seven agents.**

Consequence, and the one addition to an existing contract: saving through `PUT /business/context/section` writes `BusinessContextVersion.source = USER`, so AI provenance would be lost. The body gains an optional `sourceAgentRunId`; when present, the version records `source = AI` and the run id. The Prisma column and the `AI` enum member already exist and were never fed. Not a new route — one optional field on a route that already exists.

Nothing is persisted without the user pressing Save. A proposal the user abandons costs the credit already spent and leaves no trace, which is the honest trade for not building a draft store.

---

## 7. The panel

One component, `AiFillPanel`, used by all seven forms. It takes the contract and a `setValue` from `react-hook-form`.

**One question at a time**, ordered by `impact` descending. The input is chosen by `answerType`, reusing the primitives that already exist: `currency`/`number`/`count`/`percent` → `NumberField`, `choice` → `SelectField`, `text` → `TextField`.

Three exits, always available:

- **Answer** → `setValue(fills, value)`, mark the field AI-filled, recompute every dependent derived field, advance
- **Don't know** → field stays empty, advance, never asked again this run
- **Skip** → field stays empty, advance, returns to the back of the queue

Nothing blocks Save. Partial save is legitimate and the existing `PUT` already accepts an incomplete section.

### Field states in the form

Three visually distinct states, because they mean different things:

- **`✨` AI-filled** — editable; editing clears the marker
- **`=` derived** — shows the arithmetic beneath it (`R$ 18.000 ÷ 15 clientes`); typing over it breaks the link to the formula
- **active** — the field the panel is currently asking about

`Help` stays on every domain term. `UX_PRINCIPLES.md` §1 names CAC and MRR explicitly as terms requiring it. The panel asking in plain language is the "propose, don't ask" half; `Help` is the "explain in-app" half. Both, on the same field.

### The disabled button

When `precheck` would refuse, the button does not enable, and the microcopy says what is missing and where to go — *"AUREA precisa do contexto do negócio para propor um ICP."* with a link to the context. The client decides this from data already on screen (does a context exist? an ICP?); no extra request. The server's `precheck` is the safety net, not the source of the UI state.

---

## 8. Refuse before charging

`precheck` runs in `create-agent-run.service.ts` before `hashInput`, before the repository write, and before enqueue — therefore before `authorizeAndCharge` in the worker. The hook already exists; these seven agents are its second through eighth users.

This is the part that costs the customer money if it is wrong, so it gets a test per agent, not a shared one.

New catalogued errors, continuing from `AUR-T0028`:

| code | constant | status |
|---|---|---|
| `AUR-T0029` | `BUSINESS_WEBSITE_REQUIRED` | 400 |
| `AUR-T0030` | `BUSINESS_CONTEXT_TOO_EMPTY` | 400 |
| `AUR-T0031` | `NO_ACTIVE_ICP` | 400 |
| `AUR-T0032` | `STRATEGY_NOT_SELECTED` | 400 |
| `AUR-T0033` | `SECTION_NOT_PROPOSABLE` | 400 |

`AUR-T0033` covers both an unknown section name and the two sections with nothing to propose (`projects`, `campaigns`).

Hypothesis-not-found and ICP-not-found use the existing `NotFoundError`.

---

## 9. Credits

Priced on the existing anchor in `operation-cost.ts` — perceived effort, not token cost, with a composite action costing the sum of its parts. Reference points already in the table: `research-growth-context` 5 (with search), `propose-strategies` 3, `interpret-outcome` 2, `summarize-business-context` 1.

| taskType | credits |
|---|---|
| `propose-business-profile` | 2 |
| `propose-business-context` | 5 |
| `propose-context-section` | 1 |
| `propose-icp` | 1 |
| `propose-goal` | 1 |
| `propose-hypothesis` | 1 |
| `propose-experiment` | 2 |

A founder filling every form once, without the wizard: 2 + 5 + 1 + 1 + 1 + 2 = **12 credits**. The trial grants 50; STARTER grants 200/month.

A missing entry in `CREDITS_BY_TASK` throws `UnknownOperationCostError` — a free run in production is the failure this guards, and seven new task types is seven chances to forget.

---

## 10. Testing

### Backend, per agent

- `.strict()` rejects an unknown key at both levels
- a `fills` value outside the entity's enum fails the parse
- a derived field inside `filled` fails the parse
- `precheck` refuses before any charge, for each refusal condition
- the tool filters on `workspaceId` and ignores any id in the model's arguments
- `creditCost(taskType)` returns the published number

### Derivation module

One test per formula, plus the cases that matter more than the happy path:

- `churnRate: 0` → `ltv` undefined, never `Infinity`
- `monthlySignups: 0` → `cac` undefined
- any missing input → the derived field stays empty
- changing one input recomputes every dependent field, transitively (`mrr` changes → `ltv` changes → `ltvCacRatio` changes)

### Web

- the panel presents one question at a time, in `impact` order
- "don't know" and "skip" behave differently — one is permanent for the run, one requeues
- an answer reaches the form through `setValue` and the derived fields update
- the button is disabled with the correct microcopy for each missing prerequisite
- three locales, no raw key paths rendered

---

## 11. Exit criteria

1. Every form in §2's table has a working "generate with AI" that pre-fills and asks.
2. `grep` finds no derived field name inside any agent's `filled` fixture.
3. `precheck` refuses, without a debit, for all five new error conditions.
4. A `PUT /business/context/section` carrying `sourceAgentRunId` records `source = AI`.
5. `operationCatalog()` publishes all seven new task types.
6. The full suite is green in both repos and `tsc` is clean.

---

## 12. What spec 2 adds

`/app/onboarding` chains these agents into one guided flow: Business → Context → ICP → Goal → Research → Strategy (user picks one of three) → Hypothesis → Experiment, ending with a runnable experiment — the flow `gtm.md` §5 and `mvp.md` §3 draw, and the 7-day activation `metrics.md` §5 targets.

It introduces no new agent and no new progress table: each step saves through the normal route as it completes, so progress *is* the data, and resuming is the computation `GET /dashboard` already performs for the next-action card.

Total cost of the guided path, including the two existing agents it invokes: **20 credits**.
