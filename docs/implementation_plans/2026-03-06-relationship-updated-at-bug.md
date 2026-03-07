# Bump `updated_at` on Both Entities for Relationship Changes

## Problem

When relationships are created, updated, or deleted, the `updated_at` timestamp on the affected entities is not bumped. This causes two concrete bugs:

1. **Stale HTTP cache (Safari 304s):** The `check_not_modified()` function in note/bookmark/prompt GET endpoints compares the entity's `updated_at` against `If-Modified-Since`. Since `updated_at` doesn't change when relationships change, Safari gets a 304 and serves stale cached responses that are missing the new relationship data.

2. **Frontend stale dialog never triggers:** `useStaleCheck` compares `updated_at` timestamps to detect server-side changes. Since relationship mutations don't bump `updated_at`, the dialog never fires.

Note: History is currently only recorded on the source entity. This isn't a bug -- it's just how the system works. However, in milestone 1 the fix naturally records history on the target as well, since `_record_relationship_history` does both the `updated_at` bump and history entry in one call.

There are **two code paths** that mutate relationships:

| Path | Where | Source `updated_at` | Target `updated_at` | History |
|------|-------|---------------------|---------------------|---------|
| **Standalone endpoints** (`POST/PATCH/DELETE /relationships/`) | `relationships.py` router | Not bumped | Not bumped | Source only |
| **Inline sync** (`PATCH /notes/{id}` with `relationships` field) | `sync_relationships_for_entity` in `relationship_service.py` | Bumped by normal update flow | Not bumped | Source only (via normal update) |

Both paths need to be fixed.

---

## Milestone 1: Standalone `/relationships/` Endpoints

### Goal & Outcome

Fix the `POST`, `PATCH`, and `DELETE /relationships/` endpoints so that both the source and target entities get their `updated_at` bumped and history recorded.

After this milestone:
- Creating a relationship via MCP bumps `updated_at` on both entities
- Deleting/updating a relationship via the standalone endpoints does the same
- Both entities have history entries with `changed_fields=["relationships"]`
- HTTP cache is invalidated for both entities (Safari gets 200, not 304)
- Empty PATCH body is a no-op (no history, no timestamp bump)

### Implementation Outline

#### `backend/src/api/routers/relationships.py`

**Add import:** `from sqlalchemy import func`

**Modify `_record_relationship_history`** (around line 52): After fetching the entity, bump its `updated_at`. The entity is already session-tracked, so the subsequent `db.flush()` inside `history_service.record_action` will persist this.

```python
entity = await service.get(db, user_id, entity_id, include_archived=True)
if entity is None:
    return
entity.updated_at = func.clock_timestamp()  # ADD THIS
```

This is the right place because every caller of `_record_relationship_history` wants both the timestamp bump and the history entry. Putting the bump here avoids duplicating it across every endpoint.

Also update the docstring from "Record a metadata-only history entry for a relationship change on an entity." to "Bump entity updated_at and record a metadata-only history entry for a relationship change."

**`create_relationship` endpoint** (after existing history call ~line 109): Add a second call for the target entity:

```python
await _record_relationship_history(
    db, current_user.id, data.target_type, data.target_id, limits, request,
)
```

**`update_relationship` endpoint** (lines ~196-199): Before calling `update_relationship`, capture the old description from the fetched relationship so we can detect no-effective-change. Gate history recording on whether the value actually changed, not just whether it was provided. This is consistent with `sync_relationships_for_entity` which compares old vs new at line 699.

```python
# Capture old value before mutation
rel_before = await relationship_service.get_relationship(db, current_user.id, relationship_id)
if rel_before is None:
    raise HTTPException(status_code=404, detail="Relationship not found")
old_description = rel_before.description

rel = await relationship_service.update_relationship(
    db, current_user.id, relationship_id, **kwargs,
)
# ...

# Only record history if a value actually changed
actually_changed = kwargs and rel.description != old_description
if actually_changed:
    await _record_relationship_history(
        db, current_user.id, rel.source_type, rel.source_id, limits, request,
    )
    await _record_relationship_history(
        db, current_user.id, rel.target_type, rel.target_id, limits, request,
    )
```

Note: This introduces an extra `get_relationship` call. Alternatively, the agent could refactor to capture the old description from the existing `update_relationship` service call (which already fetches the relationship internally). Either approach is fine -- the agent should use judgment on the cleanest implementation.

**`delete_relationship` endpoint** (lines ~218-229): Capture target info before deletion and add second history call:

```python
source_type = rel.source_type
source_id = rel.source_id
target_type = rel.target_type   # ADD
target_id = rel.target_id       # ADD
```

After the existing source history call:

```python
await _record_relationship_history(
    db, current_user.id, target_type, target_id, limits, request,
)
```

### Testing Strategy

All tests go in `backend/tests/api/test_relationships.py`. Add `import asyncio` at module level.

**History on target (3 tests):**
- `test__api_create_relationship__records_history_on_target` -- target entity gets history with `changed_fields=["relationships"]`
- `test__api_delete_relationship__records_history_on_target` -- same for delete
- `test__api_update_relationship__records_history_on_target` -- same for update

Follow the same pattern as the existing `*_on_source` tests (lines 758-834).

**`updated_at` bumps on both entities (3 tests):**
- `test__api_create_relationship__bumps_updated_at_on_both` -- both entities' `updated_at` increases after create
- `test__api_delete_relationship__bumps_updated_at_on_both` -- same for delete
- `test__api_update_relationship__bumps_updated_at_on_both` -- same for update

Use `asyncio.sleep(0.01)` for timestamp separation, `>` comparison. Fetch entities before and after the relationship mutation to compare timestamps.

**Prompt entity coverage (1 test):**
- `test__api_create_relationship__bumps_updated_at_on_prompt` -- verify prompt entity `updated_at` bumps when a relationship involving a prompt is created (ensures the `_entity_services` map works for all entity types)

**No-op gating (2 tests):**
- `test__api_update_relationship__empty_body_does_not_bump_updated_at` -- empty PATCH body doesn't create history or bump `updated_at`
- `test__api_update_relationship__same_description_does_not_bump_updated_at` -- PATCH with the current description value produces no history entry and no `updated_at` bump on either entity

**HTTP cache regression (1 test):**
- `test__api_create_relationship__invalidates_http_cache` -- `GET /notes/{id}/metadata` with `If-Modified-Since` header returns 200 (not 304) after a relationship is created on that note. Use `~1.1s` delay before the relationship creation to cross a second boundary, since `check_not_modified` compares at second precision (`updated_at.replace(microsecond=0)`).

### Verification

```bash
cd backend && python -m pytest tests/api/test_relationships.py -x -v
```

---

## Milestone 2: Inline Sync via Entity Update Endpoints

### Goal & Outcome

Fix `sync_relationships_for_entity` so that target entities get their `updated_at` bumped when relationships are added, removed, or have their description changed via the inline path (e.g. `PATCH /notes/{id}` with `relationships` field).

After this milestone:
- Editing Note A to add a link to Note B bumps Note B's `updated_at`
- If Note B is open in another tab/session, the stale dialog fires and Safari serves fresh data
- All relationship mutation paths consistently bump `updated_at` on both sides

### Implementation Outline

#### `backend/src/services/relationship_service.py`

**Modify `sync_relationships_for_entity`** (lines 591-705): After the three mutation loops (delete, create, update descriptions), collect all affected target entity IDs and bump their `updated_at`.

The function already knows the affected targets from `to_add`, `to_remove`, and changed descriptions in `in_both`. Collect them into a set, then issue a bulk UPDATE. The source entity's `updated_at` is already bumped by the caller (e.g. `note_service.update` line 249), so we only need to handle targets here.

```python
# Collect target entities whose relationships changed
affected_targets: set[tuple[str, UUID]] = set()

for key in to_remove:
    target_type, target_id_str, _ = key
    affected_targets.add((target_type, UUID(target_id_str)))

for key in to_add:
    target_type, target_id_str, _ = key
    affected_targets.add((target_type, UUID(target_id_str)))

for key in in_both:
    item = desired_by_key[key]
    if item.description != current_descriptions[key]:
        target_type, target_id_str, _ = key
        affected_targets.add((target_type, UUID(target_id_str)))

# Bump updated_at on affected target entities
for target_type, target_id in affected_targets:
    model = MODEL_MAP.get(target_type)
    if model is None:
        continue
    stmt = select(model).where(model.id == target_id, model.user_id == user_id)
    result = await db.execute(stmt)
    target_entity = result.scalar_one_or_none()
    if target_entity is not None:
        target_entity.updated_at = func.clock_timestamp()

if affected_targets:
    await db.flush()
```

Note: We use individual filtered queries + attribute set rather than a bulk `UPDATE` statement because (a) the number of affected targets per sync is small (bounded by `max_per_entity`, typically ~50), and (b) the entities may span multiple model types (bookmark, note, prompt), so a single UPDATE statement wouldn't work. We filter by `user_id` (not just `db.get()` by PK) for defense in depth -- ensuring we never accidentally bump another user's entity.

### Testing Strategy

Tests go in `backend/tests/api/test_relationships.py`.

**Target `updated_at` bump via inline sync (3 tests):**
- `test__api_update_note_with_relationships__bumps_target_updated_at` -- `PATCH /notes/{id}` with a new relationship bumps the target entity's `updated_at`. Create Note A and Note B, record Note B's `updated_at`, then update Note A with `relationships: [{target_type: "note", target_id: B.id}]`. Verify Note B's `updated_at` increased.
- `test__api_update_note_remove_relationship__bumps_target_updated_at` -- Same as above but for removing a relationship. Create the relationship first, then update Note A with `relationships: []` to remove it. Verify Note B's `updated_at` increased.
- `test__api_update_bookmark_with_relationships__bumps_target_updated_at` -- Same pattern but via `PATCH /bookmarks/{id}` to confirm the sync path works across entity types, not just notes.

**No-op sync doesn't bump (1 test):**
- `test__api_update_note_with_same_relationships__does_not_bump_target` -- If the relationship set hasn't changed, target `updated_at` should not be bumped. Create Note A linked to Note B, then update Note A with the same `relationships` list. Verify Note B's `updated_at` is unchanged.

**HTTP cache regression for inline path (1 test):**
- `test__api_update_note_with_relationships__invalidates_target_http_cache` -- `GET /notes/{target_id}/metadata` with `If-Modified-Since` returns 200 (not 304) after the source note is updated with a new relationship to the target. Use `~1.1s` delay for second-precision boundary.

### Verification

```bash
cd backend && python -m pytest tests/api/test_relationships.py -x -v
cd backend && python -m pytest --tb=short  # full suite for regressions
```
