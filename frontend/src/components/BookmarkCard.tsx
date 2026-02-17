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
  EditIcon,
  ArchiveIcon,
  RestoreIcon,
  TrashIcon,
  ExternalLinkIcon,
} from './icons'
import { CONTENT_TYPE_ICON_COLORS } from '../constants/contentTypeStyles'
import { ContentCard } from './ContentCard'

interface BookmarkCardProps {
  bookmark: BookmarkListItem
  view?: 'active' | 'archived' | 'deleted'
  sortBy?: SortByOption
  /**
   * Whether to show the bookmark content type icon on the left.
   * When true (default): shows BookmarkIcon in icon column
   * When false: shows favicon in icon column (used in bookmarks-only views)
   */
  showContentTypeIcon?: boolean
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
}

export function BookmarkCard({
  bookmark,
  view = 'active',
  sortBy = 'created_at',
  showContentTypeIcon = true,
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
}: BookmarkCardProps): ReactNode {
  const hasActions = !!(onDelete || onArchive || onUnarchive || onRestore || onEdit || onTagAdd || onCancelScheduledArchive)
  const hasTitle = !!bookmark.title
  const displayTitle = bookmark.title || getDomain(bookmark.url)
  const domain = getDomain(bookmark.url)
  // URL without query parameters for cleaner display
  const displayUrl = bookmark.url.split('?')[0]
  const faviconUrl = getGoogleFaviconUrl(bookmark.url) ?? `https://icons.duckduckgo.com/ip3/${domain}.ico`
  const defaultFavicon = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="%239CA3AF" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`

  const [copySuccess, setCopySuccess] = useState(false)
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current)
      }
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
      view={view}
      onClick={handleCardClick}
      href={`/app/bookmarks/${bookmark.id}`}
    >
      {/* Column 1: Icon (bookmark icon or favicon based on mode) */}
      <span className={`w-4 h-4 mt-1 ${showContentTypeIcon ? CONTENT_TYPE_ICON_COLORS.bookmark : ''}`}>
        {showContentTypeIcon ? (
          <BookmarkIcon className="w-4 h-4" />
        ) : (
          <img
            src={faviconUrl}
            alt=""
            className="w-4 h-4"
            loading="lazy"
            onError={(e) => {
              e.currentTarget.src = defaultFavicon
            }}
          />
        )}
      </span>

      {/* Column 2: Content - responsive layout */}
      <div className="min-w-0 flex-1">
        {/* Mobile layout - stacked vertically */}
        <div className="md:hidden flex flex-col gap-1.5">
          {/* Title row - clickable as link when no title (shows domain) */}
          {hasTitle ? (
            <span
              className="text-base font-medium text-gray-900 truncate"
            >
              {displayTitle}
            </span>
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

          {/* URL row (if has title) - always show as link on mobile (no hover) */}
          {hasTitle && (
            <Tooltip content="Open URL in new tab" compact>
              <a
                href={bookmark.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleUrlClick}
                className="flex items-center gap-1.5"
              >
                {showContentTypeIcon && (
                  <img
                    src={faviconUrl}
                    alt=""
                    className="w-4 h-4 shrink-0"
                    loading="lazy"
                    onError={(e) => {
                      e.currentTarget.src = defaultFavicon
                    }}
                  />
                )}
                <span className="text-[13px] text-blue-500 underline truncate">
                  {displayUrl}
                </span>
              </a>
            </Tooltip>
          )}

          {/* Description or content preview */}
          {(bookmark.description || bookmark.content_preview) && (
            <Tooltip content={bookmark.description || bookmark.content_preview} delay={500}>
              <p className="text-sm text-gray-400 line-clamp-2">
                {bookmark.description || bookmark.content_preview}
              </p>
            </Tooltip>
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
                {onCancelScheduledArchive && (
                  <ContentCard.ScheduledArchive
                    archivedAt={bookmark.archived_at}
                    onCancel={() => onCancelScheduledArchive(bookmark)}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Desktop layout - horizontal with hover actions */}
        <div className="hidden md:block">
          {/* Row 1: Title + favicon + tags + date */}
          <div className="flex items-start gap-2">
            {/* Left: Title and tags - title is clickable as link when no title (shows domain) */}
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0 flex-1">
              {hasTitle ? (
                <span
                  className="text-base font-medium text-gray-900 truncate"
                >
                  {displayTitle}
                </span>
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
              <ContentCard.Tags
                tags={bookmark.tags}
                onTagClick={onTagClick}
                onTagRemove={onTagRemove ? (tag) => onTagRemove(bookmark, tag) : undefined}
              />
            </div>

            {/* Right: Date */}
            {showDate && (
              <div className="shrink-0">
                <ContentCard.DateDisplay
                  sortBy={sortBy}
                  createdAt={bookmark.created_at}
                  updatedAt={bookmark.updated_at}
                  lastUsedAt={bookmark.last_used_at}
                  archivedAt={bookmark.archived_at}
                  deletedAt={bookmark.deleted_at}
                />
              </div>
            )}
          </div>

          {/* Row 2: URL line with favicon/external-link icon swap on hover + Archiving indicator */}
          <div className="flex items-center gap-2 mt-0.5">
            {hasTitle && (
              <Tooltip content="Open URL in new tab" compact>
                <a
                  href={bookmark.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={handleUrlClick}
                  className="group/url flex items-center gap-1.5 min-w-0 flex-1"
                >
                  {/* Icon container with crossfade transition */}
                  {showContentTypeIcon && (
                    <span className="relative w-4 h-4 shrink-0">
                      {/* Favicon - visible by default, fades out on hover */}
                      <img
                        src={faviconUrl}
                        alt=""
                        className="absolute inset-0 w-4 h-4 opacity-100 group-hover/url:opacity-0 transition-opacity duration-150"
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.src = defaultFavicon
                        }}
                      />
                      {/* External link icon - hidden by default, fades in on hover */}
                      <ExternalLinkIcon className="absolute inset-0 w-4 h-4 text-blue-500 opacity-0 group-hover/url:opacity-100 transition-opacity duration-150" />
                    </span>
                  )}
                  {/* URL text - plain by default, styled as link on hover */}
                  <span
                    className="text-[13px] text-gray-400 truncate group-hover/url:text-blue-500 group-hover/url:underline transition-colors duration-150"
                  >
                    {displayUrl}
                  </span>
                </a>
              </Tooltip>
            )}
            {!hasTitle && <div className="flex-1" />}
            {/* Archiving indicator on the right, between date and actions */}
            {onCancelScheduledArchive && (
              <ContentCard.ScheduledArchive
                archivedAt={bookmark.archived_at}
                onCancel={() => onCancelScheduledArchive(bookmark)}
              />
            )}
          </div>

          {/* Row 3: Description/preview + actions */}
          <div className="relative mt-1 min-h-[20px]">
            {/* Description or content preview fills available width */}
            {(bookmark.description || bookmark.content_preview) ? (
              <Tooltip content={bookmark.description || bookmark.content_preview} delay={500}>
                <p className={`text-sm text-gray-400 truncate ${hasActions ? 'pr-0 group-hover:pr-40 transition-[padding] duration-150' : ''}`}>
                  {bookmark.description || bookmark.content_preview}
                </p>
              </Tooltip>
            ) : (
              <p className={`text-sm text-gray-400 truncate ${hasActions ? 'pr-0 group-hover:pr-40 transition-[padding] duration-150' : ''}`}>
                {'\u00A0'}
              </p>
            )}

            {/* Actions absolutely positioned, appear on hover */}
            {hasActions && (
              <div className="absolute right-0 top-0">
                <ContentCard.Actions
                  overflowItems={[
                    {
                      key: 'open',
                      label: 'Open link',
                      icon: <ExternalLinkIcon className="h-4 w-4" />,
                      onClick: () => { onLinkClick?.(bookmark); window.open(bookmark.url, '_blank', 'noopener,noreferrer') },
                    },
                    {
                      key: 'edit',
                      label: 'Edit',
                      icon: <EditIcon className="h-4 w-4" />,
                      onClick: () => onEdit?.(bookmark),
                      hidden: view === 'deleted' || !onEdit,
                    },
                    {
                      key: 'copy',
                      label: 'Copy URL',
                      icon: <CopyIcon className="h-4 w-4" />,
                      onClick: () => { handleCopyUrl() },
                    },
                    {
                      key: 'archive',
                      label: 'Archive',
                      icon: <ArchiveIcon className="h-4 w-4" />,
                      onClick: () => onArchive?.(bookmark),
                      hidden: !onArchive || view !== 'active',
                    },
                    {
                      key: 'unarchive',
                      label: 'Restore',
                      icon: <RestoreIcon className="h-4 w-4" />,
                      onClick: () => onUnarchive?.(bookmark),
                      hidden: view !== 'archived' || !onUnarchive,
                    },
                    {
                      key: 'restore',
                      label: 'Restore',
                      icon: <RestoreIcon className="h-4 w-4" />,
                      onClick: () => onRestore?.(bookmark),
                      hidden: view !== 'deleted' || !onRestore,
                    },
                    {
                      key: 'delete',
                      label: view === 'deleted' ? 'Delete Permanently' : 'Delete',
                      icon: <TrashIcon className="h-4 w-4" />,
                      onClick: () => onDelete?.(bookmark),
                      danger: true,
                      hidden: !onDelete,
                    },
                  ]}
                >
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
      </div>
    </ContentCard>
  )
}
