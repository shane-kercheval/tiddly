# Content Component Refactor: Extract Shared Hooks

## Overview

Extract duplicated state management logic from `Note.tsx`, `Prompt.tsx`, and `Bookmark.tsx` into reusable hooks. Currently, these three components share ~300 lines of nearly identical code for draft management and discard confirmation.

### Goals

1. Reduce code duplication across content entity components
2. Centralize draft autosave and discard confirmation logic
3. Make the existing `usePromptDraft` hook generic for all entity types
4. Improve maintainability by having a single source of truth for shared behavior

### Non-Goals

- Creating a generic "entity form" component (adds complexity without benefit)
- Extracting keyboard shortcuts into a hook (callbacks create coupling)
- Abstracting JSX/UI elements (entity-specific enough to warrant duplication)

## Current State

| Component | Lines | Draft Logic | Discard Confirmation |
|-----------|-------|-------------|---------------------|
| Note.tsx | 729 | Inline (~80 lines) | Inline (~30 lines) |
| Prompt.tsx | 780 | `usePromptDraft` hook | Inline (~30 lines) |
| Bookmark.tsx | 935 | Inline (~80 lines) | Inline (~30 lines) |

Prompt.tsx already uses a draft hook (`usePromptDraft`), but it's prompt-specific. Note and Bookmark have the same logic duplicated inline.

---

## Milestone 1: Create Generic `useDraft` Hook

### Goal

Create a generic `useDraft<T>` hook that works for any entity type (notes, prompts, bookmarks), replacing the prompt-specific `usePromptDraft`.

### Success Criteria

- [ ] `useDraft` hook exists in `frontend/src/hooks/useDraft.ts`
- [ ] Hook is generic and works with any form state shape
- [ ] All existing `usePromptDraft` tests pass with the new hook
- [ ] New tests cover generic functionality

### Key Changes

**Create `frontend/src/hooks/useDraft.ts`:**

```typescript
interface UseDraftOptions<TFormState, TDraftData extends TFormState> {
  /** Storage key prefix (e.g., 'note_draft_', 'bookmark_draft_') */
  keyPrefix: string
  /** Entity ID (undefined for new entities) */
  entityId?: string
  /** Current form state */
  formState: TFormState
  /** Original values to compare against */
  originalValues: TFormState
  /** Convert form state to draft data (adds savedAt timestamp) */
  toDraftData: (state: TFormState) => TDraftData
  /** Check if two states are equal (for dirty detection) */
  isEqual: (a: TFormState, b: TFormState) => boolean
  /** Check if draft differs from original (for hasDraft detection) */
  isDraftDifferent: (draft: TDraftData, original: TFormState, isNew: boolean) => boolean
  /** Callback when draft is restored */
  onRestore: (draft: TDraftData) => void
  /** Whether to disable autosave (e.g., when read-only) */
  disabled?: boolean
}

interface UseDraftResult<TDraftData> {
  hasDraft: boolean
  isDirty: boolean
  restoreDraft: () => void
  discardDraft: () => void
  clearDraft: () => void
}
```

**Key implementation details:**
- Generic over form state type `TFormState` and draft data type `TDraftData`
- User provides `isEqual` function for dirty detection (avoids assuming state shape)
- User provides `isDraftDifferent` for hasDraft detection
- User provides `toDraftData` to add `savedAt` timestamp
- Auto-saves every 30 seconds when dirty (matching current behavior)
- Respects `disabled` flag for read-only mode

### Testing Strategy

1. **Unit tests** (`frontend/src/hooks/useDraft.test.ts`):
   - Test localStorage read/write operations
   - Test `hasDraft` detection on mount
   - Test `isDirty` computation with custom equality function
   - Test autosave interval starts/stops based on dirty state
   - Test `restoreDraft`, `discardDraft`, `clearDraft` callbacks
   - Test `disabled` flag prevents autosave
   - Test error handling when localStorage is unavailable

2. **Edge cases to test:**
   - New entity (no ID) vs existing entity
   - Draft exists but matches original (should not show hasDraft)
   - localStorage quota exceeded
   - Malformed JSON in localStorage

### Dependencies

None - this is the foundation milestone.

### Risk Factors

- Generic type constraints may need iteration to get right
- Equality functions must handle arrays (tags) correctly

---

## Milestone 2: Migrate `usePromptDraft` to Use Generic `useDraft`

### Goal

Refactor `usePromptDraft` to be a thin wrapper around the generic `useDraft` hook, maintaining the same API for backwards compatibility.

### Success Criteria

- [ ] `usePromptDraft` uses `useDraft` internally
- [ ] `Prompt.tsx` continues to work without changes
- [ ] All existing tests pass
- [ ] No new behavior regressions

### Key Changes

**Update `frontend/src/hooks/usePromptDraft.ts`:**

```typescript
import { useDraft } from './useDraft'

export function usePromptDraft(options: UsePromptDraftOptions): UsePromptDraftResult {
  return useDraft({
    keyPrefix: 'prompt_draft_',
    entityId: options.promptId,
    formState: options.formState,
    originalValues: options.originalValues,
    toDraftData: (state) => ({ ...state, savedAt: Date.now() }),
    isEqual: (a, b) => (
      a.name === b.name &&
      a.title === b.title &&
      a.description === b.description &&
      a.content === b.content &&
      a.tags.length === b.tags.length &&
      a.tags.every((tag, i) => tag === b.tags[i]) &&
      JSON.stringify(a.arguments) === JSON.stringify(b.arguments)
    ),
    isDraftDifferent: (draft, original, isNew) => {
      if (isNew) {
        return !!(draft.name || draft.title || draft.description ||
                  draft.content || draft.arguments.length > 0 || draft.tags.length > 0)
      }
      // ... existing comparison logic
    },
    onRestore: options.onRestore,
  })
}
```

### Testing Strategy

1. Run existing `usePromptDraft` tests - all should pass
2. Manual test: Create/edit prompts, verify draft save/restore works
3. Verify no console errors or warnings

### Dependencies

- Milestone 1 (generic `useDraft` hook)

### Risk Factors

- Low risk - this is a straightforward refactor with existing tests as safety net

---

## Milestone 3: Create `useNoteDraft` Hook and Migrate Note.tsx

### Goal

Create a `useNoteDraft` hook using `useDraft` and migrate `Note.tsx` to use it.

### Success Criteria

- [ ] `useNoteDraft` hook exists in `frontend/src/hooks/useNoteDraft.ts`
- [ ] `Note.tsx` uses the hook instead of inline draft logic
- [ ] ~80 lines removed from `Note.tsx`
- [ ] All existing `Note.test.tsx` tests pass
- [ ] New hook tests exist

### Key Changes

**Create `frontend/src/hooks/useNoteDraft.ts`:**

```typescript
export interface NoteDraftData {
  title: string
  description: string
  content: string
  tags: string[]
  savedAt: number
}

export interface NoteFormState {
  title: string
  description: string
  content: string
  tags: string[]
}

export function useNoteDraft(options: UseNoteDraftOptions): UseNoteDraftResult {
  return useDraft({
    keyPrefix: 'note_draft_',
    entityId: options.noteId,
    // ... configuration
  })
}
```

**Update `Note.tsx`:**
- Remove `getDraftKey`, `loadDraft`, `saveDraft`, `clearDraft` helper functions
- Remove `DraftData` interface (now in hook)
- Remove `hasDraft` state initialization logic
- Remove autosave `useEffect`
- Import and use `useNoteDraft` hook

### Testing Strategy

1. **Hook tests** (`frontend/src/hooks/useNoteDraft.test.ts`):
   - Test note-specific draft behavior
   - Test tag array comparison
   - Test content comparison

2. **Integration tests:**
   - Run existing `Note.test.tsx` tests
   - Manual test draft restoration UI

### Dependencies

- Milestone 1 (generic `useDraft` hook)

### Risk Factors

- Note.tsx has inline draft state initialization that computes `hasDraft` on mount
- Must ensure hook initialization order doesn't break

---

## Milestone 4: Create `useBookmarkDraft` Hook and Migrate Bookmark.tsx

### Goal

Create a `useBookmarkDraft` hook using `useDraft` and migrate `Bookmark.tsx` to use it.

### Success Criteria

- [ ] `useBookmarkDraft` hook exists in `frontend/src/hooks/useBookmarkDraft.ts`
- [ ] `Bookmark.tsx` uses the hook instead of inline draft logic
- [ ] ~80 lines removed from `Bookmark.tsx`
- [ ] All existing `Bookmark.test.tsx` tests pass
- [ ] New hook tests exist

### Key Changes

**Create `frontend/src/hooks/useBookmarkDraft.ts`:**

```typescript
export interface BookmarkDraftData {
  url: string
  title: string
  description: string
  content: string
  tags: string[]
  archivedAt: string
  archivePreset: ArchivePreset
  savedAt: number
}

// Similar to useNoteDraft but with bookmark-specific fields
```

**Update `Bookmark.tsx`:**
- Same changes as Note.tsx migration
- Handle additional `archivedAt` and `archivePreset` fields

### Testing Strategy

1. **Hook tests** (`frontend/src/hooks/useBookmarkDraft.test.ts`)
2. Run existing `Bookmark.test.tsx` tests
3. Manual test archive scheduling in drafts

### Dependencies

- Milestone 1 (generic `useDraft` hook)

### Risk Factors

- Bookmark has additional fields (`archivedAt`, `archivePreset`) that must be preserved in drafts

---

## Milestone 5: Create `useDiscardConfirmation` Hook

### Goal

Extract the discard confirmation pattern (3-second timeout, state management) into a reusable hook.

### Success Criteria

- [ ] `useDiscardConfirmation` hook exists in `frontend/src/hooks/useDiscardConfirmation.ts`
- [ ] Hook handles timeout, state, and reset logic
- [ ] Tests cover all state transitions

### Key Changes

**Create `frontend/src/hooks/useDiscardConfirmation.ts`:**

```typescript
interface UseDiscardConfirmationOptions {
  /** Whether the form has unsaved changes */
  isDirty: boolean
  /** Called when discard is confirmed (or when not dirty) */
  onDiscard: () => void
  /** Called when draft should be cleared */
  onClearDraft?: () => void
  /** Called to prevent navigation blocker */
  onConfirmLeave?: () => void
  /** Timeout duration in ms (default: 3000) */
  timeout?: number
}

interface UseDiscardConfirmationResult {
  /** Whether currently in confirmation state */
  isConfirming: boolean
  /** Call to request discard (starts confirmation or executes if confirming) */
  requestDiscard: () => void
  /** Reset confirmation state (e.g., on Escape key) */
  resetConfirmation: () => void
}
```

**Key behavior:**
- First call to `requestDiscard()` when dirty: sets `isConfirming = true`, starts 3s timeout
- Second call while confirming: calls `onClearDraft()`, `onConfirmLeave()`, `onDiscard()`
- Timeout expires: resets `isConfirming = false`
- `resetConfirmation()`: clears timeout, sets `isConfirming = false`

### Testing Strategy

1. **Unit tests** (`frontend/src/hooks/useDiscardConfirmation.test.ts`):
   - Test not dirty -> immediate discard
   - Test dirty -> first click sets confirming
   - Test dirty -> second click executes discard
   - Test timeout resets confirmation
   - Test `resetConfirmation()` clears state
   - Test callbacks are called in correct order

### Dependencies

None - can be done in parallel with draft hook milestones.

### Risk Factors

- Low risk - pure state logic with no external dependencies

---

## Milestone 6: Migrate All Components to Use `useDiscardConfirmation`

### Goal

Update Note.tsx, Prompt.tsx, and Bookmark.tsx to use the shared discard confirmation hook.

### Success Criteria

- [ ] All three components use `useDiscardConfirmation`
- [ ] ~30 lines removed from each component
- [ ] All existing tests pass
- [ ] Manual testing confirms behavior unchanged

### Key Changes

**For each component:**
- Remove `confirmingDiscard` state
- Remove `discardTimeoutRef`
- Remove `handleDiscardRequest` (replaced by hook's `requestDiscard`)
- Remove `resetDiscardConfirmation` (replaced by hook's `resetConfirmation`)
- Remove cleanup effect for timeout
- Update keyboard handler to use hook's methods

### Testing Strategy

1. Run all existing component tests
2. Manual test Escape key behavior
3. Manual test close button double-click behavior
4. Manual test timeout reset

### Dependencies

- Milestone 5 (`useDiscardConfirmation` hook)

### Risk Factors

- Keyboard handlers reference the discard functions - must update all references
- Component tests may mock the old functions - may need updates

---

## Summary

| Milestone | Estimated Lines Saved | Dependencies |
|-----------|----------------------|--------------|
| 1. Generic `useDraft` | Foundation | None |
| 2. Migrate `usePromptDraft` | 0 (refactor) | M1 |
| 3. `useNoteDraft` + migrate Note | ~80 | M1 |
| 4. `useBookmarkDraft` + migrate Bookmark | ~80 | M1 |
| 5. `useDiscardConfirmation` | Foundation | None |
| 6. Migrate all to discard hook | ~90 (30x3) | M5 |

**Total estimated lines saved:** ~250-300 lines

**Total new code:** ~200 lines (hooks + tests)

**Net benefit:** Reduced duplication, centralized logic, easier maintenance

---

## Appendix: Cross-Component Inconsistencies

During analysis, the following inconsistencies were identified between Note, Prompt, and Bookmark components.

### Glossary of Terms

| Term | Description |
|------|-------------|
| **Version display** | When you edit and save an entity multiple times, the backend increments a `version` number (v1, v2, v3...). Displayed in the metadata row to help users track edit history. |
| **Draft auto-save** | Every 30 seconds while editing, the component saves work-in-progress to localStorage. If the browser crashes or you accidentally close the tab, you can restore your draft when you come back. |
| **Read-only mode** | When an entity is in the trash, you can view it but not edit it. The save button is disabled and fields are grayed out. |
| **isReadOnly check** | Draft auto-save should NOT run for deleted (read-only) items because there's nothing to save. Components should check this flag before auto-saving. |
| **General error display** | A place to show errors that don't belong to a specific field (e.g., "Could not fetch metadata: timeout"). Displayed as an alert banner above the form fields. |
| **Original state tracking** | When you open an entity for editing, the component stores the "original" values so it can detect what changed (dirty state). Can be implemented via `useState` (manual updates required) or `useMemo` (automatic, derived from props). |
| **Update after save** | After successfully saving, the component must mark the form as "clean" (no unsaved changes). With `useState`, this requires calling `setOriginal(current)`. With `useMemo`, it happens automatically when props update. |

---

### Critical Issues to Fix

| Issue | Note | Prompt | Bookmark | Action |
|-------|------|--------|----------|--------|
| Version display | ✅ Shows `v{version}` | ❌ Missing | ❌ Missing | Add to Prompt & Bookmark |
| Draft isReadOnly check | ✅ Checked | ❌ **Bug** | ✅ Checked | Fix in usePromptDraft hook |
| General error display | ❌ Missing | ❌ Missing | ✅ Has `errors.general` | Add to Note & Prompt |

**Version display:** Note.tsx shows version in the metadata row (e.g., "Created Jan 1 · Updated Jan 2 · v3"). Prompt and Bookmark have versions on the backend but don't display them.

**Draft isReadOnly check:** Note and Bookmark correctly skip auto-save when `isReadOnly` is true. Prompt's hook doesn't check this flag, so it might wastefully try to save drafts for deleted prompts.

**General error display:** Bookmark has an `errors.general` field displayed as an alert banner for non-field-specific errors. Note and Prompt only have field-specific errors, so general failures have nowhere to display.

---

### State Management Pattern

| Pattern | Note | Bookmark | Prompt |
|---------|------|----------|--------|
| Original state | `useState` | `useState` | `useMemo` (cleaner) |
| Update after save | `setOriginal()` | `setOriginal()` | None (prop-driven) |

**Recommendation:** Standardize on Prompt's `useMemo` pattern - it's cleaner and avoids manual state updates after save. The `useMemo` approach derives original values from props automatically, so when the parent passes updated props after save, the form automatically becomes "clean."

---

### Validation Differences

| Validation | Note | Prompt | Bookmark | Status |
|------------|------|--------|----------|--------|
| Title/Name required | ✅ | ✅ | ❌ | **Intentional** - Bookmark uses URL as primary identifier |
| Content required | ❌ | ✅ | ❌ | **Intentional** - Only templates need content |

These differences are intentional and should remain as-is:
- **Bookmark doesn't require title:** The URL is the primary identifier, and title can be auto-fetched from the webpage.
- **Note doesn't require content:** Users may create placeholder notes with just a title.
- **Prompt requires content:** An empty template is useless.

---

### Bug: Prompt Draft Auto-save in Read-Only Mode

```typescript
// Note & Bookmark correctly check:
if (!isDirty || isReadOnly) {
  // Skip auto-save
  return
}

// Prompt's usePromptDraft does NOT receive or check isReadOnly
// Could auto-save drafts for deleted prompts!
```

**Fix:** Add `disabled` parameter to `useDraft` hook (already in Milestone 1 design). When `disabled: true`, the hook skips all auto-save operations.

---

### Recommended Additional Work

These can be addressed during the refactor or as separate tasks:

| Item | Description | Priority |
|------|-------------|----------|
| Add version display to Prompt & Bookmark | Show "v{number}" in metadata row, matching Note | Low |
| Add general error field to Note & Prompt | Add `errors.general` and alert banner for non-field-specific errors | Low |
| Standardize on useMemo for originalValues | Refactor Note and Bookmark to use `useMemo` instead of `useState` for original values | Medium (part of refactor) |
