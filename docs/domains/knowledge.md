# AUREA Knowledge Domain

## 1. Purpose

The Knowledge domain is the persistent organizational memory of AUREA.

It stores what the business and the system have learned in a way that survives individual experiments.

Experiments end.

Campaigns end.

Knowledge remains.

Knowledge answers:

```text
What do we know about our business and market?

What have we learned from past experiments?

What is worth remembering for future decisions?

Where did this knowledge come from?

How confident are we in it?
```

Knowledge is what allows AUREA to reason with continuity over time instead of starting fresh with every task.

---

# 2. Domain Responsibility

The Knowledge domain is responsible for:

* Storing organizational knowledge documents
* Chunking documents for retrieval
* Maintaining embeddings and semantic retrieval
* Preserving provenance and confidence
* Serving relevant knowledge to agents as context
* Managing the knowledge lifecycle
* Retaining knowledge beyond individual experiments

The Knowledge domain is not responsible for:

* Defining the canonical Business Context
* Owning validated Learning state
* Collecting analytics data
* Executing actions
* Deciding strategy

Knowledge stores and retrieves.

It supports reasoning.

It does not replace the structured Growth Brain.

---

# 3. Knowledge vs Business Context vs Learning

These three concepts are related but distinct.

```text
Business Context
The structured, canonical current understanding of the business.

Learning
A validated insight derived from a specific experiment or outcome.

Knowledge
The broad, retrievable body of information the organization has accumulated.
```

The relationship:

```text
Business Context
   is structured and authoritative

Learning
   is a validated, sourced insight

Knowledge
   is the searchable library that includes
   research, documents, learnings, and more
```

Example:

```text
Business Context:
"Our primary ICP is B2B SaaS companies with 10-50 employees."

Learning:
"High-intent search reduces CAC for the B2B SaaS ICP."

Knowledge:
A research report on B2B SaaS buying behavior,
plus the above learning, plus uploaded competitor analysis,
all retrievable by semantic search.
```

Validated Learnings may flow into Knowledge.

Knowledge may inform Business Context.

But each has its own role.

---

# 4. Knowledge in the Growth Loop

Knowledge supports every stage of the loop.

```text
Business Context
      ↓
Goal
      ↓
Research ──────────→ Knowledge
      ↓                  │
Strategy ←──────────────┤
      ↓                  │
Hypothesis              │
      ↓                  │
Experiment              │
      ↓                  │
Outcome                 │
      ↓                  │
Learning ──────────────→┘
      ↓
Updated Context
```

Research adds to Knowledge.

Learnings add to Knowledge.

Agents retrieve from Knowledge at every reasoning step.

---

# 5. Knowledge Sources

Knowledge may originate from many sources.

```text
Research
Experiments
Outcomes
Validated Learnings
Uploaded Documents
User Input
Integrations
Generated Content
```

Each source should be recorded.

The origin of a piece of knowledge determines how much it should be trusted.

---

# 6. Source Types

Conceptually:

```text
USER_UPLOAD
WEB
RESEARCH
INTEGRATION
GENERATED
EXPERIMENT
LEARNING
```

User uploads are documents provided directly.

Web and research come from external gathering.

Generated knowledge is produced by AI and must be handled carefully.

---

# 7. Knowledge Document

A Knowledge Document is a unit of source material.

Examples:

```text
A market research report.
An uploaded PDF.
A competitor analysis.
A transcript of customer interviews.
A validated learning written as a note.
A web page captured during research.
```

A Knowledge Document is the canonical record of the source.

It lives in AUREA, not only in a vector store.

---

# 8. Knowledge Document Structure

Conceptual fields:

```text
KnowledgeDocument
├── id
├── workspaceId
├── title
├── sourceType
├── sourceUrl
├── content
├── metadata
├── createdAt
└── updatedAt
```

The full content is preserved.

Metadata records provenance and context.

---

# 9. Knowledge Chunk

Documents are split into retrievable chunks.

```text
KnowledgeDocument
      ↓
KnowledgeChunk
KnowledgeChunk
KnowledgeChunk
```

A chunk is a portion of a document suitable for retrieval.

Chunking allows precise retrieval of relevant passages instead of entire documents.

---

# 10. Knowledge Chunk Structure

Conceptual fields:

```text
KnowledgeChunk
├── id
├── documentId
├── content
├── position
├── metadata
├── embeddingReference
├── createdAt
└── updatedAt
```

Each chunk retains a reference back to its document.

The document remains the canonical source.

---

# 11. Embeddings and Semantic Retrieval

Each chunk may have an embedding.

An embedding is a vector representation of the chunk's meaning.

```text
Chunk Content
      ↓
Embedding Model
      ↓
Vector
      ↓
Vector Store
```

Embeddings allow semantic search.

Semantic search finds chunks by meaning, not only by keyword.

Example:

```text
Query:
"How do SaaS buyers evaluate support tools?"

Retrieves chunks about:
buyer evaluation criteria
support tool selection
purchase decision factors

even if the exact words differ.
```

---

# 12. Vector Layer Complements PostgreSQL

The vector layer does not replace PostgreSQL.

```text
PostgreSQL
Canonical documents, chunks, provenance, relationships.

Vector Store
Embeddings for semantic retrieval.
```

The relationship:

```text
KnowledgeChunk (PostgreSQL)
      ↓
embeddingReference
      ↓
Vector (Vector Store)
```

The canonical truth lives in PostgreSQL.

The vector store is an index for retrieval.

If the vector store is lost, it can be rebuilt from the canonical documents.

The vector store is never the source of truth.

---

# 13. Provenance

Every piece of knowledge should carry provenance.

Provenance records:

```text
Source Type
Source URL or Origin
Created By
Created At
Related Entities
```

Provenance answers:

```text
Where did this knowledge come from?

Who or what produced it?

When was it captured?
```

Knowledge without provenance is difficult to trust.

---

# 14. Confidence

Knowledge should carry a confidence level.

Possible values:

```text
LOW
MEDIUM
HIGH
VERIFIED
```

Confidence depends on:

```text
Source reliability
Recency
Corroboration
Whether it was validated
```

Example:

```text
Knowledge:
"B2B SaaS buyers prioritize integration ease."

Source:
Customer interviews (n=12)

Confidence:
MEDIUM
```

AI-generated knowledge should not automatically be high confidence.

---

# 15. The Fact and Inference Distinction

Knowledge should preserve the nature of each claim.

```text
Known Fact
User Provided
Observed Data
AI Inference
Hypothesis
```

An AI inference stored in Knowledge is still an inference.

Retrieving it later does not make it a fact.

The distinction must travel with the knowledge.

---

# 16. Retrieval for Context (RAG)

Agents retrieve knowledge to build their reasoning context.

This pattern is retrieval-augmented generation.

```text
Agent Task
      ↓
Query Knowledge
      ↓
Retrieve Relevant Chunks
      ↓
Assemble Context
      ↓
Reason / Generate
```

Example:

```text
Strategy Agent needs to design a strategy.

It retrieves:
market research chunks
past learnings for the ICP
competitor analysis

It uses these as grounding context.
```

Retrieval grounds agents in what the organization actually knows.

---

# 17. Retrieval Quality

Retrieval quality determines reasoning quality.

Good retrieval provides:

```text
Relevant knowledge
Correct provenance
Appropriate confidence
Recent information
```

Poor retrieval causes:

```text
Irrelevant context
Outdated assumptions
Hallucination risk
Low-confidence claims treated as fact
```

Retrieved chunks should carry their provenance and confidence into the agent context.

An agent should know how much to trust what it retrieves.

---

# 18. Grounding and Hallucination Control

Knowledge retrieval reduces hallucination.

```text
Without grounding:
The agent invents plausible-sounding claims.

With grounding:
The agent reasons from retrieved, sourced knowledge.
```

When knowledge is retrieved, the agent should prefer it over unsupported generation.

When no relevant knowledge exists, the agent should say so rather than fabricate.

---

# 19. Knowledge Lifecycle

Knowledge moves through a lifecycle.

```text
CAPTURED
INDEXED
ACTIVE
STALE
ARCHIVED
```

```text
Captured:
The document is stored.

Indexed:
Chunks and embeddings are created.

Active:
The knowledge is retrievable and current.

Stale:
The knowledge may be outdated.

Archived:
The knowledge is retained but excluded from default retrieval.
```

Knowledge should not be silently deleted.

Outdated knowledge should be archived, preserving history.

---

# 20. Knowledge Staleness

Knowledge can become outdated.

Examples:

```text
A market shifted.
A competitor changed positioning.
A pricing assumption is no longer valid.
A learning was superseded by a newer experiment.
```

Stale knowledge should be marked rather than trusted.

Recency is part of confidence.

---

# 21. Knowledge from Learnings

Validated Learnings should flow into Knowledge.

```text
Experiment
      ↓
Outcome
      ↓
Learning Candidate
      ↓
Validated Learning
      ↓
Knowledge
```

A validated Learning becomes durable organizational knowledge.

It becomes retrievable for future reasoning.

This is how the growth loop compounds over time.

**Implementation, 2026-08-03.** There is no Knowledge document layer yet, so
"retrievable for future reasoning" is served directly from the `Learning` table
by the `get_learnings` tool, read by `propose-strategies`,
`propose-hypothesis` and `propose-experiment`. Validated rows only, newest
first, capped at 20 — the cap is prompt budget, not a rule, and is the first
thing a real retrieval layer would replace.

---

# 22. Knowledge from Research

Research produces Knowledge documents.

```text
Research Task
      ↓
Gathered Information
      ↓
Knowledge Document
      ↓
Chunks + Embeddings
      ↓
Retrievable Knowledge
```

Research is one of the primary ways Knowledge grows before experiments run.

---

# 23. Data Model

Conceptually, the Knowledge domain contains:

### Knowledge Document

```text
KnowledgeDocument
├── id
├── workspaceId
├── title
├── sourceType
├── sourceUrl
├── content
├── metadata
├── createdAt
└── updatedAt
```

### Knowledge Chunk

```text
KnowledgeChunk
├── id
├── documentId
├── content
├── position
├── metadata
├── embeddingReference
├── createdAt
└── updatedAt
```

### Relationships

```text
Workspace
      ↓
KnowledgeDocument
      ↓
KnowledgeChunk
      ↓
embeddingReference → Vector Store
```

```text
Learning
      ↓
KnowledgeDocument (as durable knowledge)
```

Provenance and confidence are stored in metadata until patterns stabilize into typed fields.

This aligns with the AUREA Persistence Model.

The canonical document remains in AUREA.

The vector storage technology is implementation-dependent.

---

# 24. Multi-Tenant Isolation

Knowledge is scoped to a Workspace.

```text
Organization
      ↓
Workspace
      ↓
Knowledge
```

Retrieval must never cross tenant boundaries.

One workspace must never retrieve another workspace's knowledge.

This isolation must be enforced at query time.

---

# 25. Initial MVP Scope

The first implementation should support:

```text
Create Knowledge Document
Store canonical content
Chunk documents
Generate embeddings
Semantic retrieval by query
Return chunks with provenance and confidence
```

The MVP may begin with:

```text
User uploads
Research output
Validated learnings
```

Advanced staleness detection and automated re-indexing may follow.

The MVP must prove that agents can retrieve grounded, sourced context.

---

# 26. First Knowledge Experience

The initial user journey should be:

```text
User uploads a document or research completes
      ↓
Document stored as canonical Knowledge
      ↓
Document chunked and embedded
      ↓
Agent needs context
      ↓
Agent queries Knowledge semantically
      ↓
Relevant chunks retrieved with provenance
      ↓
Agent reasons from grounded knowledge
```

---

# 27. Knowledge Principle

The Knowledge domain exists to give AUREA memory.

It should never behave like:

```text
Agent:
I have no idea what we learned last month.
Let me guess.
```

It should behave like:

```text
Agent:
Last quarter we validated that high-intent search
reduces CAC for this ICP.

A research report indicates buyers prioritize integration ease.

I will ground this strategy in what we already know.
```

Knowledge is what turns a collection of one-off AI tasks into an organization that learns.

```text
Canonical Documents
+
Chunks
+
Embeddings
+
Provenance
+
Retrieval
=
Durable Organizational Memory
```
