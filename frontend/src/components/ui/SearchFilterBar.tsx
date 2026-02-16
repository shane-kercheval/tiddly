/**
 * SearchFilterBar - reusable search, tag filter, and sort controls.
 *
 * Used by Bookmarks, Notes, and AllContent pages to provide consistent
 * search/filter/sort UI.
 */
import type { ReactNode, RefObject, ChangeEvent } from 'react'
import { TagFilterInput } from '../TagFilterInput'
import { SearchIcon } from '../icons'
import { SORT_LABELS, type SortByOption } from '../../constants/sortOptions'
import type { TagCount } from '../../types'

interface SearchFilterBarProps {
  /** Ref for the search input (for keyboard shortcuts) */
  searchInputRef?: RefObject<HTMLInputElement | null>
  /** Current search query value */
  searchQuery: string
  /** Called when search query changes */
  onSearchChange: (e: ChangeEvent<HTMLInputElement>) => void
  /** Placeholder text for search input */
  searchPlaceholder?: string
  /** Available tags for the tag filter autocomplete */
  tagSuggestions: TagCount[]
  /** Currently selected tags (to exclude from suggestions) */
  selectedTags: string[]
  /** Called when a tag is selected from the filter */
  onTagSelect: (tag: string) => void
  /** Current sort value in format "sortBy-sortOrder" (e.g., "created_at-desc") */
  sortValue: string
  /** Called when sort changes */
  onSortChange: (e: ChangeEvent<HTMLSelectElement>) => void
  /** Available sort options for the current view */
  availableSortOptions: readonly SortByOption[]
  /** Sort options that only have a single direction (no asc/desc toggle, e.g., Relevance) */
  singleDirectionOptions?: ReadonlySet<SortByOption>
  /** Optional left slot (e.g., for add button) */
  leftSlot?: ReactNode
}

/**
 * SearchFilterBar - provides search input, tag filter, and sort dropdown.
 *
 * Features:
 * - Search input with icon
 * - Tag filter autocomplete
 * - Sort dropdown with ascending/descending options
 * - Optional left slot for add buttons
 */
export function SearchFilterBar({
  searchInputRef,
  searchQuery,
  onSearchChange,
  searchPlaceholder = 'Search...',
  tagSuggestions,
  selectedTags,
  onTagSelect,
  sortValue,
  onSortChange,
  availableSortOptions,
  singleDirectionOptions,
  leftSlot,
}: SearchFilterBarProps): ReactNode {
  return (
    <div className="flex flex-col gap-1.5 md:flex-row md:flex-nowrap md:items-center md:gap-2">
      {/* Row 1 on mobile: Add button + search input */}
      <div className="flex items-center gap-1.5 w-full md:w-auto md:contents">
        {leftSlot}
        <div className="relative flex-1 min-w-0 md:min-w-[200px]">
          <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            <SearchIcon />
          </div>
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={onSearchChange}
            placeholder={searchPlaceholder}
            className="input pl-10"
          />
        </div>
      </div>
      {/* Row 2 on mobile: Tag filter + sort dropdown */}
      <div className="flex items-center gap-1.5 w-full md:w-auto md:contents">
        <div className="flex-1 md:flex-initial">
          <TagFilterInput
            suggestions={tagSuggestions}
            selectedTags={selectedTags}
            onTagSelect={onTagSelect}
            placeholder="Filter by tag..."
          />
        </div>
        <select
          value={sortValue}
          onChange={onSortChange}
          className="appearance-none cursor-pointer rounded-lg border border-gray-200 bg-gray-50/50 px-2.5 py-1 pr-7 text-sm focus:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-900/5 bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22m6%208%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1rem_1rem] bg-[right_0.375rem_center] bg-no-repeat"
        >
          {availableSortOptions.map((option) => (
            singleDirectionOptions?.has(option) ? (
              <option key={option} value={`${option}-desc`}>{SORT_LABELS[option]}</option>
            ) : (
              <optgroup key={option} label={SORT_LABELS[option]}>
                <option value={`${option}-desc`}>{SORT_LABELS[option]} ↓</option>
                <option value={`${option}-asc`}>{SORT_LABELS[option]} ↑</option>
              </optgroup>
            )
          ))}
        </select>
      </div>
    </div>
  )
}
