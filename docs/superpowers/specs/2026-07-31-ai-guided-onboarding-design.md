# AI-Guided Onboarding — Design

**Status:** approved for planning
**Date:** 2026-07-31
**Scope:** spec 2 of 2. Composes `2026-07-30-ai-assisted-forms-design.md` and adds no agent.

---

## 1. Why

`docs/development/mvp.md` §3 draws the onboarding as one chain, from business context through to a runnable experiment. Spec 1 built the AI that fills each form in that chain. What it did not build is the chain: today a founder fills a form, lands back on a list page, and has to work out for themselves what comes next.

The home page already carries most of the parts — a five-step `SetupChecklist` and a next-action card whose route is resolved by `nextActionRoute` over seventeen action kinds. They are just not assembled into a flow anyone can feel they are inside of.

This spec assembles them.

---

## 2. Scope

### In

One layout route, an extension of the dashboard's setup contract from five steps to eight, and two new next-action kinds.

### Out, and why

**Any new agent.** The seven filling agents from spec 1 cover every step that has AI. This spec calls them through the pages that already call them.

**Any new write route.** Each step saves through the route it already used. There is nothing to persist about being partway through — see §5.

**A progress table.** Progress *is* the data. A row saying "this founder reached step 4" would be a second source of truth that drifts from the first the moment anything is deleted.

**Integrations, diagnosis, opportunities.** The product direction that arrived on 2026-07-31 — GA4, Stripe and paid-media connectors feeding a metric time series — is a separate and larger body of work. This spec deliberately does not anticipate it. What it does do is leave the founder-answers path intact, which is what that work will later narrow rather than replace.

---

## 3. The shell

`/app/onboarding/:step` is a layout route. The frame renders around the page component that already exists for that step; the page itself is untouched and unaware. `IcpNewPage` inside the guide is literally `IcpNewPage`.

`/app/onboarding` with no step redirects to the first step the server reports as not done.

**No form is duplicated.** That is the whole reason this shape was chosen over a self-contained wizard: eight forms copied into a wizard is eight forms that drift from the ones on the normal routes, and every field added later has to be added twice.

### The frame

- A row of eight nodes across the top, each done / current / todo.
- `X de 8`, and the estimated credit cost of the AI steps still ahead — the sum of `creditCost(taskType)` over the steps not yet done.
- A footer: "sair do guia" on the left, "Próximo →" on the right.

### Advancing

**"Próximo" is always enabled.** It moves to the next step whether or not the current one was completed. A gate here was considered and rejected during spec 1's brainstorm for the same reason: a founder who wants to look ahead should be able to, and a disabled button with no way forward is where onboarding flows lose people.

What replaces the gate is a warning. On arriving at a step with earlier ones still undone, the frame names them and says what is lost — *"Você pulou: contexto do negócio. A IA propõe menos sem ele."* It informs; it does not block.

**"Sair do guia"** returns to `/app`. Nothing is lost, because nothing was being held: the founder's work is already saved by the step's own save button, and the guide's position is recomputed from the data on the next visit.

---

## 4. The eight steps

| # | Step | Done when | Page |
|---|---|---|---|
| 1 | Negócio | a `Business` exists | `/app/business/setup` |
| 2 | Contexto | at least 3 context sections are filled | `/app/business` |
| 3 | Cliente ideal | an `Icp` exists | `/app/icps/new` |
| 4 | Objetivo | a `Goal` in `DRAFT` or `ACTIVE` exists | `/app/goals/new` |
| 5 | Pesquisa | a `COMPLETED` research run exists | `/app/research` |
| 6 | Estratégia | a `Strategy` exists | `/app/strategies` |
| 7 | Hipótese | a `Hypothesis` exists | `/app/strategies/:id` |
| 8 | Experimento | an `Experiment` exists | `/app/experiments/new` |

Steps 2, 7 and 8 are new to the checklist. Steps 1, 3, 4, 5 and 6 are the five that already exist, in the same order and with the same rules — including the two corrected on 2026-07-30: a goal counts only while it is `DRAFT` or `ACTIVE`, and a research run counts only when it `COMPLETED`.

The three-section bar on step 2 is the same threshold `propose-icp`'s `precheck` applies before it will draft an ICP. One number, one meaning: the guide cannot say a step is done while the agent behind the next step refuses for want of it.

---

## 5. What changes on the server

`DashboardSetup` grows from five flags to eight — `context`, `hypothesis` and `experiment` join — and `total` becomes 8. `DashboardSnapshot` gains `contextSectionCount`, `hypothesisCount` and `experimentCount`, filled by the same parallel read that already fills the rest.

Two new `NextActionKind` members: `FILL_CONTEXT` and `CREATE_HYPOTHESIS`. The remaining six steps reuse the kinds that exist.

### The hand-off to the loop moves one layer earlier

Today the setup gate closes at strategy, and the loop takes over with `DESIGN_EXPERIMENT` as its first move when no experiment exists. Making "experimento" the eighth setup step means the gate closes when an experiment exists instead — which is exactly when `spine !== null`.

The founder sees the same next action either way. What changes is which layer decides it. This is worth stating plainly because it looks like a behaviour change in a diff and is not one: `resolveDashboardState` reaches `resolveLoop` only once a spine exists, and `resolveLoop`'s first branch — the one for a null spine — becomes unreachable. It stays in the code as the defensive branch it already is.

`isSetupComplete` follows the same eight steps. Every reader of it is asking "is this founder past onboarding", and after this spec that question includes having a first experiment.

---

## 6. The home page

`SetupChecklist` renders eight rows instead of five, from the same `setup` object. It is the only consumer, so there is no second list to keep in step.

This closes a gap the founder could previously fall into: a workspace could report `5 de 5` with no business context ever filled, because context was never one of the five. The count is now over the eight things the product actually needs before its loop can turn.

---

## 7. Testing

**Backend**

- Each new flag against its own counter, including the boundary on step 2 — two filled sections is not done, three is.
- `total` is 8, and `completed` counts what is true.
- The setup gate reports the earliest incomplete step, with the three new ones in their positions.
- `isSetupComplete` is false until an experiment exists.
- `FILL_CONTEXT` and `CREATE_HYPOTHESIS` resolve to their steps.

**Web**

- `/app/onboarding` redirects to the first step the server reports undone.
- "Próximo" advances from an incomplete step.
- The warning names exactly the earlier steps that are undone, and appears only when there are some.
- "Sair do guia" returns to `/app`.
- The credit estimate counts only the AI steps still ahead.
- `nextActionRoute` stays total over the widened kind enum — the existing exhaustiveness test covers this and must be extended with the two new kinds.
- Three locales, no raw key paths.

---

## 8. Exit criteria

1. A founder can start at `/app/onboarding` with an empty workspace and reach a runnable experiment without ever navigating by hand.
2. Reloading mid-flow returns to the same step, computed from data alone.
3. The home checklist and the guide report the same eight steps from the same source.
4. No form component exists in two places.
5. `pnpm test` and `pnpm typecheck` are green in both repos.

---

## 9. Cost

The guided path spends **20 credits**: `propose-business-profile` 2, `propose-business-context` 5, `propose-icp` 1, `propose-goal` 1, `research-growth-context` 5, `propose-strategies` 3, `propose-hypothesis` 1, `propose-experiment` 2. The trial grants 50.

Every one of those is optional. A founder who types everything themselves spends nothing and reaches the same eighth step.
