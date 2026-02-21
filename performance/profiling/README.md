# API Profiling

Code-level profiling tools to identify bottlenecks in API endpoints.

## Scripts

### `profile.py` - HTML Flame Graphs

Generates interactive HTML profile reports using pyinstrument for all CRUD operations on notes, bookmarks, and prompts.

```bash
# Profile all entities with 1KB content (default)
uv run python performance/profiling/profile.py

# Profile with 50KB content
uv run python performance/profiling/profile.py --content-size 50

# Profile only prompts
uv run python performance/profiling/profile.py --entity prompts

# Profile prompts with 50KB content
uv run python performance/profiling/profile.py --entity prompts --content-size 50
```

**Operations profiled** (per entity):
- Create, Read, Update, List, Search, Soft Delete, Hard Delete

**Output**: HTML files in `performance/profiling/results/` named `{operation}_{size}kb.html`

**View**: `open performance/profiling/results/create_note_50kb.html`

**Note**: Uses ASGITransport (in-process), so profiles code path without network overhead. Does not capture async scheduling behavior under concurrent load. Automatically cleans up created test items.

---

### `minimal_baseline.py` - Bare FastAPI Baseline

Compares minimal FastAPI app against your app to measure framework/middleware overhead.

```bash
# Requires API running on port 8000
VITE_DEV_MODE=true make run

# In another terminal
uv run python performance/profiling/minimal_baseline.py
```

---

### `middleware_impact.py` - Incremental Middleware Testing

Tests middleware overhead by building up from bare FastAPI.

```bash
uv run python performance/profiling/middleware_impact.py
```

---

### `middleware_with_io.py` - Middleware + I/O Simulation

Extends middleware analysis with simulated DB/Redis calls.

```bash
uv run python performance/profiling/middleware_with_io.py
```

---

### `isolate_bottleneck.py` - Remove Middleware from Real App

Tests real app with middleware removed one-by-one to isolate bottlenecks.

```bash
# Requires Docker running
uv run python performance/profiling/isolate_bottleneck.py
```

## Key Finding

The main performance bottleneck was **DB connection pool cold start**, not middleware. First concurrent burst creates TCP connections to PostgreSQL (~10-15ms each). Solution: concurrent warmup before benchmarking.
