/**
 * A delete button that requires two clicks to confirm.
 * First click shows "Confirm", second click executes the delete.
 * Resets after a timeout or when clicking elsewhere.
 */
import { useState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { TrashIcon } from '../icons'

interface ConfirmDeleteButtonProps {
  /** Called when delete is confirmed (second click) */
  onConfirm: () => void | Promise<void>
  /** Whether the delete action is in progress */
  isDeleting?: boolean
  /** Timeout in ms before resetting to initial state (default: 3000) */
  timeout?: number
  /** Additional CSS classes */
  className?: string
  /** Title/tooltip for the button */
  title?: string
}

/**
 * Two-click delete button to prevent accidental deletions.
 *
 * Usage:
 * ```tsx
 * <ConfirmDeleteButton
 *   onConfirm={() => handleDelete(item.id)}
 *   isDeleting={deletingId === item.id}
 *   title="Delete item"
 * />
 * ```
 */
export function ConfirmDeleteButton({
  onConfirm,
  isDeleting = false,
  timeout = 3000,
  className = '',
  title = 'Delete',
}: ConfirmDeleteButtonProps): ReactNode {
  const [isConfirming, setIsConfirming] = useState(false)
  const timeoutRef = useRef<number | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  // Reset when clicking outside
  useEffect(() => {
    if (!isConfirming) return

    const handleClickOutside = (e: MouseEvent): void => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setIsConfirming(false)
        if (timeoutRef.current) {
          window.clearTimeout(timeoutRef.current)
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isConfirming])

  const handleClick = (): void => {
    if (isDeleting) return

    if (isConfirming) {
      // Second click - confirm delete
      setIsConfirming(false)
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current)
      }
      onConfirm()
    } else {
      // First click - show confirm state
      setIsConfirming(true)
      timeoutRef.current = window.setTimeout(() => {
        setIsConfirming(false)
      }, timeout)
    }
  }

  const baseClasses = 'p-2 h-8 rounded-lg transition-colors disabled:opacity-50 inline-flex items-center justify-center'
  const stateClasses = isConfirming
    ? 'bg-red-100 text-red-600 hover:bg-red-200'
    : 'text-gray-400 hover:text-red-600 hover:bg-red-50'

  return (
    <button
      ref={buttonRef}
      onClick={handleClick}
      disabled={isDeleting}
      className={`${baseClasses} ${stateClasses} ${className}`}
      title={isConfirming ? 'Click again to confirm' : title}
    >
      {isConfirming ? (
        <span className="inline-flex h-4 items-center text-xs font-medium leading-none">Confirm</span>
      ) : (
        <TrashIcon />
      )}
    </button>
  )
}
