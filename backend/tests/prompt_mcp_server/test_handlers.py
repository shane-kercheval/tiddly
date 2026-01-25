"""
Tests for MCP server handlers.

Note: mock_auth fixture is used for its side effect (patching get_bearer_token).
Tests that use mock_auth but don't reference it directly have ARG001 noqa comments.
"""

from typing import Any

import httpx
import pytest
from httpx import Response
from mcp.shared.exceptions import McpError

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
    assert "get_prompt_template" in server.instructions
    assert "create_prompt" in server.instructions
    assert "edit_prompt_template" in server.instructions
    assert "update_prompt" in server.instructions
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
async def test__list_tools__returns_all_tools() -> None:
    """Test list_tools returns all available tools."""
    result = await handle_list_tools()

    assert len(result) == 7
    tool_names = {t.name for t in result}
    assert tool_names == {
        "search_prompts",
        "list_tags",
        "get_prompt_metadata",
        "get_prompt_template",
        "create_prompt",
        "edit_prompt_template",
        "update_prompt",
    }

    get_template = next(t for t in result if t.name == "get_prompt_template")
    assert "raw content" in get_template.description
    assert "viewing or editing" in get_template.description

    create_prompt = next(t for t in result if t.name == "create_prompt")
    assert "Create a new prompt" in create_prompt.description

    edit_prompt = next(t for t in result if t.name == "edit_prompt_template")
    assert "Edit a prompt" in edit_prompt.description
    assert "string replacement" in edit_prompt.description

    update_prompt = next(t for t in result if t.name == "update_prompt")
    assert "Update a prompt" in update_prompt.description
    assert "metadata" in update_prompt.description or "content" in update_prompt.description


@pytest.mark.asyncio
async def test__list_tools__get_prompt_template_has_schema() -> None:
    """Test get_prompt_template tool has proper input schema."""
    result = await handle_list_tools()

    get_template = next(t for t in result if t.name == "get_prompt_template")
    schema = get_template.inputSchema
    assert schema["type"] == "object"
    assert "name" in schema["properties"]
    assert schema["required"] == ["name"]


@pytest.mark.asyncio
async def test__list_tools__create_prompt_has_schema() -> None:
    """Test create_prompt tool has proper input schema."""
    result = await handle_list_tools()

    create_prompt = next(t for t in result if t.name == "create_prompt")
    schema = create_prompt.inputSchema
    assert schema["type"] == "object"
    assert "name" in schema["properties"]
    assert "title" in schema["properties"]
    assert "content" in schema["properties"]
    assert "arguments" in schema["properties"]
    assert "tags" in schema["properties"]
    # Both name and content are required
    assert set(schema["required"]) == {"name", "content"}


# --- call_tool (get_prompt_template) tests ---


@pytest.mark.asyncio
async def test__get_prompt_template_tool__returns_raw_content(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    sample_prompt: dict[str, Any],
) -> None:
    """Test get_prompt_template returns raw template content as JSON."""
    import json

    mock_api.get("/prompts/name/code-review").mock(
        return_value=Response(200, json=sample_prompt),
    )

    result = await handle_call_tool("get_prompt_template", {"name": "code-review"})

    assert len(result) == 1
    # Response should be JSON-formatted
    response_data = json.loads(result[0].text)
    assert response_data["id"] == sample_prompt["id"]
    assert response_data["name"] == "code-review"
    assert response_data["title"] == "Code Review Assistant"
    assert response_data["description"] == "Reviews code and provides feedback"
    # Content should be raw template (not rendered)
    assert response_data["content"] == "Please review the following {{ language }} code:\n\n{{ code }}"
    assert len(response_data["arguments"]) == 2
    assert response_data["tags"] == ["development", "code-review"]


@pytest.mark.asyncio
async def test__get_prompt_template_tool__includes_all_metadata(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    sample_prompt: dict[str, Any],
) -> None:
    """Test get_prompt_template includes all metadata fields."""
    import json

    mock_api.get("/prompts/name/code-review").mock(
        return_value=Response(200, json=sample_prompt),
    )

    result = await handle_call_tool("get_prompt_template", {"name": "code-review"})
    response_data = json.loads(result[0].text)

    # Verify all expected fields are present
    expected_fields = {"id", "name", "title", "description", "content", "arguments", "tags"}
    assert set(response_data.keys()) == expected_fields


@pytest.mark.asyncio
async def test__get_prompt_template_tool__not_found_error(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
) -> None:
    """Test get_prompt_template returns error for nonexistent prompt."""
    from mcp.shared.exceptions import McpError

    mock_api.get("/prompts/name/nonexistent").mock(
        return_value=Response(404, json={"detail": "Prompt not found"}),
    )

    with pytest.raises(McpError) as exc_info:
        await handle_call_tool("get_prompt_template", {"name": "nonexistent"})

    assert "not found" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test__get_prompt_template_tool__missing_name_error() -> None:
    """Test get_prompt_template returns error when name is missing."""
    from mcp.shared.exceptions import McpError

    with pytest.raises(McpError) as exc_info:
        await handle_call_tool("get_prompt_template", {})

    assert "Missing required parameter: name" in str(exc_info.value)


@pytest.mark.asyncio
async def test__get_prompt_template_tool__api_unavailable(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
) -> None:
    """Test get_prompt_template handles network errors."""
    from mcp.shared.exceptions import McpError

    mock_api.get("/prompts/name/test-prompt").mock(
        side_effect=httpx.ConnectError("Connection refused"),
    )

    with pytest.raises(McpError) as exc_info:
        await handle_call_tool("get_prompt_template", {"name": "test-prompt"})

    assert "unavailable" in str(exc_info.value).lower()


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


# --- search_prompts tests ---


@pytest.mark.asyncio
async def test__search_prompts__no_params__returns_all(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
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

    result = await handle_call_tool("search_prompts", {})

    import json
    data = json.loads(result[0].text)
    assert data["total"] == 1
    assert len(data["items"]) == 1


@pytest.mark.asyncio
async def test__search_prompts__with_query__filters_results(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
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

    await handle_call_tool("search_prompts", {"query": "code review"})

    request_url = str(mock_api.calls[0].request.url)
    assert "q=code" in request_url


@pytest.mark.asyncio
async def test__search_prompts__with_tags__filters_results(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
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

    await handle_call_tool("search_prompts", {"tags": ["development", "code-review"]})

    request_url = str(mock_api.calls[0].request.url)
    assert "tags" in request_url


@pytest.mark.asyncio
async def test__search_prompts__results_include_length_and_preview(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
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

    result = await handle_call_tool("search_prompts", {})

    import json
    data = json.loads(result[0].text)
    # API returns content_length/content_preview, MCP translates to prompt_length/prompt_preview
    assert data["items"][0]["prompt_length"] == 500
    assert "prompt_preview" in data["items"][0]
    assert "content_length" not in data["items"][0]
    assert "content_preview" not in data["items"][0]


# --- list_tags tests ---


@pytest.mark.asyncio
async def test__list_tags__returns_all_tags(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
    sample_tags_response: dict[str, Any],
) -> None:
    """Test list_tags returns all tags."""
    mock_api.get("/tags/").mock(
        return_value=Response(200, json=sample_tags_response),
    )

    result = await handle_call_tool("list_tags", {})

    import json
    data = json.loads(result[0].text)
    assert len(data["tags"]) == 3
    assert data["tags"][0]["name"] == "python"


# --- call_tool (edit_prompt_template) tests ---


@pytest.mark.asyncio
async def test__edit_prompt_template_tool__updates_content(mock_api, mock_auth) -> None:  # noqa: ARG001
    """Test edit_prompt_template tool performs str-replace successfully."""
    updated_prompt = {
        "id": "550e8400-e29b-41d4-a716-446655440010",
        "name": "test-prompt",
        "title": None,
        "description": None,
        "content": "Hello world!",
        "arguments": [],
        "tags": [],
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

    result = await handle_call_tool(
        "edit_prompt_template",
        {
            "name": "test-prompt",
            "old_str": "Hello wrold",
            "new_str": "Hello world!",
        },
    )

    assert len(result) == 1
    assert "test-prompt" in result[0].text
    assert "exact" in result[0].text
    assert "line 1" in result[0].text


@pytest.mark.asyncio
async def test__edit_prompt_template_tool__with_arguments(mock_api, mock_auth) -> None:  # noqa: ARG001
    """Test edit_prompt_template tool with atomic arguments update."""
    import json

    updated_prompt = {
        "id": "550e8400-e29b-41d4-a716-446655440011",
        "name": "with-new-var",
        "title": None,
        "description": None,
        "content": "Hello {{ name }}!",
        "arguments": [{"name": "name", "required": True}],
        "tags": [],
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

    result = await handle_call_tool(
        "edit_prompt_template",
        {
            "name": "with-new-var",
            "old_str": "Hello world!",
            "new_str": "Hello {{ name }}!",
            "arguments": [{"name": "name", "required": True}],
        },
    )

    assert "with-new-var" in result[0].text

    # Verify payload included arguments
    payload = json.loads(mock_api.calls[0].request.content)
    assert payload["old_str"] == "Hello world!"
    assert payload["new_str"] == "Hello {{ name }}!"
    assert payload["arguments"] == [{"name": "name", "required": True}]


@pytest.mark.asyncio
async def test__edit_prompt_template_tool__whitespace_normalized_match(
    mock_api, mock_auth,  # noqa: ARG001
) -> None:
    """Test edit_prompt_template tool reports whitespace_normalized match type."""
    updated_prompt = {
        "id": "550e8400-e29b-41d4-a716-446655440012",
        "name": "normalized",
        "content": "Updated content",
        "arguments": [],
        "tags": [],
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

    result = await handle_call_tool(
        "edit_prompt_template",
        {
            "name": "normalized",
            "old_str": "old text",
            "new_str": "Updated content",
        },
    )

    assert "whitespace_normalized" in result[0].text
    assert "line 5" in result[0].text


@pytest.mark.asyncio
async def test__edit_prompt_template_tool__no_match_error(mock_api, mock_auth) -> None:  # noqa: ARG001
    """Test edit_prompt_template tool returns structured error when no match found."""
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

    result = await handle_call_tool(
        "edit_prompt_template",
        {
            "name": "no-match-test",
            "old_str": "nonexistent text",
            "new_str": "replacement",
        },
    )

    # Returns CallToolResult with isError=True per MCP spec
    import json
    from mcp import types

    assert isinstance(result, types.CallToolResult)
    assert result.isError is True
    assert len(result.content) == 1
    error_data = json.loads(result.content[0].text)
    assert error_data["error"] == "no_match"
    assert "not found" in error_data["message"].lower()


@pytest.mark.asyncio
async def test__edit_prompt_template_tool__multiple_matches_error(
    mock_api, mock_auth,  # noqa: ARG001
) -> None:
    """Test edit_prompt_template tool returns structured error with match locations."""
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

    result = await handle_call_tool(
        "edit_prompt_template",
        {
            "name": "multi-match-test",
            "old_str": "foo",
            "new_str": "bar",
        },
    )

    # Returns CallToolResult with isError=True per MCP spec
    import json
    from mcp import types

    assert isinstance(result, types.CallToolResult)
    assert result.isError is True
    assert len(result.content) == 1
    error_data = json.loads(result.content[0].text)
    assert error_data["error"] == "multiple_matches"
    assert len(error_data["matches"]) == 2
    assert error_data["matches"][0]["line"] == 5
    assert error_data["matches"][1]["line"] == 12


@pytest.mark.asyncio
async def test__edit_prompt_template_tool__template_validation_error(
    mock_api, mock_auth,  # noqa: ARG001
) -> None:
    """Test edit_prompt_template tool handles template validation error (string detail)."""
    mock_api.patch("/prompts/name/validation-test/str-replace").mock(
        return_value=Response(
            400,
            json={
                "detail": "Replacement would create invalid template: undefined variable(s): name",
            },
        ),
    )

    result = await handle_call_tool(
        "edit_prompt_template",
        {
            "name": "validation-test",
            "old_str": "Hello",
            "new_str": "Hello {{ name }}",
        },
    )

    # Returns CallToolResult with isError=True per MCP spec
    import json
    from mcp import types

    assert isinstance(result, types.CallToolResult)
    assert result.isError is True
    assert len(result.content) == 1
    error_data = json.loads(result.content[0].text)
    assert error_data["error"] == "validation_error"
    assert "undefined variable" in error_data["message"].lower()


@pytest.mark.asyncio
async def test__edit_prompt_template_tool__not_found_error(mock_api, mock_auth) -> None:  # noqa: ARG001
    """Test edit_prompt_template tool raises McpError when prompt not found."""
    from mcp.shared.exceptions import McpError

    mock_api.patch("/prompts/name/nonexistent-prompt/str-replace").mock(
        return_value=Response(404, json={"detail": "Prompt not found"}),
    )

    with pytest.raises(McpError) as exc_info:
        await handle_call_tool(
            "edit_prompt_template",
            {
                "name": "nonexistent-prompt",
                "old_str": "text",
                "new_str": "replacement",
            },
        )

    assert "not found" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test__edit_prompt_template_tool__missing_name_error() -> None:
    """Test edit_prompt_template tool requires name parameter."""
    from mcp.shared.exceptions import McpError

    with pytest.raises(McpError) as exc_info:
        await handle_call_tool(
            "edit_prompt_template",
            {"old_str": "text", "new_str": "replacement"},
        )

    assert "name" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test__edit_prompt_template_tool__missing_old_str_error() -> None:
    """Test edit_prompt_template tool requires old_str parameter."""
    from mcp.shared.exceptions import McpError

    with pytest.raises(McpError) as exc_info:
        await handle_call_tool(
            "edit_prompt_template",
            {"name": "some-prompt", "new_str": "replacement"},
        )

    assert "old_str" in str(exc_info.value)


@pytest.mark.asyncio
async def test__edit_prompt_template_tool__missing_new_str_error() -> None:
    """Test edit_prompt_template tool requires new_str parameter."""
    from mcp.shared.exceptions import McpError

    with pytest.raises(McpError) as exc_info:
        await handle_call_tool(
            "edit_prompt_template",
            {"name": "some-prompt", "old_str": "text"},
        )

    assert "new_str" in str(exc_info.value)


@pytest.mark.asyncio
async def test__edit_prompt_template_tool__empty_new_str_allowed(
    mock_api, mock_auth,  # noqa: ARG001
) -> None:
    """Test edit_prompt_template tool allows empty new_str for deletion."""
    updated_prompt = {
        "id": "550e8400-e29b-41d4-a716-446655440016",
        "name": "deleted-text",
        "content": "Remaining content",
        "arguments": [],
        "tags": [],
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

    result = await handle_call_tool(
        "edit_prompt_template",
        {
            "name": "deleted-text",
            "old_str": "text to delete",
            "new_str": "",  # Empty string = deletion
        },
    )

    assert "deleted-text" in result[0].text


@pytest.mark.asyncio
async def test__list_tools__edit_prompt_template_has_schema() -> None:
    """Test edit_prompt_template tool has proper input schema."""
    result = await handle_list_tools()

    edit_prompt = next(t for t in result if t.name == "edit_prompt_template")
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
    mock_api, mock_auth,  # noqa: ARG001
) -> None:
    """Test update_prompt tool updates title and returns structured response."""
    import json

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

    result = await handle_call_tool(
        "update_prompt",
        {"name": "test-prompt", "title": "New Title"},
    )

    # Returns CallToolResult with structuredContent
    assert hasattr(result, "structuredContent")
    assert result.structuredContent["id"] == "550e8400-e29b-41d4-a716-446655440020"
    assert result.structuredContent["name"] == "test-prompt"
    assert result.structuredContent["updated_at"] == "2024-01-02T00:00:00Z"
    assert "title updated" in result.structuredContent["summary"]

    # Text content also has the response
    response_text = result.content[0].text
    response_data = json.loads(response_text)
    assert response_data["id"] == "550e8400-e29b-41d4-a716-446655440020"


@pytest.mark.asyncio
async def test__update_prompt_tool__updates_tags(
    mock_api, mock_auth,  # noqa: ARG001
) -> None:
    """Test update_prompt tool updates tags."""
    import json

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

    result = await handle_call_tool(
        "update_prompt",
        {"name": "test-prompt", "tags": ["new-tag-1", "new-tag-2"]},
    )

    assert "tags updated" in result.structuredContent["summary"]

    # Verify payload
    payload = json.loads(mock_api.calls[0].request.content)
    assert payload["tags"] == ["new-tag-1", "new-tag-2"]


@pytest.mark.asyncio
async def test__update_prompt_tool__renames_prompt(
    mock_api, mock_auth,  # noqa: ARG001
) -> None:
    """Test update_prompt tool renames prompt."""
    import json

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

    result = await handle_call_tool(
        "update_prompt",
        {"name": "old-name", "new_name": "new-name"},
    )

    assert "renamed to 'new-name'" in result.structuredContent["summary"]

    # Verify payload maps new_name -> name
    payload = json.loads(mock_api.calls[0].request.content)
    assert payload["name"] == "new-name"


@pytest.mark.asyncio
async def test__update_prompt_tool__content_replacement(
    mock_api, mock_auth,  # noqa: ARG001
) -> None:
    """Test update_prompt tool replaces content."""
    import json

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

    result = await handle_call_tool(
        "update_prompt",
        {"name": "test-prompt", "content": "Completely new content"},
    )

    assert "content updated" in result.structuredContent["summary"]

    # Verify payload
    payload = json.loads(mock_api.calls[0].request.content)
    assert payload["content"] == "Completely new content"


@pytest.mark.asyncio
async def test__update_prompt_tool__content_and_arguments_together(
    mock_api, mock_auth,  # noqa: ARG001
) -> None:
    """Test update_prompt tool replaces content and arguments together."""
    import json

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

    result = await handle_call_tool(
        "update_prompt",
        {
            "name": "test-prompt",
            "content": "Hello {{ name }}!",
            "arguments": [{"name": "name", "description": "The name", "required": True}],
        },
    )

    assert "content updated" in result.structuredContent["summary"]
    assert "arguments updated" in result.structuredContent["summary"]

    # Verify payload
    payload = json.loads(mock_api.calls[0].request.content)
    assert payload["content"] == "Hello {{ name }}!"
    assert payload["arguments"] == [{"name": "name", "description": "The name", "required": True}]


@pytest.mark.asyncio
async def test__update_prompt_tool__with_expected_updated_at_success(
    mock_api, mock_auth,  # noqa: ARG001
) -> None:
    """Test update_prompt with valid expected_updated_at succeeds."""
    import json

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

    result = await handle_call_tool(
        "update_prompt",
        {
            "name": "test-prompt",
            "title": "New Title",
            "expected_updated_at": "2024-01-01T00:00:00Z",
        },
    )

    assert result.structuredContent["id"] == "550e8400-e29b-41d4-a716-446655440026"
    assert "title updated" in result.structuredContent["summary"]
    # expected_updated_at should NOT appear in summary (it's a control param)
    assert "expected_updated_at" not in result.structuredContent["summary"]

    # Verify expected_updated_at was sent in payload
    payload = json.loads(mock_api.calls[0].request.content)
    assert payload["expected_updated_at"] == "2024-01-01T00:00:00Z"


@pytest.mark.asyncio
async def test__update_prompt_tool__conflict_returns_server_state(
    mock_api, mock_auth,  # noqa: ARG001
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

    result = await handle_call_tool(
        "update_prompt",
        {
            "name": "test-prompt",
            "title": "My title",
            "expected_updated_at": "2024-01-01T00:00:00Z",
        },
    )

    # Should return CallToolResult with isError=True and structured conflict data
    assert result.isError is True
    assert result.structuredContent["error"] == "conflict"
    assert "modified" in result.structuredContent["message"].lower()
    assert result.structuredContent["server_state"]["title"] == "Someone else's title"
    assert result.structuredContent["server_state"]["updated_at"] == "2024-01-02T00:00:00Z"


@pytest.mark.asyncio
async def test__update_prompt_tool__rename_conflict(
    mock_api, mock_auth,  # noqa: ARG001
) -> None:
    """Test update_prompt tool handles rename conflict (no server_state)."""
    from mcp.shared.exceptions import McpError

    mock_api.patch("/prompts/name/old-name").mock(
        return_value=Response(
            409,
            json={"detail": {"message": "Prompt 'existing-name' already exists", "error_code": "NAME_CONFLICT"}},
        ),
    )

    with pytest.raises(McpError) as exc_info:
        await handle_call_tool(
            "update_prompt",
            {"name": "old-name", "new_name": "existing-name"},
        )

    assert "already exists" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test__update_prompt_tool__not_found(
    mock_api, mock_auth,  # noqa: ARG001
) -> None:
    """Test update_prompt tool handles not found error."""
    from mcp.shared.exceptions import McpError

    mock_api.patch("/prompts/name/nonexistent").mock(
        return_value=Response(404, json={"detail": "Prompt not found"}),
    )

    with pytest.raises(McpError) as exc_info:
        await handle_call_tool(
            "update_prompt",
            {"name": "nonexistent", "title": "New Title"},
        )

    assert "not found" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test__update_prompt_tool__missing_name_error() -> None:
    """Test update_prompt tool requires name parameter."""
    from mcp.shared.exceptions import McpError

    with pytest.raises(McpError) as exc_info:
        await handle_call_tool(
            "update_prompt",
            {"title": "New Title"},
        )

    assert "name" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test__update_prompt_tool__no_data_fields_error(
    mock_api, mock_auth,  # noqa: ARG001
) -> None:
    """Test update_prompt requires at least one data field."""
    with pytest.raises(McpError) as exc_info:
        await handle_call_tool(
            "update_prompt",
            {"name": "test-prompt"},  # No data fields provided
        )

    assert "at least one" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test__update_prompt_tool__expected_updated_at_alone_not_sufficient(
    mock_api, mock_auth,  # noqa: ARG001
) -> None:
    """Test expected_updated_at alone doesn't satisfy 'at least one field' requirement."""
    with pytest.raises(McpError) as exc_info:
        await handle_call_tool(
            "update_prompt",
            {"name": "test-prompt", "expected_updated_at": "2024-01-01T00:00:00Z"},
        )

    assert "at least one" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test__list_tools__update_prompt_has_schema() -> None:
    """Test update_prompt tool has proper input schema with new parameters."""
    result = await handle_list_tools()

    update_prompt = next(t for t in result if t.name == "update_prompt")
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


@pytest.mark.asyncio
async def test__list_prompts__forbidden_error(mock_api, mock_auth) -> None:  # noqa: ARG001
    """Test list_prompts with 403 forbidden error."""
    from mcp.shared.exceptions import McpError

    mock_api.get("/prompts/").mock(
        return_value=Response(403, json={"detail": "Access denied"}),
    )

    with pytest.raises(McpError) as exc_info:
        await handle_list_prompts(make_list_prompts_request())

    assert "access denied" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test__search_prompts__forbidden_error(mock_api, mock_auth) -> None:  # noqa: ARG001
    """Test search_prompts tool with 403 forbidden error."""
    from mcp.shared.exceptions import McpError

    mock_api.get("/prompts/").mock(
        return_value=Response(403, json={"detail": "Access denied"}),
    )

    with pytest.raises(McpError) as exc_info:
        await handle_call_tool("search_prompts", {})

    assert "access denied" in str(exc_info.value).lower()


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


# --- call_tool (get_prompt_metadata) tests ---


@pytest.mark.asyncio
async def test__get_prompt_metadata__returns_length_and_preview(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
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

    result = await handle_call_tool("get_prompt_metadata", {"name": "code-review"})

    import json
    data = json.loads(result[0].text)
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
) -> None:
    """Test get_prompt_metadata returns error when prompt not found."""
    from mcp.shared.exceptions import McpError

    mock_api.get("/prompts/name/nonexistent/metadata").mock(
        return_value=Response(404, json={"detail": "Prompt not found"}),
    )

    with pytest.raises(McpError) as exc_info:
        await handle_call_tool("get_prompt_metadata", {"name": "nonexistent"})

    assert "not found" in str(exc_info.value).lower()


# --- call_tool (get_prompt_template with start_line/end_line) tests ---


@pytest.mark.asyncio
async def test__get_prompt_template__with_start_end_line__returns_partial(
    mock_api,
    mock_auth,  # noqa: ARG001 - needed for side effect
) -> None:
    """Test get_prompt_template with start_line/end_line parameters."""
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

    result = await handle_call_tool(
        "get_prompt_template",
        {"name": "code-review", "start_line": 5, "end_line": 7},
    )

    import json
    data = json.loads(result[0].text)
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
