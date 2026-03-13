# Preserve Editor State Across Note/Prompt Create-Save

## Context

When a user creates a new note or prompt, types content, and saves (Cmd+S), the content editor loses focus, cursor position, scroll position, and undo history. The user must click back into the editor to continue typing.

### Root Cause

There are three layers of remount, each independently sufficient to destroy CodeMirror state:

**Layer 1 — Route-level remount (primary cause):** `App.tsx` defines separate route entries for create and edit:

```tsx
{ path: '/app/notes/new', element: <NoteDetail /> },
{ path: '/app/notes/:id', element: <NoteDetail /> },
```

When navigating from `/app/notes/new` to `/app/notes/:id`, React Router matches a different route entry. Even though both render `<NoteDetail />`, they're different element references in different route objects. React unmounts the entire `<NoteDetail />` component and mounts a fresh instance.

**Layer 2 — JSX structure divergence:** `NoteDetail.tsx` has two return paths with different tree shapes (bare component vs Fragment wrapper), which would also cause a remount even if the routes were merged.

**Layer 3 — ContentEditor key change:** Inside `Note.tsx`, ContentEditor uses `key={`${note?.id ?? 'new'}-${contentKey}`}`. When `note` transitions from `undefined` to defined, the key changes from `"new-0"` to `"<uuid>-0"`, forcing CodeMirror to remount even if the parent components survived.

All three layers must be fixed. Fixing only one or two still results in a remount.

### Prior Work in This Branch

The `ui-improvements` branch already contains correct fixes for a related but separate issue — **existing items losing focus during save**:

- `CodeMirrorEditor.tsx` and `ContentEditor.tsx`: Added `readOnly` prop (maps to CodeMirror's `readOnly` facet — keeps editor focusable but prevents modification during save)
- `Note.tsx`, `Prompt.tsx`, `Bookmark.tsx`: Changed `disabled={isSaving || isReadOnly}` to `disabled={isReadOnly}` + `readOnly={isSaving}` on ContentEditor; removed the `refocusAfterSaveRef` workaround
- `NoteDetail.tsx`, `PromptDetail.tsx`: Added `autoFocusContent` to navigation state and props (workaround for the remount — to be removed by this plan)
- `Note.tsx`, `Prompt.tsx`: Added `autoFocusContent` prop passed as `autoFocus` to ContentEditor
- `CodeMirrorEditor.tsx`: Added `selection={{ anchor: initialValue.length }}` when `autoFocus` is true (cursor-at-end workaround — to be removed by this plan)

**What stays:** The `readOnly` prop, `disabled={isReadOnly}`, and `refocusAfterSaveRef` removal. These are the correct fix for existing-item saves regardless of this refactor.

**What this plan removes:** The `autoFocus`/`autoFocusContent`/`selection` plumbing, which is a workaround for the remount. Eliminating the remount makes it unnecessary.

### Scope

- **App.tsx** — merge duplicate route entries
- **NoteDetail.tsx** and **PromptDetail.tsx** — unify render paths
- **Note.tsx** and **Prompt.tsx** — fix ContentEditor key, add document-switch detection to sync effect, add edit→create reset effect, remove `autoFocusContent` prop
- **ContentEditor.tsx** and **CodeMirrorEditor.tsx** — remove `autoFocus`/`selection` workaround
- **BookmarkDetail.tsx** — no changes (bookmarks close on create; no remount issue)

---

## Code Documentation Requirements

The changes in this plan involve non-obvious architectural decisions that future developers or AI agents could easily undo, reintroducing the bug. Add clear comments at these critical locations:

1. **App.tsx route entries:** Explain why notes/prompts use a single `:id` route instead of separate `/new` and `/:id` routes (router-level remount).
2. **NoteDetail/PromptDetail unified render:** Explain why there's no `key` on the component and no separate create/edit return paths (component remount destroys editor state).
3. **Note/Prompt sync effect `isDocumentSwitch`:** Explain the distinction between create→edit (preserve editor) and document switch (reset editor), and why content-diff alone is insufficient.
4. **Note/Prompt ContentEditor `key={contentKey}`:** Explain why `note?.id` is intentionally excluded from the key, with a warning not to add it back.
5. **Note/Prompt edit→create reset effect:** Explain why a separate effect resets form state when transitioning from edit mode back to create mode, and why it needs `initialTags`/`initialRelationships` in its dependency array.

The code snippets in the implementation outline below include the expected comments. These are not optional — they are part of the implementation.

---

## Milestone 1: Merge Route Entries and Unify NoteDetail Render Path

### Goal & Outcome

Eliminate all three remount layers for notes. After this milestone:

- User creates a note, types content, presses Cmd+S — cursor stays in place, scroll position preserved, undo history intact
- User can immediately continue typing after save without clicking back into the editor
- Navigating between existing notes (note A → note B) still resets the editor, even when content is identical
- Navigating from an existing note to "New Note" resets the form with fresh state (including initialTags/initialRelationships from navigation state)
- All existing note functionality (edit, archive, delete, restore, history, stale check, conflict resolution) works identically

### Implementation Outline

#### Step 1: Merge route entries in App.tsx

Delete the separate `/app/notes/new` route entry. The `:id` route already matches `"new"` as a param value, and `NoteDetail` already handles `id === 'new'` via `const isCreate = !id || id === 'new'`.

Before:
```tsx
{ path: '/app/notes/new', element: <NoteDetail /> },
{ path: '/app/notes/:id', element: <NoteDetail /> },
```

After:
```tsx
// Single route handles both create (id="new") and edit (id=UUID).
// This is intentional — separate routes cause React Router to unmount/remount
// the component when navigating from /new to /:id, destroying editor state.
{ path: '/app/notes/:id', element: <NoteDetail /> },
```

Verify: search codebase for any `Link` or `navigate` calls pointing to `/app/notes/new` — these still work fine since `new` is matched as the `:id` param.

#### Step 2: Unify NoteDetail return paths

Read the current two return paths carefully (create mode ~line 268-282, edit mode ~line 292-323) and understand every prop difference between them.

Merge into a single return path:
- Always wrap in Fragment (to accommodate HistorySidebar for existing notes)
- Remove `key` from NoteComponent entirely — document switching is handled by the sync effect + ContentEditor key (see Step 3)
- Conditionally pass edit-only props (they default to `undefined` which is already handled):
  ```tsx
  {/* Single render path for both create and edit modes.
    * No key prop — the component stays mounted across the create→edit transition
    * (when onSave navigates from /notes/new to /notes/:id), preserving CodeMirror
    * state (focus, cursor, scroll, undo). Document switching between different
    * existing notes is handled by the sync effect + ContentEditor key inside Note.tsx. */}
  <NoteComponent
    note={effectiveNote ?? undefined}
    onArchive={!isCreate && viewState === 'active' ? handleArchive : undefined}
    onDelete={!isCreate ? handleDelete : undefined}
    // ... etc
  />
  ```
- `isSaving` should use `createMutation.isPending || updateMutation.isPending` (only one can be true at a time, but avoids branching)
- `initialTags`, `initialRelationships`, `initialLinkedItems` can always be passed — they're only consumed during initial `useState` calls and ignored after mount
- Do not pass `autoFocusContent` — it will be removed in Milestone 3

Remove the `autoFocusContent` field from the `locationState` type and from the `navigate()` call in `handleSave`.

Handle the `effectiveNote` null check: currently the edit path guards with `if (!effectiveNote) return <ErrorState>`. In the unified path, `effectiveNote` is `null` for create mode, which is fine — pass `undefined` to NoteComponent's `note` prop. Move the error guard to only apply when `!isCreate && !effectiveNote`.

#### Step 3: Fix ContentEditor key and sync effect in Note.tsx

**The problem:** ContentEditor uses `key={`${note?.id ?? 'new'}-${contentKey}`}`. On create→edit, this changes from `"new-0"` to `"<uuid>-0"`, remounting CodeMirror and destroying editor state.

**Why we can't just use `key={contentKey}`:** The `contentKey` increment is driven by `needsEditorReset` in the sync effect, which is content-diff based: `(note.content ?? '') !== currentContentRef.current`. If two different notes have identical content, the editor wouldn't reset on document switch — preserving the wrong undo history and cursor position.

**The fix has two parts:**

**Part A — Add document-switch detection to the sync effect:**

Add a ref to track the previous note ID and use it to detect true document switches (navigating between existing notes) vs create→edit transitions:

```tsx
// Track previous note ID to distinguish create→edit transitions (which should
// preserve editor state) from document switches (which must reset the editor).
// See the sync effect below for how this is used.
const previousNoteIdRef = useRef<string | undefined>(note?.id)
```

In the sync effect, force editor reset on document switch regardless of content equality:

```tsx
useEffect(() => {
  if (!note) return
  // ... existing skipSyncForUpdatedAtRef logic ...

  // Detect document switch: navigating between two existing notes (UUID A → UUID B).
  // This forces an editor reset even when content is identical, because undo history
  // and cursor position belong to the previous document.
  // Create→edit (undefined → UUID) is NOT a document switch — the user just saved
  // what they were typing, so editor state (focus, cursor, scroll, undo) is preserved.
  const isDocumentSwitch = previousNoteIdRef.current !== undefined && note.id !== previousNoteIdRef.current
  const needsEditorReset = isDocumentSwitch || (note.content ?? '') !== currentContentRef.current
  previousNoteIdRef.current = note.id
  syncStateFromNote(note, needsEditorReset)
}, [note?.id, note?.updated_at, syncStateFromNote])
```

Key distinction:
- **Create→edit** (`previousNoteIdRef.current` is `undefined` → UUID): `isDocumentSwitch` is `false`. Content matches → `needsEditorReset` is `false` → no remount. Editor state preserved.
- **Document switch** (UUID A → UUID B, even with identical content): `isDocumentSwitch` is `true` → `needsEditorReset` is `true` → `contentKey` increments → editor remounts with fresh state.

**Part B — Simplify ContentEditor key:**

Change from:
```tsx
<ContentEditor key={`${note?.id ?? 'new'}-${contentKey}`} ... />
```

To:
```tsx
{/* Key uses contentKey only (not note?.id) so that the create→edit transition
  * does NOT remount CodeMirror. The sync effect above handles incrementing
  * contentKey for all cases that need a remount: document switch between
  * existing notes, version restore, and conflict resolution.
  * DO NOT add note?.id back to this key — it would destroy editor state on save. */}
<ContentEditor key={contentKey} ... />
```

This is now safe because Part A ensures `contentKey` increments for all cases that need a remount (document switch, version restore, conflict resolution), including the identical-content edge case.

**Timing chain verification (create→edit):** When the user saves a new note, `handleSave` calls `navigate(`/app/notes/${createdNote.id}`, { replace: true, state: { note: createdNote } })`. This changes the `:id` param from `"new"` to the UUID. NoteDetail re-renders: `isCreate` becomes `false`, the fetch effect runs and hits the `passedNote` path (since `passedPrompt.id === promptId`), calling `setNote(passedNote)`. The `note` prop flows into Note.tsx, triggering the sync effect. Since `previousNoteIdRef.current` is `undefined` (was in create mode) and the content matches what the user typed, `isDocumentSwitch` is `false` and `needsEditorReset` is `false`. Editor state is preserved. This chain has been verified to be safe.

#### Step 4: Add edit→create reset effect in Note.tsx

**The problem:** With the unified render path (no `key` on NoteComponent), navigating from an existing note (e.g., `/app/notes/123`) to create mode (`/app/notes/new`) keeps the component mounted. The sync effect has `if (!note) return` and won't clear state. `useState(getInitialState)` only runs on initial mount. Without a reset, the user would see the previous note's title, content, and tags in the "new note" form.

**The fix:** Add a separate `useEffect` that detects the edit→create transition and resets form state:

```tsx
// Reset form state when transitioning from edit mode to create mode.
// Without this, navigating from /notes/:id to /notes/new would keep the
// previous note's state because useState(getInitialState) only runs on mount
// and the sync effect skips when note is undefined.
// Dependencies include initialTags and initialRelationships so that
// prepopulation from quick-create flows (sidebar, linked content) works correctly.
useEffect(() => {
  if (note) {
    // In edit mode — nothing to reset. The sync effect handles edit→edit.
    return
  }
  if (previousNoteIdRef.current === undefined) {
    // Was already in create mode (or initial mount) — no transition to handle.
    return
  }
  // Edit → create transition: reset form to fresh create-mode state.
  previousNoteIdRef.current = undefined
  const freshState: NoteState = {
    title: '',
    description: '',
    content: '',
    tags: initialTags ?? [],
    relationships: initialRelationships ?? [],
    archived_at: null,
  }
  setOriginal(freshState)
  setCurrent(freshState)
  setErrors({})
  setContentKey(prev => prev + 1)
}, [note, initialTags, initialRelationships])
```

Key distinctions:
- **Edit→create** (`previousNoteIdRef.current` is UUID, `note` is `undefined`): resets form with fresh state, increments `contentKey` to reset editor
- **Create→edit** (`previousNoteIdRef.current` is `undefined`, `note` becomes defined): handled by the sync effect in Step 3, not this effect
- **Initial create mount** (`previousNoteIdRef.current` is `undefined`, `note` is `undefined`): no-op, `useState(getInitialState)` already initialized correctly

This is a separate effect from the sync effect (Step 3) because it handles a fundamentally different transition direction with different concerns (reading `initialTags`/`initialRelationships` props vs syncing from a note object).

### Testing Strategy

**Update existing tests in `NoteDetail.test.tsx`:**

- Merge the test route table to use a single route entry (`<Route path="/app/notes/:id" element={<NoteDetail />} />`), matching the actual App.tsx route structure. This ensures tests reproduce real routing behavior — separate route entries mask remount bugs.
- Update the `mockNavigate` assertion to no longer include `autoFocusContent` in the state
- Remove `autoFocusContent` from any location state in tests

**Add/verify these test cases:**

- Create a note → save → verify `navigate` is called with `{ replace: true, state: { note: createdNote, returnTo: ... } }` (no `autoFocusContent`)
- Verify the NoteComponent receives `note={undefined}` in create mode
- Verify edit-only props (`onArchive`, `onDelete`, `onShowHistory`, etc.) are `undefined` in create mode
- Verify `isSaving` reflects `createMutation.isPending` during create and `updateMutation.isPending` during edit
- Existing tests for edit, archive, delete, restore, history, stale check, conflict resolution should all continue to pass without modification

---

## Milestone 2: Unify PromptDetail Render Path

### Goal & Outcome

Same as Milestone 1, but for prompts. After this milestone:

- Prompt creation preserves editor state (focus, cursor, scroll, undo) across save
- All existing prompt functionality works identically

### Implementation Outline

#### Step 1: Merge route entry in App.tsx

Delete the separate `/app/prompts/new` route entry. Same pattern as notes.

#### Step 2: Unify PromptDetail return paths

Apply the same pattern as NoteDetail (Milestone 1). The structure is nearly identical:

1. Merge the two return paths into one
2. Remove `key` from PromptComponent
3. Conditionally pass edit-only props
4. Remove `autoFocusContent` from location state type and `navigate()` call
5. Handle `effectivePrompt` null for create mode (pass `undefined`)

The prompt-specific differences to account for:
- `handleNameConflict` error handling in `handleSave` — stays as-is, orthogonal to the render path
- The prompt has a `name` field (monospace) in addition to `title` — no impact on this refactor

#### Step 3: Fix ContentEditor key and sync effect in Prompt.tsx

Same pattern as Note.tsx (Milestone 1, Step 3):
- Add `previousPromptIdRef` to detect document switches
- Update sync effect to force editor reset on document switch
- Change ContentEditor key from `key={`${prompt?.id ?? 'new'}-${contentKey}`}` to `key={contentKey}`

#### Step 4: Add edit→create reset effect in Prompt.tsx

Same pattern as Note.tsx (Milestone 1, Step 4):
- Add a separate `useEffect` that detects edit→create transition and resets form state
- Include `initialTags` and `initialRelationships` in the dependency array for prepopulation
- Reset `previousPromptIdRef.current` to `undefined`
- Increment `contentKey` to reset the editor
- Use prompt-specific initial state (e.g., `DEFAULT_PROMPT_CONTENT` for content)

### Testing Strategy

Same pattern as Milestone 1, applied to `PromptDetail.test.tsx`:

- Merge the test route table to a single route entry, matching actual App.tsx
- Update navigate assertion to remove `autoFocusContent` from state
- Verify create and edit mode prop passing
- Ensure existing prompt tests (edit, archive, delete, restore, name conflict, history) all pass

---

## Milestone 3: Remove autoFocus/autoFocusContent Workaround

### Goal & Outcome

Clean up the workaround code that is no longer needed now that the remount is eliminated. After this milestone:

- No `autoFocusContent` prop on Note or Prompt components
- No `autoFocus` or `selection` workaround in CodeMirrorEditor
- ContentEditor's `autoFocus` prop is removed
- Code is simpler with fewer props to maintain

### Implementation Outline

**Note.tsx:**
- Remove `autoFocusContent` from `NoteProps` interface and destructuring
- Remove `autoFocus={autoFocusContent}` from the ContentEditor usage

**Prompt.tsx:**
- Same as Note.tsx — remove `autoFocusContent` from props and ContentEditor usage

**ContentEditor.tsx:**
- Remove `autoFocus` from `ContentEditorProps` interface, destructuring, and the pass-through to CodeMirrorEditor

**CodeMirrorEditor.tsx:**
- Remove `autoFocus` from `CodeMirrorEditorProps` interface and destructuring
- Remove `autoFocus={autoFocus}` from the `<CodeMirror>` component
- Remove `selection={autoFocus ? { anchor: initialValue.length } : undefined}` from the `<CodeMirror>` component
- Note: The `autoFocus` prop on CodeMirrorEditor was pre-existing (before our changes) but was only used by the now-removed `shouldAutoFocus` mode-toggle logic (commented out in ContentEditor.tsx). Verify no other callers pass `autoFocus` to CodeMirrorEditor before removing.

**ContentEditor.tsx and CodeMirrorEditor.tsx — stale comment cleanup:**
- Check for any existing comments referencing key strategy, remount behavior, or the old `note?.id`-based key pattern
- Update or remove any comments that are now outdated by the Milestone 1/2 changes

### Testing Strategy

- Run the full test suite — all tests should pass
- No new tests needed; this is purely removing dead code
- Verify no compile errors or missing prop warnings

---

## Verification Checklist (All Milestones Complete)

After all three milestones, manually verify:

1. **New note:** Create a note, type several paragraphs, press Cmd+S — cursor stays in place, can keep typing immediately, scroll position unchanged, undo (Cmd+Z) still works for pre-save edits
2. **New prompt:** Same as above for prompts
3. **Existing note edit:** Open a note, edit content, press Cmd+S — cursor stays, editor remains focused (readOnly during save, not disabled)
4. **Existing prompt edit:** Same as above
5. **Existing bookmark edit:** Open a bookmark with content expanded, edit, press Cmd+S — same behavior
6. **Deleted note:** Open a deleted note — content editor is non-interactive (disabled, not just readOnly)
7. **Navigation between notes:** Open note A, then navigate to note B — editor resets with note B's content, even if both notes have identical content (fresh undo history, cursor at default position)
8. **Navigation via linked content:** Click a linked note from within a note — editor resets properly for the new document
9. **New bookmark:** Create a bookmark — page closes as expected (no behavior change)
10. **Edit→create transition:** Open an existing note, then click "New Note" in sidebar — form resets to empty (no stale data from previous note), initialTags from current filter are applied
11. **Edit→create with prepopulation:** From an existing note, quick-create a linked note — new note form has correct initialRelationships, not data from the previous note
