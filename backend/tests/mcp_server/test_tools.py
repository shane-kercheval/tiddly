"""Tests for MCP tools using FastMCP Client."""

from typing import Any
from unittest.mock import patch

import httpx
import pytest
from httpx import Response

from fastmcp import Client

from mcp_server.server import _format_content_context_markdown, _format_filter_expression


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


@pytest.mark.asyncio
async def test__search_items__forbidden(mock_api) -> None:
    """Test 403 forbidden error handling."""
    from mcp_server.server import mcp

    mock_api.get("/content/").mock(
        return_value=Response(403, json={"detail": "Access denied"}),
    )

    with patch("mcp_server.server.get_bearer_token") as mock_auth:
        mock_auth.return_value = "valid_token"
        async with Client(transport=mcp) as client:
            result = await client.call_tool("search_items", {}, raise_on_error=False)

    assert result.is_error
    assert "access denied" in result.content[0].text.lower()


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


# --- update_item tests ---


@pytest.mark.asyncio
async def test__update_item__note_metadata_success(
    mock_api,
    mcp_client: Client,
    sample_note: dict[str, Any],
) -> None:
    """Test updating note metadata returns structured dict."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    updated_note = {
        **sample_note,
        "title": "Updated Title",
        "tags": ["new-tag"],
        "updated_at": "2024-01-02T00:00:00Z",
    }
    mock_api.patch(f"/notes/{note_id}").mock(
        return_value=Response(200, json=updated_note),
    )

    result = await mcp_client.call_tool(
        "update_item",
        {"id": note_id, "type": "note", "title": "Updated Title", "tags": ["new-tag"]},
    )

    # Returns structured dict with id, updated_at, summary
    assert result.data["id"] == note_id
    assert result.data["updated_at"] == "2024-01-02T00:00:00Z"
    assert "Updated note" in result.data["summary"]
    assert "title updated" in result.data["summary"]
    assert "tags updated" in result.data["summary"]


@pytest.mark.asyncio
async def test__update_item__bookmark_with_url(
    mock_api,
    mcp_client: Client,
    sample_bookmark: dict[str, Any],
) -> None:
    """Test updating bookmark metadata including URL returns structured dict."""
    bookmark_id = "550e8400-e29b-41d4-a716-446655440001"
    updated_bookmark = {
        **sample_bookmark,
        "url": "https://new-url.com",
        "updated_at": "2024-01-02T00:00:00Z",
    }
    mock_api.patch(f"/bookmarks/{bookmark_id}").mock(
        return_value=Response(200, json=updated_bookmark),
    )

    result = await mcp_client.call_tool(
        "update_item",
        {"id": bookmark_id, "type": "bookmark", "url": "https://new-url.com"},
    )

    # Returns structured dict
    assert result.data["id"] == bookmark_id
    assert result.data["updated_at"] == "2024-01-02T00:00:00Z"
    assert "Updated bookmark" in result.data["summary"]
    assert "url updated" in result.data["summary"]


@pytest.mark.asyncio
async def test__update_item__updates_description(
    mock_api,
    mcp_client: Client,
    sample_note: dict[str, Any],
) -> None:
    """Test updating item description returns structured dict."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    updated_note = {
        **sample_note,
        "description": "Updated description",
        "updated_at": "2024-01-02T00:00:00Z",
    }
    mock_api.patch(f"/notes/{note_id}").mock(
        return_value=Response(200, json=updated_note),
    )

    result = await mcp_client.call_tool(
        "update_item",
        {"id": note_id, "type": "note", "description": "Updated description"},
    )

    assert result.data["id"] == note_id
    assert "description updated" in result.data["summary"]


@pytest.mark.asyncio
async def test__update_item__content_replacement(
    mock_api,
    mcp_client: Client,
    sample_note: dict[str, Any],
) -> None:
    """Test updating item content with full replacement."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    updated_note = {
        **sample_note,
        "content": "Completely new content",
        "updated_at": "2024-01-02T00:00:00Z",
    }
    mock_api.patch(f"/notes/{note_id}").mock(
        return_value=Response(200, json=updated_note),
    )

    result = await mcp_client.call_tool(
        "update_item",
        {"id": note_id, "type": "note", "content": "Completely new content"},
    )

    assert result.data["id"] == note_id
    assert "content updated" in result.data["summary"]

    # Verify payload was sent correctly
    import json
    payload = json.loads(mock_api.calls[0].request.content)
    assert payload["content"] == "Completely new content"


@pytest.mark.asyncio
async def test__update_item__metadata_and_content_together(
    mock_api,
    mcp_client: Client,
    sample_note: dict[str, Any],
) -> None:
    """Test updating both metadata and content in a single call."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    updated_note = {
        **sample_note,
        "title": "New Title",
        "content": "New content",
        "tags": ["updated"],
        "updated_at": "2024-01-02T00:00:00Z",
    }
    mock_api.patch(f"/notes/{note_id}").mock(
        return_value=Response(200, json=updated_note),
    )

    result = await mcp_client.call_tool(
        "update_item",
        {
            "id": note_id,
            "type": "note",
            "title": "New Title",
            "content": "New content",
            "tags": ["updated"],
        },
    )

    assert result.data["id"] == note_id
    assert "title updated" in result.data["summary"]
    assert "content updated" in result.data["summary"]
    assert "tags updated" in result.data["summary"]


@pytest.mark.asyncio
async def test__update_item__with_expected_updated_at_success(
    mock_api,
    mcp_client: Client,
    sample_note: dict[str, Any],
) -> None:
    """Test update_item with valid expected_updated_at succeeds."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    updated_note = {
        **sample_note,
        "title": "New Title",
        "updated_at": "2024-01-02T00:00:00Z",
    }
    mock_api.patch(f"/notes/{note_id}").mock(
        return_value=Response(200, json=updated_note),
    )

    result = await mcp_client.call_tool(
        "update_item",
        {
            "id": note_id,
            "type": "note",
            "title": "New Title",
            "expected_updated_at": "2024-01-01T00:00:00Z",
        },
    )

    assert result.data["id"] == note_id
    assert "title updated" in result.data["summary"]
    # expected_updated_at should NOT appear in summary (it's a control param)
    assert "expected_updated_at" not in result.data["summary"]

    # Verify expected_updated_at was sent in payload
    import json
    payload = json.loads(mock_api.calls[0].request.content)
    assert payload["expected_updated_at"] == "2024-01-01T00:00:00Z"


@pytest.mark.asyncio
async def test__update_item__conflict_returns_server_state(
    mock_api,
    mcp_client: Client,
    sample_note: dict[str, Any],
) -> None:
    """Test update_item with stale expected_updated_at returns conflict with server_state."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    current_server_state = {
        **sample_note,
        "title": "Someone else's title",
        "updated_at": "2024-01-02T00:00:00Z",
    }
    mock_api.patch(f"/notes/{note_id}").mock(
        return_value=Response(
            409,
            json={
                "detail": {
                    "error": "conflict",
                    "message": "This item was modified since you loaded it",
                    "server_state": current_server_state,
                },
            },
        ),
    )

    result = await mcp_client.call_tool(
        "update_item",
        {
            "id": note_id,
            "type": "note",
            "title": "My title",
            "expected_updated_at": "2024-01-01T00:00:00Z",
        },
    )

    # Should return structured conflict response (not error)
    assert result.data["error"] == "conflict"
    assert "modified" in result.data["message"].lower()
    assert result.data["server_state"]["title"] == "Someone else's title"
    assert result.data["server_state"]["updated_at"] == "2024-01-02T00:00:00Z"


@pytest.mark.asyncio
async def test__update_item__name_conflict_raises_error(
    mock_api,
    mcp_client: Client,
) -> None:
    """Test 409 name conflict (no server_state) raises ToolError with API-provided message."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    mock_api.patch(f"/notes/{note_id}").mock(
        return_value=Response(
            409,
            json={"detail": {"message": "A note with this name already exists", "error_code": "NAME_CONFLICT"}},
        ),
    )

    result = await mcp_client.call_tool(
        "update_item",
        {"id": note_id, "type": "note", "title": "New Title"},
        raise_on_error=False,
    )

    assert result.is_error
    assert "already exists" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__update_item__name_conflict_string_detail_preserved(
    mock_api,
    mcp_client: Client,
) -> None:
    """Test 409 with string detail preserves the server-provided message."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    mock_api.patch(f"/notes/{note_id}").mock(
        return_value=Response(
            409,
            json={"detail": "Custom conflict message from server"},
        ),
    )

    result = await mcp_client.call_tool(
        "update_item",
        {"id": note_id, "type": "note", "title": "New Title"},
        raise_on_error=False,
    )

    assert result.is_error
    assert "custom conflict message" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__update_item__note_url_error(
    mock_api,  # noqa: ARG001 - needed to reset HTTP client
    mcp_client: Client,
) -> None:
    """Test that url parameter raises error for notes."""
    result = await mcp_client.call_tool(
        "update_item",
        {"id": "some-id", "type": "note", "url": "https://example.com"},
        raise_on_error=False,
    )

    assert result.is_error
    assert "url" in result.content[0].text.lower()
    assert "bookmark" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__update_item__no_fields_error(
    mock_api,  # noqa: ARG001 - needed to reset HTTP client
    mcp_client: Client,
) -> None:
    """Test that at least one data field must be provided."""
    result = await mcp_client.call_tool(
        "update_item",
        {"id": "some-id", "type": "note"},
        raise_on_error=False,
    )

    assert result.is_error
    assert "at least one" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__update_item__expected_updated_at_alone_not_sufficient(
    mock_api,  # noqa: ARG001 - needed to reset HTTP client
    mcp_client: Client,
) -> None:
    """Test that expected_updated_at alone doesn't satisfy the 'at least one field' requirement."""
    result = await mcp_client.call_tool(
        "update_item",
        {
            "id": "some-id",
            "type": "note",
            "expected_updated_at": "2024-01-01T00:00:00Z",
        },
        raise_on_error=False,
    )

    assert result.is_error
    assert "at least one" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__update_item__not_found(mock_api, mcp_client: Client) -> None:
    """Test 404 error handling for update_item."""
    missing_id = "00000000-0000-0000-0000-000000000000"
    mock_api.patch(f"/notes/{missing_id}").mock(
        return_value=Response(404, json={"detail": "Not found"}),
    )

    result = await mcp_client.call_tool(
        "update_item",
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


# --- _format_filter_expression unit tests ---


def test__format_filter_expression__single_tag() -> None:
    """Single tag group renders without parentheses."""
    expr = {"groups": [{"tags": ["python"]}], "group_operator": "OR"}
    assert _format_filter_expression(expr) == "python"


def test__format_filter_expression__multi_tag_group() -> None:
    """Multiple tags in one group are joined with AND."""
    expr = {"groups": [{"tags": ["work", "project"]}], "group_operator": "OR"}
    assert _format_filter_expression(expr) == "(work AND project)"


def test__format_filter_expression__multiple_groups_or() -> None:
    """Multiple groups joined with OR operator."""
    expr = {
        "groups": [{"tags": ["work", "project"]}, {"tags": ["client"]}],
        "group_operator": "OR",
    }
    assert _format_filter_expression(expr) == "(work AND project) OR client"


def test__format_filter_expression__empty() -> None:
    """Empty expression returns 'All items'."""
    assert _format_filter_expression({}) == "All items"
    assert _format_filter_expression({"groups": []}) == "All items"


def test__format_filter_expression__empty_tags_in_group() -> None:
    """Groups with empty tags are skipped."""
    expr = {"groups": [{"tags": []}], "group_operator": "OR"}
    assert _format_filter_expression(expr) == "All items"


# --- _format_content_context_markdown unit tests ---


@pytest.fixture
def sample_context_response() -> dict[str, Any]:
    """Sample content context API response."""
    return {
        "generated_at": "2026-01-25T10:30:00Z",
        "counts": {
            "bookmarks": {"active": 150, "archived": 25},
            "notes": {"active": 75, "archived": 5},
        },
        "top_tags": [
            {"name": "python", "content_count": 45, "filter_count": 3},
            {"name": "reference", "content_count": 38, "filter_count": 2},
        ],
        "filters": [
            {
                "id": "a1b2c3d4-e29b-41d4-a716-446655440000",
                "name": "Work Projects",
                "content_types": ["bookmark", "note"],
                "filter_expression": {
                    "groups": [{"tags": ["work", "project"]}, {"tags": ["client"]}],
                    "group_operator": "OR",
                },
                "items": [
                    {
                        "type": "note",
                        "id": "2b3c4d5e-e29b-41d4-a716-446655440000",
                        "title": "Client Onboarding Checklist",
                        "description": None,
                        "content_preview": "Steps for onboarding new clients...",
                        "tags": ["work", "project", "client"],
                        "last_used_at": "2026-01-25T08:00:00Z",
                        "created_at": "2026-01-20T08:00:00Z",
                        "updated_at": "2026-01-24T14:00:00Z",
                    },
                ],
            },
            {
                "id": "b2c3d4e5-e29b-41d4-a716-446655440000",
                "name": "Learning",
                "content_types": ["bookmark"],
                "filter_expression": {
                    "groups": [{"tags": ["tutorial"]}],
                    "group_operator": "OR",
                },
                "items": [],
            },
        ],
        "sidebar_items": [
            {
                "type": "filter",
                "id": "a1b2c3d4-e29b-41d4-a716-446655440000",
                "name": "Work Projects",
            },
            {
                "type": "collection",
                "name": "Study Materials",
                "items": [
                    {"type": "filter", "id": "b2c3d4e5-e29b-41d4-a716-446655440000", "name": "Learning"},
                ],
            },
        ],
        "recently_used": [
            {
                "type": "bookmark",
                "id": "f47ac10b-e29b-41d4-a716-446655440000",
                "title": "Python Documentation",
                "description": "Official Python 3.x documentation",
                "content_preview": "The Python Language Reference...",
                "tags": ["python", "reference"],
                "last_used_at": "2026-01-25T08:30:00Z",
                "created_at": "2026-01-10T08:00:00Z",
                "updated_at": "2026-01-24T14:00:00Z",
            },
        ],
        "recently_created": [],
        "recently_modified": [],
    }


def test__format_content_context_markdown__has_all_sections(
    sample_context_response: dict[str, Any],
) -> None:
    """Verify all expected sections are present in markdown output."""
    md = _format_content_context_markdown(sample_context_response)
    assert "# Content Context" in md
    assert "## Overview" in md
    assert "## Top Tags" in md
    assert "## Filters" in md
    assert "## Sidebar Organization" in md
    assert "## Filter Contents" in md
    assert "## Recently Used" in md


def test__format_content_context_markdown__overview_counts(
    sample_context_response: dict[str, Any],
) -> None:
    """Verify overview section has correct counts."""
    md = _format_content_context_markdown(sample_context_response)
    assert "150 active, 25 archived" in md
    assert "75 active, 5 archived" in md


def test__format_content_context_markdown__tags_table(
    sample_context_response: dict[str, Any],
) -> None:
    """Verify tags rendered as markdown table."""
    md = _format_content_context_markdown(sample_context_response)
    assert "| python | 45 | 3 |" in md
    assert "| reference | 38 | 2 |" in md


def test__format_content_context_markdown__filter_expression(
    sample_context_response: dict[str, Any],
) -> None:
    """Verify filter expression rendered as human-readable rule."""
    md = _format_content_context_markdown(sample_context_response)
    assert "(work AND project) OR client" in md


def test__format_content_context_markdown__filter_items(
    sample_context_response: dict[str, Any],
) -> None:
    """Verify filter items include type, id, title, tags, and preview."""
    md = _format_content_context_markdown(sample_context_response)
    assert "Client Onboarding Checklist" in md
    assert "[note 2b3c4d5e-e29b-41d4-a716-446655440000]" in md
    assert "Tags: work, project, client" in md
    assert "Preview: Steps for onboarding new clients..." in md


def test__format_content_context_markdown__description_when_present(
    sample_context_response: dict[str, Any],
) -> None:
    """Verify description is included when present, omitted when None."""
    md = _format_content_context_markdown(sample_context_response)
    # The recently_used item has a description
    assert "Description: Official Python 3.x documentation" in md


def test__format_content_context_markdown__sidebar_full_tree(
    sample_context_response: dict[str, Any],
) -> None:
    """Verify sidebar shows root-level filters and collections interleaved."""
    md = _format_content_context_markdown(sample_context_response)
    # Root-level filter (Work Projects is not in any collection)
    assert "- Work Projects `[filter a1b2c3d4" in md
    # Collection with nested filter
    assert "[collection] Study Materials" in md
    assert "  - Learning `[filter b2c3d4e5" in md

    # Verify ordering: Work Projects before Study Materials
    wp_pos = md.index("- Work Projects")
    sm_pos = md.index("[collection] Study Materials")
    assert wp_pos < sm_pos, "Root-level filter should appear before collection"


def test__format_content_context_markdown__deduplication(
    sample_context_response: dict[str, Any],
) -> None:
    """Items seen in filter contents are abbreviated in recent sections."""
    # Add the same item ID to recently_used that appears in filters
    sample_context_response["recently_used"].insert(0, {
        "type": "note",
        "id": "2b3c4d5e-e29b-41d4-a716-446655440000",
        "title": "Client Onboarding Checklist",
        "description": None,
        "content_preview": "Steps for onboarding new clients...",
        "tags": ["work", "project", "client"],
        "last_used_at": "2026-01-25T09:00:00Z",
        "created_at": "2026-01-20T08:00:00Z",
        "updated_at": "2026-01-24T14:00:00Z",
    })
    md = _format_content_context_markdown(sample_context_response)
    # The item should appear abbreviated in Recently Used
    lines = md.split("\n")
    in_recently_used = False
    found_abbreviated = False
    for i, line in enumerate(lines):
        if "## Recently Used" in line:
            in_recently_used = True
        elif line.startswith("## ") and in_recently_used:
            break
        elif in_recently_used and "2b3c4d5e" in line and "Client Onboarding" in line:
            nearby = "\n".join(lines[i:i + 4])
            if "(see above)" in nearby:
                found_abbreviated = True
    assert found_abbreviated, "Duplicate item should be abbreviated with '(see above)'"


def test__format_content_context_markdown__empty_state() -> None:
    """Empty state produces valid markdown with zero counts."""
    data: dict[str, Any] = {
        "generated_at": "2026-01-25T10:30:00Z",
        "counts": {
            "bookmarks": {"active": 0, "archived": 0},
            "notes": {"active": 0, "archived": 0},
        },
        "top_tags": [],
        "filters": [],
        "sidebar_items": [],
        "recently_used": [],
        "recently_created": [],
        "recently_modified": [],
    }
    md = _format_content_context_markdown(data)
    assert "# Content Context" in md
    assert "## Overview" in md
    assert "0 active, 0 archived" in md
    # No filter/tag sections when empty
    assert "## Top Tags" not in md
    assert "## Filters" not in md
    assert "## Recently Used" not in md


def test__format_content_context_markdown__sidebar_omitted_without_collections() -> None:
    """Sidebar section is omitted when no collections exist."""
    data: dict[str, Any] = {
        "generated_at": "2026-01-25T10:30:00Z",
        "counts": {"bookmarks": {"active": 1, "archived": 0}, "notes": {"active": 0, "archived": 0}},
        "top_tags": [],
        "filters": [{"id": "aaa", "name": "F1", "content_types": ["bookmark"],
                      "filter_expression": {"groups": [{"tags": ["x"]}]}, "items": []}],
        "sidebar_items": [],
        "recently_used": [], "recently_created": [], "recently_modified": [],
    }
    md = _format_content_context_markdown(data)
    assert "## Sidebar Organization" not in md


def test__format_content_context_markdown__last_used_at_in_recent(
    sample_context_response: dict[str, Any],
) -> None:
    """Recently used items show Last used timestamp."""
    md = _format_content_context_markdown(sample_context_response)
    assert "Last used: 2026-01-25T08:30:00Z" in md


def test__format_content_context_markdown__created_at_in_recent() -> None:
    """Recently created items show Created timestamp."""
    data: dict[str, Any] = {
        "generated_at": "2026-01-25T10:30:00Z",
        "counts": {"bookmarks": {"active": 1, "archived": 0}, "notes": {"active": 0, "archived": 0}},
        "top_tags": [], "filters": [], "sidebar_items": [],
        "recently_used": [],
        "recently_created": [{
            "type": "note", "id": "aaa-bbb", "title": "New Note",
            "description": None, "content_preview": "Content...",
            "tags": ["ideas"], "last_used_at": None,
            "created_at": "2026-01-25T07:30:00Z", "updated_at": "2026-01-25T07:30:00Z",
        }],
        "recently_modified": [],
    }
    md = _format_content_context_markdown(data)
    assert "## Recently Created" in md
    assert "Created: 2026-01-25T07:30:00Z" in md


def test__format_content_context_markdown__modified_at_in_recent() -> None:
    """Recently modified items show Modified timestamp."""
    data: dict[str, Any] = {
        "generated_at": "2026-01-25T10:30:00Z",
        "counts": {"bookmarks": {"active": 1, "archived": 0}, "notes": {"active": 0, "archived": 0}},
        "top_tags": [], "filters": [], "sidebar_items": [],
        "recently_used": [], "recently_created": [],
        "recently_modified": [{
            "type": "note", "id": "ccc-ddd", "title": "Edited Note",
            "description": None, "content_preview": "Updated...",
            "tags": [], "last_used_at": None,
            "created_at": "2026-01-20T09:00:00Z", "updated_at": "2026-01-25T09:30:00Z",
        }],
    }
    md = _format_content_context_markdown(data)
    assert "## Recently Modified" in md
    assert "Modified: 2026-01-25T09:30:00Z" in md


# --- get_context tool integration tests ---


@pytest.mark.asyncio
async def test__get_context__returns_markdown(
    mock_api,
    mcp_client: Client,
    sample_context_response: dict[str, Any],
) -> None:
    """get_context tool returns markdown string with expected sections."""
    mock_api.get("/mcp/context/content").mock(
        return_value=Response(200, json=sample_context_response),
    )

    result = await mcp_client.call_tool("get_context", {})

    text = result.content[0].text
    assert "# Content Context" in text
    assert "## Overview" in text
    assert "## Top Tags" in text


@pytest.mark.asyncio
async def test__get_context__passes_parameters(
    mock_api,
    mcp_client: Client,
    sample_context_response: dict[str, Any],
) -> None:
    """get_context passes query parameters to API."""
    mock_api.get("/mcp/context/content").mock(
        return_value=Response(200, json=sample_context_response),
    )

    await mcp_client.call_tool("get_context", {
        "tag_limit": 10,
        "recent_limit": 5,
        "filter_limit": 3,
        "filter_item_limit": 2,
    })

    request_url = str(mock_api.calls[0].request.url)
    assert "tag_limit=10" in request_url
    assert "recent_limit=5" in request_url
    assert "filter_limit=3" in request_url
    assert "filter_item_limit=2" in request_url


@pytest.mark.asyncio
async def test__get_context__auth_error(
    mock_api,
    mcp_client: Client,
) -> None:
    """get_context returns error on 401."""
    mock_api.get("/mcp/context/content").mock(
        return_value=Response(401, json={"detail": "Not authenticated"}),
    )

    result = await mcp_client.call_tool("get_context", {}, raise_on_error=False)
    assert result.is_error


@pytest.mark.asyncio
async def test__get_context__api_unavailable(
    mock_api,
    mcp_client: Client,
) -> None:
    """get_context handles network errors."""
    mock_api.get("/mcp/context/content").mock(
        side_effect=httpx.ConnectError("Connection refused"),
    )

    result = await mcp_client.call_tool("get_context", {}, raise_on_error=False)
    assert result.is_error
    assert "unavailable" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__get_context__tool_in_list(
    mock_api,  # noqa: ARG001 - needed to reset HTTP client
    mcp_client: Client,
) -> None:
    """get_context tool appears in the tool list."""
    tools = await mcp_client.list_tools()
    tool_names = [t.name for t in tools]
    assert "get_context" in tool_names
