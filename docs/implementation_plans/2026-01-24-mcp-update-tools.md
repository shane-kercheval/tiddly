# Implementation Plan: Consolidate MCP Update Tools

## Overview

Consolidate `update_item_metadata` → `update_item` and `update_prompt_metadata` → `update_prompt` to support both metadata updates AND full content replacement. This addresses the limitation that string replacement (`edit_content`/`edit_prompt_template`) is difficult for long or wholesale content changes.

**Key insight:** The REST API already supports `content` in update schemas (`BookmarkUpdate`, `NoteUpdate`, `PromptUpdate`). The MCP tools simply don't expose this parameter. This is primarily an MCP tool interface change, not a backend change.

---

## Background: Structured Content Research

### MCP Specification (2025-06-18)

The MCP specification added support for **structured content** in tool responses. Tools can now return both:
- `content`: Traditional `TextContent` blocks (for backwards compatibility)
- `structuredContent`: JSON object for programmatic parsing

**Sources:**
- [MCP Specification 2025-06-18 - Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [FastMCP Tools Documentation](https://gofastmcp.com/servers/tools)

### Current Library Support

| Library | Version | Structured Content Support |
|---------|---------|---------------------------|
| MCP SDK | 1.24.0 | `CallToolResult.structured_content` field |
| FastMCP | 2.14.1 | Automatic - dict returns become structured content |

### How FastMCP Handles Returns

When a tool returns a `dict`, FastMCP automatically provides both formats:

```python
@mcp.tool
def get_data() -> dict:
    return {'name': 'Alice', 'count': 42}

# Result:
# content: [TextContent(text='{"name":"Alice","count":42}')]
# structured_content: {'name': 'Alice', 'count': 42}
```

When a tool returns a `str`, it gets wrapped:
```python
@mcp.tool
def get_summary() -> str:
    return "Updated successfully"

# Result:
# content: [TextContent(text='Updated successfully')]
# structured_content: {'result': 'Updated successfully'}  # Less useful for parsing
```

### Current Return Type Inconsistencies

**Content MCP Server (`mcp_server/server.py`):**
| Tool | Return Type | Structured Content |
|------|-------------|-------------------|
| `search_items` | `dict` | Full structured data |
| `get_item` | `dict` | Full structured data |
| `edit_content` | `dict` | Full structured data |
| `search_in_content` | `dict` | Full structured data |
| `create_bookmark` | `dict` | Full structured data |
| `create_note` | `dict` | Full structured data |
| `list_tags` | `dict` | Full structured data |
| **`update_item_metadata`** | **`str`** | `{'result': '...'}` - less useful |

**Prompt MCP Server (`prompt_mcp_server/server.py`):**
| Tool | Returns | Structured Content |
|------|---------|-------------------|
| `search_prompts` | `json.dumps(...)` | Full structured data |
| `get_prompt_template` | `json.dumps(...)` | Full structured data |
| `get_prompt_metadata` | `json.dumps(...)` | Full structured data |
| `list_tags` | `json.dumps(...)` | Full structured data |
| **`create_prompt`** | **f-string** | `{'result': '...'}` - less useful |
| **`edit_prompt_template`** | **f-string** | `{'result': '...'}` - less useful |
| **`update_prompt_metadata`** | **f-string** | `{'result': '...'}` - less useful |

### Decision: Standardize on Structured Dict Returns

All mutation tools should return structured dicts containing:
- `id`: Entity ID for reference
- `updated_at`: Timestamp for optimistic locking
- `summary`: Human-readable description of changes

This enables:
1. **Programmatic verification** - Clients can confirm the update succeeded
2. **Optimistic locking** - Clients can use `updated_at` for subsequent updates via `expected_updated_at`
3. **Consistency** - All tools follow the same pattern

---

## Milestone 1: Content MCP Server - Rename and Extend `update_item`

### Goal
Rename `update_item_metadata` → `update_item`, add `content` parameter for full content replacement, add `expected_updated_at` for optimistic locking, and return structured dict.

### Key Changes

**File: `backend/src/mcp_server/server.py`**

1. **Rename the tool function:** `update_item_metadata` → `update_item`

2. **Update tool description** (must be clear for LLMs):
   ```python
   @mcp.tool(
       description=(
           "Update a bookmark or note. All parameters are optional - only provide the fields "
           "you want to change (at least one required). Can update metadata (title, description, "
           "tags, url) and/or fully replace content. "
           "NOTE: To make partial/targeted edits to content using string replacement, "
           "use edit_content instead. This tool replaces the entire content field."
       ),
       annotations={"readOnlyHint": False, "destructiveHint": True},
   )
   ```

3. **Add `content` parameter:**
   ```python
   content: Annotated[
       str | None,
       Field(description="New content (FULL REPLACEMENT of entire content field). Omit to leave unchanged."),
   ] = None,
   ```

4. **Add `expected_updated_at` parameter for optimistic locking:**
   ```python
   expected_updated_at: Annotated[
       str | None,
       Field(description="For optimistic locking. If provided and the item was modified after this timestamp, returns 409 Conflict. Use the updated_at from a previous response."),
   ] = None,
   ```

5. **Update validation to include `content`:**
   ```python
   # OLD (line 544-545):
   if title is None and description is None and tags is None and url is None:
       raise ToolError("At least one of title, description, tags, or url must be provided")

   # NEW:
   if title is None and description is None and tags is None and url is None and content is None:
       raise ToolError("At least one of title, description, tags, url, or content must be provided")
   ```

6. **Update payload building:** Include `content` and `expected_updated_at` in the payload if provided

7. **Change return type from `str` to `dict`:**
   ```python
   # OLD:
   return f"Updated {type} '{item_title}' (ID: {item_id}): {summary}"

   # NEW:
   return {
       "id": result.get("id"),
       "updated_at": result.get("updated_at"),
       "summary": f"Updated {type} '{item_title}': {summary}",
   }
   ```

8. **Handle 409 Conflict for optimistic locking:**
   ```python
   if e.response.status_code == 409:
       raise ToolError("Conflict: item was modified. Fetch latest version and retry.")
   ```

9. **Update MCP server instructions:** Update the `instructions` string to include:
   - Updated tool list with `update_item` (not `update_item_metadata`)
   - Clear guidance: "Use `update_item` for full content replacement, `edit_content` for targeted string-based edits"
   - Note that all `update_item` parameters are optional (at least one required)
   - Document `expected_updated_at` for optimistic locking

**File: `frontend/src/pages/settings/SettingsMCP.tsx`**

1. Rename `update_item_metadata` → `update_item` in the tool list
2. Update description to mention content replacement capability

### Success Criteria
- `update_item` tool accepts `content` parameter
- `update_item` tool accepts `expected_updated_at` parameter
- Providing `content` fully replaces the item's content field
- Existing metadata-only updates continue to work
- Returns structured dict with `{id, updated_at, summary}`
- 409 Conflict handled when `expected_updated_at` is stale
- `edit_content` tool still works for targeted string replacement
- MCP server instructions reflect the new tool name and capability
- Frontend Settings page shows updated tool name and description

### Testing Strategy
- **Unit tests:** Add/update tests in `backend/tests/mcp_server/` for:
  - `update_item` with content-only update
  - `update_item` with metadata-only update (regression)
  - `update_item` with both content and metadata
  - Verify `content` fully replaces (not appends)
  - Verify returns dict with `{id, updated_at, summary}`
  - `update_item` with valid `expected_updated_at` succeeds
  - `update_item` with stale `expected_updated_at` returns 409/error
  - Validation error when no fields provided (including content in check)
- **Integration:** Verify via MCP client that tool schema shows `content` and `expected_updated_at` parameters

### Dependencies
None - this is the first milestone

### Risk Factors
- Ensure backwards compatibility is NOT a concern (breaking changes are OK per requirements)
- Verify the API endpoint handles `content` in PATCH correctly (it should - schemas already support it)

---

## Milestone 2: Prompt MCP Server - Rename and Extend `update_prompt`

### Goal
Rename `update_prompt_metadata` → `update_prompt`, add `content` and `arguments` parameters for full template replacement, add `expected_updated_at` for optimistic locking, and return structured dict.

### Key Changes

**File: `backend/src/prompt_mcp_server/server.py`**

1. **Rename in tool list:** Change tool name from `update_prompt_metadata` to `update_prompt`

2. **Update tool description** (must be clear for LLMs):
   ```python
   types.Tool(
       name="update_prompt",
       description=(
           "Update a prompt. All parameters are optional - only provide the fields you want "
           "to change (at least one required). Can update metadata (title, description, tags, name) "
           "and/or fully replace template content and arguments. "
           "NOTE: To make partial/targeted edits to the template using string replacement, "
           "use edit_prompt_template instead. This tool replaces the entire content field."
       ),
       ...
   )
   ```

3. **Add `content`, `arguments`, and `expected_updated_at` to inputSchema:**
   ```python
   "content": {
       "type": "string",
       "description": (
           "New template content (FULL REPLACEMENT of entire template). Omit to leave unchanged. "
           "IMPORTANT: If your new content changes template variables ({{ var }}), you MUST also "
           "provide the arguments parameter with ALL arguments defined."
       ),
   },
   "arguments": {
       "type": "array",
       "description": (
           "New arguments list (FULL REPLACEMENT - not a merge). Omit to leave unchanged. "
           "IMPORTANT: If provided, you must include ALL arguments, not just changed ones. "
           "This completely replaces the existing arguments list."
       ),
       "items": { ... same schema as edit_prompt_template ... }
   },
   "expected_updated_at": {
       "type": "string",
       "description": (
           "For optimistic locking. If provided and the prompt was modified after this timestamp, "
           "returns error. Use the updated_at from a previous response."
       ),
   },
   ```

4. **Update handler:** `_handle_update_prompt_metadata` → `_handle_update_prompt`
   - Add `content`, `arguments`, and `expected_updated_at` to the field mapping
   - Include them in the payload if provided

5. **Update dispatch table:** Change key from `"update_prompt_metadata"` to `"update_prompt"`

6. **Change return from f-string to structured JSON:**
   ```python
   # OLD:
   return [types.TextContent(
       type="text",
       text=f"Updated prompt '{prompt_name}' (ID: {prompt_id}): {summary}",
   )]

   # NEW:
   response_data = {
       "id": result.get("id"),
       "name": result.get("name"),
       "updated_at": result.get("updated_at"),
       "summary": summary,
   }
   return [types.TextContent(
       type="text",
       text=json.dumps(response_data, indent=2),
   )]
   ```

7. **Update MCP server instructions:** Update the `instructions` string to include:
   - Updated tool list with `update_prompt` (not `update_prompt_metadata`)
   - Clear guidance: "Use `update_prompt` for full template replacement, `edit_prompt_template` for targeted string-based edits"
   - Note that all `update_prompt` parameters are optional (at least one required)
   - **Critical warning:** When using `update_prompt` with `content` that changes template variables, you MUST also provide `arguments` with ALL arguments (full replacement, not merge)
   - Document `expected_updated_at` for optimistic locking
   - Update example workflows to show both patterns

**File: `frontend/src/pages/settings/SettingsMCP.tsx`**

1. Rename `update_prompt_metadata` → `update_prompt` in the tool list
2. Update description: "Update metadata, content, or arguments"
3. **Fix the `edit_prompt_template` description:** Change "Edit content using string replacement" to "Edit template using string replacement"

### Success Criteria
- `update_prompt` tool accepts `content`, `arguments`, and `expected_updated_at` parameters
- Providing `content` fully replaces the prompt's template
- Providing `arguments` fully replaces the prompt's arguments list
- Existing metadata-only updates continue to work
- Returns structured JSON with `{id, name, updated_at, summary}`
- `edit_prompt_template` tool still works for targeted string replacement
- MCP server instructions reflect the new tool name and capabilities
- Frontend Settings page shows updated tool names and descriptions
- `edit_prompt_template` description says "template" not "content"

### Testing Strategy
- **Unit tests:** Add/update tests in `backend/tests/prompt_mcp_server/` for:
  - `update_prompt` with content-only update
  - `update_prompt` with arguments-only update
  - `update_prompt` with metadata-only update (regression)
  - `update_prompt` with content + arguments together
  - `update_prompt` with all fields
  - Verify template validation still runs on content updates
  - Verify returns structured JSON with `{id, name, updated_at, summary}`
  - `update_prompt` with valid `expected_updated_at` succeeds
  - `update_prompt` with stale `expected_updated_at` returns error
- **Integration:** Verify via MCP client that tool schema shows new parameters

### Dependencies
- Milestone 1 should be complete first (for consistency, though technically independent)

### Risk Factors
- Prompts have Jinja2 template validation - ensure content updates trigger validation
- Arguments must be consistent with template variables - the backend validates this
- **Critical for LLM clarity:** When `content` changes template variables, the LLM must:
  1. Also provide `arguments` parameter
  2. Include ALL arguments in the list (full replacement, not merge)
- The tool description MUST make this explicit or LLMs will forget to update arguments

---

## Milestone 3: Prompt MCP Server - Update Other Mutation Tools

### Goal
Update `create_prompt` and `edit_prompt_template` to return structured JSON instead of f-string summaries, for consistency with read tools and `update_prompt`.

### Key Changes

**File: `backend/src/prompt_mcp_server/server.py`**

1. **Update `_handle_create_prompt` return:**
   ```python
   # OLD:
   return [types.TextContent(
       type="text",
       text=f"Created prompt '{result['name']}' (ID: {result['id']})",
   )]

   # NEW:
   response_data = {
       "id": result.get("id"),
       "name": result.get("name"),
       "updated_at": result.get("updated_at"),
       "summary": f"Created prompt '{result['name']}'",
   }
   return [types.TextContent(
       type="text",
       text=json.dumps(response_data, indent=2),
   )]
   ```

2. **Update `_handle_edit_prompt_template` return:**
   ```python
   # OLD:
   return [types.TextContent(
       type="text",
       text=f"Updated prompt '{prompt_name}' (ID: {prompt_id}, match: {match_type} at line {line})",
   )]

   # NEW:
   response_data = {
       "id": prompt_id,
       "name": data.get("name", prompt_name),
       "updated_at": data.get("updated_at"),
       "match_type": match_type,
       "line": line,
       "summary": f"Updated prompt '{prompt_name}' (match: {match_type} at line {line})",
   }
   return [types.TextContent(
       type="text",
       text=json.dumps(response_data, indent=2),
   )]
   ```

### Success Criteria
- `create_prompt` returns structured JSON with `{id, name, updated_at, summary}`
- `edit_prompt_template` returns structured JSON with `{id, name, updated_at, match_type, line, summary}`
- All Prompt MCP mutation tools now return structured data

### Testing Strategy
- **Unit tests:** Update existing tests to verify structured JSON returns:
  - `create_prompt` returns dict with expected fields
  - `edit_prompt_template` returns dict with expected fields including `match_type` and `line`

### Dependencies
- Milestone 2 (for consistency in approach)

### Risk Factors
- None significant - straightforward return format change

---

## Milestone 4: Documentation and Instructions Update

### Goal
Update all MCP server instructions, CLAUDE.md, and any other documentation to reflect the renamed tools and new capabilities.

### Key Changes

**File: `CLAUDE.md`**
- No changes needed - it doesn't list individual MCP tools

**MCP Server Instructions (already covered in M1/M2/M3, but verify):**
- `backend/src/mcp_server/server.py` - instructions string
- `backend/src/prompt_mcp_server/server.py` - instructions string

**Verify tool descriptions are clear about:**
- `update_item` / `update_prompt` - for metadata OR full content replacement
- `edit_content` / `edit_prompt_template` - for targeted string replacement (partial edits)
- All params are optional on `update_*` tools - only provide what you want to change (at least one required)
- Include the "Tool Selection Guide" (see below) in the MCP server instructions
- Document `expected_updated_at` for optimistic locking
- Document that all mutation tools now return structured data with `updated_at`

### Success Criteria
- MCP server instructions clearly document both update patterns
- Tool descriptions distinguish between full replacement and targeted editing
- No references to old tool names (`update_item_metadata`, `update_prompt_metadata`)
- Optimistic locking workflow is documented

### Testing Strategy
- Manual review of all instruction strings
- Verify no old tool names remain in codebase (grep search)

### Dependencies
- Milestones 1, 2, and 3

### Risk Factors
- None significant

---

## Summary of Changes

| Old Tool Name | New Tool Name | New Parameters | Return Type Change |
|---------------|---------------|----------------|-------------------|
| `update_item_metadata` | `update_item` | `content`, `expected_updated_at` | `str` → `dict` |
| `update_prompt_metadata` | `update_prompt` | `content`, `arguments`, `expected_updated_at` | f-string → JSON |
| `create_prompt` | (no rename) | (none) | f-string → JSON |
| `edit_prompt_template` | (no rename) | (none) | f-string → JSON |

| File | Change Type |
|------|-------------|
| `backend/src/mcp_server/server.py` | Rename tool, add parameters, change return type, update instructions |
| `backend/src/prompt_mcp_server/server.py` | Rename tool, add parameters, change return types, update instructions |
| `frontend/src/pages/settings/SettingsMCP.tsx` | Update tool names and descriptions |
| `backend/tests/mcp_server/test_*.py` | Add tests for content replacement, optimistic locking, structured returns |
| `backend/tests/prompt_mcp_server/test_*.py` | Add tests for content/arguments replacement, optimistic locking, structured returns |

## Tool Selection Guide (for MCP Server Instructions)

The MCP server instructions should include clear guidance for LLMs on when to use each tool:

### Content MCP Server

| Task | Tool | Why |
|------|------|-----|
| Update title, description, tags, or url | `update_item` | Any field update |
| Replace entire content (rewrite) | `update_item` with `content` param | Full replacement |
| Fix a typo in content | `edit_content` | String replacement for targeted edits |
| Insert/delete a paragraph | `edit_content` | String replacement for partial changes |
| Update metadata AND replace content | `update_item` | Single call for both |

### Prompt MCP Server

| Task | Tool | Why |
|------|------|-----|
| Update title, description, tags, or name | `update_prompt` | Any field update |
| Replace entire template (rewrite) | `update_prompt` with `content` + `arguments` | Full replacement (must provide ALL args) |
| Fix a typo in template | `edit_prompt_template` | String replacement for targeted edits |
| Add/remove a variable | `edit_prompt_template` with `arguments` | Atomic content + args update |
| Update metadata AND replace template | `update_prompt` | Single call for both |

**IMPORTANT for `update_prompt`:** When replacing template content that changes variables:
1. You MUST also provide the `arguments` parameter
2. The `arguments` list must include ALL arguments (not just changed ones) - it's a full replacement, not a merge

### Key Distinction

- **`update_*` tools**: Full replacement of any field. All params optional - only provide what you want to change (at least one required).
- **`edit_*` tools**: String replacement (`old_str` → `new_str`) for making targeted changes to content/template without rewriting everything.

### Optimistic Locking

All mutation tools now return `updated_at` in their response. To prevent concurrent edit conflicts:
1. Fetch the item to get current `updated_at`
2. Make your changes
3. Pass `expected_updated_at` with the timestamp from step 1
4. If another edit happened in between, you'll get a 409 Conflict error
5. Re-fetch and retry if needed

---

## Notes for Implementation

1. **No backend API changes needed** - `BookmarkUpdate`, `NoteUpdate`, and `PromptUpdate` schemas already support `content`, `arguments`, and `expected_updated_at`. The MCP tools just need to expose these parameters.

2. **Breaking changes are OK** - Per requirements, no backwards compatibility needed. Just rename the tools directly.

3. **Keep edit tools** - `edit_content` and `edit_prompt_template` remain valuable for targeted edits. The new `update_*` tools complement them for full replacement scenarios.

4. **LLM clarity is critical** - Tool descriptions must clearly state:
   - All parameters are optional - only provide what you want to change (at least one required)
   - `update_*` does FULL REPLACEMENT of content
   - `edit_*` does STRING REPLACEMENT for partial/targeted edits
   - For `update_prompt`: If content changes template variables, MUST also provide `arguments` with ALL args (full replacement, not merge)

5. **Validation must include `content`** - The "at least one field required" check must be updated to include `content` as a valid field.

6. **Structured returns enable optimistic locking** - All mutation tools return `{id, updated_at, ...}` so clients can use `expected_updated_at` on subsequent calls.
