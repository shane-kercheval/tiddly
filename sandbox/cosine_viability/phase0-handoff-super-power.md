# Phase 0 handoff — cosine viability benchmark — Super Power

Generated: 2026-04-26 (run completed ~21:11 UTC)
Reconstructed from clean deploy logs.

## Provisioning
- Production image: Railway managed Postgres 18.3 (pgvector 0.8.2)
- Railway plan tier: Pro, 32 vCPU / 32 GB
- Region: us-west2
- Postgres version: 18.3 (Debian 18.3-1.pgdg13+1)
- pgvector version: 0.8.2
- `Vector` column `attstorage`: EXTERNAL
- Storage backing: unknown

### Postgres settings used in this run

Same tuning as the Typical Power run, **plus** a critical SHM increase to support parallel queries on this dataset size:

| Setting | Value | Notes |
|---|---|---|
| `shared_buffers` | **12 GB** | Same as Typical Power. Holds the entire 1.3M-chunk dataset (~8 GB of vectors) hot. |
| `effective_cache_size` | 24 GB | Same as Typical Power. |
| `work_mem` | 32 MB | Same as Typical Power. |
| `effective_io_concurrency` | 200 | Same as Typical Power. |
| `max_connections` | 100 | Same as Typical Power. N=80 was the highest concurrency cell; default 100 is sufficient. |
| `max_parallel_workers_per_gather` | **2 (default)** | Parallel queries enabled. Each cosine query uses 1 leader + 2 workers = 3 cores. |
| `RAILWAY_SHM_SIZE_BYTES` | **17,179,869,184 (16 GiB)** | **Required** — Railway's default `/dev/shm = 64 MB` is far too small for parallel queries on this dataset. The first attempt of this run **crashed** with `DiskFullError ... shared memory segment` during Scenario 2. Bumping `/dev/shm` to 16 GiB (≥ shared_buffers + headroom) eliminated the crash. **Production deploys must set this if using parallel queries on Super Power+ data.** |

## Seeding
- Bucket: super_power (130,000 chunks per user)
- Dataset: **10 users × 130,000 chunks each = 1,300,000 chunks total**
- COPY format: text (vectors as `[v1,v2,...]` strings)
- Throughput: **2,288 rows/sec (44.5 MB/s) over 568.3 s** (~9.5 minutes)
- Total rows inserted: 1,300,000
- B-tree on user_id built post-COPY
- VACUUM ANALYZE: 47.0 s (extrapolated; similar to Typical Power's 48.5 s)

## Step 0 — super_power (PASS)
- Plan picked: **Bitmap Index Scan on `ix_content_chunks_user_id`** → Parallel Bitmap Heap Scan
- Workers Planned: 2; Workers Launched: 2 (parallel execution active)
- Buffers: shared hit=543,698, shared read=113 (hit ratio ~99.98% — vectors stayed hot in shared_buffers from seeding)
- Execution Time: **332.198 ms** (single representative query)
- Full EXPLAIN: [`explain/phase0/super_power/step0.txt`](./explain/phase0/super_power/step0.txt)

## Scenario 1 — super_power, per-query latency (200 samples per cell)

| Cache regime | Filter | P50 ms | P95 ms | P99 ms | N |
|---|---|---|---|---|---|
| low_locality | unfiltered | **299.97** | **322.47** | 440.22 | 200 |
| low_locality | filtered (entity_type=note) | 210.30 | 230.70 | 274.10 | 200 |
| warm | unfiltered | 299.02 | 325.80 | 443.95 | 200 |
| warm | filtered | 202.23 | 218.41 | 333.30 | 200 |

> P99 confidence: at N=200, P99 is approximately the 2nd-largest of 200 — wide CI, treat as low confidence.

**Observations:**
- Warm and low-locality numbers are nearly identical → the entire 1.3M-chunk dataset fits in 12 GB shared_buffers; "low-locality" is not actually cold here.
- Filtered queries are ~30% faster (218 vs 326 ms P95 warm), smaller than Typical Power's 2.5× speedup. At Super Power scale, the filter still reduces the candidate set but the cosine compute on the filtered ~1/3 still dominates.
- All numbers are CPU-bound on cosine arithmetic — DB cache hit ratio 100% throughout.

## Scenario 2 — super_power, concurrency (60s loops)

| N | Aggregate P50 ms | P95 ms | P99 ms | Total queries (60s) | QPS | Worker peak CPU% | DB active conn peak |
|---|---|---|---|---|---|---|---|
| 1 | 303.33 | 337.01 | 389.89 | 195 | 3.2 | 39.2% | 4 |
| 10 | 495.91 | 845.31 | 919.24 | 1,073 | 17.7 | 40.4% | 18 |
| 50 | 2,577.40 | 4,466.24 | 5,501.71 | 1,110 | 18.1 | 39.5% | 58 |
| 80 | 3,805.65 | **8,739.95** | 12,241.58 | 1,112 | 17.8 | 37.7% | 88 |

**Observations:**
- DB cache hit ratio is 100% across all N — pure CPU-bound, no IO contribution.
- Worker CPU stays under 50% — bottleneck is on Postgres CPU (cosine compute), not client-side queueing.
- **QPS plateaus around 18 QPS between N=10 and N=80** — Postgres saturates much faster than Typical Power (which plateaued at ~130 QPS).
- **The cliff is between N=1 and N=10:** P95 jumps 337 → 845 ms (2.5×) while QPS climbs 3.2 → 17.7. By N=50, P95 is 4.5 s. By N=80, P95 is 8.7 s.
- Each query uses 3 cores (parallel + leader). 32 cores / 3 = ~10 concurrent queries before contention starts. The numbers track this precisely.

## Comparison to Typical Power (same protocol, same DB tuning, +SHM bump)

| Metric | Typical Power (20K) | Super Power (130K) | Ratio |
|---|---|---|---|
| Single-query warm unfiltered P95 | 92 ms | 326 ms | **3.5×** slower |
| Single-query warm filtered P95 | 38 ms | 218 ms | **5.7×** slower |
| Step 0 EXPLAIN execution | 84 ms | 332 ms | 4× slower |
| Concurrent QPS ceiling (saturation) | ~130 | ~18 | **7.2×** lower |
| N=10 P95 | 127 ms | 845 ms | **6.7×** slower |
| N=50 P95 | 660 ms | 4,466 ms | **6.8×** slower |
| N=80 P95 | 1,447 ms | 8,740 ms | **6.0×** slower |

**Scaling analysis:**
- Super Power has 6.5× more chunks per user (130K vs 20K).
- Single-query latency scaled ~3.5× — better than linear, thanks to parallel queries (2 workers).
- Concurrent throughput dropped ~7×, slightly worse than linear, because parallel queries consume more CPU per query AND cosine cost itself scales with chunks.

## Concurrency wall — concrete answer for Super Power

Same translation framework as the Typical Power handoff. Assuming a Pro user = Super Power user (~4,500 entities, heavy researcher), with ~0.25–0.3 searches/sec per active user:

| Active users (humans + AI conversations) | Concurrent in-flight queries | DB P95 | Full-request P95 | UX |
|---|---|---|---|---|
| 0–10 | 0–3 | ~330 ms | ~630 ms | fast ✅ |
| 10–30 | 3–10 | ~330–850 ms | ~630 ms – 1.15 s | starts feeling laggy ⚠️ |
| 30–80 | 10–25 | ~850 ms – ~3 s | ~1.15 s – 3.3 s | noticeably slow ⚠️⚠️ |
| 80+ | 25+ | 4 s+ | 4.3 s+ | broken-feeling ❌ |

**Soft wall: ~30 simultaneously active Super Power users.**
**Hard wall: ~50.**

For year-1 expected peak (~30 active concurrent), we're right at the soft wall if every user is at Super Power scale. With a realistic Pro-user mix (mostly Typical Power, some Super Power), we have headroom. With heavy AI chat usage that fans out per message, the wall hits sooner.

## Runner's preliminary read

**Super Power is the realistic upper bound of "still workable" for exact cosine on Pro hardware.**

**What's clearly OK:**
- Single-query latency at Super Power: 326 ms warm unfiltered, 218 ms warm filtered. Folded into end-to-end (≈ 250 ms embedding + 326 ms DB + 50 ms hydration ≈ **630 ms**), under 1 second.
- Step 0 still passes with parallel Bitmap Index Scan.
- DB cache hit ratio 100% — at this dataset size, vectors fit in shared_buffers.

**What's concerning:**
- Concurrent throughput collapses to ~18 QPS at the highest realistic-Pro user size. That's only ~5–10 concurrent users at full speed before queueing.
- The /dev/shm crash is a real production-relevant constraint we discovered: **Railway's default `RAILWAY_SHM_SIZE_BYTES = 64 MB` cannot support parallel cosine queries on Super Power+ data.** Production deployment must explicitly bump this.
- Linear extrapolation to **Reasonable Max (800K chunks/user, 6.2× more than Super Power)**:
  - Single-query latency could be ~2 s (assuming similar parallel speedup) → end-to-end ~2.3 s. **Borderline acceptable for single-user.**
  - Concurrent throughput could drop to ~3 QPS → essentially unusable under any concurrent load.
  - **Reasonable Max is the actually-scary case.** Phase 0 didn't measure it.

**What's surprising:**
- Single-query latency scaled sub-linearly with chunks (3.5× for 6.5× more data), thanks to parallel queries. Each query getting 3 cores helped.
- Concurrent throughput DROPPED super-linearly (~7× vs 6.5× expected) because parallel queries amplify the per-query CPU cost AND the cosine cost itself scaled.
- At higher data sizes, parallelism trades single-query speed for multi-tenant throughput — a real production tuning decision.

## Open questions for human review

1. **Reasonable Max (800K chunks/user) is unmeasured.** The Pro tier supports it. If even 1% of Pro users reach this scale, their search experience matters. Worth a focused single-user measurement on this bucket.
2. **At what user-count threshold does HNSW (approximate search) become preferable?** Current data suggests Super Power users are workable but Reasonable Max users probably aren't. A hybrid design — exact below threshold, HNSW above — may match the failure mode better than introducing HNSW for everyone.
3. **Production tuning decision:** Stay with parallel queries (better single-query UX, requires the SHM bump in prod) or disable parallel (better throughput at sustained load, no SHM concerns)? The data suggests the answer depends heavily on actual production load distribution.
4. **The benchmark assumed every user is Super Power-sized.** Real production traffic mix would be lighter on average — even a 50/50 mix of Typical Power and Super Power gives a meaningfully better aggregate throughput picture than this benchmark shows in isolation.

## Recommendation to reviewer

**Borderline — but the concerning side.** Super Power scale with concurrent load is the cliff edge for exact cosine on this hardware. Two options:

1. **Measure Reasonable Max focused (1 user × 800K chunks, single-query Scenario 1 only).** ~$0.30 in additional compute. Tells us whether exact cosine has any chance for the heaviest realistic user, or whether the answer is definitively "we need HNSW for the tail."
2. **Stop benchmarking, decide:** ship exact cosine for v1 with the understanding that we tier-gate Reasonable Max to a separate pathway (e.g., archival, or HNSW just for them), OR pivot to HNSW now because exact cosine at Reasonable Max is too risky to validate.

**My weak preference: option 1.** The marginal cost is trivial and the data resolves the biggest unknown.
