/**
 * Wraps any icon with a small "+" badge in the upper-right corner.
 * The badge inherits currentColor so it matches brand colors.
 */
import type { ReactNode } from 'react'
import { PlusIcon } from './index'

interface IconWithBadgeProps {
  children: ReactNode
  className?: string
}

export function IconWithBadge({ children, className = '' }: IconWithBadgeProps): ReactNode {
  return (
    <span className={`relative block ${className}`}>
      {children}
      <PlusIcon className="absolute -top-0.5 -right-1.5 h-2 w-2 stroke-[3]" />
    </span>
  )
}
