/**
 * Utility for invalidating TanStack Query cache for a specific list.
 *
 * When a list's filters are updated, we need to invalidate cached queries
 * for that list so the UI refetches with the new filter criteria.
 */
import type { QueryClient } from '@tanstack/react-query'
import { bookmarkKeys } from '../hooks/useBookmarksQuery'
import { noteKeys } from '../hooks/useNotesQuery'

/**
 * Invalidate all cached queries for a specific list ID.
 *
 * Query key structure for custom lists:
 * - Bookmarks: ['bookmarks', 'list', 'custom', { list_id: N, ... }]
 * - Notes: ['notes', 'list', 'custom', { list_id: N, ... }]
 *
 * The params object is at index 3 in the query key array.
 */
export async function invalidateListQueries(
  queryClient: QueryClient,
  listId: number
): Promise<void> {
  const PARAMS_INDEX = 3

  await queryClient.invalidateQueries({
    queryKey: bookmarkKeys.customLists(),
    predicate: (query) => {
      const params = query.queryKey[PARAMS_INDEX] as { list_id?: number } | undefined
      return params?.list_id === listId
    },
  })

  await queryClient.invalidateQueries({
    queryKey: noteKeys.customLists(),
    predicate: (query) => {
      const params = query.queryKey[PARAMS_INDEX] as { list_id?: number } | undefined
      return params?.list_id === listId
    },
  })
}
