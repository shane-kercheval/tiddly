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
4. Add `update_item_metadata` tool to Content MCP for metadata updates
5. Add `get_prompt_metadata` tool to Prompt MCP for metadata-only fetches
6. Update instructions/descriptions to guide optimal tool usage

---

## Design Decisions

These decisions were made during planning and should be followed throughout implementation:

### Response Shape

`content_length` is **always** returned when content exists. `content_preview` and `content` are **mutually exclusive**:
- When full content is returned: `content`, `content_metadata`, `content_length` (no `content_preview`)
- When metadata only: `content_length`, `content_preview` (no `content` or `content_metadata`)

### API Endpoint Design

Each endpoint has a **fixed contract** (no conditional response shapes):

| Endpoint | Returns | Contract |
|----------|---------|----------|
| `GET /bookmarks/{id}` | Full content + `content_metadata` + `content_length` | Always full content |
| `GET /bookmarks/{id}/metadata` | `content_length` + `content_preview` | Always metadata only |
| `GET /bookmarks/` | `content_length` + `content_preview` per item | Always metadata only (list) |

Same pattern for `/notes/` and `/prompts/`.

**Rationale:**
- Fixed contracts per URL - no conditional logic
- Type-safe for programmatic clients
- Each URL = one predictable response shape
- Cleaner documentation ("Returns X" vs "Returns X or Y depending on parameter")

### MCP Tool Design

MCP tools are designed for LLM agents (fewer tools, more flexibility):

| Tool | Has `include_content`? | Behavior |
|------|------------------------|----------|
| `get_item` | Yes, default `true` | Calls `/{id}` or `/{id}/metadata` based on parameter |
| `search_items` | **No** | Always returns `content_length` + `content_preview` (list behavior) |

**`get_item` response based on `include_content` parameter:**

| `include_content` | Returns |
|-------------------|---------|
| `false` | `content_length`, `content_preview`, `content=null`, `content_metadata=null` |
| `true` | `content_length`, `content`, `content_metadata`, `content_preview=null` |

**Rationale:**
- Fewer tools = less cognitive load for LLMs
- LLMs handle varying outputs well
- MCP tool is a facade over the two API endpoints

**Rationale for metadata-only lists:**
- Prevents 50 × 200KB = 10MB responses
- Lists are for discovery; use `get_item` for full content
- Follows common API patterns (GitHub, Stripe, etc.)

### Computation Location

`content_length` and `content_preview` are **always computed in PostgreSQL**, not Python:

```sql
-- GET /bookmarks/{id} (full content endpoint)
SELECT *, length(content) FROM bookmarks WHERE id = ?

-- GET /bookmarks/{id}/metadata (metadata endpoint)
SELECT (columns except content), length(content), left(content, 500) FROM bookmarks WHERE id = ?

-- GET /bookmarks/ (list endpoint - always metadata-only)
SELECT (columns except content), length(content), left(content, 500) FROM bookmarks WHERE ...
```

**Rationale:**
- Efficient: only transfers needed data over the wire
- Consistent: one pattern for all queries
- No Python computation overhead

### Error Handling

`start_line`/`end_line` parameters are only valid on full content endpoints:
- `GET /bookmarks/{id}?start_line=1&end_line=10` → OK (partial read of full content)
- `GET /bookmarks/{id}/metadata?start_line=1` → **400 Bad Request** ("start_line/end_line not valid on metadata endpoint")

### Preview Length

Fixed at 500 characters. Define as constant `CONTENT_PREVIEW_LENGTH = 500` for maintainability. Not configurable (YAGNI - can add later if needed).

### Prompts: `get_prompt_template` vs `get_prompt_metadata`

Unlike bookmarks/notes where `get_item` has an `include_content` parameter, prompts use separate tools:
- **`get_prompt_template`**: Always returns full template content (no `include_content` param). If calling this tool, you want the template.
- **`get_prompt_metadata`**: Returns metadata only (name, title, description, arguments, tags, `prompt_length`, `prompt_preview`). Use to check size before fetching.

This is cleaner for prompts because the template IS the content - there's no use case for "get prompt without template."

Add `start_line`/`end_line` to `get_prompt_template` for partial reads, consistent with bookmarks/notes.

---

## Final Tools Summary

After all milestones are complete, here are the final tools for each MCP server:

### Content MCP Server (bookmarks/notes)

| Tool | Parameters |
|------|------------|
| `search_items` | `query`, `type`*, `tags`, `tag_match`, `sort_by`, `sort_order`, `limit`, `offset` |
| `get_item` | `id`, `type`, `include_content`**, `start_line`, `end_line` |
| `edit_content` | `id`, `type`, `old_str`, `new_str` |
| `search_in_content` | `id`, `type`, `query`, `fields`, `case_sensitive`, `context_lines` |
| `update_item_metadata` | `id`, `type`, `title`, `description`, `tags`, `url`*** |
| `create_bookmark` | `url`, `title`, `description`, `content`, `tags` |
| `create_note` | `title`, `description`, `content`, `tags` |
| `list_tags` | (none) |

\* `type` is optional: `"bookmark"`, `"note"`, or omit to search both. Results include `content_length` and `content_preview`.
\*\* `include_content` defaults to `true`; when `false`, returns `content_length` and `content_preview` instead of `content`
\*\*\* `url` only applicable when `type="bookmark"`

**Note:** `search_bookmarks` and `search_notes` tools are removed. Use `search_items` with `type` parameter instead.

### Prompt MCP Server

| Tool | Parameters |
|------|------------|
| `search_prompts` | `query`, `tags`, `tag_match`, `sort_by`, `sort_order`, `limit`, `offset` |
| `get_prompt_template` | `name`, `start_line`, `end_line` |
| `edit_prompt_template` | `name`, `old_str`, `new_str`, `arguments` |
| `get_prompt_metadata` | `name` |
| `update_prompt_metadata` | `name`, `new_name`, `title`, `description`, `tags` |
| `create_prompt` | `name`, `title`, `description`, `content`, `arguments`, `tags` |
| `list_tags` | (none) |

**Notes:**
- `search_prompts` results include `prompt_length` and `prompt_preview` (no full content)
- `get_prompt_metadata` returns `prompt_length` and `prompt_preview`
- `get_prompt_template` returns full content (no preview)

**`search_prompts` vs `list_prompts` (MCP capability):**
- `list_prompts` is the **MCP protocol capability** for discovering prompts. Returns `types.Prompt` objects per MCP spec.
- `search_prompts` is a **tool** for searching with filters (tags, query) and getting size info (`prompt_length`, `prompt_preview`).
- Use `search_prompts` when you need filtering or want to assess prompt sizes before fetching.

**Field naming (API → MCP translation):**
The API uses `content_length`/`content_preview` (matching the `content` field name). The Prompt MCP translates these to `prompt_length`/`prompt_preview` for semantic clarity when working with prompts. This translation happens in the MCP tool handlers.

### Tool Naming Conventions

| Suffix | Meaning | Examples |
|--------|---------|----------|
| `*_item` / `*_items` | Operates on bookmark/note entities | `get_item`, `search_items`, `update_item_metadata` |
| `*_content` | Operates on the content text field | `edit_content`, `search_in_content` |
| `*_prompt` / `*_prompts` | Operates on prompt entities | `search_prompts`, `create_prompt` |
| `*_template` | Operates on prompt template text | `get_prompt_template`, `edit_prompt_template` |
| `*_metadata` | Operates on metadata fields only | `get_prompt_metadata`, `update_item_metadata`, `update_prompt_metadata` |
| `list_tags` | Lists all tags (both servers) | `list_tags` |

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

**Goal**: Add metadata endpoints and update existing endpoints to always include `content_length`

**Dependencies**: Milestone 1

**Success Criteria**:
- `GET /bookmarks/{id}` always returns full `content` + `content_metadata` + `content_length`
- `GET /bookmarks/{id}/metadata` always returns `content_length` + `content_preview` (no full content)
- Same pattern for `/notes/{id}`, `/prompts/{id}`, `/prompts/name/{name}`
- `start_line`/`end_line` only valid on full content endpoints (not `/metadata`)
- Each endpoint has a fixed response contract (no conditional shapes)

### Key Changes

**Files to modify**:
- `backend/src/api/routers/bookmarks.py` - update `get_bookmark`, add `get_bookmark_metadata`
- `backend/src/api/routers/notes.py` - update `get_note`, add `get_note_metadata`
- `backend/src/api/routers/prompts.py` - update endpoints, add metadata endpoints
- `backend/src/services/bookmark_service.py` - add `get_metadata` method
- `backend/src/services/note_service.py` - same
- `backend/src/services/prompt_service.py` - same

**Service pattern** (database-level computation):

```python
# services/note_service.py

async def get(
    self,
    db: AsyncSession,
    user_id: UUID,
    note_id: UUID,
) -> Note | None:
    """Get note with full content. Always includes content_length."""
    stmt = select(
        Note,
        func.length(Note.content).label("content_length"),
    ).where(Note.id == note_id, Note.user_id == user_id)

    result = await db.execute(stmt)
    row = result.first()
    if row is None:
        return None
    note, length = row
    note.content_length = length
    return note

async def get_metadata(
    self,
    db: AsyncSession,
    user_id: UUID,
    note_id: UUID,
) -> Note | None:
    """Get note metadata only (no full content). Returns content_length + content_preview."""
    stmt = select(
        Note,
        func.length(Note.content).label("content_length"),
        func.left(Note.content, 500).label("content_preview"),
    ).where(Note.id == note_id, Note.user_id == user_id)

    result = await db.execute(stmt)
    row = result.first()
    if row is None:
        return None
    note, length, preview = row
    note.content_length = length
    note.content_preview = preview
    note.content = None  # Ensure no full content
    return note
```

**Router pattern** (two separate endpoints with fixed contracts):

```python
@router.get("/{note_id}", response_model=NoteResponse)
async def get_note(
    note_id: UUID,
    start_line: int | None = Query(default=None, ...),
    end_line: int | None = Query(default=None, ...),
    # ... other params ...
) -> NoteResponse:
    """Get note with full content. Always includes content + content_metadata + content_length."""
    note = await note_service.get(db, user_id, note_id)
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")

    response = NoteResponse.model_validate(note)

    if start_line or end_line:
        apply_partial_read(response, start_line, end_line)

    return response


@router.get("/{note_id}/metadata", response_model=NoteResponse)
async def get_note_metadata(
    note_id: UUID,
    # No start_line/end_line - not applicable for metadata
    # ... other params ...
) -> NoteResponse:
    """Get note metadata only. Returns content_length + content_preview, no full content."""
    note = await note_service.get_metadata(db, user_id, note_id)
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")

    return NoteResponse.model_validate(note)
```

**Note for prompts**: Add `start_line`/`end_line` parameters to full content endpoints for consistency with bookmarks/notes.

### Testing Strategy

**New tests**:
- `test__get_bookmark__returns_full_content_and_length`
- `test__get_bookmark_metadata__returns_length_and_preview_no_content`
- `test__get_note__returns_full_content_and_length`
- `test__get_note_metadata__returns_length_and_preview_no_content`
- `test__get_prompt__returns_full_content_and_length`
- `test__get_prompt_metadata__returns_length_and_preview_no_content`
- `test__get_prompt_by_name_metadata__returns_length_and_preview`
- `test__metadata_endpoint__content_under_500_chars__preview_equals_full`
- `test__metadata_endpoint__null_content__returns_null_metrics`

### Risk Factors

- New endpoints need to be documented
- Frontend continues to use `/{id}` endpoint (no changes needed)

---

## Milestone 3: API Endpoint Changes - List Endpoints

**Goal**: Make list endpoints return `content_length` and `content_preview` (always metadata-only, no full content)

**Dependencies**: Milestone 1

**Success Criteria**:
- `GET /bookmarks/` returns items with `content_length` and `content_preview`
- `GET /notes/` returns items with `content_length` and `content_preview`
- `GET /prompts/` returns items with `content_length` and `content_preview` (MCP translates to `prompt_*`)
- `GET /content/` returns items with `content_length` and `content_preview`
- Lists **never** return full `content` or `content_metadata`

### Key Changes

**Files to modify**:
- `backend/src/services/base_entity_service.py` - modify `search()` method to use `defer()` and add computed columns
- `backend/src/services/content_service.py` - modify `search_all_content()` UNION queries to add computed columns

**Current problem**:
`BaseEntityService.search()` currently uses `select(self.model)` which loads ALL columns from the database, including the full `content` field (up to 200KB per item). The content is then discarded during Pydantic serialization since `*ListItem` schemas don't have a `content` field. This is wasteful.

**Solution** - Use `defer()` to exclude content column + add computed columns:

```python
from sqlalchemy import func
from sqlalchemy.orm import defer, selectinload

CONTENT_PREVIEW_LENGTH = 500

# List query - defer content, add computed columns
stmt = select(
    self.model,
    func.length(self.model.content).label("content_length"),
    func.left(self.model.content, CONTENT_PREVIEW_LENGTH).label("content_preview"),
).options(
    defer(self.model.content),  # Exclude content from SELECT
    selectinload(self.model.tag_objects),  # Keep tag loading working
).where(...)

# Results are tuples: (Model, int, str)
results = await db.execute(stmt)
items = []
for model_obj, content_length, content_preview in results:
    model_obj.content_length = content_length
    model_obj.content_preview = content_preview
    items.append(model_obj)
```

**Generated SQL** (verified via test):
```sql
SELECT notes.user_id, notes.title, notes.description, notes.version,
       notes.last_used_at, notes.id, notes.created_at, notes.updated_at,
       notes.deleted_at, notes.archived_at,
       length(notes.content) AS content_length,
       left(notes.content, 500) AS content_preview
FROM notes WHERE ...
```

Note: `notes.content` is NOT in the SELECT - `defer()` works. PostgreSQL computes `length()` and `left()` without transferring full content.

This approach:
1. **Adds** `content_length` and `content_preview` to responses
2. **Optimizes** by never loading full content from database
3. **Minimal code change** - no need for subclass-specific column lists
4. **Keeps tag loading working** - `selectinload()` still works

**For `content_service.search_all_content()`**:
Add `func.length()` and `func.left()` to each UNION subquery's column list. This function already uses explicit column selection, so just add the two new computed columns.

**Schema adjustment**:
Add `content_length` and `content_preview` fields to list item schemas (from Milestone 1).

**Router pattern** (no `include_content` parameter):

```python
@router.get("/", response_model=BookmarkListResponse)
async def list_bookmarks(
    # ... existing params (q, tags, sort_by, etc.) ...
) -> BookmarkListResponse:
    bookmarks, total = await bookmark_service.search(...)
    # Service returns items with content_length/content_preview attached
    items = [BookmarkListItem.model_validate(b) for b in bookmarks]
    return BookmarkListResponse(items=items, total=total, ...)
```

### Testing Strategy

**New tests**:
- `test__list_bookmarks__returns_length_and_preview`
- `test__list_bookmarks__does_not_return_full_content`
- `test__list_notes__returns_length_and_preview`
- `test__list_prompts__returns_length_and_preview`
- `test__list_content__returns_length_and_preview`
- `test__list_items__null_content__returns_null_metrics`

### Risk Factors

- Results change from `list[Model]` to `list[tuple[Model, int, str]]` - need to unpack and attach computed values
- SQL `LEFT()` function is PostgreSQL standard, should work correctly with UTF-8

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
| `search_bookmarks` | (remove) | Consolidated into `search_items` with `type` parameter |
| `search_notes` | (remove) | Consolidated into `search_items` with `type` parameter |
| `edit_content` | (keep) | Actually edits the content field - accurate |
| `search_in_content` | (keep) | Searches within item's text - accurate |

### Key Changes

**Files to modify**:
- `backend/src/mcp_server/server.py` - rename functions, remove redundant tools, update descriptions
- `evals/content_mcp/*.yaml` - update tool names in eval configs

**`search_items` tool** (consolidates `search_all_content`, `search_bookmarks`, `search_notes`):
```python
@mcp.tool(
    description=(
        "Search across bookmarks and notes. By default searches both types. "
        "Use `type` parameter to filter to a specific content type. "
        "Returns metadata including content_length and content_preview (not full content)."
    ),
    annotations={"readOnlyHint": True},
)
async def search_items(
    query: Annotated[str | None, Field(description="Search text")] = None,
    type: Annotated[
        Literal["bookmark", "note"] | None,
        Field(description="Filter by type: 'bookmark' or 'note'. Omit to search both."),
    ] = None,
    # ... other params (tags, tag_match, sort_by, sort_order, limit, offset) ...
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

**Goal**: Add `include_content` parameter to Content MCP `get_item`, add `get_prompt_metadata` to Prompt MCP

**Dependencies**: Milestones 2, 4

**Success Criteria**:

**Content MCP:**
- `get_item` tool has `include_content` parameter (default: `true`)
- Response includes `content_length` always (when content exists)
- Response includes `content_preview` when `include_content=false`
- Response includes `content` + `content_metadata` when `include_content=true`
- Tool description guides LLM: "Use `include_content=false` to check content size before fetching large content."

**Prompt MCP:**
- `get_prompt_template` always returns full content (NO `include_content` param)
- `get_prompt_template` supports `start_line`/`end_line` for partial reads
- New `get_prompt_metadata` tool returns metadata with `prompt_length` and `prompt_preview`
- New `search_prompts` tool for searching/listing prompts with filtering and sorting
- New `list_tags` tool for discovering available tags

### Key Changes

**Files to modify**:
- `backend/src/mcp_server/server.py` - update `get_item`
- `backend/src/prompt_mcp_server/server.py` - update `get_prompt_template`, add `get_prompt_metadata`

**Content MCP - `get_item` implementation**:

The MCP tool has `include_content` parameter but calls different API endpoints:
- `include_content=true` → calls `GET /{type}s/{id}` (full content endpoint)
- `include_content=false` → calls `GET /{type}s/{id}/metadata` (metadata endpoint)

```python
async def get_item(
    id: Annotated[str, Field(description="The item ID (UUID)")],
    type: Annotated[Literal["bookmark", "note"], Field(description="Item type: 'bookmark' or 'note'")],
    include_content: Annotated[
        bool,
        Field(description="If true (default), include full content. If false, returns content_length and content_preview for size assessment before loading large content."),
    ] = True,
    start_line: Annotated[int | None, Field(description="Start line for partial read (1-indexed). Only valid when include_content=true.")] = None,
    end_line: Annotated[int | None, Field(description="End line for partial read (1-indexed, inclusive). Only valid when include_content=true.")] = None,
) -> dict[str, Any]:
    # Route to appropriate API endpoint based on include_content
    if include_content:
        endpoint = f"/{type}s/{id}"
        params = {}
        if start_line:
            params["start_line"] = start_line
        if end_line:
            params["end_line"] = end_line
    else:
        endpoint = f"/{type}s/{id}/metadata"
        params = {}  # start_line/end_line not valid for metadata endpoint

    return await api_get(client, endpoint, token, params=params)
```

**Prompt MCP - `get_prompt_template` signature** (NO `include_content` - always returns full template):
```python
async def get_prompt_template(
    name: Annotated[str, Field(description="The prompt name (lowercase with hyphens)")],
    start_line: Annotated[int | None, Field(description="Start line for partial read (1-indexed).")] = None,
    end_line: Annotated[int | None, Field(description="End line for partial read (1-indexed, inclusive).")] = None,
) -> dict[str, Any]:
    """Returns full template content. Use get_prompt_metadata if you only need metadata."""
```

**Prompt MCP - NEW `get_prompt_metadata` tool**:
```python
types.Tool(
    name="get_prompt_metadata",
    description=(
        "Get a prompt's metadata without the template content. "
        "Returns name, title, description, arguments, tags, prompt_length, and prompt_preview. "
        "Use this to check prompt size or arguments before fetching full template."
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

**`get_prompt_metadata` response shape**:
```json
{
  "id": "uuid",
  "name": "code-review",
  "title": "Code Review Assistant",
  "description": "Reviews code for issues",
  "arguments": [{"name": "code", "description": "Code to review", "required": true}],
  "tags": ["dev", "review"],
  "prompt_length": 1523,
  "prompt_preview": "You are a code reviewer. Please review the following {{ language }} code..."
}
```

**Prompt MCP - NEW `search_prompts` tool**:
```python
types.Tool(
    name="search_prompts",
    description=(
        "Search and list prompts with optional filtering by tags and text query. "
        "Returns prompt metadata including prompt_length and prompt_preview (not full content). "
        "Use get_prompt_template to fetch the full template content."
    ),
    inputSchema={
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "Search text (matches name, title, description). Optional.",
            },
            "tags": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Filter by tags. Optional.",
            },
            "tag_match": {
                "type": "string",
                "enum": ["all", "any"],
                "description": "Tag matching: 'all' (AND) or 'any' (OR). Default: 'all'.",
            },
            "sort_by": {
                "type": "string",
                "enum": ["created_at", "updated_at", "last_used_at", "name"],
                "description": "Sort field. Default: 'created_at'.",
            },
            "sort_order": {
                "type": "string",
                "enum": ["asc", "desc"],
                "description": "Sort order. Default: 'desc'.",
            },
            "limit": {
                "type": "integer",
                "description": "Max results (1-100). Default: 50.",
            },
            "offset": {
                "type": "integer",
                "description": "Pagination offset. Default: 0.",
            },
        },
        "required": [],
    },
)
```

**`search_prompts` response shape** (each item):
```json
{
  "id": "uuid",
  "name": "code-review",
  "title": "Code Review Assistant",
  "description": "Reviews code for issues",
  "arguments": [...],
  "tags": ["dev", "review"],
  "prompt_length": 1523,
  "prompt_preview": "You are a code reviewer..."
}
```

**Prompt MCP - NEW `list_tags` tool**:
```python
types.Tool(
    name="list_tags",
    description=(
        "List all tags used across prompts. "
        "Use this to discover available tags for filtering with search_prompts, "
        "or to check existing tags before creating/updating prompts."
    ),
    inputSchema={
        "type": "object",
        "properties": {},
        "required": [],
    },
)
```

### Testing Strategy

**Content MCP:**
- Add eval test cases for `include_content=false` behavior
- Test that `content_length` and `content_preview` are returned correctly
- Test mutual exclusivity: preview XOR content

**Prompt MCP:**
- `test__get_prompt_metadata__returns_length_and_preview`
- `test__get_prompt_metadata__prompt_not_found__returns_error`
- `test__get_prompt_template__with_start_end_line__returns_partial`
- `test__search_prompts__no_params__returns_all`
- `test__search_prompts__with_query__filters_results`
- `test__search_prompts__with_tags__filters_results`
- `test__search_prompts__results_include_length_and_preview`
- `test__list_tags__returns_all_tags`

### Risk Factors

- Need to ensure API defaults (true for individual items) align with MCP defaults (true)
- `get_prompt_metadata` requires API `/metadata` endpoint (Milestone 2)
- `search_prompts` needs API list endpoint to return `content_length` and `content_preview` (covered by Milestone 3)

---

## Milestone 6: Add `update_item_metadata` Tool to Content MCP

**Goal**: Allow agents to update item metadata (title, description, tags, url) via MCP

**Dependencies**: None (can be done in parallel)

**Success Criteria**:
- `update_item_metadata` tool added to content MCP server
- Can update title, description, tags, and/or url (bookmarks only)
- All parameters optional (only update what's provided)
- Returns updated item metadata

### Key Changes

**Files to modify**:
- `backend/src/mcp_server/server.py` - add new tool

**Tool signature**:
```python
@mcp.tool(
    description=(
        "Update a bookmark or note's metadata (title, description, tags). "
        "For bookmarks, can also update url. "
        "Does NOT edit content - use edit_content for that."
    ),
    annotations={"readOnlyHint": False, "destructiveHint": True},
)
async def update_item_metadata(
    id: Annotated[str, Field(description="The item ID (UUID)")],
    type: Annotated[Literal["bookmark", "note"], Field(description="Item type: 'bookmark' or 'note'")],
    title: Annotated[str | None, Field(description="New title. Omit to leave unchanged.")] = None,
    description: Annotated[str | None, Field(description="New description. Omit to leave unchanged.")] = None,
    tags: Annotated[list[str] | None, Field(description="New tags (replaces all existing tags). Omit to leave unchanged.")] = None,
    url: Annotated[str | None, Field(description="New URL (bookmarks only). Omit to leave unchanged.")] = None,
) -> dict[str, Any]:
    """
    Update item metadata.

    At least one field must be provided.
    Tags are replaced entirely (not merged) - provide the complete tag list.
    The `url` parameter only applies to bookmarks - raises an error if provided for notes.
    """
    if title is None and description is None and tags is None and url is None:
        raise ToolError("At least one of title, description, tags, or url must be provided")

    if url is not None and type == "note":
        raise ToolError("url parameter is only valid for bookmarks")

    # Call appropriate API endpoint
    endpoint = f"/{type}s/{id}"
    payload = {}
    if title is not None:
        payload["title"] = title
    if description is not None:
        payload["description"] = description
    if tags is not None:
        payload["tags"] = tags
    if url is not None:
        payload["url"] = url

    # PATCH to update
    return await api_patch(client, endpoint, token, payload)
```

**Update server instructions** to document the new tool and clarify when to use it vs `edit_content`:
- `update_item_metadata`: Change title, description, tags, or url (bookmarks only - `url` for notes raises error)
- `edit_content`: Change the content text field using string replacement

### Testing Strategy

- `test__update_item_metadata__updates_title`
- `test__update_item_metadata__updates_description`
- `test__update_item_metadata__updates_tags`
- `test__update_item_metadata__updates_url_bookmark`
- `test__update_item_metadata__url_for_note__raises_error`
- `test__update_item_metadata__updates_multiple_fields`
- `test__update_item_metadata__no_fields_provided__returns_error`
- `test__update_item_metadata__not_found__returns_error`

### Risk Factors

- Need to handle validation errors from API (e.g., empty title for notes)
- Tags replacement vs merge semantic needs to be clearly documented
- URL validation for bookmarks

---

## Milestone 7: Documentation & Instructions Update

**Goal**: Comprehensive update to MCP server instructions explaining new patterns

**Dependencies**: Milestones 4, 5, 6

**Success Criteria**:
- Server instructions explain `include_content` parameter and when to use it
- Workflow examples show optimal patterns
- Tool naming conventions explained
- `update_item_metadata` vs `edit_content` distinction clear
- `search_items` with `type` parameter documented (replaces `search_bookmarks`/`search_notes`)
- Prompt MCP instructions explain `get_prompt_template` vs `get_prompt_metadata`
- Prompt MCP instructions clarify `search_prompts` (tool) vs `list_prompts` (MCP capability)
- CLAUDE.md updated if needed

### Key Changes

**Update Content MCP server instructions in `mcp_server/server.py`**:

```python
instructions="""
...

## Tool Naming Convention

- **Item tools** (`search_items`, `get_item`, `update_item_metadata`): Operate on bookmark/note entities
- **Content tools** (`edit_content`, `search_in_content`): Operate on the content text field

## Searching Items

`search_items` searches across bookmarks and notes. By default searches both types.
- Use `type="bookmark"` or `type="note"` to filter to a specific type
- Results include `content_length` and `content_preview` (not full content)

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

- **`update_item_metadata`**: Change title, description, tags, or url (bookmarks only - providing `url` for notes raises an error)
- **`edit_content`**: Change the content text field using string replacement

## Discovering Tags

`list_tags()` returns all tags used across bookmarks and notes. Use this to discover available tags for filtering with `search_items`.

...
"""
```

**Update Prompt MCP server instructions in `prompt_mcp_server/server.py`**:

```python
instructions="""
...

## Tool Naming Convention

- **Prompt tools** (`search_prompts`, `create_prompt`): Operate on prompt entities
- **Template tools** (`get_prompt_template`, `edit_prompt_template`): Operate on prompt template content
- **Metadata tools** (`get_prompt_metadata`, `update_prompt_metadata`): Operate on metadata fields

## Finding Prompts

**`search_prompts` vs `list_prompts`:**
- `list_prompts` is the MCP protocol capability for discovering prompts (returns MCP Prompt objects)
- `search_prompts` is a tool for searching with filters and getting size info

Use `search_prompts` when you need:
- Tag or text filtering
- Size assessment (`prompt_length`, `prompt_preview`)
- Custom sorting

Tools:
- `search_prompts(query, tags, ...)`: Search and filter prompts. Returns metadata with `prompt_length` and `prompt_preview` (not full content).
- `list_tags()`: Discover available tags for filtering or to check before creating/updating prompts.

## Getting Prompt Details

- `get_prompt_template(name)`: Returns full template content. Use when you need to view or edit the template.
- `get_prompt_metadata(name)`: Returns metadata only (name, title, description, arguments, tags, prompt_length, prompt_preview). Use to check size or arguments before fetching template.

## Updating Metadata vs Template

- **`update_prompt_metadata`**: Change title, description, tags, or rename the prompt (use `new_name` to rename)
- **`edit_prompt_template`**: Change the template text using string replacement (optionally update arguments atomically)

## Discovering Tags

`list_tags()` returns all tags used across prompts. Use this to discover available tags for filtering with `search_prompts`, or to check existing tags before creating/updating prompts.

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
Milestone 5 (MCP Params + Prompt MCP Tools) ───────────────────────┘  │
                                                                      │
Milestone 6 (update_item_metadata Tool) ──────────────────────────────┘
```

**Suggested order**:
1. Milestone 1 (Schemas) - foundation for all other changes
2. Milestone 4 (MCP Renaming) - can be done early, no API deps
3. Milestone 2 (API Individual) - depends on M1
4. Milestone 3 (API Lists) - depends on M1
5. Milestone 6 (update_item_metadata Tool) - independent, can be done anytime
6. Milestone 5 (MCP Params + Prompt MCP Tools) - depends on M2, M3, and M4
7. Milestone 7 (Docs) - final, after all other changes

**Note**: Milestone 5 now includes Content MCP `get_item` updates AND Prompt MCP additions (`get_prompt_metadata`, `search_prompts`, `list_tags`). It depends on M3 because `search_prompts` needs the API to return `prompt_length`/`prompt_preview`.
