# Search Roadmap

## Current State

Search uses `ILIKE` pattern matching across text fields (`base_entity_service.py` → `_build_text_search_filter()`). Each service returns `or_()` conditions against entity-specific columns (e.g., `Bookmark.title.ilike(pattern)`, `Bookmark.content.ilike(pattern)`).

**Limitations:** No relevance ranking (all matches are equal), no stemming ("running" won't match "run"), no word boundary awareness (`%art%` matches "start"), scans full content of every row.

---

## Phase 1: PostgreSQL Full-Text Search (FTS)

**Goal:** Replace ILIKE with FTS as the primary search mechanism for ranked, language-aware keyword search. Zero new infrastructure.

### What it is

PostgreSQL has a built-in text search engine. It works in two parts:

- **`to_tsvector`** parses text into a normalized dictionary of stemmed words with positions. `to_tsvector('english', 'The runners were running')` → `'run':2,4 'runner':2`. Stop words stripped, stems extracted.
- **`tsquery`** is the search-side equivalent. `websearch_to_tsquery('english', 'running fast')` → `'run' & 'fast'`. Supports Google-like syntax: `OR`, `-exclusion`, `"quoted phrases"`.

Search is: does the tsvector contain the stems in the tsquery? This is keyword matching with linguistic normalization — not semantic. "automobile" will not match "car."

**GIN index** (Generalized Inverted Index) is a prebuilt lookup from stem → row IDs, like a textbook index. Without it, PostgreSQL would recompute tsvectors for every row on every query.

### Approach

**Add stored generated tsvector column + GIN index to each entity table:**

```sql
ALTER TABLE bookmarks ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'C')
  ) STORED;

CREATE INDEX ix_bookmarks_search ON bookmarks USING GIN (search_vector);
```

Weights control ranking: title matches (A) score higher than content matches (C).

**Replace `_build_text_search_filter()` in each service** to use `search_vector @@ websearch_to_tsquery()` instead of ILIKE.

**Add `ts_rank` for relevance scoring** and `ts_headline` for highlighted snippets showing *why* each result matched.

**Add `sort_by: "relevance"` option** to search, defaulting to relevance when a query is provided.

### Retain ILIKE for specific cases

FTS is strictly better for natural language queries, but ILIKE is better for:

- **URL searches** — `github.com/anthropics` needs exact substring matching, not stemmed tokens. Bookmark search currently includes `Bookmark.url.ilike(pattern)`, and that should stay.
- **Code/symbol matches** — searching for `useAuth` or `ts_rank` in notes. FTS tokenizes these unpredictably.
- **Partial word matches** — FTS won't find "auth" inside "authentication" (it stems the other direction).

**Approach:** Use FTS as the primary search path. Keep ILIKE on `Bookmark.url` specifically. Consider an ILIKE fallback when FTS returns zero results — cheap to run as a second pass only when needed.

### Performance impact

- **Writes:** Small cost — PostgreSQL recomputes tsvector on every row UPDATE, including non-content changes like `last_used_at` bumps, archive/unarchive, and soft-delete. For 100KB content (the max), this is a few milliseconds. GIN uses a fastupdate buffer, so index maintenance is batched. Negligible compared to existing write-path work (history diffs, tag syncing, relationship syncing). If `last_used_at` updates become a hot path, a trigger-based approach (only recomputing when content fields actually change) is an available optimization.
- **Reads:** Significant improvement — GIN index skips non-matching rows entirely. Current ILIKE scans the full content column of every row.

### Unified content search

`content_service.py:search_all_content()` does a UNION ALL across bookmarks, notes, and prompts. Each entity type gets its own `search_vector` column, and `ts_rank` output is normalized, so scores are comparable across the UNION. The unified search path should use FTS with `ts_rank` ordering like the individual entity searches.

### Language note

`to_tsvector('english', ...)` assumes English content. This provides stemming ("running" → "run") but won't stem correctly for other languages. PostgreSQL's `'simple'` configuration (tokenization only, no stemming) works as a language-agnostic fallback. For v1, `'english'` is fine. If multi-language support becomes needed, this is a migration to change the tsvector configuration.

### Migration safety

- `ALTER TABLE ADD COLUMN ... GENERATED STORED` rewrites the table. At current scale this is fast, but be aware for larger tables.
- Use `CREATE INDEX CONCURRENTLY` for the GIN indexes to avoid table locks during index creation.

### Encryption compatibility

If encrypted notes are added later, the generated column can return NULL for encrypted rows:

```sql
CASE WHEN encrypted THEN NULL ELSE to_tsvector(...) END
```

Encrypted content drops out of search results. No current work needed — this is a small additive migration when encryption ships.

### Scope

- Migration: add `search_vector` column + GIN index to bookmarks, notes, prompts (use `CREATE INDEX CONCURRENTLY`)
- Service layer: update `_build_text_search_filter()` in each service, update `search()` in `BaseEntityService` to use `websearch_to_tsquery` and `ts_rank`
- Keep ILIKE on `Bookmark.url`; consider ILIKE fallback on zero FTS results
- Update `search_all_content()` UNION path to use FTS with `ts_rank`
- API: add `relevance` to `sort_by` enum (only valid when `query` is provided)
- `ts_headline` for search result snippets

---

## Phase 2: pgvector for Semantic Search

**Goal:** Add meaning-based search — "auth" finds documents about "login flow" and "OAuth." Also enables similarity features ("find related content").

### What it is

**pgvector** is a PostgreSQL extension that adds a `vector` data type and similarity operators (`<=>` cosine distance, `<->` L2 distance). It lets you store embedding vectors alongside regular data and query for nearest neighbors in SQL.

**Embeddings** are dense float arrays (e.g., 1536 floats) produced by a model like OpenAI's `text-embedding-3-small`. The model encodes semantic meaning into geometry — "authentication" and "login" end up close together in vector space, so a search for one finds documents about the other.

**HNSW index** (Hierarchical Navigable Small World) is an approximate nearest neighbor index. It builds a multi-layer graph structure that allows fast traversal to find the closest vectors without scanning every row. ~99% recall at high speed.

This is fundamentally different from FTS: FTS matches on exact (stemmed) words, pgvector matches on meaning. They're complementary.

### Prerequisites

- **Railway pgvector support:** Current base PostgreSQL 17 template does not have pgvector installed (`pg_available_extensions` returns no rows for `vector`). Options:
  - Migrate to Railway's pgvector template (pg_dump/pg_restore)
  - Use a custom Dockerfile based on `pgvector/pgvector:pg17`
- **Embedding API:** OpenAI `text-embedding-3-small` (1536 dims, $0.02/1M tokens) is the pragmatic default.

### Approach — start simple, no chunking

For items within a few KB (most notes, prompts, and bookmarks with short content), embed the whole item as a single vector. Use a concatenation of key fields:

```
embedding_input = f"{title}\n{description or ''}\n{content[:N] or ''}"
```

Store one embedding per entity in a separate `entity_embeddings` table (not a column on the entity tables). A separate table keeps entity tables clean and makes re-embedding trivial on model upgrades — truncate and repopulate without touching entity tables.

**When to add chunking:** Only needed for large content (bookmarks with 50-100KB of scraped content) where you want to find the *specific passage* that matches. This is a later optimization, not a v1 requirement.

### Embedding input truncation

`text-embedding-3-small` has an 8,191 token limit (~32KB of English text). Most notes and prompts fit comfortably. For bookmarks with large scraped content (up to 100KB), the input must be truncated.

**Strategy:** Front-weight the input: `title + description + summary (if available) + first ~6,000 tokens of content`. Title and description carry the most signal per token. If the bookmark has an AI-generated summary (the `summary` field already exists), prefer that over raw content truncation since it's a dense representation of the whole document.

### Embedding on save — with failure handling

Compute embeddings synchronously on create/update — an embedding API call is ~100-300ms, acceptable latency for a save operation.

**Critical: a save must never fail because the embedding API is down or slow.** The content save is the primary operation; embedding is secondary.

**Approach:** Add an `embedded_at` timestamp column (nullable) to the embeddings table. On save, attempt embedding synchronously. If it fails (API down, timeout, rate limit), save the content without an embedding and leave `embedded_at` NULL. A background job (similar to existing `tasks/cleanup.py` pattern) periodically scans for items with `embedded_at IS NULL` or `embedded_at < entity.updated_at` (stale) and retries. Items without embeddings are simply invisible to vector search but fully functional for FTS.

### Backfill strategy

When Phase 2 ships, existing content has no embeddings. A one-time batch job is needed to embed all existing items. OpenAI's embedding API supports batching up to 2,048 inputs per call. The backfill script should: batch items by user, rate-limit API calls, and be idempotent (skip items that already have current embeddings). At current scale (hundreds of users × up to 300 items each), this completes in minutes.

### Scope

- Railway migration or custom image for pgvector
- `entity_embeddings` table + migration (entity_id, entity_type, embedding vector, embedded_at)
- Embedding service: call embedding API, store vector, handle failures gracefully
- Background retry job for failed/stale embeddings
- Backfill script for existing content
- HNSW index on embedding column
- Service layer: vector search function (cosine similarity, scoped to user_id)
- Wire into search endpoint alongside FTS

---

## Phase 3: Hybrid Search with Reciprocal Rank Fusion (RRF)

**Goal:** Combine FTS keyword precision with vector semantic understanding in a single ranked result set.

### What it is

Run both FTS and vector search, then merge results using RRF. The formula scores each item based on its rank in each result set:

```
score(item) = 1/(k + rank_fts) + 1/(k + rank_vec)
```

`k=60` is standard. Items that rank highly in *both* searches score highest. Items that rank highly in only one still appear, just lower. This handles the case where a user searches "React auth" — FTS finds documents with those exact words, vector search finds documents about "login flow in React hooks," and the combined results include both.

### Approach

```python
async def hybrid_search(db, user_id, query, limit=20):
    fts_results = await fts_search(db, user_id, query, limit=100)
    query_embedding = await get_embedding(query)
    vec_results = await vector_search(db, user_id, query_embedding, limit=100)

    scores = {}
    for rank, item in enumerate(fts_results):
        scores[item.id] = 1.0 / (60 + rank)
    for rank, item in enumerate(vec_results):
        scores[item.id] = scores.get(item.id, 0) + 1.0 / (60 + rank)

    return sorted(scores.items(), key=lambda x: x[1], reverse=True)[:limit]
```

Can also be done in SQL with CTEs for better efficiency (fewer round trips), especially for the unified content search which would otherwise run 6 queries (3 entity types × 2 search methods). Either approach works — start with whichever is easier to debug and optimize later if needed.

Additional signals to layer in later: recency boost, usage frequency (`last_used_at`), tag overlap with query terms.

### Scope

- Hybrid search function combining FTS + vector results
- RRF scoring logic
- Search endpoint uses hybrid by default when query is provided (no user-facing toggle)

---

## Phase 4: Similar Content Suggestions

**Goal:** "Find related content" powered by embedding similarity. Feeds into relationship suggestions and a potential "related content" sidebar.

### What it is

Once every item has an embedding (Phase 2), finding similar content is a single vector query: take an item's embedding, search for nearest neighbors, exclude the item itself.

```python
async def find_similar(db, user_id, entity_id, limit=10):
    embedding = await get_entity_embedding(db, entity_id)
    return await vector_search(
        db, user_id, embedding, limit=limit,
        exclude_entity_id=entity_id,
    )
```

This powers:
- Suggestions when creating content relationships (existing linking feature)
- "Related content" sidebar in the UI
- RAG context selection for MCP agents

An entity's embedding doesn't change until its content changes, so similarity results are stable and cacheable.

### Scope

- Similar content endpoint
- UI integration (TBD — sidebar, suggestion dropdown, or both)

---

## Phase 5: Content Chunking

**Goal:** Enable passage-level retrieval for large content. A search can identify the specific section of a 100KB bookmark that matches, not just that the bookmark is relevant.

### What it is

Split large content into overlapping chunks (500-1000 tokens, 100-token overlap), embed each chunk separately, store in a `content_chunks` table.

```
content_chunks:
  id, user_id, entity_type, entity_id, chunk_index, chunk_text, embedding
```

Search now returns chunks with their parent entity, enabling: highlighted passage extraction, RAG with precise context windows, better relevance for long documents.

### When to do this

Defer until there's evidence that single-embedding-per-item (Phase 2) isn't providing good enough results for large content. For items under a few KB (most notes and prompts), chunking adds complexity with no quality improvement.

### Scope

- Chunking strategy (paragraph/section boundaries, overlap)
- `content_chunks` table + migration
- Async embedding pipeline (chunking + embedding 10+ chunks per item warrants background processing)
- Search integration: chunk-level results → entity-level deduplication

---

## Phase 6: LLM-Enhanced Search (Future)

**Goal:** Improve recall for vague or terse queries using LLM query expansion and HyDE.

### What it is

- **Query expansion:** LLM generates search variations. "React auth" → "React authentication", "login flow React hooks", "JWT token handling React." Run each through hybrid search, merge with RRF.
- **HyDE (Hypothetical Document Embeddings):** Instead of embedding the query, have an LLM generate a hypothetical *answer*, embed that, and search for similar real content. Bridges the query-document semantic gap.
- **Auto-generated summaries:** Generate summaries for bookmarks (the `summary` field already exists, nullable). Include in FTS search vector and as a dense embedding chunk.

### Cost considerations

At scale (100K searches/day): query expansion ~$100-500/month, HyDE ~$200-1000/month. Mitigations: cache in Redis (queries repeat), gate behind PRO tier.

### When to do this

Defer until hybrid search (Phase 3) is in production and there's evidence that search quality needs improvement for vague queries. This adds latency (LLM call before search) and cost per query.

---

## Recommended Order

| Phase | What | Dependencies | Priority |
|-------|------|-------------|----------|
| 1 | PostgreSQL FTS | None | **Do now** |
| 2 | pgvector + embeddings (no chunking) | pgvector extension, embedding API | Next |
| 3 | Hybrid RRF scoring | Phase 1 + 2 | Next |
| 4 | Similar content suggestions | Phase 2 | When useful |
| 5 | Content chunking | Phase 2 | When needed |
| 6 | LLM query expansion / HyDE | Phase 3 + LLM API | When needed |

Phase 1 is a no-brainer — zero new infrastructure, replaces ILIKE with something strictly better for natural language search while retaining ILIKE where it's needed (URLs, exact matches).

Phases 2-3 are the next meaningful upgrade — semantic search + hybrid scoring. Gated on Railway pgvector support (requires template migration or custom image).

Phases 4-6 are driven by user feedback and product needs, not speculative infrastructure.

---

## Open Questions

1. **Railway pgvector migration plan:** pg_dump/pg_restore to pgvector template, or custom Dockerfile? Need to evaluate downtime and data migration.
2. **Embedding model:** `text-embedding-3-small` (1536 dims, $0.02/1M tokens) is the default. Consider `voyage-3-lite` (512 dims) if storage becomes a concern.
3. **Tier integration:** Should vector/semantic search be gated behind a PRO tier, or available to all users? FTS should be free for everyone.
4. **Search API design:** Expose search mode (keyword vs. semantic vs. hybrid) to users? Or always run hybrid? Recommendation: hybrid-by-default. Consider exposing an "exact match" mode for power users who want substring matching.
5. **MCP search:** How should the MCP `search_items` tool leverage improved search? Currently passes query string to the same ILIKE search. Should transparently benefit from FTS/hybrid.
