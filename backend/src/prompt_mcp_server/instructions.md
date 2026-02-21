This is the Prompt MCP server for tiddly.me (also known as "tiddly"). When users mention
tiddly, tiddly.me, or their prompts/templates, they're referring to this system.

This MCP server is a prompt template manager for creating, editing, and using reusable AI prompts.
Prompts are Jinja2 templates with defined arguments that can be rendered with user-provided values.

**Tools:**
- `get_context`: Get a markdown summary of the user's prompts (counts, tags, filters with top items, recent prompts with arguments).
  Call this once at the start of a session to understand what prompts exist and how they're organized.
  Re-calling is only useful if the user significantly creates, modifies, or reorganizes content during the session.
  Use prompt names from the response with `get_prompt_content` for full templates.
- `search_prompts`: Search prompts with filters. Returns prompt_length and prompt_preview.
  Use `filter_id` to search within a saved content filter (discover IDs via `list_filters`).
- `list_filters`: List filters relevant to prompts, with IDs, names, and tag rules.
  Use filter IDs with `search_prompts(filter_id=...)` to search within a specific filter.
- `get_prompt_content`: Get a prompt's Jinja2 template and arguments. Returns both the raw template text
  and the argument definitions list. Use before edit_prompt_content.
- `get_prompt_metadata`: Get metadata without the template. Returns title, description, tags, prompt_length,
  and prompt_preview. Use to check size before loading with get_prompt_content.
- `create_prompt`: Create a new prompt template with Jinja2 content
- `edit_prompt_content`: Edit template via old_str/new_str replacement, optionally updating arguments
  atomically. Use for targeted edits: fix typos, add/remove/rename variables, modify sections.
- `update_prompt`: Update metadata (title, description, tags, name) and/or fully replace template.
  Use for metadata changes or complete rewrites. For targeted edits, use edit_prompt_content instead.
  **Important:** If updating template that changes variables ({{ var }}), you MUST also provide the full arguments list.
- `list_tags`: Get all tags with usage counts

Note: There is no delete tool. Prompts can only be deleted via the web UI.

**Optimistic Locking:**
All mutation tools return `updated_at` in their response. You can optionally pass this value as
`expected_updated_at` on `update_prompt` for optimistic locking. If the prompt was modified after
this timestamp, returns a conflict error with `server_state` containing the current version for
resolution. Omit `expected_updated_at` if you do not have the exact `updated_at` value.

**When to use get_prompt_metadata vs get_prompt_content:**
- Use `get_prompt_metadata` to check prompt_length before loading large templates
- Use `get_prompt_content` when you need the template and arguments for viewing or editing

Example workflows:

1. "Create a prompt for summarizing articles"
   - Call `create_prompt` tool with:
     - name: "summarize-article"
     - content: "Summarize the following article:\n\n{{ article_text }}\n\nProvide..."
     - arguments: [{"name": "article_text", "description": "To summarize", "required": true}]

2. "Fix a typo in my code-review prompt"
   - Call `get_prompt_content(name="code-review")` to see current content
   - Call `edit_prompt_content(name="code-review", old_str="teh code", new_str="the code")`

3. "Add a new variable to my prompt"
   - When adding {{ new_var }} to the template, you must also add its argument definition
   - Call `edit_prompt_content` with BOTH the content change AND the updated arguments list:
     - old_str: "Review this code:"
     - new_str: "Review this {{ language }} code:"
     - arguments: [...existing args..., {"name": "language", "description": "Lang"}]
   - The arguments list REPLACES all existing arguments, so include the ones you want to keep

4. "Remove a variable from my prompt"
   - Similarly, remove from both content and arguments in one call
   - Omit the removed argument from the arguments list

5. "Completely rewrite my prompt with a new structure"
   - Use `update_prompt` when most content changes (not `edit_prompt_content`)
   - Call `update_prompt(name="my-prompt", content="New template...", arguments=[...])`
   - Safer for major rewrites - avoids string matching issues

6. "Update my prompt's tags"
   - Call `update_prompt(name="my-prompt", tags=["new-tag", "another-tag"])`
   - Tags fully replace existing tags, so include all tags you want

7. "Search for prompts about code review"
   - Call `search_prompts(query="code review")` to find matching prompts
   - Response includes prompt_length and prompt_preview for each result

8. "What tags do I have?"
   - Call `list_tags()` to see all tags with usage counts

9. "What prompts does this user have?"
   - Call `get_context()` to get an overview of their prompts, tags, filters, and recent activity

10. "Show me prompts from my Development filter"
   - Call `list_filters()` to find the filter ID
   - Call `search_prompts(filter_id="<uuid>")` to get prompts matching that filter

Prompt naming: lowercase with hyphens (e.g., `code-review`, `meeting-notes`).
Argument naming: lowercase with underscores (e.g., `code_to_review`, `article_text`).
Template syntax: Jinja2 with {{ variable_name }} placeholders.
