/**
 * Hook for collection CRUD operations with optimistic updates.
 *
 * Handles creating, updating, renaming, and deleting sidebar collections
 * with proper optimistic UI updates and rollback on failure.
 */
import { useCallback } from 'react'
import toast from 'react-hot-toast'
import { useSettingsStore } from '../stores/settingsStore'
import { useFiltersStore } from '../stores/filtersStore'
import { computedToMinimal } from '../components/sidebar/sidebarDndUtils'
import type {
  SidebarCollectionComputed,
  SidebarFilterItemComputed,
  ContentFilter,
} from '../types'

const SIDEBAR_VERSION = 1

export interface UseCollectionOperationsResult {
  /** Create a new collection with the given name and filter IDs */
  createCollection: (name: string, filterIds: string[]) => Promise<void>
  /** Update an existing collection's name and/or filters */
  updateCollection: (id: string, name: string, filterIds: string[]) => Promise<void>
  /** Rename a collection (inline edit) */
  renameCollection: (collectionId: string, newName: string) => Promise<void>
  /** Delete a collection, moving its contents to root level */
  deleteCollection: (collectionId: string) => Promise<void>
}

/**
 * Hook providing collection CRUD operations with optimistic updates.
 *
 * All operations:
 * 1. Apply optimistic UI update immediately
 * 2. Persist to backend
 * 3. Rollback on failure with toast notification
 */
export function useCollectionOperations(): UseCollectionOperationsResult {
  const sidebar = useSettingsStore((state) => state.sidebar)
  const updateSidebar = useSettingsStore((state) => state.updateSidebar)
  const setSidebarOptimistic = useSettingsStore((state) => state.setSidebarOptimistic)
  const rollbackSidebar = useSettingsStore((state) => state.rollbackSidebar)
  const filters = useFiltersStore((state) => state.filters)

  const getFilterById = useCallback(
    (id: string): ContentFilter | undefined => {
      return filters.find((f) => f.id === id)
    },
    [filters]
  )

  const createCollection = useCallback(
    async (name: string, filterIds: string[]): Promise<void> => {
      if (!sidebar) return

      // Build collection items from filter IDs
      const collectionItems = filterIds
        .map((id) => {
          const filter = getFilterById(id)
          if (!filter) return null
          return {
            type: 'filter' as const,
            id: filter.id,
            name: filter.name,
            content_types: filter.content_types,
          }
        })
        .filter((item): item is SidebarFilterItemComputed => item !== null)

      const newCollectionComputed: SidebarCollectionComputed = {
        type: 'collection',
        id: crypto.randomUUID(),
        name,
        items: collectionItems,
      }

      // Remove filters that are now in the collection from root level
      const filterIdsInCollection = new Set(filterIds)
      const filteredRootItems = sidebar.items.filter(
        (item) => !(item.type === 'filter' && filterIdsInCollection.has(item.id))
      )

      // Optimistically add to UI
      const optimisticItems = [newCollectionComputed, ...filteredRootItems]
      setSidebarOptimistic(optimisticItems)

      try {
        await updateSidebar({
          version: SIDEBAR_VERSION,
          items: computedToMinimal(optimisticItems),
        })
      } catch {
        rollbackSidebar()
        throw new Error('Failed to create collection')
      }
    },
    [sidebar, getFilterById, setSidebarOptimistic, updateSidebar, rollbackSidebar]
  )

  const updateCollection = useCallback(
    async (id: string, name: string, filterIds: string[]): Promise<void> => {
      if (!sidebar) return

      // Build collection items from filter IDs
      const collectionItems = filterIds
        .map((filterId) => {
          const filter = getFilterById(filterId)
          if (!filter) return null
          return {
            type: 'filter' as const,
            id: filter.id,
            name: filter.name,
            content_types: filter.content_types,
          }
        })
        .filter((item): item is SidebarFilterItemComputed => item !== null)

      // Find the old collection to get its previous filter IDs
      const oldCollection = sidebar.items.find(
        (item): item is SidebarCollectionComputed => item.type === 'collection' && item.id === id
      )
      const oldFilterIds = new Set(
        oldCollection?.items.filter((item) => item.type === 'filter').map((item) => item.id) ?? []
      )
      const newFilterIds = new Set(filterIds)

      // Filters removed from collection should go back to root (at the end)
      const removedFilterItems: SidebarFilterItemComputed[] = []
      for (const filterId of oldFilterIds) {
        if (!newFilterIds.has(filterId)) {
          const filter = getFilterById(filterId)
          if (filter) {
            removedFilterItems.push({
              type: 'filter',
              id: filter.id,
              name: filter.name,
              content_types: filter.content_types,
            })
          }
        }
      }

      // Filters added to collection should be removed from root
      const optimisticItems = sidebar.items
        .filter((item) => !(item.type === 'filter' && newFilterIds.has(item.id) && !oldFilterIds.has(item.id)))
        .map((item) => {
          if (item.type === 'collection' && item.id === id) {
            return { ...item, name, items: collectionItems }
          }
          return item
        })

      // Add removed filters to root
      optimisticItems.push(...removedFilterItems)

      setSidebarOptimistic(optimisticItems)

      try {
        await updateSidebar({ version: SIDEBAR_VERSION, items: computedToMinimal(optimisticItems) })
      } catch {
        rollbackSidebar()
        throw new Error('Failed to update collection')
      }
    },
    [sidebar, getFilterById, setSidebarOptimistic, updateSidebar, rollbackSidebar]
  )

  const renameCollection = useCallback(
    async (collectionId: string, newName: string): Promise<void> => {
      if (!sidebar) return

      // Optimistically update UI
      const optimisticItems = sidebar.items.map((item) => {
        if (item.type === 'collection' && item.id === collectionId) {
          return { ...item, name: newName }
        }
        return item
      })
      setSidebarOptimistic(optimisticItems)

      try {
        await updateSidebar({ version: SIDEBAR_VERSION, items: computedToMinimal(optimisticItems) })
      } catch {
        rollbackSidebar()
        toast.error('Failed to rename collection')
      }
    },
    [sidebar, setSidebarOptimistic, updateSidebar, rollbackSidebar]
  )

  const deleteCollection = useCallback(
    async (collectionId: string): Promise<void> => {
      if (!sidebar) return

      const collection = sidebar.items.find(
        (item): item is SidebarCollectionComputed => item.type === 'collection' && item.id === collectionId
      )

      if (!collection) return

      // Optimistically update UI - replace collection with its contents
      const optimisticItems = sidebar.items.flatMap((item) => {
        if (item.type === 'collection' && item.id === collectionId) {
          return item.items // Return the collection's children directly
        }
        return [item]
      })
      setSidebarOptimistic(optimisticItems)

      try {
        await updateSidebar({ version: SIDEBAR_VERSION, items: computedToMinimal(optimisticItems) })
      } catch {
        rollbackSidebar()
        toast.error('Failed to delete collection')
      }
    },
    [sidebar, setSidebarOptimistic, updateSidebar, rollbackSidebar]
  )

  return {
    createCollection,
    updateCollection,
    renameCollection,
    deleteCollection,
  }
}
