# Tip candidates — mcp (reviewed)

Status: reviewed against the brief criteria. `drop` = exclude. `dup` = already covered by an existing seed tip or another category. Priority is a best-guess rank (lower = higher rank); will be re-calibrated at consolidation. `#` numbers match the original agent file's order; `S#` = item from the agent's Speculative section.

**Net result: 0 unique keepers, 4 dups.** The agent surfaced many strong agent-instruction tips (use `get_context`, prefer `edit_content`, saved filters as MCP scopes, etc.) — but on reflection, all of those tell *agents* how to use Tiddly, and that information is **already in the MCP server's instructions and tool descriptions** that the agent receives at session start. Adding them to `/docs/tips` would either:

1. Be unused (users don't read them; they're for agents).
2. Or duplicate context the agent already has — no upside if we surfaced them to agents via MCP, since they're already there.

The remaining MCP-relevant tips are user-facing setup and usage flows, all of which already have canonical homes in `cli` (`cli:D1`, `cli:3`, `cli:D2`) or the seed corpus.

## Decisions

| # | Tip | Priority | Notes |
|---|---|---|---|
| 1 | Connect Claude to your Tiddly content | dup | Canonical home `cli:D1` (priority 8). |
| 2 | One-shot `tiddly mcp configure` | dup | Canonical home `cli:3` (priority 15). |
| 3 | Use `get_context` at start of an AI session | drop | Already in `backend/src/mcp_server/instructions.md` — agent reads this at session start. |
| 4 | Prefer `edit_content` over full rewrites | drop | Already in MCP server instructions and tool descriptions. |
| 5 | Search syntax works from your AI assistant too | drop | Same syntax already covered by seed `search-quoted-phrase` for users; agents already see operators in `search_items` tool description. |
| 6 | Check size before loading large content | drop | Already in `get_item` tool description. |
| 7 | Invoke Tiddly prompts with `/prompt-name` in Claude Code | dup | Canonical home `cli:D2` (priority 5). |
| 8 | Prompt arguments use Jinja2 syntax | dup | Canonical home seed `prompt-template-arguments` (priority 20). |
| 9 | Saved filters work as named MCP scopes | drop | Already in `search_items` tool description (the `filter_id` parameter). |
| 10 | `search_in_content` returns matches with line numbers | drop | Already in tool description. |
| 11 | Tag changes are full replacement | drop | Already in `update_item` / `update_prompt` tool descriptions. |
| 12 | `edit_prompt_content` atomic template + arguments update | drop | Already in tool description. |
| 13 | Re-running `tiddly mcp configure` is safe | drop | Auto-behavior / reassurance. |
| 14 | `tiddly mcp remove --delete-tokens` | drop | Same as `cli:10` dropped. |
| 15 | Link related items with `create_relationship` | drop | Already in tool description. |
| 16 | Optimistic locking prevents stomping concurrent edits | drop | Auto-behavior; agent already sees `expected_updated_at` in tool description. |
| S1 | Search returns previews, not full content | drop | Internal plumbing; in tool description. |
| S2 | Search excludes archived/deleted items | drop | Limitation; already in instructions. |
| S3 | Tag conventions lowercase-with-hyphens | drop | Convention; already in instructions. |
| S4 | Codex users: prompts work via tools | dup | Same insight powering `cli:D2`. |
| S5 | Agents can save URLs you paste in chat | drop | Borderline overlap; not a user-facing tip. |
| S6 | Per-tool, per-server PATs by default | drop | Security/admin detail. |

## Final keepers

No unique keepers. Dups listed below; all canonicalize elsewhere.

### #1 — Connect Claude to your Tiddly content — dup of `cli:D1`

Tiddly exposes two MCP servers — `tiddly_notes_bookmarks` (bookmarks/notes) and `tiddly_prompts` (templates) — that let AI assistants search, read, create, and edit your content directly. Set up from Settings → AI Integration.

- Reference: `frontend/src/pages/settings/SettingsMCP.tsx:12`; `frontend/public/llms.txt:77`
- See `cli:D1` for canonical wording.

### #2 — One-shot MCP setup with `tiddly mcp configure` — dup of `cli:3`

The Tiddly CLI auto-detects Claude Desktop, Claude Code, and Codex and installs both MCP servers with dedicated PATs. Run `tiddly mcp configure` once.

- Reference: `frontend/src/pages/docs/DocsCLIMCP.tsx:20`
- See `cli:3` for canonical wording.

### #7 — Invoke Tiddly prompts with `/prompt-name` in Claude Code — dup of `cli:D2`

When the prompt MCP server is configured, every Tiddly prompt is available in Claude Code as `/prompt-name`. Codex doesn't support this natively — export Skills instead.

- Reference: `frontend/src/pages/docs/DocsCLIMCP.tsx:49`
- See `cli:D2` for canonical wording.

### #8 — Prompt arguments use Jinja2 syntax — dup of seed `prompt-template-arguments`

Prompt templates use `{{ variable_name }}` placeholders, plus `{% if %}` and `{% for %}` blocks. The MCP server renders the template with caller-supplied values via the standard `get_prompt` capability.

- Reference: `backend/src/prompt_mcp_server/tools.yaml:62`
- See seed `prompt-template-arguments` for canonical wording.

## Cross-category tracking

- `mcp:1` → `cli:D1` canonical.
- `mcp:2` → `cli:3` canonical.
- `mcp:7` → `cli:D2` canonical.
- `mcp:8` → seed `prompt-template-arguments` canonical.

## Update for the plan's "MCP-consumability of tips" follow-up

Earlier the plan flagged the question of whether tips should be MCP-consumable so agents could read them. This category's review surfaced a stronger claim:

The candidate agent-instruction tips that emerged here (`get_context` first, `edit_content` over rewrites, optimistic locking, etc.) are **all already in the MCP server's instructions and tool descriptions** — agents see them at session start. There is no upside to:

- Adding them to `/docs/tips` (users don't read agent-instruction prose).
- Re-publishing them via a separate `list_tips` MCP tool (agent already has them).

The plan follow-up should be narrowed: the *useful* universe of MCP-injectable tips would be tips that aren't already in MCP descriptions — specifically Tiddly-content-model nuances or cross-tool workflows that span features the per-tool descriptions don't capture. Those are likely few; possibly not worth a dedicated `mcpVisible` schema field at all.
