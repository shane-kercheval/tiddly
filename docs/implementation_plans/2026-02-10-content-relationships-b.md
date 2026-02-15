# Plan: Relationships Follow Tag Save Lifecycle

## Context

Content relationships (links between bookmarks, notes, prompts) currently use immediate CRUD - clicking "add link" or "remove link" fires API calls instantly without requiring a save. Tags, by contrast, are buffered locally and included in the entity save payload. This inconsistency means:
1. Links don't require saving the page (tags do)
2. Link changes aren't tracked in content history (tag changes are)

**Goal:** Make links behave identically to tags - buffered locally, saved with the entity, and tracked in the metadata history snapshot. Standalone endpoints (used by MCP) should also record history.

---

## Milestone 1: Backend Schema + Sync Function

### 1a. Add `RelationshipInput` schema

`backend/src/schemas/relationship.py` - New Pydantic model for relationship data in entity payloads:

```python
class RelationshipInput(BaseModel):
    target_type: Literal['bookmark', 'note', 'prompt']
    target_id: UUID
    relationship_type: Literal['related'] = 'related'
    description: str | None = None
    # Reuse existing validate_relationship_description validator
```

The saving entity is the implicit source; only target is specified (like how tags are just strings).

### 1b. Add `relationships` to entity Create/Update schemas

Files: `backend/src/schemas/bookmark.py`, `note.py`, `prompt.py`

- Create schemas: `relationships: list[RelationshipInput] = Field(default_factory=list)`
- Update schemas: `relationships: list[RelationshipInput] | None = None` (None = no change, [] = clear all)

Follows the exact tag pattern.

### 1c. Add service functions to `relationship_service.py`

`backend/src/services/relationship_service.py`:

**`get_relationships_snapshot()`** - Returns a stable, sorted list of dicts representing relationships from the entity's perspective. For metadata history:
```python
[{"target_type": "note", "target_id": "uuid-str", "relationship_type": "related", "description": "..."}]
```

Uses a single efficient `SELECT` query (no pagination, no `COUNT(*)`) since we need all relationships for the snapshot. Each returned row must resolve perspective — the querying entity may be stored as either source or target due to canonical ordering:
```python
for rel in rows:
    if rel.source_type == entity_type and rel.source_id == entity_id:
        other = (rel.target_type, rel.target_id)
    else:
        other = (rel.source_type, rel.source_id)
```
Results are sorted deterministically for stable before/after comparison.

**`sync_relationships_for_entity()`** - Computes diff between current relationships and desired set, performs creates/deletes:
1. Fetch current relationships (single SELECT, no pagination)
2. Resolve perspective for each row (same canonical ordering logic as snapshot)
3. Build key sets: `(target_type, target_id, rel_type)`
4. `to_add = desired - current`, `to_remove = current - desired`
5. Create new relationships using existing `create_relationship()` — catch `ContentNotFoundError` per-item and skip (graceful handling for restore where targets may have been permanently deleted)
6. Delete removed relationships using existing `delete_relationship()`
7. Update descriptions for items in both sets if description changed

---

## Milestone 2: Wire Relationships into Entity Service

### 2a. Make `_get_metadata_snapshot()` async in `base_entity_service.py`

The method now does I/O (fetching relationships from the database), so it should be async. Change signature to:
```python
async def _get_metadata_snapshot(self, db: AsyncSession, user_id: UUID, entity: T) -> dict:
```

Internally calls `get_relationships_snapshot()` to fetch and include relationships. `self.entity_type` (class attribute) and `entity.id` provide the query parameters. Subclass overrides (`bookmark_service`, `prompt_service`) call `await super()._get_metadata_snapshot(db, user_id, entity)` and add entity-specific fields.

All existing call sites in `create()` and `update()` methods across the 3 entity services update to `await`.

### 2b. Update entity `create()` methods

After entity creation and tag assignment (entity must exist for relationship validation):
1. Sync relationships via `sync_relationships_for_entity()`
2. Call `await self._get_metadata_snapshot(db, user_id, entity)` — it fetches the relationship snapshot internally

Files: `bookmark_service.py`, `note_service.py`, `prompt_service.py`

### 2c. Update entity `update()` methods

Follow the tag handling pattern:
1. Pop `relationships` from `update_data`
2. `previous_metadata = await self._get_metadata_snapshot(db, user_id, entity)` (fetches relationships internally)
3. Apply field changes, tag sync, then relationship sync
4. `current_metadata = await self._get_metadata_snapshot(db, user_id, entity)` (fetches updated relationships)
5. Compare and record history (existing `metadata_changed` check catches relationship changes)

Files: `bookmark_service.py`, `note_service.py`, `prompt_service.py`

---

## Milestone 3: Standalone Endpoints Record History

When relationships are created/deleted through standalone endpoints (used by MCP), record history on affected entities.

### 3a. Add history recording helper

`backend/src/api/routers/relationships.py` - Add a helper that, given an entity (type + id), snapshots current metadata + relationships and records a metadata-only history entry.

For all standalone operations, record history on the saving/acting entity only (consistent with entity save flow and tag pattern):

- `POST /relationships/` (create): Record history on the source entity as specified by the caller.
- `DELETE /relationships/{id}` (delete): Fetch the relationship before deleting. Record history on the canonical source entity (as stored in DB).

These are metadata-only history entries (no content change). The standalone endpoints need access to the entity services (for `_get_metadata_snapshot`) and the history service.

### 3b. Wire into router handlers

Add `X-Request-Source` header extraction and `RequestContext` construction in the relationship router (following the pattern in bookmarks/notes/prompts routers).

---

## Milestone 4: History Restore Handles Relationships

`backend/src/api/routers/history.py` - `_build_update_from_history()`:

Add:
```python
if "relationships" in metadata:
    common_fields["relationships"] = [
        RelationshipInput(**rel) for rel in metadata["relationships"]
    ]
```

This means restoring to a historical version also restores the relationship set from that point in time.

**Graceful handling:**
- Missing `"relationships"` key (older snapshots before this feature): skip, preserving current relationships.
- Targets that no longer exist (permanently deleted since the snapshot): `sync_relationships_for_entity` catches `ContentNotFoundError` per-item and skips silently. Restore succeeds with whatever targets still exist.

---

## Milestone 5: Frontend - Refactor LinkedContentChips to Buffered State

### 5a. New types in `frontend/src/types.ts`

```typescript
export interface RelationshipInputPayload {
  target_type: ContentType
  target_id: string
  relationship_type: 'related'
  description?: string | null
}
```

Add `relationships?: RelationshipInputPayload[]` to `BookmarkCreate`, `BookmarkUpdate`, `NoteCreate`, `NoteUpdate`, `PromptCreate`, `PromptUpdate`.

### 5b. Add conversion utilities in `frontend/src/utils/relationships.ts`

- `toRelationshipInputs(rels, selfType, selfId)`: Convert `RelationshipWithContent[]` to `RelationshipInputPayload[]` (resolve canonical ordering to get target perspective)
- `relationshipsEqual(a, b)`: Compare two `RelationshipInputPayload[]` by sorting and comparing target_type + target_id

### 5c. Refactor `LinkedContentChips`

**Remove:** `useContentRelationships` query hook, `useRelationshipMutations` mutation hooks, toast notifications for immediate errors.

**New props:**
```typescript
interface LinkedContentChipsProps {
  contentType: ContentType
  contentId: string | null    // null in create mode
  items: LinkedItem[]         // display data (resolved from parent)
  onAdd: (item: ContentListItem) => void    // buffer an add
  onRemove: (item: LinkedItem) => void      // buffer a remove
  onNavigate?: (item: LinkedItem) => void
  disabled?: boolean
  showAddButton?: boolean
}
```

The component becomes a **stateless display + search** component. It renders `items`, handles the inline search UI, and calls `onAdd`/`onRemove` callbacks. No API calls.

The parent (Bookmark.tsx, etc.) owns the relationship state and provides the display items.

### 5d. Wire into entity components

`Bookmark.tsx`, `Note.tsx`, `Prompt.tsx`:

**State:** Add `relationships: RelationshipInputPayload[]` to entity state (e.g., `BookmarkState`). Initialize from `bookmark.relationships` using `toRelationshipInputs()`.

**Display items:** Derive `linkedItems: LinkedItem[]` from the state. For items that existed in `initialRelationships`, use the enriched data (titles, archived/deleted flags). For newly added items (from search results), cache the display info in a `Map<string, LinkedItem>` (ref or state).

**isDirty:** Add `!relationshipsEqual(current.relationships, original.relationships)` to the dirty check.

**buildUpdates:** Include `relationships` in the update payload if changed.

**handleSubmit (create):** Include `relationships` in the create payload.

**syncStateFromBookmark:** Include relationships in the state sync (after save, server response has fresh relationships).

**onAdd callback:** Append to `current.relationships` and cache the `LinkedItem` display info from the search result.

**onRemove callback:** Filter from `current.relationships`.

---

## Milestone 6: Backend Tests

- `sync_relationships_for_entity`: adds, removes, no-op, mixed, validates targets, updates descriptions
- `sync_relationships_for_entity`: skips nonexistent targets gracefully (ContentNotFoundError caught per-item)
- `get_relationships_snapshot`: correct perspective when entity is on target side of canonical pair (e.g., note linked to bookmark where `bookmark < note` lexicographically)
- `get_relationships_snapshot`: sorted, stable, efficient (no COUNT query)
- Entity update with relationships: sync works, `None` = no change, `[]` clears all, history recorded, metadata-only change creates versioned entry
- Entity create with relationships: included in CREATE history
- Standalone POST: history recorded on source entity only (counterpart does NOT get history)
- Standalone DELETE: history recorded on canonical source entity only
- History restore with relationships: restores relationship set from snapshot
- History restore with deleted targets: succeeds, skips missing targets
- Backward compat: older metadata snapshots without `relationships` key handled gracefully

Files: `test_relationship_service.py`, `test_bookmarks.py`, `test_notes.py`, `test_prompts.py`, `test_relationships.py`

---

## Milestone 7: Frontend Tests

- LinkedContentChips: `onAdd` called on search selection, `onRemove` called on X click, no API calls, displays items correctly
- Entity components: relationships included in isDirty, buildUpdates, create payload, state sync
- Conversion utilities: `toRelationshipInputs`, `relationshipsEqual`

Files: `LinkedContentChips.test.tsx`, `useRelationships.test.tsx` (may need significant updates), entity component tests

---

## Milestone 8: Cleanup

- Remove `useRelationshipMutations` from `useRelationships.ts` (no longer needed for frontend - mutations go through entity save)
- Keep `useContentRelationships` query hook if still used anywhere, otherwise remove
- Keep standalone GET endpoint (`/relationships/content/{type}/{id}`) - still useful for queries
- Update MCP `create_relationship` tool: no changes needed (it already calls `POST /relationships/` which will now record history per Milestone 3)

---

## Key Files

| File | Changes |
|------|---------|
| `backend/src/schemas/relationship.py` | Add `RelationshipInput` |
| `backend/src/schemas/bookmark.py` | Add `relationships` to Create/Update |
| `backend/src/schemas/note.py` | Add `relationships` to Create/Update |
| `backend/src/schemas/prompt.py` | Add `relationships` to Create/Update |
| `backend/src/services/relationship_service.py` | Add `sync_relationships_for_entity`, `get_relationships_snapshot` |
| `backend/src/services/base_entity_service.py` | Make `_get_metadata_snapshot` async, add db/user_id params |
| `backend/src/services/bookmark_service.py` | Wire relationships into create/update |
| `backend/src/services/note_service.py` | Wire relationships into create/update |
| `backend/src/services/prompt_service.py` | Wire relationships into create/update |
| `backend/src/api/routers/relationships.py` | Add history recording to POST/DELETE |
| `backend/src/api/routers/history.py` | Handle relationships in restore |
| `frontend/src/types.ts` | Add `RelationshipInputPayload`, update Create/Update types |
| `frontend/src/utils/relationships.ts` | Add conversion/comparison utilities |
| `frontend/src/components/LinkedContentChips.tsx` | Refactor to stateless buffered component |
| `frontend/src/components/Bookmark.tsx` | Add relationships to state/dirty/save flow |
| `frontend/src/components/Note.tsx` | Same |
| `frontend/src/components/Prompt.tsx` | Same |
| `frontend/src/hooks/useRelationships.ts` | Remove mutation hooks |

---

## Verification

1. **Backend tests:** `uv run pytest tests/ -x -q` - all pass
2. **Frontend tests:** `cd frontend && npm run test:run` - all pass
3. **Lint:** `make linting` and `cd frontend && npm run lint` - clean
4. **Manual test:**
   - Open a bookmark, add a link, verify page shows as dirty (unsaved)
   - Save, verify link persists and history shows the change
   - Remove a link, verify dirty, save, verify history
   - Use MCP `create_relationship`, verify history entry appears
   - Restore to a version with different links, verify links restored
