# Bump `updated_at` on Both Entities for Relationship Changes

## Problem

When relationships are created, updated, or deleted, the `updated_at` timestamp on the affected entities is not bumped. This causes two concrete bugs:

1. **Stale HTTP cache (Safari 304s):** The `check_not_modified()` function in note/bookmark/prompt GET endpoints compares the entity's `updated_at` against `If-Modified-Since`. Since `updated_at` doesn't change when relationships change, Safari gets a 304 and serves stale cached responses that are missing the new relationship data.

2. **Frontend stale dialog never triggers:** `useStaleCheck` compares `updated_at` timestamps to detect server-side changes. Since relationship mutations don't bump `updated_at`, the dialog never fires.

There are **three code paths** that mutate relationships:

| Path | Where | Source `updated_at` | Target `updated_at` | History |
|------|-------|---------------------|---------------------|---------|
| **Standalone endpoints** (`POST/PATCH/DELETE /relationships/`) | `relationships.py` router | Not bumped | Not bumped | Source only |
| **Inline sync** (`PATCH /notes/{id}` with `relationships` field) | `sync_relationships_for_entity` in `relationship_service.py` | Bumped by normal update flow | Not bumped | Source only (via normal update) |
| **Permanent delete cascade** (`DELETE /notes/{id}?permanent=true`) | `delete_relationships_for_content` in `relationship_service.py`, called from `base_entity_service.delete` | N/A (deleted) | Not bumped | None |

All three paths need to be fixed.

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

Also update the docstring from "Record a metadata-only history entry for a relationship change on an entity." to "Bump entity updated_at and record a metadata-only history entry for a relationship change." Add a note: "NOTE: Milestone 2 implements equivalent logic in sync_relationships_for_entity (relationship_service.py). Keep both in sync when modifying history behavior."

**`create_relationship` endpoint** (after existing history call ~line 109): Add a second call for the target entity:

```python
await _record_relationship_history(
    db, current_user.id, data.target_type, data.target_id, limits, request,
)
```

#### `backend/src/services/relationship_service.py`

**Modify `update_relationship`** (lines ~226-251): Change the return type to `tuple[ContentRelationship | None, bool]`, returning whether the description actually changed. This avoids a redundant pre-fetch in the router and eliminates a TOCTOU race (where the description could change between a separate check and the update).

```python
async def update_relationship(
    db: AsyncSession, user_id: UUID, relationship_id: UUID, *,
    description: str | None = ...,
) -> tuple[ContentRelationship | None, bool]:
    rel = await get_relationship(db, user_id, relationship_id)
    if rel is None:
        return None, False

    changed = False
    if description is not ... and description != rel.description:
        rel.description = description
        rel.updated_at = func.clock_timestamp()
        changed = True

    await db.flush()
    await db.refresh(rel)
    return rel, changed
```

#### `backend/src/api/routers/relationships.py` (continued)

**`update_relationship` endpoint** (lines ~174-201): Add an early return when no updatable fields are provided (empty PATCH body is a no-op). Use the `changed` flag from the service to gate history recording.

```python
kwargs: dict[str, str | None] = {}
if 'description' in updates:
    kwargs['description'] = updates['description']

# Early return: no updatable fields provided → no-op
if not kwargs:
    rel = await relationship_service.get_relationship(
        db, current_user.id, relationship_id,
    )
    if rel is None:
        raise HTTPException(status_code=404, detail="Relationship not found")
    return RelationshipResponse.model_validate(rel)

rel, changed = await relationship_service.update_relationship(
    db, current_user.id, relationship_id, **kwargs,
)
if rel is None:
    raise HTTPException(status_code=404, detail="Relationship not found")

# Only record history if the description actually changed
# NOTE: Milestone 2 implements equivalent logic in sync_relationships_for_entity
# (relationship_service.py). Keep both in sync when modifying history behavior.
if changed:
    await _record_relationship_history(
        db, current_user.id, rel.source_type, rel.source_id, limits, request,
    )
    await _record_relationship_history(
        db, current_user.id, rel.target_type, rel.target_id, limits, request,
    )
```

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

**Existing service tests (`backend/tests/services/test_relationship_service.py`):**
- Update the 6 `test__update_relationship__*` tests (lines 762-859) to unpack the new `(rel, changed)` tuple return value from `update_relationship`. The existing test assertions for `description`, `updated_at`, and `not found` remain valid — they just need to destructure the return value.

### Verification

```bash
cd backend && python -m pytest tests/api/test_relationships.py -x -v
```

---

## Milestone 2: Inline Sync via Entity Update Endpoints

### Goal & Outcome

Fix `sync_relationships_for_entity` so that target entities get their `updated_at` bumped **and history recorded** when relationships are added, removed, or have their description changed via the inline path (e.g. `PATCH /notes/{id}` with `relationships` field).

After this milestone:
- Editing Note A to add a link to Note B bumps Note B's `updated_at` and records history on Note B
- If Note B is open in another tab/session, the stale dialog fires and Safari serves fresh data
- All relationship mutation paths consistently bump `updated_at` and record history on both sides

### Implementation Outline

#### `backend/src/services/relationship_service.py`

**Add parameters to `sync_relationships_for_entity`** (line 591): Add `context` and `limits` parameters. The callers (`note_service.update`, `bookmark_service.update`, `prompt_service.update`) already have both values — they just need to pass them through.

```python
async def sync_relationships_for_entity(
    db: AsyncSession,
    user_id: UUID,
    entity_type: str,
    entity_id: UUID,
    desired: list[RelationshipInput],
    *,
    skip_missing_targets: bool = False,
    max_per_entity: int | None = None,
    context: RequestContext | None = None,  # ADD
    limits: TierLimits | None = None,       # ADD
) -> None:
```

**After the three mutation loops** (delete, create, update descriptions), collect all affected target entity IDs, bump their `updated_at`, and record history.

The function already knows the affected targets from `to_add`, `to_remove`, and changed descriptions in `in_both`. Collect them into a set, then load and update in grouped queries (one per entity type, at most 3).

```python
from collections import defaultdict

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

# Bump updated_at and record history on affected target entities.
# Group by model type to minimize queries (one per entity type, at most 3).
# NOTE: Milestone 1 implements equivalent logic in _record_relationship_history
# (relationships.py router). Keep both in sync when modifying history behavior.
if affected_targets:
    by_type: defaultdict[str, set[UUID]] = defaultdict(set)
    for target_type, target_id in affected_targets:
        by_type[target_type].add(target_id)

    for target_type, ids in by_type.items():
        model = MODEL_MAP.get(target_type)
        if model is None:
            continue
        stmt = select(model).where(model.id.in_(ids), model.user_id == user_id)
        result = await db.execute(stmt)
        for target_entity in result.scalars():
            target_entity.updated_at = func.clock_timestamp()

            # Record history if context is available (skipped during restore)
            if context and limits:
                et = EntityType(target_type)
                service = _entity_services[et]
                current_metadata = await service.get_metadata_snapshot(
                    db, user_id, target_entity,
                )
                await history_service.record_action(
                    db=db,
                    user_id=user_id,
                    entity_type=et,
                    entity_id=target_entity.id,
                    action=ActionType.UPDATE,
                    current_content=target_entity.content,
                    previous_content=target_entity.content,
                    metadata=current_metadata,
                    context=context,
                    limits=limits,
                    changed_fields=["relationships"],
                )

    await db.flush()
```

This requires the entity services and `history_service` for `get_metadata_snapshot` and `record_action`. Since `note_service.py`, `bookmark_service.py`, and `prompt_service.py` all do `from services import relationship_service`, importing them at module level in `relationship_service.py` would create a circular import. Use lazy imports inside the function body:

```python
# Inside sync_relationships_for_entity, at the top of the affected_targets block:
from services.bookmark_service import BookmarkService
from services.note_service import NoteService
from services.prompt_service import PromptService
from services.history_service import history_service

_entity_services = {
    EntityType.BOOKMARK: BookmarkService(),
    EntityType.NOTE: NoteService(),
    EntityType.PROMPT: PromptService(),
}
```

**Architectural tradeoff:** Milestone 2 intentionally centralizes history orchestration in `relationship_service` (with lazy imports) despite the added coupling to peer entity services. The alternative — duplicating the diff-based target logic across 3 caller services — is worse: `sync_relationships_for_entity` already knows which targets were affected from the diff, and pushing that knowledge out to callers would mean each caller reconstructing the same information. The lazy import breaks the cycle cleanly, and `sync_relationships_for_entity` is not called in a tight loop where import overhead matters.

#### Callers: `note_service.py`, `bookmark_service.py`, `prompt_service.py`

**Update all 6 call sites** to pass `context` and `limits`. All three services have both values in their `create` and `update` method signatures. Example from `note_service.py` `update` (line ~243):

```python
await relationship_service.sync_relationships_for_entity(
    db, user_id, self.entity_type, note.id, data.relationships,
    skip_missing_targets=(action == ActionType.RESTORE),
    max_per_entity=limits.max_relationships_per_entity if limits else None,
    context=context,   # ADD
    limits=limits,     # ADD
)
```

All 6 call sites:
- `note_service.py`: `create` (~line 155) and `update` (~line 243)
- `bookmark_service.py`: `create` (~line 228) and `update` (~line 324)
- `prompt_service.py`: `create` (~line 285) and `update` (~line 401)

### Testing Strategy

Tests go in `backend/tests/api/test_relationships.py`.

**Target `updated_at` bump via inline sync (3 tests):**
- `test__api_update_note_with_relationships__bumps_target_updated_at` -- `PATCH /notes/{id}` with a new relationship bumps the target entity's `updated_at`. Create Note A and Note B, record Note B's `updated_at`, then update Note A with `relationships: [{target_type: "note", target_id: B.id}]`. Verify Note B's `updated_at` increased.
- `test__api_update_note_remove_relationship__bumps_target_updated_at` -- Same as above but for removing a relationship. Create the relationship first, then update Note A with `relationships: []` to remove it. Verify Note B's `updated_at` increased.
- `test__api_update_bookmark_with_relationships__bumps_target_updated_at` -- Same pattern but via `PATCH /bookmarks/{id}` to confirm the sync path works across entity types, not just notes.

**Target history via inline sync (2 tests):**
- `test__api_update_note_with_relationships__records_history_on_target` -- `PATCH /notes/{id}` with a new relationship records a history entry on the target entity with `changed_fields=["relationships"]`.
- `test__api_update_note_remove_relationship__records_history_on_target` -- Removing a relationship via inline sync records history on the target.

**No-op sync doesn't bump (1 test):**
- `test__api_update_note_with_same_relationships__does_not_bump_target` -- If the relationship set hasn't changed, target `updated_at` should not be bumped and no history should be recorded. Create Note A linked to Note B, then update Note A with the same `relationships` list. Verify Note B's `updated_at` is unchanged and no new history entry exists.

**Restore removes relationship and bumps other side (2 tests):**
- `test__api_restore_version__bumps_target_updated_at_on_relationship_remove` -- Create Bookmark with a relationship to Note. Update Bookmark (new version without the relationship). Restore Bookmark to version 1 (re-adds relationship). Verify Note's `updated_at` increased. Then update Bookmark again to remove the relationship and restore to version 2 (which has no relationship). Verify Note's `updated_at` increased again.
- `test__api_restore_version__records_history_on_target_for_relationship_change` -- Same setup: restore removes a relationship. Verify the target entity (Note) gets a history entry with `changed_fields=["relationships"]`.

**HTTP cache regression for inline path (1 test):**
- `test__api_update_note_with_relationships__invalidates_target_http_cache` -- `GET /notes/{target_id}/metadata` with `If-Modified-Since` returns 200 (not 304) after the source note is updated with a new relationship to the target. Use `~1.1s` delay for second-precision boundary.

### Verification

```bash
cd backend && python -m pytest tests/api/test_relationships.py -x -v
cd backend && python -m pytest --tb=short  # full suite for regressions
```

---

## Milestone 3: Permanent Delete Cascade

### Goal & Outcome

Fix `delete_relationships_for_content` so that when an entity is permanently deleted, the *other* entities that were linked to it get their `updated_at` bumped. No history should be recorded on the surviving entities — the deleted entity is gone and the relationship cannot be restored, so a history entry would create a misleading version.

After this milestone:
- Permanently deleting Note A (which is linked to Note B) bumps Note B's `updated_at`
- Note B's HTTP cache is invalidated (Safari serves fresh data without the dead link)
- No spurious history entry is created on Note B (nothing to restore)
- All three relationship mutation paths consistently invalidate caches

### Implementation Outline

#### `backend/src/services/relationship_service.py`

**Modify `delete_relationships_for_content`** (line ~333): Use `DELETE ... RETURNING` to atomically delete relationships and identify affected surviving entities in a single statement, then bump their `updated_at`.

The current function uses a bulk `DELETE ... WHERE` which is efficient but doesn't tell us which entities were affected. Using `RETURNING` couples the delete and the affected-entity identification into one atomic statement, avoiding a READ COMMITTED snapshot mismatch where a separate SELECT and DELETE could see different rows.

```python
async def delete_relationships_for_content(
    db: AsyncSession,
    user_id: UUID,
    content_type: str,
    content_id: UUID,
) -> int:
    """
    Delete all relationships where this content is source OR target.

    Called when content is permanently deleted (application-level cascade).
    Bumps updated_at on the surviving entities so their HTTP caches are
    invalidated. No history is recorded — the deleted entity is gone and
    the relationship cannot be restored.

    Returns the count of deleted relationships.
    """
    is_source = and_(
        ContentRelationship.source_type == content_type,
        ContentRelationship.source_id == content_id,
    )
    is_target = and_(
        ContentRelationship.target_type == content_type,
        ContentRelationship.target_id == content_id,
    )

    # DELETE ... RETURNING atomically deletes and returns the affected rows,
    # avoiding READ COMMITTED snapshot mismatch between separate SELECT + DELETE.
    stmt = (
        delete(ContentRelationship)
        .where(
            ContentRelationship.user_id == user_id,
            or_(is_source, is_target),
        )
        .returning(
            ContentRelationship.source_type,
            ContentRelationship.source_id,
            ContentRelationship.target_type,
            ContentRelationship.target_id,
        )
    )
    result = await db.execute(stmt)
    deleted_rows = result.all()

    if not deleted_rows:
        return 0

    # Collect the "other side" entities that survive the delete
    affected: set[tuple[str, UUID]] = set()
    for source_type, source_id, target_type, target_id in deleted_rows:
        if source_type == content_type and source_id == content_id:
            affected.add((target_type, target_id))
        else:
            affected.add((source_type, source_id))

    # Bump updated_at on surviving entities (no history — nothing to restore)
    for entity_type, ids in _group_by_type(affected).items():
        model = MODEL_MAP.get(entity_type)
        if model is None:
            continue
        await db.execute(
            update(model)
            .where(model.id.in_(ids), model.user_id == user_id)
            .values(updated_at=func.clock_timestamp())
        )

    await db.flush()
    return len(deleted_rows)
```

Note: Uses `DELETE ... RETURNING` (PostgreSQL) to atomically couple deletion with affected-entity identification. The bump uses a bulk `UPDATE ... SET updated_at` per entity type (at most 3 statements) rather than loading entities via ORM, since no history recording or eager-loaded attributes are needed — just a timestamp bump. The `_group_by_type` helper groups `set[tuple[str, UUID]]` into `dict[str, set[UUID]]` by entity type.

### Testing Strategy

Tests go in `backend/tests/api/test_relationships.py`.

**`updated_at` bump on surviving entity (1 test):**
- `test__api_permanent_delete__bumps_related_entity_updated_at` -- Create Note A and Note B with a relationship between them. Record Note B's `updated_at`. Soft-delete Note A, then permanently delete Note A. Verify Note B's `updated_at` increased.

**No history on surviving entity (1 test):**
- `test__api_permanent_delete__does_not_record_history_on_related_entity` -- Same setup. Verify Note B's history count does not increase after the permanent delete (no `changed_fields=["relationships"]` entry).

**HTTP cache invalidation (1 test):**
- `test__api_permanent_delete__invalidates_related_entity_http_cache` -- Create Note A linked to Note B. GET Note B's metadata to capture `Last-Modified`. Wait >1s, then permanently delete Note A. GET Note B's metadata with `If-Modified-Since` — should return 200, not 304.

**Multiple surviving entities (1 test):**
- `test__api_permanent_delete__bumps_all_related_entities` -- Create Note A linked to both Note B and Bookmark C. Permanently delete Note A. Verify both Note B and Bookmark C have their `updated_at` bumped.

### Verification

```bash
cd backend && python -m pytest tests/api/test_relationships.py -x -v
cd backend && python -m pytest --tb=short  # full suite for regressions
```
