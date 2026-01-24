"""
Integration tests for filter sort fallback behavior.

Tests verify that list endpoints use filter's default_sort_by and default_sort_ascending
when filter_id is provided without explicit sort params.
"""
from httpx import AsyncClient


# =============================================================================
# Bookmarks Endpoint Tests
# =============================================================================


async def test__list_bookmarks__filter_id_uses_filter_sort_defaults(
    client: AsyncClient,
) -> None:
    """When filter_id provided without sort params, uses filter's sort defaults."""
    # Create bookmarks with different titles
    await client.post("/bookmarks/", json={"url": "https://a.com", "title": "Zebra"})
    await client.post("/bookmarks/", json={"url": "https://b.com", "title": "Apple"})
    await client.post("/bookmarks/", json={"url": "https://c.com", "title": "Mango"})

    # Create filter with title ascending sort
    filter_response = await client.post(
        "/filters/",
        json={
            "name": "Title Asc Filter",
            "content_types": ["bookmark"],
            "filter_expression": {"groups": [], "group_operator": "OR"},
            "default_sort_by": "title",
            "default_sort_ascending": True,
        },
    )
    filter_id = filter_response.json()["id"]

    # List with filter_id only (no explicit sort params)
    response = await client.get(f"/bookmarks/?filter_id={filter_id}")
    assert response.status_code == 200

    items = response.json()["items"]
    titles = [item["title"] for item in items]
    assert titles == ["Apple", "Mango", "Zebra"]


async def test__list_bookmarks__explicit_sort_overrides_filter_defaults(
    client: AsyncClient,
) -> None:
    """When explicit sort params provided with filter_id, explicit params win."""
    # Create bookmarks
    await client.post("/bookmarks/", json={"url": "https://a.com", "title": "Zebra"})
    await client.post("/bookmarks/", json={"url": "https://b.com", "title": "Apple"})

    # Create filter with title ascending
    filter_response = await client.post(
        "/filters/",
        json={
            "name": "Override Test",
            "content_types": ["bookmark"],
            "filter_expression": {"groups": [], "group_operator": "OR"},
            "default_sort_by": "title",
            "default_sort_ascending": True,
        },
    )
    filter_id = filter_response.json()["id"]

    # List with filter_id but override with explicit sort params
    response = await client.get(
        f"/bookmarks/?filter_id={filter_id}&sort_by=title&sort_order=desc",
    )
    assert response.status_code == 200

    items = response.json()["items"]
    titles = [item["title"] for item in items]
    assert titles == ["Zebra", "Apple"]  # Descending order (override)


async def test__list_bookmarks__partial_override_sort_by_only(
    client: AsyncClient,
) -> None:
    """When only sort_by provided, sort_order falls back to filter default."""
    # Create bookmarks
    await client.post("/bookmarks/", json={"url": "https://a.com", "title": "Zebra"})
    await client.post("/bookmarks/", json={"url": "https://b.com", "title": "Apple"})

    # Create filter with title descending
    filter_response = await client.post(
        "/filters/",
        json={
            "name": "Partial Override Sort By",
            "content_types": ["bookmark"],
            "filter_expression": {"groups": [], "group_operator": "OR"},
            "default_sort_by": "created_at",
            "default_sort_ascending": True,  # asc
        },
    )
    filter_id = filter_response.json()["id"]

    # Override only sort_by, sort_order should come from filter (asc)
    response = await client.get(f"/bookmarks/?filter_id={filter_id}&sort_by=title")
    assert response.status_code == 200

    items = response.json()["items"]
    titles = [item["title"] for item in items]
    assert titles == ["Apple", "Zebra"]  # Title asc (sort_by override + filter's asc)


async def test__list_bookmarks__partial_override_sort_order_only(
    client: AsyncClient,
) -> None:
    """When only sort_order provided, sort_by falls back to filter default."""
    # Create bookmarks
    await client.post("/bookmarks/", json={"url": "https://a.com", "title": "Zebra"})
    await client.post("/bookmarks/", json={"url": "https://b.com", "title": "Apple"})

    # Create filter with title ascending
    filter_response = await client.post(
        "/filters/",
        json={
            "name": "Partial Override Sort Order",
            "content_types": ["bookmark"],
            "filter_expression": {"groups": [], "group_operator": "OR"},
            "default_sort_by": "title",
            "default_sort_ascending": True,
        },
    )
    filter_id = filter_response.json()["id"]

    # Override only sort_order, sort_by should come from filter (title)
    response = await client.get(f"/bookmarks/?filter_id={filter_id}&sort_order=desc")
    assert response.status_code == 200

    items = response.json()["items"]
    titles = [item["title"] for item in items]
    assert titles == ["Zebra", "Apple"]  # Title desc (filter's sort_by + desc override)


async def test__list_bookmarks__filter_without_sort_defaults_uses_global_fallback(
    client: AsyncClient,
) -> None:
    """When filter has no sort defaults, falls back to global defaults (created_at desc)."""
    # Create bookmarks (second one should come first with created_at desc)
    resp1 = await client.post("/bookmarks/", json={"url": "https://first.com", "title": "First"})
    resp2 = await client.post("/bookmarks/", json={"url": "https://second.com", "title": "Second"})

    # Create filter without sort defaults
    filter_response = await client.post(
        "/filters/",
        json={
            "name": "No Sort Defaults",
            "content_types": ["bookmark"],
            "filter_expression": {"groups": [], "group_operator": "OR"},
        },
    )
    filter_id = filter_response.json()["id"]

    # List with filter_id only
    response = await client.get(f"/bookmarks/?filter_id={filter_id}")
    assert response.status_code == 200

    items = response.json()["items"]
    # created_at desc means second (created later) comes first
    assert items[0]["id"] == resp2.json()["id"]
    assert items[1]["id"] == resp1.json()["id"]


async def test__list_bookmarks__no_filter_no_sort_uses_global_defaults(
    client: AsyncClient,
) -> None:
    """When no filter_id and no sort params, uses global defaults (created_at desc)."""
    # Create bookmarks
    resp1 = await client.post("/bookmarks/", json={"url": "https://first.com", "title": "First"})
    resp2 = await client.post("/bookmarks/", json={"url": "https://second.com", "title": "Second"})

    # List without filter_id or sort params
    response = await client.get("/bookmarks/")
    assert response.status_code == 200

    items = response.json()["items"]
    # created_at desc means second comes first
    assert items[0]["id"] == resp2.json()["id"]
    assert items[1]["id"] == resp1.json()["id"]


# =============================================================================
# Notes Endpoint Tests
# =============================================================================


async def test__list_notes__filter_id_uses_filter_sort_defaults(
    client: AsyncClient,
) -> None:
    """When filter_id provided without sort params, uses filter's sort defaults."""
    # Create notes with different titles
    await client.post("/notes/", json={"title": "Zebra Note", "content": "Content"})
    await client.post("/notes/", json={"title": "Apple Note", "content": "Content"})
    await client.post("/notes/", json={"title": "Mango Note", "content": "Content"})

    # Create filter with title ascending sort
    filter_response = await client.post(
        "/filters/",
        json={
            "name": "Notes Title Asc",
            "content_types": ["note"],
            "filter_expression": {"groups": [], "group_operator": "OR"},
            "default_sort_by": "title",
            "default_sort_ascending": True,
        },
    )
    filter_id = filter_response.json()["id"]

    # List with filter_id only
    response = await client.get(f"/notes/?filter_id={filter_id}")
    assert response.status_code == 200

    items = response.json()["items"]
    titles = [item["title"] for item in items]
    assert titles == ["Apple Note", "Mango Note", "Zebra Note"]


async def test__list_notes__explicit_sort_overrides_filter_defaults(
    client: AsyncClient,
) -> None:
    """When explicit sort params provided, they override filter defaults."""
    await client.post("/notes/", json={"title": "Zebra", "content": "Content"})
    await client.post("/notes/", json={"title": "Apple", "content": "Content"})

    filter_response = await client.post(
        "/filters/",
        json={
            "name": "Notes Override",
            "content_types": ["note"],
            "filter_expression": {"groups": [], "group_operator": "OR"},
            "default_sort_by": "title",
            "default_sort_ascending": True,
        },
    )
    filter_id = filter_response.json()["id"]

    response = await client.get(
        f"/notes/?filter_id={filter_id}&sort_by=title&sort_order=desc",
    )
    assert response.status_code == 200

    items = response.json()["items"]
    titles = [item["title"] for item in items]
    assert titles == ["Zebra", "Apple"]


# =============================================================================
# Prompts Endpoint Tests
# =============================================================================


async def test__list_prompts__filter_id_uses_filter_sort_defaults(
    client: AsyncClient,
) -> None:
    """When filter_id provided without sort params, uses filter's sort defaults."""
    # Create prompts with different titles
    await client.post(
        "/prompts/",
        json={"name": "zebra-prompt", "title": "Zebra Prompt", "content": "Content"},
    )
    await client.post(
        "/prompts/",
        json={"name": "apple-prompt", "title": "Apple Prompt", "content": "Content"},
    )
    await client.post(
        "/prompts/",
        json={"name": "mango-prompt", "title": "Mango Prompt", "content": "Content"},
    )

    # Create filter with title ascending sort
    filter_response = await client.post(
        "/filters/",
        json={
            "name": "Prompts Title Asc",
            "content_types": ["prompt"],
            "filter_expression": {"groups": [], "group_operator": "OR"},
            "default_sort_by": "title",
            "default_sort_ascending": True,
        },
    )
    filter_id = filter_response.json()["id"]

    # List with filter_id only
    response = await client.get(f"/prompts/?filter_id={filter_id}")
    assert response.status_code == 200

    items = response.json()["items"]
    titles = [item["title"] for item in items]
    assert titles == ["Apple Prompt", "Mango Prompt", "Zebra Prompt"]


async def test__list_prompts__explicit_sort_overrides_filter_defaults(
    client: AsyncClient,
) -> None:
    """When explicit sort params provided, they override filter defaults."""
    await client.post(
        "/prompts/",
        json={"name": "zebra", "title": "Zebra", "content": "Content"},
    )
    await client.post(
        "/prompts/",
        json={"name": "apple", "title": "Apple", "content": "Content"},
    )

    filter_response = await client.post(
        "/filters/",
        json={
            "name": "Prompts Override",
            "content_types": ["prompt"],
            "filter_expression": {"groups": [], "group_operator": "OR"},
            "default_sort_by": "title",
            "default_sort_ascending": True,
        },
    )
    filter_id = filter_response.json()["id"]

    response = await client.get(
        f"/prompts/?filter_id={filter_id}&sort_by=title&sort_order=desc",
    )
    assert response.status_code == 200

    items = response.json()["items"]
    titles = [item["title"] for item in items]
    assert titles == ["Zebra", "Apple"]


# =============================================================================
# Content Endpoint Tests
# =============================================================================


async def test__list_content__filter_id_uses_filter_sort_defaults(
    client: AsyncClient,
) -> None:
    """When filter_id provided without sort params, uses filter's sort defaults."""
    # Create content with different titles
    await client.post("/bookmarks/", json={"url": "https://z.com", "title": "Zebra Bookmark"})
    await client.post("/notes/", json={"title": "Apple Note", "content": "Content"})
    await client.post(
        "/prompts/",
        json={"name": "mango-prompt", "title": "Mango Prompt", "content": "Content"},
    )

    # Create filter with title ascending sort
    filter_response = await client.post(
        "/filters/",
        json={
            "name": "Content Title Asc",
            "content_types": ["bookmark", "note", "prompt"],
            "filter_expression": {"groups": [], "group_operator": "OR"},
            "default_sort_by": "title",
            "default_sort_ascending": True,
        },
    )
    filter_id = filter_response.json()["id"]

    # List with filter_id only
    response = await client.get(f"/content/?filter_id={filter_id}")
    assert response.status_code == 200

    items = response.json()["items"]
    titles = [item["title"] for item in items]
    assert titles == ["Apple Note", "Mango Prompt", "Zebra Bookmark"]


async def test__list_content__explicit_sort_overrides_filter_defaults(
    client: AsyncClient,
) -> None:
    """When explicit sort params provided, they override filter defaults."""
    await client.post("/bookmarks/", json={"url": "https://z.com", "title": "Zebra"})
    await client.post("/notes/", json={"title": "Apple", "content": "Content"})

    filter_response = await client.post(
        "/filters/",
        json={
            "name": "Content Override",
            "content_types": ["bookmark", "note"],
            "filter_expression": {"groups": [], "group_operator": "OR"},
            "default_sort_by": "title",
            "default_sort_ascending": True,
        },
    )
    filter_id = filter_response.json()["id"]

    response = await client.get(
        f"/content/?filter_id={filter_id}&sort_by=title&sort_order=desc",
    )
    assert response.status_code == 200

    items = response.json()["items"]
    titles = [item["title"] for item in items]
    assert titles == ["Zebra", "Apple"]


async def test__list_content__content_types_intersection_still_works(
    client: AsyncClient,
) -> None:
    """Content types query param still intersects with filter's content_types."""
    await client.post("/bookmarks/", json={"url": "https://a.com", "title": "Bookmark"})
    await client.post("/notes/", json={"title": "Note", "content": "Content"})
    await client.post(
        "/prompts/",
        json={"name": "prompt", "title": "Prompt", "content": "Content"},
    )

    # Filter allows bookmark and note
    filter_response = await client.post(
        "/filters/",
        json={
            "name": "Bookmark Note Filter",
            "content_types": ["bookmark", "note"],
            "filter_expression": {"groups": [], "group_operator": "OR"},
            "default_sort_by": "title",
            "default_sort_ascending": True,
        },
    )
    filter_id = filter_response.json()["id"]

    # Request only bookmarks (intersection with filter's [bookmark, note])
    response = await client.get(f"/content/?filter_id={filter_id}&content_types=bookmark")
    assert response.status_code == 200

    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["type"] == "bookmark"


# =============================================================================
# Edge Cases
# =============================================================================


async def test__list_bookmarks__filter_has_sort_by_but_null_ascending(
    client: AsyncClient,
) -> None:
    """Filter has default_sort_by but null default_sort_ascending."""
    await client.post("/bookmarks/", json={"url": "https://z.com", "title": "Zebra"})
    await client.post("/bookmarks/", json={"url": "https://a.com", "title": "Apple"})

    # Filter with sort_by but no ascending preference
    filter_response = await client.post(
        "/filters/",
        json={
            "name": "Sort By Only",
            "content_types": ["bookmark"],
            "filter_expression": {"groups": [], "group_operator": "OR"},
            "default_sort_by": "title",
            # default_sort_ascending not set (null)
        },
    )
    filter_id = filter_response.json()["id"]

    response = await client.get(f"/bookmarks/?filter_id={filter_id}")
    assert response.status_code == 200

    items = response.json()["items"]
    titles = [item["title"] for item in items]
    # sort_by from filter (title), sort_order fallback to desc
    assert titles == ["Zebra", "Apple"]


async def test__list_bookmarks__filter_not_found_returns_404(
    client: AsyncClient,
) -> None:
    """When filter_id not found, returns 404."""
    response = await client.get(
        "/bookmarks/?filter_id=00000000-0000-0000-0000-000000000000",
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Filter not found"


async def test__list_notes__filter_not_found_returns_404(
    client: AsyncClient,
) -> None:
    """When filter_id not found, returns 404."""
    response = await client.get(
        "/notes/?filter_id=00000000-0000-0000-0000-000000000000",
    )
    assert response.status_code == 404


async def test__list_prompts__filter_not_found_returns_404(
    client: AsyncClient,
) -> None:
    """When filter_id not found, returns 404."""
    response = await client.get(
        "/prompts/?filter_id=00000000-0000-0000-0000-000000000000",
    )
    assert response.status_code == 404


async def test__list_content__filter_not_found_returns_404(
    client: AsyncClient,
) -> None:
    """When filter_id not found, returns 404."""
    response = await client.get(
        "/content/?filter_id=00000000-0000-0000-0000-000000000000",
    )
    assert response.status_code == 404


async def test__list_bookmarks__filter_applies_tag_expression(
    client: AsyncClient,
) -> None:
    """Verify filter's filter_expression still applies correctly."""
    # Create bookmarks with different tags
    await client.post(
        "/bookmarks/",
        json={"url": "https://work.com", "title": "Work Item", "tags": ["work"]},
    )
    await client.post(
        "/bookmarks/",
        json={"url": "https://personal.com", "title": "Personal Item", "tags": ["personal"]},
    )

    # Filter for work tag with title asc
    filter_response = await client.post(
        "/filters/",
        json={
            "name": "Work Filter",
            "content_types": ["bookmark"],
            "filter_expression": {"groups": [{"tags": ["work"]}], "group_operator": "OR"},
            "default_sort_by": "title",
            "default_sort_ascending": True,
        },
    )
    filter_id = filter_response.json()["id"]

    response = await client.get(f"/bookmarks/?filter_id={filter_id}")
    assert response.status_code == 200

    items = response.json()["items"]
    assert len(items) == 1
    assert items[0]["title"] == "Work Item"
