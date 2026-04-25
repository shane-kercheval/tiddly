# Semantic Search: Benchmark Plan — Exact Cosine Viability

## Context

This plan is an addendum to [`2026-04-05-pgvector-embeddings.md`](./2026-04-05-pgvector-embeddings.md). Its sole purpose is to answer one question: **is exact cosine search performant enough across our realistic Pro-tier user-size distribution to be the v1 vector-search implementation?**

This is not a comparative benchmark of multiple designs. Exact cosine has perfect recall by construction — there is no candidate-pool truncation, no filter-after-retrieval problem, no approximation error. On the *quality* axis, it strictly wins over any HNSW-based design. The only open question is whether it is fast enough.

If exact cosine is fast enough, the main plan should be simplified to drop partitioning, per-partition HNSW indexing, the Alembic `env.py` autogenerate hook, the conftest partition DDL mirror, the `SET LOCAL` transaction contract, and the autocommit checks — all of which exist solely to make HNSW behave acceptably under multi-tenant filtering.

If exact cosine is not fast enough, we have a specific, measured cliff to design against, and any HNSW-based fallback design must be validated by its own benchmark before adoption — we do not jump from one unmeasured assumption to another.

This benchmark deliberately does NOT attempt to simulate HNSW behavior on synthetic data. Without real production usage patterns we cannot accurately model the partition-mate domination scenario or other approximate-search failure modes. Comparing exact vs HNSW on synthetic data risks producing numbers we cannot trust either way.

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
2. Provision at the same plan tier as production. Confirm the production tier (vCPU and RAM allocation) before sizing the benchmark instance.
3. Use the same Postgres + pgvector image as production: `pgvector/pgvector:pg17` with pgvector 0.8.2.
4. Set `shared_buffers` to roughly 25–40% of allocated RAM (e.g., 2–4GB on 8GB), matching production tuning.
5. **Run the benchmark client as a separate Railway service in the same region**, not from a local laptop. Intra-Railway DB connections avoid the ~30–80ms network latency that internet upload would add to every query and every COPY operation.

**Benchmark client harness:** Python 3.13 + `asyncpg` directly (matches production stack, lower overhead than SQLAlchemy session for raw-query measurement). One shared `asyncpg.Pool` across asyncio tasks. Per-query wall-clock measured around `pool.fetch(...)`. Connection pool size larger than max test concurrency (e.g., `pool_size = 110` for the N=100 concurrency test) so the pool itself never queues.

**Worker service provisioning:** at minimum 4 vCPU / 4GB RAM so the benchmark client itself is not the bottleneck at N=100. If at N=100 the host CPU on the worker saturates first (visible via `top` on the worker), increase the worker's resources rather than reporting saturated numbers as DB-bound. The measurement should reflect DB+CPU on the Postgres side, not client-side queueing.

**Authentication and access.** A randomly-generated password on a public-URL Postgres instance is fine for the duration of the benchmark — no real user data ever touches it; the database contains synthetic random vectors. Tear down the instance immediately when measurements are complete.

**Expected total cost: $2–10** for the entire benchmark (Postgres instance + worker service running for several hours). Tear-down stops billing.

## Phased execution: preliminary first, full benchmark second

The benchmark runs in two phases. Each phase uses its own dedicated Railway Postgres instance — Phase 1 spins up fresh, NOT reusing Phase 0's instance. The cost difference is rounding error in the $2–10 budget, and using a fresh instance for Phase 1 eliminates a real methodology hole (Phase 0's data hot in Phase 0's `shared_buffers` would bias Phase 1's "low-locality" measurements at Typical Power).

### Phase 0 — Preliminary: Typical Power as fail-fast gate

**Goal:** decide whether exact cosine is plausibly viable enough to justify the full benchmark, or catastrophically fails at the smallest informative bucket.

**Setup (on dedicated Phase 0 instance):**
1. Provision Phase 0 Postgres + worker on Railway. Confirm `shared_buffers` setting.
2. Generate and seed 10 users × 20,000 chunks each (~200K chunks total, ~1.5GB on disk). See "Data generation" and "Seeding sequence" below.
3. Build B-tree on `user_id`.
4. **`ANALYZE content_chunks`** to refresh planner statistics after bulk load.
5. Total seeding time: ~2–3 minutes.

**Run:** Step 0 EXPLAIN gate against Typical Power, then Scenario 1 (low-locality + warm cache, unfiltered + filtered = 4 cells) and Scenario 2 (4 concurrency levels) restricted to Typical Power queries only. Concurrency tests in Phase 0 are simpler than Phase 1's mixed-bucket distribution — all queries hit the Typical Power bucket since that's all that's seeded. ~15–20 minutes.

**Decision:**

- **Catastrophic failure at Typical Power.** Examples of what counts: P95 in seconds for single queries; planner declines the index even after `ANALYZE`; concurrent load saturates immediately at low N with no QPS scaling; CPU pegged at 100% with single-digit QPS. Higher buckets will be worse by construction — exact cosine cost scales linearly with chunks. **Stop.** Tear down Phase 0 instance. Write up findings as the benchmark deliverable. Move to fallback design discussion using the cliff as input.

- **Anything else — clearly fast, borderline, or somewhere in between.** Phase 0 passing does NOT prove exact cosine is viable across the full distribution. Acceptable performance at 20K chunks does not guarantee acceptable performance at 130K or 800K. **Tear down Phase 0 instance, provision a fresh Phase 1 instance, proceed to Phase 1.**

The Phase 0 gate is asymmetric on purpose: it catches obvious failures cheaply but does not approve exact cosine on weak evidence. The full benchmark on a fresh instance is still required for a real decision.

**Phase 0 cost: ~$0.50–1.50** (Postgres + worker running ~30–45 minutes prorated).

### Phase 1 — Full benchmark (fresh instance)

**Goal:** measure exact cosine across the full Pro-tier user-size distribution to inform the actual ship-or-fallback decision.

**Setup (on dedicated Phase 1 instance — fresh provision, NOT a reuse of Phase 0):**
1. Provision a new Phase 0-equivalent Postgres + worker on Railway. Confirm same `shared_buffers` setting as Phase 0 for comparable measurements.
2. Generate and seed all 5 buckets fresh from the same deterministic data generator (same random seed) — see "Data generation" below.
3. Build B-tree on `user_id` after the heap is loaded.
4. **`ANALYZE content_chunks`** to refresh planner statistics after bulk load.
5. Total seeding time: ~10–15 minutes.

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
**Phase 1 dataset: ~5.6M chunks across ~85 users (~40GB on disk).**

**No per-query DB costs and no rate limits on Railway** — bill is metered by compute + storage time, not query count.

### Seeding sequence (locked, not optional)

The order of operations during seeding affects both seeding time and measurement validity. Implementer must follow this sequence:

1. **Bulk-load the heap via `COPY`.** Do NOT have the B-tree on `user_id` in place during COPY — building indexes incrementally during a 5.6M-row load is materially slower than building once after.
2. **Build the B-tree** on `user_id` after COPY completes.
3. **`ANALYZE content_chunks`** to refresh `pg_class.reltuples` and column statistics. Without this, the planner evaluates Step 0 against stale stats (typically 0 rows on a freshly-loaded table) and may choose Seq Scan or Index Scan for the wrong reasons.

This sequence is required, not a tuning suggestion.

### Recommended COPY tuning (subject to Railway constraints)

To hit the seeding time budget on the Phase 1 dataset (~40GB in ~10–15 minutes):

- Raise `maintenance_work_mem` to ~1GB before the B-tree build (faster index construction). Restore default after.
- Set `synchronous_commit = off` during bulk COPY (safe for throwaway instance — durability doesn't matter here). Restore default after.
- Use **binary COPY format** for the `embedding` column rather than text. Vectors are floating-point arrays — binary format is significantly smaller and faster for both producer and consumer.

If Railway restricts any of these (e.g., `synchronous_commit` may be locked at the platform level on some plans), document what was achievable and accept slower seeding. The locked sequence above is non-negotiable; these tuning knobs are recommended-when-permitted.

### Reproducibility

- **Pin both random seeds:** the seed for synthetic vector generation AND the seed for query-vector generation during Scenarios 1 and 2. A re-run of the benchmark should produce byte-identical data and queries.
- **Reset Postgres statistics between phases and between Scenario 2 concurrency levels:** `SELECT pg_stat_statements_reset(); SELECT pg_stat_reset();` before each new measurement cell. Per-cell stats stay clean and don't cumulate.
- Row data per chunk: `id` (uuidv7), `user_id`, `entity_type` (random of bookmark/note/prompt), `entity_id` (random uuid), `chunk_type` ("content" 90% / "metadata" 10%), `chunk_index`, `chunk_text` (placeholder), `chunk_hash` (random sha256), `model` ("text-embedding-3-small"), `embedding` (1536-d random unit-normalized float32).

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

**This is a binary gate.** Verify the plan uses `Index Scan using ix_content_chunks_user_id` (or equivalent) — NOT `Seq Scan`, for every bucket including Reasonable Max.

If the planner picks Seq Scan for any bucket under default settings, **exact cosine fails the gate for that bucket**. Capture the EXPLAIN output, document it as a finding, and do not "rescue" the result with `enable_seqscan = off` or session-level planner hints — those are diagnostic tools, not production contracts. If exact cosine only looks viable under planner coercion, it is not viable in deployed code.

**TOAST awareness when reading BUFFERS output.** pgvector's `Vector(1536)` column uses 6,144 bytes per row (1536 × 4-byte float). This is well above Postgres's TOAST threshold (~2KB), and pgvector's default storage is `EXTENDED`, so the embedding values live in the TOAST table for `content_chunks`, not the main heap. EXPLAIN BUFFERS reports per-relation buffer counts — main heap and TOAST are separate. For an honest CPU-vs-IO classification, capture **full BUFFERS output including the TOAST relation** (look for `_toast_*` relations in the BUFFERS section), not just the main-heap summary. The bulk of IO during cosine computation is TOAST fetches; missing them entirely will misread the regime.

### Scenario 1 — Per-query latency across user sizes

For each bucket, measure two cache regimes × two filter variants.

**Cache variants:**

- **Low-locality / cold-ish upper bound:** rotate users between queries so each query likely hits a different user's pages. At smaller bucket sizes (Light, Typical), the working set fits entirely in `shared_buffers` and "cold" is impossible without service restart — these numbers represent low-locality access, not true disk-cold. At larger buckets (Super Power, Reasonable Max), per-user data exceeds buffer capacity and rotation does approach cold. The asymmetry is documented in the writeup; numbers across buckets are interpreted with this in mind.
- **Warm cache:** issue sequential queries against the same user. Realistic active-search-session pattern — represents typical UX during an interactive session.

**Filter variants:**

- **Unfiltered:** `WHERE user_id = :uid ORDER BY embedding <=> :q LIMIT 100`
- **Filtered:** `WHERE user_id = :uid AND entity_type = 'note' ORDER BY embedding <=> :q LIMIT 100`

The filtered variant has a 3–10× smaller candidate set after filtering by `entity_type` and is closer to typical production query shape (users frequently restrict to one content type).

**Methodology per (bucket × cache × filter) cell:**

1. **Warm-up phase.** Issue 10 queries that are NOT included in the measurement sample. These exist solely to stabilize cache and connection state. For warm-cache cells, more warm-up queries may be appropriate at the larger buckets — issue enough that subsequent timing numbers are stable across the next 10 queries. For Reasonable Max specifically, expect to need 20–30 warm-up queries before warm-cache numbers stabilize.
2. **Reset stats:** `SELECT pg_stat_statements_reset(); SELECT pg_stat_reset();` before measurement.
3. **Measure 200 queries** (1000 for Reasonable Max where sample size matters most). Random query vectors per query (using the pinned query seed). Capture per-query application-level wall-clock time via `time.monotonic()` around `pool.fetch(...)`.
4. **Report:** P50, P95, P99 latency for the cell.

Output: a table of (bucket, cache regime, filter variant) → P50/P95/P99. Plus EXPLAIN BUFFERS per bucket (full output, including TOAST counters) so we can see the CPU vs IO breakdown.

No pass/fail thresholds are asserted. The writeup interprets the numbers in light of the end-to-end budget (informational section above) and the team decides whether they're acceptable.

### Scenario 2 — Latency under concurrent load

**Concurrency justification.** Realistic peak load math: assume 2,000 Pro users at year-1 adoption, ~30 active simultaneously at peak business hours, search-session bursts of 3 queries per active user → peak instantaneous concurrency in the 10–30 range. Test at N ∈ {1, 10, 50, 100} — N=50 provides ~1.5–5× headroom over expected peak; N=100 is informational stress test.

For each concurrency level N:

1. **Warm-up phase.** 10 queries (single-threaded) to stabilize cache before launching concurrent tasks.
2. **Reset stats:** `SELECT pg_stat_statements_reset(); SELECT pg_stat_reset();` before launching the timed run.
3. Launch N concurrent asyncio query tasks using the shared `asyncpg.Pool`.
4. Each task: in a 60-second loop, pick a random user weighted by realistic distribution (70% Light/Typical, 25% Typical Power, 5% Super Power + Reasonable Max combined), issue a query with a random vector, record latency, repeat.
5. **Report per concurrency level:**
   - **Aggregate P95** across all queries
   - **Per-bucket P95** (separately for queries that hit each bucket)
   - Total queries completed (= QPS)
   - CPU saturation observed via host `top` / `htop` on both the Postgres server and the worker
   - Confirm worker-side CPU has headroom (i.e., the bottleneck observed is on the Postgres server, not client-side queueing)

Reporting per-bucket P95 separately is critical: a user living in Reasonable Max could experience consistent multi-second latency on every search while the aggregate hides it (because only 5% of queries hit that bucket). The decision needs to see the long-tail experience, not just the headline.

No pass/fail thresholds asserted. The writeup interprets the numbers.

## Decision rule (asymmetric, by design)

The benchmark produces numbers; the writeup contextualizes them; the team decides. Two outcomes:

**Outcome 1: Exact cosine looks acceptable.**
The numbers across all scenarios — single-query latency at each bucket, low-locality and warm cache, unfiltered and filtered, per-bucket P95 under concurrency — fit within rough end-to-end budget for the user populations the product is trying to serve. Ship exact cosine + B-tree(user_id) as the v1 design. Apply the cleanup scope from the section below to remove the partitioned-HNSW machinery from the main plan and the codebase.

**Outcome 2: Exact cosine has a measured cliff.**
The numbers show a specific failure mode: a particular bucket size, a particular cache regime, a particular concurrency level. **At this point we have a known cliff but no validated fallback.** Adoption of any HNSW-based design requires its own same-harness benchmark of that specific design before it ships. Do not jump from one unmeasured design assumption to another.

**Default first follow-up benchmark: global HNSW + iterative scan + B-tree(user_id).** This is the lowest-complexity HNSW design — single non-partitioned table, single global HNSW index, iterative scan handles the `user_id` post-filter, B-tree narrows the candidate set. It drops everything in the cleanup scope below EXCEPT the HNSW index itself: no partitioning, no `env.py` autogenerate hook, no conftest partition DDL mirror, no `SET LOCAL` autocommit checks beyond what HNSW iterative scan needs (which are simpler than the partitioned case). If exact cosine fails and the cliff isn't conclusively a "we need a fundamentally different storage shape" signal, this is the design to benchmark first.

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
- Phase 0 writeup if stopping here: ~30 minutes.
- Tear down Phase 0 instance: ~5 minutes.
- **Phase 0 total clock time: ~45–60 minutes. Cost: ~$0.50–1.50.**

**Phase 1 (full benchmark on fresh instance, only if Phase 0 doesn't catastrophically fail):**
- Provision fresh Phase 1 Postgres + worker: ~5–10 minutes.
- Seed all 5 buckets fresh (~5.6M chunks): ~10–15 minutes.
- Run Step 0 + Scenario 1 + Scenario 2 across all buckets: ~30–60 minutes.
- Full writeup: ~1–2 hours.
- Tear down Phase 1 instance: ~5 minutes.
- **Phase 1 total clock time: ~2–4 hours. Cost: ~$1.50–8.50.**

**Total if both phases run:** ~3–5 hours of clock time, ~$2–10 in Railway costs.
**Total if Phase 0 fails fast:** ~1 hour, ~$1 in Railway costs.

## Deliverable

A markdown writeup committed to `docs/implementation_plans/2026-04-05-pgvector-embeddings-benchmark-results.md`. The contents depend on whether Phase 0 failed fast or both phases completed.

The writeup uses a **structured three-part decision section** at the end (in addition to data tables and observations earlier in the document):

- **Observations.** What the numbers show. Cliffs (if any), where they appeared, IO-vs-CPU regime per bucket, anything surprising.
- **Recommendation.** A single declarative statement, one of:
  - "Ship exact cosine + B-tree(user_id) as v1. Apply the cleanup scope from the benchmark plan."
  - "Re-benchmark fallback design: [global HNSW + iterative scan + B-tree(user_id) | partitioned HNSW + iterative scan | hybrid exact+HNSW with threshold X | external vector DB with namespaces]. Reasoning: [observed cliff shape]."
  - "Borderline. Team discussion needed. Open question: [specific question]."
- **Rationale.** Why this recommendation given the observations.

Forcing a single-line recommendation prevents "data dump with no decision." The team can override the recommendation, but the runner takes a position rather than starting the team from zero.

**EXPLAIN output capture.** Full EXPLAIN (ANALYZE, BUFFERS) outputs go to `docs/implementation_plans/benchmark-results/explain/{phase}/{bucket}/{cell}.txt` (committed alongside the writeup). Inline excerpts in the writeup, full files for archive and reproducibility.

**If Phase 0 failed catastrophically (stopped early):**
- Railway provisioning details (Postgres tier, vCPU/RAM, `shared_buffers`, region)
- Phase 0 dataset shape and seeding time
- Step 0 EXPLAIN excerpt for Typical Power (full file in archive)
- Scenario 1 results for Typical Power (low-locality + warm × unfiltered + filtered)
- Scenario 2 results for Typical Power across concurrency levels
- Description of the failure mode that justified stopping (specific numbers, observed regime)
- Structured Observations / Recommendation / Rationale section as above

**If both phases completed:**
- Everything above for Phase 0
- Phase 1 dataset shape and seeding time on the fresh instance
- Step 0 EXPLAIN excerpts confirming B-tree usage at all 5 buckets; full BUFFERS output (main heap + TOAST) per bucket
- Scenario 1 full latency table: bucket × cache regime × filter variant → P50/P95/P99
- Scenario 2 full latency table: concurrency × {aggregate P95, per-bucket P95, QPS, CPU saturation on both server and worker}
- Interpretation of the numbers: what cliffs (if any) appeared, IO-vs-CPU regime per bucket (including TOAST), how the numbers compare to the rough end-to-end budget
- Structured Observations / Recommendation / Rationale section as above
- Anything surprising worth saving for later (planner quirks, unexpected cliffs, etc.)

## Out of scope

- Implementation of the chosen design. The benchmark produces a decision; following the decision is a follow-up implementation task.
- Comparison to external vector databases. Those remain a future-option escape hatch if both exact cosine and HNSW (in some form) prove unsatisfactory.
- Production-scale telemetry-based decisions. This is a pre-deploy synthetic benchmark on production-equivalent hardware. After real users exist, the design can be re-evaluated against production telemetry, which is a stronger signal than any synthetic benchmark.

## Status

Not started. The current implementation plan in [`2026-04-05-pgvector-embeddings.md`](./2026-04-05-pgvector-embeddings.md) describes the partitioned-HNSW design; that plan should not be implemented further until this benchmark produces a decision.
