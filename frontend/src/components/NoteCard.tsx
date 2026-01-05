/**
 * Component for displaying a single note card in list view.
 */
import type { ReactNode } from 'react'
import type { NoteListItem } from '../types'
import type { SortByOption } from '../constants/sortOptions'
import { CONTENT_TYPE_ICON_COLORS } from '../constants/contentTypeStyles'
import { formatDate, truncate } from '../utils'
import { ConfirmDeleteButton } from './ui'
import { NoteIcon, EditIcon, ArchiveIcon, RestoreIcon, TrashIcon, CloseIcon } from './icons'

interface NoteCardProps {
  note: NoteListItem
  view?: 'active' | 'archived' | 'deleted'
  sortBy?: SortByOption
  onView?: (note: NoteListItem) => void
  onEdit?: (note: NoteListItem) => void
  onDelete: (note: NoteListItem) => void
  onArchive?: (note: NoteListItem) => void
  onUnarchive?: (note: NoteListItem) => void
  onRestore?: (note: NoteListItem) => void
  onTagClick?: (tag: string) => void
  onTagRemove?: (note: NoteListItem, tag: string) => void
  /** Whether the edit action is currently loading */
  isLoading?: boolean
}

/**
 * NoteCard displays a single note with its metadata.
 *
 * Features:
 * - Clickable title opens note view
 * - Context-aware action buttons based on view:
 *   - active: edit, archive, delete
 *   - archived: edit, restore, delete
 *   - deleted: restore, permanent delete
 * - Clickable tags for filtering
 * - Shows description or truncated content preview
 */
export function NoteCard({
  note,
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
}: NoteCardProps): ReactNode {
  // Display description if present, otherwise show truncated content preview
  const previewText = note.description || ''

  // Dynamic date display based on current sort option
  const getDateDisplay = (): string => {
    switch (sortBy) {
      case 'updated_at':
        return `Modified: ${formatDate(note.updated_at)}`
      case 'last_used_at':
        return `Used: ${formatDate(note.last_used_at)}`
      case 'created_at':
      case 'title':
      default:
        return `Created: ${formatDate(note.created_at)}`
    }
  }

  const handleTitleClick = (e: React.MouseEvent): void => {
    e.stopPropagation() // Prevent card click from triggering edit
    onView?.(note)
  }

  // Handle card click to go to view mode
  const handleCardClick = (): void => {
    onView?.(note)
  }

  return (
    <div
      className={`card card-interactive group ${onView ? 'cursor-pointer' : ''}`}
      onClick={onView ? handleCardClick : undefined}
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:gap-4">
        {/* Row 1 (mobile) / Main content (desktop) */}
        <div className="min-w-0 flex-1">
          {/* Title row - on mobile, description is inline; on desktop, it wraps below */}
          <div className="flex items-center gap-2 md:flex-wrap">
            <span className={`shrink-0 w-4 h-4 ${CONTENT_TYPE_ICON_COLORS.note}`}>
              <NoteIcon className="w-4 h-4" />
            </span>
            <button
              onClick={handleTitleClick}
              className="text-base font-medium text-gray-900 text-left cursor-pointer shrink-0"
              title="View note"
            >
              {truncate(note.title, 60)}
            </button>
            {note.version > 1 && (
              <span className="text-xs text-gray-400 shrink-0">v{note.version}</span>
            )}
          </div>

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
          {note.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 flex-1 md:flex-initial md:justify-end md:w-32 md:shrink-0">
              {note.tags.map((tag) => (
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
                        onTagRemove(note, tag)
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
                  onClick={(e) => { e.stopPropagation(); onEdit(note) }}
                  className="btn-icon"
                  title="Edit note"
                  aria-label="Edit note"
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
                  onClick={(e) => { e.stopPropagation(); onArchive(note) }}
                  className="btn-icon"
                  title="Archive note"
                  aria-label="Archive note"
                >
                  <ArchiveIcon className="h-4 w-4" />
                </button>
              )}

              {/* Restore button - shown in archived view (unarchive action) */}
              {view === 'archived' && onUnarchive && (
                <button
                  onClick={(e) => { e.stopPropagation(); onUnarchive(note) }}
                  className="btn-icon"
                  title="Restore note"
                  aria-label="Restore note"
                >
                  <RestoreIcon />
                </button>
              )}

              {/* Restore button - shown in deleted view */}
              {view === 'deleted' && onRestore && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRestore(note) }}
                  className="btn-icon"
                  title="Restore note"
                  aria-label="Restore note"
                >
                  <RestoreIcon />
                </button>
              )}

              {/* Delete button - shown in all views */}
              {/* Use ConfirmDeleteButton for permanent delete in trash view */}
              {view === 'deleted' ? (
                <span onClick={(e) => e.stopPropagation()}>
                  <ConfirmDeleteButton
                    onConfirm={() => onDelete(note)}
                    title="Delete permanently"
                  />
                </span>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(note) }}
                  className="btn-icon-danger"
                  title="Delete note"
                  aria-label="Delete note"
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
