# Semantic Search: pgvector Embeddings Implementation Plan

## Context

- **FTS (Phase 1) is complete** — `search_vector` tsvector columns, GIN indexes, `ts_rank` scoring, combined FTS + ILIKE. See `future-search.md`.
- **pgvector is enabled** on production (0.8.2) and available in local dev.
- **Goal:** Add semantic/meaning-based search so "auth" finds documents about "login flow" and "OAuth." Complements FTS keyword matching.
- **Key decisions:**
  - Chunking from the start (not deferred to a later phase)
  - 512 tokens per chunk, no overlap, paragraph-based greedy combining
  - Per-entity strategy: prompts get a single embedding (typically short), notes and bookmarks use paragraph-based chunking, bookmarks also get a summary embedding
  - Async embedding via custom async worker using Redis BRPOP (not Celery — see Milestone 4 for rationale)
  - Re-embedding on content change: document-level hash check (skip if unchanged) + full re-chunk/re-embed when content changes. Incremental re-embedding (ADIRE) is deferred — see `docs/implementation_plans/adire-anchor-diffed-incremental-re-embedding.md`

## pgvector Setup

**Production:**
- Upgraded Railway `postgres-ssl` image from `:17.1` → `:17.9` (via Railway's built-in update button). The `:17.9` image includes `postgresql-17-pgvector`, added to the `postgres-ssl` image on 2026-03-14.
- Enabled extension: `CREATE EXTENSION IF NOT EXISTS vector;` — pgvector 0.8.2 on PostgreSQL 17.9.
- No data migration was needed — persistent volume preserved through image update.

**Local development:**
- `docker-compose.yml`: `postgres:16` → `pgvector/pgvector:pg17`
- `backend/tests/conftest.py`: `PostgresContainer("postgres:16", ...)` → `PostgresContainer("pgvector/pgvector:pg17", ...)`

**Key learnings:**
- Railway does not auto-update database images. Use the dashboard update button or redeploy to pull a newer tag.
- pgvector binaries are part of the Docker image, not the data directory. Updating the image makes the extension available without affecting existing data.

## Decisions

### 1. Embedding Model

OpenAI `text-embedding-3-small` (1536 dims, $0.02/1M tokens). Good quality/cost/storage balance. 1536 dims × 4 bytes × 30M vectors (10K users × 300 items × 10 chunks) = ~180GB.

### 2. Chunking Strategy

- **512 tokens per chunk, no overlap.** Benchmark-validated sweet spot (Vectara NAACL 2025, Vecta 2026). No overlap — 2026 research found no measurable recall benefit, and dropping it simplifies content hashing.
- **Paragraph-based greedy combining:** Split on `\n\n`, combine adjacent paragraphs up to 512 tokens. If a single paragraph exceeds 512 tokens, split at fixed 512-token boundaries.
- **Per-entity strategy:**
  - **Prompts:** No chunking — single embedding (typically short, under 512 tokens)
  - **Notes:** Paragraph-based greedy combining at 512 tokens
  - **Bookmarks:** Same as notes, plus a summary embedding (title + first paragraph + meta description) for broad queries
- **Small content:** If total tokens < 512, embed as a single chunk (no splitting).
- **Re-embedding:** Document-level hash check (`body_hash` SHA-256 of full embeddable text). If unchanged on save, skip all embedding work. If changed, delete all chunks and re-embed from scratch. Cost is negligible (~$0.0005 for a max-size 100K note). Incremental re-embedding (ADIRE) is deferred — see `docs/implementation_plans/adire-anchor-diffed-incremental-re-embedding.md`.

### 3. Worker Infrastructure

Custom async worker using `redis.asyncio` BRPOP. One always-on Railway service, 4 concurrent jobs (asyncio semaphore), logs only for monitoring. See Milestone 4 for full rationale and implementation.

### 4. Tier Gating

Semantic/vector search is Pro tier only. FTS remains available to all users.

### 5. API Key Management

- `OPENAI_API_KEY` stored as Railway environment variable
- Added to `core/config.py` Settings class
- Graceful degradation: if not configured, vector search is unavailable, FTS still works

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
    content_hash    Text (SHA-256 of chunk text — for change detection / future ADIRE optimization)
    model           Text (embedding model that generated the vector, e.g. "text-embedding-3-small")
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
- **TODO:** Verify that pgvector HNSW supports partial indexes (`WHERE` clause). If not, either drop the partial condition or use IVFFlat instead.
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
- Chunking uses paragraph-based greedy combining at 512 tokens, no overlap
- Prompts produce a single chunk (no splitting)
- Bookmarks produce chunks plus a separate summary embedding
- Chunks include the entity's title as context prefix

### Implementation Outline

**Chunking service** (`services/chunking_service.py`):

```python
@dataclass
class Chunk:
    index: int
    text: str
    token_count: int
    is_summary: bool = False  # True for bookmark summary embeddings

def chunk_entity(
    entity_type: str,
    title: str | None,
    description: str | None,
    content: str | None,
    max_chunk_tokens: int = 512,
) -> list[Chunk]:
    """Split entity content into embeddable chunks.

    - Builds embedding input from entity fields
    - Prompts: always a single chunk (no splitting)
    - Notes/Bookmarks: paragraph-based greedy combining at max_chunk_tokens
    - Bookmarks: also produce a summary chunk (title + first paragraph + description)
    - If total tokens < max_chunk_tokens: return single chunk
    """
```

**Token counting:** Use `tiktoken` (OpenAI's tokenizer) for accurate token counts matching the embedding model. Add to dependencies.

**Chunking algorithm:**
1. Build full text from entity fields (see entity-specific handling below).
2. Count tokens. If under `max_chunk_tokens` → single chunk, return early.
3. Split content on `\n\n` (paragraphs). Title goes in every chunk as prefix.
4. Greedily combine adjacent paragraphs until approaching `max_chunk_tokens`.
5. If a single paragraph exceeds `max_chunk_tokens`, split at fixed 512-token boundaries.
6. No overlap between chunks.

**Entity-specific handling:**
- **Prompts:** Use `name + title + description + content`. Always a single chunk — no splitting regardless of size (prompts are typically short).
- **Notes:** Use `title + description + content`. Paragraph-based chunking as described above.
- **Bookmarks:** Use `title + description + content`. Paragraph-based chunking as described above, plus a **summary chunk** (`is_summary=True`) composed of `title + first paragraph + description/meta`. The summary chunk handles broad "find that article about X" queries; the content chunks handle specific detail queries.

### Testing Strategy
- Short content (under 512 tokens) → single chunk
- Content exactly at 512-token boundary → correct behavior
- Long content splits on paragraph boundaries
- Very long single paragraph splits at fixed 512-token boundaries
- Many short paragraphs (e.g., bullet list) are combined into chunks up to 512 tokens
- Title prefix appears in every chunk
- Empty content → single chunk with just title/description
- Null fields handled gracefully
- Token counts are accurate (verify against tiktoken directly)
- Prompts always produce a single chunk regardless of size
- Bookmarks produce content chunks plus a summary chunk
- Bookmark summary chunk contains title + first paragraph + description
- Unicode content chunks correctly
- Very large content (100K note) produces reasonable number of chunks (~49 at 512 tokens)
- No overlap between adjacent chunks

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
├── Cron: cleanup (daily, python -m tasks.cleanup)              ← not yet deployed, not part of this plan
├── Cron: orphan relationships (weekly, python -m tasks.orphan_relationships --delete)  ← not yet deployed, not part of this plan
└── Cron: cost aggregation (future — daily, python -m tasks.aggregate_costs)            ← not yet deployed, not part of this plan
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
    2. Compute body_hash (SHA-256 of embeddable text)
    3. If body_hash matches stored hash → skip (nothing changed)
    4. Delete existing chunks for this entity
    5. Chunk the content (chunking service)
    6. Call embedding API for all chunks (embedding service)
    7. Store chunks + embeddings in content_chunks
    8. Update entity body_hash
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
- On entity update: compute body_hash → if unchanged, skip. Otherwise delete all existing chunks, re-chunk, re-embed.
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
- Body hash unchanged → skip embedding entirely (no API calls, no DB writes)
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

### Deployment (after M1-M4 are tested locally)

Deploy the embedding pipeline to production. This is the only milestone that introduces a new Railway service.

1. **Add `OPENAI_API_KEY`** to Railway shared env vars (new external dependency)
2. **Run Alembic migration** on production (`alembic upgrade head`) to create `content_chunks` table (M1)
3. **Deploy API** with the updated codebase (chunking service, embedding service, enqueue helper)
4. **Create Railway service** for the embedding worker:
   - Same Docker image / repo as the API
   - Start command: `python -m worker.main`
   - Env vars: inherits `DATABASE_URL`, `REDIS_URL` from shared vars, plus `OPENAI_API_KEY`
   - Always-on (not a cron job)
5. **Verify** the worker is running and processing jobs (check logs for "Embedding worker started")
6. **Test end-to-end**: save an entity on production, confirm chunks + embeddings appear in `content_chunks`

Milestones 5 and 6 are code changes to the existing API and a CLI command — no additional services needed.

---

## Milestone 5: Vector Search + Hybrid RRF

### Goal & Outcome
Implement vector similarity search and combine it with existing FTS using Reciprocal Rank Fusion. After this milestone:
- Search queries run both FTS and vector search (Pro tier only)
- Results are merged using RRF scoring
- Items matching both keyword and meaning rank highest
- Search works transparently — no user-facing toggle
- Free tier users get FTS only (current behavior, unchanged)
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

**Tier gating:**
- Hybrid search (FTS + vector) is Pro tier only
- Free tier users always get FTS-only (current behavior, no code change needed for them)
- Check user tier before embedding the query — skip vector search path entirely for free tier

**Integration with `search_all_content()`:**
- When Pro user + query provided + embeddings configured: use hybrid search
- When Free user, or embeddings not configured: FTS-only (current behavior)
- When no query: no change (browse/filter mode)

**Graceful degradation:**
- If embedding API is down during search → fall back to FTS-only (log warning)
- If a specific entity has no embeddings → it can still appear via FTS
- If no entities have embeddings yet (fresh deploy, backfill pending) → FTS-only

**TODO:** Embedding the query adds ~200-500ms latency per search request (OpenAI API round-trip). Evaluate whether this is acceptable, or if query embedding caching is needed for common/repeated queries.

### Testing Strategy
- Vector search returns nearest neighbors by cosine similarity
- Vector search is scoped to user_id (multi-tenant isolation)
- RRF scoring: item in both FTS and vector results scores higher than item in only one
- RRF scoring: item in only FTS still appears in results
- RRF scoring: item in only vector results still appears in results
- Hybrid search falls back to FTS when embedding API is unavailable
- Hybrid search falls back to FTS when embeddings not configured
- Free tier user → FTS-only, no vector search or embedding API call
- Items without embeddings still appear via FTS path
- Entity type filtering works in vector search
- Deduplication: multiple chunks from same entity → entity appears once with best score
- Empty query → no vector search triggered (browse mode)
- Search with all stop words → handled gracefully (existing stop-word guard)

---

## Milestone 6: Backfill + Stale Embedding Detection

### Goal & Outcome
Embed all existing content and detect when embeddings become stale. After this milestone:
- A CLI command backfills embeddings for all existing Pro tier content
- A periodic task detects and re-embeds stale content (body_hash mismatch)
- Monitoring: can query how many entities are pending/stale

### Implementation Outline

**Backfill command** (`tasks/backfill_embeddings.py`):

```python
async def backfill_embeddings(
    db: AsyncSession,
    batch_size: int = 50,
    entity_types: list[str] | None = None,
):
    """Embed all Pro tier entities that have no chunks or stale chunks.

    - Finds Pro tier entities with no rows in content_chunks, or where
      body_hash doesn't match the hash of current content
    - Processes in batches to respect API rate limits
    - Idempotent: safe to run multiple times
    """
```

- Run as: `python -m tasks.backfill_embeddings`
- Only processes Pro tier users' content (no point embedding for free tier)
- Batch entities, chunk each, embed chunks, store — same logic as the async worker but sequential
- Rate limiting: pause between batches to respect API limits
- Progress logging: `Processed 50/345 entities...`

**Stale detection** (add to existing `tasks/cleanup.py` or new periodic task):
- Query: entities where `body_hash` doesn't match the hash of current embeddable content (or where no chunks exist)
- Enqueue embedding jobs to Redis for stale entities (same queue the async worker listens to)
- Run as part of the daily cleanup cron, or as a separate periodic task
- Only checks Pro tier users

**Monitoring query:**
```sql
-- Entities without embeddings (Pro tier users only)
SELECT entity_type, count(*) FROM (
    SELECT 'bookmark' as entity_type, id FROM bookmarks WHERE deleted_at IS NULL
    AND id NOT IN (SELECT entity_id FROM content_chunks WHERE entity_type = 'bookmark')
    UNION ALL ...
) pending GROUP BY entity_type;
```

### Testing Strategy
- Backfill processes all Pro tier entities without chunks
- Backfill skips entities that already have current chunks (body_hash matches)
- Backfill skips free tier users' content
- Backfill handles empty database (no entities)
- Backfill respects entity_types filter
- Backfill is idempotent (running twice produces same result)
- Stale detection finds entities where body_hash doesn't match current content
- Stale detection enqueues jobs to Redis (not direct embedding)
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
