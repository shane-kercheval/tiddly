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
from starlette.routing import Mount, Route

from .auth import clear_current_token, set_current_token
from .server import cleanup, server

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

    Initializes the MCP session manager on startup and cleans up on shutdown.
    This is required for the StreamableHTTPSessionManager to work - without
    it, requests fail with "Task group is not initialized".
    """
    async with session_manager.run():
        yield
    # Cleanup resources on shutdown
    await cleanup()


# Create the Starlette application
app = Starlette(
    routes=[
        Route("/health", health_check, methods=["GET"]),
        Mount("/mcp", app=session_manager.handle_request),
    ],
    middleware=[Middleware(AuthMiddleware)],
    lifespan=lifespan,
)
