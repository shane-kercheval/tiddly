"""Test fixtures for Prompt MCP server tests."""

from typing import Any
from unittest.mock import patch

import pytest
import respx
from mcp import types

from prompt_mcp_server import server as server_module


def make_list_prompts_request(cursor: str | None = None) -> types.ListPromptsRequest:
    """Create a ListPromptsRequest with optional cursor for testing."""
    params = types.PaginatedRequestParams(cursor=cursor) if cursor else None
    return types.ListPromptsRequest(method="prompts/list", params=params)


@pytest.fixture
def mock_api() -> respx.MockRouter:
    """Context manager for mocking API responses."""
    # Reset the module-level HTTP client to ensure respx captures requests
    server_module._http_client = None
    with respx.mock(base_url="http://localhost:8000") as respx_mock:
        yield respx_mock
    # Clean up after test
    server_module._http_client = None


@pytest.fixture
def mock_auth():
    """Mock authentication for handler tests."""
    with patch("prompt_mcp_server.server.get_bearer_token") as mock:
        mock.return_value = "bm_test_token"
        yield mock


@pytest.fixture
def sample_prompt() -> dict[str, Any]:
    """Sample prompt response data."""
    return {
        "id": 1,
        "name": "code-review",
        "title": "Code Review Assistant",
        "description": "Reviews code and provides feedback",
        "content": "Please review the following {{ language }} code:\n\n{{ code }}",
        "arguments": [
            {
                "name": "language",
                "description": "Programming language",
                "required": True,
            },
            {
                "name": "code",
                "description": "Code to review",
                "required": True,
            },
        ],
        "tags": ["development", "code-review"],
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
        "last_used_at": "2024-01-01T00:00:00Z",
        "deleted_at": None,
        "archived_at": None,
    }


@pytest.fixture
def sample_prompt_no_args() -> dict[str, Any]:
    """Sample prompt with no arguments."""
    return {
        "id": 2,
        "name": "greeting",
        "title": "Friendly Greeting",
        "description": "A simple greeting prompt",
        "content": "Hello! How can I help you today?",
        "arguments": [],
        "tags": ["general"],
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
        "last_used_at": "2024-01-01T00:00:00Z",
        "deleted_at": None,
        "archived_at": None,
    }


@pytest.fixture
def sample_prompt_optional_args() -> dict[str, Any]:
    """Sample prompt with optional arguments."""
    return {
        "id": 3,
        "name": "summarize",
        "title": "Text Summarizer",
        "description": "Summarizes text",
        "content": "Summarize the following text{% if style %} in a {{ style }} style{% endif %}:\n\n{{ text }}",
        "arguments": [
            {
                "name": "text",
                "description": "Text to summarize",
                "required": True,
            },
            {
                "name": "style",
                "description": "Summary style (optional)",
                "required": False,
            },
        ],
        "tags": ["writing"],
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
        "last_used_at": "2024-01-01T00:00:00Z",
        "deleted_at": None,
        "archived_at": None,
    }


@pytest.fixture
def sample_prompt_list(sample_prompt: dict[str, Any]) -> dict[str, Any]:
    """Sample paginated prompt list response."""
    return {
        "items": [sample_prompt],
        "total": 1,
        "offset": 0,
        "limit": 100,
        "has_more": False,
    }


@pytest.fixture
def sample_prompt_list_empty() -> dict[str, Any]:
    """Empty prompt list response."""
    return {
        "items": [],
        "total": 0,
        "offset": 0,
        "limit": 100,
        "has_more": False,
    }
