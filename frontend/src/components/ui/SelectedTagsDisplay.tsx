/**
 * SelectedTagsDisplay - displays selected filter tags with remove and match controls.
 *
 * Used by Bookmarks, Notes, and AllContent pages to show currently active tag filters.
 */
import type { ReactNode, ChangeEvent } from 'react'
import { CloseIconFilled } from '../icons'

interface SelectedTagsDisplayProps {
  /** Currently selected tags */
  selectedTags: string[]
  /** Current tag match mode ('all' or 'any') */
  tagMatch: 'all' | 'any'
  /** Called when a tag should be removed */
  onRemoveTag: (tag: string) => void
  /** Called when tag match mode changes */
  onTagMatchChange: (e: ChangeEvent<HTMLSelectElement>) => void
  /** Called when clear button is clicked */
  onClearFilters: () => void
}

/**
 * SelectedTagsDisplay - shows active tag filters with controls.
 *
 * Features:
 * - Displays each selected tag as a removable badge
 * - Match mode toggle (all/any) when multiple tags selected
 * - Clear all button when multiple tags selected
 */
export function SelectedTagsDisplay({
  selectedTags,
  tagMatch,
  onRemoveTag,
  onTagMatchChange,
  onClearFilters,
}: SelectedTagsDisplayProps): ReactNode {
  if (selectedTags.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-gray-400">Filtering by:</span>
      {selectedTags.map((tag) => (
        <button
          key={tag}
          onClick={() => onRemoveTag(tag)}
          className="badge-primary inline-flex items-center gap-1 hover:bg-blue-100 transition-colors"
        >
          {tag}
          <CloseIconFilled />
        </button>
      ))}
      {selectedTags.length > 1 && (
        <>
          <select
            value={tagMatch}
            onChange={onTagMatchChange}
            className="appearance-none cursor-pointer rounded-lg border border-gray-200 bg-gray-50/50 px-2 py-1 pr-6 text-xs focus:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-900/5 bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22m6%208%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1rem_1rem] bg-[right_0.25rem_center] bg-no-repeat"
          >
            <option value="all">Match all</option>
            <option value="any">Match any</option>
          </select>
          <button
            onClick={onClearFilters}
            className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
          >
            Clear
          </button>
        </>
      )}
    </div>
  )
}
