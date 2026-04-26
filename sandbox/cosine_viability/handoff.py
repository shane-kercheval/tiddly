"""Phase 0 handoff summary writer.

Populates the markdown template with measured values, writes to
sandbox/cosine_viability/phase0-handoff-<bucket>.md, and dumps full EXPLAIN
output to a sibling directory.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from .scenarios import CellLatencies, Scenario2CellResult, Step0Result
from .seed import SeedingMetrics


def _format_cell_table_row(cell: CellLatencies) -> str:
    return (
        f"| {cell.cache_regime} | {cell.filter_variant} | "
        f"{cell.p50_ms:.2f} | {cell.p95_ms:.2f} | {cell.p99_ms:.2f} | "
        f"{cell.n_samples} |"
    )


def _format_scenario2_row(cell: Scenario2CellResult) -> str:
    return (
        f"| {cell.concurrency} | {cell.aggregate_p50_ms:.2f} | "
        f"{cell.aggregate_p95_ms:.2f} | {cell.aggregate_p99_ms:.2f} | "
        f"{cell.total_queries} | {cell.qps:.1f} | "
        f"{cell.cpu_samples.peak:.1f} | {cell.pg_delta.active_peak} |"
    )


def write_handoff(
    *,
    output_dir: Path,
    provisioning: dict,
    seeding: SeedingMetrics,
    step0: Step0Result,
    scenario1_cells: list[CellLatencies],
    scenario2_cells: list[Scenario2CellResult],
    runner_read: str,  # "catastrophic" | "clearly_fast" | "borderline"
    open_questions: list[str],
    recommendation: str,
) -> Path:
    """Write the Phase 0 handoff markdown and EXPLAIN dump. Return the markdown path."""
    output_dir.mkdir(parents=True, exist_ok=True)
    bucket_name = provisioning.get("bucket", "typical_power")
    # Filename suffix matches the bucket so multiple bucket runs don't overwrite each other.
    bucket_slug = bucket_name.replace("_", "-")
    explain_dir = output_dir / "explain" / "phase0" / bucket_name
    explain_dir.mkdir(parents=True, exist_ok=True)

    # Dump full EXPLAIN
    (explain_dir / "step0.txt").write_text(step0.full_explain)

    # Build markdown
    timestamp = datetime.now(timezone.utc).isoformat()

    open_q_block = (
        "\n".join(f"- {q}" for q in open_questions) if open_questions else "- (none)"
    )

    md = f"""# Phase 0 handoff — cosine viability benchmark

Generated: {timestamp}

## Provisioning
- Production image (verified at provisioning): `{provisioning.get("image", "unknown")}`
- Railway plan tier: {provisioning.get("tier", "unknown")}, {provisioning.get("vcpu", "?")} vCPU, {provisioning.get("ram_gb", "?")} GB RAM, region: {provisioning.get("region", "?")}
- `shared_buffers`: {provisioning.get("shared_buffers", "?")}
- Container `/dev/shm`: {provisioning.get("shm", "not measured")}
- `max_connections`: {provisioning.get("max_connections", "?")}
- `work_mem`: {provisioning.get("work_mem", "?")}
- `pg_stat_statements`: {provisioning.get("pg_stat_statements", "not enabled")}
- `Vector` column `attstorage`: {provisioning.get("attstorage", "?")}
- Storage backing: {provisioning.get("storage_backing", "unknown")}
- Disk free at provisioning: {provisioning.get("disk_free_gb", "?")} GB
- Postgres version: {provisioning.get("postgres_version", "?")}
- pgvector version: {provisioning.get("pgvector_version", "?")}

## Seeding
- Bucket: **{bucket_name}** ({seeding.total_rows:,} chunks total)
- COPY format: text (per Vector encoding subsection)
- Measured throughput: {seeding.rows_per_sec:,.0f} rows/sec ({seeding.mb_per_sec:.1f} MB/s) over {seeding.total_seconds:.1f}s
- VACUUM ANALYZE completion time: {provisioning.get("vacuum_seconds", "?")} s

## Step 0 — {bucket_name}
- Plan picked: **{step0.plan_node}** ({"PASS" if step0.passed else "FAIL"})
- `pg_stats.user_id.n_distinct`: {step0.planner_stats.get("user_id_n_distinct")}
- `pg_class.reltuples`: {step0.planner_stats.get("reltuples")}
- Full EXPLAIN file: [`explain/phase0/{bucket_name}/step0.txt`](./explain/phase0/{bucket_name}/step0.txt)
- **Reminder:** Phase 0 Step 0 is diagnostic-only on planner choice (small n_distinct, no filler users).

## Scenario 1 — {bucket_name}, per-query latency
| Cache regime | Filter | P50 ms | P95 ms | P99 ms | N |
|---|---|---|---|---|---|
{chr(10).join(_format_cell_table_row(c) for c in scenario1_cells)}

> P99 confidence: at N=200, P99 is approximately the 2nd-largest of 200 — wide CI, treat as low confidence.

## Scenario 2 — {bucket_name}, concurrency (60s loops)
| N | Aggregate P50 ms | P95 ms | P99 ms | Total queries | QPS | Worker peak CPU% | DB active conn peak |
|---|---|---|---|---|---|---|---|
{chr(10).join(_format_scenario2_row(c) for c in scenario2_cells)}

### CPU + cache-hit details per Scenario 2 cell
{chr(10).join(_format_scenario2_detail(c) for c in scenario2_cells)}

## Runner's preliminary read
**{runner_read}**

Open questions for human review:
{open_q_block}

## Recommendation to reviewer
{recommendation}
"""

    out_path = output_dir / f"phase0-handoff-{bucket_slug}.md"
    out_path.write_text(md)
    return out_path


def _format_scenario2_detail(c: Scenario2CellResult) -> str:
    return (
        f"\n#### N={c.concurrency}\n"
        f"- Worker CPU: peak={c.cpu_samples.peak:.1f}%, P95={c.cpu_samples.p95:.1f}%, mean={c.cpu_samples.mean:.1f}% (n={len(c.cpu_samples.samples)})\n"
        f"- DB cache hit ratio: {c.pg_delta.cache_hit_ratio:.2%} ({c.pg_delta.blks_hit_delta:,} hit / {c.pg_delta.blks_read_delta:,} read)\n"
        f"- DB tup_fetched delta: {c.pg_delta.tup_fetched_delta:,}\n"
        f"- DB active connections peak: {c.pg_delta.active_peak}\n"
        f"- Aggregate latency: P50={c.aggregate_p50_ms:.2f}ms / P95={c.aggregate_p95_ms:.2f}ms / P99={c.aggregate_p99_ms:.2f}ms\n"
    )
