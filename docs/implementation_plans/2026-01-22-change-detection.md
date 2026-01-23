# Implementation Plan: Multi-Tab Change Detection

**Date:** 2026-01-22
**Status:** Draft

## Overview

Implement change detection to prevent data loss when the same note is open in multiple browser tabs/windows or devices. Currently, if a user edits a note in Tab A, saves, then edits and saves from Tab B (which has stale data), the changes from Tab A are silently overwritten.

## Solution Approach

Combine two complementary strategies:

1. **Stale Check on Tab Focus (Frontend)** - When a tab gains focus, check if the note was modified elsewhere and warn the user before they start editing stale data.

2. **Optimistic Locking on Save (Backend)** - When saving, verify the note hasn't been modified since it was loaded. If it has, return 409 Conflict instead of silently overwriting.

This approach:
- Catches 90%+ of real-world scenarios (user switches between tabs)
- Provides a hard safety net for edge cases
- Requires no real-time infrastructure (WebSockets, etc.)
- Leverages existing `updated_at` timestamp (no schema changes needed)

## Scope

**In Scope:**
- Notes, bookmarks, and prompts (all editable entity types)
- Multi-tab detection within same browser and across devices
- 409 Conflict response with server state
- Conflict resolution UI with clear options
- Reusable logic across entity types (backend and frontend)

**Out of Scope:**
- Automatic merge/diff (complex, overkill for personal app)
- Real-time collaboration features (would require WebSockets)

---

## Milestone 1: Backend - Optimistic Locking

### Goal
Add version checking to update endpoints for notes, bookmarks, and prompts to prevent silent overwrites. Implement as reusable logic in the base service.

### Success Criteria
- PATCH endpoints for `/notes/{id}`, `/bookmarks/{id}`, and `/prompts/{id}` accept optional `expected_updated_at` parameter
- Returns 409 Conflict if entity was modified after `expected_updated_at`
- 409 response includes current server state for conflict resolution
- Existing clients without `expected_updated_at` continue to work (backwards compatible)
- Logic is reusable across all entity types

### Key Changes

**1. Update schema base or individual schemas:**

Add optional `expected_updated_at` field to `NoteUpdate`, `BookmarkUpdate`, and `PromptUpdate`:

```python
# Could create a mixin or add to each schema
expected_updated_at: datetime | None = Field(
    default=None,
    description="For optimistic locking. If provided and entity was modified after "
                "this timestamp, returns 409 Conflict with current server state.",
)
```

**2. Add conflict check helper (reusable across routers):**

Create a helper function that can be used by all entity routers:

```python
# backend/src/api/helpers/conflict_check.py
async def check_optimistic_lock(
    db: AsyncSession,
    service: BaseEntityService,
    user_id: UUID,
    entity_id: UUID,
    expected_updated_at: datetime | None,
    response_schema: type[BaseModel],
) -> None:
    """
    Check for conflicts before update. Raises HTTPException 409 if stale.
    Call this at the start of update endpoints when expected_updated_at is provided.
    """
    if expected_updated_at is None:
        return  # No optimistic locking requested

    current_updated_at = await service.get_updated_at(db, user_id, entity_id)
    if current_updated_at is None:
        raise HTTPException(status_code=404, detail="Entity not found")

    if current_updated_at > expected_updated_at:
        current_entity = await service.get(db, user_id, entity_id)
        raise HTTPException(
            status_code=409,
            detail={
                "error": "conflict",
                "message": "This item was modified since you loaded it",
                "server_state": response_schema.model_validate(current_entity).model_dump(),
            },
        )
```

**3. Update each router to use the helper:**

```python
# In notes.py, bookmarks.py, prompts.py
@router.patch("/{entity_id}", response_model=EntityResponse)
async def update_entity(...) -> EntityResponse:
    await check_optimistic_lock(
        db, entity_service, current_user.id, entity_id,
        data.expected_updated_at, EntityResponse,
    )
    # Proceed with update...
```

**4. Create conflict error schema (`backend/src/schemas/errors.py`):**

```python
class ConflictError(BaseModel):
    error: Literal["conflict"] = "conflict"
    message: str
    server_state: dict  # The current entity state from server
```

### Testing Strategy

**Use `pytest.parametrize` to run identical test logic against all three entity types.** This reduces duplication and ensures consistent behavior.

**Test file: `backend/tests/api/test_optimistic_locking.py`**

```python
import pytest
from datetime import datetime, timedelta, timezone

@pytest.fixture
async def note_entity(db_session, test_user, note_service):
    note = await note_service.create(db_session, test_user.id, NoteCreate(title="Test"))
    return {
        "entity": note,
        "endpoint": f"/notes/{note.id}",
        "update_data": {"title": "Updated"},
        "entity_type": "note",
    }

@pytest.fixture
async def bookmark_entity(db_session, test_user, bookmark_service):
    bookmark = await bookmark_service.create(
        db_session, test_user.id, BookmarkCreate(url="https://example.com")
    )
    return {
        "entity": bookmark,
        "endpoint": f"/bookmarks/{bookmark.id}",
        "update_data": {"title": "Updated"},
        "entity_type": "bookmark",
    }

@pytest.fixture
async def prompt_entity(db_session, test_user, prompt_service):
    prompt = await prompt_service.create(
        db_session, test_user.id, PromptCreate(name="test", content="Hello")
    )
    return {
        "entity": prompt,
        "endpoint": f"/prompts/{prompt.id}",
        "update_data": {"title": "Updated"},
        "entity_type": "prompt",
    }


@pytest.mark.parametrize("entity_fixture", ["note_entity", "bookmark_entity", "prompt_entity"])
class TestOptimisticLocking:
    """Optimistic locking tests run against all entity types."""

    async def test__update__with_expected_updated_at__success(self, request, client, entity_fixture):
        """Update succeeds when timestamps match exactly."""
        setup = request.getfixturevalue(entity_fixture)
        # ...

    async def test__update__with_expected_updated_at__conflict_returns_409(self, request, client, entity_fixture):
        """Returns 409 when entity was modified after expected time."""
        setup = request.getfixturevalue(entity_fixture)
        # ...
```

**Parametrized tests (each runs 3x, once per entity type):**

*Happy path:*
1. `test__update__with_expected_updated_at__success` - Update succeeds when timestamps match exactly
2. `test__update__with_expected_updated_at__success_when_not_modified` - Update succeeds when entity unchanged since expected time

*Conflict detection:*
3. `test__update__with_expected_updated_at__conflict_returns_409` - Returns 409 when entity was modified after expected time
4. `test__update__conflict_response_includes_server_state` - 409 response contains full current entity state
5. `test__update__conflict_response_structure` - Verify error format: `{error: "conflict", message: "...", server_state: {...}}`

*Backwards compatibility:*
6. `test__update__without_expected_updated_at__allows_update` - Existing behavior unchanged (last-write-wins)
7. `test__update__without_expected_updated_at__no_conflict_check` - No 409 even if entity was modified

*Edge cases:*
8. `test__update__expected_updated_at__entity_not_found_returns_404` - 404 if entity doesn't exist (not 409)
9. `test__update__expected_updated_at__archived_entity` - Works correctly with archived entities
10. `test__update__expected_updated_at__timezone_handling` - UTC timestamps compared correctly regardless of input timezone

**Helper tests (`backend/tests/api/test_conflict_check.py`):**

1. `test__check_optimistic_lock__returns_none_when_no_expected_updated_at` - No-op when not requested
2. `test__check_optimistic_lock__raises_409_when_stale` - Raises HTTPException with correct structure
3. `test__check_optimistic_lock__raises_404_when_entity_not_found` - 404 before 409 check

### Dependencies
None - this is the foundation milestone.

### Risk Factors
- Need to handle timezone edge cases (ensure consistent UTC comparison)
- The `get_updated_at` query adds a DB round-trip; acceptable for the safety it provides

---

## Milestone 2: Frontend - Stale Check on Tab Focus

### Goal
Detect when an entity (note, bookmark, or prompt) was modified elsewhere and warn the user before they edit stale data. Implement as a reusable hook that works with any entity type.

### Success Criteria
- When tab gains focus, fetch note's `updated_at` from server
- **Check is silent and non-blocking**: no loading spinners, no page refresh, no visible delay
- **User sees nothing unless note is stale**: only if `updated_at` differs do we show the warning banner
- **Errors are silently ignored**: network failures don't interrupt the user or show error messages
- Warning offers: "Reload" (fetch fresh) or "Continue Editing" (dismiss)
- If user has unsaved changes AND note is stale, show enhanced warning

### Key Changes

**1. Create generic `useStaleCheck` hook (`frontend/src/hooks/useStaleCheck.ts`):**

Works with any entity type by accepting a fetch function:

```typescript
interface UseStaleCheckOptions {
  entityId: string | undefined
  loadedUpdatedAt: string | undefined
  isDirty: boolean
  // Function to fetch current updated_at from server (uses metadata endpoint)
  fetchUpdatedAt: (id: string) => Promise<string>
}

interface UseStaleCheckResult {
  isStale: boolean
  serverUpdatedAt: string | null  // The server's updated_at if stale, for display
  dismiss: () => void
  refresh: () => Promise<void>
}

export function useStaleCheck({
  entityId,
  loadedUpdatedAt,
  isDirty,
  fetchUpdatedAt,
}: UseStaleCheckOptions): UseStaleCheckResult {
  // On visibilitychange (tab focus), call fetchUpdatedAt silently
  // Compare with loadedUpdatedAt
  // Set isStale only if different (this is the only UI-triggering state)
  // Errors are caught and ignored - don't interrupt user
}
```

**2. Use existing metadata endpoints:**

Each entity type already has a metadata endpoint that returns `updated_at` without loading full content:
- `GET /notes/{id}/metadata`
- `GET /bookmarks/{id}/metadata`
- `GET /prompts/{id}/metadata`

**3. Integrate into detail pages (`NoteDetail.tsx`, `BookmarkDetail.tsx`, `PromptDetail.tsx`):**

```typescript
const { isStale, serverUpdatedAt, dismiss, refresh } = useStaleCheck({
  entityId: entity?.id,
  loadedUpdatedAt: entity?.updated_at,
  isDirty,
  fetchUpdatedAt: (id) => fetchNoteMetadata(id).then(m => m.updated_at),
})

// Show StaleWarningBanner when isStale is true
```

**4. Create `StaleWarningBanner` component (`frontend/src/components/ui/StaleWarningBanner.tsx`):**

A dismissable warning that appears **centered on screen** (fixed position, visible regardless of scroll):
- Fixed position, centered horizontally and vertically (or near top-center with some margin)
- Works on mobile (responsive, not too wide)
- Yellow/amber background with shadow for visibility
- Text: "This item was modified elsewhere" (generic, or pass entity type for "This note was...")
- Shows server modified time: "Server version from 5 minutes ago"
- **"Load Latest"** button - Fetches server version, replaces local content
- **"Continue Editing"** button - Dismisses warning, keeps local content
- If `isDirty`: Additional warning text "You have unsaved changes. Loading latest will discard them."
- Semi-transparent backdrop optional (to draw attention without being as intrusive as a modal)

### Testing Strategy

**Hook tests (`frontend/src/hooks/useStaleCheck.test.ts`):**

*Core functionality:*
1. `test__useStaleCheck__detects_stale_on_visibility_change` - Mock `visibilitychange` event, verify `isStale` becomes true when `updated_at` differs
2. `test__useStaleCheck__not_stale_when_timestamps_match` - `isStale` remains false when server `updated_at` matches loaded value
3. `test__useStaleCheck__provides_server_updated_at_when_stale` - `serverUpdatedAt` is populated for display in warning

*Skip conditions:*
4. `test__useStaleCheck__no_check_when_no_noteId` - Skip API call for new/unsaved notes
5. `test__useStaleCheck__no_check_when_tab_hidden` - Only check when gaining focus, not losing it
6. `test__useStaleCheck__no_check_when_no_loaded_updated_at` - Skip if note hasn't loaded yet

*User actions:*
7. `test__useStaleCheck__dismiss_clears_stale_state` - `dismissStaleWarning()` sets `isStale` to false
8. `test__useStaleCheck__refresh_fetches_new_note` - `refreshNote()` fetches fresh data and clears stale state

*Error handling:*
9. `test__useStaleCheck__handles_network_error_silently` - Network failure doesn't set error state or interrupt user
10. `test__useStaleCheck__handles_404_when_note_deleted` - Note deleted in other tab shows appropriate state (stale or special handling)

*Edge cases:*
11. `test__useStaleCheck__debounces_rapid_tab_switches` - Multiple rapid focus events don't trigger multiple API calls

**Component tests (`frontend/src/components/ui/StaleWarningBanner.test.tsx`):**

*Rendering:*
1. `test__StaleWarningBanner__renders_centered_fixed_position` - Verify CSS positioning
2. `test__StaleWarningBanner__shows_reload_and_continue_buttons` - Both action buttons present
3. `test__StaleWarningBanner__shows_modified_time` - Displays when note was modified ("Modified 5 minutes ago")

*Conditional content:*
4. `test__StaleWarningBanner__shows_dirty_warning_when_has_unsaved_changes` - Extra warning text when `isDirty`
5. `test__StaleWarningBanner__no_dirty_warning_when_clean` - No extra warning when no local changes

*User interactions:*
6. `test__StaleWarningBanner__reload_button_calls_onReload` - Verify callback
7. `test__StaleWarningBanner__continue_button_calls_onDismiss` - Verify callback

*Responsive:*
8. `test__StaleWarningBanner__responsive_on_mobile` - Works at narrow viewport widths

### Dependencies
- Milestone 1 (backend changes) - Not strictly required, but should be done together

### Risk Factors
- Frequent tab switching could cause many API calls; consider debouncing
- Need to handle case where note was deleted in other tab (404 response)

---

## Milestone 3: Frontend - Handle 409 Conflict on Save

### Goal
When the backend returns 409 Conflict, show a conflict resolution dialog instead of a generic error. Works for all entity types with reusable components.

### Success Criteria
- Detect 409 response in mutation error handler
- Show conflict dialog with clear options and copy functionality
- User can copy their content before deciding
- "Save My Version" requires confirmation (same pattern as delete)
- Works for notes, bookmarks, and prompts

### Key Changes

**1. Update types (`frontend/src/types.ts`):**

Add `expected_updated_at` to all update types:

```typescript
interface NoteUpdate {
  // ... existing fields ...
  expected_updated_at?: string  // ISO 8601 timestamp for optimistic locking
}

interface BookmarkUpdate {
  // ... existing fields ...
  expected_updated_at?: string
}

interface PromptUpdate {
  // ... existing fields ...
  expected_updated_at?: string
}
```

**2. Update mutation hooks (`useNoteMutations.ts`, `useBookmarkMutations.ts`, `usePromptMutations.ts`):**

- Include `expected_updated_at` in update payload (from the loaded entity's `updated_at`)
- Handle 409 specially - don't rollback optimistic update, instead trigger conflict dialog

**3. Create `ConflictDialog` component (`frontend/src/components/ui/ConflictDialog.tsx`):**

Modal dialog with clear options:

```typescript
interface ConflictDialogProps {
  isOpen: boolean
  serverUpdatedAt: string  // For display: "Server version from 5 minutes ago"
  currentContent: string   // The user's current editor content (for copy)
  entityType: 'note' | 'bookmark' | 'prompt'
  onLoadServerVersion: () => void  // Fetch and load server version
  onSaveMyVersion: () => void      // Force save without version check
  onDoNothing: () => void          // Close dialog, keep local changes unsaved
}
```

Dialog contents:
- Header: "This {entityType} was modified while you were editing"
- Server modified time: "Server version from 5 minutes ago"
- **"Copy My Content"** button (always visible, top of actions) - Copies `currentContent` to clipboard, shows toast "Content copied"
- **"Load Server Version"** button - Calls `onLoadServerVersion`
  - Helper text: "Discard your changes and load the latest version"
- **"Save My Version"** button - Uses confirm pattern (first click shows "Confirm?", second click executes)
  - Helper text: "Overwrite server changes with your version"
- **"Do Nothing"** button - Calls `onDoNothing`
  - Helper text: "Close this dialog and continue editing (changes remain unsaved)"

**4. Integrate into detail pages:**

Each detail page (Note, Bookmark, Prompt) needs to:
1. Track conflict state
2. Pass current editor content to dialog for copy functionality
3. Handle each action appropriately

```typescript
const [conflictState, setConflictState] = useState<{
  isOpen: boolean
  serverUpdatedAt: string
  serverState: EntityResponse  // Full server state for reload option
} | null>(null)

// In handleSave, catch 409:
try {
  await updateMutation.mutateAsync({ id, data: { ...updates, expected_updated_at: entity.updated_at } })
} catch (error) {
  if (error.response?.status === 409) {
    const detail = error.response.data.detail
    setConflictState({
      isOpen: true,
      serverUpdatedAt: detail.server_state.updated_at,
      serverState: detail.server_state,
    })
    return // Don't show generic error toast
  }
  throw error // Let normal error handling proceed
}

// Dialog handlers:
const handleLoadServerVersion = () => {
  setEntity(conflictState.serverState)  // Replace local with server
  setConflictState(null)
}

const handleSaveMyVersion = async () => {
  // Retry save WITHOUT expected_updated_at (force overwrite)
  await updateMutation.mutateAsync({ id, data: updates })  // No expected_updated_at
  setConflictState(null)
}

const handleDoNothing = () => {
  setConflictState(null)  // Close dialog, keep local changes unsaved
}
```

### Testing Strategy

**Mutation tests (`frontend/src/hooks/useNoteMutations.test.tsx`):**

*Payload structure:*
1. `test__useUpdateNote__includes_expected_updated_at_from_loaded_note` - Verify `expected_updated_at` sent in PATCH payload
2. `test__useUpdateNote__expected_updated_at_matches_note_updated_at` - Timestamp comes from the loaded note's `updated_at`

*409 handling:*
3. `test__useUpdateNote__409_does_not_trigger_optimistic_rollback` - Local state preserved on conflict (unlike other errors)
4. `test__useUpdateNote__409_error_contains_server_state` - Error object includes server's current note state
5. `test__useUpdateNote__non_409_errors_handled_normally` - Other errors (500, network) still show toast/rollback as before

**Component tests (`frontend/src/components/ui/ConflictDialog.test.tsx`):**

*Rendering:*
1. `test__ConflictDialog__renders_when_open` - Dialog appears when `isOpen` is true
2. `test__ConflictDialog__shows_server_modified_time` - Displays "Modified X minutes ago"
3. `test__ConflictDialog__shows_all_three_options` - Reload, Overwrite, Cancel buttons present

*User actions:*
4. `test__ConflictDialog__reload_calls_onReload_and_closes` - Reload button behavior
5. `test__ConflictDialog__do_nothing_closes_without_action` - Do Nothing preserves local state
6. `test__ConflictDialog__overwrite_requires_confirmation` - First click shows confirmation, second click executes
7. `test__ConflictDialog__overwrite_calls_onOverwrite` - Overwrite triggers save without version check
8. `test__ConflictDialog__copy_copies_content_to_clipboard` - Copy button copies currentContent and shows toast

*Accessibility:*
9. `test__ConflictDialog__traps_focus` - Focus stays within dialog
10. `test__ConflictDialog__escape_key_calls_do_nothing` - Keyboard dismissal works

**Integration tests (`frontend/src/pages/NoteDetail.test.tsx` or `frontend/src/components/Note.test.tsx`):**

*End-to-end conflict flow:*
1. `test__NoteDetail__conflict_dialog_appears_on_save_409` - Full flow: edit → save → 409 → dialog shown
2. `test__NoteDetail__reload_replaces_local_state_with_server_state` - After reload, editor shows server content
3. `test__NoteDetail__overwrite_saves_local_changes_successfully` - Force save bypasses version check
4. `test__NoteDetail__do_nothing_preserves_local_edits_in_editor` - User can continue editing after Do Nothing
5. `test__NoteDetail__local_edits_not_lost_during_conflict_resolution` - Editor content intact while dialog open

### Dependencies
- Milestone 1 (backend 409 support)
- Milestone 2 (useful but not required)

### Risk Factors
- Need to preserve user's local edits in memory during conflict resolution
- "Overwrite" option should be clearly labeled as destructive (loses server changes)

---

## Implementation Notes

### Why `updated_at` Instead of a Version Number

The Note model already has a `version` field (currently unused), but using `updated_at` is preferred because:

1. Already exists and is maintained automatically
2. No migration needed
3. More informative in conflict messages ("modified 5 minutes ago" vs "version 7")
4. Works the same way for conflict detection

The `version` field can be used later if we implement version history.

### Backwards Compatibility

The `expected_updated_at` parameter is optional. Existing clients (including MCP tools) that don't send it will continue to work with last-write-wins behavior. Only the frontend will send it.

### Error Message UX

When showing conflict:
- Show when the server version was modified: "Modified 5 minutes ago"
- Don't show a diff (complex, overkill for personal notes)
- Keep it simple: reload or overwrite

### Performance Considerations

- Stale check on tab focus: Uses lightweight `/metadata` endpoint (~100ms)
- Conflict check on save: Single `get_updated_at` query (~10ms) before update
- Both are acceptable overhead for the safety they provide

---

## Design Decisions

### Entity Coverage
All three entity types (notes, bookmarks, prompts) will support change detection. Backend and frontend logic should be reusable/generic where possible.

### Dialog Wording and Behavior

There are **two distinct UI components** with different purposes:

**1. StaleWarningBanner (on tab focus)** - Informational, appears when tab gains focus and note was modified elsewhere:
- "This note was modified elsewhere"
- Shows server's modified time
- **"Load Latest"** - Fetch server version, replace local content
- **"Continue Editing"** - Dismiss warning, keep local content (user can still save later)

**2. ConflictDialog (on 409 save attempt)** - Action required, appears when user tries to save but server was modified:
- "This note was modified while you were editing"
- Shows server's modified time
- **"Copy My Content"** button - Copies current editor content to clipboard (always available, allows user to preserve their work before choosing)
- **"Load Server Version"** - Discard local changes, load server version, close dialog
  - Helper text: "Discard your changes and load the latest version"
- **"Save My Version"** - Force save local changes (overwrites server). **Requires confirmation** using same confirm pattern as delete.
  - Helper text: "Overwrite server changes with your version"
- **"Do Nothing"** - Close dialog, keep local changes in editor (unsaved), user can continue editing
  - Helper text: "Close this dialog and continue editing (changes remain unsaved)"

### What "Save My Version" Does
When user confirms "Save My Version":
1. Retry the save **without** `expected_updated_at` (bypasses conflict check)
2. This overwrites whatever is on the server with local content
3. Server changes are lost - this is clearly communicated in the confirmation

### What "Do Nothing" Does
- Closes the dialog
- Local content remains in editor (unchanged)
- Content is still dirty/unsaved
- User can continue editing or manually save later (which may trigger another 409)

### Server Content in Dialog
Show only timestamps for now ("Server version modified 5 minutes ago"). Diff view can be added later if users request it.
