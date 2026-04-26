"""Smoke test: run the entire Phase 0 pipeline on a tiny dataset locally.

Uses testcontainers' PostgresContainer with the pgvector image — same pattern
as the existing test suite. Verifies the harness end-to-end before pointing
at Railway and burning credits on bugs.

Tiny dataset: 2 users x 1K chunks each. Should complete in seconds.
"""
from __future__ import annotations

import asyncio
import shutil
from pathlib import Path

import asyncpg
import pytest
from pgvector.asyncpg import register_vector
from testcontainers.postgres import PostgresContainer

from cosine_viability import config
from cosine_viability.config import Bucket
from cosine_viability.data_gen import generate_users
from cosine_viability.handoff import write_handoff
from cosine_viability.main import _connection_setup
from cosine_viability.scenarios import (
    run_scenario1,
    run_scenario2_cell,
    run_step0,
)
from cosine_viability.schema import (
    build_btree,
    reset_schema,
    vacuum_analyze,
)
from cosine_viability.seed import seed


# Tiny bucket for smoke test — overrides production bucket sizes.
SMOKE_BUCKET = Bucket(name="smoke", chunks_per_user=1_000, avg_chunks_per_entity=10)


@pytest.fixture(scope="module")
def pg_container():
    """PostgreSQL with pgvector pre-installed."""
    with PostgresContainer("pgvector/pgvector:pg17", driver=None) as pg:
        yield pg


@pytest.fixture
def postgres_url(pg_container):
    return pg_container.get_connection_url().replace("postgresql+psycopg2://", "postgresql://")


def test_smoke_phase0(postgres_url, tmp_path, monkeypatch):
    """Run the entire Phase 0 pipeline on a tiny dataset and verify outputs."""
    # Override config to use tiny dataset and very short Scenario 2.
    monkeypatch.setattr(config, "SCENARIO1_SAMPLE_SIZE", 20)
    monkeypatch.setattr(config, "SCENARIO1_WARMUP_QUERIES", 2)
    monkeypatch.setattr(config, "SCENARIO2_DURATION_SECONDS", 3)
    monkeypatch.setattr(config, "SCENARIO2_CONCURRENCY_LEVELS", [1, 5])
    monkeypatch.setattr(config, "DB_POOL_SIZE", 10)
    monkeypatch.setattr(config, "QUERY_POOL_SIZE", 50)
    monkeypatch.setattr(config, "CPU_SAMPLE_INTERVAL_SECONDS", 1.0)

    asyncio.run(_run_smoke(postgres_url, tmp_path))


async def _run_smoke(postgres_url: str, output_dir: Path):
    pool = await asyncpg.create_pool(
        postgres_url, min_size=2, max_size=10, setup=_connection_setup,
    )
    stats_pool = await asyncpg.create_pool(
        postgres_url, min_size=1, max_size=2, setup=_connection_setup,
    )
    try:
        # Reset schema
        async with pool.acquire() as conn:
            await reset_schema(conn)

        # Seed 2 users x 1K chunks
        user_ids = generate_users(2, rng_data_seed=config.DATA_SEED)
        user_specs = [(uid, SMOKE_BUCKET) for uid in user_ids]

        async with pool.acquire() as conn:
            seeding_metrics = await seed(conn, user_specs, rng_data_seed=config.DATA_SEED)
        assert seeding_metrics.total_rows == 2_000, (
            f"expected 2000 rows, got {seeding_metrics.total_rows}"
        )
        assert seeding_metrics.rows_per_sec > 0

        async with pool.acquire() as conn:
            await build_btree(conn)
            await vacuum_analyze(conn)

        # Step 0
        async with pool.acquire() as conn:
            step0 = await run_step0(conn, bucket="smoke", user_id=user_ids[0])
        assert step0.plan_node in {"Index Scan", "Bitmap Index Scan", "Seq Scan", "Other"}
        # On a 2K-row table the planner may choose Seq Scan — that's fine for smoke.

        # Scenario 1 (4 cells)
        scenario1_cells = await run_scenario1(
            pool, bucket="smoke", user_ids=user_ids,
        )
        assert len(scenario1_cells) == 4
        for c in scenario1_cells:
            assert c.n_samples == 20
            assert c.p50_ms >= 0
            assert c.p95_ms >= c.p50_ms

        # Scenario 2 (2 concurrency levels for smoke)
        scenario2_cells = []
        for n in [1, 5]:
            cell = await run_scenario2_cell(
                pool, stats_pool,
                concurrency=n, user_ids=user_ids,
            )
            scenario2_cells.append(cell)
            assert cell.total_queries > 0
            assert cell.qps > 0

        # Handoff writer
        path = write_handoff(
            output_dir=output_dir,
            provisioning={"image": "smoke", "tier": "smoke", "bucket": "smoke"},
            seeding=seeding_metrics,
            step0=step0,
            scenario1_cells=scenario1_cells,
            scenario2_cells=scenario2_cells,
            runner_read="clearly_fast",
            open_questions=[],
            recommendation="(smoke test)",
        )
        assert path.exists()
        content = path.read_text()
        assert "Phase 0 handoff" in content
        assert "Scenario 1 — smoke" in content
        assert "Scenario 2 — smoke" in content
        # File path should reflect bucket name.
        assert path.name == "phase0-handoff-smoke.md"

    finally:
        await pool.close()
        await stats_pool.close()


def test_data_gen_round_robin():
    """Verify entity_id round-robin produces approximately k chunks per entity."""
    from cosine_viability.data_gen import generate_chunks_for_user
    import uuid

    bucket = Bucket(name="t", chunks_per_user=100, avg_chunks_per_entity=10)
    user_id = uuid.uuid4()
    chunks = list(generate_chunks_for_user(user_id, bucket, rng_data_seed=42))

    assert len(chunks) == 100
    # 10 entities expected, ~10 chunks each
    by_entity: dict[uuid.UUID, int] = {}
    for c in chunks:
        by_entity[c.entity_id] = by_entity.get(c.entity_id, 0) + 1

    counts = sorted(by_entity.values())
    assert len(by_entity) == 10
    # Each entity should have exactly 10 chunks (deterministic round-robin)
    assert all(c == 10 for c in counts), f"chunks per entity: {counts}"


def test_data_gen_deterministic():
    """Same seed → byte-identical data."""
    from cosine_viability.data_gen import generate_chunks_for_user
    import uuid

    bucket = Bucket(name="t", chunks_per_user=50, avg_chunks_per_entity=5)
    user_id = uuid.UUID("12345678-1234-5678-1234-567812345678")

    run1 = list(generate_chunks_for_user(user_id, bucket, rng_data_seed=42))
    run2 = list(generate_chunks_for_user(user_id, bucket, rng_data_seed=42))

    assert len(run1) == len(run2) == 50
    for r1, r2 in zip(run1, run2):
        assert r1.chunk_id == r2.chunk_id
        assert r1.entity_id == r2.entity_id
        assert r1.chunk_text == r2.chunk_text
        # Embeddings should be byte-identical (within float32 representation)
        import numpy as np
        assert np.array_equal(r1.embedding, r2.embedding)
