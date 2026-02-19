# Slash Command Dropdown for CodeMirror Editor

## Context

When editing markdown in the CodeMirror editor, users currently rely on toolbar buttons or keyboard shortcuts to insert block formatting (headings, lists, code blocks, etc.). A `/` slash menu provides a discoverable, keyboard-driven alternative — type `/` at the start of a line to get a filterable dropdown of block commands. The dropdown should be clean and minimal, matching the app's gray-scale design with small text-based icons, section headers, and right-aligned syntax hints.

## Approach

Use `@codemirror/autocomplete` (already available as a transitive dependency) with a custom `CompletionSource` that triggers on `/` at the start of a line. The built-in autocomplete handles popup positioning, keyboard navigation, type-to-filter, and Enter/Esc behavior out of the box. We add custom styling and icons to match the app's design.

**No conflict with the global `/` shortcut** — `useKeyboardShortcuts.ts:107` skips `/` when `isInputFocused()` returns true, and CodeMirror's contentEditable div satisfies that check.

## Files

### 1. NEW `frontend/src/utils/slashCommands.ts`

Core slash command logic:

- **`createSlashCommandSource(showJinjaTools: boolean)`** — Factory returning a `CompletionSource` function. Checks:
  - Text before cursor matches `^(\s*)\/(\w*)$` (slash at line start or after whitespace only)
  - Cursor is NOT inside a code block (scan for ``` fences above cursor)
  - Returns `CompletionResult` with `from` at the `/` position, `validFor: /^\/\w*$/`

- **`buildCommands(showJinjaTools: boolean)`** — Returns `Completion[]`:

  | Section | Label | Detail | Apply inserts |
  |---------|-------|--------|---------------|
  | Basic blocks | Heading 1 | `#` | `# ` |
  | Basic blocks | Heading 2 | `##` | `## ` |
  | Basic blocks | Heading 3 | `###` | `### ` |
  | Basic blocks | Bulleted list | `-` | `- ` |
  | Basic blocks | Numbered list | `1.` | `1. ` |
  | Basic blocks | To-do list | `- [ ]` | `- [ ] ` |
  | Advanced | Code block | ` ``` ` | `` ```\n\n``` `` (cursor inside) |
  | Advanced | Blockquote | `>` | `> ` |
  | Advanced | Horizontal rule | `---` | `---\n` |
  | Jinja2* | Variable | `{{ }}` | `{{ variable }}` |
  | Jinja2* | If block | `{% if %}` | if/endif template |
  | Jinja2* | If block (trim) | `{%- if %}` | trimmed if/endif |

  *Jinja2 section only when `showJinjaTools` is true

  Each `apply` is a function that dispatches a single transaction replacing `from..to` (the `/` + filter text) with the markdown syntax, and sets cursor position.

- **`slashCommandAddToOptions`** — Exported `addToOptions` array for rendering text-based icons (e.g., `H1`, `H2`, `-`, `1.`, `</>`) in a styled `<span class="cm-slash-icon">` before each label. Uses a `getIconForType()` map keyed on the completion's `type` field.

- **`_testExports`** — Exposes `buildCommands` for testing.

Imports `JINJA_VARIABLE`, `JINJA_IF_BLOCK`, `JINJA_IF_BLOCK_TRIM` from `'../components/editor/jinjaTemplates'`.

### 2. MODIFY `frontend/src/components/CodeMirrorEditor.tsx`

- Add imports: `autocompletion` from `@codemirror/autocomplete`, `createSlashCommandSource` and `slashCommandAddToOptions` from `../utils/slashCommands`
- **Extensions array** (~line 516): Create the slash source, add `autocompletion()` to extensions:
  ```
  autocompletion({
    override: [slashSource],
    icons: false,
    selectOnOpen: true,
    addToOptions: slashCommandAddToOptions,
  })
  ```
  Add `showJinjaTools` to `useMemo` dependencies.
- **basicSetup** (~line 738): Add `autocompletion: false` to prevent double-registration (basicSetup includes autocompletion by default).

### 3. MODIFY `frontend/src/utils/markdownStyleExtension.ts`

Add CSS rules to `markdownBaseTheme` for:

- **`.cm-tooltip-autocomplete`** — White bg, gray-200 border, 8px radius, subtle shadow, 4px padding
- **`.cm-completionSection`** — Uppercase, 11px, gray-400, letter-spacing; first-of-type no border-top
- **`li[aria-selected]`** — gray-100 bg (matching app's hover states)
- **`.cm-completionLabel`** — 13px, gray-700
- **`.cm-completionDetail`** — 12px monospace, gray-400, `fontStyle: 'normal'` (override default italic), right-aligned via `marginLeft: auto`
- **`.cm-completionMatchedText`** — No underline, bold, gray-900
- **`.cm-completionIcon`** — `display: none` (we use custom icons)
- **`.cm-slash-icon`** — 20x20px, 11px monospace font, gray-500 text, gray-50 bg, gray-200 border, 4px radius, centered flex

### 4. NEW `frontend/src/utils/slashCommands.test.ts`

Tests for `buildCommands`:
- Returns 9 commands without Jinja tools, 12 with
- Correct section assignments (6 basic, 3 advanced, 3 jinja)
- All commands have `detail` and `apply` function
- Section ranks in ascending order (basic < advanced < jinja)
- Labels match expected set

### 5. MODIFY `frontend/package.json`

Add `@codemirror/autocomplete` as explicit dependency (already works as transitive dep, but explicit is safer).

## Verification

1. `npm install` in `frontend/`
2. `npm run test:run` — all tests pass including new slash command tests
3. `npm run lint` — no lint errors
4. Manual testing with `npm run dev`:
   - On a note: type `/` at line start -> dropdown appears with Basic blocks + Advanced sections
   - Type `/head` -> filters to headings only
   - Arrow down + Enter -> inserts `## ` (or whichever selected)
   - Esc closes dropdown
   - `/` mid-sentence -> no dropdown
   - `/` inside a code block -> no dropdown
   - On a prompt: type `/` -> dropdown includes Jinja2 section
   - On a bookmark note: no Jinja2 section
