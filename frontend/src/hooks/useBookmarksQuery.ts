/**
 * TanStack Query hook for fetching bookmarks with caching.
 *
 * Replaces the fetch logic from useBookmarks with TanStack Query to enable:
 * - Automatic caching with 5-minute stale time
 * - Background refetching when data might be stale
 * - Declarative cache invalidation on mutations
 * - Built-in loading/error states
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import type { BookmarkListResponse, BookmarkSearchParams } from '../types'

/**
 * Query key factory for consistent cache keys.
 *
 * Key Structure (view segment BEFORE params for prefix matching):
 * - ['bookmarks', 'list', 'active', params]  - active view queries
 * - ['bookmarks', 'list', 'archived', params] - archived view queries
 * - ['bookmarks', 'list', 'deleted', params] - deleted view queries
 * - ['bookmarks', 'list', 'custom', params] - custom list queries (have filter_id)
 *
 * Invalidation Keys (prefix matching):
 * - bookmarkKeys.view('active')  → ['bookmarks', 'list', 'active'] - all active queries
 * - bookmarkKeys.view('archived') → ['bookmarks', 'list', 'archived'] - all archived queries
 * - bookmarkKeys.view('deleted') → ['bookmarks', 'list', 'deleted'] - all deleted queries
 * - bookmarkKeys.customLists()   → ['bookmarks', 'list', 'custom'] - all custom list queries
 * - bookmarkKeys.lists()         → ['bookmarks', 'list'] - ALL list queries
 */
export const bookmarkKeys = {
  all: ['bookmarks'] as const,
  lists: () => [...bookmarkKeys.all, 'list'] as const,

  /** Invalidation key for a specific view type (active/archived/deleted) */
  view: (view: 'active' | 'archived' | 'deleted') =>
    [...bookmarkKeys.lists(), view] as const,

  /** Invalidation key for all custom list queries */
  customLists: () => [...bookmarkKeys.lists(), 'custom'] as const,

  /** Query key for fetching - includes view/custom segment for granular invalidation */
  list: (params: BookmarkSearchParams) => {
    // Custom lists have filter_id - group them separately
    if (params.filter_id !== undefined) {
      return [...bookmarkKeys.customLists(), params] as const
    }
    // Standard view queries - group by view type
    return [...bookmarkKeys.view(params.view ?? 'active'), params] as const
  },
}

/**
 * Build URL query string from search params.
 */
function buildQueryString(params: BookmarkSearchParams): string {
  const queryParams = new URLSearchParams()

  if (params.q) {
    queryParams.set('q', params.q)
  }
  if (params.tags && params.tags.length > 0) {
    params.tags.forEach((tag) => queryParams.append('tags', tag))
  }
  if (params.tag_match) {
    queryParams.set('tag_match', params.tag_match)
  }
  if (params.sort_by) {
    queryParams.set('sort_by', params.sort_by)
  }
  if (params.sort_order) {
    queryParams.set('sort_order', params.sort_order)
  }
  if (params.offset !== undefined) {
    queryParams.set('offset', String(params.offset))
  }
  if (params.limit !== undefined) {
    queryParams.set('limit', String(params.limit))
  }
  if (params.view) {
    queryParams.set('view', params.view)
  }
  if (params.filter_id !== undefined) {
    queryParams.set('filter_id', String(params.filter_id))
  }

  return queryParams.toString()
}

/**
 * Fetch bookmarks from API.
 */
async function fetchBookmarks(params: BookmarkSearchParams): Promise<BookmarkListResponse> {
  const queryString = buildQueryString(params)
  const url = queryString ? `/bookmarks/?${queryString}` : '/bookmarks/'
  const response = await api.get<BookmarkListResponse>(url)
  return response.data
}

interface UseBookmarksQueryOptions {
  /** Whether to enable the query. Defaults to true. */
  enabled?: boolean
}

/**
 * Hook for fetching bookmarks with TanStack Query caching.
 *
 * @param params - Search/filter/pagination parameters
 * @param options - Query options (enabled, etc.)
 *
 * @returns Query result with data, loading states, and error
 *
 * @example
 * ```tsx
 * const { data, isLoading, isFetching, error } = useBookmarksQuery({
 *   view: 'active',
 *   q: debouncedSearchQuery,
 *   tags: selectedTags,
 *   sort_by: 'created_at',
 *   sort_order: 'desc',
 *   offset: 0,
 *   limit: 20,
 * })
 * ```
 */
export function useBookmarksQuery(
  params: BookmarkSearchParams,
  options: UseBookmarksQueryOptions = {}
) {
  const { enabled = true } = options

  return useQuery({
    queryKey: bookmarkKeys.list(params),
    queryFn: () => fetchBookmarks(params),
    enabled,
  })
}
