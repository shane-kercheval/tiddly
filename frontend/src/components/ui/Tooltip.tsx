/**
 * Tooltip component that shows content on hover.
 *
 * Features:
 * - Configurable delay before showing (default: immediate)
 * - Compact mode for short labels (action buttons)
 * - Wide mode for longer content (default)
 * - Uses portal to render at body level (not clipped by overflow:hidden)
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'

interface TooltipProps {
  content: ReactNode
  children: ReactNode
  /** Use compact styling for short labels (e.g., action buttons) */
  compact?: boolean
  /** Position relative to trigger: 'bottom' (centered below), 'left' (to the left), or 'right' (to the right) */
  position?: 'bottom' | 'left' | 'right'
  /** Delay in ms before showing tooltip (default: 0 for immediate) */
  delay?: number
  /** Additional classes for the trigger wrapper */
  className?: string
}

interface Position {
  top: number
  left: number
}

export function Tooltip({ content, children, compact = false, position = 'bottom', delay = 0, className = '' }: TooltipProps): ReactNode {
  const [isVisible, setIsVisible] = useState(false)
  const [pos, setPos] = useState<Position>({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const timeoutRef = useRef<number | null>(null)

  const showTooltip = useCallback((): void => {
    // Clear any pending hide
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
    }

    const show = (): void => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect()
        if (position === 'left') {
          // Position to the left of trigger, vertically centered
          setPos({
            top: rect.top + rect.height / 2,
            left: rect.left - 4,
          })
        } else if (position === 'right') {
          // Position to the right of trigger, vertically centered
          setPos({
            top: rect.top + rect.height / 2,
            left: rect.right + 4,
          })
        } else {
          // Position below and centered (fixed positioning uses viewport coordinates)
          setPos({
            top: rect.bottom + 4,
            left: rect.left + rect.width / 2,
          })
        }
        setIsVisible(true)
      }
    }

    if (delay > 0) {
      timeoutRef.current = window.setTimeout(show, delay)
    } else {
      show()
    }
  }, [position, delay])

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

  // When no content provided, render children directly without wrapper or tooltip behavior
  if (content == null) return <>{children}</>

  const sizeClasses = compact
    ? 'px-2 py-1 whitespace-nowrap'
    : 'px-3 py-2 whitespace-normal max-w-64'

  return (
    <>
      <div
        ref={triggerRef}
        className={`inline-flex ${className}`}
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
            className={`fixed z-[9999] bg-gray-800 text-white text-xs rounded shadow-lg ${sizeClasses} ${
              position === 'left'
                ? '-translate-x-full -translate-y-1/2'
                : position === 'right'
                  ? '-translate-y-1/2'
                  : '-translate-x-1/2'
            }`}
            style={{ top: pos.top, left: pos.left }}
          >
            {content}
            {position === 'left' ? (
              /* Arrow pointing right */
              <div className="absolute top-1/2 -translate-y-1/2 left-full w-0 h-0 border-t-4 border-b-4 border-l-4 border-transparent border-l-gray-800" />
            ) : position === 'right' ? (
              /* Arrow pointing left */
              <div className="absolute top-1/2 -translate-y-1/2 right-full w-0 h-0 border-t-4 border-b-4 border-r-4 border-transparent border-r-gray-800" />
            ) : (
              /* Arrow pointing up */
              <div className="absolute left-1/2 -translate-x-1/2 bottom-full w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-gray-800" />
            )}
          </div>,
          document.body
        )}
    </>
  )
}
