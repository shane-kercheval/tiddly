/**
 * Component for displaying a single note card in list view.
 */
import type { ReactNode } from 'react'
import type { NoteListItem } from '../types'
import type { SortByOption } from '../constants/sortOptions'
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

  // Handle card click to trigger edit mode
  const handleCardClick = (): void => {
    if (view !== 'deleted' && onEdit) {
      onEdit(note)
    }
  }

  const isClickable = view !== 'deleted' && onEdit

  return (
    <div
      className={`card card-interactive group ${isClickable ? 'cursor-pointer' : ''}`}
      onClick={isClickable ? handleCardClick : undefined}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardClick() } } : undefined}
    >
      <div className="flex items-start gap-4">
        {/* Main content */}
        <div className="min-w-0 flex-1">
          {/* Title row */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="shrink-0 w-4 h-4 text-green-500">
              <NoteIcon className="w-4 h-4" />
            </span>
            <button
              onClick={handleTitleClick}
              className="text-base font-medium text-gray-900 hover:text-gray-600 transition-colors text-left cursor-pointer"
              title="View note"
            >
              {truncate(note.title, 60)}
            </button>
            {note.version > 1 && (
              <span className="text-xs text-gray-400">v{note.version}</span>
            )}
          </div>

          {/* Description/Preview */}
          {previewText && (
            <p className="mt-1 text-sm text-gray-500 truncate">
              {previewText}
            </p>
          )}
        </div>

        {/* Tags */}
        {note.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 justify-end w-32 shrink-0">
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
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center">
            {/* Hover edit indicator - shown on card hover for clickable cards */}
            {isClickable && (
              <span
                className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity mr-1"
                aria-hidden="true"
              >
                {isLoading ? (
                  <div className="spinner-sm" />
                ) : (
                  <EditIcon />
                )}
              </span>
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
  )
}
