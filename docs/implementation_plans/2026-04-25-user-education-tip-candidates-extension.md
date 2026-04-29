# Tip candidates — extension (reviewed)

Status: reviewed against the brief criteria. `drop` = exclude. `dup` = already covered by an existing seed tip or another category. Priority is a best-guess rank (lower = higher rank); will be re-calibrated at consolidation. `#` numbers match the original agent file's order; `S#` = item from the agent's Speculative section.

## Decisions

| # | Tip | Priority | Notes |
|---|---|---|---|
| 1 | Save any page with the Chrome extension | 25 | **dup** of `bookmarks:13`. Both kept at 25; canonical home decided at consolidation. |
| 2 | Pin the extension and assign a keyboard shortcut | 30 | **dup** of `docs-sweep:15`. |
| 3 | Set default tags so every save is pre-tagged | 25 | **dup** of `docs-sweep:14`. |
| 4 | Search your whole library from the extension | 20 | Unique-to-extension workflow tip — "I'm browsing and remember I saved something, let me look it up without opening Tiddly." |
| 5 | Restricted pages auto-open the Search tab | drop | Auto-behavior. |
| 6 | Page content is captured for full-text search | drop | "Save as usual" experience; same rationale as bookmarks #8 (PDF text). |
| 7 | Drafts persist if popup closes mid-save | drop | Auto-behavior / defensive UX. |
| 8 | Recently used tags pre-selected on next save | drop | Auto-behavior. |
| 9 | Already-saved URLs surface a link | drop | Auto-behavior + reassurance. |
| 10 | Save with extension, organize in web app | 25 | Workflow framing — the extension does capture; the web app does curation. |
| 11 | Connect the extension with a PAT | drop | Setup detail; first-launch flow guides this. |
| 12 | Type a new tag and press Enter | drop | Universal tag-input convention; not extension-specific. |
| S1 | Show all tags when default top-eight isn't enough | drop | Trivial UI affordance. |
| S2 | Filter extension search by multiple tags | drop | Generic search-filter behavior. |
| S3 | Toggle token visibility before pasting | drop | Trivial. |

## Final keepers

### #4 — Search your whole library from the extension — priority 20

The popup has a Search tab next to Save — type to query across titles, descriptions, URLs, and scraped page content; filter by tag and sort by relevance, last used, modified, or title. Clicking a result navigates the current tab to that bookmark. Useful when you're browsing and remember saving something but don't want to leave the page to look it up.

- Reference: `chrome-extension/popup.html:66`
- Tags: feature | power-user

### #10 — Save with the extension, organize in the web app — priority 25

Use the extension while browsing — title, description, and content auto-fill from the page. Later, open tiddly.me to edit, tag, link bookmarks together, or move them into saved filters. The two surfaces have different jobs: capture in-context, curate later.

- Reference: `chrome-extension/popup-core.js:354`
- Tags: workflow | new-user

### Dup keepers (canonical home decided at consolidation)

#### #1 — Save any page with the Chrome extension — priority 25 — dup of `bookmarks:13`

Install the Tiddly Bookmarks extension from the Chrome Web Store to save the page you're on with one click — no copy-pasting URLs into the web app. Works in Chrome, Edge, Brave, Arc, and other Chromium browsers.

- Reference: `frontend/src/pages/docs/DocsExtensionsChrome.tsx:24`
- Tags: feature | new-user

#### #2 — Pin the extension and assign a keyboard shortcut — priority 30 — dup of `docs-sweep:15`

After installing, pin Tiddly Bookmarks to the toolbar, then open `chrome://extensions/shortcuts` and bind a key (e.g., `Ctrl+Shift+S`) to launch the popup without reaching for the mouse.

- Reference: `frontend/src/pages/docs/DocsExtensionsChrome.tsx:140`
- Tags: workflow | power-user

#### #3 — Set default tags so every save is pre-tagged — priority 25 — dup of `docs-sweep:14`

Open the extension settings and pick default tags (e.g., `reading-list`). They'll be pre-selected on every save — clear them per-bookmark with the inline Clear link if a particular page doesn't fit.

- Reference: `chrome-extension/options.html:28`
- Tags: feature | new-user

## Cross-category tracking

- `extension:1` ↔ `bookmarks:13` — save with extension. Pick canonical at consolidation.
- `extension:2` ↔ `docs-sweep:15` — extension keyboard shortcut.
- `extension:3` ↔ `docs-sweep:14` — extension default tags.
