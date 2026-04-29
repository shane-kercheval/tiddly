# Tip candidates — editor (reviewed)

Status: reviewed against the brief criteria. `drop` = exclude. `dup` = already covered by an existing seed tip; `dup+` = dup with refinement that should be merged into the seed wording at consolidation. Priority is a best-guess rank (lower = higher rank); will be re-calibrated at consolidation. `#` numbers match the original agent file's order; `S#` = item from the agent's Speculative section.

## Decisions

| # | Tip | Priority | Notes |
|---|---|---|---|
| 1 | `⌘+/` editor command palette | 10 | Top-tier. Tiddly-specific palette — save, discard, reading-mode toggle, version history, ToC, every formatting command in one menu. Fully hidden. |
| 2 | Type `/` at start of line for block-insert menu | dup+ | **dup** of seed `note-slash-commands`. **Merge** the agent's refinements at consolidation: the seed tip should mention (a) the menu fires after whitespace (start of line OR mid-line — see #23) and (b) the prompt-editor menu also offers Jinja Variable / If block / If block (trim). |
| 3 | `⌘+⇧+M` toggle reading mode | 20 | Real proactive shortcut; scroll position preserved is a nice detail. |
| 4 | `⌥+Z/L/M/T` view toggles (wrap, lines, mono, ToC) | 30 | Bundle of view toggles. ToC is also called out separately as a workflow (#21); leave both. |
| 5 | Click a `[ ]` checkbox in the raw editor to toggle | 15 | Hidden killer feature. Most users assume they need reading mode. |
| 6 | `⌘+D` select next occurrence | dup+ | **dup** of seed `shortcut-select-next-occurrence`. **Merge** at consolidation: the seed tip should also mention `⌘+⇧+L` to select every occurrence at once (see #7). |
| 7 | `⌘+⇧+L` select all matching | merged | Merged into #6 / seed wording. |
| 8 | `⌘+F` find / `⌘+G` next | 20 | Real proactive. Includes regex + replace in the panel. |
| 9 | `⌘+⌥+↑/↓` add cursors above/below | 25 | Power-user CodeMirror feature. |
| 10 | Alt+drag rectangular (column) selection | drop | Rare in markdown editing; power-user audience too narrow. |
| 11 | `⌘+⌥+G` jump to line | 35 | Power-user; only useful with line numbers on. Kept low-priority. |
| 12 | Smart toggle: re-applying `⌘+B` strips markers | drop | The user's action is identical to what they'd take in any editor; the cleverness is invisible. |
| 13 | Swap list types or heading levels with the formatting shortcut (reframed) | 25 | **Reframed.** Original agent description was about "smart toggle" cleverness; rewrite focuses on the proactive action: convert a numbered list to bullets via `⌘+⇧+7`, swap an H2 to H1 via `⌘+⇧+1`. |
| 14 | Cmd-click link in raw editor opens URL | 25 | Hidden behavior; non-obvious. |
| 15 | `⌘+⇧+\` Version History | 30 | Re-promoted after the bookmarks drop — version history matters more for notes/prompts where users actually edit. **Cross-category** ↔ notes, prompts (any content with active editing). |
| 16 | Discard unsaved edits without losing undo | drop | Defensive UX detail; user doesn't proactively use this. |
| 17 | Selecting a word highlights other matches | drop | Auto-behavior. |
| 18 | Brackets/quotes auto-close | drop | Universal editor convention. |
| 19 | Workflow: `/code` then `⌘+D` to rename a symbol | drop | Use case (refactoring code inside a note) not motivated; users storing code aren't usually refactoring it. |
| 20 | Workflow: select lines + `⌘+⇧+9` to checklist | 25 | Proactive transformation. |
| 21 | Workflow: `⌥+T` ToC for jumping around long notes | 25 | ToC is broadly useful; the workflow framing (lists every heading, click to scroll, place cursor) is distinct enough from #4 to keep separate. |
| 22 | Workflow (prompts): `/var` then `⌘+D` to rename a Jinja variable | 20 | Strong prompt-authoring workflow with clear motivation. **Cross-category** ↔ `prompts`. |
| 23 | Slash menu fires mid-line after a space | merged | Merged into #2 seed wording. |
| 24 | Slash menu suppressed inside fenced code blocks | drop | Auto-behavior. |
| 25 | Tab/Shift-Tab indent in lists | drop | Universal editor convention. |
| 26 | `⌘+K` with selection becomes link text | 25 | Subtle nuance — wraps existing selection rather than inserting blank. |
| 27 | `⌘+⇧+S` save and close | 30 | Editor-specific shortcut for notes/prompts (where editing is the primary activity); kept here even though dropped from `bookmarks`. |
| S1 | `⌘+/` toggle line comments | drop | Tiddly's `⌘+/` palette shadows it. |
| S2 | Fold/unfold `⌘+⌥+[/]` | drop | Couldn't confirm enabled. |
| S3 | Re-indent selection `⌘+⌥+\` | drop | Markdown isn't indent-sensitive. |
| S4 | Match bracket `⌘+⇧+\` | drop | Shadowed by global history-sidebar toggle. |
| S5 | Redo `⌘+⇧+Z` | drop | Universally known; padding. |

## Final keepers (preserved details from the agent file)

### #1 — Open the editor command palette with `⌘+/` — priority 10

Press `⌘+/` anywhere in a note or prompt to open a filterable command palette. It collects every formatting, insertion, and editor action (save, discard, toggle reading mode, version history, ToC) in one menu — type a few letters to fuzzy-filter, then Enter.

- Reference: `frontend/src/components/CodeMirrorEditor.tsx:346`, `frontend/src/components/editor/editorCommands.ts`
- Tags: feature | new-user

### #5 — Click a `[ ]` checkbox in the raw editor to toggle the task — priority 15

In the raw markdown editor, you don't have to switch to reading mode to tick off a `- [ ]`. Click directly on the `[ ]` or `[x]` glyph to flip it.

- Reference: `frontend/src/utils/markdownStyleExtension.ts`
- Tags: feature | new-user

### #3 — Toggle reading mode with `⌘+⇧+M` — priority 20

Switch a note or prompt between raw markdown editing and a rendered Milkdown preview without leaving the page. Scroll position is preserved when toggling back.

- Reference: `frontend/src/components/CodeMirrorEditor.tsx:267,303`
- Tags: feature | new-user

### #8 — Open find with `⌘+F`, find next with `⌘+G` — priority 20

`⌘+F` opens the search panel at the top of the editor. `⌘+G` jumps to the next match, `⌘+⇧+G` to the previous. The panel exposes regex and case-sensitive toggles, plus replace.

- Reference: `frontend/src/components/CodeMirrorEditor.tsx:558`
- Tags: feature | new-user

### #22 — Workflow (prompts): slash-insert a Jinja variable then `⌘+D` to rename across the template — priority 20 — cross-category: prompts

In a prompt editor, type `/var` Enter to drop a `{{ }}` placeholder. Name it once, then use `⌘+D` to rename every other reference — Tiddly auto-detects the named variables on save.

- Reference: `frontend/src/utils/slashCommands.ts:77`, `frontend/src/components/editor/jinjaTemplates.ts`
- Tags: workflow | power-user

### #13 (reframed) — Swap list types or heading levels with the formatting shortcut — priority 25

To convert a numbered list to a bullet list, select the lines and press `⌘+⇧+7`. To swap heading levels (e.g., H2 → H1), put the cursor on the heading line and press `⌘+⇧+1`. The shortcut overwrites the existing prefix instead of nesting or duplicating it.

- Reference: `frontend/src/utils/editorFormatting.ts:189` (`toggleLinePrefix`)
- Tags: feature | power-user

### #14 — Cmd-click a markdown link to open it from the raw editor — priority 25

In the raw markdown editor, hold `⌘` and click a `[text](url)` link to open the URL — without switching to reading mode. The editor explicitly suppresses the default Cmd+click-to-add-cursor so the link opens cleanly.

- Reference: `frontend/src/utils/markdownStyleExtension.ts`
- Tags: feature | new-user

### #20 — Workflow: turn a chunk of lines into a checklist in one keystroke — priority 25

Select a block of lines, press `⌘+⇧+9` — every line gets a `- [ ]` prefix. Press it again on those same lines to remove the prefix. Pair with Cmd-click to tick items off later.

- Reference: `frontend/src/components/CodeMirrorEditor.tsx:164`
- Tags: workflow | new-user

### #21 — Workflow: jump around a long note with the Table of Contents — priority 25

Press `⌥+T` to open the ToC sidebar — it lists every heading in the note. Click any heading to scroll the editor to that line and place the cursor there. Combine with `⌘+⌥+G` for non-heading jumps.

- Reference: `frontend/src/components/CodeMirrorEditor.tsx:336`, `frontend/src/components/TableOfContentsSidebar.tsx`
- Tags: workflow | power-user

### #26 — `⌘+K` with selection wraps it as link text — priority 25

Highlight some text, press `⌘+K`, and Tiddly wraps it as `[selected](url)` with the URL pre-selected so you can paste the destination immediately.

- Reference: `frontend/src/utils/editorFormatting.ts:103`
- Tags: feature | new-user

### #9 — Add cursors above or below with `⌘+⌥+↑` / `⌘+⌥+↓` — priority 25

Hold `⌘+⌥` and press the up or down arrow to drop a second (or third) cursor on the line above or below. Type once and the same edit lands on every cursor.

- Reference: `@codemirror/commands` defaultKeymap (`addCursorAbove`/`addCursorBelow`)
- Tags: feature | power-user

### #4 — Toggle word wrap, line numbers, monospace, and ToC from the keyboard — priority 30

`⌥+Z` toggles word wrap, `⌥+L` toggles line numbers, `⌥+M` toggles a monospace font, and `⌥+T` opens the Table of Contents sidebar — all from inside the editor, no toolbar reach.

- Reference: `frontend/src/components/CodeMirrorEditor.tsx:312-340`
- Tags: feature | power-user

### #15 — Open Version History with `⌘+⇧+\` — priority 30 — cross-category: notes, prompts

Every save creates a tracked version. `⌘+⇧+\` opens the version-history sidebar so you can review older revisions and restore one. Available from the `⌘+/` palette as well.

- Reference: `frontend/src/components/editor/editorCommands.ts:115`
- Tags: feature | new-user

### #27 — Save and close in one shortcut: `⌘+⇧+S` — priority 30

`⌘+S` saves and stays in the editor; `⌘+⇧+S` saves and closes the editor view in one keystroke. Both also live in the `⌘+/` palette.

- Reference: `frontend/src/components/editor/editorCommands.ts:90`
- Tags: feature | power-user

### #11 — Jump to a specific line with `⌘+⌥+G` — priority 35

Press `⌘+⌥+G` to open a small "go to line" prompt. Pair with line numbers (`⌥+L`) on long notes to navigate quickly.

- Reference: `@codemirror/search` searchKeymap (`gotoLine`)
- Tags: feature | power-user

## Dup refinements to merge into seed wording at consolidation

### #2 + #23 → seed `note-slash-commands`

The existing seed tip says: "Type `/` at the start of an empty line to open a menu of block-level formatting…"

**Merge in:**
- The menu fires after **any whitespace** (start of line OR mid-line after a space).
- In the **prompt** editor specifically, the menu also offers `Jinja Variable`, `If block`, and `If block (trim)`.

Suggested updated wording at consolidation:

> Type `/` after whitespace (start of line or mid-line) to open a menu of block-level formatting: headings, lists, code blocks, callouts, and more. The prompt editor's menu adds Jinja2 building blocks (variable, if block, if block with trim).

### #6 + #7 → seed `shortcut-select-next-occurrence`

The existing seed tip says: "With your cursor on a word in a note or prompt, press `⌘+D` to extend the selection to the next match. Repeat to add more matches and edit them simultaneously."

**Merge in:**
- After making a selection, press `⌘+⇧+L` to grab every other occurrence at once instead of `⌘+D`-ing through them.

Suggested updated wording at consolidation:

> With your cursor on a word in a note or prompt, press `⌘+D` to extend the selection to the next match — repeat to add more, then type once and they all rename together. Use `⌘+⇧+L` instead to grab every match in one shot.

## Cross-category tracking

- `editor:15` ↔ `notes`, `prompts` — Version History via ⌘+⇧+\
- `editor:22` ↔ `prompts` — Jinja-variable rename workflow
