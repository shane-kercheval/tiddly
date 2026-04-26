"""CLI entry point for the cosine viability benchmark.

Usage:
    python -m benchmarks.cosine_viability.main \\
        --postgres-url postgresql://... \\
        --phase 0 \\
        --output-dir docs/implementation_plans/benchmark-results

Phase 0: seeds typical_power only, runs Step 0 + Scenario 1 + Scenario 2.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
import time
from pathlib import Path

import asyncpg
from pgvector.asyncpg import register_vector

from .config import (
    BUCKETS,
    DATA_SEED,
    DB_POOL_SIZE,
    PHASE0_USERS_PER_BUCKET,
    SCENARIO2_CONCURRENCY_LEVELS,
)


async def _connection_setup(conn: asyncpg.Connection) -> None:
    """Per-connection setup: ensure pgvector exists, register codec.

    Runs idempotently — on Railway where extension already exists, the
    CREATE EXTENSION is a no-op. On a fresh testcontainer, it installs.
    """
    await conn.execute("CREATE EXTENSION IF NOT EXISTS vector;")
    await register_vector(conn)
from .data_gen import generate_users
from .handoff import write_handoff
from .schema import (
    build_btree,
    get_attstorage,
    reset_schema,
    vacuum_analyze,
)
from .scenarios import (
    run_scenario1,
    run_scenario2_cell,
    run_step0,
)
from .seed import seed


async def _gather_provisioning(conn: asyncpg.Connection) -> dict:
    """Read out the runtime config for the handoff doc."""
    rows = {}
    for setting in [
        "shared_buffers",
        "max_connections",
        "work_mem",
        "maintenance_work_mem",
        "server_version",
    ]:
        v = await conn.fetchval(f"SHOW {setting};")
        rows[setting] = v

    pgvector_row = await conn.fetchrow(
        "SELECT extversion FROM pg_extension WHERE extname = 'vector';",
    )
    pgvector_version = pgvector_row[0] if pgvector_row else "not installed"

    attstorage_code = await get_attstorage(conn)
    # attstorage codes: 'p'=PLAIN, 'e'=EXTERNAL, 'm'=MAIN, 'x'=EXTENDED
    attstorage_map = {"p": "PLAIN", "e": "EXTERNAL", "m": "MAIN", "x": "EXTENDED"}
    attstorage = attstorage_map.get(attstorage_code, attstorage_code)

    return {
        "shared_buffers": rows["shared_buffers"],
        "max_connections": rows["max_connections"],
        "work_mem": rows["work_mem"],
        "maintenance_work_mem": rows["maintenance_work_mem"],
        "postgres_version": rows["server_version"],
        "pgvector_version": pgvector_version,
        "attstorage": attstorage,
    }


async def run_phase0(
    postgres_url: str,
    output_dir: Path,
    *,
    bucket_name: str = "typical_power",
    image_label: str = "unknown",
    tier_label: str = "unknown",
    region_label: str = "unknown",
    storage_backing: str = "unknown",
) -> Path:
    """Run the full Phase 0 sequence and write the handoff summary.

    `bucket_name` selects which user-size bucket to seed and run against.
    Must be a key in BUCKETS and PHASE0_USERS_PER_BUCKET (extend the latter
    if running an additional bucket beyond Phase 0's typical_power default).
    """
    print(f"[phase0] Connecting to Postgres (bucket={bucket_name})...", flush=True)

    pool = await asyncpg.create_pool(
        postgres_url,
        min_size=2,
        max_size=DB_POOL_SIZE,
        setup=_connection_setup,
    )
    # Separate small pool for stats sampling so it doesn't compete with workers.
    stats_pool = await asyncpg.create_pool(
        postgres_url, min_size=1, max_size=2, setup=_connection_setup,
    )

    try:
        # ---- Schema reset + seed ----
        print("[phase0] Resetting schema...", flush=True)
        async with pool.acquire() as conn:
            await reset_schema(conn)

        # ---- Provisioning snapshot (after schema exists so attstorage is readable) ----
        async with pool.acquire() as conn:
            provisioning = await _gather_provisioning(conn)
            provisioning.update({
                "image": image_label,
                "tier": tier_label,
                "region": region_label,
                "storage_backing": storage_backing,
                "bucket": bucket_name,
            })

        if bucket_name not in BUCKETS:
            raise ValueError(f"unknown bucket: {bucket_name}; available: {list(BUCKETS)}")
        bucket = BUCKETS[bucket_name]
        # Default to 10 users (matching Phase 0's typical_power default) if a
        # bucket lacks a specific PHASE0_USERS_PER_BUCKET entry.
        n_users = PHASE0_USERS_PER_BUCKET.get(bucket_name, 10)
        user_ids = generate_users(
            n_users, rng_data_seed=DATA_SEED, user_id_prefix=bucket_name,
        )
        user_specs = [(uid, bucket) for uid in user_ids]

        print(f"[phase0] Seeding {n_users} users x {bucket.chunks_per_user} chunks "
              f"({n_users * bucket.chunks_per_user:,} chunks total)...", flush=True)
        async with pool.acquire() as conn:
            seeding_metrics = await seed(conn, user_specs, rng_data_seed=DATA_SEED)
        print(f"[phase0] Seeded {seeding_metrics.total_rows:,} rows in "
              f"{seeding_metrics.total_seconds:.1f}s "
              f"({seeding_metrics.rows_per_sec:,.0f} rows/s).", flush=True)

        print("[phase0] Building B-tree on user_id...", flush=True)
        async with pool.acquire() as conn:
            await build_btree(conn)

        print("[phase0] VACUUM ANALYZE...", flush=True)
        vacuum_start = time.monotonic()
        async with pool.acquire() as conn:
            await vacuum_analyze(conn)
        vacuum_elapsed = time.monotonic() - vacuum_start
        provisioning["vacuum_seconds"] = f"{vacuum_elapsed:.1f}"

        # ---- Step 0 ----
        print("[phase0] Running Step 0 EXPLAIN gate...", flush=True)
        async with pool.acquire() as conn:
            step0_result = await run_step0(conn, bucket=bucket_name, user_id=user_ids[0])
        print(f"[phase0] Step 0: {step0_result.plan_node} "
              f"({'PASS' if step0_result.passed else 'FAIL'})", flush=True)

        # ---- Scenario 1 ----
        print("[phase0] Running Scenario 1 (4 cells)...", flush=True)
        scenario1_cells = await run_scenario1(
            pool, bucket=bucket_name, user_ids=user_ids,
        )
        for cell in scenario1_cells:
            print(f"  {cell.cache_regime}/{cell.filter_variant}: "
                  f"P50={cell.p50_ms:.2f}ms P95={cell.p95_ms:.2f}ms "
                  f"P99={cell.p99_ms:.2f}ms (n={cell.n_samples})", flush=True)

        # ---- Scenario 2 ----
        print("[phase0] Running Scenario 2 (concurrency sweep)...", flush=True)
        scenario2_cells = []
        for n in SCENARIO2_CONCURRENCY_LEVELS:
            print(f"  N={n}...", flush=True)
            cell = await run_scenario2_cell(
                pool, stats_pool,
                concurrency=n, user_ids=user_ids,
            )
            scenario2_cells.append(cell)
            # Print full P50/P95/P99 + per-cell detail so it's captured even if
            # the handoff file output gets interleaved by the logging system.
            print(f"    P50={cell.aggregate_p50_ms:.2f}ms "
                  f"P95={cell.aggregate_p95_ms:.2f}ms "
                  f"P99={cell.aggregate_p99_ms:.2f}ms "
                  f"QPS={cell.qps:.1f} "
                  f"queries={cell.total_queries} "
                  f"worker_cpu_peak={cell.cpu_samples.peak:.1f}% "
                  f"worker_cpu_p95={cell.cpu_samples.p95:.1f}% "
                  f"db_cache_hit={cell.pg_delta.cache_hit_ratio:.2%} "
                  f"db_active_peak={cell.pg_delta.active_peak}", flush=True)

        # ---- Preliminary read (heuristic, human reviews) ----
        runner_read, open_questions, recommendation = _classify_read(
            step0_result, scenario1_cells, scenario2_cells,
        )

        # ---- Write handoff ----
        path = write_handoff(
            output_dir=output_dir,
            provisioning=provisioning,
            seeding=seeding_metrics,
            step0=step0_result,
            scenario1_cells=scenario1_cells,
            scenario2_cells=scenario2_cells,
            runner_read=runner_read,
            open_questions=open_questions,
            recommendation=recommendation,
        )
        print(f"[phase0] Handoff written: {path}", flush=True)
        # Brief sleep so the prior in-band output drains before the final
        # cat in the start command — avoids log-interleaving on Railway.
        await asyncio.sleep(2)
        return path

    finally:
        await pool.close()
        await stats_pool.close()


def _classify_read(
    step0,
    scenario1_cells,
    scenario2_cells,
) -> tuple[str, list[str], str]:
    """Heuristic preliminary read for the handoff. Human always overrides."""
    open_questions: list[str] = []

    if not step0.passed:
        return (
            "catastrophic",
            ["Step 0 planner declined the index — investigate."],
            "tear down + write up final (Step 0 fail at smallest informative bucket)",
        )

    # Look at warm + unfiltered as the headline cell.
    warm_unfilt = next(
        (c for c in scenario1_cells
         if c.cache_regime == "warm" and c.filter_variant == "unfiltered"),
        None,
    )
    if warm_unfilt is None:
        return ("borderline", ["Could not find headline cell"], "human review")

    # Catastrophic: warm-cache P95 > 2000ms at typical_power → expect Reasonable Max to be much worse.
    if warm_unfilt.p95_ms > 2_000:
        return (
            "catastrophic",
            [f"warm-cache unfiltered P95 = {warm_unfilt.p95_ms:.0f}ms at Typical Power; "
             "Reasonable Max will be much worse."],
            "tear down + write up final (catastrophic at Typical Power)",
        )

    # Concurrency degradation: highest-N P95 > 5x N=1 P95.
    n1 = next((c for c in scenario2_cells if c.concurrency == 1), None)
    n_top = scenario2_cells[-1] if scenario2_cells else None
    concurrency_ratio = (
        n_top.aggregate_p95_ms / n1.aggregate_p95_ms
        if n1 and n1.aggregate_p95_ms > 0 else 0.0
    )

    if concurrency_ratio > 8:
        open_questions.append(
            f"Concurrency P95 grew {concurrency_ratio:.1f}x from N=1 to "
            f"N={n_top.concurrency} — possible scaling cliff.",
        )

    # Clearly fast: warm-cache P95 < 100ms AND concurrency_ratio < 4
    if warm_unfilt.p95_ms < 100 and concurrency_ratio < 4:
        return (
            "clearly_fast",
            open_questions,
            "tear down + provision Phase 1 (warm-cache P95 well under budget; "
            "concurrency scales reasonably)",
        )

    # Otherwise: borderline.
    return (
        "borderline",
        open_questions or [
            f"warm-cache P95 = {warm_unfilt.p95_ms:.0f}ms at Typical Power — "
            "interpret against end-to-end budget; not catastrophic, not clearly fast.",
        ],
        "human review — decide tear down + Phase 1 / extend Phase 0 / stop",
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Cosine viability benchmark — Phase 0 (any bucket)",
    )
    parser.add_argument("--postgres-url", required=True,
                        help="DATABASE_URL for the benchmark Postgres instance")
    parser.add_argument("--phase", type=int, default=0,
                        choices=[0],
                        help="Benchmark phase (only Phase 0 currently implemented)")
    parser.add_argument("--bucket", default="typical_power",
                        choices=list(BUCKETS),
                        help="User-size bucket to seed and run (default: typical_power)")
    parser.add_argument("--output-dir", type=Path,
                        default=Path("docs/implementation_plans/benchmark-results"),
                        help="Where to write the handoff markdown and EXPLAIN dumps")
    parser.add_argument("--image-label", default="postgres-ssl:17.9 (default)",
                        help="Image tag deployed (for the writeup)")
    parser.add_argument("--tier-label", default="unknown",
                        help="Railway plan tier label (for the writeup)")
    parser.add_argument("--region-label", default="unknown",
                        help="Railway region (for the writeup)")
    parser.add_argument("--storage-backing", default="unknown",
                        help="Storage backing per Railway dashboard (for the writeup)")

    args = parser.parse_args()
    if args.phase != 0:
        print("Only Phase 0 is implemented.", file=sys.stderr)
        return 2

    asyncio.run(run_phase0(
        args.postgres_url,
        args.output_dir,
        bucket_name=args.bucket,
        image_label=args.image_label,
        tier_label=args.tier_label,
        region_label=args.region_label,
        storage_backing=args.storage_backing,
    ))
    return 0


if __name__ == "__main__":
    sys.exit(main())
