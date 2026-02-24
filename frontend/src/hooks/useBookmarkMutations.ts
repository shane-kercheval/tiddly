/**
 * TanStack Query mutation hooks for bookmark operations.
 *
 * Each mutation hook handles:
 * - API call
 * - Optimistic updates for delete/archive (instant UI feedback)
 * - Granular cache invalidation based on which views are affected
 * - Tag store refresh when tags might change
 *
 * Cache Invalidation Strategy:
 * All mutations invalidate at the lists() level (e.g. bookmarkKeys.lists(),
 * contentKeys.lists()) which covers all view combinations including multi-value
 * views like active+archived. This is simpler and always correct.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import { bookmarkKeys } from './useBookmarksQuery'
import { contentKeys } from './useContentQuery'
import { historyKeys } from './useHistory'
import { useTagsStore } from '../stores/tagsStore'
import type { Bookmark, BookmarkCreate, BookmarkUpdate, BookmarkListResponse, ContentListResponse } from '../types'

/** Context for optimistic update rollback */
interface OptimisticContext {
  previousBookmarkQueries: [readonly unknown[], BookmarkListResponse | undefined][]
  previousContentQueries: [readonly unknown[], ContentListResponse | undefined][]
}

/**
 * Optimistically remove an item from all cached list queries.
 * Returns previous data for rollback on error.
 */
function optimisticallyRemoveBookmark(
  queryClient: QueryClient,
  bookmarkId: string
): OptimisticContext {
  // Snapshot current data before modification
  const previousBookmarkQueries = queryClient.getQueriesData<BookmarkListResponse>({
    queryKey: bookmarkKeys.lists(),
  })
  const previousContentQueries = queryClient.getQueriesData<ContentListResponse>({
    queryKey: contentKeys.lists(),
  })

  // Update all bookmark list queries
  queryClient.setQueriesData<BookmarkListResponse>(
    { queryKey: bookmarkKeys.lists() },
    (old) => {
      if (!old) return old
      const filteredItems = old.items.filter((item) => item.id !== bookmarkId)
      return {
        ...old,
        items: filteredItems,
        // Only decrement total if item was actually in this query's results
        total: filteredItems.length < old.items.length ? old.total - 1 : old.total,
      }
    }
  )

  // Update all content list queries
  queryClient.setQueriesData<ContentListResponse>(
    { queryKey: contentKeys.lists() },
    (old) => {
      if (!old) return old
      const filteredItems = old.items.filter((item) => !(item.type === 'bookmark' && item.id === bookmarkId))
      return {
        ...old,
        items: filteredItems,
        // Only decrement total if item was actually in this query's results
        total: filteredItems.length < old.items.length ? old.total - 1 : old.total,
      }
    }
  )

  return { previousBookmarkQueries, previousContentQueries }
}

/**
 * Rollback optimistic updates by restoring previous query data.
 */
function rollbackOptimisticUpdate(
  queryClient: QueryClient,
  context: OptimisticContext | undefined
): void {
  if (!context) return

  // Restore bookmark queries
  for (const [queryKey, data] of context.previousBookmarkQueries) {
    if (data) queryClient.setQueryData(queryKey, data)
  }

  // Restore content queries
  for (const [queryKey, data] of context.previousContentQueries) {
    if (data) queryClient.setQueryData(queryKey, data)
  }
}

/**
 * Optimistically update a bookmark's properties in all cached list queries.
 * Used for tag updates to provide instant feedback.
 * Returns previous data for rollback on error.
 *
 * Note: Only fields present in list items are updated here. Fields like
 * `content` and `archived_at` are excluded because they're either not in
 * list responses or don't require immediate visual feedback.
 */
function optimisticallyUpdateBookmark(
  queryClient: QueryClient,
  bookmarkId: string,
  updates: BookmarkUpdate
): OptimisticContext {
  // Snapshot current data before modification
  const previousBookmarkQueries = queryClient.getQueriesData<BookmarkListResponse>({
    queryKey: bookmarkKeys.lists(),
  })
  const previousContentQueries = queryClient.getQueriesData<ContentListResponse>({
    queryKey: contentKeys.lists(),
  })

  // Update all bookmark list queries
  queryClient.setQueriesData<BookmarkListResponse>(
    { queryKey: bookmarkKeys.lists() },
    (old) => {
      if (!old) return old
      return {
        ...old,
        items: old.items.map((item) => {
          if (item.id !== bookmarkId) return item
          // Apply updates to the matching item
          return {
            ...item,
            ...(updates.tags !== undefined && { tags: updates.tags }),
            ...(updates.title !== undefined && { title: updates.title }),
            ...(updates.description !== undefined && { description: updates.description }),
            ...(updates.url !== undefined && { url: updates.url }),
          }
        }),
      }
    }
  )

  // Update all content list queries
  queryClient.setQueriesData<ContentListResponse>(
    { queryKey: contentKeys.lists() },
    (old) => {
      if (!old) return old
      return {
        ...old,
        items: old.items.map((item) => {
          if (!(item.type === 'bookmark' && item.id === bookmarkId)) return item
          // Apply updates to the matching item
          return {
            ...item,
            ...(updates.tags !== undefined && { tags: updates.tags }),
            ...(updates.title !== undefined && { title: updates.title }),
            ...(updates.description !== undefined && { description: updates.description }),
            ...(updates.url !== undefined && { url: updates.url }),
          }
        }),
      }
    }
  )

  return { previousBookmarkQueries, previousContentQueries }
}

/**
 * Hook for creating a new bookmark.
 */
export function useCreateBookmark() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async (data: BookmarkCreate): Promise<Bookmark> => {
      const response = await api.post<Bookmark>('/bookmarks/', data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bookmarkKeys.lists() })
      queryClient.invalidateQueries({ queryKey: contentKeys.lists() })
      queryClient.invalidateQueries({ queryKey: historyKeys.all })
      fetchTags()
    },
  })
}

/**
 * Hook for updating an existing bookmark.
 *
 * Optimistically updates item in cache immediately, rolls back on error.
 */
export function useUpdateBookmark() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: BookmarkUpdate }): Promise<Bookmark> => {
      const response = await api.patch<Bookmark>(`/bookmarks/${id}`, data)
      return response.data
    },
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: bookmarkKeys.lists() })
      await queryClient.cancelQueries({ queryKey: contentKeys.lists() })

      // Optimistically update the item in cache
      return optimisticallyUpdateBookmark(queryClient, id, data)
    },
    onError: (_, __, context) => {
      // Rollback on error
      rollbackOptimisticUpdate(queryClient, context)
    },
    onSettled: (_, __, { data }) => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: bookmarkKeys.lists() })
      queryClient.invalidateQueries({ queryKey: contentKeys.lists() })
      queryClient.invalidateQueries({ queryKey: historyKeys.all })
      // Only refresh tags if tags were modified (reduces flicker on save)
      if ('tags' in data) {
        fetchTags()
      }
    },
  })
}

/**
 * Hook for deleting a bookmark (soft or permanent).
 *
 * Optimistically removes from UI immediately, rolls back on error.
 */
export function useDeleteBookmark() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async ({ id, permanent = false }: { id: string; permanent?: boolean }): Promise<void> => {
      const url = permanent ? `/bookmarks/${id}?permanent=true` : `/bookmarks/${id}`
      await api.delete(url)
    },
    onMutate: async ({ id }) => {
      // Cancel outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: bookmarkKeys.lists() })
      await queryClient.cancelQueries({ queryKey: contentKeys.lists() })

      // Optimistically remove from cache
      return optimisticallyRemoveBookmark(queryClient, id)
    },
    onError: (_, __, context) => {
      // Rollback on error
      rollbackOptimisticUpdate(queryClient, context)
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: bookmarkKeys.lists() })
      queryClient.invalidateQueries({ queryKey: contentKeys.lists() })
      queryClient.invalidateQueries({ queryKey: historyKeys.all })
      fetchTags()
    },
  })
}

/**
 * Hook for restoring a deleted bookmark.
 *
 * Optimistically removes from deleted view immediately, rolls back on error.
 */
export function useRestoreBookmark() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async (id: string): Promise<Bookmark> => {
      const response = await api.post<Bookmark>(`/bookmarks/${id}/restore`)
      return response.data
    },
    onMutate: async (id) => {
      // Cancel outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: bookmarkKeys.lists() })
      await queryClient.cancelQueries({ queryKey: contentKeys.lists() })

      // Optimistically remove from deleted view (appears in active view after refetch)
      return optimisticallyRemoveBookmark(queryClient, id)
    },
    onError: (_, __, context) => {
      // Rollback on error
      rollbackOptimisticUpdate(queryClient, context)
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: bookmarkKeys.lists() })
      queryClient.invalidateQueries({ queryKey: contentKeys.lists() })
      queryClient.invalidateQueries({ queryKey: historyKeys.all })
      fetchTags()
    },
  })
}

/**
 * Hook for archiving a bookmark.
 *
 * Optimistically removes from active view immediately, rolls back on error.
 */
export function useArchiveBookmark() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async (id: string): Promise<Bookmark> => {
      const response = await api.post<Bookmark>(`/bookmarks/${id}/archive`)
      return response.data
    },
    onMutate: async (id) => {
      // Cancel outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: bookmarkKeys.lists() })
      await queryClient.cancelQueries({ queryKey: contentKeys.lists() })

      // Optimistically remove from cache (appears in archived view after refetch)
      return optimisticallyRemoveBookmark(queryClient, id)
    },
    onError: (_, __, context) => {
      // Rollback on error
      rollbackOptimisticUpdate(queryClient, context)
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: bookmarkKeys.lists() })
      queryClient.invalidateQueries({ queryKey: contentKeys.lists() })
      queryClient.invalidateQueries({ queryKey: historyKeys.all })
      fetchTags()
    },
  })
}

/**
 * Hook for unarchiving a bookmark.
 *
 * Optimistically removes from archived view immediately, rolls back on error.
 */
export function useUnarchiveBookmark() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async (id: string): Promise<Bookmark> => {
      const response = await api.post<Bookmark>(`/bookmarks/${id}/unarchive`)
      return response.data
    },
    onMutate: async (id) => {
      // Cancel outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: bookmarkKeys.lists() })
      await queryClient.cancelQueries({ queryKey: contentKeys.lists() })

      // Optimistically remove from archived view (appears in active view after refetch)
      return optimisticallyRemoveBookmark(queryClient, id)
    },
    onError: (_, __, context) => {
      // Rollback on error
      rollbackOptimisticUpdate(queryClient, context)
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: bookmarkKeys.lists() })
      queryClient.invalidateQueries({ queryKey: contentKeys.lists() })
      queryClient.invalidateQueries({ queryKey: historyKeys.all })
      fetchTags()
    },
  })
}
