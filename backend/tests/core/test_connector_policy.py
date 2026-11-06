"""
The connector allowlist (core/connector_policy.py) names real routes and never
names a dangerous one.

The drift test (tests/test_mcp_connector_drift.py) proves the list equals what
the MCP servers call; these tests prove each entry exists on the app, so a
renamed route fails here instead of silently closing an MCP tool, and that the
list never opens the surfaces the published promise rules out.
"""
import pytest
from fastapi.routing import APIRoute

from core.connector_policy import CONNECTOR_ALLOWED_ROUTES, is_connector_route_allowed

# Paths a connector token must never reach, whatever the MCP servers call:
# credentials, settings, AI spend, account details, server-side URL fetches,
# version history and restores, and public links.
FORBIDDEN_PREFIXES = ("/tokens", "/settings", "/ai", "/users")
FORBIDDEN_PATHS = ("/bookmarks/fetch-metadata",)
FORBIDDEN_SEGMENTS = ("/share", "/rotate-share-token", "/restore", "/history")


@pytest.fixture(autouse=True)
def _database_url_env(database_url: str) -> str:
    """Importing api.main loads db.session, which needs DATABASE_URL set."""
    return database_url


def _registered_routes() -> set[tuple[str, str]]:
    from api.main import app  # noqa: PLC0415

    return {
        (method, route.path)
        for route in app.routes
        if isinstance(route, APIRoute)
        for method in route.methods
    }


def test__every_entry_is_a_registered_route() -> None:
    """A renamed or removed route fails here, naming the stale entry."""
    missing = sorted(CONNECTOR_ALLOWED_ROUTES - _registered_routes())
    assert not missing, f"allowlist entries that match no route on the app: {missing}"


def test__no_entry_opens_a_forbidden_surface() -> None:
    offending = sorted(
        (method, path)
        for method, path in CONNECTOR_ALLOWED_ROUTES
        if method == "DELETE"
        or path.startswith(FORBIDDEN_PREFIXES)
        or path in FORBIDDEN_PATHS
        or any(segment in path for segment in FORBIDDEN_SEGMENTS)
    )
    assert not offending, f"allowlist entries on forbidden surfaces: {offending}"


@pytest.mark.parametrize(
    ("method", "route_template", "allowed"),
    [
        ("GET", "/bookmarks/", True),
        ("PATCH", "/notes/{note_id}/str-replace", True),
        ("POST", "/prompts/{prompt_id}/track-usage", True),
        ("DELETE", "/bookmarks/{bookmark_id}", False),
        ("POST", "/tokens/", False),
        ("GET", "/users/me", False),
        # The method is part of the entry: GET is allowed here, PUT is not.
        ("PUT", "/bookmarks/{bookmark_id}", False),
        # A concrete path is never a template, so it never matches an entry.
        ("GET", "/bookmarks/0190a1b2-0000-7000-8000-000000000000", False),
    ],
)
def test__is_connector_route_allowed(
    method: str, route_template: str, allowed: bool,
) -> None:
    assert is_connector_route_allowed(method, route_template) is allowed
