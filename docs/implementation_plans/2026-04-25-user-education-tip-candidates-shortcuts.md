# Tip candidates — shortcuts (reviewed)

Status: reviewed against the brief criteria. `drop` = exclude. `dup` = already covered by an existing seed tip or another category. Priority is a best-guess rank (lower = higher rank); will be re-calibrated at consolidation. `#` numbers match the original agent file's order; `S#` = item from the agent's Speculative section.

This is the cross-cutting category — most shortcuts have already canonicalized in their content-type or feature category. The genuinely-shortcuts-canonical items are global keystrokes that don't naturally belong to any single content category.

## Decisions

| # | Tip | Priority | Notes |
|---|---|---|---|
| 1 | `⌘+Shift+P` command palette | 15 | **Canonical home shortcuts**. Cross-tracked from `bookmarks:12`, `search:2`. Foundational keystroke; primary discovery for new users. |
| 2 | `/` to focus global search | 20 | **Canonical home shortcuts**. Cross-tracked from `bookmarks:S2`, `search:1`. |
| 3 | `s` focuses page search | drop | Page-vs-global distinction too subtle for new users; the page-search affordance is visible on the page itself anyway. |
| 4 | Paste a URL anywhere to start a bookmark | dup | Seed `bookmark-paste-url` (priority 30). |
| 5 | Open card in a new tab with `⌘+click` | 25 | **Canonical home shortcuts**. Real proactive choice — universal browser convention extended to cards. |
| 6 | `Shift+click` linked bookmark for detail page | dup | `bookmarks:4` (priority 35). |
| 7 | `Shift+⌘+click` bookmark URL silent open | dup | `bookmarks:3` (priority 25). |
| 8 | `⌘+S` save / `⌘+Shift+S` save-and-close | dup | `editor:27` (priority 30). |
| 9 | `w` toggles full-width layout | 30 | **Canonical home shortcuts**. Cross-tracked from `bookmarks:S3`. |
| 10 | `⌘+\` collapse sidebar / `⌘+Shift+\` history | split | **Split**: keep `⌘+\` sidebar collapse here at priority 25 (canonical home shortcuts); the `⌘+Shift+\` history half is dup of `editor:15` / `notes:9` and drops here. |
| 11 | `⌘+Shift+M` toggle reading mode | dup | `editor:3` (priority 20). |
| 12 | Editor display toggles `⌥+Z/L/M/T` | dup | `editor:4` (priority 30). |
| 13 | `⌘+/` editor command menu | dup | `editor:1` (priority 10). |
| 14 | `⌘+Shift+/` opens shortcuts dialog | 20 | **Canonical home shortcuts**. Strong "I forgot a shortcut" recovery tip. |
| 15 | `⌘+D` multi-cursor | dup | Seed `shortcut-select-next-occurrence`. |
| 16 | Workflow: palette → fuzzy → Enter | drop | Restates how palettes work. |
| 17 | Workflow: `/` → query → ↓ → Enter | drop | Restates palette UX. |
| 18 | `Esc` closes modals / unfocuses search | drop | Universal convention; "unfocus search to re-enable single-key shortcuts" is troubleshooting. |
| 19 | `⌘+click` markdown link in editor | dup | `editor:14` (priority 25). |
| 20 | Markdown formatting shortcuts list | drop | Bundle of universal-editor conventions. Swap-list-types and heading-swap are already covered by `editor:13` (reframed). |
| S1 | Slash menu inside the editor | dup | Seed `note-slash-commands`. |
| S2 | Single-key shortcuts pause while typing | drop | Troubleshooting, not discovery. |
| S3 | Modifier-aware list cards (tag chip vs body) | drop | Implementation quirk. |

## Final keepers (preserved details from the agent file)

### #1 — Open the command palette from anywhere with `⌘+Shift+P` — priority 15

Press `⌘+Shift+P` (or `Ctrl+Shift+P`) to open the command palette — works even while typing in an input. Jump to any sidebar filter, settings page, or `New Note`/`New Bookmark`/`New Prompt` action without leaving the keyboard.

- Reference: `frontend/src/hooks/useKeyboardShortcuts.ts:82`
- Tags: feature | new-user

### #2 — Press `/` to jump to global search — priority 20

From anywhere outside an input, press `/` to focus the global search bar. Same key opens the command palette directly into its search sub-view when triggered from inside the palette.

- Reference: `frontend/src/hooks/useKeyboardShortcuts.ts:115`
- Tags: feature | new-user

### #14 — `⌘+Shift+/` opens the shortcuts dialog — priority 20

Forget a shortcut? Press `⌘+Shift+/` from anywhere — even mid-typing — to pop up the full shortcuts cheat sheet.

- Reference: `frontend/src/hooks/useKeyboardShortcuts.ts:75`
- Tags: feature | new-user

### #5 — Open a card in a new tab with `⌘+click` — priority 25

Hold `⌘` (or `Ctrl` on Windows/Linux) and click any bookmark, note, or prompt card to open its detail page in a new tab — keep your current list view in place.

- Reference: `frontend/src/components/ContentCard/ContentCard.tsx:51`
- Tags: feature | power-user

### #10 (split) — `⌘+\` collapses the sidebar — priority 25

Press `⌘+\` (or `Ctrl+\`) to collapse or expand the main sidebar for more reading room. Works even while typing.

- Reference: `frontend/src/hooks/useKeyboardShortcuts.ts:90`
- Tags: feature | power-user

(The history-sidebar half of the original tip — `⌘+Shift+\` — drops as dup of `editor:15` / `notes:9`.)

### #9 — `w` toggles full-width layout — priority 30

Press `w` (no modifiers, outside inputs) to flip between centered and full-width content layout — useful for wider notes, code-heavy prompts, or scanning long bookmark lists.

- Reference: `frontend/src/hooks/useKeyboardShortcuts.ts:129`
- Tags: feature | power-user

## Cross-category tracking

- `shortcuts:1`, `shortcuts:2`, `shortcuts:5`, `shortcuts:9`, `shortcuts:10`, `shortcuts:14` ⟵ canonical home for the global keystrokes; cross-tracked from `bookmarks` and `search` previously.
- `shortcuts:4` → seed `bookmark-paste-url`.
- `shortcuts:6`, `shortcuts:7` → `bookmarks` canonical (#4 and #3).
- `shortcuts:8`, `shortcuts:11`, `shortcuts:12`, `shortcuts:13`, `shortcuts:19`, `shortcuts:S1` → `editor` and seed canonical.
- `shortcuts:10` (history half) → `editor:15` / `notes:9` canonical.
- `shortcuts:15` → seed `shortcut-select-next-occurrence`.
