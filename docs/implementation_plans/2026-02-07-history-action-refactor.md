# History Action Type Refactor

## Overview

Refactor the content versioning system to clearly separate content-changing actions from audit-only state transitions. This improves the semantic clarity of version history and reduces unnecessary storage.

**Problem:**
- Current `RESTORE` action conflates two concepts: "undelete a soft-deleted entity" vs "restore to a previous version"
- Lifecycle actions (DELETE/RESTORE/ARCHIVE/UNARCHIVE) store full metadata_snapshot unnecessarily
- DELETE stores a full content_snapshot (redundant since soft-deleted entity retains content)
- No way to distinguish "user edited content" from "user restored to version X"
- Frontend shows restore button on lifecycle actions, which doesn't make sense
- Terminology inconsistency: backend uses "revert" but UI shows "Restore"

**Solution:**
- Rename current `RESTORE` → `UNDELETE` (undelete a soft-deleted entity)
- Add `RESTORE` action (restore content to a previous version - matches UI "Restore" button)
- Add `AUDIT` diff type for state transitions (audit trail only, not content versions)
- Audit actions have `version = NULL` (they're not content versions, just audit events)
- Audit actions store minimal identifying metadata (`title`, `name`, `url` - whichever fields exist)
- Reconstruction naturally uses only records with non-null versions
- Backend blocks restoring to audit versions (400 error)
- Frontend displays audit events without version badge, no restore button
- Rename "revert" → "restore" throughout codebase for consistency

## Key Design Decisions

**ActionTypes (revised):**
| Action | Has Version? | Stores Content/Diff? | UI Label |
|--------|-------------|---------------------|----------|
| `CREATE` | Yes (v1) | Yes (snapshot) | "Created" |
| `UPDATE` | Yes | Yes (diff or snapshot) | "Updated" |
| `RESTORE` | Yes | Yes (diff or snapshot) | "Restored" |
| `DELETE` | No (NULL) | No | "Deleted" |
| `UNDELETE` | No (NULL) | No | "Undeleted" |
| `ARCHIVE` | No (NULL) | No | "Archived" |
| `UNARCHIVE` | No (NULL) | No | "Unarchived" |

**DiffTypes (revised):**
| Type | content_snapshot | content_diff | metadata_snapshot |
|------|------------------|--------------|-------------------|
| `SNAPSHOT` | Full content | Maybe (dual) | Full |
| `DIFF` | None | Yes | Full |
| `METADATA` | None | None | Full |
| `AUDIT` | None | None | Identifying fields only (title/name/url) |

**Naming rationale:**
- `RESTORE` matches the UI "Restore" button in HistorySidebar
- `UNDELETE` clearly means "undo deletion" (internal operation)
- `AUDIT` clearly conveys "audit trail for state changes" (not part of content versioning)

**Audit metadata:**
- Store all available identifying fields, not just title
- Returns `{"title": "...", "name": "...", "url": "..."}` with only populated fields included
- Bookmarks: `{"title": "...", "url": "..."}` (or just `{"url": "..."}` if no title)
- Notes: `{"title": "..."}`
- Prompts: `{"title": "...", "name": "..."}` (or just `{"name": "..."}` if no title)
- Frontend can display the best available field

**Null version for audit events:**
- Audit actions (DELETE/UNDELETE/ARCHIVE/UNARCHIVE) have `version = NULL`
- They're audit events, not content versions - incrementing version would be semantically wrong
- Frontend displays them without version badge, just action + timestamp
- Ordered by `created_at` in history list (not by version)
- Cannot restore to NULL version (obvious - no version to restore to)
- Eliminates modulo 10 edge case: version 10 will always be a content action

**Retention and pruning:**
- Audit events do NOT count toward `max_history_per_entity` retention limits
- `max_history_per_entity` applies only to content versions (versioned records)
- Audit events are pruned only by time-based cleanup (`history_retention_days`)
- This makes semantic sense: the limit is about how many content versions to keep, not total audit records

**Reconstruction behavior:**
- Reconstruction naturally uses only records with non-null versions
- AUDIT records are not part of the content chain - just audit events
- Backend returns 400 if attempting to restore TO an audit version (version is NULL anyway)

**Modulo 10 behavior:**
Since audit actions don't increment version, modulo 10 snapshots work naturally on content versions only:
```
CREATE v1 (SNAPSHOT)
UPDATE v2 (DIFF)
ARCHIVE (AUDIT, version=NULL)
UNARCHIVE (AUDIT, version=NULL)
UPDATE v3 (DIFF)
...
UPDATE v10 (SNAPSHOT) ← always a content version
```

**Restore is content-only:**
- RESTORE only changes content - it does NOT modify lifecycle state (deleted_at, archived_at)
- Restoring a soft-deleted entity returns 404 (entity must be undeleted first)
- Restoring an archived entity is allowed (it only changes content, entity stays archived)
- This is consistent with audit versions being non-restorable: RESTORE operates on content, not state

**Historical data:**
- This refactor has not been deployed to production; there are no external users
- Existing lifecycle records (if any in dev databases) retain their old format with version numbers
- No backfill migration is needed - we can make breaking changes freely
- New lifecycle records will use the new AUDIT format with NULL versions

**Reference documentation:**
- `docs/content-versioning.md` - Current spec (needs updating)
- `backend/src/services/history_service.py` - Core diff logic
- `backend/src/models/content_history.py` - ActionType and DiffType enums

---

## Milestone 1: Backend Enum, Model, Schema, and Migration

### Goal
Update ActionType and DiffType enums, make version nullable, update response schemas, modify history_service to handle audit actions with null version, and create database migration.

### Success Criteria
- Current `RESTORE` renamed to `UNDELETE` in ActionType enum
- New `RESTORE` added to ActionType enum (for restoring to previous version)
- `AUDIT` added to DiffType enum
- `version` column made nullable in content_history table
- `HistoryResponse.version` schema updated to `int | None`
- Audit actions (DELETE/UNDELETE/ARCHIVE/UNARCHIVE) create records with:
  - `version = NULL`
  - `diff_type = AUDIT`
  - `content_snapshot = None`
  - `content_diff = None`
  - `metadata_snapshot = {"title": "...", "name": "...", "url": "..."}` (whichever fields exist)
- Modulo check for pruning skipped when version is NULL (prevents crash)
- Entity history count excludes NULL versions (for retention limit checking)
- Pruning excludes NULL versions (audit events pruned by time only)
- Entity history ordered by `created_at.desc()` (not version)
- Reconstruction uses only records with non-null versions
- Database migration:
  - Updates existing `action = 'restore'` rows to `action = 'undelete'`
  - Makes `version` column nullable
- All existing history service tests pass (with updates for renamed action)
- New tests cover audit action storage and reconstruction behavior

### Key Changes

1. **Update `backend/src/models/content_history.py`:**
   - Rename `RESTORE = "restore"` to `UNDELETE = "undelete"` in ActionType
   - Add `RESTORE = "restore"` to ActionType (new - for version restoration)
   - Add `AUDIT = "audit"` to DiffType
   - Update model: `version: Mapped[int | None]` (make nullable)

2. **Update `backend/src/schemas/history.py`:**
   - Change `version: int` to `version: int | None` in `HistoryResponse`

3. **Create database migration using `make migration message="history action refactor"`:**
   - **IMPORTANT**: Always use `make migration` command, never generate migrations manually
   - Migration should:
     - Update existing rows: `UPDATE content_history SET action = 'undelete' WHERE action = 'restore'`
     - Make version column nullable: `ALTER TABLE content_history ALTER COLUMN version DROP NOT NULL`
   - Note: Unique constraint on (user_id, entity_type, entity_id, version) allows multiple NULLs in PostgreSQL

4. **Update `backend/src/services/history_service.py` `record_action`:**

   Guard the modulo check to prevent crash when version is NULL:
   ```python
   # Count-based pruning: check every 10th write (only for versioned records)
   if limits is not None and history.version is not None and history.version % PRUNE_CHECK_INTERVAL == 0:
       # ... existing pruning logic
   ```

5. **Update `backend/src/services/history_service.py` `_record_action_impl`:**
   ```python
   # Check audit actions FIRST - before any content logic
   if action_value in (
       ActionType.DELETE.value,
       ActionType.UNDELETE.value,
       ActionType.ARCHIVE.value,
       ActionType.UNARCHIVE.value,
   ):
       diff_type = DiffType.AUDIT
       version = None  # Audit events don't get version numbers
       content_snapshot = None
       content_diff = None
       # metadata is passed in - services will pass identifying fields only
   elif action_value == ActionType.CREATE.value:
       # ... existing CREATE logic (version = 1)
   else:
       # UPDATE/RESTORE - increment version as before
       # ... rest of existing logic
   ```

6. **Update `get_entity_history` to order by `created_at`:**
   ```python
   # Order by created_at for chronological display (version ordering breaks with NULLs)
   stmt = (
       select(ContentHistory)
       .where(...)
       .order_by(ContentHistory.created_at.desc())  # Changed from version.desc()
       .offset(offset)
       .limit(limit)
   )
   ```

7. **Update `_get_entity_history_count` to exclude audit events:**
   ```python
   # Only count versioned records for retention limit checking
   stmt = (
       select(func.count())
       .select_from(ContentHistory)
       .where(
           ContentHistory.user_id == user_id,
           ContentHistory.entity_type == entity_type,
           ContentHistory.entity_id == entity_id,
           ContentHistory.version.isnot(None),  # Exclude audit events
       )
   )
   ```

8. **Update `_prune_to_limit` to exclude audit events:**
   ```python
   # Only consider versioned records for pruning (audit events pruned by time only)
   cutoff_stmt = (
       select(ContentHistory.version)
       .where(
           ContentHistory.user_id == user_id,
           ContentHistory.entity_type == entity_type,
           ContentHistory.entity_id == entity_id,
           ContentHistory.version.isnot(None),  # Only versioned records
       )
       .order_by(ContentHistory.version.desc())
       .offset(target - 1)
       .limit(1)
   )
   # ...
   # Delete only versioned records below cutoff
   delete_stmt = delete(ContentHistory).where(
       ContentHistory.user_id == user_id,
       ContentHistory.entity_type == entity_type,
       ContentHistory.entity_id == entity_id,
       ContentHistory.version.isnot(None),  # Only versioned records
       ContentHistory.version < cutoff_version,
   )
   ```

9. **Update reconstruction in `reconstruct_content_at_version`:**
   ```python
   # Filter to only versioned records - audit events have no content
   records_to_traverse = [r for r in records if r.version is not None]
   ```

10. **Update `get_latest_version` to handle null versions:**
    ```python
    # Only consider versioned records for latest version
    result = await db.execute(
        select(func.max(ContentHistory.version))
        .where(ContentHistory.user_id == user_id)
        .where(ContentHistory.entity_type == entity_type)
        .where(ContentHistory.entity_id == entity_id)
        .where(ContentHistory.version.isnot(None))  # Exclude audit events
    )
    ```

### Testing Strategy

1. **Unit tests in `test_history_service.py`:**
   - `test__record_action__audit_actions_have_null_version`: Verify DELETE/UNDELETE/ARCHIVE/UNARCHIVE create records with version=NULL
   - `test__record_action__audit_actions_store_identifying_fields`: Verify AUDIT records have title/name/url as available
   - `test__record_action__audit_doesnt_affect_version_sequence`: Create v1, DELETE (null), UPDATE - verify UPDATE is v2 not v3
   - `test__record_action__audit_skips_prune_check`: Verify audit actions don't trigger modulo check (no crash)
   - `test__record_action__restore_stores_diff`: Verify RESTORE action stores diff like UPDATE and increments version
   - `test__reconstruct__ignores_audit_records`: Verify reconstruction filters out NULL version records
   - `test__reconstruct__with_audit_in_chain`: Create v1, UPDATE v2, ARCHIVE (null), UPDATE v3 - verify reconstructing v2 works correctly
   - `test__get_latest_version__ignores_audit`: Verify latest version ignores NULL version records
   - `test__get_entity_history__orders_by_created_at`: Create v1, DELETE (null), v2 - verify chronological order
   - `test__get_entity_history_count__excludes_audit`: Verify count only includes versioned records
   - `test__prune_to_limit__excludes_audit_records`: Create v1-v5 + 3 audit events, prune to 3, verify only v1-v2 deleted, audit retained
   - Update existing tests that reference `ActionType.RESTORE` → `ActionType.UNDELETE`

2. **Migration test:**
   - Verify existing `action = 'restore'` rows are updated to `action = 'undelete'`
   - Verify version column is nullable

### Dependencies
None

### Risk Factors
- Ensure the new `RESTORE` action value doesn't conflict (it uses string "restore" which was freed up by renaming to "undelete")
- Unique constraint behavior with NULLs (PostgreSQL allows multiple NULLs - this is desired)

---

## Milestone 2: Update Entity Services

### Goal
Update all entity services to pass identifying metadata for audit actions, use the new UNDELETE action type, and add action parameter to update methods.

### Success Criteria
- All audit action calls pass `metadata=self._get_audit_metadata(entity)`
- `restore()` method in base_entity_service uses `ActionType.UNDELETE`
- `soft_delete()`, `archive()`, `unarchive()` pass audit metadata
- Update methods accept optional `action` parameter (defaults to UPDATE)
- Existing service tests pass with updated assertions

### Key Changes

1. **Add helper to `backend/src/services/base_entity_service.py`:**
   ```python
   def _get_audit_metadata(self, entity: T) -> dict:
       """Get minimal metadata for audit actions (identifying fields only).

       Returns all available identifying fields so frontend can display
       the best available option.
       """
       metadata = {}
       for field in ("title", "name", "url"):
           value = getattr(entity, field, None)
           if value is not None:
               metadata[field] = value
       return metadata
   ```

2. **Update lifecycle methods in `base_entity_service.py`:**
   - `soft_delete()`: Change `metadata=self._get_metadata_snapshot(entity)` → `metadata=self._get_audit_metadata(entity)`
   - `restore()`: Change `ActionType.RESTORE` → `ActionType.UNDELETE`, change metadata → `self._get_audit_metadata(entity)`
   - `archive()`: Change metadata → `self._get_audit_metadata(entity)`
   - `unarchive()`: Change metadata → `self._get_audit_metadata(entity)`

3. **Update `backend/src/services/bookmark_service.py`:**
   - `restore()` override: Change `ActionType.RESTORE` → `ActionType.UNDELETE`, change metadata → `self._get_audit_metadata(bookmark)`

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
   - Verify audit actions create AUDIT diff_type records with version=NULL
   - Verify metadata_snapshot contains identifying fields for audit actions
   - `test__get_audit_metadata__bookmark`: Verify bookmark returns title and url
   - `test__get_audit_metadata__note`: Verify note returns title
   - `test__get_audit_metadata__prompt_with_title`: Verify prompt with title returns title and name
   - `test__get_audit_metadata__prompt_without_title`: Verify prompt without title returns just name
   - Verify UNDELETE action is recorded (not RESTORE)
   - Verify update() with `action=ActionType.RESTORE` records RESTORE action with version

### Dependencies
Milestone 1 (enum changes and migration)

### Risk Factors
- Need to update all three entity services (note, bookmark, prompt) consistently
- Prompt service may need special handling if it has additional lifecycle methods

---

## Milestone 3: Rename Revert to Restore and Update Endpoint

### Goal
Rename "revert" terminology to "restore" throughout the codebase, modify the restore endpoint to record RESTORE action, and block restoring to audit versions.

### Success Criteria
- Endpoint renamed: `/history/{type}/{id}/revert/{version}` → `/history/{type}/{id}/restore/{version}`
- Schema renamed: `RevertResponse` → `RestoreResponse`
- Router function renamed: `revert_to_version()` → `restore_to_version()`
- Frontend hook renamed: `useRevertToVersion` → `useRestoreToVersion`
- Restoring to a previous version creates a RESTORE action in history
- Restoring a soft-deleted entity returns 404 (must undelete first)
- Attempting to restore to an audit version (NULL version) returns 400 error
- Content reconstruction and diff storage work correctly for RESTORE
- Existing tests pass with updated names and assertions

### Key Changes

1. **Rename in `backend/src/schemas/history.py`:**
   - `RevertResponse` → `RestoreResponse`

2. **Rename in `backend/src/api/routers/history.py`:**
   - Function: `revert_to_version()` → `restore_to_version()`
   - Route: `@router.post("/{entity_type}/{entity_id}/revert/{version}")` → `@router.post("/{entity_type}/{entity_id}/restore/{version}")`
   - Response model: `RevertResponse` → `RestoreResponse`

   Add check to block restoring to audit versions:
   ```python
   # Get the target version's history record
   target_history = await history_service.get_history_at_version(
       db, current_user.id, entity_type, entity_id, version,
   )
   if target_history is None:
       raise HTTPException(status_code=404, detail="Version not found")

   # Block restoring to audit versions (they have NULL version anyway, but be explicit)
   if target_history.diff_type == DiffType.AUDIT.value:
       raise HTTPException(
           status_code=400,
           detail="Cannot restore to an audit version (delete/undelete/archive/unarchive). "
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

3. **Rename in `frontend/src/hooks/useHistory.ts`:**
   - `useRevertToVersion` → `useRestoreToVersion`
   - Update API endpoint path in the hook

4. **Update all frontend components using the hook:**
   - `HistorySidebar.tsx`: `useRevertToVersion` → `useRestoreToVersion`
   - Any other components using the hook

### Testing Strategy

1. **Router tests:**
   - `test__restore_to_version__records_restore_action`: Verify RESTORE action is created (not UPDATE)
   - `test__restore_to_version__soft_deleted_returns_404`: Verify restoring a soft-deleted entity fails
   - `test__restore_to_audit_version__returns_400`: Verify restoring to DELETE/ARCHIVE/etc. version fails
   - Update existing revert tests: rename to restore, update assertions for new action type

2. **Integration test:**
   - Create entity, update twice, restore to v1
   - Verify history shows: CREATE, UPDATE, UPDATE, RESTORE
   - Verify v4 (RESTORE) content matches v1

### Dependencies
Milestone 2 (service updates with action parameter)

### Risk Factors
- Need to ensure RESTORE is treated same as UPDATE for diff/snapshot logic (it should be - both are content-changing actions)
- Frontend API calls need to use new endpoint path

---

## Milestone 4: Frontend Updates

### Goal
Update frontend to handle new action types, null versions for audit events, and disable interaction for audit actions.

### Success Criteria
- `HistoryActionType` type includes `restore` (for version restoration) and `undelete`
- `HistoryDiffType` type includes `audit`
- `HistoryEntry.version` allows `null`
- `formatAction()` displays correct labels for all action types
- Audit action rows (DELETE/UNDELETE/ARCHIVE/UNARCHIVE) display without version badge
- Audit action rows show informational message instead of diff
- No restore button shown for audit actions
- `latestVersion` correctly computed from first non-null version
- RESTORE actions show diff and restore button like UPDATE

### Key Changes

1. **Update `frontend/src/types.ts`:**
   ```typescript
   export type HistoryActionType =
     | 'create'
     | 'update'
     | 'restore'     // Restored to previous version
     | 'delete'
     | 'undelete'    // Un-deleted (was 'restore' before)
     | 'archive'
     | 'unarchive'

   export type HistoryDiffType = 'snapshot' | 'diff' | 'metadata' | 'audit'

   // Update HistoryEntry type to allow null version
   export interface HistoryEntry {
     // ...
     version: number | null  // null for audit events
     // ...
   }
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
   - Add helper to check if action is audit:
     ```typescript
     const isAuditAction = (action: HistoryActionType): boolean =>
       ['delete', 'undelete', 'archive', 'unarchive'].includes(action)
     ```
   - Compute latestVersion from first non-null version:
     ```typescript
     // Find latest content version (first non-null version in chronological order)
     const latestVersion = history?.items.find(e => e.version !== null)?.version ?? 0
     ```
   - Display version conditionally:
     ```typescript
     {entry.version !== null && (
       <span className="font-medium text-gray-900">v{entry.version}</span>
     )}
     ```
   - When audit action is selected, show message instead of diff:
     ```typescript
     {isAuditAction(entry.action) ? (
       <div className="p-3 text-sm text-gray-500">
         This is a state transition. No content changes to display.
       </div>
     ) : (
       <DiffView ... />
     )}
     ```
   - Hide restore button for audit actions (they have null version anyway):
     ```typescript
     {entry.version !== null && entry.version < latestVersion && (
       <button ...>Restore</button>
     )}
     ```

3. **Update `frontend/src/pages/settings/SettingsVersionHistory.tsx`:**
   - Update `formatAction()` with same labels
   - Apply same audit action logic for row expansion and version display

### Testing Strategy

1. **Component tests:**
   - Verify formatAction returns correct labels for all action types
   - Verify audit actions (null version) don't show version badge
   - Verify audit actions don't show restore button
   - Verify audit actions show informational message instead of diff when expanded
   - Verify RESTORE actions show diff and restore button
   - `test__latest_version__ignores_audit`: Verify latestVersion computed from first non-null version

2. **Type tests:**
   - Verify HistoryActionType includes all new values
   - Verify HistoryDiffType includes 'audit'
   - Verify HistoryEntry.version accepts null

### Dependencies
Milestone 3 (backend changes complete, endpoint renamed)

### Risk Factors
- Ensure consistent behavior between HistorySidebar and SettingsVersionHistory

---

## Milestone 5: Update Spec and Documentation

### Goal
Update content-versioning.md spec to reflect all changes.

### Success Criteria
- ActionType table updated with RESTORE (version restoration) and UNDELETE
- DiffType table updated with AUDIT
- Version column documented as nullable (NULL for audit events)
- DELETE section updated to reflect no content storage (only identifying fields in metadata)
- Audit actions section explains audit-only purpose and null version
- Retention section clarifies audit events don't count toward max_history_per_entity
- Reconstruction algorithm notes it naturally ignores null-version records
- Restore section (renamed from revert) notes that restoring to audit versions is blocked
- All "revert" terminology updated to "restore"

### Key Changes

1. **Update `docs/content-versioning.md`:**
   - Update Actions Tracked table with new columns (Has Version?, etc.)
   - Update Diff Types table with AUDIT
   - Rewrite DELETE section (stores only identifying fields, no content, no version)
   - Add section explaining AUDIT diff type and its purpose
   - Clarify retention behavior: audit events don't count toward entity limits, only time-based cleanup
   - Update reconstruction algorithm to specify null-version filtering
   - Rename "revert" → "restore" throughout
   - Update restore section to note audit version blocking

2. **Update `CLAUDE.md`** if it references action types or revert terminology

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
| 1 | Backend enums, model, schema, migration | Add RESTORE, rename old RESTORE→UNDELETE, add AUDIT diff type, make version nullable in model and schema, audit actions get NULL version, guard modulo check, update ordering/counting/pruning to handle NULLs, update reconstruction |
| 2 | Entity services | Update audit actions to pass identifying metadata (title/name/url), add action parameter to update methods |
| 3 | Rename revert→restore, update endpoint | Rename throughout codebase, record RESTORE action, block restoring to audit versions |
| 4 | Frontend | Handle new action types, null versions for audit events, fix latestVersion calculation, show message for audit actions, hide restore button |
| 5 | Documentation | Update spec to reflect all changes, rename revert→restore |

Total: 5 milestones. Each milestone should be reviewed before proceeding to the next.
