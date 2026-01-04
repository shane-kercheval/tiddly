"""Integration tests for Prompt MCP server ASGI app."""

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.mark.asyncio
async def test__health_check__returns_healthy() -> None:
    """Test health check endpoint returns healthy status."""
    from prompt_mcp_server.main import app

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


@pytest.mark.asyncio
async def test__mcp_endpoint__exists() -> None:
    """Test that MCP endpoint is mounted."""
    from prompt_mcp_server.main import app

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        # MCP endpoint expects POST with proper JSON-RPC format
        # Without proper initialization, we get an error but the endpoint exists
        response = await client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "method": "ping", "id": 1},
        )

    # The endpoint exists (not 404)
    assert response.status_code != 404
