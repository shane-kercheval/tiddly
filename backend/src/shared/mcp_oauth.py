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

import ipaddress
import os
from dataclasses import dataclass
from typing import Any
from urllib.parse import SplitResult, urlsplit, urlunsplit

from mcp.server.transport_security import TransportSecuritySettings
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
_DEFAULT_PORTS = {"http": 80, "https": 443}


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


def _validated_port(parts: SplitResult, label: str) -> int | None:
    """
    Return the authority's port, forcing ``urlsplit``'s deferred parse and rejecting
    unusable values with a clear startup error.

    ``urlsplit`` raises ``ValueError`` for a non-numeric or out-of-range (>65535)
    port; port ``0`` parses fine but is not a connectable TCP port. A valid explicit
    port (1-65535) is permitted — local/tunnel dev use one. Returns ``None`` when no
    port is present.
    """
    try:
        port = parts.port
    except ValueError:
        raise RuntimeError(f"{label} has an invalid port — got {parts.netloc!r}.") from None
    if port == 0:
        raise RuntimeError(f"{label} port must be 1-65535 — got 0 in {parts.netloc!r}.")
    return port


def _is_ip_literal(host: str) -> bool:
    """True if ``host`` is an IPv4/IPv6 literal (``CLERK_FRONTEND_API`` must be a DNS name)."""
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return False
    return True


def _canonical_scheme_netloc(parts: SplitResult) -> tuple[str, str]:
    """
    Canonicalize an authority: lowercase scheme + host, drop the scheme's default
    port, keep a non-default port, and bracket IPv6 literals.

    URI normalization *permits* omitting the default port and lowercasing host/scheme,
    so the security layer must not depend on a client's Host serialization — deriving
    one canonical authority (used for both the advertised ``resource`` and Host
    validation) keeps discovery and enforcement from drifting apart. Assumes the port
    has already been validated (``.port`` will not raise here).
    """
    scheme = parts.scheme.lower()
    hostname = (parts.hostname or "").lower()
    # urlsplit strips IPv6 brackets from .hostname; re-add them, or "::1:8002" results.
    host = f"[{hostname}]" if ":" in hostname else hostname
    port = parts.port
    netloc = host if port is None or port == _DEFAULT_PORTS.get(scheme) else f"{host}:{port}"
    return scheme, netloc


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
        # Contractually a Clerk DNS hostname: reject a trailing root dot (would make the
        # issuer differ from Clerk's published, canonical one) and IP literals (Clerk is
        # a DNS-only issuer and an IP can't form the issuer clients discover).
        or authority.hostname.endswith(".")
        or _is_ip_literal(authority.hostname)
    ):
        raise RuntimeError(
            "CLERK_FRONTEND_API must be a bare DNS hostname (no scheme, port, path, "
            "userinfo, query, fragment, trailing dot, or IP literal), e.g. "
            f"'clerk.example.com' — got {frontend_api!r}.",
        )
    # Build from the parsed, lowercased hostname so the advertised authorization-server
    # issuer is canonical (RFC 8414 requires code-point-identical issuer comparison).
    return f"https://{authority.hostname}"


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
    _validated_port(parts, "MCP resource URL")
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

    # Canonicalize the authority once (lowercase host, drop default port, bracket
    # IPv6) so the advertised resource and the derived allowed-hosts share one
    # identity and match the Host clients actually send. The path is preserved as-is.
    scheme, netloc = _canonical_scheme_netloc(parts)
    canonical_resource = urlunsplit((scheme, netloc, parts.path, "", ""))
    # RFC 9728 §3.1: insert the well-known segment between host and the resource path.
    metadata_url = urlunsplit((scheme, netloc, f"{WELL_KNOWN_PATH}{parts.path}", "", ""))
    return OAuthConfig(
        resource_url=canonical_resource,
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


def _normalize_origin(value: str, env_var: str) -> str:
    """
    Validate and canonicalize one browser-``Origin`` allowlist entry.

    A browser serializes ``Origin`` as a bare ``scheme://host[:port]`` (no path, no
    trailing slash, lowercase, default port omitted). So a raw operator value like
    ``https://connector.example/`` would never match — canonicalize to that form and
    reject anything that isn't an origin (path, userinfo, query, fragment, stray
    characters, bad scheme/port). SDK ``:*`` wildcard-port patterns are deliberately
    not supported — list exact origins.
    """
    _reject_bad_authority_chars(value, env_var)
    parts = urlsplit(value)
    if parts.scheme not in ("http", "https"):
        raise RuntimeError(
            f"{env_var} entries must be http(s) origins — got {value!r}.",
        )
    if not parts.hostname:
        raise RuntimeError(f"{env_var} entries must include a host — got {value!r}.")
    if parts.username or parts.password:
        raise RuntimeError(f"{env_var} entries must not include userinfo — got {value!r}.")
    if parts.path not in ("", "/") or parts.query or parts.fragment:
        raise RuntimeError(
            f"{env_var} entries must be bare origins with no path/query/fragment — "
            f"got {value!r}.",
        )
    # A browser origin that can make authenticated cross-origin calls must be TLS —
    # a plain-HTTP remote origin is network-tamperable. Only loopback may use http.
    if parts.scheme != "https" and parts.hostname not in _LOCALHOST_HOSTS:
        raise RuntimeError(
            f"{env_var} entries must be HTTPS (except loopback dev origins) — got {value!r}.",
        )
    _validated_port(parts, f"{env_var} entry")
    scheme, netloc = _canonical_scheme_netloc(parts)
    return f"{scheme}://{netloc}"


def parse_allowed_origins(env_var: str = "MCP_ALLOWED_ORIGINS") -> list[str]:
    """
    Parse, validate, and canonicalize the comma-separated browser-``Origin`` allowlist
    for the ``/mcp`` transport.

    Empty by default — the Origin policy fails closed (see
    :func:`build_transport_security_settings`): server-side connectors omit ``Origin``
    and are unaffected; browser origins must be explicitly allowlisted. A malformed
    entry raises at startup (fail fast) rather than silently never matching. Production
    origins are populated here during the connector verification ladder. Order-preserving
    dedupe.
    """
    raw = os.getenv(env_var, "")
    origins = [_normalize_origin(item.strip(), env_var) for item in raw.split(",") if item.strip()]
    return list(dict.fromkeys(origins))


def build_transport_security_settings(
    config: OAuthConfig, allowed_origins: list[str],
) -> TransportSecuritySettings:
    """
    Build the MCP SDK's DNS-rebinding protection for the ``/mcp`` transport.

    ``allowed_hosts`` is the canonical authority of the (already-canonicalized) resource
    URL — the ``host[:port]`` clients connect to — always included, plus loopback
    aliases (``localhost``/``127.0.0.1``/``[::1]`` on the same port) when the resource
    host is a loopback form, so any local access path works. It is not
    connector-dependent. The ``Origin`` policy **fails closed**: a request with no
    ``Origin`` (server-side connectors) passes, but a browser ``Origin`` must be in
    ``allowed_origins`` — otherwise the SDK rejects it (``403``). Host mismatch is
    rejected (``421``). Applies only to the MCP transport, not ``/health`` or the public
    well-known metadata routes.
    """
    parts = urlsplit(config.resource_url)  # already canonical (default port stripped)
    hostname = parts.hostname or ""
    host = f"[{hostname}]" if ":" in hostname else hostname  # bracket IPv6 for the authority
    port = parts.port

    # Base authority hosts: the canonical host, plus loopback aliases when local.
    bases = [host]
    if hostname in _LOCALHOST_HOSTS:
        bases += ["localhost", "127.0.0.1", "[::1]"]

    # One port rule applied uniformly to every base: a default-port endpoint accepts
    # both the bare and explicit-default Host serializations (same endpoint, no
    # security cost); a non-default port is mandatory on every base.
    allowed_hosts: list[str] = []
    for base in bases:
        if port is None:
            allowed_hosts += [base, f"{base}:{_DEFAULT_PORTS[parts.scheme]}"]
        else:
            allowed_hosts.append(f"{base}:{port}")

    return TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=list(dict.fromkeys(allowed_hosts)),
        allowed_origins=list(allowed_origins),
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
