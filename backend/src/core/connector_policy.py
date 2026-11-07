"""
The REST routes an AI app's OAuth token ("connector token") may call.

This table is a connector token's whole REST surface: the routes the two MCP
servers call, and nothing else. A new MCP tool that calls a new backend route
adds the route here; tests/test_mcp_connector_drift.py fails until it does.
"""

# (HTTP method, route template). Templates use the routers' parameter names,
# because the check compares them to the matched route's `path`.
CONNECTOR_ALLOWED_ROUTES: frozenset[tuple[str, str]] = frozenset({
    ("GET", "/bookmarks/"),
    ("GET", "/notes/"),
    ("GET", "/content/"),
    ("GET", "/bookmarks/{bookmark_id}"),
    ("GET", "/notes/{note_id}"),
    ("GET", "/bookmarks/{bookmark_id}/metadata"),
    ("GET", "/notes/{note_id}/metadata"),
    ("GET", "/bookmarks/{bookmark_id}/search"),
    ("GET", "/notes/{note_id}/search"),
    ("GET", "/relationships/content/{content_type}/{content_id}"),
    ("GET", "/mcp/context/content"),
    ("GET", "/mcp/context/prompts"),
    ("GET", "/filters/"),
    ("GET", "/tags/"),
    ("GET", "/prompts/"),
    ("GET", "/prompts/name/{name}"),
    ("GET", "/prompts/name/{name}/metadata"),
    ("POST", "/bookmarks/"),
    ("POST", "/notes/"),
    ("POST", "/relationships/"),
    ("POST", "/prompts/"),
    ("POST", "/prompts/{prompt_id}/track-usage"),
    ("PATCH", "/bookmarks/{bookmark_id}"),
    ("PATCH", "/notes/{note_id}"),
    ("PATCH", "/bookmarks/{bookmark_id}/str-replace"),
    ("PATCH", "/notes/{note_id}/str-replace"),
    ("PATCH", "/prompts/name/{name}"),
    ("PATCH", "/prompts/name/{name}/str-replace"),
})


def is_connector_route_allowed(method: str, route_template: str) -> bool:
    """Whether a connector token may call this method on this route template."""
    return (method, route_template) in CONNECTOR_ALLOWED_ROUTES
