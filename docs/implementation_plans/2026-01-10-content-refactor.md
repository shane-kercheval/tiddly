# Content Component Refactor: Simplify and Extract Shared Logic

## Overview

Simplify `Note.tsx`, `Prompt.tsx`, and `Bookmark.tsx` by removing unnecessary complexity and extracting duplicated logic.

### Goals

1. Remove draft auto-save functionality (unnecessary given existing unsaved changes warnings)
2. Extract duplicated discard confirmation logic into a reusable hook

### Current State

| Component | Lines | Draft Auto-save | Discard Confirmation |
|-----------|-------|-----------------|---------------------|
| Note.tsx | 729 | ~80 lines | ~30 lines |
| Prompt.tsx | 780 | ~80 lines (in usePromptDraft hook) | ~30 lines |
| Bookmark.tsx | 935 | ~80 lines | ~30 lines |

---

## Milestone 1: Remove Draft Auto-save from Note.tsx

### What is draft auto-save?

Every 30 seconds while editing, the component saves work-in-progress to localStorage. If the browser crashes, users can restore their draft when they return. This adds significant complexity:

- `getDraftKey()`, `loadDraft()`, `saveDraft()`, `clearDraft()` helper functions
- `DraftData` interface
- `hasDraft` state with complex initialization logic
- `draftTimerRef` for the 30-second interval
- Auto-save `useEffect` with cleanup
- "Restore Draft" / "Discard" UI banner
- Draft clearing on save and discard

### Why remove it?

The app already has two protections for unsaved changes:
- **`beforeunload`**: Browser warns when closing tab/browser with unsaved changes
- **Navigation blocker**: App warns when navigating away with unsaved changes

Draft auto-save only helps if the browser crashes or is force-killed - a rare edge case that doesn't justify ~80 lines of complexity per component.

### Changes to Note.tsx

Remove the following:

```typescript
// Remove these constants and interfaces
const DRAFT_KEY_PREFIX = 'note_draft_'
interface DraftData { ... }

// Remove these helper functions
function getDraftKey(noteId?: string): string { ... }
function loadDraft(noteId?: string): DraftData | null { ... }
function saveDraft(noteId: string | undefined, data: DraftData): void { ... }
function clearDraft(noteId?: string): void { ... }

// Remove from component:
const [hasDraft, setHasDraft] = useState(() => { ... })  // Complex initialization
const draftTimerRef = useRef<...>(null)

// Remove auto-save useEffect (the one with 30000ms interval)

// Remove draft restoration callbacks
const restoreDraft = useCallback(...)
const discardDraft = useCallback(...)

// Remove clearDraft() calls from handleDiscardRequest and handleSubmit

// Remove draft restoration UI banner
{hasDraft && !isReadOnly && (
  <div className="alert-info">...</div>
)}
```

### Success Criteria

- [ ] All draft-related code removed from Note.tsx
- [ ] ~80 lines removed
- [ ] Component still saves/loads correctly
- [ ] Unsaved changes warnings still work (beforeunload + navigation blocker)
- [ ] All existing tests pass (remove any draft-specific tests)

### Testing Strategy

1. Remove any tests that specifically test draft functionality
2. Run existing Note.test.tsx tests - all should pass
3. Manual test: Edit a note, try to close tab → should see browser warning
4. Manual test: Edit a note, try to navigate away → should see app warning

---

## Milestone 2: Remove Draft Auto-save from Bookmark.tsx

### Changes to Bookmark.tsx

Same pattern as Note.tsx - remove:

- `DRAFT_KEY_PREFIX`, `DraftData` interface
- `getDraftKey()`, `loadDraft()`, `saveDraft()`, `clearDraft()` functions
- `hasDraft` state and initialization
- `draftTimerRef`
- Auto-save `useEffect`
- `restoreDraft()`, `discardDraft()` callbacks
- `clearDraft()` calls in handlers
- Draft restoration UI banner

### Success Criteria

- [ ] All draft-related code removed from Bookmark.tsx
- [ ] ~80 lines removed
- [ ] All existing tests pass
- [ ] Unsaved changes warnings still work

---

## Milestone 3: Remove usePromptDraft Hook and Draft Code from Prompt.tsx

### What's different about Prompt?

Prompt.tsx uses a custom `usePromptDraft` hook instead of inline draft logic. We need to:
1. Remove the hook usage from Prompt.tsx
2. Delete the usePromptDraft hook file entirely
3. Remove any tests for the hook

### Changes to Prompt.tsx

```typescript
// Remove import
import { usePromptDraft } from '../hooks/usePromptDraft'
import type { DraftData } from '../hooks/usePromptDraft'

// Remove hook usage
const { hasDraft, isDirty, restoreDraft, discardDraft, clearDraft } = usePromptDraft({...})

// Add back inline isDirty computation (copy from Note.tsx pattern)
const isDirty = useMemo(() =>
  current.name !== originalValues.name ||
  current.title !== originalValues.title ||
  // ... etc
, [current, originalValues])

// Remove clearDraft() calls
// Remove draft restoration UI banner
```

### Files to Delete

- `frontend/src/hooks/usePromptDraft.ts`
- `frontend/src/hooks/usePromptDraft.test.ts` (if exists)

### Success Criteria

- [ ] usePromptDraft hook deleted
- [ ] Prompt.tsx no longer uses draft functionality
- [ ] isDirty computed inline in Prompt.tsx
- [ ] All existing Prompt.test.tsx tests pass
- [ ] Unsaved changes warnings still work

---

## Milestone 4: Extract useDiscardConfirmation Hook

### What is discard confirmation?

When users click Close/Escape with unsaved changes, the button shows "Discard?" for 3 seconds. Clicking again confirms the discard. This prevents accidental data loss.

All three components implement this identically:

```typescript
// State
const [confirmingDiscard, setConfirmingDiscard] = useState(false)
const discardTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

// Handler
const handleDiscardRequest = useCallback((): void => {
  if (discardTimeoutRef.current) {
    clearTimeout(discardTimeoutRef.current)
    discardTimeoutRef.current = null
  }
  if (!isDirty) {
    onClose()
    return
  }
  if (confirmingDiscard) {
    confirmLeave()
    onClose()
  } else {
    setConfirmingDiscard(true)
    discardTimeoutRef.current = setTimeout(() => {
      setConfirmingDiscard(false)
    }, 3000)
  }
}, [isDirty, confirmingDiscard, onClose, confirmLeave])

// Reset function
const resetDiscardConfirmation = useCallback((): void => {
  if (discardTimeoutRef.current) {
    clearTimeout(discardTimeoutRef.current)
    discardTimeoutRef.current = null
  }
  setConfirmingDiscard(false)
}, [])

// Cleanup effect
useEffect(() => {
  return () => {
    if (discardTimeoutRef.current) {
      clearTimeout(discardTimeoutRef.current)
    }
  }
}, [])
```

### Create useDiscardConfirmation Hook

**File:** `frontend/src/hooks/useDiscardConfirmation.ts`

```typescript
interface UseDiscardConfirmationOptions {
  /** Whether the form has unsaved changes */
  isDirty: boolean
  /** Called when discard is confirmed (or when not dirty) */
  onDiscard: () => void
  /** Called to prevent navigation blocker from showing */
  onConfirmLeave?: () => void
  /** Timeout duration in ms (default: 3000) */
  timeout?: number
}

interface UseDiscardConfirmationResult {
  /** Whether currently showing "Discard?" confirmation */
  isConfirming: boolean
  /** Call to request discard - first call shows confirmation, second call executes */
  requestDiscard: () => void
  /** Reset confirmation state (e.g., when Escape is pressed during confirmation) */
  resetConfirmation: () => void
}

export function useDiscardConfirmation(options: UseDiscardConfirmationOptions): UseDiscardConfirmationResult {
  // Implementation moves here from components
}
```

### Usage in Components

```typescript
// Before (in each component)
const [confirmingDiscard, setConfirmingDiscard] = useState(false)
const discardTimeoutRef = useRef<...>(null)
const handleDiscardRequest = useCallback(() => { ... }, [...])
const resetDiscardConfirmation = useCallback(() => { ... }, [])
useEffect(() => { return () => { /* cleanup */ } }, [])

// After
const { isConfirming, requestDiscard, resetConfirmation } = useDiscardConfirmation({
  isDirty,
  onDiscard: onClose,
  onConfirmLeave: confirmLeave,
})

// Update references:
// - confirmingDiscard → isConfirming
// - handleDiscardRequest → requestDiscard
// - resetDiscardConfirmation → resetConfirmation
```

### Success Criteria

- [ ] `useDiscardConfirmation` hook created with tests
- [ ] All three components use the hook
- [ ] ~30 lines removed from each component (~90 total)
- [ ] All existing component tests pass
- [ ] Manual test: Close button shows "Discard?" on first click, closes on second
- [ ] Manual test: "Discard?" resets after 3 seconds
- [ ] Manual test: Escape during confirmation resets state

### Testing Strategy for Hook

**File:** `frontend/src/hooks/useDiscardConfirmation.test.ts`

Test cases:
1. When not dirty, `requestDiscard()` calls `onDiscard()` immediately
2. When dirty, first `requestDiscard()` sets `isConfirming: true`
3. When dirty and confirming, second `requestDiscard()` calls `onConfirmLeave()` then `onDiscard()`
4. After 3 seconds, `isConfirming` resets to `false`
5. `resetConfirmation()` clears timeout and sets `isConfirming: false`
6. Cleanup clears timeout on unmount

---

## Summary

| Milestone | Changes | Lines Removed |
|-----------|---------|---------------|
| 1. Remove draft from Note | Delete draft code | ~80 |
| 2. Remove draft from Bookmark | Delete draft code | ~80 |
| 3. Remove draft from Prompt | Delete hook + draft code | ~80 + ~220 (hook) |
| 4. Extract useDiscardConfirmation | Create hook, update 3 components | ~90 (net) |

**Total lines removed:** ~450
**Total lines added:** ~80 (new hook + tests)
**Net reduction:** ~370 lines
