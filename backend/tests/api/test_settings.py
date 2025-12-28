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
        "/lists/",
        json={
            "name": "My Reading List",
            "content_types": ["bookmark"],
            "filter_expression": {"groups": [{"tags": ["reading"]}], "group_operator": "OR"},
        },
    )
    assert create_response.status_code == 201
    list_id = create_response.json()["id"]

    # Get sidebar
    response = await client.get("/settings/sidebar")
    assert response.status_code == 200

    data = response.json()

    # Find the list in items
    list_items = [item for item in data["items"] if item["type"] == "list"]
    assert len(list_items) >= 1

    # Find our specific list
    our_list = next((item for item in list_items if item["id"] == list_id), None)
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
    # Order should be preserved
    assert data["items"][0]["key"] == "trash"
    assert data["items"][1]["key"] == "all"
    assert data["items"][2]["key"] == "archived"


async def test__put_sidebar__with_groups(client: AsyncClient) -> None:
    """Test updating sidebar with groups."""
    # Create a list first
    create_response = await client.post(
        "/lists/",
        json={
            "name": "Work Items",
            "content_types": ["bookmark", "note"],
            "filter_expression": {"groups": [{"tags": ["work"]}], "group_operator": "OR"},
        },
    )
    list_id = create_response.json()["id"]

    response = await client.put(
        "/settings/sidebar",
        json={
            "version": 1,
            "items": [
                {"type": "builtin", "key": "all"},
                {
                    "type": "group",
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "name": "Work",
                    "items": [
                        {"type": "list", "id": list_id},
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
    groups = [item for item in data["items"] if item["type"] == "group"]
    assert len(groups) == 1
    assert groups[0]["name"] == "Work"
    assert len(groups[0]["items"]) == 1


async def test__put_sidebar__rejects_duplicate_list(client: AsyncClient) -> None:
    """Test that duplicate list IDs are rejected."""
    # Create a list
    create_response = await client.post(
        "/lists/",
        json={
            "name": "Test List",
            "content_types": ["bookmark"],
            "filter_expression": {"groups": [{"tags": ["test"]}], "group_operator": "OR"},
        },
    )
    list_id = create_response.json()["id"]

    response = await client.put(
        "/settings/sidebar",
        json={
            "version": 1,
            "items": [
                {"type": "list", "id": list_id},
                {"type": "list", "id": list_id},  # Duplicate
            ],
        },
    )
    assert response.status_code == 400
    assert "Duplicate list item" in response.json()["detail"]


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
                {"type": "list", "id": 99999},
            ],
        },
    )
    assert response.status_code == 400
    assert "List not found" in response.json()["detail"]


async def test__put_sidebar__rejects_invalid_uuid(client: AsyncClient) -> None:
    """Test that invalid group UUIDs are rejected at schema level."""
    response = await client.put(
        "/settings/sidebar",
        json={
            "version": 1,
            "items": [
                {
                    "type": "group",
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
                    "type": "group",
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "name": "Outer",
                    "items": [
                        {
                            "type": "group",
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
        "/lists/",
        json={
            "name": "To Delete",
            "content_types": ["bookmark"],
            "filter_expression": {"groups": [{"tags": ["delete"]}], "group_operator": "OR"},
        },
    )
    list_id = create_response.json()["id"]

    # Delete the list
    await client.delete(f"/lists/{list_id}")

    # Get sidebar - deleted list should not appear
    response = await client.get("/settings/sidebar")
    assert response.status_code == 200

    data = response.json()
    list_ids = [item["id"] for item in data["items"] if item["type"] == "list"]
    assert list_id not in list_ids


async def test__get_sidebar__appends_orphan_lists(client: AsyncClient) -> None:
    """Test that lists not in sidebar_order are appended."""
    # Create a list (automatically added to sidebar)
    create_response = await client.post(
        "/lists/",
        json={
            "name": "New List",
            "content_types": ["note"],
            "filter_expression": {"groups": [{"tags": ["new"]}], "group_operator": "OR"},
        },
    )
    list_id = create_response.json()["id"]

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

    # Get sidebar - orphan list should be appended
    response = await client.get("/settings/sidebar")
    assert response.status_code == 200

    data = response.json()
    list_items = [item for item in data["items"] if item["type"] == "list"]
    list_ids = [item["id"] for item in list_items]
    assert list_id in list_ids


async def test__list_creation__adds_to_sidebar(client: AsyncClient) -> None:
    """Test that creating a list adds it to sidebar_order."""
    # Create a list
    create_response = await client.post(
        "/lists/",
        json={
            "name": "Auto Added List",
            "content_types": ["bookmark"],
            "filter_expression": {"groups": [{"tags": ["auto"]}], "group_operator": "OR"},
        },
    )
    assert create_response.status_code == 201
    list_id = create_response.json()["id"]

    # Get sidebar
    response = await client.get("/settings/sidebar")
    assert response.status_code == 200

    data = response.json()
    list_ids = [item["id"] for item in data["items"] if item["type"] == "list"]
    assert list_id in list_ids


async def test__list_deletion__removes_from_sidebar(client: AsyncClient) -> None:
    """Test that deleting a list removes it from sidebar_order."""
    # Create a list
    create_response = await client.post(
        "/lists/",
        json={
            "name": "To Be Deleted",
            "content_types": ["bookmark"],
            "filter_expression": {"groups": [{"tags": ["tbd"]}], "group_operator": "OR"},
        },
    )
    list_id = create_response.json()["id"]

    # Verify it's in sidebar
    response = await client.get("/settings/sidebar")
    list_ids = [item["id"] for item in response.json()["items"] if item["type"] == "list"]
    assert list_id in list_ids

    # Delete the list
    await client.delete(f"/lists/{list_id}")

    # Verify it's removed from sidebar
    response = await client.get("/settings/sidebar")
    list_ids = [item["id"] for item in response.json()["items"] if item["type"] == "list"]
    assert list_id not in list_ids


async def test__put_sidebar__rejects_duplicate_group_id(client: AsyncClient) -> None:
    """Test that duplicate group IDs are rejected."""
    response = await client.put(
        "/settings/sidebar",
        json={
            "version": 1,
            "items": [
                {
                    "type": "group",
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "name": "Group One",
                    "items": [],
                },
                {
                    "type": "group",
                    "id": "550e8400-e29b-41d4-a716-446655440000",  # Same ID
                    "name": "Group Two",
                    "items": [],
                },
            ],
        },
    )
    assert response.status_code == 400
    assert "Duplicate group ID" in response.json()["detail"]


async def test__list_deletion__removes_from_group_in_sidebar(client: AsyncClient) -> None:
    """Test that deleting a list removes it from a group in sidebar_order."""
    # Create a list
    create_response = await client.post(
        "/lists/",
        json={
            "name": "List In Group",
            "content_types": ["bookmark"],
            "filter_expression": {"groups": [{"tags": ["grouped"]}], "group_operator": "OR"},
        },
    )
    list_id = create_response.json()["id"]

    # Put list inside a group in sidebar
    await client.put(
        "/settings/sidebar",
        json={
            "version": 1,
            "items": [
                {"type": "builtin", "key": "all"},
                {
                    "type": "group",
                    "id": "550e8400-e29b-41d4-a716-446655440000",
                    "name": "Work",
                    "items": [
                        {"type": "list", "id": list_id},
                    ],
                },
                {"type": "builtin", "key": "archived"},
                {"type": "builtin", "key": "trash"},
            ],
        },
    )

    # Verify list is in group
    response = await client.get("/settings/sidebar")
    groups = [item for item in response.json()["items"] if item["type"] == "group"]
    assert len(groups) == 1
    assert len(groups[0]["items"]) == 1
    assert groups[0]["items"][0]["id"] == list_id

    # Delete the list
    await client.delete(f"/lists/{list_id}")

    # Verify list is removed from group
    response = await client.get("/settings/sidebar")
    groups = [item for item in response.json()["items"] if item["type"] == "group"]
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
            assert builtin["name"] == "All"
        elif builtin["key"] == "archived":
            assert builtin["name"] == "Archived"
        elif builtin["key"] == "trash":
            assert builtin["name"] == "Trash"
