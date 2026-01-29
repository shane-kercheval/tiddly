/**
 * Actions container for ContentCard.
 *
 * Handles the layout for action buttons and metadata (date display, scheduled archive).
 * On mobile: buttons left, meta right in a row
 * On desktop: buttons on top, meta below, aligned right
 */
import type { ReactNode } from 'react'

interface ContentCardActionsProps {
  /** Action buttons (AddTag, Archive, Restore, Delete, etc.) */
  children: ReactNode
  /** Metadata elements (DateDisplay, ScheduledArchive) */
  meta?: ReactNode
}

export function ContentCardActions({ children, meta }: ContentCardActionsProps): ReactNode {
  return (
    <div className="flex items-center justify-between w-full md:w-auto md:flex-col md:items-end md:shrink-0">
      <div className="flex items-center">
        {children}
      </div>
      {meta && (
        <div className="flex flex-col items-end gap-0.5">
          {meta}
        </div>
      )}
    </div>
  )
}
