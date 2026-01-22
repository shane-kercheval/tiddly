# MCP Tool Naming & Content Improvements

## Overview

This plan addresses two related improvements to the MCP server and underlying API:

1. **Content access optimization**: Add parameters to control content loading, reducing context bloat for AI agents
2. **Tool naming clarity**: Rename MCP tools to eliminate confusion between "content" as entity vs field

### Background

Current issues identified:
- **No way to get item metadata without loading full content**: Notes can be ~200KB, overwhelming agent context
- **"Content" is overloaded**: `search_all_content` sounds like it searches the content field, but it searches items; `get_content` sounds like it gets the content field, but it gets an item
- **No size indicators in list views**: Agents can't judge content size before deciding to load it
- **No MCP tool to update item metadata**: Agents can edit content but can't update title/description/tags

### Goals

1. Let agents get item info without loading full content
2. Provide content size metrics (`content_length`, `content_preview`) so agents can make informed decisions
3. Rename tools for clarity: entity operations vs content-field operations
4. Add `update_item` tool to allow metadata updates via MCP
5. Update instructions/descriptions to guide optimal tool usage

---

## Design Decisions

These decisions were made during planning and should be followed throughout implementation:

### Response Shape

`content_length` is **always** returned when content exists. `content_preview` and `content` are **mutually exclusive**:

| `include_content` | Returns |
|-------------------|---------|
| `false` | `content_length`, `content_preview`, `content=null`, `content_metadata=null` |
| `true` | `content_length`, `content`, `content_metadata`, `content_preview=null` |

### Defaults for `include_content`

| Endpoint Type | Default | Rationale |
|---------------|---------|-----------|
| Individual item API (`GET /items/{id}`) | `true` | You asked for one item, you probably want it |
| List API (`GET /items/`) | `false` | Protect against 50 × 200KB = 10MB responses |
| MCP tools | `true` | Consistency, let LLM decide based on docs |

### Error Handling

When `include_content=false` is combined with `start_line`/`end_line`:
- Return **400 Bad Request**
- Message: `"start_line/end_line parameters are only valid when include_content=true"`

### Preview Length

Fixed at 500 characters. Not configurable (YAGNI - can add later if needed).

### Prompts: No `start_line`/`end_line`

Skip partial read support for prompts. Prompts are typically small (<5KB). YAGNI.

---

## Milestone 1: API Schema Changes

**Goal**: Add new response fields to schemas without changing existing behavior

**Dependencies**: None

**Success Criteria**:
- `content_length` (int | null) field added to bookmark/note/prompt response and list item schemas
- `content_preview` (str | null) field added to response and list item schemas
- All existing tests pass (no behavior change yet)

### Key Changes

**Files to modify**:
- `backend/src/schemas/bookmark.py` - BookmarkResponse, BookmarkListItem
- `backend/src/schemas/note.py` - NoteResponse, NoteListItem
- `backend/src/schemas/prompt.py` - PromptResponse, PromptListItem
- `backend/src/schemas/content.py` - ContentListItem

**Schema pattern** (apply to all response and list item schemas):

```python
class BookmarkListItem(BaseModel):
    # ... existing fields ...
    content_length: int | None = Field(
        default=None,
        description="Total character count of content field.",
    )
    content_preview: str | None = Field(
        default=None,
        description="First 500 characters of content.",
    )

class BookmarkResponse(BookmarkListItem):
    content: str | None
    content_metadata: ContentMetadata | None = None
    # content_length and content_preview inherited from BookmarkListItem
```

### Testing Strategy

- Run existing test suite to confirm no regressions
- No new tests needed yet (fields will be None until populated in Milestone 2)

### Risk Factors

- Ensure optional fields don't break frontend (should be fine since they're optional with defaults)

---

## Milestone 2: API Endpoint Changes - Individual Items

**Goal**: Add `include_content` parameter to individual item GET endpoints

**Dependencies**: Milestone 1

**Success Criteria**:
- `GET /bookmarks/{id}?include_content=false` returns item with `content_length` and `content_preview`, but `content=null`
- `GET /notes/{id}?include_content=false` same behavior
- `GET /prompts/{id}?include_content=false` same behavior
- `GET /prompts/name/{name}?include_content=false` same behavior
- Default is `include_content=true`
- `include_content=false` with `start_line`/`end_line` returns 400 error
- `content_length` always populated when content exists
- `content_preview` populated only when `include_content=false`

### Key Changes

**Files to modify**:
- `backend/src/api/routers/bookmarks.py` - `get_bookmark` endpoint
- `backend/src/api/routers/notes.py` - `get_note` endpoint
- `backend/src/api/routers/prompts.py` - `get_prompt` and `get_prompt_by_name` endpoints

**Router pattern**:

```python
@router.get("/{note_id}", response_model=NoteResponse)
async def get_note(
    note_id: UUID,
    include_content: bool = Query(
        default=True,
        description="If true, include full content. If false, include content_length and content_preview instead.",
    ),
    start_line: int | None = Query(default=None, ...),
    end_line: int | None = Query(default=None, ...),
    # ... other params ...
) -> NoteResponse:
    # Validate: start_line/end_line only valid with include_content=True
    if not include_content and (start_line is not None or end_line is not None):
        raise HTTPException(
            status_code=400,
            detail="start_line/end_line parameters are only valid when include_content=true",
        )

    note = await note_service.get(...)
    response = NoteResponse.model_validate(note)

    if response.content is not None:
        # Always compute content_length
        response.content_length = len(response.content)

        if include_content:
            # Apply partial read if requested
            apply_partial_read(response, start_line, end_line)
            # content_preview stays null
        else:
            # Provide preview, clear full content
            response.content_preview = response.content[:500]
            response.content = None
            response.content_metadata = None

    return response
```

**Note for prompts**: Do NOT add `start_line`/`end_line` parameters. Prompts are small and don't need partial reads.

### Testing Strategy

**New tests**:
- `test__get_bookmark__include_content_false__returns_length_and_preview`
- `test__get_bookmark__include_content_true__returns_full_content_no_preview`
- `test__get_note__include_content_false__returns_length_and_preview`
- `test__get_note__include_content_true__returns_full_content_no_preview`
- `test__get_prompt__include_content_false__returns_length_and_preview`
- `test__get_prompt_by_name__include_content_false__returns_length_and_preview`
- `test__include_content_false__content_under_500_chars__preview_equals_content`
- `test__include_content_false__null_content__returns_null_metrics`
- `test__include_content_false__with_line_params__returns_400`

### Risk Factors

- Frontend may need updates if it relies on content always being present (but default is true, so should be fine)

---

## Milestone 3: API Endpoint Changes - List Endpoints

**Goal**: Add `include_content` parameter to list endpoints with content metrics

**Dependencies**: Milestone 1

**Success Criteria**:
- `GET /bookmarks/?include_content=false` (default) returns items with `content_length` and `content_preview`
- `GET /bookmarks/?include_content=true` returns items with full `content` and `content_metadata`
- Same for `/notes/`, `/prompts/`, `/content/`
- Default is `include_content=false` for lists

### Key Changes

**Files to modify**:
- `backend/src/api/routers/bookmarks.py` - `list_bookmarks` endpoint
- `backend/src/api/routers/notes.py` - `list_notes` endpoint
- `backend/src/api/routers/prompts.py` - `list_prompts` endpoint
- `backend/src/api/routers/content.py` - unified content endpoint
- `backend/src/services/bookmark_service.py`
- `backend/src/services/note_service.py`
- `backend/src/services/prompt_service.py`
- `backend/src/services/content_service.py`

**SQL approach** (use SQL functions to avoid loading full content):

```python
from sqlalchemy import func

# When include_content=False (default for lists)
query = select(
    Bookmark,
    func.length(Bookmark.content).label("content_length"),
    func.left(Bookmark.content, 500).label("content_preview"),
).where(...)

# When include_content=True
query = select(Bookmark).where(...)  # Full content loaded
```

**Schema adjustment**:
The `model_validator` in list item schemas will need to handle the computed columns from query results.

**Router pattern**:

```python
@router.get("/", response_model=BookmarkListResponse)
async def list_bookmarks(
    include_content: bool = Query(
        default=False,
        description="If true, include full content for each item. Default false returns content_length and content_preview.",
    ),
    # ... other params ...
) -> BookmarkListResponse:
    bookmarks, total = await bookmark_service.search(
        ...,
        include_content=include_content,
    )
    # Service returns data with appropriate fields based on include_content
```

### Testing Strategy

**New tests**:
- `test__list_bookmarks__include_content_false__returns_length_and_preview`
- `test__list_bookmarks__include_content_true__returns_full_content`
- `test__list_notes__include_content_false__returns_length_and_preview`
- `test__list_prompts__include_content_false__returns_length_and_preview`
- `test__search_all_content__include_content_false__returns_length_and_preview`
- `test__list_items__null_content__null_metrics`

### Risk Factors

- Need to update service layer to return computed columns
- May need to adjust how services return data (ORM objects vs tuples/dicts)
- SQL `LEFT()` function is PostgreSQL standard, should be fine

---

## Milestone 4: MCP Tool Renaming

**Goal**: Rename MCP tools for clarity, update all descriptions and instructions

**Dependencies**: None (can be done in parallel with API changes)

**Success Criteria**:
- Tools renamed per table below
- Server instructions updated with new names
- Tool descriptions updated
- All MCP tests/evals updated and passing

### Renaming Table

| Current | New | Rationale |
|---------|-----|-----------|
| `search_all_content` | `search_items` | Searches bookmark/note items, not the content field |
| `get_content` | `get_item` | Gets a bookmark or note item |
| `edit_content` | (keep) | Actually edits the content field - accurate |
| `search_in_content` | (keep) | Searches within item's text - accurate |

### Key Changes

**Files to modify**:
- `backend/src/mcp_server/server.py` - rename functions and update descriptions
- `evals/content_mcp/*.yaml` - update tool names in eval configs

**Pattern**:
```python
@mcp.tool(
    description="Search across all bookmarks and notes. Returns item metadata without content.",
    annotations={"readOnlyHint": True},
)
async def search_items(  # Renamed from search_all_content
    # ... params unchanged ...
) -> dict[str, Any]:
```

### Testing Strategy

- Update eval configs to use new tool names
- Run evals to verify they still pass
- Update any unit tests referencing old tool names

### Risk Factors

- Breaking change for existing MCP clients using old tool names
- Need to update any documentation referencing old names

---

## Milestone 5: MCP Tool Parameter Updates

**Goal**: Add `include_content` parameter to MCP tools

**Dependencies**: Milestones 2, 4

**Success Criteria**:
- `get_item` tool has `include_content` parameter (default: `true`)
- `get_prompt_template` tool has `include_content` parameter (default: `true`)
- Response includes `content_length` always (when content exists)
- Response includes `content_preview` when `include_content=false`
- Response includes `content` + `content_metadata` when `include_content=true`

### Key Changes

**Files to modify**:
- `backend/src/mcp_server/server.py` - update `get_item`
- `backend/src/prompt_mcp_server/server.py` - update `get_prompt_template`

**Content MCP - `get_item` signature**:
```python
async def get_item(
    id: Annotated[str, Field(description="The item ID (UUID)")],
    type: Annotated[Literal["bookmark", "note"], Field(description="Item type: 'bookmark' or 'note'")],
    include_content: Annotated[
        bool,
        Field(description="If true (default), include full content. If false, returns content_length and content_preview for size assessment."),
    ] = True,
    start_line: Annotated[int | None, Field(description="Start line for partial read (1-indexed). Only valid when include_content=true.")] = None,
    end_line: Annotated[int | None, Field(description="End line for partial read (1-indexed, inclusive). Only valid when include_content=true.")] = None,
) -> dict[str, Any]:
```

**Prompt MCP - `get_prompt_template` signature**:
```python
async def get_prompt_template(
    name: Annotated[str, Field(description="The prompt name (lowercase with hyphens)")],
    include_content: Annotated[
        bool,
        Field(description="If true (default), include full template content. If false, returns content_length and content_preview."),
    ] = True,
) -> dict[str, Any]:
```

**Note**: No `start_line`/`end_line` for prompts (YAGNI - prompts are small).

### Testing Strategy

- Add eval test cases for `include_content=false` behavior
- Test that `content_length` and `content_preview` are returned correctly
- Test mutual exclusivity: preview XOR content

### Risk Factors

- Need to ensure API defaults (true for individual items) align with MCP defaults (true)

---

## Milestone 6: Add `update_item` Tool to Content MCP

**Goal**: Allow agents to update item metadata (title, description, tags) via MCP

**Dependencies**: None (can be done in parallel)

**Success Criteria**:
- `update_item` tool added to content MCP server
- Can update title, description, and/or tags
- All parameters optional (only update what's provided)
- Returns updated item

### Key Changes

**Files to modify**:
- `backend/src/mcp_server/server.py` - add new tool

**Tool signature**:
```python
@mcp.tool(
    description="Update a bookmark or note's metadata (title, description, tags). Does NOT edit content - use edit_content for that.",
    annotations={"readOnlyHint": False, "destructiveHint": True},
)
async def update_item(
    id: Annotated[str, Field(description="The item ID (UUID)")],
    type: Annotated[Literal["bookmark", "note"], Field(description="Item type: 'bookmark' or 'note'")],
    title: Annotated[str | None, Field(description="New title. Omit to leave unchanged.")] = None,
    description: Annotated[str | None, Field(description="New description. Omit to leave unchanged.")] = None,
    tags: Annotated[list[str] | None, Field(description="New tags (replaces all existing tags). Omit to leave unchanged.")] = None,
) -> dict[str, Any]:
    """
    Update item metadata.

    At least one of title, description, or tags must be provided.
    Tags are replaced entirely (not merged) - provide the complete tag list.
    """
    if title is None and description is None and tags is None:
        raise ToolError("At least one of title, description, or tags must be provided")

    # Call appropriate API endpoint
    endpoint = f"/{type}s/{id}"
    payload = {}
    if title is not None:
        payload["title"] = title
    if description is not None:
        payload["description"] = description
    if tags is not None:
        payload["tags"] = tags

    # PATCH to update
    return await api_patch(client, endpoint, token, payload)
```

**Update server instructions** to document the new tool and when to use it vs `edit_content`.

### Testing Strategy

- `test__update_item__updates_title`
- `test__update_item__updates_description`
- `test__update_item__updates_tags`
- `test__update_item__updates_multiple_fields`
- `test__update_item__no_fields_provided__returns_error`
- `test__update_item__not_found__returns_error`

### Risk Factors

- Need to handle validation errors from API (e.g., empty title for notes)
- Tags replacement vs merge semantic needs to be clearly documented

---

## Milestone 7: Documentation & Instructions Update

**Goal**: Comprehensive update to MCP server instructions explaining new patterns

**Dependencies**: Milestones 4, 5, 6

**Success Criteria**:
- Server instructions explain `include_content` parameter and when to use it
- Workflow examples show optimal patterns
- Tool naming explained
- `update_item` vs `edit_content` distinction clear
- CLAUDE.md updated if needed

### Key Changes

**Update server instructions in `mcp_server/server.py`**:

```python
instructions="""
...

## Tool Naming Convention

- **Item tools** (`search_items`, `get_item`, `update_item`): Operate on bookmark/note entities
- **Content tools** (`edit_content`, `search_in_content`): Operate on the content text field

## Getting Item Details

`get_item(id, type)` fetches a bookmark or note. By default, includes full content.
Use `include_content=false` to get metadata only:
- `content_length`: Total characters (assess size before loading)
- `content_preview`: First 500 characters (quick context)

**Workflow for editing content:**

1. `search_items(query="...")` → find item, get `id` and `type`
2. `get_item(id, type)` → full content by default, or use `include_content=false` first to check size
3. For large items, use `search_in_content(id, type, query="...")` to find specific text
4. `edit_content(id, type, old_str="...", new_str="...")` → make the edit

## Updating Metadata vs Content

- **`update_item`**: Change title, description, or tags
- **`edit_content`**: Change the content text field using string replacement

...
"""
```

### Testing Strategy

- Manual review of instructions for clarity
- Run evals to ensure LLMs can follow the new patterns

### Risk Factors

- Instructions may be too long - keep concise
- May need iteration based on eval results

---

## Implementation Order

```
Milestone 1 (Schemas) ────────────────────────────────────────────────┐
                                                                      │
Milestone 2 (API Individual) ──────────────────────────────────────┬──┤
                                                                   │  │
Milestone 3 (API Lists) ───────────────────────────────────────────┤  ├─→ Milestone 7 (Docs)
                                                                   │  │
Milestone 4 (MCP Renaming) ────────────────────────────────────────┤  │
                                                                   │  │
Milestone 5 (MCP Params) ──────────────────────────────────────────┘  │
                                                                      │
Milestone 6 (update_item Tool) ───────────────────────────────────────┘
```

**Suggested order**:
1. Milestone 1 (Schemas) - foundation for all other changes
2. Milestone 4 (MCP Renaming) - can be done early, no API deps
3. Milestone 2 (API Individual) - depends on M1
4. Milestone 3 (API Lists) - depends on M1
5. Milestone 6 (update_item Tool) - independent, can be done anytime
6. Milestone 5 (MCP Params) - depends on M2 and M4
7. Milestone 7 (Docs) - final, after all other changes
