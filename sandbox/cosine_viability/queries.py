"""SQL queries for Step 0, Scenario 1, and Scenario 2."""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from typing import Any

import asyncpg
import numpy as np

# Step 0 representative query — exact-cosine read with user_id filter and LIMIT 100.
# With pgvector.asyncpg.register_vector(), numpy arrays bind directly to vector columns
# via the registered codec — no ::vector cast needed.
STEP0_QUERY = """
SELECT entity_type, entity_id, embedding <=> $1 AS distance
FROM content_chunks
WHERE user_id = $2
ORDER BY distance
LIMIT 100;
"""

STEP0_EXPLAIN = "EXPLAIN (ANALYZE, BUFFERS, VERBOSE) " + STEP0_QUERY

# Scenario 1 — same query as Step 0 but timed.
SCENARIO1_UNFILTERED = """
SELECT entity_type, entity_id
FROM content_chunks
WHERE user_id = $2
ORDER BY embedding <=> $1
LIMIT 100;
"""

SCENARIO1_FILTERED = """
SELECT entity_type, entity_id
FROM content_chunks
WHERE user_id = $2 AND entity_type = 'note'
ORDER BY embedding <=> $1
LIMIT 100;
"""

# Scenario 2 reuses the same shape — picks an unfiltered query.
SCENARIO2_QUERY = SCENARIO1_UNFILTERED


@dataclass
class QueryResult:
    """One timed query with its application-level wall-clock latency."""

    latency_ms: float
    user_id: uuid.UUID  # so callers can bucket per-user post-hoc


async def explain_step0(
    conn: asyncpg.Connection,
    *,
    user_id: uuid.UUID,
    query_vec: np.ndarray,
) -> str:
    """Run EXPLAIN (ANALYZE, BUFFERS, VERBOSE) for the Step 0 query.

    `query_vec` binds via the registered pgvector codec.
    """
    rows = await conn.fetch(STEP0_EXPLAIN, query_vec, user_id)
    return "\n".join(row[0] for row in rows)


async def run_query(
    conn: asyncpg.Connection,
    sql: str,
    user_id: uuid.UUID,
    query_vec: np.ndarray,
) -> QueryResult:
    """Run a parametrized query and return latency in ms.

    Per plan §Test environment harness: each pool.fetch is implicit autocommit;
    no SET LOCAL needed for exact cosine. `query_vec` binds via the registered
    pgvector codec.
    """
    start = time.monotonic()
    await conn.fetch(sql, query_vec, user_id)
    elapsed_ms = (time.monotonic() - start) * 1000.0
    return QueryResult(latency_ms=elapsed_ms, user_id=user_id)


async def get_planner_stats(conn: asyncpg.Connection) -> dict[str, Any]:
    """Snapshot relevant planner stats — n_distinct, reltuples — for the writeup."""
    n_distinct_row = await conn.fetchrow(
        "SELECT n_distinct FROM pg_stats "
        "WHERE tablename = 'content_chunks' AND attname = 'user_id';",
    )
    reltuples_row = await conn.fetchrow(
        "SELECT reltuples FROM pg_class WHERE relname = 'content_chunks';",
    )
    return {
        "user_id_n_distinct": (
            float(n_distinct_row[0]) if n_distinct_row and n_distinct_row[0] else None
        ),
        "reltuples": float(reltuples_row[0]) if reltuples_row else None,
    }


async def get_pg_stat_snapshot(conn: asyncpg.Connection) -> dict[str, Any]:
    """Snapshot pg_stat_database / pg_stat_activity for delta computation."""
    db_row = await conn.fetchrow(
        "SELECT blks_hit, blks_read, tup_fetched, tup_returned "
        "FROM pg_stat_database WHERE datname = current_database();",
    )
    act_row = await conn.fetchrow(
        "SELECT count(*) FILTER (WHERE state = 'active') AS active, count(*) AS total "
        "FROM pg_stat_activity;",
    )
    return {
        "blks_hit": int(db_row[0]) if db_row else 0,
        "blks_read": int(db_row[1]) if db_row else 0,
        "tup_fetched": int(db_row[2]) if db_row else 0,
        "tup_returned": int(db_row[3]) if db_row else 0,
        "active_connections": int(act_row[0]) if act_row else 0,
        "total_connections": int(act_row[1]) if act_row else 0,
    }
