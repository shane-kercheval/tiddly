# Prompts Feature - Full Implementation Plan

**Date:** 2026-01-03
**Status:** Approved

## Overview

Implement Prompts as a first-class entity with the same capabilities as Notes and Bookmarks:
- Soft delete, archive, restore
- Tags
- Usage tracking (last_used_at)
- Full search with filtering, sorting, pagination
- MCP server for Claude Desktop integration
- Frontend UI for management

Prompts are Jinja2 templates with defined arguments, served via MCP protocol for AI assistant use.

---

## References

### MCP Specification

- **Prompts Capability:** https://modelcontextprotocol.io/docs/concepts/prompts
- **MCP SDK (Python):** https://github.com/modelcontextprotocol/python-sdk

Key concepts from spec:
- `prompts/list` - Returns list of available prompts with name, description, arguments
- `prompts/get` - Returns rendered prompt content with provided arguments

**MCP SDK Types (from `mcp.types`):**

```python
# What we use from the SDK:
class Prompt(BaseMetadata):
    name: str                              # Required - prompt identifier
    title: str | None = None               # Optional - display name for UI
    description: str | None = None         # Optional
    arguments: list[PromptArgument] | None = None

class PromptArgument(BaseModel):
    name: str                              # Required - argument identifier
    description: str | None = None         # Optional
    required: bool | None = None           # Optional (None treated as False)

class GetPromptResult(Result):
    description: str | None = None
    messages: list[PromptMessage]          # Required - the rendered prompt content

class PromptMessage(BaseModel):
    role: Literal["user", "assistant"]     # Required
    content: TextContent | ImageContent | EmbeddedResource
```

**Low-level Server decorators:**
```python
@server.list_prompts()
async def handle_list() -> list[types.Prompt]:
    ...

@server.get_prompt()
async def handle_get(name: str, arguments: dict[str, str] | None) -> types.GetPromptResult:
    ...
```

**Error Codes (JSON-RPC standard):**
- `INVALID_PARAMS = -32602` - Invalid prompt name, missing required arguments
- `INTERNAL_ERROR = -32603` - Server errors

**Error handling:**
```python
from mcp.shared.exceptions import McpError
from mcp.types import ErrorData, INVALID_PARAMS

raise McpError(ErrorData(code=INVALID_PARAMS, message="Prompt not found"))
```

### Reference Implementation: External (tools_api)

**Location:** `/Users/shanekercheval/repos/reasoning-agent-api/tools_api`

| Component | Path | What to Copy |
|-----------|------|--------------|
| MCP Server | `tools_api/mcp_server.py` | `@server.list_prompts()` and `@server.get_prompt()` decorator patterns |
| Main App | `tools_api/main.py` | `StreamableHTTPSessionManager` setup and ASGI mounting |
| Template | `tools_api/services/prompts/template.py` | Jinja2 `StrictUndefined` rendering |

**CRITICAL DIFFERENCE: Static vs Dynamic**

| Aspect | tools_api (DON'T copy) | Our approach |
|--------|------------------------|--------------|
| Storage | File-based `PromptRegistry._prompts` dict | Database via REST API |
| Discovery | Static at startup | Dynamic per-request |
| New prompts | Requires restart | Immediate |

### Reference Implementation: This Codebase

The existing Bookmarks MCP Server provides patterns for auth and API client:

| Component | Path | Notes |
|-----------|------|-------|
| Server | `backend/src/mcp_server/server.py` | Uses FastMCP (decorator-based) for tools. Prompt server uses low-level SDK instead. |
| Auth | `backend/src/mcp_server/auth.py` | Bearer token extraction from headers. Uses `fastmcp.server.dependencies.get_http_headers()` which we CAN'T use with low-level SDK - we use `contextvars` instead. |
| API Client | `backend/src/mcp_server/api_client.py` | `api_get()`, `api_post()` helpers. **Can copy directly.** |
| Tests | `backend/tests/mcp_server/` | Test patterns for tools, auth, API client. |

**Key difference:** The existing server uses FastMCP which provides `get_http_headers()` for auth. The low-level SDK doesn't have this, so we extract the token in the ASGI handler and pass it via `contextvars`.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     MCP Client (Claude Desktop)                  │
└─────────────────────────┬───────────────────────────────────────┘
                          │ PAT Authentication
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  TWO MCP SERVERS:                                                │
│                                                                  │
│  1. mcp.tiddly.me/mcp (port 8001) - Bookmarks/Notes MCP Server  │
│     - Tools: search_bookmarks, get_bookmark, create_bookmark,   │
│              search_notes, get_note, create_note, list_tags     │
│     - For content management via AI assistants                  │
│                                                                  │
│  2. prompts.tiddly.me/mcp (port 8002) - Prompt MCP Server       │
│     - Prompts: list_prompts, get_prompt (MCP prompts capability)│
│     - Tools: create_prompt (for creating new prompts via AI)    │
│     - For prompt template management                            │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP API
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Main API (api.tiddly.me)                      │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  POST /prompts/        - Create prompt                   │   │
│  │  GET /prompts/         - List prompts                    │   │
│  │  GET /prompts/{id}     - Get prompt by ID                │   │
│  │  GET /prompts/name/{name} - Get prompt by name           │   │
│  │  PATCH /prompts/{id}   - Update prompt                   │   │
│  │  DELETE /prompts/{id}  - Delete prompt                   │   │
│  │  POST /prompts/{id}/archive - Archive                    │   │
│  │  POST /prompts/{id}/restore - Restore from trash         │   │
│  │  POST /prompts/{id}/track-usage - Update last_used_at    │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PostgreSQL Database                         │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  prompts                                                 │    │
│  │  - id (PK)                                              │    │
│  │  - user_id (FK → users, CASCADE)                        │    │
│  │  - name (unique per user for active, e.g., "code-review")│   │
│  │  - title (optional, e.g., "Code Review Assistant")      │    │
│  │  - description (optional)                               │    │
│  │  - content (Jinja2 template)                            │    │
│  │  - arguments (JSONB): [{name, description, required}]   │    │
│  │  - tags (via prompt_tags junction table)                │    │
│  │  - created_at, updated_at, last_used_at                 │    │
│  │  - deleted_at, archived_at (soft delete/archive)        │    │
│  │  PARTIAL UNIQUE(user_id, name) WHERE deleted_at IS NULL │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  prompt_tags (junction table)                           │    │
│  │  - prompt_id (FK, CASCADE)                              │    │
│  │  - tag_id (FK, CASCADE)                                 │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Port Allocation

| Service | Port | Domain | Description |
|---------|------|--------|-------------|
| Main API | 8000 | api.tiddly.me | REST API |
| Bookmarks MCP Server | 8001 | mcp.tiddly.me/mcp | Tools for bookmarks/notes |
| **Prompt MCP Server** | **8002** | **prompts.tiddly.me/mcp** | Prompts capability + create_prompt tool |

---

## Key Design Decisions

### 1. Prompts Use BaseEntityService

Prompts use `BaseEntityService[Prompt]` to get:
- Soft delete (`deleted_at`) and permanent delete
- Archive/unarchive (`archived_at`)
- Tags via junction table
- Usage tracking (`last_used_at`)
- View filtering (active, archived, deleted)
- Full search with filtering, sorting, pagination

This matches the Notes and Bookmarks patterns exactly.

### 2. Naming Conventions

**Important distinction:**
- **Prompt names** use hyphens: `code-review`, `explain-code`
- **Argument names** use underscores: `code_to_review`, `language`

This difference is intentional:
- Prompt names are URL-friendly identifiers (hyphens preferred)
- Argument names must be valid Jinja2/Python identifiers (underscores required, hyphens not allowed)

The frontend editor should provide hint text explaining this to users.

### 3. Name and Title (Aligned with MCP SDK)

- `name` - Required programmatic identifier (lowercase with hyphens, e.g., "code-review")
- `title` - Optional human-readable display name (e.g., "Code Review Assistant")
- Partial unique constraint `(user_id, name)` WHERE `deleted_at IS NULL` enforced by database
- MCP clients display `title` if provided, otherwise fall back to `name`
- Sort by title uses `COALESCE(title, name)` so prompts without titles sort by name

### 4. URL Pattern

- Use `{id}` for CRUD operations (consistent with notes/bookmarks, works with BaseEntityService)
- Add `/name/{name}` endpoint for MCP server lookups (prompts are identified by name in MCP)

### 5. Rate Limiting

Prompt endpoints follow the same rate limiting tiers as bookmarks:

| Auth Type | Operation | Per Minute | Per Day |
|-----------|-----------|------------|---------|
| PAT | Read (GET) | 120 | 2000 |
| PAT | Write (POST/PATCH/DELETE) | 60 | 2000 |
| Auth0 | Read | 300 | 4000 |
| Auth0 | Write | 90 | 4000 |

Rate limiting is applied via the existing `rate_limiter` middleware. No sensitive operations (external HTTP) are performed by prompt endpoints, so the `sensitive` tier is not used.

### 6. Authentication

All prompt endpoints use `get_current_user`, which accepts both Auth0 JWTs and Personal Access Tokens (PATs). This is appropriate because:
- No external HTTP requests are made (unlike `fetch-metadata`)
- PAT access enables legitimate automation use cases (including MCP server)
- Rate limiting provides abuse protection

### 7. Template Validation at Save Time

- All template variables must have corresponding arguments
- Duplicate argument names rejected
- Invalid Jinja2 syntax rejected (e.g., `{{ unclosed` fails immediately)

---

## Milestone 1: Database & Models

### 1.1 Create Migration

Run: `make migration message="create prompts table"`

The migration creates:

**prompts table:**
| Column | Type | Notes |
|--------|------|-------|
| id | Integer PK | |
| user_id | Integer FK | CASCADE delete, indexed |
| name | String(255) | Required, prompt identifier |
| title | String(500) | Optional display name |
| description | Text | Optional |
| content | Text | Jinja2 template |
| arguments | JSONB | Default [], [{name, description, required}] |
| created_at | DateTime TZ | From TimestampMixin |
| updated_at | DateTime TZ | From TimestampMixin |
| last_used_at | DateTime TZ | Indexed, server_default=clock_timestamp() |
| deleted_at | DateTime TZ | Nullable, indexed |
| archived_at | DateTime TZ | Nullable, indexed |

**Constraints:**
- Partial unique index: `uq_prompt_user_name_active` on (user_id, name) WHERE deleted_at IS NULL

**prompt_tags junction table:**
| Column | Type |
|--------|------|
| prompt_id | Integer FK (CASCADE), PK |
| tag_id | Integer FK (CASCADE), PK |

Index on tag_id.

### 1.2 models/tag.py

Add `prompt_tags` junction table (pattern from `note_tags`):
```python
prompt_tags = Table(
    "prompt_tags",
    Base.metadata,
    Column("prompt_id", ForeignKey("prompts.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
    Index("ix_prompt_tags_tag_id", "tag_id"),
)
```

Add to Tag class:
```python
prompts: Mapped[list["Prompt"]] = relationship(
    secondary=prompt_tags,
    back_populates="tag_objects",
)
```

### 1.3 models/prompt.py (new)

Pattern from `models/note.py`:
- Inherit `Base`, `TimestampMixin`
- All columns from table above
- `tag_objects` relationship via `prompt_tags`
- `is_archived` hybrid property (copy from Note)
- User relationship with `back_populates="prompts"`

### 1.4 models/user.py

Add prompts relationship:
```python
prompts: Mapped[list["Prompt"]] = relationship(
    back_populates="user",
    cascade="all, delete-orphan",
)
```

### 1.5 models/__init__.py

Export `Prompt` and `prompt_tags`.

### 1.6 Tests (test_prompt_model.py)

Run after migration is applied.

**Model instantiation:**
- `test__prompt_model__creates_with_required_fields` - name, user_id
- `test__prompt_model__creates_with_all_fields` - all columns populated
- `test__prompt_model__arguments_defaults_to_empty_list`

**Relationships:**
- `test__prompt_model__user_relationship` - prompt.user returns User
- `test__prompt_model__tag_objects_relationship` - prompt.tag_objects returns tags

**Hybrid properties:**
- `test__prompt_model__is_archived_false_when_archived_at_null`
- `test__prompt_model__is_archived_true_when_archived_at_set`

**CASCADE behavior:**
- `test__prompt_model__cascade_delete_user_removes_prompts`
- `test__prompt_model__cascade_delete_prompt_removes_prompt_tags`

**Partial unique index:**
- `test__prompt_model__unique_name_per_user_for_active` - duplicate name raises IntegrityError
- `test__prompt_model__same_name_allowed_after_soft_delete` - can reuse name when original is deleted
- `test__prompt_model__same_name_allowed_different_users` - different users can have same name

---

## Milestone 2: Schemas

**File:** `schemas/prompt.py`

### PromptArgument
- name (pattern: `^[a-z][a-z0-9_]*$`, max 100) - **underscores allowed, hyphens NOT allowed**
- description (optional)
- required (bool, optional, None=False)

### PromptCreate
- name (required, pattern: `^[a-z0-9]+(-[a-z0-9]+)*$`, max 255) - **hyphens allowed, underscores NOT allowed**
- title (optional, max 500)
- description (optional, max `settings.max_description_length`)
- content (optional, max `settings.max_content_length`)
- arguments (default [])
- tags (default [], with normalize validator)
- archived_at (optional datetime)

Validators:
- Duplicate argument names rejected
- Tags normalized to lowercase with hyphens

### PromptUpdate
- All fields optional
- tags (list | None)
- archived_at support

### PromptListItem
- Excludes `content` (can be large)
- Includes `arguments` (needed for MCP list_prompts)
- Includes `tags: list[str]` with model_validator extraction
- Includes all timestamp fields (created_at, updated_at, last_used_at, deleted_at, archived_at)

### PromptResponse
- Extends PromptListItem
- Adds `content`

### PromptListResponse
- items, total, offset, limit, has_more

### 2.1 Tests (test_prompt_schemas.py)

**PromptArgument validation:**
- `test__prompt_argument__valid_name` - lowercase with underscores (e.g., `user_name`, `x`, `a1_b2`)
- `test__prompt_argument__invalid_name_uppercase` - rejects `UserName`
- `test__prompt_argument__invalid_name_starts_with_number` - rejects `1name`
- `test__prompt_argument__invalid_name_has_hyphen` - rejects `user-name` (hyphens not valid in Jinja2 identifiers)
- `test__prompt_argument__name_max_length` - 100 chars accepted, 101 rejected
- `test__prompt_argument__required_defaults_to_none`

**PromptCreate validation:**
- `test__prompt_create__valid_name` - lowercase with hyphens (e.g., `my-prompt`, `x`, `a1-b2`)
- `test__prompt_create__invalid_name_uppercase` - rejects `MyPrompt`
- `test__prompt_create__invalid_name_underscore` - rejects `my_prompt` (underscores not valid in URL-friendly names)
- `test__prompt_create__invalid_name_starts_with_hyphen` - rejects `-prompt`
- `test__prompt_create__invalid_name_ends_with_hyphen` - rejects `prompt-`
- `test__prompt_create__name_max_length` - 255 chars accepted, 256 rejected
- `test__prompt_create__title_max_length` - 500 chars accepted, 501 rejected
- `test__prompt_create__duplicate_argument_names_rejected`
- `test__prompt_create__tags_normalized` - `"Machine Learning"` becomes `"machine-learning"`
- `test__prompt_create__empty_arguments_list_valid`
- `test__prompt_create__description_max_length` - uses settings.max_description_length
- `test__prompt_create__content_max_length` - uses settings.max_content_length

**PromptUpdate validation:**
- `test__prompt_update__all_fields_optional`
- `test__prompt_update__tags_none_means_no_change`
- `test__prompt_update__tags_empty_list_clears_tags`

**PromptListItem:**
- `test__prompt_list_item__excludes_content`
- `test__prompt_list_item__extracts_tags_from_tag_objects`

**PromptResponse:**
- `test__prompt_response__includes_content`

---

## Milestone 3: Service Layer

### 3.1 services/prompt_service.py

**PromptService(BaseEntityService[Prompt])**

Class attributes:
```python
model = Prompt
junction_table = prompt_tags
entity_name = "Prompt"
```

Required implementations:
- `_build_text_search_filter()` - search name, title, description, content
- `_get_sort_columns()` - standard + title with `func.coalesce(Prompt.title, Prompt.name)`

Override methods:
- `create()` - template validation, tags, name uniqueness
- `update()` - template validation, tags, name uniqueness
- `get_by_name()` - custom method for name-based lookup (for MCP server); returns only active prompts (excludes deleted AND archived)

Keep `validate_template()` function for Jinja2 syntax and undefined variable validation:
```python
from jinja2 import Environment, meta, TemplateSyntaxError

_jinja_env = Environment()

def validate_template(content: str | None, arguments: list[dict[str, Any]]) -> None:
    """
    Validate Jinja2 template syntax and variables.

    Raises:
        ValueError: If template has invalid syntax or uses undefined variables.
    """
    if not content:
        return

    # Validate syntax first
    try:
        ast = _jinja_env.parse(content)
    except TemplateSyntaxError as e:
        raise ValueError(f"Invalid Jinja2 syntax: {e.message}")

    # Check for undefined variables
    template_vars = meta.find_undeclared_variables(ast)
    if not template_vars:
        return

    defined_args = {arg["name"] for arg in arguments} if arguments else set()
    undefined = template_vars - defined_args

    if undefined:
        raise ValueError(
            f"Template uses undefined variable(s): {', '.join(sorted(undefined))}. "
            "Add them to arguments or remove from template."
        )
```

### 3.2 services/tag_service.py

Add:
- `update_prompt_tags()` function
- Update `get_user_tags_with_counts()` to include prompt tag counts

### 3.3 Tests (test_prompt_service.py)

Pattern from `test_note_service.py`. All tests run against database.

**CRUD operations:**
- `test__create__creates_prompt_with_required_fields`
- `test__create__creates_prompt_with_all_fields`
- `test__create__creates_prompt_with_tags`
- `test__create__rejects_duplicate_name_for_user`
- `test__create__allows_duplicate_name_different_users`
- `test__get__returns_prompt_by_id`
- `test__get__returns_none_for_nonexistent`
- `test__update__updates_all_fields`
- `test__update__partial_update_preserves_other_fields`
- `test__update__rejects_name_change_to_existing`
- `test__update__allows_name_change_to_soft_deleted_name`
- `test__delete__soft_deletes_by_default`
- `test__delete__permanent_delete_removes_from_db`

**Soft delete behavior:**
- `test__soft_delete__sets_deleted_at`
- `test__soft_delete__frees_name_for_reuse`
- `test__list__excludes_soft_deleted_by_default`
- `test__get__returns_soft_deleted_prompt` (service layer returns it, router filters)

**View filtering:**
- `test__list__view_active_excludes_deleted_and_archived`
- `test__list__view_archived_returns_only_archived`
- `test__list__view_deleted_returns_only_deleted`
- `test__list__view_all_returns_everything`

**Restore:**
- `test__restore__clears_deleted_at`
- `test__restore__clears_archived_at_if_set`
- `test__restore__returns_none_for_not_deleted`

**Archive/unarchive:**
- `test__archive__sets_archived_at`
- `test__archive__returns_none_for_already_archived`
- `test__unarchive__clears_archived_at`
- `test__unarchive__returns_none_for_not_archived`

**Track usage:**
- `test__track_usage__updates_last_used_at`
- `test__track_usage__returns_updated_prompt`

**Tag filtering:**
- `test__list__filters_by_single_tag`
- `test__list__filters_by_multiple_tags_match_all`
- `test__list__filters_by_multiple_tags_match_any`
- `test__list__tag_filter_returns_empty_for_no_match`

**Sort:**
- `test__list__sort_by_created_at_desc` (default)
- `test__list__sort_by_created_at_asc`
- `test__list__sort_by_updated_at`
- `test__list__sort_by_last_used_at`
- `test__list__sort_by_title_uses_coalesce` - prompts with null title sort by name

**Text search:**
- `test__list__search_matches_name`
- `test__list__search_matches_title`
- `test__list__search_matches_description`
- `test__list__search_matches_content`
- `test__list__search_case_insensitive`
- `test__list__search_partial_match`

**Pagination:**
- `test__list__pagination_offset`
- `test__list__pagination_limit`
- `test__list__pagination_has_more_true`
- `test__list__pagination_has_more_false`
- `test__list__returns_total_count`

**User isolation:**
- `test__list__excludes_other_users_prompts`
- `test__get__returns_none_for_other_users_prompt`
- `test__update__returns_none_for_other_users_prompt`
- `test__delete__returns_false_for_other_users_prompt`

**Cascade delete:**
- `test__cascade_delete__user_deletion_removes_prompts`

**Template validation (prompt-specific):**
- `test__create__validates_template_syntax`
- `test__create__validates_template_undefined_variables` - template uses var not in arguments → error
- `test__create__allows_empty_content`
- `test__create__allows_template_with_defined_arguments`
- `test__create__allows_unused_arguments` - arguments defined but not used in template → OK
- `test__update__validates_template_syntax`
- `test__update__validates_template_undefined_variables`

**get_by_name (returns only active prompts for MCP):**
- `test__get_by_name__returns_prompt`
- `test__get_by_name__returns_none_for_nonexistent`
- `test__get_by_name__returns_none_for_deleted`
- `test__get_by_name__returns_none_for_archived`
- `test__get_by_name__returns_none_for_other_users_prompt`

---

## Milestone 4: REST API

**File:** `api/routers/prompts.py`

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | / | Create prompt |
| GET | / | List/search with q, tags, tag_match, sort_by, sort_order, offset, limit, view, list_id |
| GET | /{id} | Get by ID |
| GET | /name/{name} | Get by name (for MCP server) |
| PATCH | /{id} | Update |
| DELETE | /{id} | Soft delete (permanent=true for hard delete) |
| POST | /{id}/archive | Archive |
| POST | /{id}/unarchive | Unarchive |
| POST | /{id}/restore | Restore from trash |
| POST | /{id}/track-usage | Update last_used_at |

**Note:** Uses `{id}` for CRUD operations (consistent with notes/bookmarks). `/name/{name}` endpoint added for MCP server which looks up prompts by name.

### schemas/content_list.py

Add "prompt" to `ContentType` enum to enable list_id filtering for prompts:
```python
class ContentType(str, Enum):
    BOOKMARK = "bookmark"
    NOTE = "note"
    PROMPT = "prompt"  # Add this
```

### api/main.py

Register router: `app.include_router(prompts.router)`

### 4.1 Tests (test_prompts_api.py)

Pattern from `test_notes.py` and `test_bookmarks.py`.

**Create (POST /):**
- `test__create_prompt__success`
- `test__create_prompt__with_tags`
- `test__create_prompt__validation_error_invalid_name` - 400
- `test__create_prompt__validation_error_duplicate_arguments` - 400
- `test__create_prompt__template_syntax_error` - 400
- `test__create_prompt__name_already_exists` - 409
- `test__create_prompt__unauthenticated` - 401

**List (GET /):**
- `test__list_prompts__returns_paginated_list`
- `test__list_prompts__excludes_content_in_list_items`
- `test__list_prompts__search_query_filters`
- `test__list_prompts__tag_filter`
- `test__list_prompts__tag_match_any`
- `test__list_prompts__sort_by_title`
- `test__list_prompts__view_archived`
- `test__list_prompts__view_deleted`
- `test__list_prompts__pagination`

**Get by ID (GET /{id}):**
- `test__get_prompt__success`
- `test__get_prompt__includes_content`
- `test__get_prompt__not_found` - 404
- `test__get_prompt__other_users_prompt` - 404 (not 403, to avoid info leak)

**Get by name (GET /name/{name}):**
- `test__get_prompt_by_name__success`
- `test__get_prompt_by_name__not_found` - 404
- `test__get_prompt_by_name__deleted_prompt` - 404

**Update (PATCH /{id}):**
- `test__update_prompt__success`
- `test__update_prompt__partial_update`
- `test__update_prompt__update_tags`
- `test__update_prompt__clear_tags_with_empty_list`
- `test__update_prompt__validation_error` - 400
- `test__update_prompt__template_syntax_error` - 400
- `test__update_prompt__not_found` - 404
- `test__update_prompt__name_conflict` - 409

**Delete (DELETE /{id}):**
- `test__delete_prompt__soft_delete_default`
- `test__delete_prompt__permanent_delete`
- `test__delete_prompt__not_found` - 404

**Archive (POST /{id}/archive):**
- `test__archive_prompt__success`
- `test__archive_prompt__already_archived` - 409
- `test__archive_prompt__not_found` - 404

**Unarchive (POST /{id}/unarchive):**
- `test__unarchive_prompt__success`
- `test__unarchive_prompt__not_archived` - 409
- `test__unarchive_prompt__not_found` - 404

**Restore (POST /{id}/restore):**
- `test__restore_prompt__success`
- `test__restore_prompt__not_deleted` - 409
- `test__restore_prompt__not_found` - 404

**Track usage (POST /{id}/track-usage):**
- `test__track_usage__success`
- `test__track_usage__not_found` - 404

---

## Milestone 5: Prompt MCP Server

**Package:** `backend/src/prompt_mcp_server/`

**Domain:** `prompts.tiddly.me` (separate from `mcp.tiddly.me` which serves bookmarks/notes)

Uses low-level MCP SDK for **dynamic prompt loading** (not FastMCP, not static registry).

### Key Design: No Registry (Dynamic API Calls)

Unlike the tools_api reference implementation which uses a static `PromptRegistry`, we query the REST API on each MCP request:

```
MCP Client Request (prompts/list)
    ↓
prompt_mcp_server (list_prompts handler)
    ↓
GET /prompts/?limit=100 (REST API with Bearer token)
    ↓
Database query (user's active prompts)
    ↓
Return list[types.Prompt] to MCP client
```

This means:
- New prompts available immediately after creation (no restart)
- Each user sees only their own prompts
- Authentication flows through to API

### Files

| File | Purpose |
|------|---------|
| `__init__.py` | Package marker |
| `__main__.py` | Entry point (`python -m prompt_mcp_server`) |
| `main.py` | FastAPI app with lifespan, mounts MCP as ASGI sub-app |
| `server.py` | MCP Server with list_prompts/get_prompt handlers AND create_prompt tool |
| `auth.py` | Context-based token management via contextvars |
| `api_client.py` | HTTP client helpers (copy from mcp_server) |
| `template_renderer.py` | Jinja2 rendering with validation |

### MCP Handlers (server.py)

**Pattern:** Use `mcp.server.lowlevel.Server` with decorators (see `tools_api/mcp_server.py`)

| Handler | API Call | Returns |
|---------|----------|---------|
| `@server.list_prompts()` | `GET /prompts/?limit=100` | `list[types.Prompt]` |
| `@server.get_prompt()` | `GET /prompts/name/{name}`, then `POST /prompts/{id}/track-usage` | `types.GetPromptResult` |
| `@server.list_tools()` | None | `list[types.Tool]` with `create_prompt` |
| `@server.call_tool()` | `POST /prompts/` | `list[types.TextContent]` |

**Key behaviors:**
- `list_prompts`: Query API each time (dynamic, no cache); limited to 200 prompts
- `get_prompt`: Render template with Jinja2, track usage (fire-and-forget - don't await track-usage call)
- `create_prompt` tool: Forward to API, return created prompt name

### Template Renderer (template_renderer.py)

**Pattern:** Copy from `tools_api/services/prompts/template.py`

- Use `jinja2.Environment(undefined=StrictUndefined)`
- Validate unknown arguments rejected
- Validate required arguments present
- Return empty string for empty content

### Auth Module (auth.py)

**Pattern:** Use `contextvars` (NOT FastMCP's `get_http_headers()`)

- `set_current_token(token)` - called by ASGI handler before MCP dispatch
- `get_bearer_token()` - called by MCP handlers to get token
- `clear_current_token()` - called after MCP dispatch (in finally block)

### Main Application (main.py)

**Pattern:** Combine `tools_api/main.py` ASGI mounting with our auth

Key components:
- `Settings` with `env_prefix = "PROMPT_MCP_"` for config
- `lifespan` creates `StreamableHTTPSessionManager(app=server, json_response=True, stateless=True)`
- `mcp_asgi_handler` extracts Bearer token, sets contextvar, delegates to session manager
- Mount at `/mcp`
- Health check at `/health`

### API Client (api_client.py)

**Copy and modify from:** `backend/src/mcp_server/api_client.py`

Same `api_get()` and `api_post()` helpers, but update env var names:
- `VITE_API_URL` → `PROMPT_MCP_API_BASE_URL`
- `MCP_API_TIMEOUT` → `PROMPT_MCP_API_TIMEOUT`

### Makefile

Add target:
```makefile
prompt-server:  ## Start Prompt MCP server
	cd backend && uv run python -m prompt_mcp_server
```

### Port: 8002

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PROMPT_MCP_PORT` | `8002` | Server port |
| `PROMPT_MCP_API_BASE_URL` | `http://localhost:8000` | Main API URL |
| `PROMPT_MCP_API_TIMEOUT` | `30.0` | API request timeout (seconds) |

### Known Limitations

- **200-prompt limit**: `list_prompts` returns max 200 prompts. Users with more won't see all in Claude Desktop.

### 5.1 Tests (test_prompt_mcp_server.py)

**list_prompts handler:**
- `test__list_prompts__returns_prompt_list`
- `test__list_prompts__empty_list_when_no_prompts`
- `test__list_prompts__includes_name_title_description_arguments`
- `test__list_prompts__uses_limit_100`

**get_prompt handler:**
- `test__get_prompt__renders_template_with_arguments`
- `test__get_prompt__renders_template_no_arguments`
- `test__get_prompt__missing_required_argument_error` - INVALID_PARAMS
- `test__get_prompt__extra_unknown_argument_error` - INVALID_PARAMS
- `test__get_prompt__prompt_not_found_error` - INVALID_PARAMS
- `test__get_prompt__optional_argument_uses_default`
- `test__get_prompt__tracks_usage` - verifies POST /prompts/{id}/track-usage called
- `test__get_prompt__returns_prompt_message_with_user_role`

**create_prompt tool:**
- `test__create_prompt_tool__creates_prompt`
- `test__create_prompt_tool__creates_with_arguments`
- `test__create_prompt_tool__creates_with_tags`
- `test__create_prompt_tool__validation_error_invalid_name`
- `test__create_prompt_tool__validation_error_duplicate_name`
- `test__create_prompt_tool__validation_error_template_syntax`

**Template rendering:**
- `test__render_template__simple_substitution`
- `test__render_template__complex_jinja_logic`
- `test__render_template__syntax_error_returns_error`
- `test__render_template__empty_content_returns_empty_string`

**Authentication:**
- `test__auth__valid_token_succeeds`
- `test__auth__invalid_token_fails` - 401
- `test__auth__missing_token_fails` - 401
- `test__auth__expired_token_fails` - 401

**API client error handling:**
- `test__api_client__network_error_handled` - INTERNAL_ERROR
- `test__api_client__api_error_response_handled`

**Context cleanup:**
- `test__auth__token_cleared_after_request`

**Health:**
- `test__health_check__returns_healthy`

---

## Milestone 6: Frontend

### 6.1 Types (frontend/src/types.ts)

```typescript
export interface PromptArgument {
  name: string
  description: string | null
  required: boolean | null  // null treated as false
}

export interface Prompt {
  id: number
  name: string
  title: string | null
  description: string | null
  content: string | null
  arguments: PromptArgument[]
  tags: string[]
  created_at: string
  updated_at: string
  last_used_at: string
  deleted_at: string | null
  archived_at: string | null
}
```

### 6.2 API Service (frontend/src/services/api.ts)

Add prompt CRUD methods using `{id}` for update/delete.

### 6.3 React Query Hooks (frontend/src/hooks/usePrompts.ts)

Follow patterns from `useNotes.ts`:
- `usePromptsQuery()` - list with search/filter
- `usePromptQuery(id)` - single prompt
- `useCreatePrompt()`
- `useUpdatePrompt()`
- `useDeletePrompt()`
- `useArchivePrompt()`
- `useRestorePrompt()`

### 6.4 Pages

**PromptsPage.tsx:**
- List all prompts with name, title, description, tags
- Search/filter controls
- View switcher (active/archived/deleted)
- Create button

**PromptEditorPage.tsx:**
- Name input (validated, hint: "Use lowercase with hyphens, e.g., code-review")
- Title input (optional)
- Description textarea
- Content textarea (Jinja2 template)
- Arguments builder (add/edit/delete)
  - Name input (validated, hint: "Use lowercase with underscores, e.g., code_to_review")
  - Description input
  - Required checkbox
- Tags input
- Save/cancel buttons
- Validation error display

### 6.5 Navigation

Add "Prompts" to sidebar with terminal/command icon.

### 6.6 Settings - MCP Integration Page

Update the MCP Integration settings page to include the new Prompts MCP server.

**Current:** Shows single config for `notes_bookmarks` server (port 8001)

**New:** Add toggle to select which server config to display:
- **Bookmarks/Notes** - existing `notes_bookmarks` server (port 8001)
- **Prompts** - new `prompts` server (port 8002)
- **All** - combined config with both servers

Example "All" config:
```json
{
  "mcpServers": {
    "notes_bookmarks": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://mcp.tiddly.me/mcp",
        "--header",
        "Authorization: Bearer YOUR_TOKEN_HERE"
      ]
    },
    "prompts": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://prompts.tiddly.me/mcp",
        "--header",
        "Authorization: Bearer YOUR_TOKEN_HERE"
      ]
    }
  }
}
```

Update `generateConfig()` to accept a server selection parameter.

### 6.7 Tests

**Component tests (PromptsPage.test.tsx):**
- `test__prompts_page__renders_prompt_list`
- `test__prompts_page__displays_empty_state`
- `test__prompts_page__search_filters_list`
- `test__prompts_page__view_switcher_changes_view`
- `test__prompts_page__create_button_navigates`
- `test__prompts_page__click_prompt_navigates_to_editor`

**Component tests (PromptEditorPage.test.tsx):**
- `test__prompt_editor__renders_empty_for_new`
- `test__prompt_editor__loads_existing_prompt`
- `test__prompt_editor__name_validation_error_displayed`
- `test__prompt_editor__add_argument`
- `test__prompt_editor__remove_argument`
- `test__prompt_editor__duplicate_argument_name_error`
- `test__prompt_editor__save_calls_api`
- `test__prompt_editor__cancel_navigates_back`
- `test__prompt_editor__displays_api_error`

**Hook tests (usePrompts.test.ts):**
- `test__use_prompts_query__fetches_prompts`
- `test__use_prompts_query__includes_search_params`
- `test__use_create_prompt__calls_api`
- `test__use_create_prompt__invalidates_cache`
- `test__use_update_prompt__calls_api`
- `test__use_delete_prompt__calls_api`

**MCP Settings tests (SettingsMCP.test.tsx):**
- `test__mcp_settings__toggle_bookmarks_notes_shows_single_server`
- `test__mcp_settings__toggle_prompts_shows_single_server`
- `test__mcp_settings__toggle_all_shows_both_servers`
- `test__mcp_settings__generate_config_uses_correct_urls`

---

## Milestone 7: Integration & Security Tests

This milestone consolidates cross-cutting tests that verify the system works end-to-end.

### Security Tests (test_live_penetration.py)

Add prompt IDOR tests matching bookmark/note patterns:
- `test__prompt_idor__get_other_users_prompt_returns_404`
- `test__prompt_idor__update_other_users_prompt_returns_404`
- `test__prompt_idor__delete_other_users_prompt_returns_404`
- `test__prompt_idor__archive_other_users_prompt_returns_404`

### Cascade Delete Tests

Add missing cascade delete tests to existing service tests, plus new prompt test:
- `test_bookmark_service.py`: Add `test__cascade_delete__user_deletion_removes_bookmarks`
- `test_note_service.py`: Add `test__cascade_delete__user_deletion_removes_notes`
- `test_prompt_service.py`: `test__cascade_delete__user_deletion_removes_prompts` (already in Milestone 3)

### Tag Service Integration

- `test__get_user_tags_with_counts__includes_prompt_tags`
- `test__update_prompt_tags__creates_new_tags`
- `test__update_prompt_tags__removes_unused_tags`

---

## Milestone 8: Documentation & Deployment

### Documentation

- Update README with prompts feature
- Update CLAUDE.md with prompt endpoints
- Example prompts
- Document the two MCP servers:
  - `mcp.tiddly.me` - Bookmarks/Notes tools
  - `prompts.tiddly.me` - Prompt templates + create_prompt tool

### Deployment (README_DEPLOY.md)

- Add prompt-mcp service to Railway
- Environment variables:
  - `PROMPT_MCP_PORT=8002`
  - `API_BASE_URL`
- Health check: `/health`
- Domain: `prompts.tiddly.me`

---
