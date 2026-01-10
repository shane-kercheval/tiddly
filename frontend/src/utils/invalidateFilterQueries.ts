/**
 * Utility for invalidating TanStack Query cache for a specific filter.
 *
 * When a filter's criteria are updated, we need to invalidate cached queries
 * for that filter so the UI refetches with the new filter criteria.
 */
import type { QueryClient } from '@tanstack/react-query'
import { bookmarkKeys } from '../hooks/useBookmarksQuery'
import { noteKeys } from '../hooks/useNotesQuery'
import { promptKeys } from '../hooks/usePromptsQuery'
import { contentKeys } from '../hooks/useContentQuery'

/**
 * Invalidate all cached queries for a specific filter ID.
 *
 * Query key structure for filters:
 * - Bookmarks: ['bookmarks', 'list', 'custom', { filter_id: N, ... }]
 * - Notes: ['notes', 'list', 'custom', { filter_id: N, ... }]
 * - Prompts: ['prompts', 'list', 'custom', { filter_id: N, ... }]
 * - Content: ['content', 'list', 'active', { filter_id: N, ... }]
 *
 * The params object is at index 3 in the query key array.
 */
export async function invalidateFilterQueries(
  queryClient: QueryClient,
  filterId: string
): Promise<void> {
  const PARAMS_INDEX = 3

  await queryClient.invalidateQueries({
    queryKey: bookmarkKeys.customLists(),
    predicate: (query) => {
      const params = query.queryKey[PARAMS_INDEX] as { filter_id?: string } | undefined
      return params?.filter_id === filterId
    },
  })

  await queryClient.invalidateQueries({
    queryKey: noteKeys.customLists(),
    predicate: (query) => {
      const params = query.queryKey[PARAMS_INDEX] as { filter_id?: string } | undefined
      return params?.filter_id === filterId
    },
  })

  await queryClient.invalidateQueries({
    queryKey: promptKeys.customLists(),
    predicate: (query) => {
      const params = query.queryKey[PARAMS_INDEX] as { filter_id?: string } | undefined
      return params?.filter_id === filterId
    },
  })

  // Also invalidate unified content queries (used by AllContent page for filters)
  await queryClient.invalidateQueries({
    queryKey: contentKeys.lists(),
    predicate: (query) => {
      const params = query.queryKey[PARAMS_INDEX] as { filter_id?: string } | undefined
      return params?.filter_id === filterId
    },
  })
}
