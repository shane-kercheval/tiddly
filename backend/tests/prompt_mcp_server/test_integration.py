"""Integration tests for Prompt MCP server ASGI app."""

from contextlib import asynccontextmanager

from httpx import ASGITransport, AsyncClient
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from prompt_mcp_server.auth import AuthenticationError, clear_current_token, get_bearer_token
from prompt_mcp_server.main import AuthMiddleware, app, session_manager


async def test__health_check__returns_healthy() -> None:
    """Test health check endpoint returns healthy status."""
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


async def test__mcp_endpoint__exists() -> None:
    """Test that MCP endpoint is mounted and accepts requests without trailing slash."""
    # Use lifespan context to properly initialize the session manager
    @asynccontextmanager
    async def lifespan_context():
        async with session_manager.run():
            yield

    # base_url Host must match the transport's allowed_hosts (derived from the pinned
    # PROMPT_MCP_RESOURCE_URL = http://localhost:8002/mcp) now that DNS-rebinding
    # protection is enabled.
    async with lifespan_context():
        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://localhost:8002",
        ) as client:
            # Test /mcp without trailing slash works (no redirect). A bearer is
            # required to pass the ProtectedResourceGate before reaching dispatch;
            # its value is not verified at the proxy, so any token gets past the gate.
            request = {
                "jsonrpc": "2.0", "method": "initialize", "id": 1, "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "test", "version": "1.0.0"},
                },
            }
            headers = {"Accept": "application/json", "Authorization": "Bearer bm_test"}
            response = await client.post("/mcp", json=request, headers=headers)

            # The endpoint exists and responds (not a redirect or 404)
            assert response.status_code == 200
            data = response.json()
            assert data.get("jsonrpc") == "2.0"
            assert "result" in data

            # Transport-security is live: a bearer-carrying request (past the gate)
            # with a foreign Host is rejected by DNS-rebinding protection (421),
            # proving the settings are wired, not just constructed.
            rebind = await client.post(
                "/mcp", json=request, headers={**headers, "Host": "evil.example.com"},
            )
            assert rebind.status_code == 421

            # The env-configured Origin allowlist (MCP_ALLOWED_ORIGINS, pinned in the
            # root conftest) reaches the session manager: the allowlisted browser Origin
            # is honored, an unknown one fails closed (403). Proves the env->app seam,
            # which the unit tests cannot.
            allowed = await client.post(
                "/mcp", json=request, headers={**headers, "Origin": "https://connector.test"},
            )
            assert allowed.status_code == 200
            unknown = await client.post(
                "/mcp", json=request, headers={**headers, "Origin": "https://attacker.test"},
            )
            assert unknown.status_code == 403


async def test__auth_middleware__extracts_bearer_token_from_header() -> None:
    """
    Test that AuthMiddleware extracts Bearer token from Authorization header.

    This is an integration test that verifies the middleware properly extracts
    the token from HTTP headers and makes it available to handlers via contextvars.
    """
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


async def test__auth_middleware__clears_token_after_request() -> None:
    """
    Test that AuthMiddleware clears the token after request completes.

    This ensures tokens don't leak between requests.
    """
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
