# Tip candidates — editor

Scope: the markdown editor used in notes and prompts. Tiddly's editor is CodeMirror 6 (via `@uiw/react-codemirror`) with `basicSetup` enabled by default, plus a custom slash-command source, formatting keymap, search panel (`top: true`), and a Cmd+/ command menu. Reading mode swaps to a Milkdown preview.

`basicSetup` defaults that are confirmed enabled in Tiddly: defaultKeymap, history + historyKeymap, searchKeymap, allowMultipleSelections, rectangularSelection, crosshairCursor, bracketMatching, closeBrackets, indentOnInput, highlightSelectionMatches, drawSelection, dropCursor. Notably overridden: `foldGutter: false`, `highlightActiveLine: false`, `autocompletion: false` (the override-source slash-command autocomplete is wired separately).

References:
- `frontend/src/components/CodeMirrorEditor.tsx:815` — basicSetup options
- `frontend/src/utils/slashCommands.ts` — slash-command source
- `frontend/src/components/editor/editorCommands.ts` — Cmd+/ command palette
- `frontend/src/components/editor/EditorCommandMenu.tsx`
- `frontend/src/utils/editorFormatting.ts` — toggle/wrap formatting helpers
- `frontend/src/utils/markdownStyleExtension.ts` — checkbox-click handler, link cmd-click

## Strong candidates (strongest first)

### Open the editor command palette with ⌘+/
- Description: Press `⌘+/` anywhere in a note or prompt to open a filterable command palette. It collects every formatting, insertion, and editor action (save, discard, toggle reading mode, version history, ToC) in one menu — type a few letters to fuzzy-filter, then Enter.
- Reference: `frontend/src/components/CodeMirrorEditor.tsx:346`, `frontend/src/components/editor/editorCommands.ts`
- Tags: feature | new-user

### Type `/` at the start of a line to insert a block
- Description: Type `/` at the start of an empty line (or after whitespace) to open a block-insert menu — headings, lists, checklist, code block, blockquote, link, horizontal rule. Keep typing to filter (e.g. `/head`). In prompt editors the menu also offers Jinja2 Variable, If block, and If block (trim).
- Reference: `frontend/src/utils/slashCommands.ts:182`, `:71`
- Tags: feature | new-user

### Toggle reading mode with ⌘+⇧+M
- Description: Switch a note or prompt between raw markdown editing and a rendered Milkdown preview without leaving the page. Scroll position is preserved when toggling back.
- Reference: `frontend/src/components/CodeMirrorEditor.tsx:267`, `:303`
- Tags: feature | new-user

### Toggle word wrap, line numbers, and monospace from the keyboard
- Description: `⌥+Z` toggles word wrap, `⌥+L` toggles line numbers, `⌥+M` toggles a monospace font, and `⌥+T` opens the Table of Contents sidebar — all from inside the editor, no toolbar reach.
- Reference: `frontend/src/components/CodeMirrorEditor.tsx:312-340`
- Tags: feature | power-user

### Click a checkbox in the editor to toggle the task
- Description: In the raw markdown editor, you don't have to switch to reading mode to tick off a `- [ ]`. Click directly on the `[ ]` or `[x]` glyph to flip it.
- Reference: `frontend/src/utils/markdownStyleExtension.ts` (mousedown handler + `.cm-md-checklist-checkbox` cursor)
- Tags: feature | new-user

### Select the next occurrence with ⌘+D, then edit them all at once
- Description: Place the cursor on a word and press `⌘+D` to add the next match to the selection. Repeat to grab more — typing replaces all of them simultaneously. Ideal for renaming a Jinja variable across a prompt or fixing a repeated typo.
- Reference: CodeMirror `@codemirror/commands` defaultKeymap — `Mod-d` → `selectNextOccurrence` (confirmed: `node_modules/@codemirror/commands/dist/index.cjs`); basicSetup loads defaultKeymap in `frontend/src/components/CodeMirrorEditor.tsx:815`
- Tags: feature | power-user

### Select all matching occurrences with ⌘+⇧+L
- Description: After making a selection, press `⌘+⇧+L` to select every other occurrence in the document at once. Faster than tapping `⌘+D` repeatedly when you know you want all of them.
- Reference: `@codemirror/search` searchKeymap — `Mod-Shift-l` → `selectSelectionMatches`
- Tags: feature | power-user

### Open find with ⌘+F, find next with ⌘+G
- Description: `⌘+F` opens the search panel at the top of the editor. `⌘+G` jumps to the next match, `⌘+⇧+G` to the previous. The panel also exposes regex and case-sensitive toggles, plus replace.
- Reference: `frontend/src/components/CodeMirrorEditor.tsx:558` (`search({ top: true })`); `@codemirror/search` searchKeymap
- Tags: feature | new-user

### Add cursors above or below with ⌘+⌥+↑ / ⌘+⌥+↓
- Description: Hold `⌘+⌥` and press the up or down arrow to drop a second (or third) cursor on the line above or below. Type once and the same edit lands on every cursor.
- Reference: `@codemirror/commands` defaultKeymap — `Mod-Alt-ArrowUp` / `Mod-Alt-ArrowDown` (`addCursorAbove`/`addCursorBelow`)
- Tags: feature | power-user

### Hold ⌥ and drag to make a rectangular (column) selection
- Description: Alt-click and drag to select a vertical column of text — useful for editing the start of many lines at once or stripping aligned prefixes. The crosshair cursor appears as a hint while ⌥ is held.
- Reference: basicSetup includes `rectangularSelection()` and `crosshairCursor()` (`@uiw/codemirror-extensions-basic-setup` defaults)
- Tags: feature | power-user

### Jump to a specific line with ⌘+⌥+G
- Description: Press `⌘+⌥+G` to open a small "go to line" prompt. Pair with line numbers (`⌥+L`) on long notes to navigate quickly.
- Reference: `@codemirror/search` searchKeymap — `Mod-Alt-g` → `gotoLine`
- Tags: feature | power-user

### Smart toggle: pressing ⌘+B on already-bold text removes the markers
- Description: Bold (`⌘+B`), italic (`⌘+I`), strikethrough (`⌘+⇧+X`), highlight (`⌘+⇧+H`), and inline code (`⌘+E`) are real toggles — re-applying them strips the surrounding markers, even if the markers are just outside your selection.
- Reference: `frontend/src/utils/editorFormatting.ts:39` (`toggleWrapMarkers`)
- Tags: feature | new-user

### Smart toggle for block prefixes: swap heading levels and toggle off lists
- Description: Pressing `⌘+⇧+7` (bullet) on an existing numbered list line swaps it to a bullet — pressing again removes the prefix entirely. Same for headings, blockquotes, and checklists. Works across multi-line selections.
- Reference: `frontend/src/utils/editorFormatting.ts:189` (`toggleLinePrefix`)
- Tags: feature | power-user

### Cmd-click a markdown link to open it from the raw editor
- Description: In the raw markdown editor, hold `⌘` and click a `[text](url)` link to open the URL — without switching to reading mode. The editor explicitly suppresses the default Cmd+click-to-add-cursor so the link opens cleanly.
- Reference: `frontend/src/utils/markdownStyleExtension.ts` (`handleEditorMousedown` cmd+link handling)
- Tags: feature | new-user

### Open Version History with ⌘+⇧+\
- Description: Every save creates a tracked version. `⌘+⇧+\` opens the version-history sidebar so you can review older revisions and restore one. Available from the Cmd+/ palette as well.
- Reference: `frontend/src/components/editor/editorCommands.ts:115`
- Tags: feature | new-user

### Discard unsaved edits without losing undo history
- Description: From the Cmd+/ palette, "Discard changes" rolls the editor back to the originally-loaded content via a CM dispatch — so you can still `⌘+Z` your way back if you change your mind. The command greys out when there are no unsaved changes.
- Reference: `frontend/src/components/CodeMirrorEditor.tsx:381`
- Tags: feature | power-user

### Selecting any word highlights its other matches in the document
- Description: CodeMirror automatically underlines/highlights other occurrences of whatever you currently have selected. Useful for spotting repeated terms or scanning for places a variable is used before reaching for find.
- Reference: basicSetup includes `highlightSelectionMatches()` (default `true`)
- Tags: feature | power-user

### Brackets, quotes, and code fences auto-close as you type
- Description: Typing `(`, `[`, `{`, `` ` ``, `"`, or `'` inserts the matching closer and places the cursor between them. Backspace on an empty pair removes both. With a selection active, typing one of these wraps the selection.
- Reference: basicSetup includes `closeBrackets()` (default `true`)
- Tags: feature | new-user

### Workflow: slash-insert a code block, then ⌘+D to rename a symbol
- Description: Type `/code` Enter to drop a fenced block, paste your snippet, then put the cursor on a variable name and press `⌘+D` repeatedly to grab every occurrence inside the block. Type once and they all rename together — markdown editing with IDE-grade refactoring.
- Reference: `frontend/src/utils/slashCommands.ts:113`; CM `selectNextOccurrence`
- Tags: workflow | power-user

### Workflow: turn a chunk of lines into a checklist in one keystroke
- Description: Select a block of lines, press `⌘+⇧+9` — every line gets a `- [ ]` prefix. Press it again on those same lines to remove the prefix. Pair with Cmd-click to tick items off later.
- Reference: `frontend/src/components/CodeMirrorEditor.tsx:164`; `frontend/src/utils/editorFormatting.ts:189`
- Tags: workflow | new-user

### Workflow: jump around a long note with the Table of Contents
- Description: Press `⌥+T` to open the ToC sidebar — it lists every heading in the note. Click any heading to scroll the editor to that line and place the cursor there. Combine with `⌘+⌥+G` for non-heading jumps.
- Reference: `frontend/src/components/CodeMirrorEditor.tsx:336`, `frontend/src/components/TableOfContentsSidebar.tsx`
- Tags: workflow | power-user

### Workflow (prompts): slash-insert a Jinja `{{ }}` then ⌘+D to rename across the template
- Description: In a prompt editor, type `/var` Enter to drop a `{{  }}` placeholder. Name it once, then use `⌘+D` to rename every other reference — Tiddly auto-detects the named variables on save.
- Reference: `frontend/src/utils/slashCommands.ts:77`, `frontend/src/components/editor/jinjaTemplates.ts`
- Tags: workflow | power-user

### Slash menu still works mid-line after a space
- Description: The slash menu fires whenever `/` follows whitespace — not just at the start of a line. Useful when you want to drop a horizontal rule, link, or code block after some leading text.
- Reference: `frontend/src/utils/slashCommands.ts:192` (regex `(^|\s)\/(\w*)$`)
- Tags: feature | power-user

### Slash menu is suppressed inside fenced code blocks
- Description: Typing `/` inside a ``` fenced code block won't open the menu — so you can write paths and division operators in code without interruption.
- Reference: `frontend/src/utils/slashCommands.ts:162` (`isInsideCodeBlock`)
- Tags: feature | power-user

### Tab-indents and Shift-Tab dedents inside lists
- Description: With the cursor in a list item, press Tab to indent (nest) the item and Shift+Tab to outdent. Indent unit is 4 spaces. Works on multi-line selections too.
- Reference: `frontend/src/components/CodeMirrorEditor.tsx:544` (`indentUnit.of('    ')`); CM `indentMore`/`indentLess` in defaultKeymap
- Tags: feature | new-user

### Insert link with selection becomes the link text
- Description: Highlight some text, press `⌘+K`, and Tiddly wraps it as `[selected](url)` with the URL pre-selected so you can paste the destination immediately.
- Reference: `frontend/src/utils/editorFormatting.ts:103` (`insertLink`)
- Tags: feature | new-user

### Save and close in one shortcut: ⌘+⇧+S
- Description: `⌘+S` saves and stays in the editor; `⌘+⇧+S` saves and closes the editor view in one keystroke. Both also live in the Cmd+/ palette.
- Reference: `frontend/src/components/editor/editorCommands.ts:90`
- Tags: feature | power-user

## Speculative

### Toggle line comments with ⌘+/ inside fenced code blocks
- Description: Inside a fenced code block whose language CodeMirror recognizes, `⌘+/` would normally toggle line comments via the default keymap.
- Reference: `@codemirror/commands` defaultKeymap — `Mod-/` → `toggleComment`
- Tags: feature | power-user
- Hesitation: Tiddly's keymap intercepts `⌘+/` at `Prec.highest` to open the editor command palette, so the CM default `toggleComment` binding never fires. Mentioning this would mislead users.

### Fold/unfold sections with ⌘+⌥+[ / ⌘+⌥+]
- Description: CodeMirror's defaultKeymap binds `Mod-Alt-[` to fold and `Mod-Alt-]` to unfold the current syntax node, with `Ctrl-Alt-Shift-[` / `]` to fold/unfold all.
- Reference: `@codemirror/language` foldKeymap
- Tags: feature | power-user
- Hesitation: Tiddly disables the fold gutter (`foldGutter: false` in `CodeMirrorEditor.tsx:817`) and basicSetup's `foldKeymap` flag isn't explicitly set, so this depends on whether the basic-setup default still wires the keymap when the gutter is off — couldn't confirm without runtime testing.

### Convert tabs to spaces / re-indent selection with ⌘+⌥+\
- Description: `⌘+⌥+\` runs CodeMirror's `indentSelection` to re-indent the current selection.
- Reference: `@codemirror/commands` defaultKeymap — `Mod-Alt-\\` → `indentSelection`
- Tags: feature | power-user
- Hesitation: Markdown isn't an indentation-sensitive language for CM's parser, so the practical effect on prose-heavy notes is unclear; works best inside fenced code blocks of recognized languages.

### Match bracket pair with ⌘+⇧+\
- Description: With the cursor next to a bracket, `⌘+⇧+\` jumps the cursor to the matching bracket.
- Reference: `@codemirror/commands` defaultKeymap — `Shift-Mod-\\` → `cursorMatchingBracket`
- Tags: feature | power-user
- Hesitation: Tiddly's own keymap binds `⌘+⇧+\` to "Toggle history sidebar" globally (see `editorCommands.ts:120` and the global shortcut handler) — likely shadows the CM default.

### Redo with ⌘+⇧+Z, alternative ⌘+Y
- Description: Standard undo/redo: `⌘+Z` undoes, `⌘+⇧+Z` redoes. `⌘+Y` is a Windows/Linux alternate.
- Reference: `@codemirror/commands` historyKeymap
- Tags: feature | new-user
- Hesitation: Almost universally known; including it would feel like padding unless framed as "undo persists across a discard via the Cmd+/ palette" (which is its own tip above).
