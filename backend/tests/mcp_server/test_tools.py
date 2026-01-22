"""Tests for MCP tools using FastMCP Client."""

from typing import Any
from unittest.mock import patch

import httpx
import pytest
from httpx import Response

from fastmcp import Client


@pytest.fixture
async def mcp_client(mock_auth):  # noqa: ARG001 - mock_auth needed for side effect
    """Create an MCP client connected to the server."""
    from mcp_server.server import mcp

    async with Client(transport=mcp) as client:
        yield client


# --- search_items tests (replaces search_bookmarks, search_notes, search_all_content) ---


@pytest.mark.asyncio
async def test__search_items__bookmarks(
    mock_api,
    mcp_client: Client,
    sample_bookmark_list: dict[str, Any],
) -> None:
    """Test search_items with type=bookmark."""
    mock_api.get("/bookmarks/").mock(
        return_value=Response(200, json=sample_bookmark_list),
    )

    result = await mcp_client.call_tool("search_items", {"type": "bookmark"})

    assert result.data["total"] == 1
    assert len(result.data["items"]) == 1


@pytest.mark.asyncio
async def test__search_items__bookmarks_with_query(
    mock_api,
    mcp_client: Client,
    sample_bookmark_list: dict[str, Any],
) -> None:
    """Test search_items with query parameter for bookmarks."""
    mock_api.get("/bookmarks/").mock(
        return_value=Response(200, json=sample_bookmark_list),
    )

    await mcp_client.call_tool("search_items", {"query": "example", "type": "bookmark"})

    assert "q" in str(mock_api.calls[0].request.url)


@pytest.mark.asyncio
async def test__search_items__bookmarks_with_tags(
    mock_api,
    mcp_client: Client,
    sample_bookmark_list: dict[str, Any],
) -> None:
    """Test search_items with tag filtering for bookmarks."""
    mock_api.get("/bookmarks/").mock(
        return_value=Response(200, json=sample_bookmark_list),
    )

    await mcp_client.call_tool(
        "search_items",
        {"tags": ["python", "web-dev"], "tag_match": "any", "type": "bookmark"},
    )

    request_url = str(mock_api.calls[0].request.url)
    assert "tags" in request_url
    assert "tag_match=any" in request_url


@pytest.mark.asyncio
async def test__search_items__notes(
    mock_api,
    mcp_client: Client,
    sample_note_list: dict[str, Any],
) -> None:
    """Test search_items with type=note."""
    mock_api.get("/notes/").mock(
        return_value=Response(200, json=sample_note_list),
    )

    result = await mcp_client.call_tool("search_items", {"type": "note"})

    assert result.data["total"] == 1
    assert len(result.data["items"]) == 1


@pytest.mark.asyncio
async def test__search_items__notes_with_query(
    mock_api,
    mcp_client: Client,
    sample_note_list: dict[str, Any],
) -> None:
    """Test search_items with query parameter for notes."""
    mock_api.get("/notes/").mock(
        return_value=Response(200, json=sample_note_list),
    )

    await mcp_client.call_tool("search_items", {"query": "meeting", "type": "note"})

    assert "q" in str(mock_api.calls[0].request.url)


@pytest.mark.asyncio
async def test__search_items__notes_with_tags(
    mock_api,
    mcp_client: Client,
    sample_note_list: dict[str, Any],
) -> None:
    """Test search_items with tag filtering for notes."""
    mock_api.get("/notes/").mock(
        return_value=Response(200, json=sample_note_list),
    )

    await mcp_client.call_tool(
        "search_items",
        {"tags": ["work", "important"], "tag_match": "any", "type": "note"},
    )

    request_url = str(mock_api.calls[0].request.url)
    assert "tags" in request_url
    assert "tag_match=any" in request_url


@pytest.mark.asyncio
async def test__search_items__all_types(
    mock_api,
    mcp_client: Client,
    sample_content_list: dict[str, Any],
) -> None:
    """Test search_items without type filter (searches all content types)."""
    mock_api.get("/content/").mock(
        return_value=Response(200, json=sample_content_list),
    )

    result = await mcp_client.call_tool("search_items", {})

    assert result.data["total"] == 2
    assert len(result.data["items"]) == 2
    types = [item["type"] for item in result.data["items"]]
    assert "bookmark" in types
    assert "note" in types


@pytest.mark.asyncio
async def test__search_items__excludes_prompts_when_no_type(
    mock_api,
    mcp_client: Client,
    sample_content_list: dict[str, Any],
) -> None:
    """Test search_items passes content_types to exclude prompts when type is not specified."""
    mock_api.get("/content/").mock(
        return_value=Response(200, json=sample_content_list),
    )

    await mcp_client.call_tool("search_items", {})

    # Verify content_types param is passed to exclude prompts
    request_url = str(mock_api.calls[0].request.url)
    assert "content_types=bookmark" in request_url
    assert "content_types=note" in request_url


@pytest.mark.asyncio
async def test__search_items__all_types_with_query(
    mock_api,
    mcp_client: Client,
    sample_content_list: dict[str, Any],
) -> None:
    """Test search_items with query parameter (no type filter)."""
    mock_api.get("/content/").mock(
        return_value=Response(200, json=sample_content_list),
    )

    await mcp_client.call_tool("search_items", {"query": "python"})

    assert "q" in str(mock_api.calls[0].request.url)


@pytest.mark.asyncio
async def test__search_items__api_unavailable(mock_api, mcp_client: Client) -> None:
    """Test network error handling for search_items."""
    mock_api.get("/content/").mock(side_effect=httpx.ConnectError("Connection refused"))

    result = await mcp_client.call_tool("search_items", {}, raise_on_error=False)

    assert result.is_error
    assert "unavailable" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__search_items__invalid_token(mock_api) -> None:
    """Test 401 error handling for invalid token."""
    from mcp_server.server import mcp

    mock_api.get("/content/").mock(
        return_value=Response(401, json={"detail": "Invalid token"}),
    )

    with patch("mcp_server.server.get_bearer_token") as mock_auth:
        mock_auth.return_value = "invalid_token"
        async with Client(transport=mcp) as client:
            result = await client.call_tool("search_items", {}, raise_on_error=False)

    assert result.is_error
    error_text = result.content[0].text.lower()
    assert "invalid" in error_text or "expired" in error_text


# --- get_item tests (replaces get_content) ---


@pytest.mark.asyncio
async def test__get_item__bookmark_success(
    mock_api,
    mcp_client: Client,
    sample_bookmark_with_metadata: dict[str, Any],
) -> None:
    """Test getting a bookmark by ID via get_item."""
    bookmark_id = "550e8400-e29b-41d4-a716-446655440001"
    mock_api.get(f"/bookmarks/{bookmark_id}").mock(
        return_value=Response(200, json=sample_bookmark_with_metadata),
    )

    result = await mcp_client.call_tool(
        "get_item", {"id": bookmark_id, "type": "bookmark"},
    )

    assert result.data["id"] == bookmark_id
    assert result.data["url"] == "https://example.com"
    assert result.data["content_metadata"]["total_lines"] == 10


@pytest.mark.asyncio
async def test__get_item__bookmark_not_found(mock_api, mcp_client: Client) -> None:
    """Test 404 error handling for bookmark via get_item."""
    missing_id = "00000000-0000-0000-0000-000000000000"
    mock_api.get(f"/bookmarks/{missing_id}").mock(
        return_value=Response(404, json={"detail": "Not found"}),
    )

    result = await mcp_client.call_tool(
        "get_item", {"id": missing_id, "type": "bookmark"}, raise_on_error=False,
    )

    assert result.is_error
    assert "not found" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__get_item__note_success(
    mock_api,
    mcp_client: Client,
    sample_note_with_metadata: dict[str, Any],
) -> None:
    """Test getting a note by ID via get_item."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    mock_api.get(f"/notes/{note_id}").mock(
        return_value=Response(200, json=sample_note_with_metadata),
    )

    result = await mcp_client.call_tool("get_item", {"id": note_id, "type": "note"})

    assert result.data["id"] == note_id
    assert result.data["title"] == "Test Note"
    assert result.data["content"] is not None
    assert result.data["content_metadata"]["total_lines"] == 5


@pytest.mark.asyncio
async def test__get_item__note_not_found(mock_api, mcp_client: Client) -> None:
    """Test 404 error handling for notes via get_item."""
    missing_id = "00000000-0000-0000-0000-000000000000"
    mock_api.get(f"/notes/{missing_id}").mock(
        return_value=Response(404, json={"detail": "Not found"}),
    )

    result = await mcp_client.call_tool(
        "get_item", {"id": missing_id, "type": "note"}, raise_on_error=False,
    )

    assert result.is_error
    assert "not found" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__get_item__partial_read(
    mock_api,
    mcp_client: Client,
) -> None:
    """Test partial read with line range parameters."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    partial_response = {
        "id": note_id,
        "title": "Test Note",
        "content": "line 10\nline 11\nline 12",
        "content_metadata": {
            "total_lines": 50,
            "start_line": 10,
            "end_line": 12,
            "is_partial": True,
        },
    }
    mock_api.get(f"/notes/{note_id}").mock(
        return_value=Response(200, json=partial_response),
    )

    result = await mcp_client.call_tool(
        "get_item",
        {"id": note_id, "type": "note", "start_line": 10, "end_line": 12},
    )

    assert result.data["content_metadata"]["is_partial"] is True
    assert result.data["content_metadata"]["start_line"] == 10
    assert result.data["content_metadata"]["end_line"] == 12
    # Verify query params were passed
    request_url = str(mock_api.calls[0].request.url)
    assert "start_line=10" in request_url
    assert "end_line=12" in request_url


@pytest.mark.asyncio
async def test__get_item__include_content_false(
    mock_api,
    mcp_client: Client,
) -> None:
    """Test get_item with include_content=false routes to metadata endpoint."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    metadata_response = {
        "id": note_id,
        "title": "Test Note",
        "content_length": 1500,
        "content_preview": "First 500 chars of content...",
    }
    mock_api.get(f"/notes/{note_id}/metadata").mock(
        return_value=Response(200, json=metadata_response),
    )

    result = await mcp_client.call_tool(
        "get_item",
        {"id": note_id, "type": "note", "include_content": False},
    )

    assert result.data["content_length"] == 1500
    assert result.data["content_preview"] == "First 500 chars of content..."


@pytest.mark.asyncio
async def test__get_item__invalid_type(
    mock_api,  # noqa: ARG001 - needed to reset HTTP client
    mcp_client: Client,
) -> None:
    """Test error for invalid content type."""
    result = await mcp_client.call_tool(
        "get_item",
        {"id": "some-id", "type": "invalid"},
        raise_on_error=False,
    )

    assert result.is_error
    assert "invalid" in result.content[0].text.lower()


# --- update_item_metadata tests ---


@pytest.mark.asyncio
async def test__update_item_metadata__note_success(
    mock_api,
    mcp_client: Client,
    sample_note: dict[str, Any],
) -> None:
    """Test updating note metadata."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    updated_note = {**sample_note, "title": "Updated Title", "tags": ["new-tag"]}
    mock_api.patch(f"/notes/{note_id}").mock(
        return_value=Response(200, json=updated_note),
    )

    result = await mcp_client.call_tool(
        "update_item_metadata",
        {"id": note_id, "type": "note", "title": "Updated Title", "tags": ["new-tag"]},
    )

    assert result.data["title"] == "Updated Title"


@pytest.mark.asyncio
async def test__update_item_metadata__bookmark_with_url(
    mock_api,
    mcp_client: Client,
    sample_bookmark: dict[str, Any],
) -> None:
    """Test updating bookmark metadata including URL."""
    bookmark_id = "550e8400-e29b-41d4-a716-446655440001"
    updated_bookmark = {**sample_bookmark, "url": "https://new-url.com"}
    mock_api.patch(f"/bookmarks/{bookmark_id}").mock(
        return_value=Response(200, json=updated_bookmark),
    )

    result = await mcp_client.call_tool(
        "update_item_metadata",
        {"id": bookmark_id, "type": "bookmark", "url": "https://new-url.com"},
    )

    assert result.data["url"] == "https://new-url.com"


@pytest.mark.asyncio
async def test__update_item_metadata__updates_description(
    mock_api,
    mcp_client: Client,
    sample_note: dict[str, Any],
) -> None:
    """Test updating item description."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    updated_note = {**sample_note, "description": "Updated description"}
    mock_api.patch(f"/notes/{note_id}").mock(
        return_value=Response(200, json=updated_note),
    )

    result = await mcp_client.call_tool(
        "update_item_metadata",
        {"id": note_id, "type": "note", "description": "Updated description"},
    )

    assert result.data["description"] == "Updated description"


@pytest.mark.asyncio
async def test__update_item_metadata__note_url_error(
    mock_api,  # noqa: ARG001 - needed to reset HTTP client
    mcp_client: Client,
) -> None:
    """Test that url parameter raises error for notes."""
    result = await mcp_client.call_tool(
        "update_item_metadata",
        {"id": "some-id", "type": "note", "url": "https://example.com"},
        raise_on_error=False,
    )

    assert result.is_error
    assert "url" in result.content[0].text.lower()
    assert "bookmark" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__update_item_metadata__no_fields_error(
    mock_api,  # noqa: ARG001 - needed to reset HTTP client
    mcp_client: Client,
) -> None:
    """Test that at least one field must be provided."""
    result = await mcp_client.call_tool(
        "update_item_metadata",
        {"id": "some-id", "type": "note"},
        raise_on_error=False,
    )

    assert result.is_error
    assert "at least one" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__update_item_metadata__not_found(mock_api, mcp_client: Client) -> None:
    """Test 404 error handling for update_item_metadata."""
    missing_id = "00000000-0000-0000-0000-000000000000"
    mock_api.patch(f"/notes/{missing_id}").mock(
        return_value=Response(404, json={"detail": "Not found"}),
    )

    result = await mcp_client.call_tool(
        "update_item_metadata",
        {"id": missing_id, "type": "note", "title": "New Title"},
        raise_on_error=False,
    )

    assert result.is_error
    assert "not found" in result.content[0].text.lower()


# --- create_bookmark tests ---


@pytest.mark.asyncio
async def test__create_bookmark__success(
    mock_api,
    mcp_client: Client,
    sample_bookmark: dict[str, Any],
) -> None:
    """Test creating a bookmark."""
    mock_api.post("/bookmarks/").mock(
        return_value=Response(201, json=sample_bookmark),
    )

    result = await mcp_client.call_tool(
        "create_bookmark",
        {"url": "https://example.com", "title": "Example", "tags": ["test"]},
    )

    assert result.data["id"] == "550e8400-e29b-41d4-a716-446655440001"


@pytest.mark.asyncio
async def test__create_bookmark__duplicate_active(mock_api, mcp_client: Client) -> None:
    """Test duplicate URL error (active bookmark exists)."""
    mock_api.post("/bookmarks/").mock(
        return_value=Response(
            409,
            json={
                "detail": {
                    "message": "URL already exists",
                    "error_code": "ACTIVE_URL_EXISTS",
                },
            },
        ),
    )

    result = await mcp_client.call_tool(
        "create_bookmark", {"url": "https://example.com"}, raise_on_error=False,
    )

    assert result.is_error
    assert "already exists" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__create_bookmark__archived_exists(mock_api, mcp_client: Client) -> None:
    """Test duplicate URL error (archived bookmark exists)."""
    archived_id = "550e8400-e29b-41d4-a716-446655440042"
    mock_api.post("/bookmarks/").mock(
        return_value=Response(
            409,
            json={
                "detail": {
                    "message": "Archived bookmark exists",
                    "error_code": "ARCHIVED_URL_EXISTS",
                    "existing_bookmark_id": archived_id,
                },
            },
        ),
    )

    result = await mcp_client.call_tool(
        "create_bookmark", {"url": "https://example.com"}, raise_on_error=False,
    )

    assert result.is_error
    error_text = result.content[0].text.lower()
    assert "archived" in error_text
    assert archived_id in result.content[0].text


# --- list_tags tests ---


@pytest.mark.asyncio
async def test__list_tags__success(
    mock_api,
    mcp_client: Client,
    sample_tags: dict[str, Any],
) -> None:
    """Test listing tags."""
    mock_api.get("/tags/").mock(
        return_value=Response(200, json=sample_tags),
    )

    result = await mcp_client.call_tool("list_tags", {})

    assert len(result.data["tags"]) == 3
    assert result.data["tags"][0]["name"] == "python"


# --- create_note tests ---


@pytest.mark.asyncio
async def test__create_note__success(
    mock_api,
    mcp_client: Client,
    sample_note: dict[str, Any],
) -> None:
    """Test creating a note."""
    mock_api.post("/notes/").mock(
        return_value=Response(201, json=sample_note),
    )

    result = await mcp_client.call_tool(
        "create_note",
        {
            "title": "Test Note",
            "content": "# Markdown Content",
            "tags": ["test"],
        },
    )

    assert result.data["id"] == "550e8400-e29b-41d4-a716-446655440002"
    assert result.data["title"] == "Test Note"


@pytest.mark.asyncio
async def test__create_note__minimal(
    mock_api,
    mcp_client: Client,
    sample_note: dict[str, Any],
) -> None:
    """Test creating a note with only required title."""
    mock_api.post("/notes/").mock(
        return_value=Response(201, json=sample_note),
    )

    result = await mcp_client.call_tool(
        "create_note",
        {"title": "Quick Note"},
    )

    assert result.data["id"] == "550e8400-e29b-41d4-a716-446655440002"


@pytest.mark.asyncio
async def test__create_note__api_error(mock_api, mcp_client: Client) -> None:
    """Test API error handling for note creation."""
    mock_api.post("/notes/").mock(
        return_value=Response(400, json={"detail": "Title is required"}),
    )

    result = await mcp_client.call_tool(
        "create_note", {"title": ""}, raise_on_error=False,
    )

    assert result.is_error


# --- edit_content tests ---


@pytest.mark.asyncio
async def test__edit_content__success(
    mock_api,
    mcp_client: Client,
    sample_str_replace_success: dict[str, Any],
) -> None:
    """Test successful content edit via str-replace."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    mock_api.patch(f"/notes/{note_id}/str-replace").mock(
        return_value=Response(200, json=sample_str_replace_success),
    )

    result = await mcp_client.call_tool(
        "edit_content",
        {
            "id": note_id,
            "type": "note",
            "old_str": "old text",
            "new_str": "new text",
        },
    )

    assert result.data["match_type"] == "exact"
    assert result.data["line"] == 3
    assert "data" in result.data


@pytest.mark.asyncio
async def test__edit_content__bookmark_success(
    mock_api,
    mcp_client: Client,
    sample_bookmark: dict[str, Any],
) -> None:
    """Test successful bookmark edit via str-replace."""
    bookmark_id = "550e8400-e29b-41d4-a716-446655440001"
    success_response = {
        "match_type": "whitespace_normalized",
        "line": 5,
        "data": sample_bookmark,
    }
    mock_api.patch(f"/bookmarks/{bookmark_id}/str-replace").mock(
        return_value=Response(200, json=success_response),
    )

    result = await mcp_client.call_tool(
        "edit_content",
        {
            "id": bookmark_id,
            "type": "bookmark",
            "old_str": "old content",
            "new_str": "new content",
        },
    )

    assert result.data["match_type"] == "whitespace_normalized"
    assert result.data["line"] == 5


@pytest.mark.asyncio
async def test__edit_content__no_match(
    mock_api,
    mcp_client: Client,
    sample_str_replace_no_match: dict[str, Any],
) -> None:
    """Test edit_content returns structured error for no matches."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    mock_api.patch(f"/notes/{note_id}/str-replace").mock(
        return_value=Response(400, json={"detail": sample_str_replace_no_match}),
    )

    result = await mcp_client.call_tool(
        "edit_content",
        {
            "id": note_id,
            "type": "note",
            "old_str": "nonexistent text",
            "new_str": "replacement",
        },
    )

    # Should return structured error (not raise ToolError)
    assert result.data.get("error") == "no_match"
    assert "message" in result.data
    assert "suggestion" in result.data


@pytest.mark.asyncio
async def test__edit_content__multiple_matches(
    mock_api,
    mcp_client: Client,
    sample_str_replace_multiple_matches: dict[str, Any],
) -> None:
    """Test edit_content returns structured error for multiple matches."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    mock_api.patch(f"/notes/{note_id}/str-replace").mock(
        return_value=Response(400, json={"detail": sample_str_replace_multiple_matches}),
    )

    result = await mcp_client.call_tool(
        "edit_content",
        {
            "id": note_id,
            "type": "note",
            "old_str": "common text",
            "new_str": "replacement",
        },
    )

    # Should return structured error with match locations
    assert result.data.get("error") == "multiple_matches"
    assert "matches" in result.data
    assert len(result.data["matches"]) == 2


@pytest.mark.asyncio
async def test__edit_content__not_found(mock_api, mcp_client: Client) -> None:
    """Test 404 error handling for edit_content."""
    missing_id = "00000000-0000-0000-0000-000000000000"
    mock_api.patch(f"/notes/{missing_id}/str-replace").mock(
        return_value=Response(404, json={"detail": "Not found"}),
    )

    result = await mcp_client.call_tool(
        "edit_content",
        {
            "id": missing_id,
            "type": "note",
            "old_str": "text",
            "new_str": "new text",
        },
        raise_on_error=False,
    )

    assert result.is_error
    assert "not found" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__edit_content__invalid_type(
    mock_api,  # noqa: ARG001 - needed to reset HTTP client
    mcp_client: Client,
) -> None:
    """Test error for invalid content type in edit_content."""
    result = await mcp_client.call_tool(
        "edit_content",
        {
            "id": "some-id",
            "type": "invalid",
            "old_str": "text",
            "new_str": "new",
        },
        raise_on_error=False,
    )

    assert result.is_error
    assert "invalid" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__edit_content__api_unavailable(mock_api, mcp_client: Client) -> None:
    """Test network error handling for edit_content."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    mock_api.patch(f"/notes/{note_id}/str-replace").mock(
        side_effect=httpx.ConnectError("Connection refused"),
    )

    result = await mcp_client.call_tool(
        "edit_content",
        {
            "id": note_id,
            "type": "note",
            "old_str": "text",
            "new_str": "new text",
        },
        raise_on_error=False,
    )

    assert result.is_error
    assert "unavailable" in result.content[0].text.lower()


# --- search_in_content tests ---


@pytest.mark.asyncio
async def test__search_in_content__success(
    mock_api,
    mcp_client: Client,
    sample_search_in_content: dict[str, Any],
) -> None:
    """Test successful within-content search."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    mock_api.get(f"/notes/{note_id}/search").mock(
        return_value=Response(200, json=sample_search_in_content),
    )

    result = await mcp_client.call_tool(
        "search_in_content",
        {"id": note_id, "type": "note", "query": "match"},
    )

    assert result.data["total_matches"] == 1
    assert len(result.data["matches"]) == 1
    assert result.data["matches"][0]["line"] == 3


@pytest.mark.asyncio
async def test__search_in_content__multiple_matches(
    mock_api,
    mcp_client: Client,
    sample_search_in_content_multiple: dict[str, Any],
) -> None:
    """Test search with multiple matches across fields."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    mock_api.get(f"/notes/{note_id}/search").mock(
        return_value=Response(200, json=sample_search_in_content_multiple),
    )

    result = await mcp_client.call_tool(
        "search_in_content",
        {"id": note_id, "type": "note", "query": "match"},
    )

    assert result.data["total_matches"] == 3
    assert len(result.data["matches"]) == 3
    # Check that title match has null line
    title_match = next(m for m in result.data["matches"] if m["field"] == "title")
    assert title_match["line"] is None


@pytest.mark.asyncio
async def test__search_in_content__no_matches(
    mock_api,
    mcp_client: Client,
    sample_search_in_content_empty: dict[str, Any],
) -> None:
    """Test search with no matches returns empty array (not error)."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    mock_api.get(f"/notes/{note_id}/search").mock(
        return_value=Response(200, json=sample_search_in_content_empty),
    )

    result = await mcp_client.call_tool(
        "search_in_content",
        {"id": note_id, "type": "note", "query": "nonexistent"},
    )

    assert result.data["total_matches"] == 0
    assert result.data["matches"] == []


@pytest.mark.asyncio
async def test__search_in_content__with_options(
    mock_api,
    mcp_client: Client,
    sample_search_in_content: dict[str, Any],
) -> None:
    """Test search with optional parameters."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    mock_api.get(f"/notes/{note_id}/search").mock(
        return_value=Response(200, json=sample_search_in_content),
    )

    await mcp_client.call_tool(
        "search_in_content",
        {
            "id": note_id,
            "type": "note",
            "query": "match",
            "fields": "content,title",
            "case_sensitive": True,
            "context_lines": 5,
        },
    )

    request_url = str(mock_api.calls[0].request.url)
    assert "fields=content" in request_url
    assert "case_sensitive=true" in request_url.lower()
    assert "context_lines=5" in request_url


@pytest.mark.asyncio
async def test__search_in_content__bookmark(
    mock_api,
    mcp_client: Client,
    sample_search_in_content: dict[str, Any],
) -> None:
    """Test search within a bookmark."""
    bookmark_id = "550e8400-e29b-41d4-a716-446655440001"
    mock_api.get(f"/bookmarks/{bookmark_id}/search").mock(
        return_value=Response(200, json=sample_search_in_content),
    )

    result = await mcp_client.call_tool(
        "search_in_content",
        {"id": bookmark_id, "type": "bookmark", "query": "match"},
    )

    assert result.data["total_matches"] == 1


@pytest.mark.asyncio
async def test__search_in_content__not_found(mock_api, mcp_client: Client) -> None:
    """Test 404 error handling for search_in_content."""
    missing_id = "00000000-0000-0000-0000-000000000000"
    mock_api.get(f"/notes/{missing_id}/search").mock(
        return_value=Response(404, json={"detail": "Not found"}),
    )

    result = await mcp_client.call_tool(
        "search_in_content",
        {"id": missing_id, "type": "note", "query": "text"},
        raise_on_error=False,
    )

    assert result.is_error
    assert "not found" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__search_in_content__invalid_type(
    mock_api,  # noqa: ARG001 - needed to reset HTTP client
    mcp_client: Client,
) -> None:
    """Test error for invalid content type in search_in_content."""
    result = await mcp_client.call_tool(
        "search_in_content",
        {"id": "some-id", "type": "invalid", "query": "text"},
        raise_on_error=False,
    )

    assert result.is_error
    assert "invalid" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__search_in_content__api_unavailable(mock_api, mcp_client: Client) -> None:
    """Test network error handling for search_in_content."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    mock_api.get(f"/notes/{note_id}/search").mock(
        side_effect=httpx.ConnectError("Connection refused"),
    )

    result = await mcp_client.call_tool(
        "search_in_content",
        {"id": note_id, "type": "note", "query": "text"},
        raise_on_error=False,
    )

    assert result.is_error
    assert "unavailable" in result.content[0].text.lower()
