/**
 * Hook to detect when an entity was modified elsewhere (another tab/device).
 *
 * Checks for staleness on tab focus by comparing the server's updated_at
 * with the loaded entity's updated_at. The check is silent and non-blocking -
 * no loading spinners, no error messages for network failures.
 *
 * @example
 * ```tsx
 * const { isStale, isDeleted, serverUpdatedAt, dismiss } = useStaleCheck({
 *   entityId: note?.id,
 *   loadedUpdatedAt: note?.updated_at,
 *   fetchUpdatedAt: (id) => fetchNoteMetadata(id).then(m => m.updated_at),
 * })
 *
 * // Show StaleDialog when isStale is true
 * <StaleDialog
 *   isOpen={isStale}
 *   serverUpdatedAt={serverUpdatedAt}
 *   onLoadServerVersion={handleRefresh}
 *   onContinueEditing={dismiss}
 * />
 * ```
 */
import { useState, useEffect, useCallback, useRef } from 'react'

interface UseStaleCheckOptions {
  /** The entity ID to check. If undefined, no check is performed. */
  entityId: string | undefined
  /** The loaded entity's updated_at timestamp. If undefined, no check is performed. */
  loadedUpdatedAt: string | undefined
  /** Function to fetch the current updated_at from the server. */
  fetchUpdatedAt: (id: string) => Promise<string>
}

interface UseStaleCheckResult {
  /** Whether the entity is stale (server has newer version). */
  isStale: boolean
  /** Whether the entity was deleted on the server (404 response). */
  isDeleted: boolean
  /** The server's updated_at timestamp if stale, for display. */
  serverUpdatedAt: string | null
  /** Dismiss the stale state (user chose to continue editing). */
  dismiss: () => void
}

/**
 * Hook to detect when an entity was modified elsewhere.
 *
 * Checks for staleness when the tab gains focus (visibilitychange event).
 * Errors are silently ignored to avoid interrupting the user.
 */
export function useStaleCheck({
  entityId,
  loadedUpdatedAt,
  fetchUpdatedAt,
}: UseStaleCheckOptions): UseStaleCheckResult {
  const [isStale, setIsStale] = useState(false)
  const [isDeleted, setIsDeleted] = useState(false)
  const [serverUpdatedAt, setServerUpdatedAt] = useState<string | null>(null)

  // Track current entity ID to guard against race conditions
  // (prevents setting state for old entity after navigation)
  const currentEntityIdRef = useRef<string | undefined>(entityId)

  // Reset state when entity changes (e.g., navigating to different note)
  useEffect(() => {
    currentEntityIdRef.current = entityId
    setIsStale(false)
    setIsDeleted(false)
    setServerUpdatedAt(null)
  }, [entityId])

  // Check for staleness on visibility change
  useEffect(() => {
    if (!entityId || !loadedUpdatedAt) return

    const checkStale = async (): Promise<void> => {
      // Only check when tab becomes visible
      if (document.visibilityState !== 'visible') return

      // Skip if already showing stale dialog for this entity
      if (isStale || isDeleted) return

      // Capture entityId at fetch start for race condition guard
      const fetchEntityId = entityId

      try {
        const currentUpdatedAt = await fetchUpdatedAt(fetchEntityId)

        // Guard against race condition: entity may have changed during fetch
        if (currentEntityIdRef.current !== fetchEntityId) return

        // Compare timestamps - stale if server is newer
        if (currentUpdatedAt !== loadedUpdatedAt) {
          setIsStale(true)
          setServerUpdatedAt(currentUpdatedAt)
        }
      } catch (error) {
        // Guard against race condition: entity may have changed during fetch
        if (currentEntityIdRef.current !== fetchEntityId) return

        // Check for 404 (entity deleted)
        if (
          error &&
          typeof error === 'object' &&
          'response' in error &&
          (error as { response?: { status?: number } }).response?.status === 404
        ) {
          setIsDeleted(true)
        }
        // Silently ignore other errors (network failures, etc.)
      }
    }

    // Listen for visibility changes
    document.addEventListener('visibilitychange', checkStale)

    return () => {
      document.removeEventListener('visibilitychange', checkStale)
    }
  }, [entityId, loadedUpdatedAt, fetchUpdatedAt, isStale, isDeleted])

  const dismiss = useCallback((): void => {
    setIsStale(false)
    setServerUpdatedAt(null)
  }, [])

  return {
    isStale,
    isDeleted,
    serverUpdatedAt,
    dismiss,
  }
}
