# Tip candidates — bookmarks (reviewed)

Status: reviewed against the brief criteria. `drop` = exclude. `dup` = already covered by an existing seed tip or another category. Priority is a best-guess rank (lower = higher rank); will be re-calibrated at consolidation. `#` numbers match the original agent file's order; `S#` = item from the agent's Speculative section.

## Decisions

| # | Tip | Priority | Notes |
|---|---|---|---|
| 1 | Paste a URL anywhere in your lists to start a new bookmark | dup | Already in seed corpus as `bookmark-paste-url`. Existing wording captures it; only enhancement worth borrowing is the agent's "any saved-filter, Archived, or Trash view" detail. |
| 2 | Schedule a bookmark to auto-archive on a future date | 15 | Hidden killer feature. Strong workflow + feature tip. |
| 3 | Open a bookmark URL silently with `Shift+⌘`-click | 25 | Power-user; user can choose this when peeking without skewing "recently used." |
| 4 | Shift-click a linked bookmark chip to open its detail page | 35 | Niche but proactive. |
| 5 | Re-fetch a bookmark's title/description/content from the URL | drop | Auto-aid for search; not something users proactively act on. |
| 6 | Save bookmarks pre-tagged from a saved filter | drop | Happens automatically — not a tip. |
| 7 | Restore an archived URL when saving the same link again | drop | Auto-happens. |
| 8 | Bookmarks save PDF text too | drop | "Save as usual" experience; not a trick. |
| 9 | Roll back a bookmark with History sidebar | drop | Better suited to notes/prompts where users actually edit; bookmarks rarely warrant version review. |
| 10 | Save and close in one keystroke | drop | Generic editor convention; surface in `shortcuts` if needed. |
| 11 | Quote a phrase to find a bookmark by body text | drop | **dup** — generalizes to seed `search-quoted-phrase`. |
| 12 | Open command palette to jump to a bookmark or filter | drop | **Cross-category** → tracked for `shortcuts`. |
| 13 | Save bookmarks with the Chrome extension | 25 | **Cross-category** with `extension`. Decide canonical home at consolidation. |
| 14 | Add a tag to a bookmark from the list | drop | Obvious from card action buttons. |
| 15 | Drop the protocol when typing a URL | drop | Too small to be a tip. |
| 16 | Page Content is editable — paste your own text to make a stub bookmark searchable | 15 | Hidden killer feature. Most users won't realize they can paste highlights/excerpts into a bookmark to make it findable. |
| 17 | Copy URL with one click from the card | drop | Obvious UI. |
| S1 | Cancel a scheduled archive from the card | 35 | Companion to #2 — paired. |
| S2 | Press `s` to focus the search bar | drop | **Cross-category** → tracked for `shortcuts`. |
| S3 | Press `w` for full-width layout | drop | **Cross-category** → tracked for `shortcuts`. |
| S4 | `Escape` to close, double-tap to discard | drop | **Cross-category** → tracked for `shortcuts` / generic editor. |
| S5 | Warns before unsaved navigation | drop | Auto-behavior. |
| S6 | Conflict detection between concurrent edits | drop | Auto-happens. |
| S7 | Link bookmarks to notes/prompts to build context bundles | 20 | Strong proactive workflow tip. **Cross-category** with relationships if added; otherwise primary home is `bookmarks`. |

## Final keepers (preserved details from the agent file)

### #2 — Schedule a bookmark to auto-archive on a future date — priority 15

On the bookmark detail page, click the "Auto-archive: None" pill near the URL to pick a preset (in 1 week, end of month, in 3/6/12 months) or a custom date. The bookmark stays in your active list until the date arrives, then disappears from active automatically.

- Reference: `frontend/src/components/InlineEditableArchiveSchedule.tsx:172`
- Tags: feature | power-user

### #3 — Open a bookmark URL silently with `Shift+⌘`-click — priority 25

Holding Shift plus `⌘` (or `Ctrl`) when you click a bookmark's title, favicon, or URL opens the link without bumping its `last_used_at` timestamp — useful when you want to peek at a page without skewing your "Recently used" sort order.

- Reference: `frontend/src/components/BookmarkCard.tsx:98`
- Tags: feature | power-user

### #4 — Shift-click a linked bookmark to jump to its detail page — priority 35

When a bookmark is linked from another note, prompt, or bookmark, clicking it opens the URL in a new tab. Hold Shift while clicking the chip to navigate to the bookmark's detail page in Tiddly instead.

- Reference: `frontend/src/hooks/useLinkedNavigation.ts:21`
- Tags: feature | power-user

### #13 — Save bookmarks from anywhere on the web with the Chrome extension — priority 25 (cross-category: extension)

Install the Tiddly Chrome extension and click its toolbar icon on any tab to scrape the current page's title, description, and tags into a one-click save form — no need to open Tiddly.

- Reference: `chrome-extension/manifest.json:1`
- Tags: feature | new-user

### #16 — Page Content is editable — paste your own text to make a stub bookmark searchable — priority 15

Expand the "Page Content" section under a bookmark and paste in any text (highlights, an article excerpt, your own summary). That text feeds full-text search, so even stub bookmarks become findable by content.

- Reference: `frontend/src/components/Bookmark.tsx:1104`
- Tags: workflow | power-user

### S1 — Cancel a scheduled archive directly from the card — priority 35

When a bookmark has a future auto-archive date set, an indicator appears on the card with a one-click cancel — no need to open the bookmark to undo the schedule.

- Reference: `frontend/src/components/BookmarkCard.tsx:289`
- Tags: feature | power-user

### S7 — Link bookmarks to notes or prompts to build context bundles — priority 20 (cross-category: relationships if added)

From a bookmark's "Link content" button, attach related notes, prompts, or other bookmarks. Linked items appear as chips you can click through later — handy for grouping research without inventing tags.

- Reference: `frontend/src/components/Bookmark.tsx:1006`
- Tags: workflow | power-user

### #1 — Paste a URL anywhere in your lists to start a new bookmark — dup of seed `bookmark-paste-url`

From All Content, any saved-filter, Archived, or Trash view, press `⌘+V` (or `Ctrl+V`) outside of any input. If your clipboard holds a valid URL, the new-bookmark page opens with it pre-filled and metadata auto-fetches in the background.

- Reference: `frontend/src/hooks/useKeyboardShortcuts.ts:138`
- Existing seed tip: `bookmark-paste-url` in `frontend/src/data/tips/tips.ts`. Wording from the agent here adds the explicit "any saved-filter, Archived, or Trash view" enumeration that the existing tip already covers in summary form. No rewrite needed unless the seed tip is being touched anyway.

## Draft additions during review

Tips that surfaced from review discussion rather than from the agent's pass. Marked draft — needs refinement before authoring (M5).

### D1 — Have Claude write a search-optimized summary back into your bookmark — priority 20 (draft) — cross-category: mcp, ai

**Working title**: Have Claude write a search-optimized summary back into your bookmark.

**Description (draft)**: A bookmark's "Page Content" exists to feed full-text search — you don't typically read it. From Claude Desktop (or any MCP-connected agent), ask the agent to fetch the bookmark's URL, write a dense summary focused on keywords you'd search for later, and save it back via the MCP `update_item` tool. Replaces the raw scrape with something denser and more findable.

**Sample prompt to give the agent (draft)**: *"Look up bookmark `<id>` in Tiddly, fetch the page at its URL, write a 150-word summary that highlights the key terms and concepts I'd want to find later, then save the summary as the bookmark's content via update_item."*

- Tags: workflow | power-user
- minTier: tbd (the action is via MCP, not Tiddly's AI features — likely free/all-tiers but verify)

**Refinement notes**:
- Possibly merge with #16 (`Page Content is editable`) — pasting your own text and asking AI to write it are two execution paths for the same goal.
- Sample prompt needs polish; verify the actual MCP tool / argument shape (`update_item` vs `edit_content` vs whichever applies to bookmarks specifically).
- Decide canonical home at consolidation: `bookmarks` (where the value is felt) or `mcp` (where the action happens).
- May overlap with whatever the `mcp` agent surfaced; check before authoring.

## Cross-category tracking

These items belonged conceptually to other categories — verify they're surfaced when reviewing the matching category. Cite as `bookmarks:N` when picking them up there.

- `bookmarks:12` → `shortcuts` — `⌘+Shift+P` palette to jump to bookmark or filter
- `bookmarks:S2` → `shortcuts` — `s` focuses the search bar
- `bookmarks:S3` → `shortcuts` — `w` toggles full-width layout
- `bookmarks:S4` → `shortcuts` / generic editor — `Escape` to close, double-tap to discard
- `bookmarks:13` ↔ `extension` — Chrome extension save flow (currently kept in bookmarks too; pick canonical at consolidation)
- `bookmarks:S7` ↔ `relationships` (if a relationships category is added) — link content for context bundles
- `bookmarks:D1` ↔ `mcp`, `ai` — AI-summarize-and-save-back workflow. Primary home `bookmarks` (value felt there); flip if `mcp` agent has a stronger surfacing.
