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

### 2.1 Tests (test_prompt_schemas.py)

**PromptArgument validation:**
- `test__prompt_argument__valid_name` - lowercase with underscores (e.g., `user_name`, `x`, `a1_b2`)
- `test__prompt_argument__invalid_name_uppercase` - rejects `UserName`
- `test__prompt_argument__invalid_name_starts_with_number` - rejects `1name`
- `test__prompt_argument__invalid_name_has_hyphen` - rejects `user-name`
- `test__prompt_argument__name_max_length` - 100 chars accepted, 101 rejected
- `test__prompt_argument__required_defaults_to_none`

**PromptCreate validation:**
- `test__prompt_create__valid_name` - lowercase with hyphens (e.g., `my-prompt`, `x`, `a1-b2`)
- `test__prompt_create__invalid_name_uppercase` - rejects `MyPrompt`
- `test__prompt_create__invalid_name_underscore` - rejects `my_prompt`
- `test__prompt_create__invalid_name_starts_with_hyphen` - rejects `-prompt`
- `test__prompt_create__invalid_name_ends_with_hyphen` - rejects `prompt-`
- `test__prompt_create__name_max_length` - 255 chars accepted, 256 rejected
- `test__prompt_create__title_max_length` - 500 chars accepted, 501 rejected
- `test__prompt_create__duplicate_argument_names_rejected`
- `test__prompt_create__tags_normalized` - `"Machine Learning"` becomes `"machine-learning"`
- `test__prompt_create__empty_arguments_list_valid`

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
- `get_by_name()` - custom method for name-based lookup (for MCP server)

Keep `validate_template()` function for Jinja2 syntax and undefined variable validation.

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
- `test__create__validates_template_undefined_variables`
- `test__create__allows_empty_content`
- `test__create__allows_template_with_defined_arguments`
- `test__update__validates_template_syntax`
- `test__update__validates_template_undefined_variables`

**get_by_name:**
- `test__get_by_name__returns_prompt`
- `test__get_by_name__returns_none_for_nonexistent`
- `test__get_by_name__returns_none_for_deleted`
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
- `test__create_prompt__name_already_exists` - 409 or 400
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
- `test__update_prompt__name_conflict` - 409 or 400

**Delete (DELETE /{id}):**
- `test__delete_prompt__soft_delete_default`
- `test__delete_prompt__permanent_delete`
- `test__delete_prompt__not_found` - 404

**Archive (POST /{id}/archive):**
- `test__archive_prompt__success`
- `test__archive_prompt__already_archived` - 400 or 409
- `test__archive_prompt__not_found` - 404

**Unarchive (POST /{id}/unarchive):**
- `test__unarchive_prompt__success`
- `test__unarchive_prompt__not_archived` - 400 or 409
- `test__unarchive_prompt__not_found` - 404

**Restore (POST /{id}/restore):**
- `test__restore_prompt__success`
- `test__restore_prompt__not_deleted` - 400 or 409
- `test__restore_prompt__not_found` - 404

**Track usage (POST /{id}/track-usage):**
- `test__track_usage__success`
- `test__track_usage__not_found` - 404

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

### 5.1 Tests (test_prompt_mcp_server.py)

**list_prompts handler:**
- `test__list_prompts__returns_prompt_list`
- `test__list_prompts__empty_list_when_no_prompts`
- `test__list_prompts__includes_name_description_arguments`

**get_prompt handler:**
- `test__get_prompt__renders_template_with_arguments`
- `test__get_prompt__renders_template_no_arguments`
- `test__get_prompt__missing_required_argument_error`
- `test__get_prompt__extra_unknown_argument_error`
- `test__get_prompt__prompt_not_found_error`
- `test__get_prompt__optional_argument_uses_default`

**Template rendering:**
- `test__render_template__simple_substitution`
- `test__render_template__complex_jinja_logic`
- `test__render_template__syntax_error_returns_error`

**Authentication:**
- `test__auth__valid_token_succeeds`
- `test__auth__invalid_token_fails`
- `test__auth__missing_token_fails`
- `test__auth__expired_token_fails`

**API client error handling:**
- `test__api_client__network_error_handled`
- `test__api_client__api_error_response_handled`

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

### 6.6 Tests

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

Ensure cascade delete is tested for all entity types:
- `test_prompt_service.py`: `test__cascade_delete__user_deletion_removes_prompts`
- `test_note_service.py`: `test__cascade_delete__user_deletion_removes_notes` (added earlier)
- `test_bookmark_service.py`: `test__cascade_delete__user_deletion_removes_bookmarks` (added earlier)

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
7. Run migration (`make migrate`)
8. **Run Milestone 1 & 2 tests**
9. services/tag_service.py - prompt functions
10. services/prompt_service.py
11. **Run Milestone 3 tests**
12. api/routers/prompts.py
13. api/main.py - register router
14. **Run Milestone 4 tests**
15. prompt_mcp_server package
16. **Run Milestone 5 tests**
17. Frontend types/api/hooks
18. Frontend pages
19. **Run Milestone 6 tests**
20. Security tests
21. Documentation
22. Deployment config

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
| `backend/tests/models/test_prompt_model.py` | Create |
| `backend/tests/schemas/test_prompt_schemas.py` | Create |
| `backend/tests/services/test_prompt_service.py` | Create |
| `backend/tests/api/test_prompts_api.py` | Create |
| `backend/tests/prompt_mcp_server/test_prompt_mcp_server.py` | Create |
| `backend/tests/security/test_live_penetration.py` | Modify |
| `frontend/src/types.ts` | Modify |
| `frontend/src/services/api.ts` | Modify |
| `frontend/src/hooks/usePrompts.ts` | Create |
| `frontend/src/pages/PromptsPage.tsx` | Create |
| `frontend/src/pages/PromptEditorPage.tsx` | Create |
| `frontend/src/__tests__/pages/PromptsPage.test.tsx` | Create |
| `frontend/src/__tests__/pages/PromptEditorPage.test.tsx` | Create |
| `frontend/src/__tests__/hooks/usePrompts.test.ts` | Create |
| `Makefile` | Modify |

---

## Key Patterns

- **Model**: Copy `models/note.py` structure
- **Service**: Copy `services/note_service.py` structure
- **Schemas**: Copy `schemas/note.py` tag extraction pattern
- **Router**: Copy `routers/notes.py` endpoint structure
- **Tests**: Copy `tests/services/test_note_service.py` test categories
- **MCP Server**: Reference existing `mcp_server/` for patterns
