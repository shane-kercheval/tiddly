/**
 * Simple tooltip component that shows content on hover.
 *
 * Features:
 * - 500ms delay before showing (hides immediately)
 * - Compact mode for short labels (action buttons)
 * - Wide mode for longer content (default)
 */
import type { ReactNode } from 'react'

interface TooltipProps {
  content: string
  children: ReactNode
  /** Use compact styling for short labels (e.g., action buttons) */
  compact?: boolean
}

export function Tooltip({ content, children, compact = false }: TooltipProps): ReactNode {
  const sizeClasses = compact
    ? 'px-2 py-1 whitespace-nowrap'
    : 'px-3 py-2 whitespace-normal w-64'

  return (
    <div className="relative inline-flex group/tooltip">
      {children}
      <div className={`absolute left-1/2 -translate-x-1/2 top-full mt-1 bg-gray-800 text-white text-xs rounded shadow-lg opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-opacity duration-150 group-hover/tooltip:delay-500 z-50 ${sizeClasses}`}>
        {content}
        {/* Arrow */}
        <div className="absolute left-1/2 -translate-x-1/2 bottom-full w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-800" />
      </div>
    </div>
  )
}
