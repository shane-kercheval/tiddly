/**
 * Hook for navigating to linked content items.
 *
 * Bookmarks open their URL in a new tab (with usage tracking).
 * Notes and prompts navigate to their detail pages.
 */
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBookmarks } from './useBookmarks'
import type { LinkedItem } from '../utils/relationships'

export function useLinkedNavigation(): (item: LinkedItem) => void {
  const navigate = useNavigate()
  const { trackBookmarkUsage } = useBookmarks()

  return useCallback((item: LinkedItem): void => {
    if (item.type === 'bookmark' && item.url) {
      trackBookmarkUsage(item.id)
      window.open(item.url, '_blank', 'noopener,noreferrer')
    } else if (item.type === 'note') {
      navigate(`/app/notes/${item.id}`)
    } else if (item.type === 'prompt') {
      navigate(`/app/prompts/${item.id}`)
    }
  }, [navigate, trackBookmarkUsage])
}
