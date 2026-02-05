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


async def test_user_cannot_access_another_users_history(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Test that a user cannot access another user's history (returns empty list)."""
    from collections.abc import AsyncGenerator

    from httpx import ASGITransport, AsyncClient as HttpxAsyncClient

    from api.main import app
    from core.config import Settings, get_settings
    from db.session import get_async_session
    from models.user import User
    from schemas.token import TokenCreate
    from services.token_service import create_token
    from tests.api.conftest import add_consent_for_user

    # Create a bookmark as the dev user (user1) - this creates history
    response = await client.post(
        "/bookmarks/",
        json={"url": "https://user1-history-test.com", "title": "User 1 Bookmark"},
    )
    assert response.status_code == 201
    user1_bookmark_id = response.json()["id"]

    # Verify user1 has history
    response = await client.get("/history/")
    assert response.status_code == 200
    user1_history = response.json()
    assert user1_history["total"] > 0

    # Create a second user and a PAT for them
    user2 = User(auth0_id="auth0|user2-history-test", email="user2-history@example.com")
    db_session.add(user2)
    await db_session.flush()

    # Add consent for user2 (required when dev_mode=False)
    await add_consent_for_user(db_session, user2)

    _, user2_token = await create_token(
        db_session, user2.id, TokenCreate(name="Test Token"),
    )
    await db_session.flush()

    get_settings.cache_clear()

    async def override_get_async_session() -> AsyncGenerator[AsyncSession]:
        yield db_session

    def override_get_settings() -> Settings:
        return Settings(database_url="postgresql://test", dev_mode=False)

    app.dependency_overrides[get_async_session] = override_get_async_session
    app.dependency_overrides[get_settings] = override_get_settings

    async with HttpxAsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {user2_token}"},
    ) as user2_client:
        # User2 should see empty history (their own, not user1's)
        response = await user2_client.get("/history/")
        assert response.status_code == 200
        user2_history = response.json()
        assert user2_history["total"] == 0
        assert user2_history["items"] == []

        # User2 should see empty history for user1's specific entity
        response = await user2_client.get(f"/history/bookmark/{user1_bookmark_id}")
        assert response.status_code == 200
        entity_history = response.json()
        assert entity_history["total"] == 0
        assert entity_history["items"] == []

        # User2 should get 404 for content at version (version doesn't exist for them)
        response = await user2_client.get(
            f"/history/bookmark/{user1_bookmark_id}/version/1",
        )
        assert response.status_code == 404

    app.dependency_overrides.clear()


async def test_pat_can_access_history(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """Test that PAT authentication can access history endpoints (read operation)."""
    from collections.abc import AsyncGenerator

    from httpx import ASGITransport, AsyncClient as HttpxAsyncClient

    from api.main import app
    from core.config import Settings, get_settings
    from db.session import get_async_session
    from schemas.token import TokenCreate
    from services.token_service import create_token
    from tests.api.conftest import add_consent_for_user

    # Create a bookmark as the dev user first (so there's history to read)
    response = await client.post(
        "/bookmarks/",
        json={"url": "https://pat-history-test.com", "title": "PAT History Test"},
    )
    assert response.status_code == 201
    bookmark_id = response.json()["id"]

    # Get the dev user from the database to create a PAT for them
    from sqlalchemy import select

    from models.user import User as UserModel

    result = await db_session.execute(
        select(UserModel).where(UserModel.email == "dev@localhost"),
    )
    dev_user = result.scalar_one()

    # Ensure dev user has consent
    await add_consent_for_user(db_session, dev_user)

    # Create a PAT for the dev user
    _, pat_token = await create_token(
        db_session, dev_user.id, TokenCreate(name="History PAT"),
    )
    await db_session.flush()

    get_settings.cache_clear()

    async def override_get_async_session() -> AsyncGenerator[AsyncSession]:
        yield db_session

    def override_get_settings() -> Settings:
        return Settings(database_url="postgresql://test", dev_mode=False)

    app.dependency_overrides[get_async_session] = override_get_async_session
    app.dependency_overrides[get_settings] = override_get_settings

    async with HttpxAsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"Authorization": f"Bearer {pat_token}"},
    ) as pat_client:
        # PAT should be able to access user history
        response = await pat_client.get("/history/")
        assert response.status_code == 200
        history = response.json()
        assert history["total"] > 0

        # PAT should be able to access entity history
        response = await pat_client.get(f"/history/bookmark/{bookmark_id}")
        assert response.status_code == 200
        entity_history = response.json()
        assert entity_history["total"] > 0

        # PAT should be able to access content at version
        response = await pat_client.get(f"/history/bookmark/{bookmark_id}/version/1")
        assert response.status_code == 200
        content = response.json()
        assert content["version"] == 1

        # PAT should be able to access per-entity convenience endpoint
        response = await pat_client.get(f"/bookmarks/{bookmark_id}/history")
        assert response.status_code == 200

    app.dependency_overrides.clear()


# --- Revert endpoint tests ---


@pytest.mark.parametrize(
    ("entity_type", "create_endpoint", "create_payload", "update_payload"),
    ENTITY_TEST_DATA,
)
async def test_revert_to_version_basic(
    client: AsyncClient,
    entity_type: str,
    create_endpoint: str,
    create_payload: dict,
    update_payload: dict,
) -> None:
    """Test basic revert to a previous version restores content."""
    # Create entity (v1)
    response = await client.post(create_endpoint, json=create_payload)
    assert response.status_code == 201
    entity_id = response.json()["id"]

    # Update to create v2
    await client.patch(f"{create_endpoint}{entity_id}", json=update_payload)

    # Verify current content is updated
    response = await client.get(f"{create_endpoint}{entity_id}")
    assert response.json()["content"] == "Updated content"

    # Revert to v1
    response = await client.post(f"/history/{entity_type}/{entity_id}/revert/1")
    assert response.status_code == 200

    data = response.json()
    assert data["message"] == "Reverted successfully"
    assert data["version"] == 1
    assert data["warnings"] is None

    # Verify content is restored to v1
    response = await client.get(f"{create_endpoint}{entity_id}")
    assert response.json()["content"] == "Initial content"


@pytest.mark.parametrize(
    ("entity_type", "create_endpoint", "create_payload", "update_payload"),
    ENTITY_TEST_DATA,
)
async def test_revert_creates_new_history_entry(
    client: AsyncClient,
    entity_type: str,
    create_endpoint: str,
    create_payload: dict,
    update_payload: dict,
) -> None:
    """Test that revert creates a new UPDATE history entry."""
    # Create entity (v1)
    response = await client.post(create_endpoint, json=create_payload)
    entity_id = response.json()["id"]

    # Update to create v2
    await client.patch(f"{create_endpoint}{entity_id}", json=update_payload)

    # Revert to v1 (creates v3)
    response = await client.post(f"/history/{entity_type}/{entity_id}/revert/1")
    assert response.status_code == 200

    # Verify history now has 3 entries
    response = await client.get(f"/history/{entity_type}/{entity_id}")
    data = response.json()
    assert data["total"] == 3

    # Latest entry (v3) should be an UPDATE action from the revert
    latest = data["items"][0]
    assert latest["version"] == 3
    assert latest["action"] == "update"


@pytest.mark.parametrize(
    ("entity_type", "create_endpoint", "create_payload"),
    ENTITY_CREATE_DATA,
)
async def test_revert_to_current_version_returns_400(
    client: AsyncClient,
    entity_type: str,
    create_endpoint: str,
    create_payload: dict,
) -> None:
    """Test that reverting to the current version returns 400."""
    # Create entity (v1)
    response = await client.post(create_endpoint, json=create_payload)
    entity_id = response.json()["id"]

    # Try to revert to v1 (current version)
    response = await client.post(f"/history/{entity_type}/{entity_id}/revert/1")
    assert response.status_code == 400
    assert response.json()["detail"] == "Cannot revert to current version"


@pytest.mark.parametrize(
    ("entity_type", "create_endpoint", "create_payload"),
    ENTITY_CREATE_DATA,
)
async def test_revert_nonexistent_version_returns_404(
    client: AsyncClient,
    entity_type: str,
    create_endpoint: str,
    create_payload: dict,
) -> None:
    """Test that reverting to a non-existent version returns 404."""
    # Create entity (v1)
    response = await client.post(create_endpoint, json=create_payload)
    entity_id = response.json()["id"]

    # Try to revert to v999
    response = await client.post(f"/history/{entity_type}/{entity_id}/revert/999")
    assert response.status_code == 404
    assert response.json()["detail"] == "Version not found"


@pytest.mark.parametrize("entity_type", ["bookmark", "note", "prompt"])
async def test_revert_nonexistent_entity_returns_404(
    client: AsyncClient,
    entity_type: str,
) -> None:
    """Test that reverting a non-existent entity returns 404."""
    fake_uuid = "00000000-0000-0000-0000-000000000000"

    response = await client.post(f"/history/{entity_type}/{fake_uuid}/revert/1")
    assert response.status_code == 404
    assert response.json()["detail"] == "Entity not found"


@pytest.mark.parametrize(
    ("entity_type", "create_endpoint", "create_payload"),
    ENTITY_CREATE_DATA,
)
async def test_revert_soft_deleted_entity_restores_it(
    client: AsyncClient,
    entity_type: str,
    create_endpoint: str,
    create_payload: dict,
) -> None:
    """Test that reverting a soft-deleted entity restores it first."""
    # Create entity (v1)
    response = await client.post(create_endpoint, json=create_payload)
    entity_id = response.json()["id"]

    # Update to create v2
    await client.patch(f"{create_endpoint}{entity_id}", json={"content": "Updated"})

    # Soft delete (v3)
    await client.delete(f"{create_endpoint}{entity_id}")

    # Verify entity is deleted (GET includes deleted, so check deleted_at)
    response = await client.get(f"{create_endpoint}{entity_id}")
    assert response.status_code == 200
    assert response.json()["deleted_at"] is not None

    # Revert to v1
    response = await client.post(f"/history/{entity_type}/{entity_id}/revert/1")
    assert response.status_code == 200

    # Verify entity is restored with v1 content and deleted_at is cleared
    response = await client.get(f"{create_endpoint}{entity_id}")
    assert response.status_code == 200
    assert response.json()["content"] == "Initial content"
    assert response.json()["deleted_at"] is None


async def test_revert_archived_entity_preserves_archive_state(
    client: AsyncClient,
) -> None:
    """Test that reverting an archived entity preserves archive state."""
    from datetime import UTC, datetime

    # Create note (v1)
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "Initial content"},
    )
    note_id = response.json()["id"]

    # Update to create v2
    await client.patch(f"/notes/{note_id}", json={"content": "Updated content"})

    # Archive the note
    past_time = datetime(2020, 1, 1, tzinfo=UTC).isoformat()
    await client.patch(f"/notes/{note_id}", json={"archived_at": past_time})

    # Revert to v1
    response = await client.post(f"/history/note/{note_id}/revert/1")
    assert response.status_code == 200

    # Verify content is restored but still archived
    response = await client.get(f"/notes/{note_id}", params={"include_archived": True})
    assert response.status_code == 200
    data = response.json()
    assert data["content"] == "Initial content"
    assert data["archived_at"] is not None


async def test_revert_restores_metadata(client: AsyncClient) -> None:
    """Test that revert restores metadata (title, description, tags)."""
    # Create note with metadata
    response = await client.post(
        "/notes/",
        json={
            "title": "Original Title",
            "description": "Original Description",
            "content": "Content",
            "tags": ["tag1", "tag2"],
        },
    )
    note_id = response.json()["id"]

    # Update metadata
    await client.patch(
        f"/notes/{note_id}",
        json={
            "title": "New Title",
            "description": "New Description",
            "tags": ["tag3"],
        },
    )

    # Verify metadata changed
    response = await client.get(f"/notes/{note_id}")
    assert response.json()["title"] == "New Title"
    assert response.json()["description"] == "New Description"
    assert set(response.json()["tags"]) == {"tag3"}

    # Revert to v1
    response = await client.post(f"/history/note/{note_id}/revert/1")
    assert response.status_code == 200

    # Verify metadata is restored
    response = await client.get(f"/notes/{note_id}")
    data = response.json()
    assert data["title"] == "Original Title"
    assert data["description"] == "Original Description"
    assert set(data["tags"]) == {"tag1", "tag2"}


async def test_revert_bookmark_restores_url(client: AsyncClient) -> None:
    """Test that reverting a bookmark restores the URL."""
    # Create bookmark
    response = await client.post(
        "/bookmarks/",
        json={"url": "https://original.com", "content": "Content"},
    )
    bookmark_id = response.json()["id"]

    # Update URL
    await client.patch(f"/bookmarks/{bookmark_id}", json={"url": "https://new.com"})

    # Verify URL changed
    response = await client.get(f"/bookmarks/{bookmark_id}")
    assert response.json()["url"] == "https://new.com/"

    # Revert to v1
    response = await client.post(f"/history/bookmark/{bookmark_id}/revert/1")
    assert response.status_code == 200

    # Verify URL is restored
    response = await client.get(f"/bookmarks/{bookmark_id}")
    assert response.json()["url"] == "https://original.com/"


async def test_revert_bookmark_url_conflict_returns_409(client: AsyncClient) -> None:
    """Test that reverting to a URL that now conflicts returns 409."""
    # Create bookmark with URL A
    response = await client.post(
        "/bookmarks/",
        json={"url": "https://url-a.com", "content": "Content"},
    )
    bookmark_id = response.json()["id"]

    # Update URL to B (v2)
    await client.patch(f"/bookmarks/{bookmark_id}", json={"url": "https://url-b.com"})

    # Create another bookmark with URL A (now takes the original URL)
    response = await client.post(
        "/bookmarks/",
        json={"url": "https://url-a.com", "content": "Other"},
    )
    assert response.status_code == 201

    # Try to revert first bookmark to v1 (URL A) - should conflict
    response = await client.post(f"/history/bookmark/{bookmark_id}/revert/1")
    assert response.status_code == 409
    assert "URL already exists" in response.json()["detail"]


async def test_revert_prompt_restores_name_and_arguments(client: AsyncClient) -> None:
    """Test that reverting a prompt restores name and arguments."""
    # Create prompt
    response = await client.post(
        "/prompts/",
        json={
            "name": "original-name",
            "content": "Hello {{ name }}",
            "arguments": [{"name": "name", "description": "User name", "required": True}],
        },
    )
    prompt_id = response.json()["id"]

    # Update name and arguments
    await client.patch(
        f"/prompts/{prompt_id}",
        json={
            "name": "new-name",
            "content": "Goodbye",
            "arguments": [],
        },
    )

    # Verify changes
    response = await client.get(f"/prompts/{prompt_id}")
    assert response.json()["name"] == "new-name"
    assert response.json()["arguments"] == []

    # Revert to v1
    response = await client.post(f"/history/prompt/{prompt_id}/revert/1")
    assert response.status_code == 200

    # Verify prompt is restored
    response = await client.get(f"/prompts/{prompt_id}")
    data = response.json()
    assert data["name"] == "original-name"
    assert data["content"] == "Hello {{ name }}"
    assert len(data["arguments"]) == 1
    assert data["arguments"][0]["name"] == "name"


async def test_revert_prompt_name_conflict_returns_409(client: AsyncClient) -> None:
    """Test that reverting to a name that now conflicts returns 409."""
    # Create prompt with name A
    response = await client.post(
        "/prompts/",
        json={"name": "name-a", "content": "Content", "arguments": []},
    )
    prompt_id = response.json()["id"]

    # Update name to B (v2)
    await client.patch(f"/prompts/{prompt_id}", json={"name": "name-b"})

    # Create another prompt with name A (now takes the original name)
    response = await client.post(
        "/prompts/",
        json={"name": "name-a", "content": "Other", "arguments": []},
    )
    assert response.status_code == 201

    # Try to revert first prompt to v1 (name A) - should conflict
    response = await client.post(f"/history/prompt/{prompt_id}/revert/1")
    assert response.status_code == 409
    assert "name already exists" in response.json()["detail"]


async def test_revert_hard_deleted_entity_returns_404(client: AsyncClient) -> None:
    """Test that reverting a hard-deleted entity returns 404."""
    # Create bookmark
    response = await client.post(
        "/bookmarks/",
        json={"url": "https://hard-delete-test.com", "content": "Content"},
    )
    bookmark_id = response.json()["id"]

    # Soft delete
    await client.delete(f"/bookmarks/{bookmark_id}")

    # Hard delete
    await client.delete(f"/bookmarks/{bookmark_id}", params={"permanent": True})

    # Try to revert - should fail with 404
    response = await client.post(f"/history/bookmark/{bookmark_id}/revert/1")
    assert response.status_code == 404
    assert response.json()["detail"] == "Entity not found"


async def test_sequential_reverts_maintain_chain_integrity(client: AsyncClient) -> None:
    """Test that sequential reverts maintain history chain integrity."""
    # Create note: v1 = "A"
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "A"},
    )
    note_id = response.json()["id"]

    # v2 = "B"
    await client.patch(f"/notes/{note_id}", json={"content": "B"})

    # v3 = "C"
    await client.patch(f"/notes/{note_id}", json={"content": "C"})

    # Revert to v1 -> creates v4 = "A"
    response = await client.post(f"/history/note/{note_id}/revert/1")
    assert response.status_code == 200

    # Revert to v2 -> creates v5 = "B"
    response = await client.post(f"/history/note/{note_id}/revert/2")
    assert response.status_code == 200

    # Revert to v4 -> creates v6 = "A"
    response = await client.post(f"/history/note/{note_id}/revert/4")
    assert response.status_code == 200

    # Verify history has 6 entries
    response = await client.get(f"/history/note/{note_id}")
    assert response.json()["total"] == 6

    # Verify all versions are independently reconstructable
    for version in range(1, 7):
        response = await client.get(f"/history/note/{note_id}/version/{version}")
        assert response.status_code == 200
        content = response.json()["content"]
        if version in [1, 4, 6]:
            assert content == "A", f"Version {version} should be 'A'"
        elif version in [2, 5]:
            assert content == "B", f"Version {version} should be 'B'"
        elif version == 3:
            assert content == "C", f"Version {version} should be 'C'"


async def test_revert_invalid_version_zero_returns_422(client: AsyncClient) -> None:
    """Test that reverting to version 0 returns 422 (validation error)."""
    # Create note
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "Content"},
    )
    note_id = response.json()["id"]

    # Try to revert to v0 (invalid)
    response = await client.post(f"/history/note/{note_id}/revert/0")
    assert response.status_code == 422  # FastAPI validation error


async def test_revert_creates_tags_if_missing(client: AsyncClient) -> None:
    """Test that reverting recreates tags that were deleted."""
    # Create note with tag
    response = await client.post(
        "/notes/",
        json={"title": "Test", "content": "Content", "tags": ["unique-tag-for-revert"]},
    )
    note_id = response.json()["id"]

    # Remove tag
    await client.patch(f"/notes/{note_id}", json={"tags": []})

    # Verify tag is removed
    response = await client.get(f"/notes/{note_id}")
    assert response.json()["tags"] == []

    # Revert to v1 - tag should be restored
    response = await client.post(f"/history/note/{note_id}/revert/1")
    assert response.status_code == 200

    # Verify tag is back
    response = await client.get(f"/notes/{note_id}")
    assert "unique-tag-for-revert" in response.json()["tags"]
