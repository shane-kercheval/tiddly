/**
 * Restore action button for ContentCard.
 *
 * Does NOT check view internally - the caller decides when to render.
 * Used for both "unarchive" (archived view) and "restore" (deleted view).
 * Provides entity-specific aria-label for accessibility.
 */
import type { ReactNode } from 'react'
import { Tooltip } from '../../ui'
import { RestoreIcon } from '../../icons'

interface RestoreActionProps {
  /** Called when restore button is clicked */
  onRestore: () => void
  /** Entity type for aria-label (e.g., "note", "prompt", "bookmark") */
  entityName: string
}

export function RestoreAction({ onRestore, entityName }: RestoreActionProps): ReactNode {
  return (
    <Tooltip content="Restore" compact>
      <button
        onClick={(e) => { e.stopPropagation(); onRestore() }}
        className="btn-icon"
        aria-label={`Restore ${entityName}`}
      >
        <RestoreIcon className="h-4 w-4" />
      </button>
    </Tooltip>
  )
}
