"""
OAuth discovery + auth-gate integration tests for the Prompt MCP server app.

Exercises the real Starlette app (``prompt_mcp_server.main.app``): the well-known
protected-resource metadata routes and the presence-only 401 gate on ``/mcp``,
proving the shared ``mcp_oauth`` pieces are wired in.
"""

import pytest
from httpx import ASGITransport, AsyncClient

from prompt_mcp_server.main import RESOURCE_URL, app
from shared.mcp_oauth import WELL_KNOWN_PATH, WELL_KNOWN_PATH_SUFFIXED


@pytest.mark.parametrize("path", [WELL_KNOWN_PATH, WELL_KNOWN_PATH_SUFFIXED])
async def test__protected_resource_metadata__served_at_both_well_known_paths(
    monkeypatch: pytest.MonkeyPatch, path: str,
) -> None:
    """Both well-known variants serve this server's own resource, unauthenticated."""
    monkeypatch.setenv("CLERK_FRONTEND_API", "clerk.example.com")

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get(path)

    assert response.status_code == 200
    body = response.json()
    assert body["resource"] == RESOURCE_URL
    assert body["authorization_servers"] == ["https://clerk.example.com"]
    assert body["bearer_methods_supported"] == ["header"]
    assert response.headers["access-control-allow-origin"] == "*"


async def test__protected_resource_metadata__options_preflight_public() -> None:
    """Browser clients preflight the metadata; OPTIONS is answered with CORS."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.options(WELL_KNOWN_PATH)

    assert response.status_code == 204
    assert response.headers["access-control-allow-origin"] == "*"


async def test__mcp_endpoint__rejects_missing_bearer_with_discovery_pointer() -> None:
    """No bearer on /mcp -> 401 with the RFC 9728 resource_metadata pointer."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.post("/mcp", json={"jsonrpc": "2.0", "method": "x", "id": 1})

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == (
        f'Bearer resource_metadata="{RESOURCE_URL}{WELL_KNOWN_PATH}"'
    )


# The bearer-passes-the-gate regression (an existing `tiddly mcp configure`-style
# bearer config reaching MCP dispatch on its first request) is proven end-to-end by
# `test_integration.py::test__mcp_endpoint__exists`, which now sends a bearer and
# owns the single allowed `session_manager.run()` lifespan; and at the gate boundary
# by `tests/shared/test_mcp_oauth.py::test__gate__present_bearer_passes_through`.
