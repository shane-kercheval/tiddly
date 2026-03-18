# Semantic Search: pgvector Embeddings Implementation Plan

## Context

- **FTS (Phase 1) is complete** — `search_vector` tsvector columns, GIN indexes, `ts_rank` scoring, combined FTS + ILIKE. See `future-search.md`.
- **pgvector is enabled** on production (0.8.2) and available in local dev.
- **Goal:** Add semantic/meaning-based search so "auth" finds documents about "login flow" and "OAuth." Complements FTS keyword matching.
- **Key decisions:**
  - Chunking from the start (not deferred to a later phase)
  - Async embedding via Celery (save returns immediately, embedding happens in background)
  - Redis (already deployed) as Celery broker

## pgvector Setup

**Production:**
- Upgraded Railway `postgres-ssl` image from `:17.1` → `:17.9` (via Railway's built-in update button). The `:17.9` image includes `postgresql-17-pgvector`, added to the `postgres-ssl` image on 2026-03-14.
- Enabled extension: `CREATE EXTENSION IF NOT EXISTS vector;` — pgvector 0.8.2 on PostgreSQL 17.9.
- No data migration was needed — persistent volume preserved through image update.

**Local development:**
- `docker-compose.yml`: `postgres:16` → `pgvector/pgvector:pg17`
- `backend/tests/conftest.py`: `PostgresContainer("postgres:16", ...)` → `PostgresContainer("pgvector/pgvector:pg17", ...)`

**Key learnings:**
- Railway's built-in `postgres-ssl` image is a Docker container, not a fully managed DB. Community pgvector templates are functionally equivalent but lack auto-SSL and the dashboard DB tab.
- Railway does not auto-update database images. Use the dashboard update button or redeploy to pull a newer tag.
- pgvector binaries are part of the Docker image, not the data directory. Updating the image makes the extension available without affecting existing data.

## Outstanding Questions

Before implementing, these need answers:

### 1. Embedding Model

The original roadmap suggests OpenAI `text-embedding-3-small` (1536 dims, $0.02/1M tokens). Alternatives:
- `text-embedding-3-large` (3072 dims, better quality, 2x storage)
- `voyage-3-lite` (512 dims, cheaper storage)
- An open-source model via an API-compatible provider?

**Recommendation:** `text-embedding-3-small` — good quality/cost/storage balance. 1536 dims × 4 bytes × 30M vectors (10K users × 300 items × 10 chunks) = ~180GB. Manageable.

**Decision needed:** Which model? Are you comfortable with an OpenAI dependency for embeddings?

### 2. Chunking Threshold & Strategy

The plan calls for chunking from the start. Questions:
- **Which entities get chunked?** Notes and bookmarks (large content)? Prompts too (typically short)?
- **Threshold:** At what size does an item get chunked vs. embedded as a single vector? e.g., items under 500 tokens → single embedding, items over 500 tokens → chunked.
- **Chunk size:** 500-1000 tokens per chunk with ~100 token overlap is standard. Preference?
- **Chunk boundaries:** Split on paragraph/section breaks (semantic) or fixed token count (simpler)?

**Recommendation:** Chunk notes and bookmarks above ~500 tokens. Prompts are typically short — single embedding. Split on paragraph boundaries with a max chunk size fallback. Small items (under threshold) get one chunk that equals the whole content.

**Decision needed:** Chunking threshold, which entities, boundary strategy.

### 3. Worker Infrastructure

The embedding worker needs a new always-on Railway service. Questions:
- **Worker service:** New Railway service running `python -m worker.main`. Uses same codebase, different entrypoint.
- **Monitoring:** Logs only initially. Add structured logging or a health-check endpoint later if debugging becomes painful.
- **Concurrency:** How many concurrent embedding API calls per worker?

**Recommendation:** Start with one worker, 4 concurrent jobs (asyncio semaphore). Monitor via logs.

**Decision needed:** Are you comfortable adding an embedding worker service to Railway?

### 4. Tier Gating

Should semantic/vector search be available to all users or gated behind a paid tier? FTS is free for everyone.

**Recommendation:** Available to all for now. Embedding costs are per-save (not per-search), and at current scale the cost is negligible. Gate later if costs grow.

**Decision needed:** Tier gating strategy.

### 5. API Key Management

The embedding API (e.g., OpenAI) needs an API key. This is a new external dependency.
- Store as Railway environment variable (`OPENAI_API_KEY`)
- Add to `core/config.py` Settings class
- Graceful degradation if not configured (vector search unavailable, FTS still works)

**Decision needed:** Confirm approach, and which API provider.

---

## Milestone 1: Content Chunks Table + Embedding Storage

### Goal & Outcome
Set up the database schema for storing chunked content and their embeddings. After this milestone:
- `content_chunks` table exists with vector column and HNSW index
- Alembic migration enables pgvector extension and creates the table
- No embeddings are generated yet — this is schema only

### Implementation Outline

**Alembic migration:**
- `op.execute("CREATE EXTENSION IF NOT EXISTS vector;")` — canonical location for extension enablement
- Create `content_chunks` table:

```python
# Schema (not the exact migration code — illustrative)
content_chunks:
    id              UUID PK (UUIDv7)
    user_id         UUID FK → users.id (for scoping queries)
    entity_type     String (bookmark/note/prompt)
    entity_id       UUID (FK not enforced — entities may be deleted)
    chunk_index     Integer (ordering within entity)
    chunk_text      Text (the actual chunk content)
    token_count     Integer (for debugging/monitoring)
    embedding       Vector(1536) (nullable — populated async)
    embedded_at     DateTime (nullable — null means pending)
    created_at      DateTime
    updated_at      DateTime
```

- Create HNSW index on `embedding` column, scoped to non-null embeddings:
```sql
CREATE INDEX ix_content_chunks_embedding ON content_chunks
  USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
```
- Index on `(entity_type, entity_id)` for chunk lookup/deletion
- Index on `user_id` for scoped search queries
- Index on `embedded_at` for finding stale/pending chunks

**SQLAlchemy model** (`models/content_chunk.py`):
- Uses `UUIDv7Mixin`, `TimestampMixin`
- `embedding` column uses pgvector's `Vector(1536)` type from `pgvector.sqlalchemy`
- Relationship to User (for query scoping)

**Dependency:** Add `pgvector` Python package to `pyproject.toml` (provides `pgvector.sqlalchemy` for the `Vector` type).

### Testing Strategy
- Migration runs cleanly on fresh database (testcontainers with pgvector image)
- Migration runs cleanly on database where extension is already enabled (production scenario)
- `Vector` column accepts and returns float arrays of correct dimensionality
- HNSW index is created (query `pg_indexes`)
- Verify `content_chunks` table constraints: user_id FK, non-null fields
- Verify chunk insertion and retrieval round-trip with embedding data

---

## Milestone 2: Chunking Service

### Goal & Outcome
Implement the logic that splits entity content into chunks. After this milestone:
- A chunking service can take any entity (note, bookmark, prompt) and produce a list of text chunks
- Chunking respects paragraph boundaries with a max-size fallback
- Small items produce a single chunk (no unnecessary splitting)
- Chunks include the entity's title/description as context prefix

### Implementation Outline

**Chunking service** (`services/chunking_service.py`):

```python
@dataclass
class Chunk:
    index: int
    text: str
    token_count: int

def chunk_entity(
    title: str | None,
    description: str | None,
    content: str | None,
    max_chunk_tokens: int = 800,
    overlap_tokens: int = 100,
    min_chunk_threshold: int = 500,
) -> list[Chunk]:
    """Split entity content into embeddable chunks.

    - Builds embedding input: title + description + content
    - If total tokens < min_chunk_threshold: return single chunk
    - Otherwise: split on paragraph boundaries, respecting max_chunk_tokens
    - Each chunk is prefixed with title for context
    """
```

**Token counting:** Use `tiktoken` (OpenAI's tokenizer) for accurate token counts matching the embedding model. Add to dependencies.

**Chunking algorithm:**
1. Build full text: `f"{title}\n{description}\n{content}"`
2. Count tokens. If under threshold → single chunk, return early.
3. Split content on double-newlines (paragraphs). Title/description go in every chunk as prefix.
4. Greedily combine paragraphs until approaching `max_chunk_tokens`.
5. If a single paragraph exceeds `max_chunk_tokens`, split on sentence boundaries.
6. Apply `overlap_tokens` between adjacent chunks (repeat tail of previous chunk).

**Entity-specific handling:**
- **Bookmarks:** Use `title + description + summary (if available) + content`. Summary is a dense representation — prefer it over raw content when both exist.
- **Notes:** Use `title + description + content`.
- **Prompts:** Use `name + title + description + content`. Typically short — usually a single chunk.

### Testing Strategy
- Short content (under threshold) → single chunk
- Content exactly at threshold boundary → correct behavior
- Long content splits on paragraph boundaries
- Very long single paragraph splits on sentence boundaries
- Overlap between chunks is correct (tail of chunk N appears at start of chunk N+1)
- Title prefix appears in every chunk
- Empty content → single chunk with just title/description
- Null fields handled gracefully
- Token counts are accurate (verify against tiktoken directly)
- Bookmark with summary uses summary; bookmark without summary uses content
- Unicode content chunks correctly
- Very large content (100KB bookmark) produces reasonable number of chunks

---

## Milestone 3: Embedding Service

### Goal & Outcome
Implement the service that calls the embedding API to convert text chunks into vectors. After this milestone:
- An embedding service can take text and return a vector
- Batch embedding for multiple chunks in one API call
- Graceful failure handling (API down, rate limits, timeouts)
- Configuration via environment variables

### Implementation Outline

**Embedding service** (`services/embedding_service.py`):

```python
class EmbeddingService:
    """Calls embedding API to convert text → vectors."""

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Embed multiple texts in a single API call.
        Returns list of vectors in same order as input.
        Raises EmbeddingError on failure.
        """

    async def embed_single(self, text: str) -> list[float]:
        """Convenience wrapper for single text."""
```

**API client:** Use the OpenAI Python SDK (`openai` package) directly — it supports async and handles retries. Read the [OpenAI Embeddings API docs](https://platform.openai.com/docs/guides/embeddings) before implementing.

**Configuration** (add to `core/config.py`):
```python
embedding_model: str = "text-embedding-3-small"
embedding_dimensions: int = 1536
openai_api_key: str | None = None  # None = embeddings disabled
```

**Error handling:**
- API timeouts → raise `EmbeddingError` (caller decides retry strategy)
- Rate limits (429) → raise `EmbeddingError` with retry-after hint
- Invalid input → raise `EmbeddingError`
- No API key configured → raise `EmbeddingNotConfiguredError`

**Batch limits:** OpenAI supports up to 2048 inputs per call. For a single entity's chunks (typically 1-50), one API call suffices.

### Testing Strategy
- Successful single embedding returns correct dimensionality
- Successful batch embedding returns correct count and dimensionality
- API timeout raises `EmbeddingError`
- Rate limit (429) raises `EmbeddingError`
- Invalid API key raises appropriate error
- No API key configured raises `EmbeddingNotConfiguredError`
- Empty text input handled gracefully
- Mock the OpenAI client for unit tests (don't call the real API in CI)

---

## Milestone 4: Async Embedding Worker

### Goal & Outcome
Set up a custom async worker service that processes embedding jobs from a Redis queue. After this milestone:
- A long-running worker process listens for embedding jobs via Redis `BRPOP`
- Saving/updating an entity enqueues an embedding job
- The worker chunks the content, calls the embedding API, and stores results in `content_chunks`
- Failed jobs retry with exponential backoff (max 3 retries)
- Stale chunks are cleaned up when content changes

### Why a custom worker (not Celery/arq)
- **Async nativity:** The entire stack is async (FastAPI, async SQLAlchemy, async OpenAI client). Celery 5.x does not support `async def` tasks natively — it would require `asyncio.run()` wrappers in every task, losing connection pooling and async benefits. Native async is targeted for Celery 6.0 (May 2026, repeatedly delayed since 2017).
- **arq** is async-native but is in maintenance-only mode (no new features, never reached 1.0).
- **Scope is small:** One job type (embed entity) with retries. The worker is ~100-150 lines — less code than configuring a framework.
- **No dependency risk:** No external task library to break across upgrades.

### Architecture note: workers vs. cron jobs
This worker handles **event-driven jobs** (triggered by user actions, needs to run within seconds). Scheduled tasks like `tasks/cleanup.py`, `tasks/orphan_relationships.py`, and future cost aggregation remain as **Railway cron jobs** — they're already written as standalone scripts and don't need a queue.

```
Railway services:
├── API (FastAPI)
├── Embedding worker (this milestone — always-on, listens to Redis)
├── Cron: cleanup (daily, python -m tasks.cleanup)
├── Cron: orphan relationships (weekly, python -m tasks.orphan_relationships --delete)
└── Cron: cost aggregation (future — daily, python -m tasks.aggregate_costs)
```

### Implementation Outline

**Worker service** (`worker/main.py`):

```python
import asyncio
import json
import logging
import signal

import redis.asyncio as redis

from core.config import get_settings

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
CONCURRENCY = 4  # max concurrent embedding API calls

async def process_job(job_data: dict):
    """Chunk and embed an entity's content.

    1. Load entity from DB
    2. Delete existing chunks for this entity
    3. Chunk the content (chunking service)
    4. Call embedding API for all chunks (embedding service)
    5. Store chunks + embeddings in content_chunks
    6. Set embedded_at on all chunks
    """
    ...

async def worker_loop():
    settings = get_settings()
    r = redis.from_url(settings.redis_url)
    sem = asyncio.Semaphore(CONCURRENCY)
    shutdown = asyncio.Event()

    def handle_signal():
        logger.info("Shutdown signal received, finishing current jobs...")
        shutdown.set()

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, handle_signal)

    logger.info("Embedding worker started (concurrency=%d)", CONCURRENCY)

    while not shutdown.is_set():
        # BRPOP blocks until a job arrives (no polling, no CPU waste)
        result = await r.brpop("embed_jobs", timeout=5)
        if result is None:
            continue  # timeout — check shutdown flag and loop

        job_data = json.loads(result[1])

        async def handle(data):
            async with sem:
                try:
                    await process_job(data)
                except Exception as e:
                    retries = data.get("retries", 0)
                    if retries < MAX_RETRIES:
                        data["retries"] = retries + 1
                        delay = 2 ** retries  # 1s, 2s, 4s
                        await asyncio.sleep(delay)
                        await r.lpush("embed_jobs", json.dumps(data))
                        logger.warning("Retrying job (attempt %d): %s", retries + 1, e)
                    else:
                        logger.error("Job failed after %d retries: %s", MAX_RETRIES, e, exc_info=True)

        asyncio.create_task(handle(job_data))

    await r.aclose()
    logger.info("Embedding worker shut down")
```

**Enqueue helper** (`worker/enqueue.py`):

```python
async def enqueue_embedding(redis_client, entity_type: str, entity_id: str, user_id: str):
    """Push an embedding job onto the Redis queue."""
    await redis_client.lpush("embed_jobs", json.dumps({
        "entity_type": entity_type,
        "entity_id": entity_id,
        "user_id": user_id,
    }))
```

**Triggering from service layer:**
- In each entity service's `create()` and `update()` methods, after the DB save succeeds, call `enqueue_embedding(redis, entity_type, entity_id, user_id)`
- Do NOT call on archive/unarchive/soft-delete — content hasn't changed
- Only trigger when content-relevant fields change (title, description, content, summary, name)

**Chunk lifecycle:**
- On entity update: delete all existing chunks for that entity, re-chunk, re-embed
- On entity hard-delete: delete all chunks for that entity (add to orphan cleanup or handle in service layer)
- On soft-delete: leave chunks in place (entity might be restored)

**Railway deployment:**
- New service using the same Docker image, different start command:
  ```
  python -m worker.main
  ```
- Uses same `DATABASE_URL`, `REDIS_URL`, and `OPENAI_API_KEY` as the API
- Always-on service (not a cron job)

### Testing Strategy
- Worker processes a job and produces correct chunks + embeddings (mock embedding API)
- Worker retries on embedding API failure with exponential backoff
- Worker respects max retries — after 3 failures, job is dropped with error log
- Max retries exceeded → entity still works, just no embeddings
- Content update triggers re-chunking (old chunks deleted, new chunks created)
- Non-content update (archive, last_used_at) does NOT trigger embedding
- Hard-delete cleans up associated chunks
- Soft-delete preserves chunks
- Restore does NOT re-trigger embedding (chunks still valid)
- Worker handles entity not found (deleted between enqueue and execution)
- Worker handles concurrent updates (entity changed while embedding was in progress)
- Graceful shutdown: SIGTERM finishes in-progress jobs before exiting
- Concurrency: multiple jobs process in parallel up to semaphore limit
- Job serialization round-trip: enqueue → dequeue → parse works with UUID strings

---

## Milestone 5: Vector Search + Hybrid RRF

### Goal & Outcome
Implement vector similarity search and combine it with existing FTS using Reciprocal Rank Fusion. After this milestone:
- Search queries run both FTS and vector search
- Results are merged using RRF scoring
- Items matching both keyword and meaning rank highest
- Search works transparently — no user-facing toggle
- Items without embeddings still appear via FTS (graceful degradation)

### Implementation Outline

**Vector search function** (`services/content_service.py` or new `services/vector_search_service.py`):

```python
async def vector_search(
    db: AsyncSession,
    user_id: UUID,
    query_embedding: list[float],
    entity_types: list[str] | None = None,
    limit: int = 100,
) -> list[tuple[str, UUID, float]]:
    """Find nearest chunks by cosine similarity.
    Returns (entity_type, entity_id, distance) tuples, deduplicated by entity.
    """
```

- Query: `SELECT entity_type, entity_id, embedding <=> :query_vec AS distance FROM content_chunks WHERE user_id = :uid AND embedding IS NOT NULL ORDER BY distance LIMIT :limit`
- Deduplicate by entity (multiple chunks from same entity → best score wins)

**Hybrid search with RRF:**

```python
async def hybrid_search(db, user_id, query, embedding_service, limit=20):
    # 1. FTS search (existing)
    fts_results = await fts_search(db, user_id, query, limit=100)

    # 2. Embed the query
    query_embedding = await embedding_service.embed_single(query)

    # 3. Vector search
    vec_results = await vector_search(db, user_id, query_embedding, limit=100)

    # 4. RRF merge
    k = 60
    scores = {}
    for rank, item in enumerate(fts_results):
        scores[(item.entity_type, item.entity_id)] = 1.0 / (k + rank)
    for rank, (entity_type, entity_id, _) in enumerate(vec_results):
        key = (entity_type, entity_id)
        scores[key] = scores.get(key, 0) + 1.0 / (k + rank)

    # 5. Return merged, sorted by combined score
    ...
```

**Integration with `search_all_content()`:**
- When a query is provided and embeddings are configured: use hybrid search
- When a query is provided but embeddings are not configured: fall back to FTS-only (current behavior)
- When no query: no change (browse/filter mode)

**Graceful degradation:**
- If embedding API is down during search → fall back to FTS-only (log warning)
- If a specific entity has no embeddings → it can still appear via FTS
- If no entities have embeddings yet (fresh deploy, backfill pending) → FTS-only

### Testing Strategy
- Vector search returns nearest neighbors by cosine similarity
- Vector search is scoped to user_id (multi-tenant isolation)
- RRF scoring: item in both FTS and vector results scores higher than item in only one
- RRF scoring: item in only FTS still appears in results
- RRF scoring: item in only vector results still appears in results
- Hybrid search falls back to FTS when embedding API is unavailable
- Hybrid search falls back to FTS when embeddings not configured
- Items without embeddings still appear via FTS path
- Entity type filtering works in vector search
- Deduplication: multiple chunks from same entity → entity appears once with best score
- Empty query → no vector search triggered (browse mode)
- Search with all stop words → handled gracefully (existing stop-word guard)

---

## Milestone 6: Backfill + Stale Embedding Detection

### Goal & Outcome
Embed all existing content and detect when embeddings become stale. After this milestone:
- A CLI command backfills embeddings for all existing content
- A periodic task detects and re-embeds stale content (content changed after last embedding)
- Monitoring: can query how many entities are pending/stale

### Implementation Outline

**Backfill command** (`tasks/backfill_embeddings.py`):

```python
async def backfill_embeddings(
    db: AsyncSession,
    batch_size: int = 50,
    entity_types: list[str] | None = None,
):
    """Embed all entities that have no chunks or stale chunks.

    - Finds entities with no rows in content_chunks, or where
      entity.updated_at > max(chunks.embedded_at)
    - Processes in batches to respect API rate limits
    - Idempotent: safe to run multiple times
    """
```

- Run as: `python -m tasks.backfill_embeddings`
- Batch entities, chunk each, embed chunks, store — same logic as the Celery task but sequential
- Rate limiting: pause between batches to respect API limits
- Progress logging: `Processed 50/345 entities...`

**Stale detection** (add to existing `tasks/cleanup.py` or new periodic task):
- Query: entities where `updated_at > (SELECT MAX(embedded_at) FROM content_chunks WHERE entity_id = ...)`
- Enqueue `embed_entity` Celery tasks for stale entities
- Run as part of the daily cleanup cron, or as a separate periodic task

**Monitoring query:**
```sql
-- Entities without embeddings
SELECT entity_type, count(*) FROM (
    SELECT 'bookmark' as entity_type, id FROM bookmarks WHERE deleted_at IS NULL
    AND id NOT IN (SELECT entity_id FROM content_chunks WHERE entity_type = 'bookmark')
    UNION ALL ...
) pending GROUP BY entity_type;
```

### Testing Strategy
- Backfill processes all entities without chunks
- Backfill skips entities that already have current chunks
- Backfill handles empty database (no entities)
- Backfill respects entity_types filter
- Backfill is idempotent (running twice produces same result)
- Stale detection finds entities updated after their last embedding
- Stale detection ignores non-content updates (need to track which fields changed — or just re-embed, it's cheap)
- Backfill handles API failures gracefully (skips failed entities, continues)
- Progress logging works correctly
- Batch size is respected

---

## Dependency Chain

```
Milestone 1 (schema)
    ↓
Milestone 2 (chunking) ──→ Milestone 3 (embedding API)
                                  ↓
                          Milestone 4 (async worker + Redis queue)
                                  ↓
                          Milestone 5 (search + RRF)
                                  ↓
                          Milestone 6 (backfill + stale detection)
```

Milestones 2 and 3 are independent of each other and could be done in parallel.

---

## References

- [OpenAI Embeddings API](https://platform.openai.com/docs/guides/embeddings) — embedding model docs, batch limits, pricing
- [pgvector GitHub](https://github.com/pgvector/pgvector) — vector types, operators, index options
- [pgvector SQLAlchemy integration](https://github.com/pgvector/pgvector-python) — `Vector` column type, query patterns
- [redis-py async docs](https://redis-py.readthedocs.io/en/stable/examples/asyncio_examples.html) — async Redis client, BRPOP
- [tiktoken](https://github.com/openai/tiktoken) — token counting for chunk sizing
- `docs/implementation_plans/future-search.md` — original search roadmap (Phases 2-3)
