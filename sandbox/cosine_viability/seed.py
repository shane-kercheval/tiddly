"""COPY-based seeder for the benchmark.

Per plan §Test environment Vector encoding subsection: use TEXT COPY format
with vectors serialized as `[v1,v2,...]` strings. Avoids the runner having to
implement pgvector's binary wire protocol by hand. ~2x slower than binary on
COPY but well within Phase 1's 10-15min seeding budget.
"""
from __future__ import annotations

import io
import time
import uuid
from collections.abc import Iterable, Iterator
from dataclasses import dataclass

import asyncpg

from .data_gen import ChunkRow, generate_chunks_for_user
from .config import Bucket


@dataclass
class SeedingMetrics:
    """Throughput numbers reported in the Phase 0 handoff."""

    total_rows: int
    total_seconds: float
    rows_per_sec: float
    bytes_copied: int
    mb_per_sec: float


def _vector_to_text(vec: Iterable[float]) -> str:
    """Serialize a vector as `[v1,v2,...]` for pgvector's text COPY format."""
    return "[" + ",".join(f"{x:.7g}" for x in vec) + "]"


def _row_to_copy_line(row: ChunkRow) -> str:
    """Serialize a ChunkRow as a tab-separated COPY line.

    Schema column order: id, user_id, entity_type, entity_id, chunk_type,
    chunk_index, chunk_text, token_count, chunk_hash, model, embedding.
    """
    # COPY text format: tab-separated, escape backslash and tab/newline in
    # chunk_text. Lorem doesn't contain control chars but be defensive.
    chunk_text = (
        row.chunk_text.replace("\\", "\\\\").replace("\t", "\\t").replace("\n", "\\n")
    )
    fields = [
        str(row.chunk_id),
        str(row.user_id),
        row.entity_type,
        str(row.entity_id),
        row.chunk_type,
        str(row.chunk_index),
        chunk_text,
        str(row.token_count),
        row.chunk_hash,
        row.model,
        _vector_to_text(row.embedding),
    ]
    return "\t".join(fields) + "\n"


def _generate_copy_stream(
    user_specs: Iterable[tuple[uuid.UUID, Bucket]],
    *,
    rng_data_seed: int,
) -> Iterator[bytes]:
    """Stream COPY-formatted rows for the given users."""
    for user_id, bucket in user_specs:
        for row in generate_chunks_for_user(
            user_id, bucket, rng_data_seed=rng_data_seed,
        ):
            yield _row_to_copy_line(row).encode("utf-8")


async def seed(
    conn: asyncpg.Connection,
    user_specs: list[tuple[uuid.UUID, Bucket]],
    *,
    rng_data_seed: int,
) -> SeedingMetrics:
    """Stream all chunks for the given users into content_chunks via COPY.

    Sets session-scoped tuning per plan §Recommended COPY tuning:
    - synchronous_commit = off (USERSET, safe on throwaway instance)
    - maintenance_work_mem = 1GB (USERSET, helps the post-COPY index build)
    """
    # Session tuning for faster bulk insert. Both are USERSET — no platform
    # changes required.
    await conn.execute("SET synchronous_commit = off;")
    await conn.execute("SET maintenance_work_mem = '1GB';")

    # Build COPY stream into an in-memory buffer. For 200K chunks this is
    # ~250MB; acceptable given Phase 0's small footprint. Phase 1 with 5.6M
    # chunks would need streaming — at that scale we'd switch to chunked feeds.
    buf = io.BytesIO()
    for line in _generate_copy_stream(user_specs, rng_data_seed=rng_data_seed):
        buf.write(line)
    buf.seek(0)
    bytes_total = len(buf.getvalue())

    start = time.monotonic()
    result = await conn.copy_to_table(
        "content_chunks",
        source=buf,
        format="text",
        columns=[
            "id", "user_id", "entity_type", "entity_id", "chunk_type",
            "chunk_index", "chunk_text", "token_count", "chunk_hash",
            "model", "embedding",
        ],
    )
    elapsed = time.monotonic() - start

    # Result format: "COPY <n>" — extract row count.
    if isinstance(result, str) and result.startswith("COPY "):
        rows_inserted = int(result.split()[1])
    else:
        rows_inserted = await conn.fetchval("SELECT count(*) FROM content_chunks;")

    return SeedingMetrics(
        total_rows=rows_inserted,
        total_seconds=elapsed,
        rows_per_sec=rows_inserted / elapsed if elapsed > 0 else 0.0,
        bytes_copied=bytes_total,
        mb_per_sec=(bytes_total / 1_000_000) / elapsed if elapsed > 0 else 0.0,
    )
