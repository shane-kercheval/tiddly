/**
 * Tooltip component that shows content on hover.
 *
 * Features:
 * - 500ms delay before showing (hides immediately)
 * - Compact mode for short labels (action buttons)
 * - Wide mode for longer content (default)
 * - Uses portal to render at body level (not clipped by overflow:hidden)
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

interface TooltipProps {
  content: string
  children: ReactNode
  /** Use compact styling for short labels (e.g., action buttons) */
  compact?: boolean
}

interface Position {
  top: number
  left: number
}

export function Tooltip({ content, children, compact = false }: TooltipProps): ReactNode {
  const [isVisible, setIsVisible] = useState(false)
  const [position, setPosition] = useState<Position>({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<number | null>(null)

  const showTooltip = useCallback((): void => {
    // Clear any pending hide
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
    }
    // Delay showing by 500ms
    timeoutRef.current = window.setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect()
        // Position below and centered (fixed positioning uses viewport coordinates)
        setPosition({
          top: rect.bottom + 4,
          left: rect.left + rect.width / 2,
        })
        setIsVisible(true)
      }
    }, 500)
  }, [])

  const hideTooltip = useCallback((): void => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setIsVisible(false)
  }, [])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const sizeClasses = compact
    ? 'px-2 py-1 whitespace-nowrap'
    : 'px-3 py-2 whitespace-normal w-64'

  return (
    <>
      <div
        ref={triggerRef}
        className="inline-flex"
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
      >
        {children}
      </div>
      {isVisible &&
        createPortal(
          <div
            ref={tooltipRef}
            className={`fixed z-[9999] -translate-x-1/2 bg-gray-800 text-white text-xs rounded shadow-lg ${sizeClasses}`}
            style={{ top: position.top, left: position.left }}
          >
            {content}
            {/* Arrow pointing up */}
            <div className="absolute left-1/2 -translate-x-1/2 bottom-full w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-800" />
          </div>,
          document.body
        )}
    </>
  )
}
