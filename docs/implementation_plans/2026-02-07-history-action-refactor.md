# History Action Type Refactor

## Overview

Refactor the content versioning system to clearly separate content-changing actions from lifecycle state transitions. This improves the semantic clarity of version history and reduces unnecessary storage.

**Problem:**
- `RESTORE` action conflates two concepts: "undelete a soft-deleted entity" vs "revert to a previous version"
- Lifecycle actions (DELETE/RESTORE/ARCHIVE/UNARCHIVE) store metadata_snapshot unnecessarily
- DELETE stores a full content_snapshot (redundant since soft-deleted entity retains content)
- No way to distinguish "user edited content" from "user reverted to version X"
- Frontend shows restore button on lifecycle actions, which doesn't make sense

**Solution:**
- Rename `RESTORE` → `UNDELETE` (undelete a soft-deleted entity)
- Add `REVERT` action (restore content to a previous version)
- Add `LIFECYCLE` diff type for state transitions (no content or metadata storage)
- Lifecycle actions store only audit trail: source, auth_type, token_prefix
- Frontend disables row selection and restore button for lifecycle actions

## Key Design Decisions

**ActionTypes (revised):**
| Action | Meaning | Stores Content/Diff? |
|--------|---------|---------------------|
| `CREATE` | First version | Yes (snapshot) |
| `UPDATE` | Content or metadata changed | Yes (diff or snapshot) |
| `REVERT` | Restored to previous version | Yes (diff or snapshot) |
| `DELETE` | Soft deleted | No |
| `UNDELETE` | Restored from soft delete | No |
| `ARCHIVE` | Archived | No |
| `UNARCHIVE` | Unarchived | No |

**DiffTypes (revised):**
| Type | content_snapshot | content_diff | metadata_snapshot |
|------|------------------|--------------|-------------------|
| `SNAPSHOT` | Full content | Maybe (dual) | Yes |
| `DIFF` | None | Yes | Yes |
| `METADATA` | None | None | Yes |
| `LIFECYCLE` | None | None | **No** |

**Modulo 10 edge case:**
Lifecycle actions are checked first in the diff type logic, so they never reach the modulo check. Version numbers still increment (v10 might be an ARCHIVE), but no snapshot is taken. This is fine - periodic snapshots are an optimization, not a correctness requirement.

**Reference documentation:**
- `docs/content-versioning.md` - Current spec (needs updating)
- `backend/src/services/history_service.py` - Core diff logic
- `backend/src/models/content_history.py` - ActionType and DiffType enums

---

## Milestone 1: Backend Enum and Model Changes

### Goal
Update ActionType and DiffType enums, and modify history_service to handle lifecycle actions with no content/metadata storage.

### Success Criteria
- `RESTORE` renamed to `UNDELETE` in ActionType enum
- `REVERT` added to ActionType enum
- `LIFECYCLE` added to DiffType enum
- Lifecycle actions (DELETE/UNDELETE/ARCHIVE/UNARCHIVE) create records with:
  - `diff_type = LIFECYCLE`
  - `content_snapshot = None`
  - `content_diff = None`
  - `metadata_snapshot = None` (or empty dict if column is NOT NULL)
- Content actions (CREATE/UPDATE/REVERT) continue to work as before
- All existing history service tests pass (with updates for renamed action)
- New tests cover lifecycle action storage behavior

### Key Changes

1. **Update `backend/src/models/content_history.py`:**
   - Rename `RESTORE = "restore"` to `UNDELETE = "undelete"` in ActionType
   - Add `REVERT = "revert"` to ActionType
   - Add `LIFECYCLE = "lifecycle"` to DiffType

2. **Update `backend/src/services/history_service.py` `_record_action_impl`:**
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
       # metadata will be set to None/empty below
   elif action_value == ActionType.CREATE.value:
       # ... existing CREATE logic
   # ... rest of existing logic for UPDATE/REVERT
   ```

3. **Update all service files that reference `ActionType.RESTORE`:**
   - `backend/src/services/base_entity_service.py`
   - `backend/src/services/bookmark_service.py`
   - Change `ActionType.RESTORE` → `ActionType.UNDELETE`
   - Change `metadata=self._get_metadata_snapshot(entity)` → `metadata={}` for lifecycle actions

4. **Check if metadata_snapshot column allows NULL:**
   - If NOT NULL, pass `metadata={}` instead of `metadata=None`
   - If nullable, pass `metadata=None`

### Testing Strategy

1. **Unit tests in `test_history_service.py`:**
   - `test__record_action__lifecycle_actions_store_no_content`: Verify DELETE/UNDELETE/ARCHIVE/UNARCHIVE create LIFECYCLE records with no content_snapshot, content_diff, or metadata_snapshot
   - `test__record_action__lifecycle_at_modulo_10_skips_snapshot`: Verify lifecycle action at version 10 doesn't create a snapshot
   - `test__record_action__revert_stores_diff`: Verify REVERT action stores diff like UPDATE
   - Update existing tests that reference `ActionType.RESTORE` → `ActionType.UNDELETE`

2. **Verify reconstruction still works:**
   - Lifecycle records should be skipped during content reconstruction (similar to METADATA)

### Dependencies
None

### Risk Factors
- Database migration may be needed if we need to update existing records (probably not - old "restore" values are valid strings, just different name in code)
- Check if any external code depends on the string value "restore" (MCP servers, frontend)

---

## Milestone 2: Update Entity Services

### Goal
Update all entity services to pass empty/null metadata for lifecycle actions and use the new UNDELETE action type.

### Success Criteria
- All lifecycle action calls pass `metadata={}` or `metadata=None`
- `restore()` method in base_entity_service uses `ActionType.UNDELETE`
- `soft_delete()`, `archive()`, `unarchive()` pass empty metadata
- Existing service tests pass with updated assertions

### Key Changes

1. **Update `backend/src/services/base_entity_service.py`:**
   - `soft_delete()`: Change `metadata=self._get_metadata_snapshot(entity)` → `metadata={}`
   - `restore()`: Change `ActionType.RESTORE` → `ActionType.UNDELETE`, change metadata → `{}`
   - `archive()`: Change metadata → `{}`
   - `unarchive()`: Change metadata → `{}`

2. **Update `backend/src/services/bookmark_service.py`:**
   - `restore()` override: Change `ActionType.RESTORE` → `ActionType.UNDELETE`, change metadata → `{}`

3. **Add `REVERT` action support to entity update methods:**
   - Add optional `action: ActionType = ActionType.UPDATE` parameter to update methods
   - Or create separate method that the revert endpoint will call

### Testing Strategy

1. **Update existing service tests:**
   - Verify lifecycle actions create LIFECYCLE diff_type records
   - Verify metadata_snapshot is empty/null for lifecycle actions
   - Verify UNDELETE action is recorded (not RESTORE)

### Dependencies
Milestone 1 (enum changes)

### Risk Factors
- Need to update all three entity services (note, bookmark, prompt) consistently

---

## Milestone 3: Update Revert Endpoint

### Goal
Modify the revert endpoint to record REVERT action instead of UPDATE when restoring to a previous version.

### Success Criteria
- Reverting to a previous version creates a REVERT action in history
- If entity was soft-deleted, creates UNDELETE then REVERT (two records)
- Content reconstruction and diff storage work correctly for REVERT
- Existing revert tests pass with updated assertions

### Key Changes

1. **Update `backend/src/api/routers/history.py` `revert_to_version()`:**
   - Pass action type to service.update() or call a dedicated revert method
   - Ensure REVERT action is recorded

2. **Update entity service update methods** (if not done in Milestone 2):
   - Accept optional `action` parameter
   - Default to UPDATE, but revert endpoint passes REVERT

### Testing Strategy

1. **Router tests:**
   - `test__revert_to_version__records_revert_action`: Verify REVERT action is created
   - `test__revert_soft_deleted__records_undelete_then_revert`: Verify both actions are created
   - Update existing revert tests for new action type

2. **Integration test:**
   - Create entity, update twice, revert to v1
   - Verify history shows: CREATE, UPDATE, UPDATE, REVERT
   - Verify v4 (REVERT) content matches v1

### Dependencies
Milestone 2 (service updates)

### Risk Factors
- Need to ensure REVERT is treated same as UPDATE for diff/snapshot logic

---

## Milestone 4: Frontend Updates

### Goal
Update frontend to handle new action types and disable interaction for lifecycle actions.

### Success Criteria
- `HistoryActionType` type includes `revert` and `undelete`, removes `restore`
- `formatAction()` displays correct labels for all action types
- Lifecycle action rows (DELETE/UNDELETE/ARCHIVE/UNARCHIVE) are not selectable OR show informational message instead of diff
- No restore button shown for lifecycle actions
- REVERT actions show diff and restore button like UPDATE

### Key Changes

1. **Update `frontend/src/types/index.ts`:**
   ```typescript
   export type HistoryActionType =
     | 'create'
     | 'update'
     | 'revert'      // New
     | 'delete'
     | 'undelete'    // Renamed from 'restore'
     | 'archive'
     | 'unarchive'
   ```

2. **Update `frontend/src/components/HistorySidebar.tsx`:**
   - Update `formatAction()` labels:
     ```typescript
     const labels: Record<HistoryActionType, string> = {
       create: 'Created',
       update: 'Updated',
       revert: 'Reverted',     // New
       delete: 'Deleted',
       undelete: 'Undeleted',  // Renamed
       archive: 'Archived',
       unarchive: 'Unarchived',
     }
     ```
   - Add helper to check if action is lifecycle:
     ```typescript
     const isLifecycleAction = (action: HistoryActionType): boolean =>
       ['delete', 'undelete', 'archive', 'unarchive'].includes(action)
     ```
   - Disable row selection for lifecycle actions OR show different UI when selected
   - Hide restore button for lifecycle actions

3. **Update `frontend/src/pages/settings/SettingsVersionHistory.tsx`:**
   - Update `formatAction()` with same labels
   - Apply same lifecycle action logic

4. **Decide on UX for lifecycle rows:**
   - Option A: Make rows non-clickable (gray them out slightly)
   - Option B: Allow click but show message like "This is a state change - no content diff available"

   Recommend Option B for better UX - users can still see the record details.

### Testing Strategy

1. **Component tests:**
   - Verify formatAction returns correct labels for all action types
   - Verify lifecycle actions don't show restore button
   - Verify lifecycle actions show appropriate message instead of diff
   - Verify REVERT actions show diff and restore button

2. **Type tests:**
   - Verify HistoryActionType includes all new values

### Dependencies
Milestone 3 (backend changes complete)

### Risk Factors
- Need to coordinate frontend type changes with backend API changes
- May need to handle both old ("restore") and new ("undelete") values during transition

---

## Milestone 5: Update Spec and Documentation

### Goal
Update content-versioning.md spec to reflect all changes.

### Success Criteria
- ActionType table updated with REVERT and UNDELETE
- DiffType table updated with LIFECYCLE
- DELETE section updated to reflect no content storage
- Lifecycle actions section explains audit-only purpose
- Reconstruction algorithm notes that LIFECYCLE records are skipped

### Key Changes

1. **Update `docs/content-versioning.md`:**
   - Update Actions Tracked table
   - Update Diff Types table
   - Rewrite DELETE section (no longer stores content)
   - Add section explaining LIFECYCLE diff type
   - Update reconstruction algorithm (skip LIFECYCLE like METADATA)

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
| 1 | Backend enums and history_service | Add REVERT, rename RESTORE→UNDELETE, add LIFECYCLE diff type |
| 2 | Entity services | Update lifecycle action calls to pass empty metadata |
| 3 | Revert endpoint | Record REVERT action instead of UPDATE |
| 4 | Frontend | Handle new action types, disable interaction for lifecycle actions |
| 5 | Documentation | Update spec to reflect all changes |

Total: 5 milestones. Each milestone should be reviewed before proceeding to the next.
