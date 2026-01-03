# Refactor Prompts to Use BaseEntityService

**Date:** 2026-01-03
**Status:** Approved
**Goal:** Make Prompts a first-class entity matching Notes and Bookmarks patterns - with soft delete, archive, tags, usage tracking, and full search capabilities.

**Approach:** Start fresh from `main` branch and implement properly from the beginning.

---

## Phase 1: Database & Models

### 1.1 Create Migration

Create new migration that:
- Creates `prompts` table with ALL columns from the start
- Creates `prompt_tags` junction table

**Prompts table columns:**
- `id` (PK)
- `user_id` (FK to users, CASCADE delete, indexed)
- `name` (String 255, not null) - prompt identifier
- `title` (String 500, nullable) - display name
- `description` (Text, nullable)
- `content` (Text, nullable) - Jinja2 template
- `arguments` (JSONB, default []) - [{name, description, required}]
- `created_at`, `updated_at` (from TimestampMixin)
- `last_used_at` (DateTime TZ, not null, indexed, server_default=clock_timestamp())
- `deleted_at` (DateTime TZ, nullable, indexed)
- `archived_at` (DateTime TZ, nullable, indexed)

**Constraints:**
- Partial unique index: `uq_prompt_user_name_active` on (user_id, name) WHERE deleted_at IS NULL

**prompt_tags junction table:**
- `prompt_id` (FK, CASCADE, PK)
- `tag_id` (FK, CASCADE, PK)
- Index on `tag_id`

### 1.2 Update models/tag.py

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

### 1.3 Create models/prompt.py

Pattern from `models/note.py`:
- Inherit `Base`, `TimestampMixin`
- All columns listed above
- `tag_objects` relationship via `prompt_tags`
- `is_archived` hybrid property (copy from Note)
- User relationship with `back_populates="prompts"`

### 1.4 Update models/user.py

Add prompts relationship:
```python
prompts: Mapped[list["Prompt"]] = relationship(
    back_populates="user",
    cascade="all, delete-orphan",
)
```

---

## Phase 2: Schemas

**File:** `schemas/prompt.py`

### PromptArgument (keep existing)
- name, description, required

### PromptCreate
- name (required, pattern validation)
- title, description, content (optional)
- arguments (default [])
- tags (default [], with normalize validator)
- archived_at (optional datetime)

### PromptUpdate
- All fields optional
- tags (list | None)
- archived_at support

### PromptListItem
- Excludes `content` (can be large)
- Includes `tags: list[str]` with model_validator extraction
- Includes all timestamp fields

### PromptResponse
- Extends PromptListItem
- Adds `content`

### PromptListResponse
- items, total, offset, limit, has_more

---

## Phase 3: Service Layer

**File:** `services/prompt_service.py`

### PromptService(BaseEntityService[Prompt])

Class attributes:
- `model = Prompt`
- `junction_table = prompt_tags`
- `entity_name = "Prompt"`

Required implementations:
- `_build_text_search_filter()` - search name, title, description, content
- `_get_sort_columns()` - standard + title (coalesce with name)

Override methods:
- `create()` - template validation, tags, name uniqueness
- `update()` - template validation, tags, name uniqueness
- `get_by_name()` - custom method for name-based lookup

Keep `validate_template()` function for Jinja2 validation.

### Update services/tag_service.py

- Add `update_prompt_tags()` function
- Update `get_user_tags_with_counts()` to include prompt counts

---

## Phase 4: Router

**File:** `api/routers/prompts.py`

Pattern from `routers/notes.py`:

### Endpoints:

**Decision:** Use `{id}` for CRUD operations (consistent with notes/bookmarks, reuses BaseEntityService). Add `/name/{name}` endpoint for MCP server lookups.

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

---

## Phase 5: Tests

### Service Tests (test_prompt_service.py)

Match coverage from `test_note_service.py`:
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
- Cascade delete
- Template validation (prompt-specific)

### API Tests (test_prompts.py)

- All CRUD operations
- Archive/unarchive/restore endpoints
- View filtering parameter
- Tag filtering parameter
- Template validation errors

---

## Implementation Order

1. **Migration** - Create prompts table and prompt_tags
2. **models/tag.py** - Add prompt_tags and Tag.prompts relationship
3. **models/prompt.py** - Full model with BaseEntityService compatibility
4. **models/user.py** - Add prompts relationship
5. **models/__init__.py** - Export new items
6. **schemas/prompt.py** - Full schema set
7. **services/tag_service.py** - Add prompt tag functions
8. **services/prompt_service.py** - Extend BaseEntityService
9. **api/routers/prompts.py** - Full router
10. **api/main.py** - Register router
11. **Tests** - Service and API tests
12. **Run migration** - `make migrate`

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `backend/src/db/migrations/versions/xxx_create_prompts.py` | Create |
| `backend/src/models/tag.py` | Modify - add prompt_tags, Tag.prompts |
| `backend/src/models/prompt.py` | Create |
| `backend/src/models/user.py` | Modify - add prompts relationship |
| `backend/src/models/__init__.py` | Modify - exports |
| `backend/src/schemas/prompt.py` | Create |
| `backend/src/services/tag_service.py` | Modify - add prompt functions |
| `backend/src/services/prompt_service.py` | Create |
| `backend/src/api/routers/prompts.py` | Create |
| `backend/src/api/main.py` | Modify - register router |
| `backend/tests/services/test_prompt_service.py` | Create |
| `backend/tests/api/test_prompts.py` | Create |

---

## Key Patterns to Follow

- **Model**: Copy `models/note.py` structure
- **Service**: Copy `services/note_service.py` structure
- **Schemas**: Copy `schemas/note.py` tag extraction pattern
- **Router**: Copy `routers/notes.py` endpoint structure
- **Tests**: Copy `tests/services/test_note_service.py` test categories
