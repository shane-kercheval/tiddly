"""Tests for the Prompt MCP API client helper functions."""

import httpx
import pytest
import respx
from httpx import Response

from prompt_mcp_server.api_client import api_get, api_patch, api_post


@pytest.fixture
def mock_api() -> respx.MockRouter:
    """Context manager for mocking API responses."""
    with respx.mock(base_url="http://localhost:8000") as respx_mock:
        yield respx_mock


@pytest.mark.asyncio
async def test__api_get__request_source_header_set(mock_api: respx.MockRouter) -> None:
    """Test that X-Request-Source header is set to mcp-prompt."""
    mock_api.get("/test").mock(return_value=Response(200, json={}))

    async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
        await api_get(client, "/test", "bm_test_token")

    assert mock_api.calls[0].request.headers["x-request-source"] == "mcp-prompt"


@pytest.mark.asyncio
async def test__api_post__request_source_header_set(mock_api: respx.MockRouter) -> None:
    """Test that X-Request-Source header is set to mcp-prompt for POST."""
    mock_api.post("/test").mock(return_value=Response(201, json={}))

    async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
        await api_post(client, "/test", "bm_test_token", {"key": "value"})

    assert mock_api.calls[0].request.headers["x-request-source"] == "mcp-prompt"


@pytest.mark.asyncio
async def test__api_patch__request_source_header_set(mock_api: respx.MockRouter) -> None:
    """Test that X-Request-Source header is set to mcp-prompt for PATCH."""
    mock_api.patch("/test").mock(return_value=Response(200, json={}))

    async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
        await api_patch(client, "/test", "bm_test_token", {"key": "value"})

    assert mock_api.calls[0].request.headers["x-request-source"] == "mcp-prompt"


@pytest.mark.asyncio
async def test__api_get__authorization_header_set(mock_api: respx.MockRouter) -> None:
    """Test that Authorization header is correctly set."""
    mock_api.get("/test").mock(return_value=Response(200, json={}))

    async with httpx.AsyncClient(base_url="http://localhost:8000") as client:
        await api_get(client, "/test", "bm_test_token_12345")

    assert (
        mock_api.calls[0].request.headers["authorization"] == "Bearer bm_test_token_12345"
    )
