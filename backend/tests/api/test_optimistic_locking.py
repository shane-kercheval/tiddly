"""
Parametrized tests for optimistic locking (conflict detection) on updates.

These tests run against all entity types (notes, bookmarks, prompts) to verify
consistent behavior for the expected_updated_at parameter on PATCH endpoints.
"""
import asyncio
import uuid
from datetime import datetime, UTC
from typing import Any

import pytest
from httpx import AsyncClient

from tests.api.conftest import FAKE_UUID


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
            json={"title": "Test Note", "content": "Test content for locking"},
        )
        assert response.status_code == 201
        data = response.json()
        return {
            "entity": data,
            "id": data["id"],
            "base_endpoint": "/notes",
            "endpoint": f"/notes/{data['id']}",
            "entity_type": "note",
            "update_data": {"title": "Updated Title"},
            "str_replace_old": "Test content",
            "str_replace_new": "Updated content",
        }

    if entity_type == "bookmark":
        unique_url = f"https://locking-test-{uuid.uuid4().hex[:8]}.example.com"
        response = await client.post(
            "/bookmarks/",
            json={"url": unique_url, "title": "Test Bookmark", "content": "Test content for locking"},
        )
        assert response.status_code == 201
        data = response.json()
        return {
            "entity": data,
            "id": data["id"],
            "base_endpoint": "/bookmarks",
            "endpoint": f"/bookmarks/{data['id']}",
            "entity_type": "bookmark",
            "update_data": {"title": "Updated Title"},
            "str_replace_old": "Test content",
            "str_replace_new": "Updated content",
        }

    if entity_type == "prompt":
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
            "name": unique_name,
            "base_endpoint": "/prompts",
            "endpoint": f"/prompts/{data['id']}",
            "name_endpoint": f"/prompts/name/{unique_name}",
            "entity_type": "prompt",
            "update_data": {"title": "Updated Title"},
            "str_replace_old": "Hello",
            "str_replace_new": "Hi",
        }

    raise ValueError(f"Unknown entity type: {entity_type}")


ENTITY_TYPES = ["note", "bookmark", "prompt"]


# =============================================================================
# PATCH Update Tests - Parametrized
# =============================================================================


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__update__with_expected_updated_at__success(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Update succeeds when timestamps match exactly."""
    response = await client.patch(
        entity_setup["endpoint"],
        json={
            **entity_setup["update_data"],
            "expected_updated_at": entity_setup["entity"]["updated_at"],
        },
    )
    assert response.status_code == 200


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__update__with_expected_updated_at__conflict_returns_409(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Returns 409 when entity was modified after expected time."""
    stale_timestamp = entity_setup["entity"]["updated_at"]

    # Modify the entity to change its updated_at
    await asyncio.sleep(0.01)
    await client.patch(entity_setup["endpoint"], json={"title": "First Update"})

    # Try to update with stale timestamp
    response = await client.patch(
        entity_setup["endpoint"],
        json={
            "title": "Second Update",
            "expected_updated_at": stale_timestamp,
        },
    )
    assert response.status_code == 409
    assert response.json()["detail"]["error"] == "conflict"


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__update__conflict_response_includes_server_state(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """409 response contains full current entity state."""
    stale_timestamp = entity_setup["entity"]["updated_at"]

    # Modify the entity
    await asyncio.sleep(0.01)
    await client.patch(entity_setup["endpoint"], json={"title": "Server Version"})

    # Try to update with stale timestamp
    response = await client.patch(
        entity_setup["endpoint"],
        json={
            "title": "Client Version",
            "expected_updated_at": stale_timestamp,
        },
    )
    assert response.status_code == 409

    detail = response.json()["detail"]
    assert "server_state" in detail
    # Verify server_state contains the server's current data
    assert detail["server_state"]["title"] == "Server Version"
    assert detail["server_state"]["id"] == entity_setup["id"]


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__update__conflict_response_structure(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Verify error format: {error: "conflict", message: "...", server_state: {...}}."""
    stale_timestamp = entity_setup["entity"]["updated_at"]

    # Modify the entity
    await asyncio.sleep(0.01)
    await client.patch(entity_setup["endpoint"], json={"title": "Modified"})

    # Try to update with stale timestamp
    response = await client.patch(
        entity_setup["endpoint"],
        json={
            "title": "Attempt",
            "expected_updated_at": stale_timestamp,
        },
    )
    assert response.status_code == 409

    detail = response.json()["detail"]
    assert detail["error"] == "conflict"
    assert detail["message"] == "This item was modified since you loaded it"
    assert isinstance(detail["server_state"], dict)


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__update__without_expected_updated_at__allows_update(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Existing behavior unchanged (last-write-wins) when no expected_updated_at."""
    # Update without expected_updated_at
    response = await client.patch(
        entity_setup["endpoint"],
        json={"title": "No Lock Update"},
    )
    assert response.status_code == 200
    assert response.json()["title"] == "No Lock Update"


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__update__without_expected_updated_at__no_conflict_check(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """No 409 even if entity was modified when no expected_updated_at provided."""
    # Modify the entity
    await asyncio.sleep(0.01)
    await client.patch(entity_setup["endpoint"], json={"title": "First Update"})

    # Update again without expected_updated_at - should succeed (last-write-wins)
    response = await client.patch(
        entity_setup["endpoint"],
        json={"title": "Second Update"},
    )
    assert response.status_code == 200
    assert response.json()["title"] == "Second Update"


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__update__expected_updated_at__entity_not_found_returns_404(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """404 if entity doesn't exist (not 409)."""
    response = await client.patch(
        f"{entity_setup['base_endpoint']}/{FAKE_UUID}",
        json={
            "title": "Won't Work",
            "expected_updated_at": entity_setup["entity"]["updated_at"],
        },
    )
    assert response.status_code == 404


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__update__expected_updated_at__archived_entity(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Works correctly with archived entities."""
    # Archive the entity
    archive_response = await client.post(f"{entity_setup['endpoint']}/archive")
    assert archive_response.status_code == 200
    archived_updated_at = archive_response.json()["updated_at"]

    # Update with correct timestamp should succeed
    response = await client.patch(
        entity_setup["endpoint"],
        json={
            "title": "Archived Update",
            "expected_updated_at": archived_updated_at,
        },
    )
    assert response.status_code == 200


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__update__expected_updated_at__timezone_handling(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """UTC timestamps compared correctly regardless of input timezone format."""
    # The server returns ISO format with Z suffix (e.g., 2024-01-15T12:00:00.123456Z)
    # Convert to +00:00 format to verify backend handles both representations
    server_timestamp = entity_setup["entity"]["updated_at"]
    assert server_timestamp.endswith("Z"), "Expected server to return Z suffix"
    equivalent_timestamp = server_timestamp[:-1] + "+00:00"

    response = await client.patch(
        entity_setup["endpoint"],
        json={
            "title": "Timezone Test",
            "expected_updated_at": equivalent_timestamp,
        },
    )
    assert response.status_code == 200


# =============================================================================
# Str-Replace Tests - Parametrized
# =============================================================================


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__str_replace__with_expected_updated_at__success(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Str-replace succeeds when timestamps match exactly."""
    response = await client.patch(
        f"{entity_setup['endpoint']}/str-replace",
        json={
            "old_str": entity_setup["str_replace_old"],
            "new_str": entity_setup["str_replace_new"],
            "expected_updated_at": entity_setup["entity"]["updated_at"],
        },
    )
    assert response.status_code == 200


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__str_replace__with_expected_updated_at__conflict_returns_409(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Str-replace returns 409 when entity was modified after expected time."""
    stale_timestamp = entity_setup["entity"]["updated_at"]

    # Modify the entity
    await asyncio.sleep(0.01)
    await client.patch(entity_setup["endpoint"], json={"title": "Modified"})

    # Try str-replace with stale timestamp
    response = await client.patch(
        f"{entity_setup['endpoint']}/str-replace",
        json={
            "old_str": entity_setup["str_replace_old"],
            "new_str": entity_setup["str_replace_new"],
            "expected_updated_at": stale_timestamp,
        },
    )
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["error"] == "conflict"
    assert detail["message"] == "This item was modified since you loaded it"
    assert "server_state" in detail
    assert detail["server_state"]["title"] == "Modified"
    assert detail["server_state"]["id"] == entity_setup["id"]


@pytest.mark.parametrize("entity_setup", ENTITY_TYPES, indirect=True)
async def test__str_replace__without_expected_updated_at__allows_update(
    client: AsyncClient,
    entity_setup: dict[str, Any],
) -> None:
    """Str-replace without expected_updated_at succeeds (backwards compatible)."""
    response = await client.patch(
        f"{entity_setup['endpoint']}/str-replace",
        json={
            "old_str": entity_setup["str_replace_old"],
            "new_str": entity_setup["str_replace_new"],
        },
    )
    assert response.status_code == 200


# =============================================================================
# Prompt By-Name Endpoint Tests
# =============================================================================


@pytest.fixture
async def prompt_for_name_tests(client: AsyncClient) -> dict[str, Any]:
    """Create a prompt for by-name endpoint tests."""
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
        "name": unique_name,
        "name_endpoint": f"/prompts/name/{unique_name}",
    }


async def test__update_prompt_by_name__with_expected_updated_at__success(
    client: AsyncClient,
    prompt_for_name_tests: dict[str, Any],
) -> None:
    """Update by name succeeds when timestamps match exactly."""
    setup = prompt_for_name_tests
    response = await client.patch(
        setup["name_endpoint"],
        json={
            "title": "Updated via Name",
            "expected_updated_at": setup["entity"]["updated_at"],
        },
    )
    assert response.status_code == 200


async def test__update_prompt_by_name__with_expected_updated_at__conflict_returns_409(
    client: AsyncClient,
    prompt_for_name_tests: dict[str, Any],
) -> None:
    """Update by name returns 409 when prompt was modified after expected time."""
    setup = prompt_for_name_tests
    stale_timestamp = setup["entity"]["updated_at"]

    # Modify the prompt
    await asyncio.sleep(0.01)
    await client.patch(setup["name_endpoint"], json={"title": "First Update"})

    # Try to update with stale timestamp
    response = await client.patch(
        setup["name_endpoint"],
        json={
            "title": "Second Update",
            "expected_updated_at": stale_timestamp,
        },
    )
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["error"] == "conflict"
    assert detail["message"] == "This item was modified since you loaded it"
    assert "server_state" in detail
    assert detail["server_state"]["title"] == "First Update"
    assert detail["server_state"]["name"] == setup["entity"]["name"]


async def test__str_replace_prompt_by_name__with_expected_updated_at__success(
    client: AsyncClient,
    prompt_for_name_tests: dict[str, Any],
) -> None:
    """Str-replace by name succeeds when timestamps match exactly."""
    setup = prompt_for_name_tests
    response = await client.patch(
        f"{setup['name_endpoint']}/str-replace",
        json={
            "old_str": "Hello",
            "new_str": "Hi",
            "expected_updated_at": setup["entity"]["updated_at"],
        },
    )
    assert response.status_code == 200


async def test__str_replace_prompt_by_name__with_expected_updated_at__conflict_returns_409(
    client: AsyncClient,
    prompt_for_name_tests: dict[str, Any],
) -> None:
    """Str-replace by name returns 409 when prompt was modified after expected time."""
    setup = prompt_for_name_tests
    stale_timestamp = setup["entity"]["updated_at"]

    # Modify the prompt
    await asyncio.sleep(0.01)
    await client.patch(setup["name_endpoint"], json={"title": "Modified"})

    # Try str-replace with stale timestamp
    response = await client.patch(
        f"{setup['name_endpoint']}/str-replace",
        json={
            "old_str": "Hello",
            "new_str": "Hi",
            "expected_updated_at": stale_timestamp,
        },
    )
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert detail["error"] == "conflict"
    assert detail["message"] == "This item was modified since you loaded it"
    assert "server_state" in detail
    assert detail["server_state"]["title"] == "Modified"
    assert detail["server_state"]["name"] == setup["entity"]["name"]


async def test__update_prompt_by_name__not_found_returns_404(
    client: AsyncClient,
) -> None:
    """Update by name returns 404 for non-existent prompt (not 409)."""
    response = await client.patch(
        "/prompts/name/nonexistent-prompt-xyz",
        json={
            "title": "Won't Work",
            "expected_updated_at": datetime.now(UTC).isoformat(),
        },
    )
    assert response.status_code == 404


async def test__update_prompt_by_name__archived_prompt_returns_404(
    client: AsyncClient,
    prompt_for_name_tests: dict[str, Any],
) -> None:
    """
    Update by name on archived prompt returns 404, not 409.

    This documents intentional asymmetry: by-name endpoints only work with
    active prompts (by design for MCP use). Archived prompts are invisible
    to name-based lookups, so the conflict check returns 404 rather than
    detecting a conflict.
    """
    setup = prompt_for_name_tests

    # Archive the prompt
    archive_response = await client.post(f"/prompts/{setup['id']}/archive")
    assert archive_response.status_code == 200

    # Try to update by name with the original timestamp
    # Since the prompt is now archived, get_updated_at_by_name returns None → 404
    response = await client.patch(
        setup["name_endpoint"],
        json={
            "title": "Update Archived",
            "expected_updated_at": setup["entity"]["updated_at"],
        },
    )
    assert response.status_code == 404
