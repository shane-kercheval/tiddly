# Slash Command Dropdown for CodeMirror Editor

## Context

When editing markdown in the CodeMirror editor, users currently rely on toolbar buttons or keyboard shortcuts to insert block formatting (headings, lists, code blocks, etc.). A `/` slash menu provides a discoverable, keyboard-driven alternative — type `/` at the start of a line (or mid-line after a space) to get a filterable dropdown of block commands. The dropdown includes SVG icons, keyboard shortcut badges, section headers with dividers, and blue selection highlighting.

## Approach

Use `@codemirror/autocomplete` (already available as a transitive dependency) with a custom `CompletionSource` that triggers on `/` preceded by whitespace or line start. The built-in autocomplete handles popup positioning, keyboard navigation, type-to-filter, and Enter/Esc behavior out of the box. We add custom styling, SVG icons, and keyboard shortcut badges to match the app's design.

**No conflict with the global `/` shortcut** — `useKeyboardShortcuts.ts:107` skips `/` when `isInputFocused()` returns true, and CodeMirror's contentEditable div satisfies that check.

**Escape key isolation** — A `Prec.highest` DOM event handler calls `stopPropagation()` when closing the autocomplete dropdown, preventing the Escape from bubbling to parent handlers (discard confirmation).

## Files

### 1. NEW `frontend/src/utils/slashCommands.ts`

Core slash command logic:

- **`createSlashCommandSource(showJinjaTools: boolean)`** — Factory returning a `CompletionSource` function. Checks:
  - Text before cursor matches `(^|\s)\/(\w*)$` (slash at line start, after whitespace, or mid-line after space)
  - Cursor is NOT inside a code block (scan for ``` fences above cursor)
  - Returns `CompletionResult` with `from` after the `/` for label filtering, `validFor: /^\w*$/`

- **`buildCommands(showJinjaTools: boolean)`** — Returns `Completion[]` (10 without Jinja, 13 with):

  | Section | Label | Detail | Shortcut | Apply inserts |
  |---------|-------|--------|----------|---------------|
  | Jinja2* | Variable | `{{ }}` | | `{{ variable }}` |
  | Jinja2* | If block | `{% if %}` | | if/endif template |
  | Jinja2* | If block (trim) | `{%- if %}` | | trimmed if/endif |
  | Basic blocks | Heading 1 | `#` | | `# ` |
  | Basic blocks | Heading 2 | `##` | | `## ` |
  | Basic blocks | Heading 3 | `###` | | `### ` |
  | Basic blocks | Bulleted list | `-` | ⌘⇧8 | `- ` |
  | Basic blocks | Numbered list | `1.` | ⌘⇧7 | `1. ` |
  | Basic blocks | To-do list | `- [ ]` | ⌘⇧9 | `- [ ] ` |
  | Advanced | Code block | ` ``` ` | ⌘⇧E | `` ```\n\n``` `` (cursor inside) |
  | Advanced | Blockquote | `>` | ⌘⇧. | `> ` |
  | Advanced | Link | `[]()` | ⌘K | `[text](url)` ("url" selected) |
  | Advanced | Horizontal rule | `---` | ⌘⇧- | `---\n` |

  *Jinja2 section appears first (rank 0) and only when `showJinjaTools` is true

- **`SVG_ICONS`** — Record mapping completion `type` to raw SVG markup for icon rendering.

- **`SHORTCUT_MAP`** — Record mapping completion `type` to keyboard shortcut key symbols.

- **`slashCommandAddToOptions`** — Two `addToOptions` entries: position 20 renders SVG icons, position 90 renders keyboard shortcut `<kbd>` badges.

- **`_testExports`** — Exposes `buildCommands` and `isInsideCodeBlock` for testing.

### 2. MODIFY `frontend/src/components/CodeMirrorEditor.tsx`

- Add imports: `autocompletion`, `completionStatus` from `@codemirror/autocomplete`; `createSlashCommandSource`, `slashCommandAddToOptions` from `../utils/slashCommands`
- **Extensions array**: Create slash source, add `autocompletion()` and `Prec.highest` Escape handler
- **basicSetup**: Add `autocompletion: false` to prevent double-registration
- Add `showJinjaTools` to `useMemo` dependencies

### 3. MODIFY `frontend/src/utils/markdownStyleExtension.ts`

Add CSS rules to `markdownBaseTheme` using `&` prefix for scoped specificity over CM's baseTheme:

- Tooltip container: white bg, rounded corners, shadow
- Items: 28px height, hover gray-100, selected blue-50
- Section headers: `completion-section` custom elements with dividers
- Labels: 14px, selected blue-700
- Detail: 12px monospace, selected blue-300
- SVG icons: 22x22, gray-400, selected blue-500
- Shortcut badges: kbd elements with fixed 72px width container

### 4. MODIFY `frontend/src/components/editor/EditorToolbarIcons.tsx`

- Update `BlockquoteIcon` to left-bar-with-lines visual matching slash menu icon
- Add comment noting SVG icon sync with `slashCommands.ts`

### 5. NEW `frontend/src/utils/slashCommands.test.ts`

34 tests covering:
- `buildCommands`: counts (10/13), sections (6 basic, 4 advanced, 3 jinja), labels, boost ordering, detail/apply presence
- `createSlashCommandSource`: trigger conditions (7 positive, 6 negative), `from` position (3 tests)
- `isInsideCodeBlock`: normal lines, open/closed fences, multiple fences, indented fences, language fences (9 tests)

### 6. MODIFY `frontend/package.json`

Add `@codemirror/autocomplete` as explicit dependency.

## Verification

1. `npm install` in `frontend/`
2. `npm run test:run` — all tests pass including new slash command tests
3. `npm run lint` — no lint errors
4. Manual testing with `npm run dev`:
   - On a note: type `/` at line start → dropdown appears with Basic blocks + Advanced sections
   - Type `/head` → filters to headings only
   - Arrow down + Enter → inserts `## ` (or whichever selected)
   - Esc closes dropdown without triggering discard
   - `/` mid-line after space → dropdown appears
   - `/` after non-space char (e.g. `word/`) → no dropdown
   - `/` inside a code block → no dropdown
   - On a prompt: type `/` → dropdown includes Jinja2 section at top
   - On a bookmark note: no Jinja2 section
