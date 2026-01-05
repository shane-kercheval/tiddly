/**
 * Component for displaying a single prompt card in list view.
 */
import type { ReactNode } from 'react'
import type { PromptListItem } from '../types'
import type { SortByOption } from '../constants/sortOptions'
import { CONTENT_TYPE_ICON_COLORS } from '../constants/contentTypeStyles'
import { formatDate, truncate } from '../utils'
import { ConfirmDeleteButton } from './ui'
import { PromptIcon, EditIcon, ArchiveIcon, RestoreIcon, TrashIcon, CloseIcon } from './icons'

interface PromptCardProps {
  prompt: PromptListItem
  view?: 'active' | 'archived' | 'deleted'
  sortBy?: SortByOption
  onView?: (prompt: PromptListItem) => void
  onEdit?: (prompt: PromptListItem) => void
  onDelete: (prompt: PromptListItem) => void
  onArchive?: (prompt: PromptListItem) => void
  onUnarchive?: (prompt: PromptListItem) => void
  onRestore?: (prompt: PromptListItem) => void
  onTagClick?: (tag: string) => void
  onTagRemove?: (prompt: PromptListItem, tag: string) => void
  /** Whether the edit action is currently loading */
  isLoading?: boolean
}

/**
 * PromptCard displays a single prompt with its metadata.
 *
 * Features:
 * - Clickable title opens prompt view
 * - Context-aware action buttons based on view:
 *   - active: edit, archive, delete
 *   - archived: edit, restore, delete
 *   - deleted: restore, permanent delete
 * - Clickable tags for filtering
 * - Shows name (unique identifier) and title (display name)
 */
export function PromptCard({
  prompt,
  view = 'active',
  sortBy = 'created_at',
  onView,
  onEdit,
  onDelete,
  onArchive,
  onUnarchive,
  onRestore,
  onTagClick,
  onTagRemove,
  isLoading = false,
}: PromptCardProps): ReactNode {
  // Display title if present, otherwise use name
  const displayName = prompt.title || prompt.name
  // Show description if present
  const previewText = prompt.description || ''

  // Dynamic date display based on current sort option
  const getDateDisplay = (): string => {
    switch (sortBy) {
      case 'updated_at':
        return `Modified: ${formatDate(prompt.updated_at)}`
      case 'last_used_at':
        return `Used: ${formatDate(prompt.last_used_at)}`
      case 'created_at':
      case 'title':
      default:
        return `Created: ${formatDate(prompt.created_at)}`
    }
  }

  const handleTitleClick = (e: React.MouseEvent): void => {
    e.stopPropagation() // Prevent card click from triggering edit
    onView?.(prompt)
  }

  // Handle card click to go to view mode
  const handleCardClick = (): void => {
    onView?.(prompt)
  }

  return (
    <div
      className={`card card-interactive group ${onView ? 'cursor-pointer' : ''}`}
      onClick={onView ? handleCardClick : undefined}
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:gap-4">
        {/* Row 1 (mobile) / Main content (desktop) */}
        <div className="min-w-0 flex-1 overflow-hidden">
          {/* Title row */}
          <div className="flex items-center gap-2 md:flex-wrap">
            <span className={`shrink-0 w-4 h-4 ${CONTENT_TYPE_ICON_COLORS.prompt}`}>
              <PromptIcon className="w-4 h-4" />
            </span>
            <button
              onClick={handleTitleClick}
              className="text-base font-medium text-gray-900 text-left cursor-pointer truncate min-w-0 md:shrink-0"
              title="View prompt"
            >
              {truncate(displayName, 60)}
            </button>
            {/* Show name inline on desktop */}
            {prompt.title && prompt.title !== prompt.name && (
              <span className="hidden md:inline text-xs text-gray-400 font-mono">{prompt.name}</span>
            )}
          </div>
          {/* Name on separate line - mobile only */}
          {prompt.title && prompt.title !== prompt.name && (
            <span className="block md:hidden mt-0.5 text-xs text-gray-400 font-mono">{prompt.name}</span>
          )}

          {/* Description - 2 lines on mobile, 1 line on desktop */}
          {previewText && (
            <p className="mt-1 text-sm text-gray-500 line-clamp-2 md:line-clamp-1">
              {previewText}
            </p>
          )}
        </div>

        {/* Row 2 (mobile): tags + actions + date */}
        <div className="flex items-center gap-2 md:contents">
          {/* Tags */}
          {prompt.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 flex-1 md:flex-initial md:justify-end md:w-32 md:shrink-0">
              {prompt.tags.map((tag) => (
                <div key={tag} className="group/tag relative">
                  <button
                    onClick={(e) => { e.stopPropagation(); onTagClick?.(tag) }}
                    className="badge-secondary hover:bg-gray-100 hover:border-gray-300 transition-colors"
                    title={`Filter by tag: ${tag}`}
                  >
                    {tag}
                  </button>
                  {onTagRemove && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onTagRemove(prompt, tag)
                      }}
                      className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-gray-500 hover:bg-red-500 text-white rounded-full opacity-0 group-hover/tag:opacity-100 transition-opacity flex items-center justify-center"
                      title={`Remove tag: ${tag}`}
                      aria-label={`Remove tag ${tag}`}
                    >
                      <CloseIcon className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Actions and date */}
          <div className="flex items-center gap-1 md:flex-col md:items-end shrink-0 ml-auto md:ml-0">
            <div className="flex items-center">
              {/* Edit button - shown in active and archived views */}
              {view !== 'deleted' && onEdit && (
                <button
                  onClick={(e) => { e.stopPropagation(); onEdit(prompt) }}
                  className="btn-icon"
                  title="Edit prompt"
                  aria-label="Edit prompt"
                >
                  {isLoading ? (
                    <div className="spinner-sm" />
                  ) : (
                    <EditIcon />
                  )}
                </button>
              )}

              {/* Archive button - shown in active view */}
              {view === 'active' && onArchive && (
                <button
                  onClick={(e) => { e.stopPropagation(); onArchive(prompt) }}
                  className="btn-icon"
                  title="Archive prompt"
                  aria-label="Archive prompt"
                >
                  <ArchiveIcon className="h-4 w-4" />
                </button>
              )}

              {/* Restore button - shown in archived view (unarchive action) */}
              {view === 'archived' && onUnarchive && (
                <button
                  onClick={(e) => { e.stopPropagation(); onUnarchive(prompt) }}
                  className="btn-icon"
                  title="Restore prompt"
                  aria-label="Restore prompt"
                >
                  <RestoreIcon />
                </button>
              )}

              {/* Restore button - shown in deleted view */}
              {view === 'deleted' && onRestore && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRestore(prompt) }}
                  className="btn-icon"
                  title="Restore prompt"
                  aria-label="Restore prompt"
                >
                  <RestoreIcon />
                </button>
              )}

              {/* Delete button - shown in all views */}
              {/* Use ConfirmDeleteButton for permanent delete in trash view */}
              {view === 'deleted' ? (
                <span onClick={(e) => e.stopPropagation()}>
                  <ConfirmDeleteButton
                    onConfirm={() => onDelete(prompt)}
                    title="Delete permanently"
                  />
                </span>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(prompt) }}
                  className="btn-icon-danger"
                  title="Delete prompt"
                  aria-label="Delete prompt"
                >
                  <TrashIcon />
                </button>
              )}
            </div>
            <span className="text-xs text-gray-400">
              {getDateDisplay()}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
