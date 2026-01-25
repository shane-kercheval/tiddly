# Error Handling Refactoring Notes

## Current State (Error Handling Refactoring Complete)

- `update_item_metadata` → `update_item` DONE (Content MCP)
- `update_prompt_metadata` → `update_prompt` DONE (Prompt MCP)
- Shared `parse_http_error` module created and integrated
- All 172 tests passing (53 Content MCP + 106 Prompt MCP + 13 shared)

## Completed Work

### 1. Add 403 Tests - DONE

**Content MCP** (`backend/tests/mcp_server/test_tools.py`):
```python
@pytest.mark.asyncio
async def test__search_items__forbidden(mock_api, mcp_client: Client) -> None:
    """Test 403 forbidden error handling."""
    mock_api.get("/bookmarks/").mock(return_value=Response(403, json={"detail": "Access denied"}))
    result = await mcp_client.call_tool("search_items", {"type": "bookmark"}, raise_on_error=False)
    assert result.is_error
    assert "access denied" in result.content[0].text.lower()
```

**Prompt MCP** (`backend/tests/prompt_mcp_server/test_handlers.py`):
```python
@pytest.mark.asyncio
async def test__search_prompts__forbidden(mock_api, mock_auth) -> None:
    """Test 403 forbidden error handling."""
    mock_api.get("/prompts/").mock(return_value=Response(403, json={"detail": "Access denied"}))
    with pytest.raises(McpError) as exc_info:
        await handle_call_tool("search_prompts", {})
    assert "access denied" in str(exc_info.value).lower()
```

### 2. Create Shared Module - DONE

**Location**: `backend/src/shared/api_errors.py`

```python
from dataclasses import dataclass
from typing import Literal, Any
import httpx

ErrorCategory = Literal["auth", "forbidden", "not_found", "validation", "conflict_modified", "conflict_name", "internal"]

@dataclass
class ParsedApiError:
    category: ErrorCategory
    message: str
    server_state: dict | None = None

def parse_http_error(
    e: httpx.HTTPStatusError,
    entity_type: str = "",
    entity_name: str = "",
) -> ParsedApiError:
    """Parse HTTP error into semantic categories."""
    status = e.response.status_code

    if status == 401:
        return ParsedApiError("auth", "Invalid or expired token")

    if status == 403:
        return ParsedApiError("forbidden", "Access denied")

    if status == 404:
        msg = f"{entity_type.title()} '{entity_name}' not found" if entity_name else "Not found"
        return ParsedApiError("not_found", msg)

    if status == 409:
        detail = _safe_get_detail(e)
        server_state = detail.get("server_state") if isinstance(detail, dict) else None
        if server_state:
            return ParsedApiError(
                "conflict_modified",
                "This item was modified since you loaded it. See server_state for current version.",
                server_state=server_state,
            )
        msg = detail.get("message", "A resource with this name already exists") if isinstance(detail, dict) else "Conflict"
        return ParsedApiError("conflict_name", msg)

    if status in (400, 422):
        return ParsedApiError("validation", _extract_validation_message(e))

    return ParsedApiError("internal", f"API error {status}")

def _safe_get_detail(e: httpx.HTTPStatusError) -> dict | str:
    """Safely extract detail from error response."""
    try:
        return e.response.json().get("detail", {})
    except (ValueError, KeyError):
        return {}

def _extract_validation_message(e: httpx.HTTPStatusError) -> str:
    """Extract validation error message from 400/422 response."""
    try:
        detail = e.response.json().get("detail", "Validation error")
        if isinstance(detail, dict):
            return detail.get("message", str(detail))
        if isinstance(detail, list):
            # FastAPI validation errors return a list
            return "; ".join(
                f"{err.get('loc', ['unknown'])[-1]}: {err.get('msg', 'invalid')}"
                for err in detail if isinstance(err, dict)
            ) or "Validation error"
        return str(detail)
    except (ValueError, KeyError):
        return "Validation error"
```

### 3. Refactor Content MCP Server - DONE

**File**: `backend/src/mcp_server/server.py`

Replace `_handle_api_error` with thin wrapper:
```python
from shared.api_errors import parse_http_error, ParsedApiError

def _raise_tool_error(info: ParsedApiError) -> Never:
    """Raise ToolError from parsed API error."""
    raise ToolError(info.message)
```

Update handlers to use pattern:
```python
try:
    result = await api_patch(...)
except httpx.HTTPStatusError as e:
    info = parse_http_error(e, entity_type="note", entity_name=id)
    if info.category == "conflict_modified":
        return {"error": "conflict", "message": info.message, "server_state": info.server_state}
    _raise_tool_error(info)
```

### 4. Refactor Prompt MCP Server - DONE

**File**: `backend/src/prompt_mcp_server/server.py`

Replace `_handle_api_error` with thin wrapper:
```python
from shared.api_errors import parse_http_error, ParsedApiError

_MCP_ERROR_CODES = {
    "auth": types.INVALID_REQUEST,
    "forbidden": types.INVALID_REQUEST,
    "not_found": types.INVALID_PARAMS,
    "validation": types.INVALID_PARAMS,
    "conflict_name": types.INVALID_PARAMS,
    "internal": types.INTERNAL_ERROR,
}

def _raise_mcp_error(info: ParsedApiError) -> Never:
    """Raise McpError from parsed API error."""
    raise McpError(types.ErrorData(code=_MCP_ERROR_CODES[info.category], message=info.message))

def _make_conflict_result(info: ParsedApiError) -> types.CallToolResult:
    """Create CallToolResult for conflict_modified errors."""
    error_data = {"error": "conflict", "message": info.message, "server_state": info.server_state}
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=json.dumps(error_data, indent=2))],
        structuredContent=error_data,
        isError=True,
    )
```

Update handlers to use pattern:
```python
try:
    result = await api_patch(...)
except httpx.HTTPStatusError as e:
    info = parse_http_error(e, entity_type="prompt", entity_name=prompt_name)
    if info.category == "conflict_modified":
        return _make_conflict_result(info)
    _raise_mcp_error(info)
```

## Remaining Work

### Milestone 3: Update Other Mutation Tools (Optional Enhancement)

Update `create_prompt` and `edit_prompt_template` in Prompt MCP to return `CallToolResult` with `structuredContent`:

```python
# create_prompt success response
response_data = {
    "id": result.get("id"),
    "name": result.get("name"),
    "updated_at": result.get("updated_at"),
    "summary": f"Created prompt '{result['name']}'",
}
return types.CallToolResult(
    content=[types.TextContent(type="text", text=json.dumps(response_data, indent=2))],
    structuredContent=response_data,
)

# edit_prompt_template success response
response_data = {
    "id": prompt_id,
    "name": data.get("name", prompt_name),
    "updated_at": data.get("updated_at"),
    "match_type": match_type,
    "line": line,
    "summary": f"Updated prompt '{prompt_name}' (match: {match_type} at line {line})",
}
return types.CallToolResult(
    content=[types.TextContent(type="text", text=json.dumps(response_data, indent=2))],
    structuredContent=response_data,
)
```

### Milestone 4: Documentation Review (Optional)

- Verify no stale references to `update_item_metadata` or `update_prompt_metadata`
- Already updated: README.md, CLAUDE.md, frontend SettingsMCP.tsx
- Skip: docs/implementation_plans/* (historical)
