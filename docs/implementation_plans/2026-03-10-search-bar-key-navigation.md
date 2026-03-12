# Arrow Key Navigation for Search/Filter Item Lists

## Context

Users should be able to navigate search/filter results with arrow keys, avoiding mouse interaction. Two views need this:

1. **AllContent page** — press `f` to focus search, type a query or press `ArrowDown` to navigate items
2. **CommandPalette search view** — the commands view already has arrow key navigation, but the search results view does not

The CommandPalette commands view (`CommandPalette.tsx`) already implements the exact pattern we need: `selectedIndex` state, `clampedIndex` derivation, `ArrowUp/Down/Enter` handlers, `scrollIntoView`, mouse-movement gating to avoid ghost highlights. We'll extract this into a shared hook and apply it to both views.

## Architecture

### Relationship to `useContentSearch`

`useContentSearch.ts` already manages its own `highlightedIndex`, `moveHighlight`, and `selectHighlighted` for the search dropdown. This is intentionally separate from `useListKeyboardNavigation`:

- **`useContentSearch`**: Dropdown-scoped navigation, tightly coupled to search/dropdown open/close state. Used for the inline search results dropdown.
- **`useListKeyboardNavigation`**: Page-level list navigation for full result sets. Used by AllContent and CommandPalette views.

These hooks serve different scopes and should not be merged.

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
  /** Initial selected index (-1 = no selection, 0+ = preselect). Default: -1 */
  initialIndex?: number
}

interface UseListKeyboardNavigationReturn {
  /** Currently selected index (-1 = no selection, 0+ = valid item) */
  selectedIndex: number
  /** Reset selection to initialIndex (default: -1) and mouseMoved to false */
  resetSelection: () => void
  /** Props to spread on the search input: { onKeyDown, 'aria-activedescendant' } */
  getInputProps: () => Record<string, unknown>
  /** Props to spread on the list container: { ref, onKeyDown, onMouseMove, role, 'aria-label' } */
  getListProps: () => Record<string, unknown>
  /** Props to spread on each navigable item: { id, 'data-nav-item', 'aria-selected', onMouseEnter } */
  getItemProps: (index: number) => Record<string, unknown>
}
```

#### Selection model

`selectedIndex` starts at `-1` (no selection). ArrowDown from -1 transitions to 0 (first item). ArrowUp from 0 calls `onExitTop`. ArrowUp from -1 is a no-op. `resetSelection` returns to -1.

CommandPalette commands view uses `initialIndex: 0` to preselect the first command on open (matching current behavior).

#### Focus model

Focus stays on the search input during arrow navigation (VS Code-style). The user can continue typing to filter while using arrows to navigate. The list container's `onKeyDown` (via `getListProps`) only handles the case where the user has explicitly moved focus into the list (e.g., via Tab or click). `aria-activedescendant` on the input (via `getInputProps`) communicates the active item to screen readers.

#### Prop-getter pattern

The hook returns prop-getter functions instead of individual primitives. This bundles event handlers, ARIA attributes, and refs together, making correct wiring the default and reducing integration surface from 7 separate wirings to 3 prop spreads. Consumers use:
- `<input {...getInputProps()} />` — attaches `onKeyDown` and `aria-activedescendant`
- `<div {...getListProps()}>` — attaches `ref`, `onKeyDown`, `onMouseMove`, `role="listbox"`
- `<div {...getItemProps(index)}>` — attaches `id`, `data-nav-item`, `aria-selected`, `onMouseEnter`

`selectedIndex` is still exposed directly for conditional styling (e.g., highlight class).

### Accessibility

Keyboard navigation without moving DOM focus requires ARIA to communicate the active item to screen readers. The hook's prop-getters include these automatically:

- `getListProps()` returns `role="listbox"` and `aria-label`
- `getItemProps(index)` returns `role="option"`, `id="nav-item-{index}"`, and `aria-selected={index === selectedIndex}`
- `getInputProps()` returns `aria-activedescendant="nav-item-{selectedIndex}"` (omitted when selectedIndex is -1)

This follows the combobox/listbox pattern used by Downshift and Headless UI. The hook makes ARIA compliance automatic rather than requiring each consumer to wire attributes manually.

### Hook behavior summary

The hook manages:
- `selectedIndex` state starting at `initialIndex` (default -1), clamped to `[-1, itemCount - 1]`
- ArrowDown from -1 → 0 (first item); ArrowDown otherwise increments, clamped to itemCount - 1
- `scrollIntoView({ block: 'nearest' })` effect when selection changes (skipped when -1)
- `mouseMoved` gate (false on reset, true on first mouse move)
- ArrowDown/ArrowUp/Enter keyboard handling (navigation keys only — consumers can layer additional key handlers on top)
- `onExitTop` callback when ArrowUp is pressed at index 0
- Ignoring key events from nested interactive elements (buttons, links, inputs other than the bound search input) to avoid conflicts with card action controls

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
   - Implement selection model: `selectedIndex` starts at `initialIndex` (default -1), ArrowDown from -1 → 0
   - Implement prop-getter pattern: `getInputProps()`, `getListProps()`, `getItemProps(index)` with ARIA attributes

2. **Refactor `CommandPalette.tsx` commands view** to use the hook
   - Remove inline `selectedIndex`, `mouseMoved`, `clampedIndex`, scroll effect, and `handleCommandKeyDown`
   - Replace with hook call: `initialIndex: 0` (preselect first command), `onSelect` executes the command action
   - Use `{...getListProps()}` on the command list container, `{...getItemProps(index)}` on command buttons (replaces `data-command-item`)
   - `onExitTop` not needed here (commands view doesn't have a search-to-list flow for ArrowUp)
   - **Preserve Tab handling**: The hook only handles navigation keys (Arrow/Enter). CommandPalette must compose a wrapper `onKeyDown` that calls the hook's handler for Arrow/Enter and handles Tab separately (current behavior: Tab moves focus into the selected list item at line 429). This is CommandPalette-specific behavior — other consumers don't need it.

3. **Write CommandPalette keyboard integration tests _before_ extracting the hook**
   - These tests serve as a regression suite during the refactor — if extraction breaks anything, the tests catch it immediately
   - Only proceed with extraction once these tests pass against the current inline implementation

### Testing Strategy

**`useListKeyboardNavigation.test.ts`** (new file):
- `selectedIndex` starts at -1 (no selection) by default
- `selectedIndex` starts at `initialIndex` when provided (e.g., 0 for preselect)
- ArrowDown from -1 transitions to 0 (first item)
- ArrowDown increments selectedIndex, clamped to itemCount - 1
- ArrowUp decrements selectedIndex, clamped to 0
- ArrowUp from -1 is a no-op
- ArrowUp at index 0 calls `onExitTop` when provided
- ArrowUp at index 0 stays at 0 when `onExitTop` is not provided
- Enter calls `onSelect` with current index
- Enter is a no-op when selectedIndex is -1
- `resetSelection` resets index to initialIndex (default -1) and mouseMoved to false
- Selection clamps when itemCount shrinks below current index
- `mouseMoved` starts false, becomes true on mouse move via `getListProps().onMouseMove`
- `scrollIntoView` is called when selectedIndex changes (not called for -1)
- Keyboard events are preventDefault'd
- Does nothing when `enabled` is false
- `handleKeyDown` is a no-op when `e.target` is a nested interactive element (`<button>`, `<a>`, `<select>`)
- Items going from N → 0 → N (e.g., query matches nothing then cleared) clamps correctly and doesn't leave stale selection
- `getInputProps()` returns `aria-activedescendant` matching selected item's `id` (omitted when -1)
- `getItemProps(index)` returns `aria-selected: true` only for selected index
- `getListProps()` returns `role="listbox"`

**`CommandPalette.test.tsx`**: Write these _before_ extraction (step 3 above). Existing tests primarily check list composition, not keyboard behavior. Add integration tests if not already covered:
- ArrowDown/ArrowUp navigates between commands
- Enter executes the selected command
- Tab moves focus into the selected command item (regression guard for Tab preservation)
- Scroll behavior when navigating long command lists

---

## Milestone 2: Add arrow key navigation to AllContent page

### Goal & Outcome

- On AllContent: pressing ArrowDown from search input moves selection to first item
- ArrowUp/Down navigates between items with visual highlight and scroll-into-view
- ArrowUp on first item returns focus to search input
- Enter on selected item navigates to it (same as clicking)
- Escape returns focus to search input (already works)
- Mouse hover updates selection (with ghost-highlight prevention)

### DOM Structure Note

In AllContent, `SearchFilterBar` and the content list are **sibling containers** (not parent-child). SearchFilterBar is inside `.mb-3.md:mb-5.space-y-3` while the content list is in a separate `<div>` below. Key events from the search input do **not** bubble to the list container. This means:
- `handleKeyDown` must be attached to **both** the search input and the list container — these are separate event paths with no double-fire risk.
- The search input attachment requires adding an `onKeyDown` prop to `SearchFilterBar`.

### Implementation Outline

1. **Add `onKeyDown` prop to `SearchFilterBar`**
   - Add `onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void` to `SearchFilterBarProps`
   - Forward it to the search `<input>` element's `onKeyDown`
   - This is needed because the search input is inside SearchFilterBar's DOM subtree, not directly accessible from AllContent

2. **Wire `useListKeyboardNavigation` in `AllContent.tsx`**
   - Call the hook with `itemCount` from the current items array length (default `initialIndex: -1`, no preselection)
   - `onSelect(index)`: call the same handlers the card's click would invoke — `handleEditClick` for bookmarks (no-op in deleted view since `onEdit` is undefined), `handleViewNote` for notes, `handleViewPrompt` for prompts. Do not construct routes inline — this ensures keyboard Enter and card click have identical behavior including view-specific guards.
   - `onExitTop`: focus the search input ref
   - Spread `getInputProps()` onto SearchFilterBar's input (via the new `onKeyDown` prop + `aria-activedescendant`). Spread `getListProps()` onto the list container. These are sibling containers — no bubbling overlap, no double-fire risk.
   - Spread `getItemProps(index)` onto each card wrapper — this provides `data-nav-item`, `id`, `aria-selected`, and `onMouseEnter` in a single spread.
   - Focus stays on the search input during arrow navigation. The list container's handler only fires when the user has explicitly moved focus into the list (Tab or click).

3. **Visual highlight for selected item**
   - Use `selectedIndex` from the hook to conditionally apply a highlight class
   - Use a subtle highlight style consistent with CommandPalette's `bg-gray-100` pattern
   - Consider: a simple wrapper `<div {...getItemProps(index)}>` around each card with conditional class is likely simpler than threading a prop through BookmarkCard/NoteCard/PromptCard
   - No highlight shown when `selectedIndex` is -1 (before user starts navigating)

4. **Reset selection on data changes**
   - Derive a `resetKey` from the parameters that drive the data fetch: `view + query + tags + sort + offset + pageSize + contentTypes` (or use the query cache key if available). Call `resetSelection` in a `useEffect` keyed on this value.
   - This is explicit and exhaustive — covers sort-only changes (where items length and first ID may be unchanged) without needing to enumerate individual filter controls.

5. **Arrow navigation stops at page boundaries**
   - ArrowDown when at the last item stays at the last item (clamped by the hook). Pagination is not auto-advanced — this would be surprising and over-engineered.

### Testing Strategy

**`AllContent.test.tsx`** (new tests):
- No highlight visible before first arrow keypress (selectedIndex starts at -1)
- ArrowDown from search input highlights first item (transitions -1 → 0)
- After ArrowDown, `document.activeElement` is still the search input (focus stays on input)
- Single ArrowDown press moves selection by exactly one item (no double-fire)
- ArrowDown/ArrowUp navigates between items
- ArrowUp on first item returns focus to search input
- ArrowDown on last item stays at last item (does not advance page)
- Enter on selected item navigates to the correct route (bookmark, note, prompt)
- Enter on a bookmark in deleted view does nothing (matches click behavior)
- Enter on a focused card action button (delete, archive) does NOT trigger item navigation
- Selection resets when search query changes
- Selection resets when sort order changes (even if item count unchanged)
- Selection resets when content-type filter changes
- Selection resets when page changes
- Mouse enter on item updates selection
- No navigation occurs on Enter when item list is empty
- `aria-activedescendant` on search input matches selected item's `id` (omitted when no selection)

---

## Milestone 3: Add arrow key navigation to CommandPalette search results

### Goal & Outcome

- In CommandPalette search view: ArrowDown from search input moves selection to first search result
- ArrowUp/Down navigates results with highlight and scroll-into-view
- ArrowUp on first result returns focus to search input
- Enter on selected result navigates to it and closes the palette
- Mouse hover updates selection with ghost-highlight prevention

### Learnings from Milestone 2

These patterns emerged during AllContent implementation and should be followed here:

- **`data-mouse-moved` attribute on list container**: AllContent sets `data-mouse-moved={contentMouseMoved || undefined}` on the list container. This drives the ghost-hover CSS suppression rules in `index.css`. The search view needs the same attribute, using `mouseMoved` from the hook return.
- **CSS handles selection highlight automatically**: The existing `[aria-selected="true"] > .card` rule in `index.css` applies `bg-gray-100`. No inline conditional classes needed — just wrap each card in `<div {...itemProps}>` and the CSS takes care of it.
- **`SearchFilterBar` already has the needed props**: `onSearchKeyDown` and `searchAriaActiveDescendant` already exist on `SearchFilterBar`. Destructure `getInputProps()` and pass these two values as separate props (same as AllContent).
- **`idPrefix` is required**: Use a distinct prefix (e.g., `'search-item'`) to avoid ID collisions with the commands view's `'cmd-item'` prefix.
- **`resetKey` pattern for selection reset**: Derive a string from all filter/sort/pagination state (`debouncedSearchQuery`, `selectedTags`, sort, offset, `pageSize`, `selectedContentTypes`, `selectedViews`) and call `resetSelection` in a `useEffect` keyed on it.

### Implementation Outline

1. **Wire `useListKeyboardNavigation` in CommandPalette search view**
   - The search view already renders BookmarkCard/NoteCard/PromptCard (lines ~692-756)
   - Call the hook with `itemCount` from search results length (default `initialIndex: -1`, no preselection), `idPrefix: 'search-item'`, `enabled: view === 'search'`
   - `onSelect(index)`: call the existing `handleViewBookmark`/`handleViewNote`/`handleViewPrompt` based on item type — same handlers the card click uses
   - `onExitTop`: focus the search input
   - Destructure `getInputProps()` and pass `onKeyDown` / `aria-activedescendant` to `SearchFilterBar` via `onSearchKeyDown` / `searchAriaActiveDescendant` props
   - Spread `getListProps()` onto the results container, set `data-mouse-moved={searchMouseMoved || undefined}` on it
   - Wrap each card in `<div key={...} {...getItemProps(index)}>` — the existing CSS rules handle the selection highlight
   - Reset selection via `resetKey` derived from `debouncedSearchQuery`, `selectedTags`, `sortValue`, `offset`, `pageSize`, `selectedContentTypes`, `selectedViews`

2. **Coordinate with existing keyboard handling**
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
