# Multi-Value `view` Parameter + Archive Relevance Penalty

**Goal:** Change the `view` query parameter from a single enum to a multi-value list, so clients can request combinations like `?view=active&view=archived`. When both active and archived items are returned together, archived items receive a relevance penalty so active content ranks higher in search results.

**Context:** The current `view` parameter is a single `Literal["active", "archived", "deleted"]`. The search dialog (CommandPalette, activated by `/`) hardcodes `view=active` and cannot search archived content. The multi-value approach follows the same pattern already used by `tags` and `content_types` in this API.

---

## Milestone 1: Backend — Multi-Value `view` + Archive Relevance Penalty

### Goal & Outcome

Change `view` from a single value to a list across all search/list endpoints. Apply an archive relevance penalty when the view includes both `active` and `archived`.

After this milestone:
- `GET /content/?view=active&view=archived` returns both active and archived items, excluding soft-deleted
- `GET /content/?view=active` still works as before (single value = same as current behavior)
- All entity endpoints (`/bookmarks/`, `/notes/`, `/prompts/`) support multi-value `view` the same way
- When the view includes both `active` and `archived` and `sort_by=relevance`, archived items receive a 0.5x relevance penalty so active content ranks higher
- The penalty only applies when both `active` and `archived` are in the view set
- When sorting by anything other than relevance (e.g. `created_at`, `title`), no penalty — items sort normally
- Single-value requests behave identically to current behavior (no breaking change for existing clients)

### Implementation Outline

**1. Define a shared type alias**

The view literal is currently duplicated across ~10 locations. Define it once:

```python
# e.g. in schemas/content.py or a shared types module
ViewOption = Literal["active", "archived", "deleted"]
```

Individual values stay as the same three options. The multi-value behavior comes from accepting a `list[ViewOption]` in routers and converting to a `set` internally.

**2. Router parameter change — all list endpoints**

Change from single value to list, following the same pattern as `tags` and `content_types`. The `view` parameter in the routers changes to:

```python
view: list[ViewOption] = Query(
    default=["active"],
    description="Views to include. Pass multiple for combined results, e.g. view=active&view=archived",
),
```

Files to update:
- `backend/src/api/routers/content.py` (line ~46)
- `backend/src/api/routers/bookmarks.py` (line ~183)
- `backend/src/api/routers/notes.py` (line ~115)
- `backend/src/api/routers/prompts.py` (lines ~294, ~602)

The router passes `view` as a `set` (or the service converts it) to the service layer.

**3. Service layer — accept `set[ViewOption]` (or `frozenset`)**

Update service function signatures to accept a set:

- `content_service.py:search_all_content()` (line ~207)
- `content_service.py:_build_entity_subquery()` (line ~418)
- `content_service.py:_apply_entity_filters()` (line ~540)
- `base_entity_service.py:_apply_view_filter()` (line ~690)

**Note on `prompt_service.list_for_export()`** (line ~454): This method calls `_apply_view_filter()` and currently accepts a single view value. Since `list_for_export` has no use case for multi-value view (it's for SKILL.md export), keep its public signature as a single `ViewOption` and wrap it in a set (`{view}`) before passing to `_apply_view_filter()`.

**4. View filter logic — `content_service.py:_apply_entity_filters()` (line ~576)**

Replace the if/elif chain with set-based logic. The filter builds SQL conditions from the combination of values in the set:

```python
# Build view filter from set of view options
view_conditions = []
if "active" in view:
    view_conditions.append(and_(model.deleted_at.is_(None), ~model.is_archived))
if "archived" in view:
    view_conditions.append(and_(model.deleted_at.is_(None), model.is_archived))
if "deleted" in view:
    view_conditions.append(model.deleted_at.is_not(None))

if view_conditions:
    filters.append(or_(*view_conditions))
```

Note: `{"active", "archived"}` simplifies to `WHERE deleted_at IS NULL` (since `is_archived OR NOT is_archived` is always true). The optimizer should handle this, but you could also detect this case explicitly and skip the archive condition if preferred. Either approach is fine.

Same pattern for `base_entity_service.py:_apply_view_filter()`.

**5. Archive relevance penalty — `content_service.py:_build_entity_subquery()` (line ~449)**

After `rank_col` is built by `_build_search_rank()`, apply the penalty when the view contains both `active` and `archived`:

```python
rank_col = _build_search_rank(...)

# Penalize archived items when mixed with active so active content ranks higher
if {"active", "archived"} <= view:  # both present
    archive_weight = case(
        (model.is_archived, 0.5),
        else_=1.0,
    )
    rank_col = (rank_col * archive_weight).label("search_rank")
```

**Important:** Use `model.is_archived` (the hybrid property), NOT `model.archived_at.is_not(None)`. The `is_archived` hybrid property is time-aware — it checks `archived_at IS NOT NULL AND archived_at <= now()` — so items with future-scheduled archiving (auto-archive) are correctly treated as active and receive no penalty. This is consistent with how the view filters use `is_archived`.

The penalty multiplier (0.5) means an archived item needs roughly 2x the raw relevance score to rank alongside an equivalent active item. The penalty only affects `search_rank`, which is only used when `sort_by="relevance"`.

**6. Validation**

Consider adding validation that the view list is non-empty and contains only valid values. FastAPI's `list[ViewOption]` handles the literal validation automatically, but an empty list should probably 422. Add a check in the router or service.

### Testing Strategy

**Service-level tests** (`tests/services/test_content_service.py`):

Follow existing patterns (see `test__search_all_content__view_active_excludes_deleted` etc.):

- `test__search_all_content__view_active_archived_returns_both` — create active, archived, and deleted items; pass `view={"active", "archived"}`; assert both active and archived returned, deleted excluded
- `test__search_all_content__view_active_archived_excludes_deleted` — verify soft-deleted items are excluded when view is `{"active", "archived"}`
- `test__search_all_content__view_active_archived_relevance_penalty` — create an active and archived item with the same title/content, search with a query and `view={"active", "archived"}`, verify the active item ranks higher
- `test__search_all_content__view_active_archived_relevance_penalty_ignores_future_scheduled` — create an active item, a past-archived item, and a future-scheduled archive item (all with the same title/content); search with `view={"active", "archived"}`; verify the future-scheduled item ranks equally with the active item (no penalty) while the past-archived item ranks lower
- `test__search_all_content__view_active_archived_no_penalty_on_non_relevance_sort` — same setup but with `sort_by="created_at"`, verify order follows `created_at` not relevance penalty
- `test__search_all_content__single_view_backward_compatible` — verify `view={"active"}` behaves identically to current `view="active"` behavior
- `test__search_all_content__view_archived_deleted` — pass `view={"archived", "deleted"}`; assert archived and deleted items returned, active excluded
- `test__search_all_content__view_active_archived_with_prompts` — verify prompts included correctly in combined view
- `test__search_all_content__future_scheduled_archive_appears_in_active_view` — create a future-scheduled archive item; verify it appears in `view={"active"}` and `view={"active", "archived"}` but NOT in `view={"archived"}`

**API-level tests** (`tests/api/test_content.py`):

- `test__list_all_content__multi_view_active_archived` — `GET /content/?view=active&view=archived`, assert both active and archived returned, deleted excluded
- `test__list_all_content__multi_view_relevance_ranking` — search with query, verify active item ranks above archived item with same content
- `test__list_all_content__single_view_still_works` — `GET /content/?view=active` works as before
- `test__list_all_content__empty_view_returns_422` — `GET /content/?view=` returns validation error (if we add this validation)

**Base entity service tests** (if existing test file covers `_apply_view_filter`):

- `test__search__multi_view_active_archived` — test via a single entity service (e.g. `bookmark_service.search`) to verify the base service filter works with a set

---

## Milestone 2: Frontend — Search Dialog Uses Multi-Value View

### Goal & Outcome

Update the CommandPalette search to use multi-value view with a chip UI for toggling Active/Archived. Archived items should be visually distinguishable in search results.

**Scope:** The multi-value view UI is intentionally CommandPalette-only. The main list pages (`/bookmarks`, `/notes`, `/prompts`, `/all`) use sidebar navigation to switch between Active/Archived/Deleted views and don't need multi-select. The backend supports multi-value on all endpoints for API consumers, but the frontend only surfaces it in the search dialog.

After this milestone:
- The `/` search dialog defaults to searching active content, with a chip to opt in to including archived
- View state filter chips (Active, Archived) appear in the search UI, following the same `FilterChip` pattern as the content type chips
- At least one view chip must remain selected (same guard as content type chips)
- Archived items in search results show a visual indicator
- TypeScript types updated to support `view` as a string array across all query hooks
- Cache invalidation simplified to `*.lists()` level across all mutation hooks

### Implementation Outline

**1. Update TypeScript types — `frontend/src/types.ts`**

Update the `view` field in all search param interfaces to accept an array:

```typescript
view?: ViewOption | ViewOption[]  // where ViewOption = 'active' | 'archived' | 'deleted'
```

Or simply `view?: string[]` if the union type gets unwieldy. These are at lines ~151 (NoteSearchParams), ~188 (BookmarkSearchParams), ~242 (ContentSearchParams), ~475 (PromptSearchParams).

**2. Update all query hooks — `useContentQuery`, `useBookmarksQuery`, `useNotesQuery`, `usePromptsQuery`**

All four hooks need the same two changes:

**a) `buildQueryString()`** — change from setting a single value to appending multiple, same pattern as `tags` and `content_types`:

```typescript
// Before:
if (params.view) {
    queryParams.set('view', params.view)
}

// After:
const views = Array.isArray(params.view) ? params.view : params.view ? [params.view] : []
views.forEach((v) => queryParams.append('view', v))
```

**b) Query key factory `*.view()`** — update to accept an array, sort and join for a stable key segment:

```typescript
// Before:
view: (view: 'active' | 'archived' | 'deleted') =>
    [...contentKeys.lists(), view] as const,

// After:
view: (view: ViewOption | ViewOption[]) => {
    const key = Array.isArray(view) ? [...view].sort().join('+') : view
    return [...contentKeys.lists(), key] as const
},
```

This produces stable keys like `['content', 'list', 'active+archived', {params}]`. The `*.list()` function that builds the full query key also needs to normalize array view values when calling `*.view()`.

Files:
- `frontend/src/hooks/useContentQuery.ts`
- `frontend/src/hooks/useBookmarksQuery.ts`
- `frontend/src/hooks/useNotesQuery.ts`
- `frontend/src/hooks/usePromptsQuery.ts`

**3. Simplify cache invalidation — all mutation hooks**

Change all mutation hooks from per-view invalidation to `*.lists()` level. This is both a simplification and a correctness fix — multi-value view caches (e.g. `active+archived`) wouldn't be hit by per-view invalidation (`view('active')`), leading to stale data.

```typescript
// Before (per-view, fragile — archive must invalidate two views, still misses combined caches):
queryClient.invalidateQueries({ queryKey: bookmarkKeys.view('active') })
queryClient.invalidateQueries({ queryKey: bookmarkKeys.view('archived') })
queryClient.invalidateQueries({ queryKey: contentKeys.view('active') })
queryClient.invalidateQueries({ queryKey: contentKeys.view('archived') })

// After (all lists — simpler, always correct):
queryClient.invalidateQueries({ queryKey: bookmarkKeys.lists() })
queryClient.invalidateQueries({ queryKey: contentKeys.lists() })
```

`bookmarkKeys.lists()` returns `['bookmarks', 'list']` which is a prefix of every list key — active, archived, deleted, active+archived, custom. One call covers all of them.

The per-view invalidation was already fragile — archive/unarchive had to invalidate both active and archived views, delete had to invalidate active+deleted, etc. Multi-value view makes this worse. Switching to `*.lists()` eliminates the entire category of "forgot to invalidate a view combination" bugs.

The cost is slightly broader invalidation (e.g., archiving also invalidates the deleted view's cache), but these are cheap refetches and the simplicity is well worth it.

Files:
- `frontend/src/hooks/useBookmarkMutations.ts`
- `frontend/src/hooks/useNoteMutations.ts`
- `frontend/src/hooks/usePromptMutations.ts`

**4. View state filter chips in CommandPalette**

Add `ViewFilterChips` to the CommandPalette search UI, alongside the existing `ContentTypeFilterChips`. Reuse the existing `FilterChip` primitive (`frontend/src/components/ui/FilterChip.tsx`), following the same pattern as `ContentTypeFilterChips` (`frontend/src/components/ui/ContentTypeFilterChips.tsx`):

- Two chips: "Active" and "Archived" (no "Deleted" — that's a separate trash view, not relevant to search)
- Default: both selected
- At least one must remain selected — use the same `isOnlySelected` → `disabled` guard as `ContentTypeFilterChips` (line ~60-61)
- Toggling a chip updates the `view` array in search params and resets pagination offset to 0

Place the view chips on the same row as the content type chips, separated visually (e.g. `Show:` label for content types, `Include:` or similar for view state, or combine them on one line).

```tsx
// In CommandPalette search controls section, alongside ContentTypeFilterChips:
<ViewFilterChips
  selectedViews={selectedViews}
  onChange={handleViewToggle}
/>
```

State management — local to CommandPalette (same as other search state):

```tsx
const [selectedViews, setSelectedViews] = useState<('active' | 'archived')[]>(['active'])

const handleViewToggle = useCallback((view: 'active' | 'archived') => {
  setSelectedViews(prev => {
    if (prev.includes(view) && prev.length === 1) return prev  // prevent empty
    return prev.includes(view) ? prev.filter(v => v !== view) : [...prev, view]
  })
  setOffset(0)
}, [])
```

Then pass into search params:

```tsx
const currentParams: ContentSearchParams = useMemo(() => ({
  ...
  view: selectedViews,
}), [..., selectedViews])
```

**5. Archived item indicator in search results**

The cards in CommandPalette currently receive `view="active"` as a prop (line ~662). When the result set contains both active and archived items, the card needs to check the item's own `archived_at` field rather than relying on the `view` prop. Review how `BookmarkCard`, `NoteCard`, and `PromptCard` currently handle archive-aware styling and adjust so archived items show an "Archived" badge or similar indicator in mixed results.

### Testing Strategy

**Frontend tests:**

- Verify CommandPalette defaults to `view: ['active']` in search params
- Verify `buildQueryString` produces `view=active&view=archived` for array values and `view=active` for single values (test across all four query hooks)
- Verify query key factories produce stable sorted keys (e.g. `['active', 'archived']` and `['archived', 'active']` produce the same key segment `'active+archived'`)
- Verify toggling view chips updates search params correctly
- Verify the last remaining view chip is disabled (can't deselect)
- Verify archived items render with appropriate visual indicator when returned alongside active items
- Update existing mutation hook tests that assert per-view invalidation to assert `*.lists()` invalidation instead
