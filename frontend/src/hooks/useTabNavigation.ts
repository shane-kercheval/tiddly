/**
 * Hook for managing tab navigation state in the bookmarks page.
 *
 * Handles:
 * - Parsing tab key from URL params or path
 * - Deriving view ('active' | 'archived' | 'deleted') from tab key
 * - Deriving filter ID for custom filter tabs
 * - Updating URL when tab changes
 */
import { useCallback, useMemo } from 'react'
import { useSearchParams, useLocation } from 'react-router-dom'

export type BookmarkView = 'active' | 'archived' | 'deleted'

interface DerivedTabState {
  view: BookmarkView
  filterId: string | undefined
}

/**
 * Pure function to derive view and filterId from a tab key.
 * Exported for unit testing.
 */
export function deriveViewFromTabKey(tabKey: string): DerivedTabState {
  if (tabKey === 'all') {
    return { view: 'active', filterId: undefined }
  }
  if (tabKey === 'archived') {
    return { view: 'archived', filterId: undefined }
  }
  if (tabKey === 'trash') {
    return { view: 'deleted', filterId: undefined }
  }
  if (tabKey.startsWith('filter:')) {
    const filterId = tabKey.replace('filter:', '')
    return { view: 'active', filterId: filterId || undefined }
  }
  // Default fallback
  return { view: 'active', filterId: undefined }
}

/**
 * Extract filter ID from path-based routes like /app/bookmarks/filters/12 or /app/bookmarks/filters/uuid
 */
function getFilterIdFromPath(pathname: string): string | undefined {
  const match = pathname.match(/\/filters\/([^/]+)/)
  if (match) {
    return match[1] || undefined
  }
  return undefined
}

/**
 * Extract view from path-based routes like /app/bookmarks/archived
 */
function getViewFromPath(pathname: string): BookmarkView {
  if (pathname.includes('/archived')) {
    return 'archived'
  }
  if (pathname.includes('/trash')) {
    return 'deleted'
  }
  return 'active'
}

export interface UseTabNavigationReturn {
  /** Current tab key from URL (e.g., 'all', 'archived', 'trash', 'filter:uuid') */
  currentTabKey: string
  /** Derived view for API calls */
  currentView: BookmarkView
  /** Derived filter ID for custom filter tabs */
  currentFilterId: string | undefined
  /** Handler to change the current tab */
  handleTabChange: (tabKey: string) => void
}

/**
 * Hook for tab navigation in the bookmarks page.
 *
 * Supports both query param routes (?tab=filter:5) and path-based routes (/filters/5).
 *
 * Usage:
 * ```tsx
 * const { currentTabKey, currentView, currentFilterId, handleTabChange } = useTabNavigation()
 *
 * // Use currentView and currentFilterId in API calls
 * fetchBookmarks({ view: currentView, filter_id: currentFilterId })
 *
 * // Handle tab clicks
 * <TabBar activeTabKey={currentTabKey} onTabChange={handleTabChange} />
 * ```
 */
export function useTabNavigation(): UseTabNavigationReturn {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()

  // Derive current state from URL (supports both query params and path-based routes)
  const { currentTabKey, currentView, currentFilterId } = useMemo(() => {
    // First check query params (e.g., ?tab=filter:5)
    const tabParam = searchParams.get('tab')
    if (tabParam) {
      const derived = deriveViewFromTabKey(tabParam)
      return {
        currentTabKey: tabParam,
        currentView: derived.view,
        currentFilterId: derived.filterId,
      }
    }

    // Fall back to path-based routes (e.g., /app/bookmarks/filters/5)
    const pathFilterId = getFilterIdFromPath(location.pathname)
    if (pathFilterId !== undefined) {
      return {
        currentTabKey: `filter:${pathFilterId}`,
        currentView: 'active' as BookmarkView,
        currentFilterId: pathFilterId,
      }
    }

    // Check for archived/trash in path
    const pathView = getViewFromPath(location.pathname)
    if (pathView === 'archived') {
      return {
        currentTabKey: 'archived',
        currentView: pathView,
        currentFilterId: undefined,
      }
    }
    if (pathView === 'deleted') {
      return {
        currentTabKey: 'trash',
        currentView: pathView,
        currentFilterId: undefined,
      }
    }

    // Default to 'all'
    return {
      currentTabKey: 'all',
      currentView: 'active' as BookmarkView,
      currentFilterId: undefined,
    }
  }, [searchParams, location.pathname])

  // Handler for tab change - updates URL
  const handleTabChange = useCallback(
    (tabKey: string) => {
      const newParams = new URLSearchParams(searchParams)

      // Set tab (use 'all' as default, don't store in URL)
      if (tabKey && tabKey !== 'all') {
        newParams.set('tab', tabKey)
      } else {
        newParams.delete('tab')
      }

      // Reset pagination when switching tabs
      newParams.delete('offset')

      setSearchParams(newParams, { replace: true })
    },
    [searchParams, setSearchParams]
  )

  return {
    currentTabKey,
    currentView,
    currentFilterId,
    handleTabChange,
  }
}
