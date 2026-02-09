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

## Pre-Implementation: Verify Draft Code Touchpoints

Before starting, search the codebase to ensure we're not missing any files that depend on draft functionality.

### Search Commands

```bash
# Search for draft-related patterns
grep -r "DRAFT_KEY_PREFIX" frontend/src/
grep -r "usePromptDraft" frontend/src/
grep -r "loadDraft\|saveDraft\|clearDraft" frontend/src/
grep -r "note_draft_\|bookmark_draft_\|prompt_draft_" frontend/src/
```

### Expected Results

- `Note.tsx` - inline draft code
- `Bookmark.tsx` - inline draft code
- `Prompt.tsx` - uses `usePromptDraft` hook
- `hooks/usePromptDraft.ts` - the hook itself
- `Note.test.tsx` - draft recovery tests
- `Bookmark.test.tsx` - draft recovery tests (if any)
- `hooks/usePromptDraft.test.ts` - hook tests (if exists)

If other files appear, assess whether they need updates.

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

### Cleanup Orphaned localStorage Drafts

Add a one-time cleanup on component mount to remove any existing drafts from localStorage. This prevents orphaned data from accumulating.

```typescript
// Add to component initialization (useEffect with empty deps)
useEffect(() => {
  // Clean up any orphaned drafts from previous versions
  const keysToRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith('note_draft_')) {
      keysToRemove.push(key)
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key))
}, [])
```

### Success Criteria

- [ ] All draft-related code removed from Note.tsx
- [ ] Orphaned draft cleanup added
- [ ] ~80 lines removed (net, after adding cleanup)
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

### Cleanup Orphaned localStorage Drafts

Add the same cleanup pattern as Note.tsx:

```typescript
useEffect(() => {
  // Clean up any orphaned drafts from previous versions
  const keysToRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith('bookmark_draft_')) {
      keysToRemove.push(key)
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key))
}, [])
```

### Success Criteria

- [ ] All draft-related code removed from Bookmark.tsx
- [ ] Orphaned draft cleanup added
- [ ] ~80 lines removed (net)
- [ ] All existing tests pass
- [ ] Unsaved changes warnings still work

---

## Milestone 3: Remove usePromptDraft Hook and Draft Code from Prompt.tsx

### What's different about Prompt?

Prompt.tsx uses a custom `usePromptDraft` hook instead of inline draft logic. We need to:
1. Remove the hook usage from Prompt.tsx
2. Delete the usePromptDraft hook file entirely
3. Remove any tests for the hook
4. Add inline `isDirty` computation (the hook currently provides this)
5. Update `originalValues` after successful save (so form becomes "clean")

### Changes to Prompt.tsx

```typescript
// Remove import
import { usePromptDraft } from '../hooks/usePromptDraft'
import type { DraftData } from '../hooks/usePromptDraft'

// Remove hook usage
const { hasDraft, isDirty, restoreDraft, discardDraft, clearDraft } = usePromptDraft({...})

// Add back inline isDirty computation
// IMPORTANT: Use array comparison for tags, not tags_as_csv
// Match the existing pattern from usePromptDraft hook
const isDirty = useMemo(() =>
  current.name !== originalValues.name ||
  current.title !== originalValues.title ||
  current.content !== originalValues.content ||
  current.description !== originalValues.description ||
  current.tags.length !== originalValues.tags.length ||
  current.tags.some((tag, i) => tag !== originalValues.tags[i]) ||
  current.arguments.length !== originalValues.arguments.length ||
  JSON.stringify(current.arguments) !== JSON.stringify(originalValues.arguments)
, [current, originalValues])

// Remove clearDraft() calls
// Remove draft restoration UI banner
```

### Convert originalValues from useMemo to useState

Currently `originalValues` is a `useMemo` in Prompt.tsx. To update it after save, convert to `useState`:

```typescript
// Before (useMemo - not settable)
const originalValues = useMemo(() => ({
  name: prompt?.name ?? '',
  // ...
}), [prompt])

// After (useState - can call setOriginal)
const [original, setOriginal] = useState(() => ({
  name: prompt?.name ?? '',
  title: prompt?.title ?? '',
  content: cleanMarkdown(prompt?.content ?? ''),
  description: prompt?.description ?? '',
  tags: prompt?.tags ?? initialTags,
  arguments: prompt?.arguments ?? [],
}))
```

### Update original After Save

After a successful save, update `original` to match `current` so the form becomes "clean" (isDirty = false). Without this, the Save button would remain enabled after saving.

```typescript
// In handleSubmit, after successful save:
setOriginal({
  name: current.name,
  title: current.title,
  content: current.content,
  description: current.description,
  tags: current.tags,
  arguments: current.arguments,
})
```

### Cleanup Orphaned localStorage Drafts

Add the same cleanup pattern:

```typescript
useEffect(() => {
  // Clean up any orphaned drafts from previous versions
  const keysToRemove: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith('prompt_draft_')) {
      keysToRemove.push(key)
    }
  }
  keysToRemove.forEach(key => localStorage.removeItem(key))
}, [])
```

### Files to Delete

- `frontend/src/hooks/usePromptDraft.ts`
- `frontend/src/hooks/usePromptDraft.test.ts` (if exists)

### Success Criteria

- [ ] usePromptDraft hook deleted
- [ ] Prompt.tsx no longer uses draft functionality
- [ ] isDirty computed inline in Prompt.tsx (including arguments comparison)
- [ ] originalValues updated after successful save
- [ ] Orphaned draft cleanup added
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
| 1. Remove draft from Note | Delete draft code, add cleanup | ~80 |
| 2. Remove draft from Bookmark | Delete draft code, add cleanup | ~80 |
| 3. Remove draft from Prompt | Delete hook + draft code, add cleanup | ~80 + ~220 (hook) |
| 4. Extract useDiscardConfirmation | Create hook, update 3 components | ~90 (net) |

**Total lines removed:** ~450
**Total lines added:** ~100 (new hook + tests + cleanup code)
**Net reduction:** ~350 lines

---

## Appendix: Decisions and Alternatives Not Taken

This section documents feedback considered but intentionally not incorporated, and why.

### 1. Keep draft auto-save for crash recovery

**Suggestion:** Keep draft auto-save because browser crashes, OS kills, or hard reloads would lose work without recovery.

**Decision:** Proceed with removal.

**Rationale:**
- Modern browsers are extremely stable - crashes are rare edge cases
- Users can manually save frequently (Cmd+S works)
- The complexity cost (~300 lines across 3 components + hook) doesn't justify the edge case
- We already have `beforeunload` and navigation blockers for the common cases (tab close, navigation)
- If users complain post-release, we can revisit with a simpler implementation

### 2. Extract a generic useDraftAutoSave hook instead of removal

**Suggestion:** Instead of removing draft functionality, extract it into a shared hook that all three components use.

**Decision:** Remove entirely rather than extract.

**Rationale:**
- Extracting still maintains ~80 lines of hook code plus integration in each component
- The feature solves a rare edge case (browser crash) that doesn't justify ongoing maintenance
- Simpler to remove now and add back later if needed than to maintain unused complexity

### 3. Extract useContentEditor mega-hook

**Suggestion:** Consolidate more duplicated patterns into a single hook: isDirty computation, beforeunload handler, keyboard shortcuts, discard confirmation, and form submission coordination. This could remove ~150 lines per component.

**Decision:** Stick with focused, single-purpose hooks.

**Rationale:**
- The three components have meaningful differences (Bookmark has URL/metadata, Prompt has arguments/tags_as_csv, Note has description)
- A mega-hook would either be complex with many config options or force artificial uniformity
- `useDiscardConfirmation` is the right level of abstraction - single purpose, easy to understand
- Can revisit consolidation as a follow-up if the initial refactor succeeds

### 4. Add telemetry before removing draft functionality

**Suggestion:** Add analytics to measure draft recovery usage before removing the feature.

**Decision:** Skip telemetry, proceed with removal.

**Rationale:**
- Adds complexity and delays the cleanup
- The feature has existed for a while - if it were critical, we'd have heard user complaints
- We can add it back if users request it post-removal
