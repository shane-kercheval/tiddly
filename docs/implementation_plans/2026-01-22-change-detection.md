# Implementation Plan: Multi-Tab Change Detection

**Date:** 2026-01-22
**Status:** Draft

## Overview

Implement change detection to prevent data loss when the same note is open in multiple browser tabs/windows. Currently, if a user edits a note in Tab A, saves, then edits and saves from Tab B (which has stale data), the changes from Tab A are silently overwritten.

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
- Notes only (most common editing scenario)
- Multi-tab detection within same browser
- 409 Conflict response with server state
- Basic conflict resolution UI (reload/overwrite options)

**Out of Scope:**
- Bookmarks and prompts (less frequently edited, lower risk)
- Cross-device sync (would require WebSockets)
- Automatic merge/diff (complex, overkill for personal notes)
- Real-time collaboration features

---

## Milestone 1: Backend - Optimistic Locking

### Goal
Add version checking to the note update endpoint to prevent silent overwrites.

### Success Criteria
- PATCH `/notes/{id}` accepts optional `expected_updated_at` parameter
- Returns 409 Conflict if note was modified after `expected_updated_at`
- 409 response includes current server state for conflict resolution
- Existing clients without `expected_updated_at` continue to work (backwards compatible)

### Key Changes

**1. Update `NoteUpdate` schema (`backend/src/schemas/note.py`):**

Add optional `expected_updated_at` field for optimistic locking:

```python
class NoteUpdate(BaseModel):
    # ... existing fields ...
    expected_updated_at: datetime | None = Field(
        default=None,
        description="For optimistic locking. If provided and note was modified after "
                    "this timestamp, returns 409 Conflict with current server state.",
    )
```

**2. Update note router (`backend/src/api/routers/notes.py`):**

In `update_note` endpoint, check version before applying update:

```python
@router.patch("/{note_id}", response_model=NoteResponse)
async def update_note(...) -> NoteResponse:
    # If optimistic locking requested, check for conflicts
    if data.expected_updated_at is not None:
        current_updated_at = await note_service.get_updated_at(
            db, current_user.id, note_id, include_deleted=False,
        )
        if current_updated_at is None:
            raise HTTPException(status_code=404, detail="Note not found")

        if current_updated_at > data.expected_updated_at:
            # Fetch current state for conflict resolution
            current_note = await note_service.get(db, current_user.id, note_id)
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "conflict",
                    "message": "Note was modified since you loaded it",
                    "server_state": NoteResponse.model_validate(current_note).model_dump(),
                },
            )

    # Proceed with update...
```

**3. Create conflict error schema (`backend/src/schemas/errors.py`):**

```python
class ConflictError(BaseModel):
    error: Literal["conflict"] = "conflict"
    message: str
    server_state: dict  # The current note state from server
```

### Testing Strategy

**Unit tests (`backend/tests/api/test_notes.py`):**

1. `test__update_note__with_expected_updated_at__success` - Update succeeds when timestamps match
2. `test__update_note__with_expected_updated_at__conflict` - Returns 409 when note was modified
3. `test__update_note__without_expected_updated_at__backwards_compatible` - Existing behavior unchanged
4. `test__update_note__conflict_response_includes_server_state` - Verify response structure

### Dependencies
None - this is the foundation milestone.

### Risk Factors
- Need to handle timezone edge cases (ensure consistent UTC comparison)
- The `get_updated_at` query adds a DB round-trip; acceptable for the safety it provides

---

## Milestone 2: Frontend - Stale Check on Tab Focus

### Goal
Detect when a note was modified in another tab and warn the user before they edit stale data.

### Success Criteria
- When tab gains focus, fetch note's `updated_at` from server
- If `updated_at` changed since load, show warning banner
- Warning offers: "Reload" (fetch fresh) or "Continue Editing" (dismiss)
- If user has unsaved changes AND note is stale, show enhanced warning

### Key Changes

**1. Create `useStaleCheck` hook (`frontend/src/hooks/useStaleCheck.ts`):**

```typescript
interface UseStaleCheckOptions {
  noteId: string | undefined
  loadedUpdatedAt: string | undefined
  isDirty: boolean
}

interface UseStaleCheckResult {
  isStale: boolean
  isChecking: boolean
  serverUpdatedAt: string | null
  dismissStaleWarning: () => void
  refreshNote: () => Promise<void>
}

export function useStaleCheck({
  noteId,
  loadedUpdatedAt,
  isDirty,
}: UseStaleCheckOptions): UseStaleCheckResult {
  // On visibilitychange (tab focus), fetch updated_at
  // Compare with loadedUpdatedAt
  // Set isStale if different
}
```

**2. Add lightweight endpoint or use existing metadata endpoint:**

The existing `GET /notes/{id}/metadata` endpoint returns `updated_at` without loading full content. Use this for the stale check.

**3. Integrate into `NoteDetail.tsx`:**

```typescript
const { isStale, dismissStaleWarning, refreshNote } = useStaleCheck({
  noteId: note?.id,
  loadedUpdatedAt: note?.updated_at,
  isDirty,
})

// Show StaleWarningBanner when isStale is true
```

**4. Create `StaleWarningBanner` component (`frontend/src/components/ui/StaleWarningBanner.tsx`):**

A dismissable banner that appears below the header:
- Yellow/amber background
- Text: "This note was modified in another tab"
- Buttons: [Reload] [Continue Editing]
- If `isDirty`: "You have unsaved changes. Reloading will discard them."

### Testing Strategy

**Hook tests (`frontend/src/hooks/useStaleCheck.test.ts`):**

1. `test__useStaleCheck__detects_stale_on_focus` - Mock visibility change, verify stale detection
2. `test__useStaleCheck__no_check_when_no_noteId` - Skip check for new notes
3. `test__useStaleCheck__dismiss_clears_stale_state` - Verify dismissal works
4. `test__useStaleCheck__handles_network_error_gracefully` - Don't crash on fetch failure

**Component tests (`frontend/src/components/ui/StaleWarningBanner.test.tsx`):**

1. `test__StaleWarningBanner__shows_reload_and_dismiss_buttons`
2. `test__StaleWarningBanner__shows_dirty_warning_when_has_changes`
3. `test__StaleWarningBanner__calls_onReload_when_clicked`

### Dependencies
- Milestone 1 (backend changes) - Not strictly required, but should be done together

### Risk Factors
- Frequent tab switching could cause many API calls; consider debouncing
- Need to handle case where note was deleted in other tab (404 response)

---

## Milestone 3: Frontend - Handle 409 Conflict on Save

### Goal
When the backend returns 409 Conflict, show a conflict resolution UI instead of a generic error.

### Success Criteria
- Detect 409 response in mutation error handler
- Show conflict dialog with options
- User can choose to reload (discard local changes) or force overwrite
- Force overwrite retries without `expected_updated_at`

### Key Changes

**1. Update `NoteUpdate` type (`frontend/src/types.ts`):**

```typescript
interface NoteUpdate {
  // ... existing fields ...
  expected_updated_at?: string  // ISO 8601 timestamp for optimistic locking
}
```

**2. Update `useUpdateNote` mutation (`frontend/src/hooks/useNoteMutations.ts`):**

- Include `expected_updated_at` in update payload
- Handle 409 in `onError` callback

**3. Create `ConflictDialog` component (`frontend/src/components/ui/ConflictDialog.tsx`):**

Modal dialog showing:
- "This note was modified while you were editing"
- Server's last modified time
- Options:
  - "Reload" - Discard local changes, load server version
  - "Overwrite" - Force save local changes (loses server changes)
  - "Cancel" - Close dialog, keep local changes in editor

**4. Integrate into `Note.tsx` or `NoteDetail.tsx`:**

```typescript
const [conflictState, setConflictState] = useState<{
  isOpen: boolean
  serverState: NoteResponse | null
} | null>(null)

// In handleSave error handling:
if (error.response?.status === 409) {
  setConflictState({
    isOpen: true,
    serverState: error.response.data.server_state,
  })
}
```

### Testing Strategy

**Integration tests:**

1. `test__Note__shows_conflict_dialog_on_409` - Mock 409 response, verify dialog appears
2. `test__Note__reload_option_fetches_fresh_data` - Verify reload behavior
3. `test__Note__overwrite_option_saves_without_version_check` - Verify force save

**Mutation tests (`frontend/src/hooks/useNoteMutations.test.tsx`):**

1. `test__useUpdateNote__includes_expected_updated_at` - Verify payload structure
2. `test__useUpdateNote__handles_409_conflict` - Verify error handling doesn't rollback

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

## Open Questions

1. **Should we extend this to bookmarks and prompts?** - Probably not initially. Notes are the primary editing use case. Can add later if needed.

2. **Should "Overwrite" require confirmation?** - Yes, probably a second click or typing "overwrite" to prevent accidents.

3. **Should we show the server's content in the conflict dialog?** - Could be useful but adds complexity. Start simple, iterate if users request it.
