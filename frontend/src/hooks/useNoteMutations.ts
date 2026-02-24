/**
 * TanStack Query mutation hooks for note operations.
 *
 * Each mutation hook handles:
 * - API call
 * - Optimistic updates for delete/archive/restore (instant UI feedback)
 * - Granular cache invalidation based on which views are affected
 * - Tag store refresh when tags might change
 *
 * Cache Invalidation Strategy:
 * All mutations invalidate at the lists() level (e.g. noteKeys.lists(),
 * contentKeys.lists()) which covers all view combinations including multi-value
 * views like active+archived. This is simpler and always correct.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import { noteKeys } from './useNotesQuery'
import { contentKeys } from './useContentQuery'
import { historyKeys } from './useHistory'
import { useTagsStore } from '../stores/tagsStore'
import type { Note, NoteCreate, NoteUpdate, NoteListResponse, ContentListResponse } from '../types'

/** Context for optimistic update rollback */
interface OptimisticContext {
  previousNoteQueries: [readonly unknown[], NoteListResponse | undefined][]
  previousContentQueries: [readonly unknown[], ContentListResponse | undefined][]
}

/**
 * Optimistically remove a note from all cached list queries.
 * Returns previous data for rollback on error.
 */
function optimisticallyRemoveNote(
  queryClient: QueryClient,
  noteId: string
): OptimisticContext {
  // Snapshot current data before modification
  const previousNoteQueries = queryClient.getQueriesData<NoteListResponse>({
    queryKey: noteKeys.lists(),
  })
  const previousContentQueries = queryClient.getQueriesData<ContentListResponse>({
    queryKey: contentKeys.lists(),
  })

  // Update all note list queries
  queryClient.setQueriesData<NoteListResponse>(
    { queryKey: noteKeys.lists() },
    (old) => {
      if (!old) return old
      const filteredItems = old.items.filter((item) => item.id !== noteId)
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
      const filteredItems = old.items.filter((item) => !(item.type === 'note' && item.id === noteId))
      return {
        ...old,
        items: filteredItems,
        // Only decrement total if item was actually in this query's results
        total: filteredItems.length < old.items.length ? old.total - 1 : old.total,
      }
    }
  )

  return { previousNoteQueries, previousContentQueries }
}

/**
 * Rollback optimistic updates by restoring previous query data.
 */
function rollbackOptimisticUpdate(
  queryClient: QueryClient,
  context: OptimisticContext | undefined
): void {
  if (!context) return

  // Restore note queries
  for (const [queryKey, data] of context.previousNoteQueries) {
    if (data) queryClient.setQueryData(queryKey, data)
  }

  // Restore content queries
  for (const [queryKey, data] of context.previousContentQueries) {
    if (data) queryClient.setQueryData(queryKey, data)
  }
}

/**
 * Optimistically update a note's properties in all cached list queries.
 * Used for tag updates to provide instant feedback.
 * Returns previous data for rollback on error.
 *
 * Note: Only fields present in list items are updated here. Fields like
 * `content` and `archived_at` are excluded because they're either not in
 * list responses or don't require immediate visual feedback.
 */
function optimisticallyUpdateNote(
  queryClient: QueryClient,
  noteId: string,
  updates: NoteUpdate
): OptimisticContext {
  // Snapshot current data before modification
  const previousNoteQueries = queryClient.getQueriesData<NoteListResponse>({
    queryKey: noteKeys.lists(),
  })
  const previousContentQueries = queryClient.getQueriesData<ContentListResponse>({
    queryKey: contentKeys.lists(),
  })

  // Update all note list queries
  queryClient.setQueriesData<NoteListResponse>(
    { queryKey: noteKeys.lists() },
    (old) => {
      if (!old) return old
      return {
        ...old,
        items: old.items.map((item) => {
          if (item.id !== noteId) return item
          // Apply updates to the matching item
          return {
            ...item,
            ...(updates.tags !== undefined && { tags: updates.tags }),
            ...(updates.title !== undefined && { title: updates.title }),
            ...(updates.description !== undefined && { description: updates.description }),
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
          if (!(item.type === 'note' && item.id === noteId)) return item
          // Apply updates to the matching item
          return {
            ...item,
            ...(updates.tags !== undefined && { tags: updates.tags }),
            ...(updates.title !== undefined && { title: updates.title }),
            ...(updates.description !== undefined && { description: updates.description }),
          }
        }),
      }
    }
  )

  return { previousNoteQueries, previousContentQueries }
}

/**
 * Hook for creating a new note.
 */
export function useCreateNote() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async (data: NoteCreate): Promise<Note> => {
      const response = await api.post<Note>('/notes/', data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() })
      queryClient.invalidateQueries({ queryKey: contentKeys.lists() })
      queryClient.invalidateQueries({ queryKey: historyKeys.all })
      fetchTags()
    },
  })
}

/**
 * Hook for updating an existing note.
 *
 * Updates can affect active or archived notes:
 * - Optimistically updates item in cache immediately
 * - Rolls back on error
 * - Invalidates active, archived, and custom list queries
 */
export function useUpdateNote() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: NoteUpdate }): Promise<Note> => {
      const response = await api.patch<Note>(`/notes/${id}`, data)
      return response.data
    },
    onMutate: async ({ id, data }) => {
      // Cancel outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: noteKeys.lists() })
      await queryClient.cancelQueries({ queryKey: contentKeys.lists() })

      // Optimistically update the item in cache
      return optimisticallyUpdateNote(queryClient, id, data)
    },
    onError: (_, __, context) => {
      // Rollback on error
      rollbackOptimisticUpdate(queryClient, context)
    },
    onSettled: (_, __, { data }) => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() })
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
 * Hook for deleting a note (soft or permanent).
 *
 * Optimistically removes from UI immediately, rolls back on error.
 */
export function useDeleteNote() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async ({ id, permanent = false }: { id: string; permanent?: boolean }): Promise<void> => {
      const url = permanent ? `/notes/${id}?permanent=true` : `/notes/${id}`
      await api.delete(url)
    },
    onMutate: async ({ id }) => {
      // Cancel outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: noteKeys.lists() })
      await queryClient.cancelQueries({ queryKey: contentKeys.lists() })

      // Optimistically remove from cache
      return optimisticallyRemoveNote(queryClient, id)
    },
    onError: (_, __, context) => {
      // Rollback on error
      rollbackOptimisticUpdate(queryClient, context)
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() })
      queryClient.invalidateQueries({ queryKey: contentKeys.lists() })
      queryClient.invalidateQueries({ queryKey: historyKeys.all })
      fetchTags()
    },
  })
}

/**
 * Hook for restoring a deleted note.
 *
 * Optimistically removes from deleted view immediately, rolls back on error.
 */
export function useRestoreNote() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async (id: string): Promise<Note> => {
      const response = await api.post<Note>(`/notes/${id}/restore`)
      return response.data
    },
    onMutate: async (id) => {
      // Cancel outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: noteKeys.lists() })
      await queryClient.cancelQueries({ queryKey: contentKeys.lists() })

      // Optimistically remove from deleted view (appears in active view after refetch)
      return optimisticallyRemoveNote(queryClient, id)
    },
    onError: (_, __, context) => {
      // Rollback on error
      rollbackOptimisticUpdate(queryClient, context)
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() })
      queryClient.invalidateQueries({ queryKey: contentKeys.lists() })
      queryClient.invalidateQueries({ queryKey: historyKeys.all })
      fetchTags()
    },
  })
}

/**
 * Hook for archiving a note.
 *
 * Optimistically removes from active view immediately, rolls back on error.
 */
export function useArchiveNote() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async (id: string): Promise<Note> => {
      const response = await api.post<Note>(`/notes/${id}/archive`)
      return response.data
    },
    onMutate: async (id) => {
      // Cancel outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: noteKeys.lists() })
      await queryClient.cancelQueries({ queryKey: contentKeys.lists() })

      // Optimistically remove from cache (appears in archived view after refetch)
      return optimisticallyRemoveNote(queryClient, id)
    },
    onError: (_, __, context) => {
      // Rollback on error
      rollbackOptimisticUpdate(queryClient, context)
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() })
      queryClient.invalidateQueries({ queryKey: contentKeys.lists() })
      queryClient.invalidateQueries({ queryKey: historyKeys.all })
      fetchTags()
    },
  })
}

/**
 * Hook for unarchiving a note.
 *
 * Optimistically removes from archived view immediately, rolls back on error.
 */
export function useUnarchiveNote() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async (id: string): Promise<Note> => {
      const response = await api.post<Note>(`/notes/${id}/unarchive`)
      return response.data
    },
    onMutate: async (id) => {
      // Cancel outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: noteKeys.lists() })
      await queryClient.cancelQueries({ queryKey: contentKeys.lists() })

      // Optimistically remove from archived view (appears in active view after refetch)
      return optimisticallyRemoveNote(queryClient, id)
    },
    onError: (_, __, context) => {
      // Rollback on error
      rollbackOptimisticUpdate(queryClient, context)
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: noteKeys.lists() })
      queryClient.invalidateQueries({ queryKey: contentKeys.lists() })
      queryClient.invalidateQueries({ queryKey: historyKeys.all })
      fetchTags()
    },
  })
}
