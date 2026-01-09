# Milkdown WYSIWYG Editor Implementation Plan

## Overview

Replace the current CodeMirror-based markdown editor with Milkdown WYSIWYG editor and consolidate separate View/Edit modes into a unified editing experience. This is a significant UI overhaul affecting Notes and Prompts.

### Key Changes
- **WYSIWYG editing**: Markdown renders inline as you type (like Obsidian/Notion)
- **Unified view/edit**: No more separate View and Edit modes - content is always editable
- **Inline metadata**: Title, tags, description styled to look integrated (not form fields)
- **Visual/Markdown toggle**: Switch between WYSIWYG and raw markdown editing
- **Manual save**: Explicit Save/Discard with localStorage draft recovery

### What's NOT Changing
- Backend API (no changes)
- Data model (still storing raw markdown)
- Authentication/authorization
- Bookmarks (no markdown editor there)

---

## Reference Documentation

Before implementing, read:
- **Milkdown docs**: https://milkdown.dev/docs/guide/getting-started
- **Milkdown React**: https://milkdown.dev/docs/recipes/react
- **Milkdown plugins**: https://milkdown.dev/docs/plugin/using-plugins
- **ProseMirror basics**: https://prosemirror.net/docs/guide/ (Milkdown is built on this)

### Existing Prototype

**WARNING:** A prototype exists in the repo but should NOT be treated as production-ready code. Use it as a reference for patterns and solutions, but verify against this plan before copying.

Files:
- `src/components/MilkdownEditor.tsx` - Core editor component
- `src/pages/settings/SettingsEditorPrototype.tsx` - Test page
- Route: `/app/settings/editor-prototype`

**What the prototype gets right** (use as reference):
- Checkbox/task list rendering and toggling via ProseMirror
- Cleaning `<br />` and `&nbsp;` artifacts
- Custom link dialog (Cmd+K)
- Scoped CSS styling (avoiding global pollution from themes)
- Basic editor initialization pattern

**What the prototype gets right now** (after fixes):
- Excludes `remarkPreserveEmptyLinePlugin` to prevent `<br />` tags in output (see Known Issues #3)
- Custom commonmark preset without the problematic plugin

**What still needs work for production:**
- No mode toggle (Visual/Markdown) — production needs this
- No external value change handling — needs React `key` prop pattern
- Copy handler could be improved but is less critical now that `<br />` issue is fixed

**Bottom line:** The prototype now produces clean markdown output. Still needs production features (mode toggle, external value handling).

---

## Known Milkdown Issues & Solutions

During prototyping, we encountered several issues with Milkdown that required workarounds. Document these so the production implementation handles them correctly.

### 1. Global CSS Pollution from Themes

**Problem**: Importing `@milkdown/theme-nord/style.css` broke Tailwind's responsive breakpoints (`md:`, `lg:`, etc.), causing the sidebar to be permanently stuck in mobile view.

**Solution**: Do NOT import Milkdown theme CSS globally. Instead, write custom scoped CSS targeting `.milkdown-wrapper .milkdown` selectors. All Milkdown styles should be in `index.css` under the Milkdown section, scoped to avoid affecting other components.

**Key lesson**: Always scope third-party CSS. Test that adding new CSS doesn't break existing responsive layouts.

### 2. Copy/Paste Doesn't Preserve Markdown

**Problem**: When copying text from Milkdown, the clipboard contains plain rendered text (e.g., "bold text") instead of markdown syntax (e.g., `**bold text**`).

**Solution**: Milkdown has a `clipboard` plugin (`@milkdown/kit/plugin/clipboard`) that handles markdown serialization on copy. Add `.use(clipboard)` to the editor configuration.

**Note**: The clipboard plugin must be explicitly added - it's not included by default.

**Post-processing is less critical now**: Since we fixed the `<br />` issue at the source (see Known Issues #3), copied text no longer contains HTML artifacts. The clipboard plugin handles the conversion to markdown automatically.

### 3. `<br />` Tags in Markdown Output (SOLVED)

**Problem**: Milkdown was serializing empty paragraphs as `<br />` HTML tags instead of blank lines.

**Root cause**: The `remarkPreserveEmptyLinePlugin` in Milkdown's commonmark preset intentionally converts empty paragraphs to `<br />` to "preserve" them (since standard markdown collapses multiple blank lines). This is in `paragraphSchema.toMarkdown`:
```typescript
if (emptyParagraph && shouldPreserveEmptyLine(ctx)) {
  state.addNode("html", void 0, "<br />");  // This was the problem
}
```

**Solution**: Exclude `remarkPreserveEmptyLinePlugin` from the commonmark preset. Instead of importing the full preset:
```typescript
import { commonmark } from '@milkdown/kit/preset/commonmark'
```

Import individual parts and build a custom preset without the problematic plugin:
```typescript
import {
  schema, inputRules, markInputRules, commands, keymap,
  hardbreakClearMarkPlugin, hardbreakFilterNodes, hardbreakFilterPlugin,
  inlineNodesCursorPlugin, remarkAddOrderInListPlugin, remarkInlineLinkPlugin,
  remarkLineBreak, remarkHtmlTransformer, remarkMarker,
  // remarkPreserveEmptyLinePlugin, -- EXCLUDED
  syncHeadingIdPlugin, syncListOrderPlugin,
} from '@milkdown/kit/preset/commonmark'

const customCommonmark = [
  schema, inputRules, markInputRules, commands, keymap,
  hardbreakClearMarkPlugin, hardbreakFilterNodes, hardbreakFilterPlugin,
  inlineNodesCursorPlugin, remarkAddOrderInListPlugin, remarkInlineLinkPlugin,
  remarkLineBreak, remarkHtmlTransformer, remarkMarker,
  syncHeadingIdPlugin, syncListOrderPlugin,
].flat()
```

**Result**: Empty paragraphs serialize as blank lines (`\n\n`) instead of `<br />`. No HTML in markdown output. No data corruption risk.

**Note**: The `cleanMarkdown` function now only handles non-breaking spaces and collapsing excessive newlines - the `<br />` replacement is no longer needed.

### 4. Non-Breaking Spaces (`&nbsp;`) in Output

**Problem**: Milkdown inserts non-breaking space characters (`\u00a0` or `&nbsp;`) in certain situations, which appear as weird characters when viewed elsewhere.

**Solution**: Include in the markdown cleaning function:
```typescript
.replace(/\u00a0/g, ' ')    // Convert non-breaking spaces
.replace(/&nbsp;/gi, ' ')   // Convert HTML entities
```

### 5. Task List Checkboxes Not Rendering

**Problem**: Milkdown's GFM plugin parses task lists (`- [ ] item`) but doesn't render actual checkbox `<input>` elements. Instead, it uses data attributes: `<li data-item-type="task" data-checked="false">`.

**Solution**: Use CSS to render checkboxes via `::before` pseudo-elements:
```css
.milkdown-wrapper .milkdown li[data-item-type="task"]::before {
  content: '';
  /* checkbox styling */
}

.milkdown-wrapper .milkdown li[data-item-type="task"][data-checked="true"]::before {
  /* checked state with checkmark SVG background */
}
```

### 6. Task List Checkboxes Not Toggleable

**Problem**: Since checkboxes are CSS pseudo-elements (not real inputs), clicking them doesn't toggle the checked state.

**Solution**: Add a click handler that:
1. Detects clicks on task list items (within the checkbox area)
2. Finds the corresponding ProseMirror node
3. Dispatches a transaction to toggle the `checked` attribute

```typescript
// Simplified approach:
const handleClick = (e) => {
  const listItem = e.target.closest('li[data-item-type="task"]')
  if (listItem && clickWasOnCheckboxArea(e)) {
    // Find ProseMirror node position and toggle checked attribute
    const pos = view.posAtDOM(listItem, 0)
    // ... traverse to find list_item node and update attrs
  }
}
```

### 7. Link Insertion (Cmd+K)

**Problem**: WYSIWYG editors don't interpret typed markdown syntax. Typing `[text](url)` results in escaped literal text, not a link.

**Solution**: Implement Cmd+K shortcut that:
1. Gets the current selection
2. Shows a custom dialog for URL and link text input
3. Creates a ProseMirror link mark and inserts it

**Note**: Use a custom React modal dialog instead of browser `prompt()` for better UX. The dialog should:
- Pre-fill link text with selected text (if any)
- Auto-focus the URL field
- Support Enter to submit, Escape to cancel

### 8. External Value Changes Not Reflected

**Problem**: When the `value` prop changes externally (e.g., loading different content), Milkdown doesn't update because it maintains its own internal state.

**Solution**: This is a known limitation of the prototype. For production, consider:
- Using a `key` prop to force remount when content ID changes
- Or implementing proper content reset via Milkdown's API
- Or detecting significant external changes and reinitializing

### 9. Typing Markdown Syntax Gets Escaped

**Problem**: Unlike raw markdown editors, typing `**bold**` in Milkdown produces literal asterisks, not bold text.

**Expected behavior**: This is correct for WYSIWYG. Users should use:
- Cmd+B for bold
- Cmd+I for italic
- Cmd+K for links
- Or select text and apply formatting

**Solution**: Ensure keyboard shortcuts work and are documented. Consider adding a toolbar for discoverability (optional).

---

## Milestone 1: Production-Ready Milkdown Editor

### Goal
Transform the prototype MilkdownEditor into a production-ready component with Visual/Markdown mode toggle.

### Success Criteria
- [ ] MilkdownEditor works reliably with all common markdown features
- [ ] Visual/Markdown toggle switches between WYSIWYG and raw CodeMirror editing
- [ ] All keyboard shortcuts work (Cmd+B, Cmd+I, Cmd+K, etc.)
- [ ] Copy/paste preserves markdown correctly
- [ ] Placeholder text displays when editor is empty
- [ ] Component is well-tested
- [ ] No CSS pollution affecting other components

### Key Changes

**1. Refactor MilkdownEditor structure:**
```typescript
interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  mode?: 'visual' | 'markdown'  // New prop
  onModeChange?: (mode: 'visual' | 'markdown') => void
  disabled?: boolean
  minHeight?: string
  placeholder?: string
  // ... other existing props
}
```

**2. Add mode toggle UI:**
- Two buttons: "Visual" | "Markdown"
- Visual = Milkdown WYSIWYG
- Markdown = CodeMirror (current raw editor)
- Persist preference to localStorage

**3. Component organization:**
- Keep Milkdown-specific code in `MilkdownEditor.tsx`
- Keep CodeMirror code in existing `MarkdownEditor.tsx` (rename to `CodeMirrorEditor.tsx`)
- Create new `ContentEditor.tsx` that wraps both with toggle

**Mode toggle placement:** The toggle belongs inside `ContentEditor`, not in the parent. This follows encapsulation — the parent's job is to manage content state (`value`, `onChange`), not to know about internal editor modes. The parent gets a clean interface without implementation details leaking out.

**4. Fix known prototype issues:**
- External value changes don't update Milkdown (need to handle content resets)
- Clear undo history on mode switch (see below)

### Implementation Details

**Approach for handling external value changes (Issue #8):**
The cleanest solution is using React's `key` prop to force remount when loading different content. When the user navigates to a different note/prompt, pass a different key (e.g., the entity ID) to the ContentEditor:

```tsx
<ContentEditor
  key={note?.id ?? 'new'}  // Forces remount when ID changes
  value={content}
  onChange={setContent}
/>
```

This is simpler and more reliable than trying to imperatively update Milkdown's internal state. The tradeoff is losing undo history when switching documents, which is acceptable since undo should be per-document anyway.

**Mode switching state management:**
When switching from Visual to Markdown (or vice versa), both editors receive the same `value` prop. The key insight is that:
- Milkdown's `markdownUpdated` listener calls `onChange` with cleaned markdown
- CodeMirror's `onChange` calls the same callback
- Both write to the same state, so switching modes naturally preserves content

**Undo history on mode switch:** Clear undo history when switching modes by changing the React `key` prop. This forces a remount, giving a fresh undo stack:

```tsx
// Track mode switches to force remount
const [modeKey, setModeKey] = useState(0)

const handleModeChange = (newMode: 'visual' | 'markdown'): void => {
  setMode(newMode)
  setModeKey(prev => prev + 1)  // Forces remount, clears undo
}

// Use modeKey in the editor's key prop
<MilkdownEditor key={`milkdown-${modeKey}`} ... />
<CodeMirrorEditor key={`codemirror-${modeKey}`} ... />
```

This is cleaner than trying to preserve stale undo history. If you made changes in Raw mode, the Milkdown undo stack is meaningless anyway.

Switching modes will also lose cursor position. This is acceptable - just document it. Attempting to map cursor positions between ProseMirror and CodeMirror would be complex and error-prone.

**localStorage key for mode preference:**
Use `'editor_mode_preference'` to store `'visual'` or `'markdown'`. The existing codebase uses similar patterns (see `WRAP_TEXT_KEY` in `MarkdownEditor.tsx`).

**Keep the existing CodeMirror formatting shortcuts:**
The current `MarkdownEditor.tsx` has well-tested shortcuts in `createMarkdownKeyBindings()`:
- Mod-b: Bold (`**text**`)
- Mod-i: Italic (`*text*`)
- Mod-k: Link (`[text](url)`)
- Mod-Shift-x: Strikethrough (`~~text~~`)

These should continue working in Markdown mode. For Visual mode, Milkdown handles Cmd+B and Cmd+I natively. The prototype already implements Cmd+K with a custom dialog.

**Reuse existing MarkdownEditor props:**
The current `MarkdownEditor` has props like `wrapText`, `onWrapTextChange`, `maxLength`, `errorMessage` that should be preserved in the new wrapper component. Don't break existing consumers.

**Placeholder implementation:**
Milkdown doesn't have native placeholder support. The correct approach is to use ProseMirror's decoration system — this is the standard pattern for production ProseMirror-based editors (Notion, Confluence use this approach).

Implementation:
1. Create a Milkdown plugin that adds a ProseMirror plugin
2. The ProseMirror plugin checks if the document is empty
3. If empty, add a Decoration that renders placeholder text
4. Style the placeholder with CSS (gray, italic, non-selectable)

```typescript
// Simplified approach using ProseMirror decorations
import { Plugin } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'

const placeholderPlugin = (placeholder: string) => new Plugin({
  props: {
    decorations(state) {
      const doc = state.doc
      if (doc.childCount === 1 && doc.firstChild?.isTextblock && doc.firstChild.content.size === 0) {
        return DecorationSet.create(doc, [
          Decoration.widget(1, () => {
            const span = document.createElement('span')
            span.className = 'milkdown-placeholder'
            span.textContent = placeholder
            return span
          })
        ])
      }
      return DecorationSet.empty
    }
  }
})
```

This is more work than a CSS hack, but it handles edge cases correctly and is the idiomatic solution.

### Testing Strategy

**Note:** Test infrastructure (vitest, @testing-library/react, jsdom) already exists in `package.json`. What's missing is actual test files for these components.

**For WYSIWYG-specific tests** (contentEditable, ProseMirror interactions), jsdom cannot properly simulate these. Options:
- Add Playwright for E2E tests of editor interactions
- Or rely on manual QA for WYSIWYG-specific behavior

Unit tests with vitest/jsdom work fine for: mode toggling, `cleanMarkdown()`, component props, state management.

**What to test:**

1. **Mode toggling** - Verify clicking Visual/Markdown buttons switches the active editor and persists preference to localStorage.

2. **Markdown round-trip** - Content survives switching between modes. Hard to unit test with Milkdown mocking; may need integration tests.

3. **`cleanMarkdown()` utility** - Extract to `src/utils/cleanMarkdown.ts` and test the pure function directly. Cover: `\u00a0` → space, `&nbsp;` → space, collapsing multiple newlines. (Note: `<br />` cleanup is no longer needed since we fixed the root cause.)

4. **Link dialog** - Opens on Cmd+K, submits URL correctly, closes on cancel/escape.

5. **Copy/paste** - Clipboard APIs are restricted in jsdom. Verify actual clipboard behavior manually.

6. **Checkbox toggling** - Requires real DOM interaction with Milkdown output. Consider integration test or manual testing.

7. **Keyboard shortcuts with editor focused** - Verify Cmd+S (save) and Escape (cancel) work when Milkdown editor is focused. ProseMirror has its own keymap that might intercept events. Test manually or with Playwright.

### Dependencies
- None (this is the foundation)

### Risk Factors
- Mode switching may lose cursor position (accepted tradeoff)
- Complex markdown (tables, code blocks) may render differently in each mode (document this limitation)
- **Performance with large documents**: The app allows up to 500K characters, but realistically most notes are <10K. Test with 10K, 50K, and 100K character documents. Consider showing a warning or auto-switching to raw mode above a threshold if performance degrades.
- **Testing WYSIWYG editors**: jsdom doesn't support `contentEditable` properly. For Milkdown-specific behavior (checkbox toggling, copy/paste, typing), use Playwright integration tests or rely on manual QA. Unit tests with vitest/jsdom are fine for mode toggling, `cleanMarkdown()`, and component props.
- **Keyboard shortcut conflicts**: ProseMirror has its own keymap. Verify that Cmd+S (save) and Escape (cancel) bubble up correctly when the editor is focused. Test manually or with Playwright.

---

## Milestone 2: Inline Editable Components

### Goal
Create reusable components for inline-editable metadata fields that look like view mode but are editable.

### Success Criteria
- [ ] InlineEditableTitle - large styled text, click to edit with cursor
- [ ] InlineEditableTags - view-style tags with X to remove, + to add
- [ ] InlineEditableText - for description and similar fields
- [ ] All components feel native, not like form fields
- [ ] Keyboard navigation works (Tab between fields, Enter to confirm, arrow keys for dropdowns)
- [ ] Components are accessible

### Keyboard Behavior (Decided)

Standard form behavior takes precedence over autocomplete convenience:
- **Tab**: Always moves to next field (never selects suggestions)
- **Enter**: Add tag or confirm highlighted suggestion
- **Arrow Up/Down**: Navigate suggestion dropdown
- **Escape**: Close dropdown
- **Click**: Select suggestion

This follows standard form accessibility patterns. Autocomplete dropdowns that hijack Tab are frustrating - users expect Tab to navigate forms predictably.

### Key Changes

**1. InlineEditableTitle component:**
```typescript
interface InlineEditableTitleProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string  // e.g., "Title"
  required?: boolean
  disabled?: boolean
  variant?: 'title' | 'name'  // 'name' = monospace for prompt names
  className?: string
}
```

Behavior:
- Displays as styled text (h1-style for title, monospace for name)
- Click anywhere to focus and show cursor
- No visible border until focused (subtle focus ring)
- Placeholder shown when empty
- Blur or Enter to confirm (for single-line)

**2. InlineEditableTags component:**
```typescript
interface InlineEditableTagsProps {
  value: string[]
  onChange: (tags: string[]) => void
  suggestions?: TagCount[]
  disabled?: boolean
}
```

Behavior:
- Tags displayed as pills with X button (visible on hover)
- "+" button to add (not invisible click areas - poor UX, users don't know they exist)
- Autocomplete dropdown for suggestions
- Same validation as current TagInput
- Exposes `getPendingValue()` via ref (required for Milestone 3 - capturing typed-but-not-submitted tags on save)

**3. InlineEditableText component:**
```typescript
interface InlineEditableTextProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  multiline?: boolean
  maxLength?: number
}
```

Behavior:
- Single line or multiline text
- Styled as body text (not input field)
- Click to edit, blur to confirm

### Implementation Details

**InlineEditableTitle approach:**
Use a styled native `<input>` element. This is simpler and more reliable than `contentEditable`, which has browser inconsistencies, IME issues (for non-Latin input), and accessibility concerns.

```tsx
function InlineEditableTitle({ value, onChange, placeholder, variant, disabled }: InlineEditableTitleProps): ReactNode {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled}
      className={cn(
        // Remove input appearance
        'bg-transparent border-none outline-none w-full',
        // Typography based on variant
        variant === 'name' ? 'font-mono text-lg' : 'text-2xl font-bold',
        // Subtle focus indicator
        'focus:ring-2 focus:ring-gray-900/5 rounded px-1 -mx-1',
        // Placeholder styling
        'placeholder:text-gray-400'
      )}
    />
  )
}
```

**Why native `<input>` over `contentEditable`:**
1. **Browser consistency**: `contentEditable` behaves differently across browsers
2. **IME support**: Native inputs handle international input methods correctly
3. **Accessibility**: Screen readers understand native inputs
4. **Simplicity**: No need to handle paste events, sync textContent, etc.
5. **React integration**: Works naturally with controlled components

The CSS removes the visual input appearance (`bg-transparent border-none`) while preserving all native input behavior.

**InlineEditableTags - Extract shared logic to a hook:**
The current `TagInput.tsx` has extensive logic for:
- Tag validation via `validateTag()` utility
- Autocomplete filtering and keyboard navigation
- Pending tag handling via `useImperativeHandle`

**Why hook extraction is the correct approach:**
- **DRY**: Autocomplete logic, validation, keyboard navigation exist in one place
- **Single Responsibility**: Hook handles behavior, components handle rendering
- **Testability**: The hook can be unit tested independently from UI
- **Maintainability**: Bug fixes propagate to both consumers automatically

Composition (wrapping TagInput) is wrong because TagInput is designed for form contexts with specific styling assumptions. It would couple InlineEditableTags to TagInput's implementation details.

**Implementation:**

**Recommended implementation order:** Build `InlineEditableTitle` and `InlineEditableText` first - they're straightforward styled inputs/textareas and establish visual patterns. Then tackle `InlineEditableTags` which is more complex.

1. Create `useTagAutocomplete` hook in `src/hooks/useTagAutocomplete.ts`:

Expose primitives rather than a monolithic `handleKeyDown`. This lets each consuming component compose its own keyboard handling:

```typescript
interface UseTagAutocompleteOptions {
  value: string[]
  onChange: (tags: string[]) => void
  suggestions?: TagCount[]
  maxTags?: number
}

interface UseTagAutocompleteReturn {
  // State
  inputValue: string
  setInputValue: (value: string) => void
  showSuggestions: boolean
  highlightedIndex: number
  filteredSuggestions: TagCount[]
  error: string | null

  // Actions
  addTag: (tag: string) => boolean  // returns success
  removeTag: (tag: string) => void
  selectHighlighted: () => void
  moveHighlight: (direction: 'up' | 'down') => void
  openSuggestions: () => void
  closeSuggestions: () => void
  getPendingValue: () => string
  clearPending: () => void
}
```

The component then composes keyboard handling:
```typescript
const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'ArrowDown') { moveHighlight('down'); e.preventDefault() }
  else if (e.key === 'ArrowUp') { moveHighlight('up'); e.preventDefault() }
  else if (e.key === 'Enter') {
    e.preventDefault()
    if (showSuggestions && highlightedIndex >= 0) selectHighlighted()
    else addTag(inputValue)
  }
  else if (e.key === 'Escape') closeSuggestions()
  // Tab falls through to browser default - moves to next field
}
```

This keeps the hook focused on autocomplete logic while letting `TagInput` and `InlineEditableTags` handle keyboard mapping independently if needed.

2. Create `InlineEditableTags` as a new component that:
   - Uses `useTagAutocomplete` for shared logic
   - Has view-mode visual styling (matches `NoteView.tsx` lines 165-174)
   - Shows X button on hover (not always visible)
   - Has a "+" button to add new tags
   - Exposes `getPendingValue()` via `useImperativeHandle` for form submission

3. Refactor existing `TagInput` to also use `useTagAutocomplete`

Both components share the same tested logic with different visual presentations.

**Visual reference from NoteView.tsx:**
```tsx
// Current view-mode tag style to emulate:
<button
  className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
>
  {tag}
</button>
```

Add an X icon that appears on hover.

**InlineEditableText for description:**
This is simpler than title. Use a `<textarea>` with auto-resize:

```tsx
function InlineEditableText({ value, onChange, placeholder, multiline }: InlineEditableTextProps): ReactNode {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea to content
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea && multiline) {
      textarea.style.height = 'auto'
      textarea.style.height = `${textarea.scrollHeight}px`
    }
  }, [value, multiline])

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={1}
      className="bg-transparent border-none outline-none w-full resize-none text-sm text-gray-600 italic focus:ring-2 ..."
    />
  )
}
```

The `italic` class matches the description style in `NoteView.tsx` line 193-196.

### Testing Strategy

**InlineEditableTitle tests:**
- Renders as styled input that looks like plain text
- Shows placeholder with muted styling when empty
- Calls onChange on each keystroke (controlled input)
- Variant="name" applies monospace styling
- Disabled prop prevents editing

**useTagAutocomplete hook tests** (test independently like `cleanMarkdown`):
- `addTag` validates and adds valid tags, returns false for invalid
- `removeTag` removes tag from array
- `filteredSuggestions` filters based on inputValue
- `moveHighlight` cycles through suggestions correctly
- `selectHighlighted` adds the highlighted suggestion
- `getPendingValue` returns current inputValue
- Rejects duplicate tags
- Rejects invalid tag formats

**InlineEditableTags tests:**
- Renders tags as removable pills
- X button removes tag from array
- "+" button shows input field
- Autocomplete dropdown appears when typing
- Keyboard navigation (arrow keys navigate, Enter confirms, Tab moves to next field)
- `getPendingValue()` ref method works for form submission

**InlineEditableText tests:**
- Renders as text, not visible input border
- Auto-resizes textarea to content height when multiline
- Respects maxLength prop

**Accessibility:**
- All components should have appropriate ARIA roles
- Focus states are visible
- Keyboard-only operation works

### Dependencies
- None (can be built in parallel with Milestone 1)

### Risk Factors
- Mobile/touch interaction may need special handling - tap to edit should work
- Focus management between inline fields - Tab should move to next field naturally
- Ensuring styled inputs look like plain text across all browsers (test on Safari, Firefox, Chrome)

---

## Milestone 3: Unified Note Component

### Goal
Replace separate NoteView and NoteEditor with a single unified Note component.

### Success Criteria
- [ ] Single component handles viewing and editing
- [ ] Inline editable title, tags, description
- [ ] Milkdown content editor with Visual/Markdown toggle
- [ ] Save/Discard buttons appear when content is dirty
- [ ] Draft auto-save to localStorage for recovery
- [ ] All existing functionality preserved (archive, delete, keyboard shortcuts)

### Key Changes

**1. Create new `Note.tsx` component:**

Structure:
```
┌─────────────────────────────────────────────────────────────┐
│ [Close]  [Discard]  [Save]              [Archive]  [Delete] │
├─────────────────────────────────────────────────────────────┤
│ Note Title                                                  │  ← InlineEditableTitle
│ tag1 ✕  tag2 ✕  +  ·  Created Jan 7  ·  v2                 │  ← InlineEditableTags + timestamps
│                                                             │
│ Description text...                                         │  ← InlineEditableText
│─────────────────────────────────────────────────────────────│
│ [Visual] [Markdown]                                         │
│                                                             │
│ Content...                                                  │  ← ContentEditor (Milkdown/CodeMirror)
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**2. State management:**
```typescript
interface NoteState {
  title: string
  description: string
  content: string
  tags: string[]
}

// Track dirty state by comparing to original
const isDirty = !isEqual(currentState, originalState)
```

**3. Button visibility:**
- Close: Always visible
- Discard: Only when dirty (with confirmation)
- Save: Only when dirty
- Archive/Delete: Always visible (existing behavior)

**4. Read-only mode for archived/deleted items:**
When `viewState === 'archived'` or `viewState === 'deleted'`, the note should be read-only:
- All inline editable fields (title, description, tags) should be disabled
- Content editor should be disabled/read-only
- Save/Discard buttons hidden (nothing to save)
- Only show Restore/Delete actions as appropriate

**5. Draft recovery:**
- Auto-save to localStorage every 30 seconds when dirty (keep existing pattern)
- Show "Restore Draft" prompt when draft exists
- Clear draft on successful save

**6. Update NoteDetail page:**
- Remove conditional rendering of NoteView vs NoteEditor
- Use single Note component
- Handle loading, error states

### Implementation Details

**Understanding the existing architecture:**

The current flow in `NoteDetail.tsx` is:
1. Route determines mode: `view` | `edit` | `create`
2. Conditionally renders either `NoteView` or `NoteEditor`
3. `NoteEditor` has its own form state and draft management
4. `NoteView` is read-only, uses `MarkdownViewer` for content

The new architecture collapses this:
1. Route no longer determines view vs edit (always editable)
2. Single `Note` component handles everything
3. Dirty state determines button visibility
4. Draft management stays similar but moves to unified component

**File structure change:**
```
Before:
  src/components/NoteView.tsx      (delete in Milestone 5)
  src/components/NoteEditor.tsx    (delete in Milestone 5)
  src/pages/NoteDetail.tsx

After:
  src/components/Note.tsx          (new - unified component)
  src/pages/NoteDetail.tsx         (simplified)
```

**Preserve existing patterns from NoteEditor.tsx:**

1. **Draft management** (lines 88-133): Keep the `DRAFT_KEY_PREFIX`, `getDraftKey`, `loadDraft`, `saveDraft`, `clearDraft` functions. They work well.

2. **Cancel confirmation** (lines 232-256): The double-click cancel with 3-second timeout is a good UX pattern. Keep it.

3. **Keyboard shortcuts** (lines 277-303): Cmd+S to save, Escape to cancel. Keep exactly as-is.

4. **Form validation** (lines 323-343): Title required, length limits. Keep the validation logic.

5. **Pending tag handling** (lines 351-360): The `tagInputRef.current?.getPendingValue()` pattern for capturing typed but uncommitted tags. The new `InlineEditableTags` needs to support this.

**Add `beforeunload` handler for navigation warning:**
When the form is dirty, warn users before they accidentally navigate away (browser back, close tab, refresh):

```typescript
useEffect(() => {
  const handleBeforeUnload = (e: BeforeUnloadEvent): void => {
    if (isDirty) {
      e.preventDefault()
      // Modern browsers ignore custom messages, but this triggers the native dialog
    }
  }

  window.addEventListener('beforeunload', handleBeforeUnload)
  return () => window.removeEventListener('beforeunload', handleBeforeUnload)
}, [isDirty])
```

This complements the in-app discard confirmation. The browser shows its native "Leave site? Changes may not be saved" dialog.

**Props interface for Note.tsx:**
```typescript
interface NoteProps {
  /** Existing note when editing, undefined when creating */
  note?: Note
  /** Available tags for autocomplete */
  tagSuggestions: TagCount[]
  /** Called when note is saved */
  onSave: (data: NoteCreate | NoteUpdate) => Promise<void>
  /** Called when user closes/cancels */
  onClose: () => void
  /** Whether a save is in progress */
  isSaving?: boolean
  /** Initial tags to populate (e.g., from current list filter) */
  initialTags?: string[]
  /** Called when note is archived */
  onArchive?: () => void
  /** Called when note is unarchived */
  onUnarchive?: () => void
  /** Called when note is deleted */
  onDelete?: () => void
  /** Called when note is restored from trash */
  onRestore?: () => void
  /** View state for conditional action buttons */
  viewState?: 'active' | 'archived' | 'deleted'
  /** Whether to use full width layout */
  fullWidth?: boolean
}
```

**Simplifying NoteDetail.tsx:**

The page component becomes much simpler:

```typescript
export function NoteDetail(): ReactNode {
  const { id } = useParams<{ id: string }>()
  const isCreate = !id || id === 'new'

  // ... fetch note, mutations, navigation logic stays similar ...

  if (isLoading) return <LoadingSpinnerCentered label="Loading note..." />
  if (error) return <ErrorState message={error} />

  return (
    <Note
      key={note?.id ?? 'new'}  // Force remount on ID change
      note={note}
      tagSuggestions={tagSuggestions}
      onSave={isCreate ? handleCreate : handleUpdate}
      onClose={handleBack}
      isSaving={createMutation.isPending || updateMutation.isPending}
      initialTags={initialTags}
      onArchive={viewState === 'active' ? handleArchive : undefined}
      onUnarchive={viewState === 'archived' ? handleUnarchive : undefined}
      onDelete={handleDelete}
      onRestore={viewState === 'deleted' ? handleRestore : undefined}
      viewState={viewState}
      fullWidth={fullWidthLayout}
    />
  )
}
```

**Route simplification:**
Remove the `/edit` routes entirely. The unified component is always editable, so separate edit routes are unnecessary cruft:
- Delete: `/app/notes/:id/edit` route
- Delete: `/app/prompts/:id/edit` route
- Update any navigation that uses these routes to use the base routes instead

**Handling the metadata row layout:**

The metadata row has: tags, timestamps, version. Current NoteView renders this nicely (lines 164-189). Replicate this layout but with editable tags:

```tsx
<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500">
  <InlineEditableTags
    value={state.tags}
    onChange={(tags) => setState(prev => ({ ...prev, tags }))}
    suggestions={tagSuggestions}
  />
  {state.tags.length > 0 && note && <span className="text-gray-300">·</span>}
  {note && (
    <>
      <span>Created {formatDate(note.created_at)}</span>
      {note.updated_at !== note.created_at && (
        <>
          <span className="text-gray-300">·</span>
          <span>Updated {formatDate(note.updated_at)}</span>
        </>
      )}
      {note.version > 1 && (
        <>
          <span className="text-gray-300">·</span>
          <span className="text-gray-400">v{note.version}</span>
        </>
      )}
    </>
  )}
</div>
```

For new notes (no `note` prop), hide timestamps entirely since there's nothing to show yet.

### Testing Strategy

**Dirty state:**
- Save/Discard buttons hidden when clean, visible when dirty
- Dirty detection works for title, description, tags, and content changes
- Content changes via Milkdown trigger dirty state (may need integration test)

**Save flow:**
- onSave called with only changed fields (partial update)
- Buttons disabled while isSaving=true
- Validation errors prevent save (title required, length limits)

**Discard flow:**
- First click shows "Discard?" confirmation text
- Second click within 3s calls onClose
- Confirmation resets after 3 seconds (use fake timers)
- If not dirty, single click closes immediately

**Keyboard shortcuts:**
- Cmd+S saves when dirty
- Escape triggers discard confirmation when dirty
- Escape closes immediately when clean

**Navigation warning (beforeunload):**
- When dirty, `beforeunload` event handler is registered
- When clean, handler is removed
- Handler calls `e.preventDefault()` to trigger browser's native "unsaved changes" dialog

**Draft recovery:**
- Shows restore prompt when localStorage has draft for this note ID
- "Restore Draft" populates form with draft data
- "Discard" removes draft from localStorage
- Successful save clears draft
- Auto-saves to localStorage every 30 seconds when dirty

**Create mode (no note prop):**
- Empty fields with placeholders
- Timestamps row hidden
- initialTags prop pre-populates tags

**Action buttons:**
- Archive/Unarchive/Delete/Restore shown based on viewState prop
- All actions call their respective callbacks

### Dependencies
- Milestone 1: Production Milkdown Editor
- Milestone 2: Inline Editable Components

### Risk Factors
- Complex state management between inline fields and content editor
- Ensuring all existing NoteView/NoteEditor functionality is preserved
- Mobile responsiveness with new layout

---

## Milestone 4: Unified Prompt Component

### Goal
Apply the same unified pattern to Prompts, accounting for Prompt-specific fields.

### Success Criteria
- [ ] Single component handles viewing and editing prompts
- [ ] Name field (required, monospace style)
- [ ] Title field (optional, for MCP client display)
- [ ] Description, tags with inline editing
- [ ] Arguments builder integration
- [ ] Template content with Visual/Markdown toggle
- [ ] All existing functionality preserved

### Key Changes

**1. Create new `Prompt.tsx` component:**

Structure:
```
┌─────────────────────────────────────────────────────────────┐
│ [Close]  [Discard]  [Save]              [Archive]  [Delete] │
├─────────────────────────────────────────────────────────────┤
│ my-prompt-name                                              │  ← InlineEditableTitle variant="name" (monospace)
│ Optional Display Title                                      │  ← InlineEditableTitle (optional)
│ tag1 ✕  tag2 ✕  +  ·  Created Jan 7  ·  v2                 │
│                                                             │
│ Description text...                                         │
├─────────────────────────────────────────────────────────────┤
│ Arguments: [topic ▾]  [style ▾]  [+ Add]                   │  ← Existing ArgumentsBuilder
├─────────────────────────────────────────────────────────────┤
│ [Visual] [Markdown]                                         │
│                                                             │
│ Template content with {{ variables }}...                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**2. Prompt-specific considerations:**
- Name is required, must match pattern `^[a-z0-9]+(-[a-z0-9]+)*$`
- Name displayed in monospace/code style
- Title is optional (for MCP client display purposes)
- ArgumentsBuilder remains as existing component (below metadata, above content)
- Template variables `{{ var }}` should be visually distinct in editor (nice-to-have)

**3. Validation:**
- Name: required, pattern validation, show error inline
- Title: optional
- Arguments: existing validation (unique names, valid format)
- Template: warn if uses undefined variables (existing behavior)

### Implementation Details

**This is largely a copy of Note.tsx with Prompt-specific fields.**

The structure is similar enough that you could consider a shared base, but the fields differ enough that separate components are cleaner. Don't over-abstract.

**Key differences from Note:**
1. `name` field instead of `title` as primary identifier (required, monospace, stricter validation)
2. Additional `title` field (optional, human-readable display name)
3. `arguments` array field with ArgumentsBuilder component
4. Template validation checks for undefined variables

**Reuse from PromptEditor.tsx:**

1. **Name validation** (lines 86-88): `PROMPT_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/`

2. **Argument validation** (lines 306-326): Validates argument names match `ARG_NAME_PATTERN`, checks for duplicates.

3. **Template variable validation** (lines 329-347): Uses `extractTemplateVariables()` utility to find undefined variables and unused arguments.

4. **Default content for new prompts** (lines 20-52): `DEFAULT_PROMPT_CONTENT` - keep this helpful onboarding text.

5. **usePromptDraft hook**: Already extracted to `src/hooks/usePromptDraft.ts`. Reuse it directly.

**ArgumentsBuilder integration:**
The existing `ArgumentsBuilder` component works well. It lives between the metadata section and the content editor. No changes needed to ArgumentsBuilder itself - just include it in the layout.

**Visual hierarchy for name vs title:**
- Name: Large monospace text, primary position (like Note's title)
- Title: Smaller, regular text, secondary position, with placeholder "Display title (optional)"

This mirrors how the current PromptEditor.tsx lays out name (required, first) and title (optional, second).

**Route simplification (same as Notes):**
- Delete: `/app/prompts/:id/edit` route
- Keep: `/app/prompts/:id` and `/app/prompts/new`

### Testing Strategy

**Prompt-specific tests (beyond Note tests):**
- Name validation: required, pattern enforcement, inline error display
- Title field: optional, doesn't affect dirty state when empty→empty
- Arguments: changes to arguments trigger dirty state
- Template validation: shows warning for undefined variables, shows warning for unused arguments
- Default content: new prompts get DEFAULT_PROMPT_CONTENT

**Reuse patterns from Note tests for:**
- Dirty state, save/discard flow, keyboard shortcuts, draft recovery, beforeunload navigation warning

### Dependencies
- Milestone 3: Unified Note Component (establishes the pattern)

### Risk Factors
- Arguments builder may need layout adjustments for the unified layout
- Name field has strict validation - need good inline error UX for invalid input
- Two "title-like" fields (name and title) may be confusing - ensure clear visual hierarchy and labeling

---

## Milestone 5: Cleanup and Polish

### Goal
Remove deprecated components, dead routes, and polish the implementation.

### Success Criteria
- [ ] Deprecated components removed
- [ ] Dead routes removed
- [ ] No orphaned imports or dead code
- [ ] All tests passing
- [ ] Prototype/test page removed
- [ ] Dirty state detection normalized (Note.tsx and usePromptDraft use same pattern)

### Key Changes

**1. Delete deprecated components:**
- `src/components/NoteView.tsx`
- `src/components/NoteEditor.tsx`
- `src/components/PromptView.tsx`
- `src/components/PromptEditor.tsx`

**2. Delete dead routes from App.tsx:**
- `/app/notes/:id/edit`
- `/app/prompts/:id/edit`

**3. Clean up MarkdownEditor.tsx:**
- Remove `MarkdownViewer` export if no longer used elsewhere
- Or keep it if BookmarkDetail or other components use it (check first)

**4. Remove prototype:**
- Delete `/app/settings/editor-prototype` route from App.tsx
- Delete `src/pages/settings/SettingsEditorPrototype.tsx`

**5. Rename for clarity (optional):**
Consider renaming the old `MarkdownEditor.tsx` to `CodeMirrorEditor.tsx` since it's now just the CodeMirror implementation, not the primary editor.

**6. Search for dead imports:**
Run `grep -r "NoteView\|NoteEditor\|PromptView\|PromptEditor" src/` to find any missed references.

**7. Normalize dirty state detection pattern:**
Currently inconsistent between Note and Prompt:
- `Note.tsx` uses `useMemo + isEqual(current, original)` for dirty detection
- `usePromptDraft` uses field-by-field string comparison + `JSON.stringify` for arrays

This inconsistency is brittle (adding a field requires updating comparison logic) and harder to reason about.

Options:
- a) Create shared `useDirtyState(current, original)` hook used by both
- b) Update `usePromptDraft` to use `isEqual` internally for consistency

Either approach eliminates the field-by-field comparison and ensures both components use the same reliable pattern.

### Testing Strategy
- Run `npm run lint` - should have no errors
- Run `npm run typecheck` - should have no errors
- Run `npm run test:run` - all tests pass
- Manual smoke test: create/edit/delete a Note and Prompt
- Test on mobile viewport (Chrome DevTools device mode)

### Dependencies
- All previous milestones

### Risk Factors
- May discover components are used in unexpected places - grep before deleting

---

## Implementation Notes

### State Management Pattern
Use a consistent pattern across Note and Prompt components:

```typescript
// Track original values for dirty detection
const [original, setOriginal] = useState<State>(initialState)
const [current, setCurrent] = useState<State>(initialState)

const isDirty = useMemo(() => !isEqual(current, original), [current, original])

// Reset to clean state after save
const handleSaveSuccess = (savedData: State) => {
  setOriginal(savedData)
  setCurrent(savedData)
}
```

### CSS Approach
- Use Tailwind classes for inline editable components
- Keep Milkdown CSS scoped to `.milkdown-wrapper` (in index.css)
- Avoid importing global theme CSS (learned from nord theme breaking layout)

### Keyboard Shortcuts
Preserve existing shortcuts:
- `Cmd+S` - Save
- `Escape` - Close/Cancel (with confirmation if dirty)
- `Cmd+B` - Bold (in editor)
- `Cmd+I` - Italic (in editor)
- `Cmd+K` - Insert link (in editor)

### Error Handling
- Show validation errors inline near the relevant field
- Show API errors in alert banner at top
- Never lose user input on errors
- Draft recovery handles crash/navigation scenarios

---

## Decisions Made

These were open questions that have been resolved:

### Milestone 1
1. **Visual/Markdown mode preference**: Global (stored in localStorage). All documents use the same preference.
2. **New note/prompt starting mode**: Use the user's saved preference (same as existing documents).
3. **Timestamps on new items**: Hidden. Only show Created/Updated/Version for existing items.
4. **Template variable highlighting**: Nice-to-have, not required for initial implementation.

### Milestone 2
5. **InlineEditableTags interaction**: Use "+" button only (not invisible click areas). Invisible click areas are poor UX - users don't know they exist.
6. **Pending tag ref support**: Yes, `InlineEditableTags` must expose `getPendingValue()` via ref for Milestone 3 form submission.
7. **Tab key behavior in tag autocomplete**: Tab always moves to next field (standard form behavior). Never selects suggestions - use Enter/click for that.
8. **Hook interface design**: `useTagAutocomplete` exposes primitives (state + actions) rather than a monolithic `handleKeyDown`. Components compose their own keyboard handling.
9. **Implementation order**: Build InlineEditableTitle → InlineEditableText → InlineEditableTags (simpler components first establish visual patterns).

## Known Limitations

Document these for users/future reference:

1. **Multi-tab conflicts**: If the same note is open in multiple browser tabs, localStorage drafts may conflict. One tab's draft could overwrite another's. This is acceptable for beta.

2. **WYSIWYG syntax typing**: Typing markdown syntax (e.g., `**bold**`) produces literal characters, not formatting. Users must use keyboard shortcuts (Cmd+B, Cmd+I, Cmd+K) or a future toolbar.

## Open Questions

If any of these arise during implementation, make a reasonable decision and document it:

1. Should Discard button always be visible (disabled when clean) or completely hidden when clean?
2. If Milkdown has performance issues with large documents, at what threshold should we warn users or fall back to Markdown mode?
3. Should we add a formatting toolbar for discoverability? Could integrate with existing keyboard shortcuts dialog. (Nice-to-have, not required for initial implementation.)
