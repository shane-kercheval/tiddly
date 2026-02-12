/**
 * RelatedContent - Displays linked content relationships for any content item.
 *
 * Resolves "the other side" of each relationship using getLinkedItem(),
 * which handles canonical ordering so callers always see the linked item.
 */
import type { ReactNode } from 'react'
import { useContentRelationships, useRelationshipMutations } from '../hooks/useRelationships'
import { BookmarkIcon, NoteIcon, PromptIcon, PlusIcon, CloseIcon } from './icons'
import { CONTENT_TYPE_ICON_COLORS } from '../constants/contentTypeStyles'
import { LoadingSpinner } from './ui/LoadingSpinner'
import { getLinkedItem } from '../utils/relationships'
import type { LinkedItem } from '../utils/relationships'
import type { ContentType } from '../types'

interface RelatedContentProps {
  contentType: ContentType
  contentId: string
  onAddClick?: () => void
  onNavigate?: (item: LinkedItem) => void
  className?: string
}

const CONTENT_TYPE_ICONS: Record<ContentType, (props: { className?: string }) => ReactNode> = {
  bookmark: BookmarkIcon,
  note: NoteIcon,
  prompt: PromptIcon,
}

const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  bookmark: 'Bookmark',
  note: 'Note',
  prompt: 'Prompt',
}

export function RelatedContent({
  contentType,
  contentId,
  onAddClick,
  onNavigate,
  className = '',
}: RelatedContentProps): ReactNode {
  const { data, isLoading, isError, refetch } = useContentRelationships(contentType, contentId)
  const { remove } = useRelationshipMutations()

  const items = data?.items.map((rel) => getLinkedItem(rel, contentType, contentId)) ?? []

  return (
    <div className={className}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-gray-700">Linked Content</h3>
        {onAddClick && (
          <button
            onClick={onAddClick}
            className="btn-secondary flex items-center gap-1"
            aria-label="Link content"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            <span>Link</span>
          </button>
        )}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex justify-center py-6">
          <LoadingSpinner size="sm" label="Loading linked content..." />
        </div>
      )}

      {/* Error state */}
      {!isLoading && isError && (
        <div className="py-4 text-center">
          <p className="text-sm text-gray-400">Failed to load linked content.</p>
          <button onClick={() => refetch()} className="btn-secondary mt-2 text-xs">
            Retry
          </button>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !isError && items.length === 0 && (
        <p className="text-sm text-gray-400 py-4 text-center">
          No linked content yet.
        </p>
      )}

      {/* Items */}
      {!isLoading && !isError && items.length > 0 && (
        <ul className="space-y-1" role="list">
          {items.map((item) => {
            const Icon = CONTENT_TYPE_ICONS[item.type]
            const iconColor = CONTENT_TYPE_ICON_COLORS[item.type]
            const typeLabel = CONTENT_TYPE_LABELS[item.type]
            const displayTitle = item.title ?? 'Untitled'

            const titleContent = (
              <>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-sm truncate ${
                      item.deleted
                        ? 'line-through text-gray-400'
                        : 'text-gray-700'
                    }`}
                  >
                    {displayTitle}
                  </span>
                  {item.deleted && (
                    <span className="shrink-0 text-xs text-red-400 font-medium">deleted</span>
                  )}
                  {item.archived && !item.deleted && (
                    <span className="shrink-0 text-xs text-amber-500 font-medium">archived</span>
                  )}
                </div>
                {item.description && (
                  <p className="text-xs text-gray-400 mt-0.5 truncate">
                    {item.description}
                  </p>
                )}
              </>
            )

            return (
              <li
                key={item.relationshipId}
                className="group flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-gray-50 transition-colors"
              >
                {/* Content type icon */}
                <span className={`mt-0.5 shrink-0 ${iconColor}`} title={typeLabel}>
                  <Icon className="h-4 w-4" />
                </span>

                {/* Title and description — button when navigable, div when not */}
                {onNavigate ? (
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left cursor-pointer"
                    onClick={() => onNavigate(item)}
                    aria-label={`Go to ${typeLabel}: ${displayTitle}`}
                  >
                    {titleContent}
                  </button>
                ) : (
                  <div className="flex-1 min-w-0">
                    {titleContent}
                  </div>
                )}

                {/* Remove button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    remove.mutate(item.relationshipId)
                  }}
                  className="shrink-0 mt-0.5 p-0.5 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                  title="Remove link"
                  aria-label={`Remove link to ${displayTitle}`}
                >
                  <CloseIcon className="h-3.5 w-3.5" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
