/**
 * Simple tooltip component that shows content on hover.
 */
import type { ReactNode } from 'react'

interface TooltipProps {
  content: string
  children: ReactNode
}

export function Tooltip({ content, children }: TooltipProps): ReactNode {
  return (
    <div className="relative inline-flex group">
      {children}
      <div className="absolute left-1/2 -translate-x-1/2 top-full mt-1 px-3 py-2 bg-gray-800 text-white text-xs rounded shadow-lg whitespace-normal w-64 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity z-50">
        {content}
        {/* Arrow */}
        <div className="absolute left-1/2 -translate-x-1/2 bottom-full w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-800" />
      </div>
    </div>
  )
}
