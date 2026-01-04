/**
 * TanStack Query mutation hooks for prompt operations.
 *
 * Each mutation hook handles:
 * - API call
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
import { api } from '../services/api'
import { promptKeys } from './usePromptsQuery'
import { contentKeys } from './useContentQuery'
import { useTagsStore } from '../stores/tagsStore'
import type { Prompt, PromptCreate, PromptUpdate } from '../types'

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
    mutationFn: async ({ id, data }: { id: number; data: PromptUpdate }): Promise<Prompt> => {
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
 * - Active view queries
 * - Archived view queries (prompt can be deleted from archive)
 * - Deleted view queries
 * - Custom list queries (prompt removed from lists)
 *
 * Permanent delete: removes from trash only
 * - Deleted view queries only
 */
export function useDeletePrompt() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async ({ id, permanent = false }: { id: number; permanent?: boolean }): Promise<void> => {
      const url = permanent ? `/prompts/${id}?permanent=true` : `/prompts/${id}`
      await api.delete(url)
    },
    onSuccess: (_, { permanent }) => {
      if (permanent) {
        // Permanent delete only affects trash
        queryClient.invalidateQueries({ queryKey: promptKeys.view('deleted') })
        queryClient.invalidateQueries({ queryKey: contentKeys.view('deleted') })
      } else {
        // Soft delete moves from active/archived to deleted
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
 * Moves prompt from deleted back to active, so invalidates:
 * - Active view queries
 * - Deleted view queries
 * - Custom list queries (restored prompt may match list filters)
 */
export function useRestorePrompt() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async (id: number): Promise<Prompt> => {
      const response = await api.post<Prompt>(`/prompts/${id}/restore`)
      return response.data
    },
    onSuccess: () => {
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
 * Moves prompt from active to archived, so invalidates:
 * - Active view queries
 * - Archived view queries
 * - Custom list queries (prompt removed from active lists)
 */
export function useArchivePrompt() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async (id: number): Promise<Prompt> => {
      const response = await api.post<Prompt>(`/prompts/${id}/archive`)
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
 * Hook for unarchiving a prompt.
 *
 * Moves prompt from archived back to active, so invalidates:
 * - Active view queries
 * - Archived view queries
 * - Custom list queries (prompt may now match list filters)
 */
export function useUnarchivePrompt() {
  const queryClient = useQueryClient()
  const fetchTags = useTagsStore((state) => state.fetchTags)

  return useMutation({
    mutationFn: async (id: number): Promise<Prompt> => {
      const response = await api.post<Prompt>(`/prompts/${id}/unarchive`)
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
