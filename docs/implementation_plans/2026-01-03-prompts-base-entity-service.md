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

---

## Milestone 2: Schemas

**File:** `schemas/prompt.py`

### PromptArgument
- name (pattern: `^[a-z][a-z0-9_]*$`, max 100)
- description (optional)
- required (bool, optional, None=False)

### PromptCreate
- name (required, pattern: `^[a-z0-9]+(-[a-z0-9]+)*$`, max 255)
- title (optional, max 500)
- description (optional)
- content (optional)
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
- Includes `tags: list[str]` with model_validator extraction
- Includes all timestamp fields (created_at, updated_at, last_used_at, deleted_at, archived_at)

### PromptResponse
- Extends PromptListItem
- Adds `content`

### PromptListResponse
- items, total, offset, limit, has_more

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
- `get_by_name()` - custom method for name-based lookup (for MCP server)

Keep `validate_template()` function for Jinja2 syntax and undefined variable validation.

### 3.2 services/tag_service.py

Add:
- `update_prompt_tags()` function
- Update `get_user_tags_with_counts()` to include prompt tag counts

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

### api/main.py

Register router: `app.include_router(prompts.router)`

---

## Milestone 5: Prompt MCP Server

**Package:** `backend/src/prompt_mcp_server/`

Uses low-level MCP SDK for dynamic prompt loading (not FastMCP).

### Files

| File | Purpose |
|------|---------|
| `__init__.py` | Package marker |
| `__main__.py` | Entry point |
| `main.py` | FastAPI app with lifespan |
| `server.py` | MCP Server with list_prompts/get_prompt handlers |
| `auth.py` | Context-based token management |
| `template_renderer.py` | Jinja2 rendering with validation |

### MCP Handlers

**list_prompts():**
- Calls `GET /prompts/?limit=100`
- Returns `list[types.Prompt]`

**get_prompt(name, arguments):**
- Calls `GET /prompts/name/{name}`
- Renders template with provided arguments
- Returns `types.GetPromptResult` with rendered content

### Makefile

Add target:
```makefile
prompt-server:  ## Start Prompt MCP server
	cd backend && uv run python -m prompt_mcp_server
```

### Port: 8002

---

## Milestone 6: Frontend

### 6.1 Types (frontend/src/types.ts)

```typescript
export interface PromptArgument {
  name: string
  description: string | null
  required: boolean | null
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
- Name input (validated)
- Title input (optional)
- Description textarea
- Content textarea (Jinja2 template)
- Arguments builder (add/edit/delete)
- Tags input
- Save/cancel buttons
- Validation error display

### 6.5 Navigation

Add "Prompts" to sidebar with terminal/command icon.

---

## Milestone 7: Tests

### Service Tests (test_prompt_service.py)

Match coverage from `test_note_service.py`:
- CRUD operations
- Soft delete / permanent delete
- View filtering (active, archived, deleted)
- Restore (clears both timestamps)
- Archive / unarchive
- Track usage
- Tag filtering
- Sort tests
- Text search
- Pagination
- User isolation
- Cascade delete (user deletion removes prompts)
- Template validation (prompt-specific)

### API Tests (test_prompts.py)

- All endpoints
- Validation errors (400)
- Template validation errors
- Name uniqueness

### MCP Server Tests

- list_prompts returns correct format
- get_prompt renders template
- Missing required argument error
- Unknown argument error
- Auth token validation

### Security Tests (test_live_penetration.py)

Add prompt IDOR tests matching bookmark/note patterns.

---

## Milestone 8: Documentation & Deployment

### Documentation

- Update README with prompts feature
- Update CLAUDE.md with prompt endpoints
- Example prompts

### Deployment (README_DEPLOY.md)

- Add prompt-mcp service to Railway
- Environment variables:
  - `PROMPT_MCP_PORT=8002`
  - `API_BASE_URL`
- Health check: `/health`

---

## Implementation Order

1. Migration (`make migration`)
2. models/tag.py - prompt_tags, Tag.prompts
3. models/prompt.py
4. models/user.py - prompts relationship
5. models/__init__.py
6. schemas/prompt.py
7. services/tag_service.py - prompt functions
8. services/prompt_service.py
9. api/routers/prompts.py
10. api/main.py - register router
11. Run migration (`make migrate`)
12. Backend tests
13. prompt_mcp_server package
14. MCP server tests
15. Frontend types/api/hooks
16. Frontend pages
17. Frontend tests
18. Security tests
19. Documentation
20. Deployment config

---

## Files Summary

| File | Action |
|------|--------|
| `backend/src/models/tag.py` | Modify |
| `backend/src/models/prompt.py` | Create |
| `backend/src/models/user.py` | Modify |
| `backend/src/models/__init__.py` | Modify |
| `backend/src/schemas/prompt.py` | Create |
| `backend/src/services/tag_service.py` | Modify |
| `backend/src/services/prompt_service.py` | Create |
| `backend/src/api/routers/prompts.py` | Create |
| `backend/src/api/main.py` | Modify |
| `backend/src/prompt_mcp_server/*` | Create |
| `backend/tests/services/test_prompt_service.py` | Create |
| `backend/tests/api/test_prompts.py` | Create |
| `backend/tests/prompt_mcp_server/*` | Create |
| `backend/tests/security/test_live_penetration.py` | Modify |
| `frontend/src/types.ts` | Modify |
| `frontend/src/services/api.ts` | Modify |
| `frontend/src/hooks/usePrompts.ts` | Create |
| `frontend/src/pages/PromptsPage.tsx` | Create |
| `frontend/src/pages/PromptEditorPage.tsx` | Create |
| `Makefile` | Modify |

---

## Key Patterns

- **Model**: Copy `models/note.py` structure
- **Service**: Copy `services/note_service.py` structure
- **Schemas**: Copy `schemas/note.py` tag extraction pattern
- **Router**: Copy `routers/notes.py` endpoint structure
- **Tests**: Copy `tests/services/test_note_service.py` categories
- **MCP Server**: Reference existing `mcp_server/` for patterns
