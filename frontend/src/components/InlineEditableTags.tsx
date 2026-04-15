/**
 * Inline editable tags component.
 *
 * Displays tags in view-mode style (pills) but allows inline editing.
 * Tags can be removed via X button (visible on hover) and added via tag icon button.
 *
 * When AI is available (Pro tier), the dropdown shows two columns:
 * - "Suggestions" on the left (spinner / items / "No suggestions")
 * - "Your Tags" on the right (existing tag autocomplete)
 * When AI is not available, shows a single-column dropdown of existing tags.
 *
 * Features:
 * - View-mode visual styling (badge pills)
 * - X button on hover to remove tags
 * - Tag icon button to show input and add new tags
 * - Keyboard navigation (arrows, Enter, Escape)
 * - Tab moves to next field (standard form behavior)
 * - Exposes getPendingValue() via ref for form submission
 */
import { useState, useRef, useEffect, useImperativeHandle, forwardRef, useCallback, useMemo } from 'react'
import type { ReactNode, KeyboardEvent, ChangeEvent, Ref } from 'react'
import type { TagCount } from '../types'
import { MAX_DISPLAYED_AI_TAG_SUGGESTIONS } from '../types'
import { useTagAutocomplete } from '../hooks/useTagAutocomplete'
import { Tag } from './Tag'
import { Tooltip, DropdownPortal } from './ui'
import type { DropdownPortalHandle } from './ui/DropdownPortal'

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
  /** AI-suggested tags to display in the dropdown. */
  aiSuggestions?: string[]
  /** Whether AI tag suggestions are currently loading. */
  isAiLoading?: boolean
  /** Whether AI features are available for the current user's tier. */
  aiAvailable?: boolean
  /** Called when the tag input opens (isAddingTag becomes true). */
  onOpen?: () => void
  /** Called when the tag input closes (isAddingTag becomes false). */
  onClose?: () => void
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

export const InlineEditableTags = forwardRef(function InlineEditableTags(
  {
    value,
    onChange,
    suggestions,
    disabled = false,
    showAddButton = true,
    aiSuggestions,
    isAiLoading = false,
    aiAvailable = false,
    onOpen,
    onClose,
  }: InlineEditableTagsProps,
  ref: Ref<InlineEditableTagsHandle>
): ReactNode {
  const [isAddingTag, setIsAddingTag] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const dropdownPortalRef = useRef<DropdownPortalHandle>(null)

  const {
    inputValue,
    setInputValue,
    showSuggestions,
    highlightedIndex,
    filteredSuggestions,
    error,
    addTag,
    removeTag,
    moveHighlight,
    openSuggestions,
    closeSuggestions,
    resetHighlight,
    getPendingValue,
    clearPending,
  } = useTagAutocomplete({ value, onChange, suggestions })

  // Two-stage AI suggestion filtering: exclude selected tags, filter by input, cap display count
  const filteredAiSuggestions = useMemo(() => {
    const visible = aiSuggestions?.filter((s) => !value.includes(s)) ?? []
    const filtered = inputValue
      ? visible.filter((s) => s.toLowerCase().includes(inputValue.toLowerCase()))
      : visible
    return filtered.slice(0, MAX_DISPLAYED_AI_TAG_SUGGESTIONS)
  }, [aiSuggestions, value, inputValue])

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

  // Ref to track inputValue for click-outside handler (avoids re-registering listener per keystroke)
  const inputValueRef = useRef(inputValue)
  useEffect(() => {
    inputValueRef.current = inputValue
  }, [inputValue])

  // Fire onOpen/onClose callbacks when isAddingTag changes
  const prevIsAddingRef = useRef(false)
  useEffect(() => {
    if (isAddingTag && !prevIsAddingRef.current) {
      onOpen?.()
    } else if (!isAddingTag && prevIsAddingRef.current) {
      onClose?.()
    }
    prevIsAddingRef.current = isAddingTag
  }, [isAddingTag, onOpen, onClose])

  const exitAddMode = useCallback(() => {
    setIsAddingTag(false)
  }, [])

  // Expose methods via ref for form submission and external triggers
  useImperativeHandle(ref, () => ({
    getPendingValue,
    clearPending,
    startAdding: () => {
      if (!disabled) {
        setIsAddingTag(true)
        openSuggestions(aiAvailable || undefined)
      }
    },
  }), [getPendingValue, clearPending, disabled, openSuggestions, aiAvailable])

  // Focus input when entering add mode
  useEffect(() => {
    if (isAddingTag && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isAddingTag])

  // Close suggestions and exit add mode when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      const target = event.target as Node
      // Ignore clicks inside the component or inside the portaled dropdown
      if (containerRef.current?.contains(target) || dropdownPortalRef.current?.contains(target)) {
        return
      }
      closeSuggestions()
      // Only exit add mode if input is empty
      if (!inputValueRef.current.trim()) {
        exitAddMode()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [closeSuggestions, exitAddMode])

  const handleAddClick = (): void => {
    if (!disabled) {
      setIsAddingTag(true)
      openSuggestions(aiAvailable || undefined)
    }
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
    } else if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      let success: boolean
      if (highlightedIndex >= 0) {
        if (aiAvailable && highlightedIndex < filteredAiSuggestions.length) {
          success = addTag(filteredAiSuggestions[highlightedIndex])
        } else {
          const tagIndex = aiAvailable
            ? highlightedIndex - filteredAiSuggestions.length
            : highlightedIndex
          success = tagIndex >= 0 && tagIndex < filteredSuggestions.length
            ? addTag(filteredSuggestions[tagIndex].name)
            : false
        }
      } else {
        success = addTag(inputValue)
      }
      // Keep add mode open after adding a tag
      if (success) {
        openSuggestions(aiAvailable || undefined)
      }
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      closeSuggestions()
      clearPending()
      exitAddMode()
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
    openSuggestions(aiAvailable || undefined)
  }

  const handleAiSuggestionClick = (tag: string): void => {
    addTag(tag)
    inputRef.current?.focus()
    openSuggestions(aiAvailable || undefined)
  }

  // Dropdown open condition: open for existing suggestions OR when AI is available in add mode
  const isDropdownOpen = (showSuggestions && filteredSuggestions.length > 0) || (aiAvailable && isAddingTag)

  // Highlighted index for the existing-tags section (offset by AI count)
  const getExistingTagHighlightIndex = (index: number): number =>
    aiAvailable ? index + filteredAiSuggestions.length : index

  // Active descendant for ARIA
  const activeDescendant = highlightedIndex >= 0
    ? `inline-tag-option-${highlightedIndex}`
    : undefined

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
            onFocus={() => openSuggestions(aiAvailable || undefined)}
            placeholder="Add tag..."
            aria-expanded={isDropdownOpen}
            aria-activedescendant={activeDescendant}
            aria-autocomplete="list"
            aria-controls="inline-tag-listbox"
            className="min-w-[80px] w-24 text-xs px-1.5 py-px bg-gray-50 text-gray-700 border border-gray-200 rounded outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400/20"
          />

          {/* Error message */}
          {error && (
            <div className="absolute left-0 top-full mt-1 z-20">
              <p className="text-xs text-red-500 whitespace-nowrap">{error}</p>
            </div>
          )}

          {/* Dropdown via portal */}
          <DropdownPortal
            ref={dropdownPortalRef}
            anchorRef={inputRef}
            open={isDropdownOpen}
            align="left"
          >
            <div
              id="inline-tag-listbox"
              role="listbox"
              className={`mt-1 overflow-hidden rounded-lg border border-gray-100 bg-white shadow-lg ${
                aiAvailable ? 'w-[340px]' : 'w-[170px]'
              }`}
            >
              {aiAvailable ? (
                <div className="flex">
                  {/* Left column: Suggestions */}
                  <div className="w-[170px] max-h-48 overflow-auto border-r border-gray-100 py-1">
                    <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400 px-3 py-1">
                      Suggestions
                    </div>

                    {isAiLoading && filteredAiSuggestions.length === 0 && (
                      <div className="flex items-center justify-center py-2" aria-label="Loading tag suggestions">
                        <div className="h-4 w-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                      </div>
                    )}

                    {!isAiLoading && filteredAiSuggestions.length === 0 && (
                      <div className="px-3 py-1.5 text-xs text-gray-400">No suggestions</div>
                    )}

                    {filteredAiSuggestions.map((tag, index) => (
                      <button
                        key={`ai-${tag}`}
                        id={`inline-tag-option-${index}`}
                        type="button"
                        role="option"
                        tabIndex={-1}
                        onClick={() => handleAiSuggestionClick(tag)}
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
                  <div className="w-[170px] max-h-48 overflow-auto py-1">
                    <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400 px-3 py-1">
                      Your Tags
                    </div>

                    {filteredSuggestions.map((suggestion, index) => {
                      const combinedIndex = getExistingTagHighlightIndex(index)
                      return (
                        <button
                          key={suggestion.name}
                          id={`inline-tag-option-${combinedIndex}`}
                          type="button"
                          role="option"
                          tabIndex={-1}
                          onClick={() => handleSuggestionClick(suggestion.name)}
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
                      id={`inline-tag-option-${index}`}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      onClick={() => handleSuggestionClick(suggestion.name)}
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
