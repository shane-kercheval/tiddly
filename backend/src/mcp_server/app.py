"""
ASGI application for the Content MCP server.

Wraps the FastMCP server (``server.mcp``) in an HTTP app that adds the OAuth
protected-resource discovery routes, the presence-only 401 gate, browser CORS, and
DNS-rebinding Host/Origin protection — the shared MCP-OAuth pattern, identical to the
prompt server's.

Kept separate from ``server.py`` (which the package ``__init__`` imports) so the
import-time OAuth config validation runs only when this app is loaded (uvicorn boot,
or a test that imports it), not whenever the ``mcp_server`` package is imported.

**Transport security is injected at the ASGI layer** via :class:`TransportSecurityGate`,
because FastMCP's ``http_app()`` constructs its ``StreamableHTTPSessionManager``
internally without exposing ``security_settings`` (the prompt server passes them
natively). Same settings, same 421/403 enforcement, different injection point.
"""

from starlette.middleware import Middleware

from shared.mcp_oauth import (
    WELL_KNOWN_PATH,
    WELL_KNOWN_PATH_SUFFIXED,
    ProtectedResourceGate,
    TransportSecurityGate,
    build_oauth_config,
    build_transport_security_settings,
    cors_middleware,
    make_metadata_endpoint,
    parse_allowed_origins,
    require_resource_url,
)

from .server import mcp

# Resolve + validate this server's OAuth config once, at import (uvicorn startup): a
# missing/malformed CONTENT_MCP_RESOURCE_URL or CLERK_FRONTEND_API crashes the process
# before it serves, rather than 500ing the first OAuth client.
RESOURCE_URL = require_resource_url("CONTENT_MCP_RESOURCE_URL")
OAUTH_CONFIG = build_oauth_config(RESOURCE_URL)

# OAuth protected-resource metadata (RFC 9728): canonical /mcp-suffixed path + root
# (compat). Registered on the FastMCP instance so http_app() includes them. CORS is
# handled by cors_middleware, not here.
_metadata_endpoint = make_metadata_endpoint(OAUTH_CONFIG)
mcp.custom_route(WELL_KNOWN_PATH_SUFFIXED, methods=["GET"])(_metadata_endpoint)
mcp.custom_route(WELL_KNOWN_PATH, methods=["GET"])(_metadata_endpoint)

# Middleware order (outermost first): CORS answers browser preflight and wraps every
# response (incl. the gate 401); the presence gate rejects bearer-less /mcp requests
# with the discovery pointer before dispatch; the transport-security gate then validates
# Host/Origin (DNS-rebinding) on bearer-carrying requests that pass the presence gate.
app = mcp.http_app(
    path="/mcp",
    stateless_http=True,
    middleware=[
        cors_middleware(),
        Middleware(ProtectedResourceGate, config=OAUTH_CONFIG),
        Middleware(
            TransportSecurityGate,
            settings=build_transport_security_settings(OAUTH_CONFIG, parse_allowed_origins()),
        ),
    ],
)
