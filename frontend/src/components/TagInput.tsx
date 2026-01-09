/**
 * Tag input component with autocomplete suggestions.
 *
 * Form-style tag input with chips and dropdown autocomplete.
 * For inline view-style tags, see InlineEditableTags.
 */
import { useRef, useEffect, useImperativeHandle, forwardRef } from 'react'
import type { ReactNode, KeyboardEvent, ChangeEvent, Ref } from 'react'
import type { TagCount } from '../types'
import { useTagAutocomplete } from '../hooks/useTagAutocomplete'

interface TagInputProps {
  /** Currently selected tags */
  value: string[]
  /** Called when tags change */
  onChange: (tags: string[]) => void
  /** Available tags for suggestions */
  suggestions: TagCount[]
  /** Placeholder text */
  placeholder?: string
  /** Whether the input is disabled */
  disabled?: boolean
  /** ID for the input element */
  id?: string
  /** Error message to display */
  error?: string
}

/** Exposed methods via ref */
export interface TagInputHandle {
  /** Get pending text that hasn't been added as a tag yet */
  getPendingValue: () => string
  /** Clear the pending input */
  clearPending: () => void
}

/**
 * TagInput component with autocomplete and chip display.
 *
 * Features:
 * - Type to filter suggestions
 * - Click or Enter to select a suggestion
 * - Type a new tag and press Enter or comma to add it
 * - Click X on chips to remove tags
 * - Tab to select first suggestion
 * - Exposes getPendingValue() via ref for form submission
 */
export const TagInput = forwardRef(function TagInput(
  {
    value,
    onChange,
    suggestions,
    placeholder = 'Add tags...',
    disabled = false,
    id,
    error: externalError,
  }: TagInputProps,
  ref: Ref<TagInputHandle>
): ReactNode {
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const {
    inputValue,
    setInputValue,
    showSuggestions,
    highlightedIndex,
    filteredSuggestions,
    error: localError,
    addTag,
    removeTag,
    selectHighlighted,
    moveHighlight,
    openSuggestions,
    closeSuggestions,
    getPendingValue,
    clearPending,
  } = useTagAutocomplete({ value, onChange, suggestions })

  // Expose methods via ref for form submission
  useImperativeHandle(ref, () => ({
    getPendingValue,
    clearPending,
  }), [getPendingValue, clearPending])

  // Close suggestions when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closeSuggestions()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [closeSuggestions])

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setInputValue(e.target.value)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (highlightedIndex >= 0 && highlightedIndex < filteredSuggestions.length) {
        selectHighlighted()
      } else if (inputValue.trim()) {
        addTag(inputValue)
      }
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      removeTag(value[value.length - 1])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveHighlight('down')
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveHighlight('up')
    } else if (e.key === 'Escape') {
      closeSuggestions()
    }
    // Tab falls through to browser default - moves to next field
  }

  const displayError = externalError || localError

  return (
    <div ref={containerRef} className="relative">
      {/* Selected tags and input */}
      <div
        className={`flex min-h-[42px] flex-wrap gap-1.5 rounded-lg border px-3 py-2 transition-all ${
          displayError
            ? 'border-red-200 bg-red-50/50 focus-within:border-red-300 focus-within:ring-red-500/10'
            : 'border-gray-200 bg-gray-50/50 focus-within:border-gray-300 focus-within:bg-white focus-within:ring-gray-900/5'
        } focus-within:ring-2`}
        onClick={() => inputRef.current?.focus()}
      >
        {/* Tag chips */}
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-md bg-blue-50 border border-blue-100 px-2 py-0.5 text-xs font-medium text-blue-600"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                removeTag(tag)
              }}
              disabled={disabled}
              className="rounded p-0.5 hover:bg-blue-100 focus:outline-none transition-colors"
              aria-label={`Remove tag ${tag}`}
            >
              <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </span>
        ))}

        {/* Input */}
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={openSuggestions}
          placeholder={value.length === 0 ? placeholder : ''}
          disabled={disabled}
          className="min-w-[100px] flex-1 border-none bg-transparent p-0 text-sm outline-none placeholder:text-gray-400"
        />
      </div>

      {/* Error message */}
      {displayError && (
        <p className="mt-1.5 text-sm text-red-500">{displayError}</p>
      )}

      {/* Suggestions dropdown */}
      {showSuggestions && filteredSuggestions.length > 0 && (
        <div className="absolute z-10 mt-1.5 max-h-60 w-full overflow-auto rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
          {filteredSuggestions.map((suggestion, index) => (
            <button
              key={suggestion.name}
              type="button"
              onClick={() => addTag(suggestion.name)}
              aria-selected={index === highlightedIndex}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                index === highlightedIndex
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span>{suggestion.name}</span>
              <span className="text-xs text-gray-400">{suggestion.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
})
