"""
MCP Server for Prompt templates.

Exposes user prompts via MCP prompts capability, allowing AI assistants
to list and use prompt templates. Also provides a create_prompt tool
for creating new prompts via AI.
"""

import asyncio
import json
import logging
from typing import Any, NoReturn

import httpx
from mcp import types
from mcp.server.lowlevel import Server
from mcp.shared.exceptions import McpError

from shared.api_errors import ParsedApiError, parse_http_error
from shared.mcp_format import format_filter_expression

from .api_client import api_get, api_patch, api_post, get_api_base_url, get_default_timeout
from .auth import AuthenticationError, get_bearer_token
from services.template_renderer import TemplateError, render_template

logger = logging.getLogger(__name__)

# Create the MCP server
server = Server(
    "prompt-mcp-server",
    instructions="""
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
- `edit_prompt_content`: Edit template using string replacement. Use for targeted changes (small or large)
  where you can identify specific text to replace. More efficient than replacing the entire template.
  Examples: fix typo, add/remove a paragraph, rename a variable.
- `update_prompt`: Update metadata (title, description, tags, name) and/or fully replace template.
  Use for metadata changes, or when rewriting/restructuring most of the content.
  Safer for major rewrites (avoids whitespace/formatting matching issues).
  Examples: complete rewrite, change prompt's purpose, update tags.
  **Important:** If updating template that changes variables ({{ var }}), you MUST also provide the full arguments list.
- `list_tags`: Get all tags with usage counts

Note: There is no delete tool. Prompts can only be deleted via the web UI.

**Optimistic Locking:**
All mutation tools return `updated_at` in their response. Use `expected_updated_at` parameter on
`update_prompt` to prevent concurrent edit conflicts. If the prompt was modified after this timestamp,
returns a conflict error with `server_state` containing the current version for resolution.

**When to use get_prompt_metadata vs get_prompt_content:**
- Use `get_prompt_metadata` to check prompt_length before loading large templates
- Use `get_prompt_content` when you need the template and arguments for viewing or editing

Example workflows:

1. "Create a prompt for summarizing articles"
   - Call `create_prompt` tool with:
     - name: "summarize-article"
     - content: "Summarize the following article:\\n\\n{{ article_text }}\\n\\nProvide..."
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
""".strip(),  # noqa: E501
)

# Module-level client for connection reuse
# Initialized by init_http_client() in lifespan, closed by cleanup()
_http_client: httpx.AsyncClient | None = None

# Background tasks set to prevent garbage collection
_background_tasks: set[asyncio.Task] = set()


async def init_http_client() -> None:
    """
    Initialize the HTTP client for API requests.

    Called by the lifespan handler in main.py at startup.
    This ensures the client is ready before any requests arrive.
    """
    global _http_client  # noqa: PLW0603
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            base_url=get_api_base_url(),
            timeout=get_default_timeout(),
        )


async def cleanup() -> None:
    """
    Clean up resources on shutdown.

    Closes the HTTP client and cancels any pending background tasks.
    Called by the lifespan handler in main.py.
    """
    global _http_client  # noqa: PLW0603

    # Close HTTP client
    if _http_client is not None and not _http_client.is_closed:
        await _http_client.aclose()
        _http_client = None

    # Cancel pending background tasks
    for task in list(_background_tasks):
        if not task.done():
            task.cancel()
    _background_tasks.clear()


def get_http_client() -> httpx.AsyncClient:
    """
    Get the HTTP client for API requests.

    The client must be initialized by init_http_client() before use.
    Raises RuntimeError if called before initialization.
    """
    if _http_client is None or _http_client.is_closed:
        raise RuntimeError(
            "HTTP client not initialized. Call init_http_client() first.",
        )
    return _http_client


def _get_token() -> str:
    """Get Bearer token, raising McpError on failure."""
    try:
        return get_bearer_token()
    except AuthenticationError as e:
        raise McpError(
            types.ErrorData(
                code=types.INVALID_REQUEST,
                message=str(e),
            ),
        ) from e


# MCP error codes for each error category
_MCP_ERROR_CODES = {
    "auth": types.INVALID_REQUEST,
    "forbidden": types.INVALID_REQUEST,
    "not_found": types.INVALID_PARAMS,
    "validation": types.INVALID_PARAMS,
    "conflict_modified": types.INVALID_PARAMS,  # Handled via _make_conflict_result() instead
    "conflict_name": types.INVALID_PARAMS,
    "internal": types.INTERNAL_ERROR,
}


def _raise_mcp_error(info: ParsedApiError) -> NoReturn:
    """Raise McpError from parsed API error. Always raises."""
    raise McpError(
        types.ErrorData(
            code=_MCP_ERROR_CODES[info.category],
            message=info.message,
        ),
    )


def _make_conflict_result(info: ParsedApiError) -> types.CallToolResult:
    """Create CallToolResult for conflict_modified errors."""
    error_data = {
        "error": "conflict",
        "message": info.message,
        "server_state": info.server_state,
    }
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=json.dumps(error_data, indent=2))],
        structuredContent=error_data,
        isError=True,
    )


# Page size for list_prompts pagination (API maximum is 100)
_LIST_PROMPTS_PAGE_SIZE = 100


@server.list_prompts()
async def handle_list_prompts(
    request: types.ListPromptsRequest,
) -> types.ListPromptsResult:
    """
    List available prompts for the authenticated user.

    Queries the REST API each time (dynamic, no cache).
    Supports cursor-based pagination per MCP spec.
    Cursor is the offset value as a string.
    """
    client = get_http_client()
    token = _get_token()

    # Parse cursor as offset (cursor is opaque to client, we use offset)
    cursor = request.params.cursor if request.params else None
    try:
        offset = int(cursor) if cursor else 0
    except ValueError:
        raise McpError(
            types.ErrorData(
                code=types.INVALID_PARAMS,
                message=f"Invalid cursor: {cursor}",
            ),
        ) from None

    try:
        result = await api_get(
            client,
            "/prompts/",
            token,
            params={"limit": _LIST_PROMPTS_PAGE_SIZE, "offset": offset},
        )
    except httpx.HTTPStatusError as e:
        _raise_mcp_error(parse_http_error(e))
    except httpx.RequestError as e:
        raise McpError(
            types.ErrorData(
                code=types.INTERNAL_ERROR,
                message=f"API unavailable: {e}",
            ),
        ) from e

    # Convert API response to MCP Prompt objects
    prompts = []
    for item in result.get("items", []):
        # Convert arguments to MCP PromptArgument format
        arguments = [
            types.PromptArgument(
                name=arg["name"],
                description=arg.get("description"),
                required=arg.get("required") or False,
            )
            for arg in item.get("arguments", [])
        ]

        prompts.append(
            types.Prompt(
                name=item["name"],
                title=item.get("title"),
                description=item.get("description"),
                arguments=arguments if arguments else None,
            ),
        )

    # Calculate next cursor if more results exist
    has_more = result.get("has_more", False)
    next_cursor = str(offset + _LIST_PROMPTS_PAGE_SIZE) if has_more else None

    return types.ListPromptsResult(
        prompts=prompts,
        nextCursor=next_cursor,
    )


@server.get_prompt()
async def handle_get_prompt(
    name: str,
    arguments: dict[str, str] | None,
) -> types.GetPromptResult:
    """
    Get and render a prompt by name.

    Fetches the prompt from the API, renders the Jinja2 template
    with provided arguments, and tracks usage (fire-and-forget).
    """
    client = get_http_client()
    token = _get_token()

    # Fetch prompt by name
    try:
        prompt = await api_get(client, f"/prompts/name/{name}", token)
    except httpx.HTTPStatusError as e:
        _raise_mcp_error(parse_http_error(e, entity_type="prompt", entity_name=name))
    except httpx.RequestError as e:
        raise McpError(
            types.ErrorData(
                code=types.INTERNAL_ERROR,
                message=f"API unavailable: {e}",
            ),
        ) from e

    # Render template with arguments
    try:
        rendered_content = render_template(
            content=prompt.get("content"),
            arguments=arguments,
            defined_args=prompt.get("arguments", []),
        )
    except TemplateError as e:
        raise McpError(
            types.ErrorData(
                code=types.INVALID_PARAMS,
                message=str(e),
            ),
        ) from e

    # Track usage (fire-and-forget - don't await)
    prompt_id = prompt["id"]
    task = asyncio.create_task(_track_usage(client, token, prompt_id))
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    return types.GetPromptResult(
        description=prompt.get("description"),
        messages=[
            types.PromptMessage(
                role="user",
                content=types.TextContent(
                    type="text",
                    text=rendered_content,
                ),
            ),
        ],
    )


async def _track_usage(
    client: httpx.AsyncClient,
    token: str,
    prompt_id: str,
) -> None:
    """Track prompt usage (fire-and-forget helper)."""
    try:
        await api_post(client, f"/prompts/{prompt_id}/track-usage", token)
    except Exception as e:
        # Log but don't fail - tracking is best-effort
        logger.warning("Failed to track prompt usage for %s: %s", prompt_id, e)


@server.list_tools()
async def handle_list_tools() -> list[types.Tool]:
    """List available tools."""
    return [
        types.Tool(
            name="get_context",
            description=(
                "Get a summary of the user's prompts. "
                "Use this at the START of a session to understand: "
                "what prompts the user has (counts), how prompts are organized "
                "(tags, filters in priority order), what's inside each filter "
                "(top prompts per filter), and what prompts the user frequently uses "
                "(recently used, created, modified). "
                "Results reflect a point-in-time snapshot. Call once at session start; re-calling "
                "is only useful if the user significantly creates, modifies, or reorganizes "
                "content during the session. "
                "Returns a markdown summary optimized for quick understanding. Use prompt "
                "names from the response with get_prompt_content for full templates. "
                "Use tag names with search_prompts to find related prompts."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "tag_limit": {
                        "type": "integer",
                        "default": 50,
                        "minimum": 1,
                        "maximum": 100,
                        "description": "Number of top tags",
                    },
                    "recent_limit": {
                        "type": "integer",
                        "default": 10,
                        "minimum": 1,
                        "maximum": 50,
                        "description": "Recent prompts per category",
                    },
                    "filter_limit": {
                        "type": "integer",
                        "default": 5,
                        "minimum": 0,
                        "maximum": 20,
                        "description": "Max filters to include",
                    },
                    "filter_item_limit": {
                        "type": "integer",
                        "default": 5,
                        "minimum": 1,
                        "maximum": 20,
                        "description": "Items per filter",
                    },
                },
                "required": [],
            },
            annotations=types.ToolAnnotations(readOnlyHint=True),
        ),
        types.Tool(
            name="search_prompts",
            description=(
                "Search prompts with filters. Returns metadata including prompt_length "
                "and prompt_preview (first 500 chars) for size assessment before fetching "
                "the template. Use for discovery before get_prompt_content."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": (
                            "Text to search in name, title, description, and content. "
                            "Omit to list all prompts."
                        ),
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Filter by tags (lowercase with hyphens)",
                    },
                    "tag_match": {
                        "type": "string",
                        "enum": ["all", "any"],
                        "description": (
                            "'all' requires ALL tags (default), 'any' requires ANY tag"
                        ),
                    },
                    "sort_by": {
                        "type": "string",
                        "enum": ["created_at", "updated_at", "last_used_at", "title"],
                        "description": "Field to sort by (default: created_at)",
                    },
                    "sort_order": {
                        "type": "string",
                        "enum": ["asc", "desc"],
                        "description": "Sort direction (default: desc)",
                    },
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 100,
                        "description": "Maximum results to return (default: 50)",
                    },
                    "offset": {
                        "type": "integer",
                        "minimum": 0,
                        "description": "Number of results to skip for pagination",
                    },
                    "filter_id": {
                        "type": "string",
                        "description": (
                            "Filter by content filter ID (UUID). "
                            "Use list_filters to discover filter IDs."
                        ),
                    },
                },
                "required": [],
            },
        ),
        types.Tool(
            name="list_filters",
            description=(
                "List filters relevant to prompts. "
                "Filters are saved views with tag-based rules. Use filter IDs with "
                "search_prompts(filter_id=...) to search within a specific filter. "
                "Returns filter ID, name, content types, and the tag-based filter expression."
            ),
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
            annotations=types.ToolAnnotations(readOnlyHint=True),
        ),
        types.Tool(
            name="list_tags",
            description="List all tags with their usage counts across prompts.",
            inputSchema={
                "type": "object",
                "properties": {},
                "required": [],
            },
        ),
        types.Tool(
            name="get_prompt_content",
            description=(
                "Get a prompt's Jinja2 template and arguments for viewing or editing. "
                "Returns the raw template text AND the argument definitions list. "
                "Supports partial reads via start_line/end_line for large templates; "
                "response includes content_metadata with total_lines and is_partial flag. "
                "Use get_prompt_metadata first to check prompt_length before loading large templates."  # noqa: E501
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": (
                            "The prompt name (e.g., 'code-review'). "
                            "Use search_prompts if you need to discover prompt names."
                        ),
                    },
                    "start_line": {
                        "type": "integer",
                        "minimum": 1,
                        "description": "Start line for partial read (1-indexed). Optional.",
                    },
                    "end_line": {
                        "type": "integer",
                        "minimum": 1,
                        "description": (
                            "End line for partial read (1-indexed, inclusive). Optional."
                        ),
                    },
                },
                "required": ["name"],
            },
        ),
        types.Tool(
            name="get_prompt_metadata",
            description=(
                "Get a prompt's metadata without the template. "
                "Returns name, title, description, arguments, tags, prompt_length, "
                "and prompt_preview. Use to check size before fetching with get_prompt_content."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": (
                            "The prompt name (e.g., 'code-review'). "
                            "Use search_prompts if you need to discover prompt names."
                        ),
                    },
                },
                "required": ["name"],
            },
        ),
        types.Tool(
            name="create_prompt",
            description=(
                "Create a new prompt template. Prompts are Jinja2 templates with "
                "defined arguments that can be used as reusable templates for AI "
                "interactions."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": (
                            "Prompt identifier (lowercase with hyphens, e.g., 'code-review'). "
                            "Must be unique for your account."
                        ),
                    },
                    "title": {
                        "type": "string",
                        "description": (
                            "Optional human-readable display name "
                            "(e.g., 'Code Review Assistant')"
                        ),
                    },
                    "description": {
                        "type": "string",
                        "description": "Optional description of what the prompt does",
                    },
                    "content": {
                        "type": "string",
                        "description": (
                            "The prompt template text (required field). "
                            "Can be plain text or use Jinja2 syntax: "
                            "{{ variable_name }} for placeholders, "
                            "{% if var %}...{% endif %} for conditionals, "
                            "{% for x in items %}...{% endfor %} for loops, "
                            "{{ text|upper }} for filters. "
                            "Variables must be defined in the arguments list. "
                            "Undefined variables cause errors."
                        ),
                    },
                    "arguments": {
                        "type": "array",
                        "description": "List of argument definitions for the template",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {
                                    "type": "string",
                                    "description": (
                                        "Argument name (lowercase with underscores, "
                                        "e.g., 'code_to_review'). "
                                        "Must be a valid Python/Jinja2 identifier."
                                    ),
                                },
                                "description": {
                                    "type": "string",
                                    "description": "Description of the argument",
                                },
                                "required": {
                                    "type": "boolean",
                                    "description": (
                                        "Whether this argument is required "
                                        "(default: false, optional args default to empty string)"
                                    ),
                                },
                            },
                            "required": ["name"],
                        },
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Optional tags for categorization (lowercase with hyphens)",
                    },
                },
                "required": ["name", "content"],
            },
        ),
        types.Tool(
            name="edit_prompt_content",
            description=(
                "Edit a prompt's template and arguments using string replacement. "
                "Use when: making targeted changes (small or large) where you can identify "
                "specific text to replace; adding, removing, or modifying a section while "
                "keeping the rest unchanged. More efficient than replacing the entire template. "
                "Examples: fix a typo, add a paragraph, remove a section, rename a variable. "
                "Use get_prompt_content first to see the current template and construct old_str. "
                "When adding/removing template variables, you must also update the arguments list "
                "(it replaces all existing arguments, so include the ones you want to keep). "
                "Fails with structured error if old_str matches 0 or multiple locations."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": (
                            "The prompt name (e.g., 'code-review'). "
                            "Use search_prompts if you need to discover prompt names."
                        ),
                    },
                    "old_str": {
                        "type": "string",
                        "minLength": 1,
                        "description": (
                            "Exact text to find in the template. Must match exactly one location. "
                            "If not found, returns no_match error (whitespace normalization is "
                            "automatic). If multiple matches, returns multiple_matches error with "
                            "line numbers and context to help construct a unique match."
                        ),
                    },
                    "new_str": {
                        "type": "string",
                        "description": (
                            "Replacement text. Use empty string to delete the matched text."
                        ),
                    },
                    "arguments": {
                        "type": "array",
                        "description": (
                            "Only include when adding, removing, or renaming template variables. "
                            "Do NOT include for simple text edits (typos, wording) - omitting "
                            "preserves existing arguments automatically. If provided, this list "
                            "FULLY REPLACES all current arguments (not a merge)."
                        ),
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {
                                    "type": "string",
                                    "description": "Argument name (lowercase with underscores)",
                                },
                                "description": {
                                    "type": "string",
                                    "description": "Description of the argument",
                                },
                                "required": {
                                    "type": "boolean",
                                    "description": "Whether this argument is required",
                                },
                            },
                            "required": ["name"],
                        },
                    },
                },
                "required": ["name", "old_str", "new_str"],
            },
        ),
        types.Tool(
            name="update_prompt",
            description=(
                "Update a prompt's metadata and/or fully replace template content. "
                "Use when: updating metadata (title, description, tags, name); "
                "rewriting/restructuring where most content changes; changes are extensive "
                "enough that finding old_str is impractical. Safer for major rewrites "
                "(avoids whitespace/formatting matching issues). "
                "Examples: complete template rewrite, change prompt's purpose, update tags. "
                "For targeted changes where you can identify specific text to replace, "
                "use edit_prompt_content instead (more efficient). "
                "All parameters are optional - only provide fields you want to change "
                "(at least one required)."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": (
                            "Current prompt name (e.g., 'code-review'). "
                            "Get names from list_prompts."
                        ),
                    },
                    "new_name": {
                        "type": "string",
                        "description": (
                            "New name for the prompt (optional). "
                            "Must be unique and lowercase-with-hyphens."
                        ),
                    },
                    "title": {
                        "type": "string",
                        "description": "New human-readable title (optional).",
                    },
                    "description": {
                        "type": "string",
                        "description": "New description (optional).",
                    },
                    "tags": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": (
                            "New tags list (optional). Replaces all existing tags. "
                            "Use lowercase-with-hyphens format. "
                            "If tags aren't changing, omit to preserve existing tags."
                        ),
                    },
                    "content": {
                        "type": "string",
                        "description": (
                            "New template content (FULL REPLACEMENT of entire template). Omit to leave unchanged. "  # noqa: E501
                            "IMPORTANT: If your new content changes template variables ({{ var }}), you MUST also "  # noqa: E501
                            "provide the arguments parameter with ALL arguments defined."
                        ),
                    },
                    "arguments": {
                        "type": "array",
                        "description": (
                            "New arguments list (FULL REPLACEMENT). "
                            "Omit if template variables ({{ var }}) aren't changing - "
                            "existing arguments are preserved automatically. "
                            "Only provide when adding, removing, or renaming variables. "
                            "If provided, must include ALL arguments (replaces entire list)."
                        ),
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {
                                    "type": "string",
                                    "description": "Argument name (lowercase with underscores)",
                                },
                                "description": {
                                    "type": "string",
                                    "description": "Description of the argument",
                                },
                                "required": {
                                    "type": "boolean",
                                    "description": "Whether this argument is required",
                                },
                            },
                            "required": ["name"],
                        },
                    },
                    "expected_updated_at": {
                        "type": "string",
                        "description": (
                            "For optimistic locking. If provided and the prompt was modified after this timestamp, "  # noqa: E501
                            "returns a conflict error with the current server state. Use the updated_at from a previous response."  # noqa: E501
                        ),
                    },
                },
                "required": ["name"],
            },
        ),
    ]


@server.call_tool()
async def handle_call_tool(
    name: str,
    arguments: dict[str, Any] | None,
) -> list[types.TextContent] | types.CallToolResult:
    """Handle tool calls."""
    # Dispatch table for tool handlers
    handlers = {
        "get_context": lambda args: _handle_get_context(args),
        "search_prompts": lambda args: _handle_search_prompts(args),
        "list_filters": lambda _: _handle_list_filters(),
        "list_tags": lambda _: _handle_list_tags(),
        "get_prompt_content": lambda args: _handle_get_prompt_content(args),
        "get_prompt_metadata": lambda args: _handle_get_prompt_metadata(args),
        "create_prompt": lambda args: _handle_create_prompt(args),
        "edit_prompt_content": lambda args: _handle_edit_prompt_content(args),
        "update_prompt": lambda args: _handle_update_prompt(args),
    }

    handler = handlers.get(name)
    if handler is None:
        raise McpError(
            types.ErrorData(
                code=types.INVALID_PARAMS,
                message=f"Unknown tool: {name}",
            ),
        )

    return await handler(arguments or {})


async def _handle_search_prompts(  # noqa: PLR0912
    arguments: dict[str, Any],
) -> list[types.TextContent]:
    """
    Handle search_prompts tool call.

    Searches prompts with filters and returns metadata including
    content_length and content_preview for size assessment.
    """
    client = get_http_client()
    token = _get_token()

    # Build query params
    params: dict[str, Any] = {}
    if "query" in arguments:
        params["q"] = arguments["query"]
    if "tags" in arguments:
        params["tags"] = arguments["tags"]
    if "tag_match" in arguments:
        params["tag_match"] = arguments["tag_match"]
    if "sort_by" in arguments:
        params["sort_by"] = arguments["sort_by"]
    if "sort_order" in arguments:
        params["sort_order"] = arguments["sort_order"]
    if "limit" in arguments:
        params["limit"] = arguments["limit"]
    if "offset" in arguments:
        params["offset"] = arguments["offset"]
    if "filter_id" in arguments:
        params["filter_id"] = arguments["filter_id"]

    try:
        result = await api_get(client, "/prompts/", token, params if params else None)
    except httpx.HTTPStatusError as e:
        _raise_mcp_error(parse_http_error(e))
    except httpx.RequestError as e:
        raise McpError(
            types.ErrorData(
                code=types.INTERNAL_ERROR,
                message=f"API unavailable: {e}",
            ),
        ) from e

    # Translate API field names for semantic clarity in Prompt MCP:
    # content_length → prompt_length, content_preview → prompt_preview
    for item in result.get("items", []):
        if "content_length" in item:
            item["prompt_length"] = item.pop("content_length")
        if "content_preview" in item:
            item["prompt_preview"] = item.pop("content_preview")

    return [
        types.TextContent(
            type="text",
            text=json.dumps(result, indent=2, default=str),
        ),
    ]


async def _handle_list_filters() -> list[types.TextContent]:
    """Handle list_filters tool call. Returns filters relevant to prompts."""
    client = get_http_client()
    token = _get_token()

    try:
        result = await api_get(client, "/filters/", token)
    except httpx.HTTPStatusError as e:
        _raise_mcp_error(parse_http_error(e))
    except httpx.RequestError as e:
        raise McpError(
            types.ErrorData(
                code=types.INTERNAL_ERROR,
                message=f"API unavailable: {e}",
            ),
        ) from e

    # Only include filters relevant to prompts
    filtered = [f for f in result if "prompt" in f.get("content_types", [])]

    return [
        types.TextContent(
            type="text",
            text=json.dumps({"filters": filtered}, indent=2, default=str),
        ),
    ]


async def _handle_list_tags() -> list[types.TextContent]:
    """
    Handle list_tags tool call.

    Returns all tags with usage counts for prompts.
    """
    client = get_http_client()
    token = _get_token()

    try:
        result = await api_get(client, "/tags/", token)
    except httpx.HTTPStatusError as e:
        _raise_mcp_error(parse_http_error(e))
    except httpx.RequestError as e:
        raise McpError(
            types.ErrorData(
                code=types.INTERNAL_ERROR,
                message=f"API unavailable: {e}",
            ),
        ) from e

    return [
        types.TextContent(
            type="text",
            text=json.dumps(result, indent=2),
        ),
    ]


async def _handle_get_prompt_content(
    arguments: dict[str, Any],
) -> list[types.TextContent]:
    """
    Handle get_prompt_content tool call.

    Fetches a prompt by name and returns the raw template content and arguments as JSON.
    This allows agents to inspect the prompt before editing.
    Supports optional start_line/end_line for partial reads.
    """
    # Validate required parameter
    prompt_name = arguments.get("name", "")
    if not prompt_name:
        raise McpError(
            types.ErrorData(
                code=types.INVALID_PARAMS,
                message="Missing required parameter: name",
            ),
        )

    client = get_http_client()
    token = _get_token()

    # Build query params for partial read
    params: dict[str, Any] = {}
    if "start_line" in arguments:
        params["start_line"] = arguments["start_line"]
    if "end_line" in arguments:
        params["end_line"] = arguments["end_line"]

    try:
        prompt = await api_get(
            client,
            f"/prompts/name/{prompt_name}",
            token,
            params if params else None,
        )
    except httpx.HTTPStatusError as e:
        _raise_mcp_error(parse_http_error(e, entity_type="prompt", entity_name=prompt_name))
    except httpx.RequestError as e:
        raise McpError(
            types.ErrorData(
                code=types.INTERNAL_ERROR,
                message=f"API unavailable: {e}",
            ),
        ) from e

    # Return raw template data as JSON for agent parsing
    response_data = {
        "id": prompt.get("id"),
        "name": prompt.get("name"),
        "title": prompt.get("title"),
        "description": prompt.get("description"),
        "content": prompt.get("content"),
        "arguments": prompt.get("arguments", []),
    }

    # Include content_metadata if present (for partial reads)
    if prompt.get("content_metadata"):
        response_data["content_metadata"] = prompt["content_metadata"]

    return [
        types.TextContent(
            type="text",
            text=json.dumps(response_data, indent=2),
        ),
    ]


async def _handle_get_prompt_metadata(
    arguments: dict[str, Any],
) -> list[types.TextContent]:
    """
    Handle get_prompt_metadata tool call.

    Fetches a prompt's metadata by name without the full content.
    Returns content_length and content_preview for size assessment.
    """
    # Validate required parameter
    prompt_name = arguments.get("name", "")
    if not prompt_name:
        raise McpError(
            types.ErrorData(
                code=types.INVALID_PARAMS,
                message="Missing required parameter: name",
            ),
        )

    client = get_http_client()
    token = _get_token()

    try:
        prompt = await api_get(client, f"/prompts/name/{prompt_name}/metadata", token)
    except httpx.HTTPStatusError as e:
        _raise_mcp_error(parse_http_error(e, entity_type="prompt", entity_name=prompt_name))
    except httpx.RequestError as e:
        raise McpError(
            types.ErrorData(
                code=types.INTERNAL_ERROR,
                message=f"API unavailable: {e}",
            ),
        ) from e

    # Return metadata as JSON
    # Translate API field names for semantic clarity in Prompt MCP:
    # content_length → prompt_length, content_preview → prompt_preview
    response_data = {
        "id": prompt.get("id"),
        "name": prompt.get("name"),
        "title": prompt.get("title"),
        "description": prompt.get("description"),
        "arguments": prompt.get("arguments", []),
        "tags": prompt.get("tags", []),
        "prompt_length": prompt.get("content_length"),
        "prompt_preview": prompt.get("content_preview"),
    }

    return [
        types.TextContent(
            type="text",
            text=json.dumps(response_data, indent=2),
        ),
    ]


async def _handle_create_prompt(arguments: dict[str, Any]) -> types.CallToolResult:
    """Handle create_prompt tool call."""
    client = get_http_client()
    token = _get_token()

    # Build payload for API
    payload: dict[str, Any] = {"name": arguments.get("name", "")}

    if "title" in arguments:
        payload["title"] = arguments["title"]
    if "description" in arguments:
        payload["description"] = arguments["description"]
    if "content" in arguments:
        payload["content"] = arguments["content"]
    if "arguments" in arguments:
        payload["arguments"] = arguments["arguments"]
    if "tags" in arguments:
        payload["tags"] = arguments["tags"]

    try:
        result = await api_post(client, "/prompts/", token, payload)
    except httpx.HTTPStatusError as e:
        _raise_mcp_error(parse_http_error(e))
    except httpx.RequestError as e:
        raise McpError(
            types.ErrorData(
                code=types.INTERNAL_ERROR,
                message=f"API unavailable: {e}",
            ),
        ) from e

    response_data = {
        "id": result.get("id"),
        "name": result.get("name"),
        "updated_at": result.get("updated_at"),
        "summary": f"Created prompt '{result['name']}'",
    }
    return types.CallToolResult(
        content=[types.TextContent(
            type="text",
            text=json.dumps(response_data, indent=2),
        )],
        structuredContent=response_data,
    )


async def _handle_edit_prompt_content(
    arguments: dict[str, Any],
) -> types.CallToolResult:
    """
    Handle edit_prompt_content tool call.

    Performs string replacement on prompt content via the name-based str-replace API endpoint.
    Optionally updates arguments atomically with content changes.

    Returns:
        CallToolResult with structuredContent containing {id, name, updated_at, match_type,
        line, summary} on success, or {error, message, ...} with isError=True for tool
        execution errors (400s like no_match, multiple_matches).

    Error handling note:
        This server uses the low-level MCP SDK, which allows returning
        CallToolResult(isError=True) per MCP spec for tool execution errors.
        This differs from Content MCP which uses FastMCP and cannot set isError=True
        due to SDK limitations.
    """
    # Validate required parameters first (before accessing HTTP client/token)
    prompt_name = arguments.get("name", "")
    if not prompt_name:
        raise McpError(
            types.ErrorData(
                code=types.INVALID_PARAMS,
                message="Missing required parameter: name",
            ),
        )

    old_str = arguments.get("old_str", "")
    if not old_str:
        raise McpError(
            types.ErrorData(
                code=types.INVALID_PARAMS,
                message="Missing required parameter: old_str",
            ),
        )

    new_str = arguments.get("new_str")
    if new_str is None:
        raise McpError(
            types.ErrorData(
                code=types.INVALID_PARAMS,
                message="Missing required parameter: new_str",
            ),
        )

    client = get_http_client()
    token = _get_token()

    # Build payload
    payload: dict[str, Any] = {"old_str": old_str, "new_str": new_str}
    if "arguments" in arguments:
        payload["arguments"] = arguments["arguments"]

    try:
        result = await api_patch(
            client, f"/prompts/name/{prompt_name}/str-replace", token, payload,
        )
    except httpx.HTTPStatusError as e:
        # Return tool execution errors with isError=True per MCP spec for 400.
        # This allows the LLM to see and handle the error (e.g., retry with
        # different parameters). Uses JSON format for AI parseability.
        if e.response.status_code == 400:
            try:
                error_detail = e.response.json().get("detail", {})
                if isinstance(error_detail, dict):
                    error_data = error_detail
                else:
                    # String error (e.g., template validation)
                    error_data = {
                        "error": "validation_error",
                        "message": str(error_detail),
                    }
                error_text = json.dumps(error_data, indent=2)
                return types.CallToolResult(
                    content=[types.TextContent(type="text", text=error_text)],
                    structuredContent=error_data,
                    isError=True,
                )
            except (ValueError, KeyError):
                pass
        _raise_mcp_error(parse_http_error(e, entity_type="prompt", entity_name=prompt_name))
    except httpx.RequestError as e:
        raise McpError(
            types.ErrorData(
                code=types.INTERNAL_ERROR,
                message=f"API unavailable: {e}",
            ),
        ) from e

    # Success response
    # API returns: {response_type, match_type, line, data: {id, name, updated_at, ...}}
    # match_type and line are at top level; entity fields are nested in data
    match_type = result.get("match_type", "exact")
    line = result.get("line", 0)
    data = result.get("data", {})

    response_data = {
        "id": data.get("id"),
        "name": data.get("name", prompt_name),
        "updated_at": data.get("updated_at"),
        "match_type": match_type,
        "line": line,
        "summary": f"Updated prompt '{prompt_name}' (match: {match_type} at line {line})",
    }
    return types.CallToolResult(
        content=[types.TextContent(
            type="text",
            text=json.dumps(response_data, indent=2),
        )],
        structuredContent=response_data,
    )


async def _handle_update_prompt(
    arguments: dict[str, Any],
) -> types.CallToolResult:
    """
    Handle update_prompt tool call.

    Updates prompt metadata (title, description, tags, name) and/or fully replaces
    content and arguments via the name-based PATCH endpoint.

    Returns CallToolResult with structuredContent for programmatic parsing.
    """
    # Validate required parameter
    prompt_name = arguments.get("name", "")
    if not prompt_name:
        raise McpError(
            types.ErrorData(
                code=types.INVALID_PARAMS,
                message="Missing required parameter: name",
            ),
        )

    # Validate at least one data field is provided with a non-None value
    # (expected_updated_at is a control parameter, not a data field)
    data_fields = ["new_name", "title", "description", "tags", "content", "arguments"]
    if not any(k in arguments and arguments[k] is not None for k in data_fields):
        raise McpError(
            types.ErrorData(
                code=types.INVALID_PARAMS,
                message="At least one of new_name, title, description, tags, content, or arguments must be provided",  # noqa: E501
            ),
        )

    client = get_http_client()
    token = _get_token()

    # Build payload - only include fields that were provided with non-None values
    # Map new_name -> name for the API (PromptUpdate schema uses 'name' for the new name)
    field_mapping = {
        "new_name": "name",
        "title": "title",
        "description": "description",
        "tags": "tags",
        "content": "content",
        "arguments": "arguments",
        "expected_updated_at": "expected_updated_at",
    }
    payload = {
        field_mapping[k]: arguments[k]
        for k in field_mapping
        if k in arguments and arguments[k] is not None
    }

    try:
        result = await api_patch(
            client, f"/prompts/name/{prompt_name}", token, payload,
        )
    except httpx.HTTPStatusError as e:
        info = parse_http_error(e, entity_type="prompt", entity_name=prompt_name)
        if info.category == "conflict_modified":
            return _make_conflict_result(info)
        _raise_mcp_error(info)
    except httpx.RequestError as e:
        raise McpError(
            types.ErrorData(
                code=types.INTERNAL_ERROR,
                message=f"API unavailable: {e}",
            ),
        ) from e

    # Success response - build summary of what was updated
    updated_name = result.get("name", prompt_name)
    updates = [f"renamed to '{updated_name}'"] if "new_name" in arguments else []
    # Exclude expected_updated_at from summary (it's a control parameter, not a data update)
    data_fields = ["title", "description", "tags", "content", "arguments"]
    updates.extend(f"{k} updated" for k in data_fields if k in arguments)

    summary = ", ".join(updates) if updates else "no changes"

    response_data = {
        "id": result.get("id"),
        "name": result.get("name"),
        "updated_at": result.get("updated_at"),
        "summary": summary,
    }
    return types.CallToolResult(
        content=[types.TextContent(
            type="text",
            text=json.dumps(response_data, indent=2),
        )],
        structuredContent=response_data,
    )


async def _handle_get_context(
    arguments: dict[str, Any],
) -> list[types.TextContent]:
    """
    Handle get_context tool call.

    Calls the prompt context API endpoint and returns a markdown summary.
    """
    client = get_http_client()
    token = _get_token()

    params: dict[str, Any] = {}
    for key in ("tag_limit", "recent_limit", "filter_limit", "filter_item_limit"):
        if key in arguments:
            params[key] = arguments[key]

    try:
        data = await api_get(client, "/mcp/context/prompts", token, params if params else None)
    except httpx.HTTPStatusError as e:
        _raise_mcp_error(parse_http_error(e))
    except httpx.RequestError as e:
        raise McpError(
            types.ErrorData(
                code=types.INTERNAL_ERROR,
                message=f"API unavailable: {e}",
            ),
        ) from e

    markdown = _format_prompt_context_markdown(data)
    return [types.TextContent(type="text", text=markdown)]


_TIME_LABELS: dict[str, str] = {
    "last_used_at": "Last used",
    "created_at": "Created",
    "updated_at": "Modified",
}


def _format_prompt_context_markdown(data: dict[str, Any]) -> str:
    """Convert prompt context API response to markdown."""
    lines: list[str] = []
    seen_ids: set[str] = set()

    lines.append("# Prompt Context")
    lines.append("")
    lines.append(f"Generated: {data['generated_at']}")

    _append_prompt_overview(lines, data)
    _append_prompt_tags(lines, data)

    filters = data.get("filters", [])
    _append_prompt_filters(lines, filters)
    _append_prompt_sidebar(lines, data)
    _append_prompt_filter_contents(lines, filters, seen_ids)
    _append_prompt_recent_sections(lines, data, seen_ids)

    return "\n".join(lines)


def _append_prompt_overview(
    lines: list[str], data: dict[str, Any],
) -> None:
    """Append overview counts section."""
    lines.append("")
    lines.append("## Overview")
    counts = data["counts"]
    lines.append(
        f"- **Prompts:** {counts['active']} active, {counts['archived']} archived",
    )


def _append_prompt_tags(
    lines: list[str], data: dict[str, Any],
) -> None:
    """Append top tags table section."""
    if not data.get("top_tags"):
        return
    lines.append("")
    lines.append("## Top Tags")
    lines.append(
        "Tags are used to categorize prompts. A tag referenced by any"
        " filter indicates it is important to the user's workflow.",
    )
    lines.append("")
    lines.append("| Tag | Prompts | Filters |")
    lines.append("|----|---------|---------|")
    for tag in data["top_tags"]:
        lines.append(
            f"| {tag['name']} | {tag['content_count']}"
            f" | {tag['filter_count']} |",
        )
    lines.append("")


def _append_prompt_filters(
    lines: list[str], filters: list[dict[str, Any]],
) -> None:
    """Append filter definitions section."""
    if not filters:
        return
    lines.append("")
    lines.append("## Filters")
    lines.append(
        "Filters are custom saved views the user has created to organize"
        " their prompts. They define tag-based rules to surface specific"
        " prompts. Filters are listed below in the user's preferred order,"
        " which reflects their priority. Tags within a group are combined"
        " with AND (all must match). Groups are combined with the group"
        " operator (OR = any group matches).",
    )
    lines.append("")
    for i, f in enumerate(filters, 1):
        content_types = ", ".join(f["content_types"])
        rule = format_filter_expression(f["filter_expression"])
        lines.append(
            f"{i}. **{f['name']}** `[filter {f['id']}]`"
            f" ({content_types})",
        )
        lines.append(f"   Tag rules: `{rule}`")
        lines.append("")


def _append_prompt_sidebar(
    lines: list[str], data: dict[str, Any],
) -> None:
    """Append sidebar organization section."""
    sidebar_items = data.get("sidebar_items", [])
    if not sidebar_items:
        return

    lines.append("## Sidebar Organization")
    lines.append(
        "This shows only user-created custom filters. Built-in views"
        " (e.g. 'All Prompts') are not listed here."
        " Prompts may exist outside any custom filter."
        " Collections are a visual grouping mechanism for organizing"
        " filters in the sidebar and have no effect on search or"
        " filtering behavior.",
    )
    lines.append("")

    for item in sidebar_items:
        if item.get("type") == "collection":
            lines.append(f"- [collection] {item['name']}")
            for child in item.get("items", []):
                lines.append(f"  - {child['name']} `[filter {child['id']}]`")
        else:
            lines.append(f"- {item['name']} `[filter {item['id']}]`")
    lines.append("")


def _append_prompt_filter_contents(
    lines: list[str],
    filters: list[dict[str, Any]],
    seen_ids: set[str],
) -> None:
    """Append filter contents with top prompts per filter."""
    if not filters:
        return
    lines.append("## Filter Contents")
    lines.append(
        "Top items from each filter, in sidebar order. Items already"
        " shown in a previous filter are abbreviated.",
    )
    lines.append("")
    for f in filters:
        lines.append(f"### {f['name']}")
        items = f.get("items", [])
        if not items:
            lines.append("(no items)")
            lines.append("")
            continue
        for j, item in enumerate(items, 1):
            item_id = str(item["id"])
            if item_id in seen_ids:
                _append_abbreviated_prompt(lines, j, item)
            else:
                seen_ids.add(item_id)
                _append_prompt_lines(lines, j, item)
        lines.append("")


def _append_prompt_recent_sections(
    lines: list[str],
    data: dict[str, Any],
    seen_ids: set[str],
) -> None:
    """Append recently used/created/modified sections."""
    sections = [
        ("recently_used", "Recently Used", "last_used_at"),
        ("recently_created", "Recently Created", "created_at"),
        ("recently_modified", "Recently Modified", "updated_at"),
    ]
    for section_key, section_title, time_field in sections:
        items = data.get(section_key, [])
        if not items:
            continue
        lines.append(f"## {section_title}")
        for j, item in enumerate(items, 1):
            item_id = str(item["id"])
            if item_id in seen_ids:
                _append_abbreviated_prompt(
                    lines, j, item, time_field=time_field,
                )
            else:
                seen_ids.add(item_id)
                _append_prompt_lines(
                    lines, j, item, extra_time_field=time_field,
                )
        lines.append("")


def _append_abbreviated_prompt(
    lines: list[str],
    index: int,
    item: dict[str, Any],
    time_field: str | None = None,
) -> None:
    """Append an abbreviated prompt reference (already shown elsewhere)."""
    name = item.get("name", "unknown")
    title = item.get("title")
    header = f"{index}. **{name}**"
    if title:
        header += f' — "{title}"'
    lines.append(header)
    if time_field:
        ts = item.get(time_field, "")
        if ts:
            label = _TIME_LABELS.get(time_field, time_field)
            lines.append(f"   {label}: {ts}")
    lines.append("   (see above)")


def _append_prompt_lines(
    lines: list[str],
    index: int,
    item: dict[str, Any],
    extra_time_field: str | None = None,
) -> None:
    """Append formatted prompt lines to the output."""
    name = item.get("name", "unknown")
    title = item.get("title")
    header = f"{index}. **{name}**"
    if title:
        header += f' — "{title}"'
    lines.append(header)

    if extra_time_field:
        ts = item.get(extra_time_field)
        if ts:
            label = _TIME_LABELS.get(extra_time_field, extra_time_field)
            lines.append(f"   {label}: {ts}")

    tags = item.get("tags", [])
    if tags:
        lines.append(f"   Tags: {', '.join(tags)}")

    desc = item.get("description")
    if desc:
        lines.append(f"   Description: {desc}")

    # Format arguments
    arguments = item.get("arguments", [])
    if arguments:
        arg_parts = []
        for arg in arguments:
            arg_str = f"`{arg['name']}`"
            if arg.get("required"):
                arg_str += " (required)"
            arg_parts.append(arg_str)
        lines.append(f"   Args: {', '.join(arg_parts)}")

    preview = item.get("content_preview")
    if preview:
        lines.append(f"   Preview: {preview}")
