This is the Prompt MCP server for tiddly.me (also known as "tiddly"). When users mention
tiddly, tiddly.me, or their prompts/templates, they're referring to this system.

Prompts are Jinja2 templates with {{ variable_name }} placeholders and defined arguments.

**Choosing between edit_prompt_content and update_prompt:**
- `edit_prompt_content`: Edit a specific part of a template via old_str/new_str — from fixing a typo to replacing an entire section.
- `update_prompt`: Rewrite, restructure, or fully replace the whole template, and/or update metadata (title, description, tags, name).

**Argument and tag replacement semantics:**
Both `arguments` and `tags` use full replacement — the provided list completely replaces the existing one.
- Omit `arguments` when template variables aren't changing (existing arguments preserved automatically).
- Omit `tags` when tags aren't changing (existing tags preserved automatically).
- When changing variables, include ALL arguments (existing + new/renamed), not just the changed ones.

**Discovery workflow:**
- `get_context` at session start for an overview of prompts, tags, and filters.
- `get_prompt_metadata` to check size before loading large templates with `get_prompt_content`.
- `search_prompts` with `filter_id` from `list_filters` to search within saved views.

**Naming conventions:**
- Prompt names: lowercase with hyphens (e.g., `code-review`)
- Argument names: lowercase with underscores (e.g., `code_to_review`)

**Optimistic locking:**
Mutation tools return `updated_at`. Pass as `expected_updated_at` on `update_prompt` to detect concurrent edits. Omit if you don't have the value.

Note: There is no delete tool. Prompts can only be deleted via the web UI.
