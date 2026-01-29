/**
 * Component for displaying a single note card in list view.
 *
 * Uses ContentCard composition for shared layout, tags, actions, and date display.
 * Note-specific header (icon, title, version badge, description) stays here.
 */
import type { ReactNode } from 'react'
import type { NoteListItem, TagCount } from '../types'
import type { SortByOption } from '../constants/sortOptions'
import { CONTENT_TYPE_ICON_COLORS } from '../constants/contentTypeStyles'
import { truncate } from '../utils'
import { CopyContentButton } from './ui'
import { NoteIcon } from './icons'
import { ContentCard } from './ContentCard'

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
  onTagAdd?: (note: NoteListItem, tag: string) => void
  tagSuggestions?: TagCount[]
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
  onTagAdd,
  tagSuggestions,
  onCancelScheduledArchive,
}: NoteCardProps): ReactNode {
  // Display description if present
  const previewText = note.description || ''

  const handleTitleClick = (e: React.MouseEvent): void => {
    e.stopPropagation() // Prevent card click from triggering edit
    onView?.(note)
  }

  return (
    <ContentCard
      view={view}
      onClick={onView ? () => onView(note) : undefined}
    >
      {/* Header stays in NoteCard - note-specific */}
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

      {/* Footer wraps tags + actions for responsive layout (md:contents) */}
      <ContentCard.Footer>
        <ContentCard.Tags
          tags={note.tags}
          onTagClick={onTagClick}
          onTagRemove={onTagRemove ? (tag) => onTagRemove(note, tag) : undefined}
        />

        <ContentCard.Actions
          meta={
            <>
              <ContentCard.DateDisplay
                sortBy={sortBy}
                createdAt={note.created_at}
                updatedAt={note.updated_at}
                lastUsedAt={note.last_used_at}
                archivedAt={note.archived_at}
                deletedAt={note.deleted_at}
              />
              {onCancelScheduledArchive && (
                <ContentCard.ScheduledArchive
                  archivedAt={note.archived_at}
                  onCancel={() => onCancelScheduledArchive(note)}
                />
              )}
            </>
          }
        >
          {/* Add tag button */}
          {onTagAdd && tagSuggestions && (
            <ContentCard.AddTagAction
              existingTags={note.tags}
              suggestions={tagSuggestions}
              onAdd={(tag) => onTagAdd(note, tag)}
            />
          )}

          {/* Copy button - shown in active and archived views */}
          {view !== 'deleted' && (
            <CopyContentButton contentType="note" id={note.id} />
          )}

          {/* Archive button - shown in active view only (via context) */}
          {onArchive && (
            <ContentCard.ArchiveAction
              onArchive={() => onArchive(note)}
              entityName="note"
            />
          )}

          {/* Restore button - shown in archived view (unarchive action) */}
          {view === 'archived' && onUnarchive && (
            <ContentCard.RestoreAction
              onRestore={() => onUnarchive(note)}
              entityName="note"
            />
          )}

          {/* Restore button - shown in deleted view */}
          {view === 'deleted' && onRestore && (
            <ContentCard.RestoreAction
              onRestore={() => onRestore(note)}
              entityName="note"
            />
          )}

          {/* Delete button - shown in all views */}
          <ContentCard.DeleteAction
            onDelete={() => onDelete(note)}
            entityName="note"
          />
        </ContentCard.Actions>
      </ContentCard.Footer>
    </ContentCard>
  )
}
