# Content Editing API for AI Agents

**Date:** 2026-01-19
**Status:** Draft - Awaiting Review

## Overview

Add AI-friendly editing capabilities to the content management API. The design prioritizes content-based (string matching) operations over line-number-based operations, based on empirical evidence from production AI coding tools (Claude Code, Aider, Cursor) showing LLMs perform poorly with line numbers.

### Goals

- Enable AI agents to make targeted edits to notes, bookmarks, and prompts without replacing entire content
- Provide within-content search to help agents locate and construct unique match strings
- Consolidate MCP tools to reduce cognitive load on AI agents
- Support partial reads for large documents (pagination via line ranges)

### Key Design Decisions

1. **Content-based matching (str_replace)** - Primary edit operation requires unique string match
2. **No line numbers in GET responses** - Prevents AI from trying to use them in edits
3. **Line numbers in error messages and search results** - For navigation/understanding only
4. **Progressive fuzzy matching** - Fallback strategy: exact → whitespace-normalized (indentation-relative deferred to future)
5. **Per-content-type API endpoints** - API stays consistent (`/notes/{id}/...`, `/bookmarks/{id}/...`, `/prompts/{id}/...`)
6. **Consolidated MCP tools** - MCP tools accept `type` parameter and route to appropriate API endpoint
7. **Content MCP vs Prompt MCP** - Content MCP handles bookmarks/notes; Prompt MCP handles prompts separately (different capabilities)

### Line Counting Convention

Lines are counted using simple split semantics: `total_lines = len(content.split('\n'))`

| Content | Line count |
|---------|------------|
| `"hello"` | 1 |
| `"hello\n"` | 2 |
| `"hello\nworld"` | 2 |
| `"hello\nworld\n"` | 3 |

This matches what editors like VS Code and Sublime display.

---

## Milestone 1: Within-Content Search API Endpoints

### Goal

Add endpoints to search within a single content item's text fields, returning matches with line numbers and context.

### Use Cases

This endpoint serves several purposes for AI agents:
1. **Pre-edit validation** - Confirm how many matches exist before attempting str_replace (avoid "multiple matches" errors)
2. **Context building** - Get surrounding lines to construct a unique `old_str` for editing
3. **Content discovery** - Find where specific text appears in a document without reading the entire content into context
4. **General search** - Non-editing use cases where agents need to locate information within content

Document these use cases in the endpoint's OpenAPI description and docstrings.

### Dependencies

None - can be implemented independently.

### Key Changes

**New endpoints:**
- `GET /notes/{id}/search`
- `GET /bookmarks/{id}/search`
- `GET /prompts/{id}/search`

```python
# Query parameters
q: str                          # Required search query (literal match)
fields: str = "content"         # Comma-separated: "content", "title", "description"
case_sensitive: bool = False    # Default case-insensitive
context_lines: int = 2          # Lines before/after match for context (content field only)

# Response
{
    "matches": [
        {
            "field": "content",
            "line": 15,
            "context": "line 13 content\nline 14 content\nline 15 with match\nline 16 content\nline 17 content"
        },
        {
            "field": "title",
            "line": null,  # null for non-content fields
            "context": "Full Title With Match Here"  # Full value for short fields
        },
        {
            "field": "description",
            "line": null,
            "context": "Full description text containing the match"  # Full value for short fields
        }
    ],
    "total_matches": 3
}
```

**Response semantics:**
- **No matches found:** Returns `{"matches": [], "total_matches": 0}` with HTTP 200 (success, not error)
- **For `content` field:** Uses `context_lines` parameter to return surrounding lines
- **For `title`/`description` fields:** Returns full field value as context (these are typically short)

**Implementation notes:**
- Add to respective routers: `bookmarks.py`, `notes.py`, `prompts.py`
- Create shared search logic in `backend/src/services/content_search_service.py`
- The service should:
  - Split content into lines and search for query matches
  - Return line numbers (1-indexed) and surrounding context lines
  - Search specified fields only
  - Handle case sensitivity
  - For title/description: return full value, line=null

**Files to read first:**
- `backend/src/api/routers/notes.py` - existing endpoint patterns
- `backend/src/services/base_entity_service.py` - understand service patterns

### Testing Strategy

- Test searching in each content type (bookmark, note, prompt)
- Test multiple fields: `fields=content,title,description`
- Test case sensitivity: `case_sensitive=true` vs default
- Test `context_lines` parameter with various values
- Test multiple matches in same content
- Test no matches found (empty results array with 200, not error)
- Test match at beginning/end of content (context truncation)
- Test with special characters in query
- Test 404 when ID not found
- Test title/description return full value as context

### Success Criteria

- [ ] Each content type has its own search endpoint
- [ ] Endpoint returns matches with line numbers and context
- [ ] Supports searching multiple fields
- [ ] Case sensitivity option works correctly
- [ ] Context lines count is configurable (for content field)
- [ ] Title/description return full value as context
- [ ] Returns empty matches array (not error) when no matches
- [ ] Use cases documented in OpenAPI/docstrings
- [ ] Tests cover all content types and edge cases

### Risk Factors

- Performance with very large content (mitigated by returning only context lines, not full content)

---

## Milestone 2: Partial Content Read (Pagination)

### Goal

Support reading a portion of content by line range for large documents. Prevents loading entire content into AI context.

### Dependencies

None - can be implemented independently (parallel with Milestone 1).

### Key Changes

**Modify existing endpoints:**
- `GET /bookmarks/{id}?start_line=X&end_line=Y`
- `GET /notes/{id}?start_line=X&end_line=Y`
- `GET /prompts/{id}?start_line=X&end_line=Y`
- `GET /prompts/name/{name}?start_line=X&end_line=Y`

**New shared modules:**
- `backend/src/schemas/content_metadata.py` - ContentMetadata schema (shared across response types)
- `backend/src/services/content_lines.py` - Line counting and extraction utilities

```python
# backend/src/schemas/content_metadata.py
class ContentMetadata(BaseModel):
    total_lines: int
    start_line: int
    end_line: int
    is_partial: bool
```

```python
# backend/src/services/content_lines.py
def count_lines(content: str) -> int:
    """Count lines using split semantics: len(content.split('\\n'))"""

def extract_lines(content: str, start_line: int, end_line: int) -> str:
    """Extract line range (1-indexed, inclusive). Caller handles validation."""
```

**Response additions:**
```python
{
    # Existing fields (title, description, tags, etc.) - always returned in full
    "content": "...",  # Only lines X through Y when partial read requested
    "content_metadata": {
        "total_lines": 150,
        "start_line": 50,
        "end_line": 100,
        "is_partial": true
    }
}
```

**Query parameters:**
```python
start_line: int | None = None  # Start line (1-indexed). Defaults to 1 if end_line provided.
end_line: int | None = None    # End line (1-indexed, inclusive). Defaults to total_lines if start_line provided.
```

**Parameter combinations:**

| `start_line` | `end_line` | Behavior |
|--------------|------------|----------|
| Provided | Provided | Partial read from start_line to end_line |
| Provided | Omitted | Read from start_line to end of content |
| Omitted | Provided | Read from line 1 to end_line |
| Omitted | Omitted | Full content read |

**Behavior:**
- **Scope:** Partial read only affects the `content` field. All other fields (title, description, tags, etc.) are always returned in full.
- **`content_metadata` presence:**
  - When `content` is non-null: Always include `content_metadata`
  - When `content` is null: Omit `content_metadata` (no lines to count)
- **`is_partial` flag:**
  - `true` when returning a subset of lines (any line param provided)
  - `false` when returning full content (no line params)
- **Null content with line params:** Return **400 error** with message "Content is empty; cannot retrieve lines"
- **Empty string content (`""`):** Treated as valid content with 1 line (since `"".split('\n')` = `['']`). Returns `content: ""` with `total_lines: 1`. This differs from null content - null means "no content exists", empty string means "content exists but is empty".
- **`start_line` out of range (> total_lines):** Return **400 error** with message indicating total lines
- **`end_line` out of range (> total_lines):** **Clamp** to total_lines (no error, return what exists)
- **`start_line > end_line`:** Return **400 error**
- Lines are 1-indexed
- Line count uses simple split: `total_lines = len(content.split('\n'))`

**Files to modify:**
- `backend/src/api/routers/bookmarks.py` - add params to `get_bookmark()`
- `backend/src/api/routers/notes.py` - add params to `get_note()`
- `backend/src/api/routers/prompts.py` - add params to `get_prompt()` and `get_prompt_by_name()`
- `backend/src/schemas/bookmark.py` - add `content_metadata: ContentMetadata | None` to BookmarkResponse
- `backend/src/schemas/note.py` - add `content_metadata: ContentMetadata | None` to NoteResponse
- `backend/src/schemas/prompt.py` - add `content_metadata: ContentMetadata | None` to PromptResponse

### Testing Strategy

**Unit tests for content_lines.py:**
- Test `count_lines()` with various inputs (empty string, single line, trailing newline)
- Test `count_lines("")` returns 1 (empty string splits to `['']`)
- Test `extract_lines()` with valid ranges
- Test `extract_lines("", 1, 1)` returns `""`
- Test line counting matches convention: `"hello"` = 1, `"hello\n"` = 2, `"hello\nworld\n"` = 3

**API integration tests:**
- Test partial read with valid line ranges
- Test full content when no line params (content_metadata present with is_partial=false)
- Test `start_line` only (reads to end)
- Test `end_line` only (reads from line 1)
- Test `start_line` > total_lines returns 400
- Test `end_line` > total_lines clamps correctly
- Test `start_line` > `end_line` returns 400
- Test null content with no line params (content_metadata omitted)
- Test null content with line params returns 400
- Test empty string content (`""`) with no line params (content_metadata shows total_lines=1)
- Test empty string content with `start_line=1` succeeds (returns `""`, total_lines=1)
- Test content_metadata accuracy (total_lines, start_line, end_line, is_partial)
- Test edge cases: single line content, last line, first line
- Test that title, description, tags are returned in full regardless of line params
- Test all four endpoints (bookmarks, notes, prompts by ID, prompts by name)

### Success Criteria

- [ ] Shared `ContentMetadata` schema created
- [ ] Shared `content_lines.py` utility created with `count_lines()` and `extract_lines()`
- [ ] All four GET endpoints support `start_line` and `end_line` params
- [ ] `content_metadata` included whenever content is non-null
- [ ] `content_metadata` omitted when content is null
- [ ] `is_partial` correctly reflects whether a subset was requested
- [ ] `start_line` defaults to 1 when only `end_line` provided
- [ ] `end_line` defaults to total_lines when only `start_line` provided
- [ ] Null content with line params returns 400
- [ ] `start_line` out of range returns 400
- [ ] `end_line` out of range clamps gracefully
- [ ] Line counting matches editor conventions
- [ ] Other fields (title, description, tags) unaffected by line params
- [ ] Tests cover all endpoints and edge cases

### Risk Factors

- None significant

---

## Milestone 3: String Replace Edit Endpoints

### Goal

Implement the primary editing operation: content-based string replacement with unique match requirement.

### Dependencies

None - can be implemented independently.

### Key Changes

**New endpoints:**
- `PATCH /notes/{id}/str-replace`
- `PATCH /bookmarks/{id}/str-replace`
- `PATCH /prompts/{id}/str-replace`

```python
# Request body
{
    "old_str": "exact content to find\nincluding multiple lines",
    "new_str": "replacement content"
}

# Success response (200)
{
    "success": true,
    "match_type": "exact",  # or "whitespace_normalized"
    "line": 15,  # Line number where match was found
    "type": "note",
    "id": "...",
    # Full updated entity response (NoteResponse, BookmarkResponse, or PromptResponse)
}

# Error response (400) - no matches
{
    "error": "no_match",
    "message": "The specified text was not found in the content",
    "suggestion": "Verify the text exists and check for whitespace differences"
}

# Error response (400) - multiple matches
{
    "error": "multiple_matches",
    "matches": [
        {
            "line": 15,
            "context": "line 13 content\nline 14 content\nline 15 with match\nline 16 content\nline 17 content"
        },
        {
            "line": 47,
            "context": "line 45 content\nline 46 content\nline 47 with match\nline 48 content\nline 49 content"
        }
    ],
    "suggestion": "Include more surrounding context to ensure uniqueness"
}
```

**Error response semantics:**
- Search endpoint: No matches → `{"matches": [], "total_matches": 0}` with HTTP 200 (valid answer to "what's here?")
- str-replace endpoint: No matches → HTTP 400 with `error: "no_match"` (failure - you asked to replace something that doesn't exist)

This distinction is intentional. Document clearly in API docs.

**Error context formatting:**
- Use same `context_lines` default (2 lines before/after) as search endpoint for consistency
- Matches in error responses use same format as search results

**Progressive matching strategy:**

The str-replace operation uses progressive matching to handle minor whitespace differences while preferring exact matches.

**Matching order:**
1. **Exact match** (try first) - Search for `old_str` verbatim in content
2. **Whitespace-normalized match** (fallback if exact fails) - Normalize both `old_str` AND content, then search

**Whitespace normalization definition:**
- Normalize line endings: `\r\n` → `\n`
- Strip trailing whitespace from each line

**Important:** Normalization is applied to **both** `old_str` and content for comparison purposes only. The actual replacement uses the original character positions in the content. This means:
- If content has `"hello  \nworld"` and `old_str` is `"hello\nworld"`, the normalized match finds it
- The replacement still happens at the exact positions in the original content

**Response `match_type` values:**
- `"exact"` - The `old_str` was found character-for-character in the content
- `"whitespace_normalized"` - Exact match failed, but match found after whitespace normalization

This information helps AI agents understand when their context had whitespace differences from the actual content.

**Line ending behavior:**
- **Matching:** Uses normalization (so `\r\n` in content matches `\n` in `old_str`)
- **Replacement:** Literal - `new_str` is inserted exactly as provided

**Implementation notes:**
- Create `backend/src/services/content_edit_service.py` for shared edit logic
- Create shared error response schemas in `backend/src/schemas/errors.py` for `no_match`, `multiple_matches`, etc. This ensures consistency and provides OpenAPI documentation.
- The service should:
  - Find all occurrences of `old_str` using progressive matching
  - If 0 matches: return error with suggestion
  - If 1 match: perform replacement, return success with match_type
  - If multiple matches: return error with match locations and contexts (2 context lines)
- Update the entity via existing service update methods
- **For prompts:** After content replacement, validate the updated Jinja2 template. Return 400 if template becomes invalid.
- **Rate limiting:** PATCH endpoints are classified as "write" operations. Verify this is automatic in the existing rate limiter (based on HTTP method).

**Files to read first:**
- `backend/src/services/note_service.py` - understand update patterns
- `backend/src/services/base_entity_service.py` - base update method
- `backend/src/services/prompt_service.py` - template validation logic
- `backend/src/core/rate_limiter.py` - verify PATCH → write classification

### Testing Strategy

- Test successful single-match replacement
- Test no match found error (returns 400, not empty success)
- Test multiple matches error (with correct line numbers and 2 context lines)
- Test each fallback level: exact, whitespace normalized
- Test multiline old_str
- Test replacement that changes line count
- Test empty new_str (deletion via str_replace)
- Test preserving other fields (tags, title, etc.)
- Test with each content type
- Test line ending normalization (content with `\r\n`, old_str with `\n`)
- **For prompts:** Test that invalid Jinja2 after edit returns 400

### Success Criteria

- [ ] Each content type has its own str-replace endpoint
- [ ] Single unique match triggers successful replacement
- [ ] Zero matches returns 400 error (not empty success)
- [ ] Multiple matches returns locations with 2 context lines each
- [ ] Both fallback levels (exact, whitespace normalized) implemented and working
- [ ] Response includes match_type used
- [ ] Line ending behavior documented and tested
- [ ] Prompt template validation after edit
- [ ] Shared error schemas created in `schemas/errors.py`
- [ ] Tests cover all scenarios

### Risk Factors

- None significant (indentation-relative matching deferred to future enhancement)

---

## Milestone 4: Content MCP Tool Consolidation

### Goal

Add consolidated MCP tools (`get_content`, `edit_content`, `search_in_content`) to the Content MCP server. These tools require a `type` parameter and route to the appropriate per-type API endpoint.

**Breaking Change:** This milestone removes the existing `get_bookmark` and `get_note` tools. Document this in release notes.

**Scope:** Content MCP handles bookmarks and notes only. Prompts are handled separately by the Prompt MCP server (see Milestone 5).

### Dependencies

Milestones 1, 2, 3 (API endpoints must exist first).

### Key Changes

**File:** `backend/src/mcp_server/server.py`

**New tools:**

```python
@mcp.tool(
    description="Get a bookmark or note by ID. Supports partial reads for large content.",
    annotations={"readOnlyHint": True}
)
async def get_content(
    id: Annotated[str, Field(description="The content item ID (UUID)")],
    type: Annotated[str, Field(description="Content type: 'bookmark' or 'note'. Available in search results from search_all_content.")],
    start_line: Annotated[int | None, Field(description="Start line for partial read (1-indexed)")] = None,
    end_line: Annotated[int | None, Field(description="End line for partial read (1-indexed)")] = None,
) -> dict[str, Any]:
    """Get a bookmark or note by ID."""
    # Route to GET /bookmarks/{id} or GET /notes/{id} based on type
```

```python
@mcp.tool(
    description="Edit content using string replacement. The old_str must match exactly one location.",
    annotations={"readOnlyHint": False, "destructiveHint": True}
)
async def edit_content(
    id: Annotated[str, Field(description="The content item ID (UUID)")],
    type: Annotated[str, Field(description="Content type: 'bookmark' or 'note'")],
    old_str: Annotated[str, Field(description="Exact text to find (include 3-5 lines of surrounding context for uniqueness)")],
    new_str: Annotated[str, Field(description="Replacement text (use empty string to delete)")],
) -> dict[str, Any]:
    """Replace old_str with new_str in the content. Fails if old_str matches 0 or multiple locations.

    Tips for successful edits:
    - Include enough surrounding context in old_str to ensure uniqueness
    - Use search_in_content first to check how many matches exist
    - For deletion, use empty string as new_str
    """
    # Route to PATCH /bookmarks/{id}/str-replace or PATCH /notes/{id}/str-replace
```

```python
@mcp.tool(
    description="Search within a content item's text to find matches with line numbers and context.",
    annotations={"readOnlyHint": True}
)
async def search_in_content(
    id: Annotated[str, Field(description="The content item ID (UUID)")],
    type: Annotated[str, Field(description="Content type: 'bookmark' or 'note'")],
    query: Annotated[str, Field(description="Text to search for")],
    fields: Annotated[str | None, Field(description="Comma-separated fields: 'content', 'title', 'description'. Default: 'content'")] = None,
    case_sensitive: Annotated[bool | None, Field(description="Case-sensitive search. Default: false")] = None,
) -> dict[str, Any]:
    """Find all occurrences of query within the item. Use this before editing to:
    - Check how many matches exist (avoid 'multiple matches' errors)
    - Get surrounding context to build a unique old_str for edit_content
    """
    # Route to GET /bookmarks/{id}/search or GET /notes/{id}/search
```

**Remove old tools:**
- Remove `get_bookmark` and `get_note` (replaced by `get_content`)
- This is a breaking change - document in release notes

**API client addition:**
- Add `api_patch()` helper to `backend/src/mcp_server/api_client.py`

**Files to read first:**
- `backend/src/mcp_server/server.py` - existing tool patterns
- `backend/src/mcp_server/api_client.py` - HTTP helpers

### Testing Strategy

- Test each new tool with valid inputs
- Test routing to correct endpoint based on type
- Test invalid type (not 'bookmark' or 'note') returns clear error
- Test error handling (404, validation errors)
- Test edit_content with various match scenarios
- Test search_in_content returns correct line numbers
- Integration test: search → edit workflow

### Success Criteria

- [ ] `get_content` routes correctly to bookmark/note endpoints
- [ ] `edit_content` performs str_replace correctly
- [ ] `search_in_content` returns matches with line numbers
- [ ] All tools require `type` parameter (only 'bookmark' or 'note')
- [ ] Error responses are clear and actionable
- [ ] Old `get_bookmark` and `get_note` tools removed
- [ ] Breaking change documented
- [ ] `api_patch()` helper added

### Risk Factors

- MCP client caching of tool definitions - may need server restart after changes

---

## Milestone 5: Prompt MCP Editing Tool

### Goal

Add an `update_prompt` tool to the Prompt MCP server that supports both content editing (str_replace) and argument updates (full replacement).

### Dependencies

Milestone 3 (str-replace API endpoint for prompts).

### Key Changes

**File:** `backend/src/prompt_mcp_server/server.py`

**New tool:**

```python
@server.call_tool()
async def update_prompt(
    id: str,
    # For content editing (str_replace):
    old_str: str | None = None,
    new_str: str | None = None,
    # For argument updates (full replacement):
    arguments: list[dict] | None = None,
) -> list[types.TextContent]:
    """Update a prompt's content or arguments.

    For content editing:
    - Provide old_str and new_str to perform string replacement
    - old_str must match exactly one location in the prompt content

    For argument updates:
    - Provide arguments as a complete list to replace all arguments
    - Each argument: {"name": "arg_name", "description": "...", "required": true/false}

    Both can be provided in a single call. The operation is atomic - if either
    fails, neither change is applied.
    """
```

**Atomic operation validation sequence:**

When both str_replace and arguments are provided, validation must happen in this order before any changes are applied:

1. **Find unique match:** Verify `old_str` matches exactly one location in current content
2. **Compute new content:** Determine what content would look like after replacement
3. **Validate Jinja2 syntax:** Verify new content is valid Jinja2 template
4. **Validate arguments:** Verify new arguments list is valid (no duplicates, valid names)
5. **Cross-validate template + arguments:** Verify all template variables have corresponding arguments, and all arguments are used in template
6. **Apply changes:** Only if all validations pass, apply both str_replace and argument update

This sequence matters because the str_replace might change variable references in the template. If any step fails, return error without applying any changes.

**Atomic operation behavior:**
- If both `old_str`/`new_str` and `arguments` are provided, the operation is atomic
- If the str_replace would fail (no match, multiple matches, invalid template), return error without updating arguments
- If the argument update would fail (validation error), return error without applying str_replace
- This prevents partial updates that could leave the prompt in an inconsistent state

**API client addition:**
- Add `api_patch()` helper to `backend/src/prompt_mcp_server/api_client.py`

**Files to read first:**
- `backend/src/prompt_mcp_server/server.py` - existing tool/handler patterns
- `backend/src/prompt_mcp_server/api_client.py` - HTTP helpers
- `backend/src/services/prompt_service.py` - template validation logic

### Testing Strategy

- Test content editing via str_replace
- Test argument replacement
- Test both operations in single call (atomic success)
- Test atomic failure: str_replace fails (no match), arguments should not be updated
- Test atomic failure: str_replace succeeds but would create invalid template, arguments should not be updated
- Test atomic failure: arguments invalid, str_replace should not be applied
- Test atomic failure: template + arguments cross-validation fails (unused argument)
- Test validation errors (invalid template after edit, duplicate argument names)
- Test 404 for non-existent prompt

### Success Criteria

- [ ] Can edit prompt content via str_replace
- [ ] Can replace arguments list
- [ ] Can do both in one call
- [ ] Atomic behavior: both succeed or both fail
- [ ] Validation sequence correctly handles template/argument cross-validation
- [ ] Validation errors return clear messages
- [ ] `api_patch()` helper added

### Risk Factors

- Atomic operation requires validating both changes before applying either - implementation must check str_replace match and argument validity before committing
- Validation sequence is critical - document and test thoroughly

---

## Summary

| Milestone | Component | Changes |
|-----------|-----------|---------|
| 1 | API | `GET /{type}/{id}/search` for notes, bookmarks, prompts |
| 2 | API | Partial read params (`start_line`, `end_line`) on 4 GET endpoints + `content_metadata` in responses + shared `content_lines.py` utility |
| 3 | API | `PATCH /{type}/{id}/str-replace` for notes, bookmarks, prompts |
| 4 | Content MCP | `get_content`, `edit_content`, `search_in_content` tools (replace per-type get tools) - **BREAKING** |
| 5 | Prompt MCP | `update_prompt` tool for content and argument editing (atomic) |

---

## Appendix: Decisions and Alternatives Not Taken

### Line-Number-Based Editing

**Decision:** Not implementing line-based edit operations (replace lines X-Y, insert at line N).

**Rationale:** Empirical evidence from Claude Code, Aider, and Cursor shows LLMs perform poorly with line numbers. Content-based matching is more robust because:
- Line numbers shift when content changes
- LLMs make counting errors
- Content matching is self-documenting (you see what you're replacing)

Line numbers are used only for:
- Error messages (to help locate issues)
- Search results (to help build unique match strings)
- Partial reads (pagination use case, not editing)

### Unified API Endpoints

**Decision:** Keep per-content-type API endpoints (`/notes/{id}/...`, `/bookmarks/{id}/...`) rather than unified (`/content/{id}/...`).

**Rationale:**
- API stays consistent - all content types follow the same pattern
- No type auto-detection complexity (avoids 3-query worst case)
- Type-specific validation is cleaner (e.g., Jinja2 validation for prompts)
- MCP tools handle consolidation - they accept `type` param and route to appropriate endpoint
- API users who know their content type get direct, predictable endpoints

The existing `/content/` endpoint for cross-type listing/searching is the right exception - that's genuinely a cross-type operation.

### Separate Insert/Delete Endpoints

**Decision:** Not implementing separate insert and delete endpoints.

**Rationale:** str_replace handles both cases:
- **Delete:** Use `new_str=""` (empty string)
- **Insert:** Include anchor text in `old_str`, put anchor + new content in `new_str`

This matches Claude Code, Aider, and Cursor which all use a single str_replace operation. Fewer endpoints = less API surface to maintain and fewer tools for AI to choose between.

### Regex Search

**Decision:** Not implementing regex search (literal match only).

**Rationale:** Security (ReDoS attacks) and performance concerns. Literal search handles the primary use cases. Can be added later with proper safeguards if needed.

### Version/Concurrency Detection

**Decision:** Not implementing `expected_version` parameter for optimistic locking.

**Rationale:** The Note model has a `version` field but it's intended for future version history functionality. Concurrency detection and version history are naturally connected - implement together when building history feature. For now, the "no match found" error will surface stale content issues (less cleanly, but functional).

### Unified Diff/Patch Format

**Decision:** Not implementing unified diff parsing.

**Rationale:** Adds complexity for marginal benefit. str_replace with progressive matching handles most cases. Can be added later if specific need arises.

### Two-Step Preview/Confirm Flow

**Decision:** Not implementing preview step before edits.

**Rationale:** Adds latency and complexity. Good error messages enable self-correction. The agent can always read content after editing to verify.

### Indentation-Relative Matching

**Decision:** Deferred to future enhancement. Initial implementation includes only exact and whitespace-normalized matching.

**Rationale:** Indentation-relative matching is complex (tabs vs spaces, mixed indentation, determining "uniform" offset). Exact + whitespace-normalized handles 90%+ of real cases. Add indentation matching only if users actually hit this issue.

**Future algorithm (when needed):**
1. Calculate the indentation difference of the first non-empty line between `old_str` and content
2. Verify all non-empty lines in `old_str` share the same relative offset
3. If consistent, apply the offset to match

### Searching Prompt Arguments

**Decision:** Not implementing search within prompt `arguments` field (the JSONB list of argument definitions).

**Rationale:** The primary use case for search is finding text within content for editing. Searching argument names/descriptions is a niche use case. Can be added later with `fields=arguments` if needed.
