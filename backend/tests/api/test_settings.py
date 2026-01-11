"""
Tests for user settings API endpoints.

Tests cover sidebar structure retrieval, update, and list integration.
"""
from httpx import AsyncClient


async def test__get_sidebar__returns_default_structure(client: AsyncClient) -> None:
    """Test getting sidebar returns default structure for new user."""
    response = await client.get("/settings/sidebar")
    assert response.status_code == 200

    data = response.json()
    assert "version" in data
    assert "items" in data
    assert data["version"] == 1

    # Check default builtins are present with names
    builtin_keys = [
        item["key"] for item in data["items"] if item["type"] == "builtin"
    ]
    assert "all" in builtin_keys
    assert "archived" in builtin_keys
    assert "trash" in builtin_keys


async def test__get_sidebar__resolves_list_names(client: AsyncClient) -> None:
    """Test that list names are resolved in sidebar response."""
    # Create a list first
    create_response = await client.post(
        "/filters/",
        json={
            "name": "My Reading List",
            "content_types": ["bookmark"],
            "filter_expression": {"groups": [{"tags": ["reading"]}], "group_operator": "OR"},
        },
    )
    assert create_response.status_code == 201
    filter_id = create_response.json()["id"]

    # Get sidebar
    response = await client.get("/settings/sidebar")
    assert response.status_code == 200

    data = response.json()

    # Find the list in items
    list_items = [item for item in data["items"] if item["type"] == "filter"]
    assert len(list_items) >= 1

    # Find our specific list
    our_list = next((item for item in list_items if item["id"] == filter_id), None)
    assert our_list is not None
    assert our_list["name"] == "My Reading List"
    assert our_list["content_types"] == ["bookmark"]


async def test__put_sidebar__updates_structure(client: AsyncClient) -> None:
    """Test updating sidebar structure."""
    response = await client.put(
        "/settings/sidebar",
        json={
            "version": 1,
            "items": [
                {"type": "builtin", "key": "trash"},
                {"type": "builtin", "key": "all"},
                {"type": "builtin", "key": "archived"},
            ],
        },
    )
    assert response.status_code == 200

    data = response.json()
    # Filter to builtins only (orphan lists may be prepended)
    builtins = [item for item in data["items"] if item["type"] == "builtin"]
    # Order among builtins should be preserved
    assert builtins[0]["key"] == "trash"
    assert builtins[1]["key"] == "all"
    assert builtins[2]["key"] == "archived"


async def test__put_sidebar__with_groups(client: AsyncClient) -> None:
    """Test updating sidebar with groups."""
    # Create a list first
    create_response = await client.post(
        "/filters/",
        json={
            "name": "Work Items",
            "content_types": ["bookmark", "note"],
            "filter_expression": {"groups": [{"tags": ["work"]}], "group_operator": "OR"},
        },
    )
    filter_id = create_response.json()["id"]

    response = await client.put(
        "/settings/sidebar",
        json={
            "version": 1,
            "items": [
                {"type": "builtin", "key": "all"},
                {
                    "type": "collection",
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "name": "Work",
                    "items": [
                        {"type": "filter", "id": filter_id},
                    ],
                },
                {"type": "builtin", "key": "archived"},
                {"type": "builtin", "key": "trash"},
            ],
        },
    )
    assert response.status_code == 200

    data = response.json()
    # Check group is present
    groups = [item for item in data["items"] if item["type"] == "collection"]
    assert len(groups) == 1
    assert groups[0]["name"] == "Work"
    assert len(groups[0]["items"]) == 1


async def test__put_sidebar__rejects_duplicate_list(client: AsyncClient) -> None:
    """Test that duplicate list IDs are rejected."""
    # Create a list
    create_response = await client.post(
        "/filters/",
        json={
            "name": "Test List",
            "content_types": ["bookmark"],
            "filter_expression": {"groups": [{"tags": ["test"]}], "group_operator": "OR"},
        },
    )
    filter_id = create_response.json()["id"]

    response = await client.put(
        "/settings/sidebar",
        json={
            "version": 1,
            "items": [
                {"type": "filter", "id": filter_id},
                {"type": "filter", "id": filter_id},  # Duplicate
            ],
        },
    )
    assert response.status_code == 400
    assert "Duplicate filter item" in response.json()["detail"]


async def test__put_sidebar__rejects_duplicate_builtin(client: AsyncClient) -> None:
    """Test that duplicate builtin keys are rejected."""
    response = await client.put(
        "/settings/sidebar",
        json={
            "version": 1,
            "items": [
                {"type": "builtin", "key": "all"},
                {"type": "builtin", "key": "all"},  # Duplicate
            ],
        },
    )
    assert response.status_code == 400
    assert "Duplicate builtin item" in response.json()["detail"]


async def test__put_sidebar__rejects_nonexistent_list(client: AsyncClient) -> None:
    """Test that nonexistent list IDs are rejected."""
    response = await client.put(
        "/settings/sidebar",
        json={
            "version": 1,
            "items": [
                {"type": "filter", "id": "00000000-0000-0000-0000-000000000000"},
            ],
        },
    )
    assert response.status_code == 400
    assert "Filter not found" in response.json()["detail"]


async def test__put_sidebar__rejects_invalid_uuid(client: AsyncClient) -> None:
    """Test that invalid group UUIDs are rejected at schema level."""
    response = await client.put(
        "/settings/sidebar",
        json={
            "version": 1,
            "items": [
                {
                    "type": "collection",
                    "id": "not-a-uuid",
                    "name": "Test",
                    "items": [],
                },
            ],
        },
    )
    assert response.status_code == 422  # Validation error


async def test__put_sidebar__rejects_nested_groups(client: AsyncClient) -> None:
    """Test that nested groups are rejected at schema level."""
    response = await client.put(
        "/settings/sidebar",
        json={
            "version": 1,
            "items": [
                {
                    "type": "collection",
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "name": "Outer",
                    "items": [
                        {
                            "type": "collection",
                            "id": "660e8400-e29b-41d4-a716-446655440001",
                            "name": "Inner",
                            "items": [],
                        },
                    ],
                },
            ],
        },
    )
    assert response.status_code == 422  # Validation error


async def test__get_sidebar__filters_deleted_lists(client: AsyncClient) -> None:
    """Test that deleted list references are filtered from sidebar."""
    # Create and delete a list
    create_response = await client.post(
        "/filters/",
        json={
            "name": "To Delete",
            "content_types": ["bookmark"],
            "filter_expression": {"groups": [{"tags": ["delete"]}], "group_operator": "OR"},
        },
    )
    filter_id = create_response.json()["id"]

    # Delete the list
    await client.delete(f"/filters/{filter_id}")

    # Get sidebar - deleted list should not appear
    response = await client.get("/settings/sidebar")
    assert response.status_code == 200

    data = response.json()
    filter_ids = [item["id"] for item in data["items"] if item["type"] == "filter"]
    assert filter_id not in filter_ids


async def test__get_sidebar__prepends_orphan_lists(client: AsyncClient) -> None:
    """Test that lists not in sidebar_order are prepended."""
    # Create a list (automatically added to sidebar)
    create_response = await client.post(
        "/filters/",
        json={
            "name": "New List",
            "content_types": ["note"],
            "filter_expression": {"groups": [{"tags": ["new"]}], "group_operator": "OR"},
        },
    )
    filter_id = create_response.json()["id"]

    # Override sidebar to NOT include the list
    await client.put(
        "/settings/sidebar",
        json={
            "version": 1,
            "items": [
                {"type": "builtin", "key": "all"},
            ],
        },
    )

    # Get sidebar - orphan lists should be prepended before builtins
    response = await client.get("/settings/sidebar")
    assert response.status_code == 200

    data = response.json()
    # Find all list items that appear before the first builtin
    # (these are the prepended orphan lists)
    orphan_filter_ids = []
    for item in data["items"]:
        if item["type"] == "filter":
            orphan_filter_ids.append(item["id"])
        elif item["type"] == "builtin":
            break  # Stop at first builtin
    # Our created list should be among the prepended orphans
    assert filter_id in orphan_filter_ids


async def test__list_creation__adds_to_sidebar(client: AsyncClient) -> None:
    """Test that creating a list adds it to sidebar_order."""
    # Create a list
    create_response = await client.post(
        "/filters/",
        json={
            "name": "Auto Added List",
            "content_types": ["bookmark"],
            "filter_expression": {"groups": [{"tags": ["auto"]}], "group_operator": "OR"},
        },
    )
    assert create_response.status_code == 201
    filter_id = create_response.json()["id"]

    # Get sidebar
    response = await client.get("/settings/sidebar")
    assert response.status_code == 200

    data = response.json()
    filter_ids = [item["id"] for item in data["items"] if item["type"] == "filter"]
    assert filter_id in filter_ids


async def test__list_deletion__removes_from_sidebar(client: AsyncClient) -> None:
    """Test that deleting a list removes it from sidebar_order."""
    # Create a list
    create_response = await client.post(
        "/filters/",
        json={
            "name": "To Be Deleted",
            "content_types": ["bookmark"],
            "filter_expression": {"groups": [{"tags": ["tbd"]}], "group_operator": "OR"},
        },
    )
    filter_id = create_response.json()["id"]

    # Verify it's in sidebar
    response = await client.get("/settings/sidebar")
    filter_ids = [item["id"] for item in response.json()["items"] if item["type"] == "filter"]
    assert filter_id in filter_ids

    # Delete the list
    await client.delete(f"/filters/{filter_id}")

    # Verify it's removed from sidebar
    response = await client.get("/settings/sidebar")
    filter_ids = [item["id"] for item in response.json()["items"] if item["type"] == "filter"]
    assert filter_id not in filter_ids


async def test__put_sidebar__rejects_duplicate_group_id(client: AsyncClient) -> None:
    """Test that duplicate group IDs are rejected."""
    response = await client.put(
        "/settings/sidebar",
        json={
            "version": 1,
            "items": [
                {
                    "type": "collection",
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "name": "Group One",
                    "items": [],
                },
                {
                    "type": "collection",
                    "id": "550e8400-e29b-41d4-a716-446655440000",  # Same ID
                    "name": "Group Two",
                    "items": [],
                },
            ],
        },
    )
    assert response.status_code == 400
    assert "Duplicate collection item" in response.json()["detail"]


async def test__list_deletion__removes_from_group_in_sidebar(client: AsyncClient) -> None:
    """Test that deleting a list removes it from a group in sidebar_order."""
    # Create a list
    create_response = await client.post(
        "/filters/",
        json={
            "name": "List In Group",
            "content_types": ["bookmark"],
            "filter_expression": {"groups": [{"tags": ["grouped"]}], "group_operator": "OR"},
        },
    )
    filter_id = create_response.json()["id"]

    # Put list inside a group in sidebar
    await client.put(
        "/settings/sidebar",
        json={
            "version": 1,
            "items": [
                {"type": "builtin", "key": "all"},
                {
                    "type": "collection",
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "name": "Work",
                    "items": [
                        {"type": "filter", "id": filter_id},
                    ],
                },
                {"type": "builtin", "key": "archived"},
                {"type": "builtin", "key": "trash"},
            ],
        },
    )

    # Verify list is in group
    response = await client.get("/settings/sidebar")
    groups = [item for item in response.json()["items"] if item["type"] == "collection"]
    assert len(groups) == 1
    assert len(groups[0]["items"]) == 1
    assert groups[0]["items"][0]["id"] == filter_id

    # Delete the list
    await client.delete(f"/filters/{filter_id}")

    # Verify list is removed from group
    response = await client.get("/settings/sidebar")
    groups = [item for item in response.json()["items"] if item["type"] == "collection"]
    assert len(groups) == 1
    # Group should now be empty (list was removed)
    assert len(groups[0]["items"]) == 0


async def test__get_sidebar__resolves_builtin_display_names(client: AsyncClient) -> None:
    """Test that builtin items have display names resolved."""
    response = await client.get("/settings/sidebar")
    assert response.status_code == 200

    data = response.json()
    builtins = [item for item in data["items"] if item["type"] == "builtin"]

    # Each builtin should have a name field with proper display name
    for builtin in builtins:
        assert "name" in builtin
        assert builtin["name"]  # Not empty

        # Verify specific display names
        if builtin["key"] == "all":
            assert builtin["name"] == "All Content"
        elif builtin["key"] == "archived":
            assert builtin["name"] == "Archived"
        elif builtin["key"] == "trash":
            assert builtin["name"] == "Trash"
