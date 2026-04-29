# Tip candidates — docs-sweep (reviewed)

Status: reviewed against the brief criteria. `drop` = exclude. `dup` = already covered by an existing seed tip or another category. Priority is a best-guess rank (lower = higher rank); will be re-calibrated at consolidation. `#` numbers match the original agent file's order; `S#` = item from the agent's Speculative section.

This is the orthogonal pass — every keeper here is cross-category and will canonicalize in another category's file at final consolidation. The docs-sweep file is an inbox of prose-derived tips, not a final home.

## Decisions

| # | Tip | Priority | Notes |
|---|---|---|---|
| 1 | Open URL without bumping "last used" | dup | Same as `bookmarks:3` — kept there at 25. |
| 2 | Open bookmark relationship in Tiddly (Shift+Click) | dup | Same as `bookmarks:4` — kept there at 35. |
| 3 | Use `-term` to exclude search matches | 25 | Real proactive search-syntax tip. **Cross-category** → primary home `search`. Verify against `search` agent's findings; pull whichever wording is cleaner. |
| 4 | Page search `s` vs global `/` | drop | Cross-cutting shortcuts — `bookmarks:S2` tracked. |
| 5 | Toggle reading mode `Cmd+Shift+M` | drop | Cross-cutting shortcut. |
| 6 | Build OR/AND tag filters with grouped expressions | 15 | Strong workflow + feature tip. **Cross-category** → primary home `filters`. |
| 7 | Restrict a saved filter to one content type | drop | Trivial config option. |
| 8 | Open history sidebar with `Cmd+Shift+\` | drop | Cross-cutting shortcut. |
| 9 | Restoring a version is non-destructive | 30 | Reassurance affecting whether users feel safe restoring. **Cross-category** → likely `notes`/`prompts` (where versioning matters). |
| 10 | Whitespace-control Jinja blocks (`{%- %}`) | 20 | Strong proactive prompt-authoring tip. **Cross-category** → primary home `prompts`. |
| 11 | Prompts use strict Jinja2 — typos fail loudly | 25 | Real mental-model tip for prompt authors. **Cross-category** → primary home `prompts`. |
| 12 | Tag a prompt `skill` to auto-export | dup | Same as `cli:7`. |
| 13 | AI assistants see your prompt's full metadata (refined) | 20 | **Refined from agent's "argument descriptions are seen by AI"** to cover all the metadata an AI sees via MCP: prompt name, description, argument names, descriptions, required flags. Treat them like docstrings. **Cross-category** → primary home `prompts`, also `mcp`. |
| 14 | Set default tags in Chrome extension | 25 | Real proactive workflow. **Cross-category** → primary home `extension`. |
| 15 | Bind Chrome extension to keyboard shortcut | 30 | Real workflow. **Cross-category** → primary home `extension`. |
| 16 | Extension popup defaults to Search on restricted pages | drop | Defensive UX, not proactive. |
| 17 | Duplicate URLs detected on save | drop | Auto-behavior. |
| 18 | Command palette `Cmd+Shift+P` | drop | Cross-cutting shortcut. |
| 19 | `tiddly status` shows everything | dup | Same as `cli:2`. |
| 20 | Per-tool, per-server CLI MCP tokens | drop | Internal detail. |
| 21 | Multi-account MCP setups preserved | drop | Auto-behavior. |
| 22 | Token resolution order in CLI | drop | Edge case. |
| 23 | `--scope directory` for per-project | dup | Same as `cli:8`. |
| 24 | AI endpoints reject PATs by design | drop | API-developer detail. |
| 25 | Optimistic locking via If-Unmodified-Since | drop | API-developer detail. |
| 26 | Conflict dialog when two tools edit | drop | Auto-behavior. |
| 27 | Substring matching catches what stemming misses | drop | Pedagogical mental-model; users don't proactively act on it. |
| 28 | Export your data with `tiddly export` | dup | Same as `cli:6`. |
| 29 | Inactive tags are tags only on archived/deleted items | drop | Only relevant inside Settings → Tags, where it's already explained on the page. |
| 30 | Tag counts ignore archived items | drop | Mental-model nuance; auto-behavior. |
| 31 | Open card in new tab with `Cmd+Click` | drop | Cross-cutting shortcut. |
| 32 | Toggle sidebar with `Cmd+\` | drop | Cross-cutting shortcut. |
| 33 | Drag the entire sidebar — built-ins included | 30 | Real proactive workflow. **Cross-category** → likely `account`/`filters`. |
| 34 | Deleting a collection doesn't delete its filters | drop | Reassurance, not proactive. |
| 35 | Shell tab completion | drop | Already drop'd in `cli:12`. |
| 36 | `Cmd+/` opens editor command palette | drop | Cross-cutting shortcut. |
| 37 | Toggle word wrap, line numbers, mono, TOC | drop | Cross-cutting shortcuts. |
| 38 | Bookmark content captured up to 25,000 chars | drop | Limitation framing. |
| 39 | Title generation falls back when both fields empty | dup | Same as `ai:2`. |
| 40 | BYOK keys live in browser only | drop | Tier-marketing copy. |
| 41 | `mcp-remote` bridge for Claude Desktop | drop | Setup detail; the canonical Settings → AI Integration flow handles this. |
| 42 | Codex can't auto-invoke MCP prompts — use Skills | dup | Same insight powering `cli:D2`. Reinforce wording at consolidation. |
| S1 | Markdown image syntax for external images | drop | Workaround framing. |
| S2 | Workaround for stuck Shift+Arrow on wrapped lines | drop | Bug workaround. |
| S3 | Two MCP servers means scoped revocation | drop | Admin practice, not discovery. |
| S4 | Source tracking includes auth method | drop | Narrow auditing audience. |
| S5 | Search across active+archived relevance penalty | drop | Subtle ranking detail. |
| S6 | `view` parameter accepts multiple values | drop | API-only. |
| S7 | Deep-link to an individual tip | drop | Meta-tip; recursive. |

## Final keepers (9 unique, 8 dups)

Every unique keeper here is cross-category. Source descriptions are docs-prose paraphrases; canonical wording will be picked at consolidation against whatever the target category's agent surfaced.

### #6 — Build OR/AND tag filters with grouped expressions — priority 15 — cross-category: filters (primary)

Saved filters combine tags with AND inside a group and OR between groups. Example: `(python AND tutorial) OR (javascript AND guide)` matches items satisfying either bundle. AND-groups narrow; OR-groups broaden.

- Reference: `frontend/src/pages/docs/DocsTagsFilters.tsx` — Filter Expressions section.
- Tags: feature | power-user

### #13 (refined) — AI assistants see your prompt's full metadata — priority 20 — cross-category: prompts (primary), mcp

When an AI assistant fetches a prompt via MCP, it reads everything: the prompt name, description, argument names, argument descriptions, and required/optional flags. The AI uses all of that to decide whether to invoke the prompt and what to pass for each argument. Treat the prompt and its arguments like docstrings — vague text leads to bad fills.

- Reference: `frontend/src/pages/docs/DocsPrompts.tsx` — Arguments section.
- Tags: workflow | power-user

**Refinement notes:** broadened from the agent's "argument descriptions are seen by AI" to cover all visible metadata. Verify via the prompt MCP server's `tools.yaml` / `instructions.md` what's actually returned to clients.

### #10 — Whitespace-control Jinja blocks keep optional sections clean — priority 20 — cross-category: prompts (primary)

Add `-` inside Jinja tags (`{%- if x %}…{%- endif %}`) to strip surrounding whitespace. Without it, an empty optional block leaves stray blank lines in the rendered prompt.

- Reference: `frontend/src/pages/docs/DocsPrompts.tsx` — Whitespace Control.
- Tags: feature | power-user

### #11 — Prompts use strict Jinja2 — typos fail loudly — priority 25 — cross-category: prompts (primary)

Referencing an undefined variable in a prompt template raises an error instead of rendering empty. That catches typos and missing arguments at render time, not silently in production.

- Reference: `frontend/src/pages/docs/DocsPrompts.tsx` — InfoCallout under Rendering.
- Tags: feature | power-user

### #3 — Use `-term` to exclude search matches — priority 25 — cross-category: search (primary)

Prefix any term with `-` to exclude it from results. Example: `python -django` finds Python items that aren't about Django. Combines with quoted phrases and `OR`.

- Reference: `frontend/src/pages/docs/DocsSearch.tsx` operator table.
- Tags: feature | power-user

### #14 — Set default tags in Chrome extension — priority 25 — cross-category: extension (primary)

Configure default tags in the extension settings — they're pre-selected on every save. Handy for a recurring workflow like always tagging saves with `reading-list`.

- Reference: `frontend/src/pages/docs/DocsExtensionsChrome.tsx` — Tips section.
- Tags: workflow | new-user

### #9 — Restoring a version is non-destructive — priority 30 — cross-category: notes/prompts (primary tbd)

Restoring an old version creates a new version on top — nothing is overwritten. Audit events (delete, archive) can't be "restored" — use undelete or unarchive for those.

- Reference: `frontend/src/pages/docs/DocsVersioning.tsx` — Restoring a Version.
- Tags: feature | new-user

### #15 — Bind Chrome extension to a keyboard shortcut — priority 30 — cross-category: extension (primary)

Visit `chrome://extensions/shortcuts` to assign a keyboard shortcut to Tiddly Bookmarks — open the popup without touching the mouse.

- Reference: `frontend/src/pages/docs/DocsExtensionsChrome.tsx` — Tips section.
- Tags: workflow | power-user

### #33 — Drag the entire sidebar — built-ins included — priority 30 — cross-category: account/filters (primary tbd)

The sidebar order is fully persisted. Drag filters, collections, and even built-in views like "All Content" to reorder. Hover any item to reveal the drag handle.

- Reference: `frontend/src/pages/docs/DocsTagsFilters.tsx` — Sidebar Organization.
- Tags: feature | power-user

## Pure dups (canonical home elsewhere)

- `docs-sweep:1` ↔ `bookmarks:3` (open URL without bumping last-used)
- `docs-sweep:2` ↔ `bookmarks:4` (Shift+Click on relationship chip)
- `docs-sweep:12` ↔ `cli:7` (tag prompt `skill` to auto-export)
- `docs-sweep:19` ↔ `cli:2` (`tiddly status`)
- `docs-sweep:23` ↔ `cli:8` (`--scope directory`)
- `docs-sweep:28` ↔ `cli:6` (export to JSON)
- `docs-sweep:39` ↔ `ai:2` (sparkle generates both fields when both empty)
- `docs-sweep:42` ↔ `cli:D2` (Codex needs Skills, not MCP prompts)

## Cross-category tracking

All 9 unique keepers are cross-category. Pull canonical wording at consolidation:

- `docs-sweep:3` → `search` (primary)
- `docs-sweep:6` → `filters` (primary)
- `docs-sweep:9` → `notes`/`prompts` (primary tbd)
- `docs-sweep:10` → `prompts` (primary)
- `docs-sweep:11` → `prompts` (primary)
- `docs-sweep:13` → `prompts` (primary), also `mcp`
- `docs-sweep:14` → `extension` (primary)
- `docs-sweep:15` → `extension` (primary)
- `docs-sweep:33` → `account`/`filters` (primary tbd)
