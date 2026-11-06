"""
Drift guard: the backend routes the two MCP servers call are exactly
core/connector_policy.py's CONNECTOR_ALLOWED_ROUTES.

Every tool of both servers, plus the prompt server's native `prompts/list` and
`prompts/get`, runs against a recording respx mock of the API. Each recorded
path is resolved to a route template with the app's own router, the way
FastAPI resolves a real request, and the resolved set must equal the allowlist
in both directions. A new MCP call to a route not on the list fails here
instead of returning 403 to every connector in production.

The test refuses to pass vacuously:
- the tools each server lists must equal this file's representative calls, so
  a new tool without a call fails;
- each server's request handlers must be the known set, so a new kind of
  handler (resources, completions) fails until this test drives it;
- every representative call must send at least one request and finish without
  error, so a call that never reached the API covers nothing silently;
- every recorded path must match a route on the app.

Limitation: a new branch inside an existing tool is caught only if one of the
representative calls below reaches it. The dev end-to-end run with real
clients (the connector-token-limits plan, Milestone 2) is the independent check.
"""
import asyncio
import json
import os
from collections.abc import AsyncGenerator
from typing import Any
from unittest.mock import patch

import httpx
import pytest
import respx
from fastmcp import Client
from mcp import types
from starlette.routing import Match

from core.connector_policy import CONNECTOR_ALLOWED_ROUTES
from mcp_server import server as content_server
from prompt_mcp_server import server as prompt_server

ITEM_ID = "0190a1b2-0000-7000-8000-000000000001"
OTHER_ID = "0190a1b2-0000-7000-8000-000000000002"
PROMPT_ID = "0190a1b2-0000-7000-8000-000000000003"
PROMPT_NAME = "drift-prompt"

# One or more calls per tool. get_item, update_item, edit_content, and
# search_in_content route by type, and get_item by include_content, so each
# branch gets its own call.
CONTENT_CALLS: dict[str, list[dict[str, Any]]] = {
    "search_items": [{"type": "bookmark"}, {"type": "note"}, {}],
    "list_filters": [{}],
    "get_item": [
        {"id": ITEM_ID, "type": "bookmark"},
        {"id": ITEM_ID, "type": "note"},
        {"id": ITEM_ID, "type": "bookmark", "include_content": False},
        {"id": ITEM_ID, "type": "note", "include_content": False},
    ],
    "edit_content": [
        {"id": ITEM_ID, "type": "bookmark", "old_str": "a", "new_str": "b"},
        {"id": ITEM_ID, "type": "note", "old_str": "a", "new_str": "b"},
    ],
    "search_in_content": [
        {"id": ITEM_ID, "type": "bookmark", "query": "a"},
        {"id": ITEM_ID, "type": "note", "query": "a"},
    ],
    "update_item": [
        {"id": ITEM_ID, "type": "bookmark", "title": "t"},
        {"id": ITEM_ID, "type": "note", "title": "t"},
    ],
    "create_bookmark": [{"url": "https://example.com/drift"}],
    "create_note": [{"title": "t", "content": "c"}],
    # POST /relationships/ answers 409, so the duplicate-lookup GET runs too.
    "create_relationship": [{
        "source_type": "bookmark", "source_id": ITEM_ID,
        "target_type": "note", "target_id": OTHER_ID,
    }],
    "get_context": [{}],
    "list_tags": [{}],
}

PROMPT_CALLS: dict[str, list[dict[str, Any]]] = {
    "get_context": [{}],
    "search_prompts": [{}, {"query": "a"}],
    "list_filters": [{}],
    "list_tags": [{}],
    "get_prompt_content": [{"name": PROMPT_NAME}],
    "get_prompt_metadata": [{"name": PROMPT_NAME}],
    "create_prompt": [{"name": PROMPT_NAME, "content": "Hello"}],
    "edit_prompt_content": [{"name": PROMPT_NAME, "old_str": "Hello", "new_str": "Hi"}],
    "update_prompt": [{"name": PROMPT_NAME, "title": "t"}],
}

PROMPT_SERVER_HANDLERS = {
    types.PingRequest,
    types.ListToolsRequest,
    types.CallToolRequest,
    types.ListPromptsRequest,
    types.GetPromptRequest,
}

_PAGE = {"items": [], "total": 0, "offset": 0, "limit": 50, "has_more": False}
_ITEM = {
    "id": ITEM_ID, "title": "t", "description": None, "content": "a", "tags": [],
    "url": "https://example.com", "created_at": "2026-01-01T00:00:00Z",
    "updated_at": "2026-01-01T00:00:00Z", "archived_at": None, "deleted_at": None,
}
_PROMPT = {
    "id": PROMPT_ID, "name": PROMPT_NAME, "title": None, "description": None,
    "content": "Hello", "arguments": [], "tags": [],
    "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z",
    "archived_at": None, "deleted_at": None,
}
_CONTEXT_LISTS = {
    "generated_at": "2026-01-01T00:00:00Z",
    "top_tags": [],
    "filters": [],
    "sidebar_items": [],
    "recently_used": [],
    "recently_created": [],
    "recently_modified": [],
}
_CONTENT_CONTEXT = {
    **_CONTEXT_LISTS,
    "counts": {
        "bookmarks": {"active": 0, "archived": 0},
        "notes": {"active": 0, "archived": 0},
    },
}
_PROMPT_CONTEXT = {**_CONTEXT_LISTS, "counts": {"active": 0, "archived": 0}}

# A plausible body per route template, so each tool runs to completion.
RESPONSES: dict[tuple[str, str], tuple[int, Any]] = {
    ("GET", "/bookmarks/"): (200, _PAGE),
    ("GET", "/notes/"): (200, _PAGE),
    ("GET", "/content/"): (200, _PAGE),
    ("GET", "/filters/"): (200, []),
    ("GET", "/tags/"): (200, {"tags": []}),
    ("GET", "/relationships/content/{content_type}/{content_id}"): (200, _PAGE),
    ("POST", "/relationships/"): (409, {"detail": "Relationship already exists"}),
    ("GET", "/mcp/context/content"): (200, _CONTENT_CONTEXT),
    ("GET", "/mcp/context/prompts"): (200, _PROMPT_CONTEXT),
    ("GET", "/prompts/"): (200, _PAGE),
    ("GET", "/prompts/name/{name}"): (200, _PROMPT),
    ("GET", "/prompts/name/{name}/metadata"): (200, _PROMPT),
    ("POST", "/prompts/"): (201, _PROMPT),
    ("PATCH", "/prompts/name/{name}"): (200, _PROMPT),
    ("PATCH", "/prompts/name/{name}/str-replace"): (200, _PROMPT),
    ("POST", "/prompts/{prompt_id}/track-usage"): (204, None),
}
_DEFAULT_RESPONSE = (200, _ITEM)


@pytest.fixture(autouse=True)
def _database_url_env(database_url: str) -> str:
    """Importing api.main loads db.session, which needs DATABASE_URL set."""
    return database_url


def _resolve_template(method: str, path: str) -> str | None:
    """The route template FastAPI would match for this request, or None."""
    from api.main import app  # noqa: PLC0415

    scope = {"type": "http", "method": method, "path": path, "root_path": ""}
    for route in app.router.routes:
        match, _ = route.matches(scope)
        if match == Match.FULL:
            return route.path
    return None


class _Recorder:
    """Answers every API request and records the template it resolved to."""

    def __init__(self) -> None:
        self.requests: list[tuple[str, str]] = []
        self.templates: set[tuple[str, str]] = set()
        self.unmatched: list[tuple[str, str]] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        method, path = request.method, request.url.path
        self.requests.append((method, path))
        template = _resolve_template(method, path)
        if template is None:
            self.unmatched.append((method, path))
            return httpx.Response(404, json={"detail": "Not Found"})
        self.templates.add((method, template))
        status, body = RESPONSES.get((method, template), _DEFAULT_RESPONSE)
        if body is None:
            return httpx.Response(status)
        return httpx.Response(status, content=json.dumps(body).encode(),
                              headers={"content-type": "application/json"})


@pytest.fixture
async def recorder() -> AsyncGenerator[_Recorder]:
    rec = _Recorder()
    content_server._http_client = None
    prompt_server._http_client = None
    with (
        patch("mcp_server.server.get_bearer_token", return_value="drift-token"),
        patch("prompt_mcp_server.server.get_bearer_token", return_value="drift-token"),
        respx.mock(base_url=os.environ["VITE_API_URL"], assert_all_called=False) as mock,
    ):
        mock.route().mock(side_effect=rec)
        await prompt_server.init_http_client()
        yield rec
    await prompt_server.cleanup()
    content_server._http_client = None


async def _drive(
    rec: _Recorder, label: str, call: Any, failures: list[str],
) -> None:
    """Run one representative call; it must send a request and not error."""
    before = len(rec.requests)
    try:
        result = await call()
    except Exception as exc:
        failures.append(f"{label}: raised {type(exc).__name__}: {exc}")
        return
    if getattr(result, "isError", False):
        failures.append(f"{label}: returned an error result: {result}")
    if len(rec.requests) == before:
        failures.append(f"{label}: sent no request to the API")


async def test__mcp_servers_call_exactly_the_connector_allowlist(recorder: _Recorder) -> None:
    failures: list[str] = []

    # Content server, through an in-memory MCP client as a real client would.
    async with Client(transport=content_server.mcp) as client:
        listed = {tool.name for tool in await client.list_tools()}
        assert listed == set(CONTENT_CALLS), (
            "content server tools without a representative call (or calls for "
            f"tools it no longer has): {sorted(listed ^ set(CONTENT_CALLS))}"
        )
        # Only tools: a resource or prompt would be API surface this test skips.
        assert await client.list_resources() == []
        assert await client.list_resource_templates() == []
        assert await client.list_prompts() == []
        for name, calls in CONTENT_CALLS.items():
            for args in calls:
                await _drive(
                    recorder, f"content {name}({args})",
                    lambda name=name, args=args: client.call_tool(name, args),
                    failures,
                )

    # Prompt server: its low-level handlers, including native prompts.
    assert set(prompt_server.server.request_handlers) == PROMPT_SERVER_HANDLERS, (
        "prompt server handlers changed; drive the new ones here: "
        f"{sorted(h.__name__ for h in set(prompt_server.server.request_handlers) ^ PROMPT_SERVER_HANDLERS)}"
    )
    listed = {tool.name for tool in await prompt_server.handle_list_tools()}
    assert listed == set(PROMPT_CALLS), (
        "prompt server tools without a representative call (or calls for tools "
        f"it no longer has): {sorted(listed ^ set(PROMPT_CALLS))}"
    )
    for name, calls in PROMPT_CALLS.items():
        for args in calls:
            await _drive(
                recorder, f"prompt {name}({args})",
                lambda name=name, args=args: prompt_server.handle_call_tool(name, args),
                failures,
            )
    await _drive(
        recorder, "prompts/list",
        lambda: prompt_server.handle_list_prompts(
            types.ListPromptsRequest(method="prompts/list", params=None),
        ),
        failures,
    )
    await _drive(
        recorder, "prompts/get",
        lambda: prompt_server.handle_get_prompt(PROMPT_NAME, {}),
        failures,
    )
    # prompts/get records usage in a background task; let it send its POST.
    await asyncio.gather(*list(prompt_server._background_tasks))

    assert not failures, "\n".join(failures)
    assert not recorder.unmatched, f"paths that match no route on the app: {recorder.unmatched}"
    not_allowed = sorted(recorder.templates - CONNECTOR_ALLOWED_ROUTES)
    not_called = sorted(CONNECTOR_ALLOWED_ROUTES - recorder.templates)
    assert not not_allowed, (
        f"MCP servers call routes missing from core/connector_policy.py: {not_allowed}"
    )
    assert not not_called, (
        f"core/connector_policy.py allows routes no MCP tool calls: {not_called}"
    )
