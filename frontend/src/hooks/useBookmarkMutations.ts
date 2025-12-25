/**
 * TanStack Query mutation hooks for bookmark operations.
 *
 * Each mutation hook handles:
 * - API call
 * - Cache invalidation based on the invalidation strategy
 * - Tag store refresh when tags might change
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import { bookmarkKeys } from './useBookmarksQuery'
import { useTagsStore } from '../stores/tagsStore'
import type { Bookmark, BookmarkCreate, BookmarkUpdate } from '../types'

/**
 * Invalidate all list queries (any query starting with ['bookmarks', 'list']).
 */
function invalidateAllLists(queryClient: ReturnType<typeof useQueryClient>): void {
  queryClient.invalidateQueries({ queryKey: bookmarkKeys.lists() })
}

/**
 * Hook for creating a new bookmark.
 *
 * Invalidates:
 * - ['bookmarks', 'active']
 * - All ['bookmarks', 'list', *]
 *
 * Also refreshes tags since new bookmarks may introduce new tags.
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
      queryClient.invalidateQueries({ queryKey: bookmarkKeys.active() })
      invalidateAllLists(queryClient)
      fetchTags()
    },
  })
}

/**
 * Hook for updating an existing bookmark.
 *
 * Invalidates:
 * - ['bookmarks', 'active']
 * - ['bookmarks', 'archived']
 * - All ['bookmarks', 'list', *]
 *
 * Also refreshes tags since bookmark updates may add/remove tags.
 */
export function useUpdateBookmark() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: BookmarkUpdate }): Promise<Bookmark> => {
      const response = await api.patch<Bookmark>(`/bookmarks/${id}`, data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bookmarkKeys.active() })
      queryClient.invalidateQueries({ queryKey: bookmarkKeys.archived() })
      invalidateAllLists(queryClient)
      fetchTags()
    },
  })
}

/**
 * Hook for deleting a bookmark (soft or permanent).
 *
 * Soft delete invalidates:
 * - ['bookmarks', 'active']
 * - ['bookmarks', 'deleted']
 * - All ['bookmarks', 'list', *]
 *
 * Permanent delete invalidates:
 * - ['bookmarks', 'deleted']
 *
 * Also refreshes tags since deleting bookmarks may affect tag counts.
 */
export function useDeleteBookmark() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async ({ id, permanent = false }: { id: number; permanent?: boolean }): Promise<void> => {
      const url = permanent ? `/bookmarks/${id}?permanent=true` : `/bookmarks/${id}`
      await api.delete(url)
    },
    onSuccess: (_, { permanent }) => {
      if (permanent) {
        queryClient.invalidateQueries({ queryKey: bookmarkKeys.deleted() })
      } else {
        queryClient.invalidateQueries({ queryKey: bookmarkKeys.active() })
        queryClient.invalidateQueries({ queryKey: bookmarkKeys.deleted() })
        invalidateAllLists(queryClient)
      }
      fetchTags()
    },
  })
}

/**
 * Hook for restoring a deleted bookmark.
 *
 * Invalidates:
 * - ['bookmarks', 'active']
 * - ['bookmarks', 'deleted']
 * - All ['bookmarks', 'list', *]
 *
 * Also refreshes tags since restored bookmarks affect tag counts.
 */
export function useRestoreBookmark() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async (id: number): Promise<Bookmark> => {
      const response = await api.post<Bookmark>(`/bookmarks/${id}/restore`)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bookmarkKeys.active() })
      queryClient.invalidateQueries({ queryKey: bookmarkKeys.deleted() })
      invalidateAllLists(queryClient)
      fetchTags()
    },
  })
}

/**
 * Hook for archiving a bookmark.
 *
 * Invalidates:
 * - ['bookmarks', 'active']
 * - ['bookmarks', 'archived']
 * - All ['bookmarks', 'list', *]
 *
 * Also refreshes tags since archiving may affect tag counts in active view.
 */
export function useArchiveBookmark() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async (id: number): Promise<Bookmark> => {
      const response = await api.post<Bookmark>(`/bookmarks/${id}/archive`)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bookmarkKeys.active() })
      queryClient.invalidateQueries({ queryKey: bookmarkKeys.archived() })
      invalidateAllLists(queryClient)
      fetchTags()
    },
  })
}

/**
 * Hook for unarchiving a bookmark.
 *
 * Invalidates:
 * - ['bookmarks', 'active']
 * - ['bookmarks', 'archived']
 * - All ['bookmarks', 'list', *]
 *
 * Also refreshes tags since unarchiving may affect tag counts.
 */
export function useUnarchiveBookmark() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async (id: number): Promise<Bookmark> => {
      const response = await api.post<Bookmark>(`/bookmarks/${id}/unarchive`)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bookmarkKeys.active() })
      queryClient.invalidateQueries({ queryKey: bookmarkKeys.archived() })
      invalidateAllLists(queryClient)
      fetchTags()
    },
  })
}
