/**
 * Footer/metadata container for ContentCard.
 *
 * Positioned on the right side of the card, showing date and actions.
 * Actions are hidden by default and appear on hover.
 */
import type { ReactNode } from 'react'

interface ContentCardFooterProps {
  children: ReactNode
}

export function ContentCardFooter({ children }: ContentCardFooterProps): ReactNode {
  return (
    <div className="flex flex-col items-end gap-0.5 shrink-0 ml-auto">
      {children}
    </div>
  )
}
