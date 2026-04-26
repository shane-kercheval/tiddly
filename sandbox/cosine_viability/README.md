# Cosine viability benchmark harness

Synthetic benchmark for the question: **is exact cosine search performant enough to be the v1 vector-search implementation?**

**Phase 0 results (2026-04-26):** the answer is "yes, with caveats." See:

- [`phase0-handoff-typical-power.md`](./phase0-handoff-typical-power.md) — Typical Power bucket (10 users × 20K chunks)
- [`phase0-handoff-super-power.md`](./phase0-handoff-super-power.md) — Super Power bucket (10 users × 130K chunks)
- [`explain/phase0/`](./explain/phase0/) — full EXPLAIN (ANALYZE, BUFFERS, VERBOSE) dumps

Findings are also referenced from the parent plan at [`docs/implementation_plans/2026-04-05-pgvector-embeddings.md`](../../docs/implementation_plans/2026-04-05-pgvector-embeddings.md).

## Layout

```
sandbox/cosine_viability/
├── README.md                          # this file
├── requirements.txt                   # deps (Railpack reads this for deploy)
├── railway.json                       # Railway service config + start command
├── phase0-handoff-typical-power.md    # Phase 0 results, Typical Power
├── phase0-handoff-super-power.md      # Phase 0 results, Super Power
├── explain/                           # full EXPLAIN dumps per bucket
│   └── phase0/{typical_power,super_power}/step0.txt
├── tests/
│   └── test_smoke.py                  # local end-to-end smoke against testcontainer
├── __init__.py
├── main.py                            # CLI entry — `python -m cosine_viability.main`
├── config.py                          # bucket profiles, scenario configuration
├── data_gen.py                        # synthetic vector + entity_id generation
├── schema.py                          # CREATE TABLE / B-tree DDL
├── seed.py                            # text-COPY-based seeder
├── queries.py                         # SQL primitives for Step 0 / Scenario 1 / Scenario 2
├── scenarios.py                       # cell orchestration + percentile reporting
├── instrumentation.py                 # CPU + pg_stat sampling
└── handoff.py                         # writes the Phase 0 handoff markdown
```

There is **no `pyproject.toml`** in this directory by design — local development uses the parent repo's `pyproject.toml` (deps live there as dev deps), and Railway deploy uses `requirements.txt`. Adding one here would shadow the parent and confuse `uv` when run from this directory.

## Local development

Smoke tests run against a Postgres + pgvector testcontainer (same pattern as the rest of the repo):

```bash
uv run python -m pytest sandbox/cosine_viability/tests/test_smoke.py -v
```

The smoke test seeds a tiny dataset (2 users × 1K chunks) and runs the full pipeline end-to-end in ~13 seconds.

The pytest pythonpath is set in the root `pyproject.toml` to include `sandbox`, which makes `cosine_viability` importable as a top-level package during tests.

## Running against a real Postgres

Direct invocation (e.g., against a local or testcontainer Postgres):

```bash
PYTHONPATH=sandbox uv run python -m cosine_viability.main \
    --postgres-url postgresql://user:pass@host:port/db \
    --phase 0 \
    --bucket typical_power \
    --output-dir sandbox/cosine_viability
```

CLI flags:
- `--bucket` — one of `light`, `typical`, `typical_power`, `super_power`, `reasonable_max` (see `config.py`).
- `--output-dir` — where the handoff markdown and EXPLAIN dump are written.
- `--image-label`, `--tier-label`, `--region-label`, `--storage-backing` — populate the handoff doc with environment metadata.

## Deploying to Railway

The Railway service config (`railway.json`) uses Railpack for the build (auto-detects Python from `requirements.txt`) and runs the start command which dumps the handoff to stdout via delimiter markers (`===HANDOFF_MARKDOWN_BEGIN===` … `===HANDOFF_MARKDOWN_END===`).

**Note:** the original Phase 0 deploy ran from a temporary staging directory at `/tmp/cosine-deploy/` because Railway's `railway up` upload context expects `cosine_viability` as a subdirectory of the upload. With the current flat-collapsed layout, you'd need to `railway up` from `sandbox/` (so the upload includes `cosine_viability/` as a subdirectory) — or restructure on demand if re-running.

To deploy + run a fresh benchmark:

```bash
# 1. Provision a throwaway Railway project + Postgres service
# 2. Apply the production tuning + RAILWAY_SHM_SIZE_BYTES per the parent plan's findings section
# 3. Create a worker service with DATABASE_URL=${{Postgres.DATABASE_URL}}, BUCKET=<bucket-name>
# 4. From repo root: `cd sandbox && railway up --detach`
# 5. `railway logs --service <worker> | tee deploy.log`
# 6. Extract HANDOFF_MARKDOWN + EXPLAIN blocks from deploy.log
```

The worker service in the Railway project must:
- Have `DATABASE_URL` set (typically via reference variable: `${{Postgres.DATABASE_URL}}`).
- Have `BUCKET` set to the bucket to run (defaults to `typical_power` if not set).
- Optionally have `IMAGE_LABEL`, `TIER_LABEL`, `REGION_LABEL`, `STORAGE_BACKING` for handoff metadata.

The Postgres service must:
- Run Postgres ≥ 17 with pgvector ≥ 0.8 available (`CREATE EXTENSION IF NOT EXISTS vector;` is idempotent at startup).
- Be tuned per the parent plan's findings section (`shared_buffers = 12GB`, `effective_cache_size = 24GB`, `work_mem = 32MB`, `effective_io_concurrency = 200`, **`RAILWAY_SHM_SIZE_BYTES = 17179869184`** on a 32 vCPU / 32 GB Pro replica).

## Buckets

Per the plan, user-size buckets matching the realistic Pro-tier distribution:

| Bucket | Chunks/user | Profile |
|---|---|---|
| `light` | 500 | ~65 entities, casual user |
| `typical` | 3,000 | ~300 entities, regular user |
| `typical_power` | 20,000 | ~1,000 entities, power user |
| `super_power` | 130,000 | ~4,500 entities, heavy researcher |
| `reasonable_max` | 800,000 | ~18,000 entities, approaching Pro tier ceilings |

Phase 0 runs target a single bucket (10 users by default). Phase 0 measured `typical_power` and `super_power`; `reasonable_max` was deliberately not measured (see the parent plan's findings section for rationale).
