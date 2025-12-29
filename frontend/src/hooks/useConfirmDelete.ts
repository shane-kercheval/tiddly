/**
 * Hook for two-click delete confirmation pattern.
 *
 * Encapsulates the state logic for requiring two clicks to confirm a delete action,
 * with automatic timeout reset and click-outside detection.
 *
 * Usage:
 * ```tsx
 * const { isConfirming, buttonRef, handleClick } = useConfirmDelete({
 *   onConfirm: () => deleteItem(id),
 *   timeout: 3000,
 * })
 *
 * <button ref={buttonRef} onClick={handleClick}>
 *   {isConfirming ? 'Delete?' : <TrashIcon />}
 * </button>
 * ```
 */
import { useState, useEffect, useRef, useCallback } from 'react'

/** Default timeout in ms before delete confirmation resets */
export const DEFAULT_CONFIRM_TIMEOUT = 3000

export interface UseConfirmDeleteOptions {
  /** Called when delete is confirmed (second click) */
  onConfirm: () => void | Promise<void>
  /** Timeout in ms before resetting to initial state (default: 3000) */
  timeout?: number
  /** Whether the delete action is currently in progress (disables clicks) */
  isDeleting?: boolean
}

export interface UseConfirmDeleteReturn {
  /** Whether we're in confirmation state (first click happened) */
  isConfirming: boolean
  /** Ref to attach to the button element for click-outside detection */
  buttonRef: React.RefObject<HTMLButtonElement | null>
  /** Click handler that implements the two-click pattern */
  handleClick: (e?: React.MouseEvent) => void
  /** Manually reset confirmation state */
  reset: () => void
}

/**
 * Hook for two-click delete confirmation.
 *
 * Prevents accidental deletions by requiring two clicks:
 * 1. First click shows confirmation state
 * 2. Second click executes the delete
 *
 * Automatically resets after timeout or when clicking outside the button.
 */
export function useConfirmDelete({
  onConfirm,
  timeout = DEFAULT_CONFIRM_TIMEOUT,
  isDeleting = false,
}: UseConfirmDeleteOptions): UseConfirmDeleteReturn {
  const [isConfirming, setIsConfirming] = useState(false)
  const timeoutRef = useRef<number | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  // Clear timeout helper
  const clearTimeoutRef = useCallback((): void => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  // Reset confirmation state
  const reset = useCallback((): void => {
    setIsConfirming(false)
    clearTimeoutRef()
  }, [clearTimeoutRef])

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      clearTimeoutRef()
    }
  }, [clearTimeoutRef])

  // Reset confirmation when clicking outside
  useEffect(() => {
    if (!isConfirming) return

    const handleClickOutside = (e: MouseEvent): void => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        reset()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isConfirming, reset])

  // Click handler implementing two-click pattern
  const handleClick = useCallback(
    (e?: React.MouseEvent): void => {
      if (e) {
        e.stopPropagation()
        e.preventDefault()
      }

      if (isDeleting) return

      if (isConfirming) {
        // Second click - execute delete
        reset()
        onConfirm()
      } else {
        // First click - show confirmation
        setIsConfirming(true)
        timeoutRef.current = window.setTimeout(() => {
          setIsConfirming(false)
        }, timeout)
      }
    },
    [isConfirming, isDeleting, onConfirm, reset, timeout]
  )

  return {
    isConfirming,
    buttonRef,
    handleClick,
    reset,
  }
}
