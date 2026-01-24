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

2. **Update tool description** (must be clear for LLMs):
   ```python
   @mcp.tool(
       description=(
           "Update a bookmark or note. All parameters are optional - only provide the fields "
           "you want to change. Can update metadata (title, description, tags, url) and/or "
           "fully replace content. "
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

4. **Update validation:** Allow `content` as a valid field alongside existing fields

5. **Update payload building:** Include `content` in the payload if provided

6. **Update MCP server instructions:** Update the `instructions` string to include:
   - Updated tool list with `update_item` (not `update_item_metadata`)
   - Clear guidance: "Use `update_item` for full content replacement, `edit_content` for targeted string-based edits"
   - Note that all `update_item` parameters are optional

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

2. **Update tool description** (must be clear for LLMs):
   ```python
   types.Tool(
       name="update_prompt",
       description=(
           "Update a prompt. All parameters are optional - only provide the fields you want "
           "to change. Can update metadata (title, description, tags, name) and/or fully "
           "replace template content and arguments. "
           "NOTE: To make partial/targeted edits to the template using string replacement, "
           "use edit_prompt_template instead. This tool replaces the entire content field."
       ),
       ...
   )
   ```

3. **Add `content` and `arguments` to inputSchema:**
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
   ```

4. **Update handler:** `_handle_update_prompt_metadata` → `_handle_update_prompt`
   - Add `content` and `arguments` to the field mapping
   - Include them in the payload if provided

5. **Update dispatch table:** Change key from `"update_prompt_metadata"` to `"update_prompt"`

6. **Update MCP server instructions:** Update the `instructions` string to include:
   - Updated tool list with `update_prompt` (not `update_prompt_metadata`)
   - Clear guidance: "Use `update_prompt` for full template replacement, `edit_prompt_template` for targeted string-based edits"
   - Note that all `update_prompt` parameters are optional
   - **Critical warning:** When using `update_prompt` with `content` that changes template variables, you MUST also provide `arguments` with ALL arguments (full replacement, not merge)
   - Update example workflows to show both patterns

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
- Arguments must be consistent with template variables - the backend validates this
- **Critical for LLM clarity:** When `content` changes template variables, the LLM must:
  1. Also provide `arguments` parameter
  2. Include ALL arguments in the list (full replacement, not merge)
- The tool description MUST make this explicit or LLMs will forget to update arguments

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
- `edit_content` / `edit_prompt_template` - for targeted string replacement (partial edits)
- All params are optional on `update_*` tools - only provide what you want to change
- Include the "Tool Selection Guide" (see below) in the MCP server instructions

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

- **`update_*` tools**: Full replacement of any field. All params optional - only provide what you want to change.
- **`edit_*` tools**: String replacement (`old_str` → `new_str`) for making targeted changes to content/template without rewriting everything.

---

## Notes for Implementation

1. **No backend API changes needed** - `BookmarkUpdate`, `NoteUpdate`, and `PromptUpdate` schemas already support `content` (and `arguments` for prompts). The MCP tools just need to expose these parameters.

2. **Breaking changes are OK** - Per requirements, no backwards compatibility needed. Just rename the tools directly.

3. **Keep edit tools** - `edit_content` and `edit_prompt_template` remain valuable for targeted edits. The new `update_*` tools complement them for full replacement scenarios.

4. **LLM clarity is critical** - Tool descriptions must clearly state:
   - All parameters are optional (only provide what you want to change)
   - `update_*` does FULL REPLACEMENT of content
   - `edit_*` does STRING REPLACEMENT for partial/targeted edits
   - For `update_prompt`: If content changes template variables, MUST also provide `arguments` with ALL args (full replacement, not merge)
