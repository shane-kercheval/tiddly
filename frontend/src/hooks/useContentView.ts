/**
 * Generic hook for deriving content view from route params.
 *
 * This is the shared implementation used by useBookmarkView and useNoteView.
 * It extracts the view state (active/archived/deleted) and optional filter ID
 * from the current route.
 */
import { useMemo } from 'react'
import { useLocation, useParams } from 'react-router-dom'

export type ContentView = 'active' | 'archived' | 'deleted'

export interface UseContentViewReturn {
  /** Current view for API calls */
  currentView: ContentView
  /** Filter ID for custom filter views */
  currentFilterId: string | undefined
}

/**
 * Generic hook for deriving content view from route.
 *
 * @param basePath - The base path for this content type (e.g., '/app/bookmarks', '/app/notes')
 *
 * Routes handled:
 * - {basePath} → view: 'active', filterId: undefined
 * - {basePath}/archived → view: 'archived', filterId: undefined
 * - {basePath}/trash → view: 'deleted', filterId: undefined
 * - {basePath}/filters/:filterId → view: 'active', filterId: string
 */
export function useContentView(basePath: string): UseContentViewReturn {
  const location = useLocation()
  const params = useParams<{ filterId?: string }>()

  const { currentView, currentFilterId } = useMemo(() => {
    const path = location.pathname

    if (path === `${basePath}/archived`) {
      return { currentView: 'archived' as ContentView, currentFilterId: undefined }
    }

    if (path === `${basePath}/trash`) {
      return { currentView: 'deleted' as ContentView, currentFilterId: undefined }
    }

    if (path.startsWith(`${basePath}/filters/`) && params.filterId) {
      return {
        currentView: 'active' as ContentView,
        currentFilterId: params.filterId,
      }
    }

    // Default: base path
    return { currentView: 'active' as ContentView, currentFilterId: undefined }
  }, [basePath, location.pathname, params.filterId])

  return { currentView, currentFilterId }
}
