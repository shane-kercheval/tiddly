"""
Parametrized tests for common entity operations.

These tests run against all entity types (notes, bookmarks, prompts) to verify
consistent behavior for shared functionality like archive, delete, restore, etc.
"""
import asyncio
import uuid
from typing import Any

import pytest
from httpx import AsyncClient

from tests.api.conftest import FAKE_UUID


# =============================================================================
# Helper Functions
# =============================================================================


async def _create_entity(client: AsyncClient, entity_type: str) -> dict[str, Any]:
    """Create an entity of the specified type and return its data."""
    if entity_type == "note":
        response = await client.post(
            "/notes/",
            json={"title": f"Extra Note {uuid.uuid4().hex[:8]}", "content": "Extra content"},
        )
    elif entity_type == "bookmark":
        response = await client.post(
            "/bookmarks/",
            json={"url": f"https://extra-{uuid.uuid4().hex[:8]}.example.com", "title": "Extra Bookmark"},
        )
    elif entity_type == "prompt":
        response = await client.post(
            "/prompts/",
            json={
                "name": f"extra-prompt-{uuid.uuid4().hex[:8]}",
                "content": "Extra content",
            },
        )
    else:
        raise ValueError(f"Unknown entity type: {entity_type}")

    assert response.status_code == 201
    return response.json()


# =============================================================================
# Entity Setup Fixture with Indirect Parametrization
# =============================================================================


@pytest.fixture
async def entity_setup(
    request: pytest.FixtureRequest,
    client: AsyncClient,
) -> dict[str, Any]:
    """
    Create an entity based on the parametrized entity_type.

    Use with @pytest.mark.parametrize("entity_setup", [...], indirect=True)
    """
    entity_type = request.param

    if entity_type == "note":
        response = await client.post(
            "/notes/",
            json={"title": "Test Note", "content": "Test content for note"},
        )
        assert response.status_code == 201
        data = response.json()
        return {
            "entity": data,
            "id": data["id"],
            "base_endpoint": "/notes",  # No trailing slash - avoids // in not-found URLs
            "endpoint": f"/notes/{data['id']}",
            "entity_type": "note",
            "entity_name": "Note",
            "update_data": {"title": "Updated Note Title"},
        }

    if entity_type == "bookmark":
        response = await client.post(
            "/bookmarks/",
            json={"url": "https://test-entity.example.com", "title": "Test Bookmark"},
        )
        assert response.status_code == 201
        data = response.json()
        return {
            "entity": data,
            "id": data["id"],
            "base_endpoint": "/bookmarks",  # No trailing slash - avoids // in not-found URLs
            "endpoint": f"/bookmarks/{data['id']}",
            "entity_type": "bookmark",
            "entity_name": "Bookmark",
            "update_data": {"title": "Updated Bookmark Title"},
        }

    if entity_type == "prompt":
        # Use unique name to avoid conflicts between tests
        unique_name = f"test-prompt-{uuid.uuid4().hex[:8]}"
        response = await client.post(
            "/prompts/",
            json={
                "name": unique_name,
                "content": "Hello {{ name }}",
                "arguments": [{"name": "name", "required": True}],
            },
        )
        assert response.status_code == 201
        data = response.json()
        return {
            "entity": data,
            "id": data["id"],
            "base_endpoint": "/prompts",  # No trailing slash - avoids // in not-found URLs
            "endpoint": f"/prompts/{data['id']}",
            "entity_type": "prompt",
            "entity_name": "Prompt",
            "update_data": {"title": "Updated Prompt Title"},
        }

    raise ValueError(f"Unknown entity type: {entity_type}")


ENTITY_TYPES = ["note", "bookmark", "prompt"]


# =============================================================================
# Archive / Unarchive Tests
# =============================================================================


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__archive__success(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that archive endpoint archives an entity."""
    response = await client.post(f"{entity_setup['endpoint']}/archive")
    assert response.status_code == 200

    data = response.json()
    assert data["archived_at"] is not None

    # Should not appear in active list
    list_response = await client.get(f"{entity_setup['base_endpoint']}/")
    ids = [item["id"] for item in list_response.json()["items"]]
    assert entity_setup["id"] not in ids


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__archive__already_archived_is_idempotent(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that archiving an already-archived entity returns 200."""
    # Archive first time
    await client.post(f"{entity_setup['endpoint']}/archive")

    # Archive again - should succeed
    response = await client.post(f"{entity_setup['endpoint']}/archive")
    assert response.status_code == 200


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__archive__not_found_returns_404(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that archiving a non-existent entity returns 404."""
    response = await client.post(f"{entity_setup['base_endpoint']}/{FAKE_UUID}/archive")
    assert response.status_code == 404
    assert response.json()["detail"] == f"{entity_setup['entity_name']} not found"


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__unarchive__success(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that unarchive endpoint unarchives an entity."""
    # Archive first
    await client.post(f"{entity_setup['endpoint']}/archive")

    # Unarchive
    response = await client.post(f"{entity_setup['endpoint']}/unarchive")
    assert response.status_code == 200

    data = response.json()
    assert data["archived_at"] is None

    # Should appear in active list again
    list_response = await client.get(f"{entity_setup['base_endpoint']}/")
    ids = [item["id"] for item in list_response.json()["items"]]
    assert entity_setup["id"] in ids


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__unarchive__not_archived_returns_400(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that unarchiving a non-archived entity returns 400."""
    response = await client.post(f"{entity_setup['endpoint']}/unarchive")
    assert response.status_code == 400
    assert "not archived" in response.json()["detail"]


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__unarchive__not_found_returns_404(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that unarchiving a non-existent entity returns 404."""
    response = await client.post(f"{entity_setup['base_endpoint']}/{FAKE_UUID}/unarchive")
    assert response.status_code == 404
    assert response.json()["detail"] == f"{entity_setup['entity_name']} not found"


# =============================================================================
# Soft Delete & Restore Tests
# =============================================================================


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__delete__soft_delete_success(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that DELETE soft-deletes an entity by default."""
    response = await client.delete(entity_setup["endpoint"])
    assert response.status_code == 204


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__delete__soft_deleted_not_in_active_list(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that soft-deleted entities don't appear in active list."""
    await client.delete(entity_setup["endpoint"])

    response = await client.get(f"{entity_setup['base_endpoint']}/")
    ids = [item["id"] for item in response.json()["items"]]
    assert entity_setup["id"] not in ids


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__delete__soft_deleted_in_deleted_view(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that soft-deleted entities appear in deleted view."""
    await client.delete(entity_setup["endpoint"])

    response = await client.get(f"{entity_setup['base_endpoint']}/?view=deleted")
    ids = [item["id"] for item in response.json()["items"]]
    assert entity_setup["id"] in ids


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__delete__not_found_returns_404(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that deleting a non-existent entity returns 404."""
    response = await client.delete(f"{entity_setup['base_endpoint']}/{FAKE_UUID}")
    assert response.status_code == 404
    assert response.json()["detail"] == f"{entity_setup['entity_name']} not found"


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__restore__success(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that restore endpoint restores a soft-deleted entity."""
    await client.delete(entity_setup["endpoint"])

    response = await client.post(f"{entity_setup['endpoint']}/restore")
    assert response.status_code == 200
    assert response.json()["deleted_at"] is None


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__restore__not_deleted_returns_400(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that restoring a non-deleted entity returns 400."""
    response = await client.post(f"{entity_setup['endpoint']}/restore")
    assert response.status_code == 400


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__restore__not_found_returns_404(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that restoring a non-existent entity returns 404."""
    response = await client.post(f"{entity_setup['base_endpoint']}/{FAKE_UUID}/restore")
    assert response.status_code == 404
    assert response.json()["detail"] == f"{entity_setup['entity_name']} not found"


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__delete__permanent_removes_from_db(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that permanent delete removes entity completely."""
    # Soft delete first
    await client.delete(entity_setup["endpoint"])

    # Permanent delete
    response = await client.delete(f"{entity_setup['endpoint']}?permanent=true")
    assert response.status_code == 204

    # Verify gone from deleted view too
    response = await client.get(f"{entity_setup['base_endpoint']}/?view=deleted")
    ids = [item["id"] for item in response.json()["items"]]
    assert entity_setup["id"] not in ids


# =============================================================================
# Track Usage Tests
# =============================================================================


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__track_usage__updates_last_used_at(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that track-usage endpoint updates last_used_at timestamp."""
    original_last_used = entity_setup["entity"]["last_used_at"]

    # Small delay to ensure different timestamp
    await asyncio.sleep(0.01)

    response = await client.post(f"{entity_setup['endpoint']}/track-usage")
    assert response.status_code == 204

    # Verify timestamp was updated
    get_response = await client.get(entity_setup["endpoint"])
    assert get_response.json()["last_used_at"] > original_last_used


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__track_usage__not_found_returns_404(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that track-usage returns 404 for non-existent entity."""
    response = await client.post(f"{entity_setup['base_endpoint']}/{FAKE_UUID}/track-usage")
    assert response.status_code == 404
    assert response.json()["detail"] == f"{entity_setup['entity_name']} not found"


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__track_usage__works_on_archived(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that track-usage works on archived entities."""
    # Archive the entity
    archive_response = await client.post(f"{entity_setup['endpoint']}/archive")
    assert archive_response.status_code == 200
    original_last_used = archive_response.json()["last_used_at"]

    # Small delay to ensure different timestamp
    await asyncio.sleep(0.01)

    # Track usage on archived entity
    response = await client.post(f"{entity_setup['endpoint']}/track-usage")
    assert response.status_code == 204

    # Verify via archived view
    list_response = await client.get(f"{entity_setup['base_endpoint']}/?view=archived")
    entity = next(e for e in list_response.json()["items"] if e["id"] == entity_setup["id"])
    assert entity["last_used_at"] > original_last_used


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__track_usage__works_on_deleted(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that track-usage works on soft-deleted entities."""
    original_last_used = entity_setup["entity"]["last_used_at"]

    # Delete the entity
    await client.delete(entity_setup["endpoint"])

    # Small delay to ensure different timestamp
    await asyncio.sleep(0.01)

    # Track usage on deleted entity
    response = await client.post(f"{entity_setup['endpoint']}/track-usage")
    assert response.status_code == 204

    # Verify via deleted view
    list_response = await client.get(f"{entity_setup['base_endpoint']}/?view=deleted")
    entity = next(e for e in list_response.json()["items"] if e["id"] == entity_setup["id"])
    assert entity["last_used_at"] > original_last_used


# =============================================================================
# List View Tests
# =============================================================================


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__list__active_view_excludes_archived(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that active view (default) excludes archived entities."""
    await client.post(f"{entity_setup['endpoint']}/archive")

    response = await client.get(f"{entity_setup['base_endpoint']}/")  # default view=active
    ids = [item["id"] for item in response.json()["items"]]
    assert entity_setup["id"] not in ids


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__list__archived_view_shows_only_archived(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that archived view shows only archived entities."""
    # Create a second entity that stays active
    second_entity = await _create_entity(client, entity_setup["entity_type"])

    # Archive the first entity
    await client.post(f"{entity_setup['endpoint']}/archive")

    response = await client.get(f"{entity_setup['base_endpoint']}/?view=archived")
    ids = [item["id"] for item in response.json()["items"]]
    # Archived entity should be included
    assert entity_setup["id"] in ids
    # Active entity should be excluded
    assert second_entity["id"] not in ids


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__list__deleted_view_shows_only_deleted(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that deleted view shows only soft-deleted entities."""
    # Create a second entity that stays active
    second_entity = await _create_entity(client, entity_setup["entity_type"])

    # Delete the first entity
    await client.delete(entity_setup["endpoint"])

    response = await client.get(f"{entity_setup['base_endpoint']}/?view=deleted")
    ids = [item["id"] for item in response.json()["items"]]
    # Deleted entity should be included
    assert entity_setup["id"] in ids
    # Active entity should be excluded
    assert second_entity["id"] not in ids


# =============================================================================
# Get Operations Tests
# =============================================================================


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__get__not_found_returns_404(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that getting a non-existent entity returns 404."""
    response = await client.get(f"{entity_setup['base_endpoint']}/{FAKE_UUID}")
    assert response.status_code == 404
    assert response.json()["detail"] == f"{entity_setup['entity_name']} not found"


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__get__can_access_archived(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Test that archived entities can be accessed by ID."""
    await client.post(f"{entity_setup['endpoint']}/archive")

    response = await client.get(entity_setup["endpoint"])
    assert response.status_code == 200
    assert response.json()["id"] == entity_setup["id"]


