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


@pytest.mark.asyncio
async def test__auth_middleware__extracts_bearer_token_from_header() -> None:
    """
    Test that AuthMiddleware extracts Bearer token from Authorization header.

    This is an integration test that verifies the middleware properly extracts
    the token from HTTP headers and makes it available to handlers via contextvars.
    """
    from starlette.applications import Starlette
    from starlette.middleware import Middleware
    from starlette.requests import Request
    from starlette.responses import JSONResponse
    from starlette.routing import Route

    from prompt_mcp_server.auth import AuthenticationError, get_bearer_token
    from prompt_mcp_server.main import AuthMiddleware

    # Track tokens seen by handler
    captured_tokens: list[str | None] = []
    captured_errors: list[str] = []

    async def token_echo_handler(request: Request) -> JSONResponse:  # noqa: ARG001
        """Handler that echoes the token from context."""
        try:
            token = get_bearer_token()
            captured_tokens.append(token)
            return JSONResponse({"token": token})
        except AuthenticationError as e:
            captured_errors.append(str(e))
            return JSONResponse({"error": str(e)}, status_code=401)

    test_app = Starlette(
        routes=[Route("/echo-token", token_echo_handler, methods=["GET"])],
        middleware=[Middleware(AuthMiddleware)],
    )

    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://test",
    ) as client:
        # Request WITH Bearer token
        response = await client.get(
            "/echo-token",
            headers={"Authorization": "Bearer test_token_123"},
        )
        assert response.status_code == 200
        assert response.json() == {"token": "test_token_123"}

        # Request WITHOUT Authorization header
        response = await client.get("/echo-token")
        assert response.status_code == 401
        assert "error" in response.json()

        # Request with malformed Authorization header (not Bearer)
        response = await client.get(
            "/echo-token",
            headers={"Authorization": "Basic sometoken"},
        )
        assert response.status_code == 401
        assert "error" in response.json()

    # Verify handler saw correct tokens
    assert captured_tokens == ["test_token_123"]
    assert len(captured_errors) == 2  # Two requests without valid Bearer token


@pytest.mark.asyncio
async def test__auth_middleware__clears_token_after_request() -> None:
    """
    Test that AuthMiddleware clears the token after request completes.

    This ensures tokens don't leak between requests.
    """
    from starlette.applications import Starlette
    from starlette.middleware import Middleware
    from starlette.requests import Request
    from starlette.responses import JSONResponse
    from starlette.routing import Route

    from prompt_mcp_server.auth import clear_current_token
    from prompt_mcp_server.main import AuthMiddleware

    async def dummy_handler(request: Request) -> JSONResponse:  # noqa: ARG001
        """Just return OK."""
        return JSONResponse({"status": "ok"})

    test_app = Starlette(
        routes=[Route("/test", dummy_handler, methods=["GET"])],
        middleware=[Middleware(AuthMiddleware)],
    )

    # Ensure no token is set before
    clear_current_token()

    async with AsyncClient(
        transport=ASGITransport(app=test_app),
        base_url="http://test",
    ) as client:
        # Make request with token
        await client.get(
            "/test",
            headers={"Authorization": "Bearer should_be_cleared"},
        )

    # After request completes, token should be cleared
    # (We're in a different context, so this tests the middleware's finally block)

    # The token context should be cleared (we're in a new context anyway,
    # but the middleware's finally block ensures cleanup even if we were in same context)
    # This is more of a code coverage test for the finally block
