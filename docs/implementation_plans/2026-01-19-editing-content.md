# Content Editing API for AI Agents

**Date:** 2026-01-19
**Status:** Draft - Awaiting Review

## Overview

Add AI-friendly editing capabilities to the content management API. The design prioritizes content-based (string matching) operations over line-number-based operations, based on empirical evidence from production AI coding tools (Claude Code, Aider, Cursor) showing LLMs perform poorly with line numbers.

### Goals

- Enable AI agents to make targeted edits to notes, bookmarks, and prompts without replacing entire content
- Provide within-content search to help agents locate and construct unique match strings
- Consolidate MCP tools to reduce cognitive load on AI agents (unified ID-based operations)
- Support partial reads for large documents (pagination via line ranges)

### Key Design Decisions

1. **Content-based matching (str_replace)** - Primary edit operation requires unique string match
2. **No line numbers in GET responses** - Prevents AI from trying to use them in edits
3. **Line numbers in error messages and search results** - For navigation/understanding only
4. **Progressive fuzzy matching** - Fallback strategy: exact → whitespace-normalized → indentation-relative
5. **Unified MCP tools** - `get_content`, `edit_content`, `search_in_content` replace per-type tools

---

## Milestone 1: Within-Content Search API Endpoint

### Goal

Add an endpoint to search within a single content item's text fields, returning matches with line numbers and context. This is the foundation for AI agents to locate content before editing.

### Dependencies

None - can be implemented independently.

### Key Changes

**New endpoint:** `GET /content/{id}/search`

```python
# Query parameters
q: str              # Required search query
type: str | None    # Optional: "bookmark", "note", "prompt" (auto-detect if omitted)
fields: str = "content"  # Comma-separated: "content", "title", "description"

# Response
{
    "matches": [
        {
            "field": "content",
            "line": 15,
            "context": "...surrounding text with **match** highlighted..."
        },
        {
            "field": "title",
            "line": null,  # null for non-content fields
            "context": "...match in title..."
        }
    ],
    "total_matches": 2
}
```

**Implementation notes:**
- Add to `backend/src/api/routers/content.py` (extends existing unified content router)
- Create a new service function in a shared location (perhaps `backend/src/services/content_search_service.py`)
- The service should:
  - Look up the item by ID (checking bookmarks, notes, prompts if type not specified)
  - Split content into lines and search for query matches
  - Return line numbers (1-indexed) and surrounding context (e.g., 50 chars before/after)
  - Search specified fields only

**Files to read first:**
- `backend/src/api/routers/content.py` - existing unified content patterns
- `backend/src/services/base_entity_service.py` - understand service patterns

### Testing Strategy

- Test searching in each content type (bookmark, note, prompt)
- Test with `type` parameter specified vs auto-detection (both should return same results)
- Test multiple fields: `fields=content,title,description`
- Test multiple matches in same content
- Test no matches found (empty results)
- Test match at beginning/end of content (context truncation)
- Test with special characters in query
- Test 404 when ID not found

### Success Criteria

- [ ] Endpoint returns matches with line numbers and context
- [ ] Supports searching multiple fields
- [ ] Auto-detects content type when not specified
- [ ] Returns empty matches array (not error) when no matches
- [ ] Tests cover all content types and edge cases

### Risk Factors

- Performance with very large content (consider limiting context size)
- Regex vs literal search (start with literal, add regex later if needed)

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
- `GET /content/{id}?start_line=X&end_line=Y` (new unified endpoint)

**Response additions:**
```python
{
    # Existing fields...
    "content": "...",  # Only lines X through Y
    "content_metadata": {
        "total_lines": 150,
        "start_line": 50,
        "end_line": 100,
        "is_partial": true
    }
}
```

**Important:** When `start_line`/`end_line` are NOT provided, `content_metadata` is omitted or `is_partial` is `false`. The raw content field remains unchanged for backwards compatibility.

**Files to read first:**
- `backend/src/api/routers/bookmarks.py`, `notes.py`, `prompts.py` - existing GET endpoints
- `backend/src/schemas/bookmark.py`, `note.py`, `prompt.py` - response schemas

### Testing Strategy

- Test partial read with valid line ranges
- Test full content when no line params (backwards compatibility)
- Test edge cases: start_line > total lines, end_line > total lines (should clamp or error?)
- Test start_line > end_line (should error)
- Test with empty content
- Test content_metadata accuracy

### Success Criteria

- [ ] Partial reads return only requested line range
- [ ] Response includes metadata about total lines and range
- [ ] Backwards compatible when no line params provided
- [ ] Edge cases handled gracefully
- [ ] Tests verify metadata accuracy

### Risk Factors

- Decision needed: Clamp out-of-range values or return 400? (Recommend: clamp with metadata indicating actual range returned)

---

## Milestone 3: Unified Get Content Endpoint

### Goal

Add `GET /content/{id}` to retrieve any content item by ID without knowing the type upfront. Supports the MCP tool consolidation goal.

### Dependencies

Milestone 2 (partial read support should be included).

### Key Changes

**New endpoint:** `GET /content/{id}`

```python
# Query parameters
type: str | None        # Optional: "bookmark", "note", "prompt"
start_line: int | None  # Optional: for partial reads
end_line: int | None    # Optional: for partial reads

# Response: Full item response (BookmarkResponse, NoteResponse, or PromptResponse)
# Plus a "type" field to identify which it is
{
    "type": "note",
    "id": "...",
    "title": "...",
    "content": "...",
    # ... rest of fields depend on type
}
```

**Implementation notes:**
- If `type` is provided, query only that table (faster)
- If `type` is omitted, query all three tables by ID (UUIDs are globally unique)
- Return 404 if not found in any table

**Files to read first:**
- `backend/src/api/routers/content.py` - add to existing content router

### Testing Strategy

- Test retrieving each content type
- Test with and without `type` parameter
- Test 404 for non-existent ID
- Test partial read params work
- Test that response includes correct `type` field

### Success Criteria

- [ ] Can retrieve bookmark, note, or prompt by ID
- [ ] Type auto-detection works
- [ ] Explicit type parameter skips unnecessary queries
- [ ] Partial read parameters supported
- [ ] Response includes `type` field

### Risk Factors

- Minor performance concern with type auto-detection (3 queries worst case) - acceptable for convenience

---

## Milestone 4: String Replace Edit Endpoint

### Goal

Implement the primary editing operation: content-based string replacement with unique match requirement.

### Dependencies

Milestone 3 (unified get endpoint for type detection pattern).

### Key Changes

**New endpoint:** `PATCH /content/{id}/str-replace`

```python
# Request body
{
    "old_str": "exact content to find\nincluding multiple lines",
    "new_str": "replacement content",
    "type": "note"  # Optional
}

# Success response (200)
{
    "success": true,
    "match_type": "exact",  # or "whitespace_normalized", "indentation_relative"
    "line": 15,  # Line number where match was found
    "content": "..."  # Updated full content (or partial if large?)
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
        {"line": 15, "context": "...surrounding text..."},
        {"line": 47, "context": "...surrounding text..."}
    ],
    "suggestion": "Include more surrounding context to ensure uniqueness"
}
```

**Progressive matching fallbacks:**
1. **Exact** - Character-for-character match
2. **Whitespace normalized** - Strip trailing whitespace, normalize line endings
3. **Indentation relative** - Handle uniform indent/outdent (important for code/markdown)

Return `match_type` in response so caller knows which level succeeded.

**Implementation notes:**
- Create `backend/src/services/content_edit_service.py` for edit logic
- The service should:
  - Find all occurrences of `old_str` (using progressive matching)
  - If 0 matches: return error with suggestion
  - If 1 match: perform replacement, return success
  - If multiple matches: return error with match locations and contexts
- Update the entity via existing service update methods

**Files to read first:**
- `backend/src/services/note_service.py` - understand update patterns
- `backend/src/services/base_entity_service.py` - base update method

### Testing Strategy

- Test successful single-match replacement
- Test no match found error
- Test multiple matches error (with correct line numbers in response)
- Test each fallback level: exact, whitespace normalized, indentation relative
- Test multiline old_str
- Test replacement that changes line count
- Test empty new_str (deletion)
- Test preserving other fields (tags, title, etc.)
- Test with each content type

### Success Criteria

- [ ] Single unique match triggers successful replacement
- [ ] Zero matches returns actionable error
- [ ] Multiple matches returns locations with context
- [ ] Fallback matching works progressively
- [ ] Response includes match_type used
- [ ] All content types supported

### Risk Factors

- Indentation-relative matching is complex - start with exact + whitespace normalized, add indentation later if needed
- Large content performance - may need to optimize search algorithm

---

## Milestone 5: Insert and Delete Content Endpoints

### Goal

Add content-based insert and delete operations as alternatives to str_replace.

### Dependencies

Milestone 4 (shares matching logic and service structure).

### Key Changes

**Insert endpoint:** `POST /content/{id}/insert`

```python
# Request body
{
    "after_str": "anchor text to insert after",  # Required
    "new_str": "content to insert",              # Required
    "type": "note"                               # Optional
}

# Success response includes line number where insertion occurred
```

**Delete endpoint:** `DELETE /content/{id}/content`

```python
# Request body (yes, DELETE with body - or use POST /content/{id}/delete-content)
{
    "content_to_delete": "exact text to remove",
    "type": "note"  # Optional
}
```

**Alternative:** Use POST for delete operation if DELETE-with-body is problematic:
`POST /content/{id}/delete-content`

**Implementation notes:**
- Reuse matching logic from str_replace
- Insert: find anchor, insert new_str after it
- Delete: find content, remove it (equivalent to str_replace with empty new_str)

### Testing Strategy

- Test insert after unique anchor
- Test insert with multiple anchor matches (error)
- Test insert at end of content
- Test delete unique content
- Test delete with multiple matches (error)
- Test delete non-existent content (error)

### Success Criteria

- [ ] Insert works with unique anchor
- [ ] Delete works with unique match
- [ ] Both return actionable errors on no match or multiple matches
- [ ] Both support all content types

### Risk Factors

- DELETE with body may have HTTP client compatibility issues - consider POST alternative

---

## Milestone 6: MCP Tool Consolidation

### Goal

Add consolidated MCP tools (`get_content`, `edit_content`, `search_in_content`) to the Content MCP server, replacing per-type get tools.

### Dependencies

Milestones 1, 3, 4 (API endpoints must exist first).

### Key Changes

**File:** `backend/src/mcp_server/server.py`

**New tools:**

```python
@mcp.tool(
    description="Get any content item (bookmark, note) by ID",
    annotations={"readOnlyHint": True}
)
async def get_content(
    id: Annotated[str, Field(description="The content item ID (UUID)")],
    type: Annotated[str | None, Field(description="Content type: 'bookmark' or 'note'. Auto-detected if omitted.")] = None,
    start_line: Annotated[int | None, Field(description="Start line for partial read (1-indexed)")] = None,
    end_line: Annotated[int | None, Field(description="End line for partial read (1-indexed)")] = None,
) -> dict[str, Any]:
    """Get a bookmark or note by ID. Supports partial reads for large content."""
    # Implementation calls GET /content/{id}
```

```python
@mcp.tool(
    description="Edit content using string replacement. The old_str must match exactly one location.",
    annotations={"readOnlyHint": False, "destructiveHint": True}
)
async def edit_content(
    id: Annotated[str, Field(description="The content item ID (UUID)")],
    old_str: Annotated[str, Field(description="Exact text to find (include surrounding context for uniqueness)")],
    new_str: Annotated[str, Field(description="Replacement text")],
    type: Annotated[str | None, Field(description="Content type: 'bookmark' or 'note'. Auto-detected if omitted.")] = None,
) -> dict[str, Any]:
    """Replace old_str with new_str in the content. Fails if old_str matches 0 or multiple locations."""
    # Implementation calls PATCH /content/{id}/str-replace
```

```python
@mcp.tool(
    description="Search within a content item's text to find matches with line numbers",
    annotations={"readOnlyHint": True}
)
async def search_in_content(
    id: Annotated[str, Field(description="The content item ID (UUID)")],
    query: Annotated[str, Field(description="Text to search for")],
    type: Annotated[str | None, Field(description="Content type: 'bookmark' or 'note'. Auto-detected if omitted.")] = None,
    fields: Annotated[str | None, Field(description="Comma-separated fields to search: 'content', 'title', 'description'. Default: 'content'")] = None,
) -> dict[str, Any]:
    """Find all occurrences of query within the item. Returns line numbers and context for each match."""
    # Implementation calls GET /content/{id}/search
```

**Deprecation approach for old tools:**
- Keep `get_bookmark` and `get_note` temporarily but mark descriptions as "DEPRECATED: Use get_content instead"
- Remove in a future release

**API client addition:**
- Add `api_patch()` helper to `backend/src/mcp_server/api_client.py`

**Files to read first:**
- `backend/src/mcp_server/server.py` - existing tool patterns
- `backend/src/mcp_server/api_client.py` - HTTP helpers

### Testing Strategy

- Test each new tool with valid inputs
- Test type auto-detection
- Test error handling (404, validation errors)
- Test edit_content with various match scenarios
- Test search_in_content returns correct line numbers
- Integration test: search → edit workflow

### Success Criteria

- [ ] `get_content` works for bookmarks and notes
- [ ] `edit_content` performs str_replace correctly
- [ ] `search_in_content` returns matches with line numbers
- [ ] Error responses are clear and actionable
- [ ] Old tools marked deprecated (or removed if breaking changes OK)

### Risk Factors

- MCP client caching of tool definitions - may need server restart after changes

---

## Milestone 7: Insert/Delete MCP Tools (Optional)

### Goal

Add MCP tools for insert and delete operations if they prove useful after Milestone 6.

### Dependencies

Milestones 5, 6.

### Key Changes

Add `insert_content` and `delete_content` tools following the same patterns as `edit_content`.

**Decision point:** Evaluate after Milestone 6 whether these are needed. The `edit_content` tool with `new_str=""` can handle deletion. Insert can be done with `edit_content` using `old_str` as the anchor and `new_str` including the anchor + new content.

### Success Criteria

- [ ] Decide if these tools add value beyond edit_content
- [ ] If yes, implement following established patterns

---

## Summary

| Milestone | Component | New Endpoints/Tools |
|-----------|-----------|---------------------|
| 1 | API | `GET /content/{id}/search` |
| 2 | API | Partial read params on existing GET endpoints |
| 3 | API | `GET /content/{id}` |
| 4 | API | `PATCH /content/{id}/str-replace` |
| 5 | API | `POST /content/{id}/insert`, `POST /content/{id}/delete-content` |
| 6 | MCP | `get_content`, `edit_content`, `search_in_content` |
| 7 | MCP | `insert_content`, `delete_content` (optional) |

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

### Unified Diff/Patch Format

**Decision:** Not implementing unified diff parsing.

**Rationale:** Adds complexity for marginal benefit. str_replace with progressive matching handles most cases. Can be added later if specific need arises.

### Two-Step Preview/Confirm Flow

**Decision:** Not implementing preview step before edits.

**Rationale:** Adds latency and complexity. Good error messages enable self-correction. The agent can always read content after editing to verify.
