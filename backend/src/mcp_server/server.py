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

from .api_client import api_get, api_patch, api_post, get_api_base_url, get_default_timeout
from .auth import AuthenticationError, get_bearer_token

mcp = FastMCP(
    name="Bookmarks MCP Server",
    instructions="""
A content manager for saving and organizing bookmarks and notes.
Supports full-text search, tagging, markdown notes, and AI-friendly content editing.

Available tools:

**Search:**
- `search_bookmarks`: Search bookmarks by text query and/or filter by tags
- `search_notes`: Search notes by text query and/or filter by tags
- `search_all_content`: Search across both bookmarks and notes in one query
- `list_tags`: Get all tags with usage counts (shared across content types)

**Content (unified for bookmarks and notes):**
- `get_content`: Get a bookmark or note by ID (supports partial reads for large content)
- `edit_content`: Edit content using string replacement (old_str must be unique)
- `search_in_content`: Search within an item's text fields for matches with context

**Create:**
- `create_bookmark`: Save a new URL (metadata auto-fetched if not provided)
- `create_note`: Create a new note with markdown content

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

7. "Edit my meeting note to fix a typo"
   - Call `search_all_content(query="meeting")` to find the note
   - Call `get_content(id="...", type="note")` to read the content
   - Call `search_in_content(id="...", type="note", query="teh")` to find the typo
   - Call `edit_content(id="...", type="note", old_str="teh mistake", new_str="the mistake")`

8. "Update the description in my Python bookmark"
   - Call `search_in_content(id="...", type="bookmark", query="old text")` to verify uniqueness
   - Call `edit_content(id="...", type="bookmark", old_str="old text", new_str="new text")`

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
    description=(
        "Get a bookmark or note by ID. Supports partial reads for large content "
        "via line range params. The 'type' field is available in search results "
        "from search_all_content."
    ),
    annotations={"readOnlyHint": True},
)
async def get_content(
    id: Annotated[str, Field(description="The content item ID (UUID)")],  # noqa: A002
    type: Annotated[  # noqa: A002
        Literal["bookmark", "note"],
        Field(description="Content type: 'bookmark' or 'note'"),
    ],
    start_line: Annotated[
        int | None,
        Field(description="Start line for partial read (1-indexed)"),
    ] = None,
    end_line: Annotated[
        int | None,
        Field(description="End line for partial read (1-indexed, inclusive)"),
    ] = None,
) -> dict[str, Any]:
    """
    Get a bookmark or note by ID.

    Supports partial content reads for large documents:
    - Provide start_line and/or end_line to read a specific range
    - Response includes content_metadata with total_lines and is_partial flag
    - Other fields (title, description, tags) are always returned in full

    Examples:
    - Full read: get_content(id="...", type="note")
    - First 50 lines: get_content(id="...", type="note", end_line=50)
    - Lines 100-150: get_content(id="...", type="note", start_line=100, end_line=150)
    """
    if type not in ("bookmark", "note"):
        raise ToolError(f"Invalid type '{type}'. Must be 'bookmark' or 'note'.")

    client = await _get_http_client()
    token = _get_token()

    endpoint = f"/{type}s/{id}"
    params: dict[str, Any] = {}
    if start_line is not None:
        params["start_line"] = start_line
    if end_line is not None:
        params["end_line"] = end_line

    try:
        return await api_get(client, endpoint, token, params if params else None)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise ToolError(f"{type.title()} with ID {id} not found")
        _handle_api_error(e, f"getting {type} {id}")
        raise
    except httpx.RequestError as e:
        raise ToolError(f"API unavailable: {e}")


@mcp.tool(
    description=(
        "Edit content using string replacement. The old_str must match exactly "
        "one location. Use search_in_content first to verify match uniqueness."
    ),
    annotations={"readOnlyHint": False, "destructiveHint": True},
)
async def edit_content(
    id: Annotated[str, Field(description="The content item ID (UUID)")],  # noqa: A002
    type: Annotated[  # noqa: A002
        Literal["bookmark", "note"],
        Field(description="Content type: 'bookmark' or 'note'"),
    ],
    old_str: Annotated[
        str,
        Field(description="Exact text to find. Include surrounding context for uniqueness."),
    ],
    new_str: Annotated[
        str,
        Field(description="Replacement text. Use empty string to delete the matched text."),
    ],
) -> dict[str, Any]:
    """
    Replace old_str with new_str in the content.

    The edit will fail if old_str matches 0 or multiple locations. On failure,
    the response includes match locations with context to help construct a unique match.

    Tips for successful edits:
    - Use search_in_content first to check how many matches exist
    - Include enough surrounding context in old_str to ensure uniqueness
    - For deletion, use empty string as new_str
    - Whitespace normalization is attempted if exact match fails

    Success response includes:
    - match_type: "exact" or "whitespace_normalized"
    - line: Line number where match was found
    - data: Full updated entity

    Error responses include:
    - no_match: Text not found (check for typos/whitespace)
    - multiple_matches: Multiple locations found (include more context)
    """
    if type not in ("bookmark", "note"):
        raise ToolError(f"Invalid type '{type}'. Must be 'bookmark' or 'note'.")

    client = await _get_http_client()
    token = _get_token()

    endpoint = f"/{type}s/{id}/str-replace"
    payload = {"old_str": old_str, "new_str": new_str}

    try:
        return await api_patch(client, endpoint, token, payload)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise ToolError(f"{type.title()} with ID {id} not found")
        if e.response.status_code == 400:
            # Pass through structured error response (no_match, multiple_matches, content_empty)
            # API errors already have "error": "no_match" etc. as discriminator field
            try:
                error_detail = e.response.json().get("detail", {})
                if isinstance(error_detail, dict):
                    return error_detail
                return {"error": "unknown", "message": str(error_detail)}
            except (ValueError, KeyError):
                pass
        _handle_api_error(e, f"editing {type} {id}")
        raise
    except httpx.RequestError as e:
        raise ToolError(f"API unavailable: {e}")


@mcp.tool(
    description=(
        "Search within a content item's text to find matches with line numbers and context. "
        "Use before editing to verify match uniqueness and build a unique old_str."
    ),
    annotations={"readOnlyHint": True},
)
async def search_in_content(
    id: Annotated[str, Field(description="The content item ID (UUID)")],  # noqa: A002
    type: Annotated[  # noqa: A002
        Literal["bookmark", "note"],
        Field(description="Content type: 'bookmark' or 'note'"),
    ],
    query: Annotated[str, Field(description="Text to search for (literal match)")],
    fields: Annotated[
        str | None,
        Field(description="Fields to search (comma-separated): content, title, description"),
    ] = None,
    case_sensitive: Annotated[
        bool | None,
        Field(description="Case-sensitive search. Default: false"),
    ] = None,
    context_lines: Annotated[
        int | None,
        Field(description="Lines of context before/after each match (0-10). Default: 2"),
    ] = None,
) -> dict[str, Any]:
    """
    Find all occurrences of query text within the item.

    Use this tool before editing to:
    - Check how many matches exist (avoid 'multiple matches' errors)
    - Get surrounding context to build a unique old_str for edit_content
    - Locate specific text within large documents

    Response includes:
    - matches: List of {field, line, context} for each match
    - total_matches: Total number of matches found

    For content field: Returns line number and surrounding context lines.
    For title/description: Returns full field value as context (line is null).
    """
    if type not in ("bookmark", "note"):
        raise ToolError(f"Invalid type '{type}'. Must be 'bookmark' or 'note'.")

    client = await _get_http_client()
    token = _get_token()

    endpoint = f"/{type}s/{id}/search"
    params: dict[str, Any] = {"q": query}
    if fields is not None:
        params["fields"] = fields
    if case_sensitive is not None:
        params["case_sensitive"] = case_sensitive
    if context_lines is not None:
        params["context_lines"] = context_lines

    try:
        return await api_get(client, endpoint, token, params)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            raise ToolError(f"{type.title()} with ID {id} not found")
        _handle_api_error(e, f"searching in {type} {id}")
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
