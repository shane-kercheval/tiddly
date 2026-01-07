"""
Tests for MCP server handlers.

Note: mock_auth fixture is used for its side effect (patching get_bearer_token).
Tests that use mock_auth but don't reference it directly have ARG001 noqa comments.
"""

from typing import Any

import httpx
import pytest
from httpx import Response

from prompt_mcp_server.server import (
    handle_call_tool,
    handle_get_prompt,
    handle_list_prompts,
    handle_list_tools,
    server,
)

from .conftest import make_list_prompts_request


# --- Server configuration tests ---


def test__server__has_instructions() -> None:
    """Test that server has instructions configured."""
    assert server.instructions is not None
    assert len(server.instructions) > 0
    # Verify key content is present
    assert "prompt template manager" in server.instructions.lower()
    assert "list_prompts" in server.instructions
    assert "get_prompt" in server.instructions
    assert "create_prompt" in server.instructions
    assert "Jinja2" in server.instructions


# --- list_prompts tests ---


@pytest.mark.asyncio
async def test__list_prompts__returns_prompt_list(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    sample_prompt_list: dict[str, Any],
) -> None:
    """Test list_prompts returns MCP ListPromptsResult with prompts."""
    mock_api.get("/prompts/").mock(
        return_value=Response(200, json=sample_prompt_list),
    )

    result = await handle_list_prompts(make_list_prompts_request())

    assert len(result.prompts) == 1
    assert result.prompts[0].name == "code-review"
    assert result.prompts[0].title == "Code Review Assistant"
    assert result.prompts[0].description == "Reviews code and provides feedback"
    assert result.nextCursor is None  # No more pages


@pytest.mark.asyncio
async def test__list_prompts__empty_list_when_no_prompts(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    sample_prompt_list_empty: dict[str, Any],
) -> None:
    """Test list_prompts returns empty list when no prompts."""
    mock_api.get("/prompts/").mock(
        return_value=Response(200, json=sample_prompt_list_empty),
    )

    result = await handle_list_prompts(make_list_prompts_request())

    assert len(result.prompts) == 0
    assert result.nextCursor is None


@pytest.mark.asyncio
async def test__list_prompts__includes_arguments(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    sample_prompt_list: dict[str, Any],
) -> None:
    """Test list_prompts includes prompt arguments."""
    mock_api.get("/prompts/").mock(
        return_value=Response(200, json=sample_prompt_list),
    )

    result = await handle_list_prompts(make_list_prompts_request())

    assert result.prompts[0].arguments is not None
    assert len(result.prompts[0].arguments) == 2
    assert result.prompts[0].arguments[0].name == "language"
    assert result.prompts[0].arguments[0].required is True
    assert result.prompts[0].arguments[1].name == "code"


@pytest.mark.asyncio
async def test__list_prompts__uses_limit_100_and_offset_0(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    sample_prompt_list: dict[str, Any],
) -> None:
    """Test list_prompts uses limit=100 and offset=0 by default."""
    mock_api.get("/prompts/").mock(
        return_value=Response(200, json=sample_prompt_list),
    )

    await handle_list_prompts(make_list_prompts_request())

    url = str(mock_api.calls[0].request.url)
    assert "limit=100" in url
    assert "offset=0" in url


@pytest.mark.asyncio
async def test__list_prompts__returns_next_cursor_when_has_more(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
) -> None:
    """Test list_prompts returns nextCursor when has_more=True."""
    response_with_more = {
        "items": [{"name": "prompt-1", "arguments": []}],
        "total": 150,
        "offset": 0,
        "limit": 100,
        "has_more": True,
    }
    mock_api.get("/prompts/").mock(
        return_value=Response(200, json=response_with_more),
    )

    result = await handle_list_prompts(make_list_prompts_request())

    assert result.nextCursor == "100"  # Next page starts at offset 100


@pytest.mark.asyncio
async def test__list_prompts__uses_cursor_as_offset(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
) -> None:
    """Test list_prompts uses cursor value as offset parameter."""
    response = {
        "items": [{"name": "prompt-101", "arguments": []}],
        "total": 150,
        "offset": 100,
        "limit": 100,
        "has_more": False,
    }
    mock_api.get("/prompts/").mock(
        return_value=Response(200, json=response),
    )

    result = await handle_list_prompts(make_list_prompts_request(cursor="100"))

    # Verify offset=100 was passed to API
    url = str(mock_api.calls[0].request.url)
    assert "offset=100" in url
    # No more pages
    assert result.nextCursor is None


@pytest.mark.asyncio
async def test__list_prompts__invalid_cursor_returns_error(
    mock_api,  # noqa: ARG001 - needed for fixture
    mock_auth,  # noqa: ARG001 - needed for side effect
) -> None:
    """Test list_prompts returns error for invalid cursor."""
    from mcp.shared.exceptions import McpError

    with pytest.raises(McpError) as exc_info:
        await handle_list_prompts(make_list_prompts_request(cursor="not-a-number"))

    assert "Invalid cursor" in str(exc_info.value)


@pytest.mark.asyncio
async def test__list_prompts__api_unavailable(mock_api, mock_auth) -> None:  # noqa: ARG001
    """Test list_prompts handles network errors."""
    from mcp.shared.exceptions import McpError

    mock_api.get("/prompts/").mock(side_effect=httpx.ConnectError("Connection refused"))

    with pytest.raises(McpError) as exc_info:
        await handle_list_prompts(make_list_prompts_request())

    assert "unavailable" in str(exc_info.value).lower()


# --- get_prompt tests ---


@pytest.mark.asyncio
async def test__get_prompt__renders_template_with_arguments(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    sample_prompt: dict[str, Any],
) -> None:
    """Test get_prompt renders template with provided arguments."""
    mock_api.get("/prompts/name/code-review").mock(
        return_value=Response(200, json=sample_prompt),
    )
    mock_api.post(f"/prompts/{sample_prompt['id']}/track-usage").mock(
        return_value=Response(204, json={}),
    )

    result = await handle_get_prompt(
        "code-review",
        {"language": "Python", "code": "def hello(): pass"},
    )

    assert result.messages is not None
    assert len(result.messages) == 1
    assert result.messages[0].role == "user"
    assert "Python" in result.messages[0].content.text
    assert "def hello(): pass" in result.messages[0].content.text


@pytest.mark.asyncio
async def test__get_prompt__renders_template_no_arguments(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    sample_prompt_no_args: dict[str, Any],
) -> None:
    """Test get_prompt with prompt that has no arguments."""
    mock_api.get("/prompts/name/greeting").mock(
        return_value=Response(200, json=sample_prompt_no_args),
    )
    mock_api.post(f"/prompts/{sample_prompt_no_args['id']}/track-usage").mock(
        return_value=Response(204, json={}),
    )

    result = await handle_get_prompt("greeting", None)

    assert "Hello! How can I help you today?" in result.messages[0].content.text


@pytest.mark.asyncio
async def test__get_prompt__missing_required_argument_error(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    sample_prompt: dict[str, Any],
) -> None:
    """Test get_prompt raises error when required argument is missing."""
    from mcp.shared.exceptions import McpError

    mock_api.get("/prompts/name/code-review").mock(
        return_value=Response(200, json=sample_prompt),
    )

    with pytest.raises(McpError) as exc_info:
        await handle_get_prompt("code-review", {"language": "Python"})  # Missing 'code'

    assert "Missing required" in str(exc_info.value)


@pytest.mark.asyncio
async def test__get_prompt__extra_unknown_argument_error(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    sample_prompt: dict[str, Any],
) -> None:
    """Test get_prompt raises error for unknown arguments."""
    from mcp.shared.exceptions import McpError

    mock_api.get("/prompts/name/code-review").mock(
        return_value=Response(200, json=sample_prompt),
    )

    with pytest.raises(McpError) as exc_info:
        await handle_get_prompt(
            "code-review",
            {"language": "Python", "code": "test", "unknown": "value"},
        )

    assert "Unknown argument" in str(exc_info.value)


@pytest.mark.asyncio
async def test__get_prompt__prompt_not_found_error(mock_api, mock_auth) -> None:  # noqa: ARG001
    """Test get_prompt raises error when prompt not found."""
    from mcp.shared.exceptions import McpError

    mock_api.get("/prompts/name/nonexistent").mock(
        return_value=Response(404, json={"detail": "Not found"}),
    )

    with pytest.raises(McpError) as exc_info:
        await handle_get_prompt("nonexistent", None)

    assert "not found" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test__get_prompt__optional_argument_uses_default(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    sample_prompt_optional_args: dict[str, Any],
) -> None:
    """Test get_prompt with optional argument omitted."""
    mock_api.get("/prompts/name/summarize").mock(
        return_value=Response(200, json=sample_prompt_optional_args),
    )
    mock_api.post(f"/prompts/{sample_prompt_optional_args['id']}/track-usage").mock(
        return_value=Response(204, json={}),
    )

    # Only provide required argument
    result = await handle_get_prompt("summarize", {"text": "Hello world"})

    # Template should handle missing optional arg
    assert "Hello world" in result.messages[0].content.text


@pytest.mark.asyncio
async def test__get_prompt__tracks_usage(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    sample_prompt_no_args: dict[str, Any],
) -> None:
    """Test get_prompt calls track-usage endpoint."""
    mock_api.get("/prompts/name/greeting").mock(
        return_value=Response(200, json=sample_prompt_no_args),
    )
    track_mock = mock_api.post(f"/prompts/{sample_prompt_no_args['id']}/track-usage").mock(
        return_value=Response(204, json={}),
    )

    await handle_get_prompt("greeting", None)

    # Give async task time to run
    import asyncio
    await asyncio.sleep(0.1)

    assert track_mock.called


@pytest.mark.asyncio
async def test__get_prompt__returns_user_role_message(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    sample_prompt_no_args: dict[str, Any],
) -> None:
    """Test get_prompt returns message with user role."""
    mock_api.get("/prompts/name/greeting").mock(
        return_value=Response(200, json=sample_prompt_no_args),
    )
    mock_api.post(f"/prompts/{sample_prompt_no_args['id']}/track-usage").mock(
        return_value=Response(204, json={}),
    )

    result = await handle_get_prompt("greeting", None)

    assert result.messages[0].role == "user"


# --- list_tools tests ---


@pytest.mark.asyncio
async def test__list_tools__returns_create_prompt() -> None:
    """Test list_tools returns create_prompt tool."""
    result = await handle_list_tools()

    assert len(result) == 1
    assert result[0].name == "create_prompt"
    assert "Create a new prompt" in result[0].description


@pytest.mark.asyncio
async def test__list_tools__create_prompt_has_schema() -> None:
    """Test create_prompt tool has proper input schema."""
    result = await handle_list_tools()

    schema = result[0].inputSchema
    assert schema["type"] == "object"
    assert "name" in schema["properties"]
    assert "title" in schema["properties"]
    assert "content" in schema["properties"]
    assert "arguments" in schema["properties"]
    assert "tags" in schema["properties"]
    # Both name and content are required
    assert set(schema["required"]) == {"name", "content"}


# --- call_tool (create_prompt) tests ---


@pytest.mark.asyncio
async def test__create_prompt_tool__creates_prompt(mock_api, mock_auth) -> None:  # noqa: ARG001
    """Test create_prompt tool creates a prompt."""
    created_prompt = {
        "id": "550e8400-e29b-41d4-a716-446655440010",
        "name": "new-prompt",
        "title": None,
        "description": None,
        "content": None,
        "arguments": [],
        "tags": [],
    }
    mock_api.post("/prompts/").mock(
        return_value=Response(201, json=created_prompt),
    )

    result = await handle_call_tool("create_prompt", {"name": "new-prompt"})

    assert len(result) == 1
    assert "new-prompt" in result[0].text
    assert "ID: 550e8400-e29b-41d4-a716-446655440010" in result[0].text


@pytest.mark.asyncio
async def test__create_prompt_tool__creates_with_arguments(mock_api, mock_auth) -> None:  # noqa: ARG001
    """Test create_prompt tool with arguments."""
    created_prompt = {
        "id": "550e8400-e29b-41d4-a716-446655440011",
        "name": "with-args",
        "title": "Prompt With Args",
        "description": "A test prompt",
        "content": "Hello {{ name }}",
        "arguments": [{"name": "name", "required": True}],
        "tags": [],
    }
    mock_api.post("/prompts/").mock(
        return_value=Response(201, json=created_prompt),
    )

    result = await handle_call_tool(
        "create_prompt",
        {
            "name": "with-args",
            "title": "Prompt With Args",
            "description": "A test prompt",
            "content": "Hello {{ name }}",
            "arguments": [{"name": "name", "required": True}],
        },
    )

    assert "with-args" in result[0].text

    # Verify payload was sent correctly
    request_body = mock_api.calls[0].request.content
    import json
    payload = json.loads(request_body)
    assert payload["name"] == "with-args"
    assert payload["content"] == "Hello {{ name }}"


@pytest.mark.asyncio
async def test__create_prompt_tool__creates_with_tags(mock_api, mock_auth) -> None:  # noqa: ARG001
    """Test create_prompt tool with tags."""
    created_prompt = {
        "id": "550e8400-e29b-41d4-a716-446655440012",
        "name": "tagged",
        "title": None,
        "description": None,
        "content": None,
        "arguments": [],
        "tags": ["test", "example"],
    }
    mock_api.post("/prompts/").mock(
        return_value=Response(201, json=created_prompt),
    )

    await handle_call_tool(
        "create_prompt",
        {"name": "tagged", "tags": ["test", "example"]},
    )

    import json
    payload = json.loads(mock_api.calls[0].request.content)
    assert payload["tags"] == ["test", "example"]


@pytest.mark.asyncio
async def test__create_prompt_tool__validation_error_invalid_name(
    mock_api, mock_auth,  # noqa: ARG001 - needed for side effect
) -> None:
    """Test create_prompt tool with invalid name format."""
    from mcp.shared.exceptions import McpError

    mock_api.post("/prompts/").mock(
        return_value=Response(
            400,
            json={"detail": "Invalid prompt name format"},
        ),
    )

    with pytest.raises(McpError) as exc_info:
        await handle_call_tool("create_prompt", {"name": "Invalid Name!"})

    assert "Invalid prompt name" in str(exc_info.value)


@pytest.mark.asyncio
async def test__create_prompt_tool__validation_error_duplicate_name(
    mock_api, mock_auth,  # noqa: ARG001 - needed for side effect
) -> None:
    """Test create_prompt tool with duplicate name."""
    from mcp.shared.exceptions import McpError

    mock_api.post("/prompts/").mock(
        return_value=Response(
            409,
            json={
                "detail": {
                    "message": "A prompt with name 'existing' already exists",
                    "error_code": "NAME_CONFLICT",
                },
            },
        ),
    )

    with pytest.raises(McpError) as exc_info:
        await handle_call_tool("create_prompt", {"name": "existing"})

    assert "already exists" in str(exc_info.value)


@pytest.mark.asyncio
async def test__create_prompt_tool__validation_error_template_syntax(
    mock_api, mock_auth,  # noqa: ARG001 - needed for side effect
) -> None:
    """Test create_prompt tool with invalid template syntax."""
    from mcp.shared.exceptions import McpError

    mock_api.post("/prompts/").mock(
        return_value=Response(
            400,
            json={"detail": "Invalid Jinja2 syntax: unexpected '}'"},
        ),
    )

    with pytest.raises(McpError) as exc_info:
        await handle_call_tool(
            "create_prompt",
            {"name": "bad-template", "content": "{{ unclosed"},
        )

    assert "Jinja2" in str(exc_info.value) or "syntax" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test__create_prompt_tool__unknown_tool_error() -> None:
    """Test error when calling unknown tool."""
    from mcp.shared.exceptions import McpError

    with pytest.raises(McpError) as exc_info:
        await handle_call_tool("unknown_tool", {})

    assert "Unknown tool" in str(exc_info.value)


# --- Authentication error tests ---


@pytest.mark.asyncio
async def test__list_prompts__no_token_error(mock_api) -> None:  # noqa: ARG001
    """Test list_prompts without token raises error."""
    from mcp.shared.exceptions import McpError
    from prompt_mcp_server.auth import clear_current_token

    clear_current_token()  # Ensure no token

    with pytest.raises(McpError) as exc_info:
        await handle_list_prompts(make_list_prompts_request())

    assert "token" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test__list_prompts__invalid_token_error(mock_api, mock_auth) -> None:  # noqa: ARG001
    """Test list_prompts with invalid token."""
    from mcp.shared.exceptions import McpError

    mock_api.get("/prompts/").mock(
        return_value=Response(401, json={"detail": "Invalid token"}),
    )

    with pytest.raises(McpError) as exc_info:
        await handle_list_prompts(make_list_prompts_request())

    assert "Invalid" in str(exc_info.value) or "expired" in str(exc_info.value).lower()


# --- 400/422 error handling tests ---


@pytest.mark.asyncio
async def test__create_prompt_tool__422_fastapi_validation_errors(
    mock_api, mock_auth,  # noqa: ARG001 - needed for side effect
) -> None:
    """Test 422 validation errors (FastAPI format) are handled as INVALID_PARAMS."""
    from mcp.shared.exceptions import McpError

    # FastAPI validation errors return a list of error objects
    mock_api.post("/prompts/").mock(
        return_value=Response(
            422,
            json={
                "detail": [
                    {"loc": ["body", "name"], "msg": "field required"},
                    {"loc": ["body", "content"], "msg": "string too long"},
                ],
            },
        ),
    )

    with pytest.raises(McpError) as exc_info:
        await handle_call_tool("create_prompt", {"name": ""})

    # Error message should include field info
    assert "name: field required" in str(exc_info.value)
    assert "content: string too long" in str(exc_info.value)


@pytest.mark.asyncio
async def test__create_prompt_tool__400_dict_detail_format(
    mock_api, mock_auth,  # noqa: ARG001 - needed for side effect
) -> None:
    """Test 400 errors with dict detail format are handled correctly."""
    from mcp.shared.exceptions import McpError

    mock_api.post("/prompts/").mock(
        return_value=Response(
            400,
            json={
                "detail": {
                    "message": "Template contains undefined variables",
                    "error_code": "TEMPLATE_ERROR",
                },
            },
        ),
    )

    with pytest.raises(McpError) as exc_info:
        await handle_call_tool("create_prompt", {"name": "test", "content": "{{ bad }}"})

    assert "Template contains undefined variables" in str(exc_info.value)


@pytest.mark.asyncio
async def test__create_prompt_tool__400_string_detail_format(
    mock_api, mock_auth,  # noqa: ARG001 - needed for side effect
) -> None:
    """Test 400 errors with simple string detail are handled correctly."""
    from mcp.shared.exceptions import McpError

    mock_api.post("/prompts/").mock(
        return_value=Response(
            400,
            json={"detail": "Invalid prompt name format"},
        ),
    )

    with pytest.raises(McpError) as exc_info:
        await handle_call_tool("create_prompt", {"name": "Invalid Name!"})

    assert "Invalid prompt name format" in str(exc_info.value)


# --- Cleanup tests ---


@pytest.mark.asyncio
async def test__cleanup__closes_http_client() -> None:
    """Test cleanup properly closes HTTP client."""
    from prompt_mcp_server import server as server_module
    from prompt_mcp_server.server import cleanup, init_http_client, get_http_client

    # Initialize HTTP client
    await init_http_client()
    client = get_http_client()
    assert client is not None
    assert not client.is_closed

    # Run cleanup
    await cleanup()

    # Client should be closed and cleared
    assert client.is_closed
    assert server_module._http_client is None


@pytest.mark.asyncio
async def test__cleanup__cancels_background_tasks() -> None:
    """Test cleanup cancels pending background tasks."""
    import asyncio
    import contextlib

    from prompt_mcp_server import server as server_module
    from prompt_mcp_server.server import cleanup

    # Create a long-running task
    async def long_running() -> None:
        await asyncio.sleep(100)

    task = asyncio.create_task(long_running())
    server_module._background_tasks.add(task)

    # Run cleanup
    await cleanup()

    # Wait for cancellation to propagate
    with contextlib.suppress(asyncio.CancelledError):
        await task

    # Task should be cancelled and set should be empty
    assert task.cancelled()
    assert len(server_module._background_tasks) == 0


@pytest.mark.asyncio
async def test__cleanup__handles_no_resources() -> None:
    """Test cleanup handles case when no resources exist."""
    from prompt_mcp_server import server as server_module
    from prompt_mcp_server.server import cleanup

    # Ensure no resources
    server_module._http_client = None
    server_module._background_tasks.clear()

    # Should not raise
    await cleanup()

    assert server_module._http_client is None
    assert len(server_module._background_tasks) == 0
