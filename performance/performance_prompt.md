# Pre-Release Performance Review

Run this before merging a feature branch. It produces standardized benchmark and profiling reports that can be compared across branches and releases.

---

## Phase 0: Prerequisites

Before running any benchmarks:

1. **Docker services must be running:** `make docker-up`
2. **API server must be running in dev mode:** `VITE_DEV_MODE=true make run`
3. **Tier limits must be raised** for load testing. In `backend/src/core/tier_limits.py`, temporarily set:
   ```python
   Tier.FREE: TierLimits(
       max_bookmarks=10000,
       max_notes=10000,
       max_prompts=10000,
       ...
   )
   ```
   **Do NOT commit these changes.** Revert after benchmarking.
4. **Close other heavy processes** to reduce noise (browsers, IDEs with indexing, etc.)
5. **Verify the API is reachable:** `curl http://localhost:8000/health`
6. **Check for unarchived profiling results.** If `performance/profiling/results/` contains `.html` or `.txt` files from a previous run, verify they've been archived (a corresponding `.zip` should exist in `performance/profiling/`). If not archived, archive them first:
   ```bash
   cd performance/profiling && zip -r YYYY-MM-DD-branch-name.zip results/ && cd ../..
   ```
   New profiling runs overwrite these files by name, so unarchived results will be lost.

---

## Phase 1: Review Branch Changes

Before running benchmarks, review the current branch diff to understand what changed:

```bash
git diff main...HEAD --stat
git log main..HEAD --oneline
```

Identify and document:
- New database tables, columns, or indexes
- Changes to existing query patterns (joins, subqueries, new WHERE clauses)
- New middleware or request lifecycle hooks
- Changes to `base_entity_service.py` (affects ALL entity operations)
- Changes to individual entity services (bookmark_service, note_service, prompt_service)
- New or modified API endpoints
- Any code paths added to GET/POST/PATCH/DELETE that add DB round-trips

From this review, build a list of:
- **Affected endpoints** — which API endpoints are most likely to have changed performance characteristics
- **Affected code paths** — which backend functions/modules changed and should be scrutinized in profiling results

Record these findings — they will be included in the benchmark report (Phase 5a, "Branch Changes Summary" section) and guide the targeted analysis in Phase 4.

---

## Phase 2: API Benchmarks

Run benchmarks at **two content sizes** to isolate content-size-dependent regressions from fixed-overhead regressions.

### 2a. Small Content (1KB) — Measures Fixed Overhead

```bash
uv run python performance/api/benchmark.py --content-size 1 --concurrency 10,50,100 --iterations 100
```

### 2b. Large Content (50KB) — Measures Content-Dependent Overhead

```bash
uv run python performance/api/benchmark.py --content-size 50 --concurrency 10,50,100 --iterations 100
```

### What to Capture

Both runs automatically save markdown reports to `performance/api/results/` with filenames like `benchmark_api_1kb_YYYYMMDD_HHMMSS.md` and `benchmark_api_50kb_YYYYMMDD_HHMMSS.md`.

### Operations Tested (21 per content size)

For each entity type (Notes, Bookmarks, Prompts) x 7 operations:
- **Create** — INSERT + content history record + any new hooks added by the branch
- **Update** — UPDATE + diff computation + content history record
- **Read** — Single-item GET (includes all embedded data: tags, relationships, etc.)
- **List** — Paginated list (limit=20)
- **Search** — Text search with query parameter (limit=20)
- **Soft Delete** — Logical delete + audit history record
- **Hard Delete** — Physical delete + cascade cleanup

Each operation is tested at concurrency levels 10, 50, and 100 (100 iterations each).

### Script Behavior Notes

- **Warmup is automatic.** The benchmark script warms the DB connection pool and ORM models before timing starts. No manual warmup needed.
- **Cleanup is automatic.** Test items are created and deleted within each run. Leftovers from crashed runs are cleaned up at the start of each run.
- **Runs are independent.** The 1KB and 50KB runs can be executed in either order. Each run cleans up after itself.
- **On failure:** If a run fails partway through, cleanup runs via `finally` blocks. Restart the failed run from scratch — partial results are not usable.

### Early Exit

After both benchmark runs complete, check results before proceeding to profiling. **If any operation shows >5x P95 regression versus baseline, or >10% error rate, stop here.** Fix the issue before spending time on profiling.

---

## Phase 3: Profiling (Flame Graphs)

Run pyinstrument profiling at **two content sizes** to generate HTML flame graphs and text reports.

### 3a. Small Content (1KB) — All Entities

```bash
uv run python performance/profiling/profile.py --content-size 1
```

### 3b. Large Content (50KB) — All Entities

```bash
uv run python performance/profiling/profile.py --content-size 50
```

### What to Capture

Profiling saves results to `performance/profiling/results/`:
- **HTML files** (`{operation}_{size}kb.html`): Interactive flame graphs for visual inspection
- **Text files** (`{operation}_{size}kb.txt`): Machine-readable call trees for comparison

**Note:** Each operation profiles a single request via pyinstrument. This is intentional — profiling maps the full call tree and time distribution within one request, not statistical latency (that's Phase 2's job). Single-request profiling is sufficient to identify bottlenecks, N+1 queries, and hot functions.

### Comparing to Previous Profiling Results

Previous profiling results are archived as dated zip files in `performance/profiling/` (e.g., `2026-02-05-main.zip`, `2026-02-05-content-versioning.zip`). To compare against a baseline:

```bash
# List available baselines
ls performance/profiling/*.zip

# Extract the most relevant baseline to a temporary directory
mkdir -p /tmp/profiling_baseline
unzip performance/profiling/2026-02-05-main.zip -d /tmp/profiling_baseline
```

Then compare the text reports side-by-side (e.g., `diff /tmp/profiling_baseline/results/create_note_1kb.txt performance/profiling/results/create_note_1kb.txt`). Look for new functions appearing in hot paths, or existing functions consuming a larger percentage of total time.

### Operations Profiled (7 per entity x 3 entities = 21 total per content size)

- `create_{entity}` — Full creation code path
- `read_{entity}` — Single-item fetch with all embedded data
- `update_{entity}` — Content update with history recording
- `list_{entity}` — Paginated listing
- `search_{entity}` — Text search
- `soft_delete_{entity}` — Logical deletion
- `hard_delete_{entity}` — Physical deletion with cascades

---

## Phase 4: Analysis

### 4a. Benchmark Analysis

For EACH content size (1KB, 50KB), produce an analysis covering:

**Regression Detection:**
- Compare against baseline results using this priority order:
  1. `performance/api/results_main/` — main branch baseline (preferred)
  2. The earliest results in `performance/api/results/` — original baseline
  3. Any `performance/api/results_*/` directory from the parent branch
  4. If no baseline exists, skip regression analysis and establish this run as the baseline for future comparisons
- Flag any operation where P95 latency increased by **>15%** from baseline
- Flag any operation where throughput (RPS) decreased by **>15%** from baseline
- Flag any operation where error rate increased from 0%

**Absolute Thresholds (flag if exceeded):**

| Metric | Concurrency 10 | Concurrency 50 | Concurrency 100 |
|--------|----------------|-----------------|-------------------|
| P95 latency (1KB) | > 50ms | > 150ms | > 400ms |
| P95 latency (50KB) | > 100ms | > 300ms | > 800ms |
| Error rate | > 0% | > 1% | > 5% |

**Scaling Analysis:**
- For each operation, compute the P95 latency ratio from concurrency 10 -> 100
- Flag operations where ratio exceeds **12x** (suggests poor concurrency handling)
- Compare scaling ratios against baseline — worsening ratios indicate new contention

**Write vs Read Split:**
- Compare create/update latencies to read/list/search latencies
- Write operations are expected to be slower (history recording, diff computation)
- Flag if write overhead exceeds **3x** the corresponding read operation at same concurrency
- This ratio is most meaningful at 1KB where fixed overhead (history recording, diff computation) is exposed. At 50KB, content processing dominates both reads and writes, compressing the ratio.

### 4b. Profiling Analysis

Read the text profile reports (`performance/profiling/results/*.txt`) and analyze:

**Top Time Consumers:**
- For each operation, identify the top 3 functions by cumulative time
- Flag any single function consuming **>40%** of total request time
- If baseline profiling results are available (see Phase 3 "Comparing to Previous Profiling Results"), compare the top functions and their percentages. Flag any function whose share of total time increased by >10 percentage points, or any new function appearing in the top 3 that wasn't there before.

**Targeted Code Path Analysis:**
Using the affected code paths identified in Phase 1, specifically examine:
- What percentage of total request time does each affected path consume?
- How does it compare across entity types (notes vs bookmarks vs prompts)?
- Does it scale with content size (compare 1KB vs 50KB)?
- Are there any unexpected database queries (look for SQLAlchemy execute calls)?

**Database Query Analysis:**
- Look for time spent in `asyncpg` / `sqlalchemy` execute calls
- Count distinct query executions per operation (look for N+1 patterns)
- Flag operations with **>4 distinct DB round-trips**
- Pay special attention to write operations (create/update) which include history recording

**Middleware Overhead:**
- Check time spent in middleware (ETag computation, security headers, rate limit headers)
- Middleware should be **<5%** of total request time for most operations

---

## Phase 5: Report Generation

### 5a. API Benchmark Report

Save to: `performance/api/results/benchmark_report_<BRANCH>_YYYYMMDD.md` (replace `<BRANCH>` with the current branch name, hyphens replaced with underscores).

Use this exact format:

~~~markdown
# API Benchmark Report

**Date:** YYYY-MM-DD HH:MM:SS
**Branch:** (current branch name)
**Commit:** (output of `git rev-parse --short HEAD`)
**Baseline:** (which past results were compared against, if any)
**Environment:** Local dev (VITE_DEV_MODE=true, no auth overhead)

## Branch Changes Summary

(From Phase 1: brief description of what changed, affected endpoints, affected code paths)

## Test Parameters

| Parameter | Value |
|-----------|-------|
| Content sizes | 1KB, 50KB |
| Concurrency levels | 10, 50, 100 |
| Iterations per test | 100 |
| API URL | http://localhost:8000 |

## Results: 1KB Content

(Paste the full Summary by Operation table from the 1KB benchmark output)

## Results: 50KB Content

(Paste the full Summary by Operation table from the 50KB benchmark output)

## Regression Analysis

| Operation | Size | Conc | Baseline P95 | Current P95 | Delta | Delta % | Status |
|-----------|------|------|-------------|-------------|-------|---------|--------|
(For each operation that changed >10%, list the comparison. Omit this section if no baseline exists.)

**Status key:** OK (<10% change), Warning (10-25% change), Regression (>25% change), Improvement (>10% faster)

## Scaling Analysis

| Operation | Size | P95 @10 | P95 @100 | Ratio | Status |
|-----------|------|---------|----------|-------|--------|
(For each operation, show scaling ratio)

**Status key:** Good (<10x), Moderate (10-15x), Poor (>15x)

## Slow Operations (P95 > 100ms at any concurrency)

(List all operations exceeding thresholds with severity)

## Errors

(List any operations with non-zero error rates, or "None" if clean)

## Summary

- **Overall assessment:** (PASS / PASS WITH WARNINGS / FAIL)
- **Key findings:** (2-5 bullet points)
- **Recommendations:** (if any)
~~~

### Decision Framework

The overall assessment determines the merge decision:

- **PASS:** No regressions or threshold violations. Merge freely.
- **PASS WITH WARNINGS:** Regressions 10-25%, or absolute thresholds exceeded at high concurrency only. Document the regressions and justification in the PR description before merging.
- **FAIL:** Any regression >25%, new errors under load, or scaling ratio dramatically worsened. Must fix before merge.

### 5b. Profiling Report

Save to: `performance/profiling/results/profiling_report_<BRANCH>_YYYYMMDD.md`

Use this exact format:

~~~markdown
# Profiling Report

**Date:** YYYY-MM-DD HH:MM:SS
**Branch:** (current branch name)
**Commit:** (short hash)
**Method:** pyinstrument via ASGITransport (in-process, no network overhead)

## Test Parameters

| Parameter | Value |
|-----------|-------|
| Content sizes | 1KB, 50KB |
| Entities profiled | Notes, Bookmarks, Prompts |
| Operations per entity | Create, Read, Update, List, Search, Soft Delete, Hard Delete |

## Timing Summary

| Operation | 1KB (ms) | 50KB (ms) | Size Scaling | Top Function |
|-----------|----------|-----------|--------------|--------------|
| create_note | X.X | X.X | X.Xx | function_name (XX%) |
| read_note | X.X | X.X | X.Xx | function_name (XX%) |
| update_note | X.X | X.X | X.Xx | function_name (XX%) |
| list_notes | X.X | X.X | X.Xx | function_name (XX%) |
| search_notes | X.X | X.X | X.Xx | function_name (XX%) |
| soft_delete_note | X.X | X.X | X.Xx | function_name (XX%) |
| hard_delete_note | X.X | X.X | X.Xx | function_name (XX%) |
(Repeat for bookmarks, prompts)

**Size Scaling** = 50KB time / 1KB time. Values close to 1.0x mean the operation is not content-size-dependent. High values (>3x) indicate content processing bottlenecks.

## Targeted Analysis: Affected Code Paths

(Using the affected code paths identified in Phase 1)

| Code Path | Operation | 1KB Time (ms) | % of Total | 50KB Time (ms) | % of Total |
|-----------|-----------|---------------|------------|----------------|------------|
(Fill in from profiling text reports)

### Findings

(Detailed analysis of time spent in affected code paths, DB query counts, N+1 patterns, etc.)

## Database Query Analysis

| Operation | Estimated DB Round-Trips | Primary Queries |
|-----------|------------------------|-----------------|
(For each operation, estimate query count from profile data)

## Hot Spots (Functions >20% of total time)

(List functions that dominate, grouped by operation category)

## Summary

- **Overall assessment:** (CLEAN / MINOR CONCERNS / SIGNIFICANT CONCERNS)
- **Key findings:** (2-5 bullet points)
- **Recommendations:** (if any)
~~~

---

## Phase 6: Archive Results

After generating reports:

1. **Copy benchmark results** for this branch (replace `<BRANCH>` with branch name, hyphens to underscores):
   ```bash
   BRANCH_DIR=$(git branch --show-current | tr '-' '_')
   mkdir -p performance/api/results_${BRANCH_DIR}
   cp performance/api/results/benchmark_api_1kb_*.md performance/api/results_${BRANCH_DIR}/
   cp performance/api/results/benchmark_api_50kb_*.md performance/api/results_${BRANCH_DIR}/
   cp performance/api/results/benchmark_report_*.md performance/api/results_${BRANCH_DIR}/
   ```

2. **Archive profiling results** for this branch (naming convention: `YYYY-MM-DD-branch-name.zip`):
   ```bash
   BRANCH_NAME=$(git branch --show-current)
   DATE=$(date +%Y-%m-%d)
   cd performance/profiling && zip -r ${DATE}-${BRANCH_NAME}.zip results/ && cd ../..
   ```

3. **Clean up working directories** after archiving:
   ```bash
   # Remove raw benchmark files from the working directory (they're now in the branch-specific archive)
   rm -f performance/api/results/benchmark_api_*.md
   # Profiling results/ is overwritten per run (same filenames), so no cleanup needed
   ```

4. **Revert tier limit changes** in `backend/src/core/tier_limits.py`

5. **Do NOT commit** tier limit changes. The branch-specific archive directories (`results_<branch>/`), summary reports, and profiling zips are the durable artifacts that get committed.

---

## Checklist

- [ ] Prerequisites verified (Docker, API running, tier limits raised)
- [ ] Branch changes reviewed and documented (affected endpoints + code paths identified)
- [ ] API benchmark: 1KB content completed
- [ ] API benchmark: 50KB content completed
- [ ] Profiling: 1KB content completed
- [ ] Profiling: 50KB content completed
- [ ] Benchmark report generated with regression analysis
- [ ] Profiling report generated with code path analysis
- [ ] Results archived to branch-specific directories
- [ ] Tier limits reverted
- [ ] Overall assessment: PASS / PASS WITH WARNINGS / FAIL
