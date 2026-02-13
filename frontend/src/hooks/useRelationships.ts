/**
 * TanStack Query hooks for content relationships.
 *
 * Provides:
 * - Query key factory for cache management
 * - useContentRelationships: fetch relationships for a content item
 * - useRelationshipMutations: create, update, and remove relationships
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { relationshipsApi } from '../services/relationships'
import type { ContentType, RelationshipCreate, RelationshipListResponse, RelationshipUpdate } from '../types'

/**
 * Query key factory for relationship cache keys.
 *
 * Key Structure:
 * - ['relationships']                              - all relationship queries
 * - ['relationships', 'content', type, id]         - base key for a content item
 * - ['relationships', 'content', type, id, options] - specific query with options
 */
export const relationshipKeys = {
  all: ['relationships'] as const,
  forContent: (type: ContentType, id: string) =>
    [...relationshipKeys.all, 'content', type, id] as const,
}

/**
 * Hook for fetching relationships for a content item.
 *
 * Disabled when contentType or contentId is null (e.g., before content loads).
 */
export function useContentRelationships(
  contentType: ContentType | null,
  contentId: string | null,
  options?: {
    includeContentInfo?: boolean
    /** Pre-fetched data from entity GET response to avoid an extra network request. */
    initialData?: RelationshipListResponse
  }
) {
  const includeContentInfo = options?.includeContentInfo ?? true

  return useQuery({
    queryKey: contentType && contentId
      ? [...relationshipKeys.forContent(contentType, contentId), { includeContentInfo }]
      : ['relationships', 'disabled'],
    queryFn: () => relationshipsApi.getForContent(
      contentType!,
      contentId!,
      {
        include_content_info: includeContentInfo,
      },
    ).then(res => res.data),
    enabled: contentType !== null && contentId !== null,
    staleTime: 5 * 60 * 1000,
    initialData: options?.initialData,
    // When initialData is provided (from embedded entity response), mark it as fresh
    // so React Query respects staleTime and doesn't immediately refetch.
    initialDataUpdatedAt: options?.initialData ? Date.now() : undefined,
  })
}

/**
 * Mutation hooks for relationship CRUD operations.
 *
 * Cache invalidation strategy:
 * - create: invalidates both source and target content queries
 * - update: invalidates all relationship queries
 * - remove: invalidates all relationship queries
 */
export function useRelationshipMutations() {
  const queryClient = useQueryClient()

  const create = useMutation({
    mutationFn: (data: RelationshipCreate) =>
      relationshipsApi.create(data).then(res => res.data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: relationshipKeys.forContent(variables.source_type, variables.source_id),
      })
      queryClient.invalidateQueries({
        queryKey: relationshipKeys.forContent(variables.target_type, variables.target_id),
      })
    },
  })

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: RelationshipUpdate }) =>
      relationshipsApi.update(id, data).then(res => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: relationshipKeys.all })
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => relationshipsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: relationshipKeys.all })
    },
    onError: () => {
      toast.error('Failed to remove link')
    },
  })

  return { create, update, remove }
}
