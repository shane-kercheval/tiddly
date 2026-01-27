"""Tests for MCP context endpoints."""
import uuid

import pytest
from httpx import AsyncClient


# =============================================================================
# Helpers
# =============================================================================


async def _create_bookmark(
    client: AsyncClient,
    title: str = "Test Bookmark",
    tags: list[str] | None = None,
    url: str | None = None,
    description: str | None = None,
    content: str | None = None,
) -> dict:
    url = url or f"https://{uuid.uuid4().hex[:8]}.example.com"
    payload: dict = {"url": url, "title": title}
    if tags:
        payload["tags"] = tags
    if description:
        payload["description"] = description
    if content:
        payload["content"] = content
    response = await client.post("/bookmarks/", json=payload)
    assert response.status_code == 201
    return response.json()


async def _create_note(
    client: AsyncClient,
    title: str = "Test Note",
    tags: list[str] | None = None,
    description: str | None = None,
    content: str | None = None,
) -> dict:
    payload: dict = {"title": title}
    if tags:
        payload["tags"] = tags
    if description:
        payload["description"] = description
    if content:
        payload["content"] = content
    response = await client.post("/notes/", json=payload)
    assert response.status_code == 201
    return response.json()


async def _create_prompt(
    client: AsyncClient,
    name: str | None = None,
    title: str | None = None,
    tags: list[str] | None = None,
    description: str | None = None,
    content: str = "Hello world",
    arguments: list[dict] | None = None,
) -> dict:
    name = name or f"prompt-{uuid.uuid4().hex[:8]}"
    payload: dict = {"name": name, "content": content}
    if title:
        payload["title"] = title
    if tags:
        payload["tags"] = tags
    if description:
        payload["description"] = description
    if arguments:
        payload["arguments"] = arguments
    response = await client.post("/prompts/", json=payload)
    assert response.status_code == 201
    return response.json()


async def _create_filter(
    client: AsyncClient,
    name: str,
    tags_groups: list[list[str]],
    content_types: list[str] | None = None,
) -> dict:
    groups = [{"tags": tags} for tags in tags_groups]
    payload: dict = {
        "name": name,
        "filter_expression": {"groups": groups, "group_operator": "OR"},
    }
    if content_types:
        payload["content_types"] = content_types
    response = await client.post("/filters/", json=payload)
    assert response.status_code == 201
    return response.json()


async def _set_sidebar(client: AsyncClient, items: list[dict]) -> dict:
    response = await client.put(
        "/settings/sidebar",
        json={"version": 1, "items": items},
    )
    assert response.status_code == 200
    return response.json()


# =============================================================================
# Content context tests
# =============================================================================


class TestContentContext:
    """Tests for GET /mcp/context/content."""

    @pytest.mark.anyio
    async def test__basic_response__has_correct_schema(
        self, client: AsyncClient,
    ) -> None:
        await _create_bookmark(client)
        await _create_note(client)

        response = await client.get("/mcp/context/content")
        assert response.status_code == 200
        data = response.json()

        assert "generated_at" in data
        assert "counts" in data
        assert "top_tags" in data
        assert "filters" in data
        assert "sidebar_collections" in data
        assert "recently_used" in data
        assert "recently_created" in data
        assert "recently_modified" in data

    @pytest.mark.anyio
    async def test__counts__accurate_active_and_archived(
        self, client: AsyncClient,
    ) -> None:
        # Create active items
        await _create_bookmark(client, title="Active BM 1")
        await _create_bookmark(client, title="Active BM 2")
        await _create_note(client, title="Active Note 1")

        # Create and archive items
        bm = await _create_bookmark(client, title="Archived BM")
        await client.post(f"/bookmarks/{bm['id']}/archive")
        n = await _create_note(client, title="Archived Note")
        await client.post(f"/notes/{n['id']}/archive")

        response = await client.get("/mcp/context/content")
        data = response.json()

        assert data["counts"]["bookmarks"]["active"] == 2
        assert data["counts"]["bookmarks"]["archived"] == 1
        assert data["counts"]["notes"]["active"] == 1
        assert data["counts"]["notes"]["archived"] == 1

    @pytest.mark.anyio
    async def test__tags__sorted_by_filter_count_then_content_count(
        self, client: AsyncClient,
    ) -> None:
        # Create items with tags
        await _create_bookmark(client, tags=["python", "tutorial"])
        await _create_bookmark(client, tags=["python"])
        await _create_note(client, tags=["tutorial"])

        # Create a filter using "python" tag (increases its filter_count)
        await _create_filter(client, "Python Filter", [["python"]], ["bookmark", "note"])

        response = await client.get("/mcp/context/content")
        data = response.json()

        tag_names = [t["name"] for t in data["top_tags"]]
        assert "python" in tag_names
        assert "tutorial" in tag_names

        # python should come first (has filter_count=1, content_count=2)
        python_tag = next(t for t in data["top_tags"] if t["name"] == "python")
        assert python_tag["content_count"] == 2
        assert python_tag["filter_count"] >= 1

    @pytest.mark.anyio
    async def test__tags__limited_by_tag_limit(
        self, client: AsyncClient,
    ) -> None:
        # Create bookmarks with different tags
        for i in range(5):
            await _create_bookmark(client, tags=[f"tag-{i}"])

        response = await client.get("/mcp/context/content?tag_limit=2")
        data = response.json()

        assert len(data["top_tags"]) <= 2

    @pytest.mark.anyio
    async def test__filters__in_sidebar_order(
        self, client: AsyncClient,
    ) -> None:
        f1 = await _create_filter(client, "Filter A", [["alpha"]], ["bookmark", "note"])
        f2 = await _create_filter(client, "Filter B", [["beta"]], ["bookmark", "note"])

        # Set sidebar order: B before A
        await _set_sidebar(client, [
            {"type": "builtin", "key": "all"},
            {"type": "filter", "id": f2["id"]},
            {"type": "filter", "id": f1["id"]},
            {"type": "builtin", "key": "archived"},
            {"type": "builtin", "key": "trash"},
        ])

        response = await client.get("/mcp/context/content")
        data = response.json()

        filter_names = [f["name"] for f in data["filters"]]
        assert filter_names == ["Filter B", "Filter A"]

    @pytest.mark.anyio
    async def test__filters__excludes_builtins(
        self, client: AsyncClient,
    ) -> None:
        await _create_filter(client, "Real Filter", [["test"]], ["bookmark"])

        response = await client.get("/mcp/context/content")
        data = response.json()

        filter_names = [f["name"] for f in data["filters"]]
        # Should not include "All Content", "Archived", "Trash"
        assert "All Content" not in filter_names
        assert "Archived" not in filter_names
        assert "Trash" not in filter_names

    @pytest.mark.anyio
    async def test__filters__excludes_empty_expression(
        self, client: AsyncClient,
    ) -> None:
        """Filters without tag rules (e.g. 'All Notes') should be excluded."""
        # The default filters created on first request have empty expressions
        response = await client.get("/mcp/context/content")
        data = response.json()

        for f in data["filters"]:
            # Every included filter should have at least one group with tags
            groups = f["filter_expression"]["groups"]
            assert any(g["tags"] for g in groups), f"Filter '{f['name']}' has no tag rules"

    @pytest.mark.anyio
    async def test__filter_items__contains_matching_items(
        self, client: AsyncClient,
    ) -> None:
        await _create_bookmark(client, title="Work Item", tags=["work"])
        await _create_filter(client, "Work", [["work"]], ["bookmark", "note"])

        response = await client.get("/mcp/context/content")
        data = response.json()

        work_filter = next((f for f in data["filters"] if f["name"] == "Work"), None)
        assert work_filter is not None
        assert len(work_filter["items"]) >= 1
        assert work_filter["items"][0]["title"] == "Work Item"

    @pytest.mark.anyio
    async def test__filter_limit_and_item_limit__respected(
        self, client: AsyncClient,
    ) -> None:
        # Create 3 filters with items
        for i in range(3):
            tag = f"group-{i}"
            await _create_bookmark(client, title=f"BM {i}", tags=[tag])
            await _create_filter(client, f"Filter {i}", [[tag]], ["bookmark"])

        response = await client.get("/mcp/context/content?filter_limit=2&filter_item_limit=1")
        data = response.json()

        assert len(data["filters"]) <= 2
        for f in data["filters"]:
            assert len(f["items"]) <= 1

    @pytest.mark.anyio
    async def test__filter_items__scoped_to_content_types(
        self, client: AsyncClient,
    ) -> None:
        """Content context should not include prompts in filter items."""
        await _create_bookmark(client, title="BM", tags=["shared"])
        await _create_prompt(client, tags=["shared"])
        await _create_filter(
            client, "Shared", [["shared"]], ["bookmark", "note", "prompt"],
        )

        response = await client.get("/mcp/context/content")
        data = response.json()

        shared_filter = next((f for f in data["filters"] if f["name"] == "Shared"), None)
        assert shared_filter is not None
        item_types = {item["type"] for item in shared_filter["items"]}
        assert "prompt" not in item_types

    @pytest.mark.anyio
    async def test__sidebar_collections__included_when_present(
        self, client: AsyncClient,
    ) -> None:
        f1 = await _create_filter(client, "Dev Filter", [["dev"]], ["bookmark"])

        await _set_sidebar(client, [
            {"type": "builtin", "key": "all"},
            {
                "type": "collection",
                "id": "550e8400-e29b-41d4-a716-446655440000",
                "name": "Development",
                "items": [{"type": "filter", "id": f1["id"]}],
            },
            {"type": "builtin", "key": "archived"},
            {"type": "builtin", "key": "trash"},
        ])

        response = await client.get("/mcp/context/content")
        data = response.json()

        assert len(data["sidebar_collections"]) == 1
        assert data["sidebar_collections"][0]["name"] == "Development"
        assert len(data["sidebar_collections"][0]["filters"]) == 1

    @pytest.mark.anyio
    async def test__sidebar_collections__empty_when_no_collections(
        self, client: AsyncClient,
    ) -> None:
        response = await client.get("/mcp/context/content")
        data = response.json()
        assert data["sidebar_collections"] == []

    @pytest.mark.anyio
    async def test__recently_used__sorted_by_last_used_at(
        self, client: AsyncClient,
    ) -> None:
        bm1 = await _create_bookmark(client, title="BM First")
        bm2 = await _create_bookmark(client, title="BM Second")

        # Track usage in order
        await client.post(f"/bookmarks/{bm1['id']}/track-usage")
        await client.post(f"/bookmarks/{bm2['id']}/track-usage")

        response = await client.get("/mcp/context/content")
        data = response.json()

        used_titles = [item["title"] for item in data["recently_used"]]
        # BM Second was used more recently, should come first
        assert used_titles.index("BM Second") < used_titles.index("BM First")

    @pytest.mark.anyio
    async def test__recently_created__sorted_by_created_at(
        self, client: AsyncClient,
    ) -> None:
        await _create_bookmark(client, title="First")
        await _create_bookmark(client, title="Second")

        response = await client.get("/mcp/context/content")
        data = response.json()

        created_titles = [item["title"] for item in data["recently_created"]]
        # Second was created more recently
        assert created_titles.index("Second") < created_titles.index("First")

    @pytest.mark.anyio
    async def test__description_included__when_present(
        self, client: AsyncClient,
    ) -> None:
        await _create_bookmark(
            client, title="With Desc", description="A description",
        )
        await _create_bookmark(client, title="Without Desc")

        response = await client.get("/mcp/context/content")
        data = response.json()

        items_by_title = {item["title"]: item for item in data["recently_created"]}
        assert items_by_title["With Desc"]["description"] == "A description"
        assert items_by_title["Without Desc"]["description"] is None

    @pytest.mark.anyio
    async def test__empty_state__valid_response(
        self, client: AsyncClient,
    ) -> None:
        response = await client.get("/mcp/context/content")
        assert response.status_code == 200
        data = response.json()

        assert data["counts"]["bookmarks"]["active"] == 0
        assert data["counts"]["bookmarks"]["archived"] == 0
        assert data["counts"]["notes"]["active"] == 0
        assert data["counts"]["notes"]["archived"] == 0
        assert data["top_tags"] == []
        assert data["filters"] == []
        assert data["recently_used"] == []
        assert data["recently_created"] == []
        assert data["recently_modified"] == []

    @pytest.mark.anyio
    async def test__auth__unauthenticated_returns_401(
        self, client: AsyncClient,
    ) -> None:
        # Disable dev mode to require auth
        from core.config import get_settings

        settings = get_settings()
        original = settings.dev_mode
        try:
            object.__setattr__(settings, "dev_mode", False)
            response = await client.get("/mcp/context/content")
            assert response.status_code == 401
        finally:
            object.__setattr__(settings, "dev_mode", original)


# =============================================================================
# Prompt context tests
# =============================================================================


class TestPromptContext:
    """Tests for GET /mcp/context/prompts."""

    @pytest.mark.anyio
    async def test__basic_response__has_correct_schema(
        self, client: AsyncClient,
    ) -> None:
        await _create_prompt(client)

        response = await client.get("/mcp/context/prompts")
        assert response.status_code == 200
        data = response.json()

        assert "generated_at" in data
        assert "counts" in data
        assert "top_tags" in data
        assert "filters" in data
        assert "sidebar_collections" in data
        assert "recently_used" in data
        assert "recently_created" in data
        assert "recently_modified" in data

    @pytest.mark.anyio
    async def test__counts__active_and_archived(
        self, client: AsyncClient,
    ) -> None:
        await _create_prompt(client, name="active-1")
        await _create_prompt(client, name="active-2")
        p = await _create_prompt(client, name="archived-1")
        await client.post(f"/prompts/{p['id']}/archive")

        response = await client.get("/mcp/context/prompts")
        data = response.json()

        assert data["counts"]["active"] == 2
        assert data["counts"]["archived"] == 1

    @pytest.mark.anyio
    async def test__arguments_included__in_recent_items(
        self, client: AsyncClient,
    ) -> None:
        await _create_prompt(
            client,
            name="with-args",
            content="Review {{ code }}",
            arguments=[
                {"name": "code", "description": "Code to review", "required": True},
            ],
        )

        response = await client.get("/mcp/context/prompts")
        data = response.json()

        prompt_item = next(
            (p for p in data["recently_created"] if p["name"] == "with-args"),
            None,
        )
        assert prompt_item is not None
        assert len(prompt_item["arguments"]) == 1
        assert prompt_item["arguments"][0]["name"] == "code"
        assert prompt_item["arguments"][0]["required"] is True

    @pytest.mark.anyio
    async def test__prompt_name_included(
        self, client: AsyncClient,
    ) -> None:
        await _create_prompt(client, name="my-prompt")

        response = await client.get("/mcp/context/prompts")
        data = response.json()

        names = [p["name"] for p in data["recently_created"]]
        assert "my-prompt" in names

    @pytest.mark.anyio
    async def test__filters_scoped_to_prompts(
        self, client: AsyncClient,
    ) -> None:
        """Only filters with content_types including 'prompt' should appear."""
        # Create a bookmark-only filter
        await _create_filter(client, "BM Only", [["test"]], ["bookmark"])
        # Create a prompt filter
        await _create_filter(client, "Prompt Filter", [["test"]], ["prompt"])

        response = await client.get("/mcp/context/prompts")
        data = response.json()

        filter_names = [f["name"] for f in data["filters"]]
        assert "Prompt Filter" in filter_names
        assert "BM Only" not in filter_names

    @pytest.mark.anyio
    async def test__recently_used__sorted_correctly(
        self, client: AsyncClient,
    ) -> None:
        p1 = await _create_prompt(client, name="first-used")
        p2 = await _create_prompt(client, name="second-used")

        await client.post(f"/prompts/{p1['id']}/track-usage")
        await client.post(f"/prompts/{p2['id']}/track-usage")

        response = await client.get("/mcp/context/prompts")
        data = response.json()

        used_names = [p["name"] for p in data["recently_used"]]
        assert used_names.index("second-used") < used_names.index("first-used")

    @pytest.mark.anyio
    async def test__empty_state__valid_response(
        self, client: AsyncClient,
    ) -> None:
        response = await client.get("/mcp/context/prompts")
        assert response.status_code == 200
        data = response.json()

        assert data["counts"]["active"] == 0
        assert data["counts"]["archived"] == 0
        assert data["top_tags"] == []
        assert data["filters"] == []
        assert data["recently_used"] == []
        assert data["recently_created"] == []
        assert data["recently_modified"] == []

    @pytest.mark.anyio
    async def test__auth__unauthenticated_returns_401(
        self, client: AsyncClient,
    ) -> None:
        from core.config import get_settings

        settings = get_settings()
        original = settings.dev_mode
        try:
            object.__setattr__(settings, "dev_mode", False)
            response = await client.get("/mcp/context/prompts")
            assert response.status_code == 401
        finally:
            object.__setattr__(settings, "dev_mode", original)
