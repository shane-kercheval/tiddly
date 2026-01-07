"""Test fixtures for MCP server tests."""

from typing import Any
from unittest.mock import patch

import pytest
import respx

from mcp_server import server


@pytest.fixture
def mock_api() -> respx.MockRouter:
    """Context manager for mocking API responses."""
    # Reset the module-level HTTP client to ensure respx captures requests
    server._http_client = None
    with respx.mock(base_url="http://localhost:8000") as respx_mock:
        yield respx_mock
    # Clean up after test
    server._http_client = None


@pytest.fixture
def mock_auth():
    """Mock authentication for tool tests."""
    with patch("mcp_server.server.get_bearer_token") as mock:
        mock.return_value = "bm_test_token"
        yield mock


@pytest.fixture
def sample_bookmark() -> dict[str, Any]:
    """Sample bookmark response data."""
    return {
        "id": "550e8400-e29b-41d4-a716-446655440001",
        "url": "https://example.com",
        "title": "Example Site",
        "description": "An example website",
        "content": "Page content here",
        "tags": ["example", "test"],
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
        "last_used_at": "2024-01-01T00:00:00Z",
        "deleted_at": None,
        "archived_at": None,
    }


@pytest.fixture
def sample_bookmark_list(sample_bookmark: dict[str, Any]) -> dict[str, Any]:
    """Sample paginated bookmark list response."""
    return {
        "items": [sample_bookmark],
        "total": 1,
        "offset": 0,
        "limit": 50,
        "has_more": False,
    }


@pytest.fixture
def sample_tags() -> dict[str, Any]:
    """Sample tags response data."""
    return {
        "tags": [
            {"name": "python", "count": 10},
            {"name": "javascript", "count": 5},
            {"name": "web-dev", "count": 3},
        ],
    }


@pytest.fixture
def sample_note() -> dict[str, Any]:
    """Sample note response data."""
    return {
        "id": "550e8400-e29b-41d4-a716-446655440002",
        "title": "Test Note",
        "description": "A test note description",
        "content": "# Markdown Content\n\nThis is the note body.",
        "tags": ["notes", "test"],
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
        "last_used_at": "2024-01-01T00:00:00Z",
        "deleted_at": None,
        "archived_at": None,
        "version": 1,
    }


@pytest.fixture
def sample_note_list(sample_note: dict[str, Any]) -> dict[str, Any]:
    """Sample paginated note list response."""
    return {
        "items": [sample_note],
        "total": 1,
        "offset": 0,
        "limit": 50,
        "has_more": False,
    }


@pytest.fixture
def sample_content_list(
    sample_bookmark: dict[str, Any], sample_note: dict[str, Any],
) -> dict[str, Any]:
    """Sample unified content search response."""
    bookmark_item = {
        "type": "bookmark",
        "id": sample_bookmark["id"],
        "title": sample_bookmark["title"],
        "description": sample_bookmark["description"],
        "tags": sample_bookmark["tags"],
        "created_at": sample_bookmark["created_at"],
        "updated_at": sample_bookmark["updated_at"],
        "last_used_at": sample_bookmark["last_used_at"],
        "deleted_at": sample_bookmark["deleted_at"],
        "archived_at": sample_bookmark["archived_at"],
        "url": sample_bookmark["url"],
        "version": None,
    }
    note_item = {
        "type": "note",
        "id": sample_note["id"],
        "title": sample_note["title"],
        "description": sample_note["description"],
        "tags": sample_note["tags"],
        "created_at": sample_note["created_at"],
        "updated_at": sample_note["updated_at"],
        "last_used_at": sample_note["last_used_at"],
        "deleted_at": sample_note["deleted_at"],
        "archived_at": sample_note["archived_at"],
        "url": None,
        "version": sample_note["version"],
    }
    return {
        "items": [bookmark_item, note_item],
        "total": 2,
        "offset": 0,
        "limit": 50,
        "has_more": False,
    }
