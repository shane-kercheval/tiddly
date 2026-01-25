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
- `search_prompts`: Search prompts with filters. Returns prompt_length and prompt_preview.
- `get_prompt_template`: Get full template content and arguments for viewing/editing
- `get_prompt_metadata`: Get metadata only (prompt_length, prompt_preview) - use for size check
- `create_prompt`: Create a new prompt template with Jinja2 content
- `edit_prompt_template`: Edit template using string replacement for targeted edits
- `update_prompt`: Update metadata (title, description, tags, name) and/or fully replace content and arguments.
  Use `edit_prompt_template` instead for targeted string-based edits.
  **Important:** If updating content that changes template variables ({{ var }}), you MUST also provide the full arguments list.
- `list_tags`: Get all tags with usage counts

Note: There is no delete tool. Prompts can only be deleted via the web UI.

**Optimistic Locking:**
All mutation tools return `updated_at` in their response. Use `expected_updated_at` parameter on
`update_prompt` to prevent concurrent edit conflicts. If the prompt was modified after this timestamp,
returns a conflict error with `server_state` containing the current version for resolution.

**When to use get_prompt_metadata vs get_prompt_template:**
- Use `get_prompt_metadata` first to check prompt_length before loading large templates
- Use `get_prompt_template` when you need the full content for viewing or editing

Example workflows:

1. "Create a prompt for summarizing articles"
   - Call `create_prompt` tool with:
     - name: "summarize-article"
     - content: "Summarize the following article:\\n\\n{{ article_text }}\\n\\nProvide..."
     - arguments: [{"name": "article_text", "description": "To summarize", "required": true}]

2. "Fix a typo in my code-review prompt"
   - Call `get_prompt_template(name="code-review")` to see current content
   - Call `edit_prompt_template(name="code-review", old_str="teh code", new_str="the code")`

3. "Add a new variable to my prompt"
   - When adding {{ new_var }} to the template, you must also add its argument definition
   - Call `edit_prompt_template` with BOTH the content change AND the updated arguments list:
     - old_str: "Review this code:"
     - new_str: "Review this {{ language }} code:"
     - arguments: [...existing args..., {"name": "language", "description": "Lang"}]
   - The arguments list REPLACES all existing arguments, so include the ones you want to keep

4. "Remove a variable from my prompt"
   - Similarly, remove from both content and arguments in one call
   - Omit the removed argument from the arguments list

5. "Search for prompts about code review"
   - Call `search_prompts(query="code review")` to find matching prompts
   - Response includes prompt_length and prompt_preview for each result

6. "What tags do I have?"
   - Call `list_tags()` to see all tags with usage counts

Prompt naming: lowercase with hyphens (e.g., `code-review`, `meeting-notes`).
Argument naming: lowercase with underscores (e.g., `code_to_review`, `article_text`).
Template syntax: Jinja2 with {{ variable_name }} placeholders.
""".strip(),
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
            name="search_prompts",
            description=(
                "Search prompts with filters. Returns metadata including prompt_length "
                "and prompt_preview (first 500 chars) for size assessment before fetching "
                "full content. Use this for discovery before get_prompt_template."
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
                },
                "required": [],
            },
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
            name="get_prompt_template",
            description=(
                "Get a prompt template's raw content and arguments for viewing or editing. "
                "Unlike the MCP get_prompt capability which renders templates with arguments, "
                "this returns the raw Jinja2 template content. Use this before edit_prompt_template "  # noqa: E501
                "to see the current content and construct the old_str for string replacement."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": (
                            "The prompt name (e.g., 'code-review'). "
                            "Get names from list_prompts."
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
                "Get a prompt's metadata without the template content. "
                "Returns name, title, description, arguments, tags, prompt_length, "
                "and prompt_preview. Use to check size or arguments before fetching template."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": (
                            "The prompt name (e.g., 'code-review'). "
                            "Get names from list_prompts or search_prompts."
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
            name="edit_prompt_template",
            description=(
                "Edit a prompt template's content using string replacement. Use get_prompt_template "  # noqa: E501
                "first to see the current content and construct the old_str. Optional parameter to "  # noqa: E501
                "update arguments atomically when adding/removing template variables. Note that "
                "updating arguments is required when editing template text that adds or removes "
                "variables, to avoid validation errors"
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": (
                            "The prompt name (e.g., 'code-review'). "
                            "Get names from list_prompts."
                        ),
                    },
                    "old_str": {
                        "type": "string",
                        "minLength": 1,
                        "description": (
                            "Exact text to find in the prompt content. Must match exactly "
                            "one location. Include 3-5 lines of surrounding context for uniqueness."  # noqa: E501
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
                "Update a prompt. All parameters are optional - only provide the fields you want "
                "to change (at least one required). Can update metadata (title, description, tags, name) "
                "and/or fully replace template content and arguments. "
                "NOTE: To make partial/targeted edits to the template using string replacement, "
                "use edit_prompt_template instead. This tool replaces the entire content field."
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
                            "Use lowercase-with-hyphens format."
                        ),
                    },
                    "content": {
                        "type": "string",
                        "description": (
                            "New template content (FULL REPLACEMENT of entire template). Omit to leave unchanged. "
                            "IMPORTANT: If your new content changes template variables ({{ var }}), you MUST also "
                            "provide the arguments parameter with ALL arguments defined."
                        ),
                    },
                    "arguments": {
                        "type": "array",
                        "description": (
                            "New arguments list (FULL REPLACEMENT - not a merge). Omit to leave unchanged. "
                            "IMPORTANT: If provided, you must include ALL arguments, not just changed ones. "
                            "This completely replaces the existing arguments list."
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
                            "For optimistic locking. If provided and the prompt was modified after this timestamp, "
                            "returns a conflict error with the current server state. Use the updated_at from a previous response."
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
        "search_prompts": lambda args: _handle_search_prompts(args),
        "list_tags": lambda _: _handle_list_tags(),
        "get_prompt_template": lambda args: _handle_get_prompt_template(args),
        "get_prompt_metadata": lambda args: _handle_get_prompt_metadata(args),
        "create_prompt": lambda args: _handle_create_prompt(args),
        "edit_prompt_template": lambda args: _handle_edit_prompt_template(args),
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


async def _handle_search_prompts(
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


async def _handle_get_prompt_template(
    arguments: dict[str, Any],
) -> list[types.TextContent]:
    """
    Handle get_prompt_template tool call.

    Fetches a prompt by name and returns the raw template content and metadata as JSON.
    This allows agents to inspect the template before editing.
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
        "tags": prompt.get("tags", []),
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


async def _handle_create_prompt(arguments: dict[str, Any]) -> list[types.TextContent]:
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

    return [
        types.TextContent(
            type="text",
            text=f"Created prompt '{result['name']}' (ID: {result['id']})",
        ),
    ]


async def _handle_edit_prompt_template(
    arguments: dict[str, Any],
) -> list[types.TextContent] | types.CallToolResult:
    """
    Handle edit_prompt_template tool call.

    Performs string replacement on prompt content via the name-based str-replace API endpoint.
    Optionally updates arguments atomically with content changes.

    Returns:
        - list[types.TextContent] for success (SDK wraps with isError=False)
        - types.CallToolResult with isError=True for tool execution errors (400s)

    Error handling note:
        This server uses the low-level MCP SDK, which allows returning
        CallToolResult(isError=True) per MCP spec for tool execution errors
        (no_match, multiple_matches). This differs from Content MCP which uses
        FastMCP and cannot set isError=True due to SDK limitations.

        Both approaches return the same structured JSON error data; the difference
        is only in the isError flag. See implementation plan appendix for rationale.
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
                    error_text = json.dumps(error_detail)
                else:
                    # String error (e.g., template validation)
                    error_text = json.dumps({
                        "error": "validation_error",
                        "message": str(error_detail),
                    })
                return types.CallToolResult(
                    content=[types.TextContent(type="text", text=error_text)],
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
    match_type = result.get("match_type", "exact")
    line = result.get("line", 0)
    data = result.get("data", {})
    prompt_id = data.get("id", "")

    return [
        types.TextContent(
            type="text",
            text=f"Updated prompt '{prompt_name}' (ID: {prompt_id}, match: {match_type} at line {line})",  # noqa: E501
        ),
    ]


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

    # Validate at least one data field is provided (expected_updated_at is a control parameter)
    data_fields = ["new_name", "title", "description", "tags", "content", "arguments"]
    if not any(k in arguments for k in data_fields):
        raise McpError(
            types.ErrorData(
                code=types.INVALID_PARAMS,
                message="At least one of new_name, title, description, tags, content, or arguments must be provided",
            ),
        )

    client = get_http_client()
    token = _get_token()

    # Build payload - only include fields that were provided
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
    payload = {field_mapping[k]: arguments[k] for k in field_mapping if k in arguments}

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


