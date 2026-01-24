/**
 * Component for displaying a single note card in list view.
 */
import type { ReactNode } from 'react'
import type { NoteListItem } from '../types'
import type { SortByOption } from '../constants/sortOptions'
import { CONTENT_TYPE_ICON_COLORS } from '../constants/contentTypeStyles'
import { formatDate, truncate } from '../utils'
import { ConfirmDeleteButton, CopyContentButton } from './ui'
import { NoteIcon, ArchiveIcon, RestoreIcon, TrashIcon, CloseIcon } from './icons'
import { Tag } from './Tag'

interface NoteCardProps {
  note: NoteListItem
  view?: 'active' | 'archived' | 'deleted'
  sortBy?: SortByOption
  onView?: (note: NoteListItem) => void
  onDelete: (note: NoteListItem) => void
  onArchive?: (note: NoteListItem) => void
  onUnarchive?: (note: NoteListItem) => void
  onRestore?: (note: NoteListItem) => void
  onTagClick?: (tag: string) => void
  onTagRemove?: (note: NoteListItem, tag: string) => void
  /** Called when user cancels a scheduled auto-archive */
  onCancelScheduledArchive?: (note: NoteListItem) => void
}

/**
 * NoteCard displays a single note with its metadata.
 *
 * Features:
 * - Clickable card opens note view/edit (unified component)
 * - Context-aware action buttons based on view:
 *   - active: archive, delete
 *   - archived: restore, delete
 *   - deleted: restore, permanent delete
 * - Clickable tags for filtering
 * - Shows description or truncated content preview
 */
export function NoteCard({
  note,
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
}: NoteCardProps): ReactNode {
  // Display description if present, otherwise show truncated content preview
  const previewText = note.description || ''

  // Check if note has a scheduled future archive date
  const hasScheduledArchive = view === 'active' &&
    note.archived_at &&
    new Date(note.archived_at) > new Date()

  // Dynamic date display based on current sort option
  const getDateDisplay = (): string => {
    switch (sortBy) {
      case 'updated_at':
        return `Modified: ${formatDate(note.updated_at)}`
      case 'last_used_at':
        return `Used: ${formatDate(note.last_used_at)}`
      case 'archived_at':
        return `Archived: ${formatDate(note.archived_at)}`
      case 'deleted_at':
        return `Deleted: ${formatDate(note.deleted_at)}`
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
        <div className="min-w-0 flex-1 overflow-hidden">
          {/* Title row - on mobile, description is inline; on desktop, it wraps below */}
          <div className="flex items-center gap-2 md:flex-wrap">
            <span className={`shrink-0 w-4 h-4 ${CONTENT_TYPE_ICON_COLORS.note}`}>
              <NoteIcon className="w-4 h-4" />
            </span>
            <button
              onClick={handleTitleClick}
              className="text-base font-medium text-gray-900 text-left cursor-pointer truncate min-w-0 md:shrink-0 md:overflow-visible md:whitespace-normal"
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
                <Tag
                  key={tag}
                  tag={tag}
                  onClick={onTagClick ? () => onTagClick(tag) : undefined}
                  onRemove={onTagRemove ? () => onTagRemove(note, tag) : undefined}
                />
              ))}
            </div>
          )}

          {/* Actions and date */}
          <div className="flex items-center gap-1 md:flex-col md:items-end shrink-0 ml-auto md:ml-0">
            <div className="flex items-center">
              {/* Copy button - shown in active and archived views */}
              {view !== 'deleted' && (
                <CopyContentButton contentType="note" id={note.id} />
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
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-xs text-gray-400">
                {getDateDisplay()}
              </span>
              {hasScheduledArchive && note.archived_at && (
                <span className="flex items-center gap-1 text-xs text-amber-600">
                  <span>Archiving: {formatDate(note.archived_at)}</span>
                  {onCancelScheduledArchive && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onCancelScheduledArchive(note) }}
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
