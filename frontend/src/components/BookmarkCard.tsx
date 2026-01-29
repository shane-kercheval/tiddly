/**
 * Component for displaying a single bookmark card.
 *
 * Uses ContentCard composition for shared layout, tags, actions, and date display.
 * Bookmark-specific features (favicon, URL display, copy button, edit button,
 * showContentTypeIcon toggle, link click tracking) stay here.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { BookmarkListItem, TagCount } from '../types'
import type { SortByOption } from '../constants/sortOptions'
import { truncate, getDomain, getUrlWithoutProtocol, getGoogleFaviconUrl } from '../utils'
import { Tooltip } from './ui'
import {
  BookmarkIcon,
  CopyIcon,
  CheckIcon,
  EditIcon,
} from './icons'
import { CONTENT_TYPE_ICON_COLORS } from '../constants/contentTypeStyles'
import { ContentCard } from './ContentCard'

interface BookmarkCardProps {
  bookmark: BookmarkListItem
  view?: 'active' | 'archived' | 'deleted'
  sortBy?: SortByOption
  /**
   * Whether to show the bookmark content type icon on the left.
   * When true (default): [BookmarkIcon] [Title] [Favicon] [URL]
   * When false: [Favicon] [Title] [URL] (used in bookmarks-only views)
   */
  showContentTypeIcon?: boolean
  onEdit?: (bookmark: BookmarkListItem) => void
  onDelete: (bookmark: BookmarkListItem) => void
  onArchive?: (bookmark: BookmarkListItem) => void
  onUnarchive?: (bookmark: BookmarkListItem) => void
  onRestore?: (bookmark: BookmarkListItem) => void
  onTagClick?: (tag: string) => void
  onTagRemove?: (bookmark: BookmarkListItem, tag: string) => void
  onTagAdd?: (bookmark: BookmarkListItem, tag: string) => void
  tagSuggestions?: TagCount[]
  onLinkClick?: (bookmark: BookmarkListItem) => void
  /** Called when user cancels a scheduled auto-archive */
  onCancelScheduledArchive?: (bookmark: BookmarkListItem) => void
  /** Whether the edit action is currently loading (fetching full bookmark) */
  isLoading?: boolean
}

/**
 * BookmarkCard displays a single bookmark with its metadata.
 *
 * Features:
 * - Clickable title/URL opens in new tab
 * - Context-aware action buttons based on view:
 *   - active: edit, archive, delete
 *   - archived: edit, restore, delete
 *   - deleted: restore, permanent delete
 * - Clickable tags for filtering
 * - Truncated description
 */
export function BookmarkCard({
  bookmark,
  view = 'active',
  sortBy = 'created_at',
  showContentTypeIcon = true,
  onEdit,
  onDelete,
  onArchive,
  onUnarchive,
  onRestore,
  onTagClick,
  onTagRemove,
  onTagAdd,
  tagSuggestions,
  onLinkClick,
  onCancelScheduledArchive,
  isLoading = false,
}: BookmarkCardProps): ReactNode {
  const hasTitle = !!bookmark.title
  const displayTitle = bookmark.title || getDomain(bookmark.url)
  const urlDisplay = getUrlWithoutProtocol(bookmark.url)
  const domain = getDomain(bookmark.url)
  // Use Google product-specific favicon if available, otherwise fall back to DuckDuckGo
  const faviconUrl = getGoogleFaviconUrl(bookmark.url) ?? `https://icons.duckduckgo.com/ip3/${domain}.ico`
  const defaultFavicon = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%239CA3AF" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`

  // State for copy button feedback
  const [copySuccess, setCopySuccess] = useState(false)

  // Track usage when link is clicked (unless shift+modifier key is held for silent mode)
  const handleLinkClick = (e: React.MouseEvent): void => {
    e.stopPropagation() // Prevent card click from triggering edit
    // Skip tracking if shift+cmd/ctrl held (silent mode: open without tracking)
    if (e.shiftKey && (e.metaKey || e.ctrlKey)) {
      return
    }
    onLinkClick?.(bookmark)
  }

  // Handle card click to open bookmark URL
  const handleCardClick = (): void => {
    // Track usage
    onLinkClick?.(bookmark)
    // Open in new tab
    window.open(bookmark.url, '_blank', 'noopener,noreferrer')
  }

  // Copy URL to clipboard with visual feedback
  const handleCopyUrl = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(bookmark.url)
      setCopySuccess(true)
      // Track usage when copying
      onLinkClick?.(bookmark)
      // Reset after brief flash
      setTimeout(() => setCopySuccess(false), 1000)
    } catch (err) {
      console.error('Failed to copy URL:', err)
    }
  }

  // Render favicon with link to URL
  const renderFavicon = (): ReactNode => (
    <a
      href={bookmark.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleLinkClick}
      className="shrink-0"
    >
      <img
        src={faviconUrl}
        alt=""
        className="w-4 h-4"
        loading="lazy"
        onError={(e) => {
          e.currentTarget.src = defaultFavicon
        }}
      />
    </a>
  )

  return (
    <ContentCard
      view={view}
      onClick={handleCardClick}
      className="cursor-pointer"
    >
      {/* Header stays in BookmarkCard - bookmark-specific */}
      <div className="min-w-0 flex-1 overflow-hidden">
        {/* Title row */}
        <div className="flex items-center gap-2 md:flex-wrap">
          {/* Left icon: BookmarkIcon in multi-content view, Favicon in bookmarks-only view */}
          {showContentTypeIcon ? (
            <span className={`shrink-0 w-4 h-4 ${CONTENT_TYPE_ICON_COLORS.bookmark}`}>
              <BookmarkIcon className="w-4 h-4" />
            </span>
          ) : (
            renderFavicon()
          )}
          <a
            href={bookmark.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleLinkClick}
            className="text-base font-medium text-gray-900 truncate min-w-0 md:shrink-0"
            title={bookmark.url}
          >
            {truncate(displayTitle, 60)}
          </a>
          {/* Favicon between title and URL - only in multi-content view */}
          {showContentTypeIcon && renderFavicon()}
          {/* URL inline on desktop */}
          {hasTitle && (
            <a
              href={bookmark.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleLinkClick}
              className="hidden md:inline text-sm text-gray-400 truncate min-w-0"
              title={bookmark.url}
            >
              {urlDisplay}
            </a>
          )}
        </div>
        {/* URL on separate line - mobile only, inline on desktop */}
        {hasTitle && (
          <a
            href={bookmark.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleLinkClick}
            className="block md:hidden mt-0.5 text-sm text-gray-400 truncate"
            title={bookmark.url}
          >
            {urlDisplay}
          </a>
        )}

        {/* Description - 2 lines on mobile, 1 line on desktop */}
        {bookmark.description && (
          <p className="mt-1 text-sm text-gray-500 line-clamp-2 md:line-clamp-1">
            {bookmark.description}
          </p>
        )}
      </div>

      {/* Footer wraps tags + actions for responsive layout (md:contents) */}
      <ContentCard.Footer>
        <ContentCard.Tags
          tags={bookmark.tags}
          onTagClick={onTagClick}
          onTagRemove={onTagRemove ? (tag) => onTagRemove(bookmark, tag) : undefined}
        />

        <ContentCard.Actions
          meta={
            <>
              <ContentCard.DateDisplay
                sortBy={sortBy}
                createdAt={bookmark.created_at}
                updatedAt={bookmark.updated_at}
                lastUsedAt={bookmark.last_used_at}
                archivedAt={bookmark.archived_at}
                deletedAt={bookmark.deleted_at}
              />
              {onCancelScheduledArchive && (
                <ContentCard.ScheduledArchive
                  archivedAt={bookmark.archived_at}
                  onCancel={() => onCancelScheduledArchive(bookmark)}
                />
              )}
            </>
          }
        >
          {/* Add tag button */}
          {onTagAdd && tagSuggestions && (
            <ContentCard.AddTagAction
              existingTags={bookmark.tags}
              suggestions={tagSuggestions}
              onAdd={(tag) => onTagAdd(bookmark, tag)}
            />
          )}

          {/* Edit button - shown in active and archived views (bookmark-specific) */}
          {view !== 'deleted' && onEdit && (
            <Tooltip content="Edit" compact>
              <button
                onClick={(e) => { e.stopPropagation(); onEdit(bookmark) }}
                className="btn-icon"
                aria-label="Edit bookmark"
              >
                {isLoading ? (
                  <div className="spinner-sm" />
                ) : (
                  <EditIcon />
                )}
              </button>
            </Tooltip>
          )}

          {/* Copy URL button (bookmark-specific) */}
          <Tooltip content={copySuccess ? 'Copied!' : 'Copy URL'} compact>
            <button
              onClick={(e) => { e.stopPropagation(); handleCopyUrl() }}
              className="btn-icon"
              aria-label={copySuccess ? 'Copied!' : 'Copy URL'}
            >
              {copySuccess ? (
                <CheckIcon className="h-4 w-4 text-green-600" />
              ) : (
                <CopyIcon />
              )}
            </button>
          </Tooltip>

          {/* Archive button - shown in active view only (via context) */}
          {onArchive && (
            <ContentCard.ArchiveAction
              onArchive={() => onArchive(bookmark)}
              entityName="bookmark"
            />
          )}

          {/* Restore button - shown in archived view (unarchive action) */}
          {view === 'archived' && onUnarchive && (
            <ContentCard.RestoreAction
              onRestore={() => onUnarchive(bookmark)}
              entityName="bookmark"
            />
          )}

          {/* Restore button - shown in deleted view */}
          {view === 'deleted' && onRestore && (
            <ContentCard.RestoreAction
              onRestore={() => onRestore(bookmark)}
              entityName="bookmark"
            />
          )}

          {/* Delete button - shown in all views */}
          <ContentCard.DeleteAction
            onDelete={() => onDelete(bookmark)}
            entityName="bookmark"
          />
        </ContentCard.Actions>
      </ContentCard.Footer>
    </ContentCard>
  )
}
