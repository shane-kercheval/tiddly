/**
 * TanStack Query mutation hooks for prompt operations.
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
 * | Create prompt     | active, custom lists                           |
 * | Update prompt     | active, archived, custom lists                 |
 * | Delete (soft)     | active, archived, deleted, custom lists        |
 * | Delete (permanent)| deleted only                                   |
 * | Archive           | active, archived, custom lists                 |
 * | Unarchive         | active, archived, custom lists                 |
 * | Restore           | active, deleted, custom lists                  |
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import { promptKeys } from './usePromptsQuery'
import { contentKeys } from './useContentQuery'
import { useTagsStore } from '../stores/tagsStore'
import type { Prompt, PromptCreate, PromptUpdate, PromptListResponse, ContentListResponse } from '../types'

/** Context for optimistic update rollback */
interface OptimisticContext {
  previousPromptQueries: [readonly unknown[], PromptListResponse | undefined][]
  previousContentQueries: [readonly unknown[], ContentListResponse | undefined][]
}

/**
 * Optimistically remove a prompt from all cached list queries.
 * Returns previous data for rollback on error.
 */
function optimisticallyRemovePrompt(
  queryClient: QueryClient,
  promptId: string
): OptimisticContext {
  // Snapshot current data before modification
  const previousPromptQueries = queryClient.getQueriesData<PromptListResponse>({
    queryKey: promptKeys.lists(),
  })
  const previousContentQueries = queryClient.getQueriesData<ContentListResponse>({
    queryKey: contentKeys.lists(),
  })

  // Update all prompt list queries
  queryClient.setQueriesData<PromptListResponse>(
    { queryKey: promptKeys.lists() },
    (old) => {
      if (!old) return old
      const filteredItems = old.items.filter((item) => item.id !== promptId)
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
      const filteredItems = old.items.filter((item) => !(item.type === 'prompt' && item.id === promptId))
      return {
        ...old,
        items: filteredItems,
        // Only decrement total if item was actually in this query's results
        total: filteredItems.length < old.items.length ? old.total - 1 : old.total,
      }
    }
  )

  return { previousPromptQueries, previousContentQueries }
}

/**
 * Rollback optimistic updates by restoring previous query data.
 */
function rollbackOptimisticUpdate(
  queryClient: QueryClient,
  context: OptimisticContext | undefined
): void {
  if (!context) return

  // Restore prompt queries
  for (const [queryKey, data] of context.previousPromptQueries) {
    if (data) queryClient.setQueryData(queryKey, data)
  }

  // Restore content queries
  for (const [queryKey, data] of context.previousContentQueries) {
    if (data) queryClient.setQueryData(queryKey, data)
  }
}

/**
 * Hook for creating a new prompt.
 *
 * New prompts are always active, so invalidates:
 * - Active view queries
 * - Custom list queries (new prompt's tags may match list filters)
 */
export function useCreatePrompt() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async (data: PromptCreate): Promise<Prompt> => {
      const response = await api.post<Prompt>('/prompts/', data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promptKeys.view('active') })
      queryClient.invalidateQueries({ queryKey: promptKeys.customLists() })
      queryClient.invalidateQueries({ queryKey: contentKeys.view('active') })
      fetchTags()
    },
  })
}

/**
 * Hook for updating an existing prompt.
 *
 * Updates can affect active or archived prompts, so invalidates:
 * - Active view queries
 * - Archived view queries
 * - Custom list queries (tag changes may affect list membership)
 */
export function useUpdatePrompt() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: PromptUpdate }): Promise<Prompt> => {
      const response = await api.patch<Prompt>(`/prompts/${id}`, data)
      return response.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: promptKeys.view('active') })
      queryClient.invalidateQueries({ queryKey: promptKeys.view('archived') })
      queryClient.invalidateQueries({ queryKey: promptKeys.customLists() })
      queryClient.invalidateQueries({ queryKey: contentKeys.view('active') })
      queryClient.invalidateQueries({ queryKey: contentKeys.view('archived') })
      fetchTags()
    },
  })
}

/**
 * Hook for deleting a prompt (soft or permanent).
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
export function useDeletePrompt() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async ({ id, permanent = false }: { id: string; permanent?: boolean }): Promise<void> => {
      const url = permanent ? `/prompts/${id}?permanent=true` : `/prompts/${id}`
      await api.delete(url)
    },
    onMutate: async ({ id }) => {
      // Cancel outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: promptKeys.lists() })
      await queryClient.cancelQueries({ queryKey: contentKeys.lists() })

      // Optimistically remove from cache
      return optimisticallyRemovePrompt(queryClient, id)
    },
    onError: (_, __, context) => {
      // Rollback on error
      rollbackOptimisticUpdate(queryClient, context)
    },
    onSettled: (_, __, { permanent }) => {
      // Always refetch to ensure consistency
      if (permanent) {
        queryClient.invalidateQueries({ queryKey: promptKeys.view('deleted') })
        queryClient.invalidateQueries({ queryKey: contentKeys.view('deleted') })
      } else {
        queryClient.invalidateQueries({ queryKey: promptKeys.view('active') })
        queryClient.invalidateQueries({ queryKey: promptKeys.view('archived') })
        queryClient.invalidateQueries({ queryKey: promptKeys.view('deleted') })
        queryClient.invalidateQueries({ queryKey: promptKeys.customLists() })
        queryClient.invalidateQueries({ queryKey: contentKeys.view('active') })
        queryClient.invalidateQueries({ queryKey: contentKeys.view('archived') })
        queryClient.invalidateQueries({ queryKey: contentKeys.view('deleted') })
      }
      fetchTags()
    },
  })
}

/**
 * Hook for restoring a deleted prompt.
 *
 * Moves prompt from deleted back to active:
 * - Optimistically removes from deleted view immediately
 * - Rolls back on error
 * - Invalidates active, deleted, and custom list queries
 */
export function useRestorePrompt() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async (id: string): Promise<Prompt> => {
      const response = await api.post<Prompt>(`/prompts/${id}/restore`)
      return response.data
    },
    onMutate: async (id) => {
      // Cancel outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: promptKeys.lists() })
      await queryClient.cancelQueries({ queryKey: contentKeys.lists() })

      // Optimistically remove from deleted view (appears in active view after refetch)
      return optimisticallyRemovePrompt(queryClient, id)
    },
    onError: (_, __, context) => {
      // Rollback on error
      rollbackOptimisticUpdate(queryClient, context)
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: promptKeys.view('active') })
      queryClient.invalidateQueries({ queryKey: promptKeys.view('deleted') })
      queryClient.invalidateQueries({ queryKey: promptKeys.customLists() })
      queryClient.invalidateQueries({ queryKey: contentKeys.view('active') })
      queryClient.invalidateQueries({ queryKey: contentKeys.view('deleted') })
      fetchTags()
    },
  })
}

/**
 * Hook for archiving a prompt.
 *
 * Moves prompt from active to archived:
 * - Optimistically removes from active view immediately
 * - Rolls back on error
 * - Invalidates active, archived, and custom list queries
 */
export function useArchivePrompt() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async (id: string): Promise<Prompt> => {
      const response = await api.post<Prompt>(`/prompts/${id}/archive`)
      return response.data
    },
    onMutate: async (id) => {
      // Cancel outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: promptKeys.lists() })
      await queryClient.cancelQueries({ queryKey: contentKeys.lists() })

      // Optimistically remove from cache (appears in archived view after refetch)
      return optimisticallyRemovePrompt(queryClient, id)
    },
    onError: (_, __, context) => {
      // Rollback on error
      rollbackOptimisticUpdate(queryClient, context)
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: promptKeys.view('active') })
      queryClient.invalidateQueries({ queryKey: promptKeys.view('archived') })
      queryClient.invalidateQueries({ queryKey: promptKeys.customLists() })
      queryClient.invalidateQueries({ queryKey: contentKeys.view('active') })
      queryClient.invalidateQueries({ queryKey: contentKeys.view('archived') })
      fetchTags()
    },
  })
}

/**
 * Hook for unarchiving a prompt.
 *
 * Moves prompt from archived back to active:
 * - Optimistically removes from archived view immediately
 * - Rolls back on error
 * - Invalidates active, archived, and custom list queries
 */
export function useUnarchivePrompt() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async (id: string): Promise<Prompt> => {
      const response = await api.post<Prompt>(`/prompts/${id}/unarchive`)
      return response.data
    },
    onMutate: async (id) => {
      // Cancel outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey: promptKeys.lists() })
      await queryClient.cancelQueries({ queryKey: contentKeys.lists() })

      // Optimistically remove from archived view (appears in active view after refetch)
      return optimisticallyRemovePrompt(queryClient, id)
    },
    onError: (_, __, context) => {
      // Rollback on error
      rollbackOptimisticUpdate(queryClient, context)
    },
    onSettled: () => {
      // Always refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: promptKeys.view('active') })
      queryClient.invalidateQueries({ queryKey: promptKeys.view('archived') })
      queryClient.invalidateQueries({ queryKey: promptKeys.customLists() })
      queryClient.invalidateQueries({ queryKey: contentKeys.view('active') })
      queryClient.invalidateQueries({ queryKey: contentKeys.view('archived') })
      fetchTags()
    },
  })
}
