/**
 * Component for displaying a single bookmark card in list view.
 *
 * Responsive layout:
 * - Mobile: Vertical stacking with always-visible actions
 * - Desktop: Horizontal compact layout with hover-revealed actions
 */
import { useState, useRef, useEffect } from 'react'
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
  showArchivedIndicator = false,
}: BookmarkCardProps): ReactNode {
  const hasActions = !!(onDelete || onArchive || onUnarchive || onRestore || onEdit || onTagAdd || onCancelScheduledArchive)
  const hasTitle = !!bookmark.title
  const displayTitle = bookmark.title || getDomain(bookmark.url)
  const domain = getDomain(bookmark.url)
  // URL without query parameters for cleaner display
  const displayUrl = bookmark.url.split('?')[0]
  const faviconUrl = getGoogleFaviconUrl(bookmark.url) ?? `https://icons.duckduckgo.com/ip3/${domain}.ico`

  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [faviconErrorUrl, setFaviconErrorUrl] = useState<string | null>(null)
  const faviconError = faviconErrorUrl === faviconUrl
  const [copySuccess, setCopySuccess] = useState(false)

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current)
    }
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
      <Tooltip content="Open URL in new tab" compact delay={500} position="bottom-start" className="relative mt-[3px] h-[18px] w-[18px]">
        <a
          href={bookmark.url}
          target="_blank"
          rel="noopener noreferrer"
          className="link-area relative block h-[18px] w-[18px]"
          onClick={handleUrlClick}
        >
          {faviconError ? (
            <BookmarkIcon className={`w-[18px] h-[18px] ${CONTENT_TYPE_ICON_COLORS.bookmark}`} />
          ) : (
            <>
              <img
                src={faviconUrl}
                alt=""
                className="absolute inset-0 w-[18px] h-[18px] opacity-100 md:group-has-[.link-area:hover]/link:opacity-0 transition-opacity duration-150"
                loading="lazy"
                onError={() => setFaviconErrorUrl(faviconUrl)}
              />
              <ExternalLinkIcon className="absolute inset-0 w-[18px] h-[18px] text-blue-500 opacity-0 md:group-has-[.link-area:hover]/link:opacity-100 transition-opacity duration-150" />
            </>
          )}
          {/* Invisible bridge covering the grid gap to the right so hover doesn't drop between favicon and title */}
          <span className="link-area hidden md:block absolute top-0 left-full w-2 h-full" />
        </a>
      </Tooltip>

      {/* Column 2: Content - responsive layout */}
      <div className="min-w-0 flex-1">
        {/* Mobile layout - stacked vertically */}
        <div className="md:hidden flex flex-col gap-1.5">
          {/* Title row */}
          {hasTitle ? (
            <a
              href={bookmark.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={handleUrlClick}
              className="text-base font-medium text-gray-900 truncate"
            >
              {displayTitle}
            </a>
          ) : (
            <Tooltip content="Open URL in new tab" compact delay={500}>
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
            <Tooltip content="Open URL in new tab" compact delay={500}>
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
                <Tooltip content="Open link" compact delay={500}>
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
                    aiContext={{
                      title: bookmark.title,
                      url: bookmark.url,
                      description: bookmark.description,
                      content: bookmark.content_preview,
                      contentType: 'bookmark',
                    }}
                  />
                )}
                <Tooltip content={copySuccess ? 'Copied!' : 'Copy URL'} compact delay={copySuccess ? 0 : 500}>
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
          {/* Reserve a real metadata column so title/URL truncate before reaching tags/date. */}
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2">
            {hasTitle ? (
              <div className="min-w-0 overflow-hidden">
                <Tooltip content="Open URL in new tab" compact delay={500} position="bottom-start" className="flex min-w-0 w-full max-w-full">
                  <a
                    href={bookmark.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleUrlClick}
                    className="link-area flex w-full min-w-0 flex-col overflow-hidden"
                  >
                    <span className="block w-full truncate text-base font-medium text-gray-900 group-has-[.link-area:hover]/link:text-blue-600 transition-colors">
                      {displayTitle}
                    </span>
                    <span className="block w-full truncate pt-0.5 text-[13px] text-gray-400 group-has-[.link-area:hover]/link:text-blue-500 transition-colors duration-150">
                      {displayUrl}
                    </span>
                  </a>
                </Tooltip>
              </div>
            ) : (
              <div className="min-w-0 overflow-hidden">
                <Tooltip content="Open URL in new tab" compact delay={500} position="bottom-start" className="flex min-w-0 w-full max-w-full">
                  <a
                    href={bookmark.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={handleUrlClick}
                    className="link-area block w-full truncate text-base font-medium text-gray-900 group-has-[.link-area:hover]/link:text-blue-600 transition-colors"
                  >
                    {displayTitle}
                  </a>
                </Tooltip>
              </div>
            )}

            <ContentCard.Metadata
              tags={bookmark.tags}
              archivedAt={bookmark.archived_at}
              createdAt={bookmark.created_at}
              updatedAt={bookmark.updated_at}
              lastUsedAt={bookmark.last_used_at}
              deletedAt={bookmark.deleted_at}
              sortBy={sortBy}
              showDate={showDate}
              showArchivedIndicator={showArchivedIndicator}
              onTagClick={onTagClick}
              onTagRemove={onTagRemove ? (tag) => onTagRemove(bookmark, tag) : undefined}
              onCancelScheduledArchive={onCancelScheduledArchive ? () => onCancelScheduledArchive(bookmark) : undefined}
            />
          </div>

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
                    aiContext={{
                      title: bookmark.title,
                      url: bookmark.url,
                      description: bookmark.description,
                      content: bookmark.content_preview,
                      contentType: 'bookmark',
                    }}
                  />
                )}
                {/* Edit button removed - clicking card row opens edit view */}
                <Tooltip content={copySuccess ? 'Copied!' : 'Copy URL'} compact delay={copySuccess ? 0 : 500}>
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
