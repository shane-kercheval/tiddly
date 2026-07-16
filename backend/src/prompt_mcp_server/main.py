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

from shared.mcp_oauth import (
    WELL_KNOWN_PATH,
    WELL_KNOWN_PATH_SUFFIXED,
    ProtectedResourceGate,
    build_oauth_config,
    build_transport_security_settings,
    cors_middleware,
    extract_bearer_token,
    make_metadata_endpoint,
    parse_allowed_origins,
    require_resource_url,
)

from .auth import clear_current_token, set_current_token
from .server import cleanup, init_http_client, server

# This server's canonical MCP endpoint (the OAuth ``resource``, including /mcp).
# PROMPT_MCP_RESOURCE_URL is service-specific and required in every environment (no
# shared name, no localhost fallback), so the two MCP servers can never collide on a
# shared .env and a missing value crashes on boot instead of advertising a placeholder.
RESOURCE_URL = require_resource_url("PROMPT_MCP_RESOURCE_URL")

# Resolve + validate the OAuth discovery config ONCE, at import (which is uvicorn's
# startup): a missing/malformed CLERK_FRONTEND_API or PROMPT_MCP_RESOURCE_URL crashes the
# process before it serves, instead of surfacing as a 500 to the first OAuth client.
OAUTH_CONFIG = build_oauth_config(RESOURCE_URL)

# Create session manager for streamable HTTP transport. DNS-rebinding protection
# (Host/Origin validation) is enabled on the /mcp transport, derived from this
# server's validated resource URL; the Origin allowlist fails closed (see
# build_transport_security_settings). Off by default in the SDK — must be passed.
session_manager = StreamableHTTPSessionManager(
    app=server,
    event_store=None,
    json_response=True,
    stateless=True,
    security_settings=build_transport_security_settings(
        OAUTH_CONFIG, parse_allowed_origins(),
    ),
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

        # Extract Bearer token from headers with the SAME parser the 401 gate uses,
        # so the gate can never admit a header this stager then drops.
        headers = dict(scope.get("headers", []))
        token = extract_bearer_token(headers.get(b"authorization", b"").decode())
        if token is not None:
            set_current_token(token)

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

# OAuth protected-resource metadata handler (RFC 9728). The canonical route is the
# /mcp-suffixed well-known path; the root path is served too as a compatibility
# fallback for less-strict clients. Both return this server's full-endpoint resource.
metadata_endpoint = make_metadata_endpoint(OAUTH_CONFIG)

# Create the Starlette application
app = Starlette(
    routes=[
        Route("/health", health_check, methods=["GET"]),
        # OAuth discovery (unauthenticated). CORS/preflight handled by cors_middleware.
        Route(WELL_KNOWN_PATH_SUFFIXED, metadata_endpoint, methods=["GET"]),  # canonical
        Route(WELL_KNOWN_PATH, metadata_endpoint, methods=["GET"]),  # compat fallback
        # Handle /mcp exactly (no trailing slash)
        Route("/mcp", mcp_handler, methods=["GET", "POST", "DELETE"]),
        # Handle /mcp/* with any sub-path
        Route("/mcp/{path:path}", mcp_handler, methods=["GET", "POST", "DELETE"]),
    ],
    # Order (outermost first): CORS handles browser preflight and injects headers on
    # every response incl. the gate's 401; the gate then rejects bearer-less /mcp
    # requests with the discovery pointer before AuthMiddleware stages a present token.
    middleware=[
        cors_middleware(),
        Middleware(ProtectedResourceGate, config=OAUTH_CONFIG),
        Middleware(AuthMiddleware),
    ],
    lifespan=lifespan,
)
