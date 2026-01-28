# Implementation Plan: Add Tags from List/Filter View

**Date:** 2026-01-27

**Jira:** KAN-31

## Overview

Users can currently remove tags from list view by clicking the X on tag chips, but cannot add tags without opening the detail view. This feature adds a `+` button at the end of each card's tag row that opens a dropdown with tag autocomplete, allowing immediate tag addition.

**No backend changes required** — the existing `PATCH /{type}/{id}` endpoints already accept a full `tags` array.

## Current Behavior

- Tag chips render in `BookmarkCard`, `NoteCard`, `PromptCard` via the `Tag` component
- Each chip has an X button (visible on hover) that calls `onTagRemove` → filters the tag out → fires `PATCH /{type}/{id}` with the new array
- Handlers live in `AllContent.tsx` (`handleTagRemoveBookmark`, etc.)
- Tag suggestions are available via `useTagsStore()` (already consumed in `AllContent.tsx`)
- The detail view has `InlineEditableTags` with a `+ Tags` button, but it bundles changes into a form save — not suitable for the immediate-commit UX needed here

## Solution

Add an `AddTagButton` component that renders a compact `+` button after the tag chips. Clicking it opens a small dropdown with a text input and filtered suggestions. Selecting a tag immediately fires the PATCH mutation (same pattern as tag removal).

---

## Milestone 1: AddTagButton Component

### Goal
Create a reusable `AddTagButton` component that renders a `+` button which, when clicked, shows a dropdown with tag autocomplete.

### Key Changes

**New file: `frontend/src/components/AddTagButton.tsx`**

This is intentionally a new component, not a reuse of `InlineEditableTags`. That component has form-based semantics (tags are edited locally and only persisted on form save). The list view needs immediate-commit behavior: pick a tag → PATCH fires right away, matching how tag removal already works.

However, `AddTagButton` **must** compose the existing `useTagAutocomplete` hook (`frontend/src/hooks/useTagAutocomplete.ts`) for all autocomplete logic — input state, suggestion filtering, validation (`validateTag`/`normalizeTag` from `utils.ts`), duplicate detection, keyboard navigation, and error state. The component itself only manages the button/dropdown UI; the hook handles everything else. This ensures tag validation rules stay consistent with the detail view.

Props interface:
```typescript
interface AddTagButtonProps {
  existingTags: string[]
  suggestions: TagCount[]
  onAdd: (tag: string) => void
}
```

Behavior:
- Renders a small `+` button styled to match existing tag chips (`badge-secondary`)
- On click, shows an absolutely-positioned dropdown containing:
  - A text input (auto-focused) for filtering/typing a new tag
  - A list of matching suggestions, excluding `existingTags` (via `filteredSuggestions` from the hook)
  - ArrowUp/ArrowDown for keyboard navigation, Enter to select (via `moveHighlight`/`selectHighlighted` from the hook)
  - Escape key or clicking outside closes dropdown
  - Inline validation errors displayed from hook's `error` state (e.g., invalid characters, duplicate)
- The hook's `onChange` callback should call `onAdd` with the newly added tag, then close the dropdown
- Stop propagation on all click events so the card's onClick doesn't fire

### Testing Strategy

**New file: `frontend/src/components/AddTagButton.test.tsx`**

Tests:
- Renders `+` button
- Click opens dropdown with input
- Suggestions shown, excluding existing tags
- Typing filters suggestions
- Clicking a suggestion calls `onAdd` and closes dropdown
- Enter key on typed text calls `onAdd` with normalized tag
- ArrowDown/ArrowUp navigates suggestions, Enter selects highlighted
- Escape closes dropdown without adding
- Does not call `onAdd` for empty input
- Does not call `onAdd` for duplicate tag (already in `existingTags`)
- Shows inline validation error for invalid tag characters

### Success Criteria
- Component renders, opens/closes correctly
- Tag selection and creation works
- All tests pass

### Dependencies
None

### Risk Factors
- Dropdown positioning near viewport bottom may clip. Keep dropdown small (max-height with scroll). A portal can be added later if needed.

---

## Milestone 2: Wire Into Card Components and AllContent

### Goal
Add `AddTagButton` to all three card components and wire up `onTagAdd` handlers in `AllContent.tsx`.

### Key Changes

**1. Card component props (BookmarkCard.tsx, NoteCard.tsx, PromptCard.tsx)**

Add to each card's props interface:
```typescript
onTagAdd?: (item: ItemType, tag: string) => void
tagSuggestions?: TagCount[]
```

**2. Card component rendering**

In each card's tag section, add `AddTagButton` after the tag map. Also adjust the conditional rendering so the tag container shows when `onTagAdd` is provided even if there are no tags yet:

```tsx
{(item.tags.length > 0 || onTagAdd) && (
  <div className="flex flex-wrap gap-1 ...">
    {item.tags.map((tag) => (
      <Tag key={tag} ... />
    ))}
    {onTagAdd && tagSuggestions && (
      <AddTagButton
        existingTags={item.tags}
        suggestions={tagSuggestions}
        onAdd={(tag) => onTagAdd(item, tag)}
      />
    )}
  </div>
)}
```

Key locations:
- `BookmarkCard.tsx` ~line 228 (tag rendering section)
- `NoteCard.tsx` ~line 125
- `PromptCard.tsx` ~line 132

**3. AllContent.tsx handlers**

Add handlers mirroring the existing remove pattern:

```typescript
const handleTagAddBookmark = async (bookmark: BookmarkListItem, tag: string): Promise<void> => {
  try {
    const newTags = [...bookmark.tags, tag]
    await updateBookmarkMutation.mutateAsync({ id: bookmark.id, data: { tags: newTags } })
  } catch {
    toast.error('Failed to add tag')
  }
}
// Same pattern for handleTagAddNote and handleTagAddPrompt
```

Pass to cards (same guard as `onTagRemove` — not for deleted view):
```tsx
<BookmarkCard
  ...
  onTagAdd={currentView !== 'deleted' ? handleTagAddBookmark : undefined}
  tagSuggestions={tagSuggestions}
/>
```

### Testing Strategy

Update existing test files:
- `BookmarkCard.test.tsx`: `+` button appears when `onTagAdd` provided, absent when omitted or deleted view
- `NoteCard.test.tsx`: Same
- `PromptCard.test.tsx`: Same
- `AllContent.test.tsx`: Adding a tag calls mutation with correct updated tags array

Key edge cases:
- `+` button renders even when item has zero tags
- `+` button does NOT render in deleted view

### Success Criteria
- `+` button appears on all card types in active and archived views
- `+` button does NOT appear in deleted view
- Adding a tag fires the correct PATCH mutation with the appended tag array
- Optimistic cache updates work (item shows new tag immediately)
- Tag suggestions refresh after adding (existing `fetchTags` in mutation `onSettled` handles this)
- `npm run test:run` passes
- `npm run lint` passes

### Dependencies
- Milestone 1

### Risk Factors
- Tag container conditional rendering (`tags.length > 0`) must be adjusted in all three cards to also show when `onTagAdd` is present — easy to miss one.
