/**
 * LinkedContentChips - Inline chip display + inline search for linked content.
 *
 * Stateless display + search component. The parent owns the relationship state
 * and provides items + callbacks. No API calls are made by this component.
 *
 * Designed to sit in the metadata row alongside tags, auto-archive, etc.
 * Each chip shows a content type icon + title, colored by type.
 * Exposes startAdding() via ref for external triggers (same pattern as InlineEditableTags).
 */
import { useState, useRef, useEffect, useImperativeHandle, forwardRef, useMemo } from 'react'
import type { ReactNode, KeyboardEvent, ChangeEvent, Ref } from 'react'
import { useContentSearch } from '../hooks/useContentSearch'
import { LinkIcon } from './icons'
import { Tooltip } from './ui'
import { CONTENT_TYPE_ICONS, CONTENT_TYPE_LABELS, CONTENT_TYPE_ICON_COLORS } from '../constants/contentTypeStyles'
import type { ContentListItem, ContentType } from '../types'
import type { LinkedItem } from '../utils/relationships'

interface LinkedContentChipsProps {
  contentType: ContentType
  contentId: string | null  // null in create mode
  /** Display items (resolved by parent from relationship state) */
  items: LinkedItem[]
  /** Called when user selects an item from search to add */
  onAdd: (item: ContentListItem) => void
  /** Called when user clicks remove on a chip */
  onRemove: (item: LinkedItem) => void
  onNavigate?: (item: LinkedItem) => void
  disabled?: boolean
  /** Whether to show the inline add button (default: true). Set false when using an external trigger. */
  showAddButton?: boolean
}

/** Exposed methods via ref */
export interface LinkedContentChipsHandle {
  /** Programmatically enter add mode (for external trigger buttons) */
  startAdding: () => void
}

/** Chip style per content type: light background + text color + border */
const CHIP_STYLES: Record<ContentType, string> = {
  bookmark: 'bg-brand-bookmark-light text-brand-bookmark border-brand-bookmark/20',
  note: 'bg-brand-note-light text-brand-note border-brand-note/20',
  prompt: 'bg-brand-prompt-light text-brand-prompt border-brand-prompt/20',
}

export const LinkedContentChips = forwardRef(function LinkedContentChips(
  {
    contentType,
    contentId,
    items,
    onAdd,
    onRemove,
    onNavigate,
    disabled,
    showAddButton = true,
  }: LinkedContentChipsProps,
  ref: Ref<LinkedContentChipsHandle>,
): ReactNode {
  const [isAdding, setIsAdding] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Build exclude keys from existing items
  const excludeKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const item of items) {
      keys.add(`${item.type}:${item.id}`)
    }
    return keys
  }, [items])

  const sourceKey = contentId ? `${contentType}:${contentId}` : `${contentType}:new`

  const {
    inputValue,
    setInputValue,
    showDropdown,
    highlightedIndex,
    results,
    isSearching,
    selectItem,
    selectHighlighted,
    moveHighlight,
    reset,
    closeDropdown,
  } = useContentSearch({
    sourceKey,
    excludeKeys,
    enabled: isAdding,
  })

  // Ref to track inputValue for click-outside handler
  const inputValueRef = useRef(inputValue)
  useEffect(() => {
    inputValueRef.current = inputValue
  }, [inputValue])

  // Expose startAdding via ref
  useImperativeHandle(ref, () => ({
    startAdding: () => {
      if (!disabled) {
        setIsAdding(true)
      }
    },
  }), [disabled])

  // Focus input when entering add mode
  useEffect(() => {
    if (isAdding && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isAdding])

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        closeDropdown()
        // Exit add mode if input is empty
        if (!inputValueRef.current.trim()) {
          setIsAdding(false)
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [closeDropdown])

  const handleAddClick = (): void => {
    if (!disabled) {
      setIsAdding(true)
    }
  }

  const handleInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
    setInputValue(e.target.value)
  }

  const handleSelectItem = (item: ContentListItem): void => {
    onAdd(item)
    // Stay in add mode, refocus input
    inputRef.current?.focus()
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
      if (showDropdown && highlightedIndex >= 0) {
        const selected = selectHighlighted()
        if (selected) {
          handleSelectItem(selected)
        }
      }
    } else if (e.key === 'Escape') {
      reset()
      setIsAdding(false)
    }
  }

  const handleResultClick = (index: number): void => {
    const item = selectItem(results[index])
    handleSelectItem(item)
  }

  return (
    <div ref={containerRef} className="relative inline-flex flex-wrap items-center gap-2">
      {items.map((item) => {
        const Icon = CONTENT_TYPE_ICONS[item.type]
        const typeLabel = CONTENT_TYPE_LABELS[item.type]
        const chipStyle = CHIP_STYLES[item.type]
        const displayTitle = item.title ?? 'Untitled'

        const chipContent = (
          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-px text-xs font-normal border ${chipStyle} ${item.deleted ? 'opacity-60' : ''} ${item.archived ? 'opacity-60' : ''}`}>
            <Icon className="h-3 w-3" />
            <span className={`max-w-[120px] truncate ${item.deleted ? 'line-through' : ''}`}>
              {displayTitle}
            </span>
          </span>
        )

        // Use a stable key: relationshipId if it exists, otherwise target_type:target_id
        const key = item.relationshipId || `${item.type}:${item.id}`

        return (
          <div key={key} className="group/link relative inline-flex items-baseline">
            {onNavigate && !item.deleted ? (
              <button
                type="button"
                onClick={() => onNavigate(item)}
                className="cursor-pointer"
                aria-label={`Go to ${typeLabel}: ${displayTitle}`}
              >
                {chipContent}
              </button>
            ) : (
              chipContent
            )}

            {/* Remove button -- top-right circle, like Tag */}
            {!disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(item)
                }}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-gray-500 hover:bg-red-500 text-white rounded-full opacity-0 group-hover/link:opacity-100 transition-opacity flex items-center justify-center"
                title="Remove link"
                aria-label={`Remove link to ${displayTitle}`}
              >
                <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </div>
        )
      })}

      {/* Inline search input (shown when in add mode) */}
      {isAdding && !disabled && (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Search to link..."
            className="min-w-[120px] w-36 text-xs px-1.5 py-0.5 bg-gray-50 border border-gray-200 rounded outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400/20"
          />

          {/* Results dropdown */}
          {showDropdown && inputValue.length >= 1 && (
            <div className="absolute left-0 top-full mt-1 z-10 max-h-48 w-64 overflow-auto rounded-lg border border-gray-100 bg-white py-1 shadow-lg">
              {isSearching && results.length === 0 && (
                <p className="text-xs text-gray-400 py-3 text-center">Searching...</p>
              )}

              {!isSearching && results.length === 0 && (
                <p className="text-xs text-gray-400 py-3 text-center">No results found.</p>
              )}

              {results.map((item, index) => {
                const Icon = CONTENT_TYPE_ICONS[item.type]
                const iconColor = CONTENT_TYPE_ICON_COLORS[item.type]
                const displayTitle = item.title ?? 'Untitled'

                return (
                  <button
                    key={`${item.type}-${item.id}`}
                    type="button"
                    onClick={() => handleResultClick(index)}
                    aria-selected={index === highlightedIndex}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                      index === highlightedIndex
                        ? 'bg-gray-100 text-gray-900'
                        : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span className={`shrink-0 ${iconColor}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <span className="truncate">{displayTitle}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Inline add button (only when showAddButton is true and not already adding) */}
      {showAddButton && !isAdding && !disabled && (
        <Tooltip content="Link content" compact>
          <button
            type="button"
            onClick={handleAddClick}
            className="inline-flex items-center h-5 px-1 text-gray-500 rounded transition-colors hover:text-gray-700 hover:bg-gray-100"
            aria-label="Link content"
          >
            <LinkIcon className="h-4 w-4" />
          </button>
        </Tooltip>
      )}
    </div>
  )
})
