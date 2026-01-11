/**
 * TanStack Query hook for fetching prompts with caching.
 *
 * Replaces fetch logic with TanStack Query to enable:
 * - Automatic caching with 5-minute stale time
 * - Background refetching when data might be stale
 * - Declarative cache invalidation on mutations
 * - Built-in loading/error states
 */
import { useQuery } from '@tanstack/react-query'
import { api } from '../services/api'
import type { PromptListResponse, PromptSearchParams } from '../types'

/**
 * Query key factory for consistent cache keys.
 *
 * Key Structure (view segment BEFORE params for prefix matching):
 * - ['prompts', 'list', 'active', params]  - active view queries
 * - ['prompts', 'list', 'archived', params] - archived view queries
 * - ['prompts', 'list', 'deleted', params] - deleted view queries
 * - ['prompts', 'list', 'custom', params] - custom list queries (have filter_id)
 *
 * Invalidation Keys (prefix matching):
 * - promptKeys.view('active')  → ['prompts', 'list', 'active'] - all active queries
 * - promptKeys.view('archived') → ['prompts', 'list', 'archived'] - all archived queries
 * - promptKeys.view('deleted') → ['prompts', 'list', 'deleted'] - all deleted queries
 * - promptKeys.customLists()   → ['prompts', 'list', 'custom'] - all custom list queries
 * - promptKeys.lists()         → ['prompts', 'list'] - ALL list queries
 */
export const promptKeys = {
  all: ['prompts'] as const,
  lists: () => [...promptKeys.all, 'list'] as const,

  /** Invalidation key for a specific view type (active/archived/deleted) */
  view: (view: 'active' | 'archived' | 'deleted') =>
    [...promptKeys.lists(), view] as const,

  /** Invalidation key for all custom list queries */
  customLists: () => [...promptKeys.lists(), 'custom'] as const,

  /** Query key for fetching - includes view/custom segment for granular invalidation */
  list: (params: PromptSearchParams) => {
    // Custom lists have filter_id - group them separately
    if (params.filter_id !== undefined) {
      return [...promptKeys.customLists(), params] as const
    }
    // Standard view queries - group by view type
    return [...promptKeys.view(params.view ?? 'active'), params] as const
  },
}

/**
 * Build URL query string from search params.
 */
function buildQueryString(params: PromptSearchParams): string {
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
 * Fetch prompts from API.
 */
async function fetchPrompts(params: PromptSearchParams): Promise<PromptListResponse> {
  const queryString = buildQueryString(params)
  const url = queryString ? `/prompts/?${queryString}` : '/prompts/'
  const response = await api.get<PromptListResponse>(url)
  return response.data
}

interface UsePromptsQueryOptions {
  /** Whether to enable the query. Defaults to true. */
  enabled?: boolean
}

/**
 * Hook for fetching prompts with TanStack Query caching.
 *
 * @param params - Search/filter/pagination parameters
 * @param options - Query options (enabled, etc.)
 *
 * @returns Query result with data, loading states, and error
 *
 * @example
 * ```tsx
 * const { data, isLoading, isFetching, error } = usePromptsQuery({
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
export function usePromptsQuery(
  params: PromptSearchParams,
  options: UsePromptsQueryOptions = {}
) {
  const { enabled = true } = options

  return useQuery({
    queryKey: promptKeys.list(params),
    queryFn: () => fetchPrompts(params),
    enabled,
  })
}
