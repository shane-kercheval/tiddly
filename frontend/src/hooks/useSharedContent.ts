/**
 * Fetches a page of the owner's currently-public items for the "Shared content"
 * settings view — `GET /content/?is_public=true` across the active + archived
 * views (a shared archived item is still public; deleted items are never public).
 *
 * Server-driven (pagination, sort, type + date-range filters all applied by the
 * API) so it stays correct at any scale — unlike a client-side filter, which
 * would only cover the fetched page. Keyed under `contentKeys.lists()` so the
 * share mutations' existing list invalidation (publish/unpublish/rotate)
 * refreshes it for free.
 */
import { useQuery, keepPreviousData, type UseQueryResult } from '@tanstack/react-query'
import { api } from '../services/api'
import { contentKeys } from './useContentQuery'
import type { ContentListResponse, ContentType } from '../types'

export interface SharedContentParams {
  offset: number
  limit: number
  /** Restrict to these content types (server-side). Omit/empty for all. */
  contentTypes?: ContentType[]
  /** ISO timestamps bounding shared_at (server-side date filter). */
  sharedAfter?: string
  sharedBefore?: string
}

export function useSharedContent(params: SharedContentParams): UseQueryResult<ContentListResponse> {
  return useQuery({
    queryKey: [...contentKeys.lists(), 'shared', params],
    queryFn: async () => {
      const sp = new URLSearchParams()
      sp.set('is_public', 'true')
      sp.append('view', 'active')
      sp.append('view', 'archived')
      sp.set('sort_by', 'shared_at')
      sp.set('sort_order', 'desc')
      sp.set('offset', String(params.offset))
      sp.set('limit', String(params.limit))
      params.contentTypes?.forEach(t => sp.append('content_types', t))
      if (params.sharedAfter) sp.set('shared_after', params.sharedAfter)
      if (params.sharedBefore) sp.set('shared_before', params.sharedBefore)
      const response = await api.get<ContentListResponse>(`/content/?${sp.toString()}`)
      return response.data
    },
    // Keep the current page visible while the next loads (smooth pagination).
    placeholderData: keepPreviousData,
  })
}
