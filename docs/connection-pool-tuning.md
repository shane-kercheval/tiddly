# Connection Pool & Worker Tuning

## Context

- **Railway**: up to 8 vCPU / 8 GB RAM per replica
- **Postgres `max_connections`**: 100
- **Architecture**: Only the API service connects to Postgres directly. MCP servers proxy through the API via HTTP. The nightly cron task (`tasks/cleanup.py`) runs as a separate process with its own pool (inheriting the same defaults), but runs briefly once per day and uses 1-2 connections.

## Configuration

| Setting | Value | Per-worker | Total (4 workers) |
|---------|-------|------------|--------------------|
| Uvicorn workers | 4 | — | 4 processes |
| `DB_POOL_SIZE` | 10 | 10 persistent | 40 persistent |
| `DB_MAX_OVERFLOW` | 10 | 10 overflow | 40 overflow |
| `DB_POOL_RECYCLE` | 3600 | — | — |
| `REDIS_POOL_SIZE` | 5 | 5 | 20 |
| **Max DB connections** | — | 20 | **80** |
| **Reserved** | — | — | **~20** |

Note: SQLAlchemy does not eagerly open all connections. `pool_size` is a ceiling, not a pre-allocation. With light traffic, only a few connections per worker will actually be open. The pool grows on demand.

### Why 4 workers?

Python's GIL limits a single process to 1 CPU core. With 8 vCPU available, 4 workers uses half the available cores, leaving headroom for the OS and other processes. Each worker is an independent Python process with its own event loop and connection pool.

Even though FastAPI is async and handles I/O concurrency well within a single worker, CPU-bound work (diff-match-patch calculations, Pydantic validation, JSON serialization, Jinja2 rendering) blocks the event loop. Multiple workers prevent one CPU-heavy request from stalling others.

### Why these pool sizes?

- `pool_size=10`: persistent connections kept open per worker. Handles typical concurrent DB queries.
- `max_overflow=10`: temporary connections created under burst load, closed when idle.
- `pool_recycle=3600`: proactively recycles connections older than 1 hour. Prevents accumulation of long-lived connections that managed Postgres providers may terminate. Complements `pool_pre_ping=True` which detects stale connections per-checkout.
- `redis_pool_size=5`: Redis operations (rate limiting, auth cache) are sub-millisecond and don't hold connections, so 5 per worker is sufficient. 4 workers × 5 = 20 total.
- Total max DB: 4 workers × 20 = 80 connections, leaving ~20 for deploy-time migrations, cron tasks, and manual admin access.

## Code Changes

### 1. `backend/src/core/config.py` — Lower default pool sizes, add pool_recycle

```python
# Before
db_pool_size: int = Field(default=50, validation_alias="DB_POOL_SIZE")
db_max_overflow: int = Field(default=30, validation_alias="DB_MAX_OVERFLOW")
redis_pool_size: int = Field(default=20, validation_alias="REDIS_POOL_SIZE")

# After
db_pool_size: int = Field(default=10, validation_alias="DB_POOL_SIZE")
db_max_overflow: int = Field(default=10, validation_alias="DB_MAX_OVERFLOW")
db_pool_recycle: int = Field(default=3600, validation_alias="DB_POOL_RECYCLE")
redis_pool_size: int = Field(default=5, validation_alias="REDIS_POOL_SIZE")
```

### 2. `backend/src/db/session.py` — Add pool_recycle to engine

```python
# Before
engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
)

# After
engine = create_async_engine(
    settings.database_url,
    echo=False,
    pool_pre_ping=True,
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    pool_recycle=settings.db_pool_recycle,
)
```

### 3. `backend/src/api/main.py` — Dispose engine on shutdown

The lifespan currently cleans up Redis but not the SQLAlchemy engine. On shutdown (deploys, restarts), connections in the pool are abandoned and rely on Postgres to time them out. With 4 workers, that's up to 80 stale connections per deploy.

```python
# Add to shutdown block in lifespan(), before Redis cleanup:
from db.session import engine

# In lifespan:
    yield

    # Shutdown: Dispose database connection pool
    await engine.dispose()

    # Shutdown: Clean up auth cache and Redis
    set_auth_cache(None)
    await redis_client.close()
    set_redis_client(None)
```

### 4. `Dockerfile.api` — Configurable worker count

```dockerfile
# Before
CMD uv run uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8080}

# After
CMD uv run uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers ${API_WORKERS:-1}
```

Defaults to 1 worker if `API_WORKERS` is not set. Add `API_WORKERS=4` to the Railway API service's Variables tab.

### 5. No changes needed to MCP servers

The Content MCP and Prompt MCP servers do not connect to Postgres directly. They make HTTP requests to the API (`api_client.py`), so they don't consume DB connections.

## Scaling Notes

If you need to scale beyond this:

1. **More workers**: Going from 4 to 6 workers would use 6 × 20 = 120 connections, exceeding the 100 limit. You'd need to either lower pool sizes per worker or increase `max_connections` in Postgres.
2. **More replicas**: Each replica gets its own set of workers and pools. 2 replicas × 4 workers × 20 = 160 connections — would require upgrading Postgres or adding PgBouncer as a connection pooler.
3. **Increase `max_connections`**: Possible but Postgres uses additional memory per connection (workload-dependent). Test capacity before relying on this.
4. **PgBouncer**: If connection management becomes a recurring concern across multiple services/replicas, adding PgBouncer as a connection pooler between the app and Postgres eliminates per-worker pool arithmetic. Railway supports sidecar containers. Overkill for a single-service architecture, but the standard solution at scale.
