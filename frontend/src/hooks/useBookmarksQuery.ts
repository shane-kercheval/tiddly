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
 * Structure:
 * - ['bookmarks', 'list', params] - for fetching bookmark lists
 * - ['bookmarks', 'active'] - for invalidating active view cache
 * - ['bookmarks', 'archived'] - for invalidating archived view cache
 * - ['bookmarks', 'deleted'] - for invalidating deleted view cache
 * - ['bookmarks', 'list'] - prefix to invalidate all list queries
 */
export const bookmarkKeys = {
  all: ['bookmarks'] as const,
  lists: () => [...bookmarkKeys.all, 'list'] as const,
  list: (params: BookmarkSearchParams) => [...bookmarkKeys.lists(), params] as const,
  active: () => [...bookmarkKeys.all, 'active'] as const,
  archived: () => [...bookmarkKeys.all, 'archived'] as const,
  deleted: () => [...bookmarkKeys.all, 'deleted'] as const,
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
  if (params.list_id !== undefined) {
    queryParams.set('list_id', String(params.list_id))
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
