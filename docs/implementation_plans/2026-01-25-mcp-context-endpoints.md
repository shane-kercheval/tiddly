# MCP Context Endpoints Implementation

## Overview

Implement dedicated API endpoints and MCP tools to provide AI agents with a "playbook" of context about a user's content and prompts. This is the equivalent of an `agents.md` or `CLAUDE.md` file but dynamically generated from the user's actual data.

**Problem:** AI agents connected via MCP must make multiple exploratory queries to understand a user's content landscape before being useful. This wastes tokens and time.

**Solution:** Two dedicated endpoints that aggregate context data in one call:
- `GET /mcp/context/content` - Summary for bookmarks/notes (Content MCP Server)
- `GET /mcp/context/prompts` - Summary for prompts (Prompt MCP Server)

**Key design principle:** These endpoints are specifically optimized for AI agent consumption, not the UI. They live under `/mcp/` to signal this intent.

---

## What Information is Useful for AI Agents?

Based on analysis, agents benefit most from:

1. **Intent signals** - What is the user trying to accomplish? Sidebar order, recent activity, and filter definitions express this.
2. **Vocabulary/taxonomy** - What tags do they use? How are they categorized?
3. **Recency over completeness** - Recent items matter more than comprehensive history.
4. **Relationships** - Which items go together? Tag co-occurrence and filter definitions reveal this.
5. **Patterns to follow** - When creating new content, what conventions should the agent follow?

---

## Milestone 1: API Endpoint for Content Context

### Goal

Create `GET /mcp/context/content` endpoint that returns aggregated context about a user's bookmarks and notes.

### Success Criteria

- Endpoint returns JSON with content counts, top tags, filters, and recent items
- All fields are documented with clear descriptions
- Response is optimized for LLM consumption (concise, structured)
- Authentication uses standard `get_current_user` dependency
- Tests cover all response sections

### Key Changes

**New file: `backend/src/schemas/mcp_context.py`**

```python
from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, Field

class ContentCounts(BaseModel):
    active: int
    archived: int

class ContentContextCounts(BaseModel):
    bookmarks: ContentCounts
    notes: ContentCounts

class ContextTag(BaseModel):
    name: str
    count: int
    content_types: list[str] = Field(
        description="Which content types use this tag: 'bookmark', 'note', or both"
    )

class ContextItem(BaseModel):
    type: str = Field(description="'bookmark' or 'note'")
    id: UUID
    title: str | None
    description: str | None
    preview: str | None = Field(description="First N characters of content")
    tags: list[str]
    last_used_at: datetime
    created_at: datetime
    updated_at: datetime

class ContextFilter(BaseModel):
    id: UUID
    name: str
    content_types: list[str]
    description: str = Field(
        description="Human-readable description of filter logic"
    )
    default_sort_by: str

class TagPair(BaseModel):
    tags: list[str] = Field(description="Two tags that frequently appear together")
    count: int = Field(description="Number of items with both tags")

class ContentContext(BaseModel):
    generated_at: datetime
    counts: ContentContextCounts
    top_tags: list[ContextTag]
    tag_pairs: list[TagPair] = Field(
        description="Tags that frequently appear together, revealing user's categorization patterns"
    )
    filters: list[ContextFilter] = Field(
        description="Custom filters in sidebar order (user's priority)"
    )
    recent_items: list[ContextItem] = Field(
        description="Recently accessed items (by last_used_at)"
    )
    recently_created: list[ContextItem]
    recently_modified: list[ContextItem]
```

**New file: `backend/src/services/mcp_context_service.py`**

Create a service that orchestrates calls to existing services:

```python
class MCPContextService:
    async def get_content_context(
        self,
        db: AsyncSession,
        user_id: UUID,
        tag_limit: int = 20,
        recent_limit: int = 10,
        preview_length: int = 200,
    ) -> ContentContext:
        """
        Aggregate content context for MCP consumption.

        Uses parallel queries for efficiency.
        """
        # Run independent queries in parallel
        counts, tags, filters, recent, created, modified, tag_pairs = await asyncio.gather(
            self._get_content_counts(db, user_id),
            self._get_top_tags_with_types(db, user_id, tag_limit),
            self._get_filters_with_descriptions(db, user_id),
            self._get_recent_items(db, user_id, recent_limit, preview_length, sort_by="last_used_at"),
            self._get_recent_items(db, user_id, recent_limit, preview_length, sort_by="created_at"),
            self._get_recent_items(db, user_id, recent_limit, preview_length, sort_by="updated_at"),
            self._get_tag_pairs(db, user_id, limit=10),
        )

        return ContentContext(
            generated_at=datetime.now(UTC),
            counts=counts,
            top_tags=tags,
            tag_pairs=tag_pairs,
            filters=filters,
            recent_items=recent,
            recently_created=created,
            recently_modified=modified,
        )
```

Implementation notes:
- `_get_content_counts`: Use `SELECT COUNT(*)` queries, not full entity fetches
- `_get_top_tags_with_types`: Extend existing tag service to return which content types use each tag
- `_get_filters_with_descriptions`: Fetch filters in sidebar order, convert filter expressions to human-readable descriptions (e.g., "(python AND tutorial) OR reference")
- `_get_recent_items`: Use unified content search with specified sort, truncate content to `preview_length`
- `_get_tag_pairs`: Query for tag co-occurrence (see implementation notes below)

**New file: `backend/src/api/routers/mcp.py`**

```python
from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_current_user, get_async_session
from models import User
from schemas.mcp_context import ContentContext, PromptContext
from services.mcp_context_service import mcp_context_service

router = APIRouter(prefix="/mcp", tags=["MCP"])

@router.get("/context/content", response_model=ContentContext)
async def get_content_context(
    tag_limit: int = Query(default=20, ge=1, le=100, description="Number of top tags to include"),
    recent_limit: int = Query(default=10, ge=1, le=50, description="Number of recent items per category"),
    preview_length: int = Query(default=200, ge=50, le=500, description="Character limit for content previews"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> ContentContext:
    """
    Get aggregated context about user's bookmarks and notes for AI agent consumption.

    Returns counts, top tags, custom filters, and recent activity in a single response
    optimized for LLM context windows.
    """
    return await mcp_context_service.get_content_context(
        db=db,
        user_id=current_user.id,
        tag_limit=tag_limit,
        recent_limit=recent_limit,
        preview_length=preview_length,
    )
```

**Update: `backend/src/api/main.py`**

Register the new router:
```python
from api.routers import mcp
app.include_router(mcp.router)
```

### Implementation Notes: Tag Pairs Query

To find tags that frequently appear together, query the entity-tag relationship tables:

```python
async def _get_tag_pairs(
    self,
    db: AsyncSession,
    user_id: UUID,
    limit: int = 10,
) -> list[TagPair]:
    """
    Find tag pairs that frequently co-occur.

    Uses a self-join on entity tags to find pairs.
    Only considers active (non-deleted, non-archived) items.
    """
    # This requires querying bookmark_tags and note_tags tables
    # and counting co-occurrences. The exact SQL will depend on
    # how the tag relationships are modeled.
    #
    # Conceptual approach:
    # 1. For each content type, self-join tags table on entity_id
    # 2. WHERE t1.tag_name < t2.tag_name (avoid duplicates and self-pairs)
    # 3. GROUP BY (t1.tag_name, t2.tag_name)
    # 4. ORDER BY count DESC
    # 5. UNION results from bookmarks and notes
    # 6. LIMIT to top N pairs
```

This is a nice-to-have feature. If implementation is complex, it can be deferred to a later milestone. The agent implementing this should assess complexity and ask if it should be deferred.

### Implementation Notes: Filter Description

Convert filter expressions to human-readable format:

```python
def _describe_filter_expression(expr: dict) -> str:
    """
    Convert filter expression JSON to human-readable description.

    Example input: {"groups": [{"tags": ["python", "tutorial"]}, {"tags": ["reference"]}], "group_operator": "OR"}
    Example output: "(python AND tutorial) OR (reference)"
    """
    groups = expr.get("groups", [])
    group_operator = expr.get("group_operator", "OR")

    group_strs = []
    for group in groups:
        tags = group.get("tags", [])
        if len(tags) == 1:
            group_strs.append(tags[0])
        elif len(tags) > 1:
            group_strs.append(f"({' AND '.join(tags)})")

    return f" {group_operator} ".join(group_strs) if group_strs else "All items"
```

### Testing Strategy

Create `backend/tests/api/test_mcp_context.py`:

1. **Test endpoint basics:**
   - Authenticated request returns 200 with correct schema
   - Unauthenticated request returns 401
   - Query parameters are respected (tag_limit, recent_limit, preview_length)

2. **Test counts accuracy:**
   - Create known number of bookmarks and notes
   - Verify counts match
   - Verify archived items are counted separately

3. **Test top tags:**
   - Create items with various tags
   - Verify tags are sorted by count
   - Verify `content_types` field is accurate

4. **Test filters:**
   - Create custom filters
   - Verify they appear in sidebar order
   - Verify description is human-readable

5. **Test recent items:**
   - Create items with different timestamps
   - Verify `recent_items` sorted by `last_used_at`
   - Verify `recently_created` sorted by `created_at`
   - Verify `recently_modified` sorted by `updated_at`
   - Verify preview is truncated to `preview_length`

6. **Test tag pairs (if implemented):**
   - Create items with overlapping tags
   - Verify pairs are detected and counted

7. **Test empty state:**
   - New user with no content returns valid response with empty lists and zero counts

### Dependencies

None - this is the first milestone.

### Risk Factors

- **Performance:** Multiple queries in one request. Use `asyncio.gather()` for parallelism. Monitor response times.
- **Tag pairs complexity:** The tag co-occurrence query may be complex. Assess and defer if needed.
- **Preview truncation:** Ensure preview doesn't break mid-word or mid-unicode character.

---

## Milestone 2: API Endpoint for Prompt Context

### Goal

Create `GET /mcp/context/prompts` endpoint that returns aggregated context about a user's prompts.

### Success Criteria

- Endpoint returns JSON with prompt counts, top tags, filters, recent prompts, and argument vocabulary
- Prompts include their arguments list for discoverability
- Response is optimized for LLM consumption
- Tests cover all response sections

### Key Changes

**Update: `backend/src/schemas/mcp_context.py`**

Add prompt-specific schemas:

```python
class PromptContextCounts(BaseModel):
    active: int
    archived: int

class PromptArgument(BaseModel):
    name: str
    description: str | None
    required: bool

class ContextPrompt(BaseModel):
    id: UUID
    name: str
    title: str | None
    description: str | None
    preview: str | None = Field(description="First N characters of template")
    arguments: list[PromptArgument]
    tags: list[str]
    last_used_at: datetime
    created_at: datetime
    updated_at: datetime

class CommonArgument(BaseModel):
    name: str = Field(description="Argument name used across multiple prompts")
    appears_in: int = Field(description="Number of prompts using this argument")
    usually_required: bool = Field(description="Whether this argument is usually marked required")

class PromptContext(BaseModel):
    generated_at: datetime
    counts: PromptContextCounts
    top_tags: list[ContextTag]
    filters: list[ContextFilter] = Field(
        description="Prompt filters in sidebar order"
    )
    common_arguments: list[CommonArgument] = Field(
        description="Argument names used across multiple prompts - helps maintain consistent naming"
    )
    recently_used: list[ContextPrompt] = Field(
        description="Recently used prompts (by last_used_at) - most relevant for agents"
    )
    recently_created: list[ContextPrompt]
    recently_modified: list[ContextPrompt]
```

**Update: `backend/src/services/mcp_context_service.py`**

Add prompt context method:

```python
async def get_prompt_context(
    self,
    db: AsyncSession,
    user_id: UUID,
    tag_limit: int = 20,
    recent_limit: int = 10,
    preview_length: int = 200,
) -> PromptContext:
    """
    Aggregate prompt context for MCP consumption.
    """
    counts, tags, filters, recent, created, modified, common_args = await asyncio.gather(
        self._get_prompt_counts(db, user_id),
        self._get_prompt_tags(db, user_id, tag_limit),
        self._get_prompt_filters(db, user_id),
        self._get_recent_prompts(db, user_id, recent_limit, preview_length, sort_by="last_used_at"),
        self._get_recent_prompts(db, user_id, recent_limit, preview_length, sort_by="created_at"),
        self._get_recent_prompts(db, user_id, recent_limit, preview_length, sort_by="updated_at"),
        self._get_common_arguments(db, user_id, limit=15),
    )

    return PromptContext(
        generated_at=datetime.now(UTC),
        counts=counts,
        top_tags=tags,
        filters=filters,
        common_arguments=common_args,
        recently_used=recent,
        recently_created=created,
        recently_modified=modified,
    )
```

**Update: `backend/src/api/routers/mcp.py`**

Add prompt context endpoint:

```python
@router.get("/context/prompts", response_model=PromptContext)
async def get_prompt_context(
    tag_limit: int = Query(default=20, ge=1, le=100),
    recent_limit: int = Query(default=10, ge=1, le=50),
    preview_length: int = Query(default=200, ge=50, le=500),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> PromptContext:
    """
    Get aggregated context about user's prompts for AI agent consumption.

    Returns counts, top tags, common argument names, and recent prompts
    optimized for LLM context windows.
    """
    return await mcp_context_service.get_prompt_context(
        db=db,
        user_id=current_user.id,
        tag_limit=tag_limit,
        recent_limit=recent_limit,
        preview_length=preview_length,
    )
```

### Implementation Notes: Common Arguments

Query the arguments JSON field across all prompts to find frequently used argument names:

```python
async def _get_common_arguments(
    self,
    db: AsyncSession,
    user_id: UUID,
    limit: int = 15,
) -> list[CommonArgument]:
    """
    Find argument names that appear across multiple prompts.

    This helps agents use consistent naming when creating new prompts.
    """
    # Prompts store arguments as JSONB array
    # Need to unnest and aggregate
    #
    # Approach:
    # 1. Fetch all active prompts for user
    # 2. Flatten arguments in Python (simpler than PostgreSQL JSONB operations)
    # 3. Count occurrences and calculate usually_required
    #
    # If performance becomes an issue, this could be a PostgreSQL query
    # using jsonb_array_elements
```

### Testing Strategy

Add to `backend/tests/api/test_mcp_context.py`:

1. **Test endpoint basics:**
   - Authenticated request returns 200 with correct schema
   - Query parameters work correctly

2. **Test counts accuracy:**
   - Create known prompts
   - Verify counts match

3. **Test prompt-specific tags:**
   - Verify only prompt tags are returned (not bookmark/note tags)

4. **Test common arguments:**
   - Create prompts with overlapping argument names
   - Verify common arguments are detected
   - Verify `usually_required` is calculated correctly

5. **Test recent prompts:**
   - Verify arguments list is included
   - Verify preview is truncated

6. **Test empty state:**
   - User with no prompts returns valid response

### Dependencies

Milestone 1 (shared infrastructure)

### Risk Factors

- **Arguments extraction:** The JSONB query for common arguments may need optimization for users with many prompts.

---

## Milestone 3: Content MCP Server Tool

### Goal

Add `get_context` tool to the Content MCP Server that calls `GET /mcp/context/content`.

### Success Criteria

- `get_context` tool is available in Content MCP Server
- Tool documentation clearly explains what context is returned
- Tool parameters allow customization (tag_limit, recent_limit, preview_length)
- MCP server instructions updated to mention this tool

### Key Changes

**Update: `backend/src/mcp_server/server.py`**

Add the tool:

```python
@mcp.tool(
    description="""Get a summary of the user's bookmarks and notes.

Use this at the START of a session to understand:
- What content exists (counts by type)
- How content is organized (top tags, custom filters)
- What the user is actively working with (recent items)
- Tag relationships (which tags appear together)

This replaces the need for multiple exploratory queries. The response includes:
- Content counts (active/archived bookmarks and notes)
- Top tags with usage counts and which content types use them
- Tag pairs that frequently co-occur (reveals categorization patterns)
- Custom filters in user-defined priority order
- Recently used, created, and modified items with previews

Call this first, then use search_items or get_item for specific content.""",
    annotations={"readOnlyHint": True},
)
async def get_context(
    tag_limit: Annotated[
        int,
        Field(default=20, ge=1, le=100, description="Number of top tags to include"),
    ] = 20,
    recent_limit: Annotated[
        int,
        Field(default=10, ge=1, le=50, description="Number of recent items per category"),
    ] = 10,
    preview_length: Annotated[
        int,
        Field(default=200, ge=50, le=500, description="Character limit for content previews"),
    ] = 200,
) -> dict[str, Any]:
    """Get aggregated context about user's bookmarks and notes."""
    client = await _get_http_client()
    token = _get_token()

    params = {
        "tag_limit": tag_limit,
        "recent_limit": recent_limit,
        "preview_length": preview_length,
    }

    return await api_get(client, "/mcp/context/content", token, params)
```

**Update MCP server instructions** in the same file:

Add to the instructions string:
- Document `get_context` tool in the tool list
- Recommend calling it at session start
- Explain what each section of the response contains

### Testing Strategy

Add to `backend/tests/mcp_server/`:

1. **Test tool availability:**
   - Tool appears in tool list
   - Tool schema shows correct parameters

2. **Test tool execution:**
   - Returns structured response
   - Parameters are passed correctly to API

3. **Test error handling:**
   - Auth error returns appropriate error

### Dependencies

Milestones 1 and 2 (API endpoints must exist)

### Risk Factors

- None significant - straightforward API proxy

---

## Milestone 4: Prompt MCP Server Tool

### Goal

Add `get_context` tool to the Prompt MCP Server that calls `GET /mcp/context/prompts`.

### Success Criteria

- `get_context` tool is available in Prompt MCP Server
- Tool documentation explains prompt-specific context
- MCP server instructions updated

### Key Changes

**Update: `backend/src/prompt_mcp_server/server.py`**

Add to the tool list in `handle_list_tools()`:

```python
types.Tool(
    name="get_context",
    description="""Get a summary of the user's prompts.

Use this at the START of a session to understand:
- What prompts exist (counts)
- How prompts are organized (tags, filters)
- Common argument naming patterns (for consistency when creating new prompts)
- What prompts the user frequently uses (recently_used)

This replaces the need for multiple exploratory queries. The response includes:
- Prompt counts (active/archived)
- Top tags with usage counts
- Common argument names across prompts (helps maintain consistent naming)
- Custom filters in user-defined priority order
- Recently used, created, and modified prompts with previews and arguments

Call this first, then use search_prompts or get_prompt_template for specific prompts.""",
    inputSchema={
        "type": "object",
        "properties": {
            "tag_limit": {
                "type": "integer",
                "description": "Number of top tags to include",
                "default": 20,
                "minimum": 1,
                "maximum": 100,
            },
            "recent_limit": {
                "type": "integer",
                "description": "Number of recent prompts per category",
                "default": 10,
                "minimum": 1,
                "maximum": 50,
            },
            "preview_length": {
                "type": "integer",
                "description": "Character limit for template previews",
                "default": 200,
                "minimum": 50,
                "maximum": 500,
            },
        },
    },
    annotations=types.ToolAnnotations(readOnlyHint=True),
)
```

Add handler:

```python
async def _handle_get_context(arguments: dict[str, Any]) -> types.CallToolResult:
    """Handle get_context tool call."""
    client = await _get_http_client()
    token = get_bearer_token()

    params = {
        "tag_limit": arguments.get("tag_limit", 20),
        "recent_limit": arguments.get("recent_limit", 10),
        "preview_length": arguments.get("preview_length", 200),
    }

    result = await api_get(client, "/mcp/context/prompts", token, params)

    return types.CallToolResult(
        content=[types.TextContent(type="text", text=json.dumps(result, indent=2, default=str))],
        structuredContent=result,
    )
```

Update dispatch table to include `"get_context": _handle_get_context`.

**Update MCP server instructions** in the same file.

### Testing Strategy

Add to `backend/tests/prompt_mcp_server/`:

1. **Test tool availability:**
   - Tool appears in tool list
   - Tool schema shows correct parameters

2. **Test tool execution:**
   - Returns `CallToolResult` with `structuredContent`
   - Parameters are passed correctly to API

### Dependencies

Milestones 1, 2, and 3

### Risk Factors

- None significant

---

## Milestone 5: Documentation and Polish

### Goal

Update all documentation and ensure consistent messaging.

### Success Criteria

- CLAUDE.md updated with MCP context endpoints
- MCP server instructions are complete and consistent
- Frontend settings page updated (if it lists MCP tools)

### Key Changes

**Update: `CLAUDE.md`**

Add section describing the MCP context endpoints:

```markdown
### MCP Context Endpoints

Dedicated endpoints for AI agent consumption:

- `GET /mcp/context/content` - Summary of bookmarks/notes (counts, tags, filters, recent items)
- `GET /mcp/context/prompts` - Summary of prompts (counts, tags, common arguments, recent prompts)

These provide agents with a "playbook" of context in a single request, replacing multiple exploratory queries.
```

**Update: `frontend/src/pages/settings/SettingsMCP.tsx`**

If tool lists are displayed, add `get_context` to both server sections:
- Content MCP: "Get context summary for bookmarks and notes"
- Prompt MCP: "Get context summary for prompts"

**Verify MCP server instructions:**

Both servers should have clear, consistent documentation for `get_context` in their instruction strings.

### Testing Strategy

- Manual review of all documentation
- Grep for any inconsistencies in tool names or descriptions
- Verify frontend displays correctly

### Dependencies

Milestones 1-4

### Risk Factors

- None significant

---

## Summary of Changes

| File | Change |
|------|--------|
| `backend/src/schemas/mcp_context.py` | New - Context response schemas |
| `backend/src/services/mcp_context_service.py` | New - Context aggregation service |
| `backend/src/api/routers/mcp.py` | New - MCP router with context endpoints |
| `backend/src/api/main.py` | Register MCP router |
| `backend/src/mcp_server/server.py` | Add `get_context` tool, update instructions |
| `backend/src/prompt_mcp_server/server.py` | Add `get_context` tool, update instructions |
| `backend/tests/api/test_mcp_context.py` | New - API endpoint tests |
| `backend/tests/mcp_server/test_*.py` | Add `get_context` tool tests |
| `backend/tests/prompt_mcp_server/test_*.py` | Add `get_context` tool tests |
| `frontend/src/pages/settings/SettingsMCP.tsx` | Update tool list |
| `CLAUDE.md` | Document MCP context endpoints |

---

## Future Enhancements (Not in Scope)

These were discussed but are intentionally deferred:

1. **Usage frequency tracking** - Count of how many times each item/prompt is used (not just `last_used_at`)
2. **Tag descriptions** - Let users define what their tags mean
3. **Content relationships** - Explicit links between items
4. **Top domains** (bookmarks) - Which sites the user bookmarks from most
5. **Note structure patterns** - Detection of headers, code blocks, lists in notes
6. **Template complexity distribution** - Simple vs conditional vs loop prompts
7. **Stale content indicators** - Items not used in N days

These can be added in future iterations based on user feedback.
