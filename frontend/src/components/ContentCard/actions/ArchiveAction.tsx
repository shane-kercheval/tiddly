/**
 * Archive action button for ContentCard.
 *
 * Only renders in active view (uses context to check).
 * Provides entity-specific aria-label for accessibility.
 */
import type { ReactNode } from 'react'
import { useContentCardContext } from '../ContentCardContext'
import { Tooltip } from '../../ui'
import { ArchiveIcon } from '../../icons'

interface ArchiveActionProps {
  /** Called when archive button is clicked */
  onArchive: () => void
  /** Entity type for aria-label (e.g., "note", "prompt", "bookmark") */
  entityName: string
}

export function ArchiveAction({ onArchive, entityName }: ArchiveActionProps): ReactNode {
  const { view } = useContentCardContext()

  // Only show archive button in active view
  if (view !== 'active') return null

  return (
    <Tooltip content="Archive" compact>
      <button
        onClick={(e) => { e.stopPropagation(); onArchive() }}
        className="btn-icon"
        aria-label={`Archive ${entityName}`}
      >
        <ArchiveIcon className="h-4 w-4" />
      </button>
    </Tooltip>
  )
}
