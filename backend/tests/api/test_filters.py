"""
Tests for content filter API endpoints.

Tests cover filter creation, retrieval, update, deletion, and user isolation.
"""
from httpx import AsyncClient


async def test_create_filter(client: AsyncClient) -> None:
    """Test creating a new content filter."""
    response = await client.post(
        "/filters/",
        json={
            "name": "Work Tasks",
            "filter_expression": {
                "groups": [{"tags": ["work", "priority"]}],
                "group_operator": "OR",
            },
        },
    )
    assert response.status_code == 201

    data = response.json()
    assert data["name"] == "Work Tasks"
    # Tags are sorted alphabetically in the response
    assert data["filter_expression"]["groups"][0]["tags"] == ["priority", "work"]
    assert "id" in data
    assert "created_at" in data
    assert "updated_at" in data


async def test_create_filter_normalizes_tags(client: AsyncClient) -> None:
    """Test that tags are normalized to lowercase and sorted alphabetically."""
    response = await client.post(
        "/filters/",
        json={
            "name": "Mixed Case",
            "filter_expression": {
                "groups": [{"tags": ["WORK", "Priority"]}],
                "group_operator": "OR",
            },
        },
    )
    assert response.status_code == 201

    data = response.json()
    # Tags are lowercase and sorted alphabetically
    assert data["filter_expression"]["groups"][0]["tags"] == ["priority", "work"]


async def test_create_filter_validates_name(client: AsyncClient) -> None:
    """Test that filter name is required and validated."""
    # Empty name
    response = await client.post(
        "/filters/",
        json={
            "name": "",
            "filter_expression": {
                "groups": [{"tags": ["tag"]}],
                "group_operator": "OR",
            },
        },
    )
    assert response.status_code == 422

    # Missing name
    response = await client.post(
        "/filters/",
        json={
            "filter_expression": {
                "groups": [{"tags": ["tag"]}],
                "group_operator": "OR",
            },
        },
    )
    assert response.status_code == 422


async def test_create_filter_validates_filter_expression(client: AsyncClient) -> None:
    """Test that filter expression can be empty (no tag filters)."""
    response = await client.post(
        "/filters/",
        json={
            "name": "No Filter Expression",
            "filter_expression": {
                "groups": [],
                "group_operator": "OR",
            },
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["filter_expression"]["groups"] == []


async def test_create_filter_validates_tag_format(client: AsyncClient) -> None:
    """Test that tags are validated for proper format."""
    # Invalid tag with special characters
    response = await client.post(
        "/filters/",
        json={
            "name": "Invalid Tags",
            "filter_expression": {
                "groups": [{"tags": ["invalid@tag"]}],
                "group_operator": "OR",
            },
        },
    )
    assert response.status_code == 422


async def test_get_filters_empty(client: AsyncClient) -> None:
    """Test getting filters returns default filters for a new user."""
    response = await client.get("/filters/")
    assert response.status_code == 200
    data = response.json()
    names = {item["name"] for item in data}
    assert names == {"All Bookmarks", "All Notes", "All Prompts"}


async def test_get_filters(client: AsyncClient) -> None:
    """Test getting all filters for a user."""
    # Create two filters
    await client.post(
        "/filters/",
        json={
            "name": "First",
            "filter_expression": {"groups": [{"tags": ["tag1"]}], "group_operator": "OR"},
        },
    )
    await client.post(
        "/filters/",
        json={
            "name": "Second",
            "filter_expression": {"groups": [{"tags": ["tag2"]}], "group_operator": "OR"},
        },
    )

    response = await client.get("/filters/")
    assert response.status_code == 200

    data = response.json()
    custom_filters = [
        item for item in data if item["name"] not in {"All Bookmarks", "All Notes", "All Prompts"}
    ]
    assert len(custom_filters) == 2
    # Should be ordered by created_at for custom filters
    assert custom_filters[0]["name"] == "First"
    assert custom_filters[1]["name"] == "Second"


async def test_get_filter_by_id(client: AsyncClient) -> None:
    """Test getting a specific filter by ID."""
    # Create a filter
    create_response = await client.post(
        "/filters/",
        json={
            "name": "Target",
            "filter_expression": {"groups": [{"tags": ["target"]}], "group_operator": "OR"},
        },
    )
    filter_id = create_response.json()["id"]

    response = await client.get(f"/filters/{filter_id}")
    assert response.status_code == 200

    data = response.json()
    assert data["id"] == filter_id
    assert data["name"] == "Target"


async def test_get_filter_not_found(client: AsyncClient) -> None:
    """Test getting a non-existent filter returns 404."""
    response = await client.get("/filters/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404


async def test_update_filter_name(client: AsyncClient) -> None:
    """Test updating a filter name."""
    # Create a filter
    create_response = await client.post(
        "/filters/",
        json={
            "name": "Original",
            "filter_expression": {"groups": [{"tags": ["tag"]}], "group_operator": "OR"},
        },
    )
    filter_id = create_response.json()["id"]

    response = await client.patch(
        f"/filters/{filter_id}",
        json={"name": "Updated"},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["name"] == "Updated"


async def test_update_filter_filter_expression(client: AsyncClient) -> None:
    """Test updating a filter's filter expression."""
    # Create a filter
    create_response = await client.post(
        "/filters/",
        json={
            "name": "Test",
            "filter_expression": {"groups": [{"tags": ["old"]}], "group_operator": "OR"},
        },
    )
    filter_id = create_response.json()["id"]

    response = await client.patch(
        f"/filters/{filter_id}",
        json={
            "filter_expression": {
                "groups": [{"tags": ["new1"]}, {"tags": ["new2"]}],
                "group_operator": "OR",
            },
        },
    )
    assert response.status_code == 200

    data = response.json()
    assert len(data["filter_expression"]["groups"]) == 2


async def test_update_filter_not_found(client: AsyncClient) -> None:
    """Test updating a non-existent filter returns 404."""
    response = await client.patch(
        "/filters/00000000-0000-0000-0000-000000000000",
        json={"name": "New Name"},
    )
    assert response.status_code == 404


async def test_delete_filter(client: AsyncClient) -> None:
    """Test deleting a filter."""
    # Create a filter
    create_response = await client.post(
        "/filters/",
        json={
            "name": "To Delete",
            "filter_expression": {"groups": [{"tags": ["delete"]}], "group_operator": "OR"},
        },
    )
    filter_id = create_response.json()["id"]

    response = await client.delete(f"/filters/{filter_id}")
    assert response.status_code == 204

    # Verify deleted
    get_response = await client.get(f"/filters/{filter_id}")
    assert get_response.status_code == 404


async def test_delete_filter_not_found(client: AsyncClient) -> None:
    """Test deleting a non-existent filter returns 404."""
    response = await client.delete("/filters/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404


async def test_create_filter_complex_filter(client: AsyncClient) -> None:
    """Test creating a filter with a complex filter expression."""
    response = await client.post(
        "/filters/",
        json={
            "name": "Complex",
            "filter_expression": {
                "groups": [
                    {"tags": ["work", "high-priority"]},
                    {"tags": ["urgent"]},
                    {"tags": ["critical", "deadline"]},
                ],
                "group_operator": "OR",
            },
        },
    )
    assert response.status_code == 201

    data = response.json()
    assert len(data["filter_expression"]["groups"]) == 3


# =============================================================================
# Default Sort Field API Tests
# =============================================================================


async def test_create_filter_with_sort_defaults(client: AsyncClient) -> None:
    """Test creating a filter with default sort configuration."""
    response = await client.post(
        "/filters/",
        json={
            "name": "Sorted Filter",
            "filter_expression": {
                "groups": [{"tags": ["work"]}],
                "group_operator": "OR",
            },
            "default_sort_by": "created_at",
            "default_sort_ascending": True,
        },
    )
    assert response.status_code == 201

    data = response.json()
    assert data["name"] == "Sorted Filter"
    assert data["default_sort_by"] == "created_at"
    assert data["default_sort_ascending"] is True


async def test_create_filter_without_sort_defaults(client: AsyncClient) -> None:
    """Test creating a filter without sort configuration returns null values."""
    response = await client.post(
        "/filters/",
        json={
            "name": "No Sort Config",
            "filter_expression": {
                "groups": [{"tags": ["work"]}],
                "group_operator": "OR",
            },
        },
    )
    assert response.status_code == 201

    data = response.json()
    assert data["default_sort_by"] is None
    assert data["default_sort_ascending"] is None


async def test_create_filter_with_invalid_sort_by(client: AsyncClient) -> None:
    """Test that creating a filter with invalid sort_by fails validation."""
    response = await client.post(
        "/filters/",
        json={
            "name": "Invalid Sort",
            "filter_expression": {
                "groups": [{"tags": ["work"]}],
                "group_operator": "OR",
            },
            "default_sort_by": "invalid_field",
        },
    )
    assert response.status_code == 422


async def test_create_filter_rejects_archived_at_sort(client: AsyncClient) -> None:
    """Test that archived_at is not valid for filter defaults."""
    response = await client.post(
        "/filters/",
        json={
            "name": "Archived Sort",
            "filter_expression": {
                "groups": [{"tags": ["work"]}],
                "group_operator": "OR",
            },
            "default_sort_by": "archived_at",
        },
    )
    assert response.status_code == 422


async def test_create_filter_rejects_deleted_at_sort(client: AsyncClient) -> None:
    """Test that deleted_at is not valid for filter defaults."""
    response = await client.post(
        "/filters/",
        json={
            "name": "Deleted Sort",
            "filter_expression": {
                "groups": [{"tags": ["work"]}],
                "group_operator": "OR",
            },
            "default_sort_by": "deleted_at",
        },
    )
    assert response.status_code == 422


async def test_update_filter_sort_fields(client: AsyncClient) -> None:
    """Test updating a filter's sort configuration."""
    # Create a filter without sort config
    create_response = await client.post(
        "/filters/",
        json={
            "name": "Update Sort",
            "filter_expression": {
                "groups": [{"tags": ["tag"]}],
                "group_operator": "OR",
            },
        },
    )
    filter_id = create_response.json()["id"]

    # Update with sort config
    response = await client.patch(
        f"/filters/{filter_id}",
        json={
            "default_sort_by": "title",
            "default_sort_ascending": True,
        },
    )
    assert response.status_code == 200

    data = response.json()
    assert data["default_sort_by"] == "title"
    assert data["default_sort_ascending"] is True


async def test_update_filter_invalid_sort_by(client: AsyncClient) -> None:
    """Test that updating with invalid sort_by fails validation."""
    # Create a filter
    create_response = await client.post(
        "/filters/",
        json={
            "name": "Test",
            "filter_expression": {
                "groups": [{"tags": ["tag"]}],
                "group_operator": "OR",
            },
        },
    )
    filter_id = create_response.json()["id"]

    # Update with invalid sort
    response = await client.patch(
        f"/filters/{filter_id}",
        json={"default_sort_by": "not_a_field"},
    )
    assert response.status_code == 422


async def test_get_filter_includes_sort_fields(client: AsyncClient) -> None:
    """Test that get filter response includes sort fields."""
    # Create a filter with sort config
    create_response = await client.post(
        "/filters/",
        json={
            "name": "Get With Sort",
            "filter_expression": {
                "groups": [{"tags": ["tag"]}],
                "group_operator": "OR",
            },
            "default_sort_by": "last_used_at",
            "default_sort_ascending": False,
        },
    )
    filter_id = create_response.json()["id"]

    # Get the filter
    response = await client.get(f"/filters/{filter_id}")
    assert response.status_code == 200

    data = response.json()
    assert data["default_sort_by"] == "last_used_at"
    assert data["default_sort_ascending"] is False


async def test_get_filters_includes_sort_fields(client: AsyncClient) -> None:
    """Test that get filters response includes sort fields for all filters."""
    # Create filter with sort config
    await client.post(
        "/filters/",
        json={
            "name": "With Sort",
            "filter_expression": {
                "groups": [{"tags": ["tag1"]}],
                "group_operator": "OR",
            },
            "default_sort_by": "title",
            "default_sort_ascending": True,
        },
    )
    # Create filter without sort config
    await client.post(
        "/filters/",
        json={
            "name": "Without Sort",
            "filter_expression": {
                "groups": [{"tags": ["tag2"]}],
                "group_operator": "OR",
            },
        },
    )

    response = await client.get("/filters/")
    assert response.status_code == 200

    data = response.json()
    by_name = {item["name"]: item for item in data}
    assert by_name["With Sort"]["default_sort_by"] == "title"
    assert by_name["With Sort"]["default_sort_ascending"] is True
    assert by_name["Without Sort"]["default_sort_by"] is None
    assert by_name["Without Sort"]["default_sort_ascending"] is None


async def test_create_filter_all_valid_sort_options(client: AsyncClient) -> None:
    """Test creating filters with all valid sort options."""
    valid_sort_options = ["created_at", "updated_at", "last_used_at", "title"]

    for i, sort_by in enumerate(valid_sort_options):
        response = await client.post(
            "/filters/",
            json={
                "name": f"Filter {sort_by}",
                "filter_expression": {
                    "groups": [{"tags": [f"tag-sort-{i}"]}],
                    "group_operator": "OR",
                },
                "default_sort_by": sort_by,
            },
        )
        assert response.status_code == 201
        assert response.json()["default_sort_by"] == sort_by


# =============================================================================
# Content Types API Tests
# =============================================================================


async def test_create_filter_with_prompt_content_type(client: AsyncClient) -> None:
    """Test creating a filter for prompts only."""
    response = await client.post(
        "/filters/",
        json={
            "name": "My Prompts",
            "content_types": ["prompt"],
            "filter_expression": {"groups": [], "group_operator": "OR"},
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["content_types"] == ["prompt"]


async def test_create_filter_with_all_content_types(client: AsyncClient) -> None:
    """Test creating a filter with all three content types."""
    response = await client.post(
        "/filters/",
        json={
            "name": "Everything",
            "content_types": ["bookmark", "note", "prompt"],
            "filter_expression": {"groups": [], "group_operator": "OR"},
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert set(data["content_types"]) == {"bookmark", "note", "prompt"}


async def test_create_filter_with_bookmark_and_prompt(client: AsyncClient) -> None:
    """Test creating a filter with bookmark and prompt content types."""
    response = await client.post(
        "/filters/",
        json={
            "name": "Bookmarks and Prompts",
            "content_types": ["bookmark", "prompt"],
            "filter_expression": {"groups": [], "group_operator": "OR"},
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert set(data["content_types"]) == {"bookmark", "prompt"}


async def test_create_filter_with_note_and_prompt(client: AsyncClient) -> None:
    """Test creating a filter with note and prompt content types."""
    response = await client.post(
        "/filters/",
        json={
            "name": "Notes and Prompts",
            "content_types": ["note", "prompt"],
            "filter_expression": {"groups": [], "group_operator": "OR"},
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert set(data["content_types"]) == {"note", "prompt"}


async def test_update_filter_add_prompt_content_type(client: AsyncClient) -> None:
    """Test adding prompt to existing filter's content types."""
    # Create filter without prompt
    create_response = await client.post(
        "/filters/",
        json={
            "name": "Test",
            "content_types": ["bookmark"],
            "filter_expression": {"groups": [], "group_operator": "OR"},
        },
    )
    filter_id = create_response.json()["id"]

    # Update to include prompt
    response = await client.patch(
        f"/filters/{filter_id}",
        json={"content_types": ["bookmark", "prompt"]},
    )
    assert response.status_code == 200
    assert set(response.json()["content_types"]) == {"bookmark", "prompt"}


async def test_update_filter_change_to_prompt_only(client: AsyncClient) -> None:
    """Test changing a filter to prompt-only content type."""
    # Create filter with bookmark
    create_response = await client.post(
        "/filters/",
        json={
            "name": "Test",
            "content_types": ["bookmark", "note"],
            "filter_expression": {"groups": [], "group_operator": "OR"},
        },
    )
    filter_id = create_response.json()["id"]

    # Update to prompt only
    response = await client.patch(
        f"/filters/{filter_id}",
        json={"content_types": ["prompt"]},
    )
    assert response.status_code == 200
    assert response.json()["content_types"] == ["prompt"]


async def test_get_filter_includes_prompt_content_type(client: AsyncClient) -> None:
    """Test that get filter response includes prompt content type."""
    # Create a filter with prompt
    create_response = await client.post(
        "/filters/",
        json={
            "name": "Prompt Filter",
            "content_types": ["prompt"],
            "filter_expression": {"groups": [], "group_operator": "OR"},
        },
    )
    filter_id = create_response.json()["id"]

    # Get the filter
    response = await client.get(f"/filters/{filter_id}")
    assert response.status_code == 200
    assert response.json()["content_types"] == ["prompt"]


async def test_get_filters_includes_prompt_content_types(client: AsyncClient) -> None:
    """Test that get filters response includes prompt content types."""
    # Create filter with prompt
    await client.post(
        "/filters/",
        json={
            "name": "With Prompt",
            "content_types": ["bookmark", "prompt"],
            "filter_expression": {"groups": [], "group_operator": "OR"},
        },
    )

    response = await client.get("/filters/")
    assert response.status_code == 200

    data = response.json()
    by_name = {item["name"]: item for item in data}
    assert set(by_name["With Prompt"]["content_types"]) == {"bookmark", "prompt"}


# =============================================================================
# Milestone 3: Read Path - Filter Expression Reconstruction Tests
# =============================================================================


async def test__get_filter__returns_filter_expression_format(client: AsyncClient) -> None:
    """Test that get filter returns correctly reconstructed filter_expression structure."""
    create_response = await client.post(
        "/filters/",
        json={
            "name": "Read Test",
            "filter_expression": {
                "groups": [{"tags": ["work", "priority"]}],
                "group_operator": "OR",
            },
        },
    )
    assert create_response.status_code == 201
    filter_id = create_response.json()["id"]

    response = await client.get(f"/filters/{filter_id}")
    assert response.status_code == 200

    data = response.json()
    assert "filter_expression" in data
    assert "groups" in data["filter_expression"]
    assert "group_operator" in data["filter_expression"]
    assert data["filter_expression"]["group_operator"] == "OR"
    assert len(data["filter_expression"]["groups"]) == 1
    assert data["filter_expression"]["groups"][0]["operator"] == "AND"
    # Tags should be sorted alphabetically
    assert data["filter_expression"]["groups"][0]["tags"] == ["priority", "work"]


async def test__get_filters__returns_filter_expression_for_all(client: AsyncClient) -> None:
    """Test that get filters returns filter_expression for all filters."""
    await client.post(
        "/filters/",
        json={
            "name": "Filter 1",
            "filter_expression": {
                "groups": [{"tags": ["tag1"]}],
                "group_operator": "OR",
            },
        },
    )
    await client.post(
        "/filters/",
        json={
            "name": "Filter 2",
            "filter_expression": {
                "groups": [{"tags": ["tag2", "tag3"]}],
                "group_operator": "OR",
            },
        },
    )

    response = await client.get("/filters/")
    assert response.status_code == 200

    data = response.json()
    by_name = {item["name"]: item for item in data}

    assert "filter_expression" in by_name["Filter 1"]
    assert by_name["Filter 1"]["filter_expression"]["groups"][0]["tags"] == ["tag1"]

    assert "filter_expression" in by_name["Filter 2"]
    # Tags sorted alphabetically
    assert by_name["Filter 2"]["filter_expression"]["groups"][0]["tags"] == ["tag2", "tag3"]


async def test__create_and_get_filter__roundtrip(client: AsyncClient) -> None:
    """Test that creating and getting a filter returns matching expression."""
    original_expression = {
        "groups": [
            {"tags": ["work", "high-priority"]},
            {"tags": ["urgent"]},
        ],
        "group_operator": "OR",
    }

    create_response = await client.post(
        "/filters/",
        json={
            "name": "Roundtrip Test",
            "filter_expression": original_expression,
        },
    )
    assert create_response.status_code == 201
    filter_id = create_response.json()["id"]

    get_response = await client.get(f"/filters/{filter_id}")
    assert get_response.status_code == 200

    data = get_response.json()
    # Check structure matches (tags sorted alphabetically in each group)
    assert data["filter_expression"]["group_operator"] == "OR"
    assert len(data["filter_expression"]["groups"]) == 2
    assert data["filter_expression"]["groups"][0]["tags"] == ["high-priority", "work"]
    assert data["filter_expression"]["groups"][1]["tags"] == ["urgent"]


async def test__get_filter__orders_groups_by_position(client: AsyncClient) -> None:
    """Test that groups are returned in position order."""
    create_response = await client.post(
        "/filters/",
        json={
            "name": "Position Test",
            "filter_expression": {
                "groups": [
                    {"tags": ["first"]},
                    {"tags": ["second"]},
                    {"tags": ["third"]},
                ],
                "group_operator": "OR",
            },
        },
    )
    assert create_response.status_code == 201
    filter_id = create_response.json()["id"]

    response = await client.get(f"/filters/{filter_id}")
    assert response.status_code == 200

    groups = response.json()["filter_expression"]["groups"]
    assert len(groups) == 3
    assert groups[0]["tags"] == ["first"]
    assert groups[1]["tags"] == ["second"]
    assert groups[2]["tags"] == ["third"]


async def test__get_filter__orders_tags_alphabetically(client: AsyncClient) -> None:
    """Test that tags within groups are sorted alphabetically."""
    create_response = await client.post(
        "/filters/",
        json={
            "name": "Tag Order Test",
            "filter_expression": {
                "groups": [{"tags": ["zebra", "apple", "mango", "banana"]}],
                "group_operator": "OR",
            },
        },
    )
    assert create_response.status_code == 201
    filter_id = create_response.json()["id"]

    response = await client.get(f"/filters/{filter_id}")
    assert response.status_code == 200

    tags = response.json()["filter_expression"]["groups"][0]["tags"]
    assert tags == ["apple", "banana", "mango", "zebra"]


async def test__get_filter__empty_expression(client: AsyncClient) -> None:
    """Test that filters with no groups return empty expression correctly."""
    create_response = await client.post(
        "/filters/",
        json={
            "name": "Empty Expression",
            "filter_expression": {
                "groups": [],
                "group_operator": "OR",
            },
        },
    )
    assert create_response.status_code == 201
    filter_id = create_response.json()["id"]

    response = await client.get(f"/filters/{filter_id}")
    assert response.status_code == 200

    data = response.json()
    assert data["filter_expression"]["groups"] == []
    assert data["filter_expression"]["group_operator"] == "OR"


async def test__update_filter__returns_updated_expression(client: AsyncClient) -> None:
    """Test that updating a filter returns the updated expression in response."""
    create_response = await client.post(
        "/filters/",
        json={
            "name": "Update Response Test",
            "filter_expression": {
                "groups": [{"tags": ["old-tag"]}],
                "group_operator": "OR",
            },
        },
    )
    assert create_response.status_code == 201
    filter_id = create_response.json()["id"]

    update_response = await client.patch(
        f"/filters/{filter_id}",
        json={
            "filter_expression": {
                "groups": [{"tags": ["new-tag-1", "new-tag-2"]}],
                "group_operator": "OR",
            },
        },
    )
    assert update_response.status_code == 200

    # Response should contain the updated expression
    data = update_response.json()
    assert len(data["filter_expression"]["groups"]) == 1
    # Tags sorted alphabetically
    assert data["filter_expression"]["groups"][0]["tags"] == ["new-tag-1", "new-tag-2"]
