"""
Main Starlette application for Prompt MCP server.

Mounts the MCP server as an ASGI sub-app at /mcp with authentication
middleware that extracts Bearer tokens and makes them available to
MCP handlers via contextvars.
"""

from contextlib import asynccontextmanager
from typing import Any

from mcp.server.streamable_http_manager import StreamableHTTPSessionManager
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from .auth import clear_current_token, set_current_token
from .server import cleanup, init_http_client, server

# Create session manager for streamable HTTP transport
session_manager = StreamableHTTPSessionManager(
    app=server,
    event_store=None,
    json_response=True,
    stateless=True,
)


async def health_check(request: Request) -> JSONResponse:  # noqa: ARG001
    """Health check endpoint."""
    return JSONResponse({"status": "healthy"})


class MCPRouteHandler:
    """
    ASGI wrapper that routes /mcp and /mcp/* to the MCP session manager.

    This avoids Starlette's Mount redirect behavior (307 from /mcp to /mcp/)
    by handling path normalization ourselves.
    """

    def __init__(self, session_manager: StreamableHTTPSessionManager) -> None:
        self.session_manager = session_manager

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        """Route MCP requests, normalizing path for the session manager."""
        # The session manager expects paths relative to its mount point
        # Rewrite /mcp or /mcp/* to / or /* respectively
        path = scope.get("path", "")
        if path == "/mcp":
            scope = {**scope, "path": "/"}
        elif path.startswith("/mcp/"):
            scope = {**scope, "path": path[4:]}  # Strip "/mcp" prefix

        await self.session_manager.handle_request(scope, receive, send)


class AuthMiddleware:
    """
    ASGI middleware that extracts Bearer token and sets in context.

    The token is extracted from the Authorization header before MCP
    dispatch and cleared after the request completes.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:  # noqa: D102
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        # Extract Bearer token from headers
        headers = dict(scope.get("headers", []))
        auth_header = headers.get(b"authorization", b"").decode()

        if auth_header.lower().startswith("bearer "):
            set_current_token(auth_header[7:])

        try:
            await self.app(scope, receive, send)
        finally:
            clear_current_token()


@asynccontextmanager
async def lifespan(app: Starlette):  # noqa: ARG001, ANN201
    """
    Application lifespan handler.

    Initializes resources on startup (HTTP client, MCP session manager)
    and cleans up on shutdown. The HTTP client is created once here rather
    than lazily to ensure deterministic initialization and avoid race
    conditions during shutdown.
    """
    # Initialize HTTP client before accepting requests
    await init_http_client()

    async with session_manager.run():
        yield

    # Cleanup resources on shutdown
    await cleanup()


# Create ASGI handler for MCP routes
mcp_handler = MCPRouteHandler(session_manager)

# Create the Starlette application
app = Starlette(
    routes=[
        Route("/health", health_check, methods=["GET"]),
        # Handle /mcp exactly (no trailing slash)
        Route("/mcp", mcp_handler, methods=["GET", "POST", "DELETE"]),
        # Handle /mcp/* with any sub-path
        Route("/mcp/{path:path}", mcp_handler, methods=["GET", "POST", "DELETE"]),
    ],
    middleware=[Middleware(AuthMiddleware)],
    lifespan=lifespan,
)
