"""Tests for prompt CRUD endpoints."""
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.prompt import Prompt


# =============================================================================
# Create Prompt Tests
# =============================================================================


async def test__create_prompt__success(
    client: AsyncClient, db_session: AsyncSession,
) -> None:
    """Test creating a new prompt with all fields."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "code-review",
            "title": "Code Review Assistant",
            "description": "Reviews code for quality and best practices",
            "content": "Please review the following {{ language }} code:\n\n{{ code }}",
            "arguments": [
                {"name": "language", "description": "Programming language", "required": True},
                {"name": "code", "description": "Code to review", "required": True},
            ],
        },
    )
    assert response.status_code == 201

    data = response.json()
    assert data["name"] == "code-review"
    assert data["title"] == "Code Review Assistant"
    assert data["description"] == "Reviews code for quality and best practices"
    assert data["content"] == "Please review the following {{ language }} code:\n\n{{ code }}"
    assert len(data["arguments"]) == 2
    assert data["arguments"][0]["name"] == "language"
    assert data["arguments"][0]["required"] is True
    assert isinstance(data["id"], int)
    assert "created_at" in data
    assert "updated_at" in data

    # Verify in database
    result = await db_session.execute(select(Prompt).where(Prompt.id == data["id"]))
    prompt = result.scalar_one()
    assert prompt.name == "code-review"
    assert prompt.title == "Code Review Assistant"


async def test__create_prompt__minimal(client: AsyncClient) -> None:
    """Test creating a prompt with only required name field."""
    response = await client.post(
        "/prompts/",
        json={"name": "minimal-prompt"},
    )
    assert response.status_code == 201

    data = response.json()
    assert data["name"] == "minimal-prompt"
    assert data["title"] is None
    assert data["description"] is None
    assert data["content"] is None
    assert data["arguments"] == []


async def test__create_prompt__invalid_name_format(client: AsyncClient) -> None:
    """Test that invalid name format is rejected."""
    # Uppercase
    response = await client.post(
        "/prompts/",
        json={"name": "Code-Review"},
    )
    assert response.status_code == 422

    # Spaces
    response = await client.post(
        "/prompts/",
        json={"name": "code review"},
    )
    assert response.status_code == 422

    # Special characters
    response = await client.post(
        "/prompts/",
        json={"name": "code_review"},
    )
    assert response.status_code == 422


async def test__create_prompt__duplicate_name_rejected(client: AsyncClient) -> None:
    """Test that duplicate name for same user is rejected."""
    # Create first prompt
    response = await client.post(
        "/prompts/",
        json={"name": "test-prompt"},
    )
    assert response.status_code == 201

    # Try to create duplicate
    response = await client.post(
        "/prompts/",
        json={"name": "test-prompt"},
    )
    assert response.status_code == 400
    assert "already exists" in response.json()["detail"]


async def test__create_prompt__duplicate_argument_names_rejected(client: AsyncClient) -> None:
    """Test that duplicate argument names are rejected."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "dupe-args",
            "arguments": [
                {"name": "code", "required": True},
                {"name": "code", "required": False},
            ],
        },
    )
    assert response.status_code == 422
    assert "duplicate" in response.text.lower()


async def test__create_prompt__invalid_argument_name_format(client: AsyncClient) -> None:
    """Test that invalid argument name format is rejected."""
    # Argument starting with number
    response = await client.post(
        "/prompts/",
        json={
            "name": "invalid-arg",
            "arguments": [{"name": "1code", "required": True}],
        },
    )
    assert response.status_code == 422

    # Argument with hyphens (should use underscores)
    response = await client.post(
        "/prompts/",
        json={
            "name": "invalid-arg2",
            "arguments": [{"name": "my-code", "required": True}],
        },
    )
    assert response.status_code == 422


async def test__create_prompt__undefined_template_variable_rejected(client: AsyncClient) -> None:
    """Test that template using undefined variable is rejected."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "undefined-var",
            "content": "Hello {{ undefined_variable }}",
            "arguments": [],
        },
    )
    assert response.status_code == 400
    assert "undefined variable" in response.json()["detail"].lower()


async def test__create_prompt__invalid_jinja_syntax_rejected(client: AsyncClient) -> None:
    """Test that invalid Jinja2 syntax is rejected."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "bad-syntax",
            "content": "Hello {{ unclosed",
            "arguments": [],
        },
    )
    assert response.status_code == 400
    assert "syntax" in response.json()["detail"].lower()


async def test__create_prompt__valid_template_passes(client: AsyncClient) -> None:
    """Test that valid template with matching arguments passes."""
    response = await client.post(
        "/prompts/",
        json={
            "name": "valid-template",
            "content": "Hello {{ name }}! You are {{ age }} years old.",
            "arguments": [
                {"name": "name", "required": True},
                {"name": "age", "required": False},
            ],
        },
    )
    assert response.status_code == 201


# =============================================================================
# List Prompts Tests
# =============================================================================


async def test__list_prompts__empty(client: AsyncClient) -> None:
    """Test listing prompts when none exist."""
    response = await client.get("/prompts/")
    assert response.status_code == 200

    data = response.json()
    assert data["items"] == []
    assert data["total"] == 0


async def test__list_prompts__returns_all(client: AsyncClient) -> None:
    """Test listing returns all prompts for user."""
    # Create some prompts
    await client.post("/prompts/", json={"name": "prompt-one"})
    await client.post("/prompts/", json={"name": "prompt-two"})
    await client.post("/prompts/", json={"name": "prompt-three"})

    response = await client.get("/prompts/")
    assert response.status_code == 200

    data = response.json()
    assert len(data["items"]) == 3
    assert data["total"] == 3


async def test__list_prompts__ordered_by_updated_at_desc(client: AsyncClient) -> None:
    """Test that prompts are ordered by updated_at descending."""
    # Create prompts in order
    await client.post("/prompts/", json={"name": "first-created"})
    await client.post("/prompts/", json={"name": "second-created"})

    # Update the first one
    await client.patch("/prompts/first-created", json={"title": "Updated"})

    response = await client.get("/prompts/")
    data = response.json()

    # First prompt should now be first (most recently updated)
    assert data["items"][0]["name"] == "first-created"
    assert data["items"][1]["name"] == "second-created"


async def test__list_prompts__pagination(client: AsyncClient) -> None:
    """Test pagination with offset and limit."""
    # Create 5 prompts
    for i in range(5):
        await client.post("/prompts/", json={"name": f"prompt-{i}"})

    # Get first page
    response = await client.get("/prompts/?limit=2&offset=0")
    data = response.json()
    assert len(data["items"]) == 2
    assert data["total"] == 5

    # Get second page
    response = await client.get("/prompts/?limit=2&offset=2")
    data = response.json()
    assert len(data["items"]) == 2
    assert data["total"] == 5


# =============================================================================
# Get Prompt Tests
# =============================================================================


async def test__get_prompt__success(client: AsyncClient) -> None:
    """Test getting a prompt by name."""
    # Create a prompt
    create_response = await client.post(
        "/prompts/",
        json={"name": "get-test", "title": "Get Test Prompt"},
    )
    assert create_response.status_code == 201

    # Get it back
    response = await client.get("/prompts/get-test")
    assert response.status_code == 200

    data = response.json()
    assert data["name"] == "get-test"
    assert data["title"] == "Get Test Prompt"


async def test__get_prompt__not_found(client: AsyncClient) -> None:
    """Test getting a non-existent prompt returns 404."""
    response = await client.get("/prompts/nonexistent")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


# =============================================================================
# Update Prompt Tests
# =============================================================================


async def test__update_prompt__success(client: AsyncClient) -> None:
    """Test updating a prompt."""
    # Create a prompt
    await client.post(
        "/prompts/",
        json={"name": "update-test", "description": "Original"},
    )

    # Update it
    response = await client.patch(
        "/prompts/update-test",
        json={"description": "Updated description", "title": "New Title"},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["name"] == "update-test"
    assert data["description"] == "Updated description"
    assert data["title"] == "New Title"


async def test__update_prompt__rename(client: AsyncClient) -> None:
    """Test renaming a prompt."""
    # Create a prompt
    await client.post("/prompts/", json={"name": "old-name"})

    # Rename it
    response = await client.patch(
        "/prompts/old-name",
        json={"name": "new-name"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "new-name"

    # Old name should not exist
    response = await client.get("/prompts/old-name")
    assert response.status_code == 404

    # New name should exist
    response = await client.get("/prompts/new-name")
    assert response.status_code == 200


async def test__update_prompt__rename_collision_rejected(client: AsyncClient) -> None:
    """Test renaming to an existing name is rejected."""
    # Create two prompts
    await client.post("/prompts/", json={"name": "prompt-a"})
    await client.post("/prompts/", json={"name": "prompt-b"})

    # Try to rename prompt-a to prompt-b
    response = await client.patch(
        "/prompts/prompt-a",
        json={"name": "prompt-b"},
    )
    assert response.status_code == 400
    assert "already exists" in response.json()["detail"]


async def test__update_prompt__not_found(client: AsyncClient) -> None:
    """Test updating non-existent prompt returns 404."""
    response = await client.patch(
        "/prompts/nonexistent",
        json={"title": "New Title"},
    )
    assert response.status_code == 404


async def test__update_prompt__template_validation(client: AsyncClient) -> None:
    """Test that template validation runs on update."""
    # Create a prompt with valid template
    await client.post(
        "/prompts/",
        json={
            "name": "template-update",
            "content": "Hello {{ name }}",
            "arguments": [{"name": "name", "required": True}],
        },
    )

    # Update with invalid template (undefined variable)
    response = await client.patch(
        "/prompts/template-update",
        json={"content": "Hello {{ undefined }}"},
    )
    assert response.status_code == 400
    assert "undefined variable" in response.json()["detail"].lower()


async def test__update_prompt__invalid_jinja_syntax_rejected(client: AsyncClient) -> None:
    """Test that invalid Jinja2 syntax on update is rejected."""
    # Create a prompt
    await client.post("/prompts/", json={"name": "syntax-test"})

    # Update with invalid syntax
    response = await client.patch(
        "/prompts/syntax-test",
        json={"content": "{{ unclosed"},
    )
    assert response.status_code == 400
    assert "syntax" in response.json()["detail"].lower()


# =============================================================================
# Delete Prompt Tests
# =============================================================================


async def test__delete_prompt__success(client: AsyncClient) -> None:
    """Test deleting a prompt."""
    # Create a prompt
    await client.post("/prompts/", json={"name": "delete-me"})

    # Delete it
    response = await client.delete("/prompts/delete-me")
    assert response.status_code == 204

    # Verify it's gone
    response = await client.get("/prompts/delete-me")
    assert response.status_code == 404


async def test__delete_prompt__not_found(client: AsyncClient) -> None:
    """Test deleting non-existent prompt returns 404."""
    response = await client.delete("/prompts/nonexistent")
    assert response.status_code == 404


# =============================================================================
# Null Value Edge Case Tests
# =============================================================================


async def test__update_prompt__null_name_ignored(client: AsyncClient) -> None:
    """Test that PATCH with name: null is treated as no change."""
    # Create a prompt
    await client.post("/prompts/", json={"name": "keep-my-name", "title": "Original"})

    # PATCH with null name - should NOT change the name
    response = await client.patch(
        "/prompts/keep-my-name",
        json={"name": None, "title": "Updated Title"},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["name"] == "keep-my-name"  # Name unchanged
    assert data["title"] == "Updated Title"  # Title updated


async def test__update_prompt__null_arguments_clears(client: AsyncClient) -> None:
    """Test that PATCH with arguments: null clears arguments to empty list."""
    # Create a prompt with arguments
    await client.post(
        "/prompts/",
        json={
            "name": "has-args",
            "content": "Hello {{ name }}!",
            "arguments": [{"name": "name", "required": True}],
        },
    )

    # Verify arguments exist
    response = await client.get("/prompts/has-args")
    assert len(response.json()["arguments"]) == 1

    # PATCH with null arguments - should clear to empty list
    # Also need to update content since template validation would fail
    response = await client.patch(
        "/prompts/has-args",
        json={"arguments": None, "content": "No variables here"},
    )
    assert response.status_code == 200

    data = response.json()
    assert data["arguments"] == []
    assert data["content"] == "No variables here"


async def test__update_prompt__null_arguments_fails_template_validation(
    client: AsyncClient,
) -> None:
    """Test that clearing arguments fails if template still uses variables."""
    # Create a prompt with arguments
    await client.post(
        "/prompts/",
        json={
            "name": "template-with-vars",
            "content": "Hello {{ name }}!",
            "arguments": [{"name": "name", "required": True}],
        },
    )

    # PATCH with null arguments but keep template - should fail validation
    response = await client.patch(
        "/prompts/template-with-vars",
        json={"arguments": None},  # Template still uses {{ name }}
    )
    assert response.status_code == 400
    assert "undefined variable" in response.json()["detail"].lower()


