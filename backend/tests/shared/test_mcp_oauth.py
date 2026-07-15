"""Unit tests for the shared MCP OAuth discovery + auth-gate module."""

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from shared.mcp_oauth import (
    WELL_KNOWN_PATH,
    WELL_KNOWN_PATH_SUFFIXED,
    OAuthConfig,
    ProtectedResourceGate,
    build_oauth_config,
    build_protected_resource_metadata,
    cors_middleware,
    is_mcp_request_path,
    make_metadata_endpoint,
    require_resource_url,
)

RESOURCE_URL = "https://content-mcp.example.com/mcp"
METADATA_URL = "https://content-mcp.example.com/.well-known/oauth-protected-resource/mcp"

CONFIG = OAuthConfig(
    resource_url=RESOURCE_URL,
    authorization_server="https://clerk.example.com",
    metadata_url=METADATA_URL,
)


# ---------------------------------------------------------------------------
# is_mcp_request_path
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/mcp", True),
        ("/mcp/", True),
        ("/mcp/anything", True),
        ("/health", False),
        ("/", False),
        (WELL_KNOWN_PATH, False),
        (WELL_KNOWN_PATH_SUFFIXED, False),
        ("/mcp-not-really", False),
    ],
)
def test__is_mcp_request_path__gates_only_mcp_endpoint(path: str, expected: bool) -> None:
    assert is_mcp_request_path(path) is expected


# ---------------------------------------------------------------------------
# require_resource_url
# ---------------------------------------------------------------------------


def test__require_resource_url__returns_stripped_value(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PROMPT_MCP_RESOURCE_URL", "  https://prompts.example.com/mcp/  ")

    assert require_resource_url("PROMPT_MCP_RESOURCE_URL") == "https://prompts.example.com/mcp"


@pytest.mark.parametrize("value", [None, "", "   "])
def test__require_resource_url__raises_when_unset_or_blank(
    monkeypatch: pytest.MonkeyPatch, value: str | None,
) -> None:
    if value is None:
        monkeypatch.delenv("PROMPT_MCP_RESOURCE_URL", raising=False)
    else:
        monkeypatch.setenv("PROMPT_MCP_RESOURCE_URL", value)

    with pytest.raises(RuntimeError, match="PROMPT_MCP_RESOURCE_URL must be set"):
        require_resource_url("PROMPT_MCP_RESOURCE_URL")


# ---------------------------------------------------------------------------
# build_oauth_config — resolution + validation
# ---------------------------------------------------------------------------


def test__build_oauth_config__resolves_full_config(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLERK_FRONTEND_API", "clerk.example.com")

    config = build_oauth_config(RESOURCE_URL)

    assert config == OAuthConfig(
        resource_url=RESOURCE_URL,
        authorization_server="https://clerk.example.com",
        metadata_url=METADATA_URL,
    )


def test__build_oauth_config__allows_localhost_http(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLERK_FRONTEND_API", "clerk.example.com")

    config = build_oauth_config("http://localhost:8002/mcp")

    assert config.resource_url == "http://localhost:8002/mcp"
    assert config.metadata_url == (
        "http://localhost:8002/.well-known/oauth-protected-resource/mcp"
    )


def test__build_oauth_config__raises_when_clerk_frontend_api_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CLERK_FRONTEND_API", raising=False)

    with pytest.raises(RuntimeError, match="CLERK_FRONTEND_API"):
        build_oauth_config(RESOURCE_URL)


@pytest.mark.parametrize(
    "bad_clerk",
    [
        "https://clerk.example.com",  # scheme
        "clerk.example.com/oops",  # path
        "clerk.example.com:443",  # valid port — still disallowed
        "clerk.example.com:notaport",  # malformed port — must not raise raw ValueError
        "user@clerk.example.com",  # userinfo
        "clerk.example.com?x=1",  # query
    ],
)
def test__build_oauth_config__rejects_malformed_clerk_frontend_api(
    monkeypatch: pytest.MonkeyPatch, bad_clerk: str,
) -> None:
    monkeypatch.setenv("CLERK_FRONTEND_API", bad_clerk)

    with pytest.raises(RuntimeError, match="bare hostname"):
        build_oauth_config(RESOURCE_URL)


def test__build_oauth_config__rejects_clerk_frontend_api_with_whitespace(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CLERK_FRONTEND_API", "clerk .example.com")

    with pytest.raises(RuntimeError, match="whitespace, control, or backslash"):
        build_oauth_config(RESOURCE_URL)


def test__build_oauth_config__allows_valid_explicit_resource_port(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Local/tunnel dev uses explicit ports — a valid one must pass."""
    monkeypatch.setenv("CLERK_FRONTEND_API", "clerk.example.com")

    config = build_oauth_config("https://tunnel.example.com:8443/mcp")

    assert config.resource_url == "https://tunnel.example.com:8443/mcp"
    assert config.metadata_url == (
        "https://tunnel.example.com:8443/.well-known/oauth-protected-resource/mcp"
    )


@pytest.mark.parametrize(
    ("bad_url", "match"),
    [
        ("ftp://host/mcp", "absolute http"),
        ("not-a-url/mcp", "absolute http"),
        ("https://:443/mcp", "host"),  # host-less authority
        ("http://host/mcp", "HTTPS"),  # non-localhost http
        ("https://user@host/mcp", "userinfo"),
        ("https://host:notaport/mcp", "invalid port"),  # deferred-parse port footgun
        ("https://host/mcp?x=1", "query or fragment"),
        ("https://host/mcp#frag", "query or fragment"),
        ("https://host/other", "path must be"),
        ("https://host", "path must be"),  # bare origin — the item-1 footgun
    ],
)
def test__build_oauth_config__rejects_malformed_resource_url(
    monkeypatch: pytest.MonkeyPatch, bad_url: str, match: str,
) -> None:
    monkeypatch.setenv("CLERK_FRONTEND_API", "clerk.example.com")

    with pytest.raises(RuntimeError, match=match):
        build_oauth_config(bad_url)


def test__build_protected_resource_metadata__has_spec_fields() -> None:
    assert build_protected_resource_metadata(CONFIG) == {
        "resource": RESOURCE_URL,
        "authorization_servers": ["https://clerk.example.com"],
        "bearer_methods_supported": ["header"],
    }


# ---------------------------------------------------------------------------
# metadata endpoint (served through CORS middleware)
# ---------------------------------------------------------------------------


def _metadata_app() -> Starlette:
    endpoint = make_metadata_endpoint(CONFIG)
    return Starlette(
        routes=[
            Route(WELL_KNOWN_PATH_SUFFIXED, endpoint, methods=["GET"]),
            Route(WELL_KNOWN_PATH, endpoint, methods=["GET"]),
        ],
        middleware=[cors_middleware()],
    )


@pytest.mark.parametrize("path", [WELL_KNOWN_PATH, WELL_KNOWN_PATH_SUFFIXED])
async def test__metadata_endpoint__get_returns_metadata(path: str) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=_metadata_app()),
        base_url="http://test",
    ) as client:
        response = await client.get(path, headers={"Origin": "https://client.example"})

    assert response.status_code == 200
    assert response.json() == {
        "resource": RESOURCE_URL,
        "authorization_servers": ["https://clerk.example.com"],
        "bearer_methods_supported": ["header"],
    }
    assert response.headers["access-control-allow-origin"] == "*"


async def test__metadata_endpoint__cors_preflight_allowed() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=_metadata_app()),
        base_url="http://test",
    ) as client:
        response = await client.options(
            WELL_KNOWN_PATH_SUFFIXED,
            headers={
                "Origin": "https://client.example",
                "Access-Control-Request-Method": "GET",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"


# ---------------------------------------------------------------------------
# ProtectedResourceGate (presence-only 401 gate) + CORS on the challenge
# ---------------------------------------------------------------------------


def _gated_app() -> Starlette:
    """A minimal app whose /mcp routes are gated, wrapped in CORS like the real app."""
    async def ok(request: Request) -> JSONResponse:  # noqa: ARG001
        return JSONResponse({"reached": True})

    return Starlette(
        routes=[
            Route("/mcp", ok, methods=["GET", "POST"]),
            Route("/mcp/{path:path}", ok, methods=["GET", "POST"]),
            Route("/health", ok, methods=["GET"]),
        ],
        middleware=[
            cors_middleware(),
            Middleware(ProtectedResourceGate, config=CONFIG),
        ],
    )


async def test__gate__mcp_without_bearer_returns_401_with_www_authenticate() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=_gated_app()),
        base_url="http://test",
    ) as client:
        response = await client.post("/mcp")

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == (
        f'Bearer resource_metadata="{METADATA_URL}"'
    )


async def test__gate__mcp_subpath_without_bearer_returns_401() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=_gated_app()),
        base_url="http://test",
    ) as client:
        response = await client.post("/mcp/messages")

    assert response.status_code == 401


async def test__gate__present_bearer_passes_through() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=_gated_app()),
        base_url="http://test",
    ) as client:
        response = await client.post("/mcp", headers={"Authorization": "Bearer bm_token"})

    assert response.status_code == 200
    assert response.json() == {"reached": True}


async def test__gate__invalid_bearer_still_passes_through() -> None:
    """Presence-only: an invalid/garbage bearer is the backend's job to reject."""
    async with AsyncClient(
        transport=ASGITransport(app=_gated_app()),
        base_url="http://test",
    ) as client:
        response = await client.post("/mcp", headers={"Authorization": "Bearer not-real"})

    assert response.status_code == 200


@pytest.mark.parametrize("auth", ["Basic dXNlcjpwYXNz", "Bearer ", "Bearer"])
async def test__gate__missing_or_non_bearer_returns_401(auth: str) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=_gated_app()),
        base_url="http://test",
    ) as client:
        response = await client.post("/mcp", headers={"Authorization": auth})

    assert response.status_code == 401


async def test__gate__non_mcp_path_is_not_gated() -> None:
    """Health (and any non-/mcp path) is never gated, even with no bearer."""
    async with AsyncClient(
        transport=ASGITransport(app=_gated_app()),
        base_url="http://test",
    ) as client:
        response = await client.get("/health")

    assert response.status_code == 200


async def test__gate__browser_preflight_on_mcp_is_allowed_without_bearer() -> None:
    """
    A CORS preflight (OPTIONS, never carries the bearer) must be answered by CORS,
    not 401'd by the gate — otherwise an authenticated browser POST is blocked before
    it is ever sent. The real request's methods/headers must be allowed.
    """
    async with AsyncClient(
        transport=ASGITransport(app=_gated_app()),
        base_url="http://test",
    ) as client:
        response = await client.options(
            "/mcp",
            headers={
                "Origin": "https://client.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization, content-type",
            },
        )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"
    assert "POST" in response.headers["access-control-allow-methods"]
    assert "authorization" in response.headers["access-control-allow-headers"].lower()


async def test__gate__401_challenge_exposes_www_authenticate_to_browser() -> None:
    """A cross-origin unauthenticated POST gets a browser-readable 401 challenge."""
    async with AsyncClient(
        transport=ASGITransport(app=_gated_app()),
        base_url="http://test",
    ) as client:
        response = await client.post("/mcp", headers={"Origin": "https://client.example"})

    assert response.status_code == 401
    assert response.headers["access-control-allow-origin"] == "*"
    assert "www-authenticate" in response.headers["access-control-expose-headers"].lower()
