/**
 * Component for displaying a single bookmark card in list view.
 *
 * Responsive layout:
 * - Mobile: Vertical stacking with always-visible actions
 * - Desktop: Horizontal compact layout with hover-revealed actions
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import type { BookmarkListItem, TagCount } from '../types'
import type { SortByOption } from '../constants/sortOptions'
import { getDomain, getGoogleFaviconUrl } from '../utils'
import { Tooltip } from './ui'
import {
  BookmarkIcon,
  CopyIcon,
  CheckIcon,
  ExternalLinkIcon,
} from './icons'
import { CONTENT_TYPE_ICON_COLORS } from '../constants/contentTypeStyles'
import { ContentCard } from './ContentCard'

interface BookmarkCardProps {
  bookmark: BookmarkListItem
  view?: 'active' | 'archived' | 'deleted'
  sortBy?: SortByOption
  /** Whether to show dates on the card. Defaults to true. */
  showDate?: boolean
  /** Generic card click handler (does not imply action availability). */
  onClick?: (bookmark: BookmarkListItem) => void
  onEdit?: (bookmark: BookmarkListItem) => void
  onDelete?: (bookmark: BookmarkListItem) => void
  onArchive?: (bookmark: BookmarkListItem) => void
  onUnarchive?: (bookmark: BookmarkListItem) => void
  onRestore?: (bookmark: BookmarkListItem) => void
  onTagClick?: (tag: string) => void
  onTagRemove?: (bookmark: BookmarkListItem, tag: string) => void
  onTagAdd?: (bookmark: BookmarkListItem, tag: string) => void
  tagSuggestions?: TagCount[]
  onLinkClick?: (bookmark: BookmarkListItem) => void
  onCancelScheduledArchive?: (bookmark: BookmarkListItem) => void
  /** When true, show an amber archived indicator badge for effectively archived items */
  showArchivedIndicator?: boolean
}

export function BookmarkCard({
  bookmark,
  view = 'active',
  sortBy = 'created_at',
  showDate = true,
  onClick,
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
  showArchivedIndicator,
}: BookmarkCardProps): ReactNode {
  const hasActions = !!(onDelete || onArchive || onUnarchive || onRestore || onEdit || onTagAdd || onCancelScheduledArchive)
  const hasTitle = !!bookmark.title
  const displayTitle = bookmark.title || getDomain(bookmark.url)
  const domain = getDomain(bookmark.url)
  // URL without query parameters for cleaner display
  const displayUrl = bookmark.url.split('?')[0]
  const faviconUrl = getGoogleFaviconUrl(bookmark.url) ?? `https://icons.duckduckgo.com/ip3/${domain}.ico`

  const [faviconError, setFaviconError] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  const [linkHovered, setLinkHovered] = useState(false)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const linkTooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
      if (linkTooltipTimeoutRef.current) clearTimeout(linkTooltipTimeoutRef.current)
    }
  }, [])

  // Show/hide link tooltip with small delay on hide to prevent flicker between elements
  const showLinkTooltip = useCallback((): void => {
    if (linkTooltipTimeoutRef.current) {
      clearTimeout(linkTooltipTimeoutRef.current)
      linkTooltipTimeoutRef.current = null
    }
    setLinkHovered(true)
  }, [])
  const hideLinkTooltip = useCallback((): void => {
    linkTooltipTimeoutRef.current = setTimeout(() => setLinkHovered(false), 50)
  }, [])

  const handleCardClick = (): void => {
    if (onClick) {
      onClick(bookmark)
    } else if (onEdit && view !== 'deleted') {
      onEdit(bookmark)
    }
  }

  // Handle URL link click - track usage unless in silent mode (shift+cmd/ctrl)
  // Note: Does not preventDefault, allowing native link behavior (middle-click, right-click menu)
  const handleUrlClick = (e: React.MouseEvent): void => {
    e.stopPropagation()
    // Silent mode: shift+cmd/ctrl click doesn't track usage
    if (!(e.shiftKey && (e.metaKey || e.ctrlKey))) {
      onLinkClick?.(bookmark)
    }
  }

  const handleCopyUrl = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(bookmark.url)
      setCopySuccess(true)
      onLinkClick?.(bookmark)
      copyTimeoutRef.current = setTimeout(() => setCopySuccess(false), 1000)
    } catch (err) {
      console.error('Failed to copy URL:', err)
    }
  }

  return (
    <ContentCard
      className="group/link"
      view={view}
      onClick={handleCardClick}
      href={`/app/bookmarks/${bookmark.id}`}
    >
      {/* Column 1: Favicon with crossfade to ExternalLinkIcon, BookmarkIcon fallback on load error.
          Crossfade triggers when any .link-area element (favicon, title, URL) is hovered. */}
      <span
        className="link-area relative w-4 h-4 mt-1"
        onClick={(e) => { e.stopPropagation(); handleUrlClick(e); window.open(bookmark.url, '_blank', 'noopener,noreferrer') }}
        onMouseEnter={showLinkTooltip}
        onMouseLeave={hideLinkTooltip}
      >
        {faviconError ? (
          <BookmarkIcon className={`w-4 h-4 ${CONTENT_TYPE_ICON_COLORS.bookmark}`} />
        ) : (
          <>
            <img
              src={faviconUrl}
              alt=""
              className="absolute inset-0 w-4 h-4 opacity-100 md:group-has-[.link-area:hover]/link:opacity-0 transition-opacity duration-150"
              loading="lazy"
              onError={() => setFaviconError(true)}
            />
            <ExternalLinkIcon className="absolute inset-0 w-4 h-4 text-blue-500 opacity-0 md:group-has-[.link-area:hover]/link:opacity-100 transition-opacity duration-150" />
          </>
        )}
      </span>

      {/* Column 2: Content - responsive layout */}
      <div className="min-w-0 flex-1">
        {/* Mobile layout - stacked vertically */}
        <div className="md:hidden flex flex-col gap-1.5">
          {/* Title row */}
          {hasTitle ? (
            <span className="text-base font-medium text-gray-900 truncate">{displayTitle}</span>
          ) : (
            <Tooltip content="Open URL in new tab" compact>
              <a
                href={bookmark.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleUrlClick}
                className="text-base font-medium text-gray-900 truncate hover:text-blue-600 hover:underline transition-colors"
              >
                {displayTitle}
              </a>
            </Tooltip>
          )}

          {/* URL row (if has title) - always show as link on mobile */}
          {hasTitle && (
            <Tooltip content="Open URL in new tab" compact>
              <a
                href={bookmark.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleUrlClick}
                className="text-[13px] text-blue-500 underline truncate block"
              >
                {displayUrl}
              </a>
            </Tooltip>
          )}

          {/* Description or content preview */}
          {(bookmark.description || bookmark.content_preview) && (
            <p className="text-sm text-gray-400 line-clamp-2">
              {bookmark.description || bookmark.content_preview}
            </p>
          )}

          {/* Tags row */}
          {bookmark.tags.length > 0 && (
            <ContentCard.Tags
              tags={bookmark.tags}
              onTagClick={onTagClick}
              onTagRemove={onTagRemove ? (tag) => onTagRemove(bookmark, tag) : undefined}
            />
          )}

          {/* Actions and date row */}
          {hasActions && (
            <div className="flex items-center justify-between">
              {/* Actions - always visible on mobile, -ml-2 compensates for btn-icon padding */}
              <div className="flex items-center gap-0.5 -ml-2">
                {/* External link as first action on mobile */}
                <Tooltip content="Open link" compact>
                  <button
                    onClick={(e) => { e.stopPropagation(); onLinkClick?.(bookmark); window.open(bookmark.url, '_blank', 'noopener,noreferrer') }}
                    className="btn-icon"
                    aria-label="Open link"
                  >
                    <ExternalLinkIcon className="h-4 w-4" />
                  </button>
                </Tooltip>
                {onTagAdd && tagSuggestions && (
                  <ContentCard.AddTagAction
                    existingTags={bookmark.tags}
                    suggestions={tagSuggestions}
                    onAdd={(tag) => onTagAdd(bookmark, tag)}
                  />
                )}
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
                {onArchive && (
                  <ContentCard.ArchiveAction
                    onArchive={() => onArchive(bookmark)}
                    entityName="bookmark"
                  />
                )}
                {view === 'archived' && onUnarchive && (
                  <ContentCard.RestoreAction
                    onRestore={() => onUnarchive(bookmark)}
                    entityName="bookmark"
                  />
                )}
                {view === 'deleted' && onRestore && (
                  <ContentCard.RestoreAction
                    onRestore={() => onRestore(bookmark)}
                    entityName="bookmark"
                  />
                )}
                {onDelete && (
                  <ContentCard.DeleteAction
                    onDelete={() => onDelete(bookmark)}
                    entityName="bookmark"
                  />
                )}
              </div>

              {/* Date and archiving indicator */}
              <div className="flex flex-col items-end gap-0.5">
                <ContentCard.DateDisplay
                  sortBy={sortBy}
                  createdAt={bookmark.created_at}
                  updatedAt={bookmark.updated_at}
                  lastUsedAt={bookmark.last_used_at}
                  archivedAt={bookmark.archived_at}
                  deletedAt={bookmark.deleted_at}
                  showLabel
                />
                {(onCancelScheduledArchive || showArchivedIndicator) && (
                  <ContentCard.ArchiveStatus
                    archivedAt={bookmark.archived_at}
                    onCancel={onCancelScheduledArchive ? () => onCancelScheduledArchive(bookmark) : undefined}
                    showArchivedIndicator={showArchivedIndicator}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Desktop layout - horizontal with hover actions */}
        <div className="hidden md:block relative">
          {/* Row 1: Title + tags + date */}
          <div className="flex items-baseline gap-2">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0 flex-1">
              {hasTitle ? (
                <a
                  href={bookmark.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={handleUrlClick}
                  onMouseEnter={showLinkTooltip}
                  onMouseLeave={hideLinkTooltip}
                  className="link-area text-base font-medium text-gray-900 truncate group-has-[.link-area:hover]/link:text-blue-600 transition-colors"
                >
                  {displayTitle}
                </a>
              ) : (
                <Tooltip content="Open URL in new tab" compact show={linkHovered || undefined}>
                  <a
                    href={bookmark.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleUrlClick}
                    onMouseEnter={showLinkTooltip}
                    onMouseLeave={hideLinkTooltip}
                    className="link-area text-base font-medium text-gray-900 truncate group-has-[.link-area:hover]/link:text-blue-600 transition-colors"
                  >
                    {displayTitle}
                  </a>
                </Tooltip>
              )}
              <ContentCard.Tags
                tags={bookmark.tags}
                onTagClick={onTagClick}
                onTagRemove={onTagRemove ? (tag) => onTagRemove(bookmark, tag) : undefined}
              />
            </div>

            {/* Right: Scheduled archive + Date */}
            {(onCancelScheduledArchive || showArchivedIndicator) && (
              <ContentCard.ArchiveStatus
                archivedAt={bookmark.archived_at}
                onCancel={onCancelScheduledArchive ? () => onCancelScheduledArchive(bookmark) : undefined}
                showArchivedIndicator={showArchivedIndicator}
              />
            )}
            {/* flex prevents Tooltip's inline-flex wrapper from inflating height via inherited line-height */}
            {showDate && (
              <span className="shrink-0 flex">
                <ContentCard.DateDisplay
                  sortBy={sortBy}
                  createdAt={bookmark.created_at}
                  updatedAt={bookmark.updated_at}
                  lastUsedAt={bookmark.last_used_at}
                  archivedAt={bookmark.archived_at}
                  deletedAt={bookmark.deleted_at}
                />
              </span>
            )}
          </div>

          {/* Row 2: URL */}
          {hasTitle && (
            <div className="mt-0.5">
              <Tooltip content="Open URL in new tab" compact show={linkHovered || undefined}>
                <a
                  href={bookmark.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={handleUrlClick}
                  onMouseEnter={showLinkTooltip}
                  onMouseLeave={hideLinkTooltip}
                  className="link-area text-[13px] text-gray-400 truncate block group-has-[.link-area:hover]/link:text-blue-500 transition-colors duration-150"
                >
                  {displayUrl}
                </a>
              </Tooltip>
            </div>
          )}

          {/* Row 3: Description/preview */}
          {(bookmark.description || bookmark.content_preview) && (
            <p className="text-sm text-gray-400 truncate mt-1">
              {bookmark.description || bookmark.content_preview}
            </p>
          )}

          {/* Spacer so absolute-positioned hover actions don't overlay Row 1.
              Condition must account for all optional content rows above (URL row, description).
              Update if conditional rows are added/removed. */}
          {hasActions && !hasTitle && !(bookmark.description || bookmark.content_preview) && (
            <div className="mt-1 h-5" />
          )}

          {/* Actions absolutely positioned, appear on hover */}
          {hasActions && (
            <div className="absolute right-0 bottom-0">
              <ContentCard.Actions>
                {onTagAdd && tagSuggestions && (
                  <ContentCard.AddTagAction
                    existingTags={bookmark.tags}
                    suggestions={tagSuggestions}
                    onAdd={(tag) => onTagAdd(bookmark, tag)}
                  />
                )}
                {/* Edit button removed - clicking card row opens edit view */}
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
                {onArchive && (
                  <ContentCard.ArchiveAction
                    onArchive={() => onArchive(bookmark)}
                    entityName="bookmark"
                  />
                )}
                {view === 'archived' && onUnarchive && (
                  <ContentCard.RestoreAction
                    onRestore={() => onUnarchive(bookmark)}
                    entityName="bookmark"
                  />
                )}
                {view === 'deleted' && onRestore && (
                  <ContentCard.RestoreAction
                    onRestore={() => onRestore(bookmark)}
                    entityName="bookmark"
                  />
                )}
                {onDelete && (
                  <ContentCard.DeleteAction
                    onDelete={() => onDelete(bookmark)}
                    entityName="bookmark"
                  />
                )}
              </ContentCard.Actions>
            </div>
          )}
        </div>
      </div>
    </ContentCard>
  )
}
