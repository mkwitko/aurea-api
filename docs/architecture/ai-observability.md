# AI Observability

## 1. Purpose

Every agent run does real work — it spends money and produces a decision the rest of the system may act on. When a run comes back wrong, slow, or expensive, the only honest way to answer "what happened" is to look at what was actually sent to and received from the model, in the order it happened, with real timing.

This document describes how AUREA traces agent runs with Langfuse: what a trace looks like, how a run maps to it, how cost gets there, and the invariant that makes all of this safe to run in production.

Tracing is visibility. It is not part of the run's critical path. A run's status, its credit ledger, and its output must never depend on whether tracing succeeded.

---

## 2. Trace and span shape

One Langfuse trace is created per agent run, named by the run's `taskType` (e.g. `propose-goal`, `summarize-business-context`).

```text
trace: <taskType>
  │
  ├─ span: authorize                (instant — policy decision)
  │
  ├─ generation: model-call          (timed)
  │   ├─ span: tool-call             (timed, child of the model call that requested it)
  │   ├─ span: tool-call
  │   └─ span: escalate-tier         (instant — only on tier escalation)
  │
  ├─ generation: model-call          (timed — next iteration / retry)
  │   └─ span: tool-call
  │
  ├─ span: guardrail-rejection       (instant — malformed model output)
  └─ span: verify-output-rejection   (instant — output failed verifyOutput)
```

Two kinds of span exist, matching two kinds of fact:

- **Timed spans** (`trace.startSpan(...)` / `span.child(...)`) open before the work starts and close after it ends, so their duration in Langfuse is the real duration of the work — not ~0ms. `model-call` (a `generation`) and `tool-call` (a `tool`) are timed.
- **Instant spans** (`trace.span(...)`) record something that has no duration of its own — a decision, a rejection, an escalation. `authorize`, `escalate-tier`, `guardrail-rejection`, and `verify-output-rejection` are instant.

Nesting is real: a `tool-call` span is created as a **child of the `model-call` span that requested it** (`modelSpan.child('tool-call', ...)`), not of the trace root. This is what lets the Langfuse UI show, for a given model call, exactly which tool calls it triggered and how long each one took — instead of a flat list of everything that happened during the run.

A rejected `submit_answer` call (the synthetic tool agents use to submit their final answer) also gets a `tool-call` child span under the model call that attempted it, even though it has no `tool.execute` to time — a rejected submission is exactly the kind of invisible cause behind a run that keeps retrying, so it stays visible in the trace.

---

## 3. Trace identity: derived, not stored

A trace's Langfuse trace ID is derived from the run's `agentRunId` via `createTraceId(agentRunId)` (from `@langfuse/tracing`) — the same deterministic hash, every time. It is never randomly generated and never stored on the `AgentRun` row.

This is what makes `traceUrlFor(agentRunId)` (`src/integrations/tracing/trace-url.ts`) possible without a migration: given any `agentRunId` already in the database, the trace URL is computed on the fly as `${LANGFUSE_BASEURL}/trace/${await createTraceId(agentRunId)}`. `presentAgentRun` (`src/http/api/agent-runs/agent-runs.presenter.ts`) calls it and puts the result on every agent run payload as `traceUrl: string | null` — `null` when tracing isn't configured. This is also why `presentAgentRun` is `async`: every caller (the create/get/list agent-run controllers) awaits it, and the list endpoint does so via `Promise.all` — `createTraceId` is a hash, not I/O, so a page of runs costs nothing measurable.

Finding the trace for a run a human is looking at (e.g. a failed run in an admin view) is therefore just "read the `traceUrl` field" — never a manual search in Langfuse.

---

## 4. Cost: pushed, never inferred

Langfuse prices a `generation` by matching its `model` field against Langfuse's own built-in model price table. AUREA's models (`deepseek-v4-flash`, `deepseek-v4-pro`, ...) aren't in that table, so if Langfuse were left to infer cost, every generation would show no cost at all.

Meanwhile `src/ai/runner/cost.ts` already knows, exactly, what the workspace was charged for each model call — that number is authoritative; the price catalog in `src/ai/model-router/catalog.ts` is its source of truth. So AUREA tells Langfuse the cost explicitly instead of letting it guess:

```ts
modelSpan.end({
  output: { ... },
  usageDetails: {
    input: completion.usage.inputTokens,
    output: completion.usage.outputTokens,
    cache_read_input_tokens: completion.usage.cachedInputTokens,
  },
  costDetails: costBreakdown(entry, usage), // { input, cache_read_input_tokens, output, total }
});
```

`costBreakdown` (in `cost.ts`) is the one place the per-million pricing arithmetic lives; `computeCost` — the function the credit ledger calls to debit a workspace — is defined as `costBreakdown(entry, usage).total`. One formula, two views. This matters because two independent copies of the same pricing arithmetic is exactly how a trace and an invoice start disagreeing — and **an inferred or approximated cost that disagrees with what the workspace's wallet actually paid is worse than showing no cost at all**, because it looks authoritative while being wrong.

The run's total cost (summed across every tier it touched — a run can escalate mid-flight, and `usageByTier` in `runner.ts` keeps each tier's tokens priced at that tier) is also sent when the trace ends, so the trace header shows the same number that was charged: `trace.end({ output: value, costDetails: { total: totalCost() } })`.

`cache_read_input_tokens` is the conventional Langfuse key for cached-input tokens, billed at a fraction of the fresh-input price — reporting it means the cheapest part of the bill is no longer invisible in the trace.

---

## 5. Redaction: everything leaves through one gate

Traces leave AUREA's infrastructure. Messages, tool arguments, and tool results can carry a founder's business data, and — depending on what a tool happened to return — provider credentials or sealed-secret internals. `src/integrations/tracing/redact.ts` is the one place all of that passes through before reaching Langfuse; no call site is allowed to bypass it.

`redact()`:

- replaces values under keys that look like secrets (`apiKey`, `password`, `token`, `ciphertext`, `iv`, `authTag`, ...) with `'[redacted]'`, regardless of length or nesting,
- truncates any individual string longer than 40,000 characters (with a `…[truncated N chars]` suffix) — high enough that a full agent system prompt (which can run well past the old 2,000-character cap) survives intact, but still bounded so a pathological tool result can't turn into a megabyte payload,
- caps arrays at 100 items and recursion at depth 8, for the same reason.

Every span's `input`, `output`, and `metadata` go through `redact()` before being attached to a Langfuse observation.

---

## 6. Configuration

Three environment variables gate tracing, and all three must be set together:

- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_BASEURL`

`isTracingConfigured()` (`src/integrations/tracing/langfuse-client.ts`) is true only when all three are present. A key without a `baseUrl` would otherwise fall back to the SDK's cloud default — and the entire reason to self-host is to keep client business data from leaving the box. If tracing isn't configured, `startRunTrace` returns a no-op trace and `traceUrlFor` returns `null`; nothing about the run's behavior changes.

---

## 7. The invariant: tracing never fails a run

This is the single most important property of this whole subsystem: **a tracing failure must never change a run's status, its credit, or its output.** A run is paid work; a trace is only a picture of it after the fact.

This is enforced in layers:

- `startRunTrace` never throws. If tracing isn't configured, or anything inside it fails, it returns a no-op `RunTrace` whose every method is a safe no-op.
- Every `RunSpan` returned by a configured trace (`startSpan`, `child`, `update`, `end`) already catches its own exceptions internally and degrades to a no-op rather than propagating.
- `runner.ts` wraps every interaction with the trace/span objects in its own `try {} catch {}` as well (`traceSpan`, `startSpan`, `childSpan`, `endSpan` helpers), so even a test double or an unexpected SDK failure that somehow throws synchronously cannot unwind into the run's control flow.
- `startRunTrace` is awaited *before* the run's first possible `fail()` call, so a run that fails immediately (bad input, unauthorized, missing credentials) still gets a trace showing why.

The test suite pins this directly: a mocked tracing client configured to throw on every single call (`span`, `startSpan`, `end`, `fail`) still lets a successful run reach `markCompleted` and still lets a failing run reach `markFailed` (`src/ai/runner/runner-tracing.test.ts`).
