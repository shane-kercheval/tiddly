# History Action Type Refactor

## Overview

Refactor the content versioning system to clearly separate content-changing actions from lifecycle state transitions. This improves the semantic clarity of version history and reduces unnecessary storage.

**Problem:**
- Current `RESTORE` action conflates two concepts: "undelete a soft-deleted entity" vs "restore to a previous version"
- Lifecycle actions (DELETE/RESTORE/ARCHIVE/UNARCHIVE) store full metadata_snapshot unnecessarily
- DELETE stores a full content_snapshot (redundant since soft-deleted entity retains content)
- No way to distinguish "user edited content" from "user restored to version X"
- Frontend shows restore button on lifecycle actions, which doesn't make sense

**Solution:**
- Rename current `RESTORE` → `UNDELETE` (undelete a soft-deleted entity)
- Add `RESTORE` action (restore content to a previous version - matches UI "Restore" button)
- Add `LIFECYCLE` diff type for state transitions
- Lifecycle actions store only `{"title": "..."}` for frontend display, plus audit trail (source, auth_type, token_prefix)
- Reconstruction algorithm explicitly skips LIFECYCLE records
- Backend blocks reverting to lifecycle versions (400 error)
- Frontend disables restore button for lifecycle actions

## Key Design Decisions

**ActionTypes (revised):**
| Action | Meaning | Stores Content/Diff? | UI Label |
|--------|---------|---------------------|----------|
| `CREATE` | First version | Yes (snapshot) | "Created" |
| `UPDATE` | Content or metadata changed | Yes (diff or snapshot) | "Updated" |
| `RESTORE` | Restored to previous version | Yes (diff or snapshot) | "Restored" |
| `DELETE` | Soft deleted | No | "Deleted" |
| `UNDELETE` | Un-deleted (was soft-deleted) | No | "Undeleted" |
| `ARCHIVE` | Archived | No | "Archived" |
| `UNARCHIVE` | Unarchived | No | "Unarchived" |

**DiffTypes (revised):**
| Type | content_snapshot | content_diff | metadata_snapshot |
|------|------------------|--------------|-------------------|
| `SNAPSHOT` | Full content | Maybe (dual) | Full |
| `DIFF` | None | Yes | Full |
| `METADATA` | None | None | Full |
| `LIFECYCLE` | None | None | `{"title": "..."}` only |

**Naming rationale:**
- `RESTORE` matches the UI "Restore" button in HistorySidebar
- `UNDELETE` clearly means "undo deletion" (internal operation)

**Reconstruction behavior:**
- LIFECYCLE records are **completely skipped** during content reconstruction
- They are not part of the content chain - just audit events
- Backend returns 400 if attempting to revert TO a lifecycle version

**Modulo 10 edge case:**
Lifecycle actions are checked first in the diff type logic, so they never reach the modulo check. Version numbers still increment (v10 might be an ARCHIVE), but no snapshot is taken. This is fine - periodic snapshots are an optimization, not a correctness requirement.

**Reference documentation:**
- `docs/content-versioning.md` - Current spec (needs updating)
- `backend/src/services/history_service.py` - Core diff logic
- `backend/src/models/content_history.py` - ActionType and DiffType enums

---

## Milestone 1: Backend Enum, Model, and Migration

### Goal
Update ActionType and DiffType enums, modify history_service to handle lifecycle actions, and create database migration for existing records.

### Success Criteria
- Current `RESTORE` renamed to `UNDELETE` in ActionType enum
- New `RESTORE` added to ActionType enum (for restoring to previous version)
- `LIFECYCLE` added to DiffType enum
- Lifecycle actions (DELETE/UNDELETE/ARCHIVE/UNARCHIVE) create records with:
  - `diff_type = LIFECYCLE`
  - `content_snapshot = None`
  - `content_diff = None`
  - `metadata_snapshot = {"title": "..."}` (title only for frontend display)
- Reconstruction algorithm explicitly filters out LIFECYCLE records
- Database migration updates existing `action = 'restore'` rows to `action = 'undelete'`
- All existing history service tests pass (with updates for renamed action)
- New tests cover lifecycle action storage and reconstruction behavior

### Key Changes

1. **Update `backend/src/models/content_history.py`:**
   - Rename `RESTORE = "restore"` to `UNDELETE = "undelete"` in ActionType
   - Add `RESTORE = "restore"` to ActionType (new - for version restoration)
   - Add `LIFECYCLE = "lifecycle"` to DiffType

2. **Create database migration using `make migration message="rename restore to undelete"`:**
   - **IMPORTANT**: Always use `make migration` command, never generate migrations manually
   - Migration should update existing rows: `UPDATE content_history SET action = 'undelete' WHERE action = 'restore'`

3. **Update `backend/src/services/history_service.py` `_record_action_impl`:**
   ```python
   # Check lifecycle actions FIRST - before any content logic
   if action_value in (
       ActionType.DELETE.value,
       ActionType.UNDELETE.value,
       ActionType.ARCHIVE.value,
       ActionType.UNARCHIVE.value,
   ):
       diff_type = DiffType.LIFECYCLE
       content_snapshot = None
       content_diff = None
       # metadata is passed in - services will pass {"title": "..."} only
   elif action_value == ActionType.CREATE.value:
       # ... existing CREATE logic
   # ... rest of existing logic for UPDATE/RESTORE
   ```

4. **Update reconstruction in `reconstruct_content_at_version`:**
   ```python
   # Filter out LIFECYCLE records - they're not part of the content chain
   records_to_traverse = [r for r in records if r.diff_type != DiffType.LIFECYCLE.value]
   ```

5. **Add helper method for lifecycle metadata:**
   ```python
   def _get_lifecycle_metadata(self, entity: T) -> dict:
       """Get minimal metadata for lifecycle actions (title only for display)."""
       return {"title": getattr(entity, "title", None)}
   ```

### Testing Strategy

1. **Unit tests in `test_history_service.py`:**
   - `test__record_action__lifecycle_actions_store_title_only`: Verify DELETE/UNDELETE/ARCHIVE/UNARCHIVE create LIFECYCLE records with only title in metadata_snapshot
   - `test__record_action__lifecycle_at_modulo_10_skips_snapshot`: Verify lifecycle action at version 10 doesn't create a snapshot
   - `test__record_action__restore_stores_diff`: Verify RESTORE action stores diff like UPDATE
   - `test__reconstruct__skips_lifecycle_records`: Verify reconstruction filters out LIFECYCLE records from the chain
   - `test__reconstruct__with_lifecycle_in_chain`: Create v1, UPDATE v2, ARCHIVE v3, UPDATE v4 - verify reconstructing v2 works correctly (skips v3)
   - Update existing tests that reference `ActionType.RESTORE` → `ActionType.UNDELETE`

2. **Migration test:**
   - Verify existing `action = 'restore'` rows are updated to `action = 'undelete'`

### Dependencies
None

### Risk Factors
- Ensure the new `RESTORE` action value doesn't conflict (it uses string "restore" which was freed up by renaming to "undelete")

---

## Milestone 2: Update Entity Services

### Goal
Update all entity services to pass title-only metadata for lifecycle actions, use the new UNDELETE action type, and add action parameter to update methods.

### Success Criteria
- All lifecycle action calls pass `metadata={"title": entity.title}`
- `restore()` method in base_entity_service uses `ActionType.UNDELETE`
- `soft_delete()`, `archive()`, `unarchive()` pass title-only metadata
- Update methods accept optional `action` parameter (defaults to UPDATE)
- Existing service tests pass with updated assertions

### Key Changes

1. **Add helper to `backend/src/services/base_entity_service.py`:**
   ```python
   def _get_lifecycle_metadata(self, entity: T) -> dict:
       """Get minimal metadata for lifecycle actions (title only for display)."""
       return {"title": getattr(entity, "title", None)}
   ```

2. **Update lifecycle methods in `base_entity_service.py`:**
   - `soft_delete()`: Change `metadata=self._get_metadata_snapshot(entity)` → `metadata=self._get_lifecycle_metadata(entity)`
   - `restore()`: Change `ActionType.RESTORE` → `ActionType.UNDELETE`, change metadata → `self._get_lifecycle_metadata(entity)`
   - `archive()`: Change metadata → `self._get_lifecycle_metadata(entity)`
   - `unarchive()`: Change metadata → `self._get_lifecycle_metadata(entity)`

3. **Update `backend/src/services/bookmark_service.py`:**
   - `restore()` override: Change `ActionType.RESTORE` → `ActionType.UNDELETE`, change metadata → `self._get_lifecycle_metadata(bookmark)`

4. **Add action parameter to update methods** (note_service, bookmark_service, prompt_service):
   ```python
   async def update(
       self,
       db: AsyncSession,
       user_id: UUID,
       entity_id: UUID,
       data: EntityUpdate,
       limits: TierLimits,
       context: RequestContext | None = None,
       action: ActionType = ActionType.UPDATE,  # New parameter
   ) -> Entity | None:
       # ... existing logic ...
       if context and (content_changed or metadata_changed):
           await self._get_history_service().record_action(
               # ...
               action=action,  # Use parameter instead of hardcoded UPDATE
               # ...
           )
   ```

### Testing Strategy

1. **Update existing service tests:**
   - Verify lifecycle actions create LIFECYCLE diff_type records
   - Verify metadata_snapshot contains only `{"title": "..."}` for lifecycle actions
   - Verify UNDELETE action is recorded (not RESTORE)
   - Verify update() with `action=ActionType.RESTORE` records RESTORE action

### Dependencies
Milestone 1 (enum changes and migration)

### Risk Factors
- Need to update all three entity services (note, bookmark, prompt) consistently
- Prompt service may need special handling if it has additional lifecycle methods

---

## Milestone 3: Update Revert Endpoint

### Goal
Modify the revert endpoint to record RESTORE action and block reverting to lifecycle versions.

### Success Criteria
- Reverting to a previous version creates a RESTORE action in history
- If entity was soft-deleted, creates UNDELETE then RESTORE (two records)
- Attempting to revert to a LIFECYCLE version returns 400 error
- Content reconstruction and diff storage work correctly for RESTORE
- Existing revert tests pass with updated assertions

### Key Changes

1. **Update `backend/src/api/routers/history.py` `revert_to_version()`:**

   Add check to block reverting to lifecycle versions:
   ```python
   # Get the target version's history record
   target_history = await history_service.get_history_at_version(
       db, current_user.id, entity_type, entity_id, version,
   )
   if target_history is None:
       raise HTTPException(status_code=404, detail="Version not found")

   # Block reverting to lifecycle versions
   if target_history.diff_type == DiffType.LIFECYCLE.value:
       raise HTTPException(
           status_code=400,
           detail="Cannot revert to a lifecycle version (delete/undelete/archive/unarchive). "
                  "These are state transitions, not content versions.",
       )
   ```

   Pass RESTORE action to service.update():
   ```python
   await service.update(
       db, current_user.id, entity_id, update_data, limits, context,
       action=ActionType.RESTORE,  # New parameter
   )
   ```

### Testing Strategy

1. **Router tests:**
   - `test__revert_to_version__records_restore_action`: Verify RESTORE action is created (not UPDATE)
   - `test__revert_soft_deleted__records_undelete_then_restore`: Verify both actions are created in order
   - `test__revert_to_lifecycle_version__returns_400`: Verify reverting to DELETE/ARCHIVE/etc. version fails
   - Update existing revert tests for new action type

2. **Integration test:**
   - Create entity, update twice, revert to v1
   - Verify history shows: CREATE, UPDATE, UPDATE, RESTORE
   - Verify v4 (RESTORE) content matches v1

### Dependencies
Milestone 2 (service updates with action parameter)

### Risk Factors
- Need to ensure RESTORE is treated same as UPDATE for diff/snapshot logic (it should be - both are content-changing actions)

---

## Milestone 4: Frontend Updates

### Goal
Update frontend to handle new action types and disable interaction for lifecycle actions.

### Success Criteria
- `HistoryActionType` type includes `restore` (for version restoration) and `undelete`, removes old `restore` meaning
- `formatAction()` displays correct labels for all action types
- Lifecycle action rows (DELETE/UNDELETE/ARCHIVE/UNARCHIVE) show informational message instead of diff
- No restore button shown for lifecycle actions
- RESTORE actions show diff and restore button like UPDATE

### Key Changes

1. **Update `frontend/src/types/index.ts`:**
   ```typescript
   export type HistoryActionType =
     | 'create'
     | 'update'
     | 'restore'     // Restored to previous version (was 'revert' in earlier plan)
     | 'delete'
     | 'undelete'    // Un-deleted (was 'restore' before)
     | 'archive'
     | 'unarchive'
   ```

2. **Update `frontend/src/components/HistorySidebar.tsx`:**
   - Update `formatAction()` labels:
     ```typescript
     const labels: Record<HistoryActionType, string> = {
       create: 'Created',
       update: 'Updated',
       restore: 'Restored',    // Restored to previous version
       delete: 'Deleted',
       undelete: 'Undeleted',  // Un-deleted
       archive: 'Archived',
       unarchive: 'Unarchived',
     }
     ```
   - Add helper to check if action is lifecycle:
     ```typescript
     const isLifecycleAction = (action: HistoryActionType): boolean =>
       ['delete', 'undelete', 'archive', 'unarchive'].includes(action)
     ```
   - When lifecycle action is selected, show message instead of diff:
     ```typescript
     {isLifecycleAction(entry.action) ? (
       <div className="p-3 text-sm text-gray-500">
         This is a state transition. No content changes to display.
       </div>
     ) : (
       <DiffView ... />
     )}
     ```
   - Hide restore button for lifecycle actions:
     ```typescript
     {entry.version < latestVersion && !isLifecycleAction(entry.action) && (
       <button ...>Restore</button>
     )}
     ```

3. **Update `frontend/src/pages/settings/SettingsVersionHistory.tsx`:**
   - Update `formatAction()` with same labels
   - Apply same lifecycle action logic for row expansion

### Testing Strategy

1. **Component tests:**
   - Verify formatAction returns correct labels for all action types
   - Verify lifecycle actions don't show restore button
   - Verify lifecycle actions show informational message instead of diff when expanded
   - Verify RESTORE actions show diff and restore button

2. **Type tests:**
   - Verify HistoryActionType includes all new values

### Dependencies
Milestone 3 (backend changes complete)

### Risk Factors
- Ensure consistent behavior between HistorySidebar and SettingsVersionHistory

---

## Milestone 5: Update Spec and Documentation

### Goal
Update content-versioning.md spec to reflect all changes.

### Success Criteria
- ActionType table updated with RESTORE (version restoration) and UNDELETE
- DiffType table updated with LIFECYCLE
- DELETE section updated to reflect no content storage (only title in metadata)
- Lifecycle actions section explains audit-only purpose
- Reconstruction algorithm explicitly states LIFECYCLE records are filtered out
- Revert section notes that reverting to lifecycle versions is blocked

### Key Changes

1. **Update `docs/content-versioning.md`:**
   - Update Actions Tracked table
   - Update Diff Types table with LIFECYCLE
   - Rewrite DELETE section (stores only title, no content)
   - Add section explaining LIFECYCLE diff type and its purpose
   - Update reconstruction algorithm to specify filtering out LIFECYCLE records
   - Update revert section to note lifecycle version blocking

2. **Update `CLAUDE.md`** if it references action types

### Testing Strategy
Manual review of documentation for accuracy and completeness.

### Dependencies
Milestones 1-4 (all code changes complete)

### Risk Factors
None

---

## Summary

| Milestone | Scope | Key Changes |
|-----------|-------|-------------|
| 1 | Backend enums, history_service, migration | Add RESTORE, rename old RESTORE→UNDELETE, add LIFECYCLE diff type, update reconstruction to skip lifecycle, create migration |
| 2 | Entity services | Update lifecycle actions to pass title-only metadata, add action parameter to update methods |
| 3 | Revert endpoint | Record RESTORE action, block reverting to lifecycle versions |
| 4 | Frontend | Handle new action types, show message for lifecycle actions, hide restore button |
| 5 | Documentation | Update spec to reflect all changes |

Total: 5 milestones. Each milestone should be reviewed before proceeding to the next.
