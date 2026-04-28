# Tip candidates — notes

## Strong candidates (ordered by your judgment of strength, strongest first)

### Toggle reading mode in the note editor with ⌘⇧M
- Description: Press `⌘⇧M` (or click the reading icon in the toolbar) inside a note to flip between the markdown editor and a fully-rendered preview. Scroll position is preserved across the toggle, so you can read your note formatted, then jump straight back to where you were typing.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/components/CodeMirrorEditor.tsx:296
- Tags: feature | new-user

### Open the note Table of Contents with ⌥T
- Description: Press `⌥T` while editing a note (or click the ToC icon in the toolbar) to open a sidebar of all `#` / `##` / `###` headings. Click a heading to scroll the editor to that line — useful for jumping around long notes.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/components/TableOfContentsSidebar.tsx:21
- Tags: feature | power-user

### Save a note and close in one keystroke with ⌘⇧S
- Description: `⌘S` saves and stays. `⌘⇧S` saves and closes the note in one go — handy when you've finished editing and want to get back to the list without reaching for the mouse.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/components/Note.tsx:434
- Tags: feature | power-user

### Press Escape twice to discard unsaved changes
- Description: With unsaved changes in a note, the first `Escape` shows a red "Discard?" prompt on the close button. Press `Escape` again (or `Enter`) to confirm and abandon the edits — much faster than clicking Close and confirming a dialog.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/components/Note.tsx:461
- Tags: feature | power-user

### Quick-create a linked bookmark, note, or prompt from the link picker
- Description: Open the link picker on a note (the link icon in the metadata row) and choose "Create new bookmark/note/prompt" — Tiddly opens a fresh detail page with the link to the current note pre-populated, and `Close` brings you straight back when you're done.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/hooks/useQuickCreateLinked.ts:31
- Tags: workflow | power-user

### Open a quick-action menu in the note editor with ⌘/
- Description: Press `⌘/` anywhere in the note editor to open a searchable command menu — covers every formatting action plus Save & Close, Discard, Reading mode, Table of Contents, and Version History. Faster than memorising individual shortcuts.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/components/CodeMirrorEditor.tsx:343
- Tags: feature | power-user

### Auto-archive a note on a future date
- Description: Click the calendar/"Auto-archive: None" control in a note's metadata row to schedule it to archive itself on a chosen date — choose 1 week, 1 month, end of month, 3/6/12 months, or a custom date. Useful for reference notes that should disappear once a project ends.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/components/InlineEditableArchiveSchedule.tsx:73
- Tags: feature | new-user

### Set up auto-tagging and AI link suggestions for notes
- Description: With AI configured, opening the tag input or link picker on a note triggers suggestions based on the note's title, description, and content — accept or dismiss with one click. The model can also fill the title and description from the body.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/hooks/useAITagIntegration.ts:34
- Tags: feature | new-user

### Restore an older version from the History sidebar
- Description: Open History on any note to see every saved revision with diffs against the previous version. Click Restore on an older version and the current content is replaced — this creates a new version, so nothing is ever truly lost.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/components/HistorySidebar.tsx:74
- Tags: feature | new-user

### Toggle word wrap, line numbers, and monospace font with ⌥Z / ⌥L / ⌥M
- Description: While editing a note, `⌥Z` toggles word wrap, `⌥L` toggles line numbers, and `⌥M` switches the editor between Inter and a monospace font. Preferences persist across sessions in localStorage.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/components/CodeMirrorEditor.tsx:312
- Tags: feature | power-user

### Use ==highlight== syntax in markdown notes
- Description: Wrap text in double-equals (`==like this==`) for highlighted text. Tiddly supports it via `⌘⇧H` and renders it with a yellow background in reading mode — a markdown extension most other apps don't have.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/components/CodeMirrorEditor.tsx:70
- Tags: feature | power-user

### Code blocks support real syntax highlighting
- Description: Specify a language after the opening fence (e.g. ` ```python `) and the editor highlights the code inside. The CodeMirror markdown plugin loads from `@codemirror/language-data`, so most common languages work out of the box.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/components/CodeMirrorEditor.tsx:546
- Tags: feature | new-user

### Click checkboxes in reading mode to tick them off
- Description: Notes support GitHub-style task lists (`- [ ]` and `- [x]`). In reading mode, click directly on a checkbox to toggle it — the markdown updates and saves on next save. Great for running checklists from inside a note.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/components/MilkdownEditor.tsx:1359
- Tags: feature | new-user

### Concurrent edit protection via optimistic locking
- Description: If two devices edit the same note and you save second, Tiddly opens a Conflict dialog showing both versions. Pick "Load server version" to discard yours, "Save my version" to overwrite, or "Do nothing" to keep editing — no silent overwrites.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/components/Note.tsx:566
- Tags: feature | power-user

### New notes inherit the current tag filter
- Description: When you create a note while an "active" tag filter is selected (e.g. viewing notes tagged `journal`), the new note is pre-populated with those tags. Speeds up keeping a tag-based system consistent.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/pages/NoteDetail.tsx:79
- Tags: workflow | power-user

### Link a note to a bookmark or prompt to build a knowledge graph
- Description: Use the link icon in a note's metadata row to attach existing bookmarks, notes, or prompts as related items. Linked items render as clickable chips and let you navigate between them — useful for binding meeting notes to source articles, or templates to example prompts.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/components/LinkedContentChips.tsx:1
- Tags: workflow | power-user

## Speculative

### Stale check warns when a note changed in another tab
- Description: If you have the same note open on two tabs/devices and the other one saves first, the open editor pops a "this note has changed" dialog before you accidentally overwrite. Tap "Load latest version" to refresh the editor.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/components/Note.tsx:155
- Tags: feature | power-user
- Hesitation: Defensive UX rather than a behaviour users actively reach for — useful to know but unlikely to be acted on proactively.

### `⌘D` to multi-select in the note editor
- Description: Place your cursor on a word and press `⌘D` to extend the selection to the next match — repeat to add more matches and edit them simultaneously. Inherited from CodeMirror's default keymap.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/pages/docs/DocsShortcuts.tsx:110
- Tags: feature | power-user
- Hesitation: Already an example in the existing tips corpus (shortcut-select-next-occurrence). Listing here only if a notes-tagged variant is wanted.

### Sticky header with action buttons stays visible while scrolling
- Description: Title, save, archive, history, and delete buttons stick to the top of the note as you scroll the body — no need to scroll back up to save a long note.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/components/Note.tsx:691
- Tags: feature | new-user
- Hesitation: Borderline a basic UI affordance; users probably notice this without being told.

### Notes show "Created" and "Updated" timestamps inline
- Description: A note's metadata row shows `Created <date>` and, if different, `Updated <date>` next to the auto-archive control. Quick way to verify when something was last touched without opening history.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/components/Note.tsx:883
- Tags: feature | new-user
- Hesitation: Visible by default; not really a hidden behaviour worth surfacing.

### Title autofocuses on new notes
- Description: Hitting `New Note` puts your cursor in the title field automatically — start typing immediately, then `Tab` into description, then click into the editor body.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/components/Note.tsx:397
- Tags: feature | new-user
- Hesitation: Standard form behaviour; arguably not worth a tip.

### Notes are exposed via the Content MCP server for AI agents
- Description: The MCP server (`tiddly_notes_bookmarks`) lets agents create, edit (with `edit_content` old_str/new_str), and search notes — so a Claude/Cursor session can pull a meeting note, append decisions, and link it to a related bookmark, all without leaving the chat.
- Reference: /Users/shanekercheval/repos/bookmarks/backend/src/mcp_server/server.py
- Tags: workflow | power-user
- Hesitation: This is also a bookmark-category tip; may be deduplicated by the consolidator.

### Notes use FTS with English stemming
- Description: Searching for `databases` matches notes containing `database`; `running` matches `runners`. Quote a phrase to opt out of stemming, e.g. `"customer interviews"`.
- Reference: /Users/shanekercheval/repos/bookmarks/frontend/src/pages/docs/DocsSearch.tsx:14
- Tags: feature | new-user
- Hesitation: Already covered by the existing `search-quoted-phrase` tip and likely belongs to the search category.
