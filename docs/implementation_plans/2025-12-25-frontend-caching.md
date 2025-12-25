# Frontend Caching with TanStack Query

## Overview

Replace the current `useBookmarks` hook's manual state management with TanStack Query to enable automatic caching, background refetching, and declarative cache invalidation.

**Problem:** Switching between views (All Bookmarks, Archived, Trash) triggers fresh API calls even when data hasn't changed. This creates unnecessary network traffic and slower perceived performance.

**Solution:** TanStack Query provides:
- Automatic caching with configurable stale times
- Background refetching when data might be stale
- Declarative cache invalidation on mutations
- Built-in loading/error states

**Documentation:** Read before implementing:
- https://tanstack.com/query/latest/docs/framework/react/overview
- https://tanstack.com/query/latest/docs/framework/react/guides/query-keys
- https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations

---

## Cache Invalidation Strategy

When a bookmark mutation occurs, invalidate caches as follows:

| Mutation | Invalidate |
|----------|-----------|
| Create bookmark | `['bookmarks', 'active']`, all `['bookmarks', 'list', *]` |
| Update bookmark | `['bookmarks', 'active']`, `['bookmarks', 'archived']`, all `['bookmarks', 'list', *]` |
| Delete (soft) | `['bookmarks', 'active']`, `['bookmarks', 'deleted']`, all `['bookmarks', 'list', *]` |
| Delete (permanent) | `['bookmarks', 'deleted']` |
| Archive | `['bookmarks', 'active']`, `['bookmarks', 'archived']`, all `['bookmarks', 'list', *]` |
| Unarchive | `['bookmarks', 'active']`, `['bookmarks', 'archived']`, all `['bookmarks', 'list', *]` |
| Restore | `['bookmarks', 'active']`, `['bookmarks', 'deleted']`, all `['bookmarks', 'list', *]` |

**Note:** Custom lists are invalidated aggressively (all lists on any mutation) because determining which lists are affected by a bookmark's tags would add significant complexity. This is a reasonable tradeoff - lists will refetch in the background when accessed.

---

## Milestone 1: Install and Configure TanStack Query

### Goal
Set up TanStack Query infrastructure without changing existing functionality.

### Success Criteria
- `@tanstack/react-query` installed
- `QueryClientProvider` wraps the app
- React Query DevTools available in development
- Existing functionality unchanged

### Key Changes

1. **Install packages:**
   ```bash
   npm install @tanstack/react-query
   npm install -D @tanstack/react-query-devtools
   ```

2. **Create `src/lib/queryClient.ts`** with default options:
   - `staleTime`: 5 minutes (data considered fresh, won't refetch)
   - `gcTime`: 10 minutes (keep unused data in cache)
   - `retry`: 1 (single retry on failure)
   - `refetchOnWindowFocus`: true (see note below)

   **Multi-tab/window sync:** `refetchOnWindowFocus` automatically refreshes stale data when switching between browser tabs, browser windows, or returning from other apps. This provides "good enough" sync across multiple tabs/windows without WebSockets.

3. **Update `src/main.tsx`** - Wrap app with `QueryClientProvider`

4. **Add DevTools** - Include `ReactQueryDevtools` in development only

### Testing Strategy
- Verify app renders without errors
- Verify DevTools appear in development
- Run existing test suite to ensure nothing broke

### Dependencies
None

### Risk Factors
Low risk - additive change only

---

## Milestone 2: Create Bookmark Query Hook

### Goal
Create TanStack Query hook for fetching bookmarks, replacing the fetch logic in `useBookmarks`.

### Success Criteria
- `useBookmarksQuery` hook fetches and caches bookmark lists
- Query keys encode view, search, tags, sort, pagination
- Loading and error states work correctly
- Switching views uses cached data when available

### Key Changes

1. **Create `src/hooks/useBookmarksQuery.ts`** with:
   - Query key factory for consistent cache keys
   - Hook that accepts `BookmarkSearchParams` and returns query result
   - Proper handling of the `isFetching` state (for background updates vs initial load)

2. **Update `Bookmarks.tsx`** - Use new query hook instead of `useBookmarks().fetchBookmarks`

3. **Keep mutation functions in `useBookmarks` temporarily** - Will migrate in Milestone 3

### Testing Strategy
- Test that switching views uses cached data (verify via DevTools or mock)
- Test loading states during initial fetch vs background refetch
- Test error handling when API fails
- Test that query keys properly differentiate between views/params

### Dependencies
Milestone 1

### Risk Factors
- The `clearAndSetLoading` pattern (show spinner immediately when switching views) may need adjustment - TanStack Query shows stale data while refetching by default

---

## Milestone 3: Create Bookmark Mutation Hooks

### Goal
Create TanStack Query mutation hooks for all bookmark operations with proper cache invalidation.

### Success Criteria
- All mutations (create, update, delete, archive, unarchive, restore) use TanStack mutations
- Cache is invalidated correctly after each mutation (per strategy table above)
- Tag store is refreshed after mutations that affect tags
- Undo functionality continues to work

### Key Changes

1. **Create `src/hooks/useBookmarkMutations.ts`** with hooks for each mutation type

2. **Implement cache invalidation** following the strategy table above

3. **Integrate with tag store** - Call `fetchTags()` in `onSuccess` for mutations that might add/remove tags

4. **Update `Bookmarks.tsx`** - Replace mutation calls with new hooks

5. **Preserve undo functionality** - The toast undo buttons call restore/unarchive/etc, which will use the new mutation hooks

### Testing Strategy
- Test each mutation invalidates correct query keys
- Test that after mutation, affected views show updated data
- Test undo button in toasts still works
- Test error handling for failed mutations
- Test tag suggestions update after adding bookmark with new tag

### Dependencies
Milestone 2

### Risk Factors
- Undo toast callbacks need access to mutation functions - ensure hooks are called at component level, not in callbacks

---

## Milestone 4: Cleanup and Polish

### Goal
Remove old code, handle edge cases, ensure everything works smoothly.

### Success Criteria
- `useBookmarks.ts` removed or reduced to just `fetchMetadata` and `trackBookmarkUsage`
- No dead code remains
- All tests pass
- DevTools show expected caching behavior

### Key Changes

1. **Slim down or remove `useBookmarks.ts`** - Keep only non-cacheable utilities if needed

2. **Update/remove tests** - Replace `useBookmarks.test.ts` with tests for new hooks

3. **Clean up imports** - Remove unused imports from modified files

4. **Verify edge cases:**
   - Single bookmark fetch for edit modal (keep as simple fetch, no caching needed)
   - `trackBookmarkUsage` fire-and-forget pattern still works
   - `fetchMetadata` in bookmark form still works

### Testing Strategy
- Run full test suite
- Manual testing of all bookmark operations
- Verify cache behavior in DevTools

### Dependencies
Milestone 3

### Risk Factors
- Make sure no component is still importing from deleted/modified hooks

---

## Design Decisions

1. **Stale time: 5 minutes** - With proper cache invalidation on mutations, longer stale times are safe. Only edge case is multi-device scenarios where invalidation doesn't cross devices.

2. **Window focus refetch: enabled** - Provides automatic sync when switching between tabs, windows, or apps. Solves the multi-tab consistency problem without WebSockets.

3. **Edit modal fetch: not cached** - `fetchBookmark(id)` for the edit modal is not cached. Cache miss rate would be high (rarely edit same bookmark twice), and we always want fresh data when editing.
