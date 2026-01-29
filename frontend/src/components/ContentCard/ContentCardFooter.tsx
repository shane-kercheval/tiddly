/**
 * Footer wrapper for ContentCard that handles responsive layout.
 *
 * On mobile: stacks children vertically with gap
 * On desktop: uses `md:contents` so children flow directly into parent flex
 */
import type { ReactNode } from 'react'

interface ContentCardFooterProps {
  children: ReactNode
}

export function ContentCardFooter({ children }: ContentCardFooterProps): ReactNode {
  // md:contents makes this wrapper "disappear" on desktop,
  // so children flow directly into the parent flex container
  return (
    <div className="flex flex-col gap-2 md:contents">
      {children}
    </div>
  )
}
