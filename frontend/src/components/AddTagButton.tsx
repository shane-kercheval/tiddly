/**
 * Compact add tag button with dropdown for list view cards.
 *
 * Renders a tag icon button that opens a dropdown with tag autocomplete.
 * Selecting a tag immediately calls onAdd - no form submission needed.
 * Uses useTagAutocomplete hook for all autocomplete logic.
 */
import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react'
import type { ReactNode, KeyboardEvent, ChangeEvent } from 'react'
import type { TagCount } from '../types'
import { useTagAutocomplete } from '../hooks/useTagAutocomplete'
import { Tooltip } from './ui'

interface AddTagButtonProps {
  /** Tags already on this item (excluded from suggestions) */
  existingTags: string[]
  /** Available tags for suggestions */
  suggestions: TagCount[]
  /** Called when a tag is added */
  onAdd: (tag: string) => void
}

/**
 * AddTagButton displays a compact tag icon button that opens a tag autocomplete dropdown.
 *
 * Behavior:
 * - Click opens dropdown with auto-focused input
 * - Type to filter suggestions or create new tag
 * - Click suggestion or press Enter to add
 * - Arrow keys navigate suggestions
 * - Escape or click outside closes dropdown
 */
export function AddTagButton({
  existingTags,
  suggestions,
  onAdd,
}: AddTagButtonProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false)
  const [openUpward, setOpenUpward] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Handler that captures the added tag and calls onAdd
  const handleTagsChange = useCallback((newTags: string[]): void => {
    // Find the newly added tag (one that's not in existingTags)
    const addedTag = newTags.find((t) => !existingTags.includes(t))
    if (addedTag) {
      onAdd(addedTag)
      setIsOpen(false)
    }
  }, [existingTags, onAdd])

  const {
    inputValue,
    setInputValue,
    showSuggestions,
    highlightedIndex,
    filteredSuggestions,
    error,
    addTag,
    selectHighlighted,
    moveHighlight,
    openSuggestions,
    closeSuggestions,
    clearPending,
  } = useTagAutocomplete({
    value: existingTags,
    onChange: handleTagsChange,
    suggestions,
  })

  const closeDropdown = useCallback((): void => {
    closeSuggestions()
    clearPending()
    setOpenUpward(false)
    setIsOpen(false)
  }, [closeSuggestions, clearPending])

  // Focus input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
      openSuggestions()
    }
  }, [isOpen, openSuggestions])

  // Measure available space and flip dropdown direction if needed
  useLayoutEffect(() => {
    if (isOpen && showSuggestions && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      // 220 ≈ max-h-48 (192px) + border + margin + buffer
      setOpenUpward(spaceBelow < 220)
    }
  }, [isOpen, showSuggestions])

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closeDropdown()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, closeDropdown])

  const handleButtonClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    setIsOpen(true)
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
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (showSuggestions && highlightedIndex >= 0) {
        selectHighlighted()
      } else {
        addTag(inputValue)
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeDropdown()
    }
  }

  const handleSuggestionClick = (e: React.MouseEvent, suggestionName: string): void => {
    e.stopPropagation()
    addTag(suggestionName)
  }

  // Stop propagation on the dropdown to prevent card click
  const handleDropdownClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
  }

  return (
    <div ref={containerRef} className="relative inline-flex items-center">
      {!isOpen ? (
        <Tooltip content="Add tag" compact>
          <button
            type="button"
            onClick={handleButtonClick}
            className="btn-icon"
            aria-label="Add tag"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
          </button>
        </Tooltip>
      ) : (
        <div onClick={handleDropdownClick} className="relative">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Add tag..."
            aria-label="Tag name"
            className="min-w-[80px] w-24 text-xs px-1.5 py-0.5 bg-gray-50 border border-gray-200 rounded outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400/20"
          />

          {/* Error message */}
          {error && (
            <div className={`absolute left-0 md:left-auto md:right-0 z-20 ${openUpward ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
              <p className="text-xs text-red-500 whitespace-nowrap">{error}</p>
            </div>
          )}

          {/* Suggestions dropdown */}
          {showSuggestions && filteredSuggestions.length > 0 && (
            <div className={`absolute left-0 md:left-auto md:right-0 z-10 max-h-48 w-48 overflow-auto rounded-lg border border-gray-100 bg-white py-1 shadow-lg ${openUpward ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
              {filteredSuggestions.map((suggestion, index) => (
                <button
                  key={suggestion.name}
                  type="button"
                  onClick={(e) => handleSuggestionClick(e, suggestion.name)}
                  aria-selected={index === highlightedIndex}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors ${
                    index === highlightedIndex
                      ? 'bg-gray-100 text-gray-900'
                      : 'text-gray-600 hover:bg-gray-100'
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
    </div>
  )
}
