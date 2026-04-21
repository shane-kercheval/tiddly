# Implementation Plan: Preserve Most Recent Versioned History Record During Time-Based Cleanup

**Ticket:** [KAN-123](https://tiddly.atlassian.net/browse/KAN-123)
**Date:** 2026-04-20
**Scope:** Backend only. Single file change + tests + doc update.

---

## Background

### The Problem

The nightly time-based history cleanup (`cleanup_expired_history` in `backend/src/tasks/cleanup.py`) deletes any `ContentHistory` row older than the user's tier `history_retention_days` (FREE=1, STANDARD=5, PRO=15).

If an entity (bookmark/note/prompt) is idle longer than that window, **all** of its history is deleted. On the next user edit:

1. A new history record is written with a `content_diff` against an entity snapshot, but with **no predecessor record** to show the "before" state.
2. The frontend renders `Previous metadata unavailable` (see `frontend/src/components/MetadataChanges.tsx:295`) — no diff, no "before" metadata.
3. The **Restore** button is effectively dead: it restores to the *previous* version record, which no longer exists.

This is a degraded, confusing UX for any user on a short retention window who revisits an older item.

### The Fix (chosen approach)

Modify `cleanup_expired_history` so it always preserves the **single most recent versioned record** (highest `version`, `version IS NOT NULL`) per `(user_id, entity_type, entity_id)` regardless of age. Audit records (`version IS NULL` — DELETE/UNDELETE/ARCHIVE/UNARCHIVE) remain fully eligible for time-based pruning because they carry no diff/restore value.

Once this fix lands:
- Diff/Restore on the "first edit after long idle" works because there's always a prior anchor record.
- Worst-case storage is bounded (≤1 extra row per entity, cleaned automatically on hard delete via existing cascade).
- No schema migration, no API change, no frontend change.

### Out of Scope

- Count-based inline pruning (`history_service._prune_to_limit`) already preserves the N most recent versions correctly; do not touch it.
- `cleanup_soft_deleted_items` (permanent-delete flow) should behave exactly as before — when the entity is hard-deleted, **all** history goes with it via the existing cascade.
- Synthesizing predecessor records on save (Option B in the review) — explicitly rejected.
- Frontend "Undo" alternative — explicitly rejected.

---

## Prerequisite Reading

Before implementing, the agent MUST read:

1. `docs/content-versioning.md` — full spec, especially §"Retention and Cleanup" and §"Inactive Entities and Time-Based Cleanup".
2. `backend/src/tasks/cleanup.py` — the entire file, to understand the three cleanup functions and how they compose.
3. `backend/src/models/content_history.py` — the `ContentHistory` model, noting that `version` is nullable (audit actions) and the unique constraint `(user_id, entity_type, entity_id, version)` treats NULL as exempt.
4. `backend/src/core/tier_limits.py` — tier retention config.
5. `backend/tests/tasks/test_cleanup.py` — existing cleanup tests, especially the boundary-condition tests around `cleanup_expired_history`. Mirror the fixture style there.
6. The Jira ticket description on KAN-123 (use `mcp__atlassian__getJiraIssue`).

**PostgreSQL docs to skim before writing the new query:**
- Window functions: https://www.postgresql.org/docs/17/tutorial-window.html
- `ROW_NUMBER()` over `PARTITION BY`: https://www.postgresql.org/docs/17/functions-window.html
- `DELETE ... USING` / CTE-in-DELETE: https://www.postgresql.org/docs/17/sql-delete.html

**SQLAlchemy 2.0 docs:**
- Window functions via `over()`: https://docs.sqlalchemy.org/en/20/core/sqlelement.html#sqlalchemy.sql.expression.over
- CTEs with DELETE: https://docs.sqlalchemy.org/en/20/core/selectable.html#sqlalchemy.sql.expression.CTE

---

## Questions the Agent Should Raise Before Coding

If any of these are unclear after reading the above, stop and ask:

1. **Scope of "most recent"**: confirm the rule is **per `(user_id, entity_type, entity_id)`** (not per user, not per entity type). The plan assumes per-entity.
2. **Audit records**: confirm that audit records (NULL `version`) should remain subject to time-based deletion and are **not** counted as the "most recent record to preserve." The plan assumes yes.
3. **Soft-deleted entities**: should we still preserve the latest history row for a soft-deleted entity that is not yet permanently deleted? The plan assumes yes — history lookups work for soft-deleted entities (per spec), and treating them specially adds complexity for little gain. The 30-day soft-delete cascade will clean them up anyway.
4. **Tier batching**: the current loop batches DELETE per tier for efficiency. The plan preserves this — each tier still gets a single DELETE. Confirm this is fine.

---

# Milestone 1: Preserve Latest Versioned Record in Time-Based Cleanup

**Scope:** one source file, one test file, one doc file. Agent should stop after this milestone for human review.

## 1.1 Goal & Outcome

**Goal:** Ensure `cleanup_expired_history` never deletes the most recent versioned `ContentHistory` row for any entity, even if that row is older than the tier's retention window.

**Outcomes after this milestone:**
- A user who edits a bookmark/note/prompt that has been idle longer than `history_retention_days` sees a proper diff and working Restore button on the first edit.
- Each entity retains at least its most recent versioned history record indefinitely (until the entity is hard-deleted, at which point the existing cascade removes it).
- Audit records (DELETE/UNDELETE/ARCHIVE/UNARCHIVE) continue to be time-pruned as before.
- `cleanup_soft_deleted_items` and `cleanup_orphaned_history` behavior is unchanged.
- New tests cover the preservation rule explicitly; existing cleanup tests continue to pass.

## 1.2 Implementation Outline

### What changes

**File:** `backend/src/tasks/cleanup.py`

Rewrite the DELETE inside `cleanup_expired_history` (currently lines 156–163) so that, per tier, it excludes each entity's most recent versioned record. Everything else in the function (tier loop, cutoff computation, stats accounting, logging, commit) stays the same.

### Query shape (guidance, not a copy-paste)

The new query needs to, per tier:

1. Identify the latest *versioned* row per `(user_id, entity_type, entity_id)` among rows owned by users in this tier.
2. Delete rows in this tier older than `cutoff` **except** those identified in step 1.

A clean way to express this in SQLAlchemy 2.0 is a CTE that ranks rows via `ROW_NUMBER()`:

```python
from sqlalchemy import case, delete, func, select
from sqlalchemy.sql import literal_column

# Rank versioned rows per entity; NULL-version rows get rank 0 (never "preserved").
ranked = (
    select(
        ContentHistory.id.label("id"),
        func.row_number().over(
            partition_by=(
                ContentHistory.user_id,
                ContentHistory.entity_type,
                ContentHistory.entity_id,
            ),
            order_by=ContentHistory.version.desc(),
        ).label("rn"),
    )
    .where(
        ContentHistory.user_id.in_(
            select(User.id).where(
                func.coalesce(User.tier, Tier.FREE.value) == tier.value,
            ),
        ),
        ContentHistory.version.is_not(None),  # only rank versioned rows
    )
    .cte("ranked_history")
)

latest_ids = select(ranked.c.id).where(ranked.c.rn == 1)

delete_stmt = delete(ContentHistory).where(
    ContentHistory.user_id.in_(
        select(User.id).where(
            func.coalesce(User.tier, Tier.FREE.value) == tier.value,
        ),
    ),
    ContentHistory.created_at < cutoff,
    ContentHistory.id.not_in(latest_ids),
)
```

Notes:
- Do not use `ORDER BY version DESC NULLS LAST` — we explicitly filter `version IS NOT NULL` in the CTE, so ordering is unambiguous.
- The exclusion set only includes versioned rows. Audit rows (`version IS NULL`) are never in `latest_ids`, so they remain fully subject to `created_at < cutoff`.
- Keep the existing `coalesce(User.tier, ...)` tier resolution.
- Preserve the existing `result.rowcount` / stats / logging. The log line can stay the same; the semantics of "expired_deleted" are unchanged (it's still "rows deleted by this function").

If the agent finds a measurably simpler or more idiomatic SQLAlchemy expression (e.g., correlated subquery with `MAX(version)`) that passes all tests and stays inside a single DELETE per tier, that's acceptable. Do not break the "one DELETE per tier" efficiency property.

### What does NOT change

- `cleanup_soft_deleted_items` — untouched.
- `cleanup_orphaned_history` — untouched.
- `history_service.py` count-based pruning — untouched.
- `CleanupStats` shape — untouched.
- The function signature of `cleanup_expired_history` — untouched.
- Any migration — none needed.

## 1.3 Testing Strategy

**File:** `backend/tests/tasks/test_cleanup.py` — add tests alongside the existing `cleanup_expired_history` suite. Follow the existing fixture/helper style; do not introduce new testing frameworks or patterns.

**Do NOT mock the database.** Per project convention, history/cleanup tests hit the real test DB. Use the same session/fixture the existing cleanup tests use.

### Required new tests (each as a separate `async def test_...` with type hints)

1. **`test_preserves_only_versioned_record_when_aged`**
   One entity with a single versioned history row, `created_at` well past the tier cutoff → row is **preserved**. `expired_deleted == 0`.

2. **`test_preserves_latest_and_deletes_older_aged_records`**
   One entity with several aged versioned rows (all past cutoff) → only the row with the highest `version` is preserved; all others deleted.

3. **`test_mixed_aged_and_fresh_records`**
   One entity with a mix of aged and fresh (within retention) versioned rows → all fresh rows preserved; aged rows deleted except for the latest aged one *only if* no fresh row with a higher version exists. (If a fresh row with a higher version exists, it is already the latest and no aged row is preserved.) Assert exact surviving set.

4. **`test_audit_records_still_deleted_when_aged`**
   Entity with aged audit records (NULL `version`) and no versioned rows → all audit records deleted. Confirms audit rows don't get preserved by the new rule.

5. **`test_audit_record_does_not_count_as_latest`**
   Entity with aged versioned rows plus a *newer* aged audit row → the audit row is deleted and the latest *versioned* row is preserved. This is the key rule: "latest versioned," not "latest row."

6. **`test_preservation_is_per_entity_not_per_user`**
   One user, two entities (e.g., a bookmark and a note), both with all rows aged past cutoff → each entity retains its own latest versioned row (2 rows preserved total).

7. **`test_preservation_respects_tier_boundaries`**
   Two users in different tiers (e.g., FREE and PRO), each with an entity whose rows are all aged past *both* cutoffs → each user's entity retains exactly its latest versioned row. Verifies the per-tier DELETE loop still interacts correctly with the preservation rule.

8. **`test_soft_deleted_entity_history_preserved_like_active`**
   Entity with `deleted_at` set but not yet past the 30-day permanent-delete cutoff → latest versioned history row still preserved by `cleanup_expired_history`. (Permanent deletion via `cleanup_soft_deleted_items` is a separate codepath; confirm that function still cascades all history when the entity is permanently removed — either by reusing an existing test or adding a smoke assertion.)

9. **`test_boundary_exactly_at_cutoff_unchanged`**
   Re-confirm the existing boundary behavior: a row with `created_at == cutoff` is preserved (strict `<` comparison), and this interacts correctly with the new preservation rule. Likely the existing boundary test still passes; if not, adjust or add.

10. **`test_idempotent_second_run`**
    Run `cleanup_expired_history` twice in a row on the same seeded data → second run deletes zero rows and leaves the preserved set intact. Guards against a bug where the preservation predicate is computed inconsistently across runs.

### Regression check

Run the full existing `test_cleanup.py` module to make sure no boundary/tier test regresses.

### Local verification command

```bash
PYTHONPATH=backend/src uv run pytest backend/tests/tasks/test_cleanup.py -v
```

Then `make backend-verify` before declaring the milestone done.

## 1.4 Documentation Updates

**File:** `docs/content-versioning.md`

Two small edits in §"Retention and Cleanup":

1. In the "Time-Based Pruning (Scheduled)" subsection, add a bullet:
   > The most recent versioned history record per entity is always retained, regardless of age. Audit records (DELETE/UNDELETE/ARCHIVE/UNARCHIVE) are not exempted. This guarantees that diff and restore remain functional after long idle periods.

2. In §"Inactive Entities and Time-Based Cleanup", correct the current text:
   > All history records may be deleted by time-based cleanup

   to:
   > All history records **except the most recent versioned record** may be deleted by time-based cleanup. The retained record serves as the anchor for diff and restore on the next edit.

No other docs should need updating. Specifically:
- `AGENTS.md` — no change (no new commands, no architectural shift).
- `docs/architecture.md` — no change (service topology unchanged). If the agent disagrees, flag it before editing.
- `README.md`, `llms.txt`, pricing/features pages — no change (no user-visible feature change; the bugfix restores documented behavior).
- No changelog entry unless the user explicitly asks for one.

## 1.5 Stop Here

After implementation + tests + doc updates are complete and `make backend-verify` passes, **stop and wait for human review.** Do not commit. Summarize:
- Final query approach chosen (CTE vs correlated subquery vs other).
- Any test surprises.
- Any assumption you had to make that wasn't explicitly answered in §"Questions the Agent Should Raise."
