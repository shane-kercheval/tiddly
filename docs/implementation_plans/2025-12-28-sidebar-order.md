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
  "items": [
    { "type": "builtin", "key": "all" },
    {
      "type": "group",
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
  "items": [
    { "type": "builtin", "key": "all", "name": "All" },
    {
      "type": "group",
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
  "items": [
    { "type": "builtin", "key": "all" },
    {
      "type": "group",
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
from pydantic import BaseModel

BuiltinKey = Literal["all", "archived", "trash"]

class SidebarBuiltinItem(BaseModel):
    type: Literal["builtin"]
    key: BuiltinKey

class SidebarListItem(BaseModel):
    type: Literal["list"]
    id: int

class SidebarGroup(BaseModel):
    type: Literal["group"]
    name: str  # 1-100 chars
    items: list["SidebarListItem | SidebarBuiltinItem"]  # Groups cannot nest

SidebarItem = SidebarBuiltinItem | SidebarListItem | SidebarGroup

class SidebarOrder(BaseModel):
    items: list[SidebarItem]

# Computed versions (returned by GET)
class SidebarBuiltinItemComputed(SidebarBuiltinItem):
    name: str  # "All", "Archived", "Trash"

class SidebarListItemComputed(SidebarListItem):
    name: str
    content_types: list[str]

class SidebarGroupComputed(BaseModel):
    type: Literal["group"]
    name: str
    items: list[SidebarListItemComputed | SidebarBuiltinItemComputed]

SidebarItemComputed = SidebarBuiltinItemComputed | SidebarListItemComputed | SidebarGroupComputed

class SidebarOrderComputed(BaseModel):
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
        "items": [
            {"type": "builtin", "key": "all"},
            {"type": "builtin", "key": "archived"},
            {"type": "builtin", "key": "trash"},
        ]
    }

def get_computed_sidebar(session, user_id: int) -> SidebarOrderComputed:
    """Fetch sidebar_order and resolve list names/content_types."""
    # 1. Get raw sidebar_order from UserSettings
    # 2. Fetch all user's lists
    # 3. Walk the structure, resolving list IDs to names/content_types
    # 4. Filter out orphaned list references
    # 5. Add display names for builtins
    pass

def update_sidebar_order(session, user_id: int, sidebar_order: SidebarOrder) -> None:
    """Validate and save sidebar structure."""
    # 1. Extract all list IDs from structure
    # 2. Verify all list IDs exist and belong to user
    # 3. Verify no duplicate items (same list/builtin twice)
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

- Unit tests for schema validation (valid/invalid structures)
- Unit tests for `get_computed_sidebar` (resolves names, filters orphans)
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
  name: string;
  items: (SidebarListItem | SidebarBuiltinItem)[];
}

type SidebarItem = SidebarBuiltinItem | SidebarListItem | SidebarGroup;

interface SidebarOrder {
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
  name: string;
  items: (SidebarListItemComputed | SidebarBuiltinItemComputed)[];
}

type SidebarItemComputed = SidebarBuiltinItemComputed | SidebarListItemComputed | SidebarGroupComputed;

interface SidebarOrderComputed {
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
  collapsedGroups: string[];  // Group names that are collapsed
  isMobileOpen: boolean;

  toggleGroupCollapsed: (groupName: string) => void;
  // Remove: expandedSections (replaced by collapsedGroups)
}
```

Note: Using `collapsedGroups` (collapsed by default = false) vs `expandedSections` is a UX choice. Groups start expanded, user can collapse them.

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
{sidebar.items.map((item, index) => {
  if (item.type === "builtin") {
    return <SidebarNavItem key={item.key} item={item} />;
  }
  if (item.type === "list") {
    return <SidebarNavItem key={`list-${item.id}`} item={item} />;
  }
  if (item.type === "group") {
    return <SidebarGroup key={`group-${item.name}`} group={item} />;
  }
})}
```

**2. Rename/refactor `SidebarSection.tsx` → `SidebarGroup.tsx`**

- Accepts a `SidebarGroupComputed` prop
- Renders group header with name and collapse toggle
- Renders child items (lists and builtins only, no nested groups)
- Uses `useSidebarStore.collapsedGroups` for collapse state

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

Simplify routing - no more section-based logic:

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
    return `/app/content/lists/${item.id}`;
  }
  // Groups don't have routes - they just contain items
}
```

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

## Milestone 4: In-Sidebar Management & Drag-and-Drop

### Goal
Add drag-and-drop reordering and inline management directly in the sidebar (no separate settings page).

### Success Criteria
- Users can reorder items via drag-and-drop directly in sidebar
- Users can drag items into/out of groups
- Users can create groups (via button → inline text input)
- Users can rename groups (click name → inline edit)
- Users can delete groups (hover icon → confirmation, moves contents to root)
- Users can create lists (via button → opens ListModal)
- Users can edit lists (hover icon → opens ListModal)
- Users can delete lists (hover icon → confirmation)
- Drag handles visible on hover for discoverability
- Changes persist immediately (no save button needed)

### Key Changes

**1. Install @dnd-kit**

```bash
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

**2. Update `Sidebar.tsx` with drag-and-drop**

```typescript
import { DndContext, closestCenter, DragOverlay } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

// Wrap sidebar content in DndContext
// Each item/group is a sortable element
// Groups are also droppable containers
// On drag end, call updateSidebar() to persist
```

**3. Add hover actions to `SidebarNavItem.tsx`**

```typescript
// On hover, show action icons on the right:
// - Lists: edit icon, delete icon
// - Groups: delete icon (rename is inline click)
// - Builtins: no actions (can't edit/delete)

<div className="group flex items-center">
  <DragHandle className="opacity-0 group-hover:opacity-100" />
  <span>{item.name}</span>
  <div className="ml-auto opacity-0 group-hover:opacity-100">
    {item.type === "list" && (
      <>
        <EditIcon onClick={() => openListModal(item.id)} />
        <DeleteIcon onClick={() => confirmDelete(item.id)} />
      </>
    )}
  </div>
</div>
```

**4. Add inline group rename to `SidebarGroup.tsx`**

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

**5. Add "New Group" and "New List" buttons**

Add buttons at bottom of sidebar or in a dedicated section:

```typescript
<div className="mt-auto border-t pt-2">
  <button onClick={handleNewGroup}>+ New Group</button>
  <button onClick={() => setListModalOpen(true)}>+ New List</button>
</div>
```

"New Group" creates inline with default name "New Group" in edit mode.

**6. Delete deprecated components**

- Delete `SettingsLists.tsx`
- Delete `SectionTabOrderEditor.tsx`
- Delete `ListManager.tsx` (functionality moves to sidebar)
- Remove "Lists" from settings navigation

### Testing Strategy
- Test drag-and-drop reordering at root level
- Test dragging items into groups
- Test dragging items out of groups to root
- Test inline group rename (save on blur/enter, cancel on escape)
- Test group delete moves contents to root
- Test list create/edit opens modal
- Test list delete with confirmation
- Test changes persist immediately
- Test keyboard accessibility

### Dependencies
- Milestone 3 (sidebar rendering)

### Risk Factors
- @dnd-kit nested sortable requires careful setup of droppable zones
- Balancing hover actions with drag handles (avoid accidental drags)
- Mobile touch interactions for drag-and-drop

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
- Milestone 4 (settings page)

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
| 4 | In-sidebar management & drag-and-drop | M3 |
| 5 | Content type filters & quick actions | M4 |
| 6 | Migration & cleanup | M5 |

## Decisions Made

| Question | Decision |
|----------|----------|
| Migration strategy | Flatten to root (users recreate groups as needed) |
| Quick-add placement | Two locations: sidebar icons (per type) + hover menu near search in "All" |
| Content type filter UX | Chips with multi-select (future-proofed for 3 types: bookmark, note, todo) |
| Reordering UI | Drag-and-drop only with @dnd-kit (no up/down arrows) |
| Settings page for sidebar | None - all management directly in sidebar (hover actions, inline editing) |
