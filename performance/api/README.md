# API Performance Benchmark

Measures API endpoint latency and throughput under concurrent load by making real HTTP requests to a running local server.

## Purpose

- Establish performance baselines before changes
- Compare before/after metrics for features (e.g., content versioning, caching)
- Identify bottlenecks under concurrent load
- Validate performance meets acceptable thresholds

## What It Tests

- **Create**: Notes, bookmarks, prompts (with 50KB content)
- **Update**: Content modifications (50KB payloads)
- **Read**: Single item fetch
- **List/Search**: Paginated queries
- **Delete**: Soft delete and hard delete

## Requirements

1. Docker services running: `make docker-up`
2. API server in dev mode: `VITE_DEV_MODE=true make run`

## Usage

```bash
# Default: 10, 50, 100 concurrency levels, 100 iterations, 50KB content
uv run python performance/api/benchmark.py

# Custom settings
uv run python performance/api/benchmark.py --concurrency 10,50 --iterations 50

# Test with smaller payloads (faster, less realistic)
uv run python performance/api/benchmark.py --content-size 1

# Test with larger payloads (slower, stress test)
uv run python performance/api/benchmark.py --content-size 100
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `--base-url` | `http://localhost:8000` | API base URL |
| `--concurrency` | `10,50,100` | Comma-separated concurrency levels |
| `--iterations` | `100` | Requests per test |
| `--content-size` | `50` | Content size in KB for create/update payloads |

## Output

Markdown report saved to `performance/api/results/` with filename including content size (e.g., `benchmark_api_50kb_20240203_160000.md`):

- **Latency**: Min, P50, P95, P99, Max
- **Throughput**: Requests per second
- **Error rate**: Under load

## Important Notes

- **No auth overhead**: Runs in dev mode (no authentication) because PAT rate limits are too restrictive for load testing
- **Connection pool warmup**: Benchmark warms DB connection pool with concurrent requests before timing
- **Cleanup**: Test items are created and deleted within each run; any leftovers from crashed runs are cleaned at start

## Tier Limits

The benchmark creates many items (default 100 iterations), which may exceed the FREE tier limits (currently 100 bookmarks/notes/prompts). Before running load tests:

1. Temporarily increase limits in `backend/src/core/tier_limits.py`:
   ```python
   Tier.FREE: TierLimits(
       max_bookmarks=10000,  # was 100
       max_notes=10000,      # was 100
       max_prompts=10000,    # was 100
       ...
   )
   ```

2. Run the benchmark

3. Revert the changes (don't commit increased limits)
