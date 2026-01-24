# Implementation Plan: Consolidate MCP Update Tools

## Overview

Consolidate `update_item_metadata` → `update_item` and `update_prompt_metadata` → `update_prompt` to support both metadata updates AND full content replacement. This addresses the limitation that string replacement (`edit_content`/`edit_prompt_template`) is difficult for long or wholesale content changes.

**Key insight:** The REST API already supports `content` in update schemas (`BookmarkUpdate`, `NoteUpdate`, `PromptUpdate`). The MCP tools simply don't expose this parameter. This is primarily an MCP tool interface change, not a backend change.

---

## Milestone 1: Content MCP Server - Rename and Extend `update_item`

### Goal
Rename `update_item_metadata` → `update_item` and add `content` parameter for full content replacement.

### Key Changes

**File: `backend/src/mcp_server/server.py`**

1. **Rename the tool function:** `update_item_metadata` → `update_item`

2. **Update tool description:**
   ```python
   @mcp.tool(
       description=(
           "Update a bookmark or note. Can update metadata (title, description, tags, url) "
           "and/or fully replace content. For targeted content edits, use edit_content instead."
       ),
       annotations={"readOnlyHint": False, "destructiveHint": True},
   )
   ```

3. **Add `content` parameter:**
   ```python
   content: Annotated[
       str | None,
       Field(description="New content (full replacement). Omit to leave unchanged."),
   ] = None,
   ```

4. **Update validation:** Allow `content` as a valid field alongside existing fields

5. **Update payload building:** Include `content` in the payload if provided

6. **Update MCP server instructions:** Update the tool descriptions in the `instructions` string at the top of the file

**File: `frontend/src/pages/settings/SettingsMCP.tsx`**

1. Rename `update_item_metadata` → `update_item` in the tool list
2. Update description to mention content replacement capability

### Success Criteria
- `update_item` tool accepts `content` parameter
- Providing `content` fully replaces the item's content field
- Existing metadata-only updates continue to work
- `edit_content` tool still works for targeted string replacement
- MCP server instructions reflect the new tool name and capability
- Frontend Settings page shows updated tool name and description

### Testing Strategy
- **Unit tests:** Add/update tests in `backend/tests/mcp_server/` for:
  - `update_item` with content-only update
  - `update_item` with metadata-only update (regression)
  - `update_item` with both content and metadata
  - Verify `content` fully replaces (not appends)
- **Integration:** Verify via MCP client that tool schema shows `content` parameter

### Dependencies
None - this is the first milestone

### Risk Factors
- Ensure backwards compatibility is NOT a concern (breaking changes are OK per requirements)
- Verify the API endpoint handles `content` in PATCH correctly (it should - schemas already support it)

---

## Milestone 2: Prompt MCP Server - Rename and Extend `update_prompt`

### Goal
Rename `update_prompt_metadata` → `update_prompt` and add `content` and `arguments` parameters for full template replacement.

### Key Changes

**File: `backend/src/prompt_mcp_server/server.py`**

1. **Rename in tool list:** Change tool name from `update_prompt_metadata` to `update_prompt`

2. **Update tool description:**
   ```python
   types.Tool(
       name="update_prompt",
       description=(
           "Update a prompt. Can update metadata (title, description, tags, name) "
           "and/or fully replace template content and arguments. "
           "For targeted template edits, use edit_prompt_template instead."
       ),
       ...
   )
   ```

3. **Add `content` and `arguments` to inputSchema:**
   ```python
   "content": {
       "type": "string",
       "description": (
           "New template content (full replacement). Omit to leave unchanged. "
           "When replacing content, you may also need to update arguments."
       ),
   },
   "arguments": {
       "type": "array",
       "description": (
           "New arguments list (full replacement). Omit to leave unchanged. "
           "If provided, FULLY REPLACES all existing arguments."
       ),
       "items": { ... same schema as edit_prompt_template ... }
   },
   ```

4. **Update handler:** `_handle_update_prompt_metadata` → `_handle_update_prompt`
   - Add `content` and `arguments` to the field mapping
   - Include them in the payload if provided

5. **Update dispatch table:** Change key from `"update_prompt_metadata"` to `"update_prompt"`

6. **Update MCP server instructions:** Update the tool list and example workflows

**File: `frontend/src/pages/settings/SettingsMCP.tsx`**

1. Rename `update_prompt_metadata` → `update_prompt` in the tool list
2. Update description: "Update metadata, content, or arguments"
3. **Fix the `edit_prompt_template` description:** Change "Edit content using string replacement" to "Edit template using string replacement"

### Success Criteria
- `update_prompt` tool accepts `content` and `arguments` parameters
- Providing `content` fully replaces the prompt's template
- Providing `arguments` fully replaces the prompt's arguments list
- Existing metadata-only updates continue to work
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
- **Integration:** Verify via MCP client that tool schema shows new parameters

### Dependencies
- Milestone 1 should be complete first (for consistency, though technically independent)

### Risk Factors
- Prompts have Jinja2 template validation - ensure content updates trigger validation
- Arguments must be consistent with template variables - document this clearly in tool description
- The prompt service already validates content+arguments consistency, so this should work

---

## Milestone 3: Documentation and Instructions Update

### Goal
Update all MCP server instructions, CLAUDE.md, and any other documentation to reflect the renamed tools and new capabilities.

### Key Changes

**File: `CLAUDE.md`**
- No changes needed - it doesn't list individual MCP tools

**MCP Server Instructions (already covered in M1/M2, but verify):**
- `backend/src/mcp_server/server.py` - instructions string
- `backend/src/prompt_mcp_server/server.py` - instructions string

**Verify tool descriptions are clear about:**
- `update_item` / `update_prompt` - for metadata OR full content replacement
- `edit_content` / `edit_prompt_template` - for targeted string replacement
- When to use which tool

### Success Criteria
- MCP server instructions clearly document both update patterns
- Tool descriptions distinguish between full replacement and targeted editing
- No references to old tool names (`update_item_metadata`, `update_prompt_metadata`)

### Testing Strategy
- Manual review of all instruction strings
- Verify no old tool names remain in codebase (grep search)

### Dependencies
- Milestones 1 and 2

### Risk Factors
- None significant

---

## Summary of Changes

| Old Tool Name | New Tool Name | New Parameters Added |
|---------------|---------------|---------------------|
| `update_item_metadata` | `update_item` | `content` |
| `update_prompt_metadata` | `update_prompt` | `content`, `arguments` |

| File | Change Type |
|------|-------------|
| `backend/src/mcp_server/server.py` | Rename tool, add parameter, update instructions |
| `backend/src/prompt_mcp_server/server.py` | Rename tool, add parameters, update instructions |
| `frontend/src/pages/settings/SettingsMCP.tsx` | Update tool names and descriptions |
| `backend/tests/mcp_server/test_*.py` | Add tests for content replacement |
| `backend/tests/prompt_mcp_server/test_*.py` | Add tests for content/arguments replacement |

## Notes for Implementation

1. **No backend API changes needed** - `BookmarkUpdate`, `NoteUpdate`, and `PromptUpdate` schemas already support `content` (and `arguments` for prompts). The MCP tools just need to expose these parameters.

2. **Breaking changes are OK** - Per requirements, no backwards compatibility needed. Just rename the tools directly.

3. **Keep edit tools** - `edit_content` and `edit_prompt_template` remain valuable for targeted edits. The new `update_*` tools complement them for full replacement scenarios.
