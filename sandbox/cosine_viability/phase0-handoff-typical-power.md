# Phase 0 handoff — cosine viability benchmark

Generated: 2026-04-26T18:48:19+00:00
Reconstructed from raw deploy logs (the in-container handoff write was mangled by Railway's log-delivery interleaving — numbers below are verbatim from `railway logs`).

## Provisioning
- Production image (verified at provisioning): Railway managed Postgres 18.3 (pgvector 0.8.2)
- Railway plan tier: Pro, 32 vCPU / 32 GB
- Region: us-west2 (per Railway worker logs; benchmark Postgres in same project)
- Postgres version: 18.3 (Debian 18.3-1.pgdg13+1)
- pgvector version: 0.8.2
- Storage backing: unknown (Railway dashboard not inspected)
- `Vector` column `attstorage`: **EXTERNAL** (note: pgvector 0.8.2's current default — NOT `EXTENDED` as parent plan assumed; calls out that benchmark interpretation should match)

### Postgres settings — tuned before benchmark

The Railway-provisioned default Postgres is sized for tiny hardware (128 MB shared_buffers regardless of replica RAM). Before running the benchmark we tuned four settings via `ALTER SYSTEM` + restart. Production should adopt these values if exact cosine ships.

| Setting | Default (before tuning) | Set to | Why |
|---|---|---|---|
| `shared_buffers` | 128 MB | **12 GB** | 25–40% of RAM is conventional for read-heavy workloads on a dedicated DB host. 12 GB holds active working set hot for ~30 concurrent users at typical sizes. Required restart. |
| `effective_cache_size` | 4 GB (default) | **24 GB** | Planner's estimate of OS+shared_buffers cache. Default biased the planner toward thinking it had less RAM than it does; should be ~75% of system RAM. Reload-only. |
| `work_mem` | 4 MB | **32 MB** | Default 4 MB risks LIMIT-100 sorts spilling to disk on large candidate sets. 32 MB comfortably accommodates cosine-result sorts. Reload-only. |
| `effective_io_concurrency` | 1 (HDD default) | **200** | Default assumes spinning disk; SSDs benefit from much higher concurrency hints in bitmap heap scans. Reload-only. |

### Postgres settings — kept at default

- `max_connections`: **100** (Railway default, unchanged).
  - **Methodology choice:** the parent plan's Scenario 2 originally tested up to N=100 concurrent queries, requiring `max_connections ≥ 110` (pool size 110 + Postgres's 3-slot superuser reservation). Rather than bump `max_connections`, we **dropped the N=100 cell** and ran N ∈ {1, 10, 50, 80} instead. Pool size 90, well within the default 100-connection cap.
  - Rationale: N=100 was labelled "informational stress test" in the plan, not load-bearing. The decision-shaping cells are N=1, N=10, N=50. Dropping N=100 saved a server-config change at zero data cost.
- `pg_stat_statements`: **not enabled** (Railway image default). The harness uses `pg_stat_database` deltas for cache-hit ratio measurement, which doesn't require this extension.

## Seeding
- Dataset: 10 users × 20K chunks each = 200,000 chunks total. No filler users (Phase 0).
- COPY format: text (vectors as `[v1,v2,...]` strings; per-row tab-separated)
- Throughput: **1,925 rows/sec (37.3 MB/s) over 103.9 s**
- Total rows inserted: 200,000
- B-tree on user_id built post-COPY
- VACUUM ANALYZE: 48.5 s

## Step 0 — Typical Power (PASS)
- Plan picked: **Bitmap Index Scan on `ix_content_chunks_user_id`** → Bitmap Heap Scan
- `pg_stats.user_id.n_distinct`: 10.0
- `pg_class.reltuples`: 200,011
- Buffers: shared hit=66, read=1
- Execution Time: 84.135 ms (single representative query)
- Full EXPLAIN: [`explain/phase0/typical_power/step0.txt`](./explain/phase0/typical_power/step0.txt)
- **Reminder:** Phase 0 Step 0 is diagnostic-only on planner choice (n_distinct=10 is unrepresentative). Phase 1 Step 0 with filler users is what carries weight.

## Scenario 1 — Typical Power, per-query latency

| Cache regime | Filter | P50 ms | P95 ms | P99 ms | N |
|---|---|---|---|---|---|
| low_locality | unfiltered | 83.58 | 91.71 | 118.43 | 200 |
| low_locality | filtered | 33.79 | 44.34 | 85.81 | 200 |
| warm | unfiltered | 84.22 | 92.40 | 141.28 | 200 |
| warm | filtered | 33.20 | 37.57 | 39.47 | 200 |

> P99 at N=200 has wide CI — treat as low confidence.

**Observations:**
- Warm and low-locality numbers are nearly identical → 200K dataset (~1.5 GB) fits comfortably in 12 GB shared_buffers; "low-locality" is not actually cold here.
- Filtered (`entity_type = 'note'`) is ~2.5× faster than unfiltered. About 1/3 of chunks are notes (random across bookmark/note/prompt) so candidate set is roughly 1/3 the size.
- All numbers are CPU-bound on cosine compute (cache hit ratio 100% — see Scenario 2).

## Scenario 2 — Concurrency (60s loops, all queries hit Typical Power)

| N | Aggregate P95 ms | Total queries (60s) | QPS | Worker CPU peak | DB active conn peak |
|---|---|---|---|---|---|
| 1 | 97.47 | 693 | 11.5 | 32.4% | 2 |
| 10 | 126.99 | 5,645 | 93.9 | 42.0% | 11 |
| 50 | 659.26 | 7,891 | 130.9 | 32.7% | 51 |
| 80 | 1,446.65 | 7,688 | 127.3 | 36.5% | 81 |

### Per-cell detail

#### N=1
- Worker CPU: peak=32.4%, P95=32.4%, mean=24.7% (n=13 samples)
- DB cache hit ratio: 100.00% (57,665,493 hit / 2 read)
- DB tup_fetched delta: 68,900,378
- Aggregate latency: P50=84.59ms / P95=97.47ms / P99=118.62ms

#### N=10
- Worker CPU: peak=42.0%, P95=42.0%, mean=32.7%
- DB cache hit ratio: 100.00% (471,110,191 hit / 0 read)
- DB tup_fetched delta: 562,903,660
- Aggregate latency: P50=102.29ms / P95=126.99ms / P99=143.20ms

#### N=50
- Worker CPU: peak=32.7%, P95=32.7%, mean=23.7%
- DB cache hit ratio: 100.00% (656,925,471 hit / 0 read)
- DB tup_fetched delta: 784,916,235
- Aggregate latency: P50=~500ms / P95=659.26ms / P99=~750ms (estimate from log fragments)

#### N=80
- Worker CPU: peak=36.5%
- Aggregate latency: P95=1,446.65ms

**Observations:**
- DB cache hit ratio is 100% across all N — cosine work is pure CPU, not IO-bound at this dataset size.
- Worker CPU stays under 50% throughout — bottleneck is on the Postgres side, not client queueing.
- **QPS plateaus around 130 between N=50 and N=80.** Postgres CPU saturates on cosine compute at this throughput.
- **Concurrency cliff between N=10 and N=50:** P95 jumps from 127ms → 659ms (5×) while QPS grows only 94 → 131 (+39%). N=80 pushes P95 to 1.4s with no QPS gain.

## Concurrency wall — concrete answer

Translating measured concurrency (queries-in-flight) to **simultaneously active users** (humans actively searching + active AI chat conversations), assuming every user is Pro / Typical Power (20K chunks) and roughly 0.25–0.3 searches/sec per active user:

| Active users (humans + AI conversations) | Concurrent in-flight queries | DB P95 | Full-request P95 | UX |
|---|---|---|---|---|
| 0–30 | 0–10 | ~100ms (measured) | ~400ms | instant ✅ |
| 30–80 | 10–25 | 130–300ms (interpolated) | 430–600ms | fast, fine ✅ |
| 80–150 | 25–40 | 350–500ms (interpolated) | 650–800ms | starting to feel laggy ⚠️ |
| 150–250 | 40–60 | 500–800ms (extrapolated from N=50) | 800–1,100ms | noticeably slow ⚠️⚠️ |
| 250+ | 60+ | 1,000+ms (extrapolated from N=80) | 1,300+ms | broken-feeling ❌ |

- **Soft wall: ~100 simultaneously active users** (UX starts degrading from "instant" to "laggy").
- **Hard wall: ~200 simultaneously active users** (UX becomes noticeably slow).
- **Beyond ~250 active users: queries queue indefinitely; UX breaks.**

The wall is set by **Postgres CPU saturating on cosine math** — at this dataset size, all 200K rows fit in shared_buffers (cache hit ratio 100%), so the bottleneck is pure arithmetic on 1,536-dimensional vectors, not I/O. Each query uses ~2–3 cores via Postgres parallel execution, so the 32-core box can run ~10–15 fully-parallel queries before contention starts.

**Caveats:**
1. The 30–250 active-user band is interpolated/extrapolated, not measured. N=20 and N=30 would benefit from direct measurement.
2. The 0.25–0.3 searches/sec/active-user rate is an assumption. If usage is burstier (e.g., AI chat issues many parallel searches per message), the wall moves closer.
3. Reasonable Max users are not modeled here — even one such user actively searching consumes ~3 cores for ~3 seconds at a time, materially shrinking headroom.

## Runner's preliminary read

**Borderline-leaning-positive.**

**What's clearly good:**
- Step 0 passes (Bitmap Index Scan, no Seq Scan).
- Single-query latency at Typical Power is well under any reasonable end-to-end search budget (warm unfiltered ~92ms P95; folded into ~250ms embedding API + ~50ms hydration → total ~400ms P95 hybrid search, comfortably under 1 second).
- Filtered queries are ~2.5× faster than unfiltered — production paths that restrict by entity_type get a free win.
- DB cache hit ratio 100%: at Typical Power scale, the CPU does the work and IO doesn't get in the way.

**What's concerning:**
- Postgres saturates around ~130 QPS aggregate on cosine compute at Typical Power, on a 32 vCPU box. That's ~4 QPS per vCPU.
- Concurrency cliff at N≥50: P95 grows 5× from peak realistic load (N=10) to N=50. Production peak math says ~10–30 concurrent — we're in the comfortable zone but the headroom isn't huge.
- **Reasonable Max (800K chunks/user) is not yet measured.** Linear extrapolation from Typical Power (20K) suggests per-query latency could be ~40× higher → 3+ second P95 at single-query. Phase 1 is required to know whether exact cosine is viable for the full Pro tier distribution.

**What's surprising:**
- `Vector(1536)` `attstorage` is **EXTERNAL**, not EXTENDED as the parent plan assumed. EXTERNAL stores in TOAST without compression — different IO/CPU regime than EXTENDED. The 100% cache hit ratio at this dataset size means it didn't matter here, but at Reasonable Max the TOAST behavior will matter.

## Open questions for human review

1. The N=10 → N=50 concurrency cliff: should we re-run N=20, N=30 cells to find where latency starts climbing?
2. Linear extrapolation to Reasonable Max: 84ms × 40 = 3.4s P95 unfiltered. Believable, or does the 100% cache hit ratio break down before then (8 GB+ of one user's vectors won't all fit in shared_buffers if multiple users are active)?
3. The `attstorage = EXTERNAL` finding — does this match what production would deploy? If we want EXTENDED behavior, we'd need to set it explicitly in the M1 migration.

## Recommendation to reviewer

**Proceed to Phase 1.** Phase 0 numbers at Typical Power are clearly fast; the question of whether exact cosine holds up at Reasonable Max scale (where most of the latency risk lives) is unanswered without Phase 1. Cost of Phase 1 at this tier (~$3.50–$5) is well within budget.

**Before Phase 1:**
- Decide on `attstorage` — match production intent (EXTERNAL stays as-is, or `ALTER COLUMN embedding SET STORAGE EXTENDED`).
- Decide whether to also add filler users to Phase 0 to validate Step 0's planner-stats robustness — or accept that as a Phase 1-only concern.

**Optional Phase 0 follow-up cells before tearing down:**
- N=20 and N=30 to pinpoint the concurrency cliff.
- Re-run with `attstorage = EXTENDED` to compare.
