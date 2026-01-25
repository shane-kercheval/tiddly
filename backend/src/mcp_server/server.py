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

from shared.api_errors import ParsedApiError, parse_http_error

from .api_client import api_get, api_patch, api_post, get_api_base_url, get_default_timeout
from .auth import AuthenticationError, get_bearer_token

mcp = FastMCP(
    name="Bookmarks MCP Server",
    instructions="""
This is the Content MCP server for tiddly.me (also known as "tiddly"). When users mention
tiddly, tiddly.me, or their bookmarks/notes service, they're referring to this system.

This MCP server is a content manager for saving and organizing bookmarks and notes.
Supports full-text search, tagging, markdown notes, and AI-friendly content editing.

## Content Types

- **Bookmarks** have: url, title, description, content (scraped page text or user-provided), tags
- **Notes** have: title, description, content (markdown), tags

The `content` field is the main body text. For bookmarks, it's typically auto-scraped from the
URL but can be user-provided. For notes, it's user-written markdown.

## Tool Naming Convention

- **Item tools** (`search_items`, `get_item`, `update_item`): Operate on bookmark/note entities
- **Content tools** (`edit_content`, `search_in_content`): Operate on the content text field

## Available Tools

**Search** (returns active items only - excludes archived/deleted):
- `search_items`: Search across bookmarks and notes. Use `type` parameter to filter.
- `list_tags`: Get all tags with usage counts

**Read & Edit:**
- `get_item`: Get item by ID. Use `include_content=false` to check size before loading large content.
- `edit_content`: Edit the `content` field using string replacement (NOT title/description)
- `search_in_content`: Search within item's text fields for matches with context

**Update:**
- `update_item`: Update metadata (title, description, tags, url) and/or fully replace content.
  Use `edit_content` instead for targeted string-based edits to content.

**Create:**
- `create_bookmark`: Save a new URL (metadata auto-fetched if not provided)
- `create_note`: Create a new note with markdown content

## Search Response Structure

`search_items` returns:
```
{
  "items": [...],   // List of items with content_length and content_preview
  "total": 150,     // Total matches (for pagination)
  "limit": 50,      // Page size
  "offset": 0,      // Current offset
  "has_more": true  // More results available
}
```

Each item includes: `id`, `title`, `description`, `tags`, `created_at`, `updated_at`,
`content_length`, `content_preview`
- Bookmarks also have: `url`
- Items have: `type` ("bookmark" or "note")

**Note:** Search results include `content_length` and `content_preview` (first 500 chars)
but NOT the full `content` field. Use `get_item(id, type)` to fetch full content.

## Updating Items

- **`update_item`**: Update metadata (title, description, tags, url) and/or fully replace content.
  All parameters are optional - only provide what you want to change (at least one required).
- **`edit_content`**: Make targeted edits to the content field using string replacement.
  Use this for fixing typos, inserting/deleting paragraphs, etc. without rewriting everything.

## Optimistic Locking

All mutation tools (`update_item`, `edit_content`, `create_bookmark`, `create_note`) return
`updated_at` in their response. Use `expected_updated_at` parameter on `update_item` to prevent
concurrent edit conflicts. If the item was modified after this timestamp, returns a conflict
error with `server_state` containing the current version for resolution.

## Limitations

- Delete/archive operations are only available via web UI
- Search returns active items only (not archived or deleted)

## Example Workflows

1. "Show me my reading list"
   - Call `list_tags()` to discover tag taxonomy
   - Call `search_items(tags=["reading-list"])` to filter by tag

2. "Find my Python tutorials"
   - Call `search_items(query="python tutorial", type="bookmark")` for text search

3. "Save this article: <url>"
   - Call `create_bookmark(url="<url>", tags=["articles"])`

4. "Create a meeting note"
   - Call `create_note(title="Meeting Notes", content="## Attendees\\n...", tags=["meeting"])`

5. "Search all my content for Python resources"
   - Call `search_items(query="python")` to search bookmarks and notes

6. "Edit my meeting note to fix a typo"
   - Call `search_items(query="meeting", type="note")` to find the note → get `id` from result
   - Call `get_item(id="<uuid>", type="note")` to read content
   - Call `edit_content(id="<uuid>", type="note", old_str="teh mistake", new_str="the mistake")`

7. "Check size before loading large content"
   - Call `get_item(id="<uuid>", type="note", include_content=false)` to get content_length
   - If small enough, call `get_item(id="<uuid>", type="note")` to get full content

8. "Update a bookmark's tags"
   - Call `update_item(id="<uuid>", type="bookmark", tags=["new-tag", "another"])`

Tags are lowercase with hyphens (e.g., `machine-learning`, `to-read`).
""".strip(),  # noqa: E501
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


def _raise_tool_error(info: ParsedApiError) -> NoReturn:
    """Raise ToolError from parsed API error. Always raises."""
    raise ToolError(info.message)


@mcp.tool(
    description=(
        "Search across bookmarks and notes. By default searches both types. "
        "Use `type` parameter to filter to a specific content type. "
        "Returns metadata including content_length and content_preview (not full content)."
    ),
    annotations={"readOnlyHint": True},
)
async def search_items(
    query: Annotated[
        str | None,
        Field(description="Text to search in title, description, URL (bookmarks), and content"),
    ] = None,
    type: Annotated[  # noqa: A002
        Literal["bookmark", "note"] | None,
        Field(description="Filter by type: 'bookmark' or 'note'. Omit to search both."),
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
    Search and filter bookmarks and/or notes.

    Results include content_length and content_preview for size assessment.
    Use get_item to fetch full content.

    Examples:
    - Search all: query="python"
    - Search bookmarks only: query="python", type="bookmark"
    - Filter by tag: tags=["programming"]
    - Combine: query="tutorial", tags=["python"], type="bookmark"
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

    # Route to appropriate endpoint based on type filter
    if type == "bookmark":
        endpoint = "/bookmarks/"
    elif type == "note":
        endpoint = "/notes/"
    else:
        # Search both types via unified content endpoint.
        # Explicitly filter to bookmarks and notes only - prompts have their own MCP server.
        endpoint = "/content/"
        params["content_types"] = ["bookmark", "note"]

    try:
        return await api_get(client, endpoint, token, params)
    except httpx.HTTPStatusError as e:
        _raise_tool_error(parse_http_error(e))
    except httpx.RequestError as e:
        raise ToolError(f"API unavailable: {e}")


@mcp.tool(
    description=(
        "Get a bookmark or note by ID. By default includes full content. "
        "Use include_content=false to get content_length and content_preview for size assessment "
        "before loading large content."
    ),
    annotations={"readOnlyHint": True},
)
async def get_item(
    id: Annotated[str, Field(description="The item ID (UUID)")],  # noqa: A002
    type: Annotated[  # noqa: A002
        Literal["bookmark", "note"],
        Field(description="Item type: 'bookmark' or 'note'"),
    ],
    include_content: Annotated[
        bool,
        Field(
            description="If true (default), include full content. "
            "If false, returns content_length and content_preview for size assessment.",
        ),
    ] = True,
    start_line: Annotated[
        int | None,
        Field(
            description="Start line for partial read (1-indexed). "
            "Only valid when include_content=true.",
        ),
    ] = None,
    end_line: Annotated[
        int | None,
        Field(
            description="End line for partial read (1-indexed, inclusive). "
            "Only valid when include_content=true.",
        ),
    ] = None,
) -> dict[str, Any]:
    """
    Get a bookmark or note by ID.

    By default returns full content. Use include_content=false to check size first:
    - content_length: Total characters (assess size before loading)
    - content_preview: First 500 characters (quick context)

    When include_content=true, supports partial reads for large documents:
    - Provide start_line and/or end_line to read a specific range
    - Response includes content_metadata with total_lines and is_partial flag

    Examples:
    - Full read: get_item(id="...", type="note")
    - Check size first: get_item(id="...", type="note", include_content=false)
    - First 50 lines: get_item(id="...", type="note", start_line=1, end_line=50)
    """
    if type not in ("bookmark", "note"):
        raise ToolError(f"Invalid type '{type}'. Must be 'bookmark' or 'note'.")

    client = await _get_http_client()
    token = _get_token()

    # Route to appropriate endpoint based on include_content
    if include_content:
        endpoint = f"/{type}s/{id}"
        params: dict[str, Any] = {}
        if start_line is not None:
            params["start_line"] = start_line
        if end_line is not None:
            params["end_line"] = end_line
    else:
        # Metadata-only endpoint (start_line/end_line not valid)
        endpoint = f"/{type}s/{id}/metadata"
        params = {}

    try:
        return await api_get(client, endpoint, token, params if params else None)
    except httpx.HTTPStatusError as e:
        _raise_tool_error(parse_http_error(e, entity_type=type, entity_name=id))
    except httpx.RequestError as e:
        raise ToolError(f"API unavailable: {e}")


@mcp.tool(
    description=(
        "Edit the 'content' field using string replacement. Does NOT edit title or "
        "description - only the main content body. The old_str must match exactly "
        "one location. Use search_in_content first to verify match uniqueness."
    ),
    annotations={"readOnlyHint": False, "destructiveHint": True},
)
async def edit_content(
    id: Annotated[str, Field(description="The item ID (UUID)")],  # noqa: A002
    type: Annotated[  # noqa: A002
        Literal["bookmark", "note"],
        Field(description="Item type: 'bookmark' or 'note'"),
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
    Replace old_str with new_str in the item's 'content' field.

    **Important:** This tool ONLY edits the `content` field (main body text).
    It does NOT edit title, description, or tags. Use update_item for those.

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
    - data: {id, updated_at} - minimal entity data

    Error responses (returned as structured JSON data):
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
        # Return structured error data for 400 (no_match, multiple_matches, content_empty).
        if e.response.status_code == 400:
            try:
                error_detail = e.response.json().get("detail", {})
                if isinstance(error_detail, dict):
                    return error_detail
                return {"error": "unknown", "message": str(error_detail)}
            except (ValueError, KeyError):
                pass
        _raise_tool_error(parse_http_error(e, entity_type=type, entity_name=id))
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
    id: Annotated[str, Field(description="The item ID (UUID)")],  # noqa: A002
    type: Annotated[  # noqa: A002
        Literal["bookmark", "note"],
        Field(description="Item type: 'bookmark' or 'note'"),
    ],
    query: Annotated[str, Field(description="Text to search for (literal match)")],
    fields: Annotated[
        str | None,
        Field(
            description="Fields to search (comma-separated): content, title, description. "
            "Default: 'content' only",
        ),
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

    By default, searches ONLY the 'content' field. Use `fields` parameter to also
    search title and/or description (e.g., fields="content,title,description").

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
        _raise_tool_error(parse_http_error(e, entity_type=type, entity_name=id))
    except httpx.RequestError as e:
        raise ToolError(f"API unavailable: {e}")


@mcp.tool(
    description=(
        "Update a bookmark or note. All parameters are optional - only provide the fields "
        "you want to change (at least one required). Can update metadata (title, description, "
        "tags, url) and/or fully replace content. "
        "NOTE: To make partial/targeted edits to content using string replacement, "
        "use edit_content instead. This tool replaces the entire content field."
    ),
    annotations={"readOnlyHint": False, "destructiveHint": True},
)
async def update_item(
    id: Annotated[str, Field(description="The item ID (UUID)")],  # noqa: A002
    type: Annotated[  # noqa: A002
        Literal["bookmark", "note"],
        Field(description="Item type: 'bookmark' or 'note'"),
    ],
    title: Annotated[
        str | None,
        Field(description="New title. Omit to leave unchanged."),
    ] = None,
    description: Annotated[
        str | None,
        Field(description="New description. Omit to leave unchanged."),
    ] = None,
    tags: Annotated[
        list[str] | None,
        Field(description="New tags (replaces all existing tags). Omit to leave unchanged."),
    ] = None,
    url: Annotated[
        str | None,
        Field(description="New URL (bookmarks only). Omit to leave unchanged."),
    ] = None,
    content: Annotated[
        str | None,
        Field(description="New content (FULL REPLACEMENT of entire content field). Omit to leave unchanged."),
    ] = None,
    expected_updated_at: Annotated[
        str | None,
        Field(
            description="For optimistic locking. If provided and the item was modified after "
            "this timestamp, returns a conflict error with the current server state. "
            "Use the updated_at from a previous response."
        ),
    ] = None,
) -> dict[str, Any]:
    """
    Update a bookmark or note.

    At least one data field must be provided (title, description, tags, url, or content).
    Tags are replaced entirely (not merged) - provide the complete tag list.
    The `url` parameter only applies to bookmarks - raises an error if provided for notes.

    Use `expected_updated_at` to prevent concurrent edit conflicts. If the item was modified
    after this timestamp, returns a conflict response with the current server state.

    Returns a dict with {id, updated_at, summary} for programmatic use and optimistic locking.
    """
    if type not in ("bookmark", "note"):
        raise ToolError(f"Invalid type '{type}'. Must be 'bookmark' or 'note'.")

    if title is None and description is None and tags is None and url is None and content is None:
        raise ToolError("At least one of title, description, tags, url, or content must be provided")

    if url is not None and type == "note":
        raise ToolError("url parameter is only valid for bookmarks")

    client = await _get_http_client()
    token = _get_token()

    # Build payload from provided fields
    endpoint = f"/{type}s/{id}"
    fields = {
        "title": title,
        "description": description,
        "tags": tags,
        "url": url,
        "content": content,
        "expected_updated_at": expected_updated_at,
    }
    payload = {k: v for k, v in fields.items() if v is not None}

    try:
        result = await api_patch(client, endpoint, token, payload)
    except httpx.HTTPStatusError as e:
        info = parse_http_error(e, entity_type=type, entity_name=id)
        if info.category == "conflict_modified":
            return {
                "error": "conflict",
                "message": info.message,
                "server_state": info.server_state,
            }
        _raise_tool_error(info)
    except httpx.RequestError as e:
        raise ToolError(f"API unavailable: {e}")

    # Build summary of what was updated
    item_title = result.get("title") or result.get("url") or id
    # Exclude expected_updated_at from summary (it's a control parameter, not a data update)
    data_fields = {k: v for k, v in payload.items() if k != "expected_updated_at"}
    updates = [f"{k} updated" for k in data_fields]
    summary = ", ".join(updates) if updates else "no changes"

    return {
        "id": result.get("id"),
        "updated_at": result.get("updated_at"),
        "summary": f"Updated {type} '{item_title}': {summary}",
    }


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
        # Special handling for 409: check for ARCHIVED_URL_EXISTS error code
        if e.response.status_code == 409:
            try:
                detail = e.response.json().get("detail", {})
                error_code = detail.get("error_code", "") if isinstance(detail, dict) else ""
                if error_code == "ARCHIVED_URL_EXISTS":
                    bookmark_id = detail.get("existing_bookmark_id")
                    raise ToolError(
                        f"An archived bookmark exists with this URL (ID: {bookmark_id}). "
                        "Use the web UI to restore or permanently delete it first.",
                    )
            except (ValueError, KeyError, TypeError):
                pass
            raise ToolError("A bookmark with this URL already exists")
        _raise_tool_error(parse_http_error(e))
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
        _raise_tool_error(parse_http_error(e))
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
        _raise_tool_error(parse_http_error(e))
    except httpx.RequestError as e:
        raise ToolError(f"API unavailable: {e}")
