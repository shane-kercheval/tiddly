/**
 * Actions container for ContentCard.
 *
 * Desktop (md+): Shows actions on hover, absolutely positioned to not affect layout
 * Mobile: Shows overflow menu ("•••" button)
 */
import type { ReactNode } from 'react'
import { OverflowMenu } from './OverflowMenu'

interface OverflowMenuItem {
  key: string
  label: string
  icon: ReactNode
  onClick: () => void
  danger?: boolean
  hidden?: boolean
}

interface ContentCardActionsProps {
  /** Action buttons for desktop (hidden until hover) */
  children: ReactNode
  /** Items for the mobile overflow menu */
  overflowItems?: OverflowMenuItem[]
}

export function ContentCardActions({ children, overflowItems }: ContentCardActionsProps): ReactNode {
  // Filter out hidden items for overflow menu
  const visibleOverflowItems = overflowItems?.filter(item => !item.hidden) ?? []

  return (
    <>
      {/* Desktop: Hover-revealed actions - use invisible/visible to not affect layout when hidden.
          Note: bg-gray-100 must match card-interactive's hover:bg-gray-100 (index.css). */}
      <div className="hidden md:flex -mr-1.5 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity duration-150">
        <div className="w-10 shrink-0 self-stretch bg-gradient-to-r from-gray-100/0 to-gray-100" />
        <div className="flex items-center bg-gray-100 pl-3">
          {children}
        </div>
      </div>

      {/* Mobile: Overflow menu */}
      {visibleOverflowItems.length > 0 && (
        <div className="md:hidden">
          <OverflowMenu items={visibleOverflowItems} />
        </div>
      )}
    </>
  )
}
