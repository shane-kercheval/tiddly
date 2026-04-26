"""Scenario orchestration — Step 0, Scenario 1, Scenario 2."""
from __future__ import annotations

import asyncio
import random
import time
import uuid
from dataclasses import dataclass, field

import asyncpg
import numpy as np
from pgvector.asyncpg import register_vector

from . import config
from .config import QUERY_SEED
from .data_gen import generate_query_vectors
from .instrumentation import (
    CPUSamples,
    PGStatDelta,
    compute_pg_delta,
    sample_cpu_loop,
    sample_pg_stats_loop,
    warmup_cpu_meter,
)
from .queries import (
    SCENARIO1_FILTERED,
    SCENARIO1_UNFILTERED,
    SCENARIO2_QUERY,
    QueryResult,
    explain_step0,
    get_pg_stat_snapshot,
    get_planner_stats,
    run_query,
)


# ---------- Step 0 ----------

@dataclass
class Step0Result:
    bucket: str
    plan_node: str  # "Index Scan" / "Bitmap Index Scan" / "Seq Scan" / "Other"
    full_explain: str
    passed: bool
    planner_stats: dict


def _classify_plan(explain_text: str) -> tuple[str, bool]:
    """Classify the top scan node and whether it passes the binary gate.

    Pass: Index Scan or Bitmap Index Scan (per plan §Step 0, after removing
    Index Only Scan from pass list). Fail: Seq Scan.
    """
    # Look at the first node line that mentions a scan type. Plans are tree-shaped,
    # so we find any line containing the relevant scan type substring.
    text = explain_text.lower()
    if "seq scan" in text and "->  seq scan on content_chunks" in text:
        return ("Seq Scan", False)
    if "bitmap index scan" in text:
        return ("Bitmap Index Scan", True)
    if "index scan" in text:
        return ("Index Scan", True)
    return ("Other", False)


async def run_step0(
    conn: asyncpg.Connection,
    *,
    bucket: str,
    user_id: uuid.UUID,
) -> Step0Result:
    """Run the Step 0 EXPLAIN gate for one bucket."""
    rng = np.random.default_rng(QUERY_SEED + hash(bucket) % 10_000)
    qvec = rng.standard_normal(1536, dtype=np.float32)
    qvec = qvec / np.linalg.norm(qvec)
    explain_text = await explain_step0(conn, user_id=user_id, query_vec=qvec)
    plan_node, passed = _classify_plan(explain_text)
    stats = await get_planner_stats(conn)
    return Step0Result(
        bucket=bucket,
        plan_node=plan_node,
        full_explain=explain_text,
        passed=passed,
        planner_stats=stats,
    )


# ---------- Scenario 1 ----------

@dataclass
class CellLatencies:
    """Latency stats for one Scenario 1 cell."""

    bucket: str
    cache_regime: str  # "low_locality" / "warm" / "force_cold"
    filter_variant: str  # "unfiltered" / "filtered"
    n_samples: int
    p50_ms: float
    p95_ms: float
    p99_ms: float
    min_ms: float
    max_ms: float


def _percentile(samples: list[float], p: float) -> float:
    if not samples:
        return 0.0
    sorted_s = sorted(samples)
    idx = int(p * len(sorted_s))
    return sorted_s[min(idx, len(sorted_s) - 1)]


async def _run_cell_low_locality(
    conn: asyncpg.Connection,
    sql: str,
    user_ids: list[uuid.UUID],
    query_pool: list[np.ndarray],
    n_warmup: int,
    n_measured: int,
) -> list[float]:
    """Run a cell where each query rotates to a different user."""
    py_rng = random.Random(QUERY_SEED + 1)
    # Warmup
    for i in range(n_warmup):
        await run_query(
            conn,
            sql,
            py_rng.choice(user_ids),
            query_pool[i % len(query_pool)],
        )
    # Measured
    latencies: list[float] = []
    for i in range(n_measured):
        result = await run_query(
            conn,
            sql,
            py_rng.choice(user_ids),
            query_pool[i % len(query_pool)],
        )
        latencies.append(result.latency_ms)
    return latencies


async def _run_cell_warm(
    conn: asyncpg.Connection,
    sql: str,
    user_id: uuid.UUID,
    query_pool: list[np.ndarray],
    n_warmup: int,
    n_measured: int,
) -> list[float]:
    """Run a cell where all queries hit the same user (warm cache)."""
    # Warmup
    for i in range(n_warmup):
        await run_query(conn, sql, user_id, query_pool[i % len(query_pool)])
    # Measured
    latencies: list[float] = []
    for i in range(n_measured):
        result = await run_query(
            conn, sql, user_id, query_pool[i % len(query_pool)],
        )
        latencies.append(result.latency_ms)
    return latencies


def _summarize_cell(
    bucket: str,
    cache_regime: str,
    filter_variant: str,
    latencies: list[float],
) -> CellLatencies:
    return CellLatencies(
        bucket=bucket,
        cache_regime=cache_regime,
        filter_variant=filter_variant,
        n_samples=len(latencies),
        p50_ms=_percentile(latencies, 0.50),
        p95_ms=_percentile(latencies, 0.95),
        p99_ms=_percentile(latencies, 0.99),
        min_ms=min(latencies) if latencies else 0.0,
        max_ms=max(latencies) if latencies else 0.0,
    )


async def run_scenario1(
    pool: asyncpg.Pool,
    *,
    bucket: str,
    user_ids: list[uuid.UUID],
) -> list[CellLatencies]:
    """Run all 4 Scenario 1 cells (low-locality + warm × unfiltered + filtered)."""
    is_reasonable_max = bucket == "reasonable_max"
    n_measured = (
        config.SCENARIO1_SAMPLE_SIZE_REASONABLE_MAX if is_reasonable_max
        else config.SCENARIO1_SAMPLE_SIZE
    )
    n_warmup = (
        config.SCENARIO1_WARMUP_REASONABLE_MAX if is_reasonable_max
        else config.SCENARIO1_WARMUP_QUERIES
    )

    query_pool = generate_query_vectors(config.QUERY_POOL_SIZE, query_seed=QUERY_SEED)
    cells: list[CellLatencies] = []

    async with pool.acquire() as conn:
        # low-locality + unfiltered
        latencies = await _run_cell_low_locality(
            conn, SCENARIO1_UNFILTERED, user_ids, query_pool, n_warmup, n_measured,
        )
        cells.append(_summarize_cell(bucket, "low_locality", "unfiltered", latencies))

        # low-locality + filtered
        latencies = await _run_cell_low_locality(
            conn, SCENARIO1_FILTERED, user_ids, query_pool, n_warmup, n_measured,
        )
        cells.append(_summarize_cell(bucket, "low_locality", "filtered", latencies))

        # warm + unfiltered
        warm_user = user_ids[0]
        latencies = await _run_cell_warm(
            conn, SCENARIO1_UNFILTERED, warm_user, query_pool, n_warmup, n_measured,
        )
        cells.append(_summarize_cell(bucket, "warm", "unfiltered", latencies))

        # warm + filtered
        latencies = await _run_cell_warm(
            conn, SCENARIO1_FILTERED, warm_user, query_pool, n_warmup, n_measured,
        )
        cells.append(_summarize_cell(bucket, "warm", "filtered", latencies))

    return cells


# ---------- Scenario 2 ----------

@dataclass
class Scenario2CellResult:
    """Result for one Scenario 2 concurrency level."""

    concurrency: int
    duration_seconds: float
    total_queries: int
    qps: float
    aggregate_p50_ms: float
    aggregate_p95_ms: float
    aggregate_p99_ms: float
    per_user_p95: dict[str, float]  # user_id_str -> p95 (subset of users)
    cpu_samples: CPUSamples
    pg_delta: PGStatDelta


async def _scenario2_task(
    pool: asyncpg.Pool,
    user_ids: list[uuid.UUID],
    query_pool: list[np.ndarray],
    duration: float,
    task_idx: int,
    results: list[QueryResult],
) -> None:
    """One concurrent task: loop until duration elapses, recording latencies."""
    py_rng = random.Random(QUERY_SEED + 1000 + task_idx)
    deadline = time.monotonic() + duration
    i = 0
    async with pool.acquire() as conn:
        while time.monotonic() < deadline:
            result = await run_query(
                conn,
                SCENARIO2_QUERY,
                py_rng.choice(user_ids),
                query_pool[i % len(query_pool)],
            )
            results.append(result)
            i += 1


async def run_scenario2_cell(
    pool: asyncpg.Pool,
    stats_pool: asyncpg.Pool,
    *,
    concurrency: int,
    user_ids: list[uuid.UUID],
    duration: float | None = None,
) -> Scenario2CellResult:
    """Run one Scenario 2 concurrency level for `duration` seconds."""
    if duration is None:
        duration = config.SCENARIO2_DURATION_SECONDS
    query_pool = generate_query_vectors(config.QUERY_POOL_SIZE, query_seed=QUERY_SEED)

    # Warmup (single-threaded)
    async with pool.acquire() as conn:
        py_rng = random.Random(QUERY_SEED + 99)
        for i in range(10):
            await run_query(
                conn, SCENARIO2_QUERY,
                py_rng.choice(user_ids),
                query_pool[i % len(query_pool)],
            )

    # Pre-snapshot pg_stat
    async with stats_pool.acquire() as conn:
        await conn.execute("SELECT pg_stat_reset();")
        pre_snap = await get_pg_stat_snapshot(conn)

    # Set up CPU + pg_stat_activity sampling
    warmup_cpu_meter()
    cpu_samples = CPUSamples()
    active_peaks: list[int] = []
    stop_event = asyncio.Event()

    async with stats_pool.acquire() as stats_conn:
        cpu_task = asyncio.create_task(sample_cpu_loop(cpu_samples, stop_event))
        pg_task = asyncio.create_task(
            sample_pg_stats_loop(stats_conn, active_peaks, stop_event),
        )

        # Launch worker tasks
        results: list[QueryResult] = []
        wall_start = time.monotonic()
        worker_tasks = [
            asyncio.create_task(
                _scenario2_task(pool, user_ids, query_pool, duration, i, results),
            )
            for i in range(concurrency)
        ]
        await asyncio.gather(*worker_tasks)
        wall_elapsed = time.monotonic() - wall_start

        # Stop sampling
        stop_event.set()
        await asyncio.gather(cpu_task, pg_task, return_exceptions=True)

        # Post-snapshot
        post_snap = await get_pg_stat_snapshot(stats_conn)

    pg_delta = compute_pg_delta(pre_snap, post_snap, active_peaks)

    # Aggregate latencies
    latencies = [r.latency_ms for r in results]
    by_user: dict[uuid.UUID, list[float]] = {}
    for r in results:
        by_user.setdefault(r.user_id, []).append(r.latency_ms)
    per_user_p95 = {
        str(uid): _percentile(lats, 0.95) for uid, lats in by_user.items()
    }

    return Scenario2CellResult(
        concurrency=concurrency,
        duration_seconds=wall_elapsed,
        total_queries=len(results),
        qps=len(results) / wall_elapsed if wall_elapsed > 0 else 0.0,
        aggregate_p50_ms=_percentile(latencies, 0.50),
        aggregate_p95_ms=_percentile(latencies, 0.95),
        aggregate_p99_ms=_percentile(latencies, 0.99),
        per_user_p95=per_user_p95,
        cpu_samples=cpu_samples,
        pg_delta=pg_delta,
    )


async def setup_pool_codecs(conn: asyncpg.Connection) -> None:
    """Per-connection setup for asyncpg pgvector codec."""
    await register_vector(conn)
