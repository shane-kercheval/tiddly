/**
 * Hook for managing bookmark URL parameters.
 *
 * Handles:
 * - Parsing search, sort, and pagination params from URL
 * - Providing typed updateParams function with smart defaults
 *
 * Note: Tag filters are managed separately by useTagFilterStore for persistence
 * across navigation. Sort preferences are stored in uiPreferencesStore for
 * persistence across navigation.
 */
import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useUIPreferencesStore } from '../stores/uiPreferencesStore'
import type { SortByOption, SortOrderOption } from '../stores/uiPreferencesStore'

export type { SortByOption, SortOrderOption }

export interface BookmarkUrlParams {
  searchQuery: string
  sortBy: SortByOption
  sortOrder: SortOrderOption
  offset: number
}

export interface BookmarkUrlParamUpdates {
  q?: string
  sort_by?: SortByOption
  sort_order?: SortOrderOption
  offset?: number
}

export interface UseBookmarkUrlParamsReturn extends BookmarkUrlParams {
  /** Update one or more URL params. Handles default value optimization. */
  updateParams: (updates: BookmarkUrlParamUpdates) => void
}

/**
 * Hook for managing bookmark URL parameters.
 *
 * Usage:
 * ```tsx
 * const { searchQuery, sortBy, updateParams } = useBookmarkUrlParams()
 *
 * // Update search
 * updateParams({ q: 'react hooks' })
 *
 * // Update multiple params
 * updateParams({ sort_by: 'title', sort_order: 'asc' })
 *
 * // Clear search (removes from URL rather than storing empty string)
 * updateParams({ q: '' })
 * ```
 */
export function useBookmarkUrlParams(): UseBookmarkUrlParamsReturn {
  const [searchParams, setSearchParams] = useSearchParams()

  // Get persisted sort preferences from store (defaults to last_used_at desc)
  const storedSortBy = useUIPreferencesStore((state) => state.bookmarkSortBy)
  const storedSortOrder = useUIPreferencesStore((state) => state.bookmarkSortOrder)
  const setBookmarkSort = useUIPreferencesStore((state) => state.setBookmarkSort)

  // Parse URL params with defaults from store
  const searchQuery = searchParams.get('q') || ''
  const sortBy = (searchParams.get('sort_by') as SortByOption) || storedSortBy
  const sortOrder = (searchParams.get('sort_order') as SortOrderOption) || storedSortOrder
  const offset = parseInt(searchParams.get('offset') || '0', 10)

  // Update URL params and persist sort preferences to store
  const updateParams = useCallback(
    (updates: BookmarkUrlParamUpdates) => {
      const newParams = new URLSearchParams(searchParams)

      if ('q' in updates) {
        if (updates.q) {
          newParams.set('q', updates.q)
        } else {
          newParams.delete('q')
        }
      }

      // When sort changes, persist to store and update URL
      if ('sort_by' in updates || 'sort_order' in updates) {
        const newSortBy = updates.sort_by ?? sortBy
        const newSortOrder = updates.sort_order ?? sortOrder

        // Persist to store for navigation retention
        setBookmarkSort(newSortBy, newSortOrder)

        // Always set in URL when explicitly changed
        newParams.set('sort_by', newSortBy)
        newParams.set('sort_order', newSortOrder)
      }

      if ('offset' in updates) {
        if (updates.offset && updates.offset > 0) {
          newParams.set('offset', String(updates.offset))
        } else {
          newParams.delete('offset')
        }
      }

      setSearchParams(newParams, { replace: true })
    },
    [searchParams, setSearchParams, sortBy, sortOrder, setBookmarkSort]
  )

  return {
    searchQuery,
    sortBy,
    sortOrder,
    offset,
    updateParams,
  }
}
