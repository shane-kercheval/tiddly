# Content Relationships Implementation Plan

## Overview

Add a generic relationship system that allows linking any content types (bookmarks, notes, prompts) with optional descriptions. Designed to be extensible for future content types (e.g., todos) and relationship types (e.g., `references`).

### Goals
- Enable users to link related content across types (bookmark↔note, note↔note, bookmark↔bookmark, prompt↔note, etc.)
- Support bidirectional `related` relationship type (extensible to directional types like `references` later)
- Allow optional descriptions explaining why items are linked
- Provide clean UI for viewing and managing relationships

### Design Decisions
- **Single polymorphic table** with `source_type`/`target_type` columns (no FK to entity tables, cleanup in service layer)
- **Canonical ordering for bidirectional types** — for `related`, source/target are normalized at insert time so `(source_type, source_id) < (target_type, target_id)` lexicographically, preventing duplicate A→B / B→A rows via the unique constraint
- **Application-level cascade** — delete relationships when content is permanently deleted (alongside existing history deletion in `BaseEntityService.delete()`)
- **Description field** — optional text explaining the relationship
- **Bidirectional queries** — `related` relationships queryable from either end
- **Soft-deleted content** — relationships to soft-deleted content remain visible with indicator
- **UUIDv7 primary keys** — consistent with all other content tables
- **No content history tracking** — relationships are lightweight junction-like records, not versioned content
- **Start with `related` only** — defer `references` (directional) to a future iteration to reduce initial complexity

### Relationship Type Semantics (v1)

| Type | Directionality | Query Behavior | User Perception |
|------|----------------|----------------|-----------------|
| `related` | Bidirectional | Store A→B once; returns when querying from A OR B | "A and B are related" (symmetric) |

For `related`, source/target distinction is an implementation detail — users see a symmetric relationship.

**Future types** (add via check constraint migration):
- `references` — Directional: "A references B" vs "Referenced by..."
- `subtask` — Directional (source=parent, target=child)
- `blocks` — Directional (source blocks target)

---

## Milestone 1: Database Model & Migration

### Goal
Create the `content_relationships` table with proper indexes and constraints.

### Success Criteria
- Migration runs successfully
- Table created with all columns and indexes
- Constraints prevent invalid data (duplicate relationships, self-references)

### Key Changes

**New file: `backend/src/models/content_relationship.py`**

```python
from uuid import UUID

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base, TimestampMixin, UUIDv7Mixin


class ContentRelationship(Base, UUIDv7Mixin, TimestampMixin):
    __tablename__ = "content_relationships"

    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        index=True,
    )

    # Source content
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    source_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)

    # Target content
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)
    target_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)

    # Relationship metadata
    relationship_type: Mapped[str] = mapped_column(String(30), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        # Prevent duplicate relationships.
        # For bidirectional types (e.g., 'related'), the service layer normalizes
        # source/target to canonical order before insert, so this constraint
        # naturally prevents both A→B and B→A from being stored.
        UniqueConstraint(
            'user_id', 'source_type', 'source_id',
            'target_type', 'target_id', 'relationship_type',
            name='uq_content_relationship',
        ),
        # Validate content types (add 'todo' when implementing todos)
        CheckConstraint(
            "source_type IN ('bookmark', 'note', 'prompt')",
            name='ck_source_type',
        ),
        CheckConstraint(
            "target_type IN ('bookmark', 'note', 'prompt')",
            name='ck_target_type',
        ),
        # Validate relationship types (add 'references', 'subtask', 'blocks' later)
        CheckConstraint(
            "relationship_type IN ('related')",
            name='ck_relationship_type',
        ),
        # Prevent self-references
        CheckConstraint(
            "NOT (source_type = target_type AND source_id = target_id)",
            name='ck_no_self_reference',
        ),
        # Indexes for common queries
        Index('ix_content_rel_source', 'user_id', 'source_type', 'source_id'),
        Index('ix_content_rel_target', 'user_id', 'target_type', 'target_id'),
        Index('ix_content_rel_type', 'user_id', 'relationship_type'),
    )
```

**Update `backend/src/models/__init__.py`:**
- Import and export `ContentRelationship`

**New migration:**
```bash
make migration message="add content_relationships table"
```

### Testing Strategy
- Unit test model constraints (self-reference prevention, valid types)
- Integration test migration runs cleanly on test database

### Dependencies
None — this is the foundation.

### Risk Factors
- None significant. Standard table creation.

---

## Milestone 2: Relationship Service

### Goal
Create service layer for CRUD operations on relationships with proper validation and cleanup hooks.

### Success Criteria
- Can create, read, update, delete relationships
- Validates content exists before creating relationship
- Queries relationships for a given content item (both directions for `related`)
- Provides cleanup method for when content is permanently deleted

### Key Changes

**New file: `backend/src/services/relationship_service.py`**

Use `EntityType` from `models.content_history` as the single source of truth for valid content type strings in validation and comparisons (the check constraint SQL strings must remain literals, but all service-layer logic should reference the enum).

Core functions:

```python
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from models.content_history import EntityType


# Validation — query models directly (not through services) to avoid circular
# dependencies. Follows the same pattern as HistoryService._get_entity().
MODEL_MAP: dict[str, type] = {
    EntityType.BOOKMARK: Bookmark,
    EntityType.NOTE: Note,
    EntityType.PROMPT: Prompt,
}


async def validate_content_exists(
    db: AsyncSession,
    user_id: UUID,
    content_type: str,
    content_id: UUID,
    allow_deleted: bool = False,
) -> bool:
    """
    Check if content exists and belongs to user. By default excludes soft-deleted.

    Note: No archived_at filter needed — archived items have deleted_at IS NULL
    and are valid relationship targets. The models have no default query scopes.
    """
    model = MODEL_MAP[content_type]
    conditions = [model.id == content_id, model.user_id == user_id]
    if not allow_deleted:
        conditions.append(model.deleted_at.is_(None))
    return await db.scalar(select(exists().where(*conditions)))


# Canonical ordering for bidirectional types
def canonical_pair(
    type_a: str, id_a: UUID, type_b: str, id_b: UUID,
) -> tuple[str, UUID, str, UUID]:
    """
    Normalize a pair to canonical order: (source_type, source_id, target_type, target_id).

    Compares (type, str(id)) lexicographically. Used for bidirectional types
    ('related') to ensure A→B and B→A produce the same stored row.
    """
    if (type_a, str(id_a)) <= (type_b, str(id_b)):
        return type_a, id_a, type_b, id_b
    return type_b, id_b, type_a, id_a


# CRUD
async def create_relationship(
    db: AsyncSession,
    user_id: UUID,
    source_type: str,
    source_id: UUID,
    target_type: str,
    target_id: UUID,
    relationship_type: str,
    description: str | None = None,
) -> ContentRelationship:
    """
    Create a new relationship. Validates both endpoints exist.

    For bidirectional types ('related'), normalizes source/target to canonical
    order before insert: (source_type, source_id) < (target_type, target_id)
    lexicographically. This ensures the unique constraint prevents both A→B
    and B→A from being stored. When directional types (e.g., 'references')
    are added later, skip normalization for those types.

    Catches IntegrityError from the unique constraint (concurrent insert race)
    and raises DuplicateRelationshipError, consistent with how BookmarkService
    handles DuplicateUrlError and PromptService handles NameConflictError.
    """


async def get_relationship(
    db: AsyncSession,
    user_id: UUID,
    relationship_id: UUID,
) -> ContentRelationship | None:
    """Get a single relationship by ID."""


async def update_relationship(
    db: AsyncSession,
    user_id: UUID,
    relationship_id: UUID,
    data: RelationshipUpdate,
) -> ContentRelationship | None:
    """
    Update relationship metadata.

    Uses data.model_dump(exclude_unset=True) to distinguish "not provided"
    from "explicitly set to null", consistent with BookmarkService/NoteService/
    PromptService update patterns.
    """


async def delete_relationship(
    db: AsyncSession,
    user_id: UUID,
    relationship_id: UUID,
) -> bool:
    """Delete a single relationship."""


# Query
async def get_relationships_for_content(
    db: AsyncSession,
    user_id: UUID,
    content_type: str,
    content_id: UUID,
    relationship_type: str | None = None,
) -> list[ContentRelationship]:
    """
    Get relationships for a content item.
    For 'related' type: queries both directions (where item is source OR target).
    """


# Cleanup (called when content is permanently deleted)
async def delete_relationships_for_content(
    db: AsyncSession,
    user_id: UUID,
    content_type: str,
    content_id: UUID,
) -> int:
    """Delete all relationships where this content is source OR target. Returns count deleted."""
```

**Note on directionality:** Since v1 only supports `related` (bidirectional), the `direction` parameter from the original plan is removed. When `references` is added later, a `direction` filter parameter can be introduced.

**Exception classes (add to `backend/src/services/exceptions.py` or create new):**

```python
class RelationshipError(Exception):
    """Base class for relationship errors."""

class ContentNotFoundError(RelationshipError):
    """Referenced content does not exist."""

class DuplicateRelationshipError(RelationshipError):
    """Relationship already exists."""

class InvalidRelationshipError(RelationshipError):
    """Invalid relationship (e.g., self-reference, invalid type combo)."""
```

### Testing Strategy

See [Comprehensive Test Scenarios](#comprehensive-test-scenarios) section for full test matrix.

Key service tests:
- Create with all content type combinations (bookmark→bookmark, bookmark→note, note→bookmark, note→note, prompt→bookmark, etc.)
- Canonical ordering: creating with source > target lexicographically swaps them in storage
- Reverse duplicate prevention: creating B→A when A→B exists returns 409 (canonical ordering makes unique constraint catch this)
- Duplicate relationship prevention for each combination
- Self-reference prevention
- Non-existent source/target content rejection
- Bidirectional query for `related` (A→B returns when querying from B)
- Cleanup on permanent delete

### Dependencies
- Milestone 1 (database model)

### Risk Factors
- None significant. Soft-deleted content: relationships remain, UI shows indicator.

---

## Milestone 3: Integrate Cleanup with BaseEntityService

### Goal
Ensure relationships are cleaned up when content is permanently deleted, alongside existing history cleanup.

### Success Criteria
- Permanent delete of bookmark/note/prompt removes all its relationships
- Soft delete does NOT remove relationships (can be restored)
- Relationship cleanup is transactional with content delete

### Key Changes

**Update `backend/src/services/base_entity_service.py`:**

In the `delete` method, add relationship cleanup alongside the existing history deletion when `permanent=True`:

```python
async def delete(
    self,
    db: AsyncSession,
    user_id: UUID,
    entity_id: UUID,
    permanent: bool = False,
    context: RequestContext | None = None,
    limits: TierLimits | None = None,
) -> bool:
    entity = await self.get(
        db, user_id, entity_id, include_deleted=permanent, include_archived=True,
    )
    if entity is None:
        return False

    if permanent:
        # Hard delete: cascade-delete history first (application-level cascade)
        await self._get_history_service().delete_entity_history(
            db, user_id, self.entity_type, entity_id,
        )
        # Clean up content relationships
        await relationship_service.delete_relationships_for_content(
            db, user_id, self.entity_type, entity_id,
        )
        await db.delete(entity)
    else:
        # Soft delete: existing logic unchanged
        ...

    return True
```

This approach hooks into `BaseEntityService` directly rather than modifying individual bookmark/note/prompt services, keeping the cleanup in one place and automatically covering all entity types (including prompts and any future types).

### Testing Strategy
- Test permanent delete removes relationships
- Test soft delete preserves relationships
- Test restore still has relationships intact
- Test cleanup covers bookmarks, notes, and prompts

### Dependencies
- Milestone 2 (relationship service)

### Risk Factors
- Must ensure cleanup happens in same transaction as delete

---

## Milestone 4: API Endpoints

### Goal
Create REST API for managing relationships.

### Success Criteria
- CRUD endpoints for relationships
- Query endpoints for content relationships
- Proper error handling and validation

### Key Changes

**New file: `backend/src/api/routers/relationships.py`**

```python
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

router = APIRouter(prefix="/relationships", tags=["relationships"])


# Create relationship
@router.post("/", status_code=201)
async def create_relationship(
    data: RelationshipCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> RelationshipResponse:
    """Create a new relationship between content items."""


# Get single relationship
@router.get("/{relationship_id}")
async def get_relationship(
    relationship_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> RelationshipResponse:
    """Get a relationship by ID."""


# Update relationship (description)
@router.patch("/{relationship_id}")
async def update_relationship(
    relationship_id: UUID,
    data: RelationshipUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> RelationshipResponse:
    """Update relationship metadata."""


# Delete relationship
@router.delete("/{relationship_id}", status_code=204)
async def delete_relationship(
    relationship_id: UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> None:
    """Delete a relationship."""


# Query relationships for content
@router.get("/content/{content_type}/{content_id}")
async def get_content_relationships(
    content_type: Literal["bookmark", "note", "prompt"],
    content_id: UUID,
    relationship_type: str | None = None,
    include_content_info: bool = True,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> RelationshipListResponse:
    """Get all relationships for a content item."""
```

**New file: `backend/src/schemas/relationship.py`**

```python
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator


class RelationshipCreate(BaseModel):
    source_type: Literal["bookmark", "note", "prompt"]
    source_id: UUID
    target_type: Literal["bookmark", "note", "prompt"]
    target_id: UUID
    relationship_type: Literal["related"]
    description: str | None = None

    @field_validator("description")
    @classmethod
    def validate_description_length(cls, v: str | None) -> str | None:
        if v is not None and len(v) > 500:
            raise ValueError("Description must be 500 characters or less")
        return v


class RelationshipUpdate(BaseModel):
    description: str | None = None

    @field_validator("description")
    @classmethod
    def validate_description_length(cls, v: str | None) -> str | None:
        if v is not None and len(v) > 500:
            raise ValueError("Description must be 500 characters or less")
        return v


class RelationshipResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    source_type: str
    source_id: UUID
    target_type: str
    target_id: UUID
    relationship_type: str
    description: str | None
    created_at: datetime
    updated_at: datetime


class RelationshipWithContentResponse(RelationshipResponse):
    """Extended response with basic content info for display."""
    source_title: str | None = None
    source_url: str | None = None  # For bookmarks
    target_title: str | None = None
    target_url: str | None = None  # For bookmarks
    source_deleted: bool = False
    target_deleted: bool = False
    source_archived: bool = False
    target_archived: bool = False


class RelationshipListResponse(BaseModel):
    items: list[RelationshipWithContentResponse]
    total: int
    offset: int
    limit: int
    has_more: bool
```

**Update `backend/src/api/main.py`:**
- `app.include_router(relationships.router)`

**Error responses:**
- 404: Content or relationship not found
- 409: Duplicate relationship
- 400: Invalid relationship (self-reference, invalid type)

**Note on `include_content_info`:** Defaults to `True`. When enabled, the service layer queries bookmark/note/prompt tables to resolve titles. This requires conditional queries per content type due to the polymorphic design. The response uses `RelationshipWithContentResponse` including `source_deleted`/`target_deleted` and `source_archived`/`target_archived` flags so the frontend can render appropriate indicators. Callers that only need relationship structure can opt out with `include_content_info=false`.

**Implementation constraint — batch by content type:** Collect all distinct bookmark IDs, note IDs, and prompt IDs from the relationship results, then issue one `SELECT ... WHERE id IN (...)` query per type (at most 3 queries total, regardless of relationship count). Select only the columns needed for content info (`id`, `title`, `url`, `deleted_at`, `archived_at`) — do not load full entity rows. Map results into a lookup dict and populate the response fields. Do NOT query per-relationship (N+1). If an entity is not found in the batch query results (e.g., race condition with permanent delete), set the corresponding title to `null` and deleted flag to `true`. This is a transient state — the cleanup in Milestone 3 will remove the relationship on the next permanent delete.

**Query endpoint for non-existent content:** `GET /relationships/content/{type}/{id}` returns an empty list for non-existent content IDs. This is a query/filter endpoint, not a resource endpoint — the content ID is a filter parameter, so empty results (not 404) is the correct HTTP semantic.

**Deterministic ordering:** Results are ordered by `created_at DESC, id DESC` to ensure stable pagination. No user-configurable sort — relationships are simple enough that a single ordering is sufficient.

### Testing Strategy
- Test all CRUD endpoints
- Test validation errors (invalid types, self-reference)
- Test 404 for missing content
- Test 409 for duplicate relationships
- Test `include_content_info` returns titles and status flags

### Dependencies
- Milestone 2 (relationship service)

### Risk Factors
- None significant

---

## Milestone 5: Frontend Types & API Service

### Goal
Add TypeScript types and API client methods for relationships.

### Success Criteria
- Types match backend schemas
- API methods for all endpoints
- Query hooks for fetching relationships

### Key Changes

**Update `frontend/src/types.ts`:**

Note: `ContentType` already exists in `types.ts` (line 246) — reuse it, do not redeclare.

```typescript
// ContentType already defined: export type ContentType = 'bookmark' | 'note' | 'prompt';

// New relationship types
export type RelationshipType = 'related';

export interface RelationshipCreate {
  source_type: ContentType;
  source_id: string;
  target_type: ContentType;
  target_id: string;
  relationship_type: RelationshipType;
  description?: string | null;
}

export interface RelationshipUpdate {
  description?: string | null;
}

export interface Relationship {
  id: string;
  source_type: ContentType;
  source_id: string;
  target_type: ContentType;
  target_id: string;
  relationship_type: RelationshipType;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface RelationshipWithContent extends Relationship {
  source_title: string | null;
  source_url: string | null;
  target_title: string | null;
  target_url: string | null;
  source_deleted: boolean;
  target_deleted: boolean;
  source_archived: boolean;
  target_archived: boolean;
}

export interface RelationshipListResponse {
  items: RelationshipWithContent[];
  total: number;
  offset: number;
  limit: number;
  has_more: boolean;
}
```

**New file: `frontend/src/services/relationships.ts`:**

```typescript
import api from './api';
import type {
  Relationship,
  RelationshipCreate,
  RelationshipUpdate,
  RelationshipListResponse,
  ContentType,
  RelationshipType,
} from '../types';

export const relationshipsApi = {
  create: (data: RelationshipCreate) =>
    api.post<Relationship>('/relationships/', data),

  get: (id: string) =>
    api.get<Relationship>(`/relationships/${id}`),

  update: (id: string, data: RelationshipUpdate) =>
    api.patch<Relationship>(`/relationships/${id}`, data),

  delete: (id: string) =>
    api.delete(`/relationships/${id}`),

  getForContent: (
    contentType: ContentType,
    contentId: string,
    params?: {
      relationship_type?: RelationshipType;
      include_content_info?: boolean;
    }
  ) => api.get<RelationshipListResponse>(
    `/relationships/content/${contentType}/${contentId}`,
    { params },
  ),
};
```

**New file: `frontend/src/hooks/useRelationships.ts`:**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { relationshipsApi } from '../services/relationships';
import type { ContentType, RelationshipCreate, RelationshipUpdate } from '../types';

// Query keys
export const relationshipKeys = {
  all: ['relationships'] as const,
  forContent: (type: ContentType, id: string) =>
    [...relationshipKeys.all, 'content', type, id] as const,
};

// Query hook for content relationships
export function useContentRelationships(
  contentType: ContentType | null,
  contentId: string | null,
  options?: {
    includeContentInfo?: boolean;
  }
) {
  return useQuery({
    queryKey: contentType && contentId
      ? [...relationshipKeys.forContent(contentType, contentId), options]
      : ['relationships', 'disabled'],
    queryFn: () => relationshipsApi.getForContent(
      contentType!,
      contentId!,
      {
        include_content_info: options?.includeContentInfo,
      },
    ).then(res => res.data),
    enabled: contentType !== null && contentId !== null,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// Mutations
export function useRelationshipMutations() {
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: (data: RelationshipCreate) =>
      relationshipsApi.create(data).then(res => res.data),
    onSuccess: (_, variables) => {
      // Invalidate both source and target content relationship queries
      queryClient.invalidateQueries({
        queryKey: relationshipKeys.forContent(variables.source_type, variables.source_id),
      });
      queryClient.invalidateQueries({
        queryKey: relationshipKeys.forContent(variables.target_type, variables.target_id),
      });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: RelationshipUpdate }) =>
      relationshipsApi.update(id, data).then(res => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: relationshipKeys.all });
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => relationshipsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: relationshipKeys.all });
    },
  });

  return { create, update, remove };
}
```

### Testing Strategy
- Type checking via TypeScript compilation
- Unit tests for API service methods (mocked responses)
- Hook tests with React Query test utils

### Dependencies
- Milestone 4 (API endpoints)

### Risk Factors
- None significant

---

## Milestone 6: LinkedContentChips Display Component

### Goal
Create an inline chip-based component that displays relationships for any content item, designed to sit in the metadata row alongside tags.

### Status: **Implemented**

### What Was Built

**`frontend/src/components/LinkedContentChips.tsx`** — Inline chips showing linked content with type-colored icons and titles. Each chip is clickable for navigation, with hover-reveal remove buttons (same pattern as `Tag` component).

**`frontend/src/utils/relationships.ts`** — Extracted `getLinkedItem()` utility and `LinkedItem` interface for resolving the "other side" of canonical-ordered relationships.

**`frontend/src/constants/contentTypeStyles.ts`** — Shared `CONTENT_TYPE_ICONS`, `CONTENT_TYPE_LABELS`, `CONTENT_TYPE_ICON_COLORS` used for consistent styling across chips and dropdowns.

**Key design decisions:**
- Inline chips (not a section/card layout) — sits in the same flex row as tags
- Type-colored chips match the existing tag pill visual pattern
- Soft-deleted items: `opacity-60` + `line-through` on title
- Archived items: `opacity-60` (no line-through)
- No empty state message — chips simply don't render when there are none

### Testing Strategy
- Component renders with mock relationship data
- Delete button calls mutation
- Handles deleted content indicator (line-through + opacity)
- Handles archived content indicator (opacity only)
- Resolves correct "other side" when current item is source
- Resolves correct "other side" when current item is target (canonical ordering swapped)
- Loading state returns null (doesn't render)

### Dependencies
- Milestone 5 (frontend hooks)

### Risk Factors
- None significant

---

## Milestone 7: Inline Search for Linking Content

### Goal
Provide a way for users to search and link content directly from the `LinkedContentChips` component.

### Status: **Implemented** (originally as `AddRelationshipModal`, later replaced with inline search)

### Evolution

**Original approach:** A modal (`AddRelationshipModal`) with search input, result selection, optional description textarea, and a "Link" button. This was implemented and shipped.

**Final approach:** The modal was replaced with an inline search dropdown embedded directly in `LinkedContentChips`, following the same `forwardRef` + `useImperativeHandle` + `startAdding()` pattern as `InlineEditableTags`. The description field was removed from the UI (stays in backend schema for future AI/programmatic use).

**Rationale:** The modal was too heavy for what's essentially "pick an item to link." Users weren't writing descriptions. The inline dropdown provides a faster, lighter interaction.

### What Was Built

**`frontend/src/hooks/useContentSearch.ts`** — Reusable hook encapsulating debounced content search with keyboard navigation. Analogous to `useTagAutocomplete` but hits the content API via `useDebouncedValue` + `useContentQuery`. Filters results to exclude self and already-linked items (`excludeKeys` set). Returns `selectItem`/`selectHighlighted` that return the `ContentListItem` for the caller to use for mutation.

**`frontend/src/components/LinkedContentChips.tsx`** (updated) — Now exposes `LinkedContentChipsHandle` with `startAdding()` via `useImperativeHandle`. When in add mode, renders an inline search input + dropdown after the chip list. Selection immediately creates a relationship (no description, no confirmation step). Shows toast on error (409 = "Already linked", other = "Failed to create link"). After successful link: stays in add mode, clears input, refocuses. Escape exits add mode. Click outside exits if input empty.

**Deleted:**
- `frontend/src/components/AddRelationshipModal.tsx`
- `frontend/src/components/AddRelationshipModal.test.tsx`

### UI Flow
1. User clicks link icon button (or parent calls `ref.current.startAdding()`)
2. Inline search input appears in the chip row
3. User types to search (debounced 300ms)
4. Dropdown shows results with type-colored icons
5. User clicks result (or arrow-keys + Enter)
6. Relationship created immediately, input clears, stays in add mode
7. Escape or click-outside dismisses

### Testing Strategy
- `useContentSearch.test.tsx`: filtering (self + already-linked), keyboard nav index, reset, debounce wiring
- `LinkedContentChips.test.tsx`: `startAdding` via ref, search results display, selection creates relationship, keyboard escape, click-outside, error toasts, disabled state

### Dependencies
- Milestone 6 (LinkedContentChips component)
- Existing unified search endpoint (`GET /content/` via `useContentQuery` hook)

### Risk Factors
- None significant

---

## Milestone 8: Integrate into Note Detail View

### Goal
Add linked content chips to the note metadata row.

### Status: **Implemented**

### What Was Built

**`frontend/src/components/Note.tsx`** (updated):
- `LinkedContentChips` rendered in metadata row 2 alongside tags, with `ref={linkedChipsRef}` and `showAddButton={false}`
- Link icon button in metadata row 1 calls `linkedChipsRef.current?.startAdding()` to trigger inline search
- No modal state — everything is ref-driven

```tsx
// Row 1: action icons
<Tooltip content="Link content" compact>
  <button onClick={() => linkedChipsRef.current?.startAdding()} ... />
</Tooltip>

// Row 2: tag pills + linked content chips
<LinkedContentChips
  ref={linkedChipsRef}
  contentType="note"
  contentId={note.id}
  onNavigate={onNavigateToLinked}
  disabled={isSaving || isReadOnly}
  showAddButton={false}
/>
```

**Navigation behavior:**
- Linked bookmark → open URL in new tab (with usage tracking)
- Linked note → navigate to `/app/notes/{id}`
- Linked prompt → navigate to `/app/prompts/{id}`

### Testing Strategy
- Linked content chips appear in note view
- Link button triggers inline search via ref
- Navigation works for all content types

### Dependencies
- Milestone 7 (inline search in LinkedContentChips)

### Risk Factors
- None significant

---

## Milestone 9: Integrate into Bookmark Detail View

### Goal
Add linked content chips to the bookmark edit view.

### Success Criteria
- Bookmarks show linked content chips when viewing/editing
- Can add/remove relationships via inline search
- Works within the existing bookmark edit context (which is a modal)

### Key Changes

Follow the same pattern as Note integration (Milestone 8): add `LinkedContentChips` with `ref` to metadata row, link icon triggers `startAdding()`.

```tsx
{bookmark && (
  <LinkedContentChips
    ref={linkedChipsRef}
    contentType="bookmark"
    contentId={bookmark.id}
    onNavigate={onNavigateToLinked}
    disabled={isSaving || isReadOnly}
    showAddButton={false}
  />
)}
```

The inline search dropdown works naturally within the bookmark modal — no modal-within-modal issue since the search is just an input + dropdown, not a modal.

### Testing Strategy
- Linked content chips appear when editing bookmark
- Inline search works within modal context
- Navigation closes modal before navigating to linked item

### Dependencies
- Milestone 8 (note integration pattern)

### Risk Factors
- None significant

---

## Milestone 10: Integrate into Prompt Detail View

### Goal
Add linked content chips to the prompt view/edit page.

### Success Criteria
- Prompts display linked content chips in metadata row
- Can add/remove relationships via inline search
- Navigation to linked content works

### Key Changes

Follow the same pattern as Note integration (Milestone 8): add `LinkedContentChips` with `ref` to metadata row, link icon triggers `startAdding()`.

```tsx
<LinkedContentChips
  ref={linkedChipsRef}
  contentType="prompt"
  contentId={prompt.id}
  onNavigate={onNavigateToLinked}
  disabled={isSaving || isReadOnly}
  showAddButton={false}
/>
```

**Navigation behavior:**
- Linked bookmark → open URL in new tab
- Linked note → navigate to `/app/notes/{id}`
- Linked prompt → navigate to `/app/prompts/{id}`

### Testing Strategy
- Linked content chips appear in prompt view
- Inline search triggers via link icon button
- Navigation works for all content types

### Dependencies
- Milestone 8 (note integration pattern)

### Risk Factors
- None significant — follows same pattern as note integration

---

## Milestone 11: MCP Server Integration

### Goal
Expose relationship management through MCP server for AI agent access.

### Success Criteria
- MCP tools for querying relationships
- MCP tools for creating/deleting relationships
- Documentation updated

### Key Changes

**Update `backend/src/mcp_server/server.py`:**

Add new tools:

```python
@mcp.tool()
async def get_content_relationships(
    content_type: Literal["bookmark", "note", "prompt"],
    content_id: str,
    relationship_type: str | None = None,
) -> list[dict]:
    """
    Get relationships for a content item.

    Args:
        content_type: Type of content ("bookmark", "note", or "prompt")
        content_id: ID of the content item (UUID)
        relationship_type: Optional filter by type ("related")

    Returns:
        List of relationships with source/target info and titles
    """


@mcp.tool()
async def create_relationship(
    source_type: Literal["bookmark", "note", "prompt"],
    source_id: str,
    target_type: Literal["bookmark", "note", "prompt"],
    target_id: str,
    relationship_type: Literal["related"],
    description: str | None = None,
) -> dict:
    """
    Create a relationship between two content items.

    Args:
        source_type: Type of source content
        source_id: ID of source content (UUID)
        target_type: Type of target content
        target_id: ID of target content (UUID)
        relationship_type: Type of relationship ("related")
        description: Optional description of why items are linked

    Returns:
        Created relationship (or existing relationship if duplicate)

    Note:
        On 409 (duplicate), returns the existing relationship instead of
        raising ToolError. This provides idempotent "ensure link exists"
        semantics appropriate for AI agents. The REST API itself still
        returns 409 for explicit conflict reporting.

        Implementation: on 409 from the API, query
        GET /relationships/content/{source_type}/{source_id} to find and
        return the existing relationship. Canonical ordering means the
        submitted source/target may be swapped — filter results by matching
        both endpoint IDs.
    """


@mcp.tool()
async def delete_relationship(
    relationship_id: str,
) -> bool:
    """
    Delete a relationship.

    Args:
        relationship_id: ID of relationship to delete (UUID)

    Returns:
        True if deleted, False if not found
    """
```

**Update MCP server instructions in `CLAUDE.md`:**

```markdown
**Relationships:**
- `get_content_relationships`: Get relationships for a bookmark, note, or prompt
- `create_relationship`: Link two content items together
- `delete_relationship`: Remove a relationship
```

### Testing Strategy
- MCP tools return expected data
- Error handling for invalid content IDs
- `create_relationship` on duplicate returns existing relationship (idempotent)
- Integration test with MCP client

### Dependencies
- Milestone 4 (API endpoints — MCP calls the API via httpx)

### Risk Factors
- None significant

## Milestone 12: Orphan Detection Script

### Goal
Create a maintenance script in `backend/src/tasks/` that detects orphaned relationships (pointing to non-existent content). Follows the same pattern as the existing `cleanup.py` task.

### Success Criteria
- Script identifies relationships where source or target content no longer exists in any state (permanently deleted)
- Reports orphan count and details (relationship IDs, content type/ID pairs)
- Can optionally delete orphans with a `--delete` flag
- Runnable as `python -m tasks.orphan_relationships`

### Key Changes

**New file: `backend/src/tasks/orphan_relationships.py`**

```python
"""
Orphan relationship detection and cleanup.

Identifies content_relationships rows where the source or target entity
no longer exists (permanently deleted). This catches bugs in the delete
path or incomplete cleanups.

Usage:
    python -m tasks.orphan_relationships           # Report only
    python -m tasks.orphan_relationships --delete   # Report and delete
"""
```

The script should:
1. For each content type in `MODEL_MAP`, find relationship rows where the source/target ID does not exist in the corresponding entity table (using `NOT EXISTS` subquery)
2. Report findings with counts per content type
3. If `--delete` is passed, delete the orphaned relationships and report how many were removed

### Testing Strategy
- Test detection finds orphans when entity is missing
- Test detection does not flag valid relationships
- Test `--delete` mode removes orphans
- Test dry-run mode (no `--delete`) only reports

### Dependencies
- Milestone 1 (database model)

### Risk Factors
- None significant — read-only by default

---

## Summary

| Milestone | Description | Complexity |
|-----------|-------------|------------|
| 1 | Database model & migration | Low |
| 2 | Relationship service (with canonical ordering) | Medium |
| 3 | Cleanup integration with BaseEntityService | Low |
| 4 | API endpoints | Medium |
| 5 | Frontend types & API | Low |
| 6 | LinkedContentChips component (inline chips) | Medium |
| 7 | Inline search for linking (useContentSearch hook) | Medium |
| 8 | Note detail integration | Low |
| 9 | Bookmark detail integration | Low |
| 10 | Prompt detail integration | Low |
| 11 | MCP server integration | Low |
| 12 | Orphan detection script | Low |

---

## Comprehensive Test Scenarios

### Backend: Relationship Service Tests

#### Create Relationship — Content Type Combinations

| Test | Source | Target | Expected |
|------|--------|--------|----------|
| `test__create_relationship__bookmark_to_bookmark` | bookmark | bookmark | Success |
| `test__create_relationship__bookmark_to_note` | bookmark | note | Success |
| `test__create_relationship__bookmark_to_prompt` | bookmark | prompt | Success |
| `test__create_relationship__note_to_bookmark` | note | bookmark | Success |
| `test__create_relationship__note_to_note` | note | note | Success |
| `test__create_relationship__note_to_prompt` | note | prompt | Success |
| `test__create_relationship__prompt_to_bookmark` | prompt | bookmark | Success |
| `test__create_relationship__prompt_to_note` | prompt | note | Success |
| `test__create_relationship__prompt_to_prompt` | prompt | prompt | Success |

#### Create Relationship — Validation

| Test | Scenario | Expected |
|------|----------|----------|
| `test__canonical_pair__same_type_orders_by_id` | Same type, id_a > id_b | Returns (type, id_b, type, id_a) |
| `test__canonical_pair__different_type_orders_by_type` | type_a > type_b lexicographically | Returns (type_b, id_b, type_a, id_a) |
| `test__canonical_pair__already_canonical_unchanged` | Already in order | Returns input unchanged |
| `test__canonical_pair__deterministic_uuid_format` | Various UUID formats | Consistent str(uuid) comparison |
| `test__create_relationship__canonical_ordering` | Create with source > target lexicographically | Stored with swapped source/target |
| `test__create_relationship__reverse_direction_deduplicates` | Create B→A when A→B exists | 409 Conflict (canonical ordering makes them identical) |
| `test__create_relationship__duplicate_rejected` | Same source/target/type exists | 409 Conflict |
| `test__create_relationship__duplicate_different_type_allowed` | Same source/target, different type | Success |
| `test__create_relationship__self_reference_rejected_bookmark` | bookmark→same bookmark | 400 Bad Request |
| `test__create_relationship__self_reference_rejected_note` | note→same note | 400 Bad Request |
| `test__create_relationship__self_reference_rejected_prompt` | prompt→same prompt | 400 Bad Request |
| `test__create_relationship__source_not_found` | Non-existent content as source | 404 Not Found |
| `test__create_relationship__target_not_found` | Non-existent content as target | 404 Not Found |
| `test__create_relationship__soft_deleted_source_rejected` | Soft-deleted content as source | 404 Not Found |
| `test__create_relationship__soft_deleted_target_rejected` | Soft-deleted content as target | 404 Not Found |
| `test__create_relationship__archived_source_allowed` | Archived content as source | Success |
| `test__create_relationship__archived_target_allowed` | Archived content as target | Success |
| `test__create_relationship__invalid_relationship_type` | Invalid type string | 400/422 Validation Error |
| `test__create_relationship__description_max_length` | Description > 500 chars | 422 Validation Error |
| `test__create_relationship__description_optional` | No description provided | Success (null) |
| `test__create_relationship__with_description` | Description provided | Success with description |
| `test__create_relationship__different_user_content` | Source/target belongs to other user | 404 Not Found |

#### Query Relationships — Bidirectional (related type)

| Test | Scenario | Expected |
|------|----------|----------|
| `test__get_relationships__related_from_source` | A→B exists, query from A | Returns relationship |
| `test__get_relationships__related_from_target` | A→B exists, query from B | Returns relationship |
| `test__get_relationships__related_bidirectional` | A→B exists, query from both | Same relationship returned |
| `test__get_relationships__empty_result` | Content has no relationships | Empty list |
| `test__get_relationships__include_content_info` | With include_content_info=true | Returns titles, URLs, and status flags |
| `test__get_relationships__content_info_deleted_target` | Target is soft-deleted | `target_deleted: true` flag set |
| `test__get_relationships__content_info_archived_target` | Target is archived | `target_archived: true` flag set |
| `test__get_relationships__content_info_missing_entity` | Entity not found in batch (e.g., race with permanent delete) | title=null, deleted=true |

#### Delete Relationship

| Test | Scenario | Expected |
|------|----------|----------|
| `test__delete_relationship__success` | Delete existing relationship | Success |
| `test__delete_relationship__not_found` | Delete non-existent ID | 404 Not Found |
| `test__delete_relationship__wrong_user` | Delete other user's relationship | 404 Not Found |

#### Update Relationship

| Test | Scenario | Expected |
|------|----------|----------|
| `test__update_relationship__description` | Update description only | Success, description updated |
| `test__update_relationship__clear_description` | Set description to null | Success, description cleared |
| `test__update_relationship__empty_body_no_change` | PATCH with `{}` | Success, description unchanged |
| `test__update_relationship__description_max_length` | Description > 500 chars | 422 Validation Error |
| `test__update_relationship__not_found` | Update non-existent ID | 404 Not Found |

### Backend: Cleanup Integration Tests

#### Permanent Delete Cascade

| Test | Scenario | Expected |
|------|----------|----------|
| `test__delete_bookmark_permanent__removes_as_source` | Bookmark is source in relationships | All such relationships deleted |
| `test__delete_bookmark_permanent__removes_as_target` | Bookmark is target in relationships | All such relationships deleted |
| `test__delete_note_permanent__removes_as_source` | Note is source in relationships | All such relationships deleted |
| `test__delete_note_permanent__removes_as_target` | Note is target in relationships | All such relationships deleted |
| `test__delete_prompt_permanent__removes_relationships` | Prompt has relationships | All relationships involving prompt deleted |
| `test__delete_permanent__mixed_relationships` | Entity has both source and target rels | All relationships involving entity deleted |

#### Soft Delete Preservation

| Test | Scenario | Expected |
|------|----------|----------|
| `test__delete_bookmark_soft__preserves_relationships` | Soft delete bookmark with relationships | Relationships remain |
| `test__delete_note_soft__preserves_relationships` | Soft delete note with relationships | Relationships remain |
| `test__restore_bookmark__relationships_intact` | Restore soft-deleted bookmark | Relationships still exist |
| `test__restore_note__relationships_intact` | Restore soft-deleted note | Relationships still exist |

### Backend: API Endpoint Tests

| Test | Endpoint | Scenario | Expected |
|------|----------|----------|----------|
| `test__api_create__success` | POST /relationships/ | Valid data | 201, relationship returned |
| `test__api_create__duplicate` | POST /relationships/ | Duplicate | 409 Conflict |
| `test__api_create__invalid_type` | POST /relationships/ | Bad relationship_type | 422 |
| `test__api_get__success` | GET /relationships/{id} | Exists | 200, relationship |
| `test__api_get__not_found` | GET /relationships/{id} | Missing | 404 |
| `test__api_update__success` | PATCH /relationships/{id} | Valid update | 200, updated |
| `test__api_delete__success` | DELETE /relationships/{id} | Exists | 204 |
| `test__api_query__success` | GET /relationships/content/{type}/{id} | Valid content | 200, list with content info (default) |
| `test__api_query__without_content_info` | GET /relationships/content/{type}/{id}?include_content_info=false | Opt out of content info | Returns slim response without titles/status |
| `test__api_query__pagination` | GET /relationships/content/{type}/{id}?offset=0&limit=2 | Paginated | Returns correct page with has_more flag |
| `test__api_query__ordering` | GET /relationships/content/{type}/{id} | Multiple relationships | Ordered by created_at DESC, id DESC |

### Frontend: Component Tests

| Test | Component | Scenario | Expected |
|------|-----------|----------|----------|
| `test__LinkedContentChips__renders_items` | LinkedContentChips | Multiple relationships | Shows chips with type icons and titles |
| `test__LinkedContentChips__delete_button` | LinkedContentChips | Click remove | Calls mutation |
| `test__LinkedContentChips__deleted_indicator` | LinkedContentChips | Target is soft-deleted | Shows line-through + opacity |
| `test__LinkedContentChips__archived_indicator` | LinkedContentChips | Target is archived | Shows opacity (no line-through) |
| `test__LinkedContentChips__resolves_other_side_as_source` | LinkedContentChips | Current item is source | Shows target's title/type |
| `test__LinkedContentChips__resolves_other_side_as_target` | LinkedContentChips | Current item is target (canonical swap) | Shows source's title/type |
| `test__LinkedContentChips__startAdding_via_ref` | LinkedContentChips | Call startAdding() via ref | Shows inline search input |
| `test__LinkedContentChips__search_results` | LinkedContentChips | Type in inline search | Shows dropdown with results |
| `test__LinkedContentChips__select_creates_relationship` | LinkedContentChips | Click search result | Calls create mutation |
| `test__LinkedContentChips__escape_exits` | LinkedContentChips | Press Escape in search | Exits add mode |
| `test__useContentSearch__filters_self` | useContentSearch | Source item in results | Excluded from results |
| `test__useContentSearch__filters_linked` | useContentSearch | Already-linked items in results | Excluded from results |
| `test__useContentSearch__keyboard_nav` | useContentSearch | Arrow keys | Highlight index moves correctly |
| `test__useContentSearch__reset` | useContentSearch | Call reset() | Clears input, dropdown, highlight |

---

## Decisions Made

1. **Soft-deleted content in relationships:** Yes, display with strikethrough/"(deleted)" indicator
2. **Relationships on duplicate:** No — relationships are specific to original item
3. **Maximum relationships:** No hard limit; add pagination if needed
4. **Bidirectional storage:** Store once, query both directions for `related`; use canonical ordering at insert time to prevent A→B / B→A duplication
5. **Creating relationships to soft-deleted content:** No — only allow linking to active or archived content
6. **Linking to archived content:** Yes — archived content is still accessible; UI shows "(archived)" indicator
7. **Content history tracking for relationships:** No — relationships are lightweight and don't need versioning
8. **Prompt support:** Yes — prompts are included as a valid content type from launch
9. **`references` type:** Deferred — start with `related` only; add `references` in a future iteration via check constraint migration
10. **`position` field:** Deferred — add when implementing todos; not needed for current use cases
11. **`user_id` FK:** Uses `ForeignKey("users.id", ondelete="CASCADE")` consistent with all other models
12. **Content type enum:** Service layer uses `EntityType` from `models.content_history` as single source of truth for valid content type strings
13. **Content info resolution:** Batched by content type (at most 3 queries) — never per-relationship; missing entities treated as deleted
14. **Content validation dispatch:** Uses `MODEL_MAP` with direct model imports (not services) to avoid circular dependencies, matching `HistoryService._get_entity()` pattern
15. **PATCH semantics:** Uses `model_dump(exclude_unset=True)` to distinguish "not provided" from "set to null", consistent with existing update patterns
16. **MCP duplicate handling:** `create_relationship` returns existing relationship on 409 (idempotent) rather than raising ToolError; REST API still returns 409
17. **Query for non-existent content:** Returns empty list (query/filter endpoint), not 404
18. **`include_content_info` default:** Defaults to `true` — every known caller needs content info; slim response available via `include_content_info=false`
19. **Query pagination:** Uses standard `offset`/`limit` params (default 50, max 100) with `has_more` flag, consistent with all other list endpoints
20. **Concurrent insert handling:** Service catches `IntegrityError` from unique constraint and raises `DuplicateRelationshipError`
21. **Unified search:** Inline search uses existing `GET /content/` endpoint (via `useContentQuery`) to search across all content types simultaneously
22. **Inline search over modal:** Replaced `AddRelationshipModal` with inline search dropdown in `LinkedContentChips` — modal was too heavy for "pick an item to link"; follows `InlineEditableTags` pattern (`forwardRef` + `startAdding()`)
23. **Description removed from UI:** Users weren't writing descriptions. Field stays in backend schema for future AI/programmatic use via API and MCP
24. **Canonical ordering implementation:** Extracted to a pure `canonical_pair()` function, unit tested independently, used in service layer and MCP idempotency filter
25. **Pagination ordering:** Deterministic `ORDER BY created_at DESC, id DESC` — no user-configurable sort
26. **Batch resolution columns:** Select only needed columns (`id`, `title`, `url`, `deleted_at`, `archived_at`) — do not load full entity rows
27. **`onNavigate` signature:** Accepts full `LinkedItem` object (type, id, title, url, deleted, archived) so callers have all info needed for navigation
28. **Orphan detection:** Built as `backend/src/tasks/orphan_relationships.py` maintenance script (Milestone 12), not deferred

---

## Future Enhancements (Out of Scope)

**Directional relationship types:**
- Add `references` to relationship type check constraint
- Add `direction` query parameter to API
- Update frontend to show "References" vs "Referenced by" labels

**Todo Support (add when implementing todos):**
- Add `todo` to content type check constraints
- Add `subtask` and `blocks` to relationship type check constraints
- Add `position` column for ordering
- Implement `get_subtasks()` convenience method with position ordering
- Add subtask completion cascade logic (optional)

**Operational tooling:**
- Per-item relationship limit: if accumulation becomes a problem (e.g., thousands of relationships on a single item degrading batch resolution), add a configurable soft limit in the service layer with a clear error
- Integrate orphan detection (Milestone 12) into the existing nightly cron alongside `cleanup.py`

**Other enhancements:**
- Relationship graph visualization
- Bulk relationship management
- Relationship suggestions based on content similarity
- Backlinks panel (show all content linking TO this item separately)
- Relationship history/audit log (extend content history system)
