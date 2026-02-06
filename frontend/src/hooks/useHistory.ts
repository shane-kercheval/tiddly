/**
 * TanStack Query hooks for content version history.
 *
 * Provides:
 * - useUserHistory: Fetch all user history (for Settings page)
 * - useEntityHistory: Fetch history for a specific entity (for sidebar)
 * - useContentAtVersion: Fetch content at a specific version (for diff view)
 * - useRevertToVersion: Revert entity to a previous version
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import type {
  HistoryEntityType,
  HistoryListResponse,
  ContentAtVersionResponse,
  RevertResponse,
} from '../types'

/** Query key factory for history queries */
export const historyKeys = {
  all: ['history'] as const,
  user: (params: { entityType?: HistoryEntityType; limit?: number; offset?: number }) =>
    [...historyKeys.all, 'user', params] as const,
  entity: (entityType: HistoryEntityType, entityId: string, params: { limit?: number; offset?: number }) =>
    [...historyKeys.all, entityType, entityId, params] as const,
  version: (entityType: HistoryEntityType, entityId: string, version: number) =>
    [...historyKeys.all, entityType, entityId, 'version', version] as const,
}

/**
 * Fetch all user history (for Settings page).
 *
 * Returns paginated history records across all bookmarks, notes, and prompts,
 * sorted by created_at descending (most recent first).
 */
export function useUserHistory(params: {
  entityType?: HistoryEntityType
  limit?: number
  offset?: number
}) {
  return useQuery<HistoryListResponse>({
    queryKey: historyKeys.user(params),
    queryFn: async () => {
      const queryParams: Record<string, string | number> = {}
      if (params.entityType) queryParams.entity_type = params.entityType
      if (params.limit !== undefined) queryParams.limit = params.limit
      if (params.offset !== undefined) queryParams.offset = params.offset

      const response = await api.get<HistoryListResponse>('/history', { params: queryParams })
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
  entityType: HistoryEntityType,
  entityId: string,
  params: { limit?: number; offset?: number } = {}
) {
  return useQuery<HistoryListResponse>({
    queryKey: historyKeys.entity(entityType, entityId, params),
    queryFn: async () => {
      const queryParams: Record<string, number> = {}
      if (params.limit !== undefined) queryParams.limit = params.limit
      if (params.offset !== undefined) queryParams.offset = params.offset

      const response = await api.get<HistoryListResponse>(
        `/history/${entityType}/${entityId}`,
        { params: queryParams }
      )
      return response.data
    },
    enabled: !!entityId,
  })
}

/**
 * Fetch content at a specific version (for diff view).
 *
 * Reconstructs and returns the content at the specified version.
 * Returns null content for DELETE actions (this is valid).
 */
export function useContentAtVersion(
  entityType: HistoryEntityType,
  entityId: string,
  version: number | null
) {
  return useQuery<ContentAtVersionResponse>({
    queryKey: historyKeys.version(entityType, entityId, version ?? 0),
    queryFn: async () => {
      const response = await api.get<ContentAtVersionResponse>(
        `/history/${entityType}/${entityId}/version/${version}`
      )
      return response.data
    },
    enabled: !!entityId && version !== null && version >= 1,
  })
}

/**
 * Revert entity to a previous version.
 *
 * Restores content and metadata from the specified version by creating
 * a new UPDATE history entry.
 */
export function useRevertToVersion() {
  const queryClient = useQueryClient()

  return useMutation<
    RevertResponse,
    Error,
    { entityType: HistoryEntityType; entityId: string; version: number }
  >({
    mutationFn: async ({ entityType, entityId, version }) => {
      const response = await api.post<RevertResponse>(
        `/history/${entityType}/${entityId}/revert/${version}`
      )
      return response.data
    },
    onSuccess: (_, { entityType, entityId }) => {
      // Invalidate entity queries (the entity was updated)
      queryClient.invalidateQueries({ queryKey: [entityType + 's'] })
      // Invalidate history queries (new history entry was created)
      queryClient.invalidateQueries({ queryKey: historyKeys.entity(entityType, entityId, {}) })
      queryClient.invalidateQueries({ queryKey: historyKeys.user({}) })
      // Invalidate content queries
      queryClient.invalidateQueries({ queryKey: ['content'] })
    },
  })
}
