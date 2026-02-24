/**
 * Scheduled archive warning banner for ContentCard.
 *
 * Shows a warning when an item has a future archive date scheduled.
 * Only displays in active view when archived_at is in the future.
 * Optionally shows a cancel button to remove the scheduled archive.
 *
 * When showArchivedIndicator is true, also renders an amber "Archived: date"
 * badge for items that are effectively archived (past archived_at).
 */
import type { ReactNode } from 'react'
import { useContentCardContext } from './ContentCardContext'
import { CloseIcon, ArchiveIcon } from '../icons'
import { formatShortDate, isEffectivelyArchived } from '../../utils'
import { Tooltip } from '../ui'

interface ContentCardArchiveStatusProps {
  /** ISO date string for when the item will be archived (can be null) */
  archivedAt: string | null
  /** Called when user cancels the scheduled archive */
  onCancel?: () => void
  /** When true, show an amber badge for items that are effectively archived */
  showArchivedIndicator?: boolean
}

export function ContentCardArchiveStatus({
  archivedAt,
  onCancel,
  showArchivedIndicator = false,
}: ContentCardArchiveStatusProps): ReactNode {
  const { view } = useContentCardContext()

  // Only show in active view when archived_at is in the future (scheduled but not yet effective)
  const hasScheduledArchive = view === 'active' &&
    !!archivedAt &&
    !isEffectivelyArchived(archivedAt)

  // Show amber archived badge when opt-in and item is effectively archived
  const showArchived = showArchivedIndicator &&
    !!archivedAt &&
    isEffectivelyArchived(archivedAt)

  if (!hasScheduledArchive && !showArchived) return null

  const shortDate = formatShortDate(archivedAt)

  // Archived indicator: amber badge, no cancel button
  if (showArchived) {
    const tooltipText = `Archived: ${shortDate}`
    return (
      <span className="flex items-center gap-1 text-xs text-amber-500">
        <Tooltip content={tooltipText} compact position="left">
          <span className="flex items-baseline gap-1">
            <ArchiveIcon className="w-3 h-3 self-center" />
            <span>{shortDate}</span>
          </span>
        </Tooltip>
      </span>
    )
  }

  // Scheduled archive indicator: gray, with optional cancel button
  const tooltipText = `Archiving: ${shortDate}`
  return (
    <span className="flex items-center gap-1 text-xs text-gray-400">
      <Tooltip content={tooltipText} compact position="left">
        <span className="flex items-baseline gap-1">
          <ArchiveIcon className="w-3 h-3 self-center" />
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
