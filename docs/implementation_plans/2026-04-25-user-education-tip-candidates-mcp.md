# Tip candidates — mcp

## Strong candidates (strongest first)

### Connect Claude (Desktop, Code, or Codex) to your Tiddly content
- Description: Tiddly exposes two MCP servers — `tiddly_notes_bookmarks` (bookmarks/notes) and `tiddly_prompts` (templates) — that let AI assistants search, read, create, and edit your content directly. Set up from Settings → AI Integration.
- Reference: frontend/src/pages/settings/SettingsMCP.tsx:12; frontend/public/llms.txt:77
- Tags: feature | new-user

### One-shot MCP setup with `tiddly mcp configure`
- Description: The Tiddly CLI auto-detects Claude Desktop, Claude Code, and Codex and installs both MCP servers with dedicated PATs. Run `tiddly mcp configure` once; use `tiddly mcp status` to verify and `tiddly mcp remove` to clean up.
- Reference: frontend/src/pages/docs/DocsCLIMCP.tsx:20
- Tags: feature | new-user

### Use `get_context` at the start of an AI session
- Description: Ask your assistant to call `get_context` first. It returns counts, top tags, saved filters with their top items, and recent activity — a cheap orientation step that reduces flailing searches.
- Reference: backend/src/mcp_server/tools.yaml:133; backend/src/mcp_server/instructions.md:23
- Tags: workflow | power-user

### Prefer `edit_content` over full rewrites
- Description: For surgical edits to a note or bookmark, `edit_content` (old_str/new_str) is preferred over `update_item`. Old_str must match exactly one location — agents include surrounding context for uniqueness. Use `update_item` only for full rewrites or metadata changes.
- Reference: backend/src/mcp_server/tools.yaml:43; backend/src/mcp_server/instructions.md:49
- Tags: feature | power-user

### Search syntax works from your AI assistant too
- Description: `search_items` supports quoted phrases (`"machine learning"`), AND-by-default words, `OR`, and negation (`-django`). Stemming matches variants ("databases" finds "database") and substring matching catches code symbols (`useState`, `node.js`). Tell agents to use the right operator instead of a vague query.
- Reference: backend/src/mcp_server/instructions.md:29; backend/src/mcp_server/tools.yaml:1
- Tags: feature | power-user

### Check size before loading large content
- Description: `get_item(include_content=false)` returns `content_length` and a preview without paying for the whole body. For large items, use `start_line`/`end_line` to read a range. Saves tokens and latency on long notes or scraped articles.
- Reference: backend/src/mcp_server/tools.yaml:28; backend/src/mcp_server/server.py:235
- Tags: feature | power-user

### Invoke Tiddly prompts with `/prompt-name` in Claude Code
- Description: When the prompt MCP server is configured, every Tiddly prompt is available in Claude Code as `/prompt-name`. Tab-completion shows arguments. Build templates once, run them from any project. Codex doesn't support this natively — export Skills instead.
- Reference: frontend/src/pages/docs/DocsCLIMCP.tsx:49; frontend/public/llms.txt:191
- Tags: workflow | power-user

### Prompt arguments use Jinja2 syntax
- Description: Prompt templates use `{{ variable_name }}` placeholders, plus `{% if %}` and `{% for %}` blocks. Arguments must be declared in the prompt's argument list. The MCP server renders the template with caller-supplied values via the standard `get_prompt` capability.
- Reference: backend/src/prompt_mcp_server/tools.yaml:62; backend/src/prompt_mcp_server/instructions.md:4
- Tags: feature | new-user

### Saved filters work as named MCP scopes
- Description: `list_filters` returns saved-filter IDs; pass `filter_id` to `search_items` (or `search_prompts`) to scope a search to that filter. Lets you say "search my Work Projects filter" and have the agent honor your existing organization.
- Reference: backend/src/mcp_server/tools.yaml:24; backend/src/mcp_server/instructions.md:135
- Tags: workflow | power-user

### `search_in_content` returns matches with line numbers
- Description: Once you have an item ID, `search_in_content` finds matches inside that item's text and returns line numbers with surrounding context. Pairs naturally with `edit_content`: locate the line, build a unique old_str, replace.
- Reference: backend/src/mcp_server/tools.yaml:56
- Tags: workflow | power-user

### Tag changes are full replacement — don't drop tags by accident
- Description: `update_item(tags=[...])` and `update_prompt(tags=[...])` replace the entire tag list. To add one tag, include all existing tags plus the new one. Omit `tags` entirely to leave them unchanged.
- Reference: backend/src/mcp_server/tools.yaml:86; backend/src/prompt_mcp_server/instructions.md:10
- Tags: feature | power-user

### `edit_prompt_content` updates template + arguments atomically
- Description: When an edit adds, removes, or renames a `{{ variable }}`, pass the complete new `arguments` list in the same `edit_prompt_content` call — content edit and argument schema update happen together. Omit `arguments` when variables are unchanged to avoid unnecessary writes.
- Reference: backend/src/prompt_mcp_server/tools.yaml:84
- Tags: feature | power-user

### Re-running `tiddly mcp configure` is safe
- Description: The CLI reads existing PATs from config files, validates them, and only mints new tokens when needed. Multi-account custom entries (e.g. `work_prompts`) are preserved untouched. Use `--dry-run` to preview.
- Reference: frontend/src/pages/docs/DocsCLIMCP.tsx:131; frontend/src/pages/docs/DocsCLIMCP.tsx:174
- Tags: feature | new-user

### `tiddly mcp remove --delete-tokens` cleans up dedicated PATs
- Description: When uninstalling, pass `--delete-tokens` (OAuth login required) to revoke the per-tool tokens the CLI minted. Without it, the CLI warns about potential orphan tokens. PATs attached to entries you created manually are never touched.
- Reference: frontend/src/pages/docs/DocsCLIMCP.tsx:92
- Tags: feature | power-user

### Link related items with `create_relationship`
- Description: Ask your agent to link a new note to its source bookmark (or any two items) via `create_relationship`. Idempotent — re-linking returns the existing edge. Surfaces in the UI's relationships panel.
- Reference: backend/src/mcp_server/tools.yaml:120; backend/src/mcp_server/instructions.md:60
- Tags: workflow | power-user

### Optimistic locking prevents stomping concurrent edits
- Description: Mutation tools return `updated_at`. Pass it as `expected_updated_at` on the next `update_item`/`update_prompt` to detect conflicts — the server returns the current state instead of overwriting. Useful for long-running agent loops.
- Reference: backend/src/mcp_server/tools.yaml:91; backend/src/prompt_mcp_server/instructions.md:25
- Tags: feature | power-user

## Speculative

### Search returns previews, not full content
- Description: `search_items` returns `content_length` and a 500-char `content_preview` per hit, not the full body. Agents fetch full content via `get_item` when they actually need it — keeps large result sets cheap.
- Reference: backend/src/mcp_server/instructions.md:81
- Tags: feature | power-user
- Hesitation: Borderline plumbing — useful only if a user is hand-tuning prompts.

### Search excludes archived and deleted items
- Description: MCP searches return active items only. Archive in the web UI to remove items from agent visibility without deleting them. There's no MCP delete tool — only the UI can delete.
- Reference: backend/src/mcp_server/instructions.md:99
- Tags: feature | new-user
- Hesitation: Half feature, half limitation; risk of feeling like a caveat list.

### Tag conventions: lowercase-with-hyphens
- Description: Tools expect tags in `lowercase-with-hyphens` form (e.g., `machine-learning`). Agents that follow this stay consistent with the rest of the corpus and your saved filters keep working.
- Reference: backend/src/mcp_server/instructions.md:139; backend/src/mcp_server/tools.yaml:104
- Hesitation: Minor convention; better as part of the prompts/notes tip set than a standalone MCP tip.
- Tags: feature | power-user

### Codex users: prompts work via tools, not slash invocation
- Description: Codex does not support MCP's native prompts capability. The prompt server still exposes `search_prompts`/`get_prompt_content` tools — ask Codex to fetch a prompt by name. For native invocation, export prompts as Codex Skills.
- Reference: frontend/src/pages/docs/DocsCLIMCP.tsx:49; frontend/public/llms.txt:191
- Tags: workflow | power-user
- Hesitation: Tool-specific; may belong in a Codex-skills tip cluster instead.

### Agents can save URLs you paste in chat
- Description: "Save this article: <url>" — your assistant calls `create_bookmark`, which auto-fetches metadata and scraped content. No need to leave the conversation to file something away.
- Reference: backend/src/mcp_server/instructions.md:111
- Tags: workflow | new-user
- Hesitation: Overlaps with the existing `bookmark-paste-url` UI tip; risk of redundancy.

### Per-tool, per-server PATs by default
- Description: `tiddly mcp configure` mints a separate PAT per tool per server (e.g., `cli-mcp-claude-code-content-…`). Revoke any one without breaking the others. Visible and revocable in Settings → Personal Access Tokens.
- Reference: frontend/src/pages/docs/DocsCLIMCP.tsx:124
- Tags: feature | power-user
- Hesitation: Security-y; valuable but might fit better as a security tip than an MCP one.

---

Counts: 16 strong, 6 speculative.

Top 3 highlights:
1. "Connect Claude to your Tiddly content" — gateway tip; many users likely don't realize MCP exists or what it unlocks.
2. "One-shot `tiddly mcp configure`" — collapses the biggest friction point (manual JSON/TOML edits) into a single command.
3. "Prefer `edit_content` over full rewrites" — actually changes how power users instruct their agents and reduces destructive edits.

Flags for consolidator:
- "Connect Claude…" and "One-shot `tiddly mcp configure`" overlap on new-user setup; consolidator may want to merge or stage them (overview tip + how-to tip).
- "Search syntax works from your AI assistant too" partially duplicates the existing `search-quoted-phrase` UI tip in tips.ts — different audience (agent prompting vs. UI search bar) but worth a callout.
- "Tag changes are full replacement" applies to both Content and Prompt MCP — could be one tip or split per server.
- Several speculative tips (archived exclusion, no-delete, Codex-prompts limitation) are partly limitations; consolidator should decide whether to surface them as tips or fold into FAQ/docs.
