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
A working prototype exists at:
- `src/components/MilkdownEditor.tsx` - Core editor component
- `src/pages/settings/SettingsEditorPrototype.tsx` - Test page
- Route: `/app/settings/editor-prototype`

The prototype includes solutions for:
- Checkbox/task list rendering and toggling
- Copy/paste preserving markdown
- Cleaning `<br />` and `&nbsp;` artifacts
- Custom link dialog (Cmd+K)
- Scoped CSS styling (avoiding global pollution from themes)

---

## Milestone 1: Production-Ready Milkdown Editor

### Goal
Transform the prototype MilkdownEditor into a production-ready component with Visual/Markdown mode toggle.

### Success Criteria
- [ ] MilkdownEditor works reliably with all common markdown features
- [ ] Visual/Markdown toggle switches between WYSIWYG and raw CodeMirror editing
- [ ] All keyboard shortcuts work (Cmd+B, Cmd+I, Cmd+K, etc.)
- [ ] Copy/paste preserves markdown correctly
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

**4. Fix known prototype issues:**
- External value changes don't update Milkdown (need to handle content resets)
- Ensure undo/redo works correctly across mode switches

### Testing Strategy
- Unit tests for mode toggling
- Test markdown round-trip (type in Visual → switch to Markdown → verify output)
- Test keyboard shortcuts in both modes
- Test copy/paste in both modes
- Test task list checkbox toggling
- Test link insertion dialog

### Dependencies
- None (this is the foundation)

### Risk Factors
- Mode switching may lose cursor position
- Complex markdown (tables, code blocks) may render differently in each mode
- Performance with large documents in Milkdown

---

## Milestone 2: Inline Editable Components

### Goal
Create reusable components for inline-editable metadata fields that look like view mode but are editable.

### Success Criteria
- [ ] InlineEditableTitle - large styled text, click to edit with cursor
- [ ] InlineEditableTags - view-style tags with X to remove, + to add
- [ ] InlineEditableText - for description and similar fields
- [ ] All components feel native, not like form fields
- [ ] Keyboard navigation works (Tab between fields, Enter to confirm)
- [ ] Components are accessible

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
- "+" button or click empty area to add
- Autocomplete dropdown for suggestions
- Same validation as current TagInput

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

### Testing Strategy
- Test each component in isolation
- Test keyboard navigation (Tab, Enter, Escape)
- Test with empty values and placeholders
- Test tag autocomplete
- Test validation (required fields, max length)
- Test disabled state

### Dependencies
- None (can be built in parallel with Milestone 1)

### Risk Factors
- Accessibility concerns with non-standard form controls
- Mobile/touch interaction may need special handling
- Focus management between inline fields

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

**4. Draft recovery:**
- Auto-save to localStorage every 30 seconds when dirty (keep existing pattern)
- Show "Restore Draft" prompt when draft exists
- Clear draft on successful save

**5. Update NoteDetail page:**
- Remove conditional rendering of NoteView vs NoteEditor
- Use single Note component
- Handle loading, error states

### Testing Strategy
- Test dirty state detection
- Test Save/Discard flow with confirmation
- Test draft auto-save and recovery
- Test keyboard shortcuts (Cmd+S, Escape)
- Test all actions (archive, delete, close)
- Test new note creation flow
- Test navigation away with unsaved changes

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

### Testing Strategy
- Test name validation (required, pattern)
- Test optional title field
- Test arguments builder integration
- Test all prompt-specific actions
- Test with existing prompts (backward compatibility of display)

### Dependencies
- Milestone 3: Unified Note Component (establishes the pattern)

### Risk Factors
- Arguments builder may need layout adjustments
- Name field has strict validation that may feel awkward with inline editing
- Two "title-like" fields (name and title) may be confusing - ensure clear visual hierarchy

---

## Milestone 5: Cleanup and Polish

### Goal
Remove deprecated components, update all references, and polish the implementation.

### Success Criteria
- [ ] Deprecated components removed
- [ ] No orphaned imports or dead code
- [ ] All tests passing
- [ ] Prototype/test page removed or converted

### Key Changes

**1. Remove deprecated components:**
- `NoteView.tsx` - replaced by Note.tsx
- `NoteEditor.tsx` - replaced by Note.tsx
- `PromptView.tsx` - replaced by Prompt.tsx
- `PromptEditor.tsx` - replaced by Prompt.tsx
- `MarkdownViewer` export from MarkdownEditor.tsx - no longer needed

**2. Update imports:**
- Update NoteDetail.tsx to use Note.tsx
- Update PromptDetail.tsx to use Prompt.tsx
- Search codebase for any remaining references

**3. Clean up prototype:**
- Remove `/app/settings/editor-prototype` route from App.tsx
- Remove `SettingsEditorPrototype.tsx`

**4. Final review:**
- Run full test suite
- Manual testing of all flows
- Mobile viewport testing

### Testing Strategy
- Run full test suite
- Manual E2E testing of Note and Prompt CRUD flows
- Verify no console errors or warnings
- Test on mobile viewport sizes

### Dependencies
- All previous milestones

### Risk Factors
- May discover missed references during cleanup
- Tests for removed components need removal/update

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

## Open Questions

If any of these are unclear during implementation, ask before proceeding:

1. Should the Visual/Markdown mode preference be per-document or global?
2. When creating a new note/prompt, should it start in Visual or Markdown mode?
3. Should timestamps (Created, Updated) be hidden on new/unsaved items?
4. For prompts, is template variable highlighting (`{{ var }}`) a requirement or nice-to-have?
