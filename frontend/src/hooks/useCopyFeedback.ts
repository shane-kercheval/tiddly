/**
 * Hook for managing copy-to-clipboard feedback state.
 * Handles state transitions and timeout cleanup to prevent race conditions.
 */
import { useState, useRef, useCallback, useEffect } from 'react'

/** Copy operation states */
export type CopyState = 'idle' | 'loading' | 'success' | 'error'

/** Duration to show success/error state before returning to idle (ms) */
export const COPY_FEEDBACK_DURATION = 1000

interface UseCopyFeedbackResult {
  /** Current copy state */
  state: CopyState
  /** Set state to loading (for async operations) */
  setLoading: () => void
  /** Set state to success and schedule reset to idle */
  setSuccess: () => void
  /** Set state to error and schedule reset to idle */
  setError: () => void
  /** Reset state to idle immediately */
  reset: () => void
}

/**
 * Manages copy feedback state with automatic timeout cleanup.
 * Clears any pending timeouts when state changes to prevent race conditions
 * from rapid clicks or slow async operations.
 */
export function useCopyFeedback(): UseCopyFeedbackResult {
  const [state, setState] = useState<CopyState>('idle')
  const timeoutRef = useRef<number | null>(null)

  // Clear timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const clearPendingTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const scheduleReset = useCallback(() => {
    clearPendingTimeout()
    timeoutRef.current = window.setTimeout(() => {
      setState('idle')
      timeoutRef.current = null
    }, COPY_FEEDBACK_DURATION)
  }, [clearPendingTimeout])

  const setLoading = useCallback(() => {
    clearPendingTimeout()
    setState('loading')
  }, [clearPendingTimeout])

  const setSuccess = useCallback(() => {
    setState('success')
    scheduleReset()
  }, [scheduleReset])

  const setError = useCallback(() => {
    setState('error')
    scheduleReset()
  }, [scheduleReset])

  const reset = useCallback(() => {
    clearPendingTimeout()
    setState('idle')
  }, [clearPendingTimeout])

  return { state, setLoading, setSuccess, setError, reset }
}
