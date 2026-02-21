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

from pathlib import Path
from typing import Annotated, Any, Literal, NoReturn

import httpx
from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from pydantic import Field
from starlette.requests import Request
from starlette.responses import JSONResponse

from shared.api_errors import ParsedApiError, parse_http_error
from shared.mcp_utils import format_filter_expression, load_instructions, load_tool_descriptions

from .api_client import api_get, api_patch, api_post, get_api_base_url, get_default_timeout
from .auth import AuthenticationError, get_bearer_token

_DIR = Path(__file__).parent
_TOOLS = load_tool_descriptions(_DIR)

mcp = FastMCP(
    name="Bookmarks MCP Server",
    instructions=load_instructions(_DIR),
)


@mcp.custom_route("/health", methods=["GET"])
async def health_check(request: Request) -> JSONResponse:  # noqa: ARG001
    """Health check endpoint."""
    return JSONResponse({"status": "healthy"})


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
    description=_TOOLS["search_items"]["description"],
    annotations={"readOnlyHint": True},
)
async def search_items(
    query: Annotated[
        str | None,
        Field(description=_TOOLS["search_items"]["parameters"]["query"]),
    ] = None,
    type: Annotated[  # noqa: A002
        Literal["bookmark", "note"] | None,
        Field(description=_TOOLS["search_items"]["parameters"]["type"]),
    ] = None,
    tags: Annotated[
        list[str] | None,
        Field(description=_TOOLS["search_items"]["parameters"]["tags"]),
    ] = None,
    tag_match: Annotated[
        Literal["all", "any"],
        Field(description=_TOOLS["search_items"]["parameters"]["tag_match"]),
    ] = "all",
    sort_by: Annotated[
        Literal["created_at", "updated_at", "last_used_at", "title", "relevance"] | None,
        Field(description=_TOOLS["search_items"]["parameters"]["sort_by"]),
    ] = None,
    sort_order: Annotated[
        Literal["asc", "desc"],
        Field(description=_TOOLS["search_items"]["parameters"]["sort_order"]),
    ] = "desc",
    limit: Annotated[
        int,
        Field(ge=1, le=100, description=_TOOLS["search_items"]["parameters"]["limit"]),
    ] = 50,
    offset: Annotated[
        int, Field(ge=0, description=_TOOLS["search_items"]["parameters"]["offset"]),
    ] = 0,
    filter_id: Annotated[
        str | None,
        Field(description=_TOOLS["search_items"]["parameters"]["filter_id"]),
    ] = None,
) -> dict[str, Any]:
    """
    Search and filter bookmarks and/or notes.

    Search uses full-text search (English stemming) combined with substring matching.
    Complete words are preferred and rank higher. Partial words and code symbols
    still work via substring but may rank lower.

    Results include content_length and content_preview for size assessment.
    Use get_item to fetch full content.

    Examples:
    - Search all: query="python"
    - Search bookmarks only: query="python", type="bookmark"
    - Filter by tag: tags=["programming"]
    - Combine: query="tutorial", tags=["python"], type="bookmark"
    - Exact phrase: query='"machine learning"'
    - Exclude term: query="python -beginner"
    - Alternatives: query="python OR javascript"
    """
    client = await _get_http_client()
    token = _get_token()

    params: dict[str, Any] = {
        "limit": limit,
        "offset": offset,
        "tag_match": tag_match,
        "sort_order": sort_order,
    }
    if query:
        params["q"] = query
    if sort_by is not None:
        params["sort_by"] = sort_by
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
    description=_TOOLS["list_filters"]["description"],
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
    description=_TOOLS["get_item"]["description"],
    annotations={"readOnlyHint": True},
)
async def get_item(
    id: Annotated[str, Field(description=_TOOLS["get_item"]["parameters"]["id"])],  # noqa: A002
    type: Annotated[  # noqa: A002
        Literal["bookmark", "note"],
        Field(description=_TOOLS["get_item"]["parameters"]["type"]),
    ],
    include_content: Annotated[
        bool,
        Field(description=_TOOLS["get_item"]["parameters"]["include_content"]),
    ] = True,
    start_line: Annotated[
        int | None,
        Field(description=_TOOLS["get_item"]["parameters"]["start_line"]),
    ] = None,
    end_line: Annotated[
        int | None,
        Field(description=_TOOLS["get_item"]["parameters"]["end_line"]),
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
    description=_TOOLS["edit_content"]["description"],
    annotations={"readOnlyHint": False, "destructiveHint": True},
)
async def edit_content(
    id: Annotated[str, Field(description=_TOOLS["edit_content"]["parameters"]["id"])],  # noqa: A002
    type: Annotated[  # noqa: A002
        Literal["bookmark", "note"],
        Field(description=_TOOLS["edit_content"]["parameters"]["type"]),
    ],
    old_str: Annotated[
        str,
        Field(description=_TOOLS["edit_content"]["parameters"]["old_str"]),
    ],
    new_str: Annotated[
        str,
        Field(description=_TOOLS["edit_content"]["parameters"]["new_str"]),
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
    description=_TOOLS["search_in_content"]["description"],
    annotations={"readOnlyHint": True},
)
async def search_in_content(
    id: Annotated[str, Field(description=_TOOLS["search_in_content"]["parameters"]["id"])],  # noqa: A002
    type: Annotated[  # noqa: A002
        Literal["bookmark", "note"],
        Field(description=_TOOLS["search_in_content"]["parameters"]["type"]),
    ],
    query: Annotated[str, Field(description=_TOOLS["search_in_content"]["parameters"]["query"])],
    fields: Annotated[
        str | None,
        Field(description=_TOOLS["search_in_content"]["parameters"]["fields"]),
    ] = None,
    case_sensitive: Annotated[
        bool | None,
        Field(description=_TOOLS["search_in_content"]["parameters"]["case_sensitive"]),
    ] = None,
    context_lines: Annotated[
        int | None,
        Field(description=_TOOLS["search_in_content"]["parameters"]["context_lines"]),
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
    description=_TOOLS["update_item"]["description"],
    annotations={"readOnlyHint": False, "destructiveHint": True},
)
async def update_item(
    id: Annotated[str, Field(description=_TOOLS["update_item"]["parameters"]["id"])],  # noqa: A002
    type: Annotated[  # noqa: A002
        Literal["bookmark", "note"],
        Field(description=_TOOLS["update_item"]["parameters"]["type"]),
    ],
    title: Annotated[
        str | None,
        Field(description=_TOOLS["update_item"]["parameters"]["title"]),
    ] = None,
    description: Annotated[
        str | None,
        Field(description=_TOOLS["update_item"]["parameters"]["description"]),
    ] = None,
    tags: Annotated[
        list[str] | None,
        Field(description=_TOOLS["update_item"]["parameters"]["tags"]),
    ] = None,
    url: Annotated[
        str | None,
        Field(description=_TOOLS["update_item"]["parameters"]["url"]),
    ] = None,
    content: Annotated[
        str | None,
        Field(description=_TOOLS["update_item"]["parameters"]["content"]),
    ] = None,
    expected_updated_at: Annotated[
        str | None,
        Field(description=_TOOLS["update_item"]["parameters"]["expected_updated_at"]),
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
    description=_TOOLS["create_bookmark"]["description"],
    annotations={"readOnlyHint": False, "destructiveHint": False},
)
async def create_bookmark(
    url: Annotated[
        str, Field(description=_TOOLS["create_bookmark"]["parameters"]["url"]),
    ],
    title: Annotated[
        str | None,
        Field(description=_TOOLS["create_bookmark"]["parameters"]["title"]),
    ] = None,
    description: Annotated[
        str | None,
        Field(description=_TOOLS["create_bookmark"]["parameters"]["description"]),
    ] = None,
    tags: Annotated[
        list[str] | None,
        Field(description=_TOOLS["create_bookmark"]["parameters"]["tags"]),
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
    description=_TOOLS["create_note"]["description"],
    annotations={"readOnlyHint": False, "destructiveHint": False},
)
async def create_note(
    title: Annotated[
        str, Field(description=_TOOLS["create_note"]["parameters"]["title"]),
    ],
    description: Annotated[
        str | None,
        Field(description=_TOOLS["create_note"]["parameters"]["description"]),
    ] = None,
    content: Annotated[
        str | None,
        Field(description=_TOOLS["create_note"]["parameters"]["content"]),
    ] = None,
    tags: Annotated[
        list[str] | None,
        Field(description=_TOOLS["create_note"]["parameters"]["tags"]),
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
    description=_TOOLS["create_relationship"]["description"],
    annotations={"readOnlyHint": False, "destructiveHint": False, "idempotentHint": True},
)
async def create_relationship(
    source_type: Annotated[
        Literal["bookmark", "note"],
        Field(description=_TOOLS["create_relationship"]["parameters"]["source_type"]),
    ],
    source_id: Annotated[
        str,
        Field(description=_TOOLS["create_relationship"]["parameters"]["source_id"]),
    ],
    target_type: Annotated[
        Literal["bookmark", "note"],
        Field(description=_TOOLS["create_relationship"]["parameters"]["target_type"]),
    ],
    target_id: Annotated[
        str,
        Field(description=_TOOLS["create_relationship"]["parameters"]["target_id"]),
    ],
) -> dict[str, Any]:
    """
    Create a 'related' link between two content items.

    Idempotent: if the link already exists, returns the existing relationship.
    """
    client = await _get_http_client()
    token = _get_token()

    payload = {
        "source_type": source_type,
        "source_id": source_id,
        "target_type": target_type,
        "target_id": target_id,
        "relationship_type": "related",
    }

    try:
        return await api_post(client, "/relationships/", token, payload)
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 409:
            # Duplicate — find and return the existing relationship
            try:
                data = await api_get(
                    client,
                    f"/relationships/content/{source_type}/{source_id}?limit=100",
                    token,
                )
                for rel in data.get("items", []):
                    is_source = rel["source_id"] == source_id
                    other_type = (
                        rel["target_type"] if is_source
                        else rel["source_type"]
                    )
                    other_id = (
                        rel["target_id"] if is_source
                        else rel["source_id"]
                    )
                    if other_type == target_type and other_id == target_id:
                        return rel
                return {"message": "Relationship already exists"}
            except httpx.HTTPStatusError:
                return {"message": "Relationship already exists"}
        if e.response.status_code == 404:
            raise ToolError(
                "One or both content items not found. "
                "Verify the IDs and types are correct.",
            )
        _raise_tool_error(parse_http_error(e))
    except httpx.RequestError as e:
        raise ToolError(f"API unavailable: {e}")


@mcp.tool(
    description=_TOOLS["get_context"]["description"],
    annotations={"readOnlyHint": True},
)
async def get_context(
    tag_limit: Annotated[
        int,
        Field(
            default=50, ge=1, le=100,
            description=_TOOLS["get_context"]["parameters"]["tag_limit"],
        ),
    ] = 50,
    recent_limit: Annotated[
        int,
        Field(
            default=10, ge=1, le=50,
            description=_TOOLS["get_context"]["parameters"]["recent_limit"],
        ),
    ] = 10,
    filter_limit: Annotated[
        int,
        Field(
            default=5, ge=0, le=20,
            description=_TOOLS["get_context"]["parameters"]["filter_limit"],
        ),
    ] = 5,
    filter_item_limit: Annotated[
        int,
        Field(
            default=5, ge=1, le=20,
            description=_TOOLS["get_context"]["parameters"]["filter_item_limit"],
        ),
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
            lines.append(f"   - **{label}**: {ts}")
    lines.append("   - *(see above)*")


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
            lines.append(f"   - **{label}**: {ts}")

    tags = item.get("tags", [])
    if tags:
        lines.append(f"   - **Tags**: {', '.join(tags)}")

    desc = item.get("description")
    if desc:
        lines.append(f"   - **Description**: {desc}")

    preview = item.get("content_preview")
    if preview:
        lines.append(f"   - **Preview**: {preview}")


@mcp.tool(
    description=_TOOLS["list_tags"]["description"],
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
