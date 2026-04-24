# Vector DB and Semantic Search

## Overview

Tiddly's semantic search system adds meaning-based retrieval on top of the existing full-text search (FTS) pipeline.

FTS remains the primary lexical search system:
- exact words
- stemming
- partial matches
- existing filters, tags, and views

Semantic search adds a second retrieval path based on embeddings:
- a search for `auth` can find content about `login flow`, `OAuth`, or `sign-in`
- results are still scoped to the current user and filtered through the normal content-search rules

The system uses PostgreSQL with the `pgvector` extension as the vector store. Embeddings live in the same Postgres cluster as the main application data.

At a high level, the system has two halves:

1. **Write-time indexing**
User content is chunked and embedded asynchronously after saves and updates.

2. **Query-time retrieval**
Relevant searches run both FTS and vector search, then merge the results with Reciprocal Rank Fusion (RRF).

---

## Design Goals

1. **Improve recall without replacing FTS**
Keyword search is still important for precision. Semantic search complements it rather than replacing it.

2. **Keep saves fast and reliable**
Embedding generation is asynchronous. A user's save should not fail because Redis or the embedding provider is unavailable.

3. **Minimize re-embedding work**
Edits should reuse existing embeddings whenever possible rather than reprocessing whole documents.

4. **Stay operationally simple**
Use Postgres + pgvector instead of a separate vector database, and reuse the existing Redis and AI cost-tracking infrastructure.

5. **Preserve existing filtering behavior**
Tags, views, archive/delete rules, and content-type filtering must work the same way for semantic search as they do for FTS.

---

## Core Concepts

### Chunks

The vector index does not embed whole documents as one blob. It embeds smaller units called **chunks**.

Clients do not build chunk text themselves. The API continues to expose normal structured fields, and the backend chunking/indexing layer is responsible for constructing the canonical embedding representation from those fields.

Each entity can produce:
- one optional `metadata` chunk
- zero or more `content` chunks

This gives better retrieval quality and makes updates cheaper.

### Metadata Chunk

The metadata chunk contains structured fields in a canonical text format:

```text
Name: ...
Title: ...
Description: ...
Tags: ...
```

- `Name` is used only for prompts
- `Tags` are included for bookmarks, notes, and prompts
- tags are sorted before serialization so metadata hashes are stable
- empty fields are omitted
- if all metadata fields are empty, the metadata chunk is skipped

Metadata is separated from body content so title/description edits only re-embed that one chunk.

### Content Chunks

Content is split by paragraph:
- one chunk per paragraph
- raw paragraph text only
- no title prefix

If a paragraph is unusually large, it is split into smaller fixed-size subchunks.

Prompts are the one special case in content construction:
- prompt `name`, `title`, `description`, and `tags` live in the metadata chunk
- prompt arguments are rendered into a canonical arguments block at the start of the content stream
- the arguments block is followed by a blank line and then the raw prompt template content

Each prompt argument is rendered as one paragraph:

```text
Argument name: audience; description: Intended audience for tone and examples
```

To keep this deterministic and chunk-friendly:
- arguments are sorted by argument name for embedding purposes
- argument descriptions are normalized so internal double newlines do not accidentally split one argument into multiple chunks

### Hashes

The system uses hashes at two levels:

- **Entity-level hashes**
  - `metadata_hash`
  - `content_hash`
  - used to quickly detect whether anything changed at all

- **Chunk-level hashes**
  - `chunk_hash`
  - used to reuse embeddings for unchanged paragraphs

`content_hash` is based on the canonical embeddable content text, not just the raw database content field. For prompts, that means argument changes can invalidate content embeddings even when the raw prompt body is unchanged.

This is what makes re-embedding efficient.

### Eventual Consistency

Semantic search is eventually consistent.

The source of truth is still the main content tables. Embeddings are secondary search infrastructure built asynchronously after content changes.

That means:
- saves complete before embeddings are generated
- FTS sees new content immediately
- semantic search may lag behind briefly

---

## Data Model

### `content_chunks`

This table stores the searchable vectorized chunks.

Each row includes:
- `user_id`
- `entity_type`
- `entity_id`
- `chunk_type` (`metadata` or `content`)
- `chunk_index`
- `chunk_text`
- `token_count`
- `chunk_hash`
- `model`
- `embedding`

Important properties:
- embeddings are stored directly in Postgres as `Vector(1536)`
- `user_id` is present for search scoping
- `(entity_type, entity_id, chunk_type, chunk_index)` is unique
- HNSW index supports approximate nearest-neighbor vector search
- user deletion cascades automatically through the `user_id` foreign key
- entity deletion cleanup is application-managed because `entity_type + entity_id` is a polymorphic reference, not a database-enforced foreign key

### HNSW and Cosine Distance

The vector index uses pgvector's HNSW index with cosine-distance operators.

Two different concepts are involved:
- **Cosine distance** defines what "similar" means for embeddings
- **HNSW** is the index structure that makes nearest-neighbor search fast

The database still ranks vectors by cosine distance. HNSW does not replace cosine scoring; it accelerates cosine-based nearest-neighbor retrieval so the system does not need to compare the query embedding against every stored chunk.

### `content_embedding_state`

This table tracks one row per entity and answers:
- has this entity been embedded successfully?
- what content/model was it embedded from?
- did the last attempt fail?

Each row includes:
- `user_id`
- `entity_type`
- `entity_id`
- `metadata_hash`
- `content_hash`
- `model`
- `status` (`embedded` or `failed`)
- `last_error`

This table exists to make freshness and retry decisions cheap without putting embedding-specific state on the entity tables themselves.

---

## Chunking Strategy

All entity types use the same chunking algorithm:
- bookmarks
- notes
- prompts

This keeps the pipeline uniform and reduces special-case behavior.

### Metadata

Metadata is formatted in a stable canonical order. Stability matters because hash stability depends on the exact text format not drifting.

For bookmarks, notes, and prompts, tags are part of the metadata chunk and are serialized in sorted order.

### Content

Content is split on paragraph boundaries (`\n\n`).

This was chosen over fixed-size sliding windows because:
- paragraphs are better semantic units for search
- inserts do not invalidate downstream chunks
- edits usually affect only a small number of paragraphs

For prompts, the paragraph stream is:
1. canonical argument paragraphs, sorted by argument name
2. a blank line
3. the raw prompt content

This keeps prompt arguments close to the template body they describe while still allowing argument-level chunking.

### Oversized Paragraphs

Most prose paragraphs are small enough to embed directly.

For structureless blobs or pasted text with no paragraph breaks, oversized paragraphs are split into smaller fixed-size chunks using approximate token counts based on `len(text) // 4`.

No real tokenizer is used in the worker.

---

## Write Path

### 1. User saves content

A bookmark, note, or prompt is created or updated through the normal service layer.

The primary write is the entity save itself.

### 2. Post-commit enqueue

After the database transaction commits successfully, the system enqueues an embedding job in Redis.

This is intentionally **post-commit**, not post-flush:
- the worker should only ever see committed data
- rolled-back writes should not produce embedding work

### 3. Worker loads the entity

The embedding worker is a long-running async process that consumes Redis jobs.

For each job it:
- loads the entity
- chunks it
- computes current hashes
- compares them to `content_embedding_state`

### 4. Skip or embed

If hashes and model already match:
- the job is a no-op

If metadata changed:
- re-embed metadata chunk only

If content changed:
- compare new paragraph hashes to existing chunk hashes
- reuse existing embeddings where hashes match
- embed only new paragraphs

### 5. Atomic write

Chunk inserts, chunk deletes, and state updates happen in one database transaction.

That guarantees search never sees a mixed state with some old chunks and some new chunks.

---

## Search Path

### When hybrid search runs

Hybrid search is used only when:
- the user is Pro tier
- a query is present
- `sort_by="relevance"`
- embeddings are configured

Otherwise, search remains FTS-only.

### Query embedding

For hybrid search, the query is embedded through the same embedding service used by indexing

### Concurrent first stage

The system runs:
- FTS search
- query embedding

in parallel.

This hides local FTS latency behind external embedding API latency.

### Vector search

Once the query embedding is available, vector search runs against `content_chunks` using cosine distance.

The query fetches nearest chunks ordered by distance, overfetches candidates, and deduplicates by entity in application code.

The system does **not** use `DISTINCT ON` for entity deduplication, because that would distort global nearest-neighbor ranking.

### Filter reconciliation

Vector-only results are not returned directly.

They are rechecked through the normal content search/filter pipeline so that semantic search respects:
- view filters
- archive/delete rules
- tags
- content types
- saved filter expressions

### RRF merge

The final result set is built by merging:
- FTS results
- vector results

with Reciprocal Rank Fusion.

Reciprocal Rank Fusion (RRF) is a simple rank-combination method:
- each result gets a score based on its position in each ranked list
- high rank in either list helps
- high rank in both lists helps even more

This works well here because the two search systems are complementary:
- FTS contributes lexical precision
- vector search contributes semantic recall

This gives a practical balance:
- lexical matches still rank well
- semantic-only matches can surface
- items that perform well in both systems rise to the top

---

## Why Use Hybrid Search

Pure vector search would lose a lot of keyword precision.

For example, if a user searches for `useEffectEvent`, they likely want content containing that exact React API name. Pure vector search might instead return semantically related notes about React effects, event handlers, or stale closures even if the exact symbol never appears.

Pure FTS misses semantically relevant results when exact words differ.

Hybrid search keeps the strengths of both:
- FTS for precision
- vector search for recall

This is especially useful for user-generated content where wording varies widely but the underlying concept is the same.

---

## Consistency Model

The semantic index is intentionally eventually consistent.

### What is guaranteed immediately

After a successful write:
- the entity row is updated
- FTS sees the latest content
- the user-facing write succeeds

### What may lag

Semantic search may temporarily use:
- missing embeddings for new content
- stale embeddings for updated content

This is an accepted tradeoff to avoid making content saves depend on embedding infrastructure.

### Important implication

If Redis is unavailable during post-commit enqueue:
- the content save still succeeds
- the embedding job is dropped

If the entity had never been embedded before, routine backfill can catch it.

If the entity already had a successful embedding state row, the vector index can remain stale until:
- a later successful re-enqueue
- a forced backfill
- manual reconciliation

This is the main operational sharp edge in the design.

---

## Retry and Failure Model

### Provider-level retries

The embedding service may use LiteLLM's normal per-call retry behavior for transient provider issues.

This is the inner retry layer.

### Worker-level retries

The worker is the durable retry layer.

Failed jobs are retried with exponential backoff:
- 1 second
- 2 seconds
- 4 seconds

After the retry limit is exhausted, jobs go to a dead letter queue.

### Failure behavior

On failure:
- existing chunks are preserved
- state is marked `failed`
- search continues using last-good embeddings

This avoids making a transient provider failure break existing search behavior.

---

## Cost Tracking

Embeddings reuse the same cost-tracking pipeline as the rest of the AI features.

### Provider calls

Embedding calls go through LiteLLM rather than the raw OpenAI SDK.

### Accounting path

Successful provider calls are recorded through the existing path:
- `track_cost(...)`
- Redis hourly buckets
- `ai_usage` flush cron

### Use case

For v1, all semantic-search embedding spend is tracked under:
- `use_case = "search"`

The system does not currently separate:
- indexing embeddings
- query embeddings

That can be added later if more granularity becomes useful.

### Logging

Successful cost tracking is silent.

Only anomalies should log:
- unknown cost
- Redis unavailable
- Redis write failure

## Tier Gating

Semantic search is Pro-only.

For v1:
- Free users continue using FTS only
- existing embeddings are not deleted on downgrade
- gating happens at query time

This keeps rollout simple. Cleanup on downgrade and embedding existing content on upgrade can both be added later when billing event infrastructure exists.

---

## Why pgvector in the Main Database

The system uses the existing Postgres cluster rather than a dedicated vector database.

This keeps operations simpler:
- one database
- one backup story
- one permissions model
- one transactional system for chunk writes and state updates

At the current scale, this is the pragmatic choice.

The main known limitation is that HNSW search is global and the `user_id` filter is effectively applied after candidate retrieval. That is acceptable for current scale but will become a scaling concern as corpus size grows.

Likely future mitigations:
- higher overfetch / `ef_search` tuning
- partitioning by user if necessary

---

## Operational Components

The system depends on these pieces working together:

- **Postgres**
  - stores entity data
  - stores chunk embeddings and embedding state
  - serves vector similarity queries

- **Redis**
  - stores embedding jobs
  - stores delayed retries
  - stores dead-lettered jobs
  - stores AI cost-tracking buckets

- **Embedding worker**
  - consumes jobs
  - calls the embedding provider
  - writes chunks and embedding state

- **Backfill task**
  - re-enqueues entities that need embeddings
  - supports force re-embedding after model changes or reconciliation

---

## Mental Model for Engineers

If you need one concise model for the whole system, it is this:

1. Content is saved normally.
2. A post-commit Redis job asks the worker to refresh semantic index data.
3. The worker chunks content, reuses old paragraph embeddings where possible, and writes fresh chunks atomically.
4. Relevance searches run FTS and vector search together.
5. The result list is a filtered, fused combination of lexical precision and semantic recall.

That is the entire system in one loop:
- async indexing on writes
- hybrid retrieval on reads

---

## Current Implementation Status

As of the current plan state:
- pgvector is enabled
- the chunk/state schema exists
- the high-level design for chunking, embedding, worker processing, hybrid search, and backfill is defined

The system is being built milestone by milestone from that plan.

For implementation details and step-by-step rollout work, see:
- [docs/implementation_plans/2026-04-05-pgvector-embeddings.md](/Users/shanekercheval/repos/bookmarks/docs/implementation_plans/2026-04-05-pgvector-embeddings.md)
