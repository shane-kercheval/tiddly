"""Test fixtures for Prompt MCP server tests."""

from typing import Any
from collections.abc import AsyncGenerator
from unittest.mock import patch

import pytest
import respx
from fastmcp import Client
from fastmcp.client.transports import FastMCPTransport

from prompt_mcp_server import server as server_module
from prompt_mcp_server.server import server


class _LowLevelServerWrapper:
    """
    Wraps a low-level MCP Server so FastMCPTransport can use it.

    FastMCPTransport expects an object with:
    - `._mcp_server`: the low-level MCP Server (for .run() and .create_initialization_options())
    - `.name`: used by FastMCPTransport.__repr__

    It also does an `isinstance(server, FastMCP)` check for lifespan management,
    which correctly falls through to a no-op for non-FastMCP objects.
    """

    def __init__(self, mcp_server: Any) -> None:
        self._mcp_server = mcp_server

    @property
    def name(self) -> str:
        return self._mcp_server.name


@pytest.fixture
async def mock_api() -> AsyncGenerator[respx.MockRouter]:
    """Context manager for mocking API responses."""
    # Reset the module-level HTTP client to ensure respx captures requests
    server_module._http_client = None
    with respx.mock(base_url="http://localhost:8000") as respx_mock:
        # Initialize HTTP client within respx context so it uses the mock transport
        await server_module.init_http_client()
        yield respx_mock
    # Clean up after test
    if server_module._http_client is not None:
        await server_module._http_client.aclose()
        server_module._http_client = None


@pytest.fixture
def mock_auth():
    """Mock authentication for handler tests."""
    with patch("prompt_mcp_server.server.get_bearer_token") as mock:
        mock.return_value = "bm_test_token"
        yield mock


@pytest.fixture
async def mcp_client() -> AsyncGenerator[Client]:
    """
    Create a fastmcp Client connected to the Prompt MCP server in-memory.

    Uses FastMCPTransport with a wrapper around the low-level MCP Server.
    Access `client.session` for low-level ClientSession operations (e.g. pagination).
    """
    transport = FastMCPTransport(_LowLevelServerWrapper(server))
    async with Client(transport=transport) as client:
        yield client


@pytest.fixture
def sample_prompt() -> dict[str, Any]:
    """Sample prompt response data."""
    return {
        "id": "550e8400-e29b-41d4-a716-446655440001",
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
        "id": "550e8400-e29b-41d4-a716-446655440002",
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
        "id": "550e8400-e29b-41d4-a716-446655440003",
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


@pytest.fixture
def sample_prompt_list_item() -> dict[str, Any]:
    """Sample prompt list item with content_length and content_preview."""
    return {
        "id": "550e8400-e29b-41d4-a716-446655440001",
        "name": "code-review",
        "title": "Code Review Assistant",
        "description": "Reviews code and provides feedback",
        "arguments": [
            {"name": "language", "required": True},
            {"name": "code", "required": True},
        ],
        "tags": ["development", "code-review"],
        "content_length": 500,
        "content_preview": "Please review the following {{ language }} code...",
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
        "last_used_at": "2024-01-01T00:00:00Z",
        "deleted_at": None,
        "archived_at": None,
    }


@pytest.fixture
def sample_tags_response() -> dict[str, Any]:
    """Sample tags list response."""
    return {
        "tags": [
            {"name": "python", "count": 5},
            {"name": "web", "count": 3},
            {"name": "testing", "count": 2},
        ],
    }
