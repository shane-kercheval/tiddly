"""
MCP Server for Prompt templates.

Exposes user prompts via MCP prompts capability, allowing AI assistants
to list and use prompt templates. Also provides a create_prompt tool
for creating new prompts via AI.
"""

import asyncio
import logging
from typing import Any

import httpx
from mcp import types
from mcp.server.lowlevel import Server
from mcp.shared.exceptions import McpError

from .api_client import api_get, api_post, get_api_base_url, get_default_timeout
from .auth import AuthenticationError, get_bearer_token
from .template_renderer import TemplateError, render_template

logger = logging.getLogger(__name__)

# Create the MCP server
server = Server(
    "prompt-mcp-server",
    instructions="""
A prompt template manager for creating and using reusable AI prompts.
Prompts are Jinja2 templates with defined arguments that can be rendered with
user-provided values.

Available capabilities:

**Prompts (MCP prompts capability):**
- `list_prompts`: List all saved prompt templates with their arguments
- `get_prompt`: Render a prompt template by name with provided arguments

**Tools:**
- `create_prompt`: Create a new prompt template with Jinja2 content

Example workflows:

1. "What prompts do I have?"
   - Use `list_prompts` to see all available templates

2. "Use my code-review prompt for this Python file"
   - Call `get_prompt(name="code-review", arguments={"code": "<file contents>"})`
   - The rendered template is returned as user message content

3. "Create a prompt for summarizing articles"
   - Call `create_prompt` tool with:
     - name: "summarize-article"
     - content: "Summarize the following article:\n\n{{ article_text }}\n\nProvide..."
     - arguments: [{"name": "article_text", "description": "The article to summarize", "required": true}]

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
    prompt_id: int,
) -> None:
    """Track prompt usage (fire-and-forget helper)."""
    try:
        await api_post(client, f"/prompts/{prompt_id}/track-usage", token)
    except Exception as e:
        # Log but don't fail - tracking is best-effort
        logger.warning("Failed to track prompt usage for %s: %s", prompt_id, e)


@server.list_tools()
async def handle_list_tools() -> list[types.Tool]:
    """List available tools (create_prompt)."""
    return [
        types.Tool(
            name="create_prompt",
            description=(
                "Create a new prompt template. "
                "Prompts are Jinja2 templates with defined arguments that can be "
                "used as reusable templates for AI interactions."
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
                            "Jinja2 template content (required). Use {{ variable_name }} for "
                            "placeholders. Variables must be defined in the arguments list."
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
                                        "Whether this argument is required (default: false)"
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
    ]


@server.call_tool()
async def handle_call_tool(
    name: str,
    arguments: dict[str, Any] | None,
) -> list[types.TextContent]:
    """Handle tool calls (create_prompt)."""
    if name != "create_prompt":
        raise McpError(
            types.ErrorData(
                code=types.INVALID_PARAMS,
                message=f"Unknown tool: {name}",
            ),
        )

    arguments = arguments or {}
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
