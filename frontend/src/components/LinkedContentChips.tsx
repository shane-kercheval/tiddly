/**
 * LinkedContentChips - Inline chip display for linked content relationships.
 *
 * Designed to sit in the metadata row alongside tags, auto-archive, etc.
 * Each chip shows a content type icon + title, colored by type.
 * Follows the same visual pattern as Tag components.
 */
import type { ReactNode } from 'react'
import { useContentRelationships, useRelationshipMutations } from '../hooks/useRelationships'
import { getLinkedItem } from '../utils/relationships'
import type { LinkedItem } from '../utils/relationships'
import { LinkIcon } from './icons'
import { Tooltip } from './ui'
import { CONTENT_TYPE_ICONS, CONTENT_TYPE_LABELS } from '../constants/contentTypeStyles'
import type { ContentType } from '../types'

interface LinkedContentChipsProps {
  contentType: ContentType
  contentId: string
  onAddClick?: () => void
  onNavigate?: (item: LinkedItem) => void
  disabled?: boolean
  /** Whether to show the inline add button (default: true). Set false when using an external trigger. */
  showAddButton?: boolean
}

/** Chip style per content type: light background + text color + border */
const CHIP_STYLES: Record<ContentType, string> = {
  bookmark: 'bg-brand-bookmark-light text-brand-bookmark border-brand-bookmark/20',
  note: 'bg-brand-note-light text-brand-note border-brand-note/20',
  prompt: 'bg-brand-prompt-light text-brand-prompt border-brand-prompt/20',
}

export function LinkedContentChips({
  contentType,
  contentId,
  onAddClick,
  onNavigate,
  disabled,
  showAddButton = true,
}: LinkedContentChipsProps): ReactNode {
  const { data, isLoading } = useContentRelationships(contentType, contentId)
  const { remove } = useRelationshipMutations()

  const items = data?.items.map((rel) => getLinkedItem(rel, contentType, contentId)) ?? []

  if (isLoading) return null

  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      {items.map((item) => {
        const Icon = CONTENT_TYPE_ICONS[item.type]
        const typeLabel = CONTENT_TYPE_LABELS[item.type]
        const chipStyle = CHIP_STYLES[item.type]
        const displayTitle = item.title ?? 'Untitled'

        const chipContent = (
          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-px text-xs font-normal border ${chipStyle} ${item.deleted ? 'opacity-60' : ''} ${item.archived ? 'opacity-60' : ''}`}>
            <Icon className="h-3 w-3" />
            <span className={`max-w-[120px] truncate ${item.deleted ? 'line-through' : ''}`}>
              {displayTitle}
            </span>
          </span>
        )

        return (
          <div key={item.relationshipId} className="group/link relative inline-flex items-baseline">
            {onNavigate && !item.deleted ? (
              <button
                type="button"
                onClick={() => onNavigate(item)}
                className="cursor-pointer"
                aria-label={`Go to ${typeLabel}: ${displayTitle}`}
              >
                {chipContent}
              </button>
            ) : (
              chipContent
            )}

            {/* Remove button — top-right circle, like Tag */}
            {!disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  remove.mutate(item.relationshipId)
                }}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-gray-500 hover:bg-red-500 text-white rounded-full opacity-0 group-hover/link:opacity-100 transition-opacity flex items-center justify-center"
                title="Remove link"
                aria-label={`Remove link to ${displayTitle}`}
              >
                <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </div>
        )
      })}

      {/* Add link button */}
      {showAddButton && onAddClick && !disabled && (
        <Tooltip content="Link content" compact>
          <button
            type="button"
            onClick={onAddClick}
            className="inline-flex items-center h-5 px-1 text-gray-500 rounded transition-colors hover:text-gray-700 hover:bg-gray-100"
            aria-label="Link content"
          >
            <LinkIcon className="h-4 w-4" />
          </button>
        </Tooltip>
      )}
    </div>
  )
}
