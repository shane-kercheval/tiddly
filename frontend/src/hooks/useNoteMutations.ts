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
 * | Mutation          | Invalidates                                    |
 * |-------------------|------------------------------------------------|
 * | Create note       | active, custom lists                           |
 * | Update note       | active, archived, custom lists                 |
 * | Delete (soft)     | active, archived, deleted, custom lists        |
 * | Delete (permanent)| deleted only                                   |
 * | Archive           | active, archived, custom lists                 |
 * | Unarchive         | active, archived, custom lists                 |
 * | Restore           | active, deleted, custom lists                  |
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import { noteKeys } from './useNotesQuery'
import { contentKeys } from './useContentQuery'
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
 * Hook for creating a new note.
 *
 * New notes are always active, so invalidates:
 * - Active view queries
 * - Custom list queries (new note's tags may match list filters)
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
      queryClient.invalidateQueries({ queryKey: noteKeys.view('active') })
      queryClient.invalidateQueries({ queryKey: noteKeys.customLists() })
      queryClient.invalidateQueries({ queryKey: contentKeys.view('active') })
      fetchTags()
    },
  })
}

/**
 * Hook for updating an existing note.
 *
 * Updates can affect active or archived notes, so invalidates:
 * - Active view queries
 * - Archived view queries
 * - Custom list queries (tag changes may affect list membership)
 */
export function useUpdateNote() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: NoteUpdate }): Promise<Note> => {
      const response = await api.patch<Note>(`/notes/${id}`, data)
      return response.data
    },
    onSuccess: (_, { data }) => {
      queryClient.invalidateQueries({ queryKey: noteKeys.view('active') })
      queryClient.invalidateQueries({ queryKey: noteKeys.view('archived') })
      queryClient.invalidateQueries({ queryKey: noteKeys.customLists() })
      queryClient.invalidateQueries({ queryKey: contentKeys.view('active') })
      queryClient.invalidateQueries({ queryKey: contentKeys.view('archived') })
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
 * Soft delete: moves from active/archived to deleted
 * - Optimistically removes from UI immediately
 * - Rolls back on error
 * - Invalidates active, archived, deleted, and custom list queries
 *
 * Permanent delete: removes from trash only
 * - Optimistically removes from UI immediately
 * - Rolls back on error
 * - Invalidates deleted view queries only
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
    onSettled: (_, __, { permanent }) => {
      // Always refetch to ensure consistency
      if (permanent) {
        queryClient.invalidateQueries({ queryKey: noteKeys.view('deleted') })
        queryClient.invalidateQueries({ queryKey: contentKeys.view('deleted') })
      } else {
        queryClient.invalidateQueries({ queryKey: noteKeys.view('active') })
        queryClient.invalidateQueries({ queryKey: noteKeys.view('archived') })
        queryClient.invalidateQueries({ queryKey: noteKeys.view('deleted') })
        queryClient.invalidateQueries({ queryKey: noteKeys.customLists() })
        queryClient.invalidateQueries({ queryKey: contentKeys.view('active') })
        queryClient.invalidateQueries({ queryKey: contentKeys.view('archived') })
        queryClient.invalidateQueries({ queryKey: contentKeys.view('deleted') })
      }
      fetchTags()
    },
  })
}

/**
 * Hook for restoring a deleted note.
 *
 * Moves note from deleted back to active:
 * - Optimistically removes from deleted view immediately
 * - Rolls back on error
 * - Invalidates active, deleted, and custom list queries
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
      queryClient.invalidateQueries({ queryKey: noteKeys.view('active') })
      queryClient.invalidateQueries({ queryKey: noteKeys.view('deleted') })
      queryClient.invalidateQueries({ queryKey: noteKeys.customLists() })
      queryClient.invalidateQueries({ queryKey: contentKeys.view('active') })
      queryClient.invalidateQueries({ queryKey: contentKeys.view('deleted') })
      fetchTags()
    },
  })
}

/**
 * Hook for archiving a note.
 *
 * Moves note from active to archived:
 * - Optimistically removes from active view immediately
 * - Rolls back on error
 * - Invalidates active, archived, and custom list queries
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
      queryClient.invalidateQueries({ queryKey: noteKeys.view('active') })
      queryClient.invalidateQueries({ queryKey: noteKeys.view('archived') })
      queryClient.invalidateQueries({ queryKey: noteKeys.customLists() })
      queryClient.invalidateQueries({ queryKey: contentKeys.view('active') })
      queryClient.invalidateQueries({ queryKey: contentKeys.view('archived') })
      fetchTags()
    },
  })
}

/**
 * Hook for unarchiving a note.
 *
 * Moves note from archived back to active:
 * - Optimistically removes from archived view immediately
 * - Rolls back on error
 * - Invalidates active, archived, and custom list queries
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
      queryClient.invalidateQueries({ queryKey: noteKeys.view('active') })
      queryClient.invalidateQueries({ queryKey: noteKeys.view('archived') })
      queryClient.invalidateQueries({ queryKey: noteKeys.customLists() })
      queryClient.invalidateQueries({ queryKey: contentKeys.view('active') })
      queryClient.invalidateQueries({ queryKey: contentKeys.view('archived') })
      fetchTags()
    },
  })
}
