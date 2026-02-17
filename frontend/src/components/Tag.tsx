/**
 * Reusable tag component with optional click and remove actions.
 *
 * Used in:
 * - Card components (NoteCard, BookmarkCard, PromptCard) for list view
 * - InlineEditableTags for detail view editing
 *
 * Features:
 * - Optional click handler for filtering by tag
 * - Optional remove button with X in top-right corner
 * - X appears on hover, turns red when hovering over it
 */
import type { ReactNode } from 'react'
import { Tooltip } from './ui'

interface TagProps {
  /** The tag text to display */
  tag: string
  /** Called when the tag is clicked (e.g., to filter by tag) */
  onClick?: () => void
  /** Called when the remove button is clicked */
  onRemove?: () => void
}

/**
 * Tag displays a tag badge with optional click and remove actions.
 */
export function Tag({
  tag,
  onClick,
  onRemove,
}: TagProps): ReactNode {
  const tagContent = (
    <span className="badge-secondary hover:bg-gray-100 hover:border-gray-300 transition-colors">
      {tag}
    </span>
  )

  return (
    <div className="group/tag relative inline-flex items-baseline">
      {onClick ? (
        <Tooltip content="Filter by tag" compact delay={500}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onClick()
            }}
            className="badge-secondary hover:bg-gray-100 hover:border-gray-300 transition-colors"
          >
            {tag}
          </button>
        </Tooltip>
      ) : (
        tagContent
      )}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-gray-500 hover:bg-red-500 text-white rounded-full opacity-0 group-hover/tag:opacity-100 transition-opacity flex items-center justify-center"
          aria-label={`Remove tag ${tag}`}
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
}
