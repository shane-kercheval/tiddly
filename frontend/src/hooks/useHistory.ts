/**
 * TanStack Query hooks for content version history.
 *
 * Provides:
 * - useUserHistory: Fetch all user history (for Settings page)
 * - useEntityHistory: Fetch history for a specific entity (for sidebar)
 * - useVersionDiff: Fetch diff between a version and its predecessor
 * - useRestoreToVersion: Restore entity to a previous version
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import type {
  ContentType,
  HistoryActionType,
  HistoryListResponse,
  VersionDiffResponse,
  RestoreResponse,
} from '../types'

/** Parameters for user history query */
export interface UserHistoryParams {
  contentTypes?: ContentType[]
  actions?: HistoryActionType[]
  sources?: string[]
  startDate?: string  // ISO 8601 datetime (UTC)
  endDate?: string    // ISO 8601 datetime (UTC)
  limit?: number
  offset?: number
}

/** Query key factory for history queries */
export const historyKeys = {
  all: ['history'] as const,
  user: (params: UserHistoryParams) => [
    ...historyKeys.all,
    'user',
    {
      ...params,
      // Sort arrays for consistent cache keys; normalize empty arrays to undefined
      // so [] and undefined produce the same key (both mean "no filter")
      contentTypes: params.contentTypes?.length ? params.contentTypes.slice().sort() : undefined,
      actions: params.actions?.length ? params.actions.slice().sort() : undefined,
      sources: params.sources?.length ? params.sources.slice().sort() : undefined,
    },
  ] as const,
  entity: (contentType: ContentType, contentId: string, params: { limit?: number; offset?: number }) =>
    [...historyKeys.all, contentType, contentId, params] as const,
  diff: (contentType: ContentType, contentId: string, version: number) =>
    [...historyKeys.all, contentType, contentId, 'diff', version] as const,
}

/**
 * Fetch all user history (for Settings page).
 *
 * Returns paginated history records across all bookmarks, notes, and prompts,
 * sorted by created_at descending (most recent first).
 *
 * Supports filtering by content types, actions, sources, and date range.
 * Empty arrays are treated as "no filter" (show all).
 */
export function useUserHistory(params: UserHistoryParams) {
  return useQuery<HistoryListResponse>({
    queryKey: historyKeys.user(params),
    queryFn: async () => {
      const queryParams = new URLSearchParams()

      // Use append for array params to create repeated query params
      params.contentTypes?.forEach(t => queryParams.append('content_type', t))
      params.actions?.forEach(a => queryParams.append('action', a))
      params.sources?.forEach(s => queryParams.append('source', s))

      if (params.startDate) queryParams.append('start_date', params.startDate)
      if (params.endDate) queryParams.append('end_date', params.endDate)
      if (params.limit !== undefined) queryParams.append('limit', String(params.limit))
      if (params.offset !== undefined) queryParams.append('offset', String(params.offset))

      const queryString = queryParams.toString()
      const url = queryString ? `/history/?${queryString}` : '/history/'
      const response = await api.get<HistoryListResponse>(url)
      return response.data
    },
  })
}

/**
 * Fetch history for a specific entity (for sidebar).
 *
 * Returns paginated history records for the specified entity,
 * sorted by version descending (most recent first).
 */
export function useEntityHistory(
  contentType: ContentType,
  contentId: string,
  params: { limit?: number; offset?: number } = {}
) {
  return useQuery<HistoryListResponse>({
    queryKey: historyKeys.entity(contentType, contentId, params),
    queryFn: async () => {
      const queryParams: Record<string, number> = {}
      if (params.limit !== undefined) queryParams.limit = params.limit
      if (params.offset !== undefined) queryParams.offset = params.offset

      const response = await api.get<HistoryListResponse>(
        `/history/${contentType}/${contentId}`,
        { params: queryParams }
      )
      return response.data
    },
    enabled: !!contentId,
  })
}

/**
 * Fetch diff between a version and its predecessor.
 *
 * Returns before/after content and metadata in a single response.
 * For version 1 (CREATE), before fields are null.
 * For metadata-only changes, content fields are both null.
 */
export function useVersionDiff(
  contentType: ContentType,
  contentId: string,
  version: number | null
) {
  return useQuery<VersionDiffResponse>({
    queryKey: historyKeys.diff(contentType, contentId, version ?? 0),
    queryFn: async () => {
      const response = await api.get<VersionDiffResponse>(
        `/history/${contentType}/${contentId}/version/${version}/diff`
      )
      return response.data
    },
    enabled: !!contentId && version !== null && version >= 1,
  })
}

/**
 * Restore entity to a previous version.
 *
 * Restores content and metadata from the specified version by creating
 * a new RESTORE history entry.
 */
export function useRestoreToVersion() {
  const queryClient = useQueryClient()

  return useMutation<
    RestoreResponse,
    Error,
    { contentType: ContentType; contentId: string; version: number }
  >({
    mutationFn: async ({ contentType, contentId, version }) => {
      const response = await api.post<RestoreResponse>(
        `/history/${contentType}/${contentId}/restore/${version}`
      )
      return response.data
    },
    onSuccess: (_, { contentType, contentId }) => {
      // Invalidate entity queries (the entity was updated)
      queryClient.invalidateQueries({ queryKey: [contentType + 's'] })
      // Invalidate history queries (new history entry was created)
      // Use partial key matching to invalidate regardless of params (limit, offset)
      queryClient.invalidateQueries({ queryKey: ['history', contentType, contentId] })
      queryClient.invalidateQueries({ queryKey: ['history', 'user'] })
      // Invalidate content queries
      queryClient.invalidateQueries({ queryKey: ['content'] })
    },
  })
}
