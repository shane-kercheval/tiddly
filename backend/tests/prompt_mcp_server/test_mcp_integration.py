"""
Integration tests for Prompt MCP server with real API and database.

These tests verify the MCP handlers work correctly against the actual REST API
with a real PostgreSQL database (via testcontainers).
"""

from collections.abc import AsyncGenerator
from typing import Any

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from prompt_mcp_server import server as server_module
from prompt_mcp_server.auth import clear_current_token, set_current_token
from prompt_mcp_server.server import (
    handle_call_tool,
    handle_get_prompt,
    handle_list_prompts,
)

from .conftest import make_list_prompts_request


@pytest_asyncio.fixture
async def mcp_integration_client(
    db_session: AsyncSession,
    redis_client: Any,
) -> AsyncGenerator[AsyncClient]:
    """
    Create an HTTP client for MCP integration tests.

    This client uses ASGITransport to make requests directly to the FastAPI app
    without network overhead. The MCP server's HTTP client is configured to use
    this transport.
    """
    from api.main import app
    from core.auth_cache import AuthCache, set_auth_cache
    from core.redis import set_redis_client
    from db.session import get_async_session

    # Override the session dependency
    async def override_get_async_session() -> AsyncGenerator[AsyncSession]:
        yield db_session

    app.dependency_overrides[get_async_session] = override_get_async_session

    # Set up Redis client for rate limiting (already connected via fixture)
    set_redis_client(redis_client)
    auth_cache = AuthCache(redis_client)
    set_auth_cache(auth_cache)

    # Create client with ASGITransport
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        # Override the MCP server's HTTP client to use this transport
        server_module._http_client = client
        yield client

    # Clean up
    app.dependency_overrides.clear()
    server_module._http_client = None
    set_auth_cache(None)
    set_redis_client(None)


@pytest_asyncio.fixture
async def test_prompt(mcp_integration_client: AsyncClient) -> dict[str, Any]:
    """Create a test prompt in the database."""
    response = await mcp_integration_client.post(
        "/prompts/",
        json={
            "name": "test-greeting",
            "title": "Test Greeting",
            "description": "A test greeting prompt",
            "content": "Hello, {{ name }}! Welcome to {{ place }}.",
            "arguments": [
                {"name": "name", "description": "User's name", "required": True},
                {"name": "place", "description": "Location", "required": False},
            ],
            "tags": ["test", "greeting"],
        },
    )
    assert response.status_code == 201
    return response.json()


@pytest.fixture(autouse=True)
def setup_auth_token() -> None:
    """Set up authentication token for MCP handlers."""
    # In dev mode, any token works (VITE_DEV_MODE=true set in conftest)
    set_current_token("test-integration-token")
    yield
    clear_current_token()


# --- Integration Tests ---


@pytest.mark.asyncio
async def test__list_prompts__returns_real_prompts(
    mcp_integration_client: AsyncClient,  # noqa: ARG001 - triggers fixture
    test_prompt: dict[str, Any],
) -> None:
    """Test list_prompts returns prompts from the real database."""
    result = await handle_list_prompts(make_list_prompts_request())

    assert len(result.prompts) >= 1
    prompt_names = [p.name for p in result.prompts]
    assert test_prompt["name"] in prompt_names


@pytest.mark.asyncio
async def test__list_prompts__includes_arguments_from_db(
    mcp_integration_client: AsyncClient,  # noqa: ARG001 - triggers fixture
    test_prompt: dict[str, Any],  # noqa: ARG001 - creates test data
) -> None:
    """Test list_prompts includes prompt arguments from database."""
    result = await handle_list_prompts(make_list_prompts_request())

    # Find our test prompt
    test_prompt_result = next(
        (p for p in result.prompts if p.name == "test-greeting"),
        None,
    )
    assert test_prompt_result is not None
    assert test_prompt_result.arguments is not None
    assert len(test_prompt_result.arguments) == 2

    arg_names = [a.name for a in test_prompt_result.arguments]
    assert "name" in arg_names
    assert "place" in arg_names


@pytest.mark.asyncio
async def test__get_prompt__renders_template_from_db(
    mcp_integration_client: AsyncClient,  # noqa: ARG001 - triggers fixture
    test_prompt: dict[str, Any],  # noqa: ARG001 - creates test data
) -> None:
    """Test get_prompt fetches and renders template from database."""
    result = await handle_get_prompt(
        "test-greeting",
        {"name": "Alice", "place": "Wonderland"},
    )

    assert result.messages is not None
    assert len(result.messages) == 1
    assert result.messages[0].role == "user"
    assert "Hello, Alice!" in result.messages[0].content.text
    assert "Welcome to Wonderland" in result.messages[0].content.text


@pytest.mark.asyncio
async def test__get_prompt__optional_argument_works(
    mcp_integration_client: AsyncClient,  # noqa: ARG001 - triggers fixture
    test_prompt: dict[str, Any],  # noqa: ARG001 - creates test data
) -> None:
    """Test get_prompt with optional argument omitted."""
    result = await handle_get_prompt(
        "test-greeting",
        {"name": "Bob"},  # 'place' is optional
    )

    assert "Hello, Bob!" in result.messages[0].content.text


@pytest.mark.asyncio
async def test__create_prompt_tool__creates_in_db(
    mcp_integration_client: AsyncClient,
) -> None:
    """Test create_prompt tool creates prompt in real database."""
    result = await handle_call_tool(
        "create_prompt",
        {
            "name": "integration-test-prompt",
            "title": "Integration Test",
            "content": "Test content: {{ value }}",
            "arguments": [{"name": "value", "required": True}],
        },
    )

    assert len(result) == 1
    assert "integration-test-prompt" in result[0].text

    # Verify it exists in database via API
    response = await mcp_integration_client.get("/prompts/name/integration-test-prompt")
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "integration-test-prompt"
    assert data["title"] == "Integration Test"


@pytest.mark.asyncio
async def test__create_prompt_tool__duplicate_name_error(
    mcp_integration_client: AsyncClient,  # noqa: ARG001 - triggers fixture
    test_prompt: dict[str, Any],
) -> None:
    """Test create_prompt fails for duplicate name."""
    from mcp.shared.exceptions import McpError

    with pytest.raises(McpError) as exc_info:
        await handle_call_tool(
            "create_prompt",
            {"name": test_prompt["name"], "content": "Some content"},  # Name already exists
        )

    assert "already exists" in str(exc_info.value)


@pytest.mark.asyncio
async def test__get_prompt__not_found_error(
    mcp_integration_client: AsyncClient,  # noqa: ARG001 - triggers fixture
) -> None:
    """Test get_prompt returns error for non-existent prompt."""
    from mcp.shared.exceptions import McpError

    with pytest.raises(McpError) as exc_info:
        await handle_get_prompt("nonexistent-prompt-xyz", None)

    assert "not found" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test__list_prompts__pagination_with_real_data(
    mcp_integration_client: AsyncClient,
) -> None:
    """Test pagination works with multiple prompts in database."""
    # Create a few prompts
    for i in range(3):
        response = await mcp_integration_client.post(
            "/prompts/",
            json={"name": f"pagination-test-{i}", "content": f"Prompt {i}"},
        )
        assert response.status_code == 201

    # List prompts - should get all of them
    result = await handle_list_prompts(make_list_prompts_request())

    prompt_names = [p.name for p in result.prompts]
    for i in range(3):
        assert f"pagination-test-{i}" in prompt_names


@pytest.mark.asyncio
async def test__get_prompt__tracks_usage_in_db(
    mcp_integration_client: AsyncClient,
    test_prompt: dict[str, Any],
) -> None:
    """Test that get_prompt tracks usage (updates last_used_at)."""
    import asyncio

    # Get the prompt
    await handle_get_prompt("test-greeting", {"name": "Test"})

    # Wait for fire-and-forget task to complete
    await asyncio.sleep(0.2)

    # Check that last_used_at was updated
    response = await mcp_integration_client.get(
        f"/prompts/{test_prompt['id']}",
    )
    assert response.status_code == 200
    data = response.json()

    # last_used_at should be set (it was null initially or updated)
    assert data.get("last_used_at") is not None
