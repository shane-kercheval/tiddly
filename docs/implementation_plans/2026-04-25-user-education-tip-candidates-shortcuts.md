# Tip candidates — shortcuts

## Strong candidates (strongest first)

### Open the command palette from anywhere
- Description: Press `⌘+Shift+P` to open the command palette — works even while typing in an input. Jump to any sidebar filter, settings page, or `New Note`/`New Bookmark`/`New Prompt` action without leaving the keyboard.
- Reference: frontend/src/hooks/useKeyboardShortcuts.ts:82, frontend/src/components/CommandPalette.tsx:308
- Tags: feature | new-user

### Press `/` to jump to global search
- Description: From anywhere outside an input, press `/` to focus the global search bar. The same key opens the command palette directly into its search sub-view when triggered from inside the palette.
- Reference: frontend/src/hooks/useKeyboardShortcuts.ts:115, frontend/src/components/CommandPalette.tsx:317
- Tags: feature | new-user

### `s` focuses the page search
- Description: On list pages, press `s` (lowercase, no modifiers) to focus the in-page search bar — distinct from `/`, which focuses the global search. Disabled by default unless the page registers it.
- Reference: frontend/src/hooks/useKeyboardShortcuts.ts:122
- Tags: feature | power-user

### Paste a URL anywhere to start a bookmark
- Description: Copy a URL, then press `⌘+V` from any content list view (outside an input). Tiddly opens the new-bookmark form pre-filled with the URL — title and description are auto-fetched.
- Reference: frontend/src/hooks/useKeyboardShortcuts.ts:138
- Tags: feature | new-user

### Open a card in a new tab with `⌘+click`
- Description: Hold `⌘` (or `Ctrl` on Windows/Linux) and click any bookmark, note, or prompt card to open its detail page in a new tab — keep your current list view in place.
- Reference: frontend/src/components/ContentCard/ContentCard.tsx:51
- Tags: feature | power-user

### `Shift+click` a linked bookmark to open it inside Tiddly
- Description: Bookmark relationship chips normally open the URL in a new tab. Hold `Shift` and click to navigate to the bookmark's Tiddly detail page instead — useful when you want to edit metadata, tags, or relationships without leaving the app. Usage isn't tracked on this path.
- Reference: frontend/src/hooks/useLinkedNavigation.ts:23
- Tags: feature | power-user

### `Shift+⌘+click` a bookmark URL to open without tracking
- Description: Hold `Shift+⌘` (or `Shift+Ctrl`) when clicking a bookmark's URL link to skip usage tracking — the visit doesn't count toward `last_used_at` or usage metrics. Handy for spot-checking links.
- Reference: frontend/src/components/BookmarkCard.tsx:98
- Tags: feature | power-user

### Save with `⌘+S`, save-and-close with `⌘+Shift+S`
- Description: While editing a note, bookmark, or prompt, press `⌘+S` to save in place. Press `⌘+Shift+S` to save and exit back to the list. Works in all three editors.
- Reference: frontend/src/components/Note.tsx:437, frontend/src/components/Bookmark.tsx:496, frontend/src/components/Prompt.tsx:516
- Tags: feature | new-user

### `w` toggles full-width layout
- Description: Press `w` (no modifiers, outside inputs) to flip between centered and full-width content layout — useful for wider notes, code-heavy prompts, or scanning long bookmark lists.
- Reference: frontend/src/hooks/useKeyboardShortcuts.ts:129
- Tags: feature | power-user

### `⌘+\` collapses the sidebar; `⌘+Shift+\` toggles history
- Description: Press `⌘+\` to collapse or expand the main sidebar for more reading room. `⌘+Shift+\` toggles the history sidebar on detail pages. Both work even while typing.
- Reference: frontend/src/hooks/useKeyboardShortcuts.ts:90
- Tags: feature | power-user

### `⌘+Shift+M` toggles reading mode in any editor
- Description: While viewing a note, bookmark, or prompt, press `⌘+Shift+M` to flip into reading mode (clean rendered markdown, no editor chrome). Press again to return to edit mode.
- Reference: frontend/src/components/CodeMirrorEditor.tsx:303
- Tags: feature | power-user

### Editor display toggles: `⌥+Z`, `⌥+L`, `⌥+M`, `⌥+T`
- Description: With the source editor focused, `⌥+Z` toggles word wrap, `⌥+L` toggles line numbers, `⌥+M` toggles monospace font, and `⌥+T` toggles the table-of-contents sidebar. All disabled while in reading mode.
- Reference: frontend/src/components/CodeMirrorEditor.tsx:312
- Tags: feature | power-user

### `⌘+/` opens the editor's command menu
- Description: Inside a note or prompt editor, press `⌘+/` to open the inline command menu — works whether or not the editor has focus, so you can trigger it right after opening an item.
- Reference: frontend/src/components/CodeMirrorEditor.tsx:346
- Tags: feature | power-user

### `⌘+Shift+/` opens the shortcuts dialog
- Description: Forget a shortcut? Press `⌘+Shift+/` from anywhere — even mid-typing — to pop up the full shortcuts cheat sheet.
- Reference: frontend/src/hooks/useKeyboardShortcuts.ts:75
- Tags: feature | new-user

### Multi-cursor edit with `⌘+D`
- Description: Place your cursor on a word in a note or prompt and press `⌘+D` to add the next occurrence to your selection. Repeat to keep adding. Edit them all simultaneously — great for renaming a Jinja2 variable or fixing a repeated phrase.
- Reference: frontend/src/data/tips/tips.ts:70 (existing), frontend/src/components/CodeMirrorEditor.tsx
- Tags: feature | power-user

### Workflow: palette → fuzzy match → Enter to open
- Description: Press `⌘+Shift+P`, type a few characters of a filter, settings page, or `new note`, then press `Enter` — the first match runs without ever touching the mouse. Arrow keys move the selection; the input keeps focus the whole time.
- Reference: frontend/src/components/CommandPalette.tsx:404, frontend/src/hooks/useListKeyboardNavigation.ts
- Tags: workflow | power-user

### Workflow: `/` → type query → Arrow Down → Enter to open a result
- Description: Press `/` to drop into the palette's search view, type a query, then `↓` to move the selection into the result list. `Enter` opens notes/prompts in Tiddly or bookmark URLs in a new tab. `↑` from the top item refocuses the search input.
- Reference: frontend/src/components/CommandPalette.tsx:537, frontend/src/hooks/useListKeyboardNavigation.ts:140
- Tags: workflow | power-user

### `Esc` closes any modal — and unfocuses search
- Description: `Esc` closes the command palette, the shortcuts dialog, the new-content forms, and the discard-confirmation prompt. Out in a list view, it also unfocuses the search bar so single-key shortcuts (`/`, `s`, `w`) start working again.
- Reference: frontend/src/hooks/useKeyboardShortcuts.ts:104, frontend/src/components/CommandPalette.tsx:285
- Tags: feature | new-user

### `⌘+click` a markdown link in the editor to follow it
- Description: Inside the rendered markdown editor (notes and prompts), `⌘+click` (or `Ctrl+click`) any link to open its destination in a new tab — without switching out of edit mode.
- Reference: frontend/src/components/MilkdownEditor.tsx:600
- Tags: feature | power-user

### Markdown formatting shortcuts power users miss
- Description: In the markdown editor: `⌘+B` bold, `⌘+I` italic, `⌘+K` insert link, `⌘+E` inline code, `⌘+Shift+E` code block, `⌘+Shift+7/8/9` bullet/numbered/checklist, `⌘+Shift+.` blockquote, `⌘+Shift+H` highlight, `⌘+Shift+X` strikethrough, `⌘+Shift+-` horizontal rule.
- Reference: frontend/src/components/MilkdownEditor.tsx:1290
- Tags: feature | power-user

## Speculative

### Slash menu inside the editor (not just the palette)
- Description: Type `/` at the start of an empty line inside a note or prompt editor to open a block-formatting menu (headings, lists, code blocks). Same character as the global focus-search shortcut, but scoped to editor lines.
- Reference: frontend/src/pages/docs/DocsShortcuts.tsx:117
- Tags: feature | new-user
- Hesitation: Already covered by the existing `note-slash-commands` tip in `tips.ts:18`; surface only if consolidator wants a shortcuts-flavored variant.

### Single-key shortcuts pause while you're typing
- Description: `/`, `s`, and `w` only fire when no input, textarea, or contentEditable element is focused. If a shortcut feels broken, click outside the input (or press `Esc`) first.
- Reference: frontend/src/hooks/useKeyboardShortcuts.ts:33
- Tags: feature | new-user
- Hesitation: This is more troubleshooting than discovery — useful but lower-signal than feature tips.

### Modifier-aware list cards: tag chips don't fire card click
- Description: Clicking a tag chip on a card filters the list; clicking the card body opens it. Holding `⌘` over the card opens it in a new tab. Holding `⌘` over the tag chip lets the card click bubble through (legacy behavior — varies by card type).
- Reference: frontend/src/components/PromptCard.tsx:66, frontend/src/components/NoteCard.tsx:62
- Tags: feature | power-user
- Hesitation: Behavior is subtle and partially incidental; risks documenting an implementation quirk rather than intended UX.
