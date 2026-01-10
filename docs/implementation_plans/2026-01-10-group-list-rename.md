# Implementation Plan: Rename Groups → Collections, Lists → Filters

## Overview

This plan renames the terminology throughout the entire stack:
- **List → Filter**: Custom tag-based content filters (database: `content_lists` → `content_filters`)
- **Group → Collection**: Sidebar containers that organize multiple Filters

**Important clarification:** The `filter_expression.groups` array (which holds groups of tag conditions) is a **different concept** from sidebar "Groups" and will **NOT** be renamed. This internal structure remains as-is since "groups" accurately describes groups of filter conditions.

### New Feature: Collection Modal

A new modal will be added for creating/editing Collections, allowing users to:
- Set a Collection name
- Select which Filters to include (displayed as removable tags)
- Filters are saved in selection order

### Description Text for Filter Modal

Add a brief description explaining what Filters are for user clarity.

## Terminology Mapping

| Old Term | New Term | Database | API Endpoint |
|----------|----------|----------|--------------|
| List | Filter | `content_filters` | `/filters/` |
| Group (sidebar) | Collection | (JSONB in `sidebar_order`) | (via `/settings/sidebar`) |
| `filter_expression.groups` | **No change** | N/A | N/A |

### MCP Servers

**No changes required.** Neither `content-mcp-server` nor `prompt-mcp-server` reference `list_id` or the `/lists/` endpoint directly. They interact with bookmarks, notes, and prompts endpoints which use `filter_id` as a query parameter (renamed in this plan).

---

## Milestone 1: Database Migration

### Goal
Rename the database table and update JSONB sidebar structure to use new terminology.

### Success Criteria
- `content_lists` table renamed to `content_filters`
- All JSONB `sidebar_order` data migrated: `type: "list"` → `type: "filter"`, `type: "group"` → `type: "collection"`
- `filter_expression` structure is **unchanged** (groups stays as groups)
- Migration is reversible (downgrade works)
- Existing tests pass with updated fixtures

### Key Changes

**Create the migration using the Makefile command:**

```bash
make migration message="rename_lists_to_filters_groups_to_collections"
```

This will auto-generate a migration file in `backend/src/db/migrations/versions/`. Then **edit the generated file** to replace the auto-generated `upgrade()` and `downgrade()` functions with the custom SQL below (since this migration requires raw SQL for JSONB transformations, not just schema changes that Alembic can auto-detect):

```python
def upgrade() -> None:
    """Upgrade schema."""
    # 1. Rename table from content_lists to content_filters
    op.rename_table('content_lists', 'content_filters')

    # 2. Rename all indexes to match new table name
    op.execute('ALTER INDEX ix_content_lists_user_id RENAME TO ix_content_filters_user_id')
    op.execute('ALTER INDEX ix_content_lists_updated_at RENAME TO ix_content_filters_updated_at')

    # 3. Update sidebar_order JSONB in user_settings
    # Replace type: "list" with type: "filter"
    # Replace type: "group" with type: "collection"
    op.execute("""
        UPDATE user_settings
        SET sidebar_order = (
            SELECT jsonb_set(
                sidebar_order,
                '{items}',
                (
                    SELECT COALESCE(jsonb_agg(
                        CASE
                            WHEN item->>'type' = 'list' THEN
                                jsonb_set(item, '{type}', '"filter"')
                            WHEN item->>'type' = 'group' THEN
                                jsonb_set(
                                    jsonb_set(item, '{type}', '"collection"'),
                                    '{items}',
                                    (
                                        SELECT COALESCE(jsonb_agg(
                                            CASE
                                                WHEN sub_item->>'type' = 'list' THEN
                                                    jsonb_set(sub_item, '{type}', '"filter"')
                                                ELSE sub_item
                                            END
                                        ), '[]'::jsonb)
                                        FROM jsonb_array_elements(item->'items') AS sub_item
                                    )
                                )
                            ELSE item
                        END
                    ), '[]'::jsonb)
                    FROM jsonb_array_elements(sidebar_order->'items') AS item
                )
            )
        )
        WHERE sidebar_order IS NOT NULL
          AND sidebar_order ? 'items'
    """)


def downgrade() -> None:
    """Downgrade schema."""
    # 1. Revert sidebar_order JSONB changes
    op.execute("""
        UPDATE user_settings
        SET sidebar_order = (
            SELECT jsonb_set(
                sidebar_order,
                '{items}',
                (
                    SELECT COALESCE(jsonb_agg(
                        CASE
                            WHEN item->>'type' = 'filter' THEN
                                jsonb_set(item, '{type}', '"list"')
                            WHEN item->>'type' = 'collection' THEN
                                jsonb_set(
                                    jsonb_set(item, '{type}', '"group"'),
                                    '{items}',
                                    (
                                        SELECT COALESCE(jsonb_agg(
                                            CASE
                                                WHEN sub_item->>'type' = 'filter' THEN
                                                    jsonb_set(sub_item, '{type}', '"list"')
                                                ELSE sub_item
                                            END
                                        ), '[]'::jsonb)
                                        FROM jsonb_array_elements(item->'items') AS sub_item
                                    )
                                )
                            ELSE item
                        END
                    ), '[]'::jsonb)
                    FROM jsonb_array_elements(sidebar_order->'items') AS item
                )
            )
        )
        WHERE sidebar_order IS NOT NULL
          AND sidebar_order ? 'items'
    """)

    # 2. Rename all indexes back
    op.execute('ALTER INDEX ix_content_filters_user_id RENAME TO ix_content_lists_user_id')
    op.execute('ALTER INDEX ix_content_filters_updated_at RENAME TO ix_content_lists_updated_at')

    # 3. Rename table back
    op.rename_table('content_filters', 'content_lists')
```

### Testing Strategy
- Run migration: `make migrate`
- Verify migration in local Docker database:
  ```bash
  # Connect to local PostgreSQL
  docker compose exec postgres psql -U postgres -d bookmarks

  # Verify table was renamed
  \dt content_filters

  # Verify indexes were renamed (should see ix_content_filters_user_id and ix_content_filters_updated_at)
  \di *content_filters*

  # Verify sidebar_order JSONB was updated (check for 'filter' and 'collection' types)
  SELECT id, sidebar_order FROM user_settings WHERE sidebar_order IS NOT NULL LIMIT 5;
  ```
- Run existing test suite after migration to ensure no data corruption
- Test migration downgrade restores original state: `uv run alembic downgrade -1`

### Dependencies
None - this is the first milestone

### Risk Factors
- JSONB transformations need to handle NULL values and empty arrays
- Nested structure in collections requires careful SQL

---

## Milestone 2: Backend Models, Schemas, and Services

### Goal
Update all Python code to use new terminology: model names, schema classes, service functions, and internal references.

### Success Criteria
- `ContentList` model renamed to `ContentFilter`
- All schemas renamed (`ContentListCreate` → `ContentFilterCreate`, etc.)
- `FilterGroup` remains unchanged (it's part of filter_expression, not sidebar)
- Sidebar schemas updated (`SidebarListItem` → `SidebarFilterItem`, `SidebarGroup` → `SidebarCollection`)
- Service file renamed and all functions updated
- All backend tests pass with updated code

### Key Changes

**Files to rename:**
- `backend/src/models/content_list.py` → `backend/src/models/content_filter.py`
- `backend/src/schemas/content_list.py` → `backend/src/schemas/content_filter.py`
- `backend/src/services/content_list_service.py` → `backend/src/services/content_filter_service.py`

**Model changes** (`content_filter.py`):
```python
class ContentFilter(Base, UUIDv7Mixin, TimestampMixin):
    """
    ContentFilter model - stores custom filters with tag-based filter expressions.

    Filter expressions use AND groups combined by OR:
    {
        "groups": [
            {"tags": ["work", "priority"], "operator": "AND"},
            {"tags": ["urgent"], "operator": "AND"}
        ],
        "group_operator": "OR"
    }
    Evaluates to: (work AND priority) OR (urgent)
    """
    __tablename__ = "content_filters"
    # ... same columns
    user: Mapped["User"] = relationship("User", back_populates="content_filters")
```

**Schema changes** (`content_filter.py`):
```python
# FilterGroup and FilterExpression remain UNCHANGED
# Only rename the ContentList* classes

class ContentFilterCreate(BaseModel):
    """Schema for creating a new content filter."""
    name: str = Field(min_length=1, max_length=100)
    content_types: list[ContentType] = Field(default=["bookmark", "note"], min_length=1)
    filter_expression: FilterExpression
    default_sort_by: FilterSortByOption | None = None  # Rename ListSortByOption
    default_sort_ascending: bool | None = None

class ContentFilterUpdate(BaseModel): ...
class ContentFilterResponse(BaseModel): ...
```

**Sidebar schema changes** (`sidebar.py`):
```python
class SidebarFilterItem(BaseModel):
    """A user-created filter item."""
    type: Literal["filter"]  # was "list"
    id: UUID

class SidebarCollection(BaseModel):
    """A collection containing other items (cannot be nested)."""
    type: Literal["collection"]  # was "group"
    id: Annotated[str, Field(pattern=UUID_PATTERN)]
    name: Annotated[str, Field(min_length=1, max_length=100)]
    items: list["SidebarFilterItem | SidebarBuiltinItem"]

# Similarly update Computed versions:
# SidebarListItemComputed → SidebarFilterItemComputed
# SidebarGroupComputed → SidebarCollectionComputed
```

**Service changes** (`content_filter_service.py`):
- Rename all functions: `create_list` → `create_filter`, `get_lists` → `get_filters`, etc.

**Update imports in:**
- `backend/src/models/user.py` - relationship name: `content_lists` → `content_filters`
- `backend/src/models/__init__.py`
- `backend/src/schemas/__init__.py`
- `backend/src/services/__init__.py`
- `backend/src/services/sidebar_service.py` - update all list/group references

### Testing Strategy
- Update test fixtures to use new terminology
- Ensure all existing tests pass after renaming
- TypeScript-like checking via mypy/pyright if configured

### Dependencies
- Milestone 1 (database migration) must be complete

### Risk Factors
- Many files reference these classes - careful find-and-replace needed
- ORM relationship names need attention

---

## Milestone 3: Backend API Router

### Goal
Update the API endpoint from `/lists/` to `/filters/` and update all router code.

### Success Criteria
- Router file renamed and endpoint prefix changed to `/filters/`
- All endpoint functions renamed (`create_list` → `create_filter`, etc.)
- Path parameter renamed (`list_id` → `filter_id`)
- Router registered correctly in `main.py`
- All API tests updated and passing

### Key Changes

**Rename file:**
- `backend/src/api/routers/lists.py` → `backend/src/api/routers/filters.py`

**Router changes** (`filters.py`):
```python
router = APIRouter(prefix="/filters", tags=["filters"])

@router.post("/", response_model=ContentFilterResponse, status_code=201)
async def create_filter(
    data: ContentFilterCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
) -> ContentFilterResponse:
    """Create a new content filter."""
    content_filter = await content_filter_service.create_filter(db, current_user.id, data)
    return ContentFilterResponse.model_validate(content_filter)

@router.get("/{filter_id}", response_model=ContentFilterResponse)
async def get_filter(filter_id: UUID, ...): ...

@router.patch("/{filter_id}", response_model=ContentFilterResponse)
async def update_filter(filter_id: UUID, ...): ...

@router.delete("/{filter_id}", status_code=204)
async def delete_filter(filter_id: UUID, ...): ...
```

**Update main.py:**
```python
from api.routers import filters  # was lists
app.include_router(filters.router)
```

**Update references in other routers:**
- `bookmarks.py`, `notes.py`, `prompts.py`, `content.py` - update parameter names (`list_id` → `filter_id`)
- Update docstrings/comments referencing "list"

### Testing Strategy
- Update all API test files to use `/filters/` endpoint
- Rename test file: `test_lists.py` → `test_filters.py`
- Ensure all CRUD operations work with new endpoint

### Dependencies
- Milestone 2 (backend models/schemas/services) must be complete

### Risk Factors
- Other routers reference `list_id` parameter - all need updating

---

## Milestone 4: Frontend Types, Store, and API Client

### Goal
Update frontend TypeScript types, Zustand store, and API client to use new terminology.

### Success Criteria
- All types in `types.ts` renamed (except `FilterGroup`/`FilterExpression` which stay the same)
- Store renamed from `listsStore` to `filtersStore`
- API client updated to use `/filters/` endpoint
- All type imports updated across components

### Key Changes

**Type changes** (`frontend/src/types.ts`):
```typescript
// FilterGroup and FilterExpression remain UNCHANGED - they're part of filter logic

// Rename ContentList types to ContentFilter
export interface ContentFilter {
  id: string
  name: string
  content_types: ContentType[]
  filter_expression: FilterExpression  // Still uses "groups" internally
  default_sort_by: string | null
  default_sort_ascending: boolean | null
  created_at: string
  updated_at: string
}

export interface ContentFilterCreate { ... }
export interface ContentFilterUpdate { ... }

// Rename sidebar types
export interface SidebarFilterItem {
  type: 'filter'  // was 'list'
  id: string
}

export interface SidebarCollection {
  type: 'collection'  // was 'group'
  id: string
  name: string
  items: (SidebarFilterItem | SidebarBuiltinItem)[]
}

// Update Computed versions similarly
export interface SidebarFilterItemComputed extends SidebarFilterItem { ... }
export interface SidebarCollectionComputed { ... }
```

**Update search params** in `types.ts`:
- `list_id` → `filter_id` in `BookmarkSearchParams`, `NoteSearchParams`, `PromptSearchParams`, `ContentSearchParams`

**Store changes:**
- Rename `frontend/src/stores/listsStore.ts` → `frontend/src/stores/filtersStore.ts`
- Rename interface `ListsState` → `FiltersState`
- Update API endpoint from `/lists/` to `/filters/`
- Update all function names

### Testing Strategy
- TypeScript compiler will catch most missing renames
- Run frontend tests to ensure no runtime errors

### Dependencies
- Milestone 3 (backend API) should be complete to test against

### Risk Factors
- Many files import these types - TypeScript will help catch issues

---

## Milestone 5: Frontend Components - Filter Modal and Filter Expression Builder

### Goal
Update the Filter (formerly List) modal, add description text, and ensure `FilterExpressionBuilder` is correctly integrated.

### Success Criteria
- `ListModal.tsx` renamed to `FilterModal.tsx`
- Modal title/labels updated ("Create Filter", "Edit Filter", "Filter Name")
- Add description text explaining what a Filter is
- `FilterExpressionBuilder.tsx` works correctly (no changes needed to "groups" logic)
- All component tests pass

### Key Changes

**Rename file:**
- `frontend/src/components/ListModal.tsx` → `frontend/src/components/FilterModal.tsx`

**FilterModal changes:**
```tsx
export function FilterModal({ ... }): ReactNode {
  // Update all internal references from "list" to "filter"

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit Filter' : 'Create Filter'}
      noPadding
    >
      <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
        {/* Add description at top of form */}
        <p className="text-sm text-gray-500">
          Filters create custom views of your content based on tags. Items matching the filter criteria will appear when you select this filter.
        </p>

        {error && ( ... )}

        <div>
          <label htmlFor="filter-name" className="block text-sm font-medium text-gray-700 mb-1">
            Filter Name
          </label>
          <input
            id="filter-name"
            placeholder="e.g., Work Resources, Reading List"
            ...
          />
        </div>

        {/* Rest of form stays largely the same */}

        <div className="flex gap-3 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
          <button type="submit" className="btn-primary flex-1">
            {isSubmitting ? 'Saving...' : isEditing ? 'Save' : 'Create Filter'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
```

**FilterExpressionBuilder.tsx:**
- No changes to internal "groups" logic - this is filter expression structure, not sidebar groups
- Only update any UI text if it mentions "list" (unlikely)

**Update imports in components that use ListModal:**
- Import `FilterModal` instead of `ListModal`

### Testing Strategy
- Rename `ListModal.test.tsx` → `FilterModal.test.tsx`
- Update test descriptions/assertions to use new terminology
- Test modal opens correctly with new labels

### Dependencies
- Milestone 4 (frontend types) must be complete

### Risk Factors
- UI text changes are straightforward

---

## Milestone 6: Frontend Components - Collection Modal (New Feature)

### Goal
Create a new modal for creating/editing Collections, allowing users to optionally select which Filters to include.

### Success Criteria
- New `CollectionModal.tsx` component created
- Modal allows setting Collection name
- Filter selection is **optional** - users can create empty Collections
- Only shows Filters that are **not already in other Collections** (avoids duplicate validation errors)
- When no Filters are available, displays helpful empty state text
- Selected Filters appear as removable tags in selection order
- Collections can be created and saved via sidebar API
- Modal integrates with sidebar for creating/editing Collections

### Key Design Decisions
- **Filter selection is optional**: Users can create empty Collections and add Filters later via drag-and-drop
- **Only unplaced Filters shown**: The `availableFilters` prop should only include Filters not already in other Collections. This prevents `SidebarDuplicateItemError` on the backend and avoids confusing UX.
- **Empty state handling**: When all Filters are already in Collections, show helpful guidance text

### Key Changes

**Create new component** (`frontend/src/components/CollectionModal.tsx`):

```tsx
import { useState, useEffect } from 'react'
import type { ReactNode, FormEvent } from 'react'
import type { ContentFilter, SidebarCollection, SidebarFilterItem } from '../types'
import { Modal } from './ui/Modal'

interface CollectionModalProps {
  isOpen: boolean
  onClose: () => void
  collection?: SidebarCollection  // For editing existing collection
  availableFilters: ContentFilter[]
  onCreate?: (name: string, filterIds: string[]) => void
  onUpdate?: (id: string, name: string, filterIds: string[]) => void
}

export function CollectionModal({
  isOpen,
  onClose,
  collection,
  availableFilters,
  onCreate,
  onUpdate,
}: CollectionModalProps): ReactNode {
  const [name, setName] = useState('')
  const [selectedFilterIds, setSelectedFilterIds] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isEditing = !!collection

  // Initialize state when modal opens
  useEffect(() => {
    if (isOpen) {
      if (collection) {
        setName(collection.name)
        // Extract filter IDs from collection items, preserving order
        const filterIds = collection.items
          .filter((item): item is SidebarFilterItem => item.type === 'filter')
          .map(item => item.id)
        setSelectedFilterIds(filterIds)
      } else {
        setName('')
        setSelectedFilterIds([])
      }
      setError(null)
    }
  }, [isOpen, collection])

  const handleAddFilter = (filterId: string): void => {
    if (!selectedFilterIds.includes(filterId)) {
      setSelectedFilterIds(prev => [...prev, filterId])  // Maintains selection order
    }
  }

  const handleRemoveFilter = (filterId: string): void => {
    setSelectedFilterIds(prev => prev.filter(id => id !== filterId))
  }

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()

    if (!name.trim()) {
      setError('Collection name is required')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      if (isEditing && onUpdate && collection) {
        await onUpdate(collection.id, name.trim(), selectedFilterIds)
      } else if (onCreate) {
        await onCreate(name.trim(), selectedFilterIds)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save collection')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Get filter objects for selected IDs (maintaining order)
  const selectedFilters = selectedFilterIds
    .map(id => availableFilters.find(f => f.id === id))
    .filter((f): f is ContentFilter => f !== undefined)

  // Get filters not yet selected
  const unselectedFilters = availableFilters.filter(
    f => !selectedFilterIds.includes(f.id)
  )

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? 'Edit Collection' : 'Create Collection'}
      noPadding
    >
      <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
        <p className="text-sm text-gray-500">
          Collections group your Filters together in the sidebar for better organization.
        </p>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {/* Collection Name */}
        <div>
          <label htmlFor="collection-name" className="block text-sm font-medium text-gray-700 mb-1">
            Collection Name
          </label>
          <input
            id="collection-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Work, Personal, Projects"
            className="input"
            disabled={isSubmitting}
          />
        </div>

        {/* Selected Filters */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Filters in Collection
          </label>
          {selectedFilters.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selectedFilters.map(filter => (
                <span
                  key={filter.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm bg-gray-100 text-gray-700"
                >
                  {filter.name}
                  <button
                    type="button"
                    onClick={() => handleRemoveFilter(filter.id)}
                    className="text-gray-400 hover:text-gray-600 ml-0.5"
                    disabled={isSubmitting}
                  >
                    <span className="sr-only">Remove {filter.name}</span>
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">No filters selected</p>
          )}
        </div>

        {/* Available Filters to Add */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Add Filters
          </label>
          {unselectedFilters.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {unselectedFilters.map(filter => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => handleAddFilter(filter.id)}
                  className="inline-flex items-center px-2.5 py-1 rounded-full text-sm bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200 cursor-pointer transition-colors"
                  disabled={isSubmitting}
                >
                  + {filter.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-gray-400 italic">
              {availableFilters.length === 0
                ? "No Filters available. Create Filters first, then add them to Collections."
                : "All available Filters have been added to this Collection."}
            </p>
          )}
        </div>

        {/* Submit buttons */}
        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary flex-1"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-primary flex-1"
            disabled={isSubmitting || !name.trim()}
          >
            {isSubmitting ? 'Saving...' : isEditing ? 'Save' : 'Create Collection'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
```

**Integrate with sidebar:**
- Update `Sidebar.tsx` to include mechanism to open CollectionModal
- Add "Create Collection" option where "Create Group" currently exists
- Wire up onCreate/onUpdate to sidebar settings API

### Testing Strategy
Create `CollectionModal.test.tsx` with tests for:
- Modal renders with correct title for create vs edit mode
- Name input works correctly
- Clicking available filter adds it to selected list
- Clicking × on selected filter removes it
- Filters maintain selection order
- Submit calls onCreate/onUpdate with correct data
- **Can create Collection with no Filters selected (empty Collection)**
- **Empty state shows correct message when no Filters available**
- **Empty state shows correct message when all Filters already added**
- Error state displays correctly

### Dependencies
- Milestone 5 (Filter modal) should be complete for consistent patterns
- Milestone 4 (types) must be complete

### Risk Factors
- The parent component (Sidebar.tsx) must compute and pass `availableFilters` correctly - only Filters not already placed in other Collections
- Need to wire up Collection create/update to sidebar API - verify how Groups are currently created

---

## Milestone 7: Frontend Sidebar Components

### Goal
Update all sidebar components to use new terminology (Collection instead of Group, Filter instead of List).

### Success Criteria
- `SidebarGroup.tsx` renamed to `SidebarCollection.tsx`
- All sidebar components use new type names
- UI labels updated (tooltips, titles: "group" → "collection")
- Drag-and-drop utilities updated
- All sidebar tests pass

### Key Changes

**Rename files:**
- `frontend/src/components/sidebar/SidebarGroup.tsx` → `frontend/src/components/sidebar/SidebarCollection.tsx`
- `frontend/src/components/sidebar/SortableSidebarGroup.tsx` → `frontend/src/components/sidebar/SortableSidebarCollection.tsx`

**Update SidebarCollection.tsx:**
```tsx
interface SidebarCollectionProps {
  name: string
  // ... same props
  onRename?: (newName: string) => void
  onDelete?: () => void
}

export function SidebarCollection({ ... }): ReactNode {
  // Update title attributes:
  // title="Rename group" → title="Rename collection"
  // title="Delete group" → title="Delete collection"
}
```

**Update Sidebar.tsx:**
- Import renamed components
- Update type guards (`item.type === 'group'` → `item.type === 'collection'`)
- Update rendering logic
- Update UI text ("New Group" → "New Collection" if applicable)

**Update sidebarDndUtils.tsx:**
- Update type references (`'group'` → `'collection'`, `'list'` → `'filter'`)

**Update routes.ts:**
- Rename `getListRoute()` → `getFilterRoute()`
- Update route path from `/app/content/lists/${listId}` → `/app/content/filters/${filterId}`

**Update App.tsx:**
- Update route pattern from `/app/content/lists/:listId` → `/app/content/filters/:filterId`
- Update any parameter references from `listId` → `filterId`

### Testing Strategy
- Rename and update test files:
  - `SidebarGroup.test.tsx` → `SidebarCollection.test.tsx`
- Update `Sidebar.test.tsx` with new terminology
- Test drag-and-drop still works correctly
- Test rename/delete collection functionality

### Dependencies
- Milestone 6 (Collection modal) should be complete
- Milestone 4 (types) must be complete

### Risk Factors
- Type literal strings in drag-and-drop logic may be scattered

---

## Milestone 8: Frontend Hooks and Remaining Components

### Goal
Update all remaining frontend code: hooks, utility files, and any components not yet updated.

### Success Criteria
- All hooks updated (`list_id` → `filter_id` parameters)
- Utility file renamed: `invalidateListQueries.ts` → `invalidateFilterQueries.ts`
- All remaining components updated
- No references to old terminology remain in frontend
- All frontend tests pass

### Key Changes

**Update hooks:**
- `useBookmarksQuery.ts` - rename `list_id` → `filter_id` in params
- `useNotesQuery.ts` - rename `list_id` → `filter_id` in params
- `usePromptsQuery.ts` - rename `list_id` → `filter_id` in params
- `useContentQuery.ts` / `useContentView.ts` - rename `list_id` → `filter_id`

**Rename utility:**
- `frontend/src/utils/invalidateListQueries.ts` → `frontend/src/utils/invalidateFilterQueries.ts`
- Update function names and query key references

**Update any remaining components:**
- `ListManager.tsx` → `FilterManager.tsx` (if exists)
- `ListCard.tsx` → `FilterCard.tsx` (if exists)
- Any other components referencing lists

**Full codebase search for remaining old terminology:**
```bash
grep -rn "list_id" frontend/src/
grep -rn "ContentList" frontend/src/
grep -rn "SidebarList" frontend/src/
grep -rn "SidebarGroup" frontend/src/
grep -rn "'list'" frontend/src/
grep -rn "'group'" frontend/src/
grep -rn "\"list\"" frontend/src/
grep -rn "\"group\"" frontend/src/
```

### Testing Strategy
- Run full frontend test suite: `npm run test:run`
- Run TypeScript compiler: `npm run build` or `tsc --noEmit`
- Manual testing of filter and collection flows

### Dependencies
- All previous frontend milestones must be complete

### Risk Factors
- Scattered references easy to miss

---

## Milestone 9: Backend Tests and Documentation

### Goal
Update all backend tests to use new terminology.

### Success Criteria
- All test files use new terminology
- Test fixtures updated
- All backend tests pass
- Any relevant documentation updated

### Key Changes

**Rename test files:**
- `backend/tests/api/test_lists.py` → `backend/tests/api/test_filters.py`
- `backend/tests/services/test_content_list_service.py` → `backend/tests/services/test_content_filter_service.py`

**Update test fixtures and assertions:**
- Update all references to list/group terminology
- Update API endpoint paths (`/lists/` → `/filters/`)
- Update schema references
- Update sidebar item types in test data (`"list"` → `"filter"`, `"group"` → `"collection"`)

**Update other test files that reference lists/groups:**
- `test_bookmarks.py` - `list_id` → `filter_id`
- `test_notes.py` - `list_id` → `filter_id`
- `test_prompts.py` - `list_id` → `filter_id`
- `test_content.py` - `list_id` → `filter_id`
- `test_settings.py` - sidebar item types
- `test_sidebar_service.py` - all list/group references
- `test_sidebar_schemas.py` - schema validation tests

### Testing Strategy
- Run `make tests` to ensure everything passes
- Run `make linting` for code style

### Dependencies
- All backend code changes (Milestones 1-3) must be complete

### Risk Factors
- Test data fixtures with hardcoded structures need careful updates

---

## Milestone 10: Final Verification and Cleanup

### Goal
Comprehensive verification that all terminology has been updated and the system works end-to-end.

### Success Criteria
- Full codebase search confirms no old terminology remains (except intentional `filter_expression.groups`)
- All tests pass (backend and frontend)
- Manual end-to-end testing confirms all functionality works
- No console errors or warnings related to old terminology

### Key Changes

**Codebase-wide search to verify completion:**
```bash
# Backend - should return NO results (except filter_expression.groups which is OK)
grep -rn "content_list" backend/src/
grep -rn "ContentList" backend/src/
grep -rn '"list"' backend/src/schemas/sidebar.py  # Type literals
grep -rn '"group"' backend/src/schemas/sidebar.py  # Type literals
grep -rn "list_id" backend/src/api/

# Frontend - should return NO results
grep -rn "ContentList" frontend/src/
grep -rn "SidebarListItem" frontend/src/
grep -rn "SidebarGroup" frontend/src/
grep -rn "list_id" frontend/src/
grep -rn "'list'" frontend/src/types.ts  # Type literals
grep -rn "'group'" frontend/src/types.ts  # Type literals
```

**Manual testing checklist:**
- [ ] Create a new Filter via the modal
- [ ] Edit an existing Filter
- [ ] Delete a Filter
- [ ] Create a new Collection via the modal
- [ ] Add Filters to a Collection
- [ ] Remove Filters from a Collection
- [ ] Rename a Collection inline in sidebar
- [ ] Delete a Collection
- [ ] Drag and drop Filters in sidebar (reorder)
- [ ] Drag Filters into/out of Collections
- [ ] Collapse/expand Collections
- [ ] Verify filter expression builder works correctly
- [ ] Test content filtering when a Filter is selected

**Cleanup:**
- Remove any commented-out old code
- Remove any TODO comments related to the rename
- Ensure consistent naming conventions throughout

### Testing Strategy
- Run complete test suite: `make tests`
- Run frontend tests: `npm run test:run`
- Manual UI testing per checklist above

### Dependencies
- All previous milestones must be complete

### Risk Factors
- Integration issues may surface during manual testing

---

## Summary

| Milestone | Description | Estimated Files |
|-----------|-------------|-----------------|
| 1 | Database Migration | 1 new migration file |
| 2 | Backend Models/Schemas/Services | ~10 files |
| 3 | Backend API Router | ~6 files |
| 4 | Frontend Types/Store/API | ~3 files |
| 5 | Frontend Filter Modal | ~3 files |
| 6 | Frontend Collection Modal (New) | 1 new file + integrations |
| 7 | Frontend Sidebar Components | ~6 files |
| 8 | Frontend Hooks & Remaining | ~8 files |
| 9 | Backend Tests | ~10 files |
| 10 | Final Verification | Verification only |

**Total:** ~50 files to modify/create

**Important notes:**
- **Migrations:** Always create migrations using `make migration message="description"` - never create migration files manually
- **MCP Servers:** No changes required - they don't reference `list_id` or `/lists/` directly
- **Indexes:** Two indexes need renaming: `ix_content_lists_user_id` and `ix_content_lists_updated_at`
- **Frontend Routes:** URL pattern changes from `/app/content/lists/:listId` → `/app/content/filters/:filterId`
- **Key clarification:** The `filter_expression.groups` structure is intentionally **NOT** renamed - it represents groups of filter conditions, which is unrelated to sidebar "Groups" (now "Collections")
