# Semantic Search: Benchmark Plan — Exact Cosine Viability

## Context

This plan is an addendum to [`2026-04-05-pgvector-embeddings.md`](./2026-04-05-pgvector-embeddings.md). Its sole purpose is to answer one question: **is exact cosine search performant enough across our realistic Pro-tier user-size distribution to be the v1 vector-search implementation?**

This is not a comparative benchmark of multiple designs. Exact cosine has perfect recall by construction — there is no candidate-pool truncation, no filter-after-retrieval problem, no approximation error. On the *quality* axis, it strictly wins over any HNSW-based design. The only open question is whether it is fast enough.

If exact cosine is fast enough, the main plan should be simplified to drop partitioning, per-partition HNSW indexing, the Alembic `env.py` autogenerate hook, the conftest partition DDL mirror, the `SET LOCAL` transaction contract, and the autocommit checks — all of which exist solely to make HNSW behave acceptably under multi-tenant filtering.

If exact cosine is not fast enough, we have a specific, measured cliff to design against, and any HNSW-based fallback design must be validated by its own benchmark before adoption — we do not jump from one unmeasured assumption to another.

This benchmark deliberately does NOT attempt to simulate HNSW behavior on synthetic data. Without real production usage patterns we cannot accurately model the partition-mate domination scenario or other approximate-search failure modes. Comparing exact vs HNSW on synthetic data risks producing numbers we cannot trust either way.

## Operational sequencing (read this before touching the parent plan)

The parent plan (`2026-04-05-pgvector-embeddings.md`) contains a "Redo note — earlier migration must be replaced" section instructing the implementer to downgrade and re-create the M1 migration as the partitioned-HNSW design. **Do not execute that redo until this benchmark produces a decision.** Three of the four candidate outcomes do NOT require a migration redo:

- **Outcome: exact cosine wins.** The currently-landed migration (`577108e3d7b9_…`, non-partitioned `content_chunks`, B-tree on `user_id`) is already the right shape. Apply "If exact cosine wins: cleanup scope" below — the only schema change is dropping the existing global HNSW index.
- **Outcome: re-benchmark global HNSW + iterative scan + B-tree(user_id), and that wins.** The currently-landed migration is *also* the right shape for this design — no partitioning, single global HNSW. Cleanup is in "If global HNSW wins: cleanup scope" below.
- **Outcome: re-benchmark partitioned HNSW + iterative scan, and that wins.** *Now* the parent plan's Redo note applies — execute the redo as described there.
- **Outcome: external vector DB.** Different track entirely; parent plan's Redo note does not apply.

Net rule: **the parent plan's Redo note is conditional on the benchmark outcome.** Implementers reading the parent plan first should land here before redoing any migration.

## What we're measuring

One design only:

- **Exact cosine + B-tree(`user_id`), no HNSW.** Single non-partitioned `content_chunks` table. B-tree index on `user_id`. Query plan: B-tree filter narrows to user's chunks → exact cosine `<=>` distance computed on those rows → sort → `LIMIT k`. No HNSW index of any kind.

Two scenarios with sub-variants:

1. Per-query latency across user sizes (low-locality + warm cache, unfiltered + filtered)
2. Latency under concurrent load (per-bucket and aggregate P95)

Plus a Step 0 EXPLAIN gate that verifies the planner uses the B-tree index.

## A note on thresholds

This plan deliberately does NOT define numeric pass/fail thresholds for "fast enough." Pre-defining cutoffs without data risks two failure modes: rejecting a viable design that's a hair above the asserted line, or accepting one that's technically below but actually feels bad.

Instead, the benchmark produces concrete numbers, the writeup contextualizes them (compared to expected end-to-end search budget, observed clustering across buckets, IO-vs-CPU breakdown), and the team makes a judgment call from data. Honest review beats checkbox criteria when the question is fundamentally about user experience.

The "End-to-end latency budget" section below provides rough orientation for what numbers mean in product terms, but it is informational — not a threshold to derive pass/fail from.

## End-to-end latency budget (informational)

The benchmark measures DB-side cost only. The full hybrid search request also includes:

- Query embedding API call (OpenAI `text-embedding-3-small` via LiteLLM): typically ~150–300ms
- FTS execution (concurrent with embedding): typically <50ms, hidden behind embedding latency
- Result merge (RRF) and filter reconciliation: typically <50ms
- Hydration of final entity rows: typically <100ms

So the DB cosine query is roughly 50–80% of the total request time for typical-bucket users. For a user-facing target like "P95 hybrid search under 1 second for typical users," the DB-side cosine query has a budget of ~500–700ms. For a power-user target of "P95 under 3 seconds," DB has ~2.5s.

These rough budgets are context for interpreting results, not benchmark gates.

## Test environment — Railway production-equivalent

Run the benchmark on a **temporary Railway Postgres instance** provisioned to match the production tier, NOT on local hardware. Local hardware (especially M-series Macs) runs cosine arithmetic 3–5× faster than typical Railway shared-vCPU Postgres instances; numbers measured locally would not translate.

**Provisioning steps:**

1. Create a new Postgres service on Railway (separate "benchmark" project is cleanest). DO NOT touch the production database. The benchmark instance is throwaway.
2. Provision at the same plan tier as production. **Before provisioning, confirm and record the current production tier (Railway plan name, vCPU count, RAM allocation, region) in the writeup's "Test environment" section** — the benchmark's relevance to the deploy decision depends entirely on this matching, and Railway tier definitions change over time. A Phase 1 run on the wrong tier produces authoritative-looking numbers that don't apply.
3. **Use the exact production image and tag currently deployed** — the parent plan currently names it as `postgres-ssl:17.9` (Railway-managed image with pgvector 0.8.2 installed), NOT the upstream `pgvector/pgvector:pg17` Docker image. These differ in base libc, default shared-memory behavior, and OS-level page-cache interactions. Verify the production image at provisioning time (it can change) and use the same tag for both phases.
4. Configure server settings to match production tuning, and **record the values in the writeup**:
   - `shared_buffers`: roughly 25–40% of allocated RAM (e.g., 2–4GB on 8GB).
   - `work_mem`: the default 4MB is fine for `LIMIT 100` sorts; pin it explicitly so it isn't a hidden variable.
   - `max_connections`: must be at least 110 to support the N=100 Scenario 2 cell with `pool_size = 110`. Railway Postgres tiers commonly default to 100 — raise it via the platform config before running Scenario 2 at N=100, or the cell will fail with `FATAL: too many connections` rather than producing a measurement. If Railway's tier locks `max_connections` below 110, lower the Scenario 2 top concurrency to fit (and document the substitution). Pre-flight check: `SHOW max_connections;` immediately after provisioning.
5. **Verify shared-memory allocation is large enough for the configured `shared_buffers`.** Managed Postgres on container platforms commonly defaults container `/dev/shm` to ~64MB, which prevents Postgres from starting with multi-GB `shared_buffers`. If `shared_buffers >= 1GB`, raise the container SHM limit per Railway's config before the database starts. Symptom of failure: Postgres fails to start with `could not create shared memory segment` or silently runs with a much smaller effective `shared_buffers`. Pre-flight check: confirm with `SHOW shared_buffers;` matches the configured value after startup.
6. **Verify available disk headroom before seeding.** Phase 1's dataset is ~43GB on disk before B-tree, WAL, autovacuum overhead, and filesystem reservation — call it ~50GB minimum required free space. Default Railway volumes are typically 50GB on Pro tiers; resize to ≥75GB before seeding or abort if free space falls below a 15GB safety margin. Pre-flight check: `SELECT pg_size_pretty(pg_database_size(current_database()));` plus `df -h` on the data volume if Railway exposes it.
7. Enable `pg_stat_statements` if (and only if) the per-cell stat resets will use it: add to `shared_preload_libraries` (requires restart on Railway) and `CREATE EXTENSION pg_stat_statements;`. If Railway makes this awkward, drop the `pg_stat_statements_reset()` call from the per-cell reset and use only `pg_stat_reset()` — the writeup primarily reads end-of-cell aggregates from the harness, not from `pg_stat_statements`.
8. **Pin `Vector(1536)` storage type explicitly.** pgvector's default has historically been `EXTENDED` (TOAST-eligible compression), but this has changed across versions and produces materially different IO regimes from `EXTERNAL` or `PLAIN`. Right after creating the table, run `SELECT attstorage FROM pg_attribute WHERE attrelid = 'content_chunks'::regclass AND attname = 'embedding';` and record the value in the writeup. If it differs from production's table, run `ALTER TABLE content_chunks ALTER COLUMN embedding SET STORAGE <production-value>` before COPY.
9. **Run the benchmark client as a separate Railway service in the same region**, not from a local laptop. Intra-Railway DB connections avoid the ~30–80ms network latency that internet upload would add to every query and every COPY operation.
10. **Capture Railway Postgres storage backing in the writeup** — local NVMe SSD vs network-attached block storage produce very different P99 tails on cold-cache reads, especially for Reasonable Max. Record what's available from Railway's dashboard / docs at provisioning time so future readers can interpret the numbers in context.

**Benchmark client harness:** Python 3.13 + `asyncpg` directly (matches production stack, lower overhead than SQLAlchemy session for raw-query measurement). One shared `asyncpg.Pool` across asyncio tasks. Per-query wall-clock measured around `pool.fetch(...)`. Connection pool size larger than max test concurrency (e.g., `pool_size = 110` for the N=100 concurrency test) so the pool itself never queues.

**Pre-generated query-vector pool with modulo cycling.** Pre-generate ~1000 unit-normalized 1536-d vectors per cell into an in-memory list before warm-up. Tasks pick vectors via `vec = pool[i % len(pool)]` so a fast cell doesn't exhaust the pool — vectors are reused across queries within a cell. This is fine because the test measures *cosine cost over a query distribution*, not unique-query throughput; reuse doesn't affect DB-side work (every `<=>` compute is fresh regardless of input recurrence). Pool size of 1000 is enough variety to prevent the planner caching a literal value. Do NOT generate vectors inside the timed measurement loop — inline numpy + normalize work is ~100–500µs per query, large relative to small-bucket DB cost (sub-millisecond at Light), and would distort IO-vs-CPU classification. `time.monotonic()` brackets only `pool.fetch(...)`, never vector generation.

**Transaction discipline.** Each `pool.fetch(...)` runs in an implicit autocommit transaction. Exact cosine has no `SET LOCAL` requirement (unlike the parent plan's M5 HNSW path) — do not carry that complexity over by analogy. The harness is a single SELECT per measured query.

**Vector encoding for asyncpg.** asyncpg requires explicit codec setup to handle pgvector's `vector` type; the runner cannot assume `Vector(1536)` parameters and result columns "just work." Two paths:

- **Queries:** Use the `pgvector` Python package's asyncpg integration. Per-connection setup: `from pgvector.asyncpg import register_vector; await register_vector(conn)`. Apply via `asyncpg.create_pool(setup=register_vector)` so every connection in the pool registers the codec on acquisition. After this, `pool.fetch(...)` accepts and returns `numpy.ndarray` for vector columns transparently.
- **COPY (seeding):** Use **text format**, not binary. Send vectors as their string representation (`'[0.123,0.456,...,0.789]'::vector`) via `COPY content_chunks FROM stdin WITH (FORMAT text)`. Rationale: text format is ~2× slower than binary on COPY, but eliminates the work of constructing pgvector's binary wire layout (uint16 dim + uint16 unused + float32[] big-endian) by hand. At 5.6M rows this still completes within the 10–15 minute Phase 1 seeding budget. If seeding throughput proves materially worse than budget, revisit binary format with explicit reference to pgvector's protocol docs — but text first, since the runner gets a working pipeline immediately.

**Worker service provisioning:** at minimum 4 vCPU / 4GB RAM so the benchmark client itself is not the bottleneck at N=100. If at N=100 the host CPU on the worker saturates first (visible via `top` on the worker), increase the worker's resources rather than reporting saturated numbers as DB-bound. The measurement should reflect DB+CPU on the Postgres side, not client-side queueing.

**Authentication and access.** A randomly-generated password on a public-URL Postgres instance is fine for the duration of the benchmark — no real user data ever touches it; the database contains synthetic random vectors. Tear down the instance immediately when measurements are complete.

**Expected total cost: $2–10** for the entire benchmark (Postgres instance + worker service running for several hours). Tear-down stops billing.

## Phased execution: preliminary first, full benchmark second

The benchmark runs in two phases. Each phase uses its own dedicated Railway Postgres instance — Phase 1 spins up fresh, NOT reusing Phase 0's instance. The cost difference is rounding error in the $2–10 budget, and using a fresh instance for Phase 1 eliminates a real methodology hole (Phase 0's data hot in Phase 0's `shared_buffers` would bias Phase 1's "low-locality" measurements at Typical Power).

### Phase 0 — Preliminary: Typical Power as fail-fast gate

**Goal:** decide whether exact cosine is plausibly viable enough to justify the full benchmark, or catastrophically fails at the smallest informative bucket.

**Setup (on dedicated Phase 0 instance):**
1. Provision Phase 0 Postgres + worker on Railway. Confirm `shared_buffers`, `max_connections`, `work_mem`, and `Vector` column `attstorage` per the test-environment provisioning checklist.
2. Generate and seed 10 users × 20,000 chunks each (~200K chunks total, ~1.5GB on disk). See "Data generation" and "Seeding sequence" below. (Phase 0 does NOT seed filler users — the dataset is too small to dilute meaningfully and the fail-fast gate is OK with this.)
3. Build B-tree on `user_id`.
4. **`VACUUM ANALYZE content_chunks`** to refresh planner statistics and visibility map after bulk load.
5. Total seeding time: ~2–3 minutes; record actual throughput.

**Run:** Step 0 EXPLAIN gate against Typical Power, then Scenario 1 (low-locality + warm cache, unfiltered + filtered = 4 cells) and Scenario 2 (4 concurrency levels) restricted to Typical Power queries only. Concurrency tests in Phase 0 are simpler than Phase 1's mixed-bucket distribution — all queries hit the Typical Power bucket since that's all that's seeded. ~15–20 minutes.

**Note: Step 0 in Phase 0 is diagnostic-only, NOT load-bearing on planner choice.** With 10 distinct `user_id` values and no filler users, `n_distinct(user_id)` is artificially small and the planner sees per-user selectivity (`1/n_distinct`) that doesn't generalize. A Phase 0 Index Scan does not predict Phase 1 behavior — Phase 1's filler-diluted ~1085 distinct values is where Step 0 carries weight on planner choice. In Phase 0, Step 0 mainly serves to confirm the EXPLAIN harness works and that no obvious DDL/extension issue is blocking the index path.

**Decision (HUMAN REVIEW REQUIRED — do NOT auto-tear-down):**

After Phase 0 measurements complete, the runner produces a short summary (Step 0 EXPLAIN, Scenario 1 + 2 numbers for Typical Power, observed regime — IO vs CPU, CPU saturation point, etc.) and **stops before any tear-down or Phase 1 provisioning.** Tear-down is a human decision because (a) seeding takes real time and money to recreate, (b) Phase 0's data hot in `shared_buffers` may be useful for ad-hoc follow-up exploration that the original plan didn't anticipate, and (c) the runner should not autonomously discard a paid resource based on its own read of "looks fine."

Human review picks one of:

- **Catastrophic failure at Typical Power.** Examples of what counts: P95 in seconds for single queries; planner declines the index even after `ANALYZE`; concurrent load saturates immediately at low N with no QPS scaling; CPU pegged at 100% with single-digit QPS. Higher buckets will be worse by construction — exact cosine cost scales linearly with chunks. **Action:** human authorizes tear-down of Phase 0, runner writes up findings as the benchmark deliverable, do not proceed to Phase 1.

- **Clearly fast.** Numbers comfortably inside the rough end-to-end budget at Typical Power. Phase 0 passing does NOT prove exact cosine is viable across the full distribution — acceptable performance at 20K chunks does not guarantee acceptable performance at 130K or 800K. **Action:** human authorizes tear-down of Phase 0, runner provisions fresh Phase 1 instance, proceeds to Phase 1. (Justification for tear-down: Phase 1 re-seeds Typical Power fresh anyway, so Phase 0 data is not reusable.)

- **Borderline / want more data.** Numbers are interpretable but raise questions the original cells don't answer (e.g., a P95 outlier on warm cache, an unexpected CPU/IO ratio in EXPLAIN BUFFERS, a concurrency cell that didn't behave linearly). **Action: keep Phase 0 instance running.** Human directs additional cells; while waiting for human input the runner can productively work the following standardized probe list (a starting point, not a substitute for human judgment):
    1. **Variance check.** Re-run the borderline cell with a freshly-pre-generated query-vector pool (different RNG draw within the pinned seed range) to see whether the number is stable or noisy.
    2. **Plan introspection.** `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` on a representative outlier query — look for unexpected sort spills, multi-pass heap visits, or row-count estimates far off from actuals.
    3. **Sort-spill check.** Re-measure the outlier cell with `SET LOCAL work_mem = '32MB'` to see whether spill-to-disk explains a high tail. If P95 drops materially, the default `work_mem` is too small for the cell.
    4. **Outlier inspection.** If `pg_stat_statements` is enabled, `SELECT query, calls, mean_exec_time, max_exec_time FROM pg_stat_statements ORDER BY max_exec_time DESC LIMIT 10;` to find specific slow queries.
    5. **Autovacuum sanity.** `SELECT relname, last_autovacuum, last_autoanalyze FROM pg_stat_user_tables WHERE relname = 'content_chunks';` — confirm autovacuum hasn't run mid-cell (which would invalidate the measurement window).

  Decide afterward whether to proceed to Phase 1, stop, or extend Phase 0 further.

The Phase 0 gate is asymmetric on purpose: it catches obvious failures cheaply but does not approve exact cosine on weak evidence. The full benchmark on a fresh instance is still required for a real decision. **The runner must NOT autonomously tear down the Phase 0 instance based on its own read of the numbers — only on explicit human authorization.**

**Phase 0 cost: ~$0.50–1.50** (Postgres + worker running ~30–45 minutes prorated).

### Phase 1 — Full benchmark (fresh instance)

**Goal:** measure exact cosine across the full Pro-tier user-size distribution to inform the actual ship-or-fallback decision.

**Setup (on dedicated Phase 1 instance — fresh provision, NOT a reuse of Phase 0):**
1. Provision a new Phase 0-equivalent Postgres + worker on Railway. Confirm same `shared_buffers`, `max_connections`, `work_mem`, and `Vector` column `attstorage` as Phase 0 for comparable measurements.
2. Generate and seed all 5 measured buckets fresh from the same deterministic data generator (same random seed) — see "Data generation" below — **plus the ~1000 filler users** described in "Filler users" so the planner sees a realistic tenant cardinality.
3. Build B-tree on `user_id` after the heap is loaded.
4. **`VACUUM ANALYZE content_chunks`** to refresh planner statistics and visibility map after bulk load.
5. Total seeding time: ~10–15 minutes; record actual throughput.

**Run:** Step 0 EXPLAIN gate against all 5 buckets, full Scenario 1 (5 buckets × 4 cells = 20 measurement cells), full Scenario 2 (4 concurrency levels with realistic mixed-bucket distribution). ~30–60 minutes.

**Decision:** see "Decision rule" below.

**Phase 1 additional cost: ~$1.50–8.50** (instance running additional ~3–5 hours prorated).

**Total cost if both phases run: $2–10.**

## Data generation

Synthetic 1536-dimensional unit-normalized random vectors. Cosine arithmetic does not depend on semantic structure, so random vectors are sufficient for measuring CPU/IO cost. Real OpenAI embeddings would burn ~$30+ for no measurement gain.

User-size buckets matching the realistic Pro-tier distribution (per chunks-per-entity analysis in the main plan):

| Bucket | Total chunks per user | Profile |
|---|---|---|
| Light | 500 | ~65 entities, mostly bookmarks + short notes (~7 chunks/entity avg) |
| Typical | 3,000 | ~300 entities, mix with medium notes (~10 chunks/entity avg) |
| Typical Power | 20,000 | ~1,000 entities, more long-form (~20 chunks/entity avg) |
| Super Power | 130,000 | ~4,500 entities, heavy researcher (~29 chunks/entity avg) |
| Reasonable Max | 800,000 | ~18,000 entities approaching Pro tier ceilings (~44 chunks/entity avg) |

The "Reasonable Max" bucket represents heavy-but-still-legitimate Pro usage in the realistic-year-1 sense — bounded by the Pro tier limits (10K of each entity type) and the per-entity chunk cap (2000 from M2). This is "what an active heavy researcher could plausibly accumulate," not the absolute mathematical maximum (which would be 30K entities × 2000 chunks ≈ 60M, an abuse profile we explicitly do not design for). Users beyond 800K accept degraded search experience until and unless we revisit.

**Per-phase seeding (each phase uses its own dedicated instance):**

| Bucket | Users to seed | Chunks per user | Bucket subtotal | Seeded in |
|---|---|---|---|---|
| Light | 30 | 500 | 15,000 | Phase 1 only |
| Typical | 30 | 3,000 | 90,000 | Phase 1 only |
| Typical Power | 10 | 20,000 | 200,000 | Phase 0, then re-seeded fresh in Phase 1 |
| Super Power | 10 | 130,000 | 1,300,000 | Phase 1 only |
| Reasonable Max | 5 | 800,000 | 4,000,000 | Phase 1 only |

**Phase 0 dataset: ~200K chunks (~1.5GB on disk).**
**Phase 1 dataset: ~5.6M chunks across ~85 measured users (~40GB on disk), plus ~1000 "filler" users (see below) for ~3GB additional.**

**No per-query DB costs and no rate limits on Railway** — bill is metered by compute + storage time, not query count.

### Filler users — tenant-count realism for planner statistics

The 85 "measured" users above (5+10+10+30+30) are far too few to represent the multi-thousand-tenant world the production design targets. With only 85 distinct `user_id` values in the table, the planner's `pg_stats.n_distinct` for `user_id` is small, per-user selectivity (`1/n_distinct`) is artificially generous, and the binary Step 0 gate — "does the planner pick the B-tree index?" — risks a *false positive* (planner picks the index because per-user selectivity looks great in this corpus, but would not at production scale). Worse, one Reasonable Max user at 800K chunks is ~14% of the entire benchmark table, which the planner would correctly identify as a poor index candidate but production would not.

**Mitigation: seed ~1000 "filler" users with 100 chunks each (~100K chunks total, ~700MB) before measurement.** These users are not queried — they exist purely to dilute `n_distinct(user_id)` so the planner's selectivity model resembles a multi-tenant production environment. The seeding sequence below covers them; they're built into Phase 1 only (Phase 0's 10-user dataset is too small to dilute meaningfully and the fail-fast gate is OK with the false-positive risk being asymmetric — it errs toward proceeding to Phase 1, where dilution is in place).

This is still not 2000 users (the year-1 Pro target), but ~1000 distinct values is enough to push `n_distinct` past most planner heuristic thresholds. If post-seeding `EXPLAIN` analysis suggests the planner is still seeing artificially high selectivity, scale fillers up and re-run — cost is rounding error.

### Seeding sequence (locked, not optional)

The order of operations during seeding affects both seeding time and measurement validity. Implementer must follow this sequence:

1. **Bulk-load the heap via `COPY`.** Do NOT have the B-tree on `user_id` in place during COPY — building indexes incrementally during a 5.6M-row load is materially slower than building once after. (Phase 1: COPY filler users in this same step so they're part of the post-COPY index build and statistics refresh.)
2. **Record seeding throughput as a sanity number** (rows/sec sustained). If Phase 1 COPY takes substantially longer than the 10–15-minute budget (say 30+ minutes), that's a signal storage IO is unusually slow on this instance, and Scenario 1 cold-cache numbers should be flagged accordingly in the writeup. This is a reported metric, not just a plan budget.
3. **Build the B-tree** on `user_id` after COPY completes.
4. **`VACUUM ANALYZE content_chunks`** to refresh `pg_class.reltuples`, column statistics, and the visibility map. `ANALYZE` alone misses the visibility map, which the planner uses for Index-Only Scan eligibility; on a freshly-COPYed table autovacuum has not run yet. Without this step the planner evaluates Step 0 against stale stats (typically 0 rows on a freshly-loaded table) and may choose Seq Scan, Index Scan, or Bitmap Index Scan for the wrong reasons.

This sequence is required, not a tuning suggestion.

### Recommended COPY tuning (session-scoped, no platform changes needed)

To hit the seeding time budget on the Phase 1 dataset (~40GB in ~10–15 minutes), apply these tuning knobs **per session on the COPY connection** (not as server config — no Railway platform changes required, no risk of platform locks):

- `SET maintenance_work_mem = '1GB';` before the B-tree build (faster index construction). Both `maintenance_work_mem` and `synchronous_commit` are `USERSET` GUCs — settable per-session by any role. Resets at session end automatically.
- `SET synchronous_commit = off;` on the COPY connection (safe for throwaway instance — durability doesn't matter here).
- Use **text COPY format** for vectors per the "Vector encoding for asyncpg" subsection above — text is slower than pgvector binary but still fits the 10–15 minute budget at 5.6M rows, and avoids the runner having to implement pgvector's binary wire protocol by hand.

The only platform-level config knob in this plan is `max_connections` (server-side, must be set at provisioning per §Test environment). Everything else is session-scoped and works on any Railway tier without escalation.

### Reproducibility

- **Pin both random seeds:** the seed for synthetic vector generation AND the seed for query-vector generation during Scenarios 1 and 2. A re-run of the benchmark should produce byte-identical data and queries.
- **Reset Postgres statistics between phases and between Scenario 2 concurrency levels:** `SELECT pg_stat_reset();` before each new measurement cell. (If `pg_stat_statements` is enabled per the test-environment provisioning step, also call `SELECT pg_stat_statements_reset();` — but do not assume it's available.) Per-cell stats stay clean and don't cumulate.
- **Row data per chunk:**
    - `id` (uuidv7)
    - `user_id`
    - `entity_type` (random of bookmark/note/prompt)
    - `entity_id` — **NOT a fresh random UUID per chunk.** Generate `entity_id` values such that the chunks-per-entity distribution in each bucket matches the bucket profile (~7 for Light, ~10 for Typical, ~20 for Typical Power, ~29 for Super Power, ~44 for Reasonable Max). **Pin to deterministic round-robin** (do not introduce variance shape — the benchmark doesn't need it): for a user with `N` total chunks and target average `k` chunks/entity, generate `m = ceil(N/k)` distinct `entity_id` UUIDs from the pinned RNG, then assign each chunk via `entity_idx = chunk_idx // m` (so chunks 0..k-1 share entity 0, chunks k..2k-1 share entity 1, etc.). This gives every entity exactly `k` or `k+1` chunks; deterministic and reproducible. **Why this matters:** production exact-cosine queries overfetch chunks then dedupe to entities in application code (parent plan M5 — overfetch 200 → 100 entities). With one `entity_id` per chunk, every chunk is its own entity and dedup pressure vanishes — the benchmark would understate the production work pattern. The Step 0 / Scenario 1 / Scenario 2 queries themselves still measure DB-side cosine cost (which is largely independent of entity density), but the writeup must explicitly note that application-side dedup overhead (load-by-entity-IDs hydration in M5) is unmeasured here and adds non-zero CPU on the API side. Variance shape (Poisson, Pareto, etc.) is *not* needed because the dominant production query work is invariant under variance — what matters is that average density isn't 1.
    - `chunk_type` ("content" 90% / "metadata" 10%)
    - `chunk_index` (consistent with chunk_type — metadata is always 0, content is 0..N within an entity)
    - `chunk_text` — **NOT a short placeholder like `'x'`.** Real production chunks are ~200–2000 characters of text. Seed with random lorem-style text in the 800–1500 character range so heap row width approximates production. With `'x'` as the placeholder, main-heap pages hold ~10× more rows than production and EXPLAIN BUFFERS would under-report the per-query buffer count, which (combined with TOAST) misclassifies the IO regime. Note: chunk_text itself is small enough to live in the main heap regardless of size in this range; the embedding's TOAST behavior dominates IO either way, but chunk_text width affects heap-page packing density and therefore index-fetch and B-tree-traversal IO.
    - `chunk_hash` (random sha256)
    - `model` ("text-embedding-3-small")
    - `embedding` (1536-d random unit-normalized float32)

## Test scenarios

### Step 0 — Verify the planner uses the B-tree index (binary gate)

Run after seeding completes and `ANALYZE` has run. For each bucket size, capture `EXPLAIN (ANALYZE, BUFFERS)` for one representative query:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT entity_type, entity_id, embedding <=> :q AS distance
FROM content_chunks
WHERE user_id = :uid
ORDER BY distance
LIMIT 100;
```

**This is a binary gate.** The plan **passes** if it reads via the `user_id` B-tree in either of the following forms (both are valid production plans):

- `Index Scan using ix_content_chunks_user_id` (or equivalent name)
- `Bitmap Index Scan` followed by `Bitmap Heap Scan` — the planner's preferred shape on selective-but-not-tiny `user_id` filters at large heap sizes; this is fine, do not flag it as a failure

(Index Only Scan is **not** a valid pass plan for this query: the SELECT requires `entity_type`, `entity_id`, and `embedding`, none of which are in the bare `(user_id)` index. An Index Only Scan would require an index with `INCLUDE (entity_type, entity_id)` covering columns, which is out of scope for this benchmark and not present in the landed migration.)

The plan **fails** if the planner picks `Seq Scan` (full-table scan) for any bucket under default settings. Capture the EXPLAIN output, document it as a finding, and do not "rescue" the result with `enable_seqscan = off` or session-level planner hints — those are diagnostic tools, not production contracts. If exact cosine only looks viable under planner coercion, it is not viable in deployed code.

**Tenant-count caveat for Step 0 interpretation.** The benchmark seeds ~1000 filler users (Phase 1) to dilute `n_distinct(user_id)` toward production-like values — see "Filler users" above. If the planner picks the index in Phase 1, that's load-bearing only insofar as the dilution worked. If post-`VACUUM ANALYZE` the planner's `n_distinct` for `user_id` is still small relative to the production target (~2000+ Pro users, growing), increase fillers and re-run rather than accepting a marginal index pick that production scale would invalidate.

**TOAST awareness when reading BUFFERS output.** pgvector's `Vector(1536)` column uses 6,144 bytes per row (1536 × 4-byte float). This is well above Postgres's TOAST threshold (~2KB), and pgvector's default storage is `EXTENDED`, so the embedding values live in the TOAST table for `content_chunks`, not the main heap. EXPLAIN BUFFERS reports per-relation buffer counts — main heap and TOAST are separate. For an honest CPU-vs-IO classification, capture **full BUFFERS output including the TOAST relation** (look for `_toast_*` relations in the BUFFERS section), not just the main-heap summary. The bulk of IO during cosine computation is TOAST fetches; missing them entirely will misread the regime.

### Scenario 1 — Per-query latency across user sizes

For each bucket, measure two cache regimes × two filter variants.

**Cache variants:**

- **Low-locality / cold-ish upper bound:** rotate users between queries so each query likely hits a different user's pages. At smaller bucket sizes (Light, Typical), the working set fits entirely in `shared_buffers` and "cold" is impossible without service restart — these numbers represent low-locality access, not true disk-cold. At larger buckets (Super Power, Reasonable Max), per-user data exceeds buffer capacity and rotation does approach cold. The asymmetry is documented in the writeup; numbers across buckets are interpreted with this in mind.
- **Warm cache:** issue sequential queries against the same user. Realistic active-search-session pattern — represents typical UX during an interactive session.
- **Force-cold sub-cell, Reasonable Max only:** approximates the "first search after a quiet weekend" experience that rotation-based low-locality understates at this bucket. **Recipe:**
    1. Trigger a Postgres restart via `railway service restart <postgres-service-name>` (or the dashboard restart button). There is no `pg_ctl` access on Railway's managed Postgres.
    2. Poll `pg_isready -h <host>` until the database accepts connections (typically 30–60s after restart).
    3. Recreate the `asyncpg.Pool` — the previous pool's connections are dead, including their codec registrations.
    4. Issue **20 queries** against a Reasonable Max user immediately, with no warm-up phase. (N=5, the original draft, is too few to report as P95: P95 of 5 samples is essentially `max()` and CIs are wide. N=20 is still cheap because restart dominates the wall-clock cost.)
    5. Report P50, P95, min, max for the cell.

  **Reframed claim:** what this measures is **fresh Postgres process / cleared `shared_buffers`**, NOT a true bare-disk cold. A Railway restart resets the Postgres process and empties `shared_buffers`, but the OS page cache may still hold pages depending on whether Railway reused the underlying VM (no guarantee). Treat the sub-cell as an *upper bound for in-buffer-pool latency after a cold restart* — slower than warm but generally faster than true bare-disk cold. Report this as its own cell in the writeup, not blended with low-locality numbers — the regimes are different and should be interpreted separately.

**Filter variants:**

- **Unfiltered:** `WHERE user_id = :uid ORDER BY embedding <=> :q LIMIT 100`
- **Filtered:** `WHERE user_id = :uid AND entity_type = 'note' ORDER BY embedding <=> :q LIMIT 100`

The filtered variant has a 3–10× smaller candidate set after filtering by `entity_type` and is closer to typical production query shape (users frequently restrict to one content type).

**Note on `LIMIT 100` vs production query shape.** The benchmark uses `LIMIT 100` at the SQL layer for both filter variants, but production exact-cosine retrieval (parent plan M5) overfetches *chunks* (e.g., LIMIT 200) then dedupes to 100 entities in application code. Cosine compute cost is approximately invariant under LIMIT (full filter scan + sort), but ranking and heap-extract steps scale with LIMIT, and overfetch ratio depends on per-bucket chunks/entity averages (~7 to ~44). The benchmark thus measures the dominant DB-side cost faithfully, but slightly understates production query work. The writeup must explicitly call out this gap and note that application-side dedup + entity hydration overhead is unmeasured.

**Note on dimension lock-in.** Cosine arithmetic cost scales linearly with vector dimensions. These numbers are valid for the current 1536-d `text-embedding-3-small` model. If the production model ever moves to 768-d (`text-embedding-3-small` with reduced dims) or 3072-d (`text-embedding-3-large`), the per-query CPU side of these numbers does NOT translate proportionally without re-running. Add a one-line note in the writeup tying numbers to the 1536-d assumption.

**Methodology per (bucket × cache × filter) cell:**

1. **Pre-generate query vectors.** Before warm-up, generate the full pool of query vectors for this cell (e.g., 1000 unit-normalized 1536-d vectors using the pinned query seed) into an in-memory list. The timed loop iterates this list — vectors are NEVER generated inline during the timed measurement. Inline generation adds ~100–500µs of Python work per query, which is large relative to small-bucket DB cost and would distort the IO-vs-CPU classification.
2. **Warm-up phase.** Issue 10 queries that are NOT included in the measurement sample. These exist solely to stabilize cache and connection state. For warm-cache cells, more warm-up queries may be appropriate at the larger buckets — issue enough that subsequent timing numbers are stable across the next 10 queries. For Reasonable Max specifically, expect to need 20–30 warm-up queries before warm-cache numbers stabilize.
3. **Reset stats:** `SELECT pg_stat_reset();` (and `pg_stat_statements_reset();` if the extension is enabled) before measurement.
4. **Measure 200 queries** (1000 for Reasonable Max where sample size matters most). Capture per-query application-level wall-clock time via `time.monotonic()` around `pool.fetch(...)` only — never around vector generation.
5. **Report:** P50, P95, P99 latency for the cell, plus N samples. **P99 confidence caveat:** at N=200 (the four smaller buckets), P99 is approximately the 2nd-largest of 200 samples — wide CIs, footnote it as "low confidence" in the writeup or drop P99 entirely for those cells. P99 at N=1000 (Reasonable Max) is reportable.

Output: a table of (bucket, cache regime, filter variant) → P50/P95/P99 + N. Plus EXPLAIN BUFFERS per bucket (full output, including TOAST counters) so we can see the CPU vs IO breakdown.

No pass/fail thresholds are asserted. The writeup interprets the numbers in light of the end-to-end budget (informational section above) and the team decides whether they're acceptable.

### Scenario 2 — Latency under concurrent load

**Concurrency justification.** Realistic peak load math: assume 2,000 Pro users at year-1 adoption, ~30 active simultaneously at peak business hours, search-session bursts of 3 queries per active user → peak instantaneous concurrency in the 10–30 range. Test at N ∈ {1, 10, 50, 100} — N=50 provides ~1.5–5× headroom over expected peak; N=100 is informational stress test. (At N=100, `pool_size = 110` requires `max_connections ≥ 110` on the Postgres side per the test-environment provisioning step — verify before running.)

**User-distribution weighting (best-guess, not derived).** The "70% Light/Typical, 25% Typical Power, 5% Super Power + Reasonable Max combined" weighting used below is **a best-guess**, not derived from telemetry (no production telemetry exists yet). Real heavy users likely search disproportionately *more* than typical users — i.e., the realistic load may weight up the slow buckets relative to the population shape. This is why per-bucket P95 (below) is the load-bearing number; the aggregate-P95 line is interpreted with this weighting caveat in mind. If post-launch telemetry shows a meaningfully different distribution, re-run Scenario 2 to update aggregate numbers.

For each concurrency level N:

1. **Pre-generate** N × ~1000 query vectors per task into an in-memory list (each task pops from its own pre-generated list during the loop). Do not generate vectors inside the timed loop — same reasoning as Scenario 1.
2. **Warm-up phase.** 10 queries (single-threaded) to stabilize cache before launching concurrent tasks.
3. **Reset stats:** `SELECT pg_stat_reset();` (and `pg_stat_statements_reset();` if the extension is enabled) before launching the timed run.
4. Launch N concurrent asyncio query tasks using the shared `asyncpg.Pool`.
5. **Loop duration.** Each task runs in a loop for the configured duration. **Default to 180 seconds, not 60.** Rationale: at 5% bucket weighting and aggregate QPS in the dozens-to-hundreds, a 60-second window may put only ~30 samples into the Reasonable Max bucket — P95 of 30 samples is noisy and the long-tail experience for power users is exactly what the writeup needs to defend with confidence. 180s triples the per-bucket sample count at trivial cost (the run is rounding error in the $2–10 budget). For N=1 single-threaded, 60s is fine; longer runs only matter when concurrent throughput dilutes per-bucket samples.
6. Each task: in the loop, pick a random user weighted by the distribution above, pop a pre-generated vector, issue the query, record latency, repeat.
7. **Report per concurrency level:**
   - **Aggregate P95** across all queries
   - **Per-bucket P95** (separately for queries that hit each bucket) **plus N samples per bucket** so reviewers can judge confidence intervals — a P95 over fewer than ~50 samples should be footnoted as low-confidence
   - Total queries completed (run-window count) and **derived QPS = total queries / run-window seconds**. Do not collapse these into one number labeled "QPS" — the run-window count is the primary measurement and QPS is derived from it.
   - **CPU saturation, instrumented (not eyeballed):**
       - **Worker side:** start a background asyncio task on the worker that calls `psutil.cpu_percent(interval=1.0)` every 5s for the duration of the run, logging samples to a per-cell file. Report peak and P95 of those samples in the writeup. (`htop` is interactive and useless from a Railway container; do not rely on it.)
       - **Postgres side:** capture activity proxies, since you don't have shell access on Railway-managed Postgres. Every 5s, query `SELECT count(*) FILTER (WHERE state = 'active') AS active, count(*) AS total FROM pg_stat_activity;` and `SELECT sum(blks_hit), sum(blks_read), sum(tup_fetched) FROM pg_stat_database;` from the worker against the benchmark DB. Compute deltas across the run; saturation is visible as `active` plateauing at the connection limit and `tup_fetched` growth flatlining.
   - Confirm worker-side CPU has headroom (worker peak and P95 well below 100%) so the observed bottleneck is the Postgres server, not client-side queueing. If worker peaks ≥80%, increase worker resources and re-run rather than reporting saturated numbers as DB-bound.

If per-bucket sample counts at the highest buckets remain low even at 180s (e.g., <50 in Reasonable Max), run a separate "biased-distribution" cell for that concurrency level: same N, same duration, but weight the user-pick toward the slow buckets (e.g., 50% Reasonable Max). Use the biased cell for per-bucket P95 confidence; use the realistic-distribution cell for aggregate-P95 / QPS / CPU. Document both clearly.

Reporting per-bucket P95 separately is critical: a user living in Reasonable Max could experience consistent multi-second latency on every search while the aggregate hides it (because only 5% of queries hit that bucket). The decision needs to see the long-tail experience, not just the headline.

No pass/fail thresholds asserted. The writeup interprets the numbers.

## Decision rule (asymmetric, by design)

The benchmark produces numbers; the writeup contextualizes them; the team decides. Two outcomes:

**Outcome 1: Exact cosine looks acceptable.**
The numbers across all scenarios — single-query latency at each bucket, low-locality and warm cache, unfiltered and filtered, per-bucket P95 under concurrency — fit within rough end-to-end budget for the user populations the product is trying to serve. Ship exact cosine + B-tree(user_id) as the v1 design. Apply the cleanup scope from the section below to remove the partitioned-HNSW machinery from the main plan and the codebase.

**Outcome 2: Exact cosine has a measured cliff.**
The numbers show a specific failure mode: a particular bucket size, a particular cache regime, a particular concurrency level. **At this point we have a known cliff but no validated fallback.** Adoption of any HNSW-based design requires its own same-harness benchmark of that specific design before it ships. Do not jump from one unmeasured design assumption to another.

**Default first follow-up benchmark: global HNSW + iterative scan + B-tree(user_id).** This is the lowest-complexity HNSW design — single non-partitioned table, single global HNSW index, iterative scan handles the `user_id` post-filter. It drops everything in the cleanup scope below EXCEPT the HNSW index itself: no partitioning, no `env.py` autogenerate hook, no conftest partition DDL mirror, no `SET LOCAL` autocommit checks beyond what HNSW iterative scan needs (which are simpler than the partitioned case). If exact cosine fails and the cliff isn't conclusively a "we need a fundamentally different storage shape" signal, this is the design to benchmark first.

**Tension with the parent design doc — explicit acknowledgment.** `docs/vector-db-and-semantic-search.md` and the parent plan both call out *naive* global HNSW with a `WHERE user_id = ?` post-filter as a recall failure mode at scale: HNSW returns its top-`ef_search` candidates by distance, and if a partition-mate's chunks dominate the candidate pool, the querying user's relevant chunks may never appear in the result set even though they're closer in vector space. **That is the failure mode partitioning was introduced to avoid.**

The "global HNSW + iterative scan" candidate above is *not* the naive post-filter design. pgvector's `hnsw.iterative_scan = strict_order` (added in pgvector 0.8) walks the HNSW graph past `ef_search` until enough rows pass the post-filter, instead of returning a truncated set — the recall failure mode the parent docs describe is structurally mitigated. However, iterative scan has its own cliff: `hnsw.max_scan_tuples` caps how far it will walk, and a partition-mate dominating the entire table (not just a partition) can hit that cap before retrieving enough of the querying user's chunks, silently degrading recall. At 800K-chunk Reasonable Max users in a multi-thousand-tenant table, this is plausible.

**What this means for the follow-up benchmark:** if exact cosine fails and we go to global HNSW + iterative scan, the follow-up benchmark must explicitly measure recall — not just latency — on a corpus shaped to stress-test the partition-mate domination case. A latency-only benchmark would replicate exactly the design-doc failure mode the parent docs warned against. The parent design doc should be updated alongside any decision to adopt this design, with the recall-vs-`max_scan_tuples` analysis recorded.

**Recall benchmark spec (front-loaded so the follow-up doesn't restart from zero):**

- **Metric:** `recall@100` per query — `|hnsw_top100 ∩ exact_top100| / 100`. Report per-bucket mean across the per-cell query sample.
- **Oracle:** the exact-cosine query produced by *this* benchmark's harness. Extend the harness with a `--mode=recall` flag that, for each `(user, query_vec)` pair, runs both the HNSW query and the exact-cosine query against the same DB session and computes set intersection. The exact query is the ground truth; no separate oracle implementation is needed.
- **Corpus:** the **Phase 1 dataset is already correctly shaped** for partition-mate domination stress testing — one Reasonable Max user at ~14% of total rows + 1000 small filler users in the same `n_distinct` neighborhood. **Preserve the seed values** so the follow-up benchmark can re-seed deterministically, and **consider deferring teardown** of the Phase 1 instance if the team plans to chain the recall benchmark immediately. (If the chain isn't immediate, the recall benchmark re-seeds from the same seed for byte-identical data.)
- **Stress configurations to sweep:** `hnsw.ef_search ∈ {40, 100, 200, 500}` × `hnsw.max_scan_tuples ∈ {20000, 100000, 500000}` × per-bucket queries. The cliff (where recall drops below an acceptable threshold) emerges from this sweep.

This is a benchmark spec, not a benchmark plan — the follow-up plan still needs to write up methodology/decision-rule. But these three sentences (metric, oracle, corpus) are the load-bearing design choices that would otherwise restart from zero.

The decision tree based on observed cliff shape can deviate from the default:

- **Bucket-size cliff at Reasonable Max only**, with all smaller buckets fine: a hybrid design (exact below threshold, HNSW above) may match the failure mode better than introducing HNSW for everyone. Threshold value comes from the benchmark data.
- **Concurrency cliff at low N** even at smaller buckets: HNSW is genuinely necessary for sub-linear per-query cost. Stick with the default global HNSW first.
- **Plan-instability cliff** (planner declines the index at Reasonable Max despite `ANALYZE`): the simple B-tree filter approach has a structural limit. Partitioned HNSW from the parent plan or an external vector DB with namespaces become the relevant candidates.
- **Combination cliff** (multiple axes failing): the global HNSW default is still the right first follow-up; if it also fails, partitioned HNSW or external is the next step.

In all cases, document the numbers, the chosen first follow-up benchmark target, and the rationale before changing the main plan or the codebase.

The four candidate fallback designs in rough order of complexity:

1. **Global HNSW + iterative scan + B-tree(user_id).** Default first follow-up benchmark per above.
2. **Partitioned HNSW + iterative scan.** The current main plan. More complexity in exchange for narrower per-partition graph traversal.
3. **Hybrid: exact below threshold, HNSW above.** Two query paths. Threshold value comes from benchmark data, not a guess. Per-user partial HNSW has its own lifecycle management cost.
4. **External vector DB with namespaces (Pinecone, Qdrant, Turbopuffer).** Cleanest multi-tenant story but adds an entirely new datastore to operate.

## If exact cosine wins: cleanup scope

The repo currently has a landed M1 migration (`backend/src/db/migrations/versions/577108e3d7b9_add_content_chunks_and_content_.py`), a `ContentChunk` model, fixtures, and schema tests that include a global HNSW index. If the benchmark says exact cosine is the design, the following code work follows from the decision (separate from the benchmark itself but explicitly part of the deliverable so the system actually moves to the chosen state):

- **Drop the HNSW index** from `content_chunks` via a new migration. The index is unused under exact cosine and incurs maintenance cost.
- **Verify B-tree on `user_id` exists.** Already in the existing M1 migration, but confirm it survives the cleanup migration.
- **Remove HNSW creation from `backend/tests/conftest.py`** (lines ~170–174 currently create the HNSW index in the test fixture).
- **Update `backend/tests/test_content_chunks_schema.py`** to assert presence of the B-tree on `user_id` and absence of HNSW.
- **Revert main-plan M1/M5 changes** that were made for the partitioned-HNSW direction: drop the redo-note (no migration redo needed), drop the partitioning-related schema changes from M1, drop the `env.py` autogenerate hook, drop the conftest partition DDL mirror, and drop M5's `SET LOCAL` transaction contract and autocommit check.
- **Keep `MAX_CHUNKS_PER_ENTITY = 2000`** from M2 — defense-in-depth against abuse, independent of the search architecture choice. This stays regardless of the benchmark outcome.
- **Update `docs/vector-db-and-semantic-search.md`** to describe exact-cosine as the design instead of partitioned HNSW + iterative scan.
- **Update `AGENTS.md`** to remove the "Partitioned tables" section since no partitioned tables exist anymore.

Frame this as a follow-up implementation task triggered by the benchmark decision. The benchmark itself does not perform this cleanup — it just provides the decision that makes it the right thing to do.

## If global HNSW + iterative scan wins (after follow-up benchmark): cleanup scope

This applies if exact cosine fails AND the follow-up benchmark of "global HNSW + iterative scan + B-tree(user_id)" passes (with explicit recall measurement per "Tension with the parent design doc" above).

The currently-landed M1 migration (`577108e3d7b9_…`) is already non-partitioned with a global HNSW index and a B-tree on `user_id` — i.e., it is structurally the right shape for this design. Cleanup is small:

- **Drop and recreate the HNSW index with explicit parameters.** The landed migration creates the index without a `WITH (...)` clause (`CREATE INDEX ix_content_chunks_embedding ON content_chunks USING hnsw (embedding vector_cosine_ops);`), so it currently uses pgvector's defaults — `m=16`, `ef_construction=64` *as of the version installed*, but defaults can drift across pgvector versions and rebuilding HNSW at scale is expensive. The cleanup migration must `DROP INDEX ix_content_chunks_embedding;` then `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops) WITH (m = N, ef_construction = N);` with N values pinned to whatever the follow-up benchmark validated. Keeping the existing index unmodified would be correct only by coincidence with the current pgvector version.
- **Keep the B-tree on `user_id`.** Already in the landed migration. Required for the post-filter the iterative scan walks against.
- **Add `SET LOCAL` session settings** to the M5 `vector_search()` function: `hnsw.iterative_scan = strict_order`, `hnsw.ef_search = 200`, and `hnsw.max_scan_tuples` set to whatever the follow-up benchmark validated (NOT the default 20000 if benchmark data points elsewhere). The transaction-contract guardrails from the parent plan's M5 (autocommit check, single-transaction enforcement) DO apply here — `SET LOCAL` has the same silent-failure modes regardless of whether HNSW is partitioned or global. Keep them.
- **Drop partitioning machinery from the parent plan:** drop the M1 redo-note, the `env.py` autogenerate hook, the conftest partition DDL mirror, and the per-partition HNSW index loop. These exist solely for the partitioned design.
- **Keep `MAX_CHUNKS_PER_ENTITY = 2000`** — same reasoning as the exact-cosine case.
- **Update `docs/vector-db-and-semantic-search.md`** to describe global-HNSW-with-iterative-scan as the design, with the recall-vs-`max_scan_tuples` analysis from the follow-up benchmark recorded inline. This is the load-bearing doc update — without it the design doc and the implementation will read as silently contradicting each other.
- **Update `AGENTS.md`** to remove the "Partitioned tables" section since no partitioned tables exist.

## Future-work note: production plan-drift safeguard

If exact cosine ships, the design's correctness depends on the planner continuing to use the `user_id` B-tree index over time as data distributions change. Production observability should monitor for plan drift: periodic EXPLAIN of representative queries, alerting on Seq Scan, or simply tracking P95 search latency per user-size bucket and alerting on regression. This is operations work, not benchmark scope, but worth flagging so it isn't forgotten when the design lands.

## What this benchmark deliberately does NOT measure

- **HNSW recall under partition-mate domination, or HNSW latency in any form.** Without real production usage patterns we cannot accurately simulate the failure modes; synthetic data risks misleading numbers. If HNSW becomes necessary, the comparison happens against real telemetry or a follow-up benchmark of the specific HNSW design under consideration.
- **Storage cost or index build time.** Exact cosine has neither HNSW build cost nor HNSW disk overhead; not a comparison axis here.
- **End-to-end search latency.** The benchmark measures DB cosine cost only. End-to-end is informed by the rough budget above; full integration testing happens after design lock-in.

## Estimated effort

**Phase 0 (preliminary fail-fast gate):**
- Provision Phase 0 Railway Postgres + worker service: ~5–10 minutes one-time setup.
- Seed Typical Power on Phase 0 instance (~200K chunks): ~2–3 minutes.
- Run Step 0 + Scenario 1 + Scenario 2 against Typical Power: ~15–20 minutes.
- **Stop. Surface results to human reviewer for Phase 0 decision (see Phase 0 § Decision).** No automatic tear-down.
- Phase 0 writeup if stopping here: ~30 minutes.
- After human authorization, tear down Phase 0 instance: ~5 minutes. (May happen later than the above — keep instance running if reviewer wants more cells.)
- **Phase 0 total clock time: ~45–60 minutes (excludes idle time waiting for human review). Cost: ~$0.50–1.50, plus any idle-instance time during review.**

**Phase 1 (full benchmark on fresh instance, only if Phase 0 doesn't catastrophically fail and human authorizes Phase 1):**
- Provision fresh Phase 1 Postgres + worker: ~5–10 minutes.
- Seed all 5 buckets fresh (~5.6M chunks): ~10–15 minutes.
- Run Step 0 + Scenario 1 + Scenario 2 across all buckets: ~30–60 minutes.
- Full writeup: ~1–2 hours.
- After human authorization, tear down Phase 1 instance: ~5 minutes.
- **Phase 1 total clock time: ~2–4 hours. Cost: ~$1.50–8.50.**

**Total if both phases run:** ~3–5 hours of clock time, ~$2–10 in Railway costs.
**Total if Phase 0 fails fast:** ~1 hour, ~$1 in Railway costs.

## Deliverable

Two writeup artifacts:

1. **Phase 0 handoff summary** — a short markdown summary the runner produces at the Phase 0 stop point (before any tear-down), surfaced to the human reviewer. Contents listed under "Phase 0 handoff" below. This is NOT the final benchmark deliverable; its purpose is to inform the human's tear-down / extend / proceed decision.
2. **Final benchmark writeup** — committed to `docs/implementation_plans/2026-04-05-pgvector-embeddings-benchmark-results.md` after the human-authorized phases complete. Contents depend on whether Phase 0 stopped or both phases ran.

The final writeup uses a **structured three-part decision section** at the end (in addition to data tables and observations earlier in the document):

- **Observations.** What the numbers show. Cliffs (if any), where they appeared, IO-vs-CPU regime per bucket (including TOAST), tenant-count and dimension caveats, anything surprising.
- **Recommendation.** A single declarative statement, one of:
  - "Ship exact cosine + B-tree(user_id) as v1. Apply the *If exact cosine wins* cleanup scope from the benchmark plan."
  - "Re-benchmark fallback design: [global HNSW + iterative scan + B-tree(user_id) | partitioned HNSW + iterative scan | hybrid exact+HNSW with threshold X | external vector DB with namespaces]. Reasoning: [observed cliff shape]. The follow-up benchmark MUST measure recall, not just latency, per the *Tension with the parent design doc* note."
  - "Borderline. Team discussion needed. Open question: [specific question]. Phase 0 instance retained pending discussion." (Use this only if Phase 0 stopped at borderline and the team has not yet agreed to proceed.)
- **Rationale.** Why this recommendation given the observations.

Forcing a single-line recommendation prevents "data dump with no decision." The team can override the recommendation, but the runner takes a position rather than starting the team from zero.

**EXPLAIN output capture.** Full EXPLAIN (ANALYZE, BUFFERS) outputs go to `docs/implementation_plans/benchmark-results/explain/{phase}/{bucket}/{cell}.txt` (committed alongside the writeup). Inline excerpts in the writeup, full files for archive and reproducibility.

**Phase 0 handoff (always produced, before human-review tear-down decision).** Use the following copy-pasteable template so no field is skipped:

```markdown
# Phase 0 handoff — cosine viability benchmark

## Provisioning
- Production image (verified at provisioning): <e.g. postgres-ssl:17.9>
- Railway plan tier: <name>, <vCPU>, <RAM GB>, <region>
- `shared_buffers`: <value> (verified via `SHOW shared_buffers`)
- Container `/dev/shm`: <value> (verified large enough for shared_buffers)
- `max_connections`: <value> (>= 110 if Scenario 2 N=100 ran)
- `work_mem`: <value>
- `pg_stat_statements`: enabled / not enabled
- `Vector` column `attstorage`: <e.g. EXTENDED> (matches production: yes/no)
- Storage backing (per Railway dashboard): <local NVMe / network block / unknown>
- Disk free space at provisioning: <GB>

## Seeding
- Dataset: 10 users × 20K chunks (~200K), no fillers
- COPY format: text (per Vector encoding subsection)
- Measured throughput: <rows/sec> over <wall-clock seconds>
- VACUUM ANALYZE completion time: <seconds>

## Step 0 — Typical Power
- Plan picked: <Index Scan / Bitmap Index Scan + Bitmap Heap Scan / Seq Scan>
- Index name (if used): <ix_content_chunks_user_id>
- Full EXPLAIN file: `docs/implementation_plans/benchmark-results/explain/phase0/typical_power/step0.txt`
- **Reminder:** Phase 0 Step 0 is diagnostic-only on planner choice (n_distinct=10).

## Scenario 1 — Typical Power
| Cache regime | Filter | P50 ms | P95 ms | P99 ms | N |
|---|---|---|---|---|---|
| low-locality | unfiltered | | | | 200 |
| low-locality | filtered (entity_type=note) | | | | 200 |
| warm cache | unfiltered | | | | 200 |
| warm cache | filtered (entity_type=note) | | | | 200 |

EXPLAIN BUFFERS (main heap + TOAST counters): `docs/implementation_plans/benchmark-results/explain/phase0/typical_power/scenario1_buffers.txt`

## Scenario 2 — Typical Power, all queries hit this bucket
| N concurrency | Aggregate P95 ms | Run-window queries | QPS | Worker peak CPU% | DB active conn peak |
|---|---|---|---|---|---|
| 1 | | | | | |
| 10 | | | | | |
| 50 | | | | | |
| 100 | | | | | |

## Runner's preliminary read
<catastrophic / clearly fast / borderline>

Open questions for human review:
- <e.g. P95 outlier at warm-cache filtered, root cause unclear without further probing>

## Recommendation to reviewer
<one of: tear down + write up final / tear down + provision Phase 1 / keep instance and run additional cells X, Y, Z>
```

**Final writeup if Phase 0 was catastrophic (stopped early):**
- The Phase 0 handoff content above
- Description of the failure mode that justified stopping (specific numbers, observed regime)
- Structured Observations / Recommendation / Rationale section as above

**Final writeup if both phases completed:**
- Phase 0 handoff content above (now historical)
- Phase 1 dataset shape (including filler-user count) and measured seeding throughput on the fresh instance
- Step 0 EXPLAIN excerpts at all 5 buckets; full BUFFERS output (main heap + TOAST) per bucket
- Scenario 1 full latency table: bucket × cache regime × filter variant → P50/P95/P99 + N samples; force-cold sub-cell for Reasonable Max called out separately
- Scenario 2 full latency table: concurrency × {aggregate P95, per-bucket P95 with N samples, run-window query count, derived QPS, CPU saturation on both server and worker}; biased-distribution cells called out separately if run
- Interpretation of the numbers: what cliffs (if any) appeared, IO-vs-CPU regime per bucket (including TOAST), how the numbers compare to the rough end-to-end budget, dimension lock-in note (1536-d only)
- Structured Observations / Recommendation / Rationale section as above
- Anything surprising worth saving for later (planner quirks, unexpected cliffs, etc.)

## Out of scope

- Implementation of the chosen design. The benchmark produces a decision; following the decision is a follow-up implementation task.
- Comparison to external vector databases. Those remain a future-option escape hatch if both exact cosine and HNSW (in some form) prove unsatisfactory.
- Production-scale telemetry-based decisions. This is a pre-deploy synthetic benchmark on production-equivalent hardware. After real users exist, the design can be re-evaluated against production telemetry, which is a stronger signal than any synthetic benchmark.

## Status

Not started. The current implementation plan in [`2026-04-05-pgvector-embeddings.md`](./2026-04-05-pgvector-embeddings.md) describes the partitioned-HNSW design; that plan should not be implemented further until this benchmark produces a decision.
