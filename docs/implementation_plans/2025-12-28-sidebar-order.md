# Sidebar Reorganization Implementation Plan

## Overview

Replace the hardcoded sidebar sections (Notes, Bookmarks, Shared) with a flexible user-defined structure where:
- Users create **Groups** to organize items (stored inline in JSON, not a separate table)
- Users can order groups and items freely
- Built-in items (All, Archived, Trash) are orderable like any other item
- Lists and builtins can exist at root level or inside groups
- "All Bookmarks" and "All Notes" are removed; content type filtering moves to dropdowns on All/Archived/Trash

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

## Milestone 4: Settings Page - Sidebar Management

### Goal
Rename "Settings → Lists" to "Settings → Sidebar" and add group management.

### Success Criteria
- Settings page renamed to "Sidebar"
- Users can create/rename/delete groups
- Users can reorder items (drag-drop or up/down arrows)
- Users can move lists/builtins into/out of groups
- List management (create/edit/delete) still works

### Key Changes

**1. Rename `SettingsLists.tsx` → `SettingsSidebar.tsx`**

Update route and navigation.

**2. Add group management UI**

- "Create Group" button
- Group inline rename (click to edit)
- Group delete (moves contents to root)

**3. Sidebar order editor**

Replace `SectionTabOrderEditor` with new `SidebarOrderEditor`:

- Visual tree of current sidebar structure
- Drag-and-drop OR up/down arrows for reordering
- Ability to drag items into/out of groups
- Save/Reset buttons

**4. Update settings navigation**

- Rename "Lists" → "Sidebar" in settings nav

### Testing Strategy
- Test group CRUD operations
- Test reordering at root level
- Test moving items into/out of groups
- Test that changes persist after save

### Dependencies
- Milestone 3 (sidebar rendering)

### Risk Factors
- Drag-and-drop complexity (consider starting with up/down arrows)
- Ensuring sidebar updates reflect immediately

---

## Milestone 5: Content Type Filtering & Quick Actions

### Goal
Add content type filter dropdowns to All/Archived/Trash and quick-add buttons.

### Success Criteria
- All/Archived/Trash show dropdown to filter by content type
- Filter state persists appropriately (URL params or localStorage)
- Quick-add button (+) in sidebar allows creating notes/bookmarks
- Removed: "All Bookmarks" and "All Notes" built-in items

### Key Changes

**1. Content type filter dropdown**

Add to content pages (All, Archived, Trash):

```typescript
<ContentTypeFilter
  value={selectedTypes}  // ["bookmark", "note"] or subset
  onChange={setSelectedTypes}
/>
```

Options:
- All (both types)
- Bookmarks only
- Notes only

**2. Update content fetching**

Pass selected content types to `/content` endpoint:

```typescript
// Existing endpoint already supports content_types param
GET /content?content_types=bookmark,note
```

**3. Quick-add button in sidebar**

Add a `+` button that expands to show:
- "New Bookmark"
- "New Note"

Could be:
- A floating action button at bottom of sidebar
- A button in the sidebar header
- An expandable menu

**4. Remove "All Bookmarks" / "All Notes"**

- Remove from default sidebar_order
- Migration: remove from existing users' sidebar_order
- Remove related routes (`/app/bookmarks`, `/app/notes`)
- Update any links pointing to these routes

### Testing Strategy
- Test content type filter updates results
- Test filter persistence
- Test quick-add buttons open correct modals
- Verify old routes redirect or 404 appropriately

### Dependencies
- Milestone 4 (settings page)

### Risk Factors
- Users may have bookmarked `/app/bookmarks` - consider redirects
- Filter UX (dropdown vs toggle buttons vs chips)

---

## Milestone 6: Migration & Cleanup

### Goal
Migrate existing users and clean up deprecated code.

### Success Criteria
- Existing users' sidebar_order migrated to new structure
- All deprecated code removed
- Documentation updated

### Key Changes

**1. Data migration script**

Convert existing `tab_order` to `sidebar_order`:

```python
def migrate_tab_order(old: dict) -> dict:
    """Convert old tab_order to new sidebar_order."""
    items = []

    # Add items from each old section, in section_order
    section_order = old.get("section_order", ["shared", "bookmarks", "notes"])
    sections = old.get("sections", {})

    for section_name in section_order:
        section_items = sections.get(section_name, [])
        for item_key in section_items:
            if item_key in ("all", "archived", "trash"):
                items.append({"type": "builtin", "key": item_key})
            elif item_key.startswith("list:"):
                list_id = int(item_key.split(":")[1])
                items.append({"type": "list", "id": list_id})
            # Skip "all-bookmarks", "all-notes" - they're removed

    return {"items": items}
```

Decision needed: Should we preserve section grouping as groups? Options:
- **Option A**: Flatten everything to root (simpler, users recreate groups)
- **Option B**: Convert sections to groups if they have custom lists (preserves some structure)

**2. Remove deprecated code**

Backend:
- Remove old `TabOrder`, `TabOrderSections` schemas
- Remove `settings_service.py` tab_order functions
- Remove `/settings/tab-order` endpoints

Frontend:
- Remove old types (`TabOrder`, `TabOrderSection`, etc.)
- Remove `SectionTabOrderEditor` component
- Remove section-based sidebar logic
- Remove `/app/bookmarks`, `/app/notes` routes

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
| 4 | Settings page - sidebar management | M3 |
| 5 | Content type filters & quick actions | M4 |
| 6 | Migration & cleanup | M5 |

## Open Questions

1. **Migration strategy**: Flatten existing sections to root, or convert to groups?
2. **Quick-add button placement**: Sidebar header, floating button, or both?
3. **Content type filter UX**: Dropdown, toggle buttons, or chips?
4. **Drag-and-drop**: Implement from start, or begin with up/down arrows?
