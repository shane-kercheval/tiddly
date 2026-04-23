/**
 * Hook for navigating to linked content items.
 *
 * Bookmarks open their URL in a new tab (with usage tracking).
 * Shift+click on a bookmark navigates to its detail page in Tiddly instead — power-user
 * shortcut for the less common case where the user wants the entity, not the URL.
 * `trackBookmarkUsage` is intentionally NOT called on the Shift+click path: the user isn't
 * visiting the URL, so counting it would inflate usage metrics.
 * Notes and prompts always navigate to their detail pages (no modifier needed).
 */
import { useCallback } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBookmarks } from './useBookmarks'
import type { LinkedItem } from '../utils/relationships'

export function useLinkedNavigation(): (item: LinkedItem, event?: ReactMouseEvent) => void {
  const navigate = useNavigate()
  const { trackBookmarkUsage } = useBookmarks()

  return useCallback((item: LinkedItem, event?: ReactMouseEvent): void => {
    if (item.type === 'bookmark' && item.url) {
      if (event?.shiftKey) {
        navigate(`/app/bookmarks/${item.id}`)
      } else {
        trackBookmarkUsage(item.id)
        window.open(item.url, '_blank', 'noopener,noreferrer')
      }
    } else if (item.type === 'note') {
      navigate(`/app/notes/${item.id}`)
    } else if (item.type === 'prompt') {
      navigate(`/app/prompts/${item.id}`)
    }
  }, [navigate, trackBookmarkUsage])
}
