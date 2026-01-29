/**
 * Date display for ContentCard.
 *
 * Shows a formatted date with a label that changes based on the current
 * sort option (e.g., "Created:", "Modified:", "Used:").
 */
import type { ReactNode } from 'react'
import type { SortByOption } from '../../constants/sortOptions'
import { formatDate } from '../../utils'

interface ContentCardDateDisplayProps {
  /** Current sort option - determines which date and label to show */
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
}

export function ContentCardDateDisplay({
  sortBy,
  createdAt,
  updatedAt,
  lastUsedAt,
  archivedAt,
  deletedAt,
}: ContentCardDateDisplayProps): ReactNode {
  const getDateDisplay = (): string => {
    switch (sortBy) {
      case 'updated_at':
        return `Modified: ${formatDate(updatedAt)}`
      case 'last_used_at':
        return `Used: ${formatDate(lastUsedAt!)}`
      case 'archived_at':
        return `Archived: ${formatDate(archivedAt!)}`
      case 'deleted_at':
        return `Deleted: ${formatDate(deletedAt!)}`
      case 'created_at':
      case 'title':
      default:
        return `Created: ${formatDate(createdAt)}`
    }
  }

  return (
    <span className="text-xs text-gray-400">
      {getDateDisplay()}
    </span>
  )
}
