/**
 * Component for displaying a single bookmark card.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { BookmarkListItem } from '../types'
import type { SortByOption } from '../constants/sortOptions'
import { formatDate, truncate, getDomain, getUrlWithoutProtocol, getGoogleFaviconUrl } from '../utils'
import { ConfirmDeleteButton } from './ui'
import {
  BookmarkIcon,
  CopyIcon,
  CheckIcon,
  EditIcon,
  ArchiveIcon,
  RestoreIcon,
  TrashIcon,
  CloseIcon,
} from './icons'
import { CONTENT_TYPE_ICON_COLORS } from '../constants/contentTypeStyles'
import { Tag } from './Tag'

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

  // Dynamic date display based on current sort option
  const getDateDisplay = (): string => {
    switch (sortBy) {
      case 'updated_at':
        return `Modified: ${formatDate(bookmark.updated_at)}`
      case 'last_used_at':
        return `Used: ${formatDate(bookmark.last_used_at)}`
      case 'created_at':
      case 'title':
      default:
        return `Created: ${formatDate(bookmark.created_at)}`
    }
  }

  // Check if bookmark has a scheduled future archive date
  const hasScheduledArchive = view === 'active' &&
    bookmark.archived_at &&
    new Date(bookmark.archived_at) > new Date()

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

  return (
    <div
      className="card card-interactive group cursor-pointer"
      onClick={handleCardClick}
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-start md:gap-4">
        {/* Row 1 (mobile) / Main content (desktop) */}
        <div className="min-w-0 flex-1 overflow-hidden">
          {/* Title row */}
          <div className="flex items-center gap-2 md:flex-wrap">
            {/* Left icon: BookmarkIcon in multi-content view, Favicon in bookmarks-only view */}
            {showContentTypeIcon ? (
              <span className={`shrink-0 w-4 h-4 ${CONTENT_TYPE_ICON_COLORS.bookmark}`}>
                <BookmarkIcon className="w-4 h-4" />
              </span>
            ) : (
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
            {showContentTypeIcon && (
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
            )}
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

        {/* Row 2 (mobile): tags + actions + date */}
        <div className="flex items-center gap-2 md:contents">
          {/* Tags */}
          {bookmark.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 flex-1 md:flex-initial md:justify-end md:w-32 md:shrink-0">
              {bookmark.tags.map((tag) => (
                <Tag
                  key={tag}
                  tag={tag}
                  onClick={onTagClick ? () => onTagClick(tag) : undefined}
                  onRemove={onTagRemove ? () => onTagRemove(bookmark, tag) : undefined}
                />
              ))}
            </div>
          )}

          {/* Actions and date */}
          <div className="flex items-center gap-1 md:flex-col md:items-end shrink-0 ml-auto md:ml-0">
            <div className="flex items-center">
              {/* Edit button - shown in active and archived views */}
              {view !== 'deleted' && onEdit && (
                <button
                  onClick={(e) => { e.stopPropagation(); onEdit(bookmark) }}
                  className="btn-icon"
                  title="Edit bookmark"
                  aria-label="Edit bookmark"
                >
                  {isLoading ? (
                    <div className="spinner-sm" />
                  ) : (
                    <EditIcon />
                  )}
                </button>
              )}

              {/* Copy URL button */}
              <button
                onClick={(e) => { e.stopPropagation(); handleCopyUrl() }}
                className="btn-icon"
                title={copySuccess ? 'Copied!' : 'Copy URL'}
                aria-label={copySuccess ? 'Copied!' : 'Copy URL'}
              >
                {copySuccess ? (
                  <CheckIcon className="h-4 w-4 text-green-600" />
                ) : (
                  <CopyIcon />
                )}
              </button>

              {/* Archive button - shown in active view */}
              {view === 'active' && onArchive && (
                <button
                  onClick={(e) => { e.stopPropagation(); onArchive(bookmark) }}
                  className="btn-icon"
                  title="Archive bookmark"
                  aria-label="Archive bookmark"
                >
                  <ArchiveIcon className="h-4 w-4" />
                </button>
              )}

              {/* Restore button - shown in archived view (unarchive action) */}
              {view === 'archived' && onUnarchive && (
                <button
                  onClick={(e) => { e.stopPropagation(); onUnarchive(bookmark) }}
                  className="btn-icon"
                  title="Restore bookmark"
                  aria-label="Restore bookmark"
                >
                  <RestoreIcon />
                </button>
              )}

              {/* Restore button - shown in deleted view */}
              {view === 'deleted' && onRestore && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRestore(bookmark) }}
                  className="btn-icon"
                  title="Restore bookmark"
                  aria-label="Restore bookmark"
                >
                  <RestoreIcon />
                </button>
              )}

              {/* Delete button - shown in all views */}
              {/* Use ConfirmDeleteButton for permanent delete in trash view */}
              {view === 'deleted' ? (
                <span onClick={(e) => e.stopPropagation()}>
                  <ConfirmDeleteButton
                    onConfirm={() => onDelete(bookmark)}
                    title="Delete permanently"
                  />
                </span>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(bookmark) }}
                  className="btn-icon-danger"
                  title="Delete bookmark"
                  aria-label="Delete bookmark"
                >
                  <TrashIcon />
                </button>
              )}
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-xs text-gray-400">
                {getDateDisplay()}
              </span>
              {hasScheduledArchive && bookmark.archived_at && (
                <span className="flex items-center gap-1 text-xs text-amber-600">
                  <span>Archiving: {formatDate(bookmark.archived_at)}</span>
                  {onCancelScheduledArchive && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onCancelScheduledArchive(bookmark) }}
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
