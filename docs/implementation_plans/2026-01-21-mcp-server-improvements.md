# MCP Server Improvements - Implementation Plan

**Date:** 2026-01-21
**Status:** Draft
**Goal:** Improve Prompt MCP server usability for LLM agents by using prompt names instead of UUIDs, adding a `get_prompt_template` tool, and improving tool naming/descriptions.

---

## Background

### Problem Statement

The current Prompt MCP server has usability issues for LLM agents:

1. **UUID Dependency**: The `update_prompt` tool requires a UUID `id`, but LLM agents only receive prompt `name` values from the MCP `list_prompts` capability. This creates a chicken-and-egg problem where agents can't update prompts without first obtaining the UUID through an extra lookup.

2. **No Raw Template Access**: The MCP `get_prompt` capability is defined by the MCP protocol spec (`@server.get_prompt()`) - we implement it but don't control its interface. It renders templates with provided arguments, which means:
   - It fails if required arguments are missing (agent can't inspect a template without providing all required args)
   - It returns rendered content, not the raw Jinja2 template
   - Agents need to see the raw template to make str-replace edits, but have no way to get it

3. **Tool Naming**: `update_prompt` is ambiguous - it could mean metadata or content. Clearer names would improve agent understanding.

### Solution

- Add name-based API endpoints (`PATCH /prompts/name/{name}/str-replace`, `PATCH /prompts/name/{name}`)
- Add `get_prompt_template` tool to return raw template content + arguments
- Rename `update_prompt` → `edit_prompt_template` with `name` parameter instead of `id`
- Add `update_prompt_metadata` tool for title/description/tags/name changes
- Update server instructions and tool descriptions

### Key Design Decisions

1. **Keep both UUID and name in the model**: The Prompt model retains both `id` (UUID) and `name` to maintain compatibility with `BaseEntityService`. The MCP layer exclusively uses `name` for agent-facing operations.

2. **Server-side str-replace**: The API performs string replacement server-side, so the MCP server only needs to pass `name`, `old_str`, `new_str` - no need to fetch full content first.

3. **No `/prompts/name/{name}/search` endpoint**: Prompts are typically small (unlike notes), and the new `get_prompt_template` tool provides the raw content for inspection.

---

## Milestones

### Milestone 1: API Endpoints for Name-Based Operations

**Goal:** Add API endpoints that allow operations using prompt `name` instead of UUID `id`.

**Dependencies:** None

**Key Changes:**

Note: `GET /prompts/name/{name}` already exists (see `backend/src/api/routers/prompts.py:133-181`). Only PATCH endpoints need to be added.

1. **Add `PATCH /prompts/name/{name}/str-replace`** in `backend/src/api/routers/prompts.py`:
   - Mirror existing `PATCH /prompts/{prompt_id}/str-replace` logic
   - Look up prompt by name using `prompt_service.get_by_name()`
   - Same request/response schemas, same validation

2. **Add `PATCH /prompts/name/{name}`** in `backend/src/api/routers/prompts.py`:
   - Mirror existing `PATCH /prompts/{prompt_id}` logic
   - Look up prompt by name using `prompt_service.get_by_name()`
   - Same request/response schemas

**Important: Archived Prompt Behavior**

The name-based endpoints use `prompt_service.get_by_name()` which excludes archived prompts. This is intentional - MCP tools are for active content management, not admin recovery operations. Archived prompts should be restored via the web UI before editing.

This differs from the ID-based endpoints which use `include_archived=True`. The behavior difference is acceptable.

**Implementation Pattern:**

```python
# Example structure for name-based str-replace endpoint
@router.patch(
    "/name/{name}/str-replace",
    response_model=StrReplaceSuccess[PromptResponse] | StrReplaceSuccessMinimal,
)
async def str_replace_prompt_by_name(
    name: str,
    data: PromptStrReplaceRequest,
    include_updated_entity: bool = Query(default=False, ...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> StrReplaceSuccess[PromptResponse] | StrReplaceSuccessMinimal:
    """Same as str_replace_prompt but looks up by name instead of ID."""
    prompt = await prompt_service.get_by_name(db, current_user.id, name)
    if prompt is None:
        raise HTTPException(status_code=404, detail="Prompt not found")
    # ... rest is identical to str_replace_prompt
```

**Testing Strategy:**

- Add tests in `backend/tests/api/test_prompts.py`:
  - `test__str_replace_by_name__success` - basic str-replace by name
  - `test__str_replace_by_name__not_found` - 404 for nonexistent name
  - `test__str_replace_by_name__no_match` - 400 when old_str not found
  - `test__str_replace_by_name__multiple_matches` - 400 with match locations
  - `test__update_by_name__success` - basic metadata update by name
  - `test__update_by_name__not_found` - 404 for nonexistent name
  - `test__update_by_name__name_conflict` - 409 when renaming to existing name

**Success Criteria:**
- Both endpoints work correctly with prompt names
- Error handling matches existing UUID-based endpoints
- All new tests pass

**Risk Factors:**
- Name URL encoding edge cases (names are lowercase-with-hyphens, so should be safe)

---

### Milestone 2: Prompt MCP Server - `get_prompt_template` Tool

**Goal:** Add a tool that returns the raw prompt template content and arguments for viewing/editing.

**Dependencies:** None (can run in parallel with Milestone 1)

**Why This Tool is Needed:**

The MCP protocol defines `get_prompt` (`@server.get_prompt()`) which we implement but don't control. It:
- Renders templates with provided arguments
- Fails if required arguments are missing
- Returns rendered content, not the raw Jinja2 template

This means an agent cannot inspect a template that has required arguments without providing values for them. We need a tool we fully control that returns the raw template.

**Key Changes:**

1. **Add `get_prompt_template` tool** in `backend/src/prompt_mcp_server/server.py`:
   - This is a tool we define (`@server.call_tool()`), not a protocol capability
   - Takes `name` parameter (not `id`)
   - Calls `GET /prompts/name/{name}` API endpoint
   - Returns raw content, arguments, and metadata (id, name, title, description, tags)
   - Does NOT render the template

**Note on Partial Reads:** The API supports `start_line`/`end_line` for partial reads, but this tool intentionally omits them. Prompts have a 100KB size limit (`max_prompt_content_length`) unlike notes which can be much larger. Full content retrieval is acceptable for prompts.

**Tool Schema:**

```python
types.Tool(
    name="get_prompt_template",
    description=(
        "Get a prompt template's raw content and arguments for viewing or editing. "
        "Unlike the get_prompt capability which renders templates, this returns the "
        "raw Jinja2 template content. Use this before edit_prompt_template to see "
        "the current content."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "The prompt name (e.g., 'code-review'). Get names from list_prompts.",
            },
        },
        "required": ["name"],
    },
)
```

**Response Format:**

```json
{
  "id": "uuid-here",
  "name": "code-review",
  "title": "Code Review Assistant",
  "description": "Reviews code for issues",
  "content": "Review this {{ language }} code:\n\n{{ code }}",
  "arguments": [
    {"name": "language", "description": "Programming language", "required": true},
    {"name": "code", "description": "Code to review", "required": true}
  ],
  "tags": ["development"]
}
```

**Testing Strategy:**

- Add tests in `backend/tests/prompt_mcp_server/test_handlers.py`:
  - `test__get_prompt_template__success` - returns raw content and arguments
  - `test__get_prompt_template__not_found` - proper error for nonexistent name
  - `test__get_prompt_template__includes_metadata` - verify all fields present

**Success Criteria:**
- Tool returns raw Jinja2 content (not rendered)
- Includes all metadata needed for editing
- Clear error message when prompt not found

**Risk Factors:**
- None significant

---

### Milestone 3: Prompt MCP Server - Rename and Update `edit_prompt_template`

**Goal:** Rename `update_prompt` to `edit_prompt_template` and change from UUID to name-based lookup.

**Dependencies:** Milestone 1 (needs `PATCH /prompts/name/{name}/str-replace`)

**Key Changes:**

1. **Rename tool** from `update_prompt` to `edit_prompt_template` in `backend/src/prompt_mcp_server/server.py`

2. **Change `id` parameter to `name`**:
   - Parameter name: `id` → `name`
   - Description: Update to explain it's the prompt name from `list_prompts`

3. **Update API call** to use new name-based endpoint:
   - Change from `PATCH /prompts/{prompt_id}/str-replace`
   - To `PATCH /prompts/name/{name}/str-replace`
   - Keep minimal response format (`include_updated_entity=false`) - returns `{match_type, line, data: {id, updated_at}}`
   - If agent needs to verify edit, it can call `get_prompt_template` again

4. **Update tool description** for clarity:
   - Emphasize this edits template content, not metadata
   - Reference `get_prompt_template` for viewing content first

**Updated Tool Schema:**

```python
types.Tool(
    name="edit_prompt_template",
    description=(
        "Edit a prompt template's content using string replacement. Use get_prompt_template "
        "first to see the current content. Optionally update arguments atomically when "
        "adding/removing template variables."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "The prompt name (e.g., 'code-review'). Get names from list_prompts.",
            },
            "old_str": {
                "type": "string",
                "minLength": 1,
                "description": "Exact text to find in the prompt content. Must match exactly one location.",
            },
            "new_str": {
                "type": "string",
                "description": "Replacement text. Use empty string to delete the matched text.",
            },
            "arguments": {
                # ... same as current
            },
        },
        "required": ["name", "old_str", "new_str"],
    },
)
```

**Testing Strategy:**

- Update existing tests in `backend/tests/prompt_mcp_server/test_handlers.py`:
  - Rename test functions from `test__update_prompt__*` to `test__edit_prompt_template__*`
  - Change tool name assertions
  - Change parameter from `id` to `name`
  - Verify API calls go to `/prompts/name/{name}/str-replace`

**Success Criteria:**
- Tool renamed and uses name parameter
- API calls use name-based endpoint
- All existing functionality preserved
- Tests updated and passing

**Risk Factors:**
- Breaking change for any existing integrations (acceptable per requirements)

---

### Milestone 4: Prompt MCP Server - `update_prompt_metadata` Tool

**Goal:** Add a tool for updating prompt metadata (title, description, tags, name) without touching content.

**Dependencies:** Milestone 1 (needs `PATCH /prompts/name/{name}`)

**Key Changes:**

1. **Add `update_prompt_metadata` tool** in `backend/src/prompt_mcp_server/server.py`:
   - Takes `name` parameter to identify the prompt
   - Optional parameters: `new_name`, `title`, `description`, `tags`
   - Does NOT expose `content` or `arguments` (use `edit_prompt_template` for those)
   - Calls `PATCH /prompts/name/{name}` API endpoint

**Tool Schema:**

```python
types.Tool(
    name="update_prompt_metadata",
    description=(
        "Update a prompt's metadata (title, description, tags, or name). "
        "To edit template content or arguments, use edit_prompt_template instead."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "name": {
                "type": "string",
                "description": "Current prompt name (e.g., 'code-review'). Get names from list_prompts.",
            },
            "new_name": {
                "type": "string",
                "description": "New name for the prompt (optional). Must be unique and lowercase-with-hyphens.",
            },
            "title": {
                "type": "string",
                "description": "New human-readable title (optional).",
            },
            "description": {
                "type": "string",
                "description": "New description (optional).",
            },
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "New tags list (optional). Replaces all existing tags.",
            },
        },
        "required": ["name"],
    },
)
```

**Implementation Notes:**
- When calling the API, map `new_name` → `name` in the payload (the API's `PromptUpdate` schema uses `name` for the new name)
- Only include fields that were provided (don't send nulls for omitted fields)

**Testing Strategy:**

- Add tests in `backend/tests/prompt_mcp_server/test_handlers.py`:
  - `test__update_prompt_metadata__update_title` - update just title
  - `test__update_prompt_metadata__update_tags` - update tags
  - `test__update_prompt_metadata__rename` - change prompt name
  - `test__update_prompt_metadata__rename_conflict` - 409 when new name exists
  - `test__update_prompt_metadata__not_found` - 404 for nonexistent name

**Success Criteria:**
- Tool can update any combination of metadata fields
- Rename works correctly with proper error on conflict
- Does not expose content/arguments parameters

**Risk Factors:**
- Rename could break references if users aren't careful (acceptable, API returns proper error)

---

### Milestone 5: Update Server Instructions and Tool Descriptions

**Goal:** Update the Prompt MCP server instructions and all tool descriptions to address usability issues identified from an LLM agent perspective.

**Dependencies:** Milestones 2, 3, 4

**Key Changes:**

Rewrite server instructions and tool descriptions to address the following issues identified during review:

**Issues with Current Server Instructions:**

1. **Remove confusing "Prompts capability" section**: The current instructions list `list_prompts` and `get_prompt` under "Prompts (MCP prompts capability)" but these are MCP protocol-level capabilities (`@server.list_prompts()`, `@server.get_prompt()`), not tools the agent can call. This creates confusion - agents see them listed but can't invoke them as tools. Remove this section entirely or clarify that:
   - These are MCP protocol capabilities, not tools
   - The agent's MCP client handles them automatically (e.g., prompts appear in system prompt)
   - They cannot be invoked like tools
   - `get_prompt` renders templates and requires all required arguments - use `get_prompt_template` tool to view raw templates

2. **Workflow examples reference non-callable capabilities**: Example 2 shows `get_prompt(name="code-review", arguments={})` as if it's a tool call, but agents can't call it directly. Update examples to only reference actual tools.

3. **Update tool list**: Reflect the new tools (`get_prompt_template`, `edit_prompt_template`, `update_prompt_metadata`) and remove references to old `update_prompt` tool.

4. **Update all examples to use `name` instead of `id`**: Remove any workflow examples that reference UUID lookups.

**Clarifications to Add to Tool Descriptions:**

1. **`create_prompt`**:
   - What happens if name already exists? (Returns 409 conflict error)
   - What does the tool return on success? (Created prompt with id, name, etc.)
   - Are unused arguments (defined but not in template) an error? (Yes, validation fails)

2. **`edit_prompt_template`**:
   - What if `old_str` matches zero times? (Returns error with `no_match`)
   - What if `old_str` matches multiple times? (Returns error with `multiple_matches` and match locations)
   - Clarify that this is for template content only, not metadata

3. **`update_prompt_metadata`**:
   - Clarify this is for metadata only (title, description, tags, name)
   - What happens on rename conflict? (Returns 409 error)

4. **`get_prompt_template`**:
   - Clarify difference from MCP `get_prompt` capability (raw template vs rendered)
   - When to use: before editing, to inspect template structure

**General Improvements:**

1. **Error response documentation**: Briefly describe what error responses look like so agents know what to expect

2. **Trigger phrases**: Consider whether "my prompts" (without mentioning tiddly) should trigger this server, or only explicit references to tiddly/tiddly.me

3. **Delete capability**: Note that there is no delete tool (if that's intentional) so agents don't search for one

4. **Race condition handling**: Document that if a prompt is renamed (e.g., via web UI) between `get_prompt_template` and `edit_prompt_template` calls, the agent will get a 404. This is standard race condition behavior - agents should re-fetch on 404.

5. **Archived prompts**: Document that MCP tools only work with active prompts. Archived prompts must be restored via web UI before editing.

**Testing Strategy:**
- Manual review of updated instructions for clarity and accuracy
- Verify all referenced tools actually exist
- Verify example workflows only use callable tools
- Have a fresh LLM agent review the instructions and identify any remaining confusion

**Success Criteria:**
- No references to `list_prompts`/`get_prompt` as callable tools
- All examples use actual tool names with `name` parameter
- Tool descriptions include error behavior
- Instructions are self-contained (agent doesn't need external docs)

**Risk Factors:**
- None significant

---

### Milestone 6: Update Evals

**Goal:** Update the prompt MCP evaluation tests to use `get_prompt_template` directly instead of simulating it.

**Dependencies:** Milestones 2, 3

**Key Changes:**

1. **Update `evals/prompt_mcp/test_update_prompt.py`**:
   - Rename file to `test_edit_prompt_template.py`
   - Use MCP `get_prompt_template` tool instead of `get_prompt_via_api()` + `_format_prompt_for_llm()`
   - Update tool name references from `update_prompt` to `edit_prompt_template`
   - Change parameter references from `id` to `name`

2. **Update `evals/prompt_mcp/config_update_prompt.yaml`**:
   - Rename to `config_edit_prompt_template.yaml`
   - Update tool name in checks

3. **Update helper functions in `evals/utils.py`** if needed

**Key Code Changes:**

```python
# Before (simulating get_prompt):
prompt_data = await get_prompt_via_api(prompt_id)
prompt_display = _format_prompt_for_llm(prompt_data)

# After (using actual MCP tool):
# Call get_prompt_template via MCP
get_template_result = await mcp_manager.call_tool(
    "get_prompt_template",
    {"name": unique_name}
)
prompt_display = _format_template_response(get_template_result)
```

**Testing Strategy:**
- Run evals to verify they still work correctly
- Verify LLM can successfully use the new tool names

**Success Criteria:**
- Evals use actual MCP tools instead of API simulation
- All eval test cases pass
- Tool predictions use correct new tool names

**Risk Factors:**
- Eval results may differ slightly due to tool changes (monitor and adjust thresholds if needed)

---

### Milestone 7: Content MCP Server Review and Recommendations

**Goal:** Review the Content MCP server for similar improvements and document recommendations.

**Dependencies:** None (can be done anytime)

**Key Changes:**

1. **Review `backend/src/mcp_server/server.py`** for:
   - Tool naming consistency
   - Description clarity
   - Workflow examples accuracy
   - Any similar UUID vs name issues (Content MCP uses UUIDs which is appropriate for bookmarks/notes)

2. **Document recommendations** for any improvements found

**Current Observations:**

The Content MCP server (`mcp_server/server.py`) is generally well-structured. Key differences from Prompt MCP:

- Uses UUID `id` for content items - this is appropriate since bookmarks/notes don't have user-friendly unique names like prompts do
- Tool naming is clear (`get_content`, `edit_content`, `search_in_content`)
- Instructions and workflows are comprehensive

**Potential Improvements to Consider:**

1. **Server instructions clarity**: Ensure "tiddly.me" branding is consistent
2. **Tool descriptions**: Review for any unclear wording
3. **Error messages**: Ensure consistency with Prompt MCP

**Deliverable:** A brief document or comments in the implementation PR noting any recommended improvements for Content MCP. These would be tracked as separate follow-up work if non-trivial.

**Success Criteria:**
- Content MCP reviewed for consistency issues
- Recommendations documented
- No blocking changes required for this plan

**Risk Factors:**
- May uncover larger issues requiring separate work

---

## Summary of All Changes

### API Changes (`backend/src/api/routers/prompts.py`)
- Add `PATCH /prompts/name/{name}/str-replace`
- Add `PATCH /prompts/name/{name}`

### Prompt MCP Server Changes (`backend/src/prompt_mcp_server/server.py`)
- Add `get_prompt_template` tool
- Rename `update_prompt` → `edit_prompt_template`, change `id` → `name`
- Add `update_prompt_metadata` tool
- Update server instructions

### Test Changes
- `backend/tests/api/test_prompts.py` - new endpoint tests
- `backend/tests/prompt_mcp_server/test_handlers.py` - new/updated tool tests
- `evals/prompt_mcp/test_update_prompt.py` → `test_edit_prompt_template.py`

### No Changes Needed
- Prompt model (keeps both UUID `id` and `name`)
- PromptService (already has `get_by_name()`)
- Content MCP server (review only, no changes in this plan)

---

## Implementation Notes

### Order of Implementation
Milestones can be partially parallelized:
- Milestone 1 (API) and Milestone 2 (`get_prompt_template`) can run in parallel
- Milestones 3, 4 depend on Milestone 1
- Milestone 5 depends on Milestones 2, 3, 4
- Milestone 6 depends on Milestones 2, 3
- Milestone 7 can run anytime

### Testing Approach
- Each milestone includes its own tests
- Run full test suite after each milestone
- Run evals after Milestone 6 to verify LLM behavior

### Breaking Changes
This plan introduces breaking changes to the Prompt MCP server:
- `update_prompt` tool is renamed to `edit_prompt_template`
- `id` parameter becomes `name`

Per requirements, backwards compatibility is not required. These are improvements to the design.
