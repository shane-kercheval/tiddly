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


@pytest.mark.asyncio
async def test__search_bookmarks__basic(
    mock_api,
    mcp_client: Client,
    sample_bookmark_list: dict[str, Any],
) -> None:
    """Test basic bookmark search."""
    mock_api.get("/bookmarks/").mock(
        return_value=Response(200, json=sample_bookmark_list),
    )

    result = await mcp_client.call_tool("search_bookmarks", {})

    assert result.data["total"] == 1
    assert len(result.data["items"]) == 1


@pytest.mark.asyncio
async def test__search_bookmarks__with_query(
    mock_api,
    mcp_client: Client,
    sample_bookmark_list: dict[str, Any],
) -> None:
    """Test search with query parameter."""
    mock_api.get("/bookmarks/").mock(
        return_value=Response(200, json=sample_bookmark_list),
    )

    await mcp_client.call_tool("search_bookmarks", {"query": "example"})

    assert "q" in str(mock_api.calls[0].request.url)


@pytest.mark.asyncio
async def test__search_bookmarks__with_tags(
    mock_api,
    mcp_client: Client,
    sample_bookmark_list: dict[str, Any],
) -> None:
    """Test search with tag filtering."""
    mock_api.get("/bookmarks/").mock(
        return_value=Response(200, json=sample_bookmark_list),
    )

    await mcp_client.call_tool(
        "search_bookmarks",
        {"tags": ["python", "web-dev"], "tag_match": "any"},
    )

    request_url = str(mock_api.calls[0].request.url)
    assert "tags" in request_url
    assert "tag_match=any" in request_url


@pytest.mark.asyncio
async def test__get_bookmark__success(
    mock_api,
    mcp_client: Client,
    sample_bookmark: dict[str, Any],
) -> None:
    """Test getting a bookmark by ID."""
    bookmark_id = "550e8400-e29b-41d4-a716-446655440001"
    mock_api.get(f"/bookmarks/{bookmark_id}").mock(
        return_value=Response(200, json=sample_bookmark),
    )

    result = await mcp_client.call_tool("get_bookmark", {"bookmark_id": bookmark_id})

    assert result.data["id"] == bookmark_id
    assert result.data["url"] == "https://example.com"


@pytest.mark.asyncio
async def test__get_bookmark__not_found(mock_api, mcp_client: Client) -> None:
    """Test 404 error handling."""
    missing_id = "00000000-0000-0000-0000-000000000000"
    mock_api.get(f"/bookmarks/{missing_id}").mock(
        return_value=Response(404, json={"detail": "Not found"}),
    )

    result = await mcp_client.call_tool(
        "get_bookmark", {"bookmark_id": missing_id}, raise_on_error=False,
    )

    assert result.is_error
    assert "not found" in result.content[0].text.lower()


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


@pytest.mark.asyncio
async def test__search_bookmarks__api_unavailable(mock_api, mcp_client: Client) -> None:
    """Test network error handling."""
    mock_api.get("/bookmarks/").mock(side_effect=httpx.ConnectError("Connection refused"))

    result = await mcp_client.call_tool("search_bookmarks", {}, raise_on_error=False)

    assert result.is_error
    assert "unavailable" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__search_bookmarks__invalid_token(mock_api) -> None:
    """Test 401 error handling for invalid token."""
    from mcp_server.server import mcp

    mock_api.get("/bookmarks/").mock(
        return_value=Response(401, json={"detail": "Invalid token"}),
    )

    with patch("mcp_server.server.get_bearer_token") as mock_auth:
        mock_auth.return_value = "invalid_token"
        async with Client(transport=mcp) as client:
            result = await client.call_tool("search_bookmarks", {}, raise_on_error=False)

    assert result.is_error
    error_text = result.content[0].text.lower()
    assert "invalid" in error_text or "expired" in error_text


# --- search_notes tests ---


@pytest.mark.asyncio
async def test__search_notes__basic(
    mock_api,
    mcp_client: Client,
    sample_note_list: dict[str, Any],
) -> None:
    """Test basic note search."""
    mock_api.get("/notes/").mock(
        return_value=Response(200, json=sample_note_list),
    )

    result = await mcp_client.call_tool("search_notes", {})

    assert result.data["total"] == 1
    assert len(result.data["items"]) == 1


@pytest.mark.asyncio
async def test__search_notes__with_query(
    mock_api,
    mcp_client: Client,
    sample_note_list: dict[str, Any],
) -> None:
    """Test note search with query parameter."""
    mock_api.get("/notes/").mock(
        return_value=Response(200, json=sample_note_list),
    )

    await mcp_client.call_tool("search_notes", {"query": "meeting"})

    assert "q" in str(mock_api.calls[0].request.url)


@pytest.mark.asyncio
async def test__search_notes__with_tags(
    mock_api,
    mcp_client: Client,
    sample_note_list: dict[str, Any],
) -> None:
    """Test note search with tag filtering."""
    mock_api.get("/notes/").mock(
        return_value=Response(200, json=sample_note_list),
    )

    await mcp_client.call_tool(
        "search_notes",
        {"tags": ["work", "important"], "tag_match": "any"},
    )

    request_url = str(mock_api.calls[0].request.url)
    assert "tags" in request_url
    assert "tag_match=any" in request_url


@pytest.mark.asyncio
async def test__search_notes__api_unavailable(mock_api, mcp_client: Client) -> None:
    """Test network error handling for note search."""
    mock_api.get("/notes/").mock(side_effect=httpx.ConnectError("Connection refused"))

    result = await mcp_client.call_tool("search_notes", {}, raise_on_error=False)

    assert result.is_error
    assert "unavailable" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__search_notes__invalid_token(mock_api) -> None:
    """Test 401 error handling for invalid token."""
    from mcp_server.server import mcp

    mock_api.get("/notes/").mock(
        return_value=Response(401, json={"detail": "Invalid token"}),
    )

    with patch("mcp_server.server.get_bearer_token") as mock_auth:
        mock_auth.return_value = "invalid_token"
        async with Client(transport=mcp) as client:
            result = await client.call_tool("search_notes", {}, raise_on_error=False)

    assert result.is_error
    error_text = result.content[0].text.lower()
    assert "invalid" in error_text or "expired" in error_text


# --- get_note tests ---


@pytest.mark.asyncio
async def test__get_note__success(
    mock_api,
    mcp_client: Client,
    sample_note: dict[str, Any],
) -> None:
    """Test getting a note by ID."""
    note_id = "550e8400-e29b-41d4-a716-446655440002"
    mock_api.get(f"/notes/{note_id}").mock(
        return_value=Response(200, json=sample_note),
    )

    result = await mcp_client.call_tool("get_note", {"note_id": note_id})

    assert result.data["id"] == note_id
    assert result.data["title"] == "Test Note"
    assert result.data["content"] is not None


@pytest.mark.asyncio
async def test__get_note__not_found(mock_api, mcp_client: Client) -> None:
    """Test 404 error handling for notes."""
    missing_id = "00000000-0000-0000-0000-000000000000"
    mock_api.get(f"/notes/{missing_id}").mock(
        return_value=Response(404, json={"detail": "Not found"}),
    )

    result = await mcp_client.call_tool(
        "get_note", {"note_id": missing_id}, raise_on_error=False,
    )

    assert result.is_error
    assert "not found" in result.content[0].text.lower()


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


# --- search_all_content tests ---


@pytest.mark.asyncio
async def test__search_all_content__basic(
    mock_api,
    mcp_client: Client,
    sample_content_list: dict[str, Any],
) -> None:
    """Test unified content search."""
    mock_api.get("/content/").mock(
        return_value=Response(200, json=sample_content_list),
    )

    result = await mcp_client.call_tool("search_all_content", {})

    assert result.data["total"] == 2
    assert len(result.data["items"]) == 2
    types = [item["type"] for item in result.data["items"]]
    assert "bookmark" in types
    assert "note" in types


@pytest.mark.asyncio
async def test__search_all_content__with_query(
    mock_api,
    mcp_client: Client,
    sample_content_list: dict[str, Any],
) -> None:
    """Test unified search with query parameter."""
    mock_api.get("/content/").mock(
        return_value=Response(200, json=sample_content_list),
    )

    await mcp_client.call_tool("search_all_content", {"query": "python"})

    assert "q" in str(mock_api.calls[0].request.url)


@pytest.mark.asyncio
async def test__search_all_content__api_unavailable(mock_api, mcp_client: Client) -> None:
    """Test network error handling for unified search."""
    mock_api.get("/content/").mock(side_effect=httpx.ConnectError("Connection refused"))

    result = await mcp_client.call_tool("search_all_content", {}, raise_on_error=False)

    assert result.is_error
    assert "unavailable" in result.content[0].text.lower()
