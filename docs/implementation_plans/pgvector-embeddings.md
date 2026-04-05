# Semantic Search: pgvector Embeddings Implementation Plan

## Context

- **FTS (Phase 1) is complete** — `search_vector` tsvector columns, GIN indexes, `ts_rank` scoring, combined FTS + ILIKE. See `future-search.md`.
- **pgvector is enabled** on production (0.8.2) and available in local dev.
- **Goal:** Add semantic/meaning-based search so "auth" finds documents about "login flow" and "OAuth." Complements FTS keyword matching.
- **Key decisions:**
  - Chunking from the start (not deferred to a later phase)
  - 512 tokens per chunk, no overlap, paragraph-based greedy combining
  - Per-entity strategy: prompts get a single embedding (typically short), notes and bookmarks use paragraph-based chunking, bookmarks also get a summary embedding
  - Async embedding via custom async worker using Redis BRPOPLPUSH (not Celery — see Milestone 4 for rationale)
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

Custom async worker using Redis BRPOPLPUSH (crash-safe delivery). One always-on Railway service, 4 concurrent jobs (asyncio semaphore), logs only for monitoring. Dead letter queue for permanently failed jobs. See Milestone 4 for full rationale and implementation.

### 4. Tier Gating

Semantic/vector search is Pro tier only. FTS remains available to all users.

**On tier downgrade (Pro → Free):** Existing embeddings are preserved but dormant — not used for search, not updated on edits. On re-upgrade, stale detection (M6) handles any content that changed while on the free tier. This avoids wasteful re-embedding on re-upgrade.

### 5. API Key Management

- `OPENAI_API_KEY` stored as Railway environment variable
- Added to `core/config.py` Settings class
- Graceful degradation: if not configured, vector search is unavailable, FTS still works

---

## Milestone 1: Content Chunks Table + Embedding Storage

### Goal & Outcome
Set up the database schema for storing chunked content and their embeddings. After this milestone:
- `content_chunks` table exists with vector column and HNSW index
- `content_embedding_state` table tracks per-entity embedding lifecycle
- Alembic migration enables pgvector extension and creates both tables
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

- Create `content_embedding_state` table:

```python
# Per-entity embedding lifecycle tracking (one row per entity)
content_embedding_state:
    id              UUID PK (UUIDv7)
    entity_type     String (bookmark/note/prompt)
    entity_id       UUID (unique together with entity_type)
    body_hash       Text (SHA-256 of full embeddable text — for skip-if-unchanged)
    active_body_hash Text (nullable — hash of the currently active chunk generation; null = no embeddings yet)
    model           Text (embedding model used, e.g. "text-embedding-3-small")
    status          String (pending/embedding/embedded/failed)
    last_error      Text (nullable — error message on last failure)
    embedded_at     DateTime (nullable — last successful embedding)
    created_at      DateTime
    updated_at      DateTime
```

- Unique constraint on `(entity_type, entity_id)`
- Index on `status` for finding pending/failed entities (M6 backfill/stale detection)

This table keeps embedding lifecycle state out of the entity models. The `active_body_hash` field enables crash-safe re-embedding: new chunks are inserted with a new `body_hash`, then `active_body_hash` is updated atomically — old chunks are only deleted after the new generation is active. See M4 for the swap mechanism.

**SQLAlchemy models:**
- `models/content_chunk.py`: Uses `UUIDv7Mixin`, `TimestampMixin`. `embedding` column uses pgvector's `Vector(1536)` type from `pgvector.sqlalchemy`. Relationship to User (for query scoping).
- `models/content_embedding_state.py`: Uses `UUIDv7Mixin`, `TimestampMixin`. One row per entity.

**Dependency:** Add `pgvector` Python package to `pyproject.toml` (provides `pgvector.sqlalchemy` for the `Vector` type).

### Testing Strategy
- Migration runs cleanly on fresh database (testcontainers with pgvector image)
- Migration runs cleanly on database where extension is already enabled (production scenario)
- `Vector` column accepts and returns float arrays of correct dimensionality
- HNSW index is created (query `pg_indexes`)
- Verify `content_chunks` table constraints: user_id FK, non-null fields
- Verify chunk insertion and retrieval round-trip with embedding data
- `content_embedding_state` unique constraint on `(entity_type, entity_id)` enforced
- State row creation and update round-trip

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
- A long-running worker process listens for embedding jobs via Redis BRPOPLPUSH (crash-safe delivery)
- Saving/updating an entity enqueues an embedding job
- The worker chunks the content, calls the embedding API, and stores results in `content_chunks`
- Re-embedding uses a two-phase swap (insert new, then promote) — never deletes old chunks before new ones are ready
- Failed jobs retry with exponential backoff (max 3 retries); permanently failed jobs go to a dead letter queue
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

**Database sessions:** The worker runs as a separate process, not inside FastAPI. It creates its own sessions via `get_session_factory()` from `db/session.py` (not FastAPI's `get_async_session()` dependency). The worker manages its own commit/rollback per job.

**Redis integration:** Queue primitives (LPUSH, BRPOPLPUSH) should be added to the existing `RedisClient` wrapper in `core/redis.py` rather than using raw `redis.asyncio` directly. This maintains a single Redis usage pattern across the codebase.

**Worker service** (`worker/main.py`):

```python
import asyncio
import json
import logging
import signal

from core.config import get_settings
from core.redis import get_redis_client
from db.session import get_session_factory

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
CONCURRENCY = 4  # max concurrent embedding API calls

async def process_job(job_data: dict):
    """Chunk and embed an entity's content (two-phase swap).

    1. Load entity from DB
    2. Compute body_hash (SHA-256 of embeddable text)
    3. Check content_embedding_state — if body_hash matches active_body_hash → skip
    4. Update state: status = 'embedding'
    5. Chunk the content (chunking service)
    6. Call embedding API for all chunks (embedding service)
    7. INSERT new chunks into content_chunks (with new body_hash)
    8. Update state: active_body_hash = new body_hash, status = 'embedded'
    9. DELETE old chunks where body_hash != active_body_hash
    10. Steps 7-9 in a single transaction — old chunks survive until new ones are committed

    If the worker crashes between 7 and 9, old chunks remain active (active_body_hash
    still points to them). New orphan chunks (with non-active body_hash) are cleaned
    up by the stale detection task (M6).
    """
    ...

async def worker_loop():
    settings = get_settings()
    redis = get_redis_client()
    sem = asyncio.Semaphore(CONCURRENCY)
    shutdown = asyncio.Event()
    tasks = set()  # track in-flight tasks for clean shutdown

    def handle_signal():
        logger.info("Shutdown signal received, finishing current jobs...")
        shutdown.set()

    loop = asyncio.get_event_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, handle_signal)

    # On startup, reclaim any stale jobs from the processing queue
    # (left behind by a previous crash)
    await reclaim_stale_processing_jobs(redis)

    logger.info("Embedding worker started (concurrency=%d)", CONCURRENCY)

    while not shutdown.is_set():
        # BRPOPLPUSH atomically moves job from embed_jobs to embed_jobs_processing
        # Job stays in processing queue until explicitly removed on success
        raw = await redis.brpoplpush("embed_jobs", "embed_jobs_processing", timeout=5)
        if raw is None:
            continue  # timeout — check shutdown flag and loop

        async def handle(raw_data):
            async with sem:
                try:
                    data = json.loads(raw_data)
                    await process_job(data)
                    # Success — remove from processing queue
                    await redis.lrem("embed_jobs_processing", 1, raw_data)
                except Exception as e:
                    data = json.loads(raw_data) if isinstance(raw_data, (str, bytes)) else {}
                    retries = data.get("retries", 0)
                    # Remove from processing queue regardless
                    await redis.lrem("embed_jobs_processing", 1, raw_data)
                    if retries < MAX_RETRIES:
                        data["retries"] = retries + 1
                        delay = 2 ** retries  # 1s, 2s, 4s
                        await asyncio.sleep(delay)
                        await redis.lpush("embed_jobs", json.dumps(data))
                        logger.warning("Retrying job (attempt %d): %s", retries + 1, e)
                    else:
                        # Dead letter — permanently failed, inspectable
                        await redis.lpush("embed_jobs_dead", json.dumps(data))
                        logger.error("Job failed after %d retries: %s", MAX_RETRIES, e, exc_info=True)

        t = asyncio.create_task(handle(raw))
        tasks.add(t)
        t.add_done_callback(tasks.discard)

    # Wait for in-flight tasks to complete before shutting down
    if tasks:
        logger.info("Waiting for %d in-flight tasks...", len(tasks))
        await asyncio.gather(*tasks, return_exceptions=True)

    logger.info("Embedding worker shut down")
```

**Enqueue helper** (add to `core/redis.py` or `worker/enqueue.py`):

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

Integration points (all 6 must be wired):
- `bookmark_service.create()` — after flush
- `bookmark_service.update()` — after flush, only if content fields changed
- `note_service.create()` — after flush
- `note_service.update()` — after flush, only if content fields changed
- `prompt_service.create()` — after flush
- `prompt_service.update()` — after flush, only if content fields changed

**Chunk lifecycle (two-phase swap):**
- On entity update: check `content_embedding_state.active_body_hash` → if unchanged, skip. Otherwise insert new chunks, update `active_body_hash`, delete old chunks — all in one transaction. Entity always has valid embeddings (old or new), never zero.
- On entity hard-delete: delete all chunks and the state row for that entity
- On soft-delete: leave chunks in place (entity might be restored)

**Concurrent job deduplication:** If two jobs arrive for the same entity (rapid successive edits), the `body_hash` check in `content_embedding_state` is the natural deduplication. The second job computes the hash, finds it matches `active_body_hash` (set by the first job), and skips. No explicit job dedup needed.

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
- Worker respects max retries — after 3 failures, job goes to dead letter queue
- Max retries exceeded → entity retains old embeddings (two-phase swap), just no updated ones
- Body hash unchanged → skip embedding entirely (no API calls, no DB writes)
- Two-phase swap: new chunks inserted before old ones deleted; entity always has valid embeddings
- Worker crash mid-embedding → old chunks remain active, new orphan chunks cleaned by M6
- content_embedding_state updated correctly: status transitions (pending → embedding → embedded/failed)
- Non-content update (archive, last_used_at) does NOT trigger embedding
- Hard-delete cleans up associated chunks and state row
- Soft-delete preserves chunks
- Restore does NOT re-trigger embedding (chunks still valid)
- Worker handles entity not found (deleted between enqueue and execution)
- Duplicate jobs for same entity: second job skips via body_hash check
- Malformed job data (bad JSON) → logged error, not crash
- Dead letter: permanently failed job appears in `embed_jobs_dead` with error context
- BRPOPLPUSH: job moves to processing queue before execution, removed on success
- Worker startup reclaims stale jobs from processing queue (crash recovery)
- Graceful shutdown: SIGTERM waits for in-flight tasks before exiting
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

**Vector search function** (`services/vector_search_service.py`):

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

The whole point of semantic search is **recall** — finding "login flow" when the user searches "auth." If we only rerank FTS results, we never surface items that FTS missed. RRF merge preserves recall while respecting filters.

```python
async def hybrid_search(
    db, user_id, query, embedding_service,
    tags, tag_match, view, filter_expression, content_types,
    sort_by, sort_order, offset, limit,
):
    # 1. Run existing search_all_content() pipeline (FTS + all filters)
    fts_results, fts_total = await search_all_content(
        db, user_id, query, tags=tags, tag_match=tag_match,
        view=view, filter_expression=filter_expression,
        content_types=content_types,
        sort_by="relevance", sort_order="desc",
        offset=0, limit=100,  # overfetch for RRF merge
    )

    # 2. Embed the query
    query_embedding = await embedding_service.embed_single(query)

    # 3. Vector search (scoped to user_id + entity_types only)
    vec_results = await vector_search(db, user_id, query_embedding,
                                       entity_types=content_types, limit=100)

    # 4. Filter-check vector-only results
    # Vector results not in the FTS set may violate tag/view/filter constraints.
    # Do a lightweight filter check on this small set (~10-20 entities) before including.
    vec_only = [r for r in vec_results if (r.entity_type, r.entity_id) not in fts_set]
    vec_only_filtered = await filter_check(db, user_id, vec_only, tags, tag_match, view, filter_expression)

    # 5. RRF merge
    k = 60
    scores = {}
    for rank, item in enumerate(fts_results):
        scores[(item.entity_type, item.entity_id)] = 1.0 / (k + rank)
    for rank, (entity_type, entity_id, _) in enumerate(vec_results_filtered):
        key = (entity_type, entity_id)
        scores[key] = scores.get(key, 0) + 1.0 / (k + rank)

    # 6. Sort by combined RRF score, then paginate
    merged = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    page = merged[offset:offset + limit]

    # 7. Hydrate into ContentListItem shape (load full entity data for the page)
    ...
```

**Key design choices:**
- FTS runs through the existing `search_all_content()` pipeline with all filters applied — tag, view, content type, filter expression. No filter logic is duplicated.
- Vector search runs a separate query scoped to user_id + entity_types. It does not apply tag/view/filter constraints (HNSW can't do this efficiently).
- Vector-only results (semantic matches that FTS missed) get a lightweight filter check before entering the RRF merge. This is a small query on ~10-20 entities — trivial cost.
- RRF merge and pagination happen **before** hydrating full entity data. Only the final page of results is loaded.

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

**Known scaling limitation:** pgvector's HNSW index scans globally across all users, then post-filters by `user_id`. At current scale (beta, small user count) this is fine. At larger scale, two options:
1. **Overfetch + post-filter** (current approach): Set a higher HNSW limit (e.g., 500) to compensate for filtered-out rows. Works for moderate user counts.
2. **Partitioned tables**: Partition `content_chunks` by `user_id` with per-partition HNSW indexes. PostgreSQL 17 supports this natively. Required if user count grows significantly.

**TODO:** Embedding the query adds ~200-500ms latency per search request (OpenAI API round-trip). Evaluate whether this is acceptable, or if query embedding caching is needed for common/repeated queries.

### Testing Strategy
- Vector search returns nearest neighbors by cosine similarity
- Vector search is scoped to user_id (multi-tenant isolation)
- RRF scoring: item in both FTS and vector results scores higher than item in only one
- RRF scoring: item in only FTS still appears in results
- RRF scoring: vector-only result (semantic match FTS missed) appears in results after filter check
- Vector-only result that violates tag/view filter is excluded from merge
- Hybrid search respects all existing filters: tags, tag_match, view, content_types, filter_expression
- Pagination on merged results works correctly (offset/limit applied after RRF merge)
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
- Query `content_embedding_state` for entities where `active_body_hash` doesn't match the hash of current embeddable content, or where status = 'failed', or where no state row exists
- Enqueue embedding jobs to Redis for stale entities (same queue the async worker listens to)
- Run as part of the daily cleanup cron, or as a separate periodic task
- Only checks Pro tier users
- Also serves as safety net for worker crashes and extended API outages

**Orphan chunk cleanup:**
- Delete chunks where `body_hash` doesn't match the `active_body_hash` in `content_embedding_state` for that entity. These are leftover from crashed two-phase swaps (M4) where new chunks were inserted but the swap never completed.
- Can run as part of stale detection or as a separate cleanup step.

**Monitoring query:**
```sql
-- Embedding status overview (Pro tier users only)
SELECT status, count(*) FROM content_embedding_state
WHERE entity_type IN ('bookmark', 'note', 'prompt')
GROUP BY status;

-- Entities with no embedding state at all
SELECT entity_type, count(*) FROM (
    SELECT 'bookmark' as entity_type, id FROM bookmarks
    WHERE deleted_at IS NULL
    AND id NOT IN (SELECT entity_id FROM content_embedding_state WHERE entity_type = 'bookmark')
    UNION ALL ...
) pending GROUP BY entity_type;
```

### Testing Strategy
- Backfill processes all Pro tier entities without embedding state
- Backfill skips entities where active_body_hash matches current content
- Backfill skips free tier users' content
- Backfill handles empty database (no entities)
- Backfill respects entity_types filter
- Backfill is idempotent (running twice produces same result)
- Stale detection finds entities where active_body_hash doesn't match current content
- Stale detection picks up entities with status = 'failed'
- Stale detection enqueues jobs to Redis (not direct embedding)
- Orphan chunk cleanup removes chunks from crashed swaps
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
