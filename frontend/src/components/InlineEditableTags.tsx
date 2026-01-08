/**
 * Inline editable tags component.
 *
 * Displays tags in view-mode style (pills) but allows inline editing.
 * Tags can be removed via X button (visible on hover) and added via "+" button.
 *
 * Features:
 * - View-mode visual styling (matches NoteView/PromptView)
 * - X button on hover to remove tags
 * - "+" button to show input and add new tags
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

interface InlineEditableTagsProps {
  /** Currently selected tags */
  value: string[]
  /** Called when tags change */
  onChange: (tags: string[]) => void
  /** Available tags for suggestions */
  suggestions: TagCount[]
  /** Whether the input is disabled */
  disabled?: boolean
}

/** Exposed methods via ref */
export interface InlineEditableTagsHandle {
  /** Get pending text that hasn't been added as a tag yet */
  getPendingValue: () => string
  /** Clear the pending input */
  clearPending: () => void
}

/**
 * InlineEditableTags displays tags as removable pills with inline add capability.
 *
 * Styling matches the view-mode tag appearance from NoteView/PromptView,
 * with hover state revealing the remove button.
 */
export const InlineEditableTags = forwardRef(function InlineEditableTags(
  { value, onChange, suggestions, disabled = false }: InlineEditableTagsProps,
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

  // Expose methods via ref for form submission
  useImperativeHandle(ref, () => ({
    getPendingValue,
    clearPending,
  }), [getPendingValue, clearPending])

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
    <div ref={containerRef} className="relative inline-flex flex-wrap items-center gap-2 py-1">
      {/* Tag pills */}
      {value.map((tag) => (
        <Tag
          key={tag}
          tag={tag}
          onRemove={disabled ? undefined : () => removeTag(tag)}
        />
      ))}

      {/* Add button or input */}
      {!disabled && (
        <>
          {isAddingTag ? (
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onFocus={openSuggestions}
                placeholder="Add tag..."
                className="min-w-[80px] w-24 text-xs px-1.5 py-0.5 bg-gray-50 border border-gray-200 rounded outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400/20"
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
                      <span className="text-gray-400">{suggestion.count}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={handleAddClick}
              className="inline-flex items-center gap-0.5 h-5 px-1 text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
              aria-label="Add tag"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>Tags</span>
            </button>
          )}
        </>
      )}
    </div>
  )
})
