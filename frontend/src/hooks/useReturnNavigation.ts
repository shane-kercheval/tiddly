/**
 * Hook for consistent "return to list" navigation.
 *
 * Provides:
 * - navigateBack(): Navigate to the previous list (uses returnTo state or falls back to /app/content)
 * - createReturnState(): Create location state with current URL for use when navigating to detail pages
 *
 * Usage:
 * ```tsx
 * // In a list page, when navigating to a detail page:
 * const { createReturnState } = useReturnNavigation()
 * navigate(`/app/notes/${note.id}`, { state: createReturnState() })
 *
 * // In a detail page, when navigating back:
 * const { navigateBack } = useReturnNavigation()
 * navigateBack()
 * ```
 */
import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

interface ReturnNavigationState {
  returnTo?: string
}

interface UseReturnNavigationResult {
  /** Navigate back to the previous list (or /app/content if no returnTo) */
  navigateBack: () => void
  /** The returnTo URL from location state, if present */
  returnTo: string | undefined
  /** Create state object with current URL for passing to detail page navigation */
  createReturnState: () => ReturnNavigationState
}

export function useReturnNavigation(): UseReturnNavigationResult {
  const location = useLocation()
  const navigate = useNavigate()

  const locationState = location.state as ReturnNavigationState | undefined
  const returnTo = locationState?.returnTo

  const navigateBack = useCallback((): void => {
    // Forward any extra state (e.g. selectedContentIndex) back to the list page
    const restState = Object.fromEntries(
      Object.entries((locationState ?? {}) as Record<string, unknown>).filter(([k]) => k !== 'returnTo')
    )
    const destination = returnTo ?? '/app/content'
    if (Object.keys(restState).length > 0) {
      navigate(destination, { state: restState })
    } else {
      navigate(destination)
    }
  }, [navigate, returnTo, locationState])

  const createReturnState = useCallback((): ReturnNavigationState => ({
    returnTo: location.pathname + location.search,
  }), [location.pathname, location.search])

  return { navigateBack, returnTo, createReturnState }
}
