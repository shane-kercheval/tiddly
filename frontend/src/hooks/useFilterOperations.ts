/**
 * Hook for filter CRUD operations with optimistic updates.
 *
 * Handles creating, updating, and deleting content filters
 * with proper optimistic UI updates and rollback on failure.
 */
import { useCallback } from 'react'
import toast from 'react-hot-toast'
import { useSettingsStore } from '../stores/settingsStore'
import { useFiltersStore } from '../stores/filtersStore'
import { queryClient } from '../queryClient'
import { invalidateFilterQueries } from '../utils/invalidateFilterQueries'
import { computedToMinimal } from '../components/sidebar/sidebarDndUtils'
import type {
  SidebarItemComputed,
  SidebarCollectionComputed,
  ContentFilter,
  ContentFilterCreate,
  ContentFilterUpdate,
  ContentType,
} from '../types'

const SIDEBAR_VERSION = 1

export interface UseFilterOperationsResult {
  /**
   * Create a new filter.
   * Returns the created filter on success.
   * Automatically moves the new filter to the top of the sidebar.
   */
  createFilter: (data: ContentFilterCreate) => Promise<ContentFilter>
  /**
   * Update an existing filter.
   * Returns the updated filter on success.
   * Throws on error (for modal error display).
   */
  updateFilter: (filterId: string, data: ContentFilterUpdate) => Promise<ContentFilter>
  /**
   * Delete a filter.
   * Returns true on success, false on failure.
   * Shows toast on failure.
   */
  deleteFilter: (filterId: string) => Promise<boolean>
}

/**
 * Hook providing filter CRUD operations with optimistic updates.
 */
export function useFilterOperations(): UseFilterOperationsResult {
  const sidebar = useSettingsStore((state) => state.sidebar)
  const updateSidebar = useSettingsStore((state) => state.updateSidebar)
  const setSidebarOptimistic = useSettingsStore((state) => state.setSidebarOptimistic)
  const rollbackSidebar = useSettingsStore((state) => state.rollbackSidebar)
  const fetchSidebar = useSettingsStore((state) => state.fetchSidebar)
  const storeCreateFilter = useFiltersStore((state) => state.createFilter)
  const storeUpdateFilter = useFiltersStore((state) => state.updateFilter)
  const storeDeleteFilter = useFiltersStore((state) => state.deleteFilter)

  const createFilter = useCallback(
    async (data: ContentFilterCreate): Promise<ContentFilter> => {
      const result = await storeCreateFilter(data)

      // Refresh sidebar to show new filter
      await fetchSidebar()

      // Move the new filter to the top of the sidebar
      const currentSidebar = useSettingsStore.getState().sidebar
      if (currentSidebar) {
        const newFilterItem = { type: 'filter' as const, id: result.id }
        const otherItems = computedToMinimal(currentSidebar.items).filter(
          (item) => !(item.type === 'filter' && item.id === result.id)
        )
        await updateSidebar({
          version: SIDEBAR_VERSION,
          items: [newFilterItem, ...otherItems],
        })
      }

      return result
    },
    [storeCreateFilter, fetchSidebar, updateSidebar]
  )

  const updateFilter = useCallback(
    async (filterId: string, data: ContentFilterUpdate): Promise<ContentFilter> => {
      // Helper to update filter in sidebar items (including in collections)
      const updateFilterInItems = (
        items: SidebarItemComputed[],
        id: string,
        updates: { name?: string; content_types?: ContentType[] }
      ): SidebarItemComputed[] => {
        return items.map((item) => {
          if (item.type === 'filter' && item.id === id) {
            return { ...item, ...updates }
          }
          if (item.type === 'collection') {
            return {
              ...item,
              items: item.items.map((child) =>
                child.type === 'filter' && child.id === id ? { ...child, ...updates } : child
              ),
            }
          }
          return item
        })
      }

      // Optimistically update sidebar if we have name or content_types changes
      if (sidebar && (data.name || data.content_types)) {
        const optimisticItems = updateFilterInItems(sidebar.items, filterId, {
          name: data.name,
          content_types: data.content_types,
        })
        setSidebarOptimistic(optimisticItems)
      }

      try {
        const result = await storeUpdateFilter(filterId, data)
        // Invalidate queries for this filter since filter expression may have changed
        await invalidateFilterQueries(queryClient, result.id)
        return result
      } catch (error) {
        rollbackSidebar()
        // Re-throw so FilterModal can display the error in its form UI and manage button state.
        // This differs from other handlers that swallow errors and show toasts, because
        // modal-based operations need error propagation for proper form state management.
        throw error
      }
    },
    [sidebar, setSidebarOptimistic, storeUpdateFilter, rollbackSidebar]
  )

  const deleteFilter = useCallback(
    async (filterId: string): Promise<boolean> => {
      // Helper to recursively remove filter from sidebar items (including from collections)
      const removeFilterFromItems = (items: SidebarItemComputed[]): SidebarItemComputed[] => {
        return items
          .filter((item) => !(item.type === 'filter' && item.id === filterId))
          .map((item) => {
            if (item.type === 'collection') {
              return {
                ...item,
                items: item.items.filter((child) => !(child.type === 'filter' && child.id === filterId)),
              } as SidebarCollectionComputed
            }
            return item
          })
      }

      // Optimistically remove from sidebar (instant visual feedback)
      if (sidebar) {
        const optimisticItems = removeFilterFromItems(sidebar.items)
        setSidebarOptimistic(optimisticItems)
      }

      try {
        await storeDeleteFilter(filterId)
        return true
      } catch {
        rollbackSidebar()
        toast.error('Failed to delete filter')
        return false
      }
    },
    [sidebar, setSidebarOptimistic, storeDeleteFilter, rollbackSidebar]
  )

  return {
    createFilter,
    updateFilter,
    deleteFilter,
  }
}
