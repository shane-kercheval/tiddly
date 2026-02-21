"""
Tests for the Prompt MCP server through the MCP protocol.

Tests go through the actual MCP protocol using fastmcp.Client connected
to the server in-memory via FastMCPTransport. API responses are mocked
with respx, so these verify protocol behavior without a real database.

Note: mock_auth fixture is used for its side effect (patching get_bearer_token).
Tests that use mock_auth but don't reference it directly have ARG001 noqa comments.
"""

import asyncio
import contextlib
import json
from typing import Any

import httpx
import pytest
from fastmcp import Client
from httpx import Response
from mcp.shared.exceptions import McpError

from prompt_mcp_server import server as server_module
from prompt_mcp_server.auth import clear_current_token
from prompt_mcp_server.server import (
    _format_prompt_context_markdown,
    cleanup,
    get_http_client,
    init_http_client,
    server,
)


# --- Server configuration tests ---


def test__server__has_instructions() -> None:
    """Test that server has instructions configured."""
    assert server.instructions is not None
    assert len(server.instructions) > 0
    # Verify key content is present
    assert "prompt template manager" in server.instructions.lower()
    assert "get_prompt_content" in server.instructions
    assert "create_prompt" in server.instructions
    assert "edit_prompt_content" in server.instructions
    assert "update_prompt" in server.instructions
    assert "Jinja2" in server.instructions


# --- list_prompts tests ---


@pytest.mark.asyncio
async def test__list_prompts__returns_prompt_list(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
    sample_prompt_list: dict[str, Any],
) -> None:
    """Test list_prompts returns MCP ListPromptsResult with prompts."""
    mock_api.get("/prompts/").mock(
        return_value=Response(200, json=sample_prompt_list),
    )

    result = await mcp_client.session.list_prompts()

    assert len(result.prompts) == 1
    assert result.prompts[0].name == "code-review"
    assert result.prompts[0].title == "Code Review Assistant"
    assert result.prompts[0].description == "Reviews code and provides feedback"
    assert result.nextCursor is None  # No more pages


@pytest.mark.asyncio
async def test__list_prompts__empty_list_when_no_prompts(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
    sample_prompt_list_empty: dict[str, Any],
) -> None:
    """Test list_prompts returns empty list when no prompts."""
    mock_api.get("/prompts/").mock(
        return_value=Response(200, json=sample_prompt_list_empty),
    )

    result = await mcp_client.session.list_prompts()

    assert len(result.prompts) == 0
    assert result.nextCursor is None


@pytest.mark.asyncio
async def test__list_prompts__includes_arguments(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
    sample_prompt_list: dict[str, Any],
) -> None:
    """Test list_prompts includes prompt arguments."""
    mock_api.get("/prompts/").mock(
        return_value=Response(200, json=sample_prompt_list),
    )

    result = await mcp_client.session.list_prompts()

    assert result.prompts[0].arguments is not None
    assert len(result.prompts[0].arguments) == 2
    assert result.prompts[0].arguments[0].name == "language"
    assert result.prompts[0].arguments[0].required is True
    assert result.prompts[0].arguments[1].name == "code"


@pytest.mark.asyncio
async def test__list_prompts__uses_limit_100_and_offset_0(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
    sample_prompt_list: dict[str, Any],
) -> None:
    """Test list_prompts uses limit=100 and offset=0 by default."""
    mock_api.get("/prompts/").mock(
        return_value=Response(200, json=sample_prompt_list),
    )

    await mcp_client.session.list_prompts()

    url = str(mock_api.calls[0].request.url)
    assert "limit=100" in url
    assert "offset=0" in url


@pytest.mark.asyncio
async def test__list_prompts__returns_next_cursor_when_has_more(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
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

    result = await mcp_client.session.list_prompts()

    assert result.nextCursor == "100"  # Next page starts at offset 100


@pytest.mark.asyncio
async def test__list_prompts__uses_cursor_as_offset(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
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

    result = await mcp_client.session.list_prompts(cursor="100")

    # Verify offset=100 was passed to API
    url = str(mock_api.calls[0].request.url)
    assert "offset=100" in url
    # No more pages
    assert result.nextCursor is None


@pytest.mark.asyncio
async def test__list_prompts__invalid_cursor_returns_error(
    mock_api,  # noqa: ARG001 - needed for fixture
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test list_prompts returns error for invalid cursor."""
    with pytest.raises(McpError) as exc_info:
        await mcp_client.session.list_prompts(cursor="not-a-number")

    assert "Invalid cursor" in str(exc_info.value)


@pytest.mark.asyncio
async def test__list_prompts__api_unavailable(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test list_prompts handles network errors."""
    mock_api.get("/prompts/").mock(side_effect=httpx.ConnectError("Connection refused"))

    with pytest.raises(McpError) as exc_info:
        await mcp_client.session.list_prompts()

    assert "unavailable" in str(exc_info.value).lower()


# --- get_prompt tests ---


@pytest.mark.asyncio
async def test__get_prompt__renders_template_with_arguments(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
    sample_prompt: dict[str, Any],
) -> None:
    """Test get_prompt renders template with provided arguments."""
    mock_api.get("/prompts/name/code-review").mock(
        return_value=Response(200, json=sample_prompt),
    )
    mock_api.post(f"/prompts/{sample_prompt['id']}/track-usage").mock(
        return_value=Response(204, json={}),
    )

    result = await mcp_client.get_prompt(
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
    mcp_client: Client,
    sample_prompt_no_args: dict[str, Any],
) -> None:
    """Test get_prompt with prompt that has no arguments."""
    mock_api.get("/prompts/name/greeting").mock(
        return_value=Response(200, json=sample_prompt_no_args),
    )
    mock_api.post(f"/prompts/{sample_prompt_no_args['id']}/track-usage").mock(
        return_value=Response(204, json={}),
    )

    result = await mcp_client.get_prompt("greeting", None)

    assert "Hello! How can I help you today?" in result.messages[0].content.text


@pytest.mark.asyncio
async def test__get_prompt__missing_required_argument_error(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
    sample_prompt: dict[str, Any],
) -> None:
    """Test get_prompt raises error when required argument is missing."""
    mock_api.get("/prompts/name/code-review").mock(
        return_value=Response(200, json=sample_prompt),
    )

    with pytest.raises(McpError) as exc_info:
        await mcp_client.get_prompt("code-review", {"language": "Python"})  # Missing 'code'

    assert "Missing required" in str(exc_info.value)


@pytest.mark.asyncio
async def test__get_prompt__extra_unknown_argument_error(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
    sample_prompt: dict[str, Any],
) -> None:
    """Test get_prompt raises error for unknown arguments."""
    mock_api.get("/prompts/name/code-review").mock(
        return_value=Response(200, json=sample_prompt),
    )

    with pytest.raises(McpError) as exc_info:
        await mcp_client.get_prompt(
            "code-review",
            {"language": "Python", "code": "test", "unknown": "value"},
        )

    assert "Unknown argument" in str(exc_info.value)


@pytest.mark.asyncio
async def test__get_prompt__prompt_not_found_error(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test get_prompt raises error when prompt not found."""
    mock_api.get("/prompts/name/nonexistent").mock(
        return_value=Response(404, json={"detail": "Not found"}),
    )

    with pytest.raises(McpError) as exc_info:
        await mcp_client.get_prompt("nonexistent", None)

    assert "not found" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test__get_prompt__optional_argument_uses_default(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
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
    result = await mcp_client.get_prompt("summarize", {"text": "Hello world"})

    # Template should handle missing optional arg
    assert "Hello world" in result.messages[0].content.text


@pytest.mark.asyncio
async def test__get_prompt__tracks_usage(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
    sample_prompt_no_args: dict[str, Any],
) -> None:
    """Test get_prompt calls track-usage endpoint."""
    mock_api.get("/prompts/name/greeting").mock(
        return_value=Response(200, json=sample_prompt_no_args),
    )
    track_mock = mock_api.post(f"/prompts/{sample_prompt_no_args['id']}/track-usage").mock(
        return_value=Response(204, json={}),
    )

    await mcp_client.get_prompt("greeting", None)

    # Give async task time to run
    await asyncio.sleep(0.1)

    assert track_mock.called


@pytest.mark.asyncio
async def test__get_prompt__returns_user_role_message(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
    sample_prompt_no_args: dict[str, Any],
) -> None:
    """Test get_prompt returns message with user role."""
    mock_api.get("/prompts/name/greeting").mock(
        return_value=Response(200, json=sample_prompt_no_args),
    )
    mock_api.post(f"/prompts/{sample_prompt_no_args['id']}/track-usage").mock(
        return_value=Response(204, json={}),
    )

    result = await mcp_client.get_prompt("greeting", None)

    assert result.messages[0].role == "user"


@pytest.mark.asyncio
async def test__get_prompt__api_unavailable(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test get_prompt handles network errors."""
    mock_api.get("/prompts/name/test-prompt").mock(
        side_effect=httpx.ConnectError("Connection refused"),
    )

    with pytest.raises(McpError) as exc_info:
        await mcp_client.get_prompt("test-prompt", None)

    assert "unavailable" in str(exc_info.value).lower()


# --- list_tools tests ---


@pytest.mark.asyncio
async def test__list_tools__returns_all_tools(mcp_client: Client) -> None:
    """Test list_tools returns all available tools."""
    tools = await mcp_client.list_tools()

    assert len(tools) == 9
    tool_names = {t.name for t in tools}
    assert tool_names == {
        "get_context",
        "search_prompts",
        "list_filters",
        "list_tags",
        "get_prompt_metadata",
        "get_prompt_content",
        "create_prompt",
        "edit_prompt_content",
        "update_prompt",
    }

    get_content = next(t for t in tools if t.name == "get_prompt_content")
    assert "template and arguments" in get_content.description
    assert "viewing or editing" in get_content.description

    create_prompt = next(t for t in tools if t.name == "create_prompt")
    assert "Create a new prompt" in create_prompt.description

    edit_prompt = next(t for t in tools if t.name == "edit_prompt_content")
    assert "Edit template content" in edit_prompt.description
    assert "old_str/new_str replacement" in edit_prompt.description

    update_prompt = next(t for t in tools if t.name == "update_prompt")
    assert "Update metadata" in update_prompt.description
    assert "metadata" in update_prompt.description or "content" in update_prompt.description


@pytest.mark.asyncio
async def test__list_tools__get_prompt_content_has_schema(mcp_client: Client) -> None:
    """Test get_prompt_content tool has proper input schema."""
    tools = await mcp_client.list_tools()

    get_template = next(t for t in tools if t.name == "get_prompt_content")
    schema = get_template.inputSchema
    assert schema["type"] == "object"
    assert "name" in schema["properties"]
    assert schema["required"] == ["name"]


@pytest.mark.asyncio
async def test__list_tools__create_prompt_has_schema(mcp_client: Client) -> None:
    """Test create_prompt tool has proper input schema."""
    tools = await mcp_client.list_tools()

    create_prompt = next(t for t in tools if t.name == "create_prompt")
    schema = create_prompt.inputSchema
    assert schema["type"] == "object"
    assert "name" in schema["properties"]
    assert "title" in schema["properties"]
    assert "content" in schema["properties"]
    assert "arguments" in schema["properties"]
    assert "tags" in schema["properties"]
    # Both name and content are required
    assert set(schema["required"]) == {"name", "content"}


# --- call_tool (get_prompt_content) tests ---


@pytest.mark.asyncio
async def test__get_prompt_content_tool__returns_raw_content(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
    sample_prompt: dict[str, Any],
) -> None:
    """Test get_prompt_content returns raw template content as JSON."""
    mock_api.get("/prompts/name/code-review").mock(
        return_value=Response(200, json=sample_prompt),
    )

    result = await mcp_client.call_tool("get_prompt_content", {"name": "code-review"})

    assert len(result.content) == 1
    # Response should be JSON-formatted
    response_data = json.loads(result.content[0].text)
    assert response_data["id"] == sample_prompt["id"]
    assert response_data["name"] == "code-review"
    assert response_data["title"] == "Code Review Assistant"
    assert response_data["description"] == "Reviews code and provides feedback"
    # Content should be raw template (not rendered)
    assert response_data["content"] == "Please review the following {{ language }} code:\n\n{{ code }}"
    assert len(response_data["arguments"]) == 2


@pytest.mark.asyncio
async def test__get_prompt_content_tool__includes_all_metadata(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
    sample_prompt: dict[str, Any],
) -> None:
    """Test get_prompt_content includes all metadata fields."""
    mock_api.get("/prompts/name/code-review").mock(
        return_value=Response(200, json=sample_prompt),
    )

    result = await mcp_client.call_tool("get_prompt_content", {"name": "code-review"})
    response_data = json.loads(result.content[0].text)

    # Verify all expected fields are present
    expected_fields = {"id", "name", "title", "description", "content", "arguments"}
    assert set(response_data.keys()) == expected_fields


@pytest.mark.asyncio
async def test__get_prompt_content_tool__not_found_error(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test get_prompt_content returns error for nonexistent prompt."""
    mock_api.get("/prompts/name/nonexistent").mock(
        return_value=Response(404, json={"detail": "Prompt not found"}),
    )

    result = await mcp_client.call_tool("get_prompt_content", {"name": "nonexistent"}, raise_on_error=False)

    assert result.is_error is True
    assert "not found" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__get_prompt_content_tool__missing_name_error(mcp_client: Client) -> None:
    """Test get_prompt_content returns error when name is missing."""
    result = await mcp_client.call_tool("get_prompt_content", {}, raise_on_error=False)

    assert result.is_error is True
    assert "name" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__get_prompt_content_tool__api_unavailable(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test get_prompt_content handles network errors."""
    mock_api.get("/prompts/name/test-prompt").mock(
        side_effect=httpx.ConnectError("Connection refused"),
    )

    result = await mcp_client.call_tool("get_prompt_content", {"name": "test-prompt"}, raise_on_error=False)

    assert result.is_error is True
    assert "unavailable" in result.content[0].text.lower()


# --- call_tool (create_prompt) tests ---


@pytest.mark.asyncio
async def test__create_prompt_tool__creates_prompt(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test create_prompt tool creates a prompt and returns structured response."""
    created_prompt = {
        "id": "550e8400-e29b-41d4-a716-446655440010",
        "name": "new-prompt",
        "title": None,
        "description": None,
        "content": None,
        "arguments": [],
        "tags": [],
        "updated_at": "2024-01-01T00:00:00Z",
    }
    mock_api.post("/prompts/").mock(
        return_value=Response(201, json=created_prompt),
    )

    result = await mcp_client.call_tool("create_prompt", {"name": "new-prompt", "content": "test content"})

    assert result.structured_content["id"] == "550e8400-e29b-41d4-a716-446655440010"
    assert result.structured_content["name"] == "new-prompt"
    assert result.structured_content["updated_at"] == "2024-01-01T00:00:00Z"
    assert "Created prompt 'new-prompt'" in result.structured_content["summary"]

    # Text content also has the response as JSON
    response_data = json.loads(result.content[0].text)
    assert response_data["id"] == "550e8400-e29b-41d4-a716-446655440010"


@pytest.mark.asyncio
async def test__create_prompt_tool__creates_with_arguments(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test create_prompt tool with arguments."""
    created_prompt = {
        "id": "550e8400-e29b-41d4-a716-446655440011",
        "name": "with-args",
        "title": "Prompt With Args",
        "description": "A test prompt",
        "content": "Hello {{ name }}",
        "arguments": [{"name": "name", "required": True}],
        "tags": [],
        "updated_at": "2024-01-01T00:00:00Z",
    }
    mock_api.post("/prompts/").mock(
        return_value=Response(201, json=created_prompt),
    )

    result = await mcp_client.call_tool(
        "create_prompt",
        {
            "name": "with-args",
            "title": "Prompt With Args",
            "description": "A test prompt",
            "content": "Hello {{ name }}",
            "arguments": [{"name": "name", "required": True}],
        },
    )

    assert result.structured_content["name"] == "with-args"

    # Verify payload was sent correctly
    request_body = mock_api.calls[0].request.content
    payload = json.loads(request_body)
    assert payload["name"] == "with-args"
    assert payload["content"] == "Hello {{ name }}"


@pytest.mark.asyncio
async def test__create_prompt_tool__creates_with_tags(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test create_prompt tool with tags."""
    created_prompt = {
        "id": "550e8400-e29b-41d4-a716-446655440012",
        "name": "tagged",
        "title": None,
        "description": None,
        "content": None,
        "arguments": [],
        "tags": ["test", "example"],
        "updated_at": "2024-01-01T00:00:00Z",
    }
    mock_api.post("/prompts/").mock(
        return_value=Response(201, json=created_prompt),
    )

    await mcp_client.call_tool(
        "create_prompt",
        {"name": "tagged", "content": "test content", "tags": ["test", "example"]},
    )

    payload = json.loads(mock_api.calls[0].request.content)
    assert payload["tags"] == ["test", "example"]


@pytest.mark.asyncio
async def test__create_prompt_tool__validation_error_invalid_name(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test create_prompt tool with invalid name format."""
    mock_api.post("/prompts/").mock(
        return_value=Response(
            400,
            json={"detail": "Invalid prompt name format"},
        ),
    )

    result = await mcp_client.call_tool("create_prompt", {"name": "Invalid Name!", "content": "test"}, raise_on_error=False)

    assert result.is_error is True
    assert "Invalid prompt name" in result.content[0].text


@pytest.mark.asyncio
async def test__create_prompt_tool__validation_error_duplicate_name(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test create_prompt tool with duplicate name."""
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

    result = await mcp_client.call_tool("create_prompt", {"name": "existing", "content": "test"}, raise_on_error=False)

    assert result.is_error is True
    assert "already exists" in result.content[0].text


@pytest.mark.asyncio
async def test__create_prompt_tool__validation_error_template_syntax(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test create_prompt tool with invalid template syntax."""
    mock_api.post("/prompts/").mock(
        return_value=Response(
            400,
            json={"detail": "Invalid Jinja2 syntax: unexpected '}'"},
        ),
    )

    result = await mcp_client.call_tool(
        "create_prompt",
        {"name": "bad-template", "content": "{{ unclosed"},
        raise_on_error=False,
    )

    assert result.is_error is True
    error_text = result.content[0].text
    assert "Jinja2" in error_text or "syntax" in error_text.lower()


@pytest.mark.asyncio
async def test__create_prompt_tool__api_unavailable(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test create_prompt handles network errors."""
    mock_api.post("/prompts/").mock(
        side_effect=httpx.ConnectError("Connection refused"),
    )

    result = await mcp_client.call_tool(
        "create_prompt",
        {"name": "test-prompt", "content": "test"},
        raise_on_error=False,
    )

    assert result.is_error is True
    assert "unavailable" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__create_prompt_tool__unknown_tool_error(mcp_client: Client) -> None:
    """Test error when calling unknown tool."""
    result = await mcp_client.call_tool("unknown_tool", {}, raise_on_error=False)

    assert result.is_error is True
    assert "Unknown tool" in result.content[0].text


# --- search_prompts tests ---


@pytest.mark.asyncio
async def test__search_prompts__no_params__returns_all(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
    sample_prompt_list_item: dict[str, Any],
) -> None:
    """Test search_prompts with no params returns all prompts."""
    response_data = {
        "items": [sample_prompt_list_item],
        "total": 1,
        "offset": 0,
        "limit": 50,
        "has_more": False,
    }
    mock_api.get("/prompts/").mock(
        return_value=Response(200, json=response_data),
    )

    result = await mcp_client.call_tool("search_prompts", {})

    data = json.loads(result.content[0].text)
    assert data["total"] == 1
    assert len(data["items"]) == 1


@pytest.mark.asyncio
async def test__search_prompts__with_query__filters_results(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
    sample_prompt_list_item: dict[str, Any],
) -> None:
    """Test search_prompts with query parameter."""
    response_data = {
        "items": [sample_prompt_list_item],
        "total": 1,
        "offset": 0,
        "limit": 50,
        "has_more": False,
    }
    mock_api.get("/prompts/").mock(
        return_value=Response(200, json=response_data),
    )

    await mcp_client.call_tool("search_prompts", {"query": "code review"})

    request_url = str(mock_api.calls[0].request.url)
    assert "q=code" in request_url


@pytest.mark.asyncio
async def test__search_prompts__with_tags__filters_results(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
    sample_prompt_list_item: dict[str, Any],
) -> None:
    """Test search_prompts with tags parameter."""
    response_data = {
        "items": [sample_prompt_list_item],
        "total": 1,
        "offset": 0,
        "limit": 50,
        "has_more": False,
    }
    mock_api.get("/prompts/").mock(
        return_value=Response(200, json=response_data),
    )

    await mcp_client.call_tool("search_prompts", {"tags": ["development", "code-review"]})

    request_url = str(mock_api.calls[0].request.url)
    assert "tags" in request_url


@pytest.mark.asyncio
async def test__search_prompts__results_include_length_and_preview(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
    sample_prompt_list_item: dict[str, Any],
) -> None:
    """Test search_prompts results include prompt_length and prompt_preview (translated from API)."""
    response_data = {
        "items": [sample_prompt_list_item],
        "total": 1,
        "offset": 0,
        "limit": 50,
        "has_more": False,
    }
    mock_api.get("/prompts/").mock(
        return_value=Response(200, json=response_data),
    )

    result = await mcp_client.call_tool("search_prompts", {})

    data = json.loads(result.content[0].text)
    # API returns content_length/content_preview, MCP translates to prompt_length/prompt_preview
    assert data["items"][0]["prompt_length"] == 500
    assert "prompt_preview" in data["items"][0]
    assert "content_length" not in data["items"][0]
    assert "content_preview" not in data["items"][0]


# --- search_prompts with filter_id ---


@pytest.mark.asyncio
async def test__search_prompts__with_filter_id__passes_to_api(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
    sample_prompt_list_item: dict[str, Any],
) -> None:
    """Test search_prompts passes filter_id to API."""
    response_data = {
        "items": [sample_prompt_list_item],
        "total": 1,
        "offset": 0,
        "limit": 50,
        "has_more": False,
    }
    mock_api.get("/prompts/").mock(
        return_value=Response(200, json=response_data),
    )

    await mcp_client.call_tool(
        "search_prompts",
        {"filter_id": "a1b2c3d4-e29b-41d4-a716-446655440000"},
    )

    request_url = str(mock_api.calls[0].request.url)
    assert "filter_id=a1b2c3d4-e29b-41d4-a716-446655440000" in request_url


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("param_name", "param_value", "expected_in_url"),
    [
        ("sort_by", "updated_at", "sort_by=updated_at"),
        ("sort_order", "asc", "sort_order=asc"),
        ("tag_match", "any", "tag_match=any"),
        ("limit", 25, "limit=25"),
        ("offset", 10, "offset=10"),
    ],
)
async def test__search_prompts__passes_parameter_to_api(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
    sample_prompt_list_item: dict[str, Any],
    param_name: str,
    param_value: Any,
    expected_in_url: str,
) -> None:
    """Test search_prompts passes query parameters to API."""
    response_data = {
        "items": [sample_prompt_list_item],
        "total": 1,
        "offset": 0,
        "limit": 50,
        "has_more": False,
    }
    mock_api.get("/prompts/").mock(
        return_value=Response(200, json=response_data),
    )

    await mcp_client.call_tool("search_prompts", {param_name: param_value})

    request_url = str(mock_api.calls[0].request.url)
    assert expected_in_url in request_url


@pytest.mark.asyncio
async def test__search_prompts__api_unavailable(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test search_prompts handles network errors."""
    mock_api.get("/prompts/").mock(side_effect=httpx.ConnectError("Connection refused"))

    result = await mcp_client.call_tool("search_prompts", {}, raise_on_error=False)

    assert result.is_error is True
    assert "unavailable" in result.content[0].text.lower()


# --- list_filters tests ---


@pytest.mark.asyncio
async def test__list_filters__returns_filters(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test list_filters returns filter data from API."""
    filters_response = [
        {
            "id": "a1b2c3d4-e29b-41d4-a716-446655440000",
            "name": "Development",
            "content_types": ["prompt"],
            "filter_expression": {
                "groups": [{"tags": ["code-review"]}],
                "group_operator": "OR",
            },
        },
    ]
    mock_api.get("/filters/").mock(
        return_value=Response(200, json=filters_response),
    )

    result = await mcp_client.call_tool("list_filters", {})

    data = json.loads(result.content[0].text)
    assert len(data["filters"]) == 1
    assert data["filters"][0]["name"] == "Development"


@pytest.mark.asyncio
async def test__list_filters__excludes_non_prompt_filters(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test list_filters only returns filters whose content_types include 'prompt'."""
    filters_response = [
        {
            "id": "a1b2c3d4-e29b-41d4-a716-446655440000",
            "name": "Bookmark Only",
            "content_types": ["bookmark"],
            "filter_expression": {
                "groups": [{"tags": ["work"]}],
                "group_operator": "OR",
            },
        },
        {
            "id": "b2c3d4e5-e29b-41d4-a716-446655440000",
            "name": "Prompt Filter",
            "content_types": ["prompt"],
            "filter_expression": {
                "groups": [{"tags": ["code-review"]}],
                "group_operator": "OR",
            },
        },
        {
            "id": "c3d4e5f6-e29b-41d4-a716-446655440000",
            "name": "Mixed Filter",
            "content_types": ["bookmark", "prompt"],
            "filter_expression": {
                "groups": [{"tags": ["shared"]}],
                "group_operator": "OR",
            },
        },
    ]
    mock_api.get("/filters/").mock(
        return_value=Response(200, json=filters_response),
    )

    result = await mcp_client.call_tool("list_filters", {})

    data = json.loads(result.content[0].text)
    names = [f["name"] for f in data["filters"]]
    assert "Prompt Filter" in names
    assert "Mixed Filter" in names
    assert "Bookmark Only" not in names


@pytest.mark.asyncio
async def test__list_filters__empty(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test list_filters with no filters returns empty list."""
    mock_api.get("/filters/").mock(
        return_value=Response(200, json=[]),
    )

    result = await mcp_client.call_tool("list_filters", {})

    data = json.loads(result.content[0].text)
    assert data["filters"] == []


@pytest.mark.asyncio
async def test__list_filters__api_unavailable(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test network error handling for list_filters."""
    mock_api.get("/filters/").mock(side_effect=httpx.ConnectError("Connection refused"))

    result = await mcp_client.call_tool("list_filters", {}, raise_on_error=False)

    assert result.is_error is True
    assert "unavailable" in result.content[0].text.lower()


# --- list_tags tests ---


@pytest.mark.asyncio
async def test__list_tags__returns_all_tags(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
    sample_tags_response: dict[str, Any],
) -> None:
    """Test list_tags returns all tags."""
    mock_api.get("/tags/").mock(
        return_value=Response(200, json=sample_tags_response),
    )

    result = await mcp_client.call_tool("list_tags", {})

    data = json.loads(result.content[0].text)
    assert len(data["tags"]) == 3
    assert data["tags"][0]["name"] == "python"


@pytest.mark.asyncio
async def test__list_tags__api_unavailable(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test list_tags handles network errors."""
    mock_api.get("/tags/").mock(side_effect=httpx.ConnectError("Connection refused"))

    result = await mcp_client.call_tool("list_tags", {}, raise_on_error=False)

    assert result.is_error is True
    assert "unavailable" in result.content[0].text.lower()


# --- call_tool (edit_prompt_content) tests ---


@pytest.mark.asyncio
async def test__edit_prompt_content_tool__updates_content(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test edit_prompt_content tool performs str-replace and returns structured response."""
    updated_prompt = {
        "id": "550e8400-e29b-41d4-a716-446655440010",
        "name": "test-prompt",
        "title": None,
        "description": None,
        "content": "Hello world!",
        "arguments": [],
        "tags": [],
        "updated_at": "2024-01-01T00:00:00Z",
    }
    mock_api.patch("/prompts/name/test-prompt/str-replace").mock(
        return_value=Response(
            200,
            json={
                "match_type": "exact",
                "line": 1,
                "data": updated_prompt,
            },
        ),
    )

    result = await mcp_client.call_tool(
        "edit_prompt_content",
        {
            "name": "test-prompt",
            "old_str": "Hello wrold",
            "new_str": "Hello world!",
        },
    )

    assert result.structured_content["id"] == "550e8400-e29b-41d4-a716-446655440010"
    assert result.structured_content["name"] == "test-prompt"
    assert result.structured_content["updated_at"] == "2024-01-01T00:00:00Z"
    assert result.structured_content["match_type"] == "exact"
    assert result.structured_content["line"] == 1
    assert "test-prompt" in result.structured_content["summary"]
    assert "exact" in result.structured_content["summary"]
    assert "line 1" in result.structured_content["summary"]

    # Text content also has the response as JSON
    response_data = json.loads(result.content[0].text)
    assert response_data["id"] == "550e8400-e29b-41d4-a716-446655440010"


@pytest.mark.asyncio
async def test__edit_prompt_content_tool__with_arguments(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test edit_prompt_content tool with atomic arguments update."""
    updated_prompt = {
        "id": "550e8400-e29b-41d4-a716-446655440011",
        "name": "with-new-var",
        "title": None,
        "description": None,
        "content": "Hello {{ name }}!",
        "arguments": [{"name": "name", "required": True}],
        "tags": [],
        "updated_at": "2024-01-01T00:00:00Z",
    }
    mock_api.patch("/prompts/name/with-new-var/str-replace").mock(
        return_value=Response(
            200,
            json={
                "match_type": "exact",
                "line": 1,
                "data": updated_prompt,
            },
        ),
    )

    result = await mcp_client.call_tool(
        "edit_prompt_content",
        {
            "name": "with-new-var",
            "old_str": "Hello world!",
            "new_str": "Hello {{ name }}!",
            "arguments": [{"name": "name", "required": True}],
        },
    )

    assert result.structured_content["name"] == "with-new-var"

    # Verify payload included arguments
    payload = json.loads(mock_api.calls[0].request.content)
    assert payload["old_str"] == "Hello world!"
    assert payload["new_str"] == "Hello {{ name }}!"
    assert payload["arguments"] == [{"name": "name", "required": True}]


@pytest.mark.asyncio
async def test__edit_prompt_content_tool__whitespace_normalized_match(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test edit_prompt_content tool reports whitespace_normalized match type."""
    updated_prompt = {
        "id": "550e8400-e29b-41d4-a716-446655440012",
        "name": "normalized",
        "content": "Updated content",
        "arguments": [],
        "tags": [],
        "updated_at": "2024-01-01T00:00:00Z",
    }
    mock_api.patch("/prompts/name/normalized/str-replace").mock(
        return_value=Response(
            200,
            json={
                "match_type": "whitespace_normalized",
                "line": 5,
                "data": updated_prompt,
            },
        ),
    )

    result = await mcp_client.call_tool(
        "edit_prompt_content",
        {
            "name": "normalized",
            "old_str": "old text",
            "new_str": "Updated content",
        },
    )

    assert result.structured_content["match_type"] == "whitespace_normalized"
    assert result.structured_content["line"] == 5
    assert "whitespace_normalized" in result.structured_content["summary"]
    assert "line 5" in result.structured_content["summary"]


@pytest.mark.asyncio
async def test__edit_prompt_content_tool__no_match_error(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test edit_prompt_content tool returns structured error when no match found."""
    mock_api.patch("/prompts/name/no-match-test/str-replace").mock(
        return_value=Response(
            400,
            json={
                "detail": {
                    "error": "no_match",
                    "message": "The specified text was not found in the content",
                    "suggestion": "Verify the text exists and check for whitespace differences",
                },
            },
        ),
    )

    result = await mcp_client.call_tool(
        "edit_prompt_content",
        {
            "name": "no-match-test",
            "old_str": "nonexistent text",
            "new_str": "replacement",
        },
        raise_on_error=False,
    )

    # Returns CallToolResult with isError=True and structuredContent per MCP spec
    assert result.is_error is True
    assert result.structured_content["error"] == "no_match"
    assert "not found" in result.structured_content["message"].lower()
    assert result.structured_content["suggestion"] == "Verify the text exists and check for whitespace differences"


@pytest.mark.asyncio
async def test__edit_prompt_content_tool__multiple_matches_error(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test edit_prompt_content tool returns structured error with match locations."""
    mock_api.patch("/prompts/name/multi-match-test/str-replace").mock(
        return_value=Response(
            400,
            json={
                "detail": {
                    "error": "multiple_matches",
                    "matches": [
                        {"field": "content", "line": 5, "context": "line 5 with foo"},
                        {"field": "content", "line": 12, "context": "line 12 with foo"},
                    ],
                    "suggestion": "Include more surrounding context to ensure uniqueness",
                },
            },
        ),
    )

    result = await mcp_client.call_tool(
        "edit_prompt_content",
        {
            "name": "multi-match-test",
            "old_str": "foo",
            "new_str": "bar",
        },
        raise_on_error=False,
    )

    # Returns CallToolResult with isError=True and structuredContent per MCP spec
    assert result.is_error is True
    assert result.structured_content["error"] == "multiple_matches"
    assert len(result.structured_content["matches"]) == 2
    assert result.structured_content["matches"][0]["line"] == 5
    assert result.structured_content["matches"][1]["line"] == 12


@pytest.mark.asyncio
async def test__edit_prompt_content_tool__template_validation_error(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test edit_prompt_content tool handles template validation error (string detail)."""
    mock_api.patch("/prompts/name/validation-test/str-replace").mock(
        return_value=Response(
            400,
            json={
                "detail": "Replacement would create invalid template: undefined variable(s): name",
            },
        ),
    )

    result = await mcp_client.call_tool(
        "edit_prompt_content",
        {
            "name": "validation-test",
            "old_str": "Hello",
            "new_str": "Hello {{ name }}",
        },
        raise_on_error=False,
    )

    # Returns CallToolResult with isError=True and structuredContent per MCP spec
    assert result.is_error is True
    assert result.structured_content["error"] == "validation_error"
    assert "undefined variable" in result.structured_content["message"].lower()


@pytest.mark.asyncio
async def test__edit_prompt_content_tool__not_found_error(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test edit_prompt_content tool returns error when prompt not found."""
    mock_api.patch("/prompts/name/nonexistent-prompt/str-replace").mock(
        return_value=Response(404, json={"detail": "Prompt not found"}),
    )

    result = await mcp_client.call_tool(
        "edit_prompt_content",
        {
            "name": "nonexistent-prompt",
            "old_str": "text",
            "new_str": "replacement",
        },
        raise_on_error=False,
    )

    assert result.is_error is True
    assert "not found" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__edit_prompt_content_tool__missing_name_error(mcp_client: Client) -> None:
    """Test edit_prompt_content tool requires name parameter."""
    result = await mcp_client.call_tool(
        "edit_prompt_content",
        {"old_str": "text", "new_str": "replacement"},
        raise_on_error=False,
    )

    assert result.is_error is True
    assert "name" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__edit_prompt_content_tool__missing_old_str_error(mcp_client: Client) -> None:
    """Test edit_prompt_content tool requires old_str parameter."""
    result = await mcp_client.call_tool(
        "edit_prompt_content",
        {"name": "some-prompt", "new_str": "replacement"},
        raise_on_error=False,
    )

    assert result.is_error is True
    assert "old_str" in result.content[0].text


@pytest.mark.asyncio
async def test__edit_prompt_content_tool__missing_new_str_error(mcp_client: Client) -> None:
    """Test edit_prompt_content tool requires new_str parameter."""
    result = await mcp_client.call_tool(
        "edit_prompt_content",
        {"name": "some-prompt", "old_str": "text"},
        raise_on_error=False,
    )

    assert result.is_error is True
    assert "new_str" in result.content[0].text


@pytest.mark.asyncio
async def test__edit_prompt_content_tool__empty_new_str_allowed(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test edit_prompt_content tool allows empty new_str for deletion."""
    updated_prompt = {
        "id": "550e8400-e29b-41d4-a716-446655440016",
        "name": "deleted-text",
        "content": "Remaining content",
        "arguments": [],
        "tags": [],
        "updated_at": "2024-01-01T00:00:00Z",
    }
    mock_api.patch("/prompts/name/deleted-text/str-replace").mock(
        return_value=Response(
            200,
            json={
                "match_type": "exact",
                "line": 1,
                "data": updated_prompt,
            },
        ),
    )

    result = await mcp_client.call_tool(
        "edit_prompt_content",
        {
            "name": "deleted-text",
            "old_str": "text to delete",
            "new_str": "",  # Empty string = deletion
        },
    )

    assert result.structured_content["name"] == "deleted-text"


@pytest.mark.asyncio
async def test__edit_prompt_content_tool__api_unavailable(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test edit_prompt_content handles network errors."""
    mock_api.patch("/prompts/name/test-prompt/str-replace").mock(
        side_effect=httpx.ConnectError("Connection refused"),
    )

    result = await mcp_client.call_tool(
        "edit_prompt_content",
        {"name": "test-prompt", "old_str": "text", "new_str": "replacement"},
        raise_on_error=False,
    )

    assert result.is_error is True
    assert "unavailable" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__list_tools__edit_prompt_content_has_schema(mcp_client: Client) -> None:
    """Test edit_prompt_content tool has proper input schema."""
    tools = await mcp_client.list_tools()

    edit_prompt = next(t for t in tools if t.name == "edit_prompt_content")
    schema = edit_prompt.inputSchema
    assert schema["type"] == "object"
    assert "name" in schema["properties"]
    assert "old_str" in schema["properties"]
    assert "new_str" in schema["properties"]
    assert "arguments" in schema["properties"]
    # name, old_str, and new_str are required
    assert set(schema["required"]) == {"name", "old_str", "new_str"}


# --- call_tool (update_prompt) tests ---


@pytest.mark.asyncio
async def test__update_prompt_tool__updates_title(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test update_prompt tool updates title and returns structured response."""
    updated_prompt = {
        "id": "550e8400-e29b-41d4-a716-446655440020",
        "name": "test-prompt",
        "title": "New Title",
        "description": None,
        "content": "Hello world",
        "arguments": [],
        "tags": [],
        "updated_at": "2024-01-02T00:00:00Z",
    }
    mock_api.patch("/prompts/name/test-prompt").mock(
        return_value=Response(200, json=updated_prompt),
    )

    result = await mcp_client.call_tool(
        "update_prompt",
        {"name": "test-prompt", "title": "New Title"},
    )

    assert result.structured_content["id"] == "550e8400-e29b-41d4-a716-446655440020"
    assert result.structured_content["name"] == "test-prompt"
    assert result.structured_content["updated_at"] == "2024-01-02T00:00:00Z"
    assert "title updated" in result.structured_content["summary"]

    # Text content also has the response
    response_text = result.content[0].text
    response_data = json.loads(response_text)
    assert response_data["id"] == "550e8400-e29b-41d4-a716-446655440020"


@pytest.mark.asyncio
async def test__update_prompt_tool__updates_tags(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test update_prompt tool updates tags."""
    updated_prompt = {
        "id": "550e8400-e29b-41d4-a716-446655440021",
        "name": "test-prompt",
        "title": None,
        "description": None,
        "content": "Hello world",
        "arguments": [],
        "tags": ["new-tag-1", "new-tag-2"],
        "updated_at": "2024-01-02T00:00:00Z",
    }
    mock_api.patch("/prompts/name/test-prompt").mock(
        return_value=Response(200, json=updated_prompt),
    )

    result = await mcp_client.call_tool(
        "update_prompt",
        {"name": "test-prompt", "tags": ["new-tag-1", "new-tag-2"]},
    )

    assert "tags updated" in result.structured_content["summary"]

    # Verify payload
    payload = json.loads(mock_api.calls[0].request.content)
    assert payload["tags"] == ["new-tag-1", "new-tag-2"]


@pytest.mark.asyncio
async def test__update_prompt_tool__renames_prompt(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test update_prompt tool renames prompt."""
    updated_prompt = {
        "id": "550e8400-e29b-41d4-a716-446655440022",
        "name": "new-name",
        "title": None,
        "description": None,
        "content": "Hello world",
        "arguments": [],
        "tags": [],
        "updated_at": "2024-01-02T00:00:00Z",
    }
    mock_api.patch("/prompts/name/old-name").mock(
        return_value=Response(200, json=updated_prompt),
    )

    result = await mcp_client.call_tool(
        "update_prompt",
        {"name": "old-name", "new_name": "new-name"},
    )

    assert "renamed to 'new-name'" in result.structured_content["summary"]

    # Verify payload maps new_name -> name
    payload = json.loads(mock_api.calls[0].request.content)
    assert payload["name"] == "new-name"


@pytest.mark.asyncio
async def test__update_prompt_tool__content_replacement(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test update_prompt tool replaces content."""
    updated_prompt = {
        "id": "550e8400-e29b-41d4-a716-446655440024",
        "name": "test-prompt",
        "title": None,
        "description": None,
        "content": "Completely new content",
        "arguments": [],
        "tags": [],
        "updated_at": "2024-01-02T00:00:00Z",
    }
    mock_api.patch("/prompts/name/test-prompt").mock(
        return_value=Response(200, json=updated_prompt),
    )

    result = await mcp_client.call_tool(
        "update_prompt",
        {"name": "test-prompt", "content": "Completely new content"},
    )

    assert "content updated" in result.structured_content["summary"]

    # Verify payload
    payload = json.loads(mock_api.calls[0].request.content)
    assert payload["content"] == "Completely new content"


@pytest.mark.asyncio
async def test__update_prompt_tool__content_and_arguments_together(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test update_prompt tool replaces content and arguments together."""
    updated_prompt = {
        "id": "550e8400-e29b-41d4-a716-446655440025",
        "name": "test-prompt",
        "title": None,
        "description": None,
        "content": "Hello {{ name }}!",
        "arguments": [{"name": "name", "description": "The name", "required": True}],
        "tags": [],
        "updated_at": "2024-01-02T00:00:00Z",
    }
    mock_api.patch("/prompts/name/test-prompt").mock(
        return_value=Response(200, json=updated_prompt),
    )

    result = await mcp_client.call_tool(
        "update_prompt",
        {
            "name": "test-prompt",
            "content": "Hello {{ name }}!",
            "arguments": [{"name": "name", "description": "The name", "required": True}],
        },
    )

    assert "content updated" in result.structured_content["summary"]
    assert "arguments updated" in result.structured_content["summary"]

    # Verify payload
    payload = json.loads(mock_api.calls[0].request.content)
    assert payload["content"] == "Hello {{ name }}!"
    assert payload["arguments"] == [{"name": "name", "description": "The name", "required": True}]


@pytest.mark.asyncio
async def test__update_prompt_tool__with_expected_updated_at_success(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test update_prompt with valid expected_updated_at succeeds."""
    updated_prompt = {
        "id": "550e8400-e29b-41d4-a716-446655440026",
        "name": "test-prompt",
        "title": "New Title",
        "description": None,
        "content": "Hello world",
        "arguments": [],
        "tags": [],
        "updated_at": "2024-01-02T00:00:00Z",
    }
    mock_api.patch("/prompts/name/test-prompt").mock(
        return_value=Response(200, json=updated_prompt),
    )

    result = await mcp_client.call_tool(
        "update_prompt",
        {
            "name": "test-prompt",
            "title": "New Title",
            "expected_updated_at": "2024-01-01T00:00:00Z",
        },
    )

    assert result.structured_content["id"] == "550e8400-e29b-41d4-a716-446655440026"
    assert "title updated" in result.structured_content["summary"]
    # expected_updated_at should NOT appear in summary (it's a control param)
    assert "expected_updated_at" not in result.structured_content["summary"]

    # Verify expected_updated_at was sent in payload
    payload = json.loads(mock_api.calls[0].request.content)
    assert payload["expected_updated_at"] == "2024-01-01T00:00:00Z"


@pytest.mark.asyncio
async def test__update_prompt_tool__conflict_returns_server_state(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test update_prompt with stale expected_updated_at returns conflict with server_state."""
    current_server_state = {
        "id": "550e8400-e29b-41d4-a716-446655440027",
        "name": "test-prompt",
        "title": "Someone else's title",
        "description": None,
        "content": "Hello world",
        "arguments": [],
        "tags": [],
        "updated_at": "2024-01-02T00:00:00Z",
    }
    mock_api.patch("/prompts/name/test-prompt").mock(
        return_value=Response(
            409,
            json={
                "detail": {
                    "error": "conflict",
                    "message": "This prompt was modified since you loaded it",
                    "server_state": current_server_state,
                },
            },
        ),
    )

    result = await mcp_client.call_tool(
        "update_prompt",
        {
            "name": "test-prompt",
            "title": "My title",
            "expected_updated_at": "2024-01-01T00:00:00Z",
        },
        raise_on_error=False,
    )

    # Should return CallToolResult with isError=True and structured conflict data
    assert result.is_error is True
    assert result.structured_content["error"] == "conflict"
    assert "modified" in result.structured_content["message"].lower()
    assert result.structured_content["server_state"]["title"] == "Someone else's title"
    assert result.structured_content["server_state"]["updated_at"] == "2024-01-02T00:00:00Z"


@pytest.mark.asyncio
async def test__update_prompt_tool__rename_conflict(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test update_prompt tool handles rename conflict (no server_state)."""
    mock_api.patch("/prompts/name/old-name").mock(
        return_value=Response(
            409,
            json={"detail": {"message": "Prompt 'existing-name' already exists", "error_code": "NAME_CONFLICT"}},
        ),
    )

    result = await mcp_client.call_tool(
        "update_prompt",
        {"name": "old-name", "new_name": "existing-name"},
        raise_on_error=False,
    )

    assert result.is_error is True
    assert "already exists" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__update_prompt_tool__not_found(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test update_prompt tool handles not found error."""
    mock_api.patch("/prompts/name/nonexistent").mock(
        return_value=Response(404, json={"detail": "Prompt not found"}),
    )

    result = await mcp_client.call_tool(
        "update_prompt",
        {"name": "nonexistent", "title": "New Title"},
        raise_on_error=False,
    )

    assert result.is_error is True
    assert "not found" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__update_prompt_tool__api_unavailable(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test update_prompt handles network errors."""
    mock_api.patch("/prompts/name/test-prompt").mock(
        side_effect=httpx.ConnectError("Connection refused"),
    )

    result = await mcp_client.call_tool(
        "update_prompt",
        {"name": "test-prompt", "title": "New Title"},
        raise_on_error=False,
    )

    assert result.is_error is True
    assert "unavailable" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__update_prompt_tool__missing_name_error(mcp_client: Client) -> None:
    """Test update_prompt tool requires name parameter."""
    result = await mcp_client.call_tool(
        "update_prompt",
        {"title": "New Title"},
        raise_on_error=False,
    )

    assert result.is_error is True
    assert "name" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__update_prompt_tool__no_data_fields_error(mcp_client: Client) -> None:
    """Test update_prompt requires at least one data field."""
    result = await mcp_client.call_tool(
        "update_prompt",
        {"name": "test-prompt"},  # No data fields provided
        raise_on_error=False,
    )

    assert result.is_error is True
    assert "at least one" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__update_prompt_tool__expected_updated_at_alone_not_sufficient(
    mcp_client: Client,
) -> None:
    """Test expected_updated_at alone doesn't satisfy 'at least one field' requirement."""
    result = await mcp_client.call_tool(
        "update_prompt",
        {"name": "test-prompt", "expected_updated_at": "2024-01-01T00:00:00Z"},
        raise_on_error=False,
    )

    assert result.is_error is True
    assert "at least one" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__list_tools__update_prompt_has_schema(mcp_client: Client) -> None:
    """Test update_prompt tool has proper input schema with new parameters."""
    tools = await mcp_client.list_tools()

    update_prompt = next(t for t in tools if t.name == "update_prompt")
    schema = update_prompt.inputSchema
    assert schema["type"] == "object"
    assert "name" in schema["properties"]
    assert "new_name" in schema["properties"]
    assert "title" in schema["properties"]
    assert "description" in schema["properties"]
    assert "tags" in schema["properties"]
    # New parameters
    assert "content" in schema["properties"]
    assert "arguments" in schema["properties"]
    assert "expected_updated_at" in schema["properties"]
    # Only name is required
    assert schema["required"] == ["name"]


# --- Authentication error tests ---


@pytest.mark.asyncio
async def test__list_prompts__no_token_error(
    mock_api,  # noqa: ARG001 - needed for HTTP client init
    mcp_client: Client,
) -> None:
    """Test list_prompts without token raises error."""
    clear_current_token()  # Ensure no token

    with pytest.raises(McpError) as exc_info:
        await mcp_client.session.list_prompts()

    assert "token" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test__list_prompts__invalid_token_error(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test list_prompts with invalid token."""
    mock_api.get("/prompts/").mock(
        return_value=Response(401, json={"detail": "Invalid token"}),
    )

    with pytest.raises(McpError) as exc_info:
        await mcp_client.session.list_prompts()

    assert "Invalid" in str(exc_info.value) or "expired" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test__list_prompts__forbidden_error(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test list_prompts with 403 forbidden error."""
    mock_api.get("/prompts/").mock(
        return_value=Response(403, json={"detail": "Access denied"}),
    )

    with pytest.raises(McpError) as exc_info:
        await mcp_client.session.list_prompts()

    assert "access denied" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test__search_prompts__forbidden_error(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test search_prompts tool with 403 forbidden error."""
    mock_api.get("/prompts/").mock(
        return_value=Response(403, json={"detail": "Access denied"}),
    )

    result = await mcp_client.call_tool("search_prompts", {}, raise_on_error=False)

    assert result.is_error is True
    assert "access denied" in result.content[0].text.lower()


# --- 400/422 error handling tests ---


@pytest.mark.asyncio
async def test__create_prompt_tool__422_fastapi_validation_errors(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test 422 validation errors (FastAPI format) are handled as INVALID_PARAMS."""
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

    result = await mcp_client.call_tool("create_prompt", {"name": "", "content": "test"}, raise_on_error=False)

    assert result.is_error is True
    # Error message should include field info
    assert "name: field required" in result.content[0].text
    assert "content: string too long" in result.content[0].text


@pytest.mark.asyncio
async def test__create_prompt_tool__400_dict_detail_format(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test 400 errors with dict detail format are handled correctly."""
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

    result = await mcp_client.call_tool("create_prompt", {"name": "test", "content": "{{ bad }}"}, raise_on_error=False)

    assert result.is_error is True
    assert "Template contains undefined variables" in result.content[0].text


@pytest.mark.asyncio
async def test__create_prompt_tool__400_string_detail_format(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test 400 errors with simple string detail are handled correctly."""
    mock_api.post("/prompts/").mock(
        return_value=Response(
            400,
            json={"detail": "Invalid prompt name format"},
        ),
    )

    result = await mcp_client.call_tool("create_prompt", {"name": "Invalid Name!", "content": "test"}, raise_on_error=False)

    assert result.is_error is True
    assert "Invalid prompt name format" in result.content[0].text


# --- call_tool (get_prompt_metadata) tests ---


@pytest.mark.asyncio
async def test__get_prompt_metadata__returns_length_and_preview(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test get_prompt_metadata returns prompt_length and prompt_preview (translated from API)."""
    metadata_response = {
        "id": "550e8400-e29b-41d4-a716-446655440001",
        "name": "code-review",
        "title": "Code Review",
        "description": "Review code",
        "arguments": [{"name": "code", "required": True}],
        "tags": ["dev"],
        "content_length": 1500,
        "content_preview": "You are a code reviewer...",
    }
    mock_api.get("/prompts/name/code-review/metadata").mock(
        return_value=Response(200, json=metadata_response),
    )

    result = await mcp_client.call_tool("get_prompt_metadata", {"name": "code-review"})

    data = json.loads(result.content[0].text)
    # API returns content_length/content_preview, MCP translates to prompt_length/prompt_preview
    assert data["prompt_length"] == 1500
    assert data["prompt_preview"] == "You are a code reviewer..."
    assert "content_length" not in data
    assert "content_preview" not in data
    assert "content" not in data  # Full content should NOT be present


@pytest.mark.asyncio
async def test__get_prompt_metadata__prompt_not_found(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test get_prompt_metadata returns error when prompt not found."""
    mock_api.get("/prompts/name/nonexistent/metadata").mock(
        return_value=Response(404, json={"detail": "Prompt not found"}),
    )

    result = await mcp_client.call_tool("get_prompt_metadata", {"name": "nonexistent"}, raise_on_error=False)

    assert result.is_error is True
    assert "not found" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__get_prompt_metadata__api_unavailable(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test get_prompt_metadata handles network errors."""
    mock_api.get("/prompts/name/test-prompt/metadata").mock(
        side_effect=httpx.ConnectError("Connection refused"),
    )

    result = await mcp_client.call_tool(
        "get_prompt_metadata",
        {"name": "test-prompt"},
        raise_on_error=False,
    )

    assert result.is_error is True
    assert "unavailable" in result.content[0].text.lower()


# --- call_tool (get_prompt_content with start_line/end_line) tests ---


@pytest.mark.asyncio
async def test__get_prompt_content__with_start_end_line__returns_partial(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    mcp_client: Client,
) -> None:
    """Test get_prompt_content with start_line/end_line parameters."""
    partial_response = {
        "id": "550e8400-e29b-41d4-a716-446655440001",
        "name": "code-review",
        "title": "Code Review",
        "description": None,
        "content": "Line 5\nLine 6\nLine 7",
        "arguments": [],
        "tags": [],
        "content_metadata": {
            "total_lines": 100,
            "start_line": 5,
            "end_line": 7,
        },
    }
    mock_api.get("/prompts/name/code-review").mock(
        return_value=Response(200, json=partial_response),
    )

    result = await mcp_client.call_tool(
        "get_prompt_content",
        {"name": "code-review", "start_line": 5, "end_line": 7},
    )

    data = json.loads(result.content[0].text)
    assert data["content"] == "Line 5\nLine 6\nLine 7"
    assert data["content_metadata"]["total_lines"] == 100
    assert data["content_metadata"]["start_line"] == 5
    assert data["content_metadata"]["end_line"] == 7

    # Verify query params were passed
    request_url = str(mock_api.calls[0].request.url)
    assert "start_line=5" in request_url
    assert "end_line=7" in request_url


# --- Cleanup tests ---


@pytest.mark.asyncio
async def test__cleanup__closes_http_client() -> None:
    """Test cleanup properly closes HTTP client."""
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
    # Ensure no resources
    server_module._http_client = None
    server_module._background_tasks.clear()

    # Should not raise
    await cleanup()

    assert server_module._http_client is None
    assert len(server_module._background_tasks) == 0


# --- get_context tool tests ---


def _sample_prompt_context_response() -> dict[str, Any]:
    """Build a sample prompt context API response."""
    return {
        "generated_at": "2026-01-25T10:30:00Z",
        "counts": {"active": 30, "archived": 2},
        "top_tags": [
            {"name": "code-review", "content_count": 8, "filter_count": 2},
            {"name": "writing", "content_count": 6, "filter_count": 1},
        ],
        "filters": [
            {
                "id": "d4e5f6a7-e29b-41d4-a716-446655440000",
                "name": "Development",
                "content_types": ["prompt"],
                "filter_expression": {
                    "groups": [{"tags": ["code-review"]}, {"tags": ["refactor"]}],
                    "group_operator": "OR",
                },
                "items": [
                    {
                        "id": "aaa11111-e29b-41d4-a716-446655440000",
                        "name": "code-review",
                        "title": "Code Review Assistant",
                        "description": "Reviews code for bugs",
                        "content_preview": "Review the following {{ language }} code...",
                        "arguments": [
                            {"name": "language", "description": "Programming language", "required": True},
                            {"name": "code", "description": "Code to review", "required": True},
                            {"name": "focus_areas", "description": None, "required": False},
                        ],
                        "tags": ["code-review", "development"],
                        "last_used_at": "2026-01-25T08:30:00Z",
                        "created_at": "2026-01-10T08:00:00Z",
                        "updated_at": "2026-01-25T09:00:00Z",
                    },
                ],
            },
        ],
        "sidebar_items": [
            {
                "type": "collection",
                "name": "Code Tools",
                "items": [
                    {"type": "filter", "id": "d4e5f6a7-e29b-41d4-a716-446655440000", "name": "Development"},
                ],
            },
            {"type": "filter", "id": "e5f6a7b8-e29b-41d4-a716-446655440000", "name": "Writing Helpers"},
        ],
        "recently_used": [
            {
                "id": "aaa11111-e29b-41d4-a716-446655440000",
                "name": "code-review",
                "title": "Code Review Assistant",
                "description": "Reviews code for bugs",
                "content_preview": "Review the following {{ language }} code...",
                "arguments": [
                    {"name": "language", "description": "Programming language", "required": True},
                    {"name": "code", "description": "Code to review", "required": True},
                ],
                "tags": ["code-review", "development"],
                "last_used_at": "2026-01-25T08:30:00Z",
                "created_at": "2026-01-10T08:00:00Z",
                "updated_at": "2026-01-25T09:00:00Z",
            },
        ],
        "recently_created": [],
        "recently_modified": [],
    }


@pytest.mark.asyncio
async def test__get_context__returns_markdown(
    mock_api: Any,
    mock_auth: Any,  # noqa: ARG001
    mcp_client: Client,
) -> None:
    """get_context tool returns markdown string with expected sections."""
    mock_api.get("/mcp/context/prompts").mock(
        return_value=Response(200, json=_sample_prompt_context_response()),
    )

    result = await mcp_client.call_tool("get_context", {})
    text = result.content[0].text
    assert "# Prompt Context" in text
    assert "## Overview" in text
    assert "30 active, 2 archived" in text
    assert "## Top Tags" in text
    assert "## Filters" in text
    assert "## Sidebar Organization" in text
    assert "## Filter Contents" in text
    assert "## Recently Used" in text


@pytest.mark.asyncio
async def test__get_context__passes_parameters(
    mock_api: Any,
    mock_auth: Any,  # noqa: ARG001
    mcp_client: Client,
) -> None:
    """get_context passes query parameters to API."""
    mock_api.get("/mcp/context/prompts").mock(
        return_value=Response(200, json=_sample_prompt_context_response()),
    )

    await mcp_client.call_tool("get_context", {
        "tag_limit": 10,
        "recent_limit": 5,
        "filter_limit": 3,
        "filter_item_limit": 2,
    })

    request_url = str(mock_api.calls[0].request.url)
    assert "tag_limit=10" in request_url
    assert "recent_limit=5" in request_url
    assert "filter_limit=3" in request_url
    assert "filter_item_limit=2" in request_url


@pytest.mark.asyncio
async def test__get_context__auth_error(
    mock_api: Any,
    mock_auth: Any,  # noqa: ARG001
    mcp_client: Client,
) -> None:
    """get_context returns error on 401."""
    mock_api.get("/mcp/context/prompts").mock(
        return_value=Response(401, json={"detail": "Not authenticated"}),
    )

    result = await mcp_client.call_tool("get_context", {}, raise_on_error=False)

    assert result.is_error is True
    assert "invalid" in result.content[0].text.lower() or "expired" in result.content[0].text.lower()


@pytest.mark.asyncio
async def test__get_context__api_unavailable(
    mock_api: Any,
    mock_auth: Any,  # noqa: ARG001
    mcp_client: Client,
) -> None:
    """get_context returns error on network error."""
    mock_api.get("/mcp/context/prompts").mock(
        side_effect=httpx.ConnectError("Connection refused"),
    )

    result = await mcp_client.call_tool("get_context", {}, raise_on_error=False)

    assert result.is_error is True
    assert "API unavailable" in result.content[0].text


@pytest.mark.asyncio
async def test__get_context__tool_in_list(mcp_client: Client) -> None:
    """get_context tool appears in the tool list with correct schema."""
    tools = await mcp_client.list_tools()
    tool_names = [t.name for t in tools]
    assert "get_context" in tool_names

    context_tool = next(t for t in tools if t.name == "get_context")
    assert context_tool.annotations.readOnlyHint is True
    props = context_tool.inputSchema["properties"]
    assert "tag_limit" in props
    assert "recent_limit" in props
    assert "filter_limit" in props
    assert "filter_item_limit" in props


@pytest.mark.asyncio
async def test__get_context__returns_text_content(
    mock_api: Any,
    mock_auth: Any,  # noqa: ARG001
    mcp_client: Client,
) -> None:
    """get_context returns text content (not structuredContent)."""
    mock_api.get("/mcp/context/prompts").mock(
        return_value=Response(200, json=_sample_prompt_context_response()),
    )

    result = await mcp_client.call_tool("get_context", {})
    # Through protocol, call_tool always returns CallToolResult
    # Verify text content is present and structuredContent is not set
    assert result.content[0].text.startswith("# Prompt Context")
    assert result.structured_content is None


# --- Prompt context markdown formatting tests ---


def test__format_prompt_context_markdown__has_all_sections() -> None:
    """Markdown output contains all expected sections."""
    data = _sample_prompt_context_response()
    md = _format_prompt_context_markdown(data)
    assert "# Prompt Context" in md
    assert "## Overview" in md
    assert "## Top Tags" in md
    assert "## Filters" in md
    assert "## Sidebar Organization" in md
    assert "## Filter Contents" in md
    assert "## Recently Used" in md


def test__format_prompt_context_markdown__overview_counts() -> None:
    """Overview shows correct prompt counts."""
    data = _sample_prompt_context_response()
    md = _format_prompt_context_markdown(data)
    assert "30 active, 2 archived" in md


def test__format_prompt_context_markdown__tags_table() -> None:
    """Tags table includes tag names and counts."""
    data = _sample_prompt_context_response()
    md = _format_prompt_context_markdown(data)
    assert "| code-review | 8 | 2 |" in md
    assert "| writing | 6 | 1 |" in md


def test__format_prompt_context_markdown__filter_expression() -> None:
    """Filter section renders expression as human-readable rule."""
    data = _sample_prompt_context_response()
    md = _format_prompt_context_markdown(data)
    assert "code-review OR refactor" in md


def test__format_prompt_context_markdown__prompt_format() -> None:
    """Prompt items show name, title, tags, description, args, and preview."""
    data = _sample_prompt_context_response()
    md = _format_prompt_context_markdown(data)
    assert '**code-review** — "Code Review Assistant"' in md
    assert "- **Tags**: code-review, development" in md
    assert "- **Description**: Reviews code for bugs" in md
    assert "`language` (required)" in md
    assert "`code` (required)" in md
    assert "`focus_areas`" in md
    assert "- **Preview**: Review the following" in md


def test__format_prompt_context_markdown__sidebar_tree() -> None:
    """Sidebar section renders both collections and root-level filters."""
    data = _sample_prompt_context_response()
    md = _format_prompt_context_markdown(data)
    assert "[collection] Code Tools" in md
    assert "Development `[filter d4e5f6a7" in md
    assert "Writing Helpers `[filter e5f6a7b8" in md


def test__format_prompt_context_markdown__deduplication() -> None:
    """Items shown in filter contents are abbreviated in recent sections."""
    data = _sample_prompt_context_response()
    md = _format_prompt_context_markdown(data)
    # The prompt appears in filter contents first, then recently_used should abbreviate
    lines = md.split("\n")
    # Find the Recently Used section
    recently_idx = next(i for i, line in enumerate(lines) if "## Recently Used" in line)
    recently_section = "\n".join(lines[recently_idx:])
    assert "(see above)" in recently_section


def test__format_prompt_context_markdown__empty_state() -> None:
    """Empty state produces valid markdown with zero counts."""
    data = {
        "generated_at": "2026-01-25T10:30:00Z",
        "counts": {"active": 0, "archived": 0},
        "top_tags": [],
        "filters": [],
        "sidebar_items": [],
        "recently_used": [],
        "recently_created": [],
        "recently_modified": [],
    }
    md = _format_prompt_context_markdown(data)
    assert "# Prompt Context" in md
    assert "## Overview" in md
    assert "0 active, 0 archived" in md
    # Optional sections should not appear
    assert "## Top Tags" not in md
    assert "## Filters" not in md
    assert "## Sidebar Organization" not in md
    assert "## Filter Contents" not in md
    assert "## Recently Used" not in md


def test__format_prompt_context_markdown__no_sidebar_when_empty() -> None:
    """Sidebar section is omitted when sidebar_items is empty."""
    data = _sample_prompt_context_response()
    data["sidebar_items"] = []
    md = _format_prompt_context_markdown(data)
    assert "## Sidebar Organization" not in md


def test__format_prompt_context_markdown__last_used_at_in_recent() -> None:
    """Recently used section shows last_used_at timestamp."""
    data = {
        "generated_at": "2026-01-25T10:30:00Z",
        "counts": {"active": 1, "archived": 0},
        "top_tags": [],
        "filters": [],
        "sidebar_items": [],
        "recently_used": [
            {
                "id": "bbb22222-e29b-41d4-a716-446655440000",
                "name": "test-prompt",
                "title": None,
                "description": None,
                "content_preview": None,
                "arguments": [],
                "tags": [],
                "last_used_at": "2026-01-25T08:30:00Z",
                "created_at": "2026-01-01T00:00:00Z",
                "updated_at": "2026-01-01T00:00:00Z",
            },
        ],
        "recently_created": [],
        "recently_modified": [],
    }
    md = _format_prompt_context_markdown(data)
    assert "- **Last used**: 2026-01-25T08:30:00Z" in md
