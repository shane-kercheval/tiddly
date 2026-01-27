# MCP Context Endpoints Implementation

## Overview

Implement dedicated API endpoints and MCP tools to provide AI agents with a "playbook" of context about a user's content and prompts. This is the equivalent of an `agents.md` or `CLAUDE.md` file but dynamically generated from the user's actual data.

**Problem:** AI agents connected via MCP must make multiple exploratory queries to understand a user's content landscape before being useful. This wastes tokens and time.

**Solution:** Two dedicated endpoints that aggregate context data in one call:
- `GET /mcp/context/content` - Summary for bookmarks/notes (Content MCP Server)
- `GET /mcp/context/prompts` - Summary for prompts (Prompt MCP Server)

**Architecture:**
- API endpoints return **structured JSON** (reusable by any client)
- MCP tools convert JSON to **markdown** optimized for LLM consumption (no structured output, text only)
- MCP tools add explanatory prose (what filters are, how tags work, etc.) that doesn't belong in the API response

Authentication: standard `get_current_user` dependency (same auth rules as all other endpoints).

---

## Target MCP Tool Output

The MCP tools convert structured API data into markdown. This is what the LLM will see.

### Content Context Tool Output

```markdown
# Content Context

Generated: 2026-01-25T10:30:00Z

## Overview
- **Bookmarks:** 150 active, 25 archived
- **Notes:** 75 active, 5 archived

## Top Tags
Tags are used to categorize content. A tag referenced by any filter
indicates it is important to the user's workflow.

| Tag | Items | Filters |
|-----|-------|---------|
| python | 45 | 3 |
| reference | 38 | 2 |
| tutorial | 30 | 2 |
| work | 28 | 1 |
| to-read | 22 | 0 |

## Filters
Filters are custom saved views the user has created to organize their
content. They define tag-based rules to surface specific items. Filters
are listed below in the user's preferred order, which reflects their
priority. Tags within a group are combined with AND (all must match).
Groups are combined with the group operator (OR = any group matches).

1. **Work Projects** `[filter a1b2c3d4-e29b-41d4-a716-446655440000]` (bookmarks, notes)
   Rule: `(work AND project) OR (client)`

2. **Learning** `[filter b2c3d4e5-e29b-41d4-a716-446655440000]` (bookmarks)
   Rule: `(tutorial) OR (course)`

3. **Quick Reference** `[filter c3d4e5f6-e29b-41d4-a716-446655440000]` (bookmarks, notes)
   Rule: `(reference)`

## Sidebar Organization
Collections are a frontend-only grouping mechanism for organizing filters
visually. They have no effect on search or filtering behavior.

- Work Projects `[filter a1b2c3d4-e29b-41d4-a716-446655440000]`
- [collection] Study Materials
  - Learning `[filter b2c3d4e5-e29b-41d4-a716-446655440000]`
- Quick Reference `[filter c3d4e5f6-e29b-41d4-a716-446655440000]`

## Filter Contents
Top items from each filter, in sidebar order. Items already shown in a
previous filter are abbreviated.

### Work Projects
1. **Client Onboarding Checklist** `[note 2b3c4d5e-e29b-41d4-a716-446655440000]`
   Tags: work, project, client
   Preview: Steps for onboarding new clients: 1) Schedule kickoff...

2. **Project Roadmap Q1** `[bookmark 3c4d5e6f-e29b-41d4-a716-446655440000]`
   Tags: work, project
   Description: Internal roadmap for Q1 deliverables
   Preview: Q1 priorities: 1) Launch auth v2, 2) Migrate...

### Learning
1. **FastAPI Tutorial** `[bookmark 6ba7b810-e29b-41d4-a716-446655440000]`
   Tags: python, tutorial
   Description: Step-by-step guide to building APIs with FastAPI
   Preview: FastAPI is a modern, fast web framework for building APIs with Python...

2. **Rust Course Notes** `[note 4d5e6f7a-e29b-41d4-a716-446655440000]`
   Tags: tutorial, rust
   Preview: Chapter 1: Ownership and borrowing. Rust's key innovation is...

### Quick Reference
1. **Python Documentation** `[bookmark f47ac10b-e29b-41d4-a716-446655440000]`
   Tags: python, reference
   Description: Official Python 3.x documentation and standard library reference
   Preview: The Python Language Reference describes the exact syntax and semantics of...

2. **HTTP Status Codes** `[bookmark 5e6f7a8b-e29b-41d4-a716-446655440000]`
   Tags: reference, web
   Preview: 200 OK, 201 Created, 204 No Content, 301 Moved...

## Recently Used
1. **Python Documentation** `[bookmark f47ac10b-e29b-41d4-a716-446655440000]`
   Last used: 2026-01-25T08:30:00Z
   Tags: python, reference
   Description: Official Python 3.x documentation and standard library reference
   Preview: The Python Language Reference describes the exact syntax and semantics of...

2. **Meeting Notes 2026-01-20** `[note 7c9e6679-e29b-41d4-a716-446655440000]`
   Last used: 2026-01-25T05:30:00Z
   Tags: work, meeting
   Preview: Discussed the new authentication flow. Key decisions: 1) Use JWT...

3. **FastAPI Tutorial** `[bookmark 6ba7b810-e29b-41d4-a716-446655440000]`
   Last used: 2026-01-24T10:30:00Z
   Tags: python, tutorial
   Description: Step-by-step guide to building APIs with FastAPI
   Preview: FastAPI is a modern, fast web framework for building APIs with Python...

## Recently Created
1. **Project Ideas** `[note 9a8b7c6d-e29b-41d4-a716-446655440000]`
   Created: 2026-01-25T07:30:00Z
   Tags: ideas
   Preview: Potential projects for Q1: 1) CLI tool for...

2. **Meeting Notes 2026-01-20** `[note 7c9e6679-e29b-41d4-a716-446655440000]`
   Created: 2026-01-20T09:00:00Z
   (see Recently Used above)

## Recently Modified
1. **Architecture Notes** `[note 1a2b3c4d-e29b-41d4-a716-446655440000]`
   Modified: 2026-01-25T09:30:00Z
   Tags: work, architecture
   Preview: Updated the service layer diagram to reflect...

2. **Python Documentation** `[bookmark f47ac10b-e29b-41d4-a716-446655440000]`
   Modified: 2026-01-24T14:00:00Z
   (see Recently Used above)
```

### Prompt Context Tool Output

```markdown
# Prompt Context

Generated: 2026-01-25T10:30:00Z

## Overview
- **Prompts:** 30 active, 2 archived

## Top Tags
Tags are used to categorize prompts. A tag referenced by any filter
indicates it is important to the user's workflow.

| Tag | Prompts | Filters |
|-----|---------|---------|
| code-review | 8 | 2 |
| writing | 6 | 1 |
| analysis | 5 | 1 |
| summarize | 4 | 0 |

## Filters
Filters are custom saved views the user has created to organize their
prompts. They define tag-based rules to surface specific prompts. Filters
are listed below in the user's preferred order, which reflects their
priority. Tags within a group are combined with AND (all must match).
Groups are combined with the group operator (OR = any group matches).

1. **Development** `[filter d4e5f6a7-e29b-41d4-a716-446655440000]` (prompts)
   Rule: `(code-review) OR (refactor)`

2. **Writing Helpers** `[filter e5f6a7b8-e29b-41d4-a716-446655440000]` (prompts)
   Rule: `(writing) OR (editing)`

## Sidebar Organization
Collections are a frontend-only grouping mechanism for organizing filters
visually. They have no effect on search or filtering behavior.

- [collection] Code Tools
  - Development `[filter d4e5f6a7-e29b-41d4-a716-446655440000]`
- Writing Helpers `[filter e5f6a7b8-e29b-41d4-a716-446655440000]`

## Filter Contents
Top items from each filter, in sidebar order. Items already shown in a
previous filter are abbreviated.

### Development
1. **code-review** — "Code Review Assistant"
   Tags: code-review, development
   Description: Reviews code for common bugs, style issues, and suggests improvements
   Args: `language` (required), `code` (required), `focus_areas`
   Preview: Review the following {{ language }} code for bugs, style...

2. **refactor-code** — "Code Refactorer"
   Tags: refactor, development
   Args: `code` (required), `language` (required), `goals`
   Preview: Refactor the following {{ language }} code with these goals...

### Writing Helpers
1. **summarize-article** — "Article Summarizer"
   Tags: summarize, writing
   Args: `article_text` (required), `length`
   Preview: Summarize the following article in {{ length }} or fewer...

2. **proofread** — "Proofreader"
   Tags: writing, editing
   Args: `text` (required), `tone`
   Preview: Proofread the following text for grammar, clarity...

## Recently Used
1. **code-review** — "Code Review Assistant"
   Last used: 2026-01-25T08:30:00Z
   Tags: code-review, development
   Description: Reviews code for common bugs, style issues, and suggests improvements
   Args: `language` (required), `code` (required), `focus_areas`
   Preview: Review the following {{ language }} code for bugs, style...

2. **summarize-article** — "Article Summarizer"
   Last used: 2026-01-24T15:00:00Z
   Tags: summarize, writing
   Args: `article_text` (required), `length`
   Preview: Summarize the following article in {{ length }} or fewer...

3. **explain-code** — "Code Explainer"
   Last used: 2026-01-24T10:00:00Z
   Tags: code-review
   Description: Explains code at the appropriate level for the target audience
   Args: `code` (required), `audience`
   Preview: Explain what this code does to someone who is a...

## Recently Created
1. **meeting-notes** — "Meeting Notes Generator"
   Created: 2026-01-23T14:00:00Z
   Tags: writing, work
   Description: Generates structured meeting notes from raw notes
   Args: `raw_notes` (required), `attendees`
   Preview: Given the following raw meeting notes, create a...

2. **explain-code** — "Code Explainer"
   Created: 2026-01-22T11:00:00Z
   (see Recently Used above)

## Recently Modified
1. **code-review** — "Code Review Assistant"
   Modified: 2026-01-25T09:00:00Z
   (see Recently Used above)

2. **summarize-article** — "Article Summarizer"
   Modified: 2026-01-22T16:00:00Z
   (see Recently Used above)
```

---

## Working Backwards: What the API Endpoints Need to Return

Based on the markdown output above, here is what each API endpoint needs to provide.

### `GET /mcp/context/content` Response

```python
{
    "generated_at": "2026-01-25T10:30:00Z",
    "counts": {
        "bookmarks": {"active": 150, "archived": 25},
        "notes": {"active": 75, "archived": 5}
    },
    "top_tags": [
        {"name": "python", "content_count": 45, "filter_count": 3},
        {"name": "reference", "content_count": 38, "filter_count": 2}
    ],
    "filters": [
        {
            "id": "uuid",
            "name": "Work Projects",
            "content_types": ["bookmark", "note"],
            "filter_expression": {
                "groups": [{"tags": ["work", "project"]}, {"tags": ["client"]}],
                "group_operator": "OR"
            },
            "items": [
                {
                    "type": "bookmark",
                    "id": "uuid",
                    "title": "Client Onboarding Checklist",
                    "description": null,
                    "content_preview": "Steps for onboarding new clients...",
                    "tags": ["work", "project", "client"],
                    "last_used_at": "...",
                    "created_at": "...",
                    "updated_at": "..."
                }
            ]
        }
    ],
    "recently_used": [
        {
            "type": "bookmark",
            "id": "uuid",
            "title": "Python Documentation",
            "description": "Official Python 3.x documentation...",
            "content_preview": "The Python Language Reference describes...",
            "tags": ["python", "reference"],
            "last_used_at": "2026-01-25T10:30:00Z",
            "created_at": "2026-01-20T08:00:00Z",
            "updated_at": "2026-01-24T14:00:00Z"
        }
    ],
    "recently_created": [...],
    "recently_modified": [...]
}
```

**Data sources mapping:**

| Response field | Source | Existing? |
|---------------|--------|-----------|
| `counts` | `SELECT COUNT(*) ... GROUP BY` per type and status | New query (trivial) |
| `top_tags` | `get_user_tags_with_counts(content_types=["bookmark", "note"])` | **Existing** - reuse tag service with new `content_types` filter |
| `filters` | Existing `ContentFilterResponse` + sidebar ordering | **Existing** - combine filter service + sidebar service |
| `filters[].items` | Query each filter's expression with default sort, limit N | **New** - per-filter item query (concurrent) |
| `recently_used/created/modified` | Single custom query with 3 UNION ALLs (one per sort order), scoped to `["bookmark", "note"]` | **New** - dedicated lightweight query (see below) |

**Key insight:** The content context endpoint mostly orchestrates existing services. The main new work is:
1. Count queries (trivial)
2. Ordering filters by sidebar position (combine existing services)
3. Converting filter expression to human-readable string (done in MCP tool, not API)
4. A single recent-items query (see "Recent Items Query" below)

**Recent items query:** Rather than calling `search_all_content()` 3 times (once per sort order), use a single dedicated query that UNIONs 3 subqueries — each fetching the top N items for one sort order (`last_used_at`, `created_at`, `updated_at`), scoped to bookmarks and notes only. Tags are batch-fetched once for all unique IDs across the combined result. This avoids depending on `search_all_content` internals (no wasted count queries, no text search / filter expression / pagination logic), and reduces the number of concurrent tasks in `asyncio.gather`.

### `GET /mcp/context/prompts` Response

```python
{
    "generated_at": "2026-01-25T10:30:00Z",
    "counts": {
        "active": 30,
        "archived": 2
    },
    "top_tags": [
        {"name": "code-review", "content_count": 8, "filter_count": 2}
    ],
    "filters": [
        {
            "id": "uuid",
            "name": "Development",
            "content_types": ["prompt"],
            "filter_expression": {
                "groups": [{"tags": ["code-review"]}, {"tags": ["refactor"]}],
                "group_operator": "OR"
            },
            "items": [
                {
                    "id": "uuid",
                    "name": "code-review",
                    "title": "Code Review Assistant",
                    "description": "Reviews code for common bugs...",
                    "content_preview": "Review the following {{ language }} code...",
                    "arguments": [...],
                    "tags": ["code-review", "development"],
                    "last_used_at": "...",
                    "created_at": "...",
                    "updated_at": "..."
                }
            ]
        }
    ],
    "recently_used": [
        {
            "id": "uuid",
            "name": "code-review",
            "title": "Code Review Assistant",
            "description": "Reviews code for common bugs...",
            "content_preview": "Review the following {{ language }} code...",
            "arguments": [
                {"name": "language", "description": "Programming language", "required": true},
                {"name": "code", "description": "Code to review", "required": true},
                {"name": "focus_areas", "description": null, "required": false}
            ],
            "tags": ["code-review", "development"],
            "last_used_at": "2026-01-25T10:30:00Z",
            "created_at": "2026-01-10T08:00:00Z",
            "updated_at": "2026-01-25T09:00:00Z"
        }
    ],
    "recently_created": [...],
    "recently_modified": [...]
}
```

**Data sources mapping:**

| Response field | Source | Existing? |
|---------------|--------|-----------|
| `counts` | `SELECT COUNT(*) ... GROUP BY status` | New query (trivial) |
| `top_tags` | `get_user_tags_with_counts(content_types=["prompt"])` | **Existing** - reuse tag service with new `content_types` filter |
| `filters` | Filter service + sidebar, filtered to prompt content_types | **Existing** - filter by `content_types` |
| `filters[].items` | Query each filter's expression with default sort, limit N | **New** - per-filter item query (concurrent) |
| `recently_used/created/modified` | Single custom query with 3 UNION ALLs (one per sort order), prompts only | **New** - same pattern as content recent items query, but for prompts only (includes arguments) |

**Tag filtering by content type:** Add a `content_types: list[str] | None = None` parameter to `get_user_tags_with_counts()` in `tag_service.py`. When provided, only include count subqueries for the specified types (e.g., skip the prompt subquery when `content_types=["bookmark", "note"]`). Existing callers pass `None` to retain the current combined-count behavior. The content context endpoint passes `["bookmark", "note"]`; the prompt context endpoint passes `["prompt"]`.

---

## Performance: Concurrent Queries

Each context endpoint runs in two phases of concurrent tasks:
1. **Phase 1** (~4 tasks): counts, tags, filters, recent items. The recent items task is a single query that UNIONs 3 subqueries (one per sort order) and batch-fetches tags.
2. **Phase 2** (up to `filter_limit` tasks): query top items per filter. Runs after Phase 1 completes (needs the filter list).

All are lightweight indexed reads.

**Key constraint:** A single SQLAlchemy `AsyncSession` wraps a single database connection, which can only process one query at a time. To run queries concurrently, each coroutine needs its own session from the session factory.

```python
async def get_content_context(self, session_factory, user_id, ...):
    async def _query(fn, *args):
        async with session_factory() as db:
            return await fn(db, *args)

    # Phase 1: fetch counts, tags, filters, and recent items concurrently
    counts, tags, filters, recent_items = await asyncio.gather(
        _query(self._get_counts, user_id),
        _query(self._get_tags, user_id, tag_limit),
        _query(self._get_filters, user_id, filter_limit),
        _query(self._get_recent_items, user_id, recent_limit),
    )
    # recent_items contains all 3 lists (used, created, modified) from a single
    # UNION ALL query with batch-fetched tags

    # Phase 2: fetch top items per filter concurrently
    filter_items = await asyncio.gather(
        *[_query(self._get_filter_items, f, filter_item_limit) for f in filters]
    )
    for f, items in zip(filters, filter_items):
        f.items = items
```

This means the service needs access to a session factory rather than a single session.

### Session Factory Dependency

The existing `db/session.py` already has a module-level `async_session_factory` (an `async_sessionmaker`). The current `get_async_session` dependency yields a single session from it. For the context service, we need a new dependency that provides the factory itself:

```python
# In db/session.py (or api/dependencies.py)
def get_session_factory() -> async_sessionmaker:
    """Return the session factory for services that need concurrent queries."""
    return async_session_factory
```

The router injects this instead of (or in addition to) `get_async_session`:

```python
@router.get("/context/content")
async def get_content_context(
    session_factory: async_sessionmaker = Depends(get_session_factory),
    current_user: User = Depends(get_current_user),
    ...
```

Note: `get_current_user` already uses its own session internally, so it doesn't conflict.

### Test Override for Session Factory

The key challenge: in tests, `db_connection` wraps everything in a transaction that rolls back after each test. Concurrent queries need their own sessions, but those sessions must be bound to the **same test connection** so they see the same test data and participate in the same rollback.

The existing `conftest.py` already creates a test `session_factory` bound to `db_connection` with `join_transaction_mode="create_savepoint"` (line 97-102). We just need to expose it and override the dependency:

```python
# In conftest.py — new fixture
@pytest.fixture
def db_session_factory(db_connection: AsyncConnection) -> async_sessionmaker:
    """Session factory bound to the test transaction for concurrent query tests."""
    return async_sessionmaker(
        bind=db_connection,
        class_=AsyncSession,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )
```

Then in the `client` fixture, add the override:

```python
# Existing override:
app.dependency_overrides[get_async_session] = override_get_async_session

# New override:
from db.session import get_session_factory
app.dependency_overrides[get_session_factory] = lambda: db_session_factory
```

This way, concurrent queries in the context service each get their own session, but all sessions are bound to the same test connection/transaction. They see test data created via the test client, and everything rolls back after the test.

**Important:** Each session from the factory creates a savepoint (via `join_transaction_mode="create_savepoint"`), so concurrent reads don't interfere with each other within the same outer transaction.

**Note on test concurrency:** In tests, all sessions from the factory share the same `AsyncConnection`, so `asyncio.gather` queries serialize rather than running in parallel. This is expected — tests verify correctness, not parallelism. Production uses the real connection pool where queries run concurrently. If asyncpg raises "another operation in progress" errors during testing, the fallback is to add a test-only flag that runs queries sequentially.

---

## Milestone 1: API Endpoints

### Goal

Create both `GET /mcp/context/content` and `GET /mcp/context/prompts` API endpoints that return structured JSON.

### Success Criteria

- Both endpoints return structured JSON with the fields documented above
- Authentication uses `get_current_user`
- Filters are returned in sidebar order
- Recent items are sorted correctly by their respective timestamp
- Each filter includes its top N items (using the filter's default sort)
- Tags include both `content_count` and `filter_count`
- Tests cover all response sections and edge cases

### Key Changes

**New file: `backend/src/schemas/mcp_context.py`**

Define Pydantic schemas for both response types. Reuse existing schemas where possible (e.g., `PromptArgument` from `schemas/prompt.py`, `FilterExpression` from `schemas/content_filter.py`).

Content context schemas:

```python
class EntityCounts(BaseModel):
    active: int
    archived: int

class ContentContextCounts(BaseModel):
    bookmarks: EntityCounts
    notes: EntityCounts

class ContextTag(BaseModel):
    name: str
    content_count: int
    filter_count: int

class ContextFilter(BaseModel):
    id: UUID
    name: str
    content_types: list[str]
    filter_expression: FilterExpression  # Reuse existing schema
    items: list[ContextItem]  # Top N items matching this filter (for content context)
    # For prompt context, this is list[ContextPrompt] instead

class ContextItem(BaseModel):
    type: str
    id: UUID
    title: str | None
    description: str | None
    content_preview: str | None
    tags: list[str]
    last_used_at: datetime | None
    created_at: datetime
    updated_at: datetime

class SidebarCollectionContext(BaseModel):
    name: str
    filter_names: list[str]  # Names of tag-based filters in this collection

class ContentContextResponse(BaseModel):
    generated_at: datetime
    counts: ContentContextCounts
    top_tags: list[ContextTag]
    filters: list[ContextFilter]
    sidebar_collections: list[SidebarCollectionContext]  # Only collections containing tag-based filters; empty if no collections
    recently_used: list[ContextItem]
    recently_created: list[ContextItem]
    recently_modified: list[ContextItem]
```

Prompt context schemas:

```python
class ContextPrompt(BaseModel):
    id: UUID
    name: str
    title: str | None
    description: str | None
    content_preview: str | None
    arguments: list[PromptArgument]  # Reuse existing schema
    tags: list[str]
    last_used_at: datetime | None
    created_at: datetime
    updated_at: datetime

class PromptContextResponse(BaseModel):
    generated_at: datetime
    counts: EntityCounts
    top_tags: list[ContextTag]
    filters: list[ContextFilter]
    sidebar_collections: list[SidebarCollectionContext]  # Same as content context
    recently_used: list[ContextPrompt]
    recently_created: list[ContextPrompt]
    recently_modified: list[ContextPrompt]
```

**New file: `backend/src/services/mcp_context_service.py`**

Service that orchestrates existing services. See "Performance: Concurrent Queries" section above — uses `asyncio.gather()` with separate sessions per query.

```python
class MCPContextService:
    async def get_content_context(
        self,
        session_factory: async_sessionmaker,
        user_id: UUID,
        tag_limit: int = 50,
        recent_limit: int = 10,
        filter_limit: int = 5,
        filter_item_limit: int = 5,
    ) -> ContentContextResponse:
        # Concurrent queries via asyncio.gather()
        # Each query gets its own session from the factory
        # See Performance section for pattern
        # After filters are fetched, query top items per filter (concurrent)
        ...

    async def get_prompt_context(
        self,
        session_factory: async_sessionmaker,
        user_id: UUID,
        tag_limit: int = 50,
        recent_limit: int = 10,
        filter_limit: int = 5,
        filter_item_limit: int = 5,
    ) -> PromptContextResponse:
        # Same concurrent pattern, prompt-specific
        ...
```

Implementation notes:
- **Counts:** Use lightweight `SELECT COUNT(*)` queries grouped by status. The `BaseEntityService` doesn't have a count method currently, so add one or query directly.
- **Tags:** Reuse `tag_service.get_user_tags_with_counts()` with the new `content_types` parameter — pass `["bookmark", "note"]` for content context, `["prompt"]` for prompt context. Already returns `TagCount` with `content_count` and `filter_count`, sorted by `filter_count DESC, content_count DESC`. Apply `limit` parameter.
- **Filters in sidebar order:** Call `sidebar_service.get_computed_sidebar()` to get filter IDs in user's preferred order, then fetch corresponding `ContentFilter` objects. Only include filter items (not builtins like "All", "Archived", "Trash"). Exclude filters with empty filter expressions (no tag-based rules) — these are content-type-only shortcuts (e.g., "All Notes") that provide no additional information beyond what the Overview section already shows. For prompt context, further filter to only filters whose `content_types` include "prompt". Limit to top `filter_limit` filters (default 5).
- **Filter items:** For each included filter, query its top `filter_item_limit` items (default 5) using the filter's expression and default sort order. These per-filter queries run concurrently (after filters are fetched). This is a second phase of `asyncio.gather` — first fetch filters, then fetch items per filter in parallel.
- **Recent items:** Use a single dedicated query per endpoint that UNIONs 3 subqueries (one per sort order: `last_used_at DESC`, `created_at DESC`, `updated_at DESC`), each with `LIMIT N`. For content context, scope to bookmarks and notes only (`content_types=["bookmark", "note"]`). For prompt context, query prompts only (including arguments). Batch-fetch tags once for all unique IDs across the combined result. This avoids depending on `search_all_content` internals and eliminates unnecessary count/filter/pagination logic.
- **`last_used_at` null handling:** Items never accessed via `track_usage` have `last_used_at = NULL`. The `recently_used` subquery should sort nulls last (`ORDER BY last_used_at DESC NULLS LAST`). The `last_used_at` field in the response schema should be `datetime | None`. The MCP tool should omit the "Last used:" line for items with null `last_used_at`.

**New file: `backend/src/api/routers/mcp.py`**

```python
router = APIRouter(prefix="/mcp", tags=["MCP"])

@router.get("/context/content", response_model=ContentContextResponse)
async def get_content_context(
    tag_limit: int = Query(default=50, ge=1, le=100),
    recent_limit: int = Query(default=10, ge=1, le=50),
    filter_limit: int = Query(default=5, ge=0, le=20),
    filter_item_limit: int = Query(default=5, ge=1, le=20),
    current_user: User = Depends(get_current_user),
    session_factory: async_sessionmaker = Depends(get_session_factory),
) -> ContentContextResponse:
    ...

@router.get("/context/prompts", response_model=PromptContextResponse)
async def get_prompt_context(
    tag_limit: int = Query(default=50, ge=1, le=100),
    recent_limit: int = Query(default=10, ge=1, le=50),
    filter_limit: int = Query(default=5, ge=0, le=20),
    filter_item_limit: int = Query(default=5, ge=1, le=20),
    current_user: User = Depends(get_current_user),
    session_factory: async_sessionmaker = Depends(get_session_factory),
) -> PromptContextResponse:
    ...
```

**Update: `backend/src/api/main.py`**

Register the new router.

### Testing Strategy

Tests follow the existing pattern: real PostgreSQL via testcontainers (session-scoped), per-test transaction rollback for isolation, no mocking of the DB layer. Tests create data via HTTP endpoints (`client.post("/bookmarks/", json={...})`) and then call the context endpoint to verify the aggregated response.

**Test infrastructure for concurrent queries:** The context service uses a session factory (not a single session) for `asyncio.gather()`. The existing `client` fixture overrides `get_async_session` to yield a single test session. We need an additional fixture or dependency override for the session factory that creates sessions bound to the same test transaction:

```python
@pytest.fixture
async def db_session_factory(db_connection: AsyncConnection) -> async_sessionmaker:
    """Session factory bound to the test transaction (for concurrent query tests)."""
    return async_sessionmaker(
        bind=db_connection,
        class_=AsyncSession,
        expire_on_commit=False,
        join_transaction_mode="create_savepoint",
    )
```

The `client` fixture (or the router) needs to inject this factory so that concurrent queries in the context service all participate in the same test transaction and see the same test data. The implementing agent should determine how to wire this — likely a new FastAPI dependency that the `client` fixture overrides.

Create `backend/tests/api/test_mcp_context.py`:

**Content context tests:**

1. **Basic response:** Create bookmarks and notes, verify response has correct schema
2. **Counts:** Create known items (active + archived), verify counts are accurate
3. **Tags:** Create items with tags, verify top_tags sorted by filter_count/content_count and limited by `tag_limit`
4. **Filters in sidebar order:** Create filters, set sidebar order, verify filters appear in that order
5. **Filters only (no builtins):** Verify "all", "archived", "trash" builtins are excluded
6. **Filters without tag rules excluded:** Create a filter with no filter expression (e.g., "All Notes"), verify it is excluded
7. **Filter items:** Create a filter with tag rules and matching items, verify `items` contains the correct items
8. **Filter limit/item limit:** Verify `filter_limit` and `filter_item_limit` parameters are respected
8a. **Sidebar collections:** Create filters inside a collection, verify `sidebar_collections` includes the collection with its filter names. Verify collections without tag-based filters are excluded. Verify `sidebar_collections` is empty when no collections exist.
9. **Recent items by last_used_at:** Create items, call track_usage on some, verify order. Items with null `last_used_at` sort last.
10. **Recently created/modified:** Verify correct sort order
11. **Description included:** Create item with description, verify it appears; create without, verify null
12. **Empty state:** New user, verify valid response with empty lists and zero counts
13. **Auth:** Unauthenticated request returns 401

**Prompt context tests:**

1. **Basic response:** Create prompts, verify schema
2. **Counts:** Active + archived counts
3. **Arguments included:** Verify prompts include their arguments list
4. **Prompt name included:** Verify `name` field is present (used for name-based endpoints)
5. **Filters scoped to prompts:** Verify only filters with `content_types` including "prompt" appear
6. **Recently used/created/modified:** Correct sort order
7. **Empty state:** Valid response with no prompts
8. **Auth:** 401 on unauthenticated request

### Dependencies

None - this is the first milestone.

### Risk Factors

- **Sidebar service requires filters list:** `get_computed_sidebar()` takes a `filters` parameter. The agent should check the calling convention and ensure we have the filters available before calling it.
- **Performance:** See "Performance: Concurrent Queries" section. Need to pass session factory, not single session.

---

## Milestone 2: Content MCP Server Tool

### Goal

Add `get_context` tool to the Content MCP Server that calls `GET /mcp/context/content` and returns **markdown** (not JSON).

### Success Criteria

- `get_context` tool returns markdown text (not structured JSON)
- Markdown matches the target format documented above
- Tool description explains what context is returned and recommends calling at session start
- MCP server instructions updated
- Frontend settings page updated

### Key Changes

**Update: `backend/src/mcp_server/server.py`**

Add the tool. The key difference from other tools: this one converts the JSON API response to markdown.

```python
@mcp.tool(
    description="""Get a summary of the user's bookmarks and notes.

Use this at the START of a session to understand:
- What content the user has (counts by type)
- How content is organized (top tags, custom filters in priority order)
- What's inside each filter (top items per filter)
- What the user is actively working with (recently used, created, modified items)

Results reflect a point-in-time snapshot. Call once at session start; re-calling
is only useful if the user significantly creates, modifies, or reorganizes
content during the session.

Returns a markdown summary optimized for quick understanding. Use IDs from
the response with get_item for full content. Use tag names with search_items
to find related content.""",
    annotations={"readOnlyHint": True},
)
async def get_context(
    tag_limit: Annotated[int, Field(default=50, ge=1, le=100, description="Number of top tags")] = 50,
    recent_limit: Annotated[int, Field(default=10, ge=1, le=50, description="Recent items per category")] = 10,
    filter_limit: Annotated[int, Field(default=5, ge=0, le=20, description="Max filters to include")] = 5,
    filter_item_limit: Annotated[int, Field(default=5, ge=1, le=20, description="Items per filter")] = 5,
) -> str:
    # 1. Call API endpoint
    data = await api_get(client, "/mcp/context/content", token, params)
    # 2. Convert to markdown
    return _format_content_context_markdown(data)
```

The `_format_content_context_markdown(data: dict) -> str` function builds the markdown string from the API response. This is where the explanatory prose lives (what filters are, what filter_count means, etc.).

Key formatting responsibilities:
- Render filter expressions as human-readable rules: `(work AND project) OR (client)`
- Format filters with `[filter id]` suffix
- Format items with `[type id]` suffix
- Include description only when present
- Include preview
- Format tags as comma-separated
- **Sidebar Organization section:** Only rendered when the sidebar contains collections that have tag-based filters inside them. Shows a simple tree view with `[collection]` labels. Collections without any tag-based filters are omitted. If no collections exist, skip the section entirely (it would be redundant with the Filters list).
- **Deduplication:** If an item already appeared in an earlier section (e.g., Filter Contents or Recently Used), show only the title, ID, relevant timestamp, and `(see [section name] above)` instead of repeating all details. The MCP tool tracks IDs seen so far and abbreviates duplicates. Section order for dedup: Filter Contents → Recently Used → Recently Created → Recently Modified.

**Utility function for filter expression rendering:**

```python
def _format_filter_expression(expr: dict) -> str:
    """
    Convert filter expression to human-readable rule string.

    Example: {"groups": [{"tags": ["work", "project"]}, {"tags": ["client"]}], "group_operator": "OR"}
    Returns: "(work AND project) OR (client)"
    """
    groups = expr.get("groups", [])
    group_operator = expr.get("group_operator", "OR")
    parts = []
    for group in groups:
        tags = group.get("tags", [])
        if len(tags) == 1:
            parts.append(tags[0])
        elif len(tags) > 1:
            parts.append(f"({' AND '.join(tags)})")
    return f" {group_operator} ".join(parts) if parts else "All items"
```

**Update MCP server instructions** in the `instructions` string of `server.py`. Add `get_context` to the tool list and add guidance on when to use it. Example addition:

```
**Context:**
- `get_context`: Get a markdown summary of the user's content (counts, tags, filters with top items, recent items).
  Call this once at the start of a session to understand what the user has and how it's organized.
  Re-calling is only useful if the user significantly creates, modifies, or reorganizes content during the session.
  Use IDs from the response with `get_item` for full content. Use tag names with `search_items`.
```

Also add to the Example Workflows section:

```
9. "What does this user have?"
   - Call `get_context()` to get an overview of their content, tags, filters, and recent activity
```

**Update: `frontend/src/pages/settings/SettingsMCP.tsx`**

Add `get_context` to the tool list: "Get context summary of bookmarks and notes"

### Testing Strategy

Add to `backend/tests/mcp_server/`:

1. **Tool availability:** Tool appears in tool list with correct schema
2. **Markdown output format:** Call tool, verify output is a string containing expected markdown sections (## Overview, ## Top Tags, ## Filters, ## Recently Used, etc.)
3. **Filter expression rendering:** Unit test `_format_filter_expression` with various expressions:
   - Single tag group: `(python)` → `python`
   - Multi-tag group: `(work AND project)`
   - Multiple groups with OR: `(work AND project) OR (client)`
   - Empty expression: `All items`
4. **Item formatting:** Verify items include `[type id]`, description when present, preview
5. **Empty state:** Returns valid markdown with zero counts and no items
6. **Auth error:** Returns appropriate error

### Dependencies

Milestone 1 (API endpoints)

### Risk Factors

- **Markdown formatting:** Getting the markdown format right is iterative. The format defined in this plan is a starting point — adjust based on testing.

---

## Milestone 3: Prompt MCP Server Tool

### Goal

Add `get_context` tool to the Prompt MCP Server that calls `GET /mcp/context/prompts` and returns **markdown**.

### Success Criteria

- `get_context` tool returns markdown text
- Markdown matches the target format documented above
- Prompt items include name, title, description, arguments, preview
- MCP server instructions updated
- Frontend settings page updated

### Key Changes

**Update: `backend/src/prompt_mcp_server/server.py`**

Add to tool list in `handle_list_tools()`:

```python
types.Tool(
    name="get_context",
    description="""Get a summary of the user's prompts.

Use this at the START of a session to understand:
- What prompts the user has (counts)
- How prompts are organized (tags, filters in priority order)
- What's inside each filter (top prompts per filter)
- What prompts the user frequently uses (recently used)

Results reflect a point-in-time snapshot. Call once at session start; re-calling
is only useful if the user significantly creates, modifies, or reorganizes
content during the session.

Returns a markdown summary optimized for quick understanding. Use prompt
names from the response with get_prompt_content for full templates.
Use tag names with search_prompts to find related prompts.""",
    inputSchema={
        "type": "object",
        "properties": {
            "tag_limit": {"type": "integer", "default": 50, "minimum": 1, "maximum": 100,
                          "description": "Number of top tags"},
            "recent_limit": {"type": "integer", "default": 10, "minimum": 1, "maximum": 50,
                             "description": "Recent prompts per category"},
            "filter_limit": {"type": "integer", "default": 5, "minimum": 0, "maximum": 20,
                             "description": "Max filters to include"},
            "filter_item_limit": {"type": "integer", "default": 5, "minimum": 1, "maximum": 20,
                                  "description": "Items per filter"},
        },
    },
    annotations=types.ToolAnnotations(readOnlyHint=True),
)
```

Add handler that calls the API and converts to markdown:

```python
async def _handle_get_context(arguments: dict[str, Any]) -> types.CallToolResult:
    data = await api_get(client, "/mcp/context/prompts", token, params)
    markdown = _format_prompt_context_markdown(data)
    return types.CallToolResult(
        content=[types.TextContent(type="text", text=markdown)],
    )
```

Note: **No `structuredContent`** — the whole point is to return compact markdown, not duplicate JSON.

The `_format_prompt_context_markdown` function formats prompt items as:
```
1. **name** — "Title"
   Tags: tag1, tag2
   Description: ...  (only if present)
   Args: `arg1` (required), `arg2` (required), `arg3`
   Preview: First N chars of template...
```

The filter expression formatter can be shared (copied or extracted to a shared utility in `backend/src/shared/`).

**Update MCP server instructions** in the `instructions` string of `server.py`. Add `get_context` to the tool list and add guidance. Example addition:

```
**Context:**
- `get_context`: Get a markdown summary of the user's prompts (counts, tags, filters with top items, recent prompts with arguments).
  Call this once at the start of a session to understand what prompts exist and how they're organized.
  Re-calling is only useful if the user significantly creates, modifies, or reorganizes content during the session.
  Use prompt names from the response with `get_prompt_content` for full templates.
```

Also add to Example Workflows.

**Update: `frontend/src/pages/settings/SettingsMCP.tsx`**

Add `get_context` to the prompt MCP tool list.

### Testing Strategy

Add to `backend/tests/prompt_mcp_server/`:

1. **Tool availability:** Tool in list with correct schema
2. **Markdown output:** Verify sections present (## Overview, ## Top Tags, ## Filters, ## Recently Used, etc.)
3. **Prompt formatting:** Verify items include name, title, args with required/optional markers, description when present, preview
4. **No structured content:** Verify `CallToolResult` has no `structuredContent`
5. **Empty state:** Valid markdown with zero counts
6. **Auth error handling**

### Dependencies

Milestones 1 and 2 (API endpoints and content tool for shared patterns)

### Risk Factors

- **Shared formatting code:** The filter expression formatter is needed by both MCP servers. Since they're separate packages, either duplicate the small utility or extract to `backend/src/shared/`. The agent should decide based on the codebase conventions.

---

## Milestone 4: Expose Filters in MCP Tools

### Goal

Make filters actionable in both MCP servers by adding a `filter_id` parameter to search tools and a new `list_filters` tool. This allows agents to use filter IDs from the context output to search within filters.

### Success Criteria

- `search_items` (content MCP) accepts optional `filter_id` parameter
- `search_prompts` (prompt MCP) accepts optional `filter_id` parameter
- Both MCP servers have a `list_filters` tool that returns filters with IDs, names, content_types, and filter expressions
- MCP server instructions updated for both servers
- Frontend settings page updated for both servers

### Key Changes

**Update: `backend/src/mcp_server/server.py`**

Add `filter_id` parameter to `search_items`:

```python
filter_id: Annotated[
    str | None,
    Field(description="Filter by content filter ID (UUID). Use list_filters to discover filter IDs."),
] = None,
```

The tool passes `filter_id` to the existing API endpoint which already supports it (`GET /content?filter_id=...`).

Add `list_filters` tool:

```python
@mcp.tool(
    description="""List the user's content filters.

Filters are saved views with tag-based rules. Use filter IDs with search_items
to search within a specific filter. Returns filter ID, name, content types,
and the tag-based filter expression.""",
    annotations={"readOnlyHint": True},
)
async def list_filters() -> dict[str, Any]:
    # Call GET /filters
    data = await api_get(client, "/filters", token)
    return data
```

**Update: `backend/src/prompt_mcp_server/server.py`**

Add `filter_id` parameter to `search_prompts` input schema:

```python
"filter_id": {
    "type": "string",
    "description": "Filter by content filter ID (UUID). Use list_filters to discover filter IDs.",
},
```

Add `list_filters` tool (same pattern — calls `GET /filters`, returns result).

**Update MCP server instructions** in both servers. Add `list_filters` to the tool list and update `search_items`/`search_prompts` descriptions. Example additions:

Content MCP:
```
- `list_filters`: List the user's content filters with IDs, names, and tag rules.
  Use filter IDs with `search_items(filter_id=...)` to search within a specific filter.
```

Prompt MCP:
```
- `list_filters`: List the user's prompt filters with IDs, names, and tag rules.
  Use filter IDs with `search_prompts(filter_id=...)` to search within a specific filter.
```

**Update: `frontend/src/pages/settings/SettingsMCP.tsx`**

Add `list_filters` to both tool lists.

### Testing Strategy

**Content MCP tests:**

1. **`search_items` with `filter_id`:** Create a filter, create items matching it, verify `search_items(filter_id=...)` returns matching items
2. **`list_filters` tool:** Create filters, verify tool returns all filters with IDs, names, content_types, and expressions
3. **`list_filters` empty state:** No filters, verify empty list returned

**Prompt MCP tests:**

1. **`search_prompts` with `filter_id`:** Same pattern for prompts
2. **`list_filters` tool:** Same as content
3. **`list_filters` empty state:** Same

### Dependencies

Milestones 1-3 (context endpoints provide the filter IDs that make this useful, though this milestone is technically independent)

### Risk Factors

- **Minimal:** The API already supports `filter_id` on all search endpoints and has a full `/filters` CRUD router. This milestone just exposes existing functionality in the MCP tools.

---

## Milestone 5: Documentation

### Goal

Update all documentation to reflect the new endpoints and tools.

### Success Criteria

- CLAUDE.md updated with MCP context endpoints section
- MCP server instructions are complete and consistent
- Frontend settings page lists `get_context` and `list_filters` for both servers
- No stale references anywhere

### Key Changes

**Update: `CLAUDE.md`**

Add under the existing MCP section:

```markdown
### MCP Context Endpoints

Dedicated endpoints for AI agent consumption, returning structured JSON:

- `GET /mcp/context/content` - Aggregated context about bookmarks/notes (counts, tags, filters, recent items)
- `GET /mcp/context/prompts` - Aggregated context about prompts (counts, tags, filters, recent prompts with arguments)

The MCP tools (`get_context`) convert this JSON to markdown optimized for LLM consumption.
```

**Verify:** MCP server instructions in both `server.py` files are complete.

### Testing Strategy

- Grep for consistency across documentation
- Manual review

### Dependencies

Milestones 1-4

### Risk Factors

None

---

## Summary of Changes

### New Files
| File | Purpose |
|------|---------|
| `backend/src/schemas/mcp_context.py` | Pydantic response schemas for both endpoints |
| `backend/src/services/mcp_context_service.py` | Service orchestrating existing services |
| `backend/src/api/routers/mcp.py` | Router with both context endpoints |
| `backend/tests/api/test_mcp_context.py` | API endpoint tests |

### Modified Files
| File | Change |
|------|--------|
| `backend/src/services/tag_service.py` | Add `content_types` parameter to `get_user_tags_with_counts()` |
| `backend/src/api/main.py` | Register MCP router |
| `backend/src/mcp_server/server.py` | Add `get_context` tool + markdown formatter + update instructions |
| `backend/src/prompt_mcp_server/server.py` | Add `get_context` tool + markdown formatter + update instructions |
| `backend/tests/mcp_server/test_*.py` | Tests for content `get_context` tool |
| `backend/tests/prompt_mcp_server/test_*.py` | Tests for prompt `get_context` tool |
| `frontend/src/pages/settings/SettingsMCP.tsx` | Add `get_context` to both tool lists |
| `CLAUDE.md` | Document MCP context endpoints |

---

## Future Enhancements (Not in Scope)

These were discussed but are intentionally deferred:

1. **Usage frequency tracking** - Count of uses, not just `last_used_at`
2. **Tag co-occurrence** - Pairs of tags that frequently appear together
3. **Top domains** (bookmarks) - Which sites the user bookmarks from most
4. **Tag descriptions** - User-defined tag meanings
5. **Content relationships** - Explicit links between items
6. **Stale content indicators** - Items not used in N days
