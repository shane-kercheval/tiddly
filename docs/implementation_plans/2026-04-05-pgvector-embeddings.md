# Semantic Search: pgvector Embeddings Implementation Plan

## Context

- **FTS (Phase 1) is complete** — `search_vector` tsvector columns, GIN indexes, `ts_rank` scoring, combined FTS + ILIKE. See `future-search.md`.
- **pgvector is enabled** on production (0.8.2) and available in local dev.
- **Goal:** Add semantic/meaning-based search so "auth" finds documents about "login flow" and "OAuth." Complements FTS keyword matching.
- **Key decisions:**
  - Chunking from the start (not deferred to a later phase)
  - Two chunk types: `metadata` (title + description + name) and `content` (paragraph text only). Metadata edits don't invalidate content chunks.
  - Paragraph-level reuse on content chunks: hash-based set lookup (not diffing), cascade-resistant, 95%+ savings on typical edits
  - Oversized paragraphs (>2048 tokens) split at fixed 512-token boundaries
  - All entity types (notes, bookmarks, prompts) use the same chunking algorithm — no special cases
  - Async embedding via custom async worker using Redis BLMOVE (not Celery — see Milestone 4 for rationale)
  - Post-commit enqueue: embedding jobs are pushed to Redis only after the DB transaction commits, not after flush
  - Re-embedding on content change: two-level hash check (metadata_hash + content_hash) + paragraph-hash set lookup (reuse existing embeddings by hash, only embed new paragraphs)
  - Staleness check includes model — if embedding model changes, all content is re-embedded

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

- **Two chunk types per entity:**
  - **`metadata` chunk** (one per entity): Canonical format with labeled fields, only including non-empty values:
    ```
    Name: ...        (prompts only)
    Title: ...
    Description: ...
    ```
    Hashed independently. Metadata edits only re-embed this one chunk — content chunks are unaffected.
  - **`content` chunks** (one per paragraph): Raw paragraph text only, no title prefix. Each paragraph hashed independently for reuse. This is cascade-resistant (inserting a paragraph doesn't invalidate downstream hashes) and saves 95%+ of embedding API calls on typical edits. See ADIRE simulation results for empirical validation.
- **`chunk_index` is scoped per `chunk_type`:** metadata is always index 0, content paragraphs are 0..N.
- **Oversized paragraph handling:** Paragraphs over 2048 tokens (~8K characters) are split at fixed 512-token boundaries. This handles pasted content / structureless blobs. Typical prose paragraphs are 150-250 tokens and are never split.
- **Token counting:** Approximate (`len(text) // 4`), not tiktoken. Exact counts aren't needed — paragraph boundaries determine chunks, and the 2048-token threshold is a generous guard rail. tiktoken is CPU-bound and synchronous, unsuitable for the async worker.
- **All entity types use the same chunking algorithm.** Notes, bookmarks, and prompts all produce a metadata chunk + content chunks. No special cases — short prompts naturally produce one content chunk.
- **Re-embedding:** Two-level fast-path checks via `content_embedding_state`:
  - `metadata_hash` (SHA-256 of canonical metadata text) — if unchanged, skip metadata chunk
  - `content_hash` (SHA-256 of full content field) — if unchanged, skip all content chunks
  - `model` — if embedding model changed since last embed, treat everything as stale regardless of hash matches
  - Both hashes match AND model matches → entire job is a no-op
  - If content changed: load existing chunk embeddings as `{content_hash: embedding}` dict, look up each new paragraph hash — reuse embedding if found, embed if not. Delete all old chunks, insert all new chunks (with reused or fresh embeddings) in a single transaction.
  - Cascade-resistant: paragraph hashes are independent of position, so inserting a paragraph doesn't invalidate any existing embeddings.
  - Per-edit cost savings are 95%+ for typical edits at 25K+ characters.

### 3. Consistency Model

**Semantic search freshness is eventually consistent.** The primary operation is always the entity save — embedding is secondary. If Redis is unavailable during the post-commit callback, the entity is saved successfully but the embedding job is silently dropped. The entity will have no `content_embedding_state` row (or a stale one), so the backfill command (M6) catches it on the next manual run. This is an explicit product tradeoff: we never fail a user's save due to embedding infrastructure issues, and we accept that semantic search results may be temporarily stale.

### 4. Worker Infrastructure

Custom async worker using Redis BLMOVE (crash-safe delivery). One always-on Railway service, 4 concurrent jobs (asyncio semaphore), logs only for monitoring. Worker heartbeat written to Redis each loop iteration (`embed_worker:heartbeat` key with 30s TTL) for liveness detection. Dead letter queue for permanently failed jobs. See Milestone 4 for full rationale and implementation.

### 4. Tier Gating

Semantic/vector search is Pro tier only. FTS remains available to all users.

**v1 (this plan):** Enforce at query time only — Pro users get hybrid search, Free users get FTS-only. No destructive cleanup on downgrade in v1 (no billing event source exists yet).

**Later (KAN-109):** When billing/tier-change events exist, delete all embeddings (`content_chunks`) and embedding state (`content_embedding_state`) for the user on downgrade. These are internal search infrastructure, not user data — user content is untouched. On re-upgrade (KAN-110), backfill re-embeds automatically.

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
    chunk_type      String (metadata/content)
    chunk_index     Integer (scoped per chunk_type: metadata always 0, content 0..N)
    chunk_text      Text (the actual chunk content)
    token_count     Integer (for debugging/monitoring)
    content_hash    Text (SHA-256 of chunk text — for paragraph-level reuse)
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
- Unique constraint on `(entity_type, entity_id, chunk_type, chunk_index)` — defense-in-depth against duplicate chunks from concurrent workers
- Index on `(entity_type, entity_id)` for chunk lookup/deletion
- Index on `user_id` for scoped search queries
- Index on `embedded_at` for finding stale/pending chunks

- Create `content_embedding_state` table:

```python
# Per-entity embedding lifecycle tracking (one row per entity)
content_embedding_state:
    id              UUID PK (UUIDv7)
    user_id         UUID FK → users.id (for user-scoped operations: downgrade cleanup, Pro-only backfill, monitoring)
    entity_type     String (bookmark/note/prompt)
    entity_id       UUID (unique together with entity_type)
    metadata_hash   Text (SHA-256 of canonical metadata text — for skip-if-unchanged on title/description/name edits)
    content_hash    Text (SHA-256 of full content field — for skip-if-unchanged on content edits)
    model           Text (embedding model used, e.g. "text-embedding-3-small")
    status          String (pending/embedded/failed) — no 'embedding' state; status transitions atomically in same transaction as chunk writes
    last_error      Text (nullable — error message on last failure)
    embedded_at     DateTime (nullable — last successful embedding)
    created_at      DateTime
    updated_at      DateTime
```

- Unique constraint on `(entity_type, entity_id)`
- Index on `user_id` for downgrade cleanup and Pro-only queries
- Index on `status` for finding pending/failed entities (M6 backfill/monitoring)

This table keeps embedding lifecycle state out of the entity models. Three fields enable the fast-path skip check:
- `metadata_hash` matches → skip metadata chunk re-embedding
- `content_hash` matches → skip all content chunk processing
- `model` matches current configured model → embeddings are compatible
- All three match → entire job is a no-op
- If `model` doesn't match (embedding model upgraded), treat everything as stale regardless of hash matches

**Crash safety:** The worker executes chunk inserts, chunk deletes, and state updates in a single DB transaction. If the worker crashes before commit, the transaction rolls back and the DB is unchanged — hashes still mismatch, so the next job retries from scratch. If the worker crashes after commit, everything is consistent. There is no window where search sees a mix of old and new chunks.

**SQLAlchemy models:**
- `models/content_chunk.py`: Uses `UUIDv7Mixin`, `TimestampMixin`. `embedding` column uses pgvector's `Vector(1536)` type from `pgvector.sqlalchemy`. Relationship to User (for query scoping).
- `models/content_embedding_state.py`: Uses `UUIDv7Mixin`, `TimestampMixin`. One row per entity.
- Both models must be added as relationships on the `User` model with `cascade="all, delete-orphan"` — matching the existing pattern for bookmarks, notes, prompts, etc. This ensures user deletion automatically cleans up chunks and state.

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
Implement the logic that splits entity content into metadata and content chunks. After this milestone:
- A chunking service can take any entity (note, bookmark, prompt) and produce chunks
- One `metadata` chunk per entity (title + description + name where applicable)
- One `content` chunk per paragraph, with an independent hash for reuse tracking
- Oversized paragraphs (>2048 tokens) are split at 512-token boundaries
- All entity types use the same algorithm — no special cases

### Implementation Outline

**Chunking service** (`services/chunking_service.py`):

```python
@dataclass
class Chunk:
    chunk_type: str    # "metadata" or "content"
    index: int         # scoped per chunk_type: metadata=0, content=0..N
    text: str
    content_hash: str  # SHA-256 of normalized text
    token_count: int   # approximate: len(text) // 4

def chunk_entity(
    entity_type: str,
    title: str | None,
    description: str | None,
    content: str | None,
    name: str | None = None,  # prompts only
) -> list[Chunk]:
    """Split entity content into metadata + content chunks.

    Returns:
    - One metadata chunk: canonical format with labeled fields (only non-empty)
    - N content chunks: one per paragraph (\n\n separated)
    - Oversized paragraphs (>2048 tokens) split at 512-token boundaries
    - All entity types use the same algorithm
    """
```

**Token counting:** Approximate (`len(text) // 4`). No tiktoken dependency — exact counts aren't needed since paragraph boundaries determine chunks, not a token budget. The 2048-token oversized threshold is a generous guard rail, not a precision boundary.

**Metadata chunk format:** Canonical labeled fields, only including non-empty values:
```
Name: {name}
Title: {title}
Description: {description}
```
Stability of this format matters for hash consistency — don't change field order or formatting.

**Chunking algorithm:**
1. Build metadata chunk from entity fields (canonical format above). Hash the metadata text.
2. Split `content` on `\n\n` → paragraphs. Hash each paragraph (SHA-256 of normalized text).
3. Each paragraph becomes its own `content` chunk (index 0..N).
4. If a paragraph exceeds 2048 tokens (~8K characters), split it at fixed 512-token boundaries. Each sub-chunk gets its own hash.
5. No title prefix on content chunks — title/description are in the metadata chunk.

**Entity-specific handling:**
- **Prompts:** Metadata chunk includes `name + title + description`. Content chunks from `content` field. Same algorithm as notes/bookmarks.
- **Notes:** Metadata chunk includes `title + description`. Content chunks from `content` field.
- **Bookmarks:** Same as notes. The bookmark `summary` field is deliberately excluded — it is not currently populated in the product. Can be added to the metadata chunk later if summary generation is implemented.

### Testing Strategy
- Every entity produces exactly one metadata chunk (chunk_type="metadata", index=0)
- Multi-paragraph content → one content chunk per paragraph (chunk_type="content", index=0..N)
- Entity with no content → metadata chunk only
- Entity with empty title/description → metadata chunk with only non-empty fields
- Metadata chunk format is canonical (labeled fields, stable order)
- Each content chunk has a unique content_hash based on paragraph text only (not title)
- Metadata hash changes when title/description change but content hashes don't
- Oversized paragraph (>2048 tokens) splits at 512-token boundaries
- Normal-sized paragraphs (even 500+ tokens) are NOT split — only the 2048 threshold triggers splitting
- Prompts use same algorithm as notes — no special case, large prompts get chunked
- Null fields handled gracefully
- Unicode content chunks correctly
- Content hashes are stable (same text → same hash regardless of surrounding content or title changes)
- Very large content (100K) produces one chunk per paragraph (~125-250 chunks depending on paragraph size)

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
- Embedding API returns wrong dimensionality → clear `EmbeddingError` with expected vs actual dims (not cryptic DB error from pgvector rejecting the vector)
- Mock the OpenAI client for unit tests (don't call the real API in CI)

---

## Milestone 4: Async Embedding Worker

### Goal & Outcome
Set up a custom async worker service that processes embedding jobs from a Redis queue. After this milestone:
- A long-running worker process listens for embedding jobs via Redis BLMOVE (crash-safe delivery)
- Saving/updating an entity enqueues an embedding job
- The worker chunks the content into paragraphs, looks up paragraph hashes against stored chunks (hash-based set lookup, not diffing), and only embeds paragraphs with new hashes
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

**Redis integration:** Queue primitives (LPUSH, BLMOVE, ZADD, ZRANGEBYSCORE) should be added to the existing `RedisClient` wrapper in `core/redis.py` rather than using raw `redis.asyncio` directly. This includes a `promote_delayed_jobs()` method backed by a Lua script for atomic sorted-set-to-list promotion (matching the existing `evalsha`/`script_load` pattern for rate limiting). This maintains a single Redis usage pattern across the codebase.

**Worker service** (`worker/main.py`):

```python
import asyncio
import json
import logging
import signal
import time

from core.config import get_settings
from core.redis import get_redis_client
from db.session import get_session_factory

logger = logging.getLogger(__name__)

MAX_RETRIES = 3
CONCURRENCY = 4  # max concurrent embedding API calls

async def process_job(job_data: dict):
    """Chunk and embed an entity's content (paragraph-level reuse via hash lookup).

    1. Load entity from DB (if not found — entity deleted between enqueue and execution — skip silently)
    2. Upsert content_embedding_state row (INSERT ON CONFLICT DO NOTHING) then SELECT ... FOR UPDATE
       to serialize concurrent workers for the same entity
    3. Compute metadata_hash (SHA-256 of canonical metadata text)
    4. Compute content_hash (SHA-256 of full content field)
    5. Check state: if metadata_hash, content_hash, AND model all match → no-op, return early
    6. For metadata (if hash or model changed): build metadata chunk, embed it
    7. For content (if hash or model changed):
       - Split content into paragraphs, hash each
       - Load existing content chunks as {content_hash: embedding} dict
       - For each new paragraph: if hash exists in dict → reuse embedding, else → need to embed
       - Call embedding API only for paragraphs with new hashes (one batch call)
    8. In a SINGLE TRANSACTION:
       - DELETE all old chunks for this entity
       - INSERT all new chunks (metadata + content, with reused or fresh embeddings, correct indexes)
       - UPDATE content_embedding_state: metadata_hash, content_hash, model, status = 'embedded'
       All operations commit atomically — including the status update.
       No separate 'embedding' status commit.

    Paragraph reuse is cascade-resistant: hashes are based on paragraph text only, independent
    of position. Inserting a paragraph doesn't invalidate any existing embeddings — they're
    looked up by hash, not by index.

    Duplicate paragraphs (same text at different positions) reuse the same embedding vector
    (same text = same vector). Each gets its own chunk row with a distinct chunk_index.

    Crash safety:
    - Crash before step 8 commit → transaction rolls back, DB unchanged.
      Hashes still mismatch → next job retries from scratch.
    - Crash after step 8 commit → everything is consistent.
    - No window where search sees a mix of old and new chunks.
    - No 'embedding' status that can get stranded — status transitions directly from
      prior state to 'embedded' (or 'failed') in one atomic commit.

    On failure (embedding API error): status set to 'failed', last_error recorded
    (in a separate small transaction). Existing chunks from prior successful embedding
    are PRESERVED — search continues using last-good data. Failed status is picked up
    by backfill (M6) for retry.
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
        # Worker heartbeat — liveness signal for monitoring
        await redis.setex("embed_worker:heartbeat", 30, str(time.time()))

        # Promote ready delayed jobs to the main queue (atomic via Lua script)
        # Selects jobs from embed_jobs_delayed where score <= now, removes them,
        # and pushes them to embed_jobs. Uses the existing evalsha/script_load
        # pattern in core/redis.py for atomicity.
        await redis.promote_delayed_jobs("embed_jobs_delayed", "embed_jobs")

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
                    # Success — remove from processing queue by job_id
                    await redis.lrem("embed_jobs_processing", 1, raw_data)
                except Exception as e:
                    data = json.loads(raw_data) if isinstance(raw_data, (str, bytes)) else {}
                    retries = data.get("retries", 0)
                    # Remove from processing queue regardless
                    await redis.lrem("embed_jobs_processing", 1, raw_data)
                    if retries < MAX_RETRIES:
                        data["retries"] = retries + 1
                        not_before = time.time() + (2 ** retries)  # 1s, 2s, 4s
                        # Add to delayed queue (sorted set keyed by not_before)
                        await redis.zadd("embed_jobs_delayed", {json.dumps(data): not_before})
                        logger.warning("Retrying job (attempt %d, delay %ds): %s", retries + 1, 2 ** retries, e)
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
        "job_id": str(uuid7()),  # unique ID for LREM acknowledgment
        "entity_type": entity_type,
        "entity_id": entity_id,
        "user_id": user_id,
    }))
```

**Triggering from service layer (post-commit):**

Embedding jobs must be enqueued **after the DB transaction commits**, not after `flush()`. This prevents the worker from seeing uncommitted or rolled-back data.

Implementation: services register enqueue callbacks in `session.info["post_commit_callbacks"]` (a list stored on SQLAlchemy's session info dict). In `get_async_session()`, after `await session.commit()` succeeds, execute all callbacks. On rollback, the callbacks are never executed. This is ~10 lines of code in the session dependency — no external libraries needed.

**Callback failure policy:** Post-commit callbacks are **fire-and-forget**. If Redis is unavailable, log a warning and continue — the entity save already succeeded. The entity will lack a `content_embedding_state` row (or have a stale one), so the backfill command (M6) catches it. A callback exception must never turn a successful save into a 500 response. See "Consistency Model" in Decisions section.

- Do NOT call on archive/unarchive/soft-delete — content hasn't changed
- Only trigger when content-relevant fields change (title, description, content, summary, name)

Integration points (all 9 must be wired):

Service layer (6):
- `bookmark_service.create()` — register post-commit enqueue
- `bookmark_service.update()` — register post-commit enqueue, only if content fields changed
- `note_service.create()` — register post-commit enqueue
- `note_service.update()` — register post-commit enqueue, only if content fields changed
- `prompt_service.create()` — register post-commit enqueue
- `prompt_service.update()` — register post-commit enqueue, only if content fields changed

str_replace router endpoints (3) — these modify entity.content directly in the router, bypassing the service update path. MCP servers use str_replace heavily for AI agent edits:
- `bookmarks.py` str_replace endpoint — register post-commit enqueue after content modification
- `notes.py` str_replace endpoint — same
- `prompts.py` str_replace endpoint — same

**Chunk lifecycle (paragraph-level reuse via hash lookup):**
- On entity update: check `content_embedding_state` — metadata_hash, content_hash, and model. If all match → no-op. If metadata changed → re-embed metadata chunk. If content changed → load existing chunks as `{content_hash: embedding}` dict, look up each new paragraph hash, reuse embeddings where found, embed new paragraphs only. Delete all old chunks, insert all new chunks (with correct indexes and reused/fresh embeddings) in a single transaction. Cascade-resistant — hashes are independent of position.
- On failure: existing chunks preserved (last-good data). Status set to 'failed'. Backfill (M6) retries later.
- On entity hard-delete: delete all chunks and the state row for that entity. Integration points:
  - `BaseEntityService.delete(permanent=True)` — add chunk + state cleanup before `await db.delete(entity)`. This is the centralized hard-delete path; individual services don't override it.
  - `tasks/cleanup.py` `cleanup_soft_deleted_items()` — this permanently deletes expired soft-deleted entities via direct SQLAlchemy delete (bypassing BaseEntityService). Must also delete chunks + state before `await db.delete(item)`, matching the existing pattern of deleting history before the entity.
- On soft-delete: leave chunks in place (entity might be restored)

**Concurrent job serialization:** The worker acquires `SELECT ... FOR UPDATE` on the `content_embedding_state` row at step 2. This serializes concurrent workers for the same entity — the second worker blocks until the first commits. After acquiring the lock, the hash check determines whether work is needed. Combined with the unique constraint on `content_chunks(entity_type, entity_id, chunk_type, chunk_index)`, this provides defense-in-depth against duplicate chunks.

**Railway deployment:**
- New service using the same Docker image, different start command:
  ```
  python -m worker.main
  ```
- Uses same `DATABASE_URL`, `REDIS_URL`, and `OPENAI_API_KEY` as the API
- Always-on service (not a cron job)

### Testing Strategy

This is critical infrastructure — the embedding pipeline touches every content mutation, runs as a separate process, and coordinates across Redis and Postgres. Testing must cover correctness at every layer.

**Testing infrastructure:**
- **Testcontainers for both Redis and Postgres** (pgvector image). All integration tests run against real instances, not mocks. The codebase already uses testcontainers for Postgres; extend the same pattern for Redis.
- **Mock embedding API** for unit and integration tests — don't call OpenAI in CI. Use `respx` (already in dev dependencies) or a simple mock that returns deterministic vectors.
- **Worker test harness**: a helper that runs the worker loop for a controlled number of iterations or until the queue is empty, then stops. Avoids needing to manage background processes in tests.

**Test categories:**

**1. Unit tests (no Redis, no Postgres):**
- Chunking service: paragraph splitting, hash computation, metadata format, oversized paragraph handling
- Hash stability: same text → same hash regardless of context
- Canonical metadata format: field ordering, empty field handling
- Token count approximation: `len(text) // 4` produces reasonable estimates

**2. Redis queue integration tests (real Redis via testcontainers, no Postgres):**
- Enqueue → BLMOVE → job arrives in processing queue with correct data
- Job serialization round-trip: enqueue → dequeue → parse preserves all fields including job_id
- LREM acknowledgment: processed job removed from processing queue by raw payload
- Delayed queue: failed job goes to `embed_jobs_delayed` sorted set with correct score
- Delayed queue promotion: Lua script atomically moves ready jobs to main queue, leaves future jobs untouched
- Delayed queue under load: multiple delayed jobs with different not_before values promoted in correct order
- No spin loop: with only delayed (not-yet-ready) jobs, worker loop blocks on BLMOVE timeout — does not busy-loop
- Dead letter: job exceeding MAX_RETRIES lands in `embed_jobs_dead` with error context
- Crash recovery: jobs left in `embed_jobs_processing` (simulating crash) are reclaimed on worker startup
- BLMOVE atomicity: job disappears from main queue and appears in processing queue in one operation

**3. Worker integration tests (real Redis + real Postgres via testcontainers, mock embedding API):**
- Happy path: enqueue job → worker processes → metadata chunk + content chunks appear in DB with correct embeddings, hashes, indexes
- Paragraph-level reuse: edit one paragraph → only that paragraph re-embedded, unchanged paragraphs keep old embeddings (verify by checking embedding vectors are identical)
- Metadata-only edit (title change): only metadata chunk re-embedded, all content chunks preserved
- Content-only edit: only changed content chunks re-embedded, metadata chunk preserved
- Both hashes + model unchanged → no-op (no API calls, no DB writes, no chunks modified)
- Model mismatch → full re-embed regardless of hash matches
- Duplicate paragraphs: document with repeated text → correct number of chunks, each with distinct chunk_index
- Oversized paragraph: paragraph >2048 tokens → split at 512-token boundaries, each sub-chunk embedded
- Entity not found (deleted between enqueue and execution) → job skipped silently, no error
- Embedding API failure → status set to 'failed', last_error recorded, existing chunks preserved (last-good)
- Retry with exponential backoff: first failure → delayed 1s, second → 2s, third → 4s, then dead letter
- Max retries exceeded → dead letter queue, entity retains last-good embeddings
- Malformed job data (bad JSON) → logged error, worker continues processing other jobs

**4. Transaction safety tests (real Redis + real Postgres):**
- Single transaction: chunk inserts + deletes + state update commit atomically — verify by checking DB state before and after
- Worker crash before commit (simulate by raising exception after embedding but before commit) → DB unchanged, hashes mismatch, retry succeeds
- Worker crash after commit → everything consistent, retry is a no-op
- Unique constraint: attempt to insert duplicate `(entity_type, entity_id, chunk_type, chunk_index)` → DB rejects
- SELECT FOR UPDATE serialization: two concurrent jobs for same entity → second blocks until first commits, then skips (hashes match)
- Rapid successive edits: three jobs for same entity → first processes fully, second and third skip via hash match after lock release

**5. Post-commit enqueue tests (real Redis + real Postgres):**
- Entity create via service → post-commit callback fires → job appears in Redis
- Entity update (content changed) via service → job enqueued
- Entity update (no content change, e.g., archive) → no job enqueued
- str_replace endpoint → post-commit callback fires → job appears in Redis
- Request rollback after flush (simulate by raising exception after flush but before commit) → no job in Redis
- session.info["post_commit_callbacks"] cleared between requests (no leakage)

**6. Hard-delete cleanup tests (real Postgres):**
- `BaseEntityService.delete(permanent=True)` → chunks and state row deleted before entity
- `tasks/cleanup.py` `cleanup_soft_deleted_items()` → chunks and state deleted for expired soft-deleted entities
- User deletion (cascade) → all chunks and state rows for that user automatically deleted

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
- **Note:** The `WHERE user_id` clause is a **post-filter** applied after the HNSW approximate nearest-neighbor scan, not an index-selective condition. HNSW scans globally across all users' vectors, then Postgres filters. See scaling limitation note below.
- Deduplicate by entity (multiple chunks from same entity → best score wins)

**Hybrid search with RRF:**

The whole point of semantic search is **recall** — finding "login flow" when the user searches "auth." If we only rerank FTS results, we never surface items that FTS missed. RRF merge preserves recall while respecting filters.

```python
async def hybrid_search(
    db, user_id, query, embedding_service,
    tags, tag_match, view, filter_expression, content_types,
    sort_by, sort_order, offset, limit,
):
    # 1. Run FTS and query embedding concurrently (hides FTS latency behind embedding latency)
    fts_coro = search_all_content(
        db, user_id, query, tags=tags, tag_match=tag_match,
        view=view, filter_expression=filter_expression,
        content_types=content_types,
        sort_by="relevance", sort_order="desc",
        offset=0, limit=100,  # overfetch for RRF merge
    )
    embed_coro = embedding_service.embed_single(query)  # check cache first
    (fts_results, fts_total), query_embedding = await asyncio.gather(fts_coro, embed_coro)

    # 2. Vector search (scoped to user_id + entity_types, overfetch 200 for filter headroom)
    vec_results = await vector_search(db, user_id, query_embedding,
                                       entity_types=content_types, limit=200)

    # 3. Filter-check vector-only results (only if user has active filters)
    # Reuse existing search pipeline with entity_ids whitelist — no parallel filter engine.
    fts_set = {(r.entity_type, r.entity_id) for r in fts_results}
    vec_only_ids = [(r.entity_type, r.entity_id) for r in vec_results if (r.entity_type, r.entity_id) not in fts_set]

    has_filters = tags or view != {"active"} or filter_expression
    if vec_only_ids and has_filters:
        vec_only_filtered, _ = await search_all_content(
            db, user_id, query=None,
            tags=tags, tag_match=tag_match, view=view,
            filter_expression=filter_expression,
            entity_ids=vec_only_ids,  # new parameter: whitelist specific entities
            offset=0, limit=len(vec_only_ids),
        )
        vec_only_ids = [(r.entity_type, r.entity_id) for r in vec_only_filtered]

    # 5. RRF merge
    k = 60
    scores = {}
    for rank, item in enumerate(fts_results):
        scores[(item.entity_type, item.entity_id)] = 1.0 / (k + rank)
    for rank, (entity_type, entity_id, _) in enumerate(vec_results_filtered):
        key = (entity_type, entity_id)
        scores[key] = scores.get(key, 0) + 1.0 / (k + rank)

    # 6. Sort by combined RRF score, tiebreak by entity_id for stable pagination
    merged = sorted(scores.items(), key=lambda x: (-x[1], x[0]))
    page = merged[offset:offset + limit]

    # 7. Hydrate into ContentListItem shape (load full entity data for the page)
    # Use load_entities_by_ids() utility — factored from existing search code.
    return await load_entities_by_ids(db, user_id, [key for key, _ in page])
```

**Key design choices:**
- FTS and query embedding run concurrently (`asyncio.gather`) to hide FTS latency behind the embedding API call.
- FTS runs through the existing `search_all_content()` pipeline with all filters applied — tag, view, content type, filter expression. No filter logic is duplicated.
- Vector search overfetches 200 candidates (scoped to user_id + entity_types) for filter headroom.
- Vector-only results (semantic matches that FTS missed) are filter-checked by calling back into `search_all_content()` with a new `entity_ids` whitelist parameter — reuses existing filter logic, no parallel filter engine. Filter check only runs when the user has active filters (tags, non-default view, or filter_expression). **Implementation note:** the `entity_ids` parameter must be split by entity type within `search_all_content()` — each per-type subquery gets `WHERE Bookmark.id IN [bookmark_ids]`, `WHERE Note.id IN [note_ids]`, etc.
- RRF merge breaks ties deterministically by `entity_id` for stable offset-based pagination.
- RRF merge and pagination happen **before** hydrating full entity data. Only the final page is hydrated via `load_entities_by_ids()` — a utility factored from existing search code that loads full `ContentListItem` data (tags, content_preview, etc.) for a mixed set of entity IDs.
- **Total results capped at 100.** The merged candidate set (FTS top 100 ∪ filter-passing vector-only results) is capped at 100 final results. This is an intentional and explicit API contract change for hybrid search — the existing FTS-only path returns exact totals, but hybrid search returns `min(actual, 100)`. This should be reflected in API documentation. In practice, nobody pages past 100 search results.

**Tier gating (v1: query-time enforcement only):**
- Hybrid search (FTS + vector) is Pro tier only
- Free tier users always get FTS-only (current behavior, no code change needed for them)
- Check user tier before embedding the query — skip vector search path entirely for free tier
- v1 does NOT delete embeddings on tier downgrade — just gates query-time access. Destructive cleanup deferred to KAN-109 when the billing/tier-change event source exists.

**Sort mode scoping:**
- Hybrid search (RRF merge) activates **only when `sort_by="relevance"`**. This is the only mode where semantic ranking adds value.
- All other sort modes (`created_at`, `updated_at`, `title`, etc.) use FTS-only — the user wants chronological/alphabetical order, not semantic ranking.

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
- Key: `embed_cache:{model}:{sha256(normalized_query)}` — SHA-256 consistent with the rest of the plan. Model name in the key prevents cache poisoning across model changes.
- Query normalization: lowercase, strip whitespace before hashing.
- TTL: 1 hour.
- On cache hit, skip the OpenAI call entirely. First search for a novel query pays the latency; subsequent identical queries are instant.

### Testing Strategy
- Vector search returns nearest neighbors by cosine similarity
- Vector search is scoped to user_id (multi-tenant isolation)
- FTS and query embedding run concurrently (asyncio.gather)
- RRF scoring: item in both FTS and vector results scores higher than item in only one
- RRF scoring: item in only FTS still appears in results
- RRF scoring: vector-only result (semantic match FTS missed) appears in results after filter check
- Vector-only filter check uses existing search_all_content() with entity_ids whitelist — no parallel filter engine
- Vector-only filter check only runs when user has active filters (tags, non-default view, filter_expression)
- Vector-only result that violates tag/view filter is excluded from merge
- Hybrid search respects all existing filters: tags, tag_match, view, content_types, filter_expression
- Total results capped at 100
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
- RRF tiebreaker: entities with equal RRF scores are ordered deterministically (by entity_id)
- entity_ids whitelist correctly splits by entity type across UNION subqueries
- load_entities_by_ids hydrates correct ContentListItem data for mixed entity types
- Empty query → no vector search triggered (browse mode)
- Search with all stop words → handled gracefully (existing stop-word guard)

**API endpoint tests** (in addition to service-level tests above):
- Pro user + sort_by="relevance" → hybrid search results returned
- Free user + sort_by="relevance" → FTS-only results, no embedding API call
- Pro user + sort_by="created_at" → FTS-only, chronological order
- Embeddings disabled (no API key) → FTS-only, no error
- Embedding API down → FTS fallback, no 500 error
- Total count is capped at 100 for hybrid search
- Existing search tests continue to pass (backward compatibility for FTS-only paths)

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
    redis_client,
    batch_size: int = 50,
    entity_types: list[str] | None = None,
    throttle_ms: int = 100,
):
    """Enqueue embedding jobs for all Pro tier entities that need (re-)embedding.

    - Finds Pro tier entities with no content_embedding_state row, or where
      metadata_hash, content_hash, or model doesn't match current values
    - Enqueues jobs to Redis — the async worker handles actual embedding
    - Throttles enqueue rate to avoid overwhelming the worker/API
    - Idempotent: safe to run multiple times (worker's hash check skips already-current entities)
    """
```

- Run as: `python -m tasks.backfill_embeddings`
- Only processes Pro tier users' content (no point embedding for free tier)
- Enqueues jobs to the same `embed_jobs` Redis queue the worker listens to — **single code path** for all embedding logic (chunking, hash checks, API calls, transactional updates). No duplicated embedding logic.
- Throttles enqueue rate (e.g., 100ms between batches) to respect API rate limits
- Progress logging: `Enqueued 50/345 entities...`

**Orphan chunk cleanup** (add to backfill command or run separately):
- Delete chunks for entities that no longer exist (hard-deleted entities whose chunks weren't cleaned up).
- Do NOT delete chunks for `status = 'failed'` — failed entities retain their last-good chunks for search. "Failed" means the latest content isn't fully embedded, not that existing chunks are invalid.
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
- Backfill enqueues jobs for all Pro tier entities without embedding state
- Backfill enqueues jobs for entities where metadata_hash, content_hash, or model doesn't match
- Worker processes backfill jobs using the same code path as real-time jobs
- Backfill skips free tier users' content
- Backfill handles empty database (no entities)
- Backfill respects entity_types filter
- Backfill is idempotent (running twice produces same result — worker skips already-current entities)
- Model upgrade triggers full re-embed for all entities (model mismatch = stale)
- Backfill picks up entities with status = 'failed'
- Enqueue throttling respects configured rate
- Orphan chunk cleanup removes chunks for hard-deleted entities only
- Failed entities retain their last-good chunks (not deleted by cleanup)
- Progress logging works correctly

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
- [ADIRE simulation results](https://github.com/shane-kercheval/ADIRE/blob/main/docs/analysis-results.md) — empirical validation of paragraph-level reuse strategy
- `docs/implementation_plans/future-search.md` — original search roadmap (Phases 2-3)
