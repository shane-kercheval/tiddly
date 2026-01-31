/**
 * Scheduled archive warning banner for ContentCard.
 *
 * Shows a warning when an item has a future archive date scheduled.
 * Only displays in active view when archived_at is in the future.
 * Optionally shows a cancel button to remove the scheduled archive.
 */
import type { ReactNode } from 'react'
import { useContentCardContext } from './ContentCardContext'
import { CloseIcon, ArchiveIcon } from '../icons'
import { formatShortDate } from '../../utils'
import { Tooltip } from '../ui'

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

  const shortDate = formatShortDate(archivedAt)
  const tooltipText = `Archiving: ${shortDate}`

  return (
    <span className="flex items-center gap-1 text-xs text-gray-400">
      <Tooltip content={tooltipText} compact position="left">
        <span className="flex items-center gap-1">
          <ArchiveIcon className="w-3 h-3" />
          <span>{shortDate}</span>
        </span>
      </Tooltip>
      {onCancel && (
        <Tooltip content="Cancel" compact>
          <button
            onClick={(e) => { e.stopPropagation(); onCancel() }}
            className="text-gray-400 hover:text-red-500 transition-colors p-0.5 -m-0.5"
            aria-label="Cancel scheduled archive"
          >
            <CloseIcon className="w-3 h-3" />
          </button>
        </Tooltip>
      )}
    </span>
  )
}
