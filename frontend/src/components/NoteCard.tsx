/**
 * Component for displaying a single note card in list view.
 *
 * Responsive layout:
 * - Mobile: Vertical stacking with always-visible actions
 * - Desktop: Horizontal compact layout with hover-revealed actions
 */
import type { ReactNode } from 'react'
import type { NoteListItem, TagCount } from '../types'
import type { SortByOption } from '../constants/sortOptions'
import { CONTENT_TYPE_ICON_COLORS } from '../constants/contentTypeStyles'
import { CopyContentButton } from './ui'
import { NoteIcon, ArchiveIcon, RestoreIcon, TrashIcon } from './icons'
import { ContentCard } from './ContentCard'

interface NoteCardProps {
  note: NoteListItem
  view?: 'active' | 'archived' | 'deleted'
  sortBy?: SortByOption
  /** Whether to show dates on the card. Defaults to true. */
  showDate?: boolean
  /** Generic card click handler (does not imply action availability). */
  onClick?: (note: NoteListItem) => void
  onView?: (note: NoteListItem) => void
  onDelete?: (note: NoteListItem) => void
  onArchive?: (note: NoteListItem) => void
  onUnarchive?: (note: NoteListItem) => void
  onRestore?: (note: NoteListItem) => void
  onTagClick?: (tag: string) => void
  onTagRemove?: (note: NoteListItem, tag: string) => void
  onTagAdd?: (note: NoteListItem, tag: string) => void
  tagSuggestions?: TagCount[]
  onCancelScheduledArchive?: (note: NoteListItem) => void
}

export function NoteCard({
  note,
  view = 'active',
  sortBy = 'created_at',
  showDate = true,
  onClick,
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
  const hasActions = !!(onDelete || onArchive || onUnarchive || onRestore || onTagAdd || onCancelScheduledArchive)
  const previewText = note.description || note.content_preview || ''

  const handleTitleClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    onView?.(note)
  }

  return (
    <ContentCard
      view={view}
      onClick={onClick ? () => onClick(note) : onView ? () => onView(note) : undefined}
    >
      {/* Column 1: Icon */}
      <span className={`w-4 h-4 mt-1 ${CONTENT_TYPE_ICON_COLORS.note}`}>
        <NoteIcon className="w-4 h-4" />
      </span>

      {/* Column 2: Content - responsive layout */}
      <div className="min-w-0 flex-1">
        {/* Mobile layout - stacked vertically */}
        <div className="md:hidden flex flex-col gap-1.5">
          {/* Title row */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleTitleClick}
              className="text-base font-medium text-gray-900 text-left cursor-pointer truncate"
              title="View note"
            >
              {note.title}
            </button>
            {note.version > 1 && (
              <span className="text-xs text-gray-400 shrink-0">v{note.version}</span>
            )}
          </div>

          {/* Description */}
          {previewText && (
            <p className="text-sm text-gray-400 line-clamp-2">
              {previewText}
            </p>
          )}

          {/* Tags row */}
          {note.tags.length > 0 && (
            <ContentCard.Tags
              tags={note.tags}
              onTagClick={onTagClick}
              onTagRemove={onTagRemove ? (tag) => onTagRemove(note, tag) : undefined}
            />
          )}

          {/* Actions and date row */}
          {hasActions && (
            <div className="flex items-center justify-between">
              {/* Actions - always visible on mobile */}
              <div className="flex items-center gap-0.5">
                {onTagAdd && tagSuggestions && (
                  <ContentCard.AddTagAction
                    existingTags={note.tags}
                    suggestions={tagSuggestions}
                    onAdd={(tag) => onTagAdd(note, tag)}
                  />
                )}
                {view !== 'deleted' && (
                  <CopyContentButton contentType="note" id={note.id} />
                )}
                {onArchive && (
                  <ContentCard.ArchiveAction
                    onArchive={() => onArchive(note)}
                    entityName="note"
                  />
                )}
                {view === 'archived' && onUnarchive && (
                  <ContentCard.RestoreAction
                    onRestore={() => onUnarchive(note)}
                    entityName="note"
                  />
                )}
                {view === 'deleted' && onRestore && (
                  <ContentCard.RestoreAction
                    onRestore={() => onRestore(note)}
                    entityName="note"
                  />
                )}
                {onDelete && (
                  <ContentCard.DeleteAction
                    onDelete={() => onDelete(note)}
                    entityName="note"
                  />
                )}
              </div>

              {/* Date and archiving indicator */}
              <div className="flex flex-col items-end gap-0.5">
                <ContentCard.DateDisplay
                  sortBy={sortBy}
                  createdAt={note.created_at}
                  updatedAt={note.updated_at}
                  lastUsedAt={note.last_used_at}
                  archivedAt={note.archived_at}
                  deletedAt={note.deleted_at}
                  showLabel
                />
                {onCancelScheduledArchive && (
                  <ContentCard.ScheduledArchive
                    archivedAt={note.archived_at}
                    onCancel={() => onCancelScheduledArchive(note)}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Desktop layout - horizontal with hover actions */}
        <div className="hidden md:block">
          {/* Row 1: Title + tags + date */}
          <div className="flex items-start gap-2">
            {/* Left: Title and tags */}
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0 flex-1">
              <button
                onClick={handleTitleClick}
                className="text-base font-medium text-gray-900 text-left cursor-pointer truncate"
                title="View note"
              >
                {note.title}
              </button>
              {note.version > 1 && (
                <span className="text-xs text-gray-400 shrink-0">v{note.version}</span>
              )}
              <ContentCard.Tags
                tags={note.tags}
                onTagClick={onTagClick}
                onTagRemove={onTagRemove ? (tag) => onTagRemove(note, tag) : undefined}
              />
            </div>

            {/* Right: Date */}
            {showDate && (
              <div className="shrink-0">
                <ContentCard.DateDisplay
                  sortBy={sortBy}
                  createdAt={note.created_at}
                  updatedAt={note.updated_at}
                  lastUsedAt={note.last_used_at}
                  archivedAt={note.archived_at}
                  deletedAt={note.deleted_at}
                />
              </div>
            )}
          </div>

          {/* Row 2: Archiving indicator (if applicable) - right aligned */}
          {onCancelScheduledArchive && (
            <div className="flex justify-end mt-0.5">
              <ContentCard.ScheduledArchive
                archivedAt={note.archived_at}
                onCancel={() => onCancelScheduledArchive(note)}
              />
            </div>
          )}

          {/* Row 3: Description + actions (actions overlay on hover) */}
          <div className="relative mt-1 min-h-[20px]">
            {/* Description fills full width */}
            <p className={`text-sm text-gray-400 truncate ${hasActions ? 'pr-0 group-hover:pr-32 transition-[padding] duration-150' : ''}`}>
              {previewText || '\u00A0'}
            </p>

            {/* Actions absolutely positioned, appear on hover */}
            {hasActions && (
              <div className="absolute right-0 top-0">
                <ContentCard.Actions
                  overflowItems={[
                    {
                      key: 'archive',
                      label: 'Archive',
                      icon: <ArchiveIcon className="h-4 w-4" />,
                      onClick: () => onArchive?.(note),
                      hidden: !onArchive || view !== 'active',
                    },
                    {
                      key: 'unarchive',
                      label: 'Restore',
                      icon: <RestoreIcon className="h-4 w-4" />,
                      onClick: () => onUnarchive?.(note),
                      hidden: view !== 'archived' || !onUnarchive,
                    },
                    {
                      key: 'restore',
                      label: 'Restore',
                      icon: <RestoreIcon className="h-4 w-4" />,
                      onClick: () => onRestore?.(note),
                      hidden: view !== 'deleted' || !onRestore,
                    },
                    {
                      key: 'delete',
                      label: view === 'deleted' ? 'Delete Permanently' : 'Delete',
                      icon: <TrashIcon className="h-4 w-4" />,
                      onClick: () => onDelete!(note),
                      danger: true,
                    },
                  ]}
                >
                  {onTagAdd && tagSuggestions && (
                    <ContentCard.AddTagAction
                      existingTags={note.tags}
                      suggestions={tagSuggestions}
                      onAdd={(tag) => onTagAdd(note, tag)}
                    />
                  )}
                  {view !== 'deleted' && (
                    <CopyContentButton contentType="note" id={note.id} />
                  )}
                  {onArchive && (
                    <ContentCard.ArchiveAction
                      onArchive={() => onArchive(note)}
                      entityName="note"
                    />
                  )}
                  {view === 'archived' && onUnarchive && (
                    <ContentCard.RestoreAction
                      onRestore={() => onUnarchive(note)}
                      entityName="note"
                    />
                  )}
                  {view === 'deleted' && onRestore && (
                    <ContentCard.RestoreAction
                      onRestore={() => onRestore(note)}
                      entityName="note"
                    />
                  )}
                  <ContentCard.DeleteAction
                    onDelete={() => onDelete!(note)}
                    entityName="note"
                  />
                </ContentCard.Actions>
              </div>
            )}
          </div>
        </div>
      </div>
    </ContentCard>
  )
}
