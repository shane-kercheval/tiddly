"""
Shared OAuth protected-resource discovery and presence-only auth gating for the
MCP servers (the server side of the MCP authorization spec).

Three pieces, used identically by both MCP servers:

1. **Protected-resource metadata** (RFC 9728): each server advertises its own
   canonical MCP endpoint URL as the OAuth ``resource`` and points at Clerk as the
   authorization server, so an OAuth-capable client can discover where to sign in.
2. **A presence-only 401 gate**: a request to the MCP endpoint with no
   ``Authorization: Bearer`` header is rejected *before* MCP dispatch with a
   ``WWW-Authenticate`` pointer to the metadata (RFC 9728 §5.1) — the signal that
   triggers a client's OAuth bootstrap.
3. **CORS** (via Starlette's ``CORSMiddleware``): browser-based connectors make
   cross-origin calls to ``/mcp`` and the well-known routes; the middleware handles
   preflight and exposes ``WWW-Authenticate`` so browser JS can read the challenge.

**This module does NOT verify tokens.** The MCP servers stay proxies: a present
bearer (valid or not) flows through to the backend API, which remains the only
verifier. The gate is presence-only by design.

**Resource identity (RFC 9728 §3).** The ``resource`` MUST equal the URL clients
actually connect to — i.e. the full ``https://<host>/mcp`` endpoint, *including*
the path, not the bare origin. The metadata URL is formed by inserting the
well-known segment between host and path (``…/.well-known/oauth-protected-resource/mcp``),
so a naive ``resource_url + well_known`` concatenation would be wrong — see
:func:`build_oauth_config`.

Configuration is resolved and validated **once** into an immutable
:class:`OAuthConfig` (see :func:`build_oauth_config`); servers build it at startup
so a missing/malformed value crashes the process instead of serving a
healthy-but-broken OAuth endpoint to the first client.
"""

import os
from dataclasses import dataclass
from typing import Any
from urllib.parse import SplitResult, urlsplit, urlunsplit

from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

# RFC 9728 well-known path. The canonical metadata URL for a resource with path
# ``/mcp`` inserts that path after the well-known segment (``…/oauth-protected-resource/mcp``);
# the root path is served too as a compatibility fallback for less-strict clients.
WELL_KNOWN_PATH = "/.well-known/oauth-protected-resource"
WELL_KNOWN_PATH_SUFFIXED = f"{WELL_KNOWN_PATH}/mcp"

# CORS for browser-based connectors. A cross-origin request that sets Authorization
# is a "non-simple" request and preflights; the preflight (OPTIONS) never carries the
# bearer, so it must be answered by CORS handling, not the gate. WWW-Authenticate is
# not on the response-header safelist, so it must be explicitly exposed for browser JS
# to read the discovery pointer off the 401 challenge.
_ALLOW_METHODS = ["GET", "POST", "DELETE", "OPTIONS"]
_ALLOW_HEADERS = ["Authorization", "Content-Type", "MCP-Protocol-Version", "MCP-Session-Id"]
_EXPOSE_HEADERS = ["WWW-Authenticate"]

_LOCALHOST_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


@dataclass(frozen=True)
class OAuthConfig:
    """Validated, immutable OAuth discovery configuration for one MCP server."""

    resource_url: str  # this server's canonical MCP endpoint, e.g. https://host/mcp
    authorization_server: str  # the Clerk issuer, https://{CLERK_FRONTEND_API}
    metadata_url: str  # {origin}/.well-known/oauth-protected-resource{path}


def is_mcp_request_path(path: str) -> bool:
    """
    True for the MCP endpoint paths that must be auth-gated.

    Matches ``/mcp`` exactly and any ``/mcp/`` sub-path. The health check and the
    well-known metadata paths are intentionally excluded — they stay public.
    """
    return path == "/mcp" or path.startswith("/mcp/")


def require_resource_url(env_var: str) -> str:
    """
    Read a server's **required** canonical MCP endpoint URL from its env var.

    Each MCP service sets its own service-specific variable (e.g.
    ``PROMPT_MCP_RESOURCE_URL`` / ``CONTENT_MCP_RESOURCE_URL``) to its full ``/mcp``
    endpoint — required in *every* environment (local dev gets it from
    ``.env.example``). There is deliberately no localhost fallback: a missing value
    raises at startup so a misconfigured service crashes on boot rather than
    advertising a placeholder resource that silently breaks OAuth discovery.
    """
    value = os.getenv(env_var)
    if not value or not value.strip():
        raise RuntimeError(
            f"{env_var} must be set to this MCP server's canonical /mcp endpoint URL "
            "(e.g. https://prompts-mcp.tiddly.me/mcp). See .env.example.",
        )
    return value.strip().rstrip("/")


def _reject_bad_authority_chars(raw: str, var_name: str) -> None:
    """
    Reject copy-paste noise (whitespace, control characters, backslash) that
    ``urlsplit`` would silently fold into the hostname and publish as broken metadata.
    """
    if any(ch.isspace() or ord(ch) < 0x20 or ch == "\\" for ch in raw):
        raise RuntimeError(
            f"{var_name} must not contain whitespace, control, or backslash "
            f"characters — got {raw!r}.",
        )


def _has_port_component(parts: SplitResult) -> bool:
    """
    Whether the authority carries a port, treating a malformed port as present too.

    ``urlsplit`` defers port parsing, so ``.port`` raises ``ValueError`` on a
    non-numeric/out-of-range port — that still means a port component is present.
    """
    try:
        return parts.port is not None
    except ValueError:
        return True


def _validate_resource_port(parts: SplitResult) -> None:
    """
    Force the deferred port parse on the resource URL, turning ``urlsplit``'s
    ``ValueError`` into the clear startup error. A valid explicit port is permitted
    (local/tunnel dev use one); a malformed/out-of-range port is rejected.
    """
    try:
        _ = parts.port  # attribute access triggers urlsplit's deferred port parse
    except ValueError:
        raise RuntimeError(
            f"MCP resource URL has an invalid port — got {parts.netloc!r}.",
        ) from None


def _clerk_authorization_server() -> str:
    """
    Resolve and validate the Clerk issuer URL from ``CLERK_FRONTEND_API``.

    The value is contractually a bare hostname; parse it as an authority and reject
    anything else (scheme, port, path, userinfo, query, fragment, or stray
    characters), so a malformed setting fails at startup instead of advertising a
    broken authorization server.
    """
    frontend_api = os.getenv("CLERK_FRONTEND_API", "").strip().rstrip("/")
    if not frontend_api:
        raise RuntimeError(
            "CLERK_FRONTEND_API must be set to serve MCP OAuth protected-resource "
            "metadata (it is the authorization-server URL clients discover).",
        )
    _reject_bad_authority_chars(frontend_api, "CLERK_FRONTEND_API")
    authority = urlsplit(f"//{frontend_api}")
    if (
        authority.scheme
        or authority.path
        or authority.query
        or authority.fragment
        or authority.username
        or authority.password
        or _has_port_component(authority)
        or not authority.hostname
    ):
        raise RuntimeError(
            "CLERK_FRONTEND_API must be a bare hostname (no scheme, port, path, "
            f"userinfo, query, or fragment), e.g. 'clerk.example.com' — got {frontend_api!r}.",
        )
    return f"https://{frontend_api}"


def build_oauth_config(resource_url: str, *, expected_path: str = "/mcp") -> OAuthConfig:
    """
    Validate the resource URL and Clerk config, and resolve them once into an
    immutable :class:`OAuthConfig`.

    Raises ``RuntimeError`` (loudly, at startup when called from a server's module
    load) for a misconfiguration that would otherwise publish unusable metadata:
    a non-absolute or non-HTTP(S) URL, a non-HTTPS resource off localhost, a URL
    carrying a query/fragment, or a path other than ``expected_path``.
    """
    _reject_bad_authority_chars(resource_url, "MCP resource URL")
    parts = urlsplit(resource_url)
    if parts.scheme not in ("http", "https"):
        raise RuntimeError(
            f"MCP resource URL must be an absolute http(s) URL — got {resource_url!r}.",
        )
    if not parts.hostname:
        raise RuntimeError(
            f"MCP resource URL must include a host — got {resource_url!r}.",
        )
    if parts.username or parts.password:
        raise RuntimeError(
            f"MCP resource URL must not include userinfo — got {resource_url!r}.",
        )
    _validate_resource_port(parts)
    is_localhost = parts.hostname in _LOCALHOST_HOSTS
    if parts.scheme != "https" and not is_localhost:
        raise RuntimeError(
            f"MCP resource URL must be HTTPS (except localhost dev) — got {resource_url!r}.",
        )
    if parts.query or parts.fragment:
        raise RuntimeError(
            f"MCP resource URL must not carry a query or fragment — got {resource_url!r}.",
        )
    if parts.path != expected_path:
        raise RuntimeError(
            f"MCP resource URL path must be {expected_path!r} (the MCP endpoint) — "
            f"got {parts.path!r} in {resource_url!r}.",
        )

    # RFC 9728 §3.1: insert the well-known segment between host and the resource path.
    metadata_url = urlunsplit(
        (parts.scheme, parts.netloc, f"{WELL_KNOWN_PATH}{parts.path}", "", ""),
    )
    return OAuthConfig(
        resource_url=resource_url,
        authorization_server=_clerk_authorization_server(),
        metadata_url=metadata_url,
    )


def build_protected_resource_metadata(config: OAuthConfig) -> dict[str, Any]:
    """Build the RFC 9728 protected-resource metadata document."""
    return {
        "resource": config.resource_url,
        "authorization_servers": [config.authorization_server],
        "bearer_methods_supported": ["header"],
    }


def make_metadata_endpoint(config: OAuthConfig):  # noqa: ANN201 (Starlette handler)
    """
    Build the well-known metadata route handler for a server's config.

    Returns a Starlette-style async handler usable both as a Starlette ``Route``
    (prompt server) and a FastMCP ``@custom_route`` (content server). CORS and
    OPTIONS preflight are handled by :func:`cors_middleware`, not here.
    """
    async def endpoint(request: Request) -> Response:  # noqa: ARG001
        return JSONResponse(build_protected_resource_metadata(config))

    return endpoint


def cors_middleware() -> Middleware:
    """
    CORS middleware for the MCP OAuth surface, mounted **outermost**.

    Handles browser preflight and injects CORS headers on every downstream
    response — including the gate's 401 challenge — in one place, and exposes
    ``WWW-Authenticate`` so browser clients can read the discovery pointer. This is
    the same ``CORSMiddleware`` pattern the main API uses.
    """
    return Middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=_ALLOW_METHODS,
        allow_headers=_ALLOW_HEADERS,
        expose_headers=_EXPOSE_HEADERS,
    )


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
    well-known metadata paths are never gated. CORS/preflight is handled by the
    outer :func:`cors_middleware`, so a browser preflight (which carries no bearer)
    never reaches this gate.
    """

    def __init__(self, app: Any, config: OAuthConfig) -> None:
        self.app = app
        self._www_authenticate = f'Bearer resource_metadata="{config.metadata_url}"'

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
