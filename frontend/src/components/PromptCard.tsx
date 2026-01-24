/**
 * Component for displaying a single prompt card in list view.
 */
import type { ReactNode } from 'react'
import type { PromptListItem } from '../types'
import type { SortByOption } from '../constants/sortOptions'
import { CONTENT_TYPE_ICON_COLORS } from '../constants/contentTypeStyles'
import { formatDate, truncate } from '../utils'
import { ConfirmDeleteButton, CopyContentButton } from './ui'
import { PromptIcon, ArchiveIcon, RestoreIcon, TrashIcon, CloseIcon } from './icons'
import { Tag } from './Tag'

interface PromptCardProps {
  prompt: PromptListItem
  view?: 'active' | 'archived' | 'deleted'
  sortBy?: SortByOption
  onView?: (prompt: PromptListItem) => void
  onDelete: (prompt: PromptListItem) => void
  onArchive?: (prompt: PromptListItem) => void
  onUnarchive?: (prompt: PromptListItem) => void
  onRestore?: (prompt: PromptListItem) => void
  onTagClick?: (tag: string) => void
  onTagRemove?: (prompt: PromptListItem, tag: string) => void
  /** Called when user cancels a scheduled auto-archive */
  onCancelScheduledArchive?: (prompt: PromptListItem) => void
}

/**
 * PromptCard displays a single prompt with its metadata.
 *
 * Features:
 * - Clickable card opens prompt view/edit (unified component)
 * - Context-aware action buttons based on view:
 *   - active: archive, delete
 *   - archived: restore, delete
 *   - deleted: restore, permanent delete
 * - Clickable tags for filtering
 * - Shows name (unique identifier) and title (display name)
 */
export function PromptCard({
  prompt,
  view = 'active',
  sortBy = 'created_at',
  onView,
  onDelete,
  onArchive,
  onUnarchive,
  onRestore,
  onTagClick,
  onTagRemove,
  onCancelScheduledArchive,
}: PromptCardProps): ReactNode {
  // Display title if present, otherwise use name
  const displayName = prompt.title || prompt.name
  // Show description if present
  const previewText = prompt.description || ''

  // Check if prompt has a scheduled future archive date
  const hasScheduledArchive = view === 'active' &&
    prompt.archived_at &&
    new Date(prompt.archived_at) > new Date()

  // Dynamic date display based on current sort option
  const getDateDisplay = (): string => {
    switch (sortBy) {
      case 'updated_at':
        return `Modified: ${formatDate(prompt.updated_at)}`
      case 'last_used_at':
        return `Used: ${formatDate(prompt.last_used_at)}`
      case 'archived_at':
        return `Archived: ${formatDate(prompt.archived_at!)}`
      case 'deleted_at':
        return `Deleted: ${formatDate(prompt.deleted_at!)}`
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
                <Tag
                  key={tag}
                  tag={tag}
                  onClick={onTagClick ? () => onTagClick(tag) : undefined}
                  onRemove={onTagRemove ? () => onTagRemove(prompt, tag) : undefined}
                />
              ))}
            </div>
          )}

          {/* Actions and date */}
          <div className="flex items-center gap-1 md:flex-col md:items-end shrink-0 ml-auto md:ml-0">
            <div className="flex items-center">
              {/* Copy button - shown in active and archived views */}
              {view !== 'deleted' && (
                <CopyContentButton contentType="prompt" id={prompt.id} />
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
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-xs text-gray-400">
                {getDateDisplay()}
              </span>
              {hasScheduledArchive && prompt.archived_at && (
                <span className="flex items-center gap-1 text-xs text-amber-600">
                  <span>Archiving: {formatDate(prompt.archived_at)}</span>
                  {onCancelScheduledArchive && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onCancelScheduledArchive(prompt) }}
                      className="text-amber-500 hover:text-amber-700 transition-colors p-0.5 -m-0.5"
                      title="Cancel scheduled archive"
                      aria-label="Cancel scheduled archive"
                    >
                      <CloseIcon className="w-3 h-3" />
                    </button>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
