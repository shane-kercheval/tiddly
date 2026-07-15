"""
Shared OAuth protected-resource discovery and presence-only auth gating for the
MCP servers (the server side of the MCP authorization spec).

Two pieces, used identically by both MCP servers:

1. **Protected-resource metadata** (RFC 9728): each server advertises its own
   public URL as the OAuth ``resource`` and points at Clerk as the authorization
   server, so an OAuth-capable client can discover where to sign in.
2. **A presence-only 401 gate**: a request to the MCP endpoint with no
   ``Authorization: Bearer`` header is rejected *before* MCP dispatch with a
   ``WWW-Authenticate`` pointer to the metadata (RFC 9728 §5.1) — the signal that
   triggers a client's OAuth bootstrap.

**This module does NOT verify tokens.** The MCP servers stay proxies: a
present bearer (valid or not) flows through to the backend API, which remains
the only verifier. The gate is presence-only by design — a present-but-invalid
token is the backend's job to reject, not the proxy's.

Each server passes in its *own* ``resource_url`` (its public URL); the two MCP
servers live on different domains, so the served ``resource`` differs per server.
The authorization server is derived from ``CLERK_FRONTEND_API`` — the same issuer
the backend verifies session/OAuth tokens against.
"""

import os
from collections.abc import Awaitable, Callable
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, Response

# RFC 9728 well-known path plus the path-suffixed variant. Clients differ on
# which they request (some append the resource's MCP path), so both are served.
WELL_KNOWN_PATH = "/.well-known/oauth-protected-resource"
WELL_KNOWN_PATH_SUFFIXED = "/.well-known/oauth-protected-resource/mcp"

# Browser-based connectors preflight the metadata request, so the endpoints must
# answer OPTIONS and carry permissive CORS. The metadata is public spec data
# (resource + authorization server), so wildcard CORS discloses nothing sensitive.
_CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "*",
}


def is_mcp_request_path(path: str) -> bool:
    """
    True for the MCP endpoint paths that must be auth-gated.

    Matches ``/mcp`` exactly and any ``/mcp/`` sub-path. The health check and the
    well-known metadata paths are intentionally excluded — they stay public.
    """
    return path == "/mcp" or path.startswith("/mcp/")


def clerk_authorization_server() -> str:
    """
    The Clerk issuer URL used as the OAuth authorization server in the metadata.

    Derived from ``CLERK_FRONTEND_API`` so it matches the issuer the backend
    verifies tokens against. Raises if unset — serving metadata that points at no
    authorization server would silently break OAuth discovery, so fail loudly.
    """
    frontend_api = os.getenv("CLERK_FRONTEND_API", "").strip().rstrip("/")
    if not frontend_api:
        raise RuntimeError(
            "CLERK_FRONTEND_API must be set to serve MCP OAuth protected-resource "
            "metadata (it is the authorization-server URL clients discover).",
        )
    return f"https://{frontend_api}"


def build_protected_resource_metadata(resource_url: str) -> dict[str, Any]:
    """
    Build the RFC 9728 protected-resource metadata document for one MCP server.

    Args:
        resource_url: This server's own public URL (the OAuth ``resource``).
    """
    return {
        "resource": resource_url.rstrip("/"),
        "authorization_servers": [clerk_authorization_server()],
        "bearer_methods_supported": ["header"],
    }


def make_metadata_endpoint(
    resource_url: str,
) -> Callable[[Request], Awaitable[Response]]:
    """
    Build the well-known metadata route handler for a server's ``resource_url``.

    Returns a Starlette-style async handler usable both as a Starlette ``Route``
    (prompt server) and a FastMCP ``@custom_route`` (content server). Answers
    OPTIONS (CORS preflight) and GET.
    """
    async def endpoint(request: Request) -> Response:
        if request.method == "OPTIONS":
            return Response(status_code=204, headers=_CORS_HEADERS)
        return JSONResponse(
            build_protected_resource_metadata(resource_url),
            headers=_CORS_HEADERS,
        )

    return endpoint


def _request_has_bearer(raw_headers: list[tuple[bytes, bytes]]) -> bool:
    """
    Presence check for a non-empty ``Authorization: Bearer`` header.

    Presence only — the token is NOT validated here; that is the backend's job.
    """
    for name, value in raw_headers:
        if name.lower() == b"authorization":
            parts = value.decode("latin-1").split(maxsplit=1)
            return (
                len(parts) == 2
                and parts[0].lower() == "bearer"
                and bool(parts[1].strip())
            )
    return False


class ProtectedResourceGate:
    """
    ASGI middleware: presence-only bearer gate on the MCP endpoint.

    A request to an MCP path (:func:`is_mcp_request_path`) with no bearer token is
    answered with ``401`` and a ``WWW-Authenticate: Bearer resource_metadata=...``
    header pointing at this server's protected-resource metadata (RFC 9728 §5.1),
    *before* any MCP dispatch — this is what triggers a client's OAuth bootstrap.

    A present bearer (valid or invalid) passes through untouched: the backend API
    is the only verifier (the proxy must not become one). ``/health`` and the
    well-known metadata paths are never gated.
    """

    def __init__(self, app: Any, resource_url: str) -> None:
        self.app = app
        # Point clients at the root well-known path; a client that wants the
        # suffixed variant derives it. Precomputed since it never varies per request.
        self._www_authenticate = (
            f'Bearer resource_metadata="{resource_url.rstrip("/")}{WELL_KNOWN_PATH}"'
        )

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        """Reject bearer-less MCP requests; pass everything else through."""
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        if is_mcp_request_path(scope.get("path", "")) and not _request_has_bearer(
            scope.get("headers", []),
        ):
            response = JSONResponse(
                {
                    "error": "unauthorized",
                    "error_description": (
                        "Authentication required. Discover the authorization server "
                        "via the resource metadata in the WWW-Authenticate header."
                    ),
                },
                status_code=401,
                headers={"WWW-Authenticate": self._www_authenticate},
            )
            await response(scope, receive, send)
            return

        await self.app(scope, receive, send)
