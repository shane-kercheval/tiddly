# Sidebar Reorganization Implementation Plan

## Overview

Replace the hardcoded sidebar sections (Notes, Bookmarks, Shared) with a flexible user-defined structure where:
- Users create **Groups** to organize items (stored inline in JSON, not a separate table)
- Users can order groups and items freely via drag-and-drop directly in the sidebar
- All sidebar management (create/edit/delete groups and lists) happens inline - no separate settings page
- Built-in items (All, Archived, Trash) are orderable like any other item
- Lists and builtins can exist at root level or inside groups
- "All Bookmarks" and "All Notes" are removed; content type filtering moves to multi-select chips on All/Archived/Trash
- Quick-add buttons in sidebar and "All" view for creating bookmarks/notes

## Data Model

### No New Tables

Groups are purely UI structure with no business logic, so they live inline in the JSON.

### UserSettings Changes

Replace `tab_order` field with `sidebar_order`:

```python
# Old structure (tab_order)
{
  "sections": { "shared": [...], "bookmarks": [...], "notes": [...] },
  "section_order": ["shared", "bookmarks", "notes"]
}

# New structure (sidebar_order)
{
  "version": 1,
  "items": [
    { "type": "builtin", "key": "all" },
    {
      "type": "group",
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Work",
      "items": [
        { "type": "list", "id": 3 },
        { "type": "list", "id": 7 }
      ]
    },
    { "type": "list", "id": 5 },
    { "type": "builtin", "key": "archived" },
    { "type": "builtin", "key": "trash" }
  ]
}
```

### ContentList - Unchanged

No modifications needed to the ContentList model.

## API Changes

### New Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /settings/sidebar` | Returns computed sidebar with list names/content_types resolved |
| `PUT /settings/sidebar` | Updates sidebar structure (validates list IDs) |

### Removed Endpoints

- `GET /settings/tab-order`
- `GET /settings/tab-order/raw`
- `PUT /settings/tab-order`

### Response Shapes

**GET /settings/sidebar** returns (computed):
```json
{
  "version": 1,
  "items": [
    { "type": "builtin", "key": "all", "name": "All" },
    {
      "type": "group",
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Work",
      "items": [
        { "type": "list", "id": 3, "name": "Python Resources", "content_types": ["bookmark"] },
        { "type": "list", "id": 7, "name": "Project Notes", "content_types": ["note"] }
      ]
    },
    { "type": "list", "id": 5, "name": "Reading List", "content_types": ["bookmark", "note"] },
    { "type": "builtin", "key": "archived", "name": "Archived" },
    { "type": "builtin", "key": "trash", "name": "Trash" }
  ]
}
```

**PUT /settings/sidebar** accepts (minimal):
```json
{
  "version": 1,
  "items": [
    { "type": "builtin", "key": "all" },
    {
      "type": "group",
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Work",
      "items": [
        { "type": "list", "id": 3 },
        { "type": "list", "id": 7 }
      ]
    },
    { "type": "list", "id": 5 },
    { "type": "builtin", "key": "archived" },
    { "type": "builtin", "key": "trash" }
  ]
}
```

---

## Milestone 1: Backend Schema & Service Changes

### Goal
Update backend schemas, services, and create new sidebar endpoints.

### Success Criteria
- New Pydantic schemas validate the sidebar_order structure
- `GET /settings/sidebar` returns computed sidebar with resolved list info
- `PUT /settings/sidebar` validates and stores the structure
- Old tab-order endpoints removed
- All existing tests updated, new tests pass

### Key Changes

**1. New schemas (`backend/src/schemas/sidebar.py`)**

```python
from typing import Literal
from pydantic import BaseModel, Field

SIDEBAR_VERSION = 1
BuiltinKey = Literal["all", "archived", "trash"]

class SidebarBuiltinItem(BaseModel):
    type: Literal["builtin"]
    key: BuiltinKey

class SidebarListItem(BaseModel):
    type: Literal["list"]
    id: int

class SidebarGroup(BaseModel):
    type: Literal["group"]
    id: str = Field(pattern=r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')  # UUID format validation
    name: str = Field(min_length=1, max_length=100)
    items: list["SidebarListItem | SidebarBuiltinItem"]  # Groups cannot nest

SidebarItem = SidebarBuiltinItem | SidebarListItem | SidebarGroup

class SidebarOrder(BaseModel):
    version: int = SIDEBAR_VERSION
    items: list[SidebarItem]

# Computed versions (returned by GET)
class SidebarBuiltinItemComputed(SidebarBuiltinItem):
    name: str  # "All", "Archived", "Trash"

class SidebarListItemComputed(SidebarListItem):
    name: str
    content_types: list[str]

class SidebarGroupComputed(BaseModel):
    type: Literal["group"]
    id: str
    name: str
    items: list[SidebarListItemComputed | SidebarBuiltinItemComputed]

SidebarItemComputed = SidebarBuiltinItemComputed | SidebarListItemComputed | SidebarGroupComputed

class SidebarOrderComputed(BaseModel):
    version: int
    items: list[SidebarItemComputed]
```

**2. Update UserSettings model**

- Rename `tab_order` column to `sidebar_order` (or add new column and migrate)
- Update default value to new structure

**3. New service functions (`backend/src/services/sidebar_service.py`)**

```python
def get_default_sidebar_order() -> dict:
    """Default sidebar for new users."""
    return {
        "version": SIDEBAR_VERSION,
        "items": [
            {"type": "builtin", "key": "all"},
            {"type": "builtin", "key": "archived"},
            {"type": "builtin", "key": "trash"},
        ]
    }

def get_computed_sidebar(session, user_id: int) -> SidebarOrderComputed:
    """Fetch sidebar_order and resolve list names/content_types."""
    # 1. Get raw sidebar_order from UserSettings
    # 2. Fetch all user's lists from DB
    # 3. Walk the structure, resolving list IDs to names/content_types
    # 4. Filter out orphaned references (lists in sidebar but deleted from DB)
    # 5. Append orphaned lists (lists in DB but not in sidebar) to root
    #    - This ensures no list becomes inaccessible
    # 6. Add display names for builtins
    pass

def update_sidebar_order(session, user_id: int, sidebar_order: SidebarOrder) -> None:
    """Validate and save sidebar structure."""
    # 1. Extract all list IDs from structure
    # 2. Verify all list IDs exist and belong to user
    # 3. Verify no duplicate items (same list/builtin/group twice)
    # 4. Save to UserSettings
    pass
```

**4. New router (`backend/src/api/routers/sidebar.py`)**

```python
@router.get("/sidebar", response_model=SidebarOrderComputed)
async def get_sidebar(user: User = Depends(get_current_user_auth0_only)):
    ...

@router.put("/sidebar", response_model=SidebarOrderComputed)
async def update_sidebar(sidebar: SidebarOrder, user: User = Depends(get_current_user_auth0_only)):
    ...
```

**5. Update list creation/deletion**

When a list is created:
- Add `{"type": "list", "id": <new_id>}` to end of `sidebar_order.items`

When a list is deleted:
- Remove from sidebar_order (search through items and group items)

**6. Database migration**

- Rename `tab_order` to `sidebar_order`
- Migrate existing data to new structure (or reset to default)

### Testing Strategy

- Unit tests for schema validation (valid/invalid structures, group UUID required)
- Unit tests for `get_computed_sidebar`:
  - Resolves list names and content_types
  - Filters out deleted list references
  - Appends orphaned lists (in DB but not in sidebar) to root
- Unit tests for `update_sidebar_order` (validates list ownership, rejects duplicates)
- Integration tests for GET/PUT endpoints
- Test list creation adds to sidebar
- Test list deletion removes from sidebar

### Dependencies
None - this is the foundation.

### Risk Factors
- Data migration for existing users with customized tab_order
- Deciding whether to preserve existing structure or reset to default

---

## Milestone 2: Frontend State & API Layer

### Goal
Update frontend stores and API services to use new sidebar structure.

### Success Criteria
- `useSettingsStore` fetches/updates via new `/settings/sidebar` endpoint
- Sidebar state reflects new flat + groups structure
- Group collapsed state managed in localStorage (via `useSidebarStore`)
- Old tab-order code removed

### Key Changes

**1. Update API service (`frontend/src/services/api.ts`)**

```typescript
// Remove
getTabOrder(): Promise<TabOrderResponse>
getRawTabOrder(): Promise<TabOrder>
updateTabOrder(tabOrder: TabOrder): Promise<TabOrder>

// Add
getSidebar(): Promise<SidebarOrderComputed>
updateSidebar(sidebar: SidebarOrder): Promise<SidebarOrderComputed>
```

**2. New types (`frontend/src/types/sidebar.ts`)**

```typescript
type BuiltinKey = "all" | "archived" | "trash";

interface SidebarBuiltinItem {
  type: "builtin";
  key: BuiltinKey;
}

interface SidebarListItem {
  type: "list";
  id: number;
}

interface SidebarGroup {
  type: "group";
  id: string;  // UUID, generated client-side via crypto.randomUUID()
  name: string;
  items: (SidebarListItem | SidebarBuiltinItem)[];
}

type SidebarItem = SidebarBuiltinItem | SidebarListItem | SidebarGroup;

interface SidebarOrder {
  version: number;
  items: SidebarItem[];
}

// Computed versions (from GET response)
interface SidebarBuiltinItemComputed extends SidebarBuiltinItem {
  name: string;
}

interface SidebarListItemComputed extends SidebarListItem {
  name: string;
  content_types: string[];
}

interface SidebarGroupComputed {
  type: "group";
  id: string;
  name: string;
  items: (SidebarListItemComputed | SidebarBuiltinItemComputed)[];
}

type SidebarItemComputed = SidebarBuiltinItemComputed | SidebarListItemComputed | SidebarGroupComputed;

interface SidebarOrderComputed {
  version: number;
  items: SidebarItemComputed[];
}
```

**3. Update `useSettingsStore`**

```typescript
interface SettingsState {
  sidebar: SidebarOrderComputed | null;
  // Remove: computedSections, sectionOrder, computedTabOrder

  fetchSidebar: () => Promise<void>;
  updateSidebar: (sidebar: SidebarOrder) => Promise<void>;
}
```

**4. Update `useSidebarStore`**

```typescript
interface SidebarState {
  isCollapsed: boolean;
  collapsedGroupIds: string[];  // Group UUIDs that are collapsed
  isMobileOpen: boolean;

  toggleGroupCollapsed: (groupId: string) => void;
  // Remove: expandedSections (replaced by collapsedGroupIds)
}
```

Note: Using `collapsedGroupIds` (collapsed by default = false) vs `expandedSections` is a UX choice. Groups start expanded, user can collapse them. Using UUIDs (not names) ensures collapsed state persists through renames.

### Testing Strategy
- Unit tests for store actions
- Verify localStorage persistence for collapsed groups
- Integration tests with mocked API responses

### Dependencies
- Milestone 1 (backend endpoints)

### Risk Factors
- Ensure no components still reference old `computedSections`/`sectionOrder`

---

## Milestone 3: Sidebar Component Refactor

### Goal
Update sidebar components to render the new structure.

### Success Criteria
- Sidebar renders flat items and groups correctly
- Groups are collapsible
- Lists show correct icons based on content_types
- Built-in items render with appropriate icons
- Navigation works for all item types

### Key Changes

**1. Update `Sidebar.tsx`**

- Replace section-based rendering with item-based rendering
- Iterate over `sidebar.items` and render based on type

```typescript
{sidebar.items.map((item) => {
  if (item.type === "builtin") {
    return <SidebarNavItem key={item.key} item={item} />;
  }
  if (item.type === "list") {
    return <SidebarNavItem key={`list-${item.id}`} item={item} />;
  }
  if (item.type === "group") {
    return <SidebarGroup key={item.id} group={item} />;
  }
})}
```

**2. Rename/refactor `SidebarSection.tsx` → `SidebarGroup.tsx`**

- Accepts a `SidebarGroupComputed` prop
- Renders group header with name and collapse toggle
- Renders child items (lists and builtins only, no nested groups)
- Uses `useSidebarStore.collapsedGroupIds` for collapse state (by UUID)

**3. Update `SidebarNavItem.tsx`**

- Accept computed item (builtin or list)
- Determine icon based on item type:
  - Builtin "all": appropriate icon (e.g., `Squares2X2Icon`)
  - Builtin "archived": `ArchiveBoxIcon`
  - Builtin "trash": `TrashIcon`
  - List with `content_types: ["bookmark"]`: `BookmarkIcon`
  - List with `content_types: ["note"]`: `DocumentTextIcon`
  - List with both: new mixed icon (e.g., `RectangleStackIcon`)

**4. Update `routes.ts`**

Simplify routing - all lists now route to `/app/content/lists/:id` regardless of content type:

```typescript
function getItemRoute(item: SidebarItemComputed): string {
  if (item.type === "builtin") {
    switch (item.key) {
      case "all": return "/app/content";
      case "archived": return "/app/content/archived";
      case "trash": return "/app/content/trash";
    }
  }
  if (item.type === "list") {
    // Unified routing - no more /app/bookmarks/lists or /app/notes/lists
    return `/app/content/lists/${item.id}`;
  }
  // Groups don't have routes - they just contain items
}
```

Note: This replaces the old section-based routing where bookmark-only lists went to `/app/bookmarks/lists/:id`, note-only to `/app/notes/lists/:id`, and mixed to `/app/content/lists/:id`. Now all lists use the unified route.

**5. Group icon**

For groups, use a folder-style icon (e.g., `FolderIcon` from Heroicons).

### Testing Strategy
- Visual testing of sidebar rendering
- Test group collapse/expand functionality
- Test navigation for all item types
- Test icon selection logic

### Dependencies
- Milestone 2 (frontend state)

### Risk Factors
- Ensuring all existing navigation still works
- Mobile sidebar behavior

---

## Milestone 4a: In-Sidebar Management UI

### Goal
Add inline management (create/edit/delete) directly in the sidebar without drag-and-drop.

### Success Criteria
- Users can create groups (via button → inline text input)
- Users can rename groups (click name → inline edit)
- Users can delete groups (hover/tap action → confirmation, moves contents to root)
- Users can create lists (via button → opens ListModal)
- Users can edit lists (hover/tap action → opens ListModal)
- Users can delete lists (hover/tap action → confirmation)
- Mobile: tap to reveal actions (hover doesn't work on touch)
- Changes persist immediately

### Key Changes

**1. Add hover/tap actions to `SidebarNavItem.tsx`**

```typescript
// Desktop: show action icons on hover
// Mobile: tap item to reveal actions, tap elsewhere to hide

<div className="group flex items-center">
  <span>{item.name}</span>
  <div className="ml-auto opacity-0 group-hover:opacity-100 md:group-hover:opacity-100">
    {item.type === "list" && (
      <>
        <EditIcon onClick={() => openListModal(item.id)} />
        <DeleteIcon onClick={() => confirmDelete(item.id)} />
      </>
    )}
  </div>
</div>

// For mobile, track "active" item state and show actions for that item
// Or use a three-dot menu that's always visible on mobile
```

**2. Add inline group rename to `SidebarGroup.tsx`**

```typescript
// Click on group name → editable input
// Enter/blur → save new name
// Escape → cancel

const [isEditing, setIsEditing] = useState(false);
const [editName, setEditName] = useState(group.name);

{isEditing ? (
  <input
    value={editName}
    onChange={(e) => setEditName(e.target.value)}
    onBlur={handleSave}
    onKeyDown={handleKeyDown}
    autoFocus
  />
) : (
  <span onClick={() => setIsEditing(true)}>{group.name}</span>
)}
```

**3. Add "New Group" and "New List" buttons**

Add buttons at bottom of sidebar or in a dedicated section:

```typescript
<div className="mt-auto border-t pt-2">
  <button onClick={handleNewGroup}>+ New Group</button>
  <button onClick={() => setListModalOpen(true)}>+ New List</button>
</div>

// handleNewGroup creates group with UUID:
const handleNewGroup = () => {
  const newGroup = {
    type: "group",
    id: crypto.randomUUID(),
    name: "New Group",
    items: []
  };
  // Add to sidebar and immediately enter edit mode for name
};
```

**4. Delete deprecated components**

- Delete `SettingsLists.tsx`
- Delete `SectionTabOrderEditor.tsx`
- Delete `ListManager.tsx` (functionality moves to sidebar)
- Remove "Lists" from settings navigation

### Testing Strategy
- Test group create with UUID generation
- Test inline group rename (save on blur/enter, cancel on escape)
- Test group delete moves contents to root
- Test list create/edit opens modal
- Test list delete with confirmation
- Test mobile tap-to-reveal actions
- Test changes persist immediately

### Dependencies
- Milestone 3 (sidebar rendering)

### Risk Factors
- Mobile UX for revealing actions
- Empty group handling (allowed - user can delete manually)

---

## Milestone 4b: Drag-and-Drop Reordering

### Goal
Add drag-and-drop reordering for sidebar items using @dnd-kit.

### Success Criteria
- Users can reorder items at root level via drag-and-drop
- Users can drag items into groups
- Users can drag items out of groups to root
- Users can reorder items within groups
- Users can reorder groups themselves
- Drag handles visible on hover for discoverability
- Keyboard accessibility (arrow keys + space/enter)
- Debounced persistence (~300-500ms) to prevent rapid API calls

### Key Changes

**1. Install @dnd-kit**

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

**2. Update `Sidebar.tsx` with drag-and-drop**

```typescript
import { DndContext, closestCenter, DragOverlay, pointerWithin } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useSensors, useSensor, PointerSensor, KeyboardSensor } from '@dnd-kit/core';

// Configure sensors for pointer and keyboard
const sensors = useSensors(
  useSensor(PointerSensor, {
    activationConstraint: { distance: 8 }  // Prevent accidental drags
  }),
  useSensor(KeyboardSensor)
);

// Wrap sidebar content in DndContext
// Use collision detection that works for nested containers
// Groups are both sortable AND droppable containers
```

**3. Add drag handles to items**

```typescript
import { useSortable } from '@dnd-kit/sortable';

// Each item gets a drag handle that appears on hover
<div className="group flex items-center">
  <DragHandle
    className="opacity-0 group-hover:opacity-100 cursor-grab"
    {...listeners}
    {...attributes}
  />
  <span>{item.name}</span>
  {/* ... action icons ... */}
</div>
```

**4. Implement debounced persistence**

```typescript
// Debounce sidebar updates to prevent rapid API calls during drag operations
const debouncedUpdateSidebar = useMemo(
  () => debounce((sidebar: SidebarOrder) => {
    updateSidebar(sidebar);
  }, 300),
  [updateSidebar]
);

// On drag end, update local state immediately, debounce API call
const handleDragEnd = (event: DragEndEvent) => {
  const newSidebar = computeNewSidebarOrder(event);
  setSidebarLocal(newSidebar);  // Optimistic update
  debouncedUpdateSidebar(newSidebar);
};
```

**5. Handle nested drag-and-drop**

Groups are special: they can be dragged AND receive dropped items.

```typescript
// Use @dnd-kit's useDroppable for groups
// Detect when item is dragged over a group vs between groups
// Visual feedback: highlight group when item hovers over it
```

### Testing Strategy
- Test drag-and-drop reordering at root level
- Test dragging items into groups (visual feedback, correct placement)
- Test dragging items out of groups to root
- Test reordering within groups
- Test dragging groups to reorder
- Test keyboard accessibility (Tab to focus, Space to pick up, Arrow to move, Space to drop)
- Test debounced persistence (rapid drags don't spam API)
- Test optimistic update with rollback on failure

### Dependencies
- Milestone 4a (in-sidebar management)

### Risk Factors
- @dnd-kit nested sortable requires careful collision detection setup
- Performance with many items during drag operations
- Touch device drag experience

---

## Milestone 5: Content Type Filtering & Quick Actions

### Goal
Add content type filter chips to All/Archived/Trash and quick-add buttons in two locations.

### Success Criteria
- All/Archived/Trash show filter chips for content types (multi-select)
- Filter state persists appropriately (URL params or localStorage)
- Quick-add icons in sidebar for each content type (bookmark, note)
- Quick-add hover menu (+) near search bar in "All" view
- Removed: "All Bookmarks" and "All Notes" built-in items

### Key Changes

**1. Content type filter chips**

Add to content pages (All, Archived, Trash):

```typescript
<ContentTypeFilterChips
  selected={selectedTypes}  // ["bookmark", "note"] or subset
  onChange={setSelectedTypes}
/>

// Renders clickable chips:
// [Bookmarks ✓] [Notes ✓]
//
// Multi-select: clicking toggles each type
// At least one must be selected
// Future-proofed for third type (todos)
```

**2. Update content fetching**

Pass selected content types to `/content` endpoint:

```typescript
// Existing endpoint already supports content_types param
GET /content?content_types=bookmark,note
```

**3. Quick-add in sidebar**

Add icons/buttons for each content type in sidebar (e.g., near the top or in header):

```typescript
// Sidebar header area
<div className="flex gap-2">
  <button onClick={openNewBookmarkModal} title="New Bookmark">
    <BookmarkIcon />
  </button>
  <button onClick={openNewNoteModal} title="New Note">
    <DocumentTextIcon />
  </button>
  {/* Future: TodoIcon */}
</div>
```

These create items with no prepopulated tags (unlike creating from within a custom list).

**4. Quick-add in "All" view**

Add a `+` icon near the search bar that shows options on hover/click:

```typescript
<QuickAddMenu>
  <QuickAddOption icon={BookmarkIcon} label="New Bookmark" onClick={...} />
  <QuickAddOption icon={DocumentTextIcon} label="New Note" onClick={...} />
</QuickAddMenu>
```

**5. Remove "All Bookmarks" / "All Notes"**

- Remove from default sidebar_order
- Migration: remove from existing users' sidebar_order
- Remove related routes (`/app/bookmarks`, `/app/notes`)
- Redirect old routes to `/app/content` with appropriate filter

### Testing Strategy
- Test content type filter chips toggle correctly
- Test multi-select behavior (at least one required)
- Test filter persistence across navigation
- Test sidebar quick-add opens correct modals (no prepopulated tags)
- Test "All" view quick-add menu
- Test old routes redirect properly

### Dependencies
- Milestone 4b (drag-and-drop)

### Risk Factors
- Chip styling to match existing UI
- Ensuring redirects work for users with bookmarked old routes

---

## Milestone 6: Migration & Cleanup

### Goal
Migrate existing users and clean up deprecated code.

### Success Criteria
- Existing users' sidebar_order migrated to new structure (flattened to root)
- All deprecated code removed
- Documentation updated

### Key Changes

**1. Data migration script**

Convert existing `tab_order` to `sidebar_order` by flattening all sections to root:

```python
def migrate_tab_order(old: dict | None) -> dict:
    """Convert old tab_order to new sidebar_order.

    Flattens all sections to root level. Users can recreate groups as desired.
    """
    if old is None:
        return get_default_sidebar_order()

    items = []
    seen_builtins = set()
    seen_lists = set()

    # Flatten items from each old section, in section_order
    section_order = old.get("section_order", ["shared", "bookmarks", "notes"])
    sections = old.get("sections", {})

    for section_name in section_order:
        section_items = sections.get(section_name, [])
        for item_key in section_items:
            if item_key in ("all", "archived", "trash"):
                if item_key not in seen_builtins:
                    items.append({"type": "builtin", "key": item_key})
                    seen_builtins.add(item_key)
            elif item_key.startswith("list:"):
                list_id = int(item_key.split(":")[1])
                if list_id not in seen_lists:
                    items.append({"type": "list", "id": list_id})
                    seen_lists.add(list_id)
            # Skip "all-bookmarks", "all-notes" - they're removed

    # Ensure all builtins are present
    for builtin in ["all", "archived", "trash"]:
        if builtin not in seen_builtins:
            items.append({"type": "builtin", "key": builtin})

    return {"items": items}
```

**2. Remove deprecated code**

Backend:
- Remove old `TabOrder`, `TabOrderSections` schemas
- Remove `settings_service.py` tab_order functions
- Remove `/settings/tab-order` endpoints

Frontend:
- Remove old types (`TabOrder`, `TabOrderSection`, etc.)
- Remove section-based sidebar logic
- Remove `/app/bookmarks`, `/app/notes` routes

Note: `SettingsLists.tsx`, `SectionTabOrderEditor.tsx`, and `ListManager.tsx` are deleted in Milestone 4.

**3. Update documentation**

- Update CLAUDE.md with new sidebar structure
- Update any API documentation

### Testing Strategy
- Test migration script with various existing configurations
- Verify no references to old code remain
- End-to-end test of full user flow

### Dependencies
- All previous milestones

### Risk Factors
- Data migration bugs losing user customizations
- Missing cleanup of old code paths

---

## Summary

| Milestone | Focus | Dependencies |
|-----------|-------|--------------|
| 1 | Backend schemas, services, endpoints | None |
| 2 | Frontend state & API layer | M1 |
| 3 | Sidebar component rendering | M2 |
| 4a | In-sidebar management UI | M3 |
| 4b | Drag-and-drop reordering | M4a |
| 5 | Content type filters & quick actions | M4b |
| 6 | Migration & cleanup | M5 |

## Decisions Made

| Question | Decision |
|----------|----------|
| Migration strategy | Flatten to root (users recreate groups as needed) |
| Quick-add placement | Two locations: sidebar icons (per type) + hover menu near search in "All" |
| Content type filter UX | Chips with multi-select (future-proofed for 3 types: bookmark, note, todo) |
| Reordering UI | Drag-and-drop only with @dnd-kit (no up/down arrows) |
| Settings page for sidebar | None - all management directly in sidebar (hover actions, inline editing) |
| Group identification | UUIDs (generated client-side) for robust collapsed state and safe renames |
| List routing | Unified `/app/content/lists/:id` for all lists regardless of content type |
| Schema versioning | `version: 1` field for future migrations |
| Orphan list handling | Append to root (ensures no list becomes inaccessible) |
| Empty groups | Allowed (user can delete manually) |
| Concurrent updates | Debounce sidebar updates (~300ms) |
| Mobile touch actions | Tap to reveal actions or persistent menu icon |

---

## Comprehensive Testing Strategy

### Backend Testing (pytest)

**Schema Validation Tests (`test_sidebar_schemas.py`)**
```python
# Valid structures
def test__sidebar_order__valid_minimal(): ...
def test__sidebar_order__valid_with_groups(): ...
def test__sidebar_order__valid_nested_items_in_group(): ...

# Invalid structures
def test__sidebar_order__rejects_invalid_builtin_key(): ...
def test__sidebar_order__rejects_invalid_group_uuid(): ...  # Not UUID format
def test__sidebar_order__rejects_empty_group_name(): ...
def test__sidebar_order__rejects_group_name_too_long(): ...
def test__sidebar_order__rejects_nested_groups(): ...  # Groups cannot contain groups
def test__sidebar_order__rejects_missing_version(): ...
```

**Service Tests (`test_sidebar_service.py`)**
```python
# get_computed_sidebar
def test__get_computed_sidebar__resolves_list_names(): ...
def test__get_computed_sidebar__resolves_list_content_types(): ...
def test__get_computed_sidebar__filters_deleted_list_references(): ...
def test__get_computed_sidebar__appends_orphan_lists_to_root(): ...
def test__get_computed_sidebar__returns_default_for_new_user(): ...
def test__get_computed_sidebar__preserves_group_structure(): ...

# update_sidebar_order
def test__update_sidebar_order__saves_valid_structure(): ...
def test__update_sidebar_order__rejects_nonexistent_list_id(): ...
def test__update_sidebar_order__rejects_other_users_list(): ...
def test__update_sidebar_order__rejects_duplicate_list(): ...
def test__update_sidebar_order__rejects_duplicate_builtin(): ...
def test__update_sidebar_order__allows_duplicate_group_names(): ...  # Groups identified by UUID

# List lifecycle
def test__create_list__adds_to_sidebar_root(): ...
def test__delete_list__removes_from_sidebar(): ...
def test__delete_list__removes_from_group(): ...
```

**API Integration Tests (`test_sidebar_router.py`)**
```python
def test__get_sidebar__returns_computed_structure(): ...
def test__get_sidebar__requires_auth(): ...
def test__get_sidebar__rejects_pat_auth(): ...  # Auth0 only

def test__put_sidebar__updates_structure(): ...
def test__put_sidebar__validates_list_ownership(): ...
def test__put_sidebar__returns_computed_response(): ...
```

**Migration Tests (`test_migration.py`)**
```python
def test__migrate_tab_order__flattens_sections(): ...
def test__migrate_tab_order__removes_all_bookmarks_all_notes(): ...
def test__migrate_tab_order__deduplicates_items(): ...
def test__migrate_tab_order__ensures_all_builtins_present(): ...
def test__migrate_tab_order__handles_null_input(): ...
def test__migrate_tab_order__handles_empty_sections(): ...
```

### Frontend Testing (Vitest + React Testing Library)

**Type/Schema Tests (`sidebar.test.ts`)**
```typescript
// Type guards and validators
test('isValidSidebarOrder validates correct structure', () => {});
test('isValidSidebarOrder rejects invalid group UUID', () => {});
```

**Store Tests (`useSettingsStore.test.ts`)**
```typescript
test('fetchSidebar populates sidebar state', async () => {});
test('updateSidebar sends correct payload', async () => {});
test('updateSidebar handles API errors gracefully', async () => {});
```

**Store Tests (`useSidebarStore.test.ts`)**
```typescript
test('toggleGroupCollapsed adds group ID to collapsed list', () => {});
test('toggleGroupCollapsed removes group ID when already collapsed', () => {});
test('collapsed state persists to localStorage', () => {});
```

**Component Tests**

`SidebarNavItem.test.tsx`:
```typescript
test('renders builtin item with correct icon', () => {});
test('renders bookmark-only list with BookmarkIcon', () => {});
test('renders note-only list with DocumentTextIcon', () => {});
test('renders mixed list with RectangleStackIcon', () => {});
test('shows edit/delete actions on hover for lists', () => {});
test('does not show actions for builtins', () => {});
test('navigates to correct route on click', () => {});
```

`SidebarGroup.test.tsx`:
```typescript
test('renders group with folder icon', () => {});
test('toggles collapse on chevron click', () => {});
test('hides children when collapsed', () => {});
test('inline rename activates on name click', () => {});
test('inline rename saves on Enter', () => {});
test('inline rename saves on blur', () => {});
test('inline rename cancels on Escape', () => {});
test('delete moves contents to root', () => {});
```

`Sidebar.test.tsx`:
```typescript
test('renders items in correct order', () => {});
test('renders groups with their children', () => {});
test('New Group button creates group with UUID', () => {});
test('New List button opens ListModal', () => {});
```

**Drag-and-Drop Tests (`SidebarDragDrop.test.tsx`)**
```typescript
test('drag handle appears on hover', () => {});
test('reorder at root level updates sidebar', () => {});
test('drag into group adds item to group', () => {});
test('drag out of group moves item to root', () => {});
test('keyboard navigation works for reordering', () => {});
test('debounces rapid drag operations', () => {});
```

**Content Filter Tests (`ContentTypeFilterChips.test.tsx`)**
```typescript
test('renders all content type chips', () => {});
test('clicking chip toggles selection', () => {});
test('prevents deselecting last chip', () => {});
test('calls onChange with updated selection', () => {});
```

**Route Tests**
```typescript
test('/app/content/lists/:id renders list view', () => {});
test('/app/bookmarks/lists/:id redirects to /app/content/lists/:id', () => {});
test('/app/notes/lists/:id redirects to /app/content/lists/:id', () => {});
test('/app/bookmarks redirects to /app/content with filter', () => {});
test('/app/notes redirects to /app/content with filter', () => {});
```

### End-to-End Testing Recommendations

For critical user flows, consider E2E tests (Playwright/Cypress):

1. **Sidebar Organization Flow**: Create group → rename → add list → reorder → collapse
2. **Content Filtering Flow**: Navigate to All → filter by type → verify results
3. **Quick-Add Flow**: Use sidebar quick-add → create bookmark → verify in list
4. **Migration Verification**: User with old tab_order sees correct sidebar after migration
