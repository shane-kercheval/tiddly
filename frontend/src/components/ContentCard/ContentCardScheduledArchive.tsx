/**
 * Scheduled archive warning banner for ContentCard.
 *
 * Shows a warning when an item has a future archive date scheduled.
 * Only displays in active view when archived_at is in the future.
 * Optionally shows a cancel button to remove the scheduled archive.
 */
import type { ReactNode } from 'react'
import { useContentCardContext } from './ContentCardContext'
import { CloseIcon } from '../icons'
import { formatDate } from '../../utils'

interface ContentCardScheduledArchiveProps {
  /** ISO date string for when the item will be archived (can be null) */
  archivedAt: string | null
  /** Called when user cancels the scheduled archive */
  onCancel?: () => void
}

export function ContentCardScheduledArchive({
  archivedAt,
  onCancel,
}: ContentCardScheduledArchiveProps): ReactNode {
  const { view } = useContentCardContext()

  // Only show in active view when archived_at is in the future
  const hasScheduledArchive = view === 'active' &&
    archivedAt &&
    new Date(archivedAt) > new Date()

  if (!hasScheduledArchive) return null

  return (
    <span className="flex items-center gap-1 text-xs text-amber-600">
      <span>Archiving: {formatDate(archivedAt)}</span>
      {onCancel && (
        <button
          onClick={(e) => { e.stopPropagation(); onCancel() }}
          className="text-amber-500 hover:text-amber-700 transition-colors p-0.5 -m-0.5"
          title="Cancel scheduled archive"
          aria-label="Cancel scheduled archive"
        >
          <CloseIcon className="w-3 h-3" />
        </button>
      )}
    </span>
  )
}
