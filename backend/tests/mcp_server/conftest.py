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
    }
    return {
        "items": [bookmark_item, note_item],
        "total": 2,
        "offset": 0,
        "limit": 50,
        "has_more": False,
    }


@pytest.fixture
def sample_bookmark_with_metadata(sample_bookmark: dict[str, Any]) -> dict[str, Any]:
    """Sample bookmark response with content_metadata for partial reads."""
    return {
        **sample_bookmark,
        "content_metadata": {
            "total_lines": 10,
            "start_line": 1,
            "end_line": 10,
            "is_partial": False,
        },
    }


@pytest.fixture
def sample_note_with_metadata(sample_note: dict[str, Any]) -> dict[str, Any]:
    """Sample note response with content_metadata for partial reads."""
    return {
        **sample_note,
        "content_metadata": {
            "total_lines": 5,
            "start_line": 1,
            "end_line": 5,
            "is_partial": False,
        },
    }


@pytest.fixture
def sample_str_replace_success(sample_note: dict[str, Any]) -> dict[str, Any]:
    """Sample successful str-replace response."""
    return {
        "match_type": "exact",
        "line": 3,
        "data": sample_note,
    }


@pytest.fixture
def sample_str_replace_no_match() -> dict[str, Any]:
    """Sample str-replace error response for no matches."""
    return {
        "error": "no_match",
        "message": "The specified text was not found in the content",
        "suggestion": "Verify the text exists and check for whitespace differences",
    }


@pytest.fixture
def sample_str_replace_multiple_matches() -> dict[str, Any]:
    """Sample str-replace error response for multiple matches."""
    return {
        "error": "multiple_matches",
        "matches": [
            {
                "line": 15,
                "context": "line 13 content\nline 14 content\nline 15 with match\nline 16 content\nline 17 content",
            },
            {
                "line": 47,
                "context": "line 45 content\nline 46 content\nline 47 with match\nline 48 content\nline 49 content",
            },
        ],
        "suggestion": "Include more surrounding context to ensure uniqueness",
    }


@pytest.fixture
def sample_search_in_content() -> dict[str, Any]:
    """Sample within-content search response."""
    return {
        "matches": [
            {
                "field": "content",
                "line": 3,
                "context": "line 1 content\nline 2 content\nline 3 with match\nline 4 content\nline 5 content",
            },
        ],
        "total_matches": 1,
    }


@pytest.fixture
def sample_search_in_content_multiple() -> dict[str, Any]:
    """Sample within-content search response with multiple matches."""
    return {
        "matches": [
            {
                "field": "content",
                "line": 3,
                "context": "line 1\nline 2\nline 3 match\nline 4\nline 5",
            },
            {
                "field": "content",
                "line": 10,
                "context": "line 8\nline 9\nline 10 match\nline 11\nline 12",
            },
            {
                "field": "title",
                "line": None,
                "context": "Title With Match",
            },
        ],
        "total_matches": 3,
    }


@pytest.fixture
def sample_search_in_content_empty() -> dict[str, Any]:
    """Sample within-content search response with no matches."""
    return {
        "matches": [],
        "total_matches": 0,
    }


@pytest.fixture
def sample_relationship() -> dict[str, Any]:
    """Sample relationship response data."""
    return {
        "id": "660e8400-e29b-41d4-a716-446655440010",
        "source_type": "bookmark",
        "source_id": "550e8400-e29b-41d4-a716-446655440001",
        "target_type": "note",
        "target_id": "550e8400-e29b-41d4-a716-446655440002",
        "relationship_type": "related",
        "description": None,
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
        "source_title": "Example Site",
        "source_url": "https://example.com",
        "target_title": "Test Note",
        "target_url": None,
        "source_deleted": False,
        "target_deleted": False,
        "source_archived": False,
        "target_archived": False,
    }


@pytest.fixture
def sample_relationship_list(sample_relationship: dict[str, Any]) -> dict[str, Any]:
    """Sample paginated relationship list response."""
    return {
        "items": [sample_relationship],
        "total": 1,
        "offset": 0,
        "limit": 50,
        "has_more": False,
    }
