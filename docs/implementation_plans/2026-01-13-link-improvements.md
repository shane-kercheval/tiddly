# Implementation Plan: Markdown Editor Link Improvements

**Date**: 2026-01-13
**Status**: Ready for Implementation
**Complexity**: Milestone 1 (LOW) + Milestone 2 (MEDIUM-HIGH) + Milestone 3 (LOW)

## Overview

Enhance the Milkdown editor's link handling capabilities by:
1. Making links clickable via Cmd+Click (Mac) or Ctrl+Click (Windows/Linux) to open in new tab
2. Detecting existing links when editing, pre-populating both link text and URL in the dialog, and updating links in-place
3. Fixing "Leave Site?" warning when submitting link dialog by making beforeunload handlers modal-aware

## Background

The application uses Milkdown v7.18.0, a WYSIWYG markdown editor built on ProseMirror. The codebase already includes custom ProseMirror plugins (`createCodeBlockCopyPlugin`, `createPlaceholderPlugin`, `createListKeymapPlugin`) demonstrating the pattern for extending editor functionality.

**Current Link Dialog Behavior**:
- Opens with text field pre-populated from selection
- URL field always starts empty with `https://` placeholder
- Does NOT detect if cursor is within an existing link
- Does NOT extract URL from existing links for editing

**Current Click Behavior**:
- Links are rendered but not clickable
- Clicking a link places cursor, doesn't navigate
- No way to follow links without copying URL manually

## Key Documentation

**IMPORTANT**: Read these before implementing:

1. **ProseMirror handleDOMEvents**: https://prosemirror.net/docs/ref/#view.EditorProps.handleDOMEvents
   - Core mechanism for intercepting DOM events
   - Handler receives `(view, event)` and returns boolean
   - Return `true` to indicate event was handled

2. **ProseMirror Marks API**: https://prosemirror.net/docs/ref/#model.Mark
   - Understanding mark detection: `MarkType.isInSet(marks)`
   - Mark attributes: `mark.attrs.href` for links
   - Selection marks: `state.storedMarks` vs `$from.marks()`

3. **Milkdown ProseMirror Integration**: https://milkdown.dev/docs/guide/prosemirror-api
   - Import from `@milkdown/kit/prose/*` namespace
   - Use `$prose()` helper to create plugin slices
   - Plugin registration via `.use(pluginSlice)` in editor chain

4. **Community Discussions**:
   - Clickable links pattern: https://discuss.prosemirror.net/t/clickable-links/3628
   - Mark detection at cursor: https://discuss.prosemirror.net/t/getting-mark-when-cursor-or-selection-is-between-the-bounds-of-a-given-mark-type/2821
   - ProseMirror Cookbook (mark utilities): https://github.com/PierBover/prosemirror-cookbook

## Milestones

### Milestone 1: Clickable Links with Cmd+Click

**Goal**: Enable users to open links in new tabs using Cmd+Click (Mac) or Ctrl+Click (Windows/Linux)

**Success Criteria**:
- [ ] Cmd+Click (or Ctrl+Click) on any link opens it in a new tab
- [ ] Normal clicks still place cursor normally
- [ ] Text selection workflows unaffected
- [ ] Works on both macOS and Windows/Linux
- [ ] Security: Links open with `noopener,noreferrer` flags

**Key Changes**:

1. Create new custom ProseMirror plugin in `MilkdownEditor.tsx`:

```typescript
import { Plugin } from '@milkdown/kit/prose/state'

function createLinkClickPlugin(): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        click(view, event) {
          // Platform-specific modifier key detection
          // Mac: Cmd (metaKey), Windows/Linux: Ctrl (ctrlKey)
          const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
          const isModClick = isMac ? event.metaKey : event.ctrlKey
          if (!isModClick) return false

          // Get ProseMirror position at click location
          const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
          if (!coords) return false

          // Check if there's a link mark at this position
          const $pos = view.state.doc.resolve(coords.pos)
          const linkMarkType = view.state.schema.marks.link
          const linkMark = linkMarkType?.isInSet($pos.marks())

          if (linkMark) {
            const href = linkMark.attrs.href
            if (href) {
              window.open(href, '_blank', 'noopener,noreferrer')

              // CRITICAL: handleDOMEvents does NOT automatically call preventDefault()
              // You must call it explicitly yourself, even when returning true
              event.preventDefault()
              return true
            }
          }

          return false
        }
      }
    }
  })
}
```

2. Register plugin with Milkdown:

```typescript
// Create plugin slice
const linkClickPluginSlice = $prose(() => createLinkClickPlugin())

// Add to editor.use() chain (alongside existing plugins)
.use(linkClickPluginSlice)
```

**Testing Strategy**:

**Manual Testing** (Critical):
- Create test document with multiple links (internal/external, http/https)
- Verify Cmd+Click (Mac) opens each link in new tab
- Verify Ctrl+Click (Windows/Linux) opens link in new tab
- Verify normal click still places cursor
- Verify normal text selection (click+drag) still works
- Verify links open with security flags (check browser's new tab context)

**Edge Cases**:
- Links with special characters in URL
- Links with nested formatting (bold/italic link text)
- Links at document boundaries
- Empty links (should not open)
- **Cmd+Click on selected link**: If user selects entire link text and Cmd+Clicks, it should open the link (selection is visual state, not navigation blocker). The position-based approach handles this correctly.
- **Ctrl+Click on macOS**: Should NOT open link (Ctrl+Click is right-click/context menu on Mac). Only Cmd+Click opens links on Mac.

**Browser Testing**:
- Chrome/Edge (most users)
- Firefox
- Safari (macOS specific)

**Dependencies**: None

**Risk Factors**:
- **LOW RISK**: Straightforward DOM event handling
- Potential conflict: If other plugins handle click events, ensure proper event propagation
- Browser compatibility: `event.metaKey` vs `event.ctrlKey` - solution already accounts for both

---

### Milestone 2: Link Detection for Editing

**Goal**: When user clicks link toolbar button (or Cmd+K) with cursor inside an existing link, detect the link and pre-populate both text and URL fields in the dialog

**Success Criteria**:
- [ ] Cursor in link + click toolbar button → dialog shows existing text and URL
- [ ] Cursor in link + Cmd+K → dialog shows existing text and URL
- [ ] Text selected in link → dialog shows text and URL
- [ ] Entire link selected → dialog shows text and URL
- [ ] Cursor NOT in link → dialog shows empty URL (existing behavior)
- [ ] Dialog updates link in-place when editing existing link
- [ ] Works correctly with cursor at start/middle/end of link

**Key Changes**:

1. **Add state for URL and edit mode** in `MilkdownEditor.tsx`:

```typescript
const [linkDialogInitialUrl, setLinkDialogInitialUrl] = useState('')
const [linkDialogIsEdit, setLinkDialogIsEdit] = useState(false)
```

**IMPORTANT**: Do NOT store `linkStart` and `linkEnd` in component state. ProseMirror positions are absolute document offsets that become invalid after any edit. Instead, re-detect link boundaries when the dialog is submitted.

2. **Create boundary detection helper function**:

This helper will be reused in both `handleToolbarLinkClick` and `handleLinkSubmit` to avoid code duplication:

```typescript
/**
 * Find the boundaries of a link mark at the given cursor position.
 * Uses block-scoped search for performance (O(m) where m = paragraph size).
 *
 * @param view - ProseMirror editor view
 * @param cursorPos - Cursor position to check
 * @param linkMarkType - Link mark type from schema
 * @returns Object with start, end, and mark, or null if not in a link
 */
function findLinkBoundaries(
  view: EditorView,
  cursorPos: number,
  linkMarkType: MarkType
): { start: number; end: number; mark: Mark } | null {
  const $from = view.state.doc.resolve(cursorPos)

  // Check if cursor is in a link mark
  // CRITICAL: $from.marks() doesn't include marks at exact start position
  // Use nodeAfter fallback to detect cursor at link boundary
  let linkMark = linkMarkType.isInSet($from.marks())

  // Boundary case: cursor at start of link
  if (!linkMark && $from.nodeAfter) {
    linkMark = linkMarkType.isInSet($from.nodeAfter.marks)
  }

  if (!linkMark) return null

  // Find link boundaries by walking current block
  const blockStart = $from.start($from.depth)
  const blockEnd = $from.end($from.depth)

  let linkStart = cursorPos
  let linkEnd = cursorPos

  view.state.doc.nodesBetween(blockStart, blockEnd, (node, pos) => {
    if (node.isText && node.marks.some(m => m.type === linkMarkType)) {
      const nodeEnd = pos + node.nodeSize
      // Check if this text node contains our cursor position
      if (pos <= cursorPos && nodeEnd >= cursorPos) {
        // This is part of our link - expand boundaries
        linkStart = Math.min(linkStart, pos)
        linkEnd = Math.max(linkEnd, nodeEnd)
      }
    }
  })

  return { start: linkStart, end: linkEnd, mark: linkMark }
}
```

3. **Update `handleToolbarLinkClick` callback** to use the helper:

```typescript
const handleToolbarLinkClick = useCallback(() => {
  const editor = get()
  if (!editor) return

  const view = editor.ctx.get(editorViewCtx)
  const { from, to } = view.state.selection
  const linkMarkType = view.state.schema.marks.link
  if (!linkMarkType) return

  // Use helper to detect if cursor is in a link
  const linkBoundaries = findLinkBoundaries(view, from, linkMarkType)

  if (linkBoundaries) {
    // Verify selection is fully inside this link
    // If selection extends beyond link, treat as "create new link"
    if (to > linkBoundaries.end) {
      // Selection spans beyond link - ambiguous, create new
      const selectedText = view.state.doc.textBetween(from, to)
      setLinkDialogInitialText(selectedText)
      setLinkDialogInitialUrl('')
      setLinkDialogIsEdit(false)
    } else {
      // EXISTING LINK: Extract href and text
      const href = linkBoundaries.mark.attrs.href || ''
      const linkText = view.state.doc.textBetween(linkBoundaries.start, linkBoundaries.end)

      setLinkDialogInitialText(linkText)
      setLinkDialogInitialUrl(href)
      setLinkDialogIsEdit(true)
    }
  } else {
    // NEW LINK: Use selected text if any
    const selectedText = view.state.doc.textBetween(from, to)
    setLinkDialogInitialText(selectedText)
    setLinkDialogInitialUrl('')
    setLinkDialogIsEdit(false)
  }

  setLinkDialogKey((k) => k + 1)
  setLinkDialogOpen(true)
}, [get])
```

**Key Implementation Details**:

The `findLinkBoundaries` helper handles several critical edge cases:

1. **Cursor at link start**: Uses `nodeAfter` fallback because `$from.marks()` doesn't include marks at exact start position
2. **Block-scoped search**: Only searches current paragraph (O(m)) not entire document (O(n)) to prevent lag on large documents
3. **Multi-node links**: Finds all text nodes with the same link mark (handles links with formatted text like `[**bold** text](url)`)

This approach handles all cursor positions:
- Character 0 of link (exact start) - `nodeAfter` fallback detects the link
- Middle of link - `$from.marks()` detects the link
- Last character of link - `$from.marks()` detects the link
- With entire link selected - link boundaries are found via block walk

**Limitation**: Links cannot span multiple blocks (paragraphs), but this matches markdown semantics where links are inline elements.

3. **Update `LinkDialog` component** to accept and display URL:

```typescript
interface LinkDialogProps {
  open: boolean
  initialText: string
  initialUrl: string  // NEW
  isEdit: boolean     // NEW
  onSubmit: (url: string, text: string) => void
  onClose: () => void
}

// In component:
// Pre-fill URL field with initialUrl
```

4. **Update `handleLinkSubmit` to distinguish editing vs creating**:

**CRITICAL**: The existing codebase's `handleLinkSubmit` (MilkdownEditor.tsx:765-789) creates a NEW link and replaces the selection. When editing an existing link, this would split the link or create nested marks. We need to update the link in-place.

```typescript
const handleLinkSubmit = useCallback((url: string, text: string) => {
  const editor = get()
  if (!editor) return

  const view = editor.ctx.get(editorViewCtx)
  const linkMarkType = view.state.schema.marks.link

  if (linkDialogIsEdit) {
    // EDITING EXISTING LINK
    // Re-detect link boundaries at submission time using helper
    // ProseMirror positions become invalid after document edits
    const { from } = view.state.selection
    const linkBoundaries = findLinkBoundaries(view, from, linkMarkType)

    if (!linkBoundaries) {
      // Link no longer exists (user may have deleted it while dialog was open)
      // Fall back to creating new link
      const mark = linkMarkType.create({ href: url })
      const linkNode = view.state.schema.text(text, [mark])
      const tr = view.state.tr.replaceSelectionWith(linkNode, false)
      view.dispatch(tr)
      view.focus()
      return
    }

    const tr = view.state.tr

    // Check if text was changed
    const originalText = view.state.doc.textBetween(linkBoundaries.start, linkBoundaries.end)
    if (text !== originalText) {
      // Text changed - replace entire link (new text + new URL)
      const newMark = linkMarkType.create({ href: url })
      const textNode = view.state.schema.text(text, [newMark])
      tr.replaceWith(linkBoundaries.start, linkBoundaries.end, textNode)
    } else {
      // Only URL changed - preserve existing text and formatting (bold/italic/etc)
      tr.removeMark(linkBoundaries.start, linkBoundaries.end, linkMarkType)
      const newMark = linkMarkType.create({ href: url })
      tr.addMark(linkBoundaries.start, linkBoundaries.end, newMark)
    }

    view.dispatch(tr)
    view.focus()
  } else {
    // CREATING NEW LINK
    // Existing logic (MilkdownEditor.tsx:765-790) works fine for new links
    const mark = linkMarkType.create({ href: url })
    const linkNode = view.state.schema.text(text || url, [mark])  // Use URL as fallback if text is empty
    const tr = view.state.tr.replaceSelectionWith(linkNode, false)
    view.dispatch(tr)
    view.focus()
  }
}, [get, linkDialogIsEdit])
```

**Key differences**:
- **Edit mode**: Re-detects boundaries at submission time using `findLinkBoundaries` helper
- **Formatting preservation**: If only URL changed, uses `removeMark` + `addMark` to preserve bold/italic/code formatting. If text also changed, replaces text node (formatting on new text is intentional).
- **Create mode**: Uses `replaceSelectionWith` to insert new link
- **Text change detection**: Compares original text with submitted text to determine which update strategy to use
- **Empty text fallback**: If user clears text field, uses URL as link text (matches Google Docs behavior)
- **Position safety**: Never stores positions in state - always detects fresh to avoid invalid position errors
- **Edge case handling**: If link was deleted while dialog was open, falls back to creating new link instead of crashing

5. **Update Cmd+K keyboard shortcut** to use same logic:

The existing shortcut handler (lines 1068-1080) should call the same link detection logic to maintain consistency.

**Testing Strategy**:

**Performance Testing** (MANDATORY - BLOCKER FOR MILESTONE 2):

This testing is **required before shipping** Milestone 2. If performance requirements are not met, the implementation must be revised.

**Setup**:
1. Create a test note with 5000+ lines (or 50,000+ characters)
2. Add several links throughout the document
3. Place cursor at various positions within links

**Test Procedure**:
1. Place cursor at start of link in middle of document
2. Click link toolbar button
3. Measure time to open dialog with pre-filled URL
4. **PASS CRITERIA**: Dialog opens in <100ms with no visible lag
5. Repeat at end of document to verify no degradation

**Failure Investigation**:
- If lag occurs (>100ms), check `findLinkBoundaries` implementation
- Verify `nodesBetween` uses `blockStart/blockEnd`, not `0/doc.content.size`
- Check browser console for performance warnings
- Consider adding performance.now() timing logs if needed

**Why this is critical**: Block-scoped search is O(m) where m = paragraph size. If implementation accidentally uses full document search O(n), large documents will lag severely (5+ seconds on 10,000 line documents).

**Unit/Integration Tests** (High Value):
- Mock ProseMirror state with link marks at various positions
- Test mark detection logic with cursor at:
  - Exact start of link (edge case)
  - Middle of link
  - End of link
  - Outside link
- Test boundary detection with:
  - Single-word links
  - Multi-word links
  - Links with punctuation
  - Adjacent links (should detect only one)
- Test editing vs creating:
  - Editing link preserves boundaries
  - Creating link replaces selection
  - Text only updates if changed

**Manual Testing** (Critical):
Create test document with these scenarios:

```markdown
This is [a link](https://example.com) in text.
[Link at start](https://start.com) of line.
End of line [link here](https://end.com)
Multiple [link one](https://one.com) and [link two](https://two.com) together.
[**Bold link**](https://bold.com) with formatting.
```

For each link, test:
1. Place cursor at start → click toolbar button → verify text and URL pre-filled
2. Place cursor in middle → click toolbar button → verify text and URL pre-filled
3. Place cursor at end → click toolbar button → verify text and URL pre-filled
4. Select entire link → click toolbar button → verify text and URL pre-filled
5. Select partial link text → click toolbar button → verify behavior (decide: edit full link or create new?)
6. Use Cmd+K instead of toolbar button → verify same behavior
7. Edit URL in dialog → submit → verify link updates correctly

**Edge Cases**:
- Empty link text: `[](https://example.com)`
- Empty URL: `[text]()`
- **Empty link text in dialog**: User clears text field → uses URL as link text (e.g., `[https://example.com](https://example.com)`) - matches Google Docs behavior
- Link with special characters: `[link](#section-1)`
- Link with encoded characters: `[link](https://example.com/path%20with%20spaces)`
- **Cursor between two adjacent links**: `[link1](url1)|[link2](url2)` with cursor at `|` → detects link2 (right-hand link). This matches ProseMirror's typing model where cursor position determines which marks apply when typing. The `nodeAfter` fallback enables this behavior.
- **Link with formatted text**: `[**bold** text](url)` → boundary detection finds the text node containing the cursor. If cursor is in "text", it detects "text" only. However, formatting preservation (decision 10) ensures that if user only changes URL, all formatting is preserved via removeMark + addMark. Known limitation: if user edits both text AND URL with cursor in one node of multi-node link, only that node is updated.
- Link with nested marks (bold/italic/code mixed within link text)
- **Selection spanning multiple links**: `[link1](url1) text [link2](url2)` with selection from middle of link1 to middle of link2 → should NOT detect any link (ambiguous), treat as new link creation
- **Links in code blocks**: Code blocks render as plain text without markdown processing, so links inside code blocks should not be clickable. The position-based detection will not find link marks in code block text nodes (code blocks are separate node types), so this should work correctly by default.

**Dependencies**:
- Milestone 1 (optional, but recommended to complete first for logical progression)

**Risk Factors**:
- **MEDIUM-HIGH RISK**: Mark detection at boundaries is tricky
- ProseMirror's `marks()` behavior varies by position (see documentation)
- Boundary detection requires walking paragraph (O(m) complexity where m = paragraph size)
  - Mitigation: Only runs on button click, not per keystroke
  - Mitigation: Block-scoped search prevents performance issues on large documents
  - Performance testing required with 5000+ line documents
- Edit vs create logic adds complexity - must preserve link boundaries when editing
- Multiple edge cases require thorough testing
- Risk: Might miss edge cases in initial implementation → Plan for iteration after testing

**Implementation Decisions**:

1. **Partial link selection**: If user highlights "lin" in "[link](url)", detect and edit the full link. This matches Google Docs/Notion behavior and is more intuitive because links have URLs that need full context to edit (unlike bold/italic which are just styles).

2. **Link mark spec**: Do NOT add `inclusive: true` to the link mark schema initially. Only add if boundary detection proves problematic during testing.

3. **Dialog button text**: Keep "Insert Link" for simplicity. Changing to "Update Link" when editing requires conditional logic that adds complexity without significant UX benefit.

4. **Boundary detection library**: The codebase doesn't include `prosemirror-utils` as a dependency (verified via package.json). Use manual block-scoped boundary detection via `findLinkBoundaries` helper function. Do NOT add new dependencies.

5. **Position storage**: Never store ProseMirror positions (`linkStart`, `linkEnd`) in React state. Positions are absolute offsets that become invalid after any document edit. Always re-detect boundaries at submission time using the `findLinkBoundaries` helper.

6. **Code reuse**: Extract boundary detection logic into a shared `findLinkBoundaries` helper function used by both `handleToolbarLinkClick` and `handleLinkSubmit`. This prevents code duplication and ensures consistent behavior.

7. **Empty link text**: If user clears the text field in LinkDialog, use the URL as link text (e.g., `[https://example.com](https://example.com)`). This matches Google Docs behavior and prevents links with empty text.

8. **Selection spanning multiple links**: If selection overlaps multiple links or extends beyond a detected link, do NOT detect any link (ambiguous case). Treat as new link creation using the selected text. Implemented via guard that checks `to > linkBoundaries.end`.

9. **Adjacent links cursor position**: Cursor between `[link1](url1)|[link2](url2)` detects link2 (right-hand link). This matches ProseMirror's typing model where cursor position determines which marks apply. The `nodeAfter` fallback in `findLinkBoundaries` enables this behavior.

10. **Formatting preservation**: When editing an existing link, if only the URL changed (text unchanged), preserve all existing formatting (bold/italic/code) by using `removeMark` + `addMark`. Only replace text nodes when user actually changed the text.

11. **Platform-specific modifier keys**: Use Cmd (metaKey) on macOS and Ctrl (ctrlKey) on Windows/Linux for clickable links. Prevent Ctrl+Click on macOS from triggering link navigation (Ctrl+Click is right-click/context menu on Mac).

12. **Position-based click detection**: Use `view.posAtCoords()` + mark detection instead of DOM traversal (`closest('a')`). This is more robust and works regardless of how Milkdown renders links in the DOM.

13. **Milkdown plugin registration**: Use `$prose(() => createPlugin())` pattern verified in existing codebase (createCodeBlockCopyPlugin, createPlaceholderPlugin). Register with `.use(pluginSlice)` in editor chain.

---

### Milestone 3: Make beforeunload Handlers Modal-Aware

**Goal**: Fix the "Leave Site?" dialog that appears when submitting the LinkDialog form by making the beforeunload handlers aware of modal state, so they don't fire during legitimate modal interactions.

**Success Criteria**:
- [ ] Note.tsx: beforeunload handler checks `isModalOpen` flag
- [ ] Bookmark.tsx: beforeunload handler checks `isModalOpen` flag
- [ ] Prompt.tsx: beforeunload handler checks `isModalOpen` flag
- [ ] MilkdownEditor: Sets `isModalOpen` when LinkDialog opens/closes
- [ ] LinkDialog: Clicking "Insert Link" button does NOT trigger "Leave Site?" warning
- [ ] LinkDialog: Works correctly in all contexts (Notes, Bookmarks, Prompts)
- [ ] No regression in existing beforeunload behavior (still warns on actual navigation)
- [ ] Native form Enter key submission still works

**Root Cause Analysis**:

**Original diagnosis was incorrect**. The LinkDialog already has `e.preventDefault()` (line 329), so it's NOT attempting navigation.

**Actual root cause**: The beforeunload event fires due to a focus/timing issue when clicking the submit button. The browser sees potential navigation before React processes the click, triggering the beforeunload check.

**Research Sources**:
- [How to Use onbeforeunload with Form Submit Buttons](https://randomdrake.com/2009/09/23/how-to-use-onbeforeunload-with-form-submit-buttons/)
- [MDN: beforeunload event](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)
- [Implementing Unsaved Changes Alert in React App](https://taran.hashnode.dev/preventing-data-loss-implementing-unsaved-changes-alert-in-react-app)

**Industry Standard Solution**: VS Code, GitHub, and Google Docs all use modal-aware beforeunload handlers that check if a modal is currently open before showing the warning.

**Key Changes**:

**1. Update parent components (Note.tsx, Bookmark.tsx, Prompt.tsx)**:

Add `isModalOpen` state and pass it to editor:

```typescript
// In Note.tsx (same pattern for Bookmark.tsx, Prompt.tsx)
const [isModalOpen, setIsModalOpen] = useState(false)

// Update beforeunload handler
useEffect(() => {
  const handleBeforeUnload = (e: BeforeUnloadEvent): void => {
    // Only warn if dirty AND no modal is open
    if (isDirty && !isModalOpen) {
      e.preventDefault()
      e.returnValue = '' // Required for Chrome
    }
  }

  window.addEventListener('beforeunload', handleBeforeUnload)
  return () => window.removeEventListener('beforeunload', handleBeforeUnload)
}, [isDirty, isModalOpen])  // Add isModalOpen to dependency array

// Pass to ContentEditor
<ContentEditor
  value={content}
  onChange={handleContentChange}
  onModalStateChange={setIsModalOpen}  // NEW PROP
  // ... other props
/>
```

**2. Update ContentEditor.tsx**:

Accept `onModalStateChange` prop and pass to both editors:

```typescript
// Update interface (around line 83)
interface ContentEditorProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  hasError?: boolean
  minHeight?: string
  placeholder?: string
  helperText?: string
  label?: string
  maxLength?: number
  showJinjaTools?: boolean
  onModalStateChange?: (isOpen: boolean) => void  // NEW
}

// Update component signature (around line 115)
export function ContentEditor({
  value,
  onChange,
  disabled = false,
  hasError = false,
  minHeight,
  placeholder,
  helperText,
  label,
  maxLength,
  showJinjaTools = false,
  onModalStateChange,  // NEW
}: ContentEditorProps): ReactNode {
  // ... existing code ...

  // Pass to both editors (around line 319)
  {mode === 'markdown' ? (
    <MilkdownEditor
      value={value}
      onChange={onChange}
      onModalStateChange={onModalStateChange}  // NEW PROP
      // ... other props
    />
  ) : (
    <CodeMirrorEditor
      value={value}
      onChange={onChange}
      onModalStateChange={onModalStateChange}  // NEW PROP (for consistency)
      // ... other props
    />
  )}
}
```

**3. Update CodeMirrorEditor.tsx**:

Add `onModalStateChange` to interface for consistency (but don't implement - CodeMirrorEditor has no modals):

```typescript
// Update interface (around line 35)
interface CodeMirrorEditorProps {
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  minHeight?: string
  placeholder?: string
  wrapText?: boolean
  noPadding?: boolean
  autoFocus?: boolean
  copyContent?: string
  showJinjaTools?: boolean
  onModalStateChange?: (isOpen: boolean) => void  // NEW (no-op, for consistency)
}

// Component signature - add to destructuring
export function CodeMirrorEditor({
  value,
  onChange,
  disabled = false,
  minHeight = '200px',
  placeholder,
  wrapText = true,
  noPadding = false,
  autoFocus = false,
  copyContent,
  showJinjaTools = false,
  onModalStateChange,  // NEW (unused, but accepted)
}: CodeMirrorEditorProps): ReactNode {
  // ... existing code, no need to call onModalStateChange anywhere
}
```

**Note**: CodeMirrorEditor never calls `onModalStateChange` because it has no modal dialogs. This prop exists purely for interface consistency with MilkdownEditor.

**4. Update MilkdownEditor.tsx**:

Call `onModalStateChange` when LinkDialog opens/closes:

```typescript
interface MilkdownEditorProps {
  // ... existing props
  onModalStateChange?: (isOpen: boolean) => void
}

// Update handleToolbarLinkClick
const handleToolbarLinkClick = useCallback(() => {
  // ... existing link detection logic ...

  setLinkDialogOpen(true)
  onModalStateChange?.(true)  // Notify parent modal is opening
}, [get, onModalStateChange])

// Update dialog close handler
const handleLinkDialogClose = useCallback(() => {
  setLinkDialogOpen(false)
  onModalStateChange?.(false)  // Notify parent modal is closing
}, [onModalStateChange])

// Use in LinkDialog component
<LinkDialog
  isOpen={linkDialogOpen}
  onClose={handleLinkDialogClose}  // Use new handler
  // ... other props
/>
```

**Why this approach**:
- **Fixes root cause**: Prevents beforeunload from firing during legitimate modal interactions
- **Preserves semantic HTML**: LinkDialog keeps `<form>` element with native validation
- **Preserves accessibility**: Form landmarks remain for screen readers
- **Keeps native Enter key**: HTML forms already handle Enter submission
- **Minimal code churn**: Only touch beforeunload handlers and editor props
- **Industry standard**: Same pattern used by VS Code, GitHub, Google Docs
- **Surgical fix**: Only affects the interaction causing the bug

**Testing Strategy**:

**Manual Testing** (Critical):

**LinkDialog in Note/Bookmark/Prompt** (has the bug):
1. Create a Note with some content (triggers isDirty=true)
2. Click link toolbar button to open dialog
3. Enter URL and click "Insert Link" button
4. **Verify**: No "Leave Site?" warning appears
5. **Verify**: Link is inserted correctly
6. Press Enter in URL field → should submit (native form behavior)
7. Test in Bookmark and Prompt editors (same beforeunload handlers)

**beforeunload still works for actual navigation**:
1. Create a Note with unsaved changes (isDirty=true)
2. Do NOT open any dialog
3. Try to close browser tab or navigate away
4. **Verify**: "Leave Site?" warning DOES appear
5. Click "Leave" → navigates away
6. Click "Stay" → remains on page

**Modal state tracking**:
1. Open LinkDialog
2. **Verify**: isModalOpen is true (check React DevTools if needed)
3. Close LinkDialog (Cancel or Insert)
4. **Verify**: isModalOpen is false
5. Try to navigate away with unsaved changes
6. **Verify**: Warning appears (modal is closed, so warning should show)

**Edge Cases**:
- Multiple modals open simultaneously (shouldn't happen, but verify isModalOpen handles it)
- Dialog closed via Escape key → verify isModalOpen set to false
- Dialog closed via X button → verify isModalOpen set to false
- Error in form submission → modal stays open, isModalOpen stays true

**Unit Tests** (Low Value - Skip):
- beforeunload is browser-level, difficult to test in Jest
- Modal state management is simple useState
- Manual testing is sufficient given LOW risk

**Dependencies**:
- None (can be done independently of other milestones)

**Risk Factors**:
- **LOW RISK**: Simple state management change
- beforeunload logic is well-isolated in useEffect hooks
- Only 3 files to modify (Note, Bookmark, Prompt)
- ContentEditor and MilkdownEditor just pass props through
- No changes to dialog components themselves
- Easy to rollback if issues arise

**Implementation Decisions**:

1. **Scope**: Modify Note.tsx, Bookmark.tsx, Prompt.tsx, ContentEditor.tsx, MilkdownEditor.tsx, and CodeMirrorEditor.tsx. Do NOT modify any dialog/modal components.

2. **State management**: Use simple boolean flag `isModalOpen` tracked in parent components. No need for complex modal management library.

3. **Modal types**: Only track LinkDialog for now. Other modals (filter, collection, token) don't appear in contexts with beforeunload handlers. If future features add more dialogs to editor contexts, extend this pattern.

4. **Prop naming**: Use `onModalStateChange` to be clear about purpose and follow React event naming conventions.

5. **CodeMirrorEditor interface**: Add `onModalStateChange` prop to CodeMirrorEditor for interface consistency with MilkdownEditor, even though CodeMirrorEditor never calls it (has no modals). This makes the editor interface uniform.

---

## Implementation Notes

### Code Style Adherence

- **Type hints**: All functions must have type annotations (per CLAUDE.md)
- **Imports**: Never import inside functions/classes
- **Single quotes**: Use for code strings, double quotes for user-facing text
- **Testing**: Use descriptive test names: `test__<function_name>__<scenario>`

### No Over-Engineering

- **Do**: Handle error cases (null checks, undefined guards)
- **Do**: Test edge cases thoroughly
- **Do**: Follow existing patterns (see other custom plugins)
- **Don't**: Add features not discussed (e.g., link preview tooltips, custom link styling)
- **Don't**: Add configuration options unless needed
- **Don't**: Refactor unrelated code

### Breaking Changes Policy

- **No backwards compatibility required** - this is a feature addition
- Feel free to refactor dialog component if needed for cleaner implementation
- OK to change function signatures in `MilkdownEditor.tsx` (internal component)

### Performance Considerations

- Both features trigger on user actions (clicks, button presses), NOT per keystroke
- Document walks (Milestone 2) only happen on toolbar button click
- Expected overhead: <5ms on button click (negligible)
- No measurable impact on typing performance

### Security Considerations

- Links must open with `noopener,noreferrer` to prevent:
  - `window.opener` access from external sites
  - Referrer leaking to external sites
- URL validation: ProseMirror already sanitizes in markdown serialization
- No additional sanitization needed for click handling

---

## Definition of Done

Each milestone is complete when:

1. **Code**: Implementation matches success criteria
2. **Tests**: All manual test scenarios pass
3. **Edge Cases**: All documented edge cases handled
4. **Code Review**: Agent self-reviews for type hints, error handling, style
5. **Documentation**: Updated if user-facing behavior changes (e.g., keyboard shortcuts in help text)

**Stop after each milestone** for human review before proceeding.

---

## Rollback Plan

If issues arise during implementation:

**Milestone 1**: Simply remove plugin from `.use()` chain - no other code dependencies

**Milestone 2**: More integrated, but can be rolled back by:
- Reverting state additions
- Restoring original `handleToolbarLinkClick` logic
- Reverting `LinkDialog` prop changes

No database migrations or API changes involved.

---

## Future Enhancements (Out of Scope)

These are NOT part of this implementation but could be considered later:

- Link preview on hover (like Google Docs)
- Link validation warnings for broken URLs
- Keyboard shortcut to remove link (Cmd+Shift+K)
- Recent links dropdown
- Link auto-detection while typing
- Automated tests for link functionality (only if high-value tests can be added with minimal effort)

Focus on the three milestones defined above. Do not implement these unless explicitly requested.

---

## Questions for Agent

Before implementing, verify understanding:

1. Do you understand the ProseMirror plugin pattern (`$prose(() => createPlugin())`) verified in the existing codebase?
2. **CRITICAL**: Do you understand why `$from.marks()` doesn't include marks at exact start position, and why `nodeAfter` fallback is required?
3. Do you understand why the `findLinkBoundaries` helper function is extracted and reused (prevents code duplication between `handleToolbarLinkClick` and `handleLinkSubmit`)?
4. Do you understand why block-scoped search (`blockStart` to `blockEnd`) is required instead of full document search (`0` to `doc.content.size`) for performance?
5. **CRITICAL**: Do you understand why ProseMirror positions must NOT be stored in React state and must be re-detected at submission time?
6. Do you understand the difference between editing links (removeMark + addMark when URL-only change) vs creating links (replaceSelectionWith)?
7. **CRITICAL**: Do you understand why formatting preservation matters (when only URL changes, use removeMark + addMark to keep bold/italic; when text changes, replaceWith is fine)?
8. Do you understand the expected behavior for cursor between adjacent links (detects link2, the right-hand link, via nodeAfter)?
9. Do you understand the expected behavior for links with formatted text inside (should detect entire link across multiple text nodes)?
10. Do you understand the expected behavior for selection spanning beyond detected link boundaries (guard checks `to > linkBoundaries.end`, treats as new link)?
11. Do you understand the expected behavior for empty link text (use URL as fallback text)?
12. **CRITICAL - BLOCKER**: Do you understand that performance testing with 5000+ line documents is MANDATORY before shipping Milestone 2, and what the pass criteria is (<100ms)?
13. Do you understand why the original Milestone 3 diagnosis was incorrect (not missing preventDefault, but focus/timing issue)?
14. Do you understand how the modal-aware beforeunload fix works and why it's better than removing `<form>` elements?
15. Do you understand why CodeMirrorEditor needs `onModalStateChange` prop even though it never calls it (interface consistency)?
16. **CRITICAL**: Do you understand that handleDOMEvents does NOT automatically call preventDefault() and you must call it explicitly?
17. Do you understand why platform-specific modifier key detection is needed (Cmd on Mac, Ctrl on Windows/Linux; prevent Ctrl+Click on Mac)?
18. Do you understand why position-based click detection (`posAtCoords` + mark check) is more robust than DOM traversal (`closest('a')`)?

Ask clarifying questions rather than making assumptions.
