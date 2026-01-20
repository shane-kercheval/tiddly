"""Tests for prompt CRUD endpoints."""
import asyncio
from datetime import datetime, timedelta, UTC
from uuid import UUID

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.prompt import Prompt


# =============================================================================
# Create Prompt Tests
# =============================================================================


async def test__create_prompt__success(client: AsyncClient, db_session: AsyncSession) -> None:
    """Test creating a new prompt with all fields."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "test-prompt",
            "title": "Test Prompt",
            "description": "A test description",
            "content": "Hello {{ user_name }}!",
            "arguments": [
                {"name": "user_name", "description": "The user's name", "required": True},
            ],
            "tags": ["example", "test"],
        },
    )
    assert response.status_code == 201

    data = response.json()
    # Verify all response fields
    assert data["name"] == "test-prompt"
    assert data["title"] == "Test Prompt"
    assert data["description"] == "A test description"
    assert data["content"] == "Hello {{ user_name }}!"
    assert data["arguments"] == [
        {"name": "user_name", "description": "The user's name", "required": True},
    ]
    assert data["tags"] == ["example", "test"]
    assert data["deleted_at"] is None
    assert data["archived_at"] is None
    assert isinstance(data["id"], str)
    assert "created_at" in data
    assert "updated_at" in data
    assert "last_used_at" in data

    # Verify in database
    result = await db_session.execute(select(Prompt).where(Prompt.id == UUID(data["id"])))
    prompt = result.scalar_one()
    assert prompt.name == "test-prompt"
    assert prompt.title == "Test Prompt"


async def test__create_prompt__minimal(client: AsyncClient) -> None:
    """Test creating a prompt with name and content (minimal required data)."""
    response = await client.post(
        "/prompts/",
        json={"name": "minimal-prompt", "content": "Hello world"},
    )
    assert response.status_code == 201

    data = response.json()
    assert data["name"] == "minimal-prompt"
    assert data["title"] is None
    assert data["description"] is None
    assert data["content"] == "Hello world"
    assert data["arguments"] == []
    assert data["tags"] == []


async def test__create_prompt__content_required(client: AsyncClient) -> None:
    """Test that content is required for prompt creation."""
    response = await client.post(
        "/prompts/",
        json={"name": "no-content-prompt"},
    )
    # Content is required by Pydantic schema, returns 422 with validation error
    assert response.status_code == 422
    detail = response.json()["detail"]
    # Pydantic validation error format
    assert any("content" in str(err.get("loc", [])) for err in detail)


async def test__create_prompt__with_tags(client: AsyncClient) -> None:
    """Test creating a prompt with tags."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "tagged-prompt",
            "content": "Test content",
            "tags": ["code-review", "testing"],
        },
    )
    assert response.status_code == 201
    assert response.json()["tags"] == ["code-review", "testing"]


async def test__create_prompt__validation_error_invalid_name(client: AsyncClient) -> None:
    """Test that invalid prompt name is rejected."""
    # Name with underscore (should use hyphens)
    response = await client.post(
        "/prompts/",
        json={"name": "invalid_name"},
    )
    assert response.status_code == 422


async def test__create_prompt__validation_error_uppercase_name(client: AsyncClient) -> None:
    """Test that uppercase prompt name is rejected."""
    response = await client.post(
        "/prompts/",
        json={"name": "InvalidName"},
    )
    assert response.status_code == 422


async def test__create_prompt__validation_error_duplicate_arguments(client: AsyncClient) -> None:
    """Test that duplicate argument names are rejected."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "dup-args",
            "arguments": [
                {"name": "user_name"},
                {"name": "user_name"},  # Duplicate
            ],
        },
    )
    assert response.status_code == 422


async def test__create_prompt__template_syntax_error(client: AsyncClient) -> None:
    """Test that invalid Jinja2 syntax is rejected."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "bad-template",
            "content": "Hello {{ unclosed",  # Invalid syntax
        },
    )
    assert response.status_code == 400
    assert "Invalid Jinja2 syntax" in response.json()["detail"]


async def test__create_prompt__template_undefined_variable(client: AsyncClient) -> None:
    """Test that undefined template variables are rejected."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "undefined-var",
            "content": "Hello {{ user_name }}!",
            "arguments": [],  # No arguments defined
        },
    )
    assert response.status_code == 400
    assert "undefined variable" in response.json()["detail"].lower()


async def test__create_prompt__template_with_defined_arguments(client: AsyncClient) -> None:
    """Test that templates with defined arguments are accepted."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "valid-template",
            "content": "Hello {{ user_name }}, welcome to {{ project }}!",
            "arguments": [
                {"name": "user_name", "required": True},
                {"name": "project"},
            ],
        },
    )
    assert response.status_code == 201


async def test__create_prompt__name_already_exists(client: AsyncClient) -> None:
    """Test that duplicate prompt name returns 409."""
    # Create first prompt
    await client.post(
        "/prompts/",
        json={"name": "duplicate-name", "content": "First content"},
    )

    # Try to create second with same name
    response = await client.post(
        "/prompts/",
        json={"name": "duplicate-name", "content": "Second content"},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["error_code"] == "NAME_CONFLICT"


async def test__create_prompt__normalizes_tags(client: AsyncClient) -> None:
    """Test that tags are normalized to lowercase."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "tag-normalize-test",
            "content": "Test content",
            "tags": ["Python", "FASTAPI", "Web-Dev"],
        },
    )
    assert response.status_code == 201
    assert response.json()["tags"] == ["python", "fastapi", "web-dev"]


async def test__create_prompt__with_future_archived_at(client: AsyncClient) -> None:
    """Test creating a prompt with a scheduled auto-archive date."""
    future_date = (datetime.now(UTC) + timedelta(days=7)).isoformat()

    response = await client.post(
        "/prompts/",
        json={
            "name": "scheduled-prompt",
            "content": "Test content",
            "archived_at": future_date,
        },
    )
    assert response.status_code == 201

    data = response.json()
    assert data["archived_at"] is not None


# =============================================================================
# List Prompts Tests
# =============================================================================


async def test__list_prompts__returns_paginated_list(client: AsyncClient) -> None:
    """Test listing prompts returns paginated response."""
    # Create some prompts first
    for i in range(3):
        await client.post(
            "/prompts/",
            json={"name": f"list-prompt-{i}", "content": f"Content {i}"},
        )

    response = await client.get("/prompts/")
    assert response.status_code == 200

    data = response.json()
    assert len(data["items"]) == 3
    assert data["total"] == 3
    assert "offset" in data
    assert "limit" in data
    assert "has_more" in data


async def test__list_prompts__excludes_content_in_list_items(client: AsyncClient) -> None:
    """Test that list endpoint doesn't return content field for performance."""
    await client.post(
        "/prompts/",
        json={
            "name": "has-content",
            "content": "This is a long content that should not be in list",
        },
    )

    response = await client.get("/prompts/")
    assert response.status_code == 200
    items = response.json()["items"]
    # List items should not have content field
    for item in items:
        assert "content" not in item


async def test__list_prompts__search_query_filters(client: AsyncClient) -> None:
    """Test prompt search by query."""
    await client.post("/prompts/", json={"name": "python-review", "content": "Content 1"})
    await client.post("/prompts/", json={"name": "javascript-guide", "content": "Content 2"})
    await client.post(
        "/prompts/",
        json={"name": "code-helper", "content": "Content 3", "description": "Helps with Python code"},
    )

    response = await client.get("/prompts/", params={"q": "Python"})
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 2


async def test__list_prompts__tag_filter(client: AsyncClient) -> None:
    """Test prompt filtering by tags."""
    await client.post("/prompts/", json={"name": "tagged-1", "content": "C1", "tags": ["python", "web"]})
    await client.post("/prompts/", json={"name": "tagged-2", "content": "C2", "tags": ["python"]})
    await client.post("/prompts/", json={"name": "untagged", "content": "C3"})

    # Filter by single tag
    response = await client.get("/prompts/", params={"tags": ["python"]})
    assert response.status_code == 200
    assert response.json()["total"] == 2

    # Filter by multiple tags (AND mode)
    response = await client.get("/prompts/", params={"tags": ["python", "web"]})
    assert response.status_code == 200
    assert response.json()["total"] == 1


async def test__list_prompts__tag_match_any(client: AsyncClient) -> None:
    """Test tag filtering with OR mode."""
    await client.post("/prompts/", json={"name": "py", "content": "C1", "tags": ["python"]})
    await client.post("/prompts/", json={"name": "js", "content": "C2", "tags": ["javascript"]})
    await client.post("/prompts/", json={"name": "none", "content": "C3", "tags": []})

    response = await client.get(
        "/prompts/",
        params={"tags": ["python", "javascript"], "tag_match": "any"},
    )
    assert response.status_code == 200
    assert response.json()["total"] == 2


async def test__list_prompts__sort_by_title(client: AsyncClient) -> None:
    """Test sorting prompts by title."""
    await client.post("/prompts/", json={"name": "b-prompt", "content": "C1", "title": "Banana"})
    await client.post("/prompts/", json={"name": "a-prompt", "content": "C2", "title": "Apple"})
    await client.post("/prompts/", json={"name": "c-prompt", "content": "C3", "title": "Cherry"})

    # Sort ascending
    response = await client.get("/prompts/", params={"sort_by": "title", "sort_order": "asc"})
    assert response.status_code == 200
    titles = [item["title"] for item in response.json()["items"]]
    assert titles == ["Apple", "Banana", "Cherry"]


async def test__list_prompts__sort_by_title_uses_name_fallback(client: AsyncClient) -> None:
    """Test that sorting by title uses name as fallback for null titles."""
    await client.post("/prompts/", json={"name": "beta", "content": "C1"})  # No title
    await client.post("/prompts/", json={"name": "alpha", "content": "C2"})  # No title
    await client.post("/prompts/", json={"name": "gamma", "content": "C3", "title": "Gamma Title"})

    response = await client.get("/prompts/", params={"sort_by": "title", "sort_order": "asc"})
    assert response.status_code == 200
    names = [item["name"] for item in response.json()["items"]]
    # Should sort by title, with name as fallback for nulls
    assert names == ["alpha", "beta", "gamma"]


async def test__list_prompts__view_archived(client: AsyncClient) -> None:
    """Test that archived view returns only archived prompts."""
    # Create and archive some prompts
    for i in range(2):
        response = await client.post("/prompts/", json={"name": f"archive-{i}", "content": f"C{i}"})
        await client.post(f"/prompts/{response.json()['id']}/archive")

    # Create an active prompt
    await client.post("/prompts/", json={"name": "active", "content": "Active content"})

    response = await client.get("/prompts/", params={"view": "archived"})
    assert response.status_code == 200
    assert response.json()["total"] == 2
    for item in response.json()["items"]:
        assert item["archived_at"] is not None


async def test__list_prompts__view_deleted(client: AsyncClient) -> None:
    """Test that deleted view returns only soft-deleted prompts."""
    # Create and delete some prompts
    for i in range(2):
        response = await client.post("/prompts/", json={"name": f"delete-{i}", "content": f"C{i}"})
        await client.delete(f"/prompts/{response.json()['id']}")

    # Create an active prompt
    await client.post("/prompts/", json={"name": "active", "content": "Active content"})

    response = await client.get("/prompts/", params={"view": "deleted"})
    assert response.status_code == 200
    assert response.json()["total"] == 2
    for item in response.json()["items"]:
        assert item["deleted_at"] is not None


async def test__list_prompts__pagination(client: AsyncClient) -> None:
    """Test prompt listing with pagination."""
    # Create 5 prompts
    for i in range(5):
        await client.post(
            "/prompts/",
            json={"name": f"paginate-{i}", "content": f"Content {i}"},
        )

    # Test limit
    response = await client.get("/prompts/?limit=2")
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 2
    assert data["total"] == 5
    assert data["has_more"] is True

    # Test offset
    response = await client.get("/prompts/?offset=3&limit=2")
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 2
    assert data["total"] == 5


# =============================================================================
# Get Prompt by ID Tests
# =============================================================================


async def test__get_prompt__success(client: AsyncClient) -> None:
    """Test getting a single prompt by ID."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "get-test", "content": "The full content"},
    )
    prompt_id = create_response.json()["id"]

    response = await client.get(f"/prompts/{prompt_id}")
    assert response.status_code == 200

    data = response.json()
    assert data["id"] == prompt_id
    assert data["name"] == "get-test"
    assert data["content"] == "The full content"


async def test__get_prompt__includes_content(client: AsyncClient) -> None:
    """Test that GET /prompts/{id} includes content field."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "content-test", "content": "Template content here"},
    )
    prompt_id = create_response.json()["id"]

    response = await client.get(f"/prompts/{prompt_id}")
    assert response.status_code == 200
    assert "content" in response.json()
    assert response.json()["content"] == "Template content here"


async def test__get_prompt__not_found(client: AsyncClient) -> None:
    """Test getting a non-existent prompt returns 404."""
    response = await client.get("/prompts/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404
    assert response.json()["detail"] == "Prompt not found"


# Note: Cross-user isolation (IDOR) tests are in Milestone 7: test_live_penetration.py


# =============================================================================
# Get Prompt by Name Tests
# =============================================================================


async def test__get_prompt_by_name__success(client: AsyncClient) -> None:
    """Test getting a prompt by name."""
    await client.post(
        "/prompts/",
        json={"name": "my-prompt", "content": "Hello world"},
    )

    response = await client.get("/prompts/name/my-prompt")
    assert response.status_code == 200

    data = response.json()
    assert data["name"] == "my-prompt"
    assert data["content"] == "Hello world"


async def test__get_prompt_by_name__not_found(client: AsyncClient) -> None:
    """Test getting a non-existent prompt by name returns 404."""
    response = await client.get("/prompts/name/nonexistent")
    assert response.status_code == 404
    assert response.json()["detail"] == "Prompt not found"


async def test__get_prompt_by_name__deleted_prompt(client: AsyncClient) -> None:
    """Test that deleted prompts are not returned by name lookup."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "deleted-prompt", "content": "Content"},
    )
    prompt_id = create_response.json()["id"]
    await client.delete(f"/prompts/{prompt_id}")

    response = await client.get("/prompts/name/deleted-prompt")
    assert response.status_code == 404


async def test__get_prompt_by_name__archived_prompt(client: AsyncClient) -> None:
    """Test that archived prompts are not returned by name lookup."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "archived-prompt", "content": "Content"},
    )
    prompt_id = create_response.json()["id"]
    await client.post(f"/prompts/{prompt_id}/archive")

    response = await client.get("/prompts/name/archived-prompt")
    assert response.status_code == 404


# =============================================================================
# Update Prompt Tests
# =============================================================================


async def test__update_prompt__success(client: AsyncClient) -> None:
    """Test updating a prompt."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "original", "content": "Original content"},
    )
    prompt_id = create_response.json()["id"]

    response = await client.patch(
        f"/prompts/{prompt_id}",
        json={"title": "Updated Title", "tags": ["updated"]},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["title"] == "Updated Title"
    assert data["tags"] == ["updated"]
    # Name and content should remain unchanged
    assert data["name"] == "original"
    assert data["content"] == "Original content"


async def test__update_prompt__partial_update(client: AsyncClient) -> None:
    """Test partial update only changes specified fields."""
    create_response = await client.post(
        "/prompts/",
        json={
            "name": "partial-test",
            "content": "Content",
            "title": "Original Title",
            "description": "Original description",
        },
    )
    prompt_id = create_response.json()["id"]

    # Update only title
    response = await client.patch(
        f"/prompts/{prompt_id}",
        json={"title": "New Title"},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["title"] == "New Title"
    assert data["description"] == "Original description"  # Unchanged


async def test__update_prompt__update_tags(client: AsyncClient) -> None:
    """Test updating prompt tags."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "tag-update", "content": "Content", "tags": ["original"]},
    )
    prompt_id = create_response.json()["id"]

    response = await client.patch(
        f"/prompts/{prompt_id}",
        json={"tags": ["new-tag-1", "new-tag-2"]},
    )
    assert response.status_code == 200
    assert response.json()["tags"] == ["new-tag-1", "new-tag-2"]


async def test__update_prompt__clear_tags_with_empty_list(client: AsyncClient) -> None:
    """Test clearing tags by sending empty list."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "clear-tags", "content": "Content", "tags": ["some-tag"]},
    )
    prompt_id = create_response.json()["id"]

    response = await client.patch(
        f"/prompts/{prompt_id}",
        json={"tags": []},
    )
    assert response.status_code == 200
    assert response.json()["tags"] == []


async def test__update_prompt__validation_error(client: AsyncClient) -> None:
    """Test that invalid update data returns 422."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "validation-test", "content": "Content"},
    )
    prompt_id = create_response.json()["id"]

    # Try to update with invalid name
    response = await client.patch(
        f"/prompts/{prompt_id}",
        json={"name": "invalid_name"},  # Underscores not allowed
    )
    assert response.status_code == 422


async def test__update_prompt__template_syntax_error(client: AsyncClient) -> None:
    """Test that template syntax error on update returns 400."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "template-update", "content": "Original content"},
    )
    prompt_id = create_response.json()["id"]

    response = await client.patch(
        f"/prompts/{prompt_id}",
        json={"content": "{{ unclosed"},
    )
    assert response.status_code == 400
    assert "Invalid Jinja2 syntax" in response.json()["detail"]


async def test__update_prompt__not_found(client: AsyncClient) -> None:
    """Test updating a non-existent prompt returns 404."""
    response = await client.patch(
        "/prompts/00000000-0000-0000-0000-000000000000",
        json={"title": "Won't Work"},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Prompt not found"


async def test__update_prompt__name_conflict(client: AsyncClient) -> None:
    """Test that updating to an existing name returns 409."""
    # Create two prompts
    await client.post("/prompts/", json={"name": "existing-name", "content": "C1"})
    create_response = await client.post("/prompts/", json={"name": "other-name", "content": "C2"})
    prompt_id = create_response.json()["id"]

    # Try to rename to existing name
    response = await client.patch(
        f"/prompts/{prompt_id}",
        json={"name": "existing-name"},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["error_code"] == "NAME_CONFLICT"


async def test__update_prompt__updates_updated_at(client: AsyncClient) -> None:
    """Test that updating a prompt updates the updated_at timestamp."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "timestamp-test", "content": "Content"},
    )
    original_updated_at = create_response.json()["updated_at"]
    prompt_id = create_response.json()["id"]

    await asyncio.sleep(0.01)

    response = await client.patch(
        f"/prompts/{prompt_id}",
        json={"title": "New Title"},
    )
    assert response.status_code == 200
    assert response.json()["updated_at"] > original_updated_at


# =============================================================================
# Delete Prompt Tests
# =============================================================================


async def test__delete_prompt__soft_delete_default(client: AsyncClient) -> None:
    """Test soft deleting a prompt."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "to-delete", "content": "Content"},
    )
    prompt_id = create_response.json()["id"]

    response = await client.delete(f"/prompts/{prompt_id}")
    assert response.status_code == 204

    # Verify it's in deleted view
    response = await client.get("/prompts/", params={"view": "deleted"})
    assert any(p["id"] == prompt_id for p in response.json()["items"])


async def test__delete_prompt__permanent_delete(
    client: AsyncClient, db_session: AsyncSession,
) -> None:
    """Test permanently deleting a prompt."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "permanent-delete", "content": "Content"},
    )
    prompt_id = create_response.json()["id"]

    # Soft delete first, then permanent
    await client.delete(f"/prompts/{prompt_id}")
    response = await client.delete(f"/prompts/{prompt_id}", params={"permanent": True})
    assert response.status_code == 204

    # Verify it's gone from database
    result = await db_session.execute(select(Prompt).where(Prompt.id == prompt_id))
    assert result.scalar_one_or_none() is None


async def test__delete_prompt__not_found(client: AsyncClient) -> None:
    """Test deleting a non-existent prompt returns 404."""
    response = await client.delete("/prompts/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404
    assert response.json()["detail"] == "Prompt not found"


# =============================================================================
# Archive Prompt Tests
# =============================================================================


async def test__archive_prompt__success(client: AsyncClient) -> None:
    """Test archiving a prompt."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "to-archive", "content": "Content"},
    )
    prompt_id = create_response.json()["id"]

    response = await client.post(f"/prompts/{prompt_id}/archive")
    assert response.status_code == 200
    assert response.json()["archived_at"] is not None

    # Should not appear in active list
    response = await client.get("/prompts/")
    assert not any(p["id"] == prompt_id for p in response.json()["items"])


async def test__archive_prompt__already_archived(client: AsyncClient) -> None:
    """Test that archiving an already-archived prompt is idempotent."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "already-archived", "content": "Content"},
    )
    prompt_id = create_response.json()["id"]

    await client.post(f"/prompts/{prompt_id}/archive")

    # Archive again - should succeed (idempotent)
    response = await client.post(f"/prompts/{prompt_id}/archive")
    assert response.status_code == 200


async def test__archive_prompt__not_found(client: AsyncClient) -> None:
    """Test archiving a non-existent prompt returns 404."""
    response = await client.post("/prompts/00000000-0000-0000-0000-000000000000/archive")
    assert response.status_code == 404


# =============================================================================
# Unarchive Prompt Tests
# =============================================================================


async def test__unarchive_prompt__success(client: AsyncClient) -> None:
    """Test unarchiving a prompt."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "to-unarchive", "content": "Content"},
    )
    prompt_id = create_response.json()["id"]

    await client.post(f"/prompts/{prompt_id}/archive")

    response = await client.post(f"/prompts/{prompt_id}/unarchive")
    assert response.status_code == 200
    assert response.json()["archived_at"] is None

    # Should appear in active list again
    response = await client.get("/prompts/")
    assert any(p["id"] == prompt_id for p in response.json()["items"])


async def test__unarchive_prompt__not_archived(client: AsyncClient) -> None:
    """Test that unarchiving a non-archived prompt returns 400."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "not-archived", "content": "Content"},
    )
    prompt_id = create_response.json()["id"]

    response = await client.post(f"/prompts/{prompt_id}/unarchive")
    assert response.status_code == 400
    assert "not archived" in response.json()["detail"]


async def test__unarchive_prompt__not_found(client: AsyncClient) -> None:
    """Test unarchiving a non-existent prompt returns 404."""
    response = await client.post("/prompts/00000000-0000-0000-0000-000000000000/unarchive")
    assert response.status_code == 404


# =============================================================================
# Restore Prompt Tests
# =============================================================================


async def test__restore_prompt__success(client: AsyncClient) -> None:
    """Test restoring a deleted prompt."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "to-restore", "content": "Content"},
    )
    prompt_id = create_response.json()["id"]

    await client.delete(f"/prompts/{prompt_id}")

    response = await client.post(f"/prompts/{prompt_id}/restore")
    assert response.status_code == 200
    assert response.json()["deleted_at"] is None

    # Should appear in active list again
    response = await client.get("/prompts/")
    assert any(p["id"] == prompt_id for p in response.json()["items"])


async def test__restore_prompt__not_deleted(client: AsyncClient) -> None:
    """Test that restoring a non-deleted prompt returns 400."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "not-deleted", "content": "Content"},
    )
    prompt_id = create_response.json()["id"]

    response = await client.post(f"/prompts/{prompt_id}/restore")
    assert response.status_code == 400
    assert "not deleted" in response.json()["detail"]


async def test__restore_prompt__not_found(client: AsyncClient) -> None:
    """Test restoring a non-existent prompt returns 404."""
    response = await client.post("/prompts/00000000-0000-0000-0000-000000000000/restore")
    assert response.status_code == 404


async def test__restore_prompt__clears_both_timestamps(client: AsyncClient) -> None:
    """Test that restore clears both deleted_at and archived_at."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "archived-then-deleted", "content": "Content"},
    )
    prompt_id = create_response.json()["id"]

    await client.post(f"/prompts/{prompt_id}/archive")
    await client.delete(f"/prompts/{prompt_id}")

    response = await client.post(f"/prompts/{prompt_id}/restore")
    assert response.status_code == 200
    assert response.json()["deleted_at"] is None
    assert response.json()["archived_at"] is None


# =============================================================================
# Track Usage Tests
# =============================================================================


async def test__track_usage__success(client: AsyncClient) -> None:
    """Test tracking prompt usage."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "track-me", "content": "Content"},
    )
    prompt_id = create_response.json()["id"]
    original_last_used = create_response.json()["last_used_at"]

    await asyncio.sleep(0.01)

    response = await client.post(f"/prompts/{prompt_id}/track-usage")
    assert response.status_code == 204

    # Verify timestamp was updated
    response = await client.get(f"/prompts/{prompt_id}")
    assert response.json()["last_used_at"] > original_last_used


async def test__track_usage__not_found(client: AsyncClient) -> None:
    """Test tracking usage on non-existent prompt returns 404."""
    response = await client.post("/prompts/00000000-0000-0000-0000-000000000000/track-usage")
    assert response.status_code == 404
    assert response.json()["detail"] == "Prompt not found"


async def test__track_usage__works_on_archived(client: AsyncClient) -> None:
    """Test that track-usage works on archived prompts."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "archived-track", "content": "Content"},
    )
    prompt_id = create_response.json()["id"]

    response = await client.post(f"/prompts/{prompt_id}/archive")
    original_last_used = response.json()["last_used_at"]

    await asyncio.sleep(0.01)

    response = await client.post(f"/prompts/{prompt_id}/track-usage")
    assert response.status_code == 204

    # Verify via archived view
    response = await client.get("/prompts/", params={"view": "archived"})
    prompt = next(p for p in response.json()["items"] if p["id"] == prompt_id)
    assert prompt["last_used_at"] > original_last_used


# =============================================================================
# View Filtering Tests
# =============================================================================


async def test__list_prompts__view_active_excludes_deleted_and_archived(
    client: AsyncClient,
) -> None:
    """Test that active view excludes deleted and archived prompts."""
    # Create prompts in different states
    active_resp = await client.post("/prompts/", json={"name": "active-prompt", "content": "C1"})
    active_id = active_resp.json()["id"]

    archived_resp = await client.post("/prompts/", json={"name": "to-archive", "content": "C2"})
    archived_id = archived_resp.json()["id"]
    await client.post(f"/prompts/{archived_id}/archive")

    deleted_resp = await client.post("/prompts/", json={"name": "to-delete", "content": "C3"})
    deleted_id = deleted_resp.json()["id"]
    await client.delete(f"/prompts/{deleted_id}")

    # Active view should only show active prompt
    response = await client.get("/prompts/", params={"view": "active"})
    assert response.status_code == 200
    items = response.json()["items"]
    ids = [item["id"] for item in items]
    assert active_id in ids
    assert archived_id not in ids
    assert deleted_id not in ids


# =============================================================================
# Content List Integration Tests
# =============================================================================


async def test__list_prompts__with_filter_id(client: AsyncClient) -> None:
    """Test filtering prompts by filter_id parameter."""
    # Create prompts with different tags
    await client.post(
        "/prompts/",
        json={"name": "work-priority", "content": "C1", "tags": ["work", "priority"]},
    )
    await client.post(
        "/prompts/",
        json={"name": "work-only", "content": "C2", "tags": ["work"]},
    )
    await client.post(
        "/prompts/",
        json={"name": "personal", "content": "C3", "tags": ["personal"]},
    )

    # Create a list that filters for work AND priority
    response = await client.post(
        "/filters/",
        json={
            "name": "Work Priority List",
            "content_types": ["prompt"],
            "filter_expression": {
                "groups": [{"tags": ["work", "priority"]}],
                "group_operator": "OR",
            },
        },
    )
    assert response.status_code == 201
    filter_id = response.json()["id"]

    # Filter prompts by filter_id
    response = await client.get(f"/prompts/?filter_id={filter_id}")
    assert response.status_code == 200

    data = response.json()
    assert data["total"] == 1
    assert data["items"][0]["name"] == "work-priority"


async def test__list_prompts__with_filter_id_not_found(client: AsyncClient) -> None:
    """Test that non-existent filter_id returns 404."""
    response = await client.get("/prompts/?filter_id=00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404
    assert response.json()["detail"] == "Filter not found"


# =============================================================================
# Template Validation on Update Tests
# =============================================================================


async def test__update_prompt__validates_when_removing_used_argument(
    client: AsyncClient,
) -> None:
    """Test that removing an argument still used in template fails."""
    create_response = await client.post(
        "/prompts/",
        json={
            "name": "arg-removal-test",
            "content": "Hello {{ user_name }}!",
            "arguments": [{"name": "user_name", "required": True}],
        },
    )
    prompt_id = create_response.json()["id"]

    # Try to remove the argument while content still uses it
    response = await client.patch(
        f"/prompts/{prompt_id}",
        json={"arguments": []},  # Remove all arguments
    )
    assert response.status_code == 400
    assert "undefined variable" in response.json()["detail"].lower()


async def test__update_prompt__validates_when_adding_undefined_var(
    client: AsyncClient,
) -> None:
    """Test that adding template var without argument fails."""
    create_response = await client.post(
        "/prompts/",
        json={"name": "var-add-test", "content": "Original content"},
    )
    prompt_id = create_response.json()["id"]

    # Try to add content with undefined variable
    response = await client.patch(
        f"/prompts/{prompt_id}",
        json={"content": "Hello {{ new_var }}!"},
    )
    assert response.status_code == 400
    assert "undefined variable" in response.json()["detail"].lower()


async def test__update_prompt__validates_merged_state(client: AsyncClient) -> None:
    """Test that validation uses merged state of content and arguments."""
    create_response = await client.post(
        "/prompts/",
        json={
            "name": "merged-state-test",
            "content": "Hello {{ user_name }}!",
            "arguments": [{"name": "user_name"}],
        },
    )
    prompt_id = create_response.json()["id"]

    # Update both content and arguments at once - should validate merged state
    response = await client.patch(
        f"/prompts/{prompt_id}",
        json={
            "content": "Hello {{ user_name }} from {{ project }}!",
            "arguments": [
                {"name": "user_name"},
                {"name": "project"},
            ],
        },
    )
    assert response.status_code == 200


# =============================================================================
# Argument Validation Tests
# =============================================================================


async def test__create_prompt__argument_name_with_underscore(client: AsyncClient) -> None:
    """Test that argument names can have underscores."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "underscore-args",
            "content": "Hello {{ user_name }}, here is {{ code_block }}",
            "arguments": [{"name": "user_name"}, {"name": "code_block"}],
        },
    )
    assert response.status_code == 201


async def test__create_prompt__argument_name_with_hyphen_rejected(
    client: AsyncClient,
) -> None:
    """Test that argument names with hyphens are rejected."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "hyphen-arg-test",
            "arguments": [{"name": "user-name"}],  # Invalid - hyphens not allowed
        },
    )
    assert response.status_code == 422


# =============================================================================
# Render Prompt Tests
# =============================================================================


async def test__render_prompt__simple_template(client: AsyncClient) -> None:
    """Test rendering a simple template with one argument."""
    # Create prompt
    create_response = await client.post(
        "/prompts/",
        json={
            "name": "render-simple",
            "content": "Hello, {{ name }}!",
            "arguments": [{"name": "name", "required": True}],
        },
    )
    assert create_response.status_code == 201
    prompt_id = create_response.json()["id"]

    # Render with argument
    response = await client.post(
        f"/prompts/{prompt_id}/render",
        json={"arguments": {"name": "World"}},
    )
    assert response.status_code == 200
    assert response.json()["rendered_content"] == "Hello, World!"


async def test__render_prompt__multiple_arguments(client: AsyncClient) -> None:
    """Test rendering a template with multiple arguments."""
    # Create prompt
    create_response = await client.post(
        "/prompts/",
        json={
            "name": "render-multi",
            "content": "{{ greeting }}, {{ name }}! Welcome to {{ place }}.",
            "arguments": [
                {"name": "greeting", "required": True},
                {"name": "name", "required": True},
                {"name": "place", "required": True},
            ],
        },
    )
    assert create_response.status_code == 201
    prompt_id = create_response.json()["id"]

    # Render with all arguments
    response = await client.post(
        f"/prompts/{prompt_id}/render",
        json={"arguments": {"greeting": "Hello", "name": "Alice", "place": "Python"}},
    )
    assert response.status_code == 200
    assert response.json()["rendered_content"] == "Hello, Alice! Welcome to Python."


async def test__render_prompt__missing_required_argument(client: AsyncClient) -> None:
    """Test that missing required argument returns 400."""
    # Create prompt
    create_response = await client.post(
        "/prompts/",
        json={
            "name": "render-required",
            "content": "Hello, {{ name }}!",
            "arguments": [{"name": "name", "required": True}],
        },
    )
    assert create_response.status_code == 201
    prompt_id = create_response.json()["id"]

    # Render without required argument
    response = await client.post(
        f"/prompts/{prompt_id}/render",
        json={"arguments": {}},
    )
    assert response.status_code == 400
    assert "Missing required argument" in response.json()["detail"]
    assert "name" in response.json()["detail"]


async def test__render_prompt__unknown_argument(client: AsyncClient) -> None:
    """Test that unknown argument returns 400."""
    # Create prompt with one argument
    create_response = await client.post(
        "/prompts/",
        json={
            "name": "render-unknown",
            "content": "Hello, {{ name }}!",
            "arguments": [{"name": "name", "required": True}],
        },
    )
    assert create_response.status_code == 201
    prompt_id = create_response.json()["id"]

    # Render with extra argument
    response = await client.post(
        f"/prompts/{prompt_id}/render",
        json={"arguments": {"name": "World", "extra": "value"}},
    )
    assert response.status_code == 400
    assert "Unknown argument" in response.json()["detail"]
    assert "extra" in response.json()["detail"]


async def test__render_prompt__optional_argument_omitted(client: AsyncClient) -> None:
    """Test that optional arguments default to empty string for conditionals."""
    # Create prompt with optional argument
    create_response = await client.post(
        "/prompts/",
        json={
            "name": "render-optional",
            "content": "Hello{% if suffix %}, {{ suffix }}{% endif %}!",
            "arguments": [{"name": "suffix", "required": False}],
        },
    )
    assert create_response.status_code == 201
    prompt_id = create_response.json()["id"]

    # Render without optional argument
    response = await client.post(
        f"/prompts/{prompt_id}/render",
        json={"arguments": {}},
    )
    assert response.status_code == 200
    assert response.json()["rendered_content"] == "Hello!"


async def test__render_prompt__optional_argument_provided(client: AsyncClient) -> None:
    """Test that optional argument enables conditional block when provided."""
    # Create prompt with optional argument
    create_response = await client.post(
        "/prompts/",
        json={
            "name": "render-optional-provided",
            "content": "Hello{% if suffix %}, {{ suffix }}{% endif %}!",
            "arguments": [{"name": "suffix", "required": False}],
        },
    )
    assert create_response.status_code == 201
    prompt_id = create_response.json()["id"]

    # Render with optional argument
    response = await client.post(
        f"/prompts/{prompt_id}/render",
        json={"arguments": {"suffix": "friend"}},
    )
    assert response.status_code == 200
    assert response.json()["rendered_content"] == "Hello, friend!"


async def test__render_prompt__not_found(client: AsyncClient) -> None:
    """Test that rendering non-existent prompt returns 404."""
    response = await client.post(
        "/prompts/00000000-0000-0000-0000-000000000000/render",
        json={"arguments": {}},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Prompt not found"


async def test__render_prompt__no_content(client: AsyncClient, db_session: AsyncSession) -> None:
    """Test that prompt with no content returns empty string."""
    # Create prompt with content, then update to remove it
    # (content is required on create, so we need to update after)
    create_response = await client.post(
        "/prompts/",
        json={
            "name": "render-no-content",
            "content": "Initial content",
        },
    )
    assert create_response.status_code == 201
    prompt_id = create_response.json()["id"]

    # Directly update in DB to set content to empty (bypass API validation)
    result = await db_session.execute(select(Prompt).where(Prompt.id == UUID(prompt_id)))
    prompt = result.scalar_one()
    prompt.content = ""
    await db_session.commit()

    # Render prompt with empty content
    response = await client.post(
        f"/prompts/{prompt_id}/render",
        json={"arguments": {}},
    )
    assert response.status_code == 200
    assert response.json()["rendered_content"] == ""


async def test__render_prompt__archived_prompt(client: AsyncClient) -> None:
    """Test that archived prompts can be rendered."""
    # Create prompt
    create_response = await client.post(
        "/prompts/",
        json={
            "name": "render-archived",
            "content": "Hello, {{ name }}!",
            "arguments": [{"name": "name", "required": True}],
        },
    )
    assert create_response.status_code == 201
    prompt_id = create_response.json()["id"]

    # Archive it
    archive_response = await client.post(f"/prompts/{prompt_id}/archive")
    assert archive_response.status_code == 200

    # Render should still work
    response = await client.post(
        f"/prompts/{prompt_id}/render",
        json={"arguments": {"name": "World"}},
    )
    assert response.status_code == 200
    assert response.json()["rendered_content"] == "Hello, World!"


async def test__render_prompt__deleted_prompt(client: AsyncClient) -> None:
    """Test that soft-deleted prompts can be rendered."""
    # Create prompt
    create_response = await client.post(
        "/prompts/",
        json={
            "name": "render-deleted",
            "content": "Hello, {{ name }}!",
            "arguments": [{"name": "name", "required": True}],
        },
    )
    assert create_response.status_code == 201
    prompt_id = create_response.json()["id"]

    # Soft delete it
    delete_response = await client.delete(f"/prompts/{prompt_id}")
    assert delete_response.status_code == 204

    # Render should still work
    response = await client.post(
        f"/prompts/{prompt_id}/render",
        json={"arguments": {"name": "World"}},
    )
    assert response.status_code == 200
    assert response.json()["rendered_content"] == "Hello, World!"


async def test__render_prompt__no_arguments_static_content(client: AsyncClient) -> None:
    """Test rendering a prompt with no arguments (static content)."""
    # Create prompt with no arguments
    create_response = await client.post(
        "/prompts/",
        json={
            "name": "render-static",
            "content": "This is static content with no variables.",
        },
    )
    assert create_response.status_code == 201
    prompt_id = create_response.json()["id"]

    # Render with empty arguments
    response = await client.post(
        f"/prompts/{prompt_id}/render",
        json={"arguments": {}},
    )
    assert response.status_code == 200
    assert response.json()["rendered_content"] == "This is static content with no variables."


async def test__render_prompt__complex_jinja_template(client: AsyncClient) -> None:
    """Test rendering complex Jinja2 templates with conditionals and whitespace control."""
    # Create prompt with complex template
    create_response = await client.post(
        "/prompts/",
        json={
            "name": "render-complex",
            "content": """{%- if formal -%}Dear {{ name }},{%- else -%}Hey {{ name }}!{%- endif -%}""",
            "arguments": [
                {"name": "name", "required": True},
                {"name": "formal", "required": False},
            ],
        },
    )
    assert create_response.status_code == 201
    prompt_id = create_response.json()["id"]

    # Render with formal=true
    response = await client.post(
        f"/prompts/{prompt_id}/render",
        json={"arguments": {"name": "Bob", "formal": "true"}},
    )
    assert response.status_code == 200
    assert response.json()["rendered_content"] == "Dear Bob,"

    # Render without formal (defaults to empty, falsy)
    response = await client.post(
        f"/prompts/{prompt_id}/render",
        json={"arguments": {"name": "Bob"}},
    )
    assert response.status_code == 200
    assert response.json()["rendered_content"] == "Hey Bob!"


async def test__render_prompt__preserves_whitespace(client: AsyncClient) -> None:
    """Test that rendering preserves whitespace in content."""
    # Create prompt with intentional whitespace
    create_response = await client.post(
        "/prompts/",
        json={
            "name": "render-whitespace",
            "content": "Line 1\n\nLine 3\n  Indented line\n\n{{ text }}",
            "arguments": [{"name": "text", "required": True}],
        },
    )
    assert create_response.status_code == 201
    prompt_id = create_response.json()["id"]

    # Render and verify whitespace preserved
    response = await client.post(
        f"/prompts/{prompt_id}/render",
        json={"arguments": {"text": "Final line"}},
    )
    assert response.status_code == 200
    assert response.json()["rendered_content"] == "Line 1\n\nLine 3\n  Indented line\n\nFinal line"


async def test__render_prompt__jinja_filter(client: AsyncClient) -> None:
    """Test rendering template with Jinja2 filters."""
    # Create prompt with filter
    create_response = await client.post(
        "/prompts/",
        json={
            "name": "render-filter",
            "content": "{{ name | upper }}",
            "arguments": [{"name": "name", "required": True}],
        },
    )
    assert create_response.status_code == 201
    prompt_id = create_response.json()["id"]

    # Render with filter
    response = await client.post(
        f"/prompts/{prompt_id}/render",
        json={"arguments": {"name": "hello"}},
    )
    assert response.status_code == 200
    assert response.json()["rendered_content"] == "HELLO"


# =============================================================================
# Within-Content Search Tests
# =============================================================================


async def test_search_in_prompt_basic(client: AsyncClient) -> None:
    """Test basic search within a prompt's content."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "search-test-prompt",
            "content": "line 1\nline 2 with target\nline 3",
        },
    )
    assert response.status_code == 201
    prompt_id = response.json()["id"]

    response = await client.get(
        f"/prompts/{prompt_id}/search",
        params={"q": "target"},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["total_matches"] == 1
    assert len(data["matches"]) == 1
    assert data["matches"][0]["field"] == "content"
    assert data["matches"][0]["line"] == 2
    assert "target" in data["matches"][0]["context"]


async def test_search_in_prompt_no_matches_returns_empty(client: AsyncClient) -> None:
    """Test that no matches returns empty array (not error)."""
    response = await client.post(
        "/prompts/",
        json={"name": "no-matches-prompt", "content": "some content here"},
    )
    assert response.status_code == 201
    prompt_id = response.json()["id"]

    response = await client.get(
        f"/prompts/{prompt_id}/search",
        params={"q": "nonexistent"},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["total_matches"] == 0
    assert data["matches"] == []


async def test_search_in_prompt_title_field(client: AsyncClient) -> None:
    """Test searching in title field returns full title as context."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "title-search-prompt",
            "title": "Important Code Review Prompt",
            "content": "content here",
        },
    )
    assert response.status_code == 201
    prompt_id = response.json()["id"]

    response = await client.get(
        f"/prompts/{prompt_id}/search",
        params={"q": "review", "fields": "title"},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["total_matches"] == 1
    assert data["matches"][0]["field"] == "title"
    assert data["matches"][0]["line"] is None
    assert data["matches"][0]["context"] == "Important Code Review Prompt"


async def test_search_in_prompt_multiple_fields(client: AsyncClient) -> None:
    """Test searching across multiple fields."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "multi-field-prompt",
            "title": "Python Code Review",
            "description": "Review Python code for best practices",
            "content": "Please review this Python code:\n{{ code }}",
            "arguments": [{"name": "code", "required": True}],
        },
    )
    assert response.status_code == 201
    prompt_id = response.json()["id"]

    response = await client.get(
        f"/prompts/{prompt_id}/search",
        params={"q": "python", "fields": "content,title,description"},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["total_matches"] == 3
    fields = {m["field"] for m in data["matches"]}
    assert fields == {"content", "title", "description"}


async def test_search_in_prompt_case_sensitive(client: AsyncClient) -> None:
    """Test case-sensitive search."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "case-sensitive-prompt",
            "content": "Hello World",
        },
    )
    assert response.status_code == 201
    prompt_id = response.json()["id"]

    # Case-sensitive search should not match
    response = await client.get(
        f"/prompts/{prompt_id}/search",
        params={"q": "WORLD", "case_sensitive": True},
    )
    assert response.status_code == 200
    assert response.json()["total_matches"] == 0

    # Exact case should match
    response = await client.get(
        f"/prompts/{prompt_id}/search",
        params={"q": "World", "case_sensitive": True},
    )
    assert response.status_code == 200
    assert response.json()["total_matches"] == 1


async def test_search_in_prompt_not_found(client: AsyncClient) -> None:
    """Test 404 when prompt doesn't exist."""
    response = await client.get(
        "/prompts/00000000-0000-0000-0000-000000000000/search",
        params={"q": "test"},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Prompt not found"


async def test_search_in_prompt_invalid_field(client: AsyncClient) -> None:
    """Test 400 when invalid field is specified."""
    response = await client.post(
        "/prompts/",
        json={"name": "invalid-field-prompt", "content": "content"},
    )
    assert response.status_code == 201
    prompt_id = response.json()["id"]

    response = await client.get(
        f"/prompts/{prompt_id}/search",
        params={"q": "test", "fields": "content,invalid"},
    )
    assert response.status_code == 400
    assert "Invalid fields" in response.json()["detail"]


async def test_search_in_prompt_works_on_archived(client: AsyncClient) -> None:
    """Test that search works on archived prompts."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "archived-search-prompt",
            "content": "search target here",
        },
    )
    assert response.status_code == 201
    prompt_id = response.json()["id"]

    # Archive the prompt
    await client.post(f"/prompts/{prompt_id}/archive")

    # Search should still work
    response = await client.get(
        f"/prompts/{prompt_id}/search",
        params={"q": "target"},
    )
    assert response.status_code == 200
    assert response.json()["total_matches"] == 1


async def test_search_in_prompt_works_on_deleted(client: AsyncClient) -> None:
    """Test that search works on soft-deleted prompts."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "deleted-search-prompt",
            "content": "search target here",
        },
    )
    assert response.status_code == 201
    prompt_id = response.json()["id"]

    # Delete the prompt
    await client.delete(f"/prompts/{prompt_id}")

    # Search should still work
    response = await client.get(
        f"/prompts/{prompt_id}/search",
        params={"q": "target"},
    )
    assert response.status_code == 200
    assert response.json()["total_matches"] == 1


async def test_search_in_prompt_jinja_template(client: AsyncClient) -> None:
    """Test searching in a prompt with Jinja2 template syntax."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "jinja-search-prompt",
            "content": "Please review:\n{{ code }}\nProvide feedback:",
            "arguments": [{"name": "code", "required": True}],
        },
    )
    assert response.status_code == 201
    prompt_id = response.json()["id"]

    # Search for Jinja2 variable
    response = await client.get(
        f"/prompts/{prompt_id}/search",
        params={"q": "{{ code }}"},
    )
    assert response.status_code == 200
    assert response.json()["total_matches"] == 1
    assert response.json()["matches"][0]["line"] == 2
