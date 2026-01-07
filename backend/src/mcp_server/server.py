"""
FastMCP server for the Bookmarks API.

MCP Tool Annotation Reference (from MCP Specification 2025-03-26):

    readOnlyHint (bool, default: False)
        If true, the tool does not modify its environment.

    destructiveHint (bool, default: True)
        If true, the tool may perform destructive updates to its environment.
        If false, the tool performs only additive updates.
        Only meaningful when readOnlyHint is False.

    idempotentHint (bool, default: False)
        If true, calling the tool repeatedly with the same arguments
        will have no additional effect on its environment.
        Only meaningful when readOnlyHint is False.

    openWorldHint (bool, default: True)
        If true, this tool may interact with an "open world" of external entities.
        If false, the tool's domain of interaction is closed.
        Example: a web search tool is open, a memory tool is not.

Note: Clients MUST treat annotations as untrusted hints unless the server
is explicitly trusted. These inform UI/UX decisions, not security enforcement.
"""

from typing import Annotated, Any, Literal, NoReturn

import httpx
from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import Field

from .api_client import api_get, api_post, get_api_base_url, get_default_timeout
from .auth import AuthenticationError, get_bearer_token

mcp = FastMCP(
    name="Bookmarks MCP Server",
    instructions="""
A content manager for saving and organizing bookmarks and notes.
Supports full-text search, tagging, and markdown notes.

Available tools:

**Bookmarks:**
- `search_bookmarks`: Search bookmarks by text query and/or filter by tags
- `get_bookmark`: Get full details of a specific bookmark by ID
- `create_bookmark`: Save a new URL (metadata auto-fetched if not provided)

**Notes:**
- `search_notes`: Search notes by text query and/or filter by tags
- `get_note`: Get full details of a specific note by ID (includes content)
- `create_note`: Create a new note with markdown content

**Unified:**
- `search_all_content`: Search across both bookmarks and notes in one query
- `list_tags`: Get all tags with usage counts (shared across content types)

Example workflows:

1. "Show me my reading list" or "What articles do I have saved?"
   - First call `list_tags()` to discover the user's tag taxonomy
   - Identify relevant tags (e.g., `reading-list`, `articles`, `to-read`)
   - Call `search_bookmarks(tags=["reading-list"])` to filter by that tag

2. "Find my Python tutorials"
   - Call `search_bookmarks(query="python tutorial")` for text search, or
   - Call `list_tags()` first, then `search_bookmarks(tags=["python", "tutorial"])`

3. "Save this article: <url>"
   - Call `create_bookmark(url="<url>", tags=["articles"])`
   - Title/description are auto-fetched if not provided

4. "What notes do I have about the project?"
   - Call `search_notes(query="project")` for text search
   - And/or filter by tag: `search_notes(tags=["project"])`

5. "Create a meeting note"
   - Call `create_note(title="Meeting Notes", content="## Attendees\\n...", tags=["meeting"])`

6. "Search my content for Python resources"
   - Call `search_all_content(query="python")` to search both bookmarks and notes

Tags are lowercase with hyphens (e.g., `machine-learning`, `to-read`).
""".strip(),
)


# Module-level client for connection reuse (can be overridden in tests)
_http_client: httpx.AsyncClient | None = None


async def _get_http_client() -> httpx.AsyncClient:
    """Get or create the HTTP client for API requests."""
    global _http_client  # noqa: PLW0603
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            base_url=get_api_base_url(),
            timeout=get_default_timeout(),
        )
    return _http_client


def _get_token() -> str:
    """Get Bearer token, raising ToolError on failure."""
    try:
        return get_bearer_token()
    except AuthenticationError as e:
        raise ToolError(str(e))


def _handle_api_error(e: httpx.HTTPStatusError, context: str = "") -> NoReturn:
    """Translate API errors to meaningful MCP ToolErrors. Always raises."""
    status = e.response.status_code

    if status == 401:
        raise ToolError("Invalid or expired token")
    if status == 403:
        raise ToolError("Access denied")

    # Try to extract detailed error message from API response
    try:
        detail = e.response.json().get("detail", {})
        if isinstance(detail, dict):
            message = detail.get("message", str(detail))
            error_code = detail.get("error_code", "")
            if error_code:
                raise ToolError(f"{message} (code: {error_code})")
            raise ToolError(message)
        raise ToolError(str(detail))
    except (ValueError, KeyError):
        raise ToolError(f"API error {status}{': ' + context if context else ''}")


@mcp.tool(
    description=(
        "Search bookmarks with optional text query and tag filtering. "
        "Returns active bookmarks only."
    ),
    annotations={"readOnlyHint": True},
)
async def search_bookmarks(
    query: Annotated[
        str | None,
        Field(description="Text to search in title, URL, description, and content"),
    ] = None,
    tags: Annotated[list[str] | None, Field(description="Filter by tags")] = None,
    tag_match: Annotated[
        Literal["all", "any"],
        Field(description="Tag matching: 'all' requires ALL tags, 'any' requires ANY tag"),
    ] = "all",
    sort_by: Annotated[
        Literal["created_at", "updated_at", "last_used_at", "title"],
        Field(description="Field to sort by"),
    ] = "created_at",
    sort_order: Annotated[Literal["asc", "desc"], Field(description="Sort direction")] = "desc",
    limit: Annotated[int, Field(ge=1, le=100, description="Maximum results to return")] = 50,
    offset: Annotated[
        int, Field(ge=0, description="Number of results to skip for pagination"),
    ] = 0,
) -> dict[str, Any]:
    """
    Search and filter bookmarks.

    Examples:
    - Search for "python": query="python"
    - Filter by tag: tags=["programming"]
    - Combine: query="tutorial", tags=["python", "beginner"], tag_match="all"
    """
    client = await _get_http_client()
    token = _get_token()

    params: dict[str, Any] = {
        "limit": limit,
        "offset": offset,
        "tag_match": tag_match,
        "sort_by": sort_by,
        "sort_order": sort_order,
    }
    if query:
        params["q"] = query
    if tags:
        params["tags"] = tags

    try:
        return await api_get(client, "/bookmarks/", token, params)
    except httpx.HTTPStatusError as e:
        _handle_api_error(e, "searching bookmarks")
        raise  # Unreachable but satisfies type checker
    except httpx.RequestError as e:
        raise ToolError(f"API unavailable: {e}")


@mcp.tool(
    description=(
        "Search notes with optional text query and tag filtering. "
        "Returns active notes only."
    ),
    annotations={"readOnlyHint": True},
)
async def search_notes(
    query: Annotated[
        str | None,
        Field(description="Text to search in title, description, and content"),
    ] = None,
    tags: Annotated[list[str] | None, Field(description="Filter by tags")] = None,
    tag_match: Annotated[
        Literal["all", "any"],
        Field(description="Tag matching: 'all' requires ALL tags, 'any' requires ANY tag"),
    ] = "all",
    sort_by: Annotated[
        Literal["created_at", "updated_at", "last_used_at", "title"],
        Field(description="Field to sort by"),
    ] = "created_at",
    sort_order: Annotated[Literal["asc", "desc"], Field(description="Sort direction")] = "desc",
    limit: Annotated[int, Field(ge=1, le=100, description="Maximum results to return")] = 50,
    offset: Annotated[
        int, Field(ge=0, description="Number of results to skip for pagination"),
    ] = 0,
) -> dict[str, Any]:
    """
    Search and filter notes.

    Examples:
    - Search for "meeting": query="meeting"
    - Filter by tag: tags=["work"]
    - Combine: query="project", tags=["work", "important"], tag_match="all"
    """
    client = await _get_http_client()
    token = _get_token()

    params: dict[str, Any] = {
        "limit": limit,
        "offset": offset,
        "tag_match": tag_match,
        "sort_by": sort_by,
        "sort_order": sort_order,
    }
    if query:
        params["q"] = query
    if tags:
        params["tags"] = tags

    try:
        return await api_get(client, "/notes/", token, params)
    except httpx.HTTPStatusError as e:
        _handle_api_error(e, "searching notes")
        raise
    except httpx.RequestError as e:
        raise ToolError(f"API unavailable: {e}")


@mcp.tool(
    description=(
        "Search across all content types (bookmarks and notes) with unified results. "
        "Returns active content only. Each item has a 'type' field."
    ),
    annotations={"readOnlyHint": True},
)
async def search_all_content(
    query: Annotated[
        str | None,
        Field(description="Text to search in title, description, URL (bookmarks), and content"),
    ] = None,
    tags: Annotated[list[str] | None, Field(description="Filter by tags")] = None,
    tag_match: Annotated[
        Literal["all", "any"],
        Field(description="Tag matching: 'all' requires ALL tags, 'any' requires ANY tag"),
    ] = "all",
    sort_by: Annotated[
        Literal["created_at", "updated_at", "last_used_at", "title"],
        Field(description="Field to sort by"),
    ] = "created_at",
    sort_order: Annotated[Literal["asc", "desc"], Field(description="Sort direction")] = "desc",
    limit: Annotated[int, Field(ge=1, le=100, description="Maximum results to return")] = 50,
    offset: Annotated[
        int, Field(ge=0, description="Number of results to skip for pagination"),
    ] = 0,
) -> dict[str, Any]:
    """
    Unified search across bookmarks and notes.

    Returns items with a 'type' field ("bookmark" or "note").
    Bookmark items include 'url', note items include 'version'.

    Examples:
    - Search all content: query="python"
    - Filter by tags across all types: tags=["work"]
    """
    client = await _get_http_client()
    token = _get_token()

    params: dict[str, Any] = {
        "limit": limit,
        "offset": offset,
        "tag_match": tag_match,
        "sort_by": sort_by,
        "sort_order": sort_order,
    }
    if query:
        params["q"] = query
    if tags:
        params["tags"] = tags

    try:
        return await api_get(client, "/content/", token, params)
    except httpx.HTTPStatusError as e:
        _handle_api_error(e, "searching content")
        raise
    except httpx.RequestError as e:
        raise ToolError(f"API unavailable: {e}")


@mcp.tool(
    description="Get the full details of a specific bookmark including stored content",
    annotations={"readOnlyHint": True},
)
async def get_bookmark(
    bookmark_id: Annotated[str, Field(description="The UUID of the bookmark to retrieve")],
) -> dict[str, Any]:
    """Get a bookmark by ID. Returns full details including content if stored."""
    client = await _get_http_client()
    token = _get_token()

    try:
        return await api_get(client, f"/bookmarks/{bookmark_id}", token)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise ToolError(f"Bookmark with ID {bookmark_id} not found")
        _handle_api_error(e, f"getting bookmark {bookmark_id}")
        raise
    except httpx.RequestError as e:
        raise ToolError(f"API unavailable: {e}")


@mcp.tool(
    description="Get the full details of a specific note including content",
    annotations={"readOnlyHint": True},
)
async def get_note(
    note_id: Annotated[str, Field(description="The UUID of the note to retrieve")],
) -> dict[str, Any]:
    """Get a note by ID. Returns full details including markdown content."""
    client = await _get_http_client()
    token = _get_token()

    try:
        return await api_get(client, f"/notes/{note_id}", token)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise ToolError(f"Note with ID {note_id} not found")
        _handle_api_error(e, f"getting note {note_id}")
        raise
    except httpx.RequestError as e:
        raise ToolError(f"API unavailable: {e}")


@mcp.tool(
    description="Create a new bookmark.",
    annotations={"readOnlyHint": False, "destructiveHint": False},
)
async def create_bookmark(
    url: Annotated[str, Field(description="The URL to bookmark")],
    title: Annotated[str | None, Field(description="Bookmark title")] = None,
    description: Annotated[str | None, Field(description="Bookmark description")] = None,
    tags: Annotated[
        list[str] | None,
        Field(description="Tags to assign (lowercase with hyphens, e.g., 'machine-learning')"),
    ] = None,
) -> dict[str, Any]:
    """Create a new bookmark."""
    client = await _get_http_client()
    token = _get_token()

    payload: dict[str, Any] = {"url": url}
    if title is not None:
        payload["title"] = title
    if description is not None:
        payload["description"] = description
    if tags is not None:
        payload["tags"] = tags

    try:
        return await api_post(client, "/bookmarks/", token, payload)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 409:
            # Extract rich error details for duplicate URL
            try:
                detail = e.response.json().get("detail", {})
                error_code = detail.get("error_code", "")
                if error_code == "ARCHIVED_URL_EXISTS":
                    bookmark_id = detail.get("existing_bookmark_id")
                    raise ToolError(
                        f"An archived bookmark exists with this URL (ID: {bookmark_id}). "
                        "Use the web UI to restore or permanently delete it first.",
                    )
                raise ToolError("A bookmark with this URL already exists")
            except (ValueError, KeyError, TypeError):
                raise ToolError("A bookmark with this URL already exists")
        _handle_api_error(e, "creating bookmark")
        raise
    except httpx.RequestError as e:
        raise ToolError(f"API unavailable: {e}")


@mcp.tool(
    description="Create a new note.",
    annotations={"readOnlyHint": False, "destructiveHint": False},
)
async def create_note(
    title: Annotated[str, Field(description="The note title (required)")],
    description: Annotated[str | None, Field(description="Short description/summary")] = None,
    content: Annotated[str | None, Field(description="Markdown content of the note")] = None,
    tags: Annotated[
        list[str] | None,
        Field(description="Tags to assign (lowercase with hyphens, e.g., 'meeting-notes')"),
    ] = None,
) -> dict[str, Any]:
    """Create a new note with optional markdown content."""
    client = await _get_http_client()
    token = _get_token()

    payload: dict[str, Any] = {"title": title}
    if description is not None:
        payload["description"] = description
    if content is not None:
        payload["content"] = content
    if tags is not None:
        payload["tags"] = tags

    try:
        return await api_post(client, "/notes/", token, payload)
    except httpx.HTTPStatusError as e:
        _handle_api_error(e, "creating note")
        raise
    except httpx.RequestError as e:
        raise ToolError(f"API unavailable: {e}")


@mcp.tool(
    description="List all tags with their usage counts",
    annotations={"readOnlyHint": True},
)
async def list_tags() -> dict[str, Any]:
    """
    Get all tags for the authenticated user.

    Returns tags sorted by usage count (most used first), then alphabetically.
    Includes tags with zero active bookmarks.
    """
    client = await _get_http_client()
    token = _get_token()

    try:
        return await api_get(client, "/tags/", token)
    except httpx.HTTPStatusError as e:
        _handle_api_error(e, "listing tags")
        raise
    except httpx.RequestError as e:
        raise ToolError(f"API unavailable: {e}")
