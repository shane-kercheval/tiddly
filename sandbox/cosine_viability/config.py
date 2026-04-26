"""Bucket profiles, scenario configuration, and pinned seeds."""
from __future__ import annotations

from dataclasses import dataclass

# Vector dimensions — locked to text-embedding-3-small.
EMBEDDING_DIM = 1536

# Pinned RNG seeds for reproducibility (per plan §Reproducibility).
DATA_SEED = 0xCAFEBABE
QUERY_SEED = 0xDEADBEEF


@dataclass(frozen=True)
class Bucket:
    """A user-size bucket from the realistic Pro-tier distribution."""

    name: str          # e.g. "typical_power"
    chunks_per_user: int
    avg_chunks_per_entity: int  # for entity_id round-robin assignment


# Per the plan §Data generation. Phase 0 only seeds typical_power.
BUCKETS: dict[str, Bucket] = {
    "light": Bucket("light", 500, 7),
    "typical": Bucket("typical", 3_000, 10),
    "typical_power": Bucket("typical_power", 20_000, 20),
    "super_power": Bucket("super_power", 130_000, 29),
    "reasonable_max": Bucket("reasonable_max", 800_000, 44),
}


# Phase 0 default: 10 users × 20K chunks = 200K chunks. No filler users in Phase 0.
# Additional buckets are also configurable here; user count defaults to 10 if a
# bucket isn't listed explicitly. Each Phase 0 run targets exactly one bucket.
PHASE0_USERS_PER_BUCKET: dict[str, int] = {
    "typical_power": 10,
    "super_power": 10,
}

# Phase 1: full distribution + ~1000 filler users for n_distinct dilution.
PHASE1_USERS_PER_BUCKET: dict[str, int] = {
    "light": 30,
    "typical": 30,
    "typical_power": 10,
    "super_power": 10,
    "reasonable_max": 5,
}
PHASE1_FILLER_USERS = 1_000
PHASE1_FILLER_CHUNKS_PER_USER = 100


# Scenario 2 concurrency levels. Plan dropped N=100 to avoid max_connections
# fiddling — N=80 is well within the default 100-connection cap.
SCENARIO2_CONCURRENCY_LEVELS: list[int] = [1, 10, 50, 80]

# Scenario 2 loop duration. Plan default is 180s; for Phase 0 we use 60s
# since Phase 0 only hits one bucket (no per-bucket dilution to worry about).
SCENARIO2_DURATION_SECONDS = 60

# Scenario 2 user-distribution weighting (best-guess, not derived).
# Used in Phase 1 only — Phase 0 hits typical_power exclusively.
PHASE1_LOAD_DISTRIBUTION: dict[str, float] = {
    "light": 0.35,
    "typical": 0.35,
    "typical_power": 0.25,
    "super_power": 0.04,
    "reasonable_max": 0.01,
}


# Scenario 1 sample sizes per cell.
SCENARIO1_SAMPLE_SIZE = 200
SCENARIO1_SAMPLE_SIZE_REASONABLE_MAX = 1_000
SCENARIO1_WARMUP_QUERIES = 10
SCENARIO1_WARMUP_REASONABLE_MAX = 25

# Scenario 1 force-cold sub-cell (Phase 1 only, Reasonable Max only).
FORCE_COLD_SAMPLE_SIZE = 20

# Pre-generated query vector pool size per cell.
QUERY_POOL_SIZE = 1_000

# Connection pool size — must be ≥ max concurrency in the scenario.
DB_POOL_SIZE = 90  # supports N=80 with headroom; well within default max_connections=100

# CPU sampling interval (seconds).
CPU_SAMPLE_INTERVAL_SECONDS = 5.0
