# Table of Contents for Editor

## Overview

Add a Table of Contents (ToC) panel that extracts headings from markdown content in the CodeMirror editor and displays them in a navigable sidebar. Clicking a heading scrolls the editor to that position. The ToC updates live as the user types (debounced).

## Design Decisions

- **Location**: Shared right sidebar slot with version history. Only one panel can be open at a time (ToC or History). Opening one closes the other.
- **Trigger**: Toolbar toggle button (right-side toggle group), "Table of Contents" entry in the Cmd+/ command menu, and `Alt+T` keyboard shortcut (following the existing `Alt+Z`/`Alt+L`/`Alt+M` convention).
- **Navigation**: Clicking a ToC entry scrolls the CodeMirror editor to that heading line and places the cursor there.
- **Live updates**: ToC re-parses headings on content change, debounced (~300ms).
- **Mobile**: Same behavior as history sidebar (full-width overlay).

---

## Milestone 1: Heading Parser Utility

### Goal & Outcome

Create a pure utility function that extracts markdown headings from text content, producing a structured list suitable for rendering a ToC.

After this milestone:
- A `parseMarkdownHeadings(text: string)` function exists that returns an array of `{ level, text, line }` objects
- All edge cases are handled (code blocks, empty headings, inline formatting)
- Fully tested

### Implementation Outline

Create a new file `frontend/src/utils/markdownHeadings.ts`.

**Interface:**

```typescript
export interface MarkdownHeading {
  level: number  // 1-6
  text: string   // cleaned heading text (no #s, no inline markers)
  line: number   // 1-based line number in the document
}

export function parseMarkdownHeadings(text: string): MarkdownHeading[]
```

**Parsing rules:**
- Match ATX headings only: lines starting with 1-6 `#` characters followed by a space (or just `#` with nothing after)
- Skip headings inside fenced code blocks (``` or ~~~). Track code fence state line-by-line. Reference the existing `isInsideCodeBlock()` approach in `slashCommands.ts` for pattern inspiration, though that function works with EditorView state, not raw text.
- Clean heading text: strip leading `#` and space, strip common inline markdown markers (`**`, `*`, `_`, `` ` ``, `~~`, `==`) from the display text. Don't try to handle every edge case - just strip wrapping markers so `**bold**` displays as `bold`.
- Return headings in document order

**Why a separate utility:** Keeps parsing logic pure and testable independent of any UI. The ToC component and any future consumers (e.g., outline in reading mode) can reuse it.

### Testing Strategy

Create `frontend/src/utils/markdownHeadings.test.ts`:

- **Core behavior:**
  - Parses H1 through H6 headings with correct level, text, and line number
  - Multiple headings in a document return in document order
  - Empty document returns empty array
  - Document with no headings returns empty array

- **Edge cases:**
  - Headings inside fenced code blocks (```) are skipped
  - Headings inside tilde code blocks (~~~) are skipped
  - Nested/indented code blocks (e.g., code block with ``` inside) handled correctly
  - `#` without a space after is NOT a heading (e.g., `#hashtag`)
  - `#` followed by a space but empty text: include with empty string text
  - Heading with inline formatting (`## **bold** and *italic*`) returns cleaned text
  - Heading with inline code (`` ## `code` thing ``) preserves code content
  - Heading with leading/trailing whitespace in text: trimmed
  - Lines with `#` that are inside a code block fence that uses more than 3 backticks
  - Mixed content: paragraphs, lists, headings interspersed - only headings extracted

---

## Milestone 2: Refactor Sidebar to Support Multiple Panels

### Goal & Outcome

Refactor the existing `historySidebarStore` into a general-purpose right sidebar store that supports switching between panels (History vs ToC). This is an architectural change that sets up the shared sidebar slot.

After this milestone:
- The sidebar store tracks which panel is active (`'history' | 'toc' | null`) instead of a boolean `isOpen`
- All existing history sidebar functionality works exactly as before
- Opening one panel closes the other
- Layout margin calculation unchanged

### Implementation Outline

**1. Refactor `stores/historySidebarStore.ts` -> `stores/rightSidebarStore.ts`**

Rename the file and update the store interface:

```typescript
export type SidebarPanel = 'history' | 'toc'

interface RightSidebarState {
  activePanel: SidebarPanel | null  // null = closed
  width: number
  setActivePanel: (panel: SidebarPanel | null) => void
  togglePanel: (panel: SidebarPanel) => void  // toggle specific panel
  setWidth: (width: number) => void
}
```

- `togglePanel('history')`: if history is active, close sidebar. If toc is active or sidebar is closed, open history.
- `setActivePanel(null)`: close sidebar.
- `width` is shared across panels (same physical sidebar slot).
- Persist `activePanel` to localStorage (replacing the boolean `history-sidebar-open`). Consider storing just whether sidebar is open at all, not which panel - so on page reload it defaults to closed rather than remembering a potentially stale panel choice. Up to the agent's judgment.

**2. Update all consumers**

The following files reference `useHistorySidebarStore`:

- `Layout.tsx`: Change `isOpen` check to `activePanel !== null` for margin calculation. The store name and import path change.
- `HistorySidebar.tsx`: Update to use new store. Close action calls `setActivePanel(null)`.
- `NoteDetail.tsx`: The "show history" callback should call `setActivePanel('history')` or `togglePanel('history')`. The conditional render check changes from `isOpen` to `activePanel === 'history'`.
- `PromptDetail.tsx`: Same changes as NoteDetail.
- Any other consumers found via grep.

**3. Keep HistorySidebar component unchanged** (other than store migration). The component itself doesn't need structural changes - it just needs to read from the new store.

**Why refactor the store first:** This is a prerequisite for the ToC panel. Doing it as a separate milestone makes the diff reviewable and ensures no history sidebar regressions before adding new functionality.

### Testing Strategy

- **Verify no existing test breakage:** Run `npm run test:run` after refactoring to confirm all existing tests pass
- **Store tests** in `frontend/src/stores/rightSidebarStore.test.ts`:
  - `togglePanel('history')` opens history when closed
  - `togglePanel('history')` closes sidebar when history is already active
  - `togglePanel('toc')` switches from history to toc (replaces, doesn't close)
  - `togglePanel('toc')` closes sidebar when toc is already active
  - `setActivePanel(null)` closes sidebar regardless of current panel
  - `setActivePanel('history')` opens history when closed
  - `setActivePanel('history')` switches to history when toc is active
  - `setWidth` persists and retrieves width correctly
- **If the existing `historySidebarStore` has tests**, migrate them to the new file and adapt assertions

---

## Milestone 3: ToC Sidebar Component + Toolbar/Command Menu Integration

### Goal & Outcome

Build the ToC sidebar component and wire it into the editor toolbar and command menu so users can toggle it.

After this milestone:
- Users can toggle the ToC via a toolbar button or the Cmd+/ command menu
- The ToC shows a hierarchical list of headings from the current document
- Clicking a heading scrolls the editor to that line
- The ToC updates live as the user types (debounced)
- Opening ToC closes History sidebar, and vice versa

### Implementation Outline

**1. Create `components/TableOfContentsSidebar.tsx`**

A sidebar component following the same structural pattern as `HistorySidebar.tsx`:
- Right-aligned, same width/resize behavior (reads from shared `rightSidebarStore`)
- Header with title "Table of Contents" and close button
- Drag-to-resize handle on left edge (can reuse the same resize logic from HistorySidebar, or extract a shared hook if the duplication is substantial - agent's judgment)
- Responsive: full-width on mobile (same breakpoint as HistorySidebar)

**Content area:**
- Render headings as a flat list with left indentation based on heading level (e.g., H1 = no indent, H2 = 1 level, H3 = 2 levels, etc.)
- Each item shows the heading text, clickable
- If no headings found, show a subtle empty state message like "No headings found. Use # to add headings."
- Active/current heading highlighting is NOT in scope for this milestone (could be a future enhancement)

**Props/data flow:**
- Receives `content: string` - the current editor content. The parent page already tracks this.
- Receives a callback like `onHeadingClick: (line: number) => void` that the parent wires up to scroll the editor
- Internally calls `parseMarkdownHeadings(content)` with a debounce (~300ms) on content changes using `useMemo` or a debounced state pattern
- For debouncing: since heading parsing is likely fast for typical document sizes, `useMemo` recalculating on every content change may be fine. If performance is a concern, use a debounced value. Agent should judge based on testing with larger documents. A simple approach: use `useDeferredValue` or a `useDebounce` hook on the content before parsing.

**2. Scroll-to-heading in CodeMirrorEditor**

The CodeMirrorEditor needs to expose a way to scroll to a specific line. Options:
- Expose a ref/imperative handle with a `scrollToLine(line: number)` method
- Or pass an `onScrollToLine` callback that the parent can trigger

The agent should look at how EditorView is currently accessed (it's stored in a local ref inside CodeMirrorEditor) and choose the cleanest approach. The key CodeMirror API:

```typescript
// Given an EditorView and a 1-based line number:
const line = view.state.doc.line(lineNumber)
view.dispatch({
  selection: { anchor: line.from },
  effects: EditorView.scrollIntoView(line.from, { y: 'start' })
})
view.focus()
```

**3. Integrate into NoteDetail.tsx and PromptDetail.tsx**

Both pages need to:
- Conditionally render `<TableOfContentsSidebar>` when `activePanel === 'toc'`
- Pass current content and the scroll-to-heading callback
- The existing "show history" button/callback remains; add "show ToC" trigger

**4. Add ToC toggle to the editor toolbar + keyboard shortcut**

In `CodeMirrorEditor.tsx`, add a toolbar button to the right-side toggle group (alongside wrap, line numbers, mono font, reading mode):
- Create a `TableOfContentsIcon` in `EditorToolbarIcons.tsx` (a simple list/outline icon)
- Button toggles the ToC panel via `rightSidebarStore.togglePanel('toc')`
- Button should visually indicate when ToC is active (e.g., different color/opacity, same pattern as other toggle buttons if they have an active state)
- Register `Alt+T` as a global keyboard shortcut for toggling ToC, following the same pattern as the existing `Alt+Z` (wrap), `Alt+L` (line numbers), `Alt+M` (mono font) shortcuts in the capture-phase keydown handler

**5. Add ToC toggle to the command menu**

In `editorCommands.ts`, add a new command:
- ID: `toggle-toc`
- Label: "Table of Contents" (or "Toggle Table of Contents")
- Section: "Actions" (alongside Save/Discard)
- Action: calls `rightSidebarStore.togglePanel('toc')`
- Icon: same `TableOfContentsIcon`

**6. Mutual exclusion with History**

This is handled by the store's `togglePanel` / `setActivePanel` logic from Milestone 2. When the user clicks "History" it calls `setActivePanel('history')`, which replaces any active ToC. When the user clicks ToC it calls `togglePanel('toc')`, which replaces any active History. No additional logic needed in the components.

### Testing Strategy

**Component tests** in `frontend/src/components/TableOfContentsSidebar.test.tsx`:
- Renders heading list from content with correct indentation/nesting
- Renders empty state when content has no headings
- Calls `onHeadingClick` with correct line number when heading is clicked
- Updates heading list when content changes
- Close button calls store's `setActivePanel(null)`

**Integration with command menu** in existing `editorCommands.test.ts`:
- "Table of Contents" command exists in the built commands
- Command action calls `togglePanel('toc')` on the store

**Manual testing checklist** (for human review, not automated):
- Toggle ToC from toolbar button - opens/closes correctly
- Toggle ToC from Cmd+/ command menu - same behavior
- Open ToC then open History - ToC closes, History opens
- Open History then open ToC - History closes, ToC opens
- Click heading in ToC - editor scrolls to that heading
- Type new headings - ToC updates after debounce
- Delete headings - ToC updates
- Large document with many headings - performance acceptable
- Mobile: ToC renders full-width, heading click works

---

## Notes for the Agent

- Read existing code before implementing. In particular, study `HistorySidebar.tsx` and `historySidebarStore.ts` thoroughly before the refactor.
- The `CodeMirrorEditor.tsx` is large (743 lines). Read it carefully to understand the toolbar structure, command menu integration, and how EditorView is managed.
- Follow existing code patterns and conventions. The codebase uses Tailwind CSS for styling, Zustand for stores, and specific patterns for responsive behavior.
- The slash command menu (`slashCommands.ts`) has a `isInsideCodeBlock()` function - reference its approach for code fence detection in the heading parser, but note it works with EditorView state, not raw text. The heading parser should work with raw text strings.
- Don't add features not described here (e.g., heading level filtering, collapsible sections, active heading tracking). Keep it simple.
- Update `frontend/public/llms.txt` if this is a user-facing feature worth mentioning to LLMs.
