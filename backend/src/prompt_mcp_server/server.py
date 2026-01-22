"""
MCP Server for Prompt templates.

Exposes user prompts via MCP prompts capability, allowing AI assistants
to list and use prompt templates. Also provides a create_prompt tool
for creating new prompts via AI.
"""

import asyncio
import json
import logging
from typing import Any

import httpx
from mcp import types
from mcp.server.lowlevel import Server
from mcp.shared.exceptions import McpError

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

Available capabilities:

**Prompts (MCP prompts capability):**
- `list_prompts`: List all saved prompt templates with their arguments
- `get_prompt`: Render a prompt template by name with provided arguments

**Tools:**
- `search_prompts`: Search prompts with filters. Returns prompt_length and prompt_preview.
- `list_tags`: Get all tags with usage counts
- `get_prompt_template`: Get raw template content and arguments for viewing/editing
- `get_prompt_metadata`: Get metadata without full content (prompt_length, prompt_preview)
- `create_prompt`: Create a new prompt template with Jinja2 content
- `edit_prompt_template`: Edit template content using string replacement
- `update_prompt_metadata`: Update title, description, tags, or rename a prompt

Note: There is no delete tool. Prompts can only be deleted via the web UI.

Example workflows:

1. "What prompts do I have?"
   - Use `list_prompts` to see all available templates

2. "Use my code-review prompt for this Python file"
   - Call `get_prompt(name="code-review", arguments={"code": "<file contents>"})`
   - The rendered template is returned as user message content

3. "Create a prompt for summarizing articles"
   - Call `create_prompt` tool with:
     - name: "summarize-article"
     - content: "Summarize the following article:\\n\\n{{ article_text }}\\n\\nProvide..."
     - arguments: [{"name": "article_text", "description": "To summarize", "required": true}]

4. "Fix a typo in my code-review prompt"
   - Call `get_prompt_template(name="code-review")` to see current content
   - Call `edit_prompt_template(name="code-review", old_str="teh code", new_str="the code")`

5. "Add a new variable to my prompt"
   - When adding {{ new_var }} to the template, you must also add its argument definition
   - Call `edit_prompt_template` with BOTH the content change AND the updated arguments list:
     - old_str: "Review this code:"
     - new_str: "Review this {{ language }} code:"
     - arguments: [...existing args..., {"name": "language", "description": "Lang"}]
   - The arguments list REPLACES all existing arguments, so include the ones you want to keep

6. "Remove a variable from my prompt"
   - Similarly, remove from both content and arguments in one call
   - Omit the removed argument from the arguments list

7. "Search for prompts about code review"
   - Call `search_prompts(query="code review")` to find matching prompts
   - Response includes prompt_length and prompt_preview for each result

8. "What tags do I have?"
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


def _handle_api_error(e: httpx.HTTPStatusError, context: str = "") -> None:
    """Translate API errors to MCP errors. Always raises."""
    status = e.response.status_code

    if status == 401:
        raise McpError(
            types.ErrorData(
                code=types.INVALID_REQUEST,
                message="Invalid or expired token",
            ),
        ) from e

    if status == 403:
        raise McpError(
            types.ErrorData(
                code=types.INVALID_REQUEST,
                message="Access denied",
            ),
        ) from e

    if status == 404:
        raise McpError(
            types.ErrorData(
                code=types.INVALID_PARAMS,
                message=f"Not found{': ' + context if context else ''}",
            ),
        ) from e

    # Handle validation errors (400 Bad Request, 422 Unprocessable Entity)
    if status in (400, 422):
        try:
            detail = e.response.json().get("detail", "Validation error")
            if isinstance(detail, dict):
                message = detail.get("message", str(detail))
            elif isinstance(detail, list):
                # FastAPI validation errors return a list
                message = "; ".join(
                    f"{err.get('loc', ['unknown'])[-1]}: {err.get('msg', 'invalid')}"
                    for err in detail
                    if isinstance(err, dict)
                ) or "Validation error"
            else:
                message = str(detail)
        except (ValueError, KeyError):
            message = "Validation error"
        raise McpError(
            types.ErrorData(
                code=types.INVALID_PARAMS,
                message=message,
            ),
        ) from e

    # Try to extract detailed error message from API response
    try:
        detail = e.response.json().get("detail", {})
        if isinstance(detail, dict):
            message = detail.get("message", str(detail))
            raise McpError(
                types.ErrorData(
                    code=types.INTERNAL_ERROR,
                    message=message,
                ),
            ) from e
        raise McpError(
            types.ErrorData(
                code=types.INTERNAL_ERROR,
                message=str(detail),
            ),
        ) from e
    except (ValueError, KeyError):
        raise McpError(
            types.ErrorData(
                code=types.INTERNAL_ERROR,
                message=f"API error {status}{': ' + context if context else ''}",
            ),
        ) from e


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
        _handle_api_error(e, "listing prompts")
        raise  # Unreachable but satisfies type checker
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
        if e.response.status_code == 404:
            raise McpError(
                types.ErrorData(
                    code=types.INVALID_PARAMS,
                    message=f"Prompt '{name}' not found",
                ),
            ) from e
        _handle_api_error(e, f"fetching prompt '{name}'")
        raise
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
            name="update_prompt_metadata",
            description=(
                "Update a prompt's metadata (title, description, tags, or name). "
                "To edit template content or arguments, use edit_prompt_template instead."
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
        "update_prompt_metadata": lambda args: _handle_update_prompt_metadata(args),
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
        _handle_api_error(e, "searching prompts")
        raise
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
        _handle_api_error(e, "listing tags")
        raise
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
        if e.response.status_code == 404:
            raise McpError(
                types.ErrorData(
                    code=types.INVALID_PARAMS,
                    message=f"Prompt '{prompt_name}' not found",
                ),
            ) from e
        _handle_api_error(e, f"fetching prompt '{prompt_name}'")
        raise
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
        if e.response.status_code == 404:
            raise McpError(
                types.ErrorData(
                    code=types.INVALID_PARAMS,
                    message=f"Prompt '{prompt_name}' not found",
                ),
            ) from e
        _handle_api_error(e, f"fetching metadata for prompt '{prompt_name}'")
        raise
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
        if e.response.status_code == 409:
            # Name conflict
            try:
                detail = e.response.json().get("detail", {})
                message = detail.get("message", "A prompt with this name already exists")
            except (ValueError, KeyError):
                message = "A prompt with this name already exists"
            raise McpError(
                types.ErrorData(
                    code=types.INVALID_PARAMS,
                    message=message,
                ),
            ) from e
        _handle_api_error(e, "creating prompt")
        raise
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
        if e.response.status_code == 404:
            raise McpError(
                types.ErrorData(
                    code=types.INVALID_PARAMS,
                    message=f"Prompt '{prompt_name}' not found",
                ),
            ) from e
        if e.response.status_code == 400:
            # Return tool execution errors with isError=True per MCP spec.
            # This allows the LLM to see and handle the error (e.g., retry with
            # different parameters). Uses JSON format for AI parseability.
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
        _handle_api_error(e, f"editing prompt '{prompt_name}'")
        raise
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


async def _handle_update_prompt_metadata(  # noqa: PLR0912
    arguments: dict[str, Any],
) -> list[types.TextContent]:
    """
    Handle update_prompt_metadata tool call.

    Updates prompt metadata (title, description, tags, name) via the name-based PATCH endpoint.
    Does not update content or arguments - use edit_prompt_template for those.
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

    # Build payload - only include fields that were provided
    # Map new_name -> name for the API (PromptUpdate schema uses 'name' for the new name)
    payload: dict[str, Any] = {}
    if "new_name" in arguments:
        payload["name"] = arguments["new_name"]
    if "title" in arguments:
        payload["title"] = arguments["title"]
    if "description" in arguments:
        payload["description"] = arguments["description"]
    if "tags" in arguments:
        payload["tags"] = arguments["tags"]

    try:
        result = await api_patch(
            client, f"/prompts/name/{prompt_name}", token, payload,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise McpError(
                types.ErrorData(
                    code=types.INVALID_PARAMS,
                    message=f"Prompt '{prompt_name}' not found",
                ),
            ) from e
        if e.response.status_code == 409:
            # Name conflict
            try:
                detail = e.response.json().get("detail", {})
                message = detail.get("message", "A prompt with this name already exists")
            except (ValueError, KeyError):
                message = "A prompt with this name already exists"
            raise McpError(
                types.ErrorData(
                    code=types.INVALID_PARAMS,
                    message=message,
                ),
            ) from e
        _handle_api_error(e, f"updating metadata for prompt '{prompt_name}'")
        raise
    except httpx.RequestError as e:
        raise McpError(
            types.ErrorData(
                code=types.INTERNAL_ERROR,
                message=f"API unavailable: {e}",
            ),
        ) from e

    # Success response
    updated_name = result.get("name", prompt_name)
    prompt_id = result.get("id", "")

    # Build a summary of what was updated
    updates = []
    if "new_name" in arguments:
        updates.append(f"renamed to '{updated_name}'")
    if "title" in arguments:
        updates.append("title updated")
    if "description" in arguments:
        updates.append("description updated")
    if "tags" in arguments:
        updates.append("tags updated")

    summary = ", ".join(updates) if updates else "no changes"

    return [
        types.TextContent(
            type="text",
            text=f"Updated prompt '{prompt_name}' (ID: {prompt_id}): {summary}",
        ),
    ]


