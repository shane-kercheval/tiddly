"""Synthetic data generation for the cosine viability benchmark.

Per the plan §Data generation and §Reproducibility:
- 1536-d unit-normalized random vectors via pinned RNG seed.
- entity_id assigned via deterministic round-robin so chunks-per-entity matches
  the bucket profile.
- chunk_text seeded with realistic-sized lorem (800-1500 chars) so heap density
  approximates production.
"""
from __future__ import annotations

import hashlib
import math
import random
import uuid
from collections.abc import Iterator
from dataclasses import dataclass

import numpy as np

from .config import EMBEDDING_DIM, Bucket

# Lorem source — repeated/sliced to produce variable-length placeholder text
# that's lossless across UTF-8 (ASCII only, no encoding surprises).
_LOREM_BASE = (
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. "
    "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. "
    "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris "
    "nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in "
    "reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla "
    "pariatur. Excepteur sint occaecat cupidatat non proident, sunt in "
    "culpa qui officia deserunt mollit anim id est laborum. " * 4
)


@dataclass
class ChunkRow:
    """A single row destined for content_chunks.

    Mirrors the plan's row shape but uses primitive types for COPY-friendliness.
    """

    chunk_id: uuid.UUID
    user_id: uuid.UUID
    entity_type: str
    entity_id: uuid.UUID
    chunk_type: str
    chunk_index: int
    chunk_text: str
    token_count: int
    chunk_hash: str
    model: str
    embedding: np.ndarray  # shape (EMBEDDING_DIM,), float32, unit-normalized


def _unit_normal(rng: np.random.Generator) -> np.ndarray:
    """Generate one unit-normalized 1536-d float32 vector."""
    v = rng.standard_normal(EMBEDDING_DIM, dtype=np.float32)
    norm = np.linalg.norm(v)
    if norm == 0.0:
        v[0] = 1.0
        return v
    return v / norm


def _lorem_for_length(rng: random.Random, target_chars: int) -> str:
    """Produce lorem-ipsum text of approximately target_chars characters."""
    if target_chars <= len(_LOREM_BASE):
        start = rng.randrange(0, max(1, len(_LOREM_BASE) - target_chars))
        return _LOREM_BASE[start : start + target_chars]
    # Repeat enough times to cover the target.
    repeats = math.ceil(target_chars / len(_LOREM_BASE))
    return (_LOREM_BASE * repeats)[:target_chars]


def _entity_round_robin(
    chunk_idx: int,
    chunks_per_user: int,
    avg_chunks_per_entity: int,
) -> int:
    """Map a chunk index within a user to an entity index, deterministic round-robin.

    See plan §Reproducibility row data — entity_idx = chunk_idx // ceil(N/k).
    """
    n_entities = math.ceil(chunks_per_user / avg_chunks_per_entity)
    entities_per_chunk_step = math.ceil(chunks_per_user / n_entities)
    return chunk_idx // entities_per_chunk_step


def _chunk_type_for_index(chunk_idx_in_entity: int) -> str:
    """First chunk of an entity is metadata, rest are content (90/10 mix)."""
    return "metadata" if chunk_idx_in_entity == 0 else "content"


def generate_chunks_for_user(
    user_id: uuid.UUID,
    bucket: Bucket,
    *,
    rng_data_seed: int,
) -> Iterator[ChunkRow]:
    """Yield ChunkRow instances for one user.

    The RNG is seeded deterministically per (user_id, seed) so re-runs produce
    byte-identical data.
    """
    seed_material = f"{rng_data_seed}-{user_id}".encode()
    seed_int = int.from_bytes(hashlib.sha256(seed_material).digest()[:8], "big")
    np_rng = np.random.default_rng(seed_int)
    py_rng = random.Random(seed_int)

    # Pre-allocate entity UUIDs for this user.
    n_entities = math.ceil(bucket.chunks_per_user / bucket.avg_chunks_per_entity)
    entity_uuids = [uuid.UUID(int=py_rng.getrandbits(128)) for _ in range(n_entities)]
    entity_types = [
        py_rng.choice(["bookmark", "note", "prompt"]) for _ in range(n_entities)
    ]
    # Track per-entity chunk index so chunk_index is consistent within an entity.
    entity_chunk_counters = [0] * n_entities

    for chunk_idx in range(bucket.chunks_per_user):
        entity_idx = _entity_round_robin(
            chunk_idx, bucket.chunks_per_user, bucket.avg_chunks_per_entity,
        )
        chunk_idx_in_entity = entity_chunk_counters[entity_idx]
        entity_chunk_counters[entity_idx] += 1

        chunk_type = _chunk_type_for_index(chunk_idx_in_entity)
        # Within an entity: metadata at idx 0, content at idx 0..N. Reset
        # content index when transitioning out of metadata.
        if chunk_type == "metadata":
            chunk_index = 0
        else:
            chunk_index = chunk_idx_in_entity - 1  # subtract the metadata slot

        text_len = py_rng.randint(800, 1500)
        chunk_text = _lorem_for_length(py_rng, text_len)
        chunk_hash = hashlib.sha256(
            f"{user_id}-{chunk_idx}-{rng_data_seed}".encode(),
        ).hexdigest()
        token_count = len(chunk_text) // 4

        embedding = _unit_normal(np_rng)

        yield ChunkRow(
            chunk_id=uuid.UUID(int=py_rng.getrandbits(128)),
            user_id=user_id,
            entity_type=entity_types[entity_idx],
            entity_id=entity_uuids[entity_idx],
            chunk_type=chunk_type,
            chunk_index=chunk_index,
            chunk_text=chunk_text,
            token_count=token_count,
            chunk_hash=chunk_hash,
            model="text-embedding-3-small",
            embedding=embedding,
        )


def generate_users(
    n_users: int,
    *,
    rng_data_seed: int,
    user_id_prefix: str = "user",
) -> list[uuid.UUID]:
    """Generate deterministic user UUIDs."""
    seed_material = f"{rng_data_seed}-{user_id_prefix}".encode()
    seed_int = int.from_bytes(hashlib.sha256(seed_material).digest()[:8], "big")
    py_rng = random.Random(seed_int)
    return [uuid.UUID(int=py_rng.getrandbits(128)) for _ in range(n_users)]


def generate_query_vectors(n: int, *, query_seed: int) -> list[np.ndarray]:
    """Pre-generate a pool of query vectors for a Scenario cell.

    See plan §Test environment — pool is reused via modulo cycling during the
    timed loop so vectors are NEVER generated inline.
    """
    rng = np.random.default_rng(query_seed)
    return [_unit_normal(rng) for _ in range(n)]
