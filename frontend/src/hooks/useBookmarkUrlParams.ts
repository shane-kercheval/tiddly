/**
 * Hook for managing bookmark URL parameters.
 *
 * Handles:
 * - Parsing search, sort, and pagination params from URL
 * - Providing typed updateParams function with smart defaults
 *
 * Note: Tag filters are managed separately by useTagFilterStore for persistence
 * across navigation.
 */
import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

export type SortByOption = 'created_at' | 'updated_at' | 'last_used_at' | 'title'
export type SortOrderOption = 'asc' | 'desc'

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

  // Parse URL params with defaults
  const searchQuery = searchParams.get('q') || ''
  const sortBy = (searchParams.get('sort_by') as SortByOption) || 'created_at'
  const sortOrder = (searchParams.get('sort_order') as SortOrderOption) || 'desc'
  const offset = parseInt(searchParams.get('offset') || '0', 10)

  // Update URL params with smart defaults (removes default values from URL)
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

      if ('sort_by' in updates) {
        if (updates.sort_by && updates.sort_by !== 'created_at') {
          newParams.set('sort_by', updates.sort_by)
        } else {
          newParams.delete('sort_by')
        }
      }

      if ('sort_order' in updates) {
        if (updates.sort_order && updates.sort_order !== 'desc') {
          newParams.set('sort_order', updates.sort_order)
        } else {
          newParams.delete('sort_order')
        }
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
    [searchParams, setSearchParams]
  )

  return {
    searchQuery,
    sortBy,
    sortOrder,
    offset,
    updateParams,
  }
}
