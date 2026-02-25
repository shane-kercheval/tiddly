/**
 * Inline editable tags component.
 *
 * Displays tags in view-mode style (pills) but allows inline editing.
 * Tags can be removed via X button (visible on hover) and added via tag icon button.
 *
 * Features:
 * - View-mode visual styling (badge pills)
 * - X button on hover to remove tags
 * - Tag icon button to show input and add new tags
 * - Autocomplete dropdown for tag suggestions
 * - Keyboard navigation (arrows, Enter, Escape)
 * - Tab moves to next field (standard form behavior)
 * - Exposes getPendingValue() via ref for form submission
 */
import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react'
import type { ReactNode, KeyboardEvent, ChangeEvent, Ref } from 'react'
import type { TagCount } from '../types'
import { useTagAutocomplete } from '../hooks/useTagAutocomplete'
import { Tag } from './Tag'
import { Tooltip } from './ui'

interface InlineEditableTagsProps {
  /** Currently selected tags */
  value: string[]
  /** Called when tags change */
  onChange: (tags: string[]) => void
  /** Available tags for suggestions */
  suggestions: TagCount[]
  /** Whether the input is disabled */
  disabled?: boolean
  /** Whether to show the inline add button (default: true). Set false when using an external trigger. */
  showAddButton?: boolean
}

/** Exposed methods via ref */
export interface InlineEditableTagsHandle {
  /** Get pending text that hasn't been added as a tag yet */
  getPendingValue: () => string
  /** Clear the pending input */
  clearPending: () => void
  /** Programmatically enter add mode (for external trigger buttons) */
  startAdding: () => void
}

/**
 * InlineEditableTags displays tags as removable pills with inline add capability.
 *
 * Styling uses badge pills with hover state revealing the remove button.
 */
export const InlineEditableTags = forwardRef(function InlineEditableTags(
  { value, onChange, suggestions, disabled = false, showAddButton = true }: InlineEditableTagsProps,
  ref: Ref<InlineEditableTagsHandle>
): ReactNode {
  const [isAddingTag, setIsAddingTag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const {
    inputValue,
    setInputValue,
    showSuggestions,
    highlightedIndex,
    filteredSuggestions,
    error,
    addTag,
    removeTag,
    selectHighlighted,
    moveHighlight,
    openSuggestions,
    closeSuggestions,
    getPendingValue,
    clearPending,
  } = useTagAutocomplete({ value, onChange, suggestions })

  // Ref to track inputValue for click-outside handler (avoids re-registering listener per keystroke)
  const inputValueRef = useRef(inputValue)
  useEffect(() => {
    inputValueRef.current = inputValue
  }, [inputValue])

  // Expose methods via ref for form submission and external triggers
  useImperativeHandle(ref, () => ({
    getPendingValue,
    clearPending,
    startAdding: () => {
      if (!disabled) {
        setIsAddingTag(true)
        openSuggestions()
      }
    },
  }), [getPendingValue, clearPending, disabled, openSuggestions])

  // Focus input when entering add mode
  useEffect(() => {
    if (isAddingTag && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isAddingTag])

  // Close suggestions and exit add mode when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closeSuggestions()
        // Only exit add mode if input is empty
        if (!inputValueRef.current.trim()) {
          setIsAddingTag(false)
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [closeSuggestions])

  const handleAddClick = (): void => {
    if (!disabled) {
      setIsAddingTag(true)
      openSuggestions()
    }
  }

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setInputValue(e.target.value)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveHighlight('down')
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveHighlight('up')
    } else if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      let success: boolean
      if (showSuggestions && highlightedIndex >= 0) {
        success = selectHighlighted()
      } else {
        success = addTag(inputValue)
      }
      // Keep add mode open after adding a tag
      if (success) {
        openSuggestions()
      }
    } else if (e.key === 'Escape') {
      closeSuggestions()
      clearPending()
      setIsAddingTag(false)
    } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
      // Remove last tag on backspace when input is empty
      removeTag(value[value.length - 1])
    }
    // Tab falls through to browser default - moves to next field
  }

  const handleSuggestionClick = (suggestionName: string): void => {
    addTag(suggestionName)
    // Keep input focused for adding more tags
    inputRef.current?.focus()
    openSuggestions()
  }

  return (
    <div ref={containerRef} className="relative inline-flex flex-wrap items-center gap-2">
      {/* Tag pills */}
      {value.map((tag) => (
        <Tag
          key={tag}
          tag={tag}
          onRemove={disabled ? undefined : () => removeTag(tag)}
        />
      ))}

      {/* Add input (shown when in add mode, regardless of showAddButton) */}
      {isAddingTag && !disabled && (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={openSuggestions}
            placeholder="Add tag..."
            className="min-w-[80px] w-24 text-xs px-1.5 py-px bg-gray-50 text-gray-700 border border-gray-200 rounded outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400/20"
          />

          {/* Error message */}
          {error && (
            <div className="absolute left-0 top-full mt-1 z-20">
              <p className="text-xs text-red-500 whitespace-nowrap">{error}</p>
            </div>
          )}

          {/* Suggestions dropdown */}
          {showSuggestions && filteredSuggestions.length > 0 && (
            <div className="absolute left-0 top-full mt-1 z-10 max-h-48 w-48 overflow-auto rounded-lg border border-gray-100 bg-white py-1 shadow-lg">
              {filteredSuggestions.map((suggestion, index) => (
                <button
                  key={suggestion.name}
                  type="button"
                  onClick={() => handleSuggestionClick(suggestion.name)}
                  aria-selected={index === highlightedIndex}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors ${
                    index === highlightedIndex
                      ? 'bg-gray-100 text-gray-900'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <span>{suggestion.name}</span>
                  <span className="text-gray-400">{suggestion.content_count}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Inline add button (only when showAddButton is true and not already adding) */}
      {showAddButton && !isAddingTag && (
        <Tooltip content="Add tag" compact delay={500}>
          <button
            type="button"
            onClick={handleAddClick}
            disabled={disabled}
            className={`inline-flex items-center h-5 px-1 text-gray-500 rounded transition-colors ${
              disabled ? 'cursor-not-allowed' : 'hover:text-gray-700 hover:bg-gray-100'
            }`}
            aria-label="Add tag"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
          </button>
        </Tooltip>
      )}
    </div>
  )
})
