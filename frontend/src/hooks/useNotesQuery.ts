/**
 * TanStack Query hook for fetching notes with caching.
 *
 * Replaces fetch logic with TanStack Query to enable:
 * - Automatic caching with 5-minute stale time
 * - Background refetching when data might be stale
 * - Declarative cache invalidation on mutations
 * - Built-in loading/error states
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import { normalizeViewKey } from '../types'
import type { NoteListResponse, NoteSearchParams, ViewOption } from '../types'

/**
 * Query key factory for consistent cache keys.
 *
 * Key Structure (view segment BEFORE params for prefix matching):
 * - ['notes', 'list', 'active', params]  - active view queries
 * - ['notes', 'list', 'active+archived', params] - combined view queries
 * - ['notes', 'list', 'archived', params] - archived view queries
 * - ['notes', 'list', 'deleted', params] - deleted view queries
 * - ['notes', 'list', 'custom', params] - custom list queries (have filter_id)
 *
 * Invalidation Keys (prefix matching):
 * - noteKeys.view('active')  → ['notes', 'list', 'active'] - all active queries
 * - noteKeys.view(['active', 'archived']) → ['notes', 'list', 'active+archived']
 * - noteKeys.customLists()   → ['notes', 'list', 'custom'] - all custom list queries
 * - noteKeys.lists()         → ['notes', 'list'] - ALL list queries
 */
export const noteKeys = {
  all: ['notes'] as const,
  lists: () => [...noteKeys.all, 'list'] as const,

  /** Invalidation key for a specific view type or combination */
  view: (view: ViewOption | ViewOption[]) =>
    [...noteKeys.lists(), normalizeViewKey(view)] as const,

  /** Invalidation key for all custom list queries */
  customLists: () => [...noteKeys.lists(), 'custom'] as const,

  /** Query key for fetching - includes view/custom segment for granular invalidation */
  list: (params: NoteSearchParams) => {
    // Custom lists have filter_id - group them separately
    if (params.filter_id !== undefined) {
      return [...noteKeys.customLists(), params] as const
    }
    // Standard view queries - group by view type
    return [...noteKeys.view(params.view ?? 'active'), params] as const
  },
}

/**
 * Build URL query string from search params.
 */
function buildQueryString(params: NoteSearchParams): string {
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
    const views = Array.isArray(params.view) ? params.view : [params.view]
    views.forEach((v) => queryParams.append('view', v))
  }
  if (params.filter_id !== undefined) {
    queryParams.set('filter_id', String(params.filter_id))
  }

  return queryParams.toString()
}

/**
 * Fetch notes from API.
 */
async function fetchNotes(params: NoteSearchParams): Promise<NoteListResponse> {
  const queryString = buildQueryString(params)
  const url = queryString ? `/notes/?${queryString}` : '/notes/'
  const response = await api.get<NoteListResponse>(url)
  return response.data
}

interface UseNotesQueryOptions {
  /** Whether to enable the query. Defaults to true. */
  enabled?: boolean
}

/**
 * Hook for fetching notes with TanStack Query caching.
 *
 * @param params - Search/filter/pagination parameters
 * @param options - Query options (enabled, etc.)
 *
 * @returns Query result with data, loading states, and error
 *
 * @example
 * ```tsx
 * const { data, isLoading, isFetching, error } = useNotesQuery({
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
export function useNotesQuery(
  params: NoteSearchParams,
  options: UseNotesQueryOptions = {}
) {
  const { enabled = true } = options

  return useQuery({
    queryKey: noteKeys.list(params),
    queryFn: () => fetchNotes(params),
    enabled,
  })
}
