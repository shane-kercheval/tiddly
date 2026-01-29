/**
 * Component for displaying a single prompt card in list view.
 *
 * Uses ContentCard composition for shared layout, tags, actions, and date display.
 * Prompt-specific header (icon, title/name display, description) stays here.
 */
import type { ReactNode } from 'react'
import type { PromptListItem, TagCount } from '../types'
import type { SortByOption } from '../constants/sortOptions'
import { CONTENT_TYPE_ICON_COLORS } from '../constants/contentTypeStyles'
import { truncate } from '../utils'
import { CopyContentButton } from './ui'
import { PromptIcon } from './icons'
import { ContentCard } from './ContentCard'

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
  onTagAdd?: (prompt: PromptListItem, tag: string) => void
  tagSuggestions?: TagCount[]
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
  onTagAdd,
  tagSuggestions,
  onCancelScheduledArchive,
}: PromptCardProps): ReactNode {
  // Display title if present, otherwise use name
  const displayName = prompt.title || prompt.name
  // Show description if present
  const previewText = prompt.description || ''

  const handleTitleClick = (e: React.MouseEvent): void => {
    e.stopPropagation() // Prevent card click from triggering edit
    onView?.(prompt)
  }

  return (
    <ContentCard
      view={view}
      onClick={onView ? () => onView(prompt) : undefined}
    >
      {/* Header stays in PromptCard - prompt-specific */}
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

      {/* Footer wraps tags + actions for responsive layout (md:contents) */}
      <ContentCard.Footer>
        <ContentCard.Tags
          tags={prompt.tags}
          onTagClick={onTagClick}
          onTagRemove={onTagRemove ? (tag) => onTagRemove(prompt, tag) : undefined}
        />

        <ContentCard.Actions
          meta={
            <>
              <ContentCard.DateDisplay
                sortBy={sortBy}
                createdAt={prompt.created_at}
                updatedAt={prompt.updated_at}
                lastUsedAt={prompt.last_used_at}
                archivedAt={prompt.archived_at}
                deletedAt={prompt.deleted_at}
              />
              {onCancelScheduledArchive && (
                <ContentCard.ScheduledArchive
                  archivedAt={prompt.archived_at}
                  onCancel={() => onCancelScheduledArchive(prompt)}
                />
              )}
            </>
          }
        >
          {/* Add tag button */}
          {onTagAdd && tagSuggestions && (
            <ContentCard.AddTagAction
              existingTags={prompt.tags}
              suggestions={tagSuggestions}
              onAdd={(tag) => onTagAdd(prompt, tag)}
            />
          )}

          {/* Copy button - shown in active and archived views */}
          {view !== 'deleted' && (
            <CopyContentButton contentType="prompt" id={prompt.id} />
          )}

          {/* Archive button - shown in active view only (via context) */}
          {onArchive && (
            <ContentCard.ArchiveAction
              onArchive={() => onArchive(prompt)}
              entityName="prompt"
            />
          )}

          {/* Restore button - shown in archived view (unarchive action) */}
          {view === 'archived' && onUnarchive && (
            <ContentCard.RestoreAction
              onRestore={() => onUnarchive(prompt)}
              entityName="prompt"
            />
          )}

          {/* Restore button - shown in deleted view */}
          {view === 'deleted' && onRestore && (
            <ContentCard.RestoreAction
              onRestore={() => onRestore(prompt)}
              entityName="prompt"
            />
          )}

          {/* Delete button - shown in all views */}
          <ContentCard.DeleteAction
            onDelete={() => onDelete(prompt)}
            entityName="prompt"
          />
        </ContentCard.Actions>
      </ContentCard.Footer>
    </ContentCard>
  )
}
