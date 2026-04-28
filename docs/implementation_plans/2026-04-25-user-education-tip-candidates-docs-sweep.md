# Tip candidates — docs-sweep

Sourced by reading the user-facing docs prose (`frontend/src/pages/docs/*`, `frontend/public/llms.txt`, `FAQContent.tsx`, `SettingsFAQ.tsx`). Tone-matched to existing tips in `frontend/src/data/tips/tips.ts`.

## Strong candidates (strongest first)

### Open a bookmark URL without bumping "last used"
- Description: Hold Shift+Cmd and click a bookmark to open the URL without updating its last-used timestamp. Useful when you're sanity-checking links and don't want to skew "recently used" rankings or sorts.
- Reference: `frontend/src/pages/docs/DocsContentTypes.tsx` — "Hold Shift+Cmd+Click to open a link without updating the 'last used' timestamp."
- Tags: feature | power-user

### Open a bookmark relationship in Tiddly instead of the URL
- Description: Click a bookmark relationship chip to follow the URL by default. Hold Shift while clicking to open the bookmark's detail view inside Tiddly instead.
- Reference: `frontend/src/pages/docs/DocsShortcuts.tsx` — `Shift+Click` "Open bookmark relationship in Tiddly (instead of URL)".
- Tags: feature | power-user

### Use `-term` to exclude search matches
- Description: Prefix any term with `-` to exclude it from results. Example: `python -django` finds Python items that aren't about Django. Combines with quoted phrases and `OR`.
- Reference: `frontend/src/pages/docs/DocsSearch.tsx` (operator table) and `frontend/public/llms.txt` §Search.
- Tags: feature | power-user

### Page search with `s`, global search with `/`
- Description: Two different search bars — `/` focuses the global content search; `s` focuses the in-page search inside whichever view you're on. Knowing which is which avoids the "why isn't my filter applying?" confusion.
- Reference: `frontend/src/pages/docs/DocsShortcuts.tsx` — Navigation table (`/` Focus search bar, `s` Focus page search).
- Tags: feature | new-user

### Toggle reading mode with Cmd+Shift+M
- Description: Notes and prompts open in editor mode. Press Cmd+Shift+M to render markdown for clean reading without leaving the page.
- Reference: `frontend/src/pages/docs/DocsContentTypes.tsx` and `DocsShortcuts.tsx`.
- Tags: feature | new-user

### Build OR/AND tag filters with grouped expressions
- Description: Saved filters combine tags with AND inside a group and OR between groups. Example: `(python AND tutorial) OR (javascript AND guide)` matches items that satisfy either bundle. Use AND-groups to narrow, OR-groups to broaden.
- Reference: `frontend/src/pages/docs/DocsTagsFilters.tsx` — Filter Expressions section, and `frontend/public/llms.txt` §Content Filters.
- Tags: feature | power-user

### Restrict a saved filter to one content type
- Description: Saved filters take a content-type restriction (bookmarks, notes, prompts, or any combination) plus a default sort. Pair it with tags to make views like "all Python notes, sorted by updated date".
- Reference: `frontend/src/pages/docs/DocsTagsFilters.tsx` — Filter Options.
- Tags: workflow | power-user

### Open the history sidebar with Cmd+Shift+\\
- Description: While viewing any bookmark, note, or prompt, press Cmd+Shift+\\ to open the version history sidebar — see every edit, who/where it came from (web, MCP, API, iPhone), and a per-version diff.
- Reference: `frontend/src/pages/docs/DocsVersioning.tsx` — History Sidebar.
- Tags: feature | power-user

### Restoring a version is non-destructive
- Description: Restoring an old version creates a new version on top — nothing is overwritten. Audit events (delete, archive) can't be "restored" — use undelete or unarchive for those.
- Reference: `frontend/src/pages/docs/DocsVersioning.tsx` — Restoring a Version.
- Tags: feature | new-user

### Whitespace-control Jinja blocks keep optional sections clean
- Description: Add `-` inside Jinja tags (`{%- if x %}…{%- endif %}`) to strip surrounding whitespace. Without it, an empty optional block leaves stray blank lines in the rendered prompt.
- Reference: `frontend/src/pages/docs/DocsPrompts.tsx` — Whitespace Control.
- Tags: feature | power-user

### Prompts use strict Jinja2 — typos fail loudly
- Description: Referencing an undefined variable in a prompt template raises an error instead of rendering empty. That catches typos and missing arguments at render time, not silently in production.
- Reference: `frontend/src/pages/docs/DocsPrompts.tsx` — InfoCallout under Rendering.
- Tags: feature | power-user

### Tag a prompt `skill` to auto-export it
- Description: `tiddly skills configure` defaults to `--tags skill` — tagging a prompt with `skill` is enough to ship it as a SKILL.md to Claude Code, Codex, or Claude Desktop. Use `--tags ""` to export every prompt.
- Reference: `frontend/src/pages/docs/DocsCLISkills.tsx` and `DocsPrompts.tsx` Agent Skills section.
- Tags: workflow | power-user

### Argument descriptions are seen by AI assistants
- Description: When a prompt is fetched via MCP, AI assistants read each argument's description to decide what to pass. Vague descriptions lead to bad fills — write them like docstrings.
- Reference: `frontend/src/pages/docs/DocsPrompts.tsx` — InfoCallout under Arguments.
- Tags: workflow | power-user

### Set default tags in the Chrome extension
- Description: Configure default tags in the extension settings — they're pre-selected on every save. Handy for a recurring workflow like always tagging saves with `reading-list`.
- Reference: `frontend/src/pages/docs/DocsExtensionsChrome.tsx` — Tips section.
- Tags: workflow | new-user

### Bind the Chrome extension to a keyboard shortcut
- Description: Visit `chrome://extensions/shortcuts` to assign a keyboard shortcut to Tiddly Bookmarks — open the popup without touching the mouse.
- Reference: `frontend/src/pages/docs/DocsExtensionsChrome.tsx` — Tips section.
- Tags: workflow | power-user

### The extension popup defaults to Search on restricted pages
- Description: On `chrome://`, new tab, or other extension pages, the Save tab is disabled because the page can't be bookmarked — the popup opens to Search instead. Useful as an "I want to find a bookmark" shortcut from any tab.
- Reference: `frontend/src/pages/docs/DocsExtensionsChrome.tsx` — Search Tab section.
- Tags: feature | power-user

### Duplicate URLs are detected on save
- Description: If you save a URL that already exists (active or archived), the extension links you to the existing bookmark instead of creating a duplicate. Safe to spam Cmd+V on a page you might have already saved.
- Reference: `frontend/src/pages/docs/DocsExtensionsChrome.tsx` — InfoCallout under Save Tab.
- Tags: feature | new-user

### Command palette: Cmd+Shift+P
- Description: Cmd+Shift+P opens a unified search-and-jump palette across all content. Faster than navigating sidebars when you have a name in mind.
- Reference: `frontend/src/pages/docs/DocsSearch.tsx` and `DocsShortcuts.tsx`.
- Tags: feature | new-user

### `tiddly status` shows everything in one shot
- Description: `tiddly status` prints CLI version, auth method, API health, content counts, MCP server status across user and directory scopes, and installed skills. Pass `--path /your/project` to inspect directory-scoped configs without `cd`-ing.
- Reference: `frontend/src/pages/docs/DocsCLIReference.tsx` — `tiddly status` section.
- Tags: feature | power-user

### Per-tool, per-server CLI MCP tokens
- Description: When OAuth-authed, `tiddly mcp configure` mints a separate PAT per tool per server (e.g., `cli-mcp-claude-code-content-…`). Revoke one without breaking the others. Re-running configure reuses existing PATs when valid.
- Reference: `frontend/src/pages/docs/DocsCLIMCP.tsx` — Token Management.
- Tags: feature | power-user

### Multi-account MCP setups are preserved
- Description: If you've hand-added entries like `work_prompts` or `personal_prompts` pointing at Tiddly with their own PATs, `tiddly mcp configure` adds the canonical entries alongside them and leaves your custom ones alone.
- Reference: `frontend/src/pages/docs/DocsCLIMCP.tsx` — InfoCallout "I have multiple Tiddly entries".
- Tags: workflow | power-user

### Token resolution order in the CLI
- Description: The CLI checks `--token` flag, then `TIDDLY_TOKEN` env var, then stored PAT, then stored OAuth JWT. Useful for CI: pin a token in env without losing your local OAuth login.
- Reference: `frontend/src/pages/docs/DocsCLIReference.tsx` — Token Resolution.
- Tags: workflow | power-user

### Use `--scope directory` for per-project MCP/skills
- Description: Both `tiddly mcp configure` and `tiddly skills configure` accept `--scope directory` to write into the cwd's `.claude/` or `.codex/` instead of your home directory. Lets a repo carry its own AI tooling config.
- Reference: `frontend/src/pages/docs/DocsCLIMCP.tsx` and `DocsCLISkills.tsx` — Scopes tables.
- Tags: workflow | power-user

### AI endpoints reject PATs by design
- Description: `/ai/*` endpoints return 403 to PATs — they require an Auth0 session. AI suggestions aren't meant for programmatic automation. Every other content endpoint accepts PATs normally.
- Reference: `frontend/src/pages/docs/DocsAPI.tsx` — AI Endpoint Caveat callout.
- Tags: feature | power-user

### Optimistic locking via If-Unmodified-Since
- Description: API list endpoints support `If-Unmodified-Since` to detect concurrent edits — pass the item's last-modified timestamp on writes. Same protection MCP gets via `expected_updated_at`.
- Reference: `frontend/src/pages/docs/DocsAPI.tsx` — Shared Capabilities.
- Tags: feature | power-user

### Conflict dialog when two tools edit the same item
- Description: If something else (another tab, MCP agent, API client) updates an item while you're editing, Tiddly shows a conflict dialog with options to keep your version or load the latest.
- Reference: `frontend/src/pages/docs/DocsContentTypes.tsx` — InfoCallout under Shared Features.
- Tags: feature | power-user

### Substring matching catches what stemming misses
- Description: Search runs full-text (stemmed, ranked) plus substring matching in parallel. That's why `auth` matches `authentication` and code symbols/punctuation still find their target — you don't have to choose between fuzzy and exact.
- Reference: `frontend/src/pages/docs/DocsSearch.tsx` — How Search Works.
- Tags: feature | power-user

### Export your data with `tiddly export`
- Description: `tiddly export` writes all bookmarks, notes, and prompts to JSON. `--types`, `--output`, and `--include-archived` narrow or expand. Good for backups before risky refactors.
- Reference: `frontend/src/pages/docs/DocsCLIReference.tsx` — Export.
- Tags: workflow | power-user

### Inactive tags are tags only on archived/deleted items
- Description: A tag whose only items are archived or deleted shows as "inactive" in Settings → Tags. Useful for cleaning up — delete inactive tags to prune the namespace without touching live content.
- Reference: `frontend/src/components/FAQContent.tsx` — Tags FAQ.
- Tags: feature | power-user

### Tag counts ignore archived items
- Description: Tag counts in Settings → Tags only count active content. Archived/deleted items don't contribute. Explains why your "100 things tagged python" view drops after archiving a batch.
- Reference: `frontend/src/components/FAQContent.tsx` — Archive & Trash FAQ.
- Tags: feature | power-user

### Open a card in a new tab with Cmd+Click
- Description: Cmd+Click any card in a list view to open it in a new tab — same affordance as a browser link, works for bookmarks, notes, and prompts.
- Reference: `frontend/src/pages/docs/DocsShortcuts.tsx` — Navigation.
- Tags: feature | new-user

### Toggle sidebar with Cmd+\\
- Description: Cmd+\\ collapses/expands the sidebar. Pair with `w` (full-width layout) for an editor-only view when reading or writing long notes.
- Reference: `frontend/src/pages/docs/DocsShortcuts.tsx` — View.
- Tags: workflow | power-user

### Drag the entire sidebar — built-ins included
- Description: The sidebar order is fully persisted. Drag filters, collections, and even built-in views like "All Content" to reorder. Hover any item to reveal the drag handle.
- Reference: `frontend/src/pages/docs/DocsTagsFilters.tsx` — Sidebar Organization, and FAQ.
- Tags: feature | power-user

### Deleting a collection doesn't delete its filters
- Description: When you remove a collection, its filters move back to the sidebar root. Same for deleting a filter — your bookmarks/notes/prompts inside it are untouched. Filters are views, not containers.
- Reference: `frontend/src/components/FAQContent.tsx` — Filters & Collections FAQ.
- Tags: feature | new-user

### Shell tab completion: `tiddly completion <shell>`
- Description: Source `tiddly completion bash|zsh|fish` to get tab completion for commands, flags, and tool names. Run once in your shell rc file.
- Reference: `frontend/src/pages/docs/DocsCLIReference.tsx` — Shell Completions.
- Tags: workflow | power-user

### `Cmd+/` opens the editor command palette
- Description: Inside a note or prompt editor, Cmd+/ opens a filterable palette of every formatting/insertion/action command — including save and discard. Works mid-selection, unlike `/` which only fires at the start of a line.
- Reference: `frontend/src/pages/docs/DocsContentTypes.tsx` (Editor Features) and `frontend/public/llms.txt` §Markdown Editor.
- Tags: feature | power-user

### Toggle word wrap, line numbers, mono, TOC
- Description: Alt+Z, Alt+L, Alt+M, Alt+T toggle word wrap, line numbers, monospace font, and the table-of-contents sidebar inside an editor. The TOC turns into a navigable list of headings for long notes.
- Reference: `frontend/src/pages/docs/DocsShortcuts.tsx` — View, and `llms.txt`.
- Tags: feature | power-user

### Bookmark content is captured up to 25,000 chars
- Description: When you save a bookmark, the extension captures up to 25,000 characters of body text for full-text search. Long pages get truncated — keep that in mind for very long articles.
- Reference: `frontend/src/pages/docs/DocsExtensionsChrome.tsx` — Save Tab.
- Tags: feature | power-user

### Title generation falls back to "title + description" when both empty
- Description: The sparkle icon for title generation needs description or content to work from. If the description is also empty, the AI generates both fields together from the content. So you can use it on a freshly-pasted block of content with neither filled in.
- Reference: `frontend/src/pages/docs/DocsAIFeatures.tsx` — Metadata Generation.
- Tags: feature | new-user

### BYOK keys live in your browser only
- Description: Bring-Your-Own-Key API keys for AI features are stored in your browser's local storage — never on the server. Switching browsers means re-pasting; clearing storage means losing them.
- Reference: `frontend/src/pages/docs/DocsAIFeatures.tsx` — Configuration.
- Tags: feature | power-user

### `mcp-remote` bridge for Claude Desktop
- Description: Claude Desktop doesn't speak streamable HTTP MCP natively — the recommended config uses `npx mcp-remote` as a bridge to Tiddly's `https://content-mcp.tiddly.me/mcp` and `https://prompts-mcp.tiddly.me/mcp` endpoints.
- Reference: `frontend/public/llms.txt` §Setting Up MCP Servers.
- Tags: feature | power-user

### Codex can't auto-invoke MCP prompts — use Skills
- Description: Codex doesn't support MCP Prompts (the `/prompt-name` slash invocation Claude Code has). The prompt MCP tools still work for fetch-by-name flows, but for Codex-native invocation, export prompts as Codex Skills.
- Reference: `frontend/src/pages/docs/DocsCLIMCP.tsx` — InfoCallout "Codex and Prompts".
- Tags: feature | power-user

## Speculative

### Markdown image syntax works for external images
- Description: Even though Tiddly has no file uploads, `![alt](https://example.com/img.png)` in a note renders an externally hosted image. Decent workaround for "I just want a picture in my note".
- Reference: `frontend/src/pages/docs/DocsKnownIssues.tsx` — first issue.
- Tags: feature | power-user
- Hesitation: phrased as a limitation in docs — adjacent to a "no attachments" complaint, so users may read this tip as compensating for a flaw rather than a feature.

### Workaround for stuck Shift+Arrow on wrapped lines
- Description: When word wrap is on and a long line wraps, Shift+Down/Shift+Up can stick at the visual line boundary. Press Shift+Right once to advance, or toggle word wrap off (Alt+Z).
- Reference: `frontend/src/pages/docs/DocsKnownIssues.tsx` — Editor section.
- Tags: feature | power-user
- Hesitation: workaround for a known bug — borderline for the "no bug reports" rule.

### Two MCP servers means scoped revocation
- Description: Run two separate PATs for content and prompt MCP servers. Revoke one without breaking the other — and the version history shows which prefix made each edit.
- Reference: `frontend/src/components/FAQContent.tsx` — "Do I need separate tokens for each MCP server?".
- Tags: workflow | power-user
- Hesitation: more an admin practice than a discovery tip.

### Source tracking includes auth method
- Description: Every history entry records the source (web, MCP, API, iPhone) and authentication method. PAT changes record the token prefix, so you can tell which token wrote what.
- Reference: `frontend/src/components/FAQContent.tsx` — Version History FAQ.
- Tags: feature | power-user
- Hesitation: very narrow audience — auditing-style users only.

### Searching across active+archived applies a relevance penalty
- Description: When you search both active and archived items with relevance sorting, archived results are penalized so active content ranks higher. Worth knowing if you sometimes wonder "why doesn't my archived item come up first even though it's a better match?"
- Reference: `frontend/public/llms.txt` §Search.
- Tags: feature | power-user
- Hesitation: subtle ranking detail; users may not notice or care.

### `view` parameter accepts multiple values in unified search
- Description: The `/content/` API accepts `?view=active&view=archived` to query multiple lifecycle states at once. Useful when you want one query covering "everything I ever saved".
- Reference: `frontend/public/llms.txt` §Search.
- Tags: feature | power-user
- Hesitation: API-only; arguably belongs only to API tip set.

### Deep-link to an individual tip
- Description: Each tip on `/docs/tips` has a stable anchor — link to one with `https://tiddly.me/docs/tips#tip-<id>`.
- Reference: `frontend/public/llms.txt` §Keyboard Shortcuts and Tips.
- Tags: feature | power-user
- Hesitation: meta-tip about the tips page itself; slightly recursive.
