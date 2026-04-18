/**
 * Compact add tag button with dropdown for list view cards.
 *
 * Renders a tag icon button that opens a dropdown with tag autocomplete.
 * Selecting a tag immediately calls onAdd - no form submission needed.
 * Uses useTagAutocomplete hook for all autocomplete logic.
 *
 * When AI is available (Pro tier), the dropdown shows two sections:
 * - "Suggestions" at the top (spinner / items / "No suggestions")
 * - "Your Tags" below (existing tag autocomplete)
 * Section headers only appear when aiAvailable is true.
 */
import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { ReactNode, KeyboardEvent, ChangeEvent } from 'react'
import type { TagCount } from '../types'
import { MAX_DISPLAYED_AI_TAG_SUGGESTIONS } from '../types'
import { useTagAutocomplete } from '../hooks/useTagAutocomplete'
import { Tooltip, DropdownPortal } from './ui'
import type { DropdownPortalHandle } from './ui/DropdownPortal'
import { DROPDOWN_WIDTH } from './ui/dropdownPosition'

interface AddTagButtonProps {
  /** Tags already on this item (excluded from suggestions) */
  existingTags: string[]
  /** Available tags for suggestions */
  suggestions: TagCount[]
  /** Called when a tag is added */
  onAdd: (tag: string) => void
  /** AI-suggested tags to display in the dropdown. */
  aiSuggestions?: string[]
  /** Whether AI tag suggestions are currently loading. */
  isAiLoading?: boolean
  /** Whether AI features are available for the current user's tier. */
  aiAvailable?: boolean
  /** Called when the dropdown opens. */
  onOpen?: () => void
  /** Called when the dropdown closes. */
  onClose?: () => void
}

export function AddTagButton({
  existingTags,
  suggestions,
  onAdd,
  aiSuggestions,
  isAiLoading = false,
  aiAvailable = false,
  onOpen,
  onClose,
}: AddTagButtonProps): ReactNode {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownPortalRef = useRef<DropdownPortalHandle>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Handler that captures the added tag and calls onAdd
  const handleTagsChange = useCallback((newTags: string[]): void => {
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
    moveHighlight,
    openSuggestions,
    closeSuggestions,
    resetHighlight,
    clearPending,
  } = useTagAutocomplete({
    value: existingTags,
    onChange: handleTagsChange,
    suggestions,
  })

  // Two-stage AI suggestion filtering: exclude existing tags, filter by input, cap display count
  const filteredAiSuggestions = useMemo(() => {
    const visible = aiSuggestions?.filter((s) => !existingTags.includes(s)) ?? []
    const filtered = inputValue
      ? visible.filter((s) => s.toLowerCase().includes(inputValue.toLowerCase()))
      : visible
    return filtered.slice(0, MAX_DISPLAYED_AI_TAG_SUGGESTIONS)
  }, [aiSuggestions, existingTags, inputValue])

  // Combined navigation list length for keyboard navigation
  const combinedLength = aiAvailable
    ? filteredAiSuggestions.length + filteredSuggestions.length
    : filteredSuggestions.length

  // Reset highlight when AI suggestions change (async resolve)
  const prevAiLengthRef = useRef(filteredAiSuggestions.length)
  useEffect(() => {
    if (filteredAiSuggestions.length !== prevAiLengthRef.current) {
      prevAiLengthRef.current = filteredAiSuggestions.length
      resetHighlight()
    }
  }, [filteredAiSuggestions.length, resetHighlight])

  const closeDropdown = useCallback((): void => {
    closeSuggestions()
    clearPending()
    setIsOpen(false)
  }, [closeSuggestions, clearPending])

  // Fire onOpen/onClose callbacks
  const prevIsOpenRef = useRef(false)
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current) {
      onOpen?.()
    } else if (!isOpen && prevIsOpenRef.current) {
      onClose?.()
    }
    prevIsOpenRef.current = isOpen
  }, [isOpen, onOpen, onClose])

  // Focus input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
      openSuggestions(aiAvailable || undefined)
    }
  }, [isOpen, openSuggestions, aiAvailable])

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      const target = event.target as Node
      if (containerRef.current?.contains(target) || dropdownPortalRef.current?.contains(target)) {
        return
      }
      closeDropdown()
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen, closeDropdown])

  // Close when mouse leaves both the container and the portaled dropdown.
  // Uses relatedTarget to check if the mouse moved to the portal (no close)
  // or somewhere else (immediate close). This keeps the dropdown lifecycle
  // consistent with the card's hover-driven action buttons.
  const handleContainerMouseLeave = useCallback((e: React.MouseEvent): void => {
    if (!isOpen) return
    const movingTo = e.relatedTarget as Node | null
    if (movingTo && dropdownPortalRef.current?.contains(movingTo)) return
    closeDropdown()
  }, [isOpen, closeDropdown])

  const handlePortalMouseLeave = useCallback((e: React.MouseEvent): void => {
    const movingTo = e.relatedTarget as Node | null
    if (movingTo && containerRef.current?.contains(movingTo)) return
    closeDropdown()
  }, [closeDropdown])

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
      moveHighlight('down', aiAvailable ? combinedLength : undefined)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveHighlight('up', aiAvailable ? combinedLength : undefined)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlightedIndex >= 0) {
        if (aiAvailable && highlightedIndex < filteredAiSuggestions.length) {
          addTag(filteredAiSuggestions[highlightedIndex])
        } else {
          const tagIndex = aiAvailable
            ? highlightedIndex - filteredAiSuggestions.length
            : highlightedIndex
          if (tagIndex >= 0 && tagIndex < filteredSuggestions.length) {
            addTag(filteredSuggestions[tagIndex].name)
          }
        }
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

  const handleAiSuggestionClick = (e: React.MouseEvent, tag: string): void => {
    e.stopPropagation()
    addTag(tag)
  }

  // Stop propagation on the dropdown to prevent card click
  const handleDropdownClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
  }

  // Dropdown open condition
  const isDropdownOpen = aiAvailable
    ? isOpen
    : (showSuggestions && filteredSuggestions.length > 0)

  // Highlighted index for the existing-tags section (offset by AI count)
  const getExistingTagHighlightIndex = (index: number): number =>
    aiAvailable ? index + filteredAiSuggestions.length : index

  // Active descendant for ARIA
  const activeDescendant = highlightedIndex >= 0
    ? `tag-option-${highlightedIndex}`
    : undefined

  return (
    <div ref={containerRef} className="relative inline-flex items-center" onMouseLeave={handleContainerMouseLeave}>
      {!isOpen ? (
        <Tooltip content="Add tag" compact delay={500}>
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
            aria-expanded={isDropdownOpen}
            aria-activedescendant={activeDescendant}
            aria-autocomplete="list"
            aria-controls="tag-listbox"
            className="min-w-[80px] w-24 text-xs px-1.5 py-0.5 bg-gray-50 border border-gray-200 rounded outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400/20"
          />

          {/* Error message */}
          {error && (
            <div className="absolute left-0 md:left-auto md:right-0 top-full mt-1 z-20">
              <p className="text-xs text-red-500 whitespace-nowrap">{error}</p>
            </div>
          )}

          {/* Sectioned dropdown via portal */}
          <DropdownPortal
            ref={dropdownPortalRef}
            anchorRef={inputRef}
            open={isDropdownOpen}
            onMouseLeave={handlePortalMouseLeave}
            dropdownWidth={aiAvailable ? DROPDOWN_WIDTH.TAG_AI : DROPDOWN_WIDTH.TAG}
          >
            <div
              id="tag-listbox"
              role="listbox"
              className="mt-1 overflow-hidden rounded-lg border border-gray-100 bg-white shadow-lg"
              style={{ width: aiAvailable ? DROPDOWN_WIDTH.TAG_AI : DROPDOWN_WIDTH.TAG }}
            >
              {aiAvailable ? (
                <div className="flex">
                  {/* Left column: AI Suggestions */}
                  <div className="max-h-48 overflow-auto border-r border-gray-100 py-1" style={{ width: DROPDOWN_WIDTH.TAG_COLUMN }}>
                    <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400 px-3 py-1">
                      Suggestions
                    </div>

                    {/* Loading spinner */}
                    {isAiLoading && filteredAiSuggestions.length === 0 && (
                      <div className="flex items-center justify-center py-2" aria-label="Loading tag suggestions">
                        <div className="spinner-ai h-4 w-4" />
                      </div>
                    )}

                    {/* No suggestions */}
                    {!isAiLoading && filteredAiSuggestions.length === 0 && (
                      <p className="text-xs text-gray-400 py-2 text-center">No suggestions</p>
                    )}

                    {/* AI suggestion items */}
                    {filteredAiSuggestions.map((tag, index) => (
                      <button
                        key={`ai-${tag}`}
                        id={`tag-option-${index}`}
                        type="button"
                        role="option"
                        tabIndex={-1}
                        onClick={(e) => handleAiSuggestionClick(e, tag)}
                        aria-selected={index === highlightedIndex}
                        aria-label={`Add suggested tag: ${tag}`}
                        className={`flex w-full items-center px-3 py-1.5 text-left text-xs transition-colors ${
                          index === highlightedIndex
                            ? 'bg-gray-100 text-gray-900'
                            : 'text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        <span className="truncate">{tag}</span>
                      </button>
                    ))}
                  </div>

                  {/* Right column: Your Tags */}
                  <div className="max-h-48 overflow-auto py-1" style={{ width: DROPDOWN_WIDTH.TAG_COLUMN }}>
                    <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400 px-3 py-1">
                      Your Tags
                    </div>

                    {filteredSuggestions.map((suggestion, index) => {
                      const combinedIndex = getExistingTagHighlightIndex(index)
                      return (
                        <button
                          key={suggestion.name}
                          id={`tag-option-${combinedIndex}`}
                          type="button"
                          role="option"
                          tabIndex={-1}
                          onClick={(e) => handleSuggestionClick(e, suggestion.name)}
                          aria-selected={combinedIndex === highlightedIndex}
                          className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                            combinedIndex === highlightedIndex
                              ? 'bg-gray-100 text-gray-900'
                              : 'text-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          <span className="truncate">{suggestion.name}</span>
                          <span className="shrink-0 text-gray-400">{suggestion.content_count}</span>
                        </button>
                      )
                    })}

                    {filteredSuggestions.length === 0 && (
                      <div className="px-3 py-1.5 text-xs text-gray-400">
                        {inputValue ? 'No matching tags' : 'No tags yet'}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="max-h-48 overflow-auto py-1">
                  {filteredSuggestions.map((suggestion, index) => (
                    <button
                      key={suggestion.name}
                      id={`tag-option-${index}`}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      onClick={(e) => handleSuggestionClick(e, suggestion.name)}
                      aria-selected={index === highlightedIndex}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                        index === highlightedIndex
                          ? 'bg-gray-100 text-gray-900'
                          : 'text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      <span className="truncate">{suggestion.name}</span>
                      <span className="shrink-0 text-gray-400">{suggestion.content_count}</span>
                    </button>
                  ))}

                  {filteredSuggestions.length === 0 && (
                    <div className="px-3 py-1.5 text-xs text-gray-400">
                      {inputValue ? 'No matching tags' : 'No tags yet'}
                    </div>
                  )}
                </div>
              )}
            </div>
          </DropdownPortal>
        </div>
      )}
    </div>
  )
}
