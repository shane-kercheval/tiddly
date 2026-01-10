/**
 * Hook for managing discard confirmation state.
 *
 * When users click Close/Escape with unsaved changes, shows "Discard?" for 3 seconds.
 * Clicking again within that window confirms the discard.
 */
import { useState, useCallback, useRef, useEffect } from 'react'

interface UseDiscardConfirmationOptions {
  /** Whether the form has unsaved changes */
  isDirty: boolean
  /** Called when discard is confirmed (or when not dirty) */
  onDiscard: () => void
  /** Called to prevent navigation blocker from showing */
  onConfirmLeave?: () => void
  /** Timeout duration in ms (default: 3000) */
  timeout?: number
}

interface UseDiscardConfirmationResult {
  /** Whether currently showing "Discard?" confirmation */
  isConfirming: boolean
  /** Call to request discard - first call shows confirmation, second call executes */
  requestDiscard: () => void
  /** Reset confirmation state (e.g., when Escape is pressed during confirmation) */
  resetConfirmation: () => void
}

export function useDiscardConfirmation({
  isDirty,
  onDiscard,
  onConfirmLeave,
  timeout = 3000,
}: UseDiscardConfirmationOptions): UseDiscardConfirmationResult {
  const [isConfirming, setIsConfirming] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Request discard - first call shows confirmation, second call executes
  const requestDiscard = useCallback((): void => {
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }

    if (!isDirty) {
      onDiscard()
      return
    }

    if (isConfirming) {
      // Already confirming, execute discard
      onConfirmLeave?.()
      onDiscard()
    } else {
      // Start confirmation
      setIsConfirming(true)
      // Auto-reset after timeout
      timeoutRef.current = setTimeout(() => {
        setIsConfirming(false)
      }, timeout)
    }
  }, [isDirty, isConfirming, onDiscard, onConfirmLeave, timeout])

  // Reset confirmation state
  const resetConfirmation = useCallback((): void => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setIsConfirming(false)
  }, [])

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return {
    isConfirming,
    requestDiscard,
    resetConfirmation,
  }
}
