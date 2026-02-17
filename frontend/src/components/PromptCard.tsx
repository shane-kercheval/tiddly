/**
 * Component for displaying a single prompt card in list view.
 *
 * Responsive layout:
 * - Mobile: Vertical stacking with always-visible actions
 * - Desktop: Horizontal compact layout with hover-revealed actions
 */
import type { ReactNode } from 'react'
import type { PromptListItem, TagCount } from '../types'
import type { SortByOption } from '../constants/sortOptions'
import { CONTENT_TYPE_ICON_COLORS } from '../constants/contentTypeStyles'
import { CopyContentButton } from './ui'
import { PromptIcon, ArchiveIcon, RestoreIcon, TrashIcon } from './icons'
import { ContentCard } from './ContentCard'

interface PromptCardProps {
  prompt: PromptListItem
  view?: 'active' | 'archived' | 'deleted'
  sortBy?: SortByOption
  /** Whether to show dates on the card. Defaults to true. */
  showDate?: boolean
  /** Generic card click handler (does not imply action availability). */
  onClick?: (prompt: PromptListItem) => void
  onView?: (prompt: PromptListItem) => void
  onDelete?: (prompt: PromptListItem) => void
  onArchive?: (prompt: PromptListItem) => void
  onUnarchive?: (prompt: PromptListItem) => void
  onRestore?: (prompt: PromptListItem) => void
  onTagClick?: (tag: string) => void
  onTagRemove?: (prompt: PromptListItem, tag: string) => void
  onTagAdd?: (prompt: PromptListItem, tag: string) => void
  tagSuggestions?: TagCount[]
  onCancelScheduledArchive?: (prompt: PromptListItem) => void
}

export function PromptCard({
  prompt,
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
}: PromptCardProps): ReactNode {
  const hasActions = !!(onDelete || onArchive || onUnarchive || onRestore || onTagAdd || onCancelScheduledArchive)
  // Display title if present, otherwise use name
  const displayName = prompt.title || prompt.name
  const previewText = prompt.description || prompt.content_preview || ''
  // Show name below title if they differ
  const showName = prompt.title && prompt.title !== prompt.name

  const handleTitleClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (onView) onView(prompt)
    else onClick?.(prompt)
  }

  return (
    <ContentCard
      view={view}
      onClick={onClick ? () => onClick(prompt) : onView ? () => onView(prompt) : undefined}
    >
      {/* Column 1: Icon */}
      <span className={`w-4 h-4 mt-1 ${CONTENT_TYPE_ICON_COLORS.prompt}`}>
        <PromptIcon className="w-4 h-4" />
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
              title="View prompt"
            >
              {displayName}
            </button>
          </div>

          {/* Name (if different from title) */}
          {showName && (
            <span className="text-xs text-gray-400 font-mono truncate">{prompt.name}</span>
          )}

          {/* Description */}
          {previewText && (
            <p className="text-sm text-gray-400 line-clamp-2">
              {previewText}
            </p>
          )}

          {/* Tags row */}
          {prompt.tags.length > 0 && (
            <ContentCard.Tags
              tags={prompt.tags}
              onTagClick={onTagClick}
              onTagRemove={onTagRemove ? (tag) => onTagRemove(prompt, tag) : undefined}
            />
          )}

          {/* Actions and date row */}
          {hasActions && (
            <div className="flex items-center justify-between">
              {/* Actions - always visible on mobile */}
              <div className="flex items-center gap-0.5">
                {onTagAdd && tagSuggestions && (
                  <ContentCard.AddTagAction
                    existingTags={prompt.tags}
                    suggestions={tagSuggestions}
                    onAdd={(tag) => onTagAdd(prompt, tag)}
                  />
                )}
                {view !== 'deleted' && (
                  <CopyContentButton contentType="prompt" id={prompt.id} />
                )}
                {onArchive && (
                  <ContentCard.ArchiveAction
                    onArchive={() => onArchive(prompt)}
                    entityName="prompt"
                  />
                )}
                {view === 'archived' && onUnarchive && (
                  <ContentCard.RestoreAction
                    onRestore={() => onUnarchive(prompt)}
                    entityName="prompt"
                  />
                )}
                {view === 'deleted' && onRestore && (
                  <ContentCard.RestoreAction
                    onRestore={() => onRestore(prompt)}
                    entityName="prompt"
                  />
                )}
                {onDelete && (
                  <ContentCard.DeleteAction
                    onDelete={() => onDelete(prompt)}
                    entityName="prompt"
                  />
                )}
              </div>

              {/* Date and archiving indicator */}
              <div className="flex flex-col items-end gap-0.5">
                <ContentCard.DateDisplay
                  sortBy={sortBy}
                  createdAt={prompt.created_at}
                  updatedAt={prompt.updated_at}
                  lastUsedAt={prompt.last_used_at}
                  archivedAt={prompt.archived_at}
                  deletedAt={prompt.deleted_at}
                  showLabel
                />
                {onCancelScheduledArchive && (
                  <ContentCard.ScheduledArchive
                    archivedAt={prompt.archived_at}
                    onCancel={() => onCancelScheduledArchive(prompt)}
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
                title="View prompt"
              >
                {displayName}
              </button>
              <ContentCard.Tags
                tags={prompt.tags}
                onTagClick={onTagClick}
                onTagRemove={onTagRemove ? (tag) => onTagRemove(prompt, tag) : undefined}
              />
            </div>

            {/* Right: Date */}
            {showDate && (
              <div className="shrink-0">
                <ContentCard.DateDisplay
                  sortBy={sortBy}
                  createdAt={prompt.created_at}
                  updatedAt={prompt.updated_at}
                  lastUsedAt={prompt.last_used_at}
                  archivedAt={prompt.archived_at}
                  deletedAt={prompt.deleted_at}
                />
              </div>
            )}
          </div>

          {/* Row 2: Name (if different from title) + Archiving indicator */}
          <div className="flex items-center gap-2 mt-0.5">
            {showName && (
              <span className="text-xs text-gray-400 font-mono truncate">{prompt.name}</span>
            )}
            <div className="flex-1" />
            {onCancelScheduledArchive && (
              <ContentCard.ScheduledArchive
                archivedAt={prompt.archived_at}
                onCancel={() => onCancelScheduledArchive(prompt)}
              />
            )}
          </div>

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
                      onClick: () => onArchive?.(prompt),
                      hidden: !onArchive || view !== 'active',
                    },
                    {
                      key: 'unarchive',
                      label: 'Restore',
                      icon: <RestoreIcon className="h-4 w-4" />,
                      onClick: () => onUnarchive?.(prompt),
                      hidden: view !== 'archived' || !onUnarchive,
                    },
                    {
                      key: 'restore',
                      label: 'Restore',
                      icon: <RestoreIcon className="h-4 w-4" />,
                      onClick: () => onRestore?.(prompt),
                      hidden: view !== 'deleted' || !onRestore,
                    },
                    {
                      key: 'delete',
                      label: view === 'deleted' ? 'Delete Permanently' : 'Delete',
                      icon: <TrashIcon className="h-4 w-4" />,
                      onClick: () => onDelete?.(prompt),
                      danger: true,
                      hidden: !onDelete,
                    },
                  ]}
                >
                  {onTagAdd && tagSuggestions && (
                    <ContentCard.AddTagAction
                      existingTags={prompt.tags}
                      suggestions={tagSuggestions}
                      onAdd={(tag) => onTagAdd(prompt, tag)}
                    />
                  )}
                  {view !== 'deleted' && (
                    <CopyContentButton contentType="prompt" id={prompt.id} />
                  )}
                  {onArchive && (
                    <ContentCard.ArchiveAction
                      onArchive={() => onArchive(prompt)}
                      entityName="prompt"
                    />
                  )}
                  {view === 'archived' && onUnarchive && (
                    <ContentCard.RestoreAction
                      onRestore={() => onUnarchive(prompt)}
                      entityName="prompt"
                    />
                  )}
                  {view === 'deleted' && onRestore && (
                    <ContentCard.RestoreAction
                      onRestore={() => onRestore(prompt)}
                      entityName="prompt"
                    />
                  )}
                  {onDelete && (
                    <ContentCard.DeleteAction
                      onDelete={() => onDelete(prompt)}
                      entityName="prompt"
                    />
                  )}
                </ContentCard.Actions>
              </div>
            )}
          </div>
        </div>
      </div>
    </ContentCard>
  )
}
