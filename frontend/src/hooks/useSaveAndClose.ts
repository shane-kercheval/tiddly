/**
 * useSaveAndClose - Hook for handling Cmd+Shift+S "save and close" functionality.
 *
 * Encapsulates the ref-based pattern for communicating intent from the keyboard
 * shortcut handler to the post-save success handler. This is a legitimate use
 * of refs in React for communicating across an async boundary.
 *
 * Usage:
 * 1. In keyboard handler: call requestSaveAndClose() then trigger form submit
 * 2. After successful save: call checkAndClose() to close if requested
 * 3. On error: call clearRequest() to reset the flag
 */
import { useRef, useCallback } from 'react'

interface UseSaveAndCloseOptions {
  /** Function to call to prevent navigation blocker from showing */
  confirmLeave: () => void
  /** Function to call to close the editor */
  onClose: () => void
}

interface UseSaveAndCloseReturn {
  /** Set the flag to close after save completes */
  requestSaveAndClose: () => void
  /** Check if close was requested, and if so, close and return true */
  checkAndClose: () => boolean
  /** Clear the request flag (call on error) */
  clearRequest: () => void
}

export function useSaveAndClose({
  confirmLeave,
  onClose,
}: UseSaveAndCloseOptions): UseSaveAndCloseReturn {
  const shouldCloseAfterSaveRef = useRef(false)

  const requestSaveAndClose = useCallback((): void => {
    shouldCloseAfterSaveRef.current = true
  }, [])

  const checkAndClose = useCallback((): boolean => {
    if (shouldCloseAfterSaveRef.current) {
      shouldCloseAfterSaveRef.current = false
      confirmLeave()
      onClose()
      return true
    }
    return false
  }, [confirmLeave, onClose])

  const clearRequest = useCallback((): void => {
    shouldCloseAfterSaveRef.current = false
  }, [])

  return {
    requestSaveAndClose,
    checkAndClose,
    clearRequest,
  }
}
