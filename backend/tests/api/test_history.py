"""Tests for history API endpoints."""
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


# --- Test data for parametrized tests ---

ENTITY_TEST_DATA = [
    pytest.param(
        "bookmark",
        "/bookmarks/",
        {"url": "https://example.com", "content": "Initial content", "title": "Test Title"},
        {"content": "Updated content"},
        id="bookmark",
    ),
    pytest.param(
        "note",
        "/notes/",
        {"title": "Test Note", "content": "Initial content"},
        {"content": "Updated content"},
        id="note",
    ),
    pytest.param(
        "prompt",
        "/prompts/",
        {"name": "test-prompt", "content": "Initial content", "arguments": []},
        {"content": "Updated content"},
        id="prompt",
    ),
]

# Test data without update_payload for tests that don't need it
ENTITY_CREATE_DATA = [
    pytest.param(
        "bookmark",
        "/bookmarks/",
        {"url": "https://example.com", "content": "Initial content", "title": "Test Title"},
        id="bookmark",
    ),
    pytest.param(
        "note",
        "/notes/",
        {"title": "Test Note", "content": "Initial content"},
        id="note",
    ),
    pytest.param(
        "prompt",
        "/prompts/",
        {"name": "test-prompt", "content": "Initial content", "arguments": []},
        id="prompt",
    ),
]


# --- /history/ endpoint tests ---


async def test_get_user_history_empty(client: AsyncClient) -> None:
    """Test getting user history when no history exists."""
    response = await client.get("/history/")
    assert response.status_code == 200

    data = response.json()
    assert data["items"] == []
    assert data["total"] == 0
    assert data["offset"] == 0
    assert data["limit"] == 50
    assert data["has_more"] is False


async def test_get_user_history_with_all_entity_types(client: AsyncClient) -> None:
    """Test getting user history includes all entity types."""
    # Create one of each entity type
    await client.post("/bookmarks/", json={"url": "https://example.com"})
    await client.post("/notes/", json={"title": "Test", "content": "Content"})
    await client.post(
        "/prompts/",
        json={"name": "test-prompt", "content": "Hello", "arguments": []},
    )

    # Get all history
    response = await client.get("/history/")
    assert response.status_code == 200

    data = response.json()
    assert data["total"] == 3

    # Verify all entity types are present
    entity_types = {item["entity_type"] for item in data["items"]}
    assert entity_types == {"bookmark", "note", "prompt"}


@pytest.mark.parametrize("entity_type", ["bookmark", "note", "prompt"])
async def test_get_user_history_filter_by_entity_type(
    client: AsyncClient,
    entity_type: str,
) -> None:
    """Test filtering user history by entity type."""
    # Create one of each entity type
    await client.post("/bookmarks/", json={"url": "https://example.com"})
    await client.post("/notes/", json={"title": "Test", "content": "Content"})
    await client.post(
        "/prompts/",
        json={"name": "test-prompt", "content": "Hello", "arguments": []},
    )

    # Filter by specific entity type
    response = await client.get("/history/", params={"entity_type": entity_type})
    assert response.status_code == 200

    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["entity_type"] == entity_type


async def test_get_user_history_pagination(client: AsyncClient) -> None:
    """Test pagination of user history."""
    # Create multiple entities to generate history
    for i in range(5):
        await client.post("/bookmarks/", json={"url": f"https://example{i}.com"})

    # Get first page
    response = await client.get("/history/", params={"limit": 2, "offset": 0})
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 5
    assert len(data["items"]) == 2
    assert data["has_more"] is True

    # Get second page
    response = await client.get("/history/", params={"limit": 2, "offset": 2})
    data = response.json()
    assert len(data["items"]) == 2
    assert data["has_more"] is True

    # Get last page
    response = await client.get("/history/", params={"limit": 2, "offset": 4})
    data = response.json()
    assert len(data["items"]) == 1
    assert data["has_more"] is False


async def test_get_user_history_offset_beyond_total(client: AsyncClient) -> None:
    """Test user history with offset beyond total count."""
    await client.post("/bookmarks/", json={"url": "https://example.com"})

    response = await client.get("/history/", params={"offset": 100})
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 1
    assert len(data["items"]) == 0
    assert data["has_more"] is False


# --- /history/{entity_type}/{entity_id} endpoint tests (parametrized) ---


@pytest.mark.parametrize(
    ("entity_type", "create_endpoint", "create_payload", "update_payload"),
    ENTITY_TEST_DATA,
)
async def test_get_entity_history(
    client: AsyncClient,
    entity_type: str,
    create_endpoint: str,
    create_payload: dict,
    update_payload: dict,
) -> None:
    """Test getting history for a specific entity."""
    # Create entity
    response = await client.post(create_endpoint, json=create_payload)
    assert response.status_code == 201, f"Failed to create {entity_type}: {response.json()}"
    entity_id = response.json()["id"]

    # Update to create more history
    await client.patch(f"{create_endpoint}{entity_id}", json=update_payload)

    # Get entity history
    response = await client.get(f"/history/{entity_type}/{entity_id}")
    assert response.status_code == 200

    data = response.json()
    assert data["total"] == 2
    assert len(data["items"]) == 2

    # Items should be sorted by version descending (most recent first)
    assert data["items"][0]["version"] == 2
    assert data["items"][0]["entity_type"] == entity_type
    assert data["items"][1]["version"] == 1


@pytest.mark.parametrize("entity_type", ["bookmark", "note", "prompt"])
async def test_get_entity_history_empty_for_nonexistent(
    client: AsyncClient,
    entity_type: str,
) -> None:
    """Test getting history for non-existent entity returns empty list."""
    fake_uuid = "00000000-0000-0000-0000-000000000000"

    response = await client.get(f"/history/{entity_type}/{fake_uuid}")
    assert response.status_code == 200

    data = response.json()
    assert data["items"] == []
    assert data["total"] == 0


@pytest.mark.parametrize(
    ("entity_type", "create_endpoint", "create_payload"),
    ENTITY_CREATE_DATA,
)
async def test_get_entity_history_soft_deleted(
    client: AsyncClient,
    entity_type: str,
    create_endpoint: str,
    create_payload: dict,
) -> None:
    """Test getting history for soft-deleted entity returns history."""
    # Create entity
    response = await client.post(create_endpoint, json=create_payload)
    entity_id = response.json()["id"]

    # Soft delete
    await client.delete(f"{create_endpoint}{entity_id}")

    # Get entity history - should still return history
    response = await client.get(f"/history/{entity_type}/{entity_id}")
    assert response.status_code == 200

    data = response.json()
    assert data["total"] == 2  # CREATE + DELETE
    assert data["items"][0]["action"] == "delete"
    assert data["items"][1]["action"] == "create"


@pytest.mark.parametrize(
    ("entity_type", "create_endpoint", "create_payload"),
    ENTITY_CREATE_DATA,
)
async def test_get_entity_history_hard_deleted(
    client: AsyncClient,
    entity_type: str,
    create_endpoint: str,
    create_payload: dict,
) -> None:
    """Test getting history for hard-deleted entity returns empty list."""
    # Create entity
    response = await client.post(create_endpoint, json=create_payload)
    entity_id = response.json()["id"]

    # Soft delete first
    await client.delete(f"{create_endpoint}{entity_id}")

    # Hard delete
    await client.delete(f"{create_endpoint}{entity_id}", params={"permanent": True})

    # Get entity history - should return empty (history cascade-deleted)
    response = await client.get(f"/history/{entity_type}/{entity_id}")
    assert response.status_code == 200

    data = response.json()
    assert data["items"] == []
    assert data["total"] == 0


@pytest.mark.parametrize(
    ("entity_type", "create_endpoint", "create_payload"),
    ENTITY_CREATE_DATA,
)
async def test_get_entity_history_pagination(
    client: AsyncClient,
    entity_type: str,
    create_endpoint: str,
    create_payload: dict,
) -> None:
    """Test pagination of entity history."""
    # Create entity and update multiple times
    response = await client.post(create_endpoint, json=create_payload)
    entity_id = response.json()["id"]

    for i in range(4):
        await client.patch(
            f"{create_endpoint}{entity_id}",
            json={"content": f"Version {i + 2}"},
        )

    # Get first page
    response = await client.get(
        f"/history/{entity_type}/{entity_id}",
        params={"limit": 2, "offset": 0},
    )
    data = response.json()
    assert data["total"] == 5
    assert len(data["items"]) == 2
    assert data["has_more"] is True


# --- /history/{entity_type}/{entity_id}/version/{version} endpoint tests (parametrized) ---


@pytest.mark.parametrize(
    ("entity_type", "create_endpoint", "create_payload", "update_payload"),
    ENTITY_TEST_DATA,
)
async def test_get_content_at_version(
    client: AsyncClient,
    entity_type: str,
    create_endpoint: str,
    create_payload: dict,
    update_payload: dict,
) -> None:
    """Test getting content at a specific version."""
    # Create entity
    response = await client.post(create_endpoint, json=create_payload)
    entity_id = response.json()["id"]

    # Update the entity
    await client.patch(f"{create_endpoint}{entity_id}", json=update_payload)

    # Get content at version 1 (original)
    response = await client.get(f"/history/{entity_type}/{entity_id}/version/1")
    assert response.status_code == 200

    data = response.json()
    assert data["entity_id"] == entity_id
    assert data["version"] == 1
    assert data["content"] == "Initial content"
    assert data["metadata"] is not None
    assert data["warnings"] is None


@pytest.mark.parametrize(
    ("entity_type", "create_endpoint", "create_payload"),
    ENTITY_CREATE_DATA,
)
async def test_get_content_at_version_latest(
    client: AsyncClient,
    entity_type: str,
    create_endpoint: str,
    create_payload: dict,
) -> None:
    """Test getting content at the latest version."""
    # Create entity
    response = await client.post(create_endpoint, json=create_payload)
    entity_id = response.json()["id"]

    # Get content at version 1 (latest and only version)
    response = await client.get(f"/history/{entity_type}/{entity_id}/version/1")
    assert response.status_code == 200

    data = response.json()
    assert data["content"] == "Initial content"


@pytest.mark.parametrize(
    ("entity_type", "create_endpoint", "create_payload"),
    ENTITY_CREATE_DATA,
)
async def test_get_content_at_version_not_found(
    client: AsyncClient,
    entity_type: str,
    create_endpoint: str,
    create_payload: dict,
) -> None:
    """Test getting content at non-existent version returns 404."""
    # Create entity
    response = await client.post(create_endpoint, json=create_payload)
    entity_id = response.json()["id"]

    # Try to get version 999
    response = await client.get(f"/history/{entity_type}/{entity_id}/version/999")
    assert response.status_code == 404
    assert response.json()["detail"] == "Version not found"


@pytest.mark.parametrize(
    ("entity_type", "create_endpoint", "create_payload"),
    ENTITY_CREATE_DATA,
)
async def test_get_content_at_version_hard_deleted(
    client: AsyncClient,
    entity_type: str,
    create_endpoint: str,
    create_payload: dict,
) -> None:
    """Test getting content at version for hard-deleted entity returns 404."""
    # Create entity
    response = await client.post(create_endpoint, json=create_payload)
    entity_id = response.json()["id"]

    # Soft delete
    await client.delete(f"{create_endpoint}{entity_id}")

    # Hard delete
    await client.delete(f"{create_endpoint}{entity_id}", params={"permanent": True})

    # Try to get version
    response = await client.get(f"/history/{entity_type}/{entity_id}/version/1")
    assert response.status_code == 404


@pytest.mark.parametrize(
    ("entity_type", "create_endpoint", "create_payload"),
    ENTITY_CREATE_DATA,
)
async def test_get_content_at_delete_version(
    client: AsyncClient,
    entity_type: str,
    create_endpoint: str,
    create_payload: dict,
) -> None:
    """Test getting content at DELETE version returns pre-delete content."""
    # Create entity
    response = await client.post(create_endpoint, json=create_payload)
    entity_id = response.json()["id"]

    # Soft delete
    await client.delete(f"{create_endpoint}{entity_id}")

    # Get content at DELETE version (v2)
    response = await client.get(f"/history/{entity_type}/{entity_id}/version/2")
    assert response.status_code == 200

    data = response.json()
    assert data["content"] == "Initial content"  # Pre-delete content preserved


# --- Per-entity /history convenience endpoint tests ---


async def test_bookmark_history_endpoint(client: AsyncClient) -> None:
    """Test /bookmarks/{id}/history convenience endpoint."""
    response = await client.post(
        "/bookmarks/",
        json={"url": "https://example.com", "title": "Test"},
    )
    bookmark_id = response.json()["id"]

    response = await client.get(f"/bookmarks/{bookmark_id}/history")
    assert response.status_code == 200

    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["entity_type"] == "bookmark"
    assert data["items"][0]["metadata_snapshot"]["url"] == "https://example.com/"


async def test_note_history_endpoint(client: AsyncClient) -> None:
    """Test /notes/{id}/history convenience endpoint."""
    response = await client.post(
        "/notes/",
        json={"title": "Test Note", "content": "Content"},
    )
    note_id = response.json()["id"]

    response = await client.get(f"/notes/{note_id}/history")
    assert response.status_code == 200

    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["entity_type"] == "note"
    assert data["items"][0]["metadata_snapshot"]["title"] == "Test Note"


async def test_prompt_history_endpoint(client: AsyncClient) -> None:
    """Test /prompts/{id}/history convenience endpoint."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "my-prompt",
            "content": "Hello {{ name }}",
            "arguments": [{"name": "name", "description": "The name"}],
        },
    )
    assert response.status_code == 201, f"Failed to create prompt: {response.json()}"
    prompt_id = response.json()["id"]

    response = await client.get(f"/prompts/{prompt_id}/history")
    assert response.status_code == 200

    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["entity_type"] == "prompt"
    assert data["items"][0]["metadata_snapshot"]["name"] == "my-prompt"
    assert data["items"][0]["metadata_snapshot"]["arguments"] == [
        {"name": "name", "description": "The name", "required": None},
    ]


# --- Response schema validation tests ---


async def test_history_response_includes_all_fields(client: AsyncClient) -> None:
    """Test that history response includes all expected fields."""
    response = await client.post(
        "/bookmarks/",
        json={
            "url": "https://example.com",
            "title": "Test",
            "description": "Desc",
            "tags": ["tag1"],
        },
    )
    bookmark_id = response.json()["id"]

    response = await client.get(f"/history/bookmark/{bookmark_id}")
    assert response.status_code == 200

    item = response.json()["items"][0]

    # Verify all expected fields are present
    assert "id" in item
    assert "entity_type" in item
    assert "entity_id" in item
    assert "action" in item
    assert "version" in item
    assert "diff_type" in item
    assert "metadata_snapshot" in item
    assert "source" in item
    assert "auth_type" in item
    assert "token_prefix" in item
    assert "created_at" in item

    # Verify UUID formats
    UUID(item["id"])
    UUID(item["entity_id"])


async def test_content_at_version_response_includes_all_fields(client: AsyncClient) -> None:
    """Test that content at version response includes all expected fields."""
    response = await client.post(
        "/bookmarks/",
        json={"url": "https://example.com", "content": "Content", "title": "Test"},
    )
    bookmark_id = response.json()["id"]

    response = await client.get(f"/history/bookmark/{bookmark_id}/version/1")
    assert response.status_code == 200

    data = response.json()

    # Verify all expected fields
    assert "entity_id" in data
    assert "version" in data
    assert "content" in data
    assert "metadata" in data
    assert "warnings" in data

    # Verify values
    assert data["entity_id"] == bookmark_id
    assert data["version"] == 1
    assert data["content"] == "Content"
    assert data["metadata"]["title"] == "Test"
    assert data["warnings"] is None


# --- Invalid entity type tests ---


async def test_get_entity_history_invalid_entity_type(client: AsyncClient) -> None:
    """Test getting history with invalid entity type returns 422."""
    fake_uuid = "00000000-0000-0000-0000-000000000000"

    response = await client.get(f"/history/invalid/{fake_uuid}")
    assert response.status_code == 422  # Validation error


async def test_get_content_at_version_invalid_entity_type(client: AsyncClient) -> None:
    """Test getting content at version with invalid entity type returns 422."""
    fake_uuid = "00000000-0000-0000-0000-000000000000"

    response = await client.get(f"/history/invalid/{fake_uuid}/version/1")
    assert response.status_code == 422  # Validation error


# --- Authorization tests ---


async def test_get_user_history_requires_auth(
    db_session: AsyncSession,
    redis_client,  # noqa: ARG001
) -> None:
    """Test that user history requires authentication (works in dev mode)."""
    from httpx import ASGITransport, AsyncClient as HttpxAsyncClient

    from api.main import app
    from core.config import get_settings
    from db.session import get_async_session

    get_settings.cache_clear()

    async def override_get_async_session():
        yield db_session

    app.dependency_overrides[get_async_session] = override_get_async_session

    async with HttpxAsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as test_client:
        # In dev mode, should work (dev user is auto-created)
        response = await test_client.get("/history/")
        assert response.status_code == 200

    app.dependency_overrides.clear()
