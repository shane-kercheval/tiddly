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
from shared.mcp_format import format_filter_expression

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

**Context:**
- `get_context`: Get a markdown summary of the user's content (counts, tags, filters with top items, recent items).
  Call this once at the start of a session to understand what the user has and how it's organized.
  Re-calling is only useful if the user significantly creates, modifies, or reorganizes content during the session.
  Use IDs from the response with `get_item` for full content. Use tag names with `search_items`.

**Search** (returns active items only - excludes archived/deleted):
- `search_items`: Search across bookmarks and notes. Use `type` parameter to filter.
  Use `filter_id` to search within a saved content filter (discover IDs via `list_filters`).
- `list_filters`: List filters relevant to bookmarks and notes, with IDs, names, and tag rules.
  Use filter IDs with `search_items(filter_id=...)` to search within a specific filter.
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

9. "What does this user have?"
   - Call `get_context()` to get an overview of their content, tags, filters, and recent activity

10. "Show me items from my Work Projects filter"
   - Call `list_filters()` to find the filter ID
   - Call `search_items(filter_id="<uuid>")` to get items matching that filter

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
    filter_id: Annotated[
        str | None,
        Field(
            description=(
                "Filter by content filter ID (UUID). "
                "Use list_filters to discover filter IDs."
            ),
        ),
    ] = None,
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
    if filter_id:
        params["filter_id"] = filter_id

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
        "List filters relevant to bookmarks and notes. "
        "Filters are saved views with tag-based rules. Use filter IDs with "
        "search_items(filter_id=...) to search within a specific filter. "
        "Returns filter ID, name, content types, and the tag-based filter expression."
    ),
    annotations={"readOnlyHint": True},
)
async def list_filters() -> dict[str, Any]:
    """List filters relevant to bookmarks and notes."""
    client = await _get_http_client()
    token = _get_token()

    try:
        filters = await api_get(client, "/filters/", token)
        # Only include filters relevant to bookmarks/notes
        content_types = {"bookmark", "note"}
        relevant = [f for f in filters if content_types & set(f.get("content_types", []))]
        return {"filters": relevant}
    except httpx.HTTPStatusError as e:
        _raise_tool_error(parse_http_error(e))
    except httpx.RequestError as e:
        raise ToolError(f"API unavailable: {e}")


@mcp.tool(
    description=(
        "Get a bookmark or note by ID. By default includes full content. "
        "Use include_content=false to get content_length and content_preview for size assessment "
        "before loading large content. "
        "Supports partial reads via start_line/end_line for large documents."
    ),
    annotations={"readOnlyHint": True},
)
async def get_item(
    id: Annotated[str, Field(description="The item ID (UUID). Use search_items if you need to discover item IDs.")],  # noqa: A002, E501
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
        "Edit the 'content' field using string replacement. "
        "Use when: making targeted changes (small or large) where you can identify "
        "specific text to replace; adding, removing, or modifying a section while "
        "keeping the rest unchanged. More efficient than replacing entire content. "
        "Examples: fix a typo, add a paragraph, remove a section, update specific text. "
        "Does NOT edit title, description, or tags - only the main content body. "
        "The old_str must match exactly one location. "
        "Use search_in_content first to verify match uniqueness."
    ),
    annotations={"readOnlyHint": False, "destructiveHint": True},
)
async def edit_content(
    id: Annotated[str, Field(description="The item ID (UUID). Use search_items if you need to discover item IDs.")],  # noqa: A002, E501
    type: Annotated[  # noqa: A002
        Literal["bookmark", "note"],
        Field(description="Item type: 'bookmark' or 'note'"),
    ],
    old_str: Annotated[
        str,
        Field(
            description=(
                "Exact text to find. Must match exactly one location. "
                "If not found, returns no_match error (whitespace normalization is automatic). "
                "If multiple matches, returns multiple_matches error with line numbers and "
                "context to help construct a unique match."
            ),
        ),
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
    id: Annotated[str, Field(description="The item ID (UUID). Use search_items if you need to discover item IDs.")],  # noqa: A002, E501
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
        "Update metadata and/or fully replace content. "
        "Use when: updating metadata (title, description, tags, url); "
        "rewriting/restructuring where most content changes; changes are extensive "
        "enough that finding old_str is impractical. Safer for major rewrites. "
        "Examples: convert format (bullets to prose), change tone/audience, "
        "reorganize structure, complete rewrite, update tags. "
        "All parameters optional - only provide what you want to change (at least one required). "
        "NOTE: For targeted edits where you can identify specific text to replace, "
        "use edit_content instead - it's more efficient for surgical changes."
    ),
    annotations={"readOnlyHint": False, "destructiveHint": True},
)
async def update_item(
    id: Annotated[str, Field(description="The item ID (UUID). Use search_items if you need to discover item IDs.")],  # noqa: A002, E501
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
        Field(description="New content (FULL REPLACEMENT of entire content field). Omit to leave unchanged."),  # noqa: E501
    ] = None,
    expected_updated_at: Annotated[
        str | None,
        Field(
            description="For optimistic locking. If provided and the item was modified after "
            "this timestamp, returns a conflict error with the current server state. "
            "Use the updated_at from a previous response.",
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
        raise ToolError("At least one of title, description, tags, url, or content must be provided")  # noqa: E501

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
    description=(
        "Get a summary of the user's bookmarks and notes. "
        "Use this at the START of a session to understand: "
        "what content the user has (counts by type), how content is organized "
        "(top tags, custom filters in priority order), what's inside each filter "
        "(top items per filter), and what the user is actively working with "
        "(recently used, created, modified items). "
        "Results reflect a point-in-time snapshot. Call once at session start; re-calling "
        "is only useful if the user significantly creates, modifies, or reorganizes "
        "content during the session. "
        "Returns a markdown summary optimized for quick understanding. Use IDs from "
        "the response with get_item for full content. Use tag names with search_items "
        "to find related content."
    ),
    annotations={"readOnlyHint": True},
)
async def get_context(
    tag_limit: Annotated[
        int, Field(default=50, ge=1, le=100, description="Number of top tags"),
    ] = 50,
    recent_limit: Annotated[
        int, Field(default=10, ge=1, le=50, description="Recent items per category"),
    ] = 10,
    filter_limit: Annotated[
        int, Field(default=5, ge=0, le=20, description="Max filters to include"),
    ] = 5,
    filter_item_limit: Annotated[
        int, Field(default=5, ge=1, le=20, description="Items per filter"),
    ] = 5,
) -> str:
    """Get a markdown summary of the user's content landscape."""
    client = await _get_http_client()
    token = _get_token()

    params: dict[str, Any] = {
        "tag_limit": tag_limit,
        "recent_limit": recent_limit,
        "filter_limit": filter_limit,
        "filter_item_limit": filter_item_limit,
    }

    try:
        data = await api_get(client, "/mcp/context/content", token, params)
    except httpx.HTTPStatusError as e:
        _raise_tool_error(parse_http_error(e))
    except httpx.RequestError as e:
        raise ToolError(f"API unavailable: {e}")

    return _format_content_context_markdown(data)




def _format_content_context_markdown(data: dict[str, Any]) -> str:
    """Convert content context API response to markdown."""
    lines: list[str] = []
    seen_ids: set[str] = set()

    lines.append("# Content Context")
    lines.append("")
    lines.append(f"Generated: {data['generated_at']}")

    _append_overview_section(lines, data)
    _append_tags_section(lines, data)

    filters = data.get("filters", [])
    _append_filters_section(lines, filters)
    _append_sidebar_section(lines, data)
    _append_filter_contents_section(lines, filters, seen_ids)
    _append_recent_sections(lines, data, seen_ids)

    return "\n".join(lines)


def _append_overview_section(
    lines: list[str], data: dict[str, Any],
) -> None:
    """Append overview counts section."""
    lines.append("")
    lines.append("## Overview")
    counts = data["counts"]
    bm = counts["bookmarks"]
    notes = counts["notes"]
    lines.append(
        f"- **Bookmarks:** {bm['active']} active, {bm['archived']} archived",
    )
    lines.append(
        f"- **Notes:** {notes['active']} active, {notes['archived']} archived",
    )


def _append_tags_section(
    lines: list[str], data: dict[str, Any],
) -> None:
    """Append top tags table section."""
    if not data.get("top_tags"):
        return
    lines.append("")
    lines.append("## Top Tags")
    lines.append(
        "Tags are used to categorize content. A tag referenced by any"
        " filter indicates it is important to the user's workflow.",
    )
    lines.append("")
    lines.append("| Tag | Items | Filters |")
    lines.append("|-----|-------|---------|")
    for tag in data["top_tags"]:
        lines.append(
            f"| {tag['name']} | {tag['content_count']}"
            f" | {tag['filter_count']} |",
        )
    lines.append("")


def _append_filters_section(
    lines: list[str], filters: list[dict[str, Any]],
) -> None:
    """Append filter definitions section."""
    if not filters:
        return
    lines.append("")
    lines.append("## Filters")
    lines.append(
        "Filters are custom saved views the user has created to organize"
        " their content. They define tag-based rules to surface specific"
        " items. Filters are listed below in the user's preferred order,"
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


def _append_sidebar_section(
    lines: list[str], data: dict[str, Any],
) -> None:
    """Append sidebar organization section from sidebar_items tree."""
    sidebar_items = data.get("sidebar_items", [])
    if not sidebar_items:
        return

    lines.append("## Sidebar Organization")
    lines.append(
        "This shows only user-created custom filters. Built-in views"
        " (e.g. 'All Bookmarks', 'All Notes') are not listed here."
        " Items may exist outside any custom filter."
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


def _append_filter_contents_section(
    lines: list[str],
    filters: list[dict[str, Any]],
    seen_ids: set[str],
) -> None:
    """Append filter contents with top items per filter."""
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
                _append_abbreviated_item(lines, j, item)
            else:
                seen_ids.add(item_id)
                _append_item_lines(lines, j, item)
        lines.append("")


def _append_recent_sections(
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
                _append_abbreviated_item(
                    lines, j, item, time_field=time_field,
                )
            else:
                seen_ids.add(item_id)
                _append_item_lines(
                    lines, j, item, extra_time_field=time_field,
                )
        lines.append("")


_TIME_LABELS: dict[str, str] = {
    "last_used_at": "Last used",
    "created_at": "Created",
    "updated_at": "Modified",
}


def _append_abbreviated_item(
    lines: list[str],
    index: int,
    item: dict[str, Any],
    time_field: str | None = None,
) -> None:
    """Append an abbreviated item reference (already shown elsewhere)."""
    item_id = str(item["id"])
    title = item.get("title") or "Untitled"
    lines.append(
        f"{index}. **{title}** `[{item['type']} {item_id}]`",
    )
    if time_field:
        ts = item.get(time_field, "")
        if ts:
            label = _TIME_LABELS.get(time_field, time_field)
            lines.append(f"   {label}: {ts}")
    lines.append("   (see above)")


def _append_item_lines(
    lines: list[str],
    index: int,
    item: dict[str, Any],
    extra_time_field: str | None = None,
) -> None:
    """Append formatted item lines to the output."""
    item_id = str(item["id"])
    title = item.get("title") or "Untitled"
    lines.append(f"{index}. **{title}** `[{item['type']} {item_id}]`")

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

    preview = item.get("content_preview")
    if preview:
        lines.append(f"   Preview: {preview}")


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
