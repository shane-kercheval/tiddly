# Implementation Plan: Markdown Editor Link Improvements

**Date**: 2026-01-13
**Status**: Ready for Implementation
**Complexity**: Milestone 1 (LOW) + Milestone 2 (MEDIUM) + Milestone 3 (VERY LOW)

## Overview

Enhance the Milkdown editor's link handling capabilities by:
1. Making links clickable via Cmd+Click (Mac) or Ctrl+Click (Windows/Linux) to open in new tab
2. Detecting existing links when editing, pre-populating both link text and URL in the dialog
3. Fixing "Leave Site?" warning when submitting link dialog + adding Enter key support

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

Solution - Walk the document to find all text nodes with link marks that contain the cursor:

```typescript
// Find the full extent of the link by walking the document
view.state.doc.nodesBetween(0, view.state.doc.content.size, (node, pos) => {
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

This approach handles all edge cases including cursor at:
- Character 0 of link (exact start) - adjacent node will be found
- Middle of link - current node will be found
- Last character of link - current node will be found
- With entire link selected - all nodes in range will be found

3. **Update `LinkDialog` component** to accept and display URL:

```typescript
interface LinkDialogProps {
  open: boolean
  initialText: string
  initialUrl: string  // NEW
  isEdit: boolean     // NEW (optional, for UI messaging)
  onSubmit: (url: string, text: string) => void
  onClose: () => void
}

// In component:
// Pre-fill URL field with initialUrl
// Consider showing "Edit Link" vs "Insert Link" title based on isEdit
```

4. **Update Cmd+K keyboard shortcut** to use same logic:

The existing shortcut handler (lines 1068-1080) should call the same link detection logic to maintain consistency.

**Testing Strategy**:

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
- **MEDIUM RISK**: Mark detection at boundaries is tricky
- ProseMirror's `marks()` behavior varies by position (see documentation)
- Boundary detection requires walking document (O(n) complexity)
  - Mitigation: Only runs on button click, not per keystroke
  - Performance: Document walks happen elsewhere (e.g., code block plugin), no issues observed
- Multiple edge cases require thorough testing
- Risk: Might miss edge cases in initial implementation → Plan for iteration after testing

**Implementation Decisions**:

1. **Partial link selection**: If user highlights "lin" in "[link](url)", detect and edit the full link (more intuitive than creating new nested link)

2. **Link mark spec**: Do NOT add `inclusive: true` to the link mark schema initially. Only add if boundary detection proves problematic during testing.

3. **Dialog button text**: Keep "Insert Link" for simplicity. Changing to "Update Link" when editing requires conditional logic that adds complexity without significant UX benefit.

---

### Milestone 3: Fix Modal Form Submission Architecture

**Goal**: Fix the "Leave Site?" dialog that appears when submitting the LinkDialog form, and apply the same architectural fix to all modal forms for consistency and future-proofing. Add Enter key support for form submission.

**Success Criteria**:
- [ ] LinkDialog: Clicking "Insert Link" button does NOT trigger "Leave Site?" warning
- [ ] LinkDialog: Pressing Enter in either input field submits the form
- [ ] LinkDialog: Works correctly in all contexts (Notes, Bookmarks, Prompts)
- [ ] CreateTokenModal: Updated to same pattern (remove `<form>`)
- [ ] FilterModal: Updated to same pattern (remove `<form>`)
- [ ] CollectionModal: Updated to same pattern (remove `<form>`)
- [ ] All modals: Enter key submits from input fields
- [ ] No regression in existing form behavior

**Root Cause Analysis**:

The bug occurs in LinkDialog when:
1. User is editing a Note/Bookmark/Prompt with unsaved changes (`isDirty=true`)
2. Parent component has active `beforeunload` event handler (see Note.tsx:200-211, Bookmark.tsx:275-285, Prompt.tsx:275-285)
3. User submits LinkDialog form
4. Form submission (even with `preventDefault()`) triggers browser navigation check
5. `beforeunload` handler intercepts and shows "Leave Site?" warning

**Research Sources**:
- [How to Use onbeforeunload with Form Submit Buttons](https://randomdrake.com/2009/09/23/how-to-use-onbeforeunload-with-form-submit-buttons/)
- [MDN: beforeunload event](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)
- [Implementing Unsaved Changes Alert in React App](https://taran.hashnode.dev/preventing-data-loss-implementing-unsaved-changes-alert-in-react-app)

**The Issue**: HTML forms without explicit `action` attribute default to submitting to the current URL. Even though React's `preventDefault()` stops the submission, the browser's navigation check can fire BEFORE preventDefault is called, triggering the beforeunload handler.

**Architectural Fix**: While only LinkDialog currently exhibits this bug (due to context), we're fixing all modal forms for consistency and to prevent future issues. Modal dialogs conceptually shouldn't use `<form>` elements that attempt navigation - they're UI interactions with inputs, not traditional HTML form submissions.

**Key Changes**:

Apply this pattern to all 4 modal forms: **LinkDialog**, **CreateTokenModal**, **FilterModal**, and **CollectionModal**.

For each modal, remove the `<form>` element and use explicit button handlers. Example (LinkDialog):

```typescript
function LinkDialog({
  isOpen,
  onClose,
  onSubmit,
  initialText = '',
  initialUrl = 'https://',
}: LinkDialogProps): ReactNode {
  const [url, setUrl] = useState(initialUrl)
  const [text, setText] = useState(initialText)

  const handleSubmit = (): void => {
    if (url && url !== 'https://') {
      onSubmit(url, text || url)
      onClose()
    }
  }

  // Add Enter key handler for inputs
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Insert Link" maxWidth="max-w-md">
      {/* No longer a form - just a div */}
      <div className="space-y-4">
        <div>
          <label htmlFor="link-text" className="label mb-1">
            Link Text
          </label>
          <input
            id="link-text"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Display text for the link"
            className="input"
          />
        </div>
        <div>
          <label htmlFor="link-url" className="label mb-1">
            URL
          </label>
          <input
            id="link-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="https://example.com"
            className="input"
            required
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
          <button type="button" onClick={handleSubmit} className="btn-primary">
            Insert Link
          </button>
        </div>
      </div>
    </Modal>
  )
}
```

**Why this approach**:
- No `<form>` element means no form submission event
- No navigation attempt means beforeunload never fires
- Enter key explicitly handled via `onKeyDown`
- Cleaner and more explicit control over submission
- No risk of browser form submission quirks
- Consistent with other non-navigating UI patterns (dialogs shouldn't trigger navigation)

**Testing Strategy**:

**Manual Testing** (Critical):

**LinkDialog** (has the bug):
1. Create a Note with some content (triggers isDirty=true)
2. Click link toolbar button to open dialog
3. Enter URL and click "Insert Link"
4. **Verify**: No "Leave Site?" warning appears
5. **Verify**: Link is inserted correctly
6. Repeat test:
   - Press Enter in text field → should submit
   - Press Enter in URL field → should submit
   - Click Cancel → should close without inserting
7. Test in Bookmark and Prompt editors (same beforeunload handlers)

**CreateTokenModal** (no bug, but test pattern):
1. Navigate to Settings → API Tokens
2. Click "Create Token" button
3. Enter token name, select expiry
4. Press Enter in name field → should submit
5. Click "Create Token" → should show token
6. **Verify**: No unexpected warnings or errors

**FilterModal** (no bug, but test pattern):
1. Navigate to Lists page
2. Click filter icon on any list
3. Enter filter text
4. Press Enter in filter field → should apply filter
5. Click "Apply" → should filter list
6. **Verify**: No unexpected warnings or errors

**CollectionModal** (no bug, but test pattern):
1. Navigate to Lists page
2. Click "New List" button
3. Enter list name
4. Press Enter in name field → should submit
5. Click submit button → should create list
6. **Verify**: No unexpected warnings or errors

**Edge Cases** (test on all modals):
- Empty required fields (should not submit)
- Rapid Enter key presses (should not double-submit)
- Tab to Cancel button, press Enter → should close without submitting
- Escape key → should close (existing Modal behavior)

**Unit Tests** (Medium Value if easy to implement):
- Test that Enter key in either field triggers submission
- Test that empty/placeholder URL doesn't submit
- Mock beforeunload and verify it's not triggered

**Testing Note**: The user mentioned "It seems like we should have tests that would catch this but perhaps the testing strategy for this is too complex given the low risk."

**Decision on tests**:
- **DO add**: Simple manual test checklist (already defined above)
- **DON'T add**: Complex automated tests that mock beforeunload handlers
  - Reason: beforeunload is browser-level, hard to test in Jest
  - Manual testing is sufficient given LOW risk after fix
  - Test value doesn't justify effort for this specific issue

**Dependencies**:
- None (can be done independently or alongside Milestone 2)

**Risk Factors**:
- **VERY LOW RISK**: Straightforward fix
- Removing `<form>` element is safe - dialog is internal component
- Enter key handling is explicit and testable
- No changes to parent components (Note/Bookmark/Prompt)

**Implementation Decisions**:

1. **Scope**: Fix all 4 modal forms (LinkDialog, CreateTokenModal, FilterModal, CollectionModal) for consistency and future-proofing, even though only LinkDialog currently has the bug. This ensures all modals follow the same architectural pattern.

2. **Enter key handling**: Only handle Enter in input fields (not buttons). Let default focus/tab behavior work naturally. Test to verify Cancel button doesn't submit on Enter.

3. **Code changes per modal**: Each modal requires the same pattern:
   - Remove `<form>` wrapper, replace with `<div>`
   - Change `onSubmit={handleSubmit}` to `onClick={handleSubmit}` on submit button
   - Change `type="submit"` to `type="button"` on submit button
   - Add `onKeyDown` handler to input fields for Enter key
   - Remove `e.preventDefault()` from handleSubmit (no longer needed)

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
3. Do you need clarification on any ProseMirror concepts?
4. Are the testing requirements clear for all three milestones?
5. Do you understand why the beforeunload bug occurs and how the fix prevents it (Milestone 3)?

Ask clarifying questions rather than making assumptions.
