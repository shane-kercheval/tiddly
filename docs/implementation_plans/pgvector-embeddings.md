# Semantic Search: pgvector Embeddings Implementation Plan

## Context

- **FTS (Phase 1) is complete** — `search_vector` tsvector columns, GIN indexes, `ts_rank` scoring, combined FTS + ILIKE. See `future-search.md`.
- **pgvector is enabled** on production (0.8.2) and available in local dev.
- **Goal:** Add semantic/meaning-based search so "auth" finds documents about "login flow" and "OAuth." Complements FTS keyword matching.
- **Key decisions:**
  - Chunking from the start (not deferred to a later phase)
  - Paragraph-level chunking: one paragraph = one chunk, with paragraph-hash-based reuse on re-embedding (95%+ savings on typical edits)
  - Oversized paragraphs (>2048 tokens) split at fixed 512-token boundaries
  - Per-entity strategy: prompts get a single embedding (typically short), notes and bookmarks use paragraph-level chunking
  - Async embedding via custom async worker using Redis BLMOVE (not Celery — see Milestone 4 for rationale)
  - Re-embedding on content change: document-level hash check (skip if unchanged) + paragraph-hash diff (only embed new/changed paragraphs)

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

- **Paragraph-level chunking with reuse.** Each paragraph (`\n\n`-separated) becomes its own chunk. Paragraphs are hashed independently — on re-embedding, only paragraphs with changed hashes are re-embedded. This is cascade-resistant (inserting a paragraph at the top doesn't invalidate downstream hashes) and saves 95%+ of embedding API calls on typical edits to large notes. See ADIRE simulation results (`ADIRE/docs/analysis-results.md`) for the empirical validation.
- **Oversized paragraph handling:** Paragraphs over 2048 tokens (~8K characters) are split at fixed 512-token boundaries. This handles pasted content / structureless blobs. Typical prose paragraphs are 150-250 tokens and are never split.
- **Token counting:** Approximate (`len(text) // 4`), not tiktoken. Exact counts aren't needed — paragraph boundaries determine chunks, and the 2048-token threshold is a generous guard rail. tiktoken is CPU-bound and synchronous, unsuitable for the async worker.
- **Per-entity strategy:**
  - **Prompts:** No chunking — single embedding (typically short)
  - **Notes:** Paragraph-level chunking as described above
  - **Bookmarks:** Same as notes (summary embedding deferred to post-v1 if needed)
- **Re-embedding:** Document-level hash check (`body_hash` SHA-256 of full embeddable text). If unchanged on save, skip entirely. If changed, diff paragraph hashes against stored hashes — only embed new/changed paragraphs, delete removed ones. Per-edit cost savings are 95%+ for typical edits at 25K+ characters.

### 3. Worker Infrastructure

Custom async worker using Redis BLMOVE (crash-safe delivery). One always-on Railway service, 4 concurrent jobs (asyncio semaphore), logs only for monitoring. Dead letter queue for permanently failed jobs. See Milestone 4 for full rationale and implementation.

### 4. Tier Gating

Semantic/vector search is Pro tier only. FTS remains available to all users.

**On tier downgrade (Pro → Free):** Delete all embeddings (`content_chunks`) and embedding state (`content_embedding_state`) for the user. These are internal search infrastructure, not user data — user content is untouched. On re-upgrade, backfill/stale detection (M6) re-embeds automatically. See KAN-109.

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
- **Verified:** pgvector 0.8.2 on pg17 supports partial HNSW indexes (`WHERE embedding IS NOT NULL`). Tested locally 2026-04-05.
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
    model           Text (embedding model used, e.g. "text-embedding-3-small")
    status          String (pending/embedding/embedded/failed)
    last_error      Text (nullable — error message on last failure)
    embedded_at     DateTime (nullable — last successful embedding)
    created_at      DateTime
    updated_at      DateTime
```

- Unique constraint on `(entity_type, entity_id)`
- Index on `status` for finding pending/failed entities (M6 backfill/monitoring)

This table keeps embedding lifecycle state out of the entity models. The `body_hash` field enables the skip-if-unchanged fast path — if the hash matches, no work is needed.

**Crash safety:** The worker executes chunk inserts, chunk deletes, and state updates in a single DB transaction. If the worker crashes before commit, the transaction rolls back and the DB is unchanged — `body_hash` still mismatches, so the next job retries from scratch. If the worker crashes after commit, everything is consistent. There is no window where search sees a mix of old and new chunks.

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
- A chunking service can take any entity (note, bookmark, prompt) and produce a list of paragraph-level chunks
- Each paragraph becomes its own chunk, with an independent hash for reuse tracking
- Oversized paragraphs (>2048 tokens) are split at 512-token boundaries
- Prompts produce a single chunk (no splitting)
- Bookmarks produce paragraph chunks (summary embedding deferred — title prefix on first chunk serves as a broad search signal for v1)

### Implementation Outline

**Chunking service** (`services/chunking_service.py`):

```python
@dataclass
class Chunk:
    index: int
    text: str
    content_hash: str  # SHA-256 of normalized paragraph text
    token_count: int   # approximate: len(text) // 4

def chunk_entity(
    entity_type: str,
    title: str | None,
    description: str | None,
    content: str | None,
) -> list[Chunk]:
    """Split entity content into paragraph-level chunks.

    - Builds embedding input from entity fields
    - Prompts: always a single chunk (no splitting)
    - Notes/Bookmarks: one chunk per paragraph (\n\n separated)
    - Oversized paragraphs (>2048 tokens) split at 512-token boundaries
    - Each chunk has a content_hash for paragraph-level reuse on re-embedding
    """
```

**Token counting:** Approximate (`len(text) // 4`). No tiktoken dependency — exact counts aren't needed since paragraph boundaries determine chunks, not a token budget. The 2048-token oversized threshold is a generous guard rail, not a precision boundary.

**Chunking algorithm:**
1. Build full text from entity fields (see entity-specific handling below).
2. Split content on `\n\n` → paragraphs. Hash each paragraph (SHA-256 of normalized text).
3. Each paragraph becomes its own chunk.
4. If a paragraph exceeds 2048 tokens (~8K characters), split it at fixed 512-token boundaries. Each sub-chunk gets its own hash.
5. Prepend entity title to each chunk's text for search context.

**Entity-specific handling:**
- **Prompts:** Use `name + title + description + content`. Always a single chunk — no splitting regardless of size (prompts are typically short).
- **Notes:** Use `title + description + content`. Paragraph-level chunking as described above.
- **Bookmarks:** Use `title + description + content`. Paragraph-level chunking as described above. Title prefix on each chunk serves as a broad search signal. A separate summary embedding may be added later if bookmark search quality is lacking — it's just another row in `content_chunks`, no schema changes needed.

### Testing Strategy
- Short content (single paragraph) → single chunk
- Multi-paragraph content → one chunk per paragraph
- Each chunk has a unique content_hash
- Oversized paragraph (>2048 tokens) splits at 512-token boundaries
- Normal-sized paragraphs (even 500+ tokens) are NOT split — only the 2048 threshold triggers splitting
- Title prefix appears in every chunk
- Empty content → single chunk with just title/description
- Null fields handled gracefully
- Prompts always produce a single chunk regardless of size
- Bookmarks produce paragraph chunks with title prefix (no separate summary chunk)
- Unicode content chunks correctly
- Content hashes are stable (same text → same hash regardless of surrounding content)
- Very large content (100K note) produces one chunk per paragraph (~125-250 chunks depending on paragraph size)

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
- A long-running worker process listens for embedding jobs via Redis BLMOVE (crash-safe delivery)
- Saving/updating an entity enqueues an embedding job
- The worker chunks the content into paragraphs, diffs paragraph hashes against stored chunks, and only embeds new/changed paragraphs
- Failed jobs retry with exponential backoff (max 3 retries); permanently failed jobs go to a dead letter queue

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

**Redis integration:** Queue primitives (LPUSH, BLMOVE) should be added to the existing `RedisClient` wrapper in `core/redis.py` rather than using raw `redis.asyncio` directly. This maintains a single Redis usage pattern across the codebase.

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
    """Chunk and embed an entity's content (paragraph-level reuse).

    1. Load entity from DB
    2. Compute body_hash (SHA-256 of full embeddable text)
    3. Check content_embedding_state — if body_hash matches → skip (nothing changed)
    4. Update state: status = 'embedding'
    5. Split content into paragraphs, hash each (chunking service)
    6. Load existing chunk content_hashes for this entity from DB
    7. Diff: new hashes not in old set → need embedding. Old hashes not in new set → delete.
    8. Call embedding API only for new/changed paragraphs
    9. In a SINGLE TRANSACTION:
       - INSERT new chunks
       - DELETE removed chunks
       - UPDATE content_embedding_state: body_hash, status = 'embedded'
       All three operations commit atomically.

    Crash safety:
    - Crash before step 9 commit → transaction rolls back, DB unchanged.
      body_hash still mismatches → next job retries from scratch.
    - Crash after step 9 commit → everything is consistent.
    - No window where search sees a mix of old and new chunks.
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
        # BLMOVE atomically moves job from embed_jobs to embed_jobs_processing
        # Job stays in processing queue until explicitly removed on success
        raw = await redis.blmove("embed_jobs", "embed_jobs_processing", "RIGHT", "LEFT", timeout=5)
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
                        # Re-enqueue immediately — don't sleep under semaphore.
                        # Job goes to back of queue, providing natural delay.
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

**Chunk lifecycle (paragraph-level reuse):**
- On entity update: check `content_embedding_state.body_hash` → if unchanged, skip. Otherwise diff paragraph hashes: insert new paragraphs, delete removed paragraphs, leave unchanged paragraphs in place. Entity retains all unchanged chunk embeddings throughout.
- On entity hard-delete: delete all chunks and the state row for that entity. Integration points:
  - `bookmark_service.hard_delete()` — delete chunks + state where entity_type='bookmark' and entity_id matches
  - `note_service.hard_delete()` — same for notes
  - `prompt_service.hard_delete()` — same for prompts
- On soft-delete: leave chunks in place (entity might be restored)

**Concurrent job deduplication:** If two jobs arrive for the same entity (rapid successive edits), the `body_hash` check in `content_embedding_state` is the natural deduplication. The second job computes the hash, finds it matches (set by the first job), and skips. No explicit job dedup needed.

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
- Max retries exceeded → entity retains existing chunk embeddings, just no updated ones
- Body hash unchanged → skip embedding entirely (no API calls, no DB writes)
- Paragraph-level reuse: only new/changed paragraphs are embedded, unchanged paragraphs keep their embeddings
- Chunk diff + state update execute in single transaction — no mixed chunk state visible to search
- Worker crash before transaction commit → DB unchanged, body_hash mismatch triggers retry
- Worker crash after transaction commit → everything consistent, no retry needed
- Crash-window test: commit chunk diff, simulate crash before body_hash update, rerun job → no duplicate chunks, no stale chunks, state repaired
- content_embedding_state updated correctly: status transitions (pending → embedding → embedded/failed)
- Non-content update (archive, last_used_at) does NOT trigger embedding
- Hard-delete cleans up associated chunks and state row
- Soft-delete preserves chunks
- Restore does NOT re-trigger embedding (chunks still valid)
- Worker handles entity not found (deleted between enqueue and execution)
- Duplicate jobs for same entity: second job skips via body_hash check
- Malformed job data (bad JSON) → logged error, not crash
- Dead letter: permanently failed job appears in `embed_jobs_dead` with error context
- BLMOVE: job moves to processing queue before execution, removed on success
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

**Sort mode scoping:**
- Hybrid search (RRF merge) activates **only when `sort_by="relevance"`**. This is the only mode where semantic ranking adds value.
- All other sort modes (`created_at`, `updated_at`, `title`, etc.) use FTS-only — the user wants chronological/alphabetical order, not semantic ranking.
- Total count for hybrid search = count of the merged candidate set (FTS results ∪ filter-passing vector results).

**Integration with `search_all_content()`:**
- When Pro user + query provided + `sort_by="relevance"` + embeddings configured: use hybrid search
- When `sort_by` != `"relevance"`, Free user, or embeddings not configured: FTS-only (current behavior)
- When no query: no change (browse/filter mode)

**Graceful degradation:**
- If embedding API is down during search → fall back to FTS-only (log warning)
- If a specific entity has no embeddings → it can still appear via FTS
- If no entities have embeddings yet (fresh deploy, backfill pending) → FTS-only

**Known scaling limitation:** pgvector's HNSW index scans globally across all users, then post-filters by `user_id`. At current scale (beta, small user count) this is fine. Mitigations for larger scale:
1. **Overfetch + post-filter** (current approach): Set a higher HNSW limit (e.g., 500) to compensate for filtered-out rows. Also set `SET hnsw.ef_search = 200` at session level to increase the HNSW candidate pool. Works for moderate user counts.
2. **Partitioned tables**: Partition `content_chunks` by `user_id` with per-partition HNSW indexes. PostgreSQL 17 supports this natively. Required if user count grows significantly.

**Query embedding cache:** Embedding the query adds ~200-500ms latency per search request (OpenAI API round-trip). To mitigate, cache query embeddings in Redis:
- Key: `embed_cache:{model}:{hash(normalized_query)}` — model name in the key prevents cache poisoning across model changes.
- Query normalization: lowercase, strip whitespace before hashing.
- TTL: 1 hour.
- On cache hit, skip the OpenAI call entirely. First search for a novel query pays the latency; subsequent identical queries are instant.

### Testing Strategy
- Vector search returns nearest neighbors by cosine similarity
- Vector search is scoped to user_id (multi-tenant isolation)
- RRF scoring: item in both FTS and vector results scores higher than item in only one
- RRF scoring: item in only FTS still appears in results
- RRF scoring: vector-only result (semantic match FTS missed) appears in results after filter check
- Vector-only result that violates tag/view filter is excluded from merge
- Hybrid search respects all existing filters: tags, tag_match, view, content_types, filter_expression
- Pagination on merged results works correctly (offset/limit applied after RRF merge)
- sort_by="relevance" → hybrid search with RRF merge
- sort_by="created_at" (or any non-relevance sort) → FTS-only, no vector search
- Hybrid search falls back to FTS when embedding API is unavailable
- Hybrid search falls back to FTS when embeddings not configured
- Free tier user → FTS-only, no vector search or embedding API call
- Query embedding cache: second identical query skips OpenAI call (cache hit)
- Query embedding cache key includes model name (model change doesn't poison cache)
- Items without embeddings still appear via FTS path
- Entity type filtering works in vector search
- Deduplication: multiple chunks from same entity → entity appears once with best score
- Empty query → no vector search triggered (browse mode)
- Search with all stop words → handled gracefully (existing stop-word guard)

---

## Milestone 6: Backfill + Monitoring

### Goal & Outcome
Embed all existing content and provide monitoring for embedding health. After this milestone:
- A CLI command backfills embeddings for all existing Pro tier content
- Monitoring queries can check how many entities are pending/stale/failed
- Orphan chunks from crashed swaps are cleaned up

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

**Orphan chunk cleanup** (add to backfill command or run separately):
- Delete chunks for entities that no longer exist (hard-deleted entities whose chunks weren't cleaned up).
- Delete chunks for entities where `content_embedding_state.status = 'failed'` and the chunk data may be incomplete from a crashed worker run.
- Run as part of the backfill command (`--cleanup` flag) or as a separate manual step.

**Monitoring queries** (run manually via `railway run` or DB console as needed):

No automated stale detection cron job for now. The worker + retry + dead letter queue handles normal operations. If stale entities accumulate (visible via monitoring queries), re-run the backfill command — it's idempotent and catches stale content. Add a periodic cron later if manual monitoring proves insufficient.
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
- Backfill skips entities where body_hash matches current content
- Backfill skips free tier users' content
- Backfill handles empty database (no entities)
- Backfill respects entity_types filter
- Backfill is idempotent (running twice produces same result)
- Backfill also catches stale content (body_hash doesn't match current content)
- Backfill picks up entities with status = 'failed'
- Orphan chunk cleanup removes chunks for deleted entities and failed states
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
                          Milestone 6 (backfill + monitoring)
```

Milestones 2 and 3 are independent of each other and could be done in parallel.

---

## References

- [OpenAI Embeddings API](https://platform.openai.com/docs/guides/embeddings) — embedding model docs, batch limits, pricing
- [pgvector GitHub](https://github.com/pgvector/pgvector) — vector types, operators, index options
- [pgvector SQLAlchemy integration](https://github.com/pgvector/pgvector-python) — `Vector` column type, query patterns
- [redis-py async docs](https://redis-py.readthedocs.io/en/stable/examples/asyncio_examples.html) — async Redis client, BRPOP
- [ADIRE simulation results](../implementation_plans/adire-anchor-diffed-incremental-re-embedding.md) — empirical validation of paragraph-level reuse strategy
- `docs/implementation_plans/future-search.md` — original search roadmap (Phases 2-3)
