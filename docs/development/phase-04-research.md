# AUREA Phase 04 — Research

This phase introduces the first AI agent and the knowledge layer.

It maps to product roadmap Phase 4 (Research).

It is the point where AUREA begins to consume the outside world and feed structured, sourced context into the Growth Brain.

---

# 1. Objective

Enable AUREA to research a business, its market, and its opportunities, and to turn that research into structured, provenance-tracked context.

Deliver the Research Agent, research integrations (web search and retrieval, document ingestion), the `KnowledgeDocument` and `KnowledgeChunk` entities, and the flow that writes research findings back into the Growth Brain as new `BusinessContextVersion` records.

The Research Agent proposes context. It does not become an independent source of truth (see `CLAUDE.md`, principle 3).

---

# 1a. What was built, and what was deferred

Implemented 2026-07-29 (`docs/superpowers/specs/2026-07-29-research-agent-design.md`):
the Research Agent, the web search integration, findings with provenance, and
acceptance into a `BusinessContextVersion`.

Deferred, following `docs/development/mvp.md` §5, which already defers embeddings
infrastructure:

- `KnowledgeDocument` and `KnowledgeChunk`, document ingestion, and document upload.
  Findings live in `AgentRun.output`; accepted findings live in business context.
- Embeddings and semantic retrieval.
- The `ResearchRequested` / `ResearchCompleted` events. No event bus exists in this
  repository, and `AgentRun` status already carries the lifecycle the UI reads.
- ICP proposals from research.

Research therefore reaches the Strategy Agent through the Growth Brain rather than
through a retrieval layer: `get_growth_context` already returns the current business
context, so an accepted finding is in the next strategy run's prompt.

---

# 2. Scope (what gets built)

This section is the phase's original plan, kept for context. See `# 1a` for what
of it was actually built and what was deferred.

Knowledge persistence (persistance-model.md sections 30–31).

```text
KnowledgeDocument  (workspace-owned; title, sourceType, sourceUrl, content, metadata)
KnowledgeChunk     (per document; content, position, metadata, embeddingReference)
```

Research integrations (`packages/integrations`).

```text
- Web search / retrieval provider interface (provider-agnostic).
- Document ingestion: accept a URL or uploaded document, fetch/parse,
  normalize to text, store as a KnowledgeDocument, split into KnowledgeChunks.
- An embedding interface (embeddings computed via the AI layer; vector store
  technology is implementation-dependent — the canonical document stays in AUREA).
```

Research Agent (`packages/ai` + agent runtime).

```text
- A Research Agent that, given a business/goal context, runs research tasks:
    market research, competitor research, customer research, trend discovery,
    opportunity identification.
- Every execution is recorded as an AgentRun (scaffold from phase 03),
  including model, provider, token counts, and estimated cost.
- The agent reads Growth Brain context and produces research findings.
- The agent uses the Model Router; simple tasks use cheaper models.
```

Provenance.

```text
- Every finding records its source (URL, document, or derivation).
- Findings written to context use BusinessContextVersion.source = RESEARCH
  and a confidence level (LOW | MEDIUM | HIGH | VERIFIED).
- AI-inferred findings are never written as VERIFIED facts automatically.
```

Feeding the Growth Brain.

```text
- Research findings become a proposed BusinessContextVersion update,
  carrying source and confidence, linked to the KnowledgeDocuments used.
- Findings may also propose new/updated ICPs.
- The human reviews before high-confidence promotion where required.
```

Events (event-architecture.md).

```text
ResearchRequested, ResearchCompleted (workflow/AI events)
AgentRunStarted, AgentRunCompleted, AgentRunFailed
BusinessContextUpdated (when research writes a new context version)
```

API and UI.

```text
- Endpoints to request research, list documents, and view findings + provenance.
- UI to trigger research, watch run status, review findings, and accept
  findings into business context.
```

---

# 3. Dependencies (which earlier phases / must-haves)

```text
- Phase 01 — Monorepo   (packages/ai, packages/integrations, EventBus)
- Phase 02 — Identity   (workspace scoping)
- Phase 03 — Growth Brain (Business, BusinessContext versions, ICP, AgentRun)
```

References:

```text
- docs/agents/research-agent.md         (agent contract)
- docs/agents/overview.md               (agent boundaries)
- docs/domains/knowledge.md             (knowledge rules)
- docs/domains/growth-brain.md          (context sources + confidence)
- docs/architecture/ai-architecture.md  (Model Router, provider abstraction)
- docs/architecture/persistance-model.md (KnowledgeDocument, KnowledgeChunk)
```

---

# 4. Deliverables (concrete artifacts)

Everything below except `API` is the original plan. `API` was corrected to what
was actually built; the `Schema`, `Web`, and `Events` blocks below it were not
built at all, and `Integrations` and `Tests` were only partly built — see `# 1a`.

```text
Schema (packages/db)                                    — not built, see § 1a
  Prisma models: KnowledgeDocument, KnowledgeChunk
  Enum: KnowledgeDocument.sourceType (USER_UPLOAD|WEB|RESEARCH|INTEGRATION|GENERATED)
  Migration + seed

Integrations (packages/integrations)
  WebSearch/Retrieval provider interface + one concrete implementation   (built)
  Document ingestion pipeline (fetch/parse → document → chunks)     — not built
  Embedding interface (wired to the AI layer)                       — not built

AI (packages/ai)
  Research Agent implementation using the Model Router
  One task type, research-growth-context — not five separate task
    definitions. Findings carry a dimension label (MARKET|COMPETITOR|
    CUSTOMER|TREND); opportunities are a separate output array, not a
    fifth dimension or a separate task
  Cost/model recording into AgentRun

Async
  Research jobs run asynchronously (Redis/BullMQ) so long research does not
  block requests; progress reflected via AgentRun status

API
  POST /agent-runs              request a research run  (generic, already existed)
  GET  /agent-runs/:id          run status + findings   (generic, already existed)
  GET  /agent-runs?taskType=    find a run in flight    (generic, already existed)
  POST /business/context/from-research
                                promote selected findings into a BusinessContextVersion
                                answers { version, created, skippedFindingIndexes,
                                skippedOpportunityIndexes }: an accept whose whole
                                selection is already stored writes no version and
                                says so, instead of returning a fresh version
                                identical to the previous one
  GET  /business/context/from-research/:agentRunId
                                which findings/opportunities of that run are already
                                in the current context — the review survives a reload
                                because "already kept" is a fact about the context,
                                not a memory of the open tab
  DELETE /business/context/from-research
                                take accepted findings back out, as a USER version
                                preserving the previous confidence

  The task-specific POST /research and GET /research/:runId were not added: the
  generic agent-run surface already covers the same lifecycle, and the Strategy
  Agent uses it too.

Web (apps/web)                                          — not built, see § 1a
  Research trigger + run status view
  Findings view with per-finding provenance
  Accept-into-context action
  (This is Tasks 10–13 of the same plan, in the aurea-web repository.)

Events                                                   — not built, see § 1a
  ResearchRequested, ResearchCompleted, AgentRun* , BusinessContextUpdated

Tests
  Ingestion produces a document + chunks with correct positions     — not built
  A research run records an AgentRun with token/cost data                (built)
  Findings carry source + confidence; acceptance creates a new context
    version                                                              (built)
  Tenant isolation for findings (documents/chunks do not exist)          (built)
```

---

# 5. Out of Scope (explicitly deferred)

```text
- Strategy generation from research           → phase 05
- Experiment planning                          → phase 06
- Content generation                           → phase 07
- Analytics-sourced context                    → phase 09
- Autonomous acceptance of findings as fact    → never automatic; human-reviewed
- Advanced RAG ranking / re-ranking tuning     → later optimization
```

---

# 6. Exit Criteria (verifiable conditions)

```text
[deferred] A document (URL or upload) is ingested into a KnowledgeDocument and split
    into ordered KnowledgeChunks.
[ ] A research task runs asynchronously and records a complete AgentRun
    (model, provider, tokens, estimated cost, status).
[ ] Research findings carry a source and a confidence level.
[ ] Accepting findings creates a new BusinessContextVersion with
    source = RESEARCH, without overwriting prior versions.
[ ] AI inference is never stored as a VERIFIED fact automatically.
[deferred] ResearchRequested and ResearchCompleted events are emitted and correlated
    (shared correlationId across the workflow).
[ ] The Research Agent reads Growth Brain context and never writes canonical
    state except through the versioned context service.
[ ] Findings are workspace-isolated. (Documents and chunks are not: they were
    not built, see §1a. AgentRun, which holds findings in its output, is
    scoped by workspaceId, and a run from another workspace 404s.)
```

---

# 7. Research Flow

This is the phase's original conception of the flow. The path actually built is
the one without document ingestion or events, described in `# 1a`.

```text
User / Goal context
        │  request research
        ▼
Research Agent  (AgentRun opened; Model Router selects model)
        │
        ├── Web search / retrieval ──► sources
        └── Document ingestion ──────► KnowledgeDocument → KnowledgeChunks   (not built)
        │
        ▼
Findings (each with source + confidence)
        │  ResearchCompleted (correlationId)                                 (not built)
        ▼
Human review
        │  accept
        ▼
BusinessContextVersion (source = RESEARCH)
        │  BusinessContextUpdated                                           (not built)
        ▼
Growth Brain  (updated context available to later agents)
```

Research feeds the Growth Brain.

The Growth Brain remains the source of truth.
