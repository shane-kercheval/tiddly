# Arrow Key Navigation for Search/Filter Item Lists

## Context

Users should be able to navigate search/filter results with arrow keys, avoiding mouse interaction. Two views need this:

1. **AllContent page** — press `f` to focus search, type a query or press `ArrowDown` to navigate items
2. **CommandPalette search view** — the commands view already has arrow key navigation, but the search results view does not

The CommandPalette commands view (`CommandPalette.tsx`) already implements the exact pattern we need: `selectedIndex` state, `clampedIndex` derivation, `ArrowUp/Down/Enter` handlers, `scrollIntoView`, mouse-movement gating to avoid ghost highlights. We'll extract this into a shared hook and apply it to both views.

## Architecture

### Shared hook: `useListKeyboardNavigation`

Extract from CommandPalette's existing logic into `frontend/src/hooks/useListKeyboardNavigation.ts`.

```typescript
interface UseListKeyboardNavigationOptions {
  /** Total number of navigable items */
  itemCount: number
  /** Called when Enter is pressed on the selected item */
  onSelect: (index: number) => void
  /** Called when ArrowUp is pressed while on the first item (e.g., refocus search input) */
  onExitTop?: () => void
  /** CSS selector for navigable items within the container (default: '[data-nav-item]') */
  itemSelector?: string
  /** Whether navigation is currently active */
  enabled?: boolean
}

interface UseListKeyboardNavigationReturn {
  /** Currently selected index (clamped to valid range) */
  selectedIndex: number
  /** Reset selection (e.g., when results change) */
  resetSelection: () => void
  /** Keyboard handler to attach to the container or input */
  handleKeyDown: (e: React.KeyboardEvent) => void
  /** Ref to attach to the scrollable list container */
  listRef: React.RefObject<HTMLElement>
  /** Whether user has moved the mouse (for ghost-highlight prevention) */
  mouseMoved: boolean
  /** Mouse move handler to attach to the list container */
  handleMouseMove: () => void
  /** Update selected index (for mouse hover) */
  setSelectedIndex: (index: number) => void
}
```

The hook manages:
- `selectedIndex` state with clamping to `[0, itemCount - 1]`
- `scrollIntoView({ block: 'nearest' })` effect when selection changes
- `mouseMoved` gate (false on reset, true on first mouse move)
- ArrowDown/ArrowUp/Enter keyboard handling
- `onExitTop` callback when ArrowUp is pressed at index 0

---

## Milestone 1: Extract `useListKeyboardNavigation` hook and refactor CommandPalette commands view

### Goal & Outcome

- New shared hook `useListKeyboardNavigation` exists with full test coverage
- CommandPalette commands view uses the hook instead of inline logic — behavior is identical
- No user-visible changes

### Implementation Outline

1. **Create `frontend/src/hooks/useListKeyboardNavigation.ts`** with the interface above
   - Extract state management (`selectedIndex`, `mouseMoved`), clamping, scroll effect, and keyboard handler from `CommandPalette.tsx` (lines ~180, 406-440, 408-415, 593-607)
   - Use `[data-nav-item]` as default selector (rename from `data-command-item`)
   - Include `onExitTop` in the ArrowUp handler: if index is 0 and `onExitTop` is provided, call it instead of staying at 0

2. **Refactor `CommandPalette.tsx` commands view** to use the hook
   - Remove inline `selectedIndex`, `mouseMoved`, `clampedIndex`, scroll effect, and `handleCommandKeyDown`
   - Replace with hook call, wiring `onSelect` to execute the command action
   - Rename `data-command-item` → `data-nav-item` on command buttons
   - `onExitTop` not needed here (commands view doesn't have a search-to-list flow for ArrowUp)

3. **Update `CommandPalette.tsx` tests** to verify behavior is preserved (no new tests needed, existing tests should pass)

### Testing Strategy

**`useListKeyboardNavigation.test.ts`** (new file):
- ArrowDown increments selectedIndex, clamped to itemCount - 1
- ArrowUp decrements selectedIndex, clamped to 0
- ArrowUp at index 0 calls `onExitTop` when provided
- ArrowUp at index 0 stays at 0 when `onExitTop` is not provided
- Enter calls `onSelect` with current index
- `resetSelection` resets index to 0 and mouseMoved to false
- Selection clamps when itemCount shrinks below current index
- `mouseMoved` starts false, becomes true on `handleMouseMove`
- `scrollIntoView` is called when selectedIndex changes
- Keyboard events are preventDefault'd
- Does nothing when `enabled` is false

**`CommandPalette.test.tsx`**: Existing tests should pass unchanged (verify arrow nav, Enter execution, scroll behavior in commands view)

---

## Milestone 2: Add arrow key navigation to AllContent page

### Goal & Outcome

- On AllContent: pressing ArrowDown from search input moves selection to first item
- ArrowUp/Down navigates between items with visual highlight and scroll-into-view
- ArrowUp on first item returns focus to search input
- Enter on selected item navigates to it (same as clicking)
- Escape returns focus to search input (already works)
- Mouse hover updates selection (with ghost-highlight prevention)

### Implementation Outline

1. **Wire `useListKeyboardNavigation` in `AllContent.tsx`**
   - Call the hook with `itemCount` from the current items array length
   - `onSelect(index)`: look up `items[index]`, call the same navigation logic as the card's click handler (navigate to `/app/bookmarks/{id}`, `/app/notes/{id}`, or `/app/prompts/{id}`)
   - `onExitTop`: focus the search input ref
   - Attach `handleKeyDown` to the search input's `onKeyDown` AND to the list container's `onKeyDown`
   - Attach `handleMouseMove` and mouse enter with `setSelectedIndex` to card wrappers
   - Reset selection when search query, tags, sort, or page changes

2. **Add `data-nav-item` attribute to cards** in AllContent's item rendering
   - Add the attribute to each card's wrapper element so the hook can query them for scrollIntoView

3. **Visual highlight for selected item**
   - Pass `isSelected` prop (or use a wrapper div with conditional styling) to indicate the currently selected item
   - Use a subtle highlight style consistent with CommandPalette's `bg-gray-100` pattern
   - Consider: a simple wrapper `<div>` around each card with conditional class is likely simpler than threading a prop through BookmarkCard/NoteCard/PromptCard

4. **Reset selection** when results change (query change, tag change, pagination, sort change) — call `resetSelection`

### Testing Strategy

**`AllContent.test.tsx`** (new tests):
- ArrowDown from search input highlights first item
- ArrowDown/ArrowUp navigates between items
- ArrowUp on first item returns focus to search input
- Enter on selected item navigates to the correct route (bookmark, note, prompt)
- Selection resets when search query changes
- Selection resets when page changes
- Mouse enter on item updates selection
- No navigation occurs on Enter when item list is empty

---

## Milestone 3: Add arrow key navigation to CommandPalette search results

### Goal & Outcome

- In CommandPalette search view: ArrowDown from search input moves selection to first search result
- ArrowUp/Down navigates results with highlight and scroll-into-view
- ArrowUp on first result returns focus to search input
- Enter on selected result navigates to it and closes the palette
- Mouse hover updates selection with ghost-highlight prevention

### Implementation Outline

1. **Wire `useListKeyboardNavigation` in CommandPalette search view**
   - The search view already renders BookmarkCard/NoteCard/PromptCard (lines ~692-756)
   - Call the hook with `itemCount` from search results length
   - `onSelect(index)`: call the existing `handleViewBookmark`/`handleViewNote`/`handleViewPrompt` based on item type
   - `onExitTop`: focus the search input
   - Attach `handleKeyDown` to the search input's `onKeyDown`
   - Reset selection when search query or results change

2. **Add `data-nav-item` and selection highlight** to search result cards
   - Same pattern as AllContent (Milestone 2)

3. **Coordinate with existing keyboard handling**
   - The commands view already uses the hook (from Milestone 1)
   - The search view needs its own separate hook instance since it's a different list with different items
   - Only one view is active at a time (`view` state), so no conflicts

### Testing Strategy

**`CommandPalette.test.tsx`** (new tests):
- In search view: ArrowDown highlights first search result
- ArrowDown/ArrowUp navigates between search results
- ArrowUp on first result focuses search input
- Enter on selected result navigates and closes palette
- Selection resets when search query changes
- Mouse enter updates selection in search results
