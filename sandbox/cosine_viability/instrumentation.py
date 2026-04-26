"""CPU instrumentation — psutil worker-side, pg_stat snapshots DB-side.

Per plan §Scenario 2 step 7. Worker CPU sampled every 5s; pg_stat_database +
pg_stat_activity captured pre/post run for delta computation.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field

import asyncpg
import psutil

from . import config
from .queries import get_pg_stat_snapshot


@dataclass
class CPUSamples:
    """Worker-side CPU samples for one cell."""

    samples: list[float] = field(default_factory=list)

    @property
    def peak(self) -> float:
        return max(self.samples) if self.samples else 0.0

    @property
    def p95(self) -> float:
        if not self.samples:
            return 0.0
        sorted_samples = sorted(self.samples)
        idx = int(0.95 * len(sorted_samples))
        return sorted_samples[min(idx, len(sorted_samples) - 1)]

    @property
    def mean(self) -> float:
        return sum(self.samples) / len(self.samples) if self.samples else 0.0


@dataclass
class PGStatDelta:
    """Delta of pg_stat_database counters across a cell run."""

    blks_hit_delta: int
    blks_read_delta: int
    tup_fetched_delta: int
    cache_hit_ratio: float  # blks_hit / (blks_hit + blks_read)
    active_peak: int


async def sample_cpu_loop(samples: CPUSamples, stop_event: asyncio.Event) -> None:
    """Background task: sample worker CPU every config.CPU_SAMPLE_INTERVAL_SECONDS.

    psutil.cpu_percent(interval=...) is blocking; we run it in a thread to
    avoid blocking the event loop.
    """
    while not stop_event.is_set():
        # cpu_percent with interval blocks for that duration; first call after
        # process start may return 0.0 — caller should warm it up.
        pct = await asyncio.to_thread(
            psutil.cpu_percent,
            config.CPU_SAMPLE_INTERVAL_SECONDS,
        )
        samples.samples.append(pct)


async def sample_pg_stats_loop(
    conn: asyncpg.Connection,
    active_peaks: list[int],
    stop_event: asyncio.Event,
) -> None:
    """Background task: sample pg_stat_activity every config.CPU_SAMPLE_INTERVAL_SECONDS.

    Tracks the peak `active` connection count during the cell.
    """
    while not stop_event.is_set():
        snap = await get_pg_stat_snapshot(conn)
        active_peaks.append(snap["active_connections"])
        try:
            await asyncio.wait_for(stop_event.wait(), config.CPU_SAMPLE_INTERVAL_SECONDS)
        except asyncio.TimeoutError:
            pass


def compute_pg_delta(pre: dict, post: dict, active_peaks: list[int]) -> PGStatDelta:
    """Compute the per-cell pg_stat delta."""
    blks_hit_d = post["blks_hit"] - pre["blks_hit"]
    blks_read_d = post["blks_read"] - pre["blks_read"]
    tup_fetched_d = post["tup_fetched"] - pre["tup_fetched"]
    total_blocks = blks_hit_d + blks_read_d
    cache_ratio = blks_hit_d / total_blocks if total_blocks > 0 else 0.0
    return PGStatDelta(
        blks_hit_delta=blks_hit_d,
        blks_read_delta=blks_read_d,
        tup_fetched_delta=tup_fetched_d,
        cache_hit_ratio=cache_ratio,
        active_peak=max(active_peaks) if active_peaks else 0,
    )


def warmup_cpu_meter() -> None:
    """First psutil call after process start may return 0.0; prime it.

    Should be called once before the first measurement cell.
    """
    psutil.cpu_percent(interval=None)
    time.sleep(0.05)
    psutil.cpu_percent(interval=None)
