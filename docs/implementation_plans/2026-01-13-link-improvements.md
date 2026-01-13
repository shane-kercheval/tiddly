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
          // Check for Cmd (Mac) or Ctrl (Windows/Linux)
          const isModClick = event.metaKey || event.ctrlKey
          if (!isModClick) return false

          // Find if clicked element is or contains a link
          const target = event.target as HTMLElement
          const link = target.closest('a')
          if (!link) return false

          // Get href and open in new tab
          const href = link.getAttribute('href')
          if (href) {
            window.open(href, '_blank', 'noopener,noreferrer')
            event.preventDefault()
            return true
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

2. **Update `handleToolbarLinkClick` callback** to detect existing links:

Core logic:
```typescript
const handleToolbarLinkClick = useCallback(() => {
  const editor = get()
  if (!editor) return

  const view = editor.ctx.get(editorViewCtx)
  const { from, to, $from } = view.state.selection

  // Get link mark type from schema
  const linkMarkType = view.state.schema.marks.link
  if (!linkMarkType) return

  // Get marks at cursor position
  // For empty selection: check storedMarks (about to apply) or marks at position
  // For text selection: check marks at start of selection
  const marks = view.state.selection.empty
    ? (view.state.storedMarks || $from.marks())
    : $from.marks()

  // Check if a link mark exists
  const linkMark = linkMarkType.isInSet(marks)

  if (linkMark) {
    // EXISTING LINK: Extract href and find link boundaries
    const href = linkMark.attrs.href || ''

    // Find the full extent of the link by walking the document
    let linkStart = from
    let linkEnd = to

    // TODO: Implement boundary detection
    // Walk backwards from cursor to find link start
    // Walk forwards from cursor to find link end
    // Handle edge case: cursor at exact link start (mark may not be in $from.marks())

    const linkText = view.state.doc.textBetween(linkStart, linkEnd)

    setLinkDialogInitialText(linkText)
    setLinkDialogInitialUrl(href)
    setLinkDialogIsEdit(true)
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

**Boundary Detection Implementation**:

ProseMirror challenge: `$from.marks()` doesn't include marks at the exact start position.

Solution - Walk only the current block/paragraph to find link boundaries (for performance):

```typescript
// IMPORTANT: Only search within current block, not entire document
// This is O(m) where m = paragraph size, not O(n) where n = document size
const $from = view.state.selection.$from
const blockStart = $from.start($from.depth)
const blockEnd = $from.end($from.depth)

// Find the full extent of the link by walking current block
let linkStart = from
let linkEnd = to

view.state.doc.nodesBetween(blockStart, blockEnd, (node, pos) => {
  if (node.isText && node.marks.some(m => m.type === linkMarkType)) {
    const nodeEnd = pos + node.nodeSize
    // Check if this text node contains our cursor position
    if (pos <= from && nodeEnd >= from) {
      // This is part of our link - expand boundaries
      linkStart = Math.min(linkStart, pos)
      linkEnd = Math.max(linkEnd, nodeEnd)
    }
  }
})
```

**Why block-scoped**: Walking the entire document (`0` to `doc.content.size`) is O(n) and causes lag on large documents (5000+ lines). Walking only the current block is O(m) where m is typically <1000 characters.

This approach handles all edge cases including cursor at:
- Character 0 of link (exact start) - adjacent node within block will be found
- Middle of link - current node will be found
- Last character of link - current node will be found
- With entire link selected - all nodes in range will be found

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
    // Remove old link mark and add new one to the SAME text range
    // This preserves the link boundaries and updates it in-place

    const tr = view.state.tr

    // Remove old link mark from the detected boundaries
    tr.removeMark(linkStart, linkEnd, linkMarkType)

    // Add new link mark with updated URL
    const newMark = linkMarkType.create({ href: url })
    tr.addMark(linkStart, linkEnd, newMark)

    // Only update text if user actually changed it
    const originalText = view.state.doc.textBetween(linkStart, linkEnd)
    if (text !== originalText) {
      const textNode = view.state.schema.text(text, [newMark])
      tr.replaceWith(linkStart, linkEnd, textNode)
    }

    view.dispatch(tr)
    view.focus()
  } else {
    // CREATING NEW LINK
    // Existing logic (MilkdownEditor.tsx:765-790) works fine for new links
    const mark = linkMarkType.create({ href: url })
    const linkNode = view.state.schema.text(text, [mark])
    const tr = view.state.tr.replaceSelectionWith(linkNode, false)
    view.dispatch(tr)
    view.focus()
  }
}, [get, linkDialogIsEdit, linkStart, linkEnd])
```

**Key differences**:
- **Edit mode**: Uses `removeMark` + `addMark` to update in-place, preserves boundaries
- **Create mode**: Uses `replaceSelectionWith` to insert new link
- **Text updates**: Only replaces text if user changed it (prevents unnecessary edits)

5. **Update Cmd+K keyboard shortcut** to use same logic:

The existing shortcut handler (lines 1068-1080) should call the same link detection logic to maintain consistency.

**Testing Strategy**:

**Performance Testing** (Critical):
- Create a large note (5000+ lines or 50,000+ characters)
- Place cursor in middle of link
- Click link toolbar button
- **Verify**: No noticeable lag (<100ms)
- **Why**: Ensures block-scoped search is working, not full document walk
- If lag occurs, check that `nodesBetween` uses `blockStart/blockEnd`, not `0/doc.content.size`

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
- Link with special characters: `[link](#section-1)`
- Link with encoded characters: `[link](https://example.com/path%20with%20spaces)`
- Cursor between two adjacent links
- Link with nested marks (bold/italic/code)

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

1. **Partial link selection**: If user highlights "lin" in "[link](url)", detect and edit the full link (more intuitive than creating new nested link)

2. **Link mark spec**: Do NOT add `inclusive: true` to the link mark schema initially. Only add if boundary detection proves problematic during testing.

3. **Dialog button text**: Keep "Insert Link" for simplicity. Changing to "Update Link" when editing requires conditional logic that adds complexity without significant UX benefit.

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

Accept `onModalStateChange` prop and pass to editors:

```typescript
interface ContentEditorProps {
  // ... existing props
  onModalStateChange?: (isOpen: boolean) => void
}

// Pass to both editors
{mode === 'markdown' ? (
  <MilkdownEditor
    value={value}
    onChange={onChange}
    onModalStateChange={onModalStateChange}  // NEW PROP
    // ... other props
  />
) : (
  <CodeMirrorEditor
    // CodeMirrorEditor doesn't have modals, so no prop needed
  />
)}
```

**3. Update MilkdownEditor.tsx**:

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

1. **Scope**: Only modify Note.tsx, Bookmark.tsx, Prompt.tsx, ContentEditor.tsx, and MilkdownEditor.tsx. Do NOT modify any dialog/modal components.

2. **State management**: Use simple boolean flag `isModalOpen` tracked in parent components. No need for complex modal management library.

3. **Modal types**: Only track LinkDialog for now. Other modals (filter, collection, token) don't appear in contexts with beforeunload handlers.

4. **Prop naming**: Use `onModalStateChange` to be clear about purpose and follow React event naming conventions.

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

1. Do you understand the ProseMirror plugin pattern from existing plugins in the codebase?
2. Are the mark detection edge cases clear (Milestone 2)?
3. Do you understand why block-scoped search is required for performance (Milestone 2)?
4. Do you understand the difference between editing (removeMark + addMark) vs creating (replaceSelectionWith) links (Milestone 2)?
5. Do you understand why the original Milestone 3 diagnosis was incorrect?
6. Do you understand how the modal-aware beforeunload fix works and why it's better than removing `<form>` elements (Milestone 3)?
7. Are the testing requirements clear for all three milestones, especially performance testing?

Ask clarifying questions rather than making assumptions.
