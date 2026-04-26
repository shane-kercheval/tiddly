"""Benchmark schema setup — non-partitioned content_chunks for exact cosine.

Mirrors the landed M1 migration shape (no partitioning, no HNSW for the exact
cosine path) but is self-contained — does not depend on the application's
Alembic migrations.
"""
from __future__ import annotations

import asyncpg

CREATE_EXTENSION = "CREATE EXTENSION IF NOT EXISTS vector;"

CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS content_chunks (
    id            UUID NOT NULL,
    user_id       UUID NOT NULL,
    entity_type   VARCHAR(20) NOT NULL,
    entity_id     UUID NOT NULL,
    chunk_type    VARCHAR(20) NOT NULL,
    chunk_index   INTEGER NOT NULL,
    chunk_text    TEXT NOT NULL,
    token_count   INTEGER NOT NULL,
    chunk_hash    TEXT NOT NULL,
    model         TEXT NOT NULL,
    embedding     vector(1536) NOT NULL,
    PRIMARY KEY (id)
);
"""

# B-tree on user_id is the load-bearing index for the exact-cosine path.
CREATE_BTREE_USER_ID = (
    "CREATE INDEX IF NOT EXISTS ix_content_chunks_user_id "
    "ON content_chunks (user_id);"
)

# Optional: B-tree on (entity_type, entity_id) for chunk lookup. Mirrors landed
# migration. Not load-bearing for benchmark queries but kept for parity.
CREATE_BTREE_ENTITY = (
    "CREATE INDEX IF NOT EXISTS ix_content_chunks_entity "
    "ON content_chunks (entity_type, entity_id);"
)

DROP_TABLE = "DROP TABLE IF EXISTS content_chunks;"


async def reset_schema(conn: asyncpg.Connection) -> None:
    """Drop + recreate content_chunks for a clean benchmark run."""
    await conn.execute(DROP_TABLE)
    await conn.execute(CREATE_EXTENSION)
    await conn.execute(CREATE_TABLE)


async def build_btree(conn: asyncpg.Connection) -> None:
    """Build the B-tree on user_id (and entity index) AFTER bulk load.

    Per plan §Seeding sequence: build indexes once after COPY, not incrementally
    during COPY.
    """
    await conn.execute(CREATE_BTREE_USER_ID)
    await conn.execute(CREATE_BTREE_ENTITY)


async def vacuum_analyze(conn: asyncpg.Connection) -> None:
    """VACUUM ANALYZE refreshes pg_class.reltuples + visibility map.

    Per plan §Seeding sequence — without this, the planner evaluates Step 0
    against stale stats.
    """
    # VACUUM cannot run inside a transaction block.
    await conn.execute("VACUUM ANALYZE content_chunks;")


async def get_attstorage(conn: asyncpg.Connection) -> str:
    """Read the embedding column's storage type. Per plan §Test environment."""
    row = await conn.fetchrow(
        "SELECT attstorage::text FROM pg_attribute "
        "WHERE attrelid = 'content_chunks'::regclass AND attname = 'embedding';",
    )
    return row[0] if row else "unknown"
