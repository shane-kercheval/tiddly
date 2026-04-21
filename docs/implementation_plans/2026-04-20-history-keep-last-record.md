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

Two shapes are equally correct. **Prefer `NOT EXISTS` as the primary form** — it reads directly as the rule we want: "delete an aged row unless a higher-versioned row exists for the same entity." Fall back to the ranked CTE only if the generated SQL is clearer in that form for a particular reader.

#### Primary: NOT EXISTS

```python
newer = aliased(ContentHistory)

delete_stmt = delete(ContentHistory).where(
    ContentHistory.user_id.in_(
        select(User.id).where(
            func.coalesce(User.tier, Tier.FREE.value) == tier.value,
        ),
    ),
    ContentHistory.created_at < cutoff,
    # Preserve the single latest versioned row per entity: delete only if
    # this row is an audit row (version IS NULL), OR a higher-versioned row
    # exists for the same entity.
    #
    # IMPORTANT — foot-gun warning for future readers: do NOT narrow the
    # `newer` subquery by adding `newer.created_at < cutoff` or similar.
    # We must rank/compare across ALL versioned rows, aged or not. Narrowing
    # to aged-only would preserve a stale aged anchor even when a fresh
    # higher-versioned row already exists — which reintroduces the original
    # bug in a different shape.
    or_(
        ContentHistory.version.is_(None),
        exists().where(
            newer.user_id == ContentHistory.user_id,
            newer.entity_type == ContentHistory.entity_type,
            newer.entity_id == ContentHistory.entity_id,
            newer.version.is_not(None),
            newer.version > ContentHistory.version,
        ),
    ),
)
```

#### Alternative: ranked CTE with `ROW_NUMBER()`

Same semantics via a CTE that ranks versioned rows per entity, then deletes aged rows whose id is not in `rn = 1`. Acceptable if the implementer finds it clearer. If you choose this form, carry the same foot-gun comment: the ranking must span all versioned rows, not aged-only.

#### Notes (apply to either shape)

- Audit rows (`version IS NULL`) are never "latest" for preservation purposes. They remain fully subject to `created_at < cutoff`.
- Keep the existing inline `coalesce(User.tier, Tier.FREE.value)` tier resolution — mirror the existing style in the file. Do **not** wrap it in a separate `.subquery()` binding: with the NOT EXISTS shape, the tier-users select is only referenced once (in the outer `user_id.in_(...)`), so the binding adds indirection without planner benefit.
- Preserve the existing `result.rowcount`, `CleanupStats`, and log line. The semantics of `expired_deleted` are unchanged ("rows deleted by this function").
- Update the function docstring (`cleanup.py:127`) to reflect the new invariant: it no longer "deletes all history records older than retention period" — it deletes all such records *except the most recent versioned record per entity*.

#### Benchmarking

Do **not** make `EXPLAIN ANALYZE` a gating requirement. Both shapes plan well in PostgreSQL 17 for realistic cardinalities. Only benchmark if the choice between shapes is otherwise a coin flip for you and you have a realistic local dataset; otherwise ship the clearer one.

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

10. **`test_preservation_follows_latest_across_runs`**
    Seed an entity with multiple aged versioned rows, run cleanup (leaves the latest preserved), then insert a *new* aged versioned row with a higher `version`, then run cleanup again. Assert: the previously-preserved row is now deleted (it is no longer the latest), and the new row is preserved. This catches bugs where preservation was cached, where `rn = 1` was computed against a stale view, or where the NOT EXISTS predicate was written against the wrong partition.

11. **`test_same_tier_users_isolated`**
    Two users **in the same tier**, each with their own entity and aged versioned rows → each user's entity retains exactly its own latest versioned row (2 rows preserved total). Distinct from #7 (which crosses tiers) and #6 (which uses a single user). The tier-batched DELETE runs one statement across all users in the tier; this test confirms the `(user_id, entity_type, entity_id)` partition keeps users isolated within a tier.

12. **`test_view_content_at_preserved_version`** *(parameterized)*
    After cleanup preserves a single versioned row, confirm `reconstruct_content_at_version` (the path used by the view-at-version endpoint) returns correct content for that version. **Parameterize over two shapes of the preserved row:**
    - Preserved row is at a non-modulo-10 version (e.g., v5) → `content_snapshot` is None, row has `content_diff` only. Reconstruction must anchor on `entity.content` and skip the diff (target == latest, no diffs to apply).
    - Preserved row is at a modulo-10 version (e.g., v10) → `content_snapshot` is set. Reconstruction can anchor on the snapshot.

    Assert the returned content equals the entity's current content in both shapes. This pins the reconstruction path through a single-row post-cleanup history, which is a distinct code path from restore and from the diff endpoint.

13. **`test_create_only_entity_preserved_when_aged`**
    Entity with exactly one history record — a CREATE action (`action='create'`, `version=1`, `content_snapshot` set, `content_diff` None) — aged past cutoff → the CREATE record is preserved. Confirms CREATE records are first-class preservation-eligible rows (not accidentally excluded by a check that assumes `content_diff IS NOT NULL`).

### Symptom-level regression test (REQUIRED — the highest-value test in this milestone)

The tests above prove rows survive/die correctly. This test proves the **user-visible bug is actually fixed**: that after cleanup, the next edit through the normal service path produces a working diff and a restorable anchor.

**File:** `backend/tests/services/test_history_service.py` (preferred — service layer is where the predecessor-selection logic lives) or `backend/tests/api/test_history.py` if source/auth plumbing is relevant.

**Critical: drive the update through the real service path.** The new edit must go through `HistoryService.record_action` (via the entity service's update path that calls it in production), **not** via a direct ORM insert of a `ContentHistory` row. The whole point of this test is proving the service correctly reads the preserved predecessor when computing the next diff. An ORM-direct test would pass even if `record_action` had a regression in predecessor selection.

**Parameterize over both starting states** (use `pytest.mark.parametrize`):

- **`versioned-aged`**: entity has multiple aged versioned history rows, all past cutoff. Seed so the preserved (latest versioned) row ends up at a version > 1 with a populated `metadata_snapshot` that differs from the post-edit state (so we can assert the diff endpoint reads the right `before_metadata`).
- **`audit-only-aged`**: entity has only aged audit rows (e.g., ARCHIVE/UNARCHIVE), all past cutoff, no versioned rows.

For each starting state:

1. Seed the entity and the aged history rows.
2. Run `cleanup_expired_history` with an injected `now` that makes all seeded rows aged.
3. Verify the expected surviving set (versioned-aged → exactly the latest versioned row survives; audit-only-aged → zero history rows survive).
4. Perform an update on the entity **through the service layer** (e.g., `BookmarkService.update` / the path that calls `record_action`).
5. Assert (versioned-aged):
   - A new `ContentHistory` row is written with a non-null `content_diff`.
   - `get_version_diff` for the new version returns non-null `before_metadata`, **and its contents equal the preserved row's `metadata_snapshot` field-for-field** (title, tags, url/name as applicable). This pins that the diff endpoint reads the right predecessor, not just that *some* predecessor exists.
   - `GET /history` for the entity (the list endpoint) returns the preserved row plus the new row — exactly the set we expect post-cleanup + post-edit. This confirms the history list endpoint reflects the post-cleanup state correctly.
   - Restore to the preserved prior version succeeds and returns the preserved row's content.
6. Assert (audit-only-aged) — **this is NOT a CREATE path, despite being v1. Pin the shape explicitly:**
   - The new row is an UPDATE-at-v1: `action == 'update'`, `version == 1`, `content_diff is not None`, `content_snapshot is None`. `_get_next_version` returns 1 because `max(version)` over non-null versions is None with only audit rows present; `record_action` then follows the UPDATE branch since the entity already exists with differing content.
   - `get_version_diff` for the new version returns `before_metadata is None` (no v0 record to read metadata from) and `action == 'update'`. The frontend "Previous metadata unavailable" branch is the expected, acceptable UX for this case.
   - `GET /history` returns exactly the one new row.
   - **Do not attempt to "fix" the v1-update-with-diff shape in this PR.** File as a follow-up observation in the milestone summary (see §1.5). Semantic context: this state only arises for *legacy data* whose CREATE record was deleted by pre-fix cleanup runs. New entities always have their CREATE preserved by this fix, so they never reach audit-only-aged. The legacy cohort ages out over time; no ongoing gap.

Parameterizing this way subsumes the audit-only-edge concern without needing a separate test.

### Regression check

Run the full existing `test_cleanup.py` module to make sure no boundary/tier test regresses.

### Local verification command

```bash
PYTHONPATH=backend/src uv run pytest backend/tests/tasks/test_cleanup.py backend/tests/services/test_history_service.py -v
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

Framing: this is a **behavior change + doc correction**, not a restoration of previously-documented behavior. `docs/content-versioning.md` currently documents the opposite of what we want (history starts fresh after long idle). The edits above correct that.

No other docs should need updating. Specifically:
- `AGENTS.md` — no change (no new commands, no architectural shift).
- `docs/architecture.md` — no change (service topology unchanged). If the agent disagrees, flag it before editing.
- `README.md`, `llms.txt`, pricing/features pages — no change (no new user-visible feature; this corrects degraded UX).
- No changelog entry unless the user explicitly asks for one.

## 1.5 Stop Here

After implementation + tests + doc updates are complete and `make backend-verify` passes, **stop and wait for human review.** Do not commit. Summarize:
- Final query approach chosen (NOT EXISTS vs ranked CTE vs other).
- Any test surprises.
- Any assumption you had to make that wasn't explicitly answered in §"Questions the Agent Should Raise."
- **Follow-up observation (do not fix in this PR):** the audit-only-aged starting state produces a v1 UPDATE-with-diff-no-snapshot row — unusual shape, but semantically consistent and bounded to pre-fix legacy data. Note whether the `GET /history` and diff-endpoint behavior for this row was as expected.

---

## Merge Notes (not implementation steps — for the PR description)

These don't belong inside the milestone work. Include them in the PR description / commit message for reviewer context and future archaeology:

- **Behavior change, not bugfix framing:** previously-documented behavior in `docs/content-versioning.md` (history starts fresh after long idle) is being changed, not restored. Doc updated in same PR.
- **Storage footprint shift:** `content_history` row count now scales with live-entity count (one retained row per entity for long-idle entities), not strictly with retention days. Still bounded — one row per entity is tiny, and hard-delete cascades still clean up. Noting so future "why is this table growing" investigations land here.
