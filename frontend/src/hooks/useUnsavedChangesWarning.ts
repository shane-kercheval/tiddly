/**
 * Hook to warn users about unsaved changes when navigating away.
 *
 * Uses React Router's useBlocker to intercept in-app navigation
 * and show a confirmation dialog.
 */
import { useContext, useCallback, useRef, useEffect } from 'react'
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom'
import type { Blocker } from 'react-router-dom'

interface UseUnsavedChangesWarningResult {
  /** Whether the warning dialog should be shown */
  showDialog: boolean
  /** Call this to cancel navigation and stay on the page */
  handleStay: () => void
  /** Call this to proceed with navigation and discard changes */
  handleLeave: () => void
  /** Call this before intentional navigation (save, discard) to prevent the dialog from showing */
  confirmLeave: () => void
}

/** Fallback blocker for when useBlocker is not available */
const UNBLOCKED_BLOCKER: Blocker = {
  state: 'unblocked',
  reset: undefined,
  proceed: undefined,
  location: undefined,
}

/**
 * Internal hook that safely uses useBlocker.
 * Returns an unblocked state when no data router is available (e.g., in tests).
 *
 * Note: The conditional hook call is intentional and safe here because
 * hasDataRouter is determined by context which is stable for a component's
 * lifetime - the hook count won't change between renders.
 */
function useBlockerSafe(shouldBlock: boolean | (() => boolean)): Blocker {
  // Check if we're inside a data router context
  const dataRouterContext = useContext(UNSAFE_DataRouterContext)
  const hasDataRouter = dataRouterContext != null

  // Only call useBlocker if we have a data router context
  // This allows the hook to work in tests that use MemoryRouter
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const blocker = hasDataRouter ? useBlocker(shouldBlock) : UNBLOCKED_BLOCKER

  return blocker
}

/**
 * Blocks navigation when there are unsaved changes and provides
 * dialog state management.
 *
 * @param isDirty - Whether the form has unsaved changes
 * @returns Dialog state, handlers, and confirmLeave function
 *
 * @example
 * ```tsx
 * const { showDialog, handleStay, handleLeave, confirmLeave } = useUnsavedChangesWarning(isDirty)
 *
 * const handleDiscard = () => {
 *   confirmLeave() // Prevent dialog from showing
 *   navigate('/home')
 * }
 *
 * const handleSave = async () => {
 *   confirmLeave() // Prevent dialog from showing
 *   await saveData()
 *   navigate('/home')
 * }
 *
 * return (
 *   <>
 *     {/* ... your form ... *\/}
 *     <UnsavedChangesDialog
 *       isOpen={showDialog}
 *       onStay={handleStay}
 *       onLeave={handleLeave}
 *     />
 *   </>
 * )
 * ```
 */
export function useUnsavedChangesWarning(isDirty: boolean): UseUnsavedChangesWarningResult {
  // Ref to track if user has confirmed they want to leave (discard, save, etc.)
  // Uses ref instead of state for synchronous updates - state updates are batched
  // and may not be visible to the blocker function at navigation time
  const confirmedLeaveRef = useRef(false)

  // Reset confirmedLeaveRef when form becomes clean (successful save, reset, etc.)
  // This ensures the blocker is re-enabled if the form becomes dirty again,
  // e.g., if a save fails and the user continues editing
  useEffect(() => {
    if (!isDirty) {
      confirmedLeaveRef.current = false
    }
  }, [isDirty])

  // Pass function to useBlocker so the ref check happens at navigation time, not render time
  const blocker = useBlockerSafe(() => isDirty && !confirmedLeaveRef.current)

  const showDialog = blocker.state === 'blocked'

  const handleStay = useCallback((): void => {
    if (blocker.state === 'blocked') {
      blocker.reset()
    }
  }, [blocker])

  const handleLeave = useCallback((): void => {
    if (blocker.state === 'blocked') {
      blocker.proceed()
    }
  }, [blocker])

  // Call this before intentional navigation to prevent the dialog from showing
  const confirmLeave = useCallback((): void => {
    confirmedLeaveRef.current = true
  }, [])

  return {
    showDialog,
    handleStay,
    handleLeave,
    confirmLeave,
  }
}
