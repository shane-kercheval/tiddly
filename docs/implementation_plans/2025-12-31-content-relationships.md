# Content Relationships Implementation Plan

## Overview

Add a generic relationship system that allows linking any content types (bookmarks, notes) with typed relationships and optional descriptions. Designed to be extensible for future content types (e.g., todos).

### Goals
- Enable users to link related content across types (bookmark↔note, note↔note, bookmark↔bookmark)
- Support multiple relationship types (`related`, `references`)
- Allow optional descriptions explaining why items are linked
- Provide clean UI for viewing and managing relationships

### Design Decisions
- **Single polymorphic table** with `source_type`/`target_type` columns (no FK integrity, cleanup in service layer)
- **Application-level cascade** — delete relationships when content is permanently deleted
- **Description field** — optional text explaining the relationship
- **Position field** — for ordering (reserved for future use with todos)
- **Bidirectional queries** — `related` relationships queryable from either end
- **Soft-deleted content** — relationships to soft-deleted content remain visible with indicator

### Relationship Type Semantics

| Type | Directionality | Query Behavior | User Perception |
|------|----------------|----------------|-----------------|
| `related` | Bidirectional | Store A→B once; returns when querying from A OR B | "A and B are related" (symmetric) |
| `references` | Directional | From A: shows as outgoing; From B: shows as incoming | "A references B" (asymmetric) |

For `related`, source/target distinction is an implementation detail — users see symmetric relationship.
For `references`, the frontend displays direction: "This note references..." vs "Referenced by..."

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
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey,
    UniqueConstraint, CheckConstraint, Index
)
from sqlalchemy.sql import func
from backend.src.db.base import Base

class ContentRelationship(Base):
    __tablename__ = "content_relationships"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    # Source content
    source_type = Column(String(20), nullable=False)  # "bookmark", "note"
    source_id = Column(Integer, nullable=False)

    # Target content
    target_type = Column(String(20), nullable=False)
    target_id = Column(Integer, nullable=False)

    # Relationship metadata
    relationship_type = Column(String(30), nullable=False)  # "related", "references"
    description = Column(Text, nullable=True)  # Optional: why are these linked?
    position = Column(Integer, nullable=True)  # Reserved for future ordering (e.g., subtasks)

    created_at = Column(DateTime(timezone=True), server_default=func.clock_timestamp())

    __table_args__ = (
        # Prevent duplicate relationships
        UniqueConstraint(
            'user_id', 'source_type', 'source_id',
            'target_type', 'target_id', 'relationship_type',
            name='uq_content_relationship'
        ),
        # Validate content types (add more types here when implementing todos)
        CheckConstraint(
            "source_type IN ('bookmark', 'note')",
            name='ck_source_type'
        ),
        CheckConstraint(
            "target_type IN ('bookmark', 'note')",
            name='ck_target_type'
        ),
        # Validate relationship types (add 'subtask', 'blocks' when implementing todos)
        CheckConstraint(
            "relationship_type IN ('related', 'references')",
            name='ck_relationship_type'
        ),
        # Prevent self-references
        CheckConstraint(
            "NOT (source_type = target_type AND source_id = target_id)",
            name='ck_no_self_reference'
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
- Provides cleanup method for when content is deleted

### Key Changes

**New file: `backend/src/services/relationship_service.py`**

Core functions:

```python
# Validation
async def validate_content_exists(
    db: AsyncSession,
    user_id: int,
    content_type: str,
    content_id: int,
    allow_deleted: bool = False,
) -> bool:
    """Check if content exists and belongs to user. By default excludes permanently deleted."""

# CRUD
async def create_relationship(
    db: AsyncSession,
    user_id: int,
    source_type: str,
    source_id: int,
    target_type: str,
    target_id: int,
    relationship_type: str,
    description: str | None = None,
    position: int | None = None,
) -> ContentRelationship:
    """Create a new relationship. Validates both endpoints exist."""

async def get_relationship(
    db: AsyncSession,
    user_id: int,
    relationship_id: int,
) -> ContentRelationship | None:
    """Get a single relationship by ID."""

async def update_relationship(
    db: AsyncSession,
    user_id: int,
    relationship_id: int,
    description: str | None = ...,  # Use sentinel for "not provided"
    position: int | None = ...,
) -> ContentRelationship | None:
    """Update relationship metadata (description, position)."""

async def delete_relationship(
    db: AsyncSession,
    user_id: int,
    relationship_id: int,
) -> bool:
    """Delete a single relationship."""

# Query
async def get_relationships_for_content(
    db: AsyncSession,
    user_id: int,
    content_type: str,
    content_id: int,
    relationship_type: str | None = None,
    direction: Literal["outgoing", "incoming", "both"] = "both",
) -> list[ContentRelationship]:
    """
    Get relationships for a content item.
    - outgoing: where this item is source
    - incoming: where this item is target
    - both: union of both (default, useful for 'related')
    """

# Cleanup (called when content is deleted)
async def delete_relationships_for_content(
    db: AsyncSession,
    user_id: int,
    content_type: str,
    content_id: int,
) -> int:
    """Delete all relationships where this content is source OR target. Returns count deleted."""
```

**Relationship type semantics:**

| Type | Directionality | Use Case |
|------|----------------|----------|
| `related` | Bidirectional | Loosely connected items (query from either side returns the relationship) |
| `references` | Directional | Source references/cites target (e.g., note references a bookmark) |

Future types when implementing todos:
- `subtask` — Directional (source=parent, target=child)
- `blocks` — Directional (source blocks target)

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
- Create with all content type combinations (bookmark→bookmark, bookmark→note, note→bookmark, note→note)
- Duplicate relationship prevention for each combination
- Self-reference prevention
- Non-existent source/target content rejection
- Bidirectional query for `related` (A→B returns when querying from B)
- Directional query for `references`
- Cleanup on permanent delete

### Dependencies
- Milestone 1 (database model)

### Risk Factors
- None significant. Soft-deleted content: relationships remain, UI shows indicator.

---

## Milestone 3: Integrate Cleanup with Existing Services

### Goal
Ensure relationships are cleaned up when content is permanently deleted.

### Success Criteria
- Permanent delete of bookmark/note removes all its relationships
- Soft delete does NOT remove relationships (can be restored)
- Relationship cleanup is transactional with content delete

### Key Changes

**Update `backend/src/services/bookmark_service.py`:**

In the `delete` method, when `permanent=True`:
```python
async def delete(self, db, user_id, bookmark_id, permanent=False):
    # ... existing logic ...
    if permanent:
        # Clean up relationships before deleting
        await relationship_service.delete_relationships_for_content(
            db, user_id, "bookmark", bookmark_id
        )
        await db.delete(bookmark)
    else:
        bookmark.deleted_at = func.now()
    await db.flush()
    return True
```

**Update `backend/src/services/note_service.py`:**

Same pattern as bookmark_service.

### Testing Strategy
- Test permanent delete removes relationships
- Test soft delete preserves relationships
- Test restore still has relationships intact

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
    relationship_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> RelationshipResponse:
    """Get a relationship by ID."""

# Update relationship (description, position)
@router.patch("/{relationship_id}")
async def update_relationship(
    relationship_id: int,
    data: RelationshipUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> RelationshipResponse:
    """Update relationship metadata."""

# Delete relationship
@router.delete("/{relationship_id}", status_code=204)
async def delete_relationship(
    relationship_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> None:
    """Delete a relationship."""

# Query relationships for content
@router.get("/content/{content_type}/{content_id}")
async def get_content_relationships(
    content_type: Literal["bookmark", "note"],
    content_id: int,
    relationship_type: str | None = None,
    direction: Literal["outgoing", "incoming", "both"] = "both",
    include_content_info: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> RelationshipListResponse:
    """Get all relationships for a content item."""
```

**New file: `backend/src/schemas/relationship.py`**

```python
class RelationshipCreate(BaseModel):
    source_type: Literal["bookmark", "note"]
    source_id: int
    target_type: Literal["bookmark", "note"]
    target_id: int
    relationship_type: Literal["related", "references"]
    description: str | None = None
    position: int | None = None  # Reserved for future use

    @field_validator("description")
    @classmethod
    def validate_description_length(cls, v):
        if v is not None and len(v) > 500:
            raise ValueError("Description must be 500 characters or less")
        return v

class RelationshipUpdate(BaseModel):
    description: str | None = None
    position: int | None = None

class RelationshipResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source_type: str
    source_id: int
    target_type: str
    target_id: int
    relationship_type: str
    description: str | None
    position: int | None
    created_at: datetime

class RelationshipWithContentResponse(RelationshipResponse):
    """Extended response with basic content info for display."""
    source_title: str | None = None
    source_url: str | None = None  # For bookmarks
    target_title: str | None = None
    target_url: str | None = None  # For bookmarks

class RelationshipListResponse(BaseModel):
    items: list[RelationshipResponse]  # or RelationshipWithContentResponse
    total: int
```

**Update `backend/src/api/main.py`:**
- Register relationships router

**Error responses:**
- 404: Content or relationship not found
- 409: Duplicate relationship
- 400: Invalid relationship (self-reference, invalid type)

### Testing Strategy
- Test all CRUD endpoints
- Test validation errors (invalid types, self-reference)
- Test 404 for missing content
- Test 409 for duplicate relationships
- Test query by relationship type
- Test directional queries
- Test `include_content_info` returns titles

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

```typescript
// Content relationship types
export type ContentType = 'bookmark' | 'note';
export type RelationshipType = 'related' | 'references';

export interface RelationshipCreate {
  source_type: ContentType;
  source_id: number;
  target_type: ContentType;
  target_id: number;
  relationship_type: RelationshipType;
  description?: string | null;
  position?: number | null;
}

export interface RelationshipUpdate {
  description?: string | null;
  position?: number | null;
}

export interface Relationship {
  id: number;
  source_type: ContentType;
  source_id: number;
  target_type: ContentType;
  target_id: number;
  relationship_type: RelationshipType;
  description: string | null;
  position: number | null;
  created_at: string;
}

export interface RelationshipWithContent extends Relationship {
  source_title: string | null;
  source_url: string | null;
  target_title: string | null;
  target_url: string | null;
}

export interface RelationshipListResponse {
  items: Relationship[];
  total: number;
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

  get: (id: number) =>
    api.get<Relationship>(`/relationships/${id}`),

  update: (id: number, data: RelationshipUpdate) =>
    api.patch<Relationship>(`/relationships/${id}`, data),

  delete: (id: number) =>
    api.delete(`/relationships/${id}`),

  getForContent: (
    contentType: ContentType,
    contentId: number,
    params?: {
      relationship_type?: RelationshipType;
      direction?: 'outgoing' | 'incoming' | 'both';
      include_content_info?: boolean;
    }
  ) => api.get<RelationshipListResponse>(
    `/relationships/content/${contentType}/${contentId}`,
    { params }
  ),
};
```

**New file: `frontend/src/hooks/useRelationships.ts`:**

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { relationshipsApi } from '../services/relationships';
import type { ContentType, RelationshipType, RelationshipCreate, RelationshipUpdate } from '../types';

// Query keys
export const relationshipKeys = {
  all: ['relationships'] as const,
  forContent: (type: ContentType, id: number) =>
    [...relationshipKeys.all, 'content', type, id] as const,
};

// Query hook for content relationships
export function useContentRelationships(
  contentType: ContentType | null,
  contentId: number | null,
  options?: {
    relationshipType?: RelationshipType;
    direction?: 'outgoing' | 'incoming' | 'both';
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
        relationship_type: options?.relationshipType,
        direction: options?.direction,
        include_content_info: options?.includeContentInfo,
      }
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
        queryKey: relationshipKeys.forContent(variables.source_type, variables.source_id)
      });
      queryClient.invalidateQueries({
        queryKey: relationshipKeys.forContent(variables.target_type, variables.target_id)
      });
    },
  });

  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: RelationshipUpdate }) =>
      relationshipsApi.update(id, data).then(res => res.data),
    onSuccess: () => {
      // Invalidate all relationship queries (simpler than tracking specific ones)
      queryClient.invalidateQueries({ queryKey: relationshipKeys.all });
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => relationshipsApi.delete(id),
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

## Milestone 6: RelatedContent Display Component

### Goal
Create a reusable component that displays relationships for any content item.

### Success Criteria
- Shows related content grouped by relationship type
- Displays content type icons, titles, and optional descriptions
- Clickable links to related content
- Delete button to remove relationship
- Empty state when no relationships

### Key Changes

**New file: `frontend/src/components/RelatedContent.tsx`:**

```typescript
interface RelatedContentProps {
  contentType: ContentType;
  contentId: number;
  onAddClick?: () => void;
  onNavigate?: (type: ContentType, id: number) => void;
  className?: string;
}

export function RelatedContent({
  contentType,
  contentId,
  onAddClick,
  onNavigate,
  className,
}: RelatedContentProps) {
  const { data, isLoading } = useContentRelationships(contentType, contentId, {
    includeContentInfo: true,
  });
  const { remove } = useRelationshipMutations();

  // Group relationships by type
  // Render each group with header
  // Each item shows: icon, title, description (if present), delete button
}
```

**UI Design (ASCII mockup):**

```
┌─────────────────────────────────────────────────┐
│ Linked Content                           [+ Link]│
├─────────────────────────────────────────────────┤
│ Related                                          │
│ ┌─────────────────────────────────────────────┐ │
│ │ 📄 Project Requirements Doc           [×]   │ │
│ │     "Background context for this task"      │ │
│ └─────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────┐ │
│ │ 🔖 API Documentation                  [×]   │ │
│ └─────────────────────────────────────────────┘ │
│                                                  │
│ References                                       │
│ ┌─────────────────────────────────────────────┐ │
│ │ 🔖 GitHub Issue #123                  [×]   │ │
│ │     "Original feature request"              │ │
│ └─────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
```

**Empty state:**
```
┌─────────────────────────────────────────────────┐
│ Linked Content                           [+ Link]│
├─────────────────────────────────────────────────┤
│                                                  │
│     No linked content yet.                       │
│     Click "+ Link" to connect related items.    │
│                                                  │
└─────────────────────────────────────────────────┘
```

**Content type icons:**
- Bookmark: 🔖 or bookmark icon from existing UI
- Note: 📄 or note icon from existing UI

**Deleted content handling:**
- If target content is soft-deleted, show with strikethrough and "(deleted)" indicator
- Still clickable to restore? Or just informational?

### Testing Strategy
- Component renders with mock relationship data
- Groups relationships by type correctly
- Delete button calls mutation
- Empty state renders when no relationships
- Loading state shows skeleton/spinner
- Handles deleted content indicator

### Dependencies
- Milestone 5 (frontend hooks)

### Risk Factors
- Performance if many relationships (consider virtualization for 50+ items)
- Fetching content titles adds latency (mitigated by `include_content_info`)

---

## Milestone 7: AddRelationshipModal

### Goal
Create modal UI for searching and linking content.

### Success Criteria
- Modal with search input
- Search results show content with type icons
- Can select relationship type
- Optional description field
- Creates relationship on submit

### Key Changes

**New file: `frontend/src/components/AddRelationshipModal.tsx`:**

```typescript
interface AddRelationshipModalProps {
  isOpen: boolean;
  onClose: () => void;
  sourceType: ContentType;
  sourceId: number;
  onSuccess?: () => void;
}

export function AddRelationshipModal({
  isOpen,
  onClose,
  sourceType,
  sourceId,
  onSuccess,
}: AddRelationshipModalProps) {
  // State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedContent, setSelectedContent] = useState<{type: ContentType; id: number} | null>(null);
  const [relationshipType, setRelationshipType] = useState<RelationshipType>('related');
  const [description, setDescription] = useState('');

  // Search using existing /content endpoint
  const debouncedQuery = useDebouncedValue(searchQuery, 300);
  const { data: searchResults } = useContentQuery({
    q: debouncedQuery,
    limit: 10,
  }, { enabled: debouncedQuery.length > 0 });

  // Filter out current item from results
  const filteredResults = searchResults?.items.filter(
    item => !(item.type === sourceType && item.id === sourceId)
  );

  // Create mutation
  const { create } = useRelationshipMutations();

  const handleSubmit = async () => {
    if (!selectedContent) return;
    await create.mutateAsync({
      source_type: sourceType,
      source_id: sourceId,
      target_type: selectedContent.type,
      target_id: selectedContent.id,
      relationship_type: relationshipType,
      description: description || null,
    });
    onSuccess?.();
    onClose();
  };
}
```

**UI Flow:**
1. User clicks [+ Link] button on RelatedContent section
2. Modal opens with search input focused
3. User types to search (debounced)
4. Results appear with type icon, title, description preview
5. User clicks result to select it (highlighted state)
6. Relationship type dropdown (default: "related")
7. Description textarea (optional, placeholder: "Why are these linked?")
8. "Link" button to create (disabled until content selected)
9. Success: modal closes, RelatedContent refreshes

**Relationship type options:**
- Related (default) — bidirectional loose connection
- References — this item references the selected item

### Testing Strategy
- Modal opens/closes correctly
- Search input triggers query
- Results filtered to exclude current item
- Selection highlights and updates state
- Relationship type dropdown works
- Description field captures input
- Submit creates relationship and closes modal
- Validation prevents submit without selection

### Dependencies
- Milestone 6 (RelatedContent component)
- Existing `/content` search endpoint

### Risk Factors
- UX for selecting from search results (clear selection feedback)
- Modal focus management

---

## Milestone 8: Integrate into Note Detail View

### Goal
Add RelatedContent section to the note view/edit page.

### Success Criteria
- Notes display linked content section
- Can add/remove relationships from note view
- Navigation to linked content works

### Key Changes

**Update `frontend/src/components/NoteView.tsx`:**

Add RelatedContent component below note content:

```tsx
// After note content section
<div className="mt-8 border-t border-gray-200 dark:border-gray-700 pt-6">
  <RelatedContent
    contentType="note"
    contentId={note.id}
    onAddClick={() => setShowAddRelationshipModal(true)}
    onNavigate={(type, id) => {
      if (type === 'bookmark') {
        // Open bookmark URL in new tab
        window.open(bookmarkUrl, '_blank');
      } else if (type === 'note') {
        navigate(`/app/notes/${id}`);
      }
    }}
  />
</div>

{/* Add relationship modal */}
<AddRelationshipModal
  isOpen={showAddRelationshipModal}
  onClose={() => setShowAddRelationshipModal(false)}
  sourceType="note"
  sourceId={note.id}
/>
```

**Navigation behavior:**
- Linked bookmark → open URL in new tab (with usage tracking)
- Linked note → navigate to `/app/notes/{id}`

### Testing Strategy
- RelatedContent section appears in note view
- Add button opens modal
- Adding relationship refreshes list
- Clicking linked note navigates correctly
- Clicking linked bookmark opens URL

### Dependencies
- Milestone 7 (AddRelationshipModal)

### Risk Factors
- Layout on mobile (may need collapsible section)

---

## Milestone 9: Integrate into Bookmark Detail View

### Goal
Add RelatedContent section to bookmark edit modal/view.

### Success Criteria
- Bookmarks show linked content when viewing/editing
- Can add/remove relationships
- Works within modal context

### Key Changes

**Update `frontend/src/components/BookmarkForm.tsx`:**

When editing an existing bookmark (not creating new), show related content:

```tsx
{/* Only show for existing bookmarks */}
{bookmark && (
  <div className="mt-6 border-t border-gray-200 dark:border-gray-700 pt-4">
    <RelatedContent
      contentType="bookmark"
      contentId={bookmark.id}
      onAddClick={() => setShowAddRelationshipModal(true)}
      onNavigate={(type, id) => {
        if (type === 'note') {
          // Close bookmark modal first, then navigate
          onClose?.();
          navigate(`/app/notes/${id}`);
        } else if (type === 'bookmark') {
          // Open bookmark URL in new tab
          window.open(url, '_blank');
        }
      }}
    />
  </div>
)}

{/* Nested modal for adding relationships */}
<AddRelationshipModal
  isOpen={showAddRelationshipModal}
  onClose={() => setShowAddRelationshipModal(false)}
  sourceType="bookmark"
  sourceId={bookmark?.id ?? 0}
/>
```

**Considerations:**
- Bookmark edit is typically in a modal — adding relationship shouldn't open another modal on top
- Solution: AddRelationshipModal replaces content within same modal, or use slide-over pattern
- Alternative: Use inline search/select instead of modal

### Testing Strategy
- Related content appears when editing bookmark
- Add relationship works within modal context
- Navigation closes modal before navigating
- Linking to another bookmark opens URL

### Dependencies
- Milestone 8 (note integration pattern)

### Risk Factors
- Modal-within-modal UX complexity
- Consider inline pattern instead of nested modal

---

## Milestone 10: MCP Server Integration

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
    content_type: Literal["bookmark", "note"],
    content_id: int,
    relationship_type: str | None = None,
) -> list[dict]:
    """
    Get relationships for a content item.

    Args:
        content_type: Type of content ("bookmark" or "note")
        content_id: ID of the content item
        relationship_type: Optional filter by type ("related", "references", etc.)

    Returns:
        List of relationships with source/target info
    """

@mcp.tool()
async def create_relationship(
    source_type: Literal["bookmark", "note"],
    source_id: int,
    target_type: Literal["bookmark", "note"],
    target_id: int,
    relationship_type: Literal["related", "references"],
    description: str | None = None,
) -> dict:
    """
    Create a relationship between two content items.

    Args:
        source_type: Type of source content
        source_id: ID of source content
        target_type: Type of target content
        target_id: ID of target content
        relationship_type: Type of relationship
        description: Optional description of why items are linked

    Returns:
        Created relationship
    """

@mcp.tool()
async def delete_relationship(
    relationship_id: int,
) -> bool:
    """
    Delete a relationship.

    Args:
        relationship_id: ID of relationship to delete

    Returns:
        True if deleted, False if not found
    """
```

**Update MCP server instructions in `CLAUDE.md`:**

```markdown
**Relationships:**
- `get_content_relationships`: Get relationships for a bookmark or note
- `create_relationship`: Link two content items together
- `delete_relationship`: Remove a relationship
```

### Testing Strategy
- MCP tools return expected data
- Error handling for invalid content IDs
- Integration test with MCP client

### Dependencies
- Milestone 4 (API endpoints — MCP calls same service layer)

### Risk Factors
- None significant

---

## Summary

| Milestone | Description | Complexity |
|-----------|-------------|------------|
| 1 | Database model & migration | Low |
| 2 | Relationship service | Medium |
| 3 | Cleanup integration | Low |
| 4 | API endpoints | Medium |
| 5 | Frontend types & API | Low |
| 6 | RelatedContent component | Medium |
| 7 | AddRelationshipModal | Medium |
| 8 | Note detail integration | Low |
| 9 | Bookmark detail integration | Low |
| 10 | MCP server integration | Low |

---

## Comprehensive Test Scenarios

### Backend: Relationship Service Tests

#### Create Relationship — Content Type Combinations

| Test | Source | Target | Expected |
|------|--------|--------|----------|
| `test__create_relationship__bookmark_to_bookmark` | bookmark | bookmark | Success |
| `test__create_relationship__bookmark_to_note` | bookmark | note | Success |
| `test__create_relationship__note_to_bookmark` | note | bookmark | Success |
| `test__create_relationship__note_to_note` | note | note | Success |

#### Create Relationship — Validation

| Test | Scenario | Expected |
|------|----------|----------|
| `test__create_relationship__duplicate_rejected` | Same source/target/type exists | 409 Conflict |
| `test__create_relationship__duplicate_different_type_allowed` | Same source/target, different type | Success |
| `test__create_relationship__self_reference_rejected_bookmark` | bookmark→same bookmark | 400 Bad Request |
| `test__create_relationship__self_reference_rejected_note` | note→same note | 400 Bad Request |
| `test__create_relationship__source_not_found_bookmark` | Non-existent bookmark as source | 404 Not Found |
| `test__create_relationship__source_not_found_note` | Non-existent note as source | 404 Not Found |
| `test__create_relationship__target_not_found_bookmark` | Non-existent bookmark as target | 404 Not Found |
| `test__create_relationship__target_not_found_note` | Non-existent note as target | 404 Not Found |
| `test__create_relationship__soft_deleted_source_rejected` | Soft-deleted content as source | 404 Not Found |
| `test__create_relationship__soft_deleted_target_rejected` | Soft-deleted content as target | 404 Not Found |
| `test__create_relationship__archived_source_allowed` | Archived content as source | Success |
| `test__create_relationship__archived_target_allowed` | Archived content as target | Success |
| `test__create_relationship__invalid_relationship_type` | Invalid type string | 400/422 Validation Error |
| `test__create_relationship__description_max_length` | Description > 500 chars | 422 Validation Error |
| `test__create_relationship__description_optional` | No description provided | Success (null) |
| `test__create_relationship__with_description` | Description provided | Success with description |
| `test__create_relationship__different_user_content` | Source/target belongs to other user | 404 Not Found |

#### Query Relationships — Direction

| Test | Scenario | Expected |
|------|----------|----------|
| `test__get_relationships__outgoing_only` | Query with direction="outgoing" | Only where content is source |
| `test__get_relationships__incoming_only` | Query with direction="incoming" | Only where content is target |
| `test__get_relationships__both_directions` | Query with direction="both" (default) | Union of outgoing and incoming |
| `test__get_relationships__empty_result` | Content has no relationships | Empty list |

#### Query Relationships — Bidirectional (related type)

| Test | Scenario | Expected |
|------|----------|----------|
| `test__get_relationships__related_from_source` | A→B exists, query from A | Returns relationship |
| `test__get_relationships__related_from_target` | A→B exists, query from B | Returns relationship |
| `test__get_relationships__related_bidirectional` | A→B exists, query from both | Same relationship returned |

#### Query Relationships — Directional (references type)

| Test | Scenario | Expected |
|------|----------|----------|
| `test__get_relationships__references_outgoing` | A→B exists, query A outgoing | Returns relationship |
| `test__get_relationships__references_incoming` | A→B exists, query B incoming | Returns relationship |
| `test__get_relationships__references_wrong_direction` | A→B exists, query A incoming | Empty (or doesn't include this) |

#### Query Relationships — Filtering

| Test | Scenario | Expected |
|------|----------|----------|
| `test__get_relationships__filter_by_type_related` | Filter relationship_type="related" | Only related type |
| `test__get_relationships__filter_by_type_references` | Filter relationship_type="references" | Only references type |
| `test__get_relationships__include_content_info` | With include_content_info=true | Returns titles and URLs |
| `test__get_relationships__content_info_deleted_target` | Target is soft-deleted | Title still returned (or null with indicator) |

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
| `test__update_relationship__position` | Update position only | Success, position updated |
| `test__update_relationship__clear_description` | Set description to null | Success, description cleared |
| `test__update_relationship__not_found` | Update non-existent ID | 404 Not Found |

### Backend: Cleanup Integration Tests

#### Permanent Delete Cascade

| Test | Scenario | Expected |
|------|----------|----------|
| `test__delete_bookmark_permanent__removes_as_source` | Bookmark is source in relationships | All such relationships deleted |
| `test__delete_bookmark_permanent__removes_as_target` | Bookmark is target in relationships | All such relationships deleted |
| `test__delete_note_permanent__removes_as_source` | Note is source in relationships | All such relationships deleted |
| `test__delete_note_permanent__removes_as_target` | Note is target in relationships | All such relationships deleted |
| `test__delete_bookmark_permanent__mixed_relationships` | Bookmark has both source and target rels | All relationships involving bookmark deleted |

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
| `test__api_query__success` | GET /relationships/content/{type}/{id} | Valid content | 200, list |
| `test__api_query__with_filters` | GET /relationships/content/{type}/{id}?... | With filters | Filtered results |

### Frontend: Component Tests

| Test | Component | Scenario | Expected |
|------|-----------|----------|----------|
| `test__RelatedContent__renders_grouped` | RelatedContent | Multiple relationship types | Groups by type with headers |
| `test__RelatedContent__empty_state` | RelatedContent | No relationships | Shows empty message |
| `test__RelatedContent__delete_button` | RelatedContent | Click delete | Calls mutation, refreshes |
| `test__RelatedContent__deleted_indicator` | RelatedContent | Target is soft-deleted | Shows strikethrough/badge |
| `test__AddRelationshipModal__search` | AddRelationshipModal | Type in search | Triggers debounced query |
| `test__AddRelationshipModal__excludes_self` | AddRelationshipModal | Search results | Current item not in list |
| `test__AddRelationshipModal__submit` | AddRelationshipModal | Select and submit | Creates relationship, closes |
| `test__AddRelationshipModal__validation` | AddRelationshipModal | Submit without selection | Button disabled |

---

## Decisions Made

1. **Soft-deleted content in relationships:** Yes, display with strikethrough/"(deleted)" indicator
2. **Relationships on duplicate:** No — relationships are specific to original item
3. **Maximum relationships:** No hard limit; add pagination if needed
4. **Bidirectional storage:** Store once, query both directions for `related`

## Open Questions

1. **Can users create relationships TO soft-deleted content?**
   - Recommendation: No — only allow linking to active or archived content
   - Rationale: Prevents confusion about linking to soon-to-be-deleted items

2. **Should we allow linking to archived content?**
   - Recommendation: Yes — archived content is still accessible
   - The UI should indicate "(archived)" state

---

## Future Enhancements (Out of Scope)

**Todo Support (add when implementing todos):**
- Add `todo` to content type check constraints
- Add `subtask` and `blocks` to relationship type check constraints
- Implement `get_subtasks()` convenience method with position ordering
- Add subtask completion cascade logic (optional)

**Other enhancements:**
- Relationship graph visualization
- Bulk relationship management
- Relationship suggestions based on content similarity
- Backlinks panel (show all content linking TO this item separately)
- Relationship history/audit log
