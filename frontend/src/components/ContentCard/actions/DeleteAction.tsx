/**
 * Delete action button for ContentCard.
 *
 * Uses context to determine delete behavior:
 * - In deleted view: shows ConfirmDeleteButton for permanent deletion
 * - In other views: shows simple delete button for soft delete
 *
 * Provides entity-specific aria-label for accessibility.
 */
import type { ReactNode } from 'react'
import { useContentCardContext } from '../ContentCardContext'
import { ConfirmDeleteButton, Tooltip } from '../../ui'
import { TrashIcon } from '../../icons'

interface DeleteActionProps {
  /** Called when delete is confirmed */
  onDelete: () => void
  /** Entity type for aria-label (e.g., "note", "prompt", "bookmark") */
  entityName: string
}

export function DeleteAction({ onDelete, entityName }: DeleteActionProps): ReactNode {
  const { view } = useContentCardContext()

  // Permanent delete in trash view requires confirmation
  if (view === 'deleted') {
    return (
      <span onClick={(e) => e.stopPropagation()}>
        <ConfirmDeleteButton
          onConfirm={onDelete}
          title="Delete permanently"
        />
      </span>
    )
  }

  // Soft delete in other views
  return (
    <Tooltip content="Delete" compact>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="btn-icon-danger"
        aria-label={`Delete ${entityName}`}
      >
        <TrashIcon className="h-4 w-4" />
      </button>
    </Tooltip>
  )
}
