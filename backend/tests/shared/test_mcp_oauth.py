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
    ProtectedResourceGate,
    build_protected_resource_metadata,
    clerk_authorization_server,
    is_mcp_request_path,
    make_metadata_endpoint,
)

RESOURCE_URL = "https://content-mcp.example.com"


# ---------------------------------------------------------------------------
# is_mcp_request_path
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/mcp", True),
        ("/mcp/", True),
        ("/mcp/anything", True),
        ("/mcp/sub/path", True),
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
# metadata builder / authorization server
# ---------------------------------------------------------------------------


def test__build_metadata__has_spec_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLERK_FRONTEND_API", "clerk.example.com")

    metadata = build_protected_resource_metadata(RESOURCE_URL)

    assert metadata == {
        "resource": RESOURCE_URL,
        "authorization_servers": ["https://clerk.example.com"],
        "bearer_methods_supported": ["header"],
    }


def test__build_metadata__strips_trailing_slash_from_resource(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CLERK_FRONTEND_API", "clerk.example.com")

    metadata = build_protected_resource_metadata(RESOURCE_URL + "/")

    assert metadata["resource"] == RESOURCE_URL


def test__clerk_authorization_server__raises_when_frontend_api_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CLERK_FRONTEND_API", raising=False)

    with pytest.raises(RuntimeError, match="CLERK_FRONTEND_API"):
        clerk_authorization_server()


def test__clerk_authorization_server__normalizes_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CLERK_FRONTEND_API", "  clerk.example.com/  ")

    assert clerk_authorization_server() == "https://clerk.example.com"


# ---------------------------------------------------------------------------
# metadata endpoint (GET + OPTIONS + CORS)
# ---------------------------------------------------------------------------


def _metadata_app(resource_url: str = RESOURCE_URL) -> Starlette:
    endpoint = make_metadata_endpoint(resource_url)
    return Starlette(
        routes=[
            Route(WELL_KNOWN_PATH, endpoint, methods=["GET", "OPTIONS"]),
            Route(WELL_KNOWN_PATH_SUFFIXED, endpoint, methods=["GET", "OPTIONS"]),
        ],
    )


@pytest.mark.parametrize("path", [WELL_KNOWN_PATH, WELL_KNOWN_PATH_SUFFIXED])
async def test__metadata_endpoint__get_returns_metadata_with_cors(
    monkeypatch: pytest.MonkeyPatch, path: str,
) -> None:
    monkeypatch.setenv("CLERK_FRONTEND_API", "clerk.example.com")

    async with AsyncClient(
        transport=ASGITransport(app=_metadata_app()),
        base_url="http://test",
    ) as client:
        response = await client.get(path)

    assert response.status_code == 200
    assert response.json() == {
        "resource": RESOURCE_URL,
        "authorization_servers": ["https://clerk.example.com"],
        "bearer_methods_supported": ["header"],
    }
    assert response.headers["access-control-allow-origin"] == "*"


@pytest.mark.parametrize("path", [WELL_KNOWN_PATH, WELL_KNOWN_PATH_SUFFIXED])
async def test__metadata_endpoint__options_preflight_returns_cors(
    monkeypatch: pytest.MonkeyPatch, path: str,
) -> None:
    monkeypatch.setenv("CLERK_FRONTEND_API", "clerk.example.com")

    async with AsyncClient(
        transport=ASGITransport(app=_metadata_app()),
        base_url="http://test",
    ) as client:
        response = await client.options(path)

    assert response.status_code == 204
    assert response.headers["access-control-allow-origin"] == "*"
    assert "GET" in response.headers["access-control-allow-methods"]


# ---------------------------------------------------------------------------
# ProtectedResourceGate (presence-only 401 gate)
# ---------------------------------------------------------------------------


def _gated_app() -> Starlette:
    """A minimal app whose /mcp routes are gated, with a passthrough marker."""
    async def ok(request: Request) -> JSONResponse:  # noqa: ARG001
        return JSONResponse({"reached": True})

    return Starlette(
        routes=[
            Route("/mcp", ok, methods=["GET", "POST"]),
            Route("/mcp/{path:path}", ok, methods=["GET", "POST"]),
            Route("/health", ok, methods=["GET"]),
        ],
        middleware=[Middleware(ProtectedResourceGate, resource_url=RESOURCE_URL)],
    )


async def test__gate__mcp_without_bearer_returns_401_with_www_authenticate() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=_gated_app()),
        base_url="http://test",
    ) as client:
        response = await client.post("/mcp")

    assert response.status_code == 401
    www_auth = response.headers["www-authenticate"]
    assert www_auth == (
        f'Bearer resource_metadata="{RESOURCE_URL}{WELL_KNOWN_PATH}"'
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
        response = await client.post(
            "/mcp",
            headers={"Authorization": "Bearer bm_some_token"},
        )

    assert response.status_code == 200
    assert response.json() == {"reached": True}


async def test__gate__invalid_bearer_still_passes_through() -> None:
    """Presence-only: an invalid/garbage bearer is the backend's job to reject."""
    async with AsyncClient(
        transport=ASGITransport(app=_gated_app()),
        base_url="http://test",
    ) as client:
        response = await client.post(
            "/mcp",
            headers={"Authorization": "Bearer not-a-real-token"},
        )

    assert response.status_code == 200
    assert response.json() == {"reached": True}


async def test__gate__non_bearer_scheme_returns_401() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=_gated_app()),
        base_url="http://test",
    ) as client:
        response = await client.post(
            "/mcp",
            headers={"Authorization": "Basic dXNlcjpwYXNz"},
        )

    assert response.status_code == 401


async def test__gate__empty_bearer_returns_401() -> None:
    async with AsyncClient(
        transport=ASGITransport(app=_gated_app()),
        base_url="http://test",
    ) as client:
        response = await client.post(
            "/mcp",
            headers={"Authorization": "Bearer "},
        )

    assert response.status_code == 401


async def test__gate__non_mcp_path_is_not_gated() -> None:
    """Health (and any non-/mcp path) is never gated, even with no bearer."""
    async with AsyncClient(
        transport=ASGITransport(app=_gated_app()),
        base_url="http://test",
    ) as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"reached": True}
