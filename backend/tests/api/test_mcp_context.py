"""Tests for MCP context endpoints."""
import uuid
from unittest.mock import MagicMock

from httpx import AsyncClient

from core.config import get_settings
from services.mcp_context_service import _is_relevant_filter


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
        assert "sidebar_items" in data
        assert "recently_used" in data
        assert "recently_created" in data
        assert "recently_modified" in data

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

    async def test__tags__limited_by_tag_limit(
        self, client: AsyncClient,
    ) -> None:
        # Create bookmarks with different tags
        for i in range(5):
            await _create_bookmark(client, tags=[f"tag-{i}"])

        response = await client.get("/mcp/context/content?tag_limit=2")
        data = response.json()

        assert len(data["top_tags"]) <= 2

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

    async def test__top_tags__excludes_prompt_only_tags(
        self, client: AsyncClient,
    ) -> None:
        """Content context top_tags should not include tags only used by prompts."""
        await _create_bookmark(client, tags=["python"])
        await _create_prompt(client, tags=["prompt-only"])

        response = await client.get("/mcp/context/content")
        data = response.json()

        tag_names = [t["name"] for t in data["top_tags"]]
        assert "python" in tag_names
        assert "prompt-only" not in tag_names

    async def test__top_tags__excludes_filter_only_tags(
        self, client: AsyncClient,
    ) -> None:
        """Tags used only in filters (content_count=0) should not appear in context."""
        await _create_bookmark(client, tags=["python"])
        # "filter-only" tag is used in a filter but not on any bookmarks/notes
        await _create_filter(
            client, "Filter Only", [["filter-only"]], ["bookmark", "note"],
        )

        response = await client.get("/mcp/context/content")
        data = response.json()

        tag_names = [t["name"] for t in data["top_tags"]]
        assert "python" in tag_names
        assert "filter-only" not in tag_names

    async def test__filters__excludes_prompt_only_filters(
        self, client: AsyncClient,
    ) -> None:
        """Content context should not include filters scoped only to prompts."""
        await _create_filter(client, "Prompt Only", [["test"]], ["prompt"])
        await _create_filter(client, "BM Filter", [["test"]], ["bookmark"])

        response = await client.get("/mcp/context/content")
        data = response.json()

        filter_names = [f["name"] for f in data["filters"]]
        assert "BM Filter" in filter_names
        assert "Prompt Only" not in filter_names

    async def test__sidebar_items__included_when_present(
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

        assert len(data["sidebar_items"]) == 1
        assert data["sidebar_items"][0]["type"] == "collection"
        assert data["sidebar_items"][0]["name"] == "Development"
        assert len(data["sidebar_items"][0]["items"]) == 1
        assert data["sidebar_items"][0]["items"][0]["type"] == "filter"

    async def test__sidebar_items__empty_when_no_sidebar_filters(
        self, client: AsyncClient,
    ) -> None:
        response = await client.get("/mcp/context/content")
        data = response.json()
        assert data["sidebar_items"] == []

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

    async def test__recently_modified__sorted_by_updated_at(
        self, client: AsyncClient,
    ) -> None:
        bm1 = await _create_bookmark(client, title="First")
        await _create_bookmark(client, title="Second")

        # Update the first bookmark so it has a newer updated_at
        await client.patch(
            f"/bookmarks/{bm1['id']}",
            json={"title": "First Updated"},
        )

        response = await client.get("/mcp/context/content")
        data = response.json()

        modified_titles = [item["title"] for item in data["recently_modified"]]
        # "First Updated" was modified most recently
        assert modified_titles.index("First Updated") < modified_titles.index("Second")

    async def test__recently_used__null_last_used_at_sorts_last(
        self, client: AsyncClient,
    ) -> None:
        await _create_bookmark(client, title="Never Used")
        bm2 = await _create_bookmark(client, title="Used")

        # Only track usage for one
        await client.post(f"/bookmarks/{bm2['id']}/track-usage")

        response = await client.get("/mcp/context/content")
        data = response.json()

        used_titles = [item["title"] for item in data["recently_used"]]
        assert "Used" in used_titles
        assert "Never Used" in used_titles
        assert used_titles.index("Used") < used_titles.index("Never Used")

    async def test__filter_limit_zero__returns_no_filters(
        self, client: AsyncClient,
    ) -> None:
        await _create_bookmark(client, tags=["test"])
        await _create_filter(client, "Test Filter", [["test"]], ["bookmark"])

        response = await client.get("/mcp/context/content?filter_limit=0")
        data = response.json()

        assert data["filters"] == []

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

    async def test__auth__unauthenticated_returns_401(
        self, client: AsyncClient,
    ) -> None:
        # Disable dev mode to require auth
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
        assert "sidebar_items" in data
        assert "recently_used" in data
        assert "recently_created" in data
        assert "recently_modified" in data

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

    async def test__prompt_name_included(
        self, client: AsyncClient,
    ) -> None:
        await _create_prompt(client, name="my-prompt")

        response = await client.get("/mcp/context/prompts")
        data = response.json()

        names = [p["name"] for p in data["recently_created"]]
        assert "my-prompt" in names

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

    async def test__top_tags__excludes_bookmark_only_tags(
        self, client: AsyncClient,
    ) -> None:
        """Prompt context top_tags should not include tags only used by bookmarks/notes."""
        await _create_bookmark(client, tags=["bookmark-only"])
        await _create_prompt(client, tags=["code-review"])

        response = await client.get("/mcp/context/prompts")
        data = response.json()

        tag_names = [t["name"] for t in data["top_tags"]]
        assert "code-review" in tag_names
        assert "bookmark-only" not in tag_names

    async def test__top_tags__excludes_filter_only_tags(
        self, client: AsyncClient,
    ) -> None:
        """Tags used only in filters (content_count=0) should not appear in context."""
        await _create_prompt(client, tags=["code-review"])
        # "filter-only" tag is used in a prompt-relevant filter but not on any prompts
        await _create_filter(
            client, "Filter Only", [["filter-only"]], ["prompt"],
        )

        response = await client.get("/mcp/context/prompts")
        data = response.json()

        tag_names = [t["name"] for t in data["top_tags"]]
        assert "code-review" in tag_names
        assert "filter-only" not in tag_names

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

    async def test__filter_items__scoped_to_prompts_only(
        self, client: AsyncClient,
    ) -> None:
        """Prompt context should not include bookmarks/notes in filter items."""
        await _create_bookmark(client, tags=["shared"])
        await _create_prompt(client, tags=["shared"])
        await _create_filter(
            client, "Shared", [["shared"]], ["bookmark", "note", "prompt"],
        )

        response = await client.get("/mcp/context/prompts")
        data = response.json()

        shared_filter = next((f for f in data["filters"] if f["name"] == "Shared"), None)
        assert shared_filter is not None
        # All items should be prompts — no bookmarks or notes
        for item in shared_filter["items"]:
            assert "arguments" in item  # Only ContextPrompt has arguments

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

    async def test__auth__unauthenticated_returns_401(
        self, client: AsyncClient,
    ) -> None:
        settings = get_settings()
        original = settings.dev_mode
        try:
            object.__setattr__(settings, "dev_mode", False)
            response = await client.get("/mcp/context/prompts")
            assert response.status_code == 401
        finally:
            object.__setattr__(settings, "dev_mode", original)


# =============================================================================
# Unit tests for internal helpers
# =============================================================================


class TestIsRelevantFilter:
    """Tests for _is_relevant_filter."""

    def test__none_filter_expression__returns_false(self) -> None:
        mock_filter = MagicMock()
        mock_filter.filter_expression = None
        mock_filter.content_types = ["bookmark"]

        assert _is_relevant_filter(mock_filter, ["bookmark"]) is False

    def test__empty_groups__returns_false(self) -> None:
        mock_filter = MagicMock()
        mock_filter.filter_expression = {"groups": []}
        mock_filter.content_types = ["bookmark"]

        assert _is_relevant_filter(mock_filter, ["bookmark"]) is False

    def test__no_content_type_overlap__returns_false(self) -> None:
        mock_filter = MagicMock()
        mock_filter.filter_expression = {"groups": [{"tags": ["python"]}]}
        mock_filter.content_types = ["prompt"]

        assert _is_relevant_filter(mock_filter, ["bookmark", "note"]) is False

    def test__valid_filter__returns_true(self) -> None:
        mock_filter = MagicMock()
        mock_filter.filter_expression = {"groups": [{"tags": ["python"]}]}
        mock_filter.content_types = ["bookmark", "note"]

        assert _is_relevant_filter(mock_filter, ["bookmark", "note"]) is True
