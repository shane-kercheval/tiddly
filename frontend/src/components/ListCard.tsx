/**
 * List card component for displaying a bookmark list with its filter expression.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { BookmarkList, FilterExpression } from '../types'

interface ListCardProps {
  list: BookmarkList
  onEdit: (list: BookmarkList) => void
  onDelete: (list: BookmarkList) => Promise<void>
}

/** Edit icon */
const EditIcon = (): ReactNode => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
    />
  </svg>
)

/** Trash icon */
const TrashIcon = (): ReactNode => (
  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
    />
  </svg>
)

/**
 * Format filter expression for display.
 * Shows: (tag1 AND tag2) OR (tag3)
 */
function formatFilterExpression(expr: FilterExpression): string {
  if (!expr.groups || expr.groups.length === 0) {
    return 'No filters'
  }

  const groupStrings = expr.groups
    .filter((group) => group.tags && group.tags.length > 0)
    .map((group) => {
      if (group.tags.length === 1) {
        return group.tags[0]
      }
      return `(${group.tags.join(' AND ')})`
    })

  if (groupStrings.length === 0) {
    return 'No filters'
  }

  return groupStrings.join(' OR ')
}

/**
 * List card with edit and delete actions.
 */
export function ListCard({ list, onEdit, onDelete }: ListCardProps): ReactNode {
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = async (): Promise<void> => {
    if (!confirm(`Delete list "${list.name}"? This action cannot be undone.`)) {
      return
    }

    setIsDeleting(true)
    try {
      await onDelete(list)
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="flex items-center justify-between p-4 hover:bg-gray-50/50 transition-colors">
      <div className="min-w-0 flex-1">
        <h3 className="font-medium text-gray-900">{list.name}</h3>
        <p className="mt-1 text-sm text-gray-500 truncate">
          {formatFilterExpression(list.filter_expression)}
        </p>
      </div>
      <div className="ml-4 flex items-center gap-2">
        <button
          onClick={() => onEdit(list)}
          className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          title="Edit list"
        >
          <EditIcon />
        </button>
        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
          title="Delete list"
        >
          <TrashIcon />
        </button>
      </div>
    </div>
  )
}
