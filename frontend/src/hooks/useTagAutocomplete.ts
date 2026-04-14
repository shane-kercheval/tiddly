/**
 * Hook for tag autocomplete logic.
 *
 * Provides reusable autocomplete state and actions for tag input components.
 * Used by both TagInput (form style) and InlineEditableTags (inline style).
 *
 * Exposes primitives (state + actions) rather than opinionated handlers,
 * allowing consuming components to compose their own keyboard handling.
 */
import { useState, useMemo, useCallback } from 'react'
import type { TagCount } from '../types'
import { validateTag } from '../utils'

interface UseTagAutocompleteProps {
  /** Currently selected tags */
  value: string[]
  /** Called when tags change */
  onChange: (tags: string[]) => void
  /** Available tags for suggestions */
  suggestions: TagCount[]
}

interface UseTagAutocompleteReturn {
  // State
  /** Current input value */
  inputValue: string
  /** Set the input value */
  setInputValue: (value: string) => void
  /** Whether to show the suggestions dropdown */
  showSuggestions: boolean
  /** Currently highlighted suggestion index (-1 = none) */
  highlightedIndex: number
  /** Filtered suggestions based on input and already-selected tags */
  filteredSuggestions: TagCount[]
  /** Current validation error message, or null */
  error: string | null

  // Actions
  /** Add a tag. Returns true if successful, false if validation failed. */
  addTag: (tag: string) => boolean
  /** Remove a tag from the selected list */
  removeTag: (tag: string) => void
  /** Select the currently highlighted suggestion */
  selectHighlighted: () => boolean
  /** Move the highlight up or down. When itemCount is provided, it overrides
   *  the internal filteredSuggestions.length for bounds and skips the
   *  showSuggestions guard — the component controls visibility. */
  moveHighlight: (direction: 'up' | 'down', itemCount?: number) => void
  /** Open the suggestions dropdown. When force is true, opens unconditionally
   *  (even with no filtered suggestions or input). Returns true if opened. */
  openSuggestions: (force?: boolean) => boolean
  /** Close the suggestions dropdown and reset highlight */
  closeSuggestions: () => void
  /** Reset highlighted index to -1 without affecting dropdown visibility */
  resetHighlight: () => void
  /** Get the current pending (uncommitted) input value */
  getPendingValue: () => string
  /** Clear the pending input */
  clearPending: () => void
  /** Clear the error state */
  clearError: () => void
}

/**
 * Hook providing tag autocomplete logic for reuse across components.
 *
 * Usage:
 * ```tsx
 * const {
 *   inputValue, setInputValue, showSuggestions, highlightedIndex,
 *   filteredSuggestions, error, addTag, removeTag, moveHighlight,
 *   selectHighlighted, openSuggestions, closeSuggestions
 * } = useTagAutocomplete({ value, onChange, suggestions })
 *
 * const handleKeyDown = (e: KeyboardEvent) => {
 *   if (e.key === 'ArrowDown') { moveHighlight('down'); e.preventDefault() }
 *   else if (e.key === 'ArrowUp') { moveHighlight('up'); e.preventDefault() }
 *   else if (e.key === 'Enter') {
 *     e.preventDefault()
 *     if (showSuggestions && highlightedIndex >= 0) selectHighlighted()
 *     else addTag(inputValue)
 *   }
 *   else if (e.key === 'Escape') closeSuggestions()
 * }
 * ```
 */
export function useTagAutocomplete({
  value,
  onChange,
  suggestions,
}: UseTagAutocompleteProps): UseTagAutocompleteReturn {
  const [inputValue, setInputValueInternal] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [error, setError] = useState<string | null>(null)

  // Filter suggestions: exclude already selected tags and match input
  const filteredSuggestions = useMemo(() => {
    return suggestions.filter(
      (suggestion) =>
        !value.includes(suggestion.name) &&
        suggestion.name.toLowerCase().includes(inputValue.toLowerCase())
    )
  }, [suggestions, value, inputValue])

  // Wrapper for setInputValue that also manages suggestions visibility
  const setInputValue = useCallback((newValue: string): void => {
    setInputValueInternal(newValue)
    setError(null)
    // Show suggestions while user is typing; openSuggestions handles focus case
    setShowSuggestions(newValue.length > 0)
    setHighlightedIndex(-1)
  }, [])

  // Add a tag with validation
  const addTag = useCallback(
    (tag: string): boolean => {
      const normalized = tag.toLowerCase().trim()
      if (!normalized) return false

      const validationError = validateTag(normalized)
      if (validationError) {
        setError(validationError)
        return false
      }

      // Don't add duplicates
      if (value.includes(normalized)) {
        setError('Tag already added')
        return false
      }

      onChange([...value, normalized])
      setInputValueInternal('')
      setError(null)
      setShowSuggestions(false)
      setHighlightedIndex(-1)
      return true
    },
    [value, onChange]
  )

  // Remove a tag (only calls onChange if tag exists)
  const removeTag = useCallback(
    (tagToRemove: string): void => {
      if (value.includes(tagToRemove)) {
        onChange(value.filter((tag) => tag !== tagToRemove))
      }
    },
    [value, onChange]
  )

  // Select the highlighted suggestion
  const selectHighlighted = useCallback((): boolean => {
    if (highlightedIndex >= 0 && highlightedIndex < filteredSuggestions.length) {
      return addTag(filteredSuggestions[highlightedIndex].name)
    }
    return false
  }, [highlightedIndex, filteredSuggestions, addTag])

  // Move highlight up or down. When itemCount is provided, the component owns
  // the total navigable item count (e.g. AI suggestions + existing tags) and
  // the showSuggestions guard is skipped — the component controls visibility
  // via the portal open prop.
  const moveHighlight = useCallback(
    (direction: 'up' | 'down', itemCount?: number): void => {
      const total = itemCount ?? filteredSuggestions.length
      if (total === 0) return
      if (itemCount === undefined && !showSuggestions) return

      setHighlightedIndex((prev) => {
        if (direction === 'down') {
          return prev < total - 1 ? prev + 1 : prev
        } else {
          return prev > 0 ? prev - 1 : prev
        }
      })
    },
    [showSuggestions, filteredSuggestions.length]
  )

  // Open suggestions dropdown. When force is true, opens unconditionally —
  // used when AI suggestions should be visible even with no existing tag matches.
  const openSuggestions = useCallback((force?: boolean): boolean => {
    if (force || filteredSuggestions.length > 0 || inputValue.length > 0) {
      setShowSuggestions(true)
      return true
    }
    return false
  }, [filteredSuggestions.length, inputValue.length])

  // Close suggestions dropdown and reset highlight
  const closeSuggestions = useCallback((): void => {
    setShowSuggestions(false)
    setHighlightedIndex(-1)
  }, [])

  // Reset highlight without affecting dropdown visibility
  const resetHighlight = useCallback((): void => {
    setHighlightedIndex(-1)
  }, [])

  // Get pending value for form submission
  const getPendingValue = useCallback((): string => {
    return inputValue.trim()
  }, [inputValue])

  // Clear pending input
  const clearPending = useCallback((): void => {
    setInputValueInternal('')
    setError(null)
  }, [])

  // Clear error
  const clearError = useCallback((): void => {
    setError(null)
  }, [])

  return {
    // State
    inputValue,
    setInputValue,
    showSuggestions,
    highlightedIndex,
    filteredSuggestions,
    error,
    // Actions
    addTag,
    removeTag,
    selectHighlighted,
    moveHighlight,
    openSuggestions,
    closeSuggestions,
    resetHighlight,
    getPendingValue,
    clearPending,
    clearError,
  }
}
