/**
 * PaginationControls - reusable pagination UI with page size selector.
 *
 * Used by Bookmarks, Notes, and AllContent pages to provide consistent
 * pagination controls.
 */
import type { ReactNode } from 'react'
import { PAGE_SIZE_OPTIONS } from '../../stores/uiPreferencesStore'
import type { PageSize } from '../../stores/uiPreferencesStore'

interface PaginationControlsProps {
  /** Current page number (1-based) */
  currentPage: number
  /** Total number of pages */
  totalPages: number
  /** Current page size */
  pageSize: PageSize
  /** Whether there are more pages after the current one */
  hasMore: boolean
  /** Current offset (for calculating previous page) */
  offset: number
  /** Total number of items */
  total: number
  /** Called when navigating to a new offset */
  onPageChange: (newOffset: number) => void
  /** Called when page size changes */
  onPageSizeChange: (newSize: PageSize) => void
}

/**
 * PaginationControls - provides previous/next buttons and page size selector.
 *
 * Features:
 * - Previous/Next navigation buttons
 * - Current page indicator
 * - Page size dropdown
 * - Only renders when pagination is needed
 */
export function PaginationControls({
  currentPage,
  totalPages,
  pageSize,
  hasMore,
  offset,
  total,
  onPageChange,
  onPageSizeChange,
}: PaginationControlsProps): ReactNode {
  // Only show if there are multiple pages or if total exceeds the smallest page size
  if (totalPages <= 1 && total <= PAGE_SIZE_OPTIONS[0]) {
    return null
  }

  return (
    <div className="mt-8 flex items-center justify-between border-t border-gray-100 pt-4">
      <button
        onClick={() => onPageChange(Math.max(0, offset - pageSize))}
        disabled={offset === 0}
        className="btn-secondary"
      >
        Previous
      </button>

      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-400">
          Page {currentPage} of {totalPages}
        </span>
        <select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value) as PageSize)}
          className="appearance-none cursor-pointer rounded-lg border border-gray-200 bg-gray-50/50 px-2 py-1 pr-6 text-xs focus:border-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-900/5 bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2020%2020%22%3E%3Cpath%20stroke%3D%22%236b7280%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22%20stroke-width%3D%221.5%22%20d%3D%22m6%208%204%204%204-4%22%2F%3E%3C%2Fsvg%3E')] bg-[length:1rem_1rem] bg-[right_0.25rem_center] bg-no-repeat"
          title="Items per page"
        >
          {PAGE_SIZE_OPTIONS.map((size) => (
            <option key={size} value={size}>{size} per page</option>
          ))}
        </select>
      </div>

      <button
        onClick={() => onPageChange(offset + pageSize)}
        disabled={!hasMore}
        className="btn-secondary"
      >
        Next
      </button>
    </div>
  )
}
