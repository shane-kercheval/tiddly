/**
 * Hook for content search with debounced input and keyboard navigation.
 *
 * Analogous to useTagAutocomplete but hits the content API.
 * Filters results to exclude self and already-linked items.
 * Returns primitives (state + actions) for consuming components to compose.
 */
import { useState, useMemo, useCallback } from 'react'
import { useDebouncedValue } from './useDebouncedValue'
import { useContentQuery } from './useContentQuery'
import type { ContentListItem } from '../types'

interface UseContentSearchProps {
  /** Key identifying the source item (e.g. "note:abc-123") to exclude from results */
  sourceKey: string
  /** Set of "type:id" keys for already-linked items to exclude from results */
  excludeKeys: Set<string>
  /** Whether the search is currently active */
  enabled: boolean
}

interface UseContentSearchReturn {
  // State
  /** Current input value */
  inputValue: string
  /** Set the input value */
  setInputValue: (value: string) => void
  /** Whether to show the dropdown */
  showDropdown: boolean
  /** Currently highlighted result index (-1 = none) */
  highlightedIndex: number
  /** Filtered search results */
  results: ContentListItem[]
  /** Whether a search is in progress */
  isSearching: boolean

  // Actions
  /** Select a specific item. Returns the item for the caller to use for mutation. */
  selectItem: (item: ContentListItem) => ContentListItem
  /** Select the currently highlighted item. Returns the item or null if nothing highlighted. */
  selectHighlighted: () => ContentListItem | null
  /** Move the highlight up or down */
  moveHighlight: (direction: 'up' | 'down') => void
  /** Reset all state (input, dropdown, highlight) */
  reset: () => void
  /** Open the dropdown */
  openDropdown: () => void
  /** Close the dropdown and reset highlight */
  closeDropdown: () => void
}

export function useContentSearch({
  sourceKey,
  excludeKeys,
  enabled,
}: UseContentSearchProps): UseContentSearchReturn {
  const [inputValue, setInputValueInternal] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  const debouncedQuery = useDebouncedValue(inputValue, 300)

  const { data, isFetching } = useContentQuery(
    { q: debouncedQuery, limit: 20, view: 'active' },
    { enabled: enabled && debouncedQuery.length >= 1 },
  )

  const rawItems = data?.items
  // Filter out self and already-linked items
  const results = useMemo(() => {
    if (!rawItems) return []
    return rawItems.filter((item) => {
      const key = `${item.type}:${item.id}`
      if (key === sourceKey) return false
      if (excludeKeys.has(key)) return false
      return true
    })
  }, [rawItems, sourceKey, excludeKeys])

  const setInputValue = useCallback((value: string): void => {
    setInputValueInternal(value)
    setShowDropdown(value.length > 0)
    setHighlightedIndex(-1)
  }, [])

  const selectItem = useCallback((item: ContentListItem): ContentListItem => {
    setInputValueInternal('')
    setShowDropdown(false)
    setHighlightedIndex(-1)
    return item
  }, [])

  const selectHighlighted = useCallback((): ContentListItem | null => {
    if (highlightedIndex >= 0 && highlightedIndex < results.length) {
      return selectItem(results[highlightedIndex])
    }
    return null
  }, [highlightedIndex, results, selectItem])

  const moveHighlight = useCallback(
    (direction: 'up' | 'down'): void => {
      if (!showDropdown || results.length === 0) return
      setHighlightedIndex((prev) => {
        if (direction === 'down') {
          return prev < results.length - 1 ? prev + 1 : prev
        } else {
          return prev > 0 ? prev - 1 : prev
        }
      })
    },
    [showDropdown, results.length],
  )

  const reset = useCallback((): void => {
    setInputValueInternal('')
    setShowDropdown(false)
    setHighlightedIndex(-1)
  }, [])

  const openDropdown = useCallback((): void => {
    setShowDropdown(true)
  }, [])

  const closeDropdown = useCallback((): void => {
    setShowDropdown(false)
    setHighlightedIndex(-1)
  }, [])

  return {
    inputValue,
    setInputValue,
    showDropdown,
    highlightedIndex,
    results,
    isSearching: isFetching,
    selectItem,
    selectHighlighted,
    moveHighlight,
    reset,
    openDropdown,
    closeDropdown,
  }
}
