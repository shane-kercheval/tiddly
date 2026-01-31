/**
 * Date display for ContentCard.
 *
 * Shows a short formatted date, with label shown on hover via tooltip.
 * The date shown depends on the current sort option.
 */
import type { ReactNode } from 'react'
import type { SortByOption } from '../../constants/sortOptions'
import { formatShortDate } from '../../utils'
import { Tooltip } from '../ui'

interface ContentCardDateDisplayProps {
  /** Current sort option - determines which date to show */
  sortBy: SortByOption
  /** ISO date string for when the item was created */
  createdAt: string
  /** ISO date string for when the item was last updated */
  updatedAt: string
  /** ISO date string for when the item was last used (can be null) */
  lastUsedAt: string | null
  /** ISO date string for when the item was archived (can be null) */
  archivedAt: string | null
  /** ISO date string for when the item was deleted (can be null) */
  deletedAt: string | null
  /** Show label inline (e.g., "Modified: Jan 31") instead of in tooltip. Useful for mobile. */
  showLabel?: boolean
}

export function ContentCardDateDisplay({
  sortBy,
  createdAt,
  updatedAt,
  lastUsedAt,
  archivedAt,
  deletedAt,
  showLabel = false,
}: ContentCardDateDisplayProps): ReactNode {
  // Get the date and label based on sort option
  const getDateInfo = (): { date: string; label: string } => {
    switch (sortBy) {
      case 'updated_at':
        return { date: updatedAt, label: 'Modified' }
      case 'last_used_at':
        return { date: lastUsedAt!, label: 'Used' }
      case 'archived_at':
        return { date: archivedAt!, label: 'Archived' }
      case 'deleted_at':
        return { date: deletedAt!, label: 'Deleted' }
      case 'created_at':
      case 'title':
      default:
        return { date: createdAt, label: 'Created' }
    }
  }

  const { date, label } = getDateInfo()
  const shortDate = formatShortDate(date)
  const tooltipText = `${label}: ${shortDate}`

  // On mobile (showLabel=true), show label inline. On desktop, use tooltip.
  if (showLabel) {
    return (
      <span className="text-xs text-gray-400">
        {label}: {shortDate}
      </span>
    )
  }

  return (
    <Tooltip content={tooltipText} compact position="left">
      <span className="text-xs text-gray-400">
        {shortDate}
      </span>
    </Tooltip>
  )
}
