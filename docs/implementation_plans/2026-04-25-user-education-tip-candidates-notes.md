# Tip candidates — notes (reviewed)

Status: reviewed against the brief criteria. `drop` = exclude. `dup` = already covered by an existing seed tip or another category. Priority is a best-guess rank (lower = higher rank); will be re-calibrated at consolidation. `#` numbers match the original agent file's order; `S#` = item from the agent's Speculative section; `D#` = draft additions surfaced during review.

Notes is structurally a thin category — almost every tip about "the note experience" is either editor behavior (covered in `editor`) or generic content-lifecycle behavior (covered in `bookmarks`/`filters`/`shortcuts`). Net unique to notes: 3 (one of which is a new draft from review).

## Decisions

| # | Tip | Priority | Notes |
|---|---|---|---|
| 1 | Toggle reading mode `⌘⇧M` | dup | `editor:3` (priority 20). |
| 2 | Open ToC `⌥T` | dup | `editor:21` (priority 25). |
| 3 | Save and close `⌘⇧S` | dup | `editor:27` (priority 30). |
| 4 | Press Escape twice to discard | drop | Defensive UX. |
| 5 | Quick-create a linked bookmark/note/prompt from the link picker | 20 | Real proactive workflow — pick "Create new …" in the link picker → opens a new detail page pre-linked to the current note → save+close drops you back in the source. **Cross-category** with `bookmarks`, `prompts`. |
| 6 | `⌘/` quick-action menu | dup | `editor:1` (priority 10). |
| 7 | Auto-archive a note on a future date | dup | Same idea as `bookmarks:2` (priority 15) — applies to notes too. **Cross-category** ↔ bookmarks/prompts; the auto-archive feature is content-type-agnostic. |
| 8 | AI auto-tagging and link suggestions | dup | Largely covered by `ai:1` (tag chips) and `ai:3` (related-content suggestions). |
| 9 | Restore an older version from the History sidebar | 25 | **Canonical home for `editor:15`** (Version History via `⌘⇧\`). Versioning matters most where users actively edit (notes/prompts). **Cross-category** with `prompts`. |
| 10 | `⌥Z/L/M` view toggles | dup | Subset of `editor:4` (priority 30). |
| 11 | `==highlight==` syntax | drop | Markdown extension; users wouldn't proactively decide to use this. |
| 12 | Code blocks support real syntax highlighting | drop | Auto-behavior; expected from any markdown editor. |
| 13 | Click checkboxes in reading mode to tick them off | drop | `editor:5` covers clicking checkboxes in the *raw* editor (the unique angle). Reading-mode clicks are expected. |
| 14 | Concurrent edit protection / Conflict dialog | drop | Auto-behavior; same logic as `bookmarks:S6` dropped. |
| 15 | New notes inherit the current tag filter | drop | Auto-behavior. |
| 16 | Link a note to a bookmark or prompt | dup | `bookmarks:S7` ("link content for context bundles") at priority 20. **Cross-category** with relationships if added. |
| S1 | Stale check warns when changed in another tab | drop | Defensive UX. |
| S2 | `⌘D` multi-select | dup | seed `shortcut-select-next-occurrence`. |
| S3 | Sticky header stays visible | drop | Basic UI affordance. |
| S4 | Created/Updated timestamps shown | drop | Visible by default. |
| S5 | Title autofocuses on new notes | drop | Standard form behavior. |
| S6 | Notes are exposed via MCP for agents | dup | `cli:D1` covers this. |
| S7 | FTS with English stemming | dup | Adjacent to seed `search-quoted-phrase`. |
| **D1** (draft) | Audit and undo AI edits via Version History | **18** | Surfaces the trust narrative for MCP write access — every AI edit is logged with source `MCP`, viewable as a diff, fully restorable. Strong workflow + power-user trust tip. **Cross-category** with `ai`, `mcp`, `prompts`. |

## Final keepers (preserved details from the agent file, plus drafts)

### D1 (draft) — Audit and undo AI edits via Version History — priority 18 — cross-category: ai, mcp, prompts

When AI assistants edit your notes or prompts through MCP, every change gets logged in version history along with the source (`MCP`). Open the History sidebar (`⌘⇧\`) to:

- **See what the agent changed** — every edit is attributed to its source (`MCP` for agent edits, `web` for your own).
- **Review the diff** — exactly what was added, removed, or rewritten in each save.
- **Restore any previous version** in one click if the agent changed something it shouldn't have, or you want to roll back an experiment.

This is the safety net that makes letting AI edit your content directly feel safe — you can always see what it did and undo it.

- Tags: workflow | power-user
- minTier: tbd (verify whether MCP integration is gated)

**Refinement notes:**
- Decide canonical home: `notes` (where the action happens) or `ai` / `mcp` (where the value framing lives).
- Possibly merge with #9 (the broader version-history tip) into a layered tip, or keep separate (#9 = "you have version history"; D1 = "version history is the audit trail for AI edits").
- Verify the source-attribution column actually says `MCP` (not `mcp` or `agent` or some other label) before authoring.

### #5 — Quick-create a linked bookmark, note, or prompt from the link picker — priority 20 — cross-category: bookmarks, prompts

Open the link picker on a note (the link icon in the metadata row) and choose "Create new bookmark/note/prompt" — Tiddly opens a fresh detail page with the link to the current note pre-populated, and `Close` brings you straight back when you're done.

Use case: in a meeting note and want to capture a quick action item? Pick "Create new note" → the new note opens pre-linked to the meeting note → write the action → save+close → you're back in the meeting note with the action already linked. No copy-pasting IDs, no "I'll come back and link this later."

- Reference: `frontend/src/hooks/useQuickCreateLinked.ts:31`
- Tags: workflow | power-user

### #9 — Restore an older version from the History sidebar — priority 25 — canonical home for `editor:15` — cross-category: prompts

Open History on any note to see every saved revision with diffs against the previous version. Click Restore on an older version and the current content is replaced — this creates a new version, so nothing is ever truly lost.

Open the History sidebar with `⌘⇧\` (also available from the `⌘/` editor command palette).

- Reference: `frontend/src/components/HistorySidebar.tsx:74`
- Tags: feature | new-user

## Cross-category tracking

- `notes:5` ↔ `bookmarks`, `prompts` — quick-create-linked workflow applies symmetrically across content types.
- `notes:7` ↔ `bookmarks:2` — auto-archive scheduling is content-type-agnostic; the bookmarks file is currently the canonical home but applies equally here.
- `notes:9` ⟶ canonical home for `editor:15` (Version History via `⌘⇧\`); also applies to `prompts`.
- `notes:16` ↔ `bookmarks:S7` — link content for context bundles. Pick canonical home at consolidation.
- `notes:D1` ↔ `ai`, `mcp`, `prompts` — AI-edit transparency via Version History.
