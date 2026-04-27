/**
 * Metadata column for ContentCard list-view rows.
 *
 * Renders the right-hand cluster of tags + scheduled archive + date
 * shared by BookmarkCard, NoteCard, and PromptCard. Owns the alignment
 * shims (relative top-px on tags, conditional top-1 on archive/date when
 * no tags) so the three card types stay visually identical.
 */
import type { ReactNode } from 'react'
import type { SortByOption } from '../../constants/sortOptions'
import { ContentCardTags } from './ContentCardTags'
import { ContentCardArchiveStatus } from './ContentCardArchiveStatus'
import { ContentCardDateDisplay } from './ContentCardDateDisplay'

interface ContentCardMetadataProps {
  tags: string[]
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  lastUsedAt: string | null
  deletedAt: string | null
  sortBy: SortByOption
  /** Whether to render the date. */
  showDate: boolean
  /** Whether to render an amber archived-indicator badge for effectively-archived items. */
  showArchivedIndicator: boolean
  onTagClick?: (tag: string) => void
  /** Pre-bound at the call site so this component stays untyped on the item. */
  onTagRemove?: (tag: string) => void
  /** Pre-bound at the call site. When provided, gates rendering of the scheduled-archive badge and adds a cancel button to it. */
  onCancelScheduledArchive?: () => void
}

export function ContentCardMetadata({
  tags,
  archivedAt,
  createdAt,
  updatedAt,
  lastUsedAt,
  deletedAt,
  sortBy,
  showDate,
  showArchivedIndicator,
  onTagClick,
  onTagRemove,
  onCancelScheduledArchive,
}: ContentCardMetadataProps): ReactNode {
  const noTagsNudge = tags.length === 0 ? 'relative top-1' : ''

  return (
    <div className="shrink-0 flex items-center gap-2">
      <div className="relative top-px">
        <ContentCardTags
          tags={tags}
          onTagClick={onTagClick}
          onTagRemove={onTagRemove}
        />
      </div>
      {(onCancelScheduledArchive || showArchivedIndicator) && (
        <div className={noTagsNudge}>
          <ContentCardArchiveStatus
            archivedAt={archivedAt}
            onCancel={onCancelScheduledArchive}
            showArchivedIndicator={showArchivedIndicator}
          />
        </div>
      )}
      {/* flex prevents Tooltip's inline-flex wrapper from inflating height via inherited line-height */}
      {showDate && (
        <span className={`shrink-0 flex ${noTagsNudge}`}>
          <ContentCardDateDisplay
            sortBy={sortBy}
            createdAt={createdAt}
            updatedAt={updatedAt}
            lastUsedAt={lastUsedAt}
            archivedAt={archivedAt}
            deletedAt={deletedAt}
          />
        </span>
      )}
    </div>
  )
}
