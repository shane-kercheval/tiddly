/**
 * Hook for managing tab navigation state in the bookmarks page.
 *
 * Handles:
 * - Parsing tab key from URL params or path
 * - Deriving view ('active' | 'archived' | 'deleted') from tab key
 * - Deriving list ID for custom list tabs
 * - Updating URL when tab changes
 */
import { useCallback, useMemo } from 'react'
import { useSearchParams, useLocation } from 'react-router-dom'

export type BookmarkView = 'active' | 'archived' | 'deleted'

interface DerivedTabState {
  view: BookmarkView
  listId: number | undefined
}

/**
 * Pure function to derive view and listId from a tab key.
 * Exported for unit testing.
 */
export function deriveViewFromTabKey(tabKey: string): DerivedTabState {
  if (tabKey === 'all') {
    return { view: 'active', listId: undefined }
  }
  if (tabKey === 'archived') {
    return { view: 'archived', listId: undefined }
  }
  if (tabKey === 'trash') {
    return { view: 'deleted', listId: undefined }
  }
  if (tabKey.startsWith('list:')) {
    const listId = parseInt(tabKey.replace('list:', ''), 10)
    return { view: 'active', listId: isNaN(listId) ? undefined : listId }
  }
  // Default fallback
  return { view: 'active', listId: undefined }
}

/**
 * Extract list ID from path-based routes like /app/bookmarks/lists/12
 */
function getListIdFromPath(pathname: string): number | undefined {
  const match = pathname.match(/\/lists\/(\d+)/)
  if (match) {
    const id = parseInt(match[1], 10)
    return isNaN(id) ? undefined : id
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
  /** Current tab key from URL (e.g., 'all', 'archived', 'trash', 'list:5') */
  currentTabKey: string
  /** Derived view for API calls */
  currentView: BookmarkView
  /** Derived list ID for custom list tabs */
  currentListId: number | undefined
  /** Handler to change the current tab */
  handleTabChange: (tabKey: string) => void
}

/**
 * Hook for tab navigation in the bookmarks page.
 *
 * Supports both query param routes (?tab=list:5) and path-based routes (/lists/5).
 *
 * Usage:
 * ```tsx
 * const { currentTabKey, currentView, currentListId, handleTabChange } = useTabNavigation()
 *
 * // Use currentView and currentListId in API calls
 * fetchBookmarks({ view: currentView, list_id: currentListId })
 *
 * // Handle tab clicks
 * <TabBar activeTabKey={currentTabKey} onTabChange={handleTabChange} />
 * ```
 */
export function useTabNavigation(): UseTabNavigationReturn {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()

  // Derive current state from URL (supports both query params and path-based routes)
  const { currentTabKey, currentView, currentListId } = useMemo(() => {
    // First check query params (e.g., ?tab=list:5)
    const tabParam = searchParams.get('tab')
    if (tabParam) {
      const derived = deriveViewFromTabKey(tabParam)
      return {
        currentTabKey: tabParam,
        currentView: derived.view,
        currentListId: derived.listId,
      }
    }

    // Fall back to path-based routes (e.g., /app/bookmarks/lists/5)
    const pathListId = getListIdFromPath(location.pathname)
    if (pathListId !== undefined) {
      return {
        currentTabKey: `list:${pathListId}`,
        currentView: 'active' as BookmarkView,
        currentListId: pathListId,
      }
    }

    // Check for archived/trash in path
    const pathView = getViewFromPath(location.pathname)
    if (pathView === 'archived') {
      return {
        currentTabKey: 'archived',
        currentView: pathView,
        currentListId: undefined,
      }
    }
    if (pathView === 'deleted') {
      return {
        currentTabKey: 'trash',
        currentView: pathView,
        currentListId: undefined,
      }
    }

    // Default to 'all'
    return {
      currentTabKey: 'all',
      currentView: 'active' as BookmarkView,
      currentListId: undefined,
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
    currentListId,
    handleTabChange,
  }
}
